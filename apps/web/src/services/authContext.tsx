import { useMemo, useState, type ReactNode } from "react";
import { AuthContext, type AuthState, type AuthUser, type UserRole } from "./authStore";

export interface AuthProviderProps {
  children: ReactNode;
  initialUser?: AuthUser | null;
}

/**
 * Foundation authentication state abstraction (`02_SCREEN_FRAME_EVENT_FLOWS.md` §1.2).
 * Never trusted as authorization authority — server enforces RBAC & session checks.
 */
export function AuthProvider({ children, initialUser = null }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);

  const value = useMemo<AuthState>(() => {
    const role: UserRole = user ? user.role : "ANONYMOUS";
    const isAuthenticated = user !== null && user.status === "ACTIVE";
    const isAdmin = isAuthenticated && user.role === "ADMIN";
    return {
      status: user ? "authenticated" : "unauthenticated",
      user,
      role,
      isAuthenticated,
      isAdmin,
      setSessionUser: setUser,
      clearSession: () => setUser(null),
    };
  }, [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
