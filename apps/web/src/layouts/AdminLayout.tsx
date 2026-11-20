import { NavLink, Outlet } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { ForbiddenState } from "../components/StateViews";
import { useAuth } from "../hooks/useAuth";

const ADMIN_NAV_ITEMS = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/accounts", label: "Accounts & Logs", end: false },
  { to: "/admin/manga", label: "Manga Catalog", end: false },
  { to: "/admin/reports", label: "Moderation Reports", end: false },
  { to: "/admin/etl", label: "Source ETL & CDC", end: false },
];

/**
 * Isolated Admin layout boundary (`01_PRODUCT_SCOPE_AND_REQUIREMENTS.md` §3.2).
 * Backend always enforces Admin RBAC independently of this UI boundary.
 */
export function AdminLayout() {
  const { isAdmin } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      {!isAdmin ? (
        <main className="mx-auto w-full max-w-[var(--mr-max-width)] flex-1 px-4 py-6">
          <ForbiddenState
            title="Administrator access required"
            description="Only active Administrator accounts may access moderation, catalog administration, and ETL controls."
          />
        </main>
      ) : (
        <div className="mx-auto grid w-full max-w-[var(--mr-max-width)] flex-1 grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[220px_1fr]">
          <aside
            aria-label="Admin navigation"
            className="h-fit rounded-[var(--mr-radius-lg)] border p-3"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <p
              className="px-2 pb-2 text-xs font-semibold tracking-wider uppercase"
              style={{ color: "var(--mr-accent)" }}
            >
              Admin Console
            </p>
            <nav className="flex flex-col gap-1 text-sm">
              {ADMIN_NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className="rounded-[var(--mr-radius-sm)] px-2.5 py-1.5"
                  style={({ isActive }) => ({
                    backgroundColor: isActive ? "var(--mr-bg-elevated)" : "transparent",
                    color: isActive ? "var(--mr-text-primary)" : "var(--mr-text-secondary)",
                  })}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </aside>
          <main>
            <Outlet />
          </main>
        </div>
      )}
    </div>
  );
}
