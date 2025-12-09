# Savanna World (Backend)

Minimal authoritative server + Postgres + WebSocket broadcast.

## Requirements
- Node.js 18+
- Postgres (local or hosted)

## Setup
1) Create a Postgres database and set `DATABASE_URL` (see `.env.example`).
2) Install deps:
   npm install
3) Run migrations:
   npm run migrate
4) Start server:
   npm start

By default it listens on http://localhost:8080

## Endpoints
- GET /state
- POST /command  (JSON body)
- WS  /ws  (receives state snapshots)

Notes:
- The server is the authority. Clients send commands; server serializes updates through a FIFO queue and DB transaction.
