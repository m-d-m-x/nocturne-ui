import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import FontLoader from "./components/common/FontLoader";
import AuthContainer from "./components/auth/AuthContainer";
import NetworkScreen from "./components/auth/NetworkScreen";
import Tutorial from "./components/tutorial/Tutorial";
import Home from "./pages/Home";
import ContentView from "./components/content/ContentView";
import NowPlaying from "./components/player/NowPlaying";
import DeviceSwitcherModal from "./components/player/DeviceSwitcherModal";
import NetworkPasswordModal from "./components/common/modals/NetworkPasswordModal";
import ConnectorQRModal from "./components/common/modals/ConnectorQRModal";
import ButtonMappingOverlay from "./components/common/overlays/ButtonMappingOverlay";
import NetworkBanner from "./components/common/overlays/NetworkBanner";
import GradientBackground from "./components/common/GradientBackground";
import NocturneIcon from "./components/common/icons/NocturneIcon";
import { useAuth } from "./hooks/useAuth";
import { useNetwork } from "./hooks/useNetwork";
import { useGradientState } from "./hooks/useGradientState";
import { DeviceSwitcherContext } from "./hooks/useSpotifyPlayerControls";
import {
  useBluetooth,
  useSystemUpdate,
  useNocturneInfo,
  useNocturned,
} from "./hooks/useNocturned";
import { useSpotifyData } from "./hooks/useSpotifyData";
import { useDeviceAttach } from "./hooks/useDeviceAttach";
import { useSpotifySearch } from "./hooks/useSpotifySearch";
import SearchResultsView from "./components/content/SearchResultsView";
import { usePlaybackProgress } from "./hooks/usePlaybackProgress";
import { SettingsProvider } from "./contexts/SettingsContext";
import { ConnectorProvider } from "./contexts/ConnectorContext";
import React from "react";
import {
  NotificationProvider,
  useNotifications,
} from "./contexts/NotificationContext";
import NotificationsContainer from "./components/common/notifications/NotificationsContainer";
import PairingScreen from "./components/auth/PairingScreen";
import LockView from "./components/common/LockView";
import LoadingScreen from "./components/common/LoadingScreen";
import PowerMenuOverlay from "./components/common/overlays/PowerMenuOverlay";
import ListeningOverlay from "./components/common/overlays/ListeningOverlay";
import WakeWordArmer from "./components/common/WakeWordArmer";
import { CheckIcon } from "./components/common/icons";
import { SettingsUpdateIcon } from "./components/common/icons";
import UpdateCheckNotification from "./components/common/notifications/UpdateCheckNotification";
import UpdateScreen from "./components/common/UpdateScreen";

export const NetworkContext = React.createContext({
  selectedNetwork: null,
  setSelectedNetwork: () => {},
});

export const ConnectorContext = React.createContext({
  showConnectorModal: false,
  setShowConnectorModal: () => {},
});

