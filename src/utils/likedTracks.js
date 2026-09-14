/**
 * Local answer to "is this track liked?".
 *
 * `/me/tracks/contains` returns 403 without extended quota (so does the whole
 * /contains family: albums, shows, following). Reading the library itself is
 * still allowed, so the saved-track ids are fetched once and membership is
 * answered from a Set. Like/unlike keeps the Set in step, so the heart stays
 * correct without ever re-querying.
 */

const PAGE_SIZE = 50;

// Guards against an enormous library turning startup into hundreds of requests.
// Beyond this the cache is still used, it is just not exhaustive.
const MAX_TRACKS = 2000;

let cachedIds = null;
let inFlight = null;
let cachedForToken = null;

async function fetchAllSavedIds(accessToken) {
  const ids = new Set();
  let url = `https://api.spotify.com/v1/me/tracks?limit=${PAGE_SIZE}`;

  while (url && ids.size < MAX_TRACKS) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Failed to load saved tracks: ${response.status}`);
    }

    const data = await response.json();
    (data.items || []).forEach((item) => {
      const id = item?.track?.id;
      if (id) ids.add(id);
    });

    url = data.next;
  }

  return ids;
}

/** Resolves to a Set of saved track ids, fetching at most once per token. */
export function loadLikedTracks(accessToken) {
  if (!accessToken) return Promise.resolve(new Set());

  if (cachedIds && cachedForToken === accessToken) {
    return Promise.resolve(cachedIds);
  }
  if (inFlight && cachedForToken === accessToken) return inFlight;

  cachedForToken = accessToken;
  inFlight = fetchAllSavedIds(accessToken)
    .then((ids) => {
      cachedIds = ids;
      inFlight = null;
      return ids;
    })
    .catch((err) => {
      inFlight = null;
      cachedForToken = null;
      throw err;
    });

  return inFlight;
}

export async function isTrackLiked(accessToken, trackId) {
  if (!accessToken || !trackId) return false;
  const ids = await loadLikedTracks(accessToken);
  return ids.has(trackId);
}

export function markTrackLiked(trackId) {
  if (cachedIds && trackId) cachedIds.add(trackId);
}

export function markTrackUnliked(trackId) {
  if (cachedIds && trackId) cachedIds.delete(trackId);
}

export function invalidateLikedTracks() {
  cachedIds = null;
  inFlight = null;
  cachedForToken = null;
}
