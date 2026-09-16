import { useState, useEffect, useRef, useCallback } from "react";
import {
  networkAwareRequest,
  waitForNetwork,
} from "../utils/networkAwareRequest";
import { useNetwork } from "./useNetwork";
import { track } from "../utils/telemetry";

let globalWebSocket = null;
let globalConnectionId = null;
let connectionCount = 0;
let isConnecting = false;
let isAttemptingReconnect = false;
let connectionErrors = 0;
let retryTimeout = null;
let eventSubscribers = [];
let lastFetchTimestamp = 0;
let pendingFetch = null;
let keepAliveInterval = null;
let isInitialized = false;
let currentAccessToken = null;
let podcastPollingInterval = null;
let isPodcastPlaying = false;
let lastPodcastFetch = 0;
let podcastFetchDebounceTimeout = null;
let initialPlaybackFetchDone = false;
let hasInvalidToken = false;
let rateLimitedUntil = 0;

// Coalescing for dealer-driven refreshes. A single track change produces
// several herodotus frames, and resume-point revisions keep arriving during
// playback, so hints are debounced and then rate limited. Worst case is one
// request every HINT_MIN_GAP_MS, and only while events are actually flowing.
let hintTimeout = null;
let lastHintedFetch = 0;
const HINT_DEBOUNCE_MS = 600;
const HINT_MIN_GAP_MS = 2000;

function scheduleHintedRefresh(run) {
  if (hintTimeout) return;
  const sinceLast = Date.now() - lastHintedFetch;
  const wait = Math.max(HINT_DEBOUNCE_MS, HINT_MIN_GAP_MS - sinceLast);

  hintTimeout = setTimeout(() => {
    hintTimeout = null;
    lastHintedFetch = Date.now();
    run();
  }, wait);
}

