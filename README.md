# WebRTC Explorer

A lightweight WebRTC screen sharing demo with manual signaling - no server
required.

## Features

- Screen sharing with audio support
- Manual copy/paste signaling (no signaling server needed)
- Adjustable video quality (1-20 Mbps)

## Quick Start

```bash
# Start with
deno task build
# Then run
deno task serve
```

Open [http://localhost:8080](http://localhost:8080) in two browser windows/tabs.

## Usage

1. **Sender window**: Click "Start Screen Share" and select what to share
2. **Sender window**: Click "Generate Offer" and copy the generated offer
3. **Receiver window**: Paste the offer and click "Apply Offer"
4. **Receiver window**: Copy the generated answer
5. **Sender window**: Paste the answer and click "Apply Answer"
6. **Receiver window**: Click the audio button to enable sound

The connection will establish automatically via WebRTC peer-to-peer.

## Project Structure

```
webrtc-explorer/
├── public/
│   └── webrtc.html       # Main HTML interface
├── src/
│   ├── webrtc.ts         # WebRTC logic (signaling, peer connection)
│   └── inline.ts         # Build script for inlining JS
├── dist/                 # Build output
└── deno.json             # Deno configuration and tasks
```

## Available Tasks

```bash
deno task serve    # Serve the app on port 8080
deno task bundle   # Bundle TypeScript
deno task watch    # Watch mode for development
deno task build    # Production build
```

## Technical Details

- Uses Google STUN servers for NAT traversal
- VP9 codec preference for screen content
- Base64-encoded SDP bundles with ICE candidates
- No external signaling server or dependencies
- Pure TypeScript with Deno runtime
