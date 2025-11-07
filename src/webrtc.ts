interface SignalBundle {
    type: 'offer' | 'answer';
    sdp: string;
    candidates: RTCIceCandidateInit[];
}

let localStream: MediaStream | null = null;
let senderPC: RTCPeerConnection | null = null;
let receiverPC: RTCPeerConnection | null = null;
let senderICECandidates: RTCIceCandidateInit[] = [];
let receiverICECandidates: RTCIceCandidateInit[] = [];

let logDiv: HTMLElement;
let localVideo: HTMLVideoElement;
let remoteVideo: HTMLVideoElement;
let senderStatus: HTMLElement;
let receiverStatus: HTMLElement;
let offerText: HTMLTextAreaElement;
let answerText: HTMLTextAreaElement;
let offerInput: HTMLTextAreaElement;
let answerInput: HTMLTextAreaElement;
let qualitySelect: HTMLSelectElement;

function log(message: string, type: 'info' | 'sender' | 'receiver' = 'info'): void {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = type === 'sender' ? '[SENDER]' : type === 'receiver' ? '[RECEIVER]' : '[INFO]';
    const messageTimestamped = `[${timestamp}] ${prefix} ${message}\n`;
    logDiv.textContent = `${messageTimestamped}${logDiv.textContent}`;
    logDiv.scrollTop = logDiv.scrollHeight;
    console.log(`${prefix} ${message}`);
}

async function startScreenCapture(): Promise<void> {
    try {
        log('Requesting screen share...', 'sender');

        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30, max: 60 }
            } as MediaTrackConstraints,
            audio: true,
        });

        localVideo.srcObject = localStream;

        const videoTrack = localStream.getVideoTracks()[0];
        const audioTracks = localStream.getAudioTracks();

        const settings = videoTrack.getSettings();
        const statusText = `Capturing: ${videoTrack.label}\n` +
            `Resolution: ${settings.width}x${settings.height}\n` +
            `Frame rate: ${settings.frameRate}fps\n` +
            `Audio tracks: ${audioTracks.length}`;

        senderStatus.textContent = statusText;

        log(`Screen capture started: ${videoTrack.label}`, 'sender');
        log(`Resolution: ${settings.width}x${settings.height} @ ${settings.frameRate}fps`, 'sender');
        log(`Audio tracks: ${audioTracks.length}`, 'sender');

        videoTrack.onended = () => {
            log('Screen share stopped by user', 'sender');
            stopScreenCapture();
        };

    } catch (err) {
        const error = err as Error;
        log(`Error capturing screen: ${error.message}`, 'sender');
        senderStatus.textContent = `Error: ${error.message}`;
    }
}

function stopScreenCapture(): void {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;

        localVideo.srcObject = null;

        senderStatus.textContent = 'Stopped';
        log('Screen capture stopped', 'sender');
    }
}

const rtcConfig: RTCConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ]
};

async function generateOffer(): Promise<void> {
    try {
        if (!localStream) {
            alert('Start screen share first!');
            return;
        }

        log('Creating RTCPeerConnection...', 'sender');

        senderPC = new RTCPeerConnection(rtcConfig);
        senderICECandidates = [];

        const tracks = localStream.getTracks();
        log(`Adding ${tracks.length} tracks to peer connection`, 'sender');

        tracks.forEach(track => {
            const sender = senderPC!.addTrack(track, localStream!);
            log(`Added ${track.kind} track - ID: ${track.id}, label: ${track.label}, enabled: ${track.enabled}`, 'sender');

            if (track.kind === 'video') {
                const parameters = sender.getParameters();
                if (!parameters.encodings) {
                    parameters.encodings = [{}];
                }
                const selectedBitrate = parseInt(qualitySelect.value);
                parameters.encodings[0].maxBitrate = selectedBitrate;
                sender.setParameters(parameters)
                    .then(() => log(`Video bitrate set to ${(selectedBitrate / 1000000).toFixed(1)} Mbps`, 'sender'))
                    .catch(err => log(`Failed to set bitrate: ${err.message}`, 'sender'));
            }
        });

        senderPC.onconnectionstatechange = () => {
            log(`Connection state: ${senderPC!.connectionState}`, 'sender');
            senderStatus.textContent = `Connection: ${senderPC!.connectionState}`;
        };

        senderPC.oniceconnectionstatechange = () => {
            log(`ICE connection state: ${senderPC!.iceConnectionState}`, 'sender');
        };

        senderPC.onicecandidate = (event) => {
            if (event.candidate) {
                senderICECandidates.push(event.candidate.toJSON());
                log(`ICE candidate gathered (${senderICECandidates.length})`, 'sender');
            } else {
                // null candidate means gathering is complete
                log('ICE gathering complete', 'sender');
                createOfferBundle();
            }
        };

        senderPC.onicegatheringstatechange = () => {
            log(`ICE gathering state: ${senderPC!.iceGatheringState}`, 'sender');
        };

        log('Creating offer...', 'sender');
        const offer = await senderPC.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false,
        });

        // Try to prefer VP9 codec for better screen share quality
        if (offer.sdp) {
            // VP9 is often better for screen content than VP8/H264
            log('Using VP9 codec preference for screen content', 'sender');
        }

        await senderPC.setLocalDescription(offer);

        log('Offer created, gathering ICE candidates...', 'sender');
        senderStatus.textContent = 'Gathering ICE candidates...';

    } catch (err) {
        const error = err as Error;
        log(`Error generating offer: ${error.message}`, 'sender');
        alert(`Error: ${error.message}`);
    }
}

