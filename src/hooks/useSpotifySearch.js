import { useCallback, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import { networkAwareRequest } from "../utils/networkAwareRequest";

const SEARCH_TYPES = "track,album,playlist,artist";

export function useSpotifySearch() {
  const { accessToken } = useAuth();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const searchSpotify = useCallback(
    async (q) => {
      const trimmed = (q || "").trim();
      if (!trimmed) return null;
      if (!accessToken) {
        setError("Not authenticated with Spotify");
        return null;
      }

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setQuery(trimmed);
      setLoading(true);
      setError(null);

      try {
        const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
          trimmed,
        )}&type=${SEARCH_TYPES}&limit=20`;

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
          tracks: data.tracks?.items?.filter(Boolean) || [],
          albums: data.albums?.items?.filter(Boolean) || [],
          playlists: data.playlists?.items?.filter(Boolean) || [],
          artists: data.artists?.items?.filter(Boolean) || [],
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
