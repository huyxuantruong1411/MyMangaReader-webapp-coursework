import { Link, Outlet, useLocation } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { useAuth } from "../hooks/useAuth";

/**
 * Authenticated Reader layout boundary (`02_SCREEN_FRAME_EVENT_FLOWS.md` §1.1).
 * Protects personal routes (`/history`, `/reading-lists`, `/settings`).
 */
export function AuthenticatedLayout() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const nextUrl = encodeURIComponent(`${location.pathname}${location.search}`);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[var(--mr-max-width)] flex-1 px-4 py-6">
        {isAuthenticated ? (
          <Outlet />
        ) : (
          <section
            role="alert"
            className="mx-auto my-8 max-w-xl rounded-[var(--mr-radius-lg)] border p-6 text-center"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <p
              className="mb-2 text-xs font-semibold tracking-wider uppercase"
              style={{ color: "var(--mr-warning)" }}
            >
              403 Forbidden
            </p>
            <h2 className="text-lg font-semibold" style={{ color: "var(--mr-text-primary)" }}>
              Sign in required
            </h2>
            <p className="mt-2 text-sm" style={{ color: "var(--mr-text-secondary)" }}>
              This personal workspace requires an active Reader account. Sign in or create an
              account to access your history, reading lists, and preferences.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Link
                to={`/login?next=${nextUrl}`}
                className="rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: "var(--mr-accent)" }}
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="rounded-[var(--mr-radius-sm)] border px-4 py-2 text-sm font-medium"
                style={{
                  borderColor: "var(--mr-border-strong)",
                  color: "var(--mr-text-primary)",
                }}
              >
                Create Account
              </Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
