import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { frontendConfig } from "../services/config";

export function AppHeader() {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated, isAdmin, user } = useAuth();

  return (
    <header
      className="sticky top-0 z-20 border-b backdrop-blur"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div className="mx-auto flex h-14 max-w-[var(--mr-max-width)] items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link
            to="/"
            className="text-base font-bold tracking-tight"
            style={{ color: "var(--mr-text-primary)" }}
          >
            {frontendConfig.appTitle}
          </Link>
          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-4 text-sm sm:flex"
          >
            <NavLink to="/explore" style={{ color: "var(--mr-text-secondary)" }}>
              Explore
            </NavLink>
            <NavLink to="/search" style={{ color: "var(--mr-text-secondary)" }}>
              Search
            </NavLink>
            {isAuthenticated ? (
              <>
                <NavLink to="/history" style={{ color: "var(--mr-text-secondary)" }}>
                  History
                </NavLink>
                <NavLink to="/reading-lists" style={{ color: "var(--mr-text-secondary)" }}>
                  My Lists
                </NavLink>
                <NavLink to="/settings" style={{ color: "var(--mr-text-secondary)" }}>
                  Settings
                </NavLink>
              </>
            ) : null}
            {isAdmin ? (
              <NavLink to="/admin" style={{ color: "var(--mr-accent)" }}>
                Admin
              </NavLink>
            ) : null}
          </nav>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span
            className="rounded px-2 py-1 font-mono"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              color: "var(--mr-text-secondary)",
            }}
          >
            {user ? `${user.displayName} (${user.role})` : "Guest"}
          </span>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle color theme"
            className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-2.5 py-1 font-medium"
            style={{
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </div>
    </header>
  );
}
