const API_BASE = ""; // "" means same-origin. If serving separately, set e.g. "http://localhost:8080".

const ANIMALS = {
  OAK: "OAK",
  LEOPARD: "LEOPARD",
  ZEBRA: "ZEBRA",
  VULTURE: "VULTURE",
  AARDWOLF: "AARDWOLF",
};

const DISPLAY = {
  OAK: { label: "Oak", icon: "🌳" },
  LEOPARD: { label: "Leopard", icon: "🐆" },
  ZEBRA: { label: "Zebra", icon: "🦓" },
  VULTURE: { label: "Vulture", icon: "🦅" },
  AARDWOLF: { label: "Aardwolf", icon: "🐺" },
};

const CENTER_CARD_PX = 140;


const SURVEYABLE = [ANIMALS.OAK, ANIMALS.LEOPARD, ANIMALS.ZEBRA, ANIMALS.VULTURE];

function getCenterScale(){
  if(!state.map) return 1;
  const z = state.map.getZoom();
  const baseZoom = 16;
  return Math.max(0.6, Math.min(1.6, Math.pow(1.12, z - baseZoom)));
}

// Overlay colors (no gross yellows)
const FILL_ACTIVE = "rgba(96,165,250,0.25)";
const FILL_FOG = "rgba(248,113,113,0.22)";
const FILL_SELECTED = "rgba(34,197,94,0.25)";

// label colors (a bit stronger but still translucent)
const LABEL_ACTIVE = "rgba(21, 85, 223, 0.75)";
const LABEL_FOG = "rgba(209, 24, 24, 0.7)";
const LABEL_SELECTED = "rgba(17, 100, 47, 0.75)";

const el = {
  addRemoveBtn: document.getElementById("addRemoveBtn"),
  surveyBtn: document.getElementById("surveyBtn"),
  guessBtn: document.getElementById("guessBtn"),
  infoBtn: document.getElementById("infoBtn"),
  logBtn: document.getElementById("logBtn"),

  // Title screen
  titleScreen: document.getElementById("titleScreen"),
  titleNewGameBtn: document.getElementById("titleNewGameBtn"),
  topBar: document.querySelector(".topBar"),
  bottomBar: document.querySelector(".bottomBar"),

  toast: document.getElementById("toast"),
  backdrop: document.getElementById("modalBackdrop"),

  surveyModal: document.getElementById("surveyModal"),
  closeSurvey: document.getElementById("closeSurvey"),
  surveyRangeText: document.getElementById("surveyRangeText"),
  surveyAnimal: document.getElementById("surveyAnimal"),
  confirmSurvey: document.getElementById("confirmSurvey"),

  logModal: document.getElementById("logModal"),
  closeLog: document.getElementById("closeLog"),
  logGrid: document.getElementById("logGrid"),

  infoModal: document.getElementById("infoModal"),
  closeInfo: document.getElementById("closeInfo"),
  hintsList: document.getElementById("hintsList"),

  guessModal: document.getElementById("guessModal"),
  closeGuess: document.getElementById("closeGuess"),
  guessList: document.getElementById("guessList"),
  submitGuess: document.getElementById("submitGuess"),
  guessesRemaining: document.getElementById("guessesRemaining"),
};

// Populate survey dropdown
el.surveyAnimal.innerHTML = SURVEYABLE.map(a => `<option value="${a}">${DISPLAY[a].icon} ${DISPLAY[a].label}</option>`).join("");

const state = {
  snapshot: null,
  myLoc: null,
  mySector: null,
  map: null,
  userHasPanned: false,
  sectorPolys: [],
  sectorLabels: [],
  locationMarker: null,
  centerMarker: null,
  lastCenterKey: null,
  ui: { modal: null },
};

// TESTING
const TESTMODE = {
  enabled: new URLSearchParams(location.search).get("test") === "1",
  stepMeters: 8,     // arrow press step
  fastMeters: 25,    // shift+arrow step
  lat: null,
  lon: null,
};

