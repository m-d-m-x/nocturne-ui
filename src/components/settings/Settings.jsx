import React, { useState, useEffect, useRef } from "react";
import {
  Switch,
  Listbox,
  ListboxButton,
  ListboxOptions,
  ListboxOption,
} from "@headlessui/react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SettingsAccountIcon,
  SettingsGeneralIcon,
  SettingsPlaybackIcon,
  BluetoothIcon,
} from "../common/icons";
import AccountInfo from "./AccountInfo";
import AccountSwitcher from "./AccountSwitcher";
import BluetoothDevices from "./network/BluetoothDevices";
import { useSettings } from "../../contexts/SettingsContext";

const settingsStructure = {
  general: {
    title: "General",
    icon: SettingsGeneralIcon,
    items: [
      {
        id: "start-with-now-playing",
        title: "Start with Now Playing",
        type: "toggle",
        description: "When enabled, the app will open directly to Now Playing.",
        storageKey: "startWithNowPlaying",
        defaultValue: false,
      },
      {
        id: "show-status-bar",
        title: "Toggle Status Bar",
        type: "toggle",
        description: "Show or hide the status bar at the top of the sidebar.",
        storageKey: "showStatusBar",
        defaultValue: true,
      },
      {
        id: "24-hour-time",
        title: "24-Hour Time",
        type: "toggle",
        description:
          "Display the clock inside of the status bar in 24-hour format instead of 12-hour format.",
        storageKey: "use24HourTime",
        defaultValue: false,
      },
      {
        id: "automatic-timezone",
        title: "Automatic Timezone",
        type: "toggle",
        description:
          "Automatically set timezone from network. When off, select a timezone manually.",
        storageKey: "autoTimezoneEnabled",
        defaultValue: true,
      },
      {
        id: "text-size",
        title: "Text Size",
        type: "textSize",
        description: "Set the size of text displayed on the screen.",
        storageKey: "textSize",
        defaultValue: "1",
      },
      {
        id: "factory-reset",
        title: "Factory Reset",
        type: "action",
        description:
          "Erase all stored settings and paired Bluetooth devices. This cannot be undone.",
        action: "factoryReset",
      },
    ],
  },
  network: {
    title: "Network",
    icon: BluetoothIcon,
    items: [
      {
        id: "bluetooth",
        type: "custom",
        component: BluetoothDevices,
      },
    ],
  },
  playback: {
    title: "Playback",
    icon: SettingsPlaybackIcon,
    items: [
      {
        id: "track-scrolling",
        title: "Track Name Scrolling",
        type: "toggle",
        description:
          "Enable or disable the scrolling animation for the track name in the player.",
        storageKey: "trackNameScrollingEnabled",
        defaultValue: true,
      },
      {
        id: "show-lyrics-gesture",
        title: "Swipe to Show Lyrics",
        type: "toggle",
        description:
          "Enable swiping up on the track info to show the lyrics of a song.",
        storageKey: "showLyricsGestureEnabled",
        defaultValue: false,
      },
      {
        id: "song-change-gesture",
        title: "Swipe to Change Song",
        type: "toggle",
        description:
          "Enable left/right swipe gestures to skip to the previous or next song.",
        storageKey: "songChangeGestureEnabled",
        defaultValue: true,
      },
      {
        id: "elapsed-time",
        title: "Show Time Elapsed",
        type: "toggle",
        description: "Display the elapsed track time below the progress bar.",
        storageKey: "elapsedTimeEnabled",
        defaultValue: false,
      },
    ],
  },
  account: {
    title: "Account",
    icon: SettingsAccountIcon,
    items: [
      {
        id: "profile-info",
        title: "Profile Information",
        type: "custom",
      },
      {
        id: "account-switcher",
        title: "Accounts",
        type: "custom",
        component: AccountSwitcher,
      },
      {
        id: "sign-out",
        title: "Sign Out",
        type: "action",
        description: "Sign out of your Spotify account.",
        action: "signOut",
      },
    ],
  },
};

