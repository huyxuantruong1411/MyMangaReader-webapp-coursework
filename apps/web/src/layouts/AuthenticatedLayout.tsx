import { Outlet } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { ForbiddenState } from "../components/StateViews";
import { useAuth } from "../hooks/useAuth";

/**
 * Authenticated Reader layout boundary (`02_SCREEN_FRAME_EVENT_FLOWS.md` §1.1).
 * Protects personal routes (`/history`, `/reading-lists`, `/settings`).
 */
export function AuthenticatedLayout() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[var(--mr-max-width)] flex-1 px-4 py-6">
        {isAuthenticated ? (
          <Outlet />
        ) : (
          <ForbiddenState
            title="Sign in required"
            description="This personal workspace requires an active Reader account. Authentication screens activate in Roadmap Phase 2."
          />
        )}
      </main>
    </div>
  );
}
