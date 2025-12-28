# Excalidraw Collaboration Workers

This folder contains the Cloudflare Workers code for real-time collaboration in Excalidraw. It uses Durable Objects to manage WebSocket connections for each collaboration room.

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│  Excalidraw     │◄──────────────────►│  Cloudflare      │
│  Client         │                    │  Worker          │
└─────────────────┘                    └────────┬─────────┘
                                                │
                                                ▼
                                       ┌──────────────────┐
                                       │  Durable Object  │
                                       │  (Room)          │
                                       └──────────────────┘
```

## Prerequisites

- Node.js 18+
- A Cloudflare account with Workers and Durable Objects enabled

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Login to Cloudflare:
   ```bash
   npx wrangler login
   ```

## Development

Start the local development server:
```bash
npm run dev
```

This will start the worker at `http://localhost:8787`.

## Deployment

Deploy to Cloudflare:
```bash
npm run deploy
```

After deployment, update your Excalidraw app's `.env` file:
```
VITE_APP_CLOUDFLARE_WS_URL=wss://excalidraw-collab.<your-subdomain>.workers.dev
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API information |
| `GET /health` | Health check |
| `GET /room/:roomId` | WebSocket upgrade for collaboration |
| `GET /room/:roomId/info` | Room information (user count) |

## WebSocket Protocol

### Connection

Connect to: `wss://<worker-url>/room/<roomId>?socketId=<uuid>&username=<name>`

### Message Types

#### Binary Messages
All encrypted scene data is sent as binary messages with format:
```
[4 bytes: IV length][IV bytes][encrypted data]
```

#### JSON Messages

**Broadcast** (send/receive):
```json
{
  "type": "broadcast",
  "event": "server-broadcast",
  "payload": { ... }
}
```

**Presence** (receive):
```json
{
  "type": "presence",
  "event": "sync" | "join" | "leave",
  "users": [{ "socketId": "...", "username": "..." }]
}
```

## Monitoring

View real-time logs:
```bash
npm run tail
```
