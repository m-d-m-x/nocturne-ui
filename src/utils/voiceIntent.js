/**
 * Local intent classification.
 *
 * This used to POST the transcript to Groq/OpenAI for classification, which
 * meant two provider calls per voice command (one for STT, one for intent) and
 * broke outright when Groq decommissioned llama-3.3-70b-versatile. The command
 * set here is small and closed, so matching it locally is faster, free, works
 * offline, and cannot 404 when a vendor retires a model.
 *
 * Search commands are parsed as  action + category + query, e.g.
 *   "play artist bob dylan"            -> artist:"bob dylan",               type=artist first
 *   "play song stairway to heaven"     -> track:"stairway to heaven",       type=track  first
 *   "play album hyperdrama by justice" -> album:"hyperdrama" artist:"justice", type=album first
 */

// "spotify" is deliberately absent: stripping it here would break the "on
// spotify" suffix rule below and leave a dangling "on" in the search query.
const FILLER = /\b(?:hey|ok|okay|please|could you|can you|would you)\b/g;
const WAKE_PREFIX = /^(?:nocturne|spotify)\s+/;

// Longest/most specific phrasings first - "turn it down" must beat "turn it".
const RULES = [
  {
    type: "pause",
    re: /\b(?:pause|stop(?: (?:the )?(?:music|playback|song))?|shut up|be quiet)\b/,
  },
  {
    type: "skip",
    re: /\b(?:skip(?: (?:this|it|ahead|forward))?|next(?: (?:one|track|song))?|forward)\b/,
  },
  {
    type: "previous",
    re: /\b(?:previous(?: (?:one|track|song))?|go back|back (?:a|one) (?:track|song)|last (?:track|song)|rewind|restart)\b/,
  },
  {
    type: "volume_up",
    re: /\b(?:volume up|turn it up|turn up|louder|crank it|more volume)\b/,
  },
  {
    type: "volume_down",
    re: /\b(?:volume down|turn it down|turn down|quieter|softer|lower (?:the )?volume|less volume)\b/,
  },
  {
    type: "resume",
    re: /^(?:play|resume|unpause|continue|go|keep going|play it|start|continue playing)$/,
  },
];

// Liked Songs is a library collection, not a searchable item: without this
// "play my liked songs" became a track search for the literal phrase. Checked
// after the transport rules above, so "stop playing my liked songs" pauses, and
// only behind the action-word gate, so the bare phrase does nothing.
const LIKED_SONGS =
  /\b(?:liked|saved|hearted|favou?rite)\s+(?:songs|tracks|music)\b|\bmy (?:likes|favou?rites)\b/;

// "volume 40", "set the volume to 40", "turn it up to 40 percent"
const VOLUME_SET =
  /\b(?:volume|sound|loudness)\b[^0-9]{0,20}(\d{1,3})|\bto (\d{1,3})\s*(?:percent|%)/;

// Leading verbs to strip when the rest of the utterance is the search query.
const SEARCH_PREFIX =
  /^(?:play|put on|pull up|listen to|find|search for|search|look for|queue(?: up)?|start)\s+/;
const SEARCH_SUFFIX = /\s+(?:on spotify|please|for me)$/;

// The spoken category noun, e.g. the "artist" in "play artist bob dylan".
const CATEGORIES = [
  { category: "artist", re: /^(?:the\s+)?(?:artist|band|group|musician)\s+/ },
  { category: "album", re: /^(?:the\s+)?(?:album|record|lp)\s+/ },
  { category: "track", re: /^(?:the\s+)?(?:song|track|tune)\s+/ },
  { category: "playlist", re: /^(?:the\s+)?playlist\s+/ },
  { category: "show", re: /^(?:the\s+)?(?:podcast|show)\s+/ },
];

