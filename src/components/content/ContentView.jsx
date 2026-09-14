import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import {
  getPlaylistTrackCount,
  playlistItemsUrl,
  unwrapPlaylistItems,
} from "../../utils/spotifyPlaylist";
import { useNavigation } from "../../hooks/useNavigation";
import { CarThingIcon } from "../common/icons";
import { useButtonMapping } from "../../hooks/useButtonMapping";
import ButtonMappingOverlay from "../common/overlays/ButtonMappingOverlay";
import ScrollingText from "../common/ScrollingText";
import { networkAwareRequest } from "../../utils/networkAwareRequest";

// Search is capped at limit=10, and an `artist:"Name"` filter frequently matches
// only a handful (Black Label Society reports total: 5), so offset cannot help.
// Top up from the discography instead. /albums?ids= is 403 without extended
// quota, so albums have to be fetched one at a time.
const ARTIST_TRACK_TARGET = 30;
const ARTIST_ALBUM_LIMIT = 6;

async function gatherArtistTracks(artistId, artistName, accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const seenIds = new Set();
  const seenNames = new Set();
  const collected = [];

  const add = (track) => {
    if (!track?.id || !track.uri) return;
    const name = (track.name || "").toLowerCase().trim();
    // Live/deluxe/remaster reissues repeat the same songs across albums.
    if (seenIds.has(track.id) || seenNames.has(name)) return;
    seenIds.add(track.id);
    if (name) seenNames.add(name);
    collected.push(track);
  };

  try {
    const res = await networkAwareRequest(() =>
      fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(
          `artist:"${artistName}"`,
        )}&type=track&limit=10`,
        { headers },
      ),
    );
    if (res.ok) {
      const data = await res.json();
      (data.tracks?.items || []).filter(Boolean).forEach(add);
    }
  } catch (err) {
    console.warn("Artist track search failed:", err?.message);
  }

  if (collected.length >= ARTIST_TRACK_TARGET) {
    return collected.slice(0, ARTIST_TRACK_TARGET);
  }

  try {
    const albumsRes = await networkAwareRequest(() =>
      fetch(
        `https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album,single&limit=${ARTIST_ALBUM_LIMIT}`,
        { headers },
      ),
    );
    if (albumsRes.ok) {
      const albums = ((await albumsRes.json()).items || []).filter(Boolean);
      const details = await Promise.all(
        albums.map((album) =>
          networkAwareRequest(() =>
            fetch(`https://api.spotify.com/v1/albums/${album.id}`, { headers }),
          )
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ),
      );
      details.forEach((album) => {
        (album?.tracks?.items || []).filter(Boolean).forEach(add);
      });
    }
  } catch (err) {
    console.warn("Artist discography fetch failed:", err?.message);
  }

  return collected.slice(0, ARTIST_TRACK_TARGET);
}

