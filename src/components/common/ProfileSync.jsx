import { useEffect } from "react";
import { syncActiveToken } from "../../services/profiles";

/**
 * Keeps the daemon's copy of the active account's refresh token current, and
 * adopts the existing session as a profile the first time it runs.
 *
 * Two reasons this has to be continuous rather than a one-off:
 *
 *   - Spotify rotates the refresh token on every PKCE refresh, so a copy
 *     written once goes stale within the hour. Restoring from a stale one would
 *     mean another desktop OAuth round trip.
 *   - A device that already had a session before profiles existed needs that
 *     session captured, otherwise there is nothing to switch back TO after a
 *     second account is added.
 *
 * Running on [accessToken] lines both up with the moment the token rotates.
 */
export default function ProfileSync({ accessToken }) {
  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;

    (async () => {
      // Name profiles from the account itself. There is no keyboard on this
      // device, so a name the user would have to type is a name they cannot
      // set.
      let name = null;
      try {
        const res = await fetch("https://api.spotify.com/v1/me", {
          headers: { Authorization: "Bearer " + accessToken },
        });
        if (res.ok) {
          const me = await res.json();
          name = me.display_name || me.email || null;
        }
      } catch {
        // Offline, or the token is mid-rotation. syncActiveToken falls back to
        // the name already stored.
      }

      if (cancelled) return;
      await syncActiveToken(name);
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return null;
}
