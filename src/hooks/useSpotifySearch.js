import { useCallback, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import { networkAwareRequest } from "../utils/networkAwareRequest";

export const DEFAULT_SEARCH_TYPES = ["track", "album", "artist", "playlist"];

// Spotify returns one bucket per item type and ignores the order of `type`, so
// callers pass a priority order and get it back on `results.priority` to decide
// what to show (or play) first.
const BUCKET = {
  track: "tracks",
  album: "albums",
  artist: "artists",
  playlist: "playlists",
  show: "shows",
};

export function useSpotifySearch() {
  const { accessToken } = useAuth();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const searchSpotify = useCallback(
    async (q, options = {}) => {
      const { types = DEFAULT_SEARCH_TYPES, spotifyQuery } = options;

      const trimmed = (q || "").trim();
      // spotifyQuery carries field filters (album:"x" artist:"y"); the plain
      // query is what we show the user.
      const apiQuery = (spotifyQuery || trimmed).trim();
      if (!apiQuery) return null;
      if (!accessToken) {
        setError("Not authenticated with Spotify");
        return null;
      }

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      const priority = types.filter((t) => BUCKET[t]);
      const typeParam = (
        priority.length ? priority : DEFAULT_SEARCH_TYPES
      ).join(",");

      setQuery(trimmed);
      setLoading(true);
      setError(null);

      try {
        const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
          apiQuery,
        )}&type=${typeParam}&limit=10`;

        const response = await networkAwareRequest(() =>
          fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal,
          }),
        );

        if (!response.ok) {
          throw new Error(`Search failed: ${response.status}`);
        }

        const data = await response.json();
        const parsed = {
          query: trimmed,
          // Search buckets can contain nulls for items that are no longer
          // available, so every bucket is filtered.
          tracks: data.tracks?.items?.filter(Boolean) || [],
          albums: data.albums?.items?.filter(Boolean) || [],
          playlists: data.playlists?.items?.filter(Boolean) || [],
          artists: data.artists?.items?.filter(Boolean) || [],
          shows: data.shows?.items?.filter(Boolean) || [],
          priority: priority.length ? priority : DEFAULT_SEARCH_TYPES,
        };
        setResults(parsed);
        return parsed;
      } catch (err) {
        if (err.name === "AbortError") return null;
        console.error("Spotify search error:", err);
        setError(err.message || "Search failed");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [accessToken],
  );

  const clear = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setQuery("");
    setResults(null);
    setError(null);
    setLoading(false);
  }, []);

  return {
    query,
    results,
    loading,
    error,
    searchSpotify,
    clear,
  };
}