export default function Settings({ accessToken, setActiveSection }) {
  const navigate = useNavigate();
  const [userProfile, setUserProfile] = useState(null);
  const [activeParent, setActiveParent] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const shouldExitToRecents = useRef(false);
  const isProcessingEscape = useRef(false);
  const scrollContainerRef = useRef(null);
  const { settings, updateSetting } = useSettings();
  const [manualTzContinent, setManualTzContinent] = useState("");
  const [manualTimezone, setManualTimezone] = useState("");
  const [timezoneOptions, setTimezoneOptions] = useState([]);
  const [timezoneMap, setTimezoneMap] = useState({});
  const [continents, setContinents] = useState([]);
  const [showFactoryResetDialog, setShowFactoryResetDialog] = useState(false);

  const [showMain, setShowMain] = useState(true);
  const [showParent, setShowParent] = useState(false);

  const [mainClasses, setMainClasses] = useState("translate-x-0 opacity-100");
  const [parentClasses, setParentClasses] = useState(
    "translate-x-full opacity-0",
  );
  const ANIMATION_DURATION = 300;

  useEffect(() => {
    scrollContainerRef.current = document.querySelector(
      ".settings-scroll-container",
    );
  }, []);

  useEffect(() => {
    if (accessToken) {
      fetchSpotifyProfile();
    }
  }, [accessToken]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("http://localhost:5000/device/date");
        if (!res.ok) return;
        const data = await res.json();
        if (
          data &&
          typeof data.timezone === "string" &&
          data.timezone.includes("/")
        ) {
          const parts = data.timezone.split("/");
          const continent = parts[0] || "";
          const region = parts[parts.length - 1] || "";
          setManualTzContinent(continent);
          setManualTimezone(region);
        }
      } catch (_) {}
    })();
  }, []);

  const fetchSpotifyProfile = async () => {
    try {
      const response = await fetch("https://api.spotify.com/v1/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const profile = await response.json();
      setUserProfile(profile);
    } catch (error) {
      console.error("Error fetching Spotify profile:", error);
    }
  };

  const handleToggle = (key) => {
    updateSetting(key, !settings[key]);
  };

  const loadTimezoneOptions = (continent) => {
    if (!continent) {
      setTimezoneOptions([]);
      return;
    }
    setTimezoneOptions(timezoneMap[continent] || []);
  };

  useEffect(() => {
    loadTimezoneOptions(manualTzContinent);
  }, [manualTzContinent, timezoneMap]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("http://localhost:5000/device/date/timezones");
        if (!res.ok) return;
        const data = await res.json();
        if (data && typeof data === "object") {
          const filtered = Object.fromEntries(
            Object.entries(data).filter(([k]) => k !== "Etc"),
          );
          setTimezoneMap(filtered);
          setContinents(Object.keys(filtered));
        }
      } catch (_) {}
    })();
  }, []);

  const applyManualTimezone = async (continent, city) => {
    const tz = continent && city ? `${continent}/${city}` : "";
    try {
      if (tz) {
        fetch("http://localhost:5000/device/date/settimezone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timezone: tz }),
        }).catch(() => {});
      }
    } catch (e) {}
  };

  const handleFactoryReset = async () => {
    try {
      fetch("http://localhost:5000/device/factoryreset", { method: "POST" });
      setShowFactoryResetDialog(false);
    } catch (error) {
      console.error("Error during factory reset:", error);
      setShowFactoryResetDialog(false);
    }
  };

  const handleSignOut = async () => {
    try {
      localStorage.removeItem("spotifyAccessToken");
      localStorage.removeItem("spotifyRefreshToken");
      localStorage.removeItem("spotifyTokenExpiry");
      localStorage.removeItem("spotifyAuthType");
      window.location.reload();
    } catch (error) {
      console.error("Error during sign out:", error);
      localStorage.clear();
      window.location.reload();
    }
  };

  const setTextSize = (size) => {
    try {
      document.documentElement.style.setProperty("--text-scale", size);
      updateSetting("textSize", size);
    } catch (error) {
      console.error("Error setting text size:", error);
      updateSetting("textSize", "1");
    }
  };

  const handleAction = (action) => {
    switch (action) {
      case "textSmall":
        setTextSize("0.75");
        break;
      case "textMedium":
        setTextSize("1");
        break;
      case "textLarge":
        setTextSize("1.25");
        break;
      case "factoryReset":
        setShowFactoryResetDialog(true);
        break;
      case "signOut":
        handleSignOut();
        break;
    }
  };

  const navigateTo = (page) => {
    // Only the main list can navigate forward, and only that branch clears
    // isAnimating - entering here from the detail view would latch it on and
    // freeze navigation for good. The hidden main list is still in the DOM, so
    // a stray click can reach it.
    if (isAnimating || !showMain) return;
    setIsAnimating(true);
    shouldExitToRecents.current = false;

    setMainClasses("-translate-x-full opacity-0");
    setParentClasses("translate-x-0 opacity-100");
    setActiveParent(page);

    setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    }, ANIMATION_DURATION / 3);

    setTimeout(() => {
      setShowMain(false);
      setShowParent(true);
      setIsAnimating(false);
    }, ANIMATION_DURATION);
  };

  const navigateBack = () => {
    if (isAnimating) return;
    setIsAnimating(true);

    if (showParent) {
      setParentClasses("translate-x-full opacity-0");
      setMainClasses("translate-x-0 opacity-100");

      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0;
        }
      }, ANIMATION_DURATION / 3);

      setTimeout(() => {
        setShowParent(false);
        setShowMain(true);
        setActiveParent(null);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    }
  };

  const renderSettingItem = (item) => {
    switch (item.type) {
      case "toggle":
        return (
          <div key={item.id} className="mb-8">
            <div className="flex items-center">
              <Switch
                checked={settings[item.storageKey]}
                onChange={() => handleToggle(item.storageKey)}
                className={`relative inline-flex h-11 w-20 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  settings[item.storageKey] ? "bg-white/40" : "bg-white/10"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-10 w-10 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    settings[item.storageKey]
                      ? "translate-x-9"
                      : "translate-x-0"
                  }`}
                />
              </Switch>
              <span className="ml-3 text-[length:calc(var(--text-scale)*32px)] font-[580] text-white tracking-tight">
                {item.title}
              </span>
            </div>
            <p className="pt-4 text-[length:calc(var(--text-scale)*28px)] font-[560] text-white/60 max-w-[380px] tracking-tight">
              {item.description}
            </p>
            {item.storageKey === "autoTimezoneEnabled" &&
              !settings.autoTimezoneEnabled && (
                <div className="mt-6 space-y-4">
                  <div>
                    <label className="block text-[length:calc(var(--text-scale)*24px)] font-[560] text-white/80 mb-2">
                      Continent
                    </label>
                    <Listbox
                      value={manualTzContinent || null}
                      onChange={(val) => {
                        const v = val || "";
                        setManualTzContinent(v);
                        setManualTimezone("");
                        applyManualTimezone(v, "");
                      }}
                    >
                      <div className="relative w-96">
                        <ListboxButton className="w-full bg-white/10 border border-white/10 rounded-[14px] px-5 py-4 text-white text-[length:calc(var(--text-scale)*24px)] text-left hover:bg-white/15 focus:outline-none">
                          {manualTzContinent || "Select continent"}
                        </ListboxButton>
                        <ListboxOptions className="absolute z-10 mt-2 max-h-72 w-full overflow-auto rounded-[14px] bg-[#1c1c1c] border border-white/10 shadow-lg focus:outline-none custom-scrollbar-hide">
                          {continents.map((c) => (
                            <ListboxOption
                              key={c}
                              value={c}
                              className="cursor-pointer select-none px-5 py-3 text-[length:calc(var(--text-scale)*22px)] text-white/90 data-[focus]:bg-white/10 data-[focus]:text-white"
                            >
                              {c}
                            </ListboxOption>
                          ))}
                        </ListboxOptions>
                      </div>
                    </Listbox>
                  </div>
                  <div>
                    <label className="block text-[length:calc(var(--text-scale)*24px)] font-[560] text-white/80 mb-2">
                      Timezone
                    </label>
                    <Listbox
                      value={manualTimezone || null}
                      onChange={(city) => {
                        const c = city || "";
                        setManualTimezone(c);
                        applyManualTimezone(manualTzContinent, c);
                      }}
                      disabled={!manualTzContinent}
                    >
                      <div className="relative w-96">
                        <ListboxButton
                          className={`w-full border rounded-[14px] px-5 py-4 text-[length:calc(var(--text-scale)*24px)] text-left focus:outline-none ${
                            manualTzContinent
                              ? "bg-white/10 border-white/10 text-white hover:bg-white/15"
                              : "bg-white/5 border-white/10 text-white/40 cursor-not-allowed"
                          }`}
                        >
                          {manualTzContinent
                            ? manualTimezone
                              ? manualTimezone.replace(/_/g, " ")
                              : "Select timezone"
                            : "Select continent first"}
                        </ListboxButton>
                        {manualTzContinent && (
                          <ListboxOptions className="absolute z-10 mt-2 max-h-72 w-full overflow-auto rounded-[14px] bg-[#1c1c1c] border border-white/10 shadow-lg focus:outline-none custom-scrollbar-hide">
                            {timezoneOptions.map((tz) => (
                              <ListboxOption
                                key={tz}
                                value={tz}
                                className="cursor-pointer select-none px-5 py-3 text-[length:calc(var(--text-scale)*22px)] text-white/90 data-[focus]:bg-white/10 data-[focus]:text-white"
                              >
                                {tz.replace(/_/g, " ")}
                              </ListboxOption>
                            ))}
                          </ListboxOptions>
                        )}
                      </div>
                    </Listbox>
                  </div>
                </div>
              )}
          </div>
        );
      case "action":
        return (
          <div key={item.id} className="mb-8">
            <button
              onClick={() => handleAction(item.action)}
              className="bg-white/10 hover:bg-white/20 w-80 transition-colors duration-200 rounded-[12px] px-6 py-3 border border-white/10 focus:outline-none"
            >
              <span className="text-[length:calc(var(--text-scale)*32px)] font-[580] text-white tracking-tight">
                {item.title}
              </span>
            </button>
            <p className="pt-4 text-[length:calc(var(--text-scale)*28px)] font-[560] text-white/60 max-w-[380px] tracking-tight">
              {item.description}
            </p>
          </div>
        );
      case "textSize":
        return (
          <div key={item.id} className="mb-8">
            <span className="text-[length:calc(var(--text-scale)*32px)] font-[580] text-white tracking-tight">
              {item.title}
            </span>
            <div class="flex flex-col mt-4">
              <button
                onClick={() => handleAction("textSmall")}
                className="bg-white/10 hover:bg-white/20 w-80 transition-colors duration-200 rounded-[12px] px-6 py-3 border border-white/10 focus:outline-none"
                style={{
                  backgroundColor:
                    settings[item.storageKey] === "0.75"
                      ? "rgb(255 255 255 / 0.4)"
                      : "",
                }}
              >
                <span className="text-[length:calc(var(--text-scale)*26px)] font-[580] text-white tracking-tight">
                  Small
                </span>
              </button>
              <button
                onClick={() => handleAction("textMedium")}
                className="bg-white/10 hover:bg-white/20 w-80 mt-4 transition-colors duration-200 rounded-[12px] px-6 py-3 border border-white/10 focus:outline-none"
                style={{
                  backgroundColor:
                    settings[item.storageKey] === "1"
                      ? "rgb(255 255 255 / 0.4)"
                      : "",
                }}
              >
                <span className="text-[length:calc(var(--text-scale)*32px)] font-[580] text-white tracking-tight">
                  Medium
                </span>
              </button>
              <button
                onClick={() => handleAction("textLarge")}
                className="bg-white/10 hover:bg-white/20 w-80 mt-4 transition-colors duration-200 rounded-[12px] px-6 py-3 border border-white/10 focus:outline-none"
                style={{
                  backgroundColor:
                    settings[item.storageKey] === "1.25"
                      ? "rgb(255 255 255 / 0.4)"
                      : "",
                }}
              >
                <span className="text-[length:calc(var(--text-scale)*40px)] font-[580] text-white tracking-tight">
                  Large
                </span>
              </button>
            </div>
            <p className="pt-4 text-[length:calc(var(--text-scale)*28px)] font-[560] text-white/60 max-w-[380px] tracking-tight">
              {item.description}
            </p>
          </div>
        );
      case "custom":
        if (item.component) {
          const Component = item.component;
          return <Component key={item.id} />;
        } else if (item.id === "profile-info") {
          return <AccountInfo key={item.id} userProfile={userProfile} />;
        }
        return null;
      default:
        return null;
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isAnimating) return;

      if (e.key === "Escape") {
        if (showParent) {
          navigateBack();
        } else {
          shouldExitToRecents.current = true;
          setActiveSection("recents");
        }

        setTimeout(() => {
          setIsAnimating(false);
        }, ANIMATION_DURATION);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAnimating, showParent, setActiveSection]);

  return (
    <div
      className="h-full overflow-y-auto overflow-x-hidden settings-scroll-container scroll-smooth transform-gpu will-change-transform"
      style={{
        touchAction: "pan-y",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
        willChange: "transform",
      }}
    >
      <style>{`
        .screen-transition {
          transition: transform ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1),
                      opacity ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1);
          will-change: transform, opacity;
        }
        .settings-scroll-container::-webkit-scrollbar {
          display: none;
        }
        .custom-scrollbar-hide::-webkit-scrollbar { display: none; }
        .custom-scrollbar-hide { scrollbar-width: none; -ms-overflow-style: none; }
      `}</style>
      <div className="min-h-full flex flex-col px-12 pt-12 -ml-12">
        <div className="flex-1 relative">
          <div className="relative w-full" style={{ minHeight: "100%" }}>
            <div
              className={`absolute top-0 left-0 w-full screen-transition ${mainClasses}`}
              style={{
                visibility: showMain || isAnimating ? "visible" : "hidden",
                touchAction: "pan-y",
                overflowX: "hidden",
              }}
            >
              <h2 className="text-[length:calc(var(--text-scale)*46px)] font-[580] text-white tracking-tight mb-6">
                Settings
              </h2>
              <div className="space-y-4 mb-12">
                {Object.entries(settingsStructure).map(([key, section]) => (
                  <button
                    key={key}
                    onClick={() => navigateTo(key)}
                    className="flex items-center justify-between w-full p-4 bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/10 focus:outline-none"
                    disabled={isAnimating}
                  >
                    <div className="flex items-center">
                      <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center">
                        <section.icon className="w-7 h-7 text-white" />
                      </div>
                      <span className="text-[length:calc(var(--text-scale)*32px)] ml-4 font-[580] text-white tracking-tight">
                        {section.title}
                      </span>
                    </div>
                    <ChevronRightIcon className="w-8 h-8 text-white/60" />
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`absolute top-0 left-0 w-full screen-transition ${parentClasses}`}
              style={{
                visibility: showParent || isAnimating ? "visible" : "hidden",
                touchAction: "pan-y",
                overflowX: "hidden",
              }}
            >
              <div className="flex items-center mb-4">
                <button
                  onClick={navigateBack}
                  className="mr-4 focus:outline-none"
                  style={{ background: "none" }}
                  disabled={isAnimating}
                >
                  <ChevronLeftIcon className="w-8 h-8 text-white" />
                </button>
                <h2 className="text-[length:calc(var(--text-scale)*46px)] font-[580] text-white tracking-tight">
                  {activeParent && settingsStructure[activeParent].title}
                </h2>
              </div>
              <div className="space-y-6 mb-12">
                {activeParent &&
                  settingsStructure[activeParent].items?.map((item) =>
                    renderSettingItem(item),
                  )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog
        open={showFactoryResetDialog}
        onClose={() => setShowFactoryResetDialog(false)}
        className="relative z-50"
      >
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/60 transition-opacity data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200 data-[enter]:ease-out data-[leave]:ease-in"
        />

        <div className="fixed inset-0 z-50 w-screen overflow-y-auto">
          <div
            className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0"
            style={{ fontFamily: "var(--font-inter)" }}
          >
            <DialogPanel
              transition
              className="relative transform overflow-hidden rounded-[17px] bg-[#161616] px-0 pb-0 pt-5 text-left shadow-xl transition-all data-[closed]:translate-y-4 data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200 data-[enter]:ease-out data-[leave]:ease-in sm:my-8 sm:w-full sm:max-w-[36rem] data-[closed]:sm:translate-y-0 data-[closed]:sm:scale-95"
            >
              <div>
                <div className="text-center">
                  <DialogTitle
                    as="h3"
                    className="text-[length:calc(var(--text-scale)*36px)] font-[560] tracking-tight text-white"
                  >
                    Factory Reset?
                  </DialogTitle>
                  <div className="mt-2">
                    <p className="text-[length:calc(var(--text-scale)*28px)] font-[560] tracking-tight text-white/60">
                      This will erase all stored settings and paired Bluetooth
                      devices. This cannot be undone.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-0 border-t border-slate-100/25">
                <button
                  type="button"
                  onClick={() => setShowFactoryResetDialog(false)}
                  className="inline-flex w-full justify-center px-3 py-3 text-[length:calc(var(--text-scale)*28px)] font-[560] tracking-tight text-[#6c8bd5] shadow-sm sm:col-start-1 border-r border-slate-100/25 bg-transparent hover:bg-white/5 focus:outline-none"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleFactoryReset}
                  className="mt-3 inline-flex w-full justify-center px-3 py-3 text-[length:calc(var(--text-scale)*28px)] font-[560] tracking-tight text-[#fe3b30] shadow-sm sm:col-start-2 sm:mt-0 bg-transparent hover:bg-white/5 focus:outline-none"
                >
                  Reset
                </button>
              </div>
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
