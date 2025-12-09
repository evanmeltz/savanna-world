require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const { pool, withTx } = require("./db");
const { sectorForPosition, INNER_RADIUS_M, OUTER_RADIUS_M, N_SECTORS } = require("./geometry");
const {
  ACTIVE_LEN, SHIFT_PER_SURVEY, ANIMALS, SURVEYABLE, SURVEY_COST_MIN,
  wrap, isSectorActive, contiguousRun, sectorsDisplay,
  generateSolution, generateHints, countInSectors
} = require("./game");
const { loadState, loadLog, clearLog, tryDedup, saveState } = require("./state");

const PORT = parseInt(process.env.PORT || "8080", 10);
const START_TIME_MINUTES = parseInt(process.env.START_TIME_MINUTES || "120", 10);
const STATIC_DIR = process.env.STATIC_DIR || null;

/** @type {Set<WebSocket>} */
const sockets = new Set();

// ---- In-memory single-writer command queue ----
const queue = [];
let processing = false;

// ---- Timer cache (so TICK does not hit DB unless it must write) ----
const timerCache = {
  loaded: false,
  status: "waiting",
  deadlineMs: null,
  minutesRemaining: null,
};

function nowUtcIso() { return new Date().toISOString(); }

function minutesRemainingFromDeadline(deadlineUtc) {
  if (!deadlineUtc) return null;
  const ms = new Date(deadlineUtc).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 60000));
}

function setTimerCacheFromRow(row) {
  timerCache.loaded = true;
  timerCache.status = row.status;
  timerCache.deadlineMs = row.deadline_utc ? new Date(row.deadline_utc).getTime() : null;
  timerCache.minutesRemaining = row.deadline_utc ? minutesRemainingFromDeadline(row.deadline_utc) : null;
}

async function ensureTimerCacheLoaded() {
  if (timerCache.loaded) return;
  await withTx(async (client) => {
    const { rows } = await client.query("SELECT status, deadline_utc FROM game_state WHERE id=1");
    if (rows.length === 0) throw new Error("game_state row missing");
    setTimerCacheFromRow(rows[0]);
  });
}

function broadcastJson(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of sockets) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    } catch {}
  }
}

function broadcastSnapshot(snapshot) {
  broadcastJson({ type: "STATE_SNAPSHOT", payload: snapshot });
}

function broadcastTimerOnly() {
  // Timer-only payload; clients just render minutes + status
  broadcastJson({
    type: "TIMER_UPDATE",
    payload: {
      status: timerCache.status,
      minutes_remaining: timerCache.minutesRemaining,
      server_time_utc: nowUtcIso(),
    }
  });
}

function asJsonValue(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return fallback; }
  }
  return v;
}

function makePublicSnapshot(dbRow, logRows) {
  const deadlineIso = dbRow.deadline_utc ? new Date(dbRow.deadline_utc).toISOString() : null;

  // Ensure jsonb fields are proper JS values
  const hints = asJsonValue(dbRow.hints, []);
  const solution = asJsonValue(dbRow.solution, null);

  const base = {
    status: dbRow.status,
    center_lat: dbRow.center_lat,
    center_lon: dbRow.center_lon,

    n_sectors: N_SECTORS,
    inner_radius_m: INNER_RADIUS_M,
    outer_radius_m: OUTER_RADIUS_M,

    active_len: ACTIVE_LEN,
    active_start_index: dbRow.active_start_index,
    selected_sectors: dbRow.selected_sectors || [],

    deadline_utc: deadlineIso,
    minutes_remaining: dbRow.deadline_utc ? minutesRemainingFromDeadline(dbRow.deadline_utc) : null,

    guesses_remaining: dbRow.guesses_remaining,
    hints,

    solution_revealed: dbRow.solution_revealed,
    version: Number(dbRow.version || 0),
    server_time_utc: nowUtcIso(),

    log: (logRows || []).map(r => ({
      id: r.id,
      created_at: new Date(r.created_at).toISOString(),
      sectors: r.sectors,
      animal: r.animal,
      count: r.count,
      sectors_display: (() => {
        try {
          const arr = Array.isArray(r.sectors) ? r.sectors : (typeof r.sectors === "string" ? JSON.parse(r.sectors) : r.sectors);
          return sectorsDisplay(arr).text;
        } catch { return "—"; }
      })()
    })),
  };

  if (dbRow.solution_revealed && Array.isArray(solution)) {
    base.solution = solution;
  }

  return base;
}

