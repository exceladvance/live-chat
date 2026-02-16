# Live Session (Real-Time Chat + Polls)

Production-ready starter for temporary live Q&A sessions with:

- Name-only entry (no login/signup)
- Real-time chat
- Real-time polls with live results
- Moderator mode via `?moderator=true`

## Architecture

**Option B** stack:

- Frontend: React + Vite (`client/`)
- Backend: Node.js + Express + Socket.IO (`server/`)
- Real-time transport: WebSockets via Socket.IO
- Data: in-memory session state for messages/polls

## Features

- Name prompt modal, stored in `localStorage` with 10-hour TTL and browser-session binding
- Auto reconnect with Socket.IO
- Chat message validation and rate limiting
- Poll creation/close restricted to moderators
- Voting by participants, one vote per poll per browser (`voterKey` + local storage)
- Optional vote updates while poll is active
- Moderator-only copy button for chat entries

## Local Development

### 1) Install dependencies

```bash
npm install
```

### 2) Run frontend + backend

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:4000

If backend runs on another URL, set in `client/.env`:

```bash
VITE_SOCKET_URL=https://your-backend.example.com
```

## Build

```bash
npm run build
```

## Run backend in production mode

```bash
npm run start
```

## Deployment (Step-by-step)

### Backend (Render / Railway)

1. Create a new Web Service from the repo.
2. Set root directory to `server`.
3. Build command: `npm install`.
4. Start command: `npm start`.
5. Set env var (optional) `CLIENT_ORIGIN=https://your-frontend-domain.com`.
6. Deploy and copy service URL (e.g. `https://live-chat-api.onrender.com`).

### Frontend (Vercel)

1. Create a new Vercel project from the same repo.
2. Set root directory to `client`.
3. Framework preset: **Vite**.
4. Add env var: `VITE_SOCKET_URL=https://your-backend-service-url`.
5. Deploy.
6. Moderator URL: `https://your-frontend-domain.com/?moderator=true`.

## Operational Notes

- State is in-memory and lasts while the backend process is running.
- Mid-session users receive existing messages and active/closed polls on connect.
- For high availability/persistent sessions, swap in Redis/Postgres and horizontal pub/sub.

## Security & Reliability Controls

- Message length limited to 500 chars
- Poll question length max 200 chars
- Poll option length max 80 chars, 2–6 options
- Rate limiting: one chat and one vote action every 300ms per socket
- Empty/whitespace-only chat messages are rejected