function setMyLoc(lat, lon, accuracy_m = null) {
  state.myLoc = { lat, lon, accuracy_m };

  // Keep your existing downstream updates in one place:
  renderCenterMarker();
  renderButtons();
  renderOverlays();
}

// meters → lat/lon delta (good enough for < a few km)
function moveByMeters(lat, lon, metersNorth, metersEast) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(lat * Math.PI / 180);
  const dLat = metersNorth / metersPerDegLat;
  const dLon = metersEast / metersPerDegLon;
  return { lat: lat + dLat, lon: lon + dLon };
}

function installTestModeKeys() {
  // Use capture so we intercept before Leaflet
  document.addEventListener("keydown", (e) => {
    const key = e.key;

    // Toggle test mode with T (works even if map has focus)
    if (key === "t" || key === "T") {
      e.preventDefault();
      e.stopPropagation();

      TESTMODE.enabled = !TESTMODE.enabled;
      showToast(TESTMODE.enabled ? "Test mode ON" : "Test mode OFF (refresh to restore GPS)");

      // Turn Leaflet keyboard on/off dynamically
      if (state.map) {
        if (TESTMODE.enabled) state.map.keyboard.disable();
        else state.map.keyboard.enable();
      }

      // If we just turned ON, ensure we have a starting simulated position
      if (TESTMODE.enabled && (TESTMODE.lat == null || TESTMODE.lon == null)) {
        const c = state.map ? state.map.getCenter() : { lat: 37.7749, lng: -122.4194 };
        TESTMODE.lat = c.lat;
        TESTMODE.lon = c.lng;
        setMyLoc(TESTMODE.lat, TESTMODE.lon, 5);
      }
      return;
    }

    // Only handle arrows when test mode is enabled
    if (!TESTMODE.enabled) return;

    // Eat arrow keys so Leaflet can't pan
    const isArrow = key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
    if (!isArrow) return;

    e.preventDefault();
    e.stopPropagation();

    if (TESTMODE.lat == null || TESTMODE.lon == null) return;

    const step = e.shiftKey ? TESTMODE.fastMeters : TESTMODE.stepMeters;

    let north = 0, east = 0;
    if (key === "ArrowUp") north = step;
    else if (key === "ArrowDown") north = -step;
    else if (key === "ArrowLeft") east = -step;
    else if (key === "ArrowRight") east = step;

    const next = moveByMeters(TESTMODE.lat, TESTMODE.lon, north, east);
    TESTMODE.lat = next.lat;
    TESTMODE.lon = next.lon;

    setMyLoc(TESTMODE.lat, TESTMODE.lon, 5);

    // Keep map centered on simulated position (optional)
    if (state.map) state.map.panTo([TESTMODE.lat, TESTMODE.lon], { animate: false });
  }, true); // ✅ capture
}
// TESTING

function uuidv4() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const rnds = new Uint8Array(16);
  (window.crypto || crypto).getRandomValues(rnds);
  rnds[6] = (rnds[6] & 0x0f) | 0x40;
  rnds[8] = (rnds[8] & 0x3f) | 0x80;
  const hex = Array.from(rnds, b => b.toString(16).padStart(2, "0"));
  return (
    hex[0] + hex[1] + hex[2] + hex[3] + "-" +
    hex[4] + hex[5] + "-" +
    hex[6] + hex[7] + "-" +
    hex[8] + hex[9] + "-" +
    hex[10] + hex[11] + hex[12] + hex[13] + hex[14] + hex[15]
  );
}

function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.add("hidden"), 1800);
}

function setTitleScreenVisible(visible) {
  if (!el.titleScreen) return;
  if (visible) {
    el.titleScreen.classList.remove("hidden");
    if (el.topBar) el.topBar.classList.add("hidden");
    if (el.bottomBar) el.bottomBar.classList.add("hidden");
    closeModal();
  } else {
    el.titleScreen.classList.add("hidden");
    if (el.topBar) el.topBar.classList.remove("hidden");
    if (el.bottomBar) el.bottomBar.classList.remove("hidden");
  }
}

