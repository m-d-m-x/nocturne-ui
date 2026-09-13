import { networkAwareRequest } from "../utils/networkAwareRequest";

const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

export const REDIRECT_URI = `${window.location.origin}/`;

const SCOPES =
  "app-remote-control,playlist-modify-private,playlist-modify-public,playlist-read-collaborative,playlist-read-private,streaming,ugc-image-upload,user-follow-modify,user-follow-read,user-library-modify,user-library-read,user-modify-playback-state,user-read-currently-playing,user-read-email,user-read-playback-position,user-read-playback-state,user-read-private,user-read-recently-played,user-top-read";

function base64UrlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateCodeVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return base64UrlEncode(bytes);
}

export async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

export function generateState() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return base64UrlEncode(bytes);
}

export async function buildAuthorizeUrl() {
  if (!SPOTIFY_CLIENT_ID) {
    throw new Error(
      "Missing VITE_SPOTIFY_CLIENT_ID. Set it in a .env file at the project root.",
    );
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  sessionStorage.setItem("spotifyCodeVerifier", codeVerifier);
  sessionStorage.setItem("spotifyAuthState", state);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export function consumeRedirectParams() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  if (!code && !error) return null;

  window.history.replaceState({}, document.title, window.location.pathname);

  return { code, state, error };
}

export async function exchangeCodeForToken(code, codeVerifier) {
  if (!SPOTIFY_CLIENT_ID) {
    throw new Error(
      "Missing VITE_SPOTIFY_CLIENT_ID. Set it in a .env file at the project root.",
    );
  }

  try {
    const response = await networkAwareRequest(async () =>
      fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: SPOTIFY_CLIENT_ID,
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier,
        }).toString(),
      }),
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error_description || "Failed to exchange code for token",
      );
    }

    return await response.json();
  } catch (error) {
    console.error("Error exchanging code for token:", error);
    throw error;
  }
}

export async function refreshAccessToken(refreshToken) {
  if (!SPOTIFY_CLIENT_ID) {
    throw new Error(
      "Missing VITE_SPOTIFY_CLIENT_ID. Set it in a .env file at the project root.",
    );
  }

  try {
    const response = await networkAwareRequest(async () =>
      fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: SPOTIFY_CLIENT_ID,
        }).toString(),
      }),
    );

    if (response.status === 400) {
      try {
        const errorData = await response.json();
        if (errorData?.error === "invalid_grant") {
          throw new Error("invalid_grant");
        }
        throw new Error(errorData?.error_description || "Token refresh failed");
      } catch {
        throw new Error("invalid_grant");
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error refreshing token:", error);
    throw error;
  }
}
