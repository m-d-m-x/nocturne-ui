import { useCallback, useEffect, useRef, useState } from "react";
import { useNocturned } from "../../../hooks/useNocturned";
import { useSettings } from "../../../contexts/SettingsContext";
import { classifyIntent, intentLabel } from "../../../utils/voiceIntent";

function friendlyError(raw) {
  const s = (raw || "").toLowerCase();
  if (s.includes("429") || s.includes("rate_limit") || s.includes("rate limit"))
    return "Rate limit — try again";
  if (
    s.includes("401") ||
    s.includes("invalid_api_key") ||
    s.includes("authentication")
  )
    return "Invalid API key";
  if (
    s.includes("empty transcription") ||
    s.includes("no audio") ||
    s.includes("no speech")
  )
    return "No speech detected";
  return "Voice command failed";
}

/** Voice pipeline tracing - grep the device console for "[voice]". */
function vlog(...args) {
  console.log("[voice]", ...args);
}

/** Capture levels, so a silent-looking recording can be diagnosed from the log. */
function levels(p) {
  if (p.peakRms === undefined) return "";
  return `peak=${Math.round(p.peakRms)} floor=${Math.round(
    p.floorRms ?? 0,
  )} threshold=${Math.round(p.threshold ?? 0)} windows=${p.windows ?? 0}`;
}

const PHASE_IDLE = "idle";
const PHASE_LISTENING = "listening";
const PHASE_PROCESSING = "processing";
const PHASE_CONFIRMED = "confirmed";
const PHASE_ERROR = "error";

// Nothing here should be able to strand the overlay on screen. nocturned caps
// capture at 30s (arecord -d) and gives transcription a 30s client timeout, so
// these are backstops a healthy run never reaches.
const PHASE_TIMEOUTS = {
  [PHASE_IDLE]: 10000,
  [PHASE_LISTENING]: 35000,
  [PHASE_PROCESSING]: 40000,
};

const CLOSE_DELAY_ERROR = 2500;
const CLOSE_DELAY_SEARCH = 600;
const CLOSE_DELAY_COMMAND = 1200;