// Spotify returns each item type in its own bucket and ignores the order of the
// `type` parameter, so the ordering that actually matters is the one we read
// results back in. This is that order, most-likely-intended first.
const TYPE_PRIORITY = {
  artist: ["artist", "album", "track", "playlist"],
  album: ["album", "artist", "track", "playlist"],
  track: ["track", "album", "artist", "playlist"],
  playlist: ["playlist", "album", "artist", "track"],
  show: ["show", "playlist", "artist", "album"],
};
const DEFAULT_TYPES = ["track", "album", "artist", "playlist"];

// Field filters only exist for these; playlists and shows are free-text only.
const FIELD_FILTER = { artist: "artist", album: "album", track: "track" };

function normalize(transcript) {
  return (transcript || "")
    .toLowerCase()
    .replace(/[.,!?;:]+/g, " ")
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(WAKE_PREFIX, "");
}

function clampLevel(n) {
  return Math.max(0, Math.min(100, n));
}

/** Quote multi-word values so `album:hyperdrama artist:justice` binds correctly. */
function field(name, value) {
  return /\s/.test(value) ? `${name}:"${value}"` : `${name}:${value}`;
}

function buildSearch(text) {
  let rest = text;
  let category = null;

  for (const c of CATEGORIES) {
    if (c.re.test(rest)) {
      category = c.category;
      rest = rest.replace(c.re, "").trim();
      break;
    }
  }

  // "<name> by <artist>" - the trailing half is always the performer.
  let name = rest;
  let by = null;
  const byMatch = rest.match(/^(.+?)\s+by\s+(.+)$/);
  if (byMatch) {
    name = byMatch[1].trim();
    by = byMatch[2].trim();
  }

  const parts = [];
  const filterName = FIELD_FILTER[category];
  if (name) parts.push(filterName ? field(filterName, name) : name);
  if (by) parts.push(field("artist", by));

  return {
    query: [name, by].filter(Boolean).join(" by "),
    spotifyQuery: parts.join(" "),
    category,
    types: TYPE_PRIORITY[category] || DEFAULT_TYPES,
  };
}

export function classifyIntent(transcript) {
  const text = normalize(transcript);
  if (!text) return { type: "unknown", args: { transcript: "" } };

  const vol = text.match(VOLUME_SET);
  if (vol) {
    const level = parseInt(vol[1] ?? vol[2], 10);
    if (!Number.isNaN(level)) {
      return { type: "volume_set", args: { level: clampLevel(level) } };
    }
  }

  // Transport commands are themselves the action word.
  for (const rule of RULES) {
    if (rule.re.test(text)) return { type: rule.type, args: {} };
  }

  // Everything past this point acts on the user's library or playback, so it
  // requires an explicit leading verb. Without this gate any stray speech the
  // wake word happened to catch - a snatch of conversation, the tail of a
  // podcast - became a search and started playing something. Silence is the
  // right response to "stairway to heaven"; "play stairway to heaven" is not
  // ambiguous.
  if (!SEARCH_PREFIX.test(text)) {
    return { type: "unknown", args: { transcript: text } };
  }

  const stripped = text
    .replace(SEARCH_PREFIX, "")
    .replace(SEARCH_SUFFIX, "")
    .trim();
  if (!stripped) return { type: "unknown", args: { transcript: text } };

  if (LIKED_SONGS.test(stripped)) return { type: "liked", args: {} };

  return { type: "search", args: buildSearch(stripped) };
}

const CATEGORY_LABEL = {
  artist: "artist",
  album: "album",
  track: "song",
  playlist: "playlist",
  show: "podcast",
};

export function intentLabel(intent) {
  switch (intent.type) {
    case "resume":
      return "Resuming";
    case "pause":
      return "Pausing";
    case "skip":
      return "Skipping";
    case "previous":
      return "Going back";
    case "volume_up":
      return "Volume up";
    case "volume_down":
      return "Volume down";
    case "volume_set":
      return `Volume ${intent.args?.level ?? "?"}%`;
    case "liked":
      return "Playing Liked Songs";
    case "unknown":
      return "Didn't catch a command";
    default: {
      const label = CATEGORY_LABEL[intent.args?.category];
      return label ? `Playing ${label}` : "Searching";
    }
  }
}
