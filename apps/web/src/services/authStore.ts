import { createContext } from "react";
import type { UserSummary } from "./apiTypes";

export type UserRole = "ANONYMOUS" | "READER" | "ADMIN";
export type UserAccountStatus = "PENDING_VERIFICATION" | "ACTIVE" | "LOCKED";
export type AuthUser = UserSummary;

export interface AuthState {
  status: "idle" | "loading" | "authenticated" | "unauthenticated";
  user: AuthUser | null;
  accessToken: string | null;
  role: UserRole;
  isAuthenticated: boolean;
  isAdmin: boolean;
  loginWithCredentials: (identifier: string, password: string) => Promise<AuthUser>;
  logoutSession: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setSessionUser: (user: AuthUser | null) => void;
  clearSession: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);