function ListeningOverlay({ show, onClose, onCommand }) {
  const { settings } = useSettings();
  const { apiRequest, addMessageListener, removeMessageListener } =
    useNocturned();

  const [mounted, setMounted] = useState(show);
  const [phase, setPhase] = useState(PHASE_IDLE);
  const [errMsg, setErrMsg] = useState("");
  const [confirmedLabel, setConfirmedLabel] = useState("");

  const sessionActiveRef = useRef(false);
  const startedForShowRef = useRef(false);
  const mountedRef = useRef(true);
  const closeTimerRef = useRef(null);

  // Effects below must not re-run when the parent re-renders (App re-renders on
  // every playback poll, and this overlay is now on screen for many seconds),
  // so latest-value props and settings are read through refs instead of deps.
  const onCloseRef = useRef(onClose);
  const onCommandRef = useRef(onCommand);
  const settingsRef = useRef(settings);
  useEffect(() => {
    onCloseRef.current = onClose;
    onCommandRef.current = onCommand;
    settingsRef.current = settings;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const releaseBody = useCallback(() => {
    document.body.classList.remove("stop-scrolling");
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
  }, []);

  /** Settle into a terminal phase, then hand control back to the parent. */
  const finish = useCallback(
    (delay) => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        releaseBody();
        onCloseRef.current?.();
      }, delay);
    },
    [releaseBody],
  );

  const fail = useCallback(
    (message, delay = CLOSE_DELAY_ERROR) => {
      if (!mountedRef.current) return;
      sessionActiveRef.current = false;
      setErrMsg(message);
      setPhase(PHASE_ERROR);
      finish(delay);
    },
    [finish],
  );

  const cancelSession = useCallback(() => {
    if (!sessionActiveRef.current) return;
    sessionActiveRef.current = false;
    vlog("cancelling capture");
    apiRequest("/audio/transcribe/cancel", "POST").catch(() => {});
  }, [apiRequest]);

  useEffect(() => {
    let unmountTimer;
    if (show) {
      setMounted(true);
      document.body.classList.add("stop-scrolling");
    } else if (mounted) {
      unmountTimer = setTimeout(() => setMounted(false), 300);
      setTimeout(releaseBody, 300);
    }
    return () => {
      if (unmountTimer) clearTimeout(unmountTimer);
    };
  }, [show, mounted, releaseBody]);

  useEffect(() => {
    if (!mounted) return;

    const handleKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        cancelSession();
        releaseBody();
        onCloseRef.current?.();
      }
    };

    const preventDismiss = (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    window.addEventListener("keydown", handleKey, true);
    window.addEventListener("wheel", preventDismiss, {
      passive: false,
      capture: true,
    });
    window.addEventListener("touchmove", preventDismiss, {
      passive: false,
      capture: true,
    });
    window.addEventListener("touchstart", preventDismiss, {
      passive: false,
      capture: true,
    });
    window.addEventListener("touchend", preventDismiss, {
      passive: false,
      capture: true,
    });

    return () => {
      window.removeEventListener("keydown", handleKey, true);
      window.removeEventListener("wheel", preventDismiss, { capture: true });
      window.removeEventListener("touchmove", preventDismiss, {
        capture: true,
      });
      window.removeEventListener("touchstart", preventDismiss, {
        capture: true,
      });
      window.removeEventListener("touchend", preventDismiss, { capture: true });
    };
  }, [mounted, cancelSession, releaseBody]);

  useEffect(() => {
    if (mounted) {
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
    } else {
      releaseBody();
    }
  }, [mounted, releaseBody]);

  const runIntent = useCallback(
    (text) => {
      let intent;
      try {
        intent = classifyIntent(text);
      } catch (err) {
        vlog("intent classification threw", err);
        fail("Couldn't understand — try again");
        return;
      }

      vlog("intent", intent.type, intent.args, `-> "${intentLabel(intent)}"`);
      setConfirmedLabel(intentLabel(intent));
      setPhase(PHASE_CONFIRMED);
      onCommandRef.current?.(intent);
      finish(
        intent.type === "search" ? CLOSE_DELAY_SEARCH : CLOSE_DELAY_COMMAND,
      );
    },
    [finish, fail],
  );

  // Capture lifecycle is owned by nocturned: it auto-stops after ~2s of silence
  // and tells us via voice_state, then delivers voice_transcript.
  useEffect(() => {
    const id = addMessageListener("voice-events", (data) => {
      if (!mountedRef.current) return;

      if (data?.type === "voice_state") {
        const p = data.payload || {};
        if (p.state === "recording") {
          vlog("recording started");
          setPhase(PHASE_LISTENING);
        } else if (p.state === "transcribing") {
          vlog(
            `recording stopped (${p.reason || "?"})`,
            `${p.durationMs ?? "?"}ms`,
            `${p.bytes ?? "?"} bytes`,
            levels(p),
          );
          setPhase(PHASE_PROCESSING);
        } else if (p.state === "discarded") {
          vlog(
            `recording discarded (${p.reason || "?"})`,
            `${p.durationMs ?? "?"}ms`,
            levels(p),
            "- nothing above the speech threshold",
          );
        } else if (p.state === "cancelled") {
          vlog("capture cancelled");
        }
        return;
      }

      if (data?.type !== "voice_transcript") return;

      sessionActiveRef.current = false;
      const { text, error, provider, elapsedMs } = data.payload || {};

      if (error) {
        vlog("transcript error:", error);
        fail(friendlyError(error), 3000);
      } else if (text) {
        vlog(
          `transcript via ${provider || "?"} in ${elapsedMs ?? "?"}ms:`,
          JSON.stringify(text),
        );
        runIntent(text);
      } else {
        vlog("transcript was empty");
        fail("No speech detected");
      }
    });

    return () => removeMessageListener(id);
  }, [addMessageListener, removeMessageListener, runIntent, fail]);

  // Start exactly once per show-edge.
  useEffect(() => {
    if (!show) {
      startedForShowRef.current = false;
      return;
    }
    if (startedForShowRef.current) return;
    startedForShowRef.current = true;

    let cancelled = false;
    setPhase(PHASE_IDLE);
    setErrMsg("");
    setConfirmedLabel("");
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);

    (async () => {
      const apiKey = (settingsRef.current.voiceSttApiKey || "").trim();
      if (!apiKey) {
        fail("No API key configured. Open Settings → Voice Search.", 3500);
        return;
      }

      try {
        await apiRequest("/audio/transcribe/start", "POST", {
          provider: settingsRef.current.voiceSttProvider || "groq",
          apiKey,
          lang: "en",
        });
        if (cancelled) {
          apiRequest("/audio/transcribe/cancel", "POST").catch(() => {});
          return;
        }
        sessionActiveRef.current = true;
        vlog("capture start acknowledged by nocturned");
        setPhase(PHASE_LISTENING);
      } catch (err) {
        if (cancelled) return;
        fail(err?.message || "Failed to start capture", 3000);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [show, apiRequest, fail]);

  // Watchdog: never leave the overlay stuck in a non-terminal phase.
  useEffect(() => {
    const budget = PHASE_TIMEOUTS[phase];
    if (!mounted || !budget) return;

    const timer = setTimeout(() => {
      vlog(`watchdog fired in phase "${phase}" after ${budget}ms`);
      cancelSession();
      fail(
        phase === PHASE_LISTENING
          ? "No speech detected"
          : "Voice command timed out",
      );
    }, budget);

    return () => clearTimeout(timer);
  }, [phase, mounted, cancelSession, fail]);

  if (!mounted) return null;

  let label = "";
  let showLoader = false;
  if (phase === PHASE_LISTENING) {
    label = "Listening";
    showLoader = true;
  } else if (phase === PHASE_PROCESSING) {
    label = "Transcribing…";
    showLoader = true;
  } else if (phase === PHASE_CONFIRMED) {
    label = confirmedLabel;
  } else if (phase === PHASE_ERROR) {
    label = errMsg;
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/80 ${
        show ? "listening-fade-in" : "listening-fade-out"
      }`}
    >
      <div className="absolute left-[40px] bottom-[10px] flex flex-col items-start">
        <div className="flex items-center">
          {showLoader && <span className="loader -mt-4" />}
          <p className="text-white text-[72px] font-[700] ml-8">{label}</p>
        </div>
        <p className="text-white text-[32px] mt-6 ml-20 max-w-[80vw]"></p>
      </div>
    </div>
  );
}

export default ListeningOverlay;
