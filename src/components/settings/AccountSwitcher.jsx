import React, { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import { CheckCircleIcon, SmartphoneIcon } from "../common/icons";
import { useBluetooth } from "../../hooks/useNocturned";
import {
  listProfiles,
  saveProfile,
  switchProfile,
} from "../../services/profiles";

/**
 * Switch the head unit between accounts, and bind a phone to each.
 *
 * Adding an account is deliberately NOT here. It needs a Spotify refresh token,
 * which needs an OAuth round trip, which needs a keyboard - so provisioning
 * happens from the host with scripts/add-account.mjs. This screen only selects
 * between accounts that already exist.
 */
export default function AccountSwitcher() {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [bindingFor, setBindingFor] = useState(null);

  const { devices, fetchDevices } = useBluetooth();

  const load = useCallback(async () => {
    try {
      const listing = await listProfiles();
      setProfiles(listing.profiles || []);
      setActiveId(listing.activeId || null);
      setError(null);
    } catch (err) {
      setError(err.message || "Could not read profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    fetchDevices(true);
  }, [load, fetchDevices]);

  const confirmSwitch = async () => {
    const target = pending;
    setPending(null);
    if (!target) return;

    setSwitching(true);
    try {
      // Reloads the page on success, so nothing after this runs.
      await switchProfile(target.id);
    } catch (err) {
      setSwitching(false);
      setError(err.message || "Switch failed");
    }
  };

  const bindDevice = async (profile, address) => {
    setBindingFor(null);
    try {
      await saveProfile({
        id: profile.id,
        name: profile.name,
        btAddress: address,
      });
      await load();
    } catch (err) {
      setError(err.message || "Could not save the device");
    }
  };

  const deviceName = (address) => {
    if (!address) return null;
    for (let i = 0; i < devices.length; i++) {
      if (devices[i].address === address) {
        return devices[i].name || devices[i].alias || address;
      }
    }
    return address;
  };

  if (loading) {
    return (
      <div className="space-y-4 mb-8">
        <div className="h-24 bg-white/10 rounded-xl animate-pulse" />
        <div className="h-24 bg-white/10 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (switching) {
    return (
      <div className="mb-8 bg-white/10 rounded-xl p-8 text-center border border-white/10">
        <p className="text-[length:calc(var(--text-scale)*32px)] font-[580] text-white tracking-tight">
          Switching accounts...
        </p>
      </div>
    );
  }

  return (
    <div className="mb-8 space-y-4">
      <h3 className="text-[length:calc(var(--text-scale)*32px)] font-[580] text-white tracking-tight">
        Accounts
      </h3>

      {error && (
        <p className="text-[length:calc(var(--text-scale)*24px)] font-[560] text-red-400 tracking-tight">
          {error}
        </p>
      )}

      {profiles.length === 0 && (
        <div className="bg-white/10 rounded-xl p-8 text-center border border-white/10">
          <p className="text-[length:calc(var(--text-scale)*28px)] font-[580] text-white tracking-tight">
            No accounts saved yet
          </p>
          <p className="text-[length:calc(var(--text-scale)*24px)] font-[560] text-white/60 tracking-tight mt-2">
            The current account is adopted automatically once its token
            refreshes.
          </p>
        </div>
      )}

      {profiles.map((profile) => {
        const isActive = profile.id === activeId;
        const bound = deviceName(profile.btAddress);

        return (
          <div
            key={profile.id}
            className="bg-white/10 rounded-xl p-6 border border-white/10"
          >
            <div className="flex justify-between items-center">
              <div className="min-w-0 flex-1 pr-4">
                <div className="flex items-center">
                  {isActive && (
                    <CheckCircleIcon className="w-7 h-7 text-white mr-3 shrink-0" />
                  )}
                  <h4 className="text-[length:calc(var(--text-scale)*28px)] font-[580] text-white tracking-tight truncate">
                    {profile.name}
                  </h4>
                </div>
                <p className="text-[length:calc(var(--text-scale)*24px)] font-[560] text-white/60 tracking-tight mt-1 truncate">
                  {bound ? bound : "No phone bound"}
                  {!profile.hasToken && " - needs provisioning"}
                </p>
              </div>

              {!isActive && (
                <button
                  onClick={() => setPending(profile)}
                  disabled={!profile.hasToken}
                  className="bg-white/10 hover:bg-white/20 disabled:opacity-40 transition-colors duration-200 rounded-xl px-6 py-3 min-w-[160px] border border-white/10"
                >
                  <span className="text-[length:calc(var(--text-scale)*24px)] font-[580] text-white tracking-tight">
                    Switch
                  </span>
                </button>
              )}
            </div>

            <button
              onClick={() => setBindingFor(profile)}
              className="flex items-center mt-4 focus:outline-none"
              style={{ background: "none" }}
            >
              <SmartphoneIcon className="w-6 h-6 text-white/60 mr-2" />
              <span className="text-[length:calc(var(--text-scale)*22px)] font-[560] text-white/60 tracking-tight">
                {bound ? "Change phone" : "Bind a phone"}
              </span>
            </button>
          </div>
        );
      })}

      <Dialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        className="relative z-50"
      >
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/60 transition-opacity data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200"
        />
        <div className="fixed inset-0 z-50 w-screen overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <DialogPanel
              transition
              className="relative transform overflow-hidden rounded-[17px] bg-[#161616] p-8 text-left shadow-xl transition-all data-[closed]:opacity-0 w-full max-w-[36rem]"
            >
              <DialogTitle className="text-[length:calc(var(--text-scale)*32px)] font-[580] text-white tracking-tight">
                Switch to {pending ? pending.name : ""}?
              </DialogTitle>
              <p className="text-[length:calc(var(--text-scale)*24px)] font-[560] text-white/60 tracking-tight mt-3">
                Playback stops and the screen reloads. This takes a few seconds.
              </p>
              <div className="flex gap-4 mt-8">
                <button
                  onClick={() => setPending(null)}
                  className="flex-1 bg-white/10 hover:bg-white/20 transition-colors rounded-xl px-6 py-4 border border-white/10"
                >
                  <span className="text-[length:calc(var(--text-scale)*26px)] font-[580] text-white tracking-tight">
                    Cancel
                  </span>
                </button>
                <button
                  onClick={confirmSwitch}
                  className="flex-1 bg-white hover:bg-white/90 transition-colors rounded-xl px-6 py-4"
                >
                  <span className="text-[length:calc(var(--text-scale)*26px)] font-[580] text-black tracking-tight">
                    Switch
                  </span>
                </button>
              </div>
            </DialogPanel>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(bindingFor)}
        onClose={() => setBindingFor(null)}
        className="relative z-50"
      >
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/60 transition-opacity data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200"
        />
        <div className="fixed inset-0 z-50 w-screen overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <DialogPanel
              transition
              className="relative transform overflow-hidden rounded-[17px] bg-[#161616] p-8 text-left shadow-xl transition-all data-[closed]:opacity-0 w-full max-w-[36rem]"
            >
              <DialogTitle className="text-[length:calc(var(--text-scale)*32px)] font-[580] text-white tracking-tight">
                Phone for {bindingFor ? bindingFor.name : ""}
              </DialogTitle>
              <p className="text-[length:calc(var(--text-scale)*24px)] font-[560] text-white/60 tracking-tight mt-3">
                Switching to this account will connect to it and move the
                network over.
              </p>

              <div className="space-y-3 mt-6 max-h-[40vh] overflow-y-auto">
                {devices.length === 0 && (
                  <p className="text-[length:calc(var(--text-scale)*24px)] font-[560] text-white/60 tracking-tight">
                    No paired devices. Pair the phone under Network first.
                  </p>
                )}
                {devices.map((device) => (
                  <button
                    key={device.address}
                    onClick={() => bindDevice(bindingFor, device.address)}
                    className="flex items-center justify-between w-full bg-white/10 hover:bg-white/20 transition-colors rounded-xl px-6 py-4 border border-white/10"
                  >
                    <span className="text-[length:calc(var(--text-scale)*26px)] font-[580] text-white tracking-tight truncate">
                      {device.name || device.alias || device.address}
                    </span>
                    {bindingFor && bindingFor.btAddress === device.address && (
                      <CheckCircleIcon className="w-6 h-6 text-white shrink-0 ml-3" />
                    )}
                  </button>
                ))}
              </div>

              <button
                onClick={() => bindDevice(bindingFor, "")}
                className="w-full bg-white/10 hover:bg-white/20 transition-colors rounded-xl px-6 py-4 border border-white/10 mt-4"
              >
                <span className="text-[length:calc(var(--text-scale)*26px)] font-[580] text-white tracking-tight">
                  {bindingFor && bindingFor.btAddress ? "Unbind" : "Close"}
                </span>
              </button>
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
