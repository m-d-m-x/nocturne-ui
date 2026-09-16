/**
 * Account profiles - switching the head unit between two Spotify accounts.
 *
 * The durable half lives in nocturned (/var/lib/nocturne/profiles.json): the
 * refresh token, the bound phone, and the four button presets. That is there
 * rather than here because a refresh token costs a desktop OAuth round trip to
 * replace - signing in on a 3.5in touchscreen with no keyboard is not a real
 * flow - so it has to survive a cleared localStorage and be writable over SSH,
 * which is how a second account gets provisioned in the first place.
 *
 * The live half stays in localStorage exactly where useAuth already looks for
 * it. Switching means: save what the outgoing account has drifted to, drop the
 * current session, write the incoming account's credential into the same keys,
 * and reload. The reload is deliberate - every Spotify hook holds its data in
 * React state with nothing cached to disk, so a fresh page IS the cache
 * invalidation, and the alternative means tearing down the refresh timer and
 * racing in-flight requests from the account being left.
 */

import { track, trackError } from "../utils/telemetry";

const BASE = "http://localhost:5000";

/**
 * Keys that belong to an account rather than to the device.
 *
 * Getting this list wrong is the failure that matters: a leftover key means one
 * person sees the other's state. lastPlaybackInfo in particular would show her
 * the track he paused on.
 */
const SESSION_KEYS = [
  "spotifyAccessToken",
  "spotifyRefreshToken",
  "spotifyTokenExpiry",
  "spotifyAuthType",
  "lastPlaybackInfo",
  "currentPlayingMixId",
  "playingLikedSongs",
];

/** The four hardware buttons. These point at Spotify content ids. */
function presetKeys() {
  const parts = ["Id", "Type", "Image", "Name", "Tracks"];
  const keys = [];
  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i < parts.length; i++) {
      keys.push("button" + n + parts[i]);
    }
  }
  return keys;
}

/* ------------------------------------------------------------------ api -- */

async function request(path, options) {
  const res = await fetch(BASE + path, options);
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body && body.error ? body.error : "";
    } catch {
      /* body was not JSON; the status is enough */
    }
    throw new Error(detail || "profiles " + path + " returned " + res.status);
  }
  return res.json();
}

/** All profiles plus which is active. Refresh tokens are redacted here. */
export function listProfiles() {
  return request("/profiles");
}

/** One profile, refresh token included. Only fetched for a profile being used. */
export function getProfile(id) {
  return request("/profiles/" + encodeURIComponent(id));
}

