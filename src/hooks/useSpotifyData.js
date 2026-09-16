import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "./useAuth";
import { useSpotifyPlayerState } from "./useSpotifyPlayerState";
import { useSpotifyPlayerControls } from "./useSpotifyPlayerControls";
import {
  networkAwareRequest,
  waitForNetwork,
} from "../utils/networkAwareRequest";

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

export function useSpotifyData(
  activeSection,
  skipInitialFetch = false,
  tokenReady = true,
  deviceSwitcherRef = null,
) {
  const {
    isAuthenticated,
    accessToken,
    isLoading: authIsLoading,
    refreshTokens,
    error: authError,
  } = useAuth();

  const [isInitializing, setIsInitializing] = useState(false);
  const [recentAlbums, setRecentAlbums] = useState([]);
  const [userPlaylists, setUserPlaylists] = useState([]);
  const [topArtists, setTopArtists] = useState([]);
  const [likedSongs, setLikedSongs] = useState({
    name: "Liked Songs",
    tracks: { total: 0 },
    images: [{ url: "/images/liked-songs.webp" }],
    type: "liked-songs",
  });
  const [radioMixes, setRadioMixes] = useState([]);
  const [userShows, setUserShows] = useState([]);
  const [savedEpisodes, setSavedEpisodes] = useState([]);
  const [retryCount, setRetryCount] = useState(0);

  const [isLoading, setIsLoading] = useState({
    recentAlbums: true,
    userPlaylists: true,
    topArtists: true,
    likedSongs: true,
    radioMixes: true,
    userShows: true,
    savedEpisodes: true,
  });

  const [errors, setErrors] = useState({
    recentAlbums: null,
    userPlaylists: null,
    topArtists: null,
    likedSongs: null,
    radioMixes: null,
    userShows: null,
    savedEpisodes: null,
  });

  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const dataLoadingAttemptedRef = useRef(false);
  const initialLoadTriggeredRef = useRef(false);
  const dataFetchingInProgressRef = useRef(false);
  const lastPlayedAlbumIdRef = useRef(null);
  const effectiveToken = useMemo(() => {
    return tokenReady &&
      isAuthenticated &&
      !isInitializing &&
      !skipInitialFetch &&
      accessToken
      ? accessToken
      : null;
  }, [
    tokenReady,
    isAuthenticated,
    isInitializing,
    skipInitialFetch,
    accessToken,
  ]);
  const retryTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

  const {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading: playerIsLoading,
    error: playerError,
    refreshPlaybackState,
  } = useSpotifyPlayerState(effectiveToken, !!effectiveToken);

  const playerControls = useSpotifyPlayerControls(
    effectiveToken,
    deviceSwitcherRef,
  );

  useEffect(() => {
    if (currentlyPlayingAlbum?.id) {
      if (
        !recentAlbums.length ||
        recentAlbums[0]?.id !== currentlyPlayingAlbum.id
      ) {
        lastPlayedAlbumIdRef.current = currentlyPlayingAlbum.id;
        setRecentAlbums((prevAlbums) => {
          const filteredAlbums = prevAlbums.filter(
            (album) => album.id !== currentlyPlayingAlbum.id,
          );
          return [currentlyPlayingAlbum, ...filteredAlbums].slice(0, 50);
        });

        if (activeSection === "recents") {
          setTimeout(() => {
            const event = new CustomEvent("albumOrderChanged", {
              detail: { albumId: currentlyPlayingAlbum.id },
            });
            window.dispatchEvent(event);
          }, 50);
        }
      }
    }
  }, [currentlyPlayingAlbum, recentAlbums, activeSection]);

  const fetchRecentlyPlayed = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, recentAlbums: true }));

      const response = await networkAwareRequest(() =>
        fetch(
          "https://api.spotify.com/v1/me/player/recently-played?limit=50&additional_types=track,episode",
          {
            headers: {
              Authorization: `Bearer ${effectiveToken}`,
            },
          },
        ),
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const uniqueAlbums = [];
      const albumIds = new Set();

      if (currentlyPlayingAlbum?.id) {
        albumIds.add(currentlyPlayingAlbum.id);
        uniqueAlbums.push(currentlyPlayingAlbum);
      }

      data.items.forEach((item) => {
        if (
          item.track &&
          item.track.type === "track" &&
          item.track.album &&
          !albumIds.has(item.track.album.id)
        ) {
          albumIds.add(item.track.album.id);
          uniqueAlbums.push(item.track.album);
        } else if (
          item.track &&
          item.track.type === "episode" &&
          item.track.show &&
          !albumIds.has(item.track.show.id)
        ) {
          albumIds.add(item.track.show.id);
          uniqueAlbums.push(item.track.show);
        }
      });

      setRecentAlbums(uniqueAlbums);
      setErrors((prev) => ({ ...prev, recentAlbums: null }));
      return uniqueAlbums;
    } catch (err) {
      console.error("Error fetching recently played:", err);
      setErrors((prev) => ({ ...prev, recentAlbums: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, recentAlbums: false }));
    }
  }, [effectiveToken, currentlyPlayingAlbum]);

  const fetchUserPlaylists = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, userPlaylists: true }));

      const response = await networkAwareRequest(() =>
        fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }),
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setUserPlaylists(data.items);
      setErrors((prev) => ({ ...prev, userPlaylists: null }));
      return data.items;
    } catch (err) {
      console.error("Error fetching user playlists:", err);
      setErrors((prev) => ({ ...prev, userPlaylists: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, userPlaylists: false }));
    }
  }, [effectiveToken]);

  const fetchTopArtists = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, topArtists: true }));

      const response = await networkAwareRequest(() =>
        fetch("https://api.spotify.com/v1/me/top/artists?limit=50", {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }),
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setTopArtists(data.items);
      setErrors((prev) => ({ ...prev, topArtists: null }));
      return data.items;
    } catch (err) {
      console.error("Error fetching top artists:", err);
      setErrors((prev) => ({ ...prev, topArtists: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, topArtists: false }));
    }
  }, [effectiveToken]);

  const fetchLikedSongs = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, likedSongs: true }));

      const response = await networkAwareRequest(() =>
        fetch("https://api.spotify.com/v1/me/tracks?limit=1", {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }),
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const updatedLikedSongs = {
        ...likedSongs,
        tracks: { total: data.total },
      };
      setLikedSongs(updatedLikedSongs);
      setErrors((prev) => ({ ...prev, likedSongs: null }));
      return updatedLikedSongs;
    } catch (err) {
      console.error("Error fetching liked songs:", err);
      setErrors((prev) => ({ ...prev, likedSongs: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, likedSongs: false }));
    }
  }, [effectiveToken, likedSongs]);

  const fetchUserShows = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, userShows: true }));

      const response = await networkAwareRequest(() =>
        fetch("https://api.spotify.com/v1/me/shows?limit=50", {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }),
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setUserShows(data.items || []);
      setErrors((prev) => ({ ...prev, userShows: null }));
      return data.items || [];
    } catch (err) {
      console.error("Error fetching user shows:", err);
      setErrors((prev) => ({ ...prev, userShows: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, userShows: false }));
    }
  }, [effectiveToken]);

  const fetchSavedEpisodes = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, savedEpisodes: true }));

      const response = await networkAwareRequest(() =>
        fetch("https://api.spotify.com/v1/me/episodes?limit=50", {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }),
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setSavedEpisodes(data.items || []);
      setErrors((prev) => ({ ...prev, savedEpisodes: null }));
      return data.items || [];
    } catch (err) {
      console.error("Error fetching saved episodes:", err);
      setErrors((prev) => ({ ...prev, savedEpisodes: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, savedEpisodes: false }));
    }
  }, [effectiveToken]);

  const fetchRadioMixes = useCallback(async () => {
    if (!effectiveToken) return;

    const authed = (url) =>
      networkAwareRequest(() =>
        fetch(url, { headers: { Authorization: `Bearer ${effectiveToken}` } }),
      )
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);

    try {
      setIsLoading((prev) => ({ ...prev, radioMixes: true }));

      const [mediumTerm, longTerm, recent, topArtistsData] = await Promise.all([
        authed(
          "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term",
        ),
        authed(
          "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=long_term",
        ),
        authed("https://api.spotify.com/v1/me/player/recently-played?limit=50"),
        authed("https://api.spotify.com/v1/me/top/artists?limit=10"),
      ]);

      const getUniqueTracksById = (tracks) => {
        const uniqueMap = new Map();
        tracks.forEach((track) => {
          if (track?.id && !uniqueMap.has(track.id)) {
            uniqueMap.set(track.id, track);
          }
        });
        return Array.from(uniqueMap.values());
      };

      const addUniqueIds = (tracks, mixId) =>
        tracks.map((track) => ({ ...track, uniqueId: `${mixId}-${track.id}` }));

      const mixes = [];

      if (mediumTerm?.items?.length) {
        mixes.push({
          id: "top-mix",
          name: "Your Top Mix",
          images: [{ url: "/images/radio-cover/top.webp" }],
          tracks: addUniqueIds(
            getUniqueTracksById(mediumTerm.items),
            "top-mix",
          ),
          type: "static",
          sortOrder: 1,
        });
      }

      // /artists/{id}/top-tracks is 403 without extended quota, but searching
      // `artist:"Name"` returns the same popular tracks and is not restricted.
      if (topArtistsData?.items?.length) {
        const seeds = topArtistsData.items.slice(0, 5);
        const perArtist = await Promise.all(
          seeds.map((artist) =>
            authed(
              `https://api.spotify.com/v1/search?q=${encodeURIComponent(
                `artist:"${artist.name}"`,
              )}&type=track&limit=10`,
            ).then((data) => data?.tracks?.items?.filter(Boolean) || []),
          ),
        );

        const discoveries = getUniqueTracksById(perArtist.flat())
          .sort(() => Math.random() - 0.5)
          .slice(0, 50);

        if (discoveries.length) {
          mixes.push({
            id: "discoveries-mix",
            name: "Discoveries",
            images: [{ url: "/images/radio-cover/discoveries.webp" }],
            tracks: addUniqueIds(discoveries, "discoveries-mix"),
            type: "static",
            sortOrder: 2,
          });
        }
      }

      if (longTerm?.items?.length) {
        mixes.push({
          id: "all-time-mix",
          name: "All Time",
          images: [{ url: "/images/radio-cover/top.webp" }],
          tracks: addUniqueIds(
            getUniqueTracksById(longTerm.items),
            "all-time-mix",
          ),
          type: "static",
          sortOrder: 3,
        });
      }

      if (recent?.items?.length) {
        const recentTracks = getUniqueTracksById(
          recent.items.map((item) => item.track).filter(Boolean),
        );
        if (recentTracks.length) {
          mixes.push({
            id: "recent-mix",
            name: "Recently Played",
            images: [{ url: "/images/radio-cover/discoveries.webp" }],
            tracks: addUniqueIds(recentTracks, "recent-mix"),
            type: "static",
            sortOrder: 4,
          });
        }
      }

      mixes.sort((a, b) => a.sortOrder - b.sortOrder);
      setRadioMixes(mixes);
      setErrors((prev) => ({ ...prev, radioMixes: null }));
      return mixes;
    } catch (err) {
      console.error("Error fetching radio mixes:", err);
      setErrors((prev) => ({ ...prev, radioMixes: err.message }));
      setRadioMixes([]);
      return [];
    } finally {
      setIsLoading((prev) => ({ ...prev, radioMixes: false }));
    }
  }, [effectiveToken]);

  const isTokenValid = useCallback(() => {
    const tokenExpiry = localStorage.getItem("spotifyTokenExpiry");
    if (!tokenExpiry) return false;

    const expiryTime = new Date(tokenExpiry);
    const now = new Date();
    const tenMinutes = 10 * 60 * 1000;
    return expiryTime.getTime() - now.getTime() > tenMinutes;
  }, []);

  const waitForValidToken = useCallback(async () => {
    if (!isAuthenticated || !accessToken) return false;
    if (isTokenValid()) return true;

    try {
      await refreshTokens();
      return isTokenValid();
    } catch (error) {
      console.error("Error refreshing token:", error);
      return false;
    }
  }, [isAuthenticated, accessToken, refreshTokens, isTokenValid]);

  const loadInitialData = useCallback(async () => {
    if (skipInitialFetch) return;
    if (
      initialLoadTriggeredRef.current ||
      !accessToken ||
      isInitializing ||
      initialDataLoaded ||
      dataLoadingAttemptedRef.current ||
      dataFetchingInProgressRef.current
    ) {
      return;
    }

    initialLoadTriggeredRef.current = true;

    const hasValidToken = await waitForValidToken();
    if (!hasValidToken) {
      initialLoadTriggeredRef.current = false;
      return;
    }

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    dataLoadingAttemptedRef.current = true;
    dataFetchingInProgressRef.current = true;

    setIsLoading({
      recentAlbums: true,
      userPlaylists: true,
      topArtists: true,
      likedSongs: true,
      radioMixes: true,
      userShows: true,
      savedEpisodes: true,
    });

    try {
      await waitForNetwork();

      abortControllerRef.current = new AbortController();

      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const results = await Promise.allSettled(
        [
          fetchRecentlyPlayed,
          fetchUserPlaylists,
          fetchTopArtists,
          fetchLikedSongs,
          fetchRadioMixes,
          fetchUserShows,
          fetchSavedEpisodes,
        ].map((fn, index) => delay(index * 250).then(fn)),
      );

      const failedRequests = results.filter(
        (result) => result.status === "rejected",
      );

      if (failedRequests.length > 0) {
        console.error(
          "Some data fetching operations failed:",
          failedRequests.map((f) => f.reason),
        );

        if (retryCount < MAX_RETRIES) {
          setRetryCount((prev) => prev + 1);
          retryTimeoutRef.current = setTimeout(
            () => {
              initialLoadTriggeredRef.current = false;
              dataLoadingAttemptedRef.current = false;
              dataFetchingInProgressRef.current = false;
              loadInitialData();
            },
            RETRY_DELAY * Math.pow(2, retryCount),
          );
          return;
        }
      }

      setInitialDataLoaded(true);
      setRetryCount(0);
      dataFetchingInProgressRef.current = false;
    } catch (error) {
      console.error("Error loading initial data:", error);

      if (retryCount < MAX_RETRIES) {
        setRetryCount((prev) => prev + 1);
        retryTimeoutRef.current = setTimeout(
          () => {
            initialLoadTriggeredRef.current = false;
            dataLoadingAttemptedRef.current = false;
            dataFetchingInProgressRef.current = false;
            loadInitialData();
          },
          RETRY_DELAY * Math.pow(2, retryCount),
        );
      } else {
        dataFetchingInProgressRef.current = false;
      }
    }
  }, [
    accessToken,
    isInitializing,
    initialDataLoaded,
    retryCount,
    fetchRecentlyPlayed,
    fetchUserPlaylists,
    fetchTopArtists,
    fetchLikedSongs,
    fetchRadioMixes,
    fetchUserShows,
    fetchSavedEpisodes,
    skipInitialFetch,
  ]);

  useEffect(() => {
    if (skipInitialFetch) return;
    if (effectiveToken && !initialDataLoaded) {
      loadInitialData();
    }

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [effectiveToken, initialDataLoaded, loadInitialData, skipInitialFetch]);

  const refreshData = useCallback(async () => {
    if (!accessToken) return;

    if (dataFetchingInProgressRef.current) {
      return;
    }

    const hasValidToken = await waitForValidToken();
    if (!hasValidToken) {
      return;
    }

    dataFetchingInProgressRef.current = true;

    setIsLoading((prev) => ({
      ...prev,
      userPlaylists: true,
      topArtists: true,
      likedSongs: true,
      radioMixes: true,
      userShows: true,
      savedEpisodes: true,
    }));

    try {
      await fetchUserPlaylists();
      await fetchTopArtists();
      await fetchLikedSongs();
      await fetchRadioMixes();
      await fetchUserShows();
      await fetchSavedEpisodes();
    } catch (error) {
      console.error("Error refreshing data:", error);
    } finally {
      dataFetchingInProgressRef.current = false;
    }
  }, [
    accessToken,
    waitForValidToken,
    fetchUserPlaylists,
    fetchTopArtists,
    fetchLikedSongs,
    fetchRadioMixes,
    fetchUserShows,
    fetchSavedEpisodes,
    initialDataLoaded,
  ]);

  const isLoadingData = Object.values(isLoading).some(Boolean);
  const isLoadingAll =
    authIsLoading || isInitializing || isLoadingData || playerIsLoading;

  return {
    isAuthenticated,
    accessToken: tokenReady ? accessToken : null,
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
    isLoading: {
      data: isLoadingData,
      player: playerIsLoading,
      auth: authIsLoading || isInitializing,
      all: isLoadingAll,
      recentAlbums: isLoading.recentAlbums,
      userPlaylists: isLoading.userPlaylists,
      topArtists: isLoading.topArtists,
      likedSongs: isLoading.likedSongs,
      radioMixes: isLoading.radioMixes,
      userShows: isLoading.userShows,
      savedEpisodes: isLoading.savedEpisodes,
    },
    errors,
    refreshData,
    refreshRecentlyPlayed: fetchRecentlyPlayed,
    refreshUserPlaylists: fetchUserPlaylists,
    refreshTopArtists: fetchTopArtists,
    refreshLikedSongs: fetchLikedSongs,
    refreshRadioMixes: fetchRadioMixes,
    refreshUserShows: fetchUserShows,
    refreshSavedEpisodes: fetchSavedEpisodes,
  };
}