function useGlobalButtonMapping({
  accessToken,
  isAuthenticated,
  playTrack,
  playDJMix,
  refreshPlaybackState,
  setActiveSection,
  isTutorialActive,
  isDisabled = false,
  setListeningOverlayVisible,
}) {
  const [showMappingOverlay, setShowMappingOverlay] = useState(false);
  const [activeButton, setActiveButton] = useState(null);
  const [isProcessingButtonPress, setIsProcessingButtonPress] = useState(false);
  const ignoreNextReleaseRef = useRef(false);
  const shouldRenderRef = useRef(true);

  const handleButtonPress = useCallback(
    async (buttonNumber) => {
      if (
        !accessToken ||
        !isAuthenticated ||
        isProcessingButtonPress ||
        isTutorialActive ||
        isDisabled
      )
        return;

      const mappedId = localStorage.getItem(`button${buttonNumber}Id`);
      const mappedType = localStorage.getItem(`button${buttonNumber}Type`);

      if (!mappedId || !mappedType) return;

      setIsProcessingButtonPress(true);
      setActiveButton(buttonNumber);
      setShowMappingOverlay(true);

      let contextUri = null;
      let uris = null;

      try {
        if (mappedType === "album") {
          contextUri = `spotify:album:${mappedId}`;
        } else if (mappedType === "playlist") {
          contextUri = `spotify:playlist:${mappedId}`;
        } else if (mappedType === "artist") {
          const response = await fetch(
            `https://api.spotify.com/v1/artists/${mappedId}/top-tracks?market=from_token`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
          );

          if (response.ok) {
            const data = await response.json();
            if (data.tracks && data.tracks.length > 0) {
              uris = data.tracks.map((track) => track.uri);
            }
          } else {
            contextUri = `spotify:artist:${mappedId}`;
          }
        } else if (mappedType === "show") {
          const response = await fetch(
            `https://api.spotify.com/v1/shows/${mappedId}/episodes?limit=50`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
          );

          if (response.ok) {
            const data = await response.json();
            if (data.items && data.items.length > 0) {
              const lastPlayedEpisodeId = localStorage.getItem(
                `lastPlayedEpisode_${mappedId}`,
              );
              let targetEpisodeIndex = 0;

              if (lastPlayedEpisodeId) {
                const foundIndex = data.items.findIndex(
                  (ep) => ep.id === lastPlayedEpisodeId,
                );
                if (foundIndex !== -1) {
                  targetEpisodeIndex = foundIndex;
                }
              }

              contextUri = `spotify:show:${mappedId}`;
              uris = [`spotify:episode:${data.items[targetEpisodeIndex].id}`];
            }
          } else {
            contextUri = `spotify:show:${mappedId}`;
          }
        } else if (mappedType === "mix") {
          const mixTracksJson = localStorage.getItem(
            `button${buttonNumber}Tracks`,
          );
          if (mixTracksJson) {
            try {
              const mixTracks = JSON.parse(mixTracksJson);
              uris = mixTracks;
              localStorage.setItem("currentPlayingMixId", mappedId);
            } catch (e) {
              console.error("Error parsing mix tracks:", e);
            }
          }
        } else if (mappedType === "liked-songs") {
          const likedTracksJson = localStorage.getItem(
            `button${buttonNumber}Tracks`,
          );
          if (likedTracksJson) {
            try {
              const likedTracks = JSON.parse(likedTracksJson);
              uris = likedTracks;
              localStorage.setItem("playingLikedSongs", "true");
            } catch (e) {
              console.error("Error parsing liked tracks:", e);

              const response = await fetch(
                "https://api.spotify.com/v1/me/tracks?limit=50",
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                },
              );

              if (response.ok) {
                const data = await response.json();
                if (data.items && data.items.length > 0) {
                  uris = data.items.map((item) => item.track.uri);
                  localStorage.setItem("playingLikedSongs", "true");
                }
              }
            }
          } else {
            const response = await fetch(
              "https://api.spotify.com/v1/me/tracks?limit=50",
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              },
            );

            if (response.ok) {
              const data = await response.json();
              if (data.items && data.items.length > 0) {
                uris = data.items.map((item) => item.track.uri);
                localStorage.setItem("playingLikedSongs", "true");
              }
            }
          }
        }

        let success = false;
        const DJ_PLAYLIST_ID = "37i9dQZF1EYkqdzj48dyYq";

        if (mappedType === "playlist" && mappedId === DJ_PLAYLIST_ID) {
          success = await (playDJMix
            ? playDJMix()
            : playTrack(null, contextUri));
        } else if (contextUri) {
          success = await playTrack(null, contextUri);
        } else if (uris && uris.length > 0) {
          success = await playTrack(null, null, uris);
        }

        if (success) {
          setTimeout(() => {
            refreshPlaybackState();
            setActiveSection("nowPlaying");
          }, 500);
        }

        setTimeout(() => {
          setShowMappingOverlay(false);
          setActiveButton(null);
          setIsProcessingButtonPress(false);
        }, 1500);
      } catch (error) {
        console.error("Error playing mapped content:", error);
        setShowMappingOverlay(false);
        setActiveButton(null);
        setIsProcessingButtonPress(false);
      }
    },
    [
      accessToken,
      isAuthenticated,
      playTrack,
      playDJMix,
      refreshPlaybackState,
      setActiveSection,
      isProcessingButtonPress,
      isTutorialActive,
      isDisabled,
    ],
  );

  // These listeners must stay registered across re-renders. They used to be
  // torn down whenever handleButtonPress changed identity or isDisabled
  // flipped, and because the long-press timer lived inside the effect, the
  // teardown cancelled any hold in progress. App re-renders roughly once a
  // second while playback progresses, so a dial hold on Now Playing had a good
  // chance of being cancelled before it reached 675ms. The effect now depends
  // only on things that genuinely change who may use the dial; everything else
  // is read through refs at dispatch time.
  const isDisabledRef = useRef(isDisabled);
  const handleButtonPressRef = useRef(handleButtonPress);
  useEffect(() => {
    isDisabledRef.current = isDisabled;
    handleButtonPressRef.current = handleButtonPress;
  });

  const extraLongPressTimerRef = useRef(null);
  const extraLongPressFiredRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || isTutorialActive) return;

    // In dev, use V so Enter works normally in the browser during testing.
    // In production (on-device) Enter = dial press.
    const VOICE_KEY = import.meta.env.DEV ? "v" : "Enter";

    const handleKeyDown = (e) => {
      // Power menu / update screen / an in-flight voice session own the dial.
      if (isDisabledRef.current) return;

      if (e.key === VOICE_KEY) {
        if (e.__nocturneSynthetic) return;
        if (e.repeat) return;

        if (!extraLongPressTimerRef.current) {
          e.stopImmediatePropagation();
          e.preventDefault();

          extraLongPressFiredRef.current = false;
          extraLongPressTimerRef.current = setTimeout(() => {
            extraLongPressFiredRef.current = true;
            extraLongPressTimerRef.current = null;
            setWakeSessionActive(false);
            setListeningOverlayVisible(true);
          }, 675);
        }
        return;
      }

      if (!["1", "2", "3", "4"].includes(e.key)) return;

      e.stopImmediatePropagation();
      e.preventDefault();
    };

    const handleKeyUp = (e) => {
      if (isDisabledRef.current) return;

      if (e.key === VOICE_KEY) {
        if (e.__nocturneSynthetic) return;

        if (extraLongPressTimerRef.current) {
          clearTimeout(extraLongPressTimerRef.current);
          extraLongPressTimerRef.current = null;

          const kd = new KeyboardEvent("keydown", {
            key: VOICE_KEY,
            bubbles: true,
            cancelable: true,
          });
          Object.defineProperty(kd, "__nocturneSynthetic", { value: true });

          const ku = new KeyboardEvent("keyup", {
            key: VOICE_KEY,
            bubbles: true,
            cancelable: true,
          });
          Object.defineProperty(ku, "__nocturneSynthetic", { value: true });

          document.dispatchEvent(kd);
          document.dispatchEvent(ku);
        } else if (extraLongPressFiredRef.current) {
          // Releasing the dial only ends the activation gesture. The recording
          // keeps running until nocturned's silence detector stops it, so we
          // deliberately do not close the overlay or stop capture here.
          extraLongPressFiredRef.current = false;
        }

        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }

      // 1-4 keyup: existing behavior
      const validButtons = ["1", "2", "3", "4"];
      const buttonNumber = e.key;

      if (!validButtons.includes(buttonNumber)) return;

      if (ignoreNextReleaseRef.current) {
        ignoreNextReleaseRef.current = false;
        return;
      }

      handleButtonPressRef.current?.(buttonNumber);
      e.stopImmediatePropagation();
      e.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      if (extraLongPressTimerRef.current) {
        clearTimeout(extraLongPressTimerRef.current);
        extraLongPressTimerRef.current = null;
      }
    };
  }, [isAuthenticated, isTutorialActive]);

  const setIgnoreNextRelease = useCallback(() => {
    ignoreNextReleaseRef.current = true;
  }, []);

  return {
    showMappingOverlay: isDisabled ? false : showMappingOverlay,
    activeButton,
    setIgnoreNextRelease,
  };
}

