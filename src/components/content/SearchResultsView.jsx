import React, { useEffect } from "react";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import ScrollingText from "../common/ScrollingText";

const ITEM_WIDTH = 220;

function Card({ image, title, subtitle, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col text-left w-[220px] shrink-0 mr-6"
    >
      <div className="w-[220px] h-[220px] rounded-xl overflow-hidden bg-white/10">
        {image ? (
          <img
            src={image}
            alt={title}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : null}
      </div>
      <div className="mt-3 w-[220px]">
        <ScrollingText
          text={title}
          className="text-white text-[22px] font-[600] leading-tight"
        />
        {subtitle ? (
          <p className="text-white/60 text-[18px] mt-1 truncate">{subtitle}</p>
        ) : null}
      </div>
    </button>
  );
}

function Row({ heading, children }) {
  return (
    <section className="mb-10">
      <h2 className="text-white text-[34px] font-[700] mb-4 px-10">
        {heading}
      </h2>
      <div className="flex overflow-x-auto no-scrollbar px-10">{children}</div>
    </section>
  );
}

export default function SearchResultsView({
  accessToken,
  results,
  loading,
  error,
  onOpenContent,
  onClose,
}) {
  const { playTrack } = useSpotifyPlayerControls(accessToken);

  // This view replaces Home rather than layering over it, so Home's Escape
  // handler is unmounted while it is open - without this there is nothing
  // listening and the back button does nothing.
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose?.();
    };

    window.addEventListener("keydown", handleKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKey, { capture: true });
  }, [onClose]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-white text-[32px]">Searching…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-white text-[32px]">Search failed</p>
        <p className="text-white/60 text-[22px]">{error}</p>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-white/60 text-[28px]">
          Hold the V key to dictate a search.
        </p>
      </div>
    );
  }

  const { query, tracks, albums, playlists, artists, shows = [] } = results;
  const isEmpty =
    !tracks.length &&
    !albums.length &&
    !playlists.length &&
    !artists.length &&
    !shows.length;

  // Rendered in the order the caller asked for, so a command like "play artist
  // bob dylan" leads with artists instead of a fixed songs-first layout.
  const SECTIONS = {
    track: () => (
      <Row heading="Songs" key="track">
        {tracks.slice(0, 12).map((t) => (
          <Card
            key={t.id}
            image={t.album?.images?.[1]?.url || t.album?.images?.[0]?.url}
            title={t.name}
            subtitle={t.artists?.map((a) => a.name).join(", ")}
            onClick={() => playTrack && playTrack(t.uri)}
          />
        ))}
      </Row>
    ),
    album: () => (
      <Row heading="Albums" key="album">
        {albums.slice(0, 12).map((a) => (
          <Card
            key={a.id}
            image={a.images?.[1]?.url || a.images?.[0]?.url}
            title={a.name}
            subtitle={a.artists?.map((x) => x.name).join(", ")}
            onClick={() => onOpenContent?.({ id: a.id, type: "album" })}
          />
        ))}
      </Row>
    ),
    playlist: () => (
      <Row heading="Playlists" key="playlist">
        {playlists.slice(0, 12).map((p) => (
          <Card
            key={p.id}
            image={p.images?.[1]?.url || p.images?.[0]?.url}
            title={p.name}
            subtitle={p.owner?.display_name}
            onClick={() => onOpenContent?.({ id: p.id, type: "playlist" })}
          />
        ))}
      </Row>
    ),
    artist: () => (
      <Row heading="Artists" key="artist">
        {artists.slice(0, 12).map((ar) => (
          <Card
            key={ar.id}
            image={ar.images?.[1]?.url || ar.images?.[0]?.url}
            title={ar.name}
            subtitle="Artist"
            onClick={() => onOpenContent?.({ id: ar.id, type: "artist" })}
          />
        ))}
      </Row>
    ),
    show: () => (
      <Row heading="Podcasts" key="show">
        {shows.slice(0, 12).map((sh) => (
          <Card
            key={sh.id}
            image={sh.images?.[1]?.url || sh.images?.[0]?.url}
            title={sh.name}
            subtitle={sh.publisher}
            onClick={() => onOpenContent?.({ id: sh.id, type: "show" })}
          />
        ))}
      </Row>
    ),
  };

  const counts = {
    track: tracks.length,
    album: albums.length,
    playlist: playlists.length,
    artist: artists.length,
    show: shows.length,
  };

  const order = results.priority?.length
    ? results.priority
    : ["track", "album", "playlist", "artist"];
  const ordered = [
    ...new Set([...order, "track", "album", "playlist", "artist", "show"]),
  ];

  return (
    <div className="min-h-screen pt-10 pb-12">
      <header className="px-10 mb-8">
        <p className="text-white/60 text-[20px] uppercase tracking-wider">
          Search results
        </p>
        <h1 className="text-white text-[48px] font-[700] mt-1">{query}</h1>
      </header>

      {isEmpty && (
        <div className="px-10">
          <p className="text-white/60 text-[24px]">No results.</p>
        </div>
      )}

      {ordered.map((type) => (counts[type] > 0 ? SECTIONS[type]() : null))}
    </div>
  );
}
