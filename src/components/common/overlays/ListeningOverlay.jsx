import { useEffect, useRef, useState } from "react";
import { useNocturned } from "../../../hooks/useNocturned";
import { useSettings } from "../../../contexts/SettingsContext";

const PHASE_IDLE = "idle";
const PHASE_LISTENING = "listening";
const PHASE_PROCESSING = "processing";
const PHASE_ERROR = "error";

function ListeningOverlay({ show, onClose, onTranscript }) {
  const { settings } = useSettings();
  const { apiRequest, addMessageListener, removeMessageListener } =
    useNocturned();

  const [mounted, setMounted] = useState(show);
  const [phase, setPhase] = useState(PHASE_IDLE);
  const [errMsg, setErrMsg] = useState("");
  const sessionActiveRef = useRef(false);
  const listenerIdRef = useRef(null);

  useEffect(() => {
    let unmountTimer;
    if (show) {
      setMounted(true);
      document.body.classList.add("stop-scrolling");
    } else if (mounted) {
      unmountTimer = setTimeout(() => setMounted(false), 300);
      setTimeout(() => document.body.classList.remove("stop-scrolling"), 300);
    }
    return () => {
      if (unmountTimer) clearTimeout(unmountTimer);
    };
  }, [show, mounted]);

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
        setErrMsg(error);
        setPhase(PHASE_ERROR);
        setTimeout(() => onClose?.(), 3000);
        return;
      }

      if (text) {
        onTranscript?.(text);
        onClose?.();
      } else {
        setErrMsg("No speech detected");
        setPhase(PHASE_ERROR);
        setTimeout(() => onClose?.(), 2500);
      }
    });
    listenerIdRef.current = id;

    return () => {
      if (listenerIdRef.current) removeMessageListener(listenerIdRef.current);
    };
  }, [addMessageListener, removeMessageListener, onClose, onTranscript]);

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
  if (phase === PHASE_LISTENING) label = "Listening";
  else if (phase === PHASE_PROCESSING) label = "Searching…";
  else if (phase === PHASE_ERROR) label = errMsg;

  const showLoader = phase === PHASE_LISTENING || phase === PHASE_PROCESSING;

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