function NotificationEffects({
  isUpdating,
  updateStatus,
  activeSection,
  handleReboot,
  isAuthenticated,
  isError,
  errorMessage,
}) {
  const { addNotification, removeNotification } = useNotifications();
  const notificationShownRef = useRef(false);
  const lastErrorMessageRef = useRef(null);

  useEffect(() => {
    if (
      !isUpdating &&
      updateStatus.stage === "complete" &&
      activeSection !== "settings" &&
      !notificationShownRef.current
    ) {
      notificationShownRef.current = true;
      addNotification({
        icon: SettingsUpdateIcon,
        title: "Update installed",
        description: "Nocturne was updated successfully. Restart to apply.",
        action: { label: "Restart", onPress: handleReboot },
      });
    }
  }, [
    isUpdating,
    updateStatus.stage,
    activeSection,
    addNotification,
    handleReboot,
  ]);

  const logoutNotificationIdRef = useRef(null);

  useEffect(() => {
    const handler = () => {
      const id = addNotification({
        title: "Signed out",
        description: "Your session expired. Please sign in again.",
      });
      logoutNotificationIdRef.current = id;
    };
    window.addEventListener("userLoggedOut", handler);
    return () => window.removeEventListener("userLoggedOut", handler);
  }, [addNotification]);

  useEffect(() => {
    if (isAuthenticated && logoutNotificationIdRef.current) {
      removeNotification(logoutNotificationIdRef.current);
      logoutNotificationIdRef.current = null;
    }
  }, [isAuthenticated, removeNotification]);

  useEffect(() => {
    if (isError && errorMessage) {
      if (lastErrorMessageRef.current !== errorMessage) {
        lastErrorMessageRef.current = errorMessage;
        addNotification({
          icon: SettingsUpdateIcon,
          title: "Update failed",
          description: errorMessage,
        });
      }
    } else if (!isError) {
      lastErrorMessageRef.current = null;
    }
  }, [isError, errorMessage, addNotification]);

  return null;
}

function TokenRefreshOverlay({ show }) {
  const [gradientState, updateGradientColors] = useGradientState();
  useEffect(() => {
    if (show) {
      updateGradientColors(null, "auth");
    }
  }, [show, updateGradientColors]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden rounded-2xl">
      <div className="absolute inset-0 bg-black" />
      <GradientBackground gradientState={gradientState} />
      <div className="relative z-10 flex flex-col items-center justify-center">
        <NocturneIcon className="h-12 w-auto animate-pulse" />
      </div>
    </div>
  );
}