const ContentView = ({
  accessToken,
  contentId,
  contentType = "album",
  onClose,
  currentlyPlayingTrackUri,
  currentPlayback,
  radioMixes = [],
  savedEpisodes = [],
  updateGradientColors,
  setIgnoreNextRelease,
  onNavigateToNowPlaying,
  refreshPlaybackState,
}) => {
  const [content, setContent] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(-1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);
  const [hasMoreTracks, setHasMoreTracks] = useState(false);
  const [tracksPerPage, setTracksPerPage] = useState(0);
  const [loadedPages, setLoadedPages] = useState(0);
  const tracksContainerRef = useRef(null);
  const navigate = useNavigate();

  const {
    playTrack,
    isLoading: isPlaybackLoading,
    error: playbackError,
    toggleShuffle,
  } = useSpotifyPlayerControls(accessToken);

  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);

  const fetchPlaylistTracks = async (
    playlistId,
    initialTracks,
    initialNext,
  ) => {
    let allTracks = [...initialTracks];
    let nextUrl = initialNext;

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch additional tracks: ${response.status}`,
        );
      }

      const data = await response.json();
      allTracks = [...allTracks, ...unwrapPlaylistItems(data.items)];
      nextUrl = data.next;
    }

    return allTracks;
  };

  const loadMoreTracks = useCallback(async () => {
    if (
      !nextUrl ||
      isLoadingMore ||
      (contentType !== "playlist" && contentType !== "show")
    )
      return;

    try {
      setIsLoadingMore(true);
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch more tracks: ${response.status}`);
      }

      const data = await response.json();
      const newTracks =
        contentType === "playlist"
          ? unwrapPlaylistItems(data.items)
          : data.items;

      setTracks((prevTracks) => [...prevTracks, ...newTracks]);
      setNextUrl(data.next);
      setHasMoreTracks(!!data.next);
      setLoadedPages((prev) => prev + 1);
    } catch (err) {
      console.error("Error loading more tracks:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextUrl, isLoadingMore, contentType, accessToken]);

  useEffect(() => {
    const container = tracksContainerRef.current;
    if (
      !container ||
      (contentType !== "playlist" && contentType !== "show") ||
      tracksPerPage === 0
    )
      return;

    const handleScroll = () => {
      const trackElements = container.querySelectorAll("[data-track-index]");
      if (trackElements.length === 0) return;

      const containerRect = container.getBoundingClientRect();
      let currentVisibleTrackIndex = -1;

      for (let i = 0; i < trackElements.length; i++) {
        const trackRect = trackElements[i].getBoundingClientRect();
        const trackCenter = trackRect.top + trackRect.height / 2;
        const containerCenter = containerRect.top + containerRect.height / 2;

        if (trackCenter <= containerCenter) {
          currentVisibleTrackIndex = i;
        } else {
          break;
        }
      }

      if (currentVisibleTrackIndex >= 0) {
        const currentPage = Math.floor(
          currentVisibleTrackIndex / tracksPerPage,
        );
        const currentPageStart = currentPage * tracksPerPage;
        const currentPageMidpoint =
          currentPageStart + Math.floor(tracksPerPage / 2);

        if (
          currentVisibleTrackIndex >= currentPageMidpoint &&
          currentPage >= loadedPages - 1 &&
          hasMoreTracks &&
          !isLoadingMore
        ) {
          loadMoreTracks();
        }
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [
    hasMoreTracks,
    isLoadingMore,
    loadMoreTracks,
    contentType,
    tracksPerPage,
    loadedPages,
  ]);

  const { showMappingOverlay, activeButton, mappingInProgress, setTrackUris } =
    useButtonMapping({
      accessToken,
      contentId,
      contentType,
      contentImage:
        content?.images?.[1]?.url || content?.images?.[0]?.url || "",
      contentName: content?.name || "",
      playTrack,
      isActive: !!content,
      setIgnoreNextRelease,
    });

  useEffect(() => {
    if (
      tracks.length > 0 &&
      (contentType === "mix" || contentType === "liked-songs")
    ) {
      const trackUris = tracks
        .filter((track) => track && track.uri)
        .map((track) => track.uri);

      setTrackUris(trackUris);
    }
  }, [tracks, contentType, setTrackUris]);

  useEffect(() => {
    if (currentPlayback?.shuffle_state !== undefined) {
      setIsShuffleEnabled(currentPlayback.shuffle_state);
    }
  }, [currentPlayback?.shuffle_state]);

  const handleTrackSelect = (index, trackElement) => {
    if (index >= 0 && index < tracks.length) {
      handleTrackPlay(tracks[index], index);
    }
  };

  const { selectedIndex } = useNavigation({
    containerRef: tracksContainerRef,
    enableScrollTracking: true,
    enableWheelNavigation: true,
    enableKeyboardNavigation: true,
    enableItemSelection: true,
    enableEscapeKey: true,
    onEscape: handleBack,
    onItemSelect: handleTrackSelect,
    onItemFocus: (index) => setSelectedTrackIndex(index),
    inactivityTimeout: 3000,
    vertical: true,
  });

  useEffect(() => {
    const fetchContent = async () => {
      if (!accessToken) return;
      if (!contentId && contentType !== "liked-songs") return;

      try {
        setIsLoading(true);
        setNextUrl(null);
        setHasMoreTracks(false);
        setIsLoadingMore(false);
        setTracksPerPage(0);
        setLoadedPages(0);

        let contentData;
        let tracksData = [];

        switch (contentType) {
          case "album": {
            const albumResponse = await fetch(
              `https://api.spotify.com/v1/albums/${contentId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              },
            );

            if (!albumResponse.ok) {
              throw new Error(
                `Failed to fetch album data: ${albumResponse.status}`,
              );
            }

            contentData = await albumResponse.json();

            if (
              contentData?.images &&
              contentData.images.length > 0 &&
              updateGradientColors
            ) {
              updateGradientColors(
                contentData.images[1]?.url || contentData.images[0].url,
                contentType,
              );
            }

            tracksData = contentData.tracks.items;
            break;
          }

          case "playlist": {
            const playlistResponse = await fetch(
              `https://api.spotify.com/v1/playlists/${contentId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              },
            );

            if (!playlistResponse.ok) {
              throw new Error(
                `Failed to fetch playlist data: ${playlistResponse.status}`,
              );
            }

            contentData = await playlistResponse.json();

            if (
              contentData?.images &&
              contentData.images.length > 0 &&
              updateGradientColors
            ) {
              updateGradientColors(
                contentData.images[1]?.url || contentData.images[0].url,
                contentType,
              );
            }

            // `/playlists/{id}` no longer embeds the track list, so the items
            // page is a separate request. Followed (not owned) playlists 403
            // here - degrade to an empty track list rather than blanking the
            // whole view.
            const itemsResponse = await fetch(playlistItemsUrl(contentId), {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });

            if (itemsResponse.ok) {
              const itemsData = await itemsResponse.json();
              tracksData = unwrapPlaylistItems(itemsData.items);
              setNextUrl(itemsData.next);
              setHasMoreTracks(!!itemsData.next);
            } else {
              console.warn(
                `Playlist items unavailable (${itemsResponse.status}) for ${contentId}`,
              );
              tracksData = [];
              setNextUrl(null);
              setHasMoreTracks(false);
            }

            setTracksPerPage(tracksData.length);
            setLoadedPages(1);
            break;
          }

          case "artist": {
            const artistResponse = await fetch(
              `https://api.spotify.com/v1/artists/${contentId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              },
            );

            if (!artistResponse.ok) {
              throw new Error(
                `Failed to fetch artist data: ${artistResponse.status}`,
              );
            }

            contentData = await artistResponse.json();

            if (
              contentData?.images &&
              contentData.images.length > 0 &&
              updateGradientColors
            ) {
              updateGradientColors(
                contentData.images[1]?.url || contentData.images[0].url,
                contentType,
              );
            }

            // top-tracks is 403 without extended quota. Searching the artist by
            // name is not restricted and surfaces the same popular tracks, so
            // fall back to it - and never let a missing track list take down the
            // whole artist page, which is what used to happen.
            tracksData = [];
            try {
              const topTracksResponse = await fetch(
                `https://api.spotify.com/v1/artists/${contentId}/top-tracks?market=from_token`,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                },
              );

              if (topTracksResponse.ok) {
                tracksData = (await topTracksResponse.json()).tracks || [];
              } else {
                tracksData = await gatherArtistTracks(
                  contentId,
                  contentData.name,
                  accessToken,
                );
              }
            } catch (trackErr) {
              console.warn(
                `Artist tracks unavailable for ${contentId}:`,
                trackErr?.message,
              );
            }
            break;
          }

          case "liked-songs": {
            const likedSongsResponse = await fetch(
              "https://api.spotify.com/v1/me/tracks?limit=50",
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              },
            );

            if (!likedSongsResponse.ok) {
              throw new Error(
                `Failed to fetch liked songs: ${likedSongsResponse.status}`,
              );
            }

            const likedSongsData = await likedSongsResponse.json();

            contentData = {
              id: "liked-songs",
              name: "Liked Songs",
              type: "liked-songs",
              images: [{ url: "/images/liked-songs.webp" }],
              tracks: { total: likedSongsData.total },
              owner: { display_name: "You" },
            };

            if (updateGradientColors) {
              updateGradientColors(contentData.images[0].url, contentType);
            }

            tracksData = likedSongsData.items.map((item) => item.track);
            break;
          }

          case "mix": {
            const foundMix = radioMixes.find((m) => m.id === contentId);

            if (foundMix) {
              contentData = {
                ...foundMix,
                type: "mix",
                images: foundMix.images?.[1]
                  ? foundMix.images
                  : [foundMix.images?.[0], foundMix.images?.[0]],
              };

              if (
                contentData?.images &&
                contentData.images.length > 0 &&
                updateGradientColors
              ) {
                updateGradientColors(
                  contentData.images[1]?.url || contentData.images[0].url,
                  contentType,
                );
              }

              tracksData = foundMix.tracks || [];
            } else {
              throw new Error(`Mix not found: ${contentId}`);
            }
            break;
          }

          // Saved episodes grouped under their show. The episodes are already in
          // hand from /me/episodes (each one embeds its show), so this needs no
          // request - and unlike opening the show itself, it lists only what the
          // user actually saved rather than the full back catalogue.
          case "saved-episodes": {
            const episodes = savedEpisodes
              .map((item) => item?.episode)
              .filter((ep) => ep && ep.show?.id === contentId);

            if (!episodes.length) {
              throw new Error(`No saved episodes for show: ${contentId}`);
            }

            const show = episodes[0].show;
            contentData = {
              ...show,
              type: "saved-episodes",
              savedCount: episodes.length,
            };

            if (contentData.images?.length > 0 && updateGradientColors) {
              updateGradientColors(
                contentData.images[1]?.url || contentData.images[0].url,
                contentType,
              );
            }

            tracksData = episodes;
            setTracksPerPage(tracksData.length);
            setLoadedPages(1);
            break;
          }

          case "show": {
            const [showResponse, episodesResponse] = await Promise.all([
              fetch(`https://api.spotify.com/v1/shows/${contentId}`, {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }),
              fetch(
                `https://api.spotify.com/v1/shows/${contentId}/episodes?limit=50`,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                },
              ),
            ]);

            if (!showResponse.ok || !episodesResponse.ok) {
              throw new Error(
                `Failed to fetch show data: ${
                  !showResponse.ok
                    ? showResponse.status
                    : episodesResponse.status
                }`,
              );
            }

            contentData = await showResponse.json();
            const episodesData = await episodesResponse.json();

            if (
              contentData?.images &&
              contentData.images.length > 0 &&
              updateGradientColors
            ) {
              updateGradientColors(
                contentData.images[1]?.url || contentData.images[0].url,
                contentType,
              );
            }

            tracksData = episodesData.items;
            setNextUrl(episodesData.next);
            setHasMoreTracks(!!episodesData.next);
            setTracksPerPage(tracksData.length);
            setLoadedPages(1);
            break;
          }

          default:
            throw new Error(`Unsupported content type: ${contentType}`);
        }

        setContent(contentData);
        setTracks(tracksData);
      } catch (err) {
        console.error(`Error fetching ${contentType} data:`, err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchContent();
  }, [
    contentId,
    contentType,
    accessToken,
    radioMixes,
    savedEpisodes,
    updateGradientColors,
  ]);

  function handleBack() {
    if (onClose) {
      onClose();
    } else {
      navigate(-1);
    }
  }

  const handleTrackPlay = async (track, index) => {
    if (!track || !track.uri) {
      console.warn("Attempted to play an invalid track:", track);
      return;
    }

    let contextUri = null;
    let uris = null;
    let wasShuffleEnabled = isShuffleEnabled;

    if (wasShuffleEnabled) {
      await toggleShuffle(false);
    }

    if (contentType === "album") {
      contextUri = `spotify:album:${contentId}`;
    } else if (contentType === "playlist") {
      contextUri = `spotify:playlist:${contentId}`;
    } else if (contentType === "artist") {
      uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
      const startIndex = index || 0;
      uris = uris.slice(startIndex).concat(uris.slice(0, startIndex));
    } else if (contentType === "show") {
      contextUri = `spotify:show:${contentId}`;
    } else if (contentType === "mix") {
      const currentMix = radioMixes.find((m) => m.id === contentId);
      if (currentMix && currentMix.type === "spotify-radio") {
        contextUri = currentMix.uri;
      } else {
        uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
        const startIndex = index || 0;
        uris = uris.slice(startIndex).concat(uris.slice(0, startIndex));
      }
      localStorage.setItem("currentPlayingMixId", contentId);
    } else if (contentType === "liked-songs") {
      uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
      const startIndex = index || 0;
      uris = uris.slice(startIndex).concat(uris.slice(0, startIndex));
      localStorage.setItem("playingLikedSongs", "true");
    }

    const success = await playTrack(track.uri, contextUri, uris);

    if (success) {
      if (refreshPlaybackState) {
        setTimeout(() => {
          refreshPlaybackState(true);
        }, 1000);
      }

      if (wasShuffleEnabled) {
        setTimeout(async () => {
          await toggleShuffle(true);
        }, 500);
      }
      if (onNavigateToNowPlaying) {
        onNavigateToNowPlaying();
      }
    } else {
      if (wasShuffleEnabled) {
        await toggleShuffle(true);
      }
    }
  };

  const handleShufflePlay = async () => {
    if (tracks.length === 0) {
      console.warn("No tracks available to shuffle play");
      return;
    }

    let contextUri = null;
    let uris = null;

    if (contentType === "mix") {
      const currentMix = radioMixes.find((m) => m.id === contentId);
      if (currentMix && currentMix.type === "spotify-radio") {
        contextUri = currentMix.uri;
      } else {
        uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
      }
    } else {
      uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
    }

    if (contentType === "liked-songs") {
      localStorage.setItem("playingLikedSongs", "true");
    }

    await playTrack(null, contextUri, uris);

    if (contentType === "liked-songs" && isShuffleEnabled) {
      setTimeout(async () => {
        await toggleShuffle(true);
      }, 500);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col md:flex-row pt-10 px-12 fadeIn-animation">
        <div className="md:w-1/3 sticky top-10 mb-8 md:mb-0 md:mr-8">
          <div className="mr-10" style={{ minWidth: "280px" }}>
            <div
              className="aspect-square bg-white/10 animate-pulse rounded-xl drop-shadow-xl"
              style={{ width: "280px", height: "280px", borderRadius: "12px" }}
            />
            <div
              className="mt-4 h-10 bg-white/10 animate-pulse rounded"
              style={{ width: "250px" }}
            />
            <div
              className="mt-3 h-8 bg-white/10 animate-pulse rounded"
              style={{ width: "200px" }}
            />
          </div>
        </div>
        <div
          className="md:w-2/3 md:pl-20"
          style={{ height: "calc(100vh - 5rem)" }}
        >
          {Array(5)
            .fill()
            .map((_, i) => (
              <div key={i} className="flex items-start mb-4">
                <div className="w-6 h-8 bg-white/10 animate-pulse rounded mr-12" />
                <div className="flex-grow">
                  <div
                    className="h-8 bg-white/10 animate-pulse rounded mb-2"
                    style={{ width: "250px" }}
                  />
                  <div
                    className="h-6 bg-white/10 animate-pulse rounded"
                    style={{ width: "200px" }}
                  />
                </div>
              </div>
            ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center text-white/70"
        style={{ height: "480px" }}
      >
        <CarThingIcon className="h-16 w-auto mb-2" />
        <h3
          className="text-white truncate tracking-tight"
          style={{
            fontSize: `calc(var(--text-scale)*36px)`,
            fontWeight: "560",
          }}
        >
          Error Loading Content
        </h3>
        <p
          className="text-white/60 truncate tracking-tight"
          style={{
            fontSize: `calc(var(--text-scale)*24px)`,
            fontWeight: "560",
          }}
        >
          {error}
        </p>
      </div>
    );
  }

  if (!content) {
    return null;
  }

  const getImageUrl = () => {
    if (!content.images || !content.images.length) {
      return "/images/not-playing.webp";
    }
    return content.images[1]?.url || content.images[0].url;
  };

  const formatNumber = (num) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  const getSubtitle = () => {
    switch (contentType) {
      case "album":
        return content.artists?.map((artist) => artist.name).join(", ");
      case "artist":
        return "";
      case "playlist":
        return `${formatNumber(getPlaylistTrackCount(content))} Songs`;
      case "liked-songs":
        return `${formatNumber(content.tracks?.total || 0)} Songs`;
      case "mix":
        return `${content.tracks?.length || 0} Tracks`;
      case "show":
        return content.publisher;
      case "saved-episodes":
        return `${formatNumber(content.savedCount || 0)} Saved Episode${
          content.savedCount === 1 ? "" : "s"
        }`;
      default:
        return "";
    }
  };

  const getImageStyle = () => {
    return contentType === "artist"
      ? "w-[280px] h-[280px] rounded-full drop-shadow-xl object-cover"
      : "w-[280px] h-[280px] object-cover rounded-[12px] drop-shadow-xl";
  };

  const getMappingStatusText = () => {
    if (mappingInProgress) {
      return (
        <div className="absolute top-0 left-0 right-0 bg-black/80 text-white py-2 px-4 text-center rounded-t-[12px]">
          <span className="text-lg font-medium">Mapping to button...</span>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col md:flex-row pt-10 px-12 fadeIn-animation">
      <div className="md:w-1/3 sticky top-10 mb-8 md:mb-0 md:mr-8">
        <div className="mr-10 relative" style={{ minWidth: "280px" }}>
          <img
            src={getImageUrl()}
            alt={`${content.name} Cover`}
            width={280}
            height={280}
            className={`${getImageStyle()}`}
          />
          {getMappingStatusText()}
          <h4
            className="mt-2 text-white truncate tracking-tight"
            style={{
              fontSize: `calc(var(--text-scale)*36px)`,
              fontWeight: "580",
              maxWidth: "280px",
            }}
          >
            {content.name}
          </h4>
          <h4
            className="text-white/60 truncate tracking-tight"
            style={{
              fontSize: `calc(var(--text-scale)*28px)`,
              fontWeight: "560",
              maxWidth: "280px",
            }}
          >
            {getSubtitle()}
          </h4>
        </div>
      </div>

      <div
        className="md:w-2/3 md:pl-20 overflow-y-auto scroll-container scroll-smooth pb-12"
        style={{ height: "calc(100vh - 5rem)", paddingTop: "6px" }}
        ref={tracksContainerRef}
      >
        {tracks.map((track, index) => {
          if (!track) return null;

          return (
            <div
              key={`${track.id || "track"}-${index}`}
              className={`flex items-start mb-5 transition-transform duration-200 ease-out ${
                selectedTrackIndex === index ? "scale-105" : ""
              }`}
              onClick={() => (track.uri ? handleTrackPlay(track, index) : null)}
              style={{
                transition: "transform 0.2s ease-out",
                borderRadius: "10px",
                background:
                  selectedTrackIndex === index ? "rgb(255 255 255 / 10%)" : "",
              }}
              data-track-index={index}
            >
              <div
                className="text-3xl font-semibold text-center text-white/60 mr-6 mt-3 flex justify-center"
                style={{
                  minWidth: "3rem",
                  fontSize: `calc(var(--text-scale)*32px)`,
                  fontWeight: "580",
                }}
              >
                {track.uri && track.uri === currentlyPlayingTrackUri ? (
                  <div className="w-5">
                    <section>
                      <div className="wave0"></div>
                      <div className="wave1"></div>
                      <div className="wave2"></div>
                      <div className="wave3"></div>
                    </section>
                  </div>
                ) : (
                  <p>{index + 1}</p>
                )}
              </div>

              <div className="flex-grow" style={{ marginTop: "-6px" }}>
                <div>
                  {selectedTrackIndex === index ? (
                    <div
                      style={{
                        fontSize: `calc(var(--text-scale)*32px)`,
                        fontWeight: "580",
                        maxWidth: "280px",
                      }}
                    >
                      <ScrollingText
                        text={track.name || "Unknown Track"}
                        className="text-white tracking-tight"
                        maxWidth="280px"
                        pauseDuration={1000}
                        pixelsPerSecond={40}
                      />
                    </div>
                  ) : (
                    <p
                      className="text-white truncate tracking-tight"
                      style={{
                        fontSize: `calc(var(--text-scale)*32px)`,
                        fontWeight: "580",
                        maxWidth: "280px",
                      }}
                    >
                      {track.name || "Unknown Track"}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap">
                  {contentType === "show" ? (
                    <p
                      className="text-white/60 truncate tracking-tight"
                      style={{
                        fontSize: `calc(var(--text-scale)*28px)`,
                        fontWeight: "560",
                      }}
                    >
                      {track.release_date
                        ? new Date(track.release_date).toLocaleDateString(
                            "en-US",
                            {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            },
                          )
                        : "No release date available"}
                    </p>
                  ) : (
                    track.artists &&
                    track.artists.map((artist, artistIndex) => (
                      <p
                        key={artist?.id || `artist-${artistIndex}`}
                        className={`text-white/60 truncate tracking-tight ${
                          artistIndex < track.artists.length - 1 ? "mr-2" : ""
                        }`}
                        style={{
                          fontSize: `calc(var(--text-scale)*28px)`,
                          fontWeight: "560",
                        }}
                      >
                        {artist?.name === null && artist?.type
                          ? artist.type
                          : artist?.name || "Unknown Artist"}
                        {artistIndex < track.artists.length - 1 && ","}
                      </p>
                    ))
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {isLoadingMore &&
          (contentType === "playlist" || contentType === "show") && (
            <div className="flex justify-center items-center py-8">
              <div className="flex items-center">
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin mr-4"></div>
                <p
                  className="text-white/60"
                  style={{
                    fontSize: `calc(var(--text-scale)*24px)`,
                    fontWeight: "560",
                  }}
                >
                  Loading more {contentType === "show" ? "episodes" : "tracks"}
                  ...
                </p>
              </div>
            </div>
          )}

        {playbackError && (
          <div className="mt-4 p-4 bg-red-500/20 rounded-lg">
            <p className="text-white/80">{playbackError}</p>
          </div>
        )}
      </div>

      <ButtonMappingOverlay
        show={showMappingOverlay}
        activeButton={activeButton}
      />
    </div>
  );
};

export default ContentView;
