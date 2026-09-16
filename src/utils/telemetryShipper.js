/**
 * Store-and-forward for telemetry.
 *
 * Events are written to localStorage as batches, a push is attempted every
 * 60s, and a batch is deleted only once the server has accepted it. Anything
 * that fails stays queued for the next attempt.
 *
 * localStorage is the store because it is the only thing on this device that
 * survives both a reboot and a deploy: the deploy scripts clear
 * chrome_storage/Default/Cache but not Local Storage. The rootfs is mounted
 * read-only in normal operation, so writing files was not an option.
 *
 * The queue is deliberately and tightly bounded. localStorage is shared with
 * auth tokens, settings and button mappings, and a full quota makes setItem
 * throw for *everything*, so an offline drive must not be able to fill it.
 * Telemetry is the least important thing here and drops itself first.
 *
 * Batches go to nocturned, not to the log service directly. A browser POST to
 * an ingest API carries Authorization and a non-simple content type, so it is
 * preflighted, and ingest APIs built for servers generally do not answer
 * preflights. nocturned forwards from there, which also keeps the ingest token
 * out of this kiosk's localStorage and survives the Chromium restart that every
 * UI deploy causes.
 *
 * So there are two queues, deliberately. This one covers the seconds between
 * events and the next flush; the daemon's disk queue covers the hours a car
 * spends out of coverage. The handoff is a local request that only fails if
 * nocturned itself is down.
 *
 * Override the destination for testing:
 *   localStorage.setItem("nocturneTelemetryUrl", "https://...")
 *   localStorage.setItem("nocturneTelemetryToken", "...")   // optional
 */

import { drain, restore } from "./telemetry.js";

const QUEUE_KEY = "nocturneTelemetryQueue";
const URL_KEY = "nocturneTelemetryUrl";
const TOKEN_KEY = "nocturneTelemetryToken";

// nocturned on the loopback. It answers preflight and owns the durable queue.
const DEFAULT_URL = "http://localhost:5000/telemetry";

export const FLUSH_INTERVAL_MS = 60000;

// Caps. MAX_BYTES is the one that matters - it is what keeps telemetry from
// starving the rest of the app of storage.
export const MAX_BATCHES = 24;
export const MAX_BYTES = 128 * 1024;

// How many queued batches to push in one cycle, so a device coming back online
// after a long drive drains instead of dribbling one batch a minute.
const MAX_SENDS_PER_FLUSH = 5;

const POST_TIMEOUT_MS = 10000;

/* ------------------------------------------------------------------ pure -- */

/**
 * Append a batch and enforce the caps, dropping OLDEST first.
 *
 * Exported separately from any browser API so the queue policy can be tested
 * directly - this is the part that must not misbehave when a device has been
 * offline for hours.
 */
export function enqueue(
  queue,
  batch,
  { maxBatches = MAX_BATCHES, maxBytes = MAX_BYTES } = {},
) {
  let out = queue.concat([batch]);
  if (out.length > maxBatches) out = out.slice(out.length - maxBatches);
  // Drop from the front until it fits. Newest data is the most useful, and a
  // partial history beats no history and a broken app.
  while (out.length > 1 && JSON.stringify(out).length > maxBytes) {
    out = out.slice(1);
  }
  return out;
}

/** Remove a batch by id, after the server has accepted it. */
export function acknowledge(queue, id) {
  return queue.filter((b) => b.id !== id);
}

/* --------------------------------------------------------------- storage -- */

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    return true;
  } catch {
    // Quota exceeded, most likely. Shed the oldest half and try once more;
    // if that still fails, drop telemetry entirely rather than let it break
    // features that share this storage.
    try {
      const half = queue.slice(Math.floor(queue.length / 2));
      localStorage.setItem(QUEUE_KEY, JSON.stringify(half));
      return true;
    } catch {
      try {
        localStorage.removeItem(QUEUE_KEY);
      } catch {
        /* nothing further to try */
      }
      return false;
    }
  }
}

function config() {
  try {
    return {
      url: localStorage.getItem(URL_KEY) || DEFAULT_URL,
      token: localStorage.getItem(TOKEN_KEY) || "",
    };
  } catch {
    return { url: DEFAULT_URL, token: "" };
  }
}

/* ---------------------------------------------------------------- sending -- */

async function postBatch(url, token, batch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-ndjson",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // NDJSON: one event per line, which every log backend ingests directly.
      body: batch.events.map((e) => JSON.stringify(e)).join("\n"),
      signal: controller.signal,
    });
    // 4xx other than 429 means the server will never accept this batch;
    // retrying it forever would block everything behind it in the queue.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      return "reject";
    }
    return res.ok ? "ok" : "retry";
  } catch {
    return "retry";
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------------------------------------------- driver -- */

let timer = null;
let flushing = false;

/** Move whatever is in the in-memory ring into the durable queue. */
function captureRing() {
  const events = drain();
  if (!events.length) return;
  const batch = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    events,
  };
  const next = enqueue(readQueue(), batch);
  if (!writeQueue(next)) {
    // Storage refused it; hand the events back so they are not simply lost.
    restore(events);
  }
}

export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    captureRing();

    const { url, token } = config();
    if (!url) return; // Explicitly disabled: queue and rotate, send nothing.

    for (let i = 0; i < MAX_SENDS_PER_FLUSH; i++) {
      const queue = readQueue();
      if (!queue.length) break;

      const batch = queue[0];
      const result = await postBatch(url, token, batch);
      if (result === "retry") break; // Keep it; try again next cycle.

      // "ok" and "reject" both remove it - accepted, or never acceptable.
      writeQueue(acknowledge(readQueue(), batch.id));
    }
  } finally {
    flushing = false;
  }
}

/** Begin the 60s cycle. Safe to call more than once. */
export function startTelemetryShipper() {
  if (timer) return;
  timer = setInterval(flush, FLUSH_INTERVAL_MS);

  // Capture on the way out so a reboot does not lose the current ring. Only
  // captures - a POST during teardown would not reliably complete.
  const onHide = () => {
    if (document.visibilityState === "hidden") captureRing();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", captureRing);
}

/** Queue depth, for diagnostics. */
export function queueStatus() {
  const queue = readQueue();
  return {
    batches: queue.length,
    events: queue.reduce((n, b) => n + (b.events?.length || 0), 0),
    bytes: JSON.stringify(queue).length,
    configured: Boolean(config().url),
  };
}

if (typeof window !== "undefined") {
  window.nocturneTelemetryQueue = { status: queueStatus, flush };
}
