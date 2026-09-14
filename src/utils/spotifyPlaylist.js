/**
 * Spotify renamed the playlist track collection from `tracks` to `items`:
 *
 *   - playlist object:      `tracks: { href, total }`  ->  `items: { href, total }`
 *   - track list endpoint:  `/playlists/{id}/tracks`   ->  `/playlists/{id}/items`  (old one 403s)
 *   - track wrapper:        `{ added_at, track }`      ->  `{ added_at, item }`
 *   - `/playlists/{id}` no longer embeds the track list at all
 *
 * The old spellings are kept as fallbacks so this works against either shape,
 * and so the synthetic `liked-songs` / radio-mix objects we build locally
 * (which still use `tracks`) keep working.
 */

export function getPlaylistTrackCount(playlist) {
  return playlist?.items?.total ?? playlist?.tracks?.total ?? 0;
}

export function playlistItemsUrl(playlistId, limit = 100) {
  return `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=${limit}`;
}

/** Unwrap one entry of a playlist items page into the track/episode itself. */
export function unwrapPlaylistItem(entry) {
  return entry?.item ?? entry?.track ?? null;
}

export function unwrapPlaylistItems(entries) {
  return (entries || []).map(unwrapPlaylistItem).filter(Boolean);
}
