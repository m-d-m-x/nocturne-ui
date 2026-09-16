/**
 * Event recording for the head unit.
 *
 * Replaces scattered console.log calls. Two reasons that matters here:
 *
 *   1. The device is a kiosk. Nobody is watching a console while driving, so
 *      logging to it is write-only - the wake-word tuning problem was invisible
 *      for exactly this reason.
 *   2. Chromium 69 on a slow ARM core pays real cost for string formatting on
 *      hot paths, and several of these fired per poll.
 *
 * So events go into a bounded in-memory ring instead, and the console stays
 * quiet unless someone asks for it. The ring is the seam a shipper hooks into:
 * see drain() below.
 *
 * Enable console output at runtime, no rebuild:
 *   localStorage.setItem("nocturneDebug", "true"); location.reload();
 */

const RING_SIZE = 500;
const DEBUG_KEY = "nocturneDebug";

let ring = [];
let subscriber = null;

function consoleEnabled() {
  try {
    return localStorage.getItem(DEBUG_KEY) === "true";
  } catch {
    // Private mode or blocked storage: stay quiet rather than throw on a path
    // that every event passes through.
    return false;
  }
}

let debugOn = consoleEnabled();

// Keys the event envelope owns. A data field colliding with one of these is
// kept nested rather than silently overwriting the envelope.
const RESERVED = new Set([
  "_time",
  "at",
  "message",
  "name",
  "session",
  "uptimeMs",
]);

// One boot of the UI. Lets a whole drive be selected in one query, which
// matters because the device has no stable identity between restarts.
const SESSION_ID = Math.random().toString(36).slice(2, 10);

/** Compact a value for the human-readable summary, not for the stored field. */
function brief(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  if (typeof value === "string") {
    return value.length > 60
      ? JSON.stringify(value.slice(0, 57) + "...")
      : JSON.stringify(value);
  }
  if (value === null || value === undefined) return "-";
  return JSON.stringify(value);
}

/**
 * A scannable one-line summary.
 *
 * Without this every attribute is rendered with equal weight and the stream is
 * unreadable - the full precision stays in the individual fields, which are
 * what queries actually use.
 */
function summarise(name, data) {
  if (!data || typeof data !== "object") return name;
  const parts = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${brief(v)}`);
  return parts.length ? `${name} ${parts.join(" ")}` : name;
}

/** Lift data fields to the top level so queries read `peak > 100`, not `data.peak`. */
function flatten(data) {
  if (!data || typeof data !== "object") return {};
  const out = {};
  const nested = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (RESERVED.has(k)) nested[k] = v;
    else out[k] = v;
  }
  if (Object.keys(nested).length) out.data = nested;
  return out;
}

/**
 * Record an event.
 *
 * @param {string} name  dotted identifier, e.g. "voice.wake.detected"
 * @param {object} [data] small, JSON-serialisable detail; lifted to top level
 */
export function track(name, data) {
  const event = {
    // Wall clock, used by the daemon to derive _time and then dropped. The
    // device has no RTC, so this can be wrong until ntp corrects it.
    at: Date.now(),
    // Milliseconds since this page loaded - reliable even when the clock is
    // not, and the right axis for boot-sequence timing.
    uptimeMs: Math.round(performance.now()),
    session: SESSION_ID,
    name,
    message: summarise(name, data),
    ...flatten(data),
  };

  ring.push(event);
  if (ring.length > RING_SIZE) ring = ring.slice(-RING_SIZE);

  if (debugOn) {
    console.log(event.message);
  }
  if (subscriber) {
    try {
      subscriber(event);
    } catch {
      // A bad subscriber must never break the thing it is observing.
    }
  }
}

export function trackError(name, err, data) {
  const message = err?.message || String(err ?? "unknown");
  track(name, { ...(data || {}), level: "error", error: message });
  console.error(`[${name}]`, message);
}

/** Everything currently buffered, oldest first. */
export function snapshot() {
  return ring.slice();
}

/**
 * Take the buffer and clear it. This is the hook for a batch shipper: call it
 * on an interval, POST the result, and put it back with restore() if the send
 * fails so nothing is lost to a dropped tunnel.
 */
export function drain() {
  const out = ring;
  ring = [];
  return out;
}

/** Put undelivered events back at the front after a failed send. */
export function restore(events) {
  if (!events?.length) return;
  ring = events.concat(ring).slice(-RING_SIZE);
}

/** Observe events as they happen, for a live shipper. Pass null to stop. */
export function subscribe(fn) {
  subscriber = fn;
}

/** Toggle console output without a reload. */
export function setDebug(on) {
  debugOn = !!on;
  try {
    localStorage.setItem(DEBUG_KEY, on ? "true" : "false");
  } catch {
    // Setting is best-effort; the in-memory flag still applies this session.
  }
}

// Reachable from the devtools console on the device.
if (typeof window !== "undefined") {
  window.nocturneTelemetry = { snapshot, drain, setDebug, track };
}