function setBtnVariant(button, variant) {
  if (!button) return;
  button.classList.remove("btnPrimary", "btnDanger", "btnGhost", "btnSuccess");
  if (variant === "primary") button.classList.add("btnPrimary");
  else if (variant === "danger") button.classList.add("btnDanger");
  else if (variant === "ghost") button.classList.add("btnGhost");
  else if (variant === "success") button.classList.add("btnSuccess");
}

function openModal(which) {
  state.ui.modal = which;
  el.backdrop.classList.remove("hidden");
  for (const m of [el.surveyModal, el.logModal, el.infoModal, el.guessModal]) m.classList.add("hidden");
  if (which === "survey") el.surveyModal.classList.remove("hidden");
  if (which === "log") el.logModal.classList.remove("hidden");
  if (which === "info") el.infoModal.classList.remove("hidden");
  if (which === "guess") el.guessModal.classList.remove("hidden");
}
function closeModal() {
  state.ui.modal = null;
  el.backdrop.classList.add("hidden");
  for (const m of [el.surveyModal, el.logModal, el.infoModal, el.guessModal]) m.classList.add("hidden");
}

if (el.titleNewGameBtn) {
  el.titleNewGameBtn.addEventListener("click", async () => {
    if (!state.myLoc) { showToast("Need location permission to start."); return; }
    await apiCommand({ type: "NEW_GAME", center_lat: state.myLoc.lat, center_lon: state.myLoc.lon });
  });
}

el.backdrop.addEventListener("click", closeModal);
el.closeSurvey.addEventListener("click", closeModal);
el.closeLog.addEventListener("click", closeModal);
el.closeInfo.addEventListener("click", closeModal);
el.closeGuess.addEventListener("click", closeModal);

const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const dφ = toRad(lat2 - lat1), dλ = toRad(lon2 - lon1);
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lon1), λ2 = toRad(lon2);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  let θ = toDeg(Math.atan2(y, x));
  return (θ + 360) % 360;
}

function wrap(i, n) { return ((i % n) + n) % n; }

function sectorForPosition(center, pos, nSectors, innerM, outerM) {
  if (!center || !pos) return null;
  const d = haversineMeters(center.lat, center.lon, pos.lat, pos.lon);
  if (d < innerM || d > outerM) return null;
  const b = bearingDeg(center.lat, center.lon, pos.lat, pos.lon);
  const slice = 360 / nSectors;
  const idx = Math.floor(b / slice);
  return Math.max(0, Math.min(nSectors - 1, idx));
}

function isSectorActive(idx, start, activeLen, n) {
  for (let k = 0; k < activeLen; k++) {
    if (wrap(start + k, n) === idx) return true;
  }
  return false;
}

function contiguousRun(sectors, n) {
  if (!Array.isArray(sectors)) return null;
  const set = new Set(sectors);
  if (set.size !== sectors.length) return null;
  const len = sectors.length;
  if (len < 2 || len > 4) return null;
  for (const start of sectors) {
    const seq = [];
    for (let k = 0; k < len; k++) seq.push(wrap(start + k, n));
    let ok = true;
    for (const x of seq) if (!set.has(x)) { ok = false; break; }
    if (ok) return seq;
  }
  return null;
}

function rangeTextFromOrdered(ordered) {
  if (!ordered || ordered.length === 0) return "—";
  const s = ordered[0] + 1;
  const e = ordered[ordered.length - 1] + 1;
  const wrapFlag = (e < s);
  return wrapFlag ? `${s} to ${e} (wrap)` : `${s} to ${e}`;
}

function destPoint(lat, lon, bearingDeg0, distMeters) {
  const R = 6371000;
  const δ = distMeters / R;
  const θ = toRad(bearingDeg0);
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}

