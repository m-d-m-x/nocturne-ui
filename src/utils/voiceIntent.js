const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = `You classify a voice command for a Spotify music player. Return JSON only — no prose.

Intent types:
- "resume": resume/play/unpause with no search query
- "pause": pause or stop playback
- "skip": next track
- "previous": previous track
- "volume_up": louder / turn it up
- "volume_down": quieter / turn it down
- "volume_set": set to specific volume (include args.level 0-100)
- "search": play, queue, or find specific music (include args.query)

Return exactly: {"type":"<intent>","args":{}}`;

export async function classifyIntent(transcript, provider, apiKey) {
  const url = provider === "openai" ? OPENAI_CHAT_URL : GROQ_CHAT_URL;
  const model = provider === "openai" ? "gpt-4o-mini" : "llama-3.3-70b-versatile";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      response_format: { type: "json_object" },
      max_tokens: 60,
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(`Intent API ${res.status}`);

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  return { type: parsed.type || "search", args: parsed.args || {} };
}

export function intentLabel(intent) {
  switch (intent.type) {
    case "resume":      return "Resuming";
    case "pause":       return "Pausing";
    case "skip":        return "Skipping";
    case "previous":    return "Going back";
    case "volume_up":   return "Volume up";
    case "volume_down": return "Volume down";
    case "volume_set":  return `Volume ${intent.args?.level ?? "?"}%`;
    default:            return "Searching";
  }
}