async function fetchSnapshotAndUpdateCache() {
  return withTx(async (client) => {
    const state = await loadState(client);
    setTimerCacheFromRow(state); // keep cache in sync whenever we do a real state read
    const log = await loadLog(client, 200);
    return makePublicSnapshot(state, log);
  });
}

function enqueue(cmd) {
  return new Promise((resolve) => {
    queue.push({ cmd, resolve });
    processQueue().catch((e) => console.error("queue error", e));
  });
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      const item = queue.shift();
      const { cmd, resolve } = item;

      let result;
      try {
        result = await handleCommand(cmd);
      } catch (e) {
        result = { ok: false, message: String(e && e.message ? e.message : e), broadcast: "none" };
      }

      // Only broadcast what’s needed:
      // - state: full snapshot
      // - timer: timer-only payload
      if (result.broadcast === "state") {
        try {
          const snap = await fetchSnapshotAndUpdateCache();
          result.state = snap;
          broadcastSnapshot(snap);
        } catch (e) {
          result.state = null;
        }
      } else if (result.broadcast === "timer") {
        // Ensure cache exists; then broadcast timer-only
        try { await ensureTimerCacheLoaded(); } catch {}
        broadcastTimerOnly();
      }

      resolve(result);
    }
  } finally {
    processing = false;
  }
}

function requireNumber(x, name) {
  if (typeof x !== "number" || !isFinite(x)) throw new Error(`Missing/invalid ${name}`);
  return x;
}
function requireString(x, name) {
  if (typeof x !== "string" || !x.trim()) throw new Error(`Missing/invalid ${name}`);
  return x.trim();
}

function isExpiredMs(deadlineMs) {
  if (deadlineMs == null) return false;
  return Date.now() >= deadlineMs;
}

async function startNewGameTx(client, centerLat, centerLon) {
  const solution = generateSolution();
  const hints = generateHints(solution);
  const deadline = new Date(Date.now() + START_TIME_MINUTES * 60 * 1000);

  const patch = {
    status: "running",
    center_lat: centerLat,
    center_lon: centerLon,
    deadline_utc: deadline,
    active_start_index: 0,
    selected_sectors: [],
    guesses_remaining: 3,

    // jsonb safe
    solution: JSON.stringify(solution),
    solution_revealed: false,
    hints: JSON.stringify(hints),

    version: 0,
  };

  await clearLog(client);
  await saveState(client, patch);
}

async function expireIfNeededWriteTx(client) {
  // Called only when we already know it’s expired from cache (or we want to be safe)
  const locked = await client.query("SELECT * FROM game_state WHERE id=1 FOR UPDATE");
  if (locked.rows.length === 0) throw new Error("game_state row missing");
  const s = locked.rows[0];

  if (s.status !== "running" || !s.deadline_utc) return false;
  const deadlineMs = new Date(s.deadline_utc).getTime();
  if (!isExpiredMs(deadlineMs)) return false;

  const patch = {
    status: "lost",
    solution_revealed: true,
    version: Number(s.version) + 1,
  };
  await saveState(client, patch);
  return true;
}