function sectorPolygonPoints(center, innerM, outerM, startDeg, endDeg, steps = 12) {
  const outer = [];
  const inner = [];
  const step = (endDeg - startDeg) / steps;
  for (let i = 0; i <= steps; i++) {
    const a = startDeg + step * i;
    const p = destPoint(center.lat, center.lon, a, outerM);
    outer.push([p.lat, p.lon]);
  }
  for (let i = steps; i >= 0; i--) {
    const a = startDeg + step * i;
    const p = destPoint(center.lat, center.lon, a, innerM);
    inner.push([p.lat, p.lon]);
  }
  return outer.concat(inner);
}

// --- Network ---
async function apiCommand(cmd) {
  const body = { ...cmd, command_id: uuidv4() };
  const r = await fetch(`${API_BASE}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (j && j.message) showToast(j.message);
  if (j && j.state) applySnapshot(j.state);
  return j;
}

async function loadInitialState() {
  const r = await fetch(`${API_BASE}/state`);
  const j = await r.json();
  if (j && j.state) applySnapshot(j.state);
}

function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const host = API_BASE ? API_BASE.replace(/^https?:\/\//, "") : location.host;
  const ws = new WebSocket(`${proto}://${host}/ws`);
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.type === "STATE_SNAPSHOT") applySnapshot(m.payload);
      if (m.type === "TIMER_UPDATE") applyTimerUpdate(m.payload);
    } catch {}
  };
  ws.onclose = () => setTimeout(connectWS, 1200);
}

function applyTimerUpdate(payload) {
  if (!state.snapshot) state.snapshot = {};
  state.snapshot.status = payload.status;
  state.snapshot.minutes_remaining = payload.minutes_remaining;
  state.snapshot.server_time_utc = payload.server_time_utc;
  renderCenterMarker(); // timer UI is inside the map marker
}

// --- Snapshot / UI rendering ---
function applySnapshot(snap) {
  state.snapshot = snap;

  // Title screen is shown when the game is waiting (shut down).
  const status = (snap && snap.status) ? snap.status : "waiting";
  setTitleScreenVisible(status === "waiting");

  resetOverlaysIfCenterChanged();
  ensureOverlays();
  renderOverlays();
  renderButtons();
  renderHints();
  renderLog();
  renderCenterMarker();
}

function resetOverlaysIfCenterChanged() {
  const snap = state.snapshot;
  const key = (snap && snap.center_lat != null && snap.center_lon != null) ? `${snap.center_lat.toFixed(6)},${snap.center_lon.toFixed(6)}` : "none";
  if (state.lastCenterKey === null) state.lastCenterKey = key;
  if (key === state.lastCenterKey) return;

  // Center moved (new game) — wipe polygons/labels/center marker
  state.lastCenterKey = key;

  for (const p of state.sectorPolys) { try { p.remove(); } catch {} }
  state.sectorPolys = [];

  for (const m of state.sectorLabels) { try { m.remove(); } catch {} }
  state.sectorLabels = [];

  if (state.centerMarker) { try { state.centerMarker.remove(); } catch {} }
  state.centerMarker = null;
}

function getCenterForRendering() {
  const snap = state.snapshot;

  // If game has a center, use it (locks timer to circle center).
  if (snap && snap.center_lat != null && snap.center_lon != null) {
    return { lat: snap.center_lat, lon: snap.center_lon };
  }

  // If no game center yet, fall back to user location so the "New Game" button is reachable.
  if (state.myLoc) return { lat: state.myLoc.lat, lon: state.myLoc.lon };

  return null;
}

function centerMarkerHtml() {
  const snap = state.snapshot || {};
  const status = snap.status || "waiting";
  const minutes = snap.minutes_remaining;

  if (status === "running") {
    return `
      <div class="centerCard">
        <div class="centerTimerNum">${minutes == null ? "—" : minutes}</div>
        <div class="centerTimerUnit">min</div>
      </div>
    `;
  }

  if (status === "won") {
    return `
      <div class="centerCard">
        <div class="centerStatusText">You win! 🎉</div>
        <button class="centerBtn" data-action="shutdown">Shut Down</button>
      </div>
    `;
  }

  if (status === "lost") {
    return `
      <div class="centerCard">
        <div class="centerStatusText">You lose.</div>
        <button class="centerBtn" data-action="shutdown">Shut Down</button>
      </div>
    `;
  }

  return ``;
}


