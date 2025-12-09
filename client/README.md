# Savanna World (Client)

Minimal phone-first web client (Leaflet + OSM tiles).

## Run (recommended)
Run the backend and let it serve this folder by setting:
  STATIC_DIR=../client

Then open:
  http://localhost:8080

## Or run separately
Serve this folder on any static server and point it at your backend by editing `app.js`:
  const API_BASE = "http://localhost:8080";
