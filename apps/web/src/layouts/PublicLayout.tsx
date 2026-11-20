import { Outlet } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[var(--mr-max-width)] flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer
        className="border-t py-4 text-center text-xs"
        style={{
          borderColor: "var(--mr-border-subtle)",
          color: "var(--mr-text-muted)",
        }}
      >
        Manga Reader Web Application · Package v2.0 Compliant Catalog &amp; Reader Engine
      </footer>
    </div>
  );
}
