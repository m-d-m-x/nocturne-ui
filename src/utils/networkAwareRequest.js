import { addGlobalWsListener } from "../hooks/useNocturned";
import { checkNetworkConnectivity } from "./networkChecker";

const LOCAL_URLS = ["172.16.42.1", "localhost"];
let currentNetworkCheckPromise = null;
let isConnected = false;
let listeners = new Set();
let lastNetworkRestoredTime = 0;
export const DNS_READY_DELAY = 5000;

const NETWORK_CHECK_BYPASS_KEY = "networkCheckBypass";

function isBypassed() {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(NETWORK_CHECK_BYPASS_KEY) === "true"
    );
  } catch {
    return false;
  }
}

if (typeof window !== "undefined" && isBypassed()) {
  isConnected = true;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    isConnected = true;
    lastNetworkRestoredTime = Date.now();
    window.dispatchEvent(new CustomEvent("networkRestored"));
  });

  window.addEventListener("offline", () => {
    isConnected = false;
  });

  (async () => {
    try {
      const status = await checkNetworkConnectivity();
      isConnected = status.isConnected;
      window.dispatchEvent(new Event(isConnected ? "online" : "offline"));
    } catch {
      isConnected = false;
    }
  })();
}

function isLocalRequest(url) {
  if (!url) return false;
  return LOCAL_URLS.some((localUrl) => url.includes(localUrl));
}

function setupNetworkMonitoring() {
  if (typeof window === "undefined") return () => {};

  let lastStatusUpdate = 0;
  const MIN_STATUS_UPDATE_INTERVAL = 5000;

  const updateNetworkStatus = (data) => {
    if (data.type === "network_status") {
      const now = Date.now();
      if (now - lastStatusUpdate < MIN_STATUS_UPDATE_INTERVAL) {
        return;
      }
      lastStatusUpdate = now;

      const isOnline = data.payload?.status === "online";
      const wasOffline = !isConnected;
      isConnected = isOnline;

      if (isOnline && wasOffline) {
        lastNetworkRestoredTime = Date.now();
        window.dispatchEvent(new CustomEvent("networkRestored"));
      }

      window.dispatchEvent(new Event(isOnline ? "online" : "offline"));

      listeners.forEach((listener) => {
        if (isOnline) {
          listener.resolve();
        }
      });
      listeners.clear();
    }
  };

  const listenerId = "networkAwareRequest-" + Date.now();
  return addGlobalWsListener(listenerId, {
    onMessage: updateNetworkStatus,
    onClose: () => {
      // The nocturned WebSocket dropping tells us nothing about whether the
      // device has internet - it usually just means nocturned restarted.
      // Treating it as "offline" used to latch isConnected false with nothing
      // able to set it back, which silently blocked every Spotify request.
      // Re-check real connectivity instead of assuming the worst.
      if (isBypassed()) return;

      checkNetworkConnectivity()
        .then((status) => {
          if (status.isConnected) return;
          console.warn("Network unreachable after nocturned WebSocket closed");
          isConnected = false;
        })
        .catch(() => {
          isConnected = false;
        });
    },
  });
}

let cleanupRef = setupNetworkMonitoring();

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

export function waitForNetwork(checkIntervalMs = 1000) {
  return new Promise((resolve) => {
    if (isBypassed() || isConnected) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("browserOnlyModeOnline", handleOnline);
      clearInterval(pollId);
      resolve();
    };

    const handleOnline = () => finish();

    window.addEventListener("online", handleOnline);
    window.addEventListener("browserOnlyModeOnline", handleOnline);

    // Don't rely purely on a future 'online' event that may never fire -
    // actively re-check real connectivity too, since isConnected can get
    // flipped false by something unrelated (e.g. nocturned's own WebSocket
    // blipping) without anything ever telling us it's actually fine.
    const pollId = setInterval(async () => {
      try {
        const status = await checkNetworkConnectivity();
        if (status.isConnected) {
          isConnected = true;
          finish();
        }
      } catch {
        // keep polling
      }
    }, checkIntervalMs);
  });
}

