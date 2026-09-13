import React, { useEffect } from "react";
import { useGradientState } from "../../hooks/useGradientState";
import { useAuth } from "../../hooks/useAuth";
import { useNetwork } from "../../hooks/useNetwork";
import NocturneIcon from "../common/icons/NocturneIcon";
import GradientBackground from "../common/GradientBackground";
import NetworkScreen from "./NetworkScreen";

const AuthScreen = ({ onAuthSuccess }) => {
  const { isLoading, error, login, isAuthenticated } = useAuth();
  const { isConnected: isNetworkConnected, initialCheckDone } = useNetwork();
  const [gradientState, updateGradientColors] = useGradientState();

  useEffect(() => {
    updateGradientColors(null, "auth");
  }, [updateGradientColors]);

  useEffect(() => {
    if (isAuthenticated) {
      onAuthSuccess();
    }
  }, [isAuthenticated, onAuthSuccess]);

  if (!initialCheckDone) {
    return (
      <div className="h-screen flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl">
        <GradientBackground gradientState={gradientState} />
        <div className="relative z-10 flex flex-col items-center justify-center">
          <NocturneIcon className="h-12 w-auto animate-pulse" />
        </div>
      </div>
    );
  }

  if (!isNetworkConnected) {
    return <NetworkScreen isConnectionLost={true} />;
  }

  const isCompletingRedirect =
    isLoading && new URLSearchParams(window.location.search).has("code");

  return (
    <div className="h-screen flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl">
      <GradientBackground gradientState={gradientState} />

      <div className="relative z-10 w-full max-w-6xl px-6 flex flex-col items-center space-y-8">
        <NocturneIcon className="h-12 w-auto" />

        <div className="space-y-4 text-center">
          <h2 className="text-4xl text-white tracking-tight font-[580]">
            {isCompletingRedirect
              ? "Finishing sign-in..."
              : "Log in with Spotify"}
          </h2>
          {error && (
            <p className="text-[length:calc(var(--text-scale)*24px)] text-red-400 tracking-tight max-w-[28rem]">
              {error}
            </p>
          )}
        </div>

        {!isCompletingRedirect && (
          <button
            onClick={login}
            disabled={isLoading}
            className="text-3xl font-[560] text-black tracking-tight bg-white rounded-full px-10 py-4 disabled:opacity-50"
          >
            Log in with Spotify
          </button>
        )}
      </div>
    </div>
  );
};

export default AuthScreen;
