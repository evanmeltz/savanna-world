# Savanna World (Prototype)

This package contains:

- `backend/` — Node.js + Postgres authoritative server + WebSocket state broadcasts
- `client/`  — phone-first web UI using Leaflet + OpenStreetMap tiles

## Quick start (local)
1) Set up Postgres and export DATABASE_URL
2) cd backend
   npm install
   npm run migrate
   STATIC_DIR=../client npm start
3) Open http://localhost:8080

Tip (phone testing on same Wi‑Fi):
- Find your computer's LAN IP and open:
  http://<your-computer-ip>:8080