function ensureCenterMarker() {
  if (!state.map) return;

  const snap = state.snapshot || {};
  const status = snap.status || "waiting";

  // No center marker on title screen / waiting state.
  if (status === "waiting" || snap.center_lat == null || snap.center_lon == null) {
    if (state.centerMarker) {
      try { state.centerMarker.remove(); } catch {}
      state.centerMarker = null;
    }
    return;
  }

  const latlng = [snap.center_lat, snap.center_lon];

  const icon = L.divIcon({
    className: "centerMarkerIcon",
    html: centerMarkerHtml(),
    iconSize: [CENTER_CARD_PX, CENTER_CARD_PX],
    iconAnchor: [CENTER_CARD_PX / 2, CENTER_CARD_PX / 2],
  });

  if (!state.centerMarker) {
    state.centerMarker = L.marker(latlng, { icon, interactive: true, keyboard: false }).addTo(state.map);
    state.centerMarker.on("add", () => wireCenterMarker());
  } else {
    state.centerMarker.setLatLng(latlng);
    state.centerMarker.setIcon(icon);
    wireCenterMarker();
  }
}

function wireCenterMarker() {
  if (!state.centerMarker) return;
  const root = state.centerMarker.getElement();
  if (!root) return;

  // Prevent map dragging/zooming when tapping the center UI
  L.DomEvent.disableClickPropagation(root);
  L.DomEvent.disableScrollPropagation(root);

  const btn = root.querySelector('[data-action="shutdown"]');
  if (btn) {
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await apiCommand({ type: "SHUTDOWN" });
    };
  }
}

function renderCenterMarker() {
  // Always keep center marker up-to-date
  ensureCenterMarker();
}

function labelColorFor(sectorIdx) {
  const snap = state.snapshot;
  if (!snap) return LABEL_FOG;
  const selected = new Set(snap.selected_sectors || []);
  if (selected.has(sectorIdx)) return LABEL_SELECTED;
  const active = isSectorActive(sectorIdx, snap.active_start_index, snap.active_len, snap.n_sectors);
  return active ? LABEL_ACTIVE : LABEL_FOG;
}

function renderButtons() {
  const snap = state.snapshot;
  const loc = state.myLoc;
  const status = snap ? snap.status : "waiting";
  const hasCenter = snap && snap.center_lat != null && snap.center_lon != null;
  const running = status === "running";

  // Disable/grey out everything in loss state (shutdown stays available in center circle).
  const lost = status === "lost";
  if (lost) closeModal();

  // Top buttons: disable only on loss (requested).
  el.guessBtn.disabled = lost || !running;
  el.infoBtn.disabled = lost;
  el.logBtn.disabled = lost;

  // Survey button enable
  let surveyEnabled = false;
  if (running && snap) {
    const sel = snap.selected_sectors || [];
    const ordered = contiguousRun(sel, snap.n_sectors);
    if (ordered && ordered.length >= 2 && ordered.length <= 4) {
      const allActive = ordered.every(s => isSectorActive(s, snap.active_start_index, snap.active_len, snap.n_sectors));
      surveyEnabled = allActive;
    }
  }
  el.surveyBtn.disabled = !surveyEnabled;
  setBtnVariant(el.surveyBtn, surveyEnabled ? "primary" : "ghost");

  // Add/Remove button state
  if (!running || !hasCenter || !loc) {
    el.addRemoveBtn.disabled = true;
    el.addRemoveBtn.textContent = "Add Sector";
    setBtnVariant(el.addRemoveBtn, "ghost");
    return;
  }

  const center = { lat: snap.center_lat, lon: snap.center_lon };
  const sec = sectorForPosition(center, loc, snap.n_sectors, snap.inner_radius_m, snap.outer_radius_m);
  state.mySector = sec;

  if (sec == null) {
    el.addRemoveBtn.disabled = true;
    el.addRemoveBtn.textContent = "Add Sector";
    setBtnVariant(el.addRemoveBtn, "ghost");
    return;
  }

  const active = isSectorActive(sec, snap.active_start_index, snap.active_len, snap.n_sectors);
  if (!active) {
    el.addRemoveBtn.disabled = true;
    el.addRemoveBtn.textContent = "Out of play";
    setBtnVariant(el.addRemoveBtn, "ghost");
    return;
  }

  const selected = (snap.selected_sectors || []).includes(sec);
  el.addRemoveBtn.disabled = false;
  if (selected) {
    el.addRemoveBtn.textContent = "Remove Sector";
    setBtnVariant(el.addRemoveBtn, "danger");
  } else {
    el.addRemoveBtn.textContent = "Add Sector";
    setBtnVariant(el.addRemoveBtn, "success");
  }
}

