import {
  createContext,
  createElement,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import {
  buildAuthorizeUrl,
  consumeRedirectParams,
  exchangeCodeForToken,
  refreshAccessToken,
} from "../services/authService";
import { waitForStableNetwork } from "../utils/networkAwareRequest";

const authInitializationState = {
  refreshing: false,
  lastRefreshTime: 0,
  lastRefreshAttemptFailed: false,
  networkRestoreTimeout: null,
  redirectHandled: false,
};

const DNS_READY_DELAY = 5000;

function useAuthState() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenRefreshing, setTokenRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const refreshTimerRef = useRef(null);
  const initCalledRef = useRef(false);

  const shouldRefreshToken = useCallback(() => {
    const tokenExpiry = localStorage.getItem("spotifyTokenExpiry");
    if (!tokenExpiry) return true;

    const expiryTime = new Date(tokenExpiry);
    const now = new Date();
    return (
      expiryTime <= now || authInitializationState.lastRefreshAttemptFailed
    );
  }, []);

  const tokenReady =
    isAuthenticated && !tokenRefreshing && !shouldRefreshToken();

  const persistSession = useCallback((data) => {
    localStorage.setItem("spotifyAccessToken", data.access_token);
    if (data.refresh_token) {
      localStorage.setItem("spotifyRefreshToken", data.refresh_token);
    }
    localStorage.setItem("spotifyAuthType", "spotify");

    const expiryDate = new Date();
    expiryDate.setSeconds(
      expiryDate.getSeconds() + (data.expires_in || 3600) - 600,
    );
    localStorage.setItem("spotifyTokenExpiry", expiryDate.toISOString());

    setAccessToken(data.access_token);
    if (data.refresh_token) {
      setRefreshToken(data.refresh_token);
    }
    setIsAuthenticated(true);
    authInitializationState.lastRefreshAttemptFailed = false;

    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(
      new CustomEvent("accessTokenUpdated", {
        detail: { accessToken: data.access_token },
      }),
    );

    return expiryDate;
  }, []);

  const refreshTokens = useCallback(async () => {
    setTokenRefreshing(true);
    try {
      const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");
      if (!storedRefreshToken) {
        setTokenRefreshing(false);
        return false;
      }

      const now = Date.now();
      if (now - authInitializationState.lastRefreshTime < 15000) {
        return true;
      }

      if (authInitializationState.refreshing) {
        setTokenRefreshing(false);
        return false;
      }

      authInitializationState.refreshing = true;

      const bypass =
        typeof localStorage !== "undefined" &&
        localStorage.getItem("networkCheckBypass") === "true";
      if (!bypass) {
        await waitForStableNetwork(10000);
      }

      const data = await refreshAccessToken(storedRefreshToken);

      if (data.access_token) {
        const expiryDate = persistSession(data);
        scheduleTokenRefresh(expiryDate);

        authInitializationState.refreshing = false;
        setTokenRefreshing(false);
        authInitializationState.lastRefreshTime = now;
        return true;
      }
      authInitializationState.refreshing = false;
      setTokenRefreshing(false);
      authInitializationState.lastRefreshAttemptFailed = true;
      return false;
    } catch (err) {
      console.error("Token refresh failed:", err);
      if (err.message?.includes("invalid_grant")) {
        logout();
      }
      authInitializationState.refreshing = false;
      setTokenRefreshing(false);
      authInitializationState.lastRefreshAttemptFailed = true;
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistSession]);

  const scheduleTokenRefresh = useCallback(
    (expiryDate) => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      const now = new Date();
      const expiryTime = new Date(expiryDate);
      const timeUntilRefresh = Math.max(
        0,
        expiryTime.getTime() - now.getTime(),
      );

      if (timeUntilRefresh < 60000) {
        refreshTokens();
        return;
      }

      refreshTimerRef.current = setTimeout(() => {
        refreshTokens();
      }, timeUntilRefresh);
    },
    [refreshTokens],
  );

  const logout = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    localStorage.removeItem("spotifyAccessToken");
    localStorage.removeItem("spotifyRefreshToken");
    localStorage.removeItem("spotifyTokenExpiry");
    localStorage.removeItem("spotifyAuthType");
    sessionStorage.removeItem("spotifyCodeVerifier");
    sessionStorage.removeItem("spotifyAuthState");

    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new Event("userLoggedOut"));

    setAccessToken(null);
    setRefreshToken(null);
    setIsAuthenticated(false);
  }, []);

  const login = useCallback(async () => {
    setError(null);
    try {
      const authorizeUrl = await buildAuthorizeUrl();
      window.location.href = authorizeUrl;
    } catch (err) {
      console.error("Failed to start Spotify login:", err);
      setError(err.message || "Failed to start Spotify login");
    }
  }, []);

  useEffect(() => {
    const initAuthState = async () => {
      if (initCalledRef.current) return;
      initCalledRef.current = true;

      if (!authInitializationState.redirectHandled) {
        authInitializationState.redirectHandled = true;
        const redirect = consumeRedirectParams();

        if (redirect?.error) {
          setError(
            redirect.error === "access_denied"
              ? "Spotify login was cancelled"
              : redirect.error,
          );
          setIsLoading(false);
          return;
        }

        if (redirect?.code) {
          const storedState = sessionStorage.getItem("spotifyAuthState");
          const storedVerifier = sessionStorage.getItem(
            "spotifyCodeVerifier",
          );
          sessionStorage.removeItem("spotifyAuthState");
          sessionStorage.removeItem("spotifyCodeVerifier");

          if (!storedVerifier || redirect.state !== storedState) {
            setError("Spotify login failed: state mismatch");
            setIsLoading(false);
            return;
          }

          try {
            const data = await exchangeCodeForToken(
              redirect.code,
              storedVerifier,
            );
            const expiryDate = persistSession(data);
            scheduleTokenRefresh(expiryDate);
          } catch (err) {
            console.error("Failed to complete Spotify login:", err);
            setError(err.message || "Failed to complete Spotify login");
          }
          setIsLoading(false);
          return;
        }
      }

      const storedAccessToken = localStorage.getItem("spotifyAccessToken");
      let storedRefreshToken = localStorage.getItem("spotifyRefreshToken");

      if (!storedRefreshToken && import.meta.env.VITE_SPOTIFY_REFRESH_TOKEN) {
        storedRefreshToken = import.meta.env.VITE_SPOTIFY_REFRESH_TOKEN;
        localStorage.setItem("spotifyRefreshToken", storedRefreshToken);
      }

      if (storedAccessToken && storedRefreshToken) {
        setAccessToken(storedAccessToken);
        setRefreshToken(storedRefreshToken);
        setIsAuthenticated(true);
      } else if (storedRefreshToken) {
        setRefreshToken(storedRefreshToken);
        await refreshTokens();
      }

      setIsLoading(false);
    };

    initAuthState();

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleStorageChange = () => {
      const storedAccessToken = localStorage.getItem("spotifyAccessToken");
      const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");

      if (storedAccessToken && storedRefreshToken) {
        setAccessToken(storedAccessToken);
        setRefreshToken(storedRefreshToken);
        setIsAuthenticated(true);

        const storedExpiry = localStorage.getItem("spotifyTokenExpiry");
        if (storedExpiry) {
          scheduleTokenRefresh(new Date(storedExpiry));
        }
      } else {
        setAccessToken(null);
        setRefreshToken(null);
        setIsAuthenticated(false);
      }
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [scheduleTokenRefresh]);

  useEffect(() => {
    const handleAccessTokenUpdated = (e) => {
      const newAccessToken = e.detail?.accessToken;
      if (newAccessToken) {
        setAccessToken(newAccessToken);

        const storedExpiry = localStorage.getItem("spotifyTokenExpiry");
        if (storedExpiry) {
          scheduleTokenRefresh(new Date(storedExpiry));
        }

        if (!isAuthenticated) {
          const storedRefreshToken = localStorage.getItem(
            "spotifyRefreshToken",
          );
          if (storedRefreshToken) {
            setRefreshToken(storedRefreshToken);
            setIsAuthenticated(true);
          }
        }
      }
    };

    window.addEventListener("accessTokenUpdated", handleAccessTokenUpdated);
    return () => {
      window.removeEventListener(
        "accessTokenUpdated",
        handleAccessTokenUpdated,
      );
    };
  }, [isAuthenticated, scheduleTokenRefresh]);

  useEffect(() => {
    if (accessToken && refreshToken) {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
    }
  }, [accessToken, refreshToken]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleNetworkRestored = async () => {
      if (authInitializationState.networkRestoreTimeout) {
        clearTimeout(authInitializationState.networkRestoreTimeout);
      }

      authInitializationState.networkRestoreTimeout = setTimeout(async () => {
        if (shouldRefreshToken()) {
          try {
            const bypass =
              typeof localStorage !== "undefined" &&
              localStorage.getItem("networkCheckBypass") === "true";
            if (!bypass) {
              await waitForStableNetwork(10000);
            }
            await refreshTokens();
          } catch (error) {
            console.error(
              "Error refreshing token after network restored:",
              error,
            );
          }
        }
      }, DNS_READY_DELAY);
    };

    window.addEventListener("networkRestored", handleNetworkRestored);
    window.addEventListener("online", handleNetworkRestored);

    return () => {
      window.removeEventListener("networkRestored", handleNetworkRestored);
      window.removeEventListener("online", handleNetworkRestored);
      if (authInitializationState.networkRestoreTimeout) {
        clearTimeout(authInitializationState.networkRestoreTimeout);
      }
    };
  }, [isAuthenticated, shouldRefreshToken, refreshTokens]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (tokenReady) return;
    if (tokenRefreshing) return;

    let cancelled = false;
    const retry = async () => {
      if (cancelled) return;
      const success = await refreshTokens();
      if (!success && !cancelled) {
        setTimeout(retry, 15000);
      }
    };
    retry();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, tokenReady, tokenRefreshing, refreshTokens]);

  return {
    isAuthenticated,
    accessToken,
    refreshToken,
    isLoading,
    error,
    login,
    refreshTokens,
    logout,
    tokenReady,
    tokenRefreshing,
  };
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const value = useAuthState();
  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
