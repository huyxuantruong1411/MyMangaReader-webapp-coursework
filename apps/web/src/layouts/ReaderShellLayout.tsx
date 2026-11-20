import { Outlet } from "react-router-dom";

/**
 * Immersive dark-canvas layout for the Chapter Reader Engine (`07_READER_ENGINE_PROGRESS_MEDIA.md`).
 * The chapter canvas provides its own sticky reader top/bottom navigation bars.
 */
export function ReaderShellLayout() {
  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: "var(--mr-bg-reader)", color: "#f8fafc" }}
    >
      <Outlet />
    </div>
  );
}
