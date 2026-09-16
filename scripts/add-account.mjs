/**
 * Provision a Spotify account onto the head unit.
 *
 *   node scripts/add-account.mjs                        # add / refresh an account
 *   node scripts/add-account.mjs --list                 # show what is on the device
 *   node scripts/add-account.mjs --rename p1 --name Bo  # relabel one
 *   node scripts/add-account.mjs --device 172.16.42.2
 *
 * Why this exists rather than an "Add account" button on the device: adding an
 * account needs a Spotify OAuth round trip, which needs a password, which needs
 * a keyboard. The Car Thing has neither a keyboard nor a browser that renders
 * Spotify's current login page well. So the sign-in happens here, in a real
 * browser, and only the resulting refresh token is sent to the device.
 *
 * The token goes straight from Spotify to this process to nocturned. It is
 * never printed and never written to a file on this machine.
 *
 * Requires http://127.0.0.1:5173/ to be a registered Redirect URI on the
 * Spotify app, which it already is.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5173;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/`;

const SCOPES = [
  "app-remote-control",
  "playlist-modify-private",
  "playlist-modify-public",
  "playlist-read-collaborative",
  "playlist-read-private",
  "streaming",
  "ugc-image-upload",
  "user-follow-modify",
  "user-follow-read",
  "user-library-modify",
  "user-library-read",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-email",
  "user-read-playback-position",
  "user-read-playback-state",
  "user-read-private",
  "user-read-recently-played",
  "user-top-read",
].join(",");

/* ------------------------------------------------------------------ args -- */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const DEVICE = flag("device", "172.16.42.2");
const DAEMON = `http://${DEVICE}:5000`;
const NAME_OVERRIDE = flag("name", null);

/* ------------------------------------------------------------------ env -- */

function clientId() {
  const raw = readFileSync(join(ROOT, ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*VITE_SPOTIFY_CLIENT_ID\s*=\s*(.+?)\s*$/);
    if (m) return m[1];
  }
  throw new Error("VITE_SPOTIFY_CLIENT_ID not found in .env");
}

const b64url = (buf) =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/* --------------------------------------------------------------- device -- */

/**
 * Relabel a profile.
 *
 * Spotify display names are often just the numeric user id, which makes for a
 * poor label on a switcher. Renaming lives here rather than on the device for
 * the same reason as everything else in this script: no keyboard.
 */
async function rename(id, name) {
  if (!name) throw new Error("--rename needs --name");

  const listRes = await fetch(`${DAEMON}/profiles`);
  if (!listRes.ok) throw new Error(`device returned ${listRes.status}`);
  const { profiles } = await listRes.json();
  if (!profiles.some((p) => p.id === id)) {
    throw new Error(`no profile ${id} on ${DEVICE} - try --list`);
  }

  // No refreshToken in the body, so the device keeps the stored credential.
  const res = await fetch(`${DAEMON}/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name }),
  });
  if (!res.ok) throw new Error(`rename failed (${res.status})`);
  console.log(`Renamed ${id} to "${name}"`);
}

async function listAccounts() {
  const res = await fetch(`${DAEMON}/profiles`);
  if (!res.ok)
    throw new Error(`device returned ${res.status} - is nocturned running?`);
  const { activeId, profiles } = await res.json();
  if (!profiles.length) {
    console.log("No accounts on the device yet.");
    return;
  }
  console.log(`\nAccounts on ${DEVICE}:\n`);
  for (const p of profiles) {
    const marks = [
      p.id === activeId ? "active" : null,
      p.hasToken ? null : "NO TOKEN",
      p.btAddress ? `phone ${p.btAddress}` : "no phone bound",
    ].filter(Boolean);
    console.log(`  ${p.id}  ${p.name.padEnd(24)} ${marks.join(", ")}`);
  }
  console.log();
}

/* ----------------------------------------------------------------- flow -- */

function waitForCode(expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      const reply = (msg) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Nocturne</title>` +
            `<body style="font:16px system-ui;padding:3rem;max-width:34rem">` +
            `<h2>${msg}</h2><p>You can close this tab and return to the terminal.</p>`,
        );
      };

      if (error) {
        reply("Sign-in was cancelled.");
        server.close();
        reject(new Error(error));
        return;
      }
      if (!code) {
        // Favicon and other stray requests hit this same server.
        res.writeHead(404).end();
        return;
      }
      if (state !== expectedState) {
        reply("State mismatch - nothing was saved.");
        server.close();
        reject(new Error("state mismatch"));
        return;
      }

      reply("Signed in. Saving to the device...");
      server.close();
      resolve(code);
    });

    server.on("error", (err) => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(`port ${PORT} is busy - stop the dev server and retry`)
          : err,
      );
    });
    server.listen(PORT, "127.0.0.1");
  });
}

async function main() {
  if (args.includes("--list")) {
    await listAccounts();
    return;
  }

  const renameId = flag("rename", null);
  if (renameId) {
    await rename(renameId, NAME_OVERRIDE);
    return;
  }

  const id = clientId();
  const verifier = b64url(randomBytes(64));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const authorizeUrl =
    "https://accounts.spotify.com/authorize?" +
    new URLSearchParams({
      client_id: id,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
      code_challenge_method: "S256",
      code_challenge: challenge,
      // Force the account chooser. Without this Spotify silently reuses whoever
      // is already signed in to this browser, which on a second run means
      // provisioning the SAME account again and wondering why nothing changed.
      show_dialog: "true",
    }).toString();

  console.log(
    "\nOpen this in your browser and sign in as the account to add:\n",
  );
  console.log(authorizeUrl);
  console.log("\nWaiting for the redirect...\n");

  const code = await waitForCode(state);

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`token exchange failed (${tokenRes.status}): ${body}`);
  }
  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    throw new Error("Spotify returned no refresh token");
  }

  let name = NAME_OVERRIDE;
  let product = null;
  if (!name || !product) {
    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      name = name || me.display_name || me.email || "Account";
      product = me.product;
    }
  }

  // Playback control needs Premium. Better to say so now than to have someone
  // discover it as "the buttons do nothing" in a moving car.
  if (product && product !== "premium") {
    console.warn(
      `WARNING: ${name} is on Spotify ${product}, not Premium. ` +
        `Browsing will work; play/pause and skip will not.`,
    );
  }

  // Reuse the existing profile when this account is already on the device, so
  // re-running to refresh a credential does not create a duplicate.
  let existingId = "";
  try {
    const res = await fetch(`${DAEMON}/profiles`);
    if (res.ok) {
      const { profiles } = await res.json();
      const match = profiles.find((p) => p.name === name);
      if (match) existingId = match.id;
    }
  } catch {
    // Device unreachable is handled by the POST below, with a better message.
  }

  const saveRes = await fetch(`${DAEMON}/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: existingId,
      name,
      refreshToken: tokens.refresh_token,
    }),
  });
  if (!saveRes.ok) {
    const body = await saveRes.text();
    throw new Error(
      `device rejected the profile (${saveRes.status}): ${body}\n` +
        `Is nocturned running and is ${DEVICE} reachable?`,
    );
  }
  const saved = await saveRes.json();

  console.log(
    `Saved "${saved.name}" to ${DEVICE} as ${saved.id}` +
      (existingId ? " (updated existing)" : ""),
  );
  console.log(
    "\nOn the device: Settings > Account > Accounts to bind a phone and switch.\n",
  );
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
