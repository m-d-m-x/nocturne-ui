import React, { useState } from "react";
import { Switch } from "@headlessui/react";
import { EyeIcon, EyeOffIcon } from "../common/icons";
import { useSettings } from "../../contexts/SettingsContext";

const PROVIDERS = [
  { id: "groq", label: "Groq (whisper-large-v3-turbo)" },
  { id: "openai", label: "OpenAI (whisper-1)" },
];

export default function VoiceSearch() {
  const { settings, updateSetting } = useSettings();
  const [revealKey, setRevealKey] = useState(false);

  const enabled = !!settings.voiceSearchEnabled;
  const provider = settings.voiceSttProvider || "groq";
  const apiKey = settings.voiceSttApiKey || "";

  return (
    <div className="flex flex-col gap-y-8 px-4 py-2">
      <div className="flex items-start justify-between">
        <div className="pr-6">
          <h3 className="text-[36px] font-[580] text-white tracking-tight">
            Voice Search
          </h3>
          <p className="text-[24px] text-white/60 mt-2">
            Hold the V key to dictate a search query. Audio is sent to your chosen
            transcription provider, and the result is searched on Spotify.
          </p>
        </div>
        <Switch
          checked={enabled}
          onChange={(v) => updateSetting("voiceSearchEnabled", v)}
          className={`${
            enabled ? "bg-white/90" : "bg-white/25"
          } relative inline-flex h-[44px] w-[80px] shrink-0 cursor-pointer rounded-full transition-colors`}
        >
          <span
            className={`${
              enabled ? "translate-x-[38px]" : "translate-x-[4px]"
            } inline-block h-[36px] w-[36px] mt-[4px] transform rounded-full bg-black transition-transform`}
          />
        </Switch>
      </div>

      <div className={enabled ? "" : "opacity-40 pointer-events-none"}>
        <label className="block text-[28px] font-[580] text-white mb-3">
          Provider
        </label>
        <div className="flex gap-3 flex-wrap">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => updateSetting("voiceSttProvider", p.id)}
              className={`text-[22px] px-5 py-3 rounded-2xl border transition-colors ${
                provider === p.id
                  ? "bg-white text-black border-white"
                  : "bg-white/5 text-white/80 border-white/20"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="block text-[28px] font-[580] text-white mt-8 mb-3">
          API Key
        </label>
        <div className="flex items-center gap-3">
          <input
            type={revealKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => updateSetting("voiceSttApiKey", e.target.value)}
            placeholder={provider === "groq" ? "gsk_..." : "sk-..."}
            spellCheck={false}
            autoComplete="off"
            className="flex-1 text-[22px] bg-white/5 text-white placeholder-white/30 rounded-2xl px-5 py-3 border border-white/20 focus:outline-none focus:border-white/60"
          />
          <button
            type="button"
            onClick={() => setRevealKey((v) => !v)}
            className="p-3 rounded-2xl bg-white/5 border border-white/20"
            aria-label={revealKey ? "Hide API key" : "Show API key"}
          >
            {revealKey ? (
              <EyeOffIcon className="w-[28px] h-[28px] text-white" />
            ) : (
              <EyeIcon className="w-[28px] h-[28px] text-white" />
            )}
          </button>
        </div>
        <p className="text-[18px] text-white/40 mt-2">
          Stored locally on the device. Never sent anywhere except the provider.
        </p>
      </div>
    </div>
  );
}