function renderHints() {
  const snap = state.snapshot;
  if (!snap) return;
  const hints = snap.hints || [];
  el.hintsList.innerHTML = hints.map((h) => {
    const d = DISPLAY[h.animal] || { icon: "❓", label: h.animal };
    return `<div class="hintItem">${d.icon} <b>${d.label}</b> is not in sector <b>${h.sector + 1}</b>.</div>`;
  }).join("");
}

function renderLog() {
  const snap = state.snapshot;
  if (!snap) return;
  const rows = (snap.log || []);
  el.logGrid.innerHTML = rows.map(r => {
    const d = DISPLAY[r.animal] || { icon: "❓", label: r.animal };
    return `<div class="gridBodyRow">
      <div>${r.sectors_display || "—"}</div>
      <div>${d.icon} ${d.label}</div>
      <div>${r.count}</div>
    </div>`;
  }).join("");
}

// --- Map / Overlays ---
function initMap() {
  state.map = L.map("map", {
    zoomControl: false,
    minZoom: 14,   // ✅ max zoom-out level (bigger number = less zoomed out)
    maxZoom: 16.5,   // optional cap on zoom-in
    zoomSnap: 0,   // quarter-zoom steps
    keyboard: !TESTMODE.enabled,   // ✅ add this
  });
  
  // Simple black/white, no labels
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: "© OpenStreetMap, © CARTO"
  }).addTo(state.map);

  state.map.setView([37.7749, -122.4194], 13);

  state.map.on("dragstart", () => { state.userHasPanned = true; });
  state.map.on("zoomstart", () => { state.userHasPanned = true; });

  state.map.createPane("playerPane");
  state.map.getPane("playerPane").style.zIndex = 650; // higher than overlays
}

