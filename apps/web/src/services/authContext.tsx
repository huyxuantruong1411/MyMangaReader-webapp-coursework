import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiClient } from "./apiClient";
import { AuthContext, type AuthState, type AuthUser, type UserRole } from "./authStore";

const TOKEN_STORAGE_KEY = "mr_access_token";
const USER_STORAGE_KEY = "mr_session_user";

function loadStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

function loadStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export interface AuthProviderProps {
  children: ReactNode;
  initialUser?: AuthUser | null;
}

export function AuthProvider({ children, initialUser }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(() =>
    initialUser !== undefined ? initialUser : loadStoredUser(),
  );
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    initialUser !== undefined ? null : loadStoredToken(),
  );
  const tokenRef = useRef<string | null>(accessToken);
  tokenRef.current = accessToken;

  const persistSession = useCallback((nextUser: AuthUser | null, nextToken: string | null) => {
    setUser(nextUser);
    setAccessToken(nextToken);
    tokenRef.current = nextToken;
    if (typeof window !== "undefined") {
      if (nextToken && nextUser) {
        window.sessionStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
        window.sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
      } else {
        window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        window.sessionStorage.removeItem(USER_STORAGE_KEY);
      }
    }
  }, []);

  const clearSession = useCallback(() => {
    persistSession(null, null);
  }, [persistSession]);

  useEffect(() => {
    apiClient.configureAuth({
      getAccessToken: () => tokenRef.current,
      refreshSession: async () => {
        try {
          const res = await apiClient.refresh();
          persistSession(res.data.user, res.data.accessToken);
          return true;
        } catch {
          clearSession();
          return false;
        }
      },
    });
  }, [clearSession, persistSession]);

  const loginWithCredentials = useCallback(
    async (identifier: string, password: string): Promise<AuthUser> => {
      const res = await apiClient.login({ identifier, password });
      persistSession(res.data.user, res.data.accessToken);
      return res.data.user;
    },
    [persistSession],
  );

  const logoutSession = useCallback(async () => {
    try {
      if (tokenRef.current) {
        await apiClient.logout();
      }
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const refreshProfile = useCallback(async () => {
    if (!tokenRef.current) return;
    try {
      const res = await apiClient.getMe();
      persistSession(res.data, tokenRef.current);
    } catch {
      clearSession();
    }
  }, [clearSession, persistSession]);

  const value = useMemo<AuthState>(() => {
    const role: UserRole = user ? user.role : "ANONYMOUS";
    const isAuthenticated = user !== null && user.status === "ACTIVE";
    const isAdmin = isAuthenticated && user.role === "ADMIN";
    return {
      status: user ? "authenticated" : "unauthenticated",
      user,
      accessToken,
      role,
      isAuthenticated,
      isAdmin,
      loginWithCredentials,
      logoutSession,
      refreshProfile,
      setSessionUser: (next) => setUser(next),
      clearSession,
    };
  }, [user, accessToken, loginWithCredentials, logoutSession, refreshProfile, clearSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