async function handleCommand(cmd) {
  const type = requireString(cmd.type, "type");

  // NOTE: we accept missing/invalid command_id by just not deduping
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const command_id = (typeof cmd.command_id === "string" && UUID_RE.test(cmd.command_id)) ? cmd.command_id : null;

  // ---- TICK: no DB unless it must expire the game ----
  if (type === "TICK") {
    await ensureTimerCacheLoaded();

    // Update minutes remaining in cache (no DB)
    if (timerCache.deadlineMs != null) {
      timerCache.minutesRemaining = Math.max(0, Math.floor((timerCache.deadlineMs - Date.now()) / 60000));
    } else {
      timerCache.minutesRemaining = null;
    }

    // If not running or no deadline: just broadcast timer
    if (timerCache.status !== "running" || timerCache.deadlineMs == null) {
      return { ok: true, message: "tick", broadcast: "timer" };
    }

    // If expired: do a real write (this is a real state change)
    if (isExpiredMs(timerCache.deadlineMs)) {
      const changed = await withTx(async (client) => {
        return expireIfNeededWriteTx(client);
      });

      // Refresh cache by loading real row once (cheap and correct)
      timerCache.loaded = false;
      await ensureTimerCacheLoaded();

      if (changed) {
        // State changed to lost; broadcast full snapshot so solution + new game button show, etc.
        return { ok: true, message: "expired", broadcast: "state" };
      }
    }

    return { ok: true, message: "tick", broadcast: "timer" };
  }

  // ---- All other commands: serialize + lock row, because they mutate game state ----
  return withTx(async (client) => {
    const { rows } = await client.query("SELECT * FROM game_state WHERE id=1 FOR UPDATE");
    if (rows.length === 0) throw new Error("game_state row missing");
    let state = rows[0];

    if (command_id) {
      const inserted = await tryDedup(client, command_id);
      if (!inserted) {
        // Duplicate command: no need to broadcast anything
        return { ok: true, message: "Duplicate command ignored.", broadcast: "none" };
      }
    }

    if (type === "NEW_GAME") {
      const lat = requireNumber(cmd.center_lat, "center_lat");
      const lon = requireNumber(cmd.center_lon, "center_lon");
      await startNewGameTx(client, lat, lon);

      // cache will be updated when we fetch snapshot for broadcast
      timerCache.loaded = false;

      return { ok: true, message: "New game started.", broadcast: "state" };
    }

    // If not running, block commands except NEW_GAME
    if (state.status !== "running") {
      return { ok: false, message: `Game is not running (status=${state.status}).`, broadcast: "none" };
    }
    if (state.center_lat == null || state.center_lon == null) {
      return { ok: false, message: "Game center is not set. Start a new game first.", broadcast: "none" };
    }

    // Add/Remove sector
    if (type === "ADD_SECTOR" || type === "REMOVE_SECTOR") {
      const lat = requireNumber(cmd.lat, "lat");
      const lon = requireNumber(cmd.lon, "lon");

      const sector = sectorForPosition(state.center_lat, state.center_lon, lat, lon);
      if (sector == null) {
        return { ok: false, message: "You are not currently inside any sector (must be between 0.25 and 0.5 miles from center).", broadcast: "none" };
      }
      if (!isSectorActive(sector, state.active_start_index)) {
        return { ok: false, message: "That sector is currently out of play (fogged).", broadcast: "none" };
      }

      const sel = Array.isArray(state.selected_sectors) ? state.selected_sectors.slice() : [];
      const has = sel.includes(sector);

      if (type === "ADD_SECTOR") {
        if (has) return { ok: true, message: "Sector already selected.", broadcast: "none" };
        if (sel.length >= 4) return { ok: false, message: "You cannot select more than 4 sectors.", broadcast: "none" };
        sel.push(sector);
      } else {
        if (!has) return { ok: true, message: "Sector not selected.", broadcast: "none" };
        const next = sel.filter(x => x !== sector);
        sel.length = 0; sel.push(...next);
      }

      sel.sort((a, b) => a - b);

      const patch = { selected_sectors: sel, version: Number(state.version) + 1 };
      await saveState(client, patch);

      return { ok: true, message: type === "ADD_SECTOR" ? "Sector added." : "Sector removed.", broadcast: "state" };
    }

    // Survey
    if (type === "RUN_SURVEY") {
      const animal = requireString(cmd.animal_type, "animal_type");
      if (!SURVEYABLE.has(animal)) return { ok: false, message: "That animal cannot be surveyed.", broadcast: "none" };

      const sel = Array.isArray(state.selected_sectors) ? state.selected_sectors.slice() : [];
      const run = contiguousRun(sel);
      if (!run.ok) return { ok: false, message: "Selected sectors must be 2–4 and contiguous.", broadcast: "none" };

      for (const s of run.ordered) {
        if (!isSectorActive(s, state.active_start_index)) {
          return { ok: false, message: "Selection includes out-of-play (fogged) sectors.", broadcast: "none" };
        }
      }

      const len = run.ordered.length;
      const cost = SURVEY_COST_MIN[len];
      if (cost == null) return { ok: false, message: "Invalid survey length.", broadcast: "none" };

      const solution = asJsonValue(state.solution, null);
      if (!Array.isArray(solution) || solution.length !== N_SECTORS) {
        return { ok: false, message: "Server missing solution. Start a new game.", broadcast: "none" };
      }

      const count = countInSectors(solution, run.ordered, animal);
      const nextDeadline = new Date(new Date(state.deadline_utc).getTime() - cost * 60 * 1000);
      const nextActiveStart = wrap(state.active_start_index + SHIFT_PER_SURVEY);

      // log entry
      await client.query(
        "INSERT INTO survey_log (sectors, animal, count, game_version) VALUES ($1,$2,$3,$4)",
        [JSON.stringify(run.ordered), animal, count, Number(state.version) + 1]
      );

      // Build patch
      const nextDeadlineMs = nextDeadline.getTime();
      const expiredNow = Date.now() >= nextDeadlineMs;

      const patch = {
        deadline_utc: nextDeadline,
        active_start_index: nextActiveStart,
        selected_sectors: [],
        version: Number(state.version) + 1,
      };

      // If survey pushed time past 0, immediately lose + reveal
      if (expiredNow) {
        patch.status = "lost";
        patch.solution_revealed = true;
      }

      await saveState(client, patch);

      // Update timer cache immediately (no DB read)
      timerCache.loaded = true;
      timerCache.status = expiredNow ? "lost" : "running";
      timerCache.deadlineMs = nextDeadlineMs;
      timerCache.minutesRemaining = Math.max(0, Math.floor((nextDeadlineMs - Date.now()) / 60000));

      return {
        ok: !expiredNow, // optional: you can keep ok:true if you prefer
        message: expiredNow ? "Time ran out — you lose." : `Survey complete: ${count}`,
        broadcast: "state",
      };
    }

    // Guess
    if (type === "SUBMIT_GUESS") {
      const guess = cmd.guess;
      if (!Array.isArray(guess) || guess.length !== N_SECTORS) {
        return { ok: false, message: `Guess must be an array of length ${N_SECTORS}.`, broadcast: "none" };
      }
      for (const g of guess) {
        if (typeof g !== "string" || !(g in ANIMALS)) {
          return { ok: false, message: "Guess contains invalid animal values.", broadcast: "none" };
        }
      }

      const solution = asJsonValue(state.solution, null);
      if (!Array.isArray(solution) || solution.length !== N_SECTORS) {
        return { ok: false, message: "Server missing solution. Start a new game.", broadcast: "none" };
      }

      let correct = true;
      for (let i = 0; i < N_SECTORS; i++) {
        if (guess[i] !== solution[i]) { correct = false; break; }
      }

      if (correct) {
        const patch = { status: "won", solution_revealed: true, version: Number(state.version) + 1 };
        await saveState(client, patch);

        timerCache.loaded = true;
        timerCache.status = "won";

        return { ok: true, message: "Correct! You win.", broadcast: "state" };
      }

      const remaining = Number(state.guesses_remaining) - 1;
      if (remaining <= 0) {
        const patch = { guesses_remaining: 0, status: "lost", solution_revealed: true, version: Number(state.version) + 1 };
        await saveState(client, patch);

        timerCache.loaded = true;
        timerCache.status = "lost";

        return { ok: false, message: "Incorrect. No guesses remaining — you lose.", broadcast: "state" };
      } else {
        const patch = { guesses_remaining: remaining, version: Number(state.version) + 1 };
        await saveState(client, patch);
        return { ok: false, message: `Incorrect. Guesses remaining: ${remaining}.`, broadcast: "state" };
      }
    }

    return { ok: false, message: "Unknown command type.", broadcast: "none" };
  });
}

