const N_SECTORS = 13;
const MILES_TO_M = 1609.344;
const INNER_RADIUS_M = 0.05 * MILES_TO_M;
const OUTER_RADIUS_M = 0.5 * MILES_TO_M;
const SLICE_DEG = 360 / N_SECTORS;

function toRad(d) { return d * Math.PI / 180; }
function toDeg(r) { return r * 180 / Math.PI; }

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const dφ = toRad(lat2 - lat1);
  const dλ = toRad(lon2 - lon1);
  const a = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Bearing from (lat1,lon1) to (lat2,lon2), 0° = north, clockwise.
function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lon1), λ2 = toRad(lon2);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2 - λ1);
  let θ = toDeg(Math.atan2(y, x));
  θ = (θ + 360) % 360;
  return θ;
}

// Returns sector index 0..12 if within annulus, else null
function sectorForPosition(centerLat, centerLon, lat, lon) {
  if (centerLat == null || centerLon == null) return null;
  const d = haversineMeters(centerLat, centerLon, lat, lon);
  if (d < INNER_RADIUS_M) return null;
  if (d > OUTER_RADIUS_M) return null;
  const b = bearingDeg(centerLat, centerLon, lat, lon);
  const idx = Math.floor(b / SLICE_DEG);
  return Math.max(0, Math.min(N_SECTORS - 1, idx));
}

module.exports = {
  N_SECTORS,
  INNER_RADIUS_M,
  OUTER_RADIUS_M,
  SLICE_DEG,
  haversineMeters,
  bearingDeg,
  sectorForPosition,
};
