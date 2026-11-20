import { createContext } from "react";

export type UserRole = "ANONYMOUS" | "READER" | "ADMIN";
export type UserAccountStatus = "PENDING_VERIFICATION" | "ACTIVE" | "LOCKED";

export interface AuthUser {
  accountId: string;
  username: string;
  displayName: string;
  role: Exclude<UserRole, "ANONYMOUS">;
  status: UserAccountStatus;
}

export interface AuthState {
  status: "idle" | "loading" | "authenticated" | "unauthenticated";
  user: AuthUser | null;
  role: UserRole;
  isAuthenticated: boolean;
  isAdmin: boolean;
  setSessionUser: (user: AuthUser | null) => void;
  clearSession: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);