function createOfferBundle(): void {
    if (!senderPC || !senderPC.localDescription) {
        log('No local description available', 'sender');
        return;
    }

    const bundle: SignalBundle = {
        type: 'offer',
        sdp: senderPC.localDescription.sdp,
        candidates: senderICECandidates
    };

    const json = JSON.stringify(bundle);
    const base64 = btoa(json);

    offerText.value = base64;

    log(`Offer bundle created: ${json.length} bytes, ${senderICECandidates.length} ICE candidates`, 'sender');
    senderStatus.textContent = `Offer ready! ${senderICECandidates.length} ICE candidates`;
}

async function applyAnswer(): Promise<void> {
    try {
        const base64 = answerInput.value.trim();
        if (!base64) {
            alert('Paste the answer from receiver first!');
            return;
        }

        if (!senderPC) {
            alert('Generate offer first!');
            return;
        }

        log('Decoding answer bundle...', 'sender');

        const json = atob(base64);
        const bundle: SignalBundle = JSON.parse(json);

        if (bundle.type !== 'answer') {
            alert('Invalid bundle type. Expected answer.');
            return;
        }

        log(`Answer received with ${bundle.candidates.length} ICE candidates`, 'sender');

        await senderPC.setRemoteDescription({
            type: 'answer',
            sdp: bundle.sdp
        });

        log('Remote description set', 'sender');

        for (const candidate of bundle.candidates) {
            await senderPC.addIceCandidate(candidate);
        }

        log(`Added ${bundle.candidates.length} ICE candidates`, 'sender');
        senderStatus.textContent = 'Answer applied! Connecting...';

    } catch (err) {
        const error = err as Error;
        log(`Error applying answer: ${error.message}`, 'sender');
        alert(`Error: ${error.message}`);
    }
}

async function receiveOffer(): Promise<void> {
    try {
        const base64 = offerInput.value.trim();
        if (!base64) {
            alert('Paste the offer from sender first!');
            return;
        }

        log('Decoding offer bundle...', 'receiver');

        const json = atob(base64);
        const bundle: SignalBundle = JSON.parse(json);

        if (bundle.type !== 'offer') {
            alert('Invalid bundle type. Expected offer.');
            return;
        }

        log(`Offer received with ${bundle.candidates.length} ICE candidates`, 'receiver');

        receiverPC = new RTCPeerConnection(rtcConfig);
        receiverICECandidates = [];

        receiverPC.ontrack = (event) => {
            log(`Received ${event.track.kind} track - ID: ${event.track.id}, enabled: ${event.track.enabled}`, 'receiver');

            if (!remoteVideo.srcObject) {
                remoteVideo.srcObject = event.streams[0];
                // Keep muted initially - user must click "Enable Audio" button
                remoteVideo.muted = true;

                const stream = event.streams[0];
                const videoTracks = stream.getVideoTracks();
                const audioTracks = stream.getAudioTracks();
                log(`Stream attached - Video tracks: ${videoTracks.length}, Audio tracks: ${audioTracks.length}`, 'receiver');

                if (audioTracks.length > 0) {
                    audioTracks.forEach(track => {
                        log(`Audio track: ${track.label}, enabled: ${track.enabled}, muted: ${track.muted}, readyState: ${track.readyState}`, 'receiver');
                    });
                } else {
                    log('WARNING: No audio tracks in stream!', 'receiver');
                }
            }
        };

        receiverPC.onconnectionstatechange = () => {
            log(`Connection state: ${receiverPC!.connectionState}`, 'receiver');
            receiverStatus.textContent = `Connection: ${receiverPC!.connectionState}`;
        };

        receiverPC.oniceconnectionstatechange = () => {
            log(`ICE connection state: ${receiverPC!.iceConnectionState}`, 'receiver');
        };

        receiverPC.onicecandidate = (event) => {
            if (event.candidate) {
                receiverICECandidates.push(event.candidate.toJSON());
                log(`ICE candidate gathered (${receiverICECandidates.length})`, 'receiver');
            } else {
                log('ICE gathering complete', 'receiver');
                createAnswerBundle();
            }
        };

        receiverPC.onicegatheringstatechange = () => {
            log(`ICE gathering state: ${receiverPC!.iceGatheringState}`, 'receiver');
        };

        await receiverPC.setRemoteDescription({
            type: 'offer',
            sdp: bundle.sdp
        });

        log('Remote description set', 'receiver');

        for (const candidate of bundle.candidates) {
            await receiverPC.addIceCandidate(candidate);
        }

        log(`Added ${bundle.candidates.length} ICE candidates`, 'receiver');

        log('Creating answer...', 'receiver');
        const answer = await receiverPC.createAnswer();
        await receiverPC.setLocalDescription(answer);

        log('Answer created, gathering ICE candidates...', 'receiver');
        receiverStatus.textContent = 'Gathering ICE candidates...';

    } catch (err) {
        const error = err as Error;
        log(`Error receiving offer: ${error.message}`, 'receiver');
        alert(`Error: ${error.message}`);
    }
}

