import { useEffect, useRef, useState } from "react";
import { useNocturned } from "../../../hooks/useNocturned";
import { useSettings } from "../../../contexts/SettingsContext";
import { classifyIntent, intentLabel } from "../../../utils/voiceIntent";

function friendlyError(raw) {
  const s = (raw || "").toLowerCase();
  if (s.includes("429") || s.includes("rate_limit") || s.includes("rate limit"))
    return "Rate limit — try again";
  if (s.includes("401") || s.includes("invalid_api_key") || s.includes("authentication"))
    return "Invalid API key";
  if (s.includes("empty transcription") || s.includes("no audio"))
    return "No speech detected";
  return "Voice command failed";
}

const PHASE_IDLE = "idle";
const PHASE_LISTENING = "listening";
const PHASE_PROCESSING = "processing";
const PHASE_COMMANDING = "commanding";
const PHASE_CONFIRMED = "confirmed";
const PHASE_ERROR = "error";

function ListeningOverlay({ show, onClose, onCommand }) {
  const { settings } = useSettings();
  const { apiRequest, addMessageListener, removeMessageListener } =
    useNocturned();

  const [mounted, setMounted] = useState(show);
  const [phase, setPhase] = useState(PHASE_IDLE);
  const [errMsg, setErrMsg] = useState("");
  const [confirmedLabel, setConfirmedLabel] = useState("");
  const sessionActiveRef = useRef(false);
  const listenerIdRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let unmountTimer;
    if (show) {
      setMounted(true);
      document.body.classList.add("stop-scrolling");
    } else if (mounted && (phase === PHASE_IDLE || phase === PHASE_LISTENING || phase === PHASE_ERROR)) {
      unmountTimer = setTimeout(() => setMounted(false), 300);
      setTimeout(() => document.body.classList.remove("stop-scrolling"), 300);
    }
    return () => {
      if (unmountTimer) clearTimeout(unmountTimer);
    };
  }, [show, mounted, phase]);

  useEffect(() => {
    if (!mounted) return;

    const handleKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (sessionActiveRef.current) {
          apiRequest("/audio/transcribe/cancel", "POST").catch(() => {});
          sessionActiveRef.current = false;
        }
        onClose?.();
      } else {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const preventDismiss = (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    window.addEventListener("keydown", handleKey, true);
    window.addEventListener("wheel", preventDismiss, { passive: false, capture: true });
    window.addEventListener("touchmove", preventDismiss, { passive: false, capture: true });
    window.addEventListener("touchstart", preventDismiss, { passive: false, capture: true });
    window.addEventListener("touchend", preventDismiss, { passive: false, capture: true });

    return () => {
      window.removeEventListener("keydown", handleKey, true);
      window.removeEventListener("wheel", preventDismiss, { capture: true });
      window.removeEventListener("touchmove", preventDismiss, { capture: true });
      window.removeEventListener("touchstart", preventDismiss, { capture: true });
      window.removeEventListener("touchend", preventDismiss, { capture: true });
    };
  }, [mounted, onClose, apiRequest]);

  useEffect(() => {
    if (mounted) {
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
    } else {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    }
    return () => {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    };
  }, [mounted]);

  useEffect(() => {
    const id = addMessageListener("voice-transcript", (data) => {
      if (data?.type !== "voice_transcript") return;
      sessionActiveRef.current = false;
      const text = data.payload?.text;
      const error = data.payload?.error;

      if (error) {
        if (!mountedRef.current) return;
        setErrMsg(friendlyError(error));
        setPhase(PHASE_ERROR);
        setTimeout(() => {
          if (mountedRef.current) {
            document.body.classList.remove("stop-scrolling");
            document.body.style.overflow = "";
            document.body.style.touchAction = "";
            setMounted(false);
            onClose?.();
          }
        }, 3000);
        return;
      }

      if (text) {
        if (!mountedRef.current) return;
        setPhase(PHASE_COMMANDING);

        const provider = settings.voiceSttProvider || "groq";
        const apiKey = (settings.voiceSttApiKey || "").trim();

        classifyIntent(text, provider, apiKey)
          .then((intent) => {
            if (!mountedRef.current) return;
            const label = intentLabel(intent);
            setConfirmedLabel(label);
            setPhase(PHASE_CONFIRMED);
            onCommand?.(intent);
            const delay = intent.type === "search" ? 600 : 1200;
            setTimeout(() => {
              if (mountedRef.current) {
                document.body.classList.remove("stop-scrolling");
                document.body.style.overflow = "";
                document.body.style.touchAction = "";
                setMounted(false);
                onClose?.();
              }
            }, delay);
          })
          .catch((err) => {
            if (!mountedRef.current) return;
            const msg =
              err?.message?.includes("429") ||
              err?.message?.includes("rate_limit")
                ? "Rate limit — try again"
                : "Couldn't understand — try again";
            setErrMsg(msg);
            setPhase(PHASE_ERROR);
            setTimeout(() => {
              if (mountedRef.current) {
                document.body.classList.remove("stop-scrolling");
                document.body.style.overflow = "";
                document.body.style.touchAction = "";
                setMounted(false);
                onClose?.();
              }
            }, 2500);
          });
      } else {
        if (!mountedRef.current) return;
        setErrMsg("No speech detected");
        setPhase(PHASE_ERROR);
        setTimeout(() => {
          if (mountedRef.current) onClose?.();
        }, 2500);
      }
    });
    listenerIdRef.current = id;

    return () => {
      if (listenerIdRef.current) removeMessageListener(listenerIdRef.current);
    };
  }, [addMessageListener, removeMessageListener, onClose, onCommand, settings.voiceSttProvider, settings.voiceSttApiKey]);

  useEffect(() => {
    let cancelled = false;

    const startCapture = async () => {
      const apiKey = (settings.voiceSttApiKey || "").trim();
      if (!apiKey) {
        if (cancelled) return;
        setErrMsg("No API key configured. Open Settings → Voice Search.");
        setPhase(PHASE_ERROR);
        setTimeout(() => onClose?.(), 3500);
        return;
      }

      try {
        await apiRequest("/audio/transcribe/start", "POST", {
          provider: settings.voiceSttProvider || "groq",
          apiKey,
          lang: "en",
        });
        if (cancelled) {
          apiRequest("/audio/transcribe/cancel", "POST").catch(() => {});
          return;
        }
        sessionActiveRef.current = true;
        setPhase(PHASE_LISTENING);
        setErrMsg("");
      } catch (err) {
        if (cancelled) return;
        setErrMsg(err?.message || "Failed to start capture");
        setPhase(PHASE_ERROR);
        setTimeout(() => onClose?.(), 3000);
      }
    };

    const stopCapture = async () => {
      if (!sessionActiveRef.current) return;
      try {
        setPhase(PHASE_PROCESSING);
        await apiRequest("/audio/transcribe/stop", "POST");
      } catch (err) {
        sessionActiveRef.current = false;
        setErrMsg(err?.message || "Failed to stop capture");
        setPhase(PHASE_ERROR);
        setTimeout(() => onClose?.(), 3000);
      }
    };

    if (show) {
      setPhase(PHASE_IDLE);
      setErrMsg("");
      startCapture();
    } else if (sessionActiveRef.current) {
      stopCapture();
    }

    return () => {
      cancelled = true;
    };
  }, [show, apiRequest, settings.voiceSttApiKey, settings.voiceSttProvider, onClose]);

  if (!mounted) return null;

  let label = "";
  let showLoader = false;
  if (phase === PHASE_LISTENING) { label = "Listening"; showLoader = true; }
  else if (phase === PHASE_PROCESSING) { label = "Transcribing…"; showLoader = true; }
  else if (phase === PHASE_COMMANDING) { label = "Thinking…"; showLoader = true; }
  else if (phase === PHASE_CONFIRMED) { label = confirmedLabel; showLoader = false; }
  else if (phase === PHASE_ERROR) { label = errMsg; showLoader = false; }

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
