import { Link, Outlet } from "react-router-dom";

/**
 * Immersive dark-canvas layout reserved for the Chapter Reader Engine (Phase 6).
 */
export function ReaderShellLayout() {
  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: "var(--mr-bg-reader)", color: "#f8fafc" }}
    >
      <header
        className="flex h-12 items-center justify-between border-b px-4 text-xs"
        style={{ borderColor: "#1f2937" }}
      >
        <Link to="/" className="font-semibold text-sky-400">
          ← Back to Catalog
        </Link>
        <span className="font-mono text-slate-400">Reader Engine Shell (Phase 6)</span>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