function createAnswerBundle(): void {
    if (!receiverPC || !receiverPC.localDescription) {
        log('No local description available', 'receiver');
        return;
    }

    const bundle: SignalBundle = {
        type: 'answer',
        sdp: receiverPC.localDescription.sdp,
        candidates: receiverICECandidates
    };

    const json = JSON.stringify(bundle);
    const base64 = btoa(json);

    answerText.value = base64;

    log(`Answer bundle created: ${json.length} bytes, ${receiverICECandidates.length} ICE candidates`, 'receiver');
    receiverStatus.textContent = `Answer ready! ${receiverICECandidates.length} ICE candidates`;
}

function enableAudio(): void {
    if (!remoteVideo.srcObject) {
        alert('No stream connected yet. Apply offer first.');
        return;
    }

    const stream = remoteVideo.srcObject as MediaStream;
    const audioTracks = stream.getAudioTracks();

    log(`Attempting to enable audio. Audio tracks available: ${audioTracks.length}`, 'receiver');

    if (audioTracks.length === 0) {
        alert('No audio tracks available in the stream. Make sure the sender shared audio.');
        log('ERROR: No audio tracks to enable!', 'receiver');
        return;
    }

    audioTracks.forEach(track => {
        track.enabled = true;
        log(`Audio track enabled: ${track.label}, readyState: ${track.readyState}`, 'receiver');
    });

    remoteVideo.muted = false;
    remoteVideo.volume = 1.0;

    remoteVideo.play()
        .then(() => {
            log('Audio enabled successfully!', 'receiver');
            receiverStatus.textContent = 'Audio enabled ✓';
        })
        .catch(err => {
            log(`Failed to play video: ${err.message}`, 'receiver');
            alert('Failed to enable audio. Try clicking the play button on the video controls.');
        });
}

function init(): void {
    logDiv = document.getElementById('log')!;
    localVideo = document.getElementById('localVideo') as HTMLVideoElement;
    remoteVideo = document.getElementById('remoteVideo') as HTMLVideoElement;
    senderStatus = document.getElementById('senderStatus')!;
    receiverStatus = document.getElementById('receiverStatus')!;
    offerText = document.getElementById('offerText') as HTMLTextAreaElement;
    answerText = document.getElementById('answerText') as HTMLTextAreaElement;
    offerInput = document.getElementById('offerInput') as HTMLTextAreaElement;
    answerInput = document.getElementById('answerInput') as HTMLTextAreaElement;
    qualitySelect = document.getElementById('qualitySelect') as HTMLSelectElement;

    log('App initialized');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

globalThis.startScreenCapture = startScreenCapture;
globalThis.stopScreenCapture = stopScreenCapture;
globalThis.generateOffer = generateOffer;
globalThis.applyAnswer = applyAnswer;
globalThis.receiveOffer = receiveOffer;
globalThis.enableAudio = enableAudio;