// ---- Express + WS ----
const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

if (STATIC_DIR) {
  const staticPath = path.resolve(__dirname, "..", STATIC_DIR);
  app.use("/", express.static(staticPath));
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/state", async (req, res) => {
  try {
    const snap = await fetchSnapshotAndUpdateCache();
    res.json({ ok: true, state: snap });
  } catch (e) {
    res.status(500).json({ ok: false, message: String(e.message || e) });
  }
});

app.post("/command", async (req, res) => {
  try {
    const cmd = req.body || {};
    if (!cmd.command_id) cmd.command_id = crypto.randomUUID();
    const out = await enqueue(cmd);
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, message: String(e.message || e) });
  }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", async (ws) => {
  sockets.add(ws);
  ws.on("close", () => sockets.delete(ws));
  ws.on("error", () => sockets.delete(ws));

  // On connect: send full snapshot once (so UI can render everything)
  try {
    const snap = await fetchSnapshotAndUpdateCache();
    ws.send(JSON.stringify({ type: "STATE_SNAPSHOT", payload: snap }));
  } catch {}
});

// TICK once per minute (passive work minimized; no snapshot broadcast)
setInterval(() => {
  enqueue({ type: "TICK" }).catch(() => {});
}, 60000);

server.listen(PORT, () => {
  console.log(`Savanna World backend listening on http://localhost:${PORT}`);
  if (STATIC_DIR) console.log(`Serving client from ${STATIC_DIR}`);
});

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  try { wss.close(); } catch {}
  try { server.close(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(0);
});
