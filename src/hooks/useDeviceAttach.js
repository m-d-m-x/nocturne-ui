import { useEffect, useRef } from "react";
import { track, trackError } from "../utils/telemetry";

const DEVICES_URL = "https://api.spotify.com/v1/me/player/devices";
const TRANSFER_URL = "https://api.spotify.com/v1/me/player";

const RETRY_MS = 4000;
const MAX_ATTEMPTS = 5;

/**
 * Attaches to an available Spotify Connect device on cold start.
 *
 * On boot the phone's Spotify app is often not yet advertising itself, so
 * /me/player/devices comes back empty and the head unit has nothing to control
 * until the user opens Spotify on their phone and presses something. Polling a
 * handful of times covers that window.
 *
 * Transfers with `play: false` deliberately. Attaching is about establishing
 * which device this controls; starting playback on boot because a device
 * appeared would be a surprise, especially in a car.
 *
 * Gives up silently after MAX_ATTEMPTS: no device is a completely normal state
 * (phone asleep, Spotify closed) and is not worth an error in front of the
 * user. Pressing play still runs the existing on-demand device lookup.
 */
export function useDeviceAttach({ accessToken, isAuthenticated }) {
  // One attempt sequence per app start; a token refresh must not restart it.
  const ranRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !accessToken || ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;
    let timer;
    let attempts = 0;

    const attach = async (devices) => {
      const active = devices.find((d) => d.is_active);
      if (active) {
        track("devices.alreadyActive", { device: active.name });
        return;
      }
      const target = devices[0];
      try {
        const res = await fetch(TRANSFER_URL, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ device_ids: [target.id], play: false }),
        });
        if (cancelled) return;
        if (res.ok || res.status === 204) {
          track("devices.attached", { device: target.name });
        } else {
          track("devices.attachRejected", {
            device: target.name,
            status: res.status,
          });
        }
      } catch (err) {
        if (!cancelled) trackError("devices.attachFailed", err);
      }
    };

    const poll = async () => {
      attempts += 1;
      let devices = null;

      try {
        const res = await fetch(DEVICES_URL, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (cancelled) return;
          devices = data.devices || [];
        }
      } catch {
        // Offline or the request was refused; treated the same as no devices.
      }
      if (cancelled) return;

      if (devices && devices.length > 0) {
        await attach(devices);
        return;
      }

      if (attempts >= MAX_ATTEMPTS) {
        track("devices.noneFound", { attempts });
        return;
      }
      timer = setTimeout(poll, RETRY_MS);
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [accessToken, isAuthenticated]);
}

export default useDeviceAttach;
