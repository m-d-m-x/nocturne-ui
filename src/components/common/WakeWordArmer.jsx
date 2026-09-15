import { useEffect, useRef } from "react";
import { useNocturned } from "../../hooks/useNocturned";
import { useSettings } from "../../contexts/SettingsContext";

// A websocket reconnect races the network check inside apiRequest, which
// rejects with "No network connection" for a moment afterwards. Without a
// retry the daemon would sit unarmed until the next page reload.
//
// The first attempt is delayed rather than fired immediately: apiRequest logs
// every failure as a console error, and arming half a second early would put a
// misleading red line in the log on every reconnect for something that then
// succeeds on retry.
const INITIAL_ARM_DELAY_MS = 1500;
const ARM_RETRY_MS = 3000;
const MAX_ARM_ATTEMPTS = 5;

/**
 * Keeps "hey spotify" detection armed in nocturned.
 *
 * The daemon does not persist the armed state: it holds the STT credentials in
 * memory so that a detected phrase can open a capture immediately, without a
 * round trip to us that would clip the start of the command. So every daemon
 * restart leaves detection off, and something on this side has to turn it back
 * on. That is what this does.
 *
 * Renders nothing. It lives inside SettingsProvider because the API key comes
 * from settings, which App itself sits outside of.
 *
 * Note detection is not free - it runs two feature models over every 80ms of
 * audio, measured at roughly half of one core on this device. If that ever
 * needs to become a user choice, this is the single place to gate it.
 */
function WakeWordArmer() {
  const { settings } = useSettings();
  const { apiRequest, wsConnected } = useNocturned();

  // What we last successfully armed with, so settings edits re-arm but
  // re-renders do not.
  const armedWithRef = useRef(null);

  // A dropped socket means the daemon went away, taking the armed state with
  // it. Forget what we armed so the effect below re-arms on reconnect.
  useEffect(() => {
    if (!wsConnected) armedWithRef.current = null;
  }, [wsConnected]);

  const provider = settings?.voiceSttProvider || "groq";
  const apiKey = (settings?.voiceSttApiKey || "").trim();

  useEffect(() => {
    if (!wsConnected || !apiKey) return;

    const signature = `${provider}:${apiKey}`;
    if (armedWithRef.current === signature) return;

    let cancelled = false;
    let timer;
    let attempt = 0;

    const arm = () => {
      apiRequest("/audio/transcribe/wake", "POST", {
        enabled: true,
        provider,
        apiKey,
        lang: "en",
      })
        .then(() => {
          if (cancelled) return;
          // Only recorded on success, so a failed attempt is always retried.
          // Re-arming is idempotent in the daemon, so an extra call is safe.
          armedWithRef.current = signature;
          console.log("[voice] wake word armed");
        })
        .catch((err) => {
          if (cancelled) return;
          attempt += 1;
          if (attempt >= MAX_ARM_ATTEMPTS) {
            console.warn(
              "[voice] gave up arming wake word:",
              err?.message || err,
            );
            return;
          }
          timer = setTimeout(arm, ARM_RETRY_MS);
        });
    };

    timer = setTimeout(arm, INITIAL_ARM_DELAY_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [wsConnected, provider, apiKey, apiRequest]);

  return null;
}

export default WakeWordArmer;