function App() {
  const [showTutorial, setShowTutorial] = useState(false);
  const [currentTutorialStep, setCurrentTutorialStep] = useState(0);
  const [activeSection, setActiveSection] = useState("recents");
  const previousSectionRef = useRef("recents");
  const activeSectionRef = useRef(activeSection);

  useEffect(() => {
    activeSectionRef.current = activeSection;
    if (activeSection !== "lock") {
      previousSectionRef.current = activeSection;
    }
  }, [activeSection]);
  const [viewingContent, setViewingContent] = useState(null);
  const [contentSourceSection, setContentSourceSection] = useState(null);
  const [isDeviceSwitcherOpen, setIsDeviceSwitcherOpen] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [showConnectorModal, setShowConnectorModal] = useState(false);
  const [playbackIntentOnDeviceSwitch, setPlaybackIntentOnDeviceSwitch] =
    useState(null);
  const [prefetchedDevices, setPrefetchedDevices] = useState(null);
  const [showLoader, setShowLoader] = useState(true);
  const [initialTokenRefreshDone, setInitialTokenRefreshDone] = useState(false);
  const [powerMenuVisible, setPowerMenuVisible] = useState(false);
  const [listeningOverlayVisible, setListeningOverlayVisible] = useState(false);
  // True when the current overlay was opened by the wake word, meaning
  // nocturned already has a capture running and the overlay must attach to it
  // rather than starting its own.
  const [wakeSessionActive, setWakeSessionActive] = useState(false);
  const {
    results: searchResults,
    loading: searchLoading,
    error: searchError,
    searchSpotify,
  } = useSpotifySearch();
  const { tokenReady } = useAuth();

  useEffect(() => {
    if (tokenReady && !initialTokenRefreshDone) {
      setInitialTokenRefreshDone(true);
    }
  }, [tokenReady, initialTokenRefreshDone]);
  const powerMenuVisibleRef = useRef(false);
  // Populated below, once handleOpenDeviceSwitcher exists. useSpotifyData runs
  // above the DeviceSwitcherContext.Provider, so this is how its player
  // controls reach the real handler.
  const openDeviceSwitcherRef = useRef(null);

  useEffect(() => {
    powerMenuVisibleRef.current = powerMenuVisible;
  }, [powerMenuVisible]);

  const {
    isAuthenticated,
    accessToken,
    authIsLoading,
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    playerIsLoading,
    playerError,
    refreshPlaybackState,
    playerControls,
    recentAlbums,
    userPlaylists,
    topArtists,
    likedSongs,
    radioMixes,
    userShows,
    savedEpisodes,
    initialDataLoaded,
    isLoading,
    errors: dataErrors,
    refreshData,
    refreshRecentlyPlayed,
  } = useSpotifyData(
    activeSection,
    showLoader || !tokenReady,
    tokenReady && !showLoader,
    openDeviceSwitcherRef,
  );

  const {
    isConnected: isInternetConnected,
    showNetworkBanner,
    initialCheckDone,
    initialConnectionFailed,
    hasEverConnectedThisSession,
  } = useNetwork();

  const {
    version: nocturneVersion,
    serial,
    isLoading: isInfoLoading,
    refetch: refetchInfo,
  } = useNocturneInfo();

  const [analyticsEnabled, setAnalyticsEnabled] = useState(
    () => localStorage.getItem("analyticsEnabled") !== "false",
  );

  useEffect(() => {
    const handleStorageChange = () => {
      setAnalyticsEnabled(localStorage.getItem("analyticsEnabled") !== "false");
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--text-scale",
      localStorage.getItem("textSize") ?? "1",
    );
  }, []);

  useEffect(() => {
    if (showLoader) return;
    if (!isInternetConnected) return;
    if (isInfoLoading) return;
    if (!serial) return;

    const existing = document.getElementById("analytics");

    if (!analyticsEnabled) {
      if (existing) {
        existing.remove();
      }
      return;
    }

    if (existing) return;

    window.umamiBeforeSend = (type, payload) => {
      if (!payload) return false;
      return { ...payload, id: serial };
    };
  }, [
    showLoader,
    isInternetConnected,
    isInfoLoading,
    serial,
    analyticsEnabled,
  ]);

  const {
    pairingRequest,
    isConnecting,
    showTetheringScreen,
    lastConnectedDevice,
    acceptPairing,
    denyPairing,
    setDiscoverable,
    disconnectDevice,
    enableNetworking,
    stopRetrying,
  } = useBluetooth();

  const { updateStatus, progress, isUpdating, isError, errorMessage } =
    useSystemUpdate();

  // Shares the global socket with the other nocturned hooks; both callbacks are
  // stable, so the wake listener registers once rather than on every render.
  const { addMessageListener, removeMessageListener } = useNocturned();

  // On a cold boot the phone is often not advertising itself yet, so the head
  // unit has nothing to control until something wakes Spotify on the phone.
  useDeviceAttach({ accessToken, isAuthenticated });

  const [gradientState, updateGradientColors] = useGradientState(activeSection);

  const playbackProgress = usePlaybackProgress(
    currentPlayback,
    refreshPlaybackState,
    accessToken,
  );

  const {
    showMappingOverlay: showGlobalMappingOverlay,
    activeButton: globalActiveButton,
    setIgnoreNextRelease,
  } = useGlobalButtonMapping({
    accessToken,
    isAuthenticated,
    playTrack: playerControls.playTrack,
    playDJMix: playerControls.playDJMix,
    refreshPlaybackState,
    setActiveSection,
    isTutorialActive: showTutorial,
    // While the listening overlay is up the recording runs to completion on its
    // own, so the hardware buttons must go dead - otherwise a second dial press
    // would synthesize a play/pause toggle in the middle of a voice command.
    isDisabled: powerMenuVisible || isUpdating || listeningOverlayVisible,
    setListeningOverlayVisible,
  });

  const handleOpenDeviceSwitcher = useCallback(
    (playbackIntentOrDevices = null, devicesArg = null) => {
      let playbackIntent = null;
      let devicesList = null;

      if (Array.isArray(playbackIntentOrDevices)) {
        devicesList = playbackIntentOrDevices;
      } else {
        playbackIntent = playbackIntentOrDevices;
        devicesList = devicesArg;
      }

      if (playbackIntent) {
        setPlaybackIntentOnDeviceSwitch(playbackIntent);
      }

      if (devicesList && devicesList.length > 0) {
        setPrefetchedDevices(devicesList);
      }

      setIsDeviceSwitcherOpen(true);
    },
    [],
  );

  const handleCloseDeviceSwitcher = (selectedDeviceId = null) => {
    setIsDeviceSwitcherOpen(false);
    setPrefetchedDevices(null);
    if (selectedDeviceId && playbackIntentOnDeviceSwitch) {
      const { trackUriToPlay, contextUriToPlay, urisToPlay } =
        playbackIntentOnDeviceSwitch;
      (async () => {
        let success = false;
        if (contextUriToPlay) {
          success = await playerControls.playTrack(
            trackUriToPlay,
            contextUriToPlay,
            null,
            selectedDeviceId,
          );
        } else if (urisToPlay && urisToPlay.length > 0) {
          success = await playerControls.playTrack(
            null,
            null,
            urisToPlay,
            selectedDeviceId,
          );
        } else if (trackUriToPlay) {
          success = await playerControls.playTrack(
            trackUriToPlay,
            null,
            null,
            selectedDeviceId,
          );
        }

        if (success) {
          setTimeout(() => {
            refreshPlaybackState();
            setActiveSection("nowPlaying");
          }, 1500);
        }
        setPlaybackIntentOnDeviceSwitch(null);
      })();
    } else {
      setPlaybackIntentOnDeviceSwitch(null);
    }
  };

  useEffect(() => {
    openDeviceSwitcherRef.current = handleOpenDeviceSwitcher;
  });

  // A fresh object here hands every consumer inside the provider a new
  // openDeviceSwitcher on each render, which cascades into new playTrack and
  // handleButtonPress callbacks app-wide.
  const deviceSwitcherContextValue = useMemo(
    () => ({ openDeviceSwitcher: handleOpenDeviceSwitcher }),
    [handleOpenDeviceSwitcher],
  );

  const handleNetworkClose = () => {
    setSelectedNetwork(null);
  };

  const networkContextValue = {
    selectedNetwork,
    setSelectedNetwork,
  };

  const connectorContextValue = {
    showConnectorModal,
    setShowConnectorModal,
  };

  useEffect(() => {
    if (isAuthenticated) {
      const handleNetworkRestored = () => {
        refreshPlaybackState(true);
        if (!initialDataLoaded) {
          refreshData();
          refreshRecentlyPlayed();
        }
      };
      window.addEventListener("online", handleNetworkRestored);
      return () => {
        window.removeEventListener("online", handleNetworkRestored);
      };
    }
  }, [
    isAuthenticated,
    refreshPlaybackState,
    refreshData,
    refreshRecentlyPlayed,
    initialDataLoaded,
  ]);

  useEffect(() => {
    if (isAuthenticated) {
      const hasSeenTutorial =
        localStorage.getItem("hasSeenTutorial") === "true";
      if (hasSeenTutorial) {
        setShowTutorial(false);
        const shouldStartWithNowPlaying =
          localStorage.getItem("startWithNowPlaying") === "true";
        if (shouldStartWithNowPlaying) {
          setActiveSection("nowPlaying");
        }
      } else {
        setShowTutorial(true);
      }
    }
  }, [isAuthenticated, setActiveSection]);

  useEffect(() => {
    if (viewingContent) return;
    if (showTutorial) {
      updateGradientColors(null, "auth");
    } else if (activeSection === "recents" && recentAlbums.length > 0) {
      const firstAlbumImage = recentAlbums[0]?.images?.[1]?.url;
      if (firstAlbumImage) {
        updateGradientColors(firstAlbumImage, "recents");
      }
    } else if (activeSection === "library" && userPlaylists.length > 0) {
      updateGradientColors(null, "library");
    } else if (activeSection === "artists" && topArtists.length > 0) {
      const firstArtistImage = topArtists[0]?.images?.[1]?.url;
      if (firstArtistImage) {
        updateGradientColors(firstArtistImage, "artists");
      }
    } else if (activeSection === "radio") {
      updateGradientColors(null, "radio");
    } else if (activeSection === "settings") {
      updateGradientColors(null, "settings");
    } else if (activeSection === "nowPlaying" && currentlyPlayingAlbum) {
      const albumImage = currentlyPlayingAlbum?.images?.[1]?.url;
      if (albumImage) {
        updateGradientColors(albumImage, "nowPlaying");
      }
    } else if (activeSection === "lock") {
      const albumImage = currentlyPlayingAlbum?.images?.[1]?.url;
      if (albumImage) {
        updateGradientColors(albumImage, "lock");
      }
    }
  }, [
    activeSection,
    viewingContent,
    updateGradientColors,
    recentAlbums,
    userPlaylists,
    topArtists,
    currentlyPlayingAlbum,
    showTutorial,
  ]);

  useEffect(() => {
    if (lastConnectedDevice && isInternetConnected) {
      setDiscoverable(false);
    } else {
      setDiscoverable(true);
    }
  }, [lastConnectedDevice, isInternetConnected, setDiscoverable]);

  useEffect(() => {
    if (showTetheringScreen) {
      enableNetworking();
    }
  }, [showTetheringScreen, enableNetworking]);

  useEffect(() => {
    if (showTutorial) return;

    if (viewingContent) return;

    if (currentlyPlayingAlbum?.images?.[1]?.url) {
      if (activeSection === "nowPlaying") {
        updateGradientColors(currentlyPlayingAlbum.images[1].url, "nowPlaying");
      } else if (activeSection === "recents") {
        updateGradientColors(currentlyPlayingAlbum.images[1].url, "recents");
      }
    } else if (currentlyPlayingAlbum?.type === "local-track") {
      if (activeSection === "recents" || activeSection === "nowPlaying") {
        updateGradientColors("/images/not-playing.webp", activeSection);
      }
    }
  }, [
    currentlyPlayingAlbum,
    activeSection,
    updateGradientColors,
    showTutorial,
    viewingContent,
  ]);

  useEffect(() => {
    const holdTimerRef = { current: null };
    const longPressTriggeredRef = { current: false };

    const handleKeyDown = (e) => {
      if (!e.key || e.key.toLowerCase() !== "m") return;

      if (powerMenuVisibleRef.current) return;

      if (longPressTriggeredRef.current) return;

      if (showTutorial && currentTutorialStep === 7) {
        return;
      }

      if (!holdTimerRef.current) {
        holdTimerRef.current = setTimeout(() => {
          longPressTriggeredRef.current = true;
          setListeningOverlayVisible(false);
          setPowerMenuVisible(true);
          holdTimerRef.current = null;
        }, 600);
      }
    };

    const handleKeyUp = (e) => {
      if (!e.key || e.key.toLowerCase() !== "m") return;

      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }

      if (longPressTriggeredRef.current) {
        longPressTriggeredRef.current = false;
        return;
      }

      if (powerMenuVisibleRef.current) {
        setPowerMenuVisible(false);
        return;
      }

      if (activeSectionRef.current === "lock") {
        const target = previousSectionRef.current || "recents";
        setActiveSection(target);
        activeSectionRef.current = target;
      } else {
        previousSectionRef.current = activeSectionRef.current;
        setListeningOverlayVisible(false);
        setActiveSection("lock");
        activeSectionRef.current = "lock";
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, [showTutorial, currentTutorialStep]);

  const handleShutdown = () => {
    fetch("http://localhost:5000/device/power/shutdown", {
      method: "POST",
    }).catch((err) => console.error("Shutdown request failed", err));
    setPowerMenuVisible(false);
  };

  const handleReboot = () => {
    fetch("http://localhost:5000/device/power/reboot", {
      method: "POST",
    }).catch((err) => console.error("Restart request failed", err));
    setPowerMenuVisible(false);
  };

  const handleAuthSuccess = () => {
    const storedAccessToken = localStorage.getItem("spotifyAccessToken");
    const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");
    const storedExpiry = localStorage.getItem("spotifyTokenExpiry");
    const isTokenValid = storedExpiry && new Date(storedExpiry) > new Date();

    if (storedAccessToken && storedRefreshToken && isTokenValid) {
      if (initialDataLoaded) {
        console.log("Refreshing data after auth success");
        refreshData();
      } else {
        console.log(
          "Skipping refresh - letting initial data load handle the fetch",
        );
      }
    } else {
      console.warn("No valid tokens found after auth success");
    }
  };

  const handleTutorialComplete = () => {
    setShowTutorial(false);
    setCurrentTutorialStep(0);
    localStorage.setItem("hasSeenTutorial", "true");
    const shouldStartWithNowPlaying =
      localStorage.getItem("startWithNowPlaying") === "true";
    if (shouldStartWithNowPlaying) {
      setActiveSection("nowPlaying");
    } else {
      setActiveSection("recents");
    }
  };

  const handleOpenContent = (id, type) => {
    setContentSourceSection(activeSection);
    setViewingContent({ id, type });
    if (type === "artist") {
      setActiveSection("artists");
    } else if (type === "album") {
      setActiveSection("recents");
    }
  };

  const handleNavigateToArtistFromNowPlaying = (artistId, contentType) => {
    setContentSourceSection("nowPlaying");
    setViewingContent({ id: artistId, type: contentType });
    setActiveSection("artists");
  };

  const handleNavigateToAlbumFromNowPlaying = (albumId, contentType) => {
    setContentSourceSection("nowPlaying");
    setViewingContent({ id: albumId, type: contentType });
    setActiveSection("recents");
  };

  const handleCloseSearch = useCallback(() => {
    setViewingContent(null);
    setActiveSection(contentSourceSection || "recents");
    setContentSourceSection(null);
  }, [contentSourceSection]);

  const handleCloseContent = () => {
    const source = contentSourceSection;
    setViewingContent(null);
    setContentSourceSection(null);

    if (source) {
      setActiveSection(source);
    }
  };

  const handleNavigateToNowPlaying = () => {
    setViewingContent(null);
    setActiveSection("nowPlaying");
  };

  /**
   * Play the best hit from a search, walking buckets in priority order so
   * "play artist bob dylan" starts the artist rather than a same-named track.
   * Returns false when nothing was playable, or when playTrack deferred to the
   * device switcher - in both cases the caller decides what to show instead.
   */
  const playTopMatch = useCallback(
    async (results, priority) => {
      const target = {
        artist: () =>
          results.artists?.[0] && {
            contextUri: `spotify:artist:${results.artists[0].id}`,
          },
        album: () =>
          results.albums?.[0] && {
            contextUri: `spotify:album:${results.albums[0].id}`,
          },
        playlist: () =>
          results.playlists?.[0] && {
            contextUri: `spotify:playlist:${results.playlists[0].id}`,
          },
        track: () => results.tracks?.[0] && { trackUri: results.tracks[0].uri },
      };

      for (const type of priority || []) {
        const hit = target[type]?.();
        if (!hit) continue;

        console.log("[voice] playing top", type, "match");
        try {
          const ok = await playerControls.playTrack(
            hit.trackUri || null,
            hit.contextUri || null,
          );
          if (ok === false) return true; // device switcher took over
          setTimeout(() => refreshPlaybackState(), 500);
          return true;
        } catch (err) {
          console.warn("[voice] playback failed for", type, err?.message);
          return false;
        }
      }
      return false;
    },
    [playerControls, refreshPlaybackState],
  );

  const handleListeningClose = useCallback(() => {
    setWakeSessionActive(false);
    setListeningOverlayVisible(false);
  }, []);

  // "Hey Spotify" is detected by nocturned, not here: it opens the capture the
  // instant the phrase ends and then broadcasts this event. Showing the overlay
  // is all that is left to do, and it has to mark the session as already
  // running so the overlay attaches instead of starting a second capture.
  //
  // Registered at App level rather than inside the overlay because the overlay
  // is not mounted until this fires.
  useEffect(() => {
    if (!isAuthenticated) return;

    const id = addMessageListener("wake-word", (data) => {
      if (data?.type !== "voice_state") return;
      if (data.payload?.state !== "wake") return;

      console.log(
        "[voice] wake word detected",
        `score=${(data.payload.score ?? 0).toFixed(3)}`,
      );
      setWakeSessionActive(true);
      setListeningOverlayVisible(true);
    });

    return () => removeMessageListener(id);
  }, [isAuthenticated, addMessageListener, removeMessageListener]);

  // Liked Songs is a library collection, not a playlist: it has no context URI
  // the play endpoint accepts, so it is played as an explicit list of track
  // URIs - the same approach the preset buttons use.
  const playLikedSongs = useCallback(async () => {
    try {
      const response = await fetch(
        "https://api.spotify.com/v1/me/tracks?limit=50",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) {
        console.error("[voice] liked songs fetch failed:", response.status);
        return false;
      }
      const data = await response.json();
      const uris = (data.items || [])
        .map((item) => item?.track?.uri)
        .filter(Boolean);
      if (!uris.length) return false;

      const ok = await playerControls.playTrack(null, null, uris);
      if (ok) localStorage.setItem("playingLikedSongs", "true");
      return ok;
    } catch (err) {
      console.error("[voice] could not play liked songs:", err);
      return false;
    }
  }, [accessToken, playerControls]);

  // Spotify's /me/player lags a control call by a beat, so one immediate read
  // usually still returns the previous state. Two staged reads cover it without
  // introducing a polling loop, and they only happen on an explicit command.
  const refreshAfterCommand = useCallback(() => {
    setTimeout(() => refreshPlaybackState(), 600);
    setTimeout(() => refreshPlaybackState(), 2000);
  }, [refreshPlaybackState]);

  const handleVoiceCommand = useCallback(
    async (intent) => {
      switch (intent.type) {
        case "pause":
          await playerControls.pausePlayback();
          refreshAfterCommand();
          break;
        case "resume":
          await playerControls.playTrack(null);
          refreshAfterCommand();
          break;
        case "skip":
          await playerControls.skipToNext();
          refreshAfterCommand();
          break;
        case "previous":
          await playerControls.skipToPrevious();
          refreshAfterCommand();
          break;
        case "volume_up":
          await playerControls.setVolume(
            Math.min(100, playerControls.volume + 15),
          );
          break;
        case "volume_down":
          await playerControls.setVolume(
            Math.max(0, playerControls.volume - 15),
          );
          break;
        case "volume_set":
          if (typeof intent.args?.level === "number") {
            await playerControls.setVolume(intent.args.level);
          }
          break;
        case "liked":
          // If the library is empty or playback refuses, fall through to the
          // search screen rather than leaving the command with no effect.
          if (await playLikedSongs()) {
            refreshAfterCommand();
          } else {
            setActiveSection("library");
          }
          break;
        default: {
          const { query = "", spotifyQuery, types } = intent.args || {};
          if (!query) break;

          setContentSourceSection(activeSection);
          setViewingContent(null);

          const results = await searchSpotify(query, { spotifyQuery, types });
          const order = results?.priority || types;

          // Try to act on the command directly; only fall back to showing the
          // search screen if there is nothing to play or playback refused.
          if (results && (await playTopMatch(results, order))) {
            refreshAfterCommand();
            break;
          }

          setActiveSection("search");
          break;
        }
      }
    },
    [
      playerControls,
      activeSection,
      searchSpotify,
      refreshPlaybackState,
      playTopMatch,
      playLikedSongs,
      refreshAfterCommand,
    ],
  );

  const handleNavigateToArtist = (id, type) => {
    setViewingContent({ id, type });
    setActiveSection("artists");
  };

  const handleNetworkCancel = () => {
    if (lastConnectedDevice) {
      disconnectDevice(lastConnectedDevice.address);
    }
  };

  const handleConnectionRestored = () => {
    refreshPlaybackState(true);
    if (!initialDataLoaded) {
      refreshData();
      refreshRecentlyPlayed();
    }
  };

  const isUpdateScreenVisible =
    isUpdating || (updateStatus.stage && updateStatus.stage !== "");

  const showConnectionLostScreen =
    initialCheckDone &&
    !isUpdateScreenVisible &&
    !pairingRequest &&
    !showTetheringScreen &&
    ((initialConnectionFailed &&
      !isInternetConnected &&
      !hasEverConnectedThisSession) ||
      (!hasEverConnectedThisSession && !isInternetConnected));

  const displayNetworkBanner =
    initialCheckDone &&
    !showConnectionLostScreen &&
    !pairingRequest &&
    !isUpdating &&
    updateStatus.stage !== "download" &&
    updateStatus.stage !== "flash" &&
    showNetworkBanner &&
    hasEverConnectedThisSession;

  let content;
  if (showLoader) {
    content = null;
  } else if (authIsLoading && !initialCheckDone) {
    content = null;
  } else if (isUpdateScreenVisible) {
    content = <UpdateScreen />;
  } else if (
    !isInternetConnected &&
    !hasEverConnectedThisSession &&
    initialCheckDone
  ) {
    content = (
      <NetworkScreen
        isConnectionLost={true}
        onConnectionRestored={handleConnectionRestored}
      />
    );
  } else if (showConnectionLostScreen) {
    content = (
      <NetworkScreen
        isConnectionLost={true}
        deviceName={lastConnectedDevice?.name}
        onConnectionRestored={handleConnectionRestored}
      />
    );
  } else if (!isAuthenticated && initialCheckDone) {
    content = <AuthContainer onAuthSuccess={handleAuthSuccess} />;
  } else if (showTutorial) {
    content = (
      <Tutorial
        onComplete={handleTutorialComplete}
        onStepChange={setCurrentTutorialStep}
      />
    );
  } else if (activeSection === "nowPlaying") {
    content = (
      <NowPlaying
        accessToken={accessToken}
        currentPlayback={currentPlayback}
        playbackProgress={playbackProgress}
        onClose={() => setActiveSection("recents")}
        updateGradientColors={updateGradientColors}
        onOpenDeviceSwitcher={handleOpenDeviceSwitcher}
        onNavigateToArtist={handleNavigateToArtistFromNowPlaying}
        onNavigateToAlbum={handleNavigateToAlbumFromNowPlaying}
        setIgnoreNextRelease={setIgnoreNextRelease}
      />
    );
  } else if (activeSection === "lock") {
    content = (
      <LockView
        currentPlayback={currentPlayback}
        refreshPlaybackState={refreshPlaybackState}
        onClose={() => setActiveSection("recents")}
      />
    );
  } else if (activeSection === "search") {
    content = (
      <SearchResultsView
        accessToken={accessToken}
        results={searchResults}
        loading={searchLoading}
        error={searchError}
        onOpenContent={(arg) => handleOpenContent(arg.id, arg.type)}
        onClose={handleCloseSearch}
      />
    );
  } else if (viewingContent) {
    content = (
      <ContentView
        accessToken={accessToken}
        contentId={viewingContent.id}
        contentType={viewingContent.type}
        onClose={handleCloseContent}
        onNavigateToNowPlaying={handleNavigateToNowPlaying}
        currentlyPlayingTrackUri={currentPlayback?.item?.uri}
        currentPlayback={currentPlayback}
        radioMixes={radioMixes}
        savedEpisodes={savedEpisodes}
        updateGradientColors={updateGradientColors}
        setIgnoreNextRelease={setIgnoreNextRelease}
        playbackProgress={playbackProgress}
        refreshPlaybackState={refreshPlaybackState}
      />
    );
  } else {
    content = (
      <Home
        accessToken={accessToken}
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        recentAlbums={recentAlbums}
        userPlaylists={userPlaylists}
        topArtists={topArtists}
        likedSongs={likedSongs}
        radioMixes={radioMixes}
        userShows={userShows}
        savedEpisodes={savedEpisodes}
        currentPlayback={currentPlayback}
        currentlyPlayingAlbum={currentlyPlayingAlbum}
        playbackProgress={playbackProgress}
        isLoading={isLoading}
        refreshData={refreshData}
        refreshPlaybackState={refreshPlaybackState}
        onOpenContent={handleOpenContent}
        updateGradientColors={updateGradientColors}
        onOpenDeviceSwitcher={handleOpenDeviceSwitcher}
      />
    );
  }

  return (
    <NotificationProvider>
      <NotificationEffects
        isUpdating={isUpdating}
        updateStatus={updateStatus}
        activeSection={activeSection}
        handleReboot={handleReboot}
        isAuthenticated={isAuthenticated}
        isError={isError}
        errorMessage={errorMessage}
      />
      {isAuthenticated && !showConnectionLostScreen && !showTutorial && (
        <UpdateCheckNotification
          showLoader={showLoader}
          setActiveSection={setActiveSection}
          currentVersion={nocturneVersion}
          isInfoLoading={isInfoLoading}
          refetchInfo={refetchInfo}
        />
      )}
      <ConnectorProvider>
        <SettingsProvider>
          <DeviceSwitcherContext.Provider value={deviceSwitcherContextValue}>
            <NetworkContext.Provider value={networkContextValue}>
              <ConnectorContext.Provider value={connectorContextValue}>
                <Router>
                  <FontLoader />
                  {isAuthenticated && <WakeWordArmer />}
                  {showLoader && (
                    <LoadingScreen
                      show={showLoader}
                      onComplete={() => setShowLoader(false)}
                    />
                  )}
                  {!showLoader &&
                    isAuthenticated &&
                    !tokenReady &&
                    !initialTokenRefreshDone && (
                      <TokenRefreshOverlay show={!tokenReady} />
                    )}
                  <main
                    className="overflow-hidden relative min-h-screen rounded-2xl"
                    style={{
                      fontFamily: `var(--font-inter), var(--font-noto-sans-sc), var(--font-noto-sans-tc), var(--font-noto-serif-jp), var(--font-noto-sans-kr), var(--font-noto-naskh-ar), var(--font-noto-sans-bn), var(--font-noto-sans-dv), var(--font-noto-sans-he), var(--font-noto-sans-ta), var(--font-noto-sans-th), var(--font-noto-sans-gk), system-ui, sans-serif`,
                      fontOpticalSizing: "auto",
                    }}
                  >
                    <GradientBackground
                      gradientState={gradientState}
                      className="bg-black"
                    />

                    <div className="relative z-10">
                      {content}
                      {!isUpdateScreenVisible &&
                        !showTetheringScreen &&
                        !showConnectionLostScreen && (
                          <>
                            {pairingRequest ? (
                              <PairingScreen
                                pin={pairingRequest.pairingKey}
                                isConnecting={isConnecting}
                                onAccept={acceptPairing}
                                onReject={denyPairing}
                              />
                            ) : null}
                          </>
                        )}
                      {!displayNetworkBanner &&
                        !showConnectorModal &&
                        !showTutorial &&
                        !powerMenuVisible &&
                        !isUpdateScreenVisible &&
                        !showConnectionLostScreen &&
                        !showTetheringScreen && (
                          <ListeningOverlay
                            show={listeningOverlayVisible}
                            onClose={handleListeningClose}
                            onCommand={handleVoiceCommand}
                            sessionAlreadyActive={wakeSessionActive}
                          />
                        )}
                      <NetworkBanner visible={displayNetworkBanner} />
                      <DeviceSwitcherModal
                        isOpen={isDeviceSwitcherOpen}
                        onClose={handleCloseDeviceSwitcher}
                        accessToken={accessToken}
                        initialDevices={prefetchedDevices}
                      />
                      {showConnectorModal && (
                        <ConnectorQRModal
                          onClose={() => setShowConnectorModal(false)}
                        />
                      )}
                      <NetworkPasswordModal
                        network={selectedNetwork}
                        onClose={handleNetworkClose}
                        onConnect={handleNetworkClose}
                      />
                      {!showTutorial && (
                        <ButtonMappingOverlay
                          show={showGlobalMappingOverlay}
                          activeButton={globalActiveButton}
                        />
                      )}
                      <PowerMenuOverlay
                        show={powerMenuVisible}
                        onShutdown={handleShutdown}
                        onReboot={handleReboot}
                        onClose={() => setPowerMenuVisible(false)}
                      />
                    </div>
                  </main>
                  <NotificationsContainer />
                </Router>
              </ConnectorContext.Provider>
            </NetworkContext.Provider>
          </DeviceSwitcherContext.Provider>
        </SettingsProvider>
      </ConnectorProvider>
    </NotificationProvider>
  );
}

export default App;