/** Create or update. Omit refreshToken or presets to leave them untouched. */
export function saveProfile(profile) {
  return request("/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
}

export function deleteProfile(id) {
  return request("/profiles/" + encodeURIComponent(id), { method: "DELETE" });
}

/* ------------------------------------------------------- local swapping -- */

function readKeys(keys) {
  const out = {};
  for (let i = 0; i < keys.length; i++) {
    try {
      const v = localStorage.getItem(keys[i]);
      if (v !== null) out[keys[i]] = v;
    } catch {
      /* blocked storage: nothing to capture */
    }
  }
  return out;
}

function clearKeys(keys) {
  for (let i = 0; i < keys.length; i++) {
    try {
      localStorage.removeItem(keys[i]);
    } catch {
      /* nothing further to try */
    }
  }
}

/** Current button mappings, for storing against the outgoing profile. */
export function capturePresets() {
  return readKeys(presetKeys());
}

function applyPresets(presets) {
  clearKeys(presetKeys());
  if (!presets) return;
  const names = Object.keys(presets);
  for (let i = 0; i < names.length; i++) {
    try {
      localStorage.setItem(names[i], presets[names[i]]);
    } catch {
      /* quota: presets are the least important thing here */
    }
  }
}

function currentRefreshToken() {
  try {
    return localStorage.getItem("spotifyRefreshToken") || "";
  } catch {
    return "";
  }
}

/**
 * Push the live refresh token back to the daemon, adopting the current session
 * as a profile if none exists yet.
 *
 * Spotify rotates the refresh token on PKCE refreshes, so the daemon's copy
 * goes stale within an hour of being written. Without this, restoring a profile
 * after a cleared localStorage would hand Spotify a long-dead credential.
 */
export async function syncActiveToken(name) {
  const token = currentRefreshToken();
  if (!token) return;

  try {
    const listing = await listProfiles();
    const profiles = listing.profiles || [];

    if (!listing.activeId || !profiles.length) {
      // First run on a device that already has a session: adopt it, so there is
      // something to switch back TO once a second account is added.
      const created = await saveProfile({
        name: name || "Account 1",
        refreshToken: token,
        presets: capturePresets(),
      });
      track("profile.adopted", { id: created.id, name: created.name });
      return;
    }

    let active = null;
    for (let i = 0; i < profiles.length; i++) {
      if (profiles[i].id === listing.activeId) active = profiles[i];
    }
    if (!active) return;

    await saveProfile({
      id: active.id,
      name: name || active.name,
      refreshToken: token,
    });
  } catch (err) {
    // Never let profile bookkeeping break playback - the session in
    // localStorage is what the app actually runs on.
    trackError("profile.sync.failed", err);
  }
}

/* ------------------------------------------------------------ bluetooth -- */

async function btPost(path) {
  try {
    const res = await fetch(BASE + path, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Move the tether to this profile's phone.
 *
 * Deliberately connect-then-disconnect, and only disconnect the old phone if
 * the new one actually answered. The other phone is frequently not in the car,
 * and dropping a working tether to chase an absent one would take the device
 * offline - including the token refresh the switch depends on.
 */
async function switchBluetooth(fromAddress, toAddress) {
  if (!toAddress || toAddress === fromAddress) return false;

  const connected = await btPost(
    "/bluetooth/connect/" + encodeURIComponent(toAddress),
  );
  if (!connected) {
    track("profile.bt.unreachable", { address: toAddress });
    return false;
  }

  await btPost("/bluetooth/network/" + encodeURIComponent(toAddress));

  if (fromAddress) {
    await btPost("/bluetooth/disconnect/" + encodeURIComponent(fromAddress));
  }
  return true;
}

/* --------------------------------------------------------------- switch -- */

/**
 * Switch to another account. Reloads the page on success and does not return.
 *
 * Order matters. The outgoing account is saved first, because its refresh token
 * has almost certainly rotated since it was stored and losing it would cost
 * another desktop OAuth round trip. The target's credential is fetched and
 * checked before anything local is cleared, so a failure up to that point
 * leaves the device exactly as it was.
 */
export async function switchProfile(id) {
  const listing = await listProfiles();
  if (id === listing.activeId) return;

  const profiles = listing.profiles || [];
  let outgoing = null;
  for (let i = 0; i < profiles.length; i++) {
    if (profiles[i].id === listing.activeId) outgoing = profiles[i];
  }

  if (outgoing) {
    await saveProfile({
      id: outgoing.id,
      name: outgoing.name,
      refreshToken: currentRefreshToken(),
      presets: capturePresets(),
    });
  }

  const target = await getProfile(id);
  if (!target.refreshToken) {
    throw new Error(
      target.name + " has no saved credential. Re-run the provisioning step.",
    );
  }

  await request("/profiles/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });

  await switchBluetooth(outgoing ? outgoing.btAddress : "", target.btAddress);

  track("profile.switched", { from: listing.activeId || "none", to: id });

  // Nothing below this point may throw: the session is half-swapped from here
  // until the reload completes.
  clearKeys(SESSION_KEYS);
  try {
    localStorage.setItem("spotifyRefreshToken", target.refreshToken);
    localStorage.setItem("spotifyAuthType", "spotify");
  } catch {
    /* if this fails the app lands on the login screen, which is recoverable */
  }
  applyPresets(target.presets);

  window.location.reload();
}
