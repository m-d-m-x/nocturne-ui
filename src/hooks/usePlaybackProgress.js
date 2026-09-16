import { useState, useEffect, useRef, useCallback } from "react";
import { track } from "../utils/telemetry";

// Polling cadence, by what the player is actually doing.
//
// A fixed 15s interval was the only thing that ever noticed a pause made on the
// phone: the dealer socket pushes play-history and resume-point telemetry, which
// fires on a track change but NOT on a bare pause, and the PLAYER_STATE_CHANGED
// subscription is unavailable to app tokens (401). So a pause could sit
// unnoticed for the full interval while the progress bar carried on filling from
// locally interpolated time.
//
// Polling faster only while something is playing costs less overall than the old
// flat rate, because it stops almost entirely when idle.
const POLL_PLAYING_MS = 2000;
const POLL_PAUSED_MS = 8000;
const POLL_IDLE_MS = 20000;

const sharedState = {
  refreshTimeoutId: null,
  lastRefreshTime: 0,
  driftHistory: [],
  maxDriftHistory: 10,
  // Read when a tick fires rather than captured when it is scheduled, so the
  // cadence can change without recreating the scheduler callback - an unstable
  // callback here is what previously churned effects elsewhere in this app.
  pollIntervalMs: POLL_IDLE_MS,
};

export const usePlaybackProgress = (
  currentPlayback,
  refreshPlaybackState,
  accessToken,
) => {
  const [progressMs, setProgressMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [trackId, setTrackId] = useState(null);

  const lastUpdateTimeRef = useRef(Date.now());
  const animationFrameRef = useRef(null);
  const serverProgressRef = useRef(0);
  const frameSkipCounterRef = useRef(0);

  const scheduleNextRefresh = useCallback(() => {
    if (sharedState.refreshTimeoutId) {
      clearTimeout(sharedState.refreshTimeoutId);
    }

    sharedState.refreshTimeoutId = setTimeout(() => {
      refreshPlaybackState();
      sharedState.lastRefreshTime = Date.now();
      scheduleNextRefresh();
    }, sharedState.pollIntervalMs);
  }, [refreshPlaybackState]);

  const triggerRefresh = useCallback(() => {
    if (sharedState.refreshTimeoutId) {
      clearTimeout(sharedState.refreshTimeoutId);
    }

    refreshPlaybackState();
    sharedState.lastRefreshTime = Date.now();
    scheduleNextRefresh();
  }, [refreshPlaybackState, scheduleNextRefresh]);

  useEffect(() => {
    if (accessToken) {
      const now = Date.now();
      if (
        !sharedState.refreshTimeoutId ||
        now - sharedState.lastRefreshTime > 10000
      ) {
        triggerRefresh();
      }
    }

    return () => {};
  }, [accessToken, triggerRefresh]);

  useEffect(() => {
    if (currentPlayback) {
      if (currentPlayback?.item?.id !== trackId) {
        setTrackId(currentPlayback.item?.id);
        setDuration(currentPlayback.item?.duration_ms || 0);
        serverProgressRef.current = currentPlayback.progress_ms || 0;
        setProgressMs(currentPlayback.progress_ms || 0);
        lastUpdateTimeRef.current = Date.now();
        sharedState.driftHistory = [];
      } else if (typeof currentPlayback?.progress_ms === "number") {
        const now = Date.now();
        const elapsed = now - lastUpdateTimeRef.current;
        const estimatedProgress = serverProgressRef.current + elapsed;
        const actualProgress = currentPlayback.progress_ms;
        const drift = estimatedProgress - actualProgress;

        if (elapsed > 1000 && Math.abs(drift) < 10000) {
          sharedState.driftHistory.push(drift);
          if (sharedState.driftHistory.length > sharedState.maxDriftHistory) {
            sharedState.driftHistory.shift();
          }
        }

        serverProgressRef.current = currentPlayback.progress_ms;
        setProgressMs(currentPlayback.progress_ms);
        lastUpdateTimeRef.current = now;
      }

      setIsPlaying(currentPlayback.is_playing || false);
      setDuration(currentPlayback.item?.duration_ms || 0);
    }
  }, [currentPlayback, trackId]);

  // Retune the cadence to what the player is doing. When it gets shorter the
  // pending tick is rescheduled, so starting playback does not have to wait out
  // a 20s idle timer before the faster rate takes effect.
  useEffect(() => {
    const next = !currentPlayback?.item
      ? POLL_IDLE_MS
      : currentPlayback.is_playing
        ? POLL_PLAYING_MS
        : POLL_PAUSED_MS;

    if (next === sharedState.pollIntervalMs) return;
    const shortened = next < sharedState.pollIntervalMs;
    sharedState.pollIntervalMs = next;
    track("player.pollInterval", {
      ms: next,
      state: !currentPlayback?.item
        ? "idle"
        : currentPlayback.is_playing
          ? "playing"
          : "paused",
    });
    if (shortened && sharedState.refreshTimeoutId) scheduleNextRefresh();
  }, [currentPlayback, scheduleNextRefresh]);

  useEffect(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!isPlaying || duration <= 0) return;

    const animate = () => {
      const now = Date.now();
      const elapsed = now - lastUpdateTimeRef.current;

      let driftCorrectionFactor = 0.98;
      if (sharedState.driftHistory.length >= 3) {
        const averageDrift =
          sharedState.driftHistory.reduce((sum, drift) => sum + drift, 0) /
          sharedState.driftHistory.length;
        if (averageDrift > 100) {
          driftCorrectionFactor = 0.96;
        } else if (averageDrift > 50) {
          driftCorrectionFactor = 0.97;
        } else if (averageDrift < -50) {
          driftCorrectionFactor = 1.01;
        } else {
          driftCorrectionFactor = 0.98;
        }
      }

      const correctedElapsed = elapsed * driftCorrectionFactor;
      const estimated = Math.min(
        serverProgressRef.current + correctedElapsed,
        duration,
      );

      if (estimated > duration * 0.98) {
        const remaining = duration - serverProgressRef.current;
        const safeProgression = remaining * 0.1;
        const safeEstimated = Math.min(
          serverProgressRef.current + safeProgression,
          duration,
        );
        setProgressMs(safeEstimated);
      } else {
        setProgressMs(estimated);
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, duration]);

  const updateProgress = useCallback((newProgressMs) => {
    serverProgressRef.current = newProgressMs;
    setProgressMs(newProgressMs);
    lastUpdateTimeRef.current = Date.now();
  }, []);

  return {
    progressMs,
    isPlaying,
    duration,
    trackId,
    progressPercentage: duration > 0 ? (progressMs / duration) * 100 : 0,
    updateProgress,
    triggerRefresh,
  };
};