export function useSpotifyPlayerState(accessToken, immediateLoad = false) {
  const { isConnected: isNetworkConnected } = useNetwork();
  const [currentPlayback, setCurrentPlayback] = useState(null);
  const [currentlyPlayingAlbum, setCurrentlyPlayingAlbum] = useState(null);
  const [albumChangeEvent, setAlbumChangeEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [initialFetchInProgress, setInitialFetchInProgress] = useState(false);

  const webSocketRef = useRef(null);
  const connectionIdRef = useRef(null);
  const initialStateLoadedRef = useRef(false);
  const lastPlayedAlbumIdRef = useRef(null);
  const subscriberIdRef = useRef(`subscriber-${Date.now()}-${Math.random()}`);
  const reconnectTimeoutRef = useRef(null);
  const maxRetryAttempts = 5;
  const accessTokenRef = useRef(accessToken);
  const currentPlaybackRef = useRef(null);

  useEffect(() => {
    accessTokenRef.current = accessToken;
    hasInvalidToken = false;
  }, [accessToken]);

  const stopPodcastPolling = useCallback(() => {
    if (podcastPollingInterval) {
      clearInterval(podcastPollingInterval);
      podcastPollingInterval = null;
    }
    if (podcastFetchDebounceTimeout) {
      clearTimeout(podcastFetchDebounceTimeout);
      podcastFetchDebounceTimeout = null;
    }
    isPodcastPlaying = false;
    lastPodcastFetch = 0;
  }, []);

  const processPlaybackState = useCallback(
    (data) => {
      if (!data) return;

      const isEpisode =
        data.currently_playing_type === "episode" ||
        (data?.item && data.item.type === "episode");
      const hasIncompleteEpisodeData =
        data.currently_playing_type === "episode" && !data.item;

      if (isEpisode && !isPodcastPlaying) {
        isPodcastPlaying = true;
        setTimeout(() => {
          if (podcastPollingInterval || !isPodcastPlaying) return;

          podcastPollingInterval = setInterval(async () => {
            if (
              isPodcastPlaying &&
              accessTokenRef.current &&
              isNetworkConnected
            ) {
              try {
                const now = Date.now();
                if (now - lastPodcastFetch < 25000) return;

                lastPodcastFetch = now;
                await waitForNetwork();
                const response = await networkAwareRequest(() =>
                  fetch(
                    "https://api.spotify.com/v1/me/player?additional_types=track,episode",
                    {
                      headers: {
                        Authorization: `Bearer ${accessTokenRef.current}`,
                      },
                    },
                  ),
                );

                if (response.ok) {
                  const polledData = await response.json();
                  if (polledData && Object.keys(polledData).length > 0) {
                    const wasPolling = isPodcastPlaying;
                    isPodcastPlaying = false;
                    processPlaybackState(polledData);
                    isPodcastPlaying = wasPolling;
                  }
                }
              } catch (err) {
                console.error("Error polling podcast data:", err);
              }
            }
          }, 30000);
        }, 2000);
      } else if (!isEpisode && isPodcastPlaying) {
        setTimeout(() => {
          if (!isEpisode) {
            stopPodcastPolling();
          }
        }, 1000);
      }

      if (
        hasIncompleteEpisodeData &&
        currentPlaybackRef.current?.item?.type === "episode"
      ) {
        setCurrentPlayback((prevPlayback) => {
          const updatedPlayback = {
            ...prevPlayback,
            device: {
              ...prevPlayback?.device,
              ...data.device,
              volume_percent: data.device?.volume_percent,
            },
            shuffle_state: data.shuffle_state,
            repeat_state: data.repeat_state,
            is_playing: data.is_playing,
            progress_ms: data.progress_ms,
            timestamp: data.timestamp,
          };
          currentPlaybackRef.current = updatedPlayback;
          return updatedPlayback;
        });
        return;
      }

      setCurrentPlayback((prevPlayback) => {
        const newPlayback = {
          ...data,
          device: {
            ...data.device,
            volume_percent: data.device?.volume_percent,
          },
          shuffle_state: data.shuffle_state,
          repeat_state: data.repeat_state,
        };
        currentPlaybackRef.current = newPlayback;
        return newPlayback;
      });

      if (data?.item && data.item.type === "track") {
        const currentAlbum = data.item.is_local
          ? {
              id: `local-${data.item.uri}`,
              name: data.item.album?.name || data.item.name,
              images: [{ url: "/images/not-playing.webp" }],
              artists: data.item.artists,
              type: "local-track",
              uri: data.item.uri,
            }
          : data.item.album;

        setCurrentlyPlayingAlbum(currentAlbum);

        if (
          currentAlbum?.id &&
          currentAlbum.id !== lastPlayedAlbumIdRef.current
        ) {
          lastPlayedAlbumIdRef.current = currentAlbum.id;
          setAlbumChangeEvent({
            album: currentAlbum,
            timestamp: new Date().toISOString(),
          });
        }
      } else if (data?.item && data.item.type === "episode") {
        const currentShow = data.item.show;
        setCurrentlyPlayingAlbum(currentShow);

        if (currentShow?.id && data.item.id) {
          localStorage.setItem(
            `lastPlayedEpisode_${currentShow.id}`,
            data.item.id,
          );
        }
      }

      initialStateLoadedRef.current = true;
    },
    [stopPodcastPolling],
  );

  const resetPlaybackState = useCallback(
    (force = false) => {
      stopPodcastPolling();
      if (force || !initialFetchInProgress) {
        setCurrentPlayback(null);
        setCurrentlyPlayingAlbum(null);
      }
      initialStateLoadedRef.current = true;
    },
    [stopPodcastPolling, initialFetchInProgress],
  );

  const fetchCurrentPlayback = useCallback(
    async (forceRefresh = false) => {
      if (hasInvalidToken) return;
      if (Date.now() < rateLimitedUntil) return;

      if (!accessTokenRef.current || !isNetworkConnected) {
        if (!initialStateLoadedRef.current) {
          setCurrentPlayback(null);
        }
        return;
      }

      const now = Date.now();
      if (!forceRefresh && (now - lastFetchTimestamp < 1000 || pendingFetch)) {
        return;
      }

      const isInitialFetch = !initialStateLoadedRef.current;
      if (isInitialFetch) {
        setInitialFetchInProgress(true);
      }

      try {
        await waitForNetwork();
        lastFetchTimestamp = now;
        pendingFetch = true;
        setIsLoading(true);

        const response = await networkAwareRequest(() =>
          fetch(
            "https://api.spotify.com/v1/me/player?additional_types=track,episode",
            {
              headers: {
                Authorization: `Bearer ${accessTokenRef.current}`,
              },
            },
          ),
        );

        if (response.status === 401 || response.status === 403) {
          hasInvalidToken = true;
          resetPlaybackState(true);
          cleanupWebSocket();
          return;
        }

        if (response.status === 429) {
          const retryAfterSeconds =
            parseInt(response.headers.get("Retry-After"), 10) || 5;
          rateLimitedUntil = Date.now() + retryAfterSeconds * 2000;
          return;
        }

        if (response.status === 204) {
          resetPlaybackState();
          return;
        }

        if (response.ok) {
          const data = await response.json();
          if (!data || Object.keys(data).length === 0) {
            resetPlaybackState();
          } else {
            processPlaybackState(data);
          }
        } else {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
      } catch (err) {
        console.error("Error fetching current playback:", err);
        setError(err.message);

        if (err.name === "NetworkError" || !isNetworkConnected) {
          resetPlaybackState();
          cleanupWebSocket();
        }
      } finally {
        pendingFetch = false;
        setIsLoading(false);
        setInitialFetchInProgress(false);
      }
    },
    [processPlaybackState, resetPlaybackState, isNetworkConnected],
  );

  const cleanupWebSocket = useCallback(() => {
    connectionCount = Math.max(0, connectionCount - 1);

    if (connectionCount <= 0) {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (podcastPollingInterval) {
        clearInterval(podcastPollingInterval);
        podcastPollingInterval = null;
      }
      if (podcastFetchDebounceTimeout) {
        clearTimeout(podcastFetchDebounceTimeout);
        podcastFetchDebounceTimeout = null;
      }
      if (hintTimeout) {
        clearTimeout(hintTimeout);
        hintTimeout = null;
      }
      isPodcastPlaying = false;
      lastPodcastFetch = 0;

      isAttemptingReconnect = false;
      isConnecting = false;

      if (globalWebSocket) {
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }

        globalWebSocket.onclose = null;
        globalWebSocket.onerror = null;
        globalWebSocket.onmessage = null;
        globalWebSocket.onopen = null;

        if (
          globalWebSocket.readyState === WebSocket.OPEN ||
          globalWebSocket.readyState === WebSocket.CONNECTING
        ) {
          try {
            globalWebSocket.close(1000, "Client cleanup");
          } catch (e) {
            /* ignore */
          }
        }
        globalWebSocket = null;
        globalConnectionId = null;
        isInitialized = false;
        connectionErrors = 0;
      }
    }
    webSocketRef.current = null;
  }, [reconnectTimeoutRef]);

  const connectWebSocket = useCallback(async () => {
    if (
      hasInvalidToken ||
      !accessTokenRef.current ||
      (isConnecting &&
        globalWebSocket &&
        globalWebSocket.readyState === WebSocket.CONNECTING) ||
      isAttemptingReconnect ||
      !isNetworkConnected
    ) {
      return;
    }

    isAttemptingReconnect = true;

    try {
      await waitForNetwork();
    } catch (error) {
      isAttemptingReconnect = false;
      return;
    }

    connectionCount++;

    if (globalWebSocket) {
      if (globalWebSocket.readyState === WebSocket.OPEN) {
        webSocketRef.current = globalWebSocket;
        connectionIdRef.current = globalConnectionId;
        if (!initialStateLoadedRef.current) {
          await networkAwareRequest(() => fetchCurrentPlayback());
        }
        isAttemptingReconnect = false;
        return;
      }
      if (globalWebSocket.readyState === WebSocket.CONNECTING) {
        webSocketRef.current = globalWebSocket;
        isAttemptingReconnect = false;
        return;
      }
      globalWebSocket.onopen = null;
      globalWebSocket.onmessage = null;
      globalWebSocket.onerror = null;
      globalWebSocket.onclose = null;
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
      if (
        globalWebSocket.readyState !== WebSocket.CLOSING &&
        globalWebSocket.readyState !== WebSocket.CLOSED
      ) {
        try {
          globalWebSocket.close(1000, "Replacing defunct WebSocket");
        } catch (e) {
          /* ignore */
        }
      }
      globalWebSocket = null;
      globalConnectionId = null;
    }

    if (isConnecting) {
      isAttemptingReconnect = false;
      connectionCount = Math.max(0, connectionCount - 1);
      return;
    }

    isConnecting = true;
    currentAccessToken = accessTokenRef.current;

    try {
      if (!accessTokenRef.current) {
        isConnecting = false;
        isAttemptingReconnect = false;
        connectionCount = Math.max(0, connectionCount - 1);
        return;
      }
      globalWebSocket = new WebSocket(
        `wss://dealer.spotify.com/?access_token=${currentAccessToken}`,
      );
      webSocketRef.current = globalWebSocket;

      globalWebSocket.onopen = () => {
        isConnecting = false;
        isAttemptingReconnect = false;
        connectionErrors = 0;
        isInitialized = true;

        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
        }

        keepAliveInterval = setInterval(() => {
          if (
            globalWebSocket &&
            globalWebSocket.readyState === WebSocket.OPEN
          ) {
            globalWebSocket.send(JSON.stringify({ type: "ping" }));
          } else {
            clearInterval(keepAliveInterval);
            keepAliveInterval = null;
          }
        }, 15000);
      };

      globalWebSocket.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if ("headers" in message && message.headers["Spotify-Connection-Id"]) {
          globalConnectionId = message.headers["Spotify-Connection-Id"];
          connectionIdRef.current = globalConnectionId;

          try {
            const url = `https://api.spotify.com/v1/me/notifications/player?connection_id=${encodeURIComponent(globalConnectionId)}`;
            await networkAwareRequest(() =>
              fetch(url, {
                method: "PUT",
                headers: {
                  Authorization: `Bearer ${currentAccessToken}`,
                  "Content-Type": "application/json",
                },
              }),
            );

            if (!initialStateLoadedRef.current) {
              await networkAwareRequest(() => fetchCurrentPlayback());
            }
          } catch (error) {
            console.error("Error setting up notifications:", error);
            if (error.name === "NetworkError" || !isNetworkConnected) {
              cleanupWebSocket();
            }
          }
        } else if (message.type === "message" && message.payloads) {
          for (const payload of message.payloads) {
            if (payload.events) {
              for (const eventData of payload.events) {
                if (
                  eventData.type === "PLAYER_STATE_CHANGED" &&
                  eventData.event?.state
                ) {
                  const state = eventData.event.state;

                  if (
                    state.currently_playing_type === "episode" &&
                    !state.item
                  ) {
                    const now = Date.now();
                    if (now - lastPodcastFetch > 1000) {
                      lastPodcastFetch = now;
                      fetchCurrentPlayback(true);
                    }
                  }

                  eventSubscribers.forEach((subscriber) => {
                    if (subscriber.onPlaybackState) {
                      subscriber.onPlaybackState(state);
                    }
                  });
                }
              }
            }
          }
        } else if (
          typeof message.uri === "string" &&
          message.uri.startsWith("hm://") &&
          !message.uri.startsWith("hm://pusher/")
        ) {
          // Spotify pushes internal telemetry to every dealer connection with
          // no subscription, which matters because PUT
          // /me/notifications/player answers 401 for app tokens - so
          // PLAYER_STATE_CHANGED never arrives and the branch above is dead.
          //
          // Matching all hm:// traffic rather than just hm://herodotus/: these
          // are base64 protobuf on an internal, unversioned schema, so the only
          // thing worth reading is that a frame arrived at all. Casting wide
          // gives the best chance of catching transitions herodotus misses -
          // notably a bare pause, which emits no play-history event. Excludes
          // hm://pusher/, the connection handshake handled above.
          //
          // Bounded by scheduleHintedRefresh, so extra frames cost nothing.
          // Was a console.log on a hot path; the uri is recorded instead.
          track("player.pushHint", { uri: message.uri.slice(0, 60) });
          scheduleHintedRefresh(() => fetchCurrentPlayback(true));
        }
      };

      globalWebSocket.onerror = (error) => {
        console.error("WebSocket error:", error);
        if (isConnecting) isConnecting = false;
        if (isAttemptingReconnect) isAttemptingReconnect = false;
        connectionErrors += 1;

        if (connectionErrors > maxRetryAttempts) {
          if (
            globalWebSocket &&
            (globalWebSocket.readyState === WebSocket.OPEN ||
              globalWebSocket.readyState === WebSocket.CONNECTING)
          ) {
            try {
              globalWebSocket.close(1008, "Too many errors");
            } catch (e) {
              /*ignore*/
            }
          }
        }
      };

      globalWebSocket.onclose = (event) => {
        const wasGloballyConnecting = isConnecting;
        isConnecting = false;
        isAttemptingReconnect = false;

        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }

        if (connectionCount > 0 && isNetworkConnected) {
          const backoffTime = Math.min(
            1000 *
              Math.pow(
                1.5,
                Math.min(
                  connectionErrors,
                  wasGloballyConnecting
                    ? connectionErrors + 1
                    : connectionErrors,
                ),
              ),
            15000,
          );
          connectionErrors++;

          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }

          reconnectTimeoutRef.current = setTimeout(async () => {
            if (connectionCount > 0 && isNetworkConnected) {
              try {
                await waitForNetwork();
                if (isNetworkConnected) {
                  await fetchCurrentPlayback();
                  connectWebSocket();
                } else {
                  isAttemptingReconnect = false;
                }
              } catch (error) {
                console.error("Failed during pre-reconnect sequence:", error);
                isAttemptingReconnect = false;
                if (connectionCount > 0 && isNetworkConnected) {
                  const nextRetryTime = Math.min(backoffTime * 2, 30000);
                  reconnectTimeoutRef.current = setTimeout(() => {
                    connectWebSocket();
                  }, nextRetryTime);
                }
              }
            } else {
              isAttemptingReconnect = false;
            }
          }, backoffTime);
        } else {
          isAttemptingReconnect = false;
        }
      };
    } catch (error) {
      console.error("Error creating WebSocket:", error);
      isConnecting = false;
      isAttemptingReconnect = false;
      connectionErrors += 1;
      connectionCount = Math.max(0, connectionCount - 1);
      if (globalWebSocket === webSocketRef.current) {
        globalWebSocket = null;
      }
    }
  }, [
    accessTokenRef,
    fetchCurrentPlayback,
    cleanupWebSocket,
    initialStateLoadedRef,
    networkAwareRequest,
    processPlaybackState,
    isNetworkConnected,
  ]);

  useEffect(() => {
    const subscriberId = subscriberIdRef.current;
    eventSubscribers.push({
      id: subscriberId,
      onPlaybackState: processPlaybackState,
    });
    return () => {
      eventSubscribers = eventSubscribers.filter(
        (sub) => sub.id !== subscriberId,
      );
    };
  }, [processPlaybackState]);

  // The socket lifecycle is driven through refs rather than by listing these
  // callbacks as effect dependencies.
  //
  // They are not stable: fetchCurrentPlayback depends on isNetworkConnected
  // (React state from useNetwork) and on resetPlaybackState, which in turn
  // depends on initialFetchInProgress - state that fetchCurrentPlayback itself
  // sets on every call. connectWebSocket then depends on fetchCurrentPlayback,
  // so each fetch produced a new connectWebSocket identity, re-ran the effect
  // below, and its cleanup closed the socket. Because cleanupWebSocket closes
  // sockets in CONNECTING as well as OPEN, the connection was usually killed
  // mid-handshake - the browser reports that as "WebSocket is closed before the
  // connection is established", and the realtime push never starts, even though
  // the dealer endpoint is perfectly healthy.
  //
  // The token is the only thing that should govern this socket's lifetime.
  const connectRef = useRef(connectWebSocket);
  const cleanupRef = useRef(cleanupWebSocket);
  const fetchPlaybackRef = useRef(fetchCurrentPlayback);
  connectRef.current = connectWebSocket;
  cleanupRef.current = cleanupWebSocket;
  fetchPlaybackRef.current = fetchCurrentPlayback;

  useEffect(() => {
    if (!accessToken) {
      cleanupRef.current();
      return;
    }

    connectRef.current();
    if (!initialPlaybackFetchDone) {
      initialPlaybackFetchDone = true;
      fetchPlaybackRef.current(true);
    }

    const handleNetworkRestored = () => {
      if (
        !globalWebSocket ||
        (globalWebSocket.readyState !== WebSocket.OPEN &&
          globalWebSocket.readyState !== WebSocket.CONNECTING)
      ) {
        connectRef.current();
        fetchPlaybackRef.current(true);
      }
    };

    window.addEventListener("online", handleNetworkRestored);
    window.addEventListener("networkRestored", handleNetworkRestored);

    return () => {
      cleanupRef.current();
      window.removeEventListener("online", handleNetworkRestored);
      window.removeEventListener("networkRestored", handleNetworkRestored);
    };
  }, [accessToken]);

  useEffect(() => {
    if (reconnectTimeoutRef.current) {
      return () => {
        clearTimeout(reconnectTimeoutRef.current);
      };
    }
  }, []);

  useEffect(() => {
    if (accessToken && immediateLoad && !initialPlaybackFetchDone) {
      initialPlaybackFetchDone = true;
      fetchCurrentPlayback(true);
    }
  }, [accessToken, immediateLoad, fetchCurrentPlayback]);

  useEffect(() => {
    const handleNetworkRestored = async () => {
      if (
        globalWebSocket &&
        (globalWebSocket.readyState === WebSocket.OPEN ||
          globalWebSocket.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      cleanupRef.current();
      connectionErrors = 0;
      isAttemptingReconnect = false;
      connectRef.current();
      await fetchPlaybackRef.current(true);
    };

    window.addEventListener("networkRestored", handleNetworkRestored);

    return () => {
      window.removeEventListener("networkRestored", handleNetworkRestored);
    };
    // Refs, not deps: see the note above the socket lifecycle effect.
  }, []);

  useEffect(() => {
    const handleAccessTokenUpdate = (event) => {
      const newAccessToken = event.detail.accessToken;
      if (newAccessToken && newAccessToken !== accessTokenRef.current) {
        accessTokenRef.current = newAccessToken;
        hasInvalidToken = false;
        initialPlaybackFetchDone = false;

        if (
          globalWebSocket &&
          (globalWebSocket.readyState === WebSocket.OPEN ||
            globalWebSocket.readyState === WebSocket.CONNECTING)
        ) {
          cleanupRef.current();
          setTimeout(() => {
            connectRef.current();
            fetchPlaybackRef.current(true);
          }, 100);
        } else {
          connectRef.current();
          fetchPlaybackRef.current(true);

          if (!isConnecting && !isAttemptingReconnect) {
            if (
              !globalWebSocket ||
              globalWebSocket.readyState === WebSocket.CLOSED
            ) {
              setTimeout(() => {
                if (
                  !globalWebSocket ||
                  globalWebSocket.readyState !== WebSocket.OPEN
                ) {
                  connectRef.current();
                }
                fetchPlaybackRef.current(true);
              }, 100);
            }
          }
        }
      }
    };

    window.addEventListener("accessTokenUpdated", handleAccessTokenUpdate);

    return () => {
      window.removeEventListener("accessTokenUpdated", handleAccessTokenUpdate);
    };
    // Refs, not deps: see the note above the socket lifecycle effect.
  }, []);

  return {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading,
    error,
    refreshPlaybackState: fetchCurrentPlayback,
  };
}