// How long to wait after the daemon confirms the link is up. The daemon has
// already done the waiting for us (see below); this is only a short grace for
// DNS, which can lag a freshly established tether by a moment.
const VERIFIED_SETTLE_MS = 1500;

export function waitForStableNetwork(stabilityDelayMs = 10000) {
  return new Promise((resolve) => {
    if (isBypassed()) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    // Fast path. stabilityDelayMs exists so a flapping link is not hammered the
    // instant it reports up - but it measures THIS PAGE's uptime, which resets
    // on every reload, so a warm reload paid the full settle for nothing. The
    // daemon pings continuously, survives reloads, and needs five consecutive
    // failures to declare offline, so its "online" is direct evidence that the
    // link is already stable. Believe it instead of re-timing from zero.
    //
    // This is what made an account switch take 13s: the page loads in ~200ms
    // and then sat in the settle window.
    checkNetworkConnectivity()
      .then((status) => {
        if (status.isConnected && status.source === "daemon") {
          setTimeout(finish, VERIFIED_SETTLE_MS);
        }
      })
      .catch(() => {
        // Fall through to the listener path below.
      });

    let stabilityTimeout = null;
    let isWaitingForOnline = false;

    // Hard ceiling: without this, a stale isConnected=false with no further
    // 'online' event blocks token refresh forever.
    const hardTimeout = setTimeout(
      () => {
        finish();
      },
      Math.max(stabilityDelayMs * 3, 30000),
    );

    const cleanup = () => {
      clearTimeout(hardTimeout);
      if (stabilityTimeout) {
        clearTimeout(stabilityTimeout);
        stabilityTimeout = null;
      }
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("browserOnlyModeOnline", handleOnline);
    };

    const handleOnline = () => {
      isWaitingForOnline = false;

      if (stabilityTimeout) {
        clearTimeout(stabilityTimeout);
      }

      stabilityTimeout = setTimeout(finish, stabilityDelayMs);
    };

    const handleOffline = () => {
      isWaitingForOnline = true;

      if (stabilityTimeout) {
        clearTimeout(stabilityTimeout);
        stabilityTimeout = null;
      }
    };

    if (isConnected && !isWaitingForOnline) {
      stabilityTimeout = setTimeout(finish, stabilityDelayMs);
    } else {
      isWaitingForOnline = true;
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("browserOnlyModeOnline", handleOnline);
  });
}

export async function networkAwareRequest(
  requestFn,
  retryCount = 0,
  options = {},
) {
  const { requireNetwork = false } = options;

  try {
    const bypass = isBypassed();
    if (!bypass && !isConnected) {
      // Don't trust a possibly-stale cached flag: confirm before refusing to
      // send, otherwise one bad reading blocks every request indefinitely.
      const status = await checkNetworkConnectivity();
      if (!status.isConnected) {
        throw new Error("No network connection");
      }
      isConnected = true;
    }

    const requestInfo = await requestFn();
    const isAuthRequest = requestInfo?.url?.includes("accounts.spotify.com");
    const isLocal = isLocalRequest(requestInfo?.url);
    if (
      !bypass &&
      !isConnected &&
      !isAuthRequest &&
      (!isLocal || requireNetwork)
    ) {
      throw new Error("No network connection");
    }

    const response = await requestInfo;

    if (
      !response.ok &&
      retryCount < MAX_RETRIES &&
      (response.status >= 500 || [429, 408, 0, 304].includes(response.status))
    ) {
      let delayMs = RETRY_DELAY;
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("Retry-After"), 10);
        if (!isNaN(retryAfter)) {
          delayMs = retryAfter * 1000;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return networkAwareRequest(requestFn, retryCount + 1, options);
    }

    return response;
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }

    if (retryCount < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return networkAwareRequest(requestFn, retryCount + 1, options);
    }

    throw error;
  }
}

window.addEventListener("unload", () => {
  if (cleanupRef) {
    cleanupRef();
  }
});