function ensureOverlays() {
  const snap = state.snapshot;
  if (!snap) { ensureCenterMarker(); return; }

  // No ring until the server has a center
  if (snap.center_lat == null || snap.center_lon == null) {
    ensureCenterMarker();
    return;
  }

  // Create ring once
  if (state.sectorPolys.length) {
    ensureCenterMarker();
    return;
  }

  const center = { lat: snap.center_lat, lon: snap.center_lon };
  const n = snap.n_sectors;
  const slice = 360 / n;

  // Create polygons + number labels
  for (let i = 0; i < n; i++) {
    const start = i * slice;
    const end = (i + 1) * slice;

    const pts = sectorPolygonPoints(center, snap.inner_radius_m, snap.outer_radius_m, start, end, 12);

    const poly = L.polygon(pts, {
      // thicker border; we will color-match stroke to fill in renderOverlays()
      color: FILL_FOG,
      weight: 6,
      opacity: 1,
      fillColor: FILL_FOG,
      fillOpacity: 1,

      // remove click/hover interactions entirely
      interactive: false,
    }).addTo(state.map);

    state.sectorPolys.push(poly);

    // Sector label at mid-angle, mid-radius
    const midAngle = (start + end) / 2;
    const midR = (snap.inner_radius_m + snap.outer_radius_m) / 2;
    const p = destPoint(center.lat, center.lon, midAngle, midR);

    const labelIcon = L.divIcon({
      className: "sectorLabelIcon",
      html: `<div class="sectorLabel" data-sector="${i}">${i + 1}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const labelMarker = L.marker([p.lat, p.lon], { icon: labelIcon, interactive: false, keyboard: false }).addTo(state.map);
    state.sectorLabels.push(labelMarker);
  }

  // Fit bounds around the ring
  const north = destPoint(center.lat, center.lon, 0, snap.outer_radius_m);
  const south = destPoint(center.lat, center.lon, 180, snap.outer_radius_m);
  const east = destPoint(center.lat, center.lon, 90, snap.outer_radius_m);
  const west = destPoint(center.lat, center.lon, 270, snap.outer_radius_m);
  const bounds = L.latLngBounds([south.lat, west.lon], [north.lat, east.lon]);
  state.map.fitBounds(bounds, { padding: [24, 24] });

  ensureCenterMarker();
}

function renderOverlays() {
  const snap = state.snapshot;
  if (!snap) return;

  // Center marker always rendered (locked to ring center when available)
  renderCenterMarker();

  if (!snap.center_lat || !snap.center_lon) return;
  if (!state.sectorPolys.length) return;

  const selected = new Set(snap.selected_sectors || []);
  const revealed = !!snap.solution_revealed;
  const solution = snap.solution || null;

  for (let i = 0; i < snap.n_sectors; i++) {
    const poly = state.sectorPolys[i];

    const active = isSectorActive(i, snap.active_start_index, snap.active_len, snap.n_sectors);
    let fill = active ? FILL_ACTIVE : FILL_FOG;
    if (selected.has(i)) fill = FILL_SELECTED;

    // Border thicker and same color as the fill
    poly.setStyle({
      fillColor: fill,
      color: fill,
      weight: 6,
      opacity: 1,
      fillOpacity: 1,
    });

    // Update label content + color
    const marker = state.sectorLabels[i];
    const root = marker && marker.getElement();
    const label = root && root.querySelector(".sectorLabel");

    const showSolutionEmojis = (snap.status === "lost" && snap.solution_revealed && Array.isArray(snap.solution));

    if (label) {
      if (showSolutionEmojis) {
        const animal = snap.solution[i];
        label.textContent = (DISPLAY[animal] && DISPLAY[animal].icon) ? DISPLAY[animal].icon : "❓";
        label.classList.add("emoji");
        label.style.color = "";
      } else {
        label.textContent = String(i + 1);
        label.classList.remove("emoji");
        label.style.color = labelColorFor(i);
      }
    }

    // No tooltips; no hover; but if revealed, we can still show via toast/log UI (kept simple).
    // If you want revealed solution to show somewhere else, we can add a dedicated modal later.
    if (revealed && solution && solution[i]) {
      // no-op here (by request: no hover/click UI)
    }
  }

  // My location marker
  if (state.myLoc) {
    const p = [state.myLoc.lat, state.myLoc.lon];
    if (!state.locationMarker) {
      state.locationMarker = L.circleMarker(p, {
        radius: 7, weight: 2,
        color: "rgba(0,0,0,.55)",
        fillColor: "rgba(255,255,255,.9)",
        fillOpacity: 1,
        pane: "playerPane",
      }).addTo(state.map);
    } else {
      state.locationMarker.setLatLng(p);
    }
  }
}

// --- UI handlers ---
el.logBtn.addEventListener("click", () => openModal("log"));
el.infoBtn.addEventListener("click", () => openModal("info"));
el.guessBtn.addEventListener("click", () => {
  buildGuessUI();
  openModal("guess");
});

el.surveyBtn.addEventListener("click", () => {
  const snap = state.snapshot;
  if (!snap) return;
  const ordered = contiguousRun(snap.selected_sectors || [], snap.n_sectors);
  if (!ordered) return;
  el.surveyRangeText.textContent = `Surveying sectors ${rangeTextFromOrdered(ordered)} for:`;
  openModal("survey");
});

el.confirmSurvey.addEventListener("click", async () => {
  const animal = el.surveyAnimal.value;
  closeModal();
  await apiCommand({ type: "RUN_SURVEY", animal_type: animal });
});

el.addRemoveBtn.addEventListener("click", async () => {
  const snap = state.snapshot;
  if (!snap || snap.status !== "running") return;
  if (!state.myLoc) return;

  const selected = (snap.selected_sectors || []).includes(state.mySector);
  const cmd = selected ? "REMOVE_SECTOR" : "ADD_SECTOR";
  await apiCommand({ type: cmd, lat: state.myLoc.lat, lon: state.myLoc.lon });
});

function buildGuessUI() {
  const snap = state.snapshot;
  if (!snap) return;
  el.guessList.innerHTML = "";

  el.guessesRemaining.textContent = `Guesses remaining: ${snap.guesses_remaining}`;

  const opts = Object.keys(ANIMALS).map(k => {
    const a = ANIMALS[k];
    const d = DISPLAY[a];
    return `<option value="${a}">${d.icon} ${d.label}</option>`;
  }).join("");

  const rows = [];
  for (let i = 0; i < snap.n_sectors; i++) {
    rows.push(`<div class="guessRow">
      <label>Sector ${i + 1}</label>
      <select data-sector="${i}">
        <option value="" selected disabled>Choose…</option>
        ${opts}
      </select>
    </div>`);
  }
  el.guessList.innerHTML = rows.join("");
}

el.submitGuess.addEventListener("click", async () => {
  const snap = state.snapshot;
  if (!snap) return;

  const selects = el.guessList.querySelectorAll("select[data-sector]");
  const guess = Array(snap.n_sectors).fill(null);
  for (const s of selects) {
    const idx = parseInt(s.getAttribute("data-sector"), 10);
    const v = s.value;
    if (!v) { showToast("Pick an animal for every sector."); return; }
    guess[idx] = v;
  }
  closeModal();
  await apiCommand({ type: "SUBMIT_GUESS", guess });
});

// --- Geolocation ---
// function startGeolocation() {
//   if (!navigator.geolocation) {
//     showToast("Geolocation not supported.");
//     return;
//   }
//   navigator.geolocation.watchPosition(
//     (pos) => {
//       const { latitude, longitude, accuracy } = pos.coords;
//       state.myLoc = { lat: latitude, lon: longitude, accuracy_m: accuracy || null };

//       // keep map centered reasonably on user
//       if (state.map) state.map.setView([latitude, longitude], Math.max(state.map.getZoom(), 15));

//       // if game not started, keep center marker near the user so "New Game" is tappable
//       renderCenterMarker();

//       renderButtons();
//       renderOverlays();
//     },
//     () => showToast("Location permission needed."),
//     { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
//   );
// }
function startGeolocation() {
  // If test mode, we don't start GPS watching
  if (TESTMODE.enabled) {
    showToast("Test mode: arrow keys move. (Shift = faster, T toggles)");
    // Initialize simulated position: use map center or default
    const c = state.map ? state.map.getCenter() : { lat: 37.7749, lng: -122.4194 };
    TESTMODE.lat = c.lat;
    TESTMODE.lon = c.lng;
    setMyLoc(TESTMODE.lat, TESTMODE.lon, 5);
    installTestModeKeys();
    return;
  }

  if (!navigator.geolocation) {
    showToast("Geolocation not supported.");
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      setMyLoc(latitude, longitude, accuracy || null);

      // keep map view reasonable (your existing behavior)
      if (state.map && !state.userHasPanned) {
        state.map.setView([latitude, longitude], Math.max(state.map.getZoom(), 15));
      }
    },
    () => showToast("Location permission needed."),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}


// Boot
(function init() {
  initMap();
  installTestModeKeys(); // TESTING
  loadInitialState().catch(() => {});
  connectWS();
  startGeolocation();
})();
