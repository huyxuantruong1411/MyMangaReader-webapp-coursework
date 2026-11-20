import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { apiClient } from "../../services/apiClient";

export function ReadingHistoryPage() {
  const [page, setPage] = useState(1);

  const historyQuery = useQuery({
    queryKey: ["reader", "history", page],
    queryFn: () => apiClient.getReadingHistory(page),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
            Reading History
          </h1>
          <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
            Chronological chapter opens with exact-page resume checkpoints.
          </p>
        </div>
      </div>

      {historyQuery.isLoading ? (
        <LoadingState label="Loading reading history..." />
      ) : historyQuery.isError ? (
        <ErrorState onRetry={() => void historyQuery.refetch()} />
      ) : historyQuery.data && historyQuery.data.data.length === 0 ? (
        <EmptyState
          title="No reading history yet"
          description="Open any chapter in the catalog to begin tracking your progress."
          action={
            <Link
              to="/explore"
              className="rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Browse Catalog
            </Link>
          }
        />
      ) : (
        <>
          <ul
            className="divide-y rounded-[var(--mr-radius-lg)] border"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            {historyQuery.data?.data.map((entry) => (
              <li
                key={entry.historyId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
                style={{ borderColor: "var(--mr-border-subtle)" }}
              >
                <div className="space-y-0.5">
                  <Link
                    to={`/manga/${entry.mangaSlug}`}
                    className="font-semibold hover:underline"
                    style={{ color: "var(--mr-text-primary)" }}
                  >
                    {entry.mangaTitle}
                  </Link>
                  <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
                    Opened Ch. {entry.chapterNumber}
                    {entry.chapterTitle ? ` — ${entry.chapterTitle}` : ""} ·{" "}
                    {new Date(entry.openedAt).toLocaleString()}
                  </p>
                  <div
                    className="flex flex-wrap gap-2 text-[11px]"
                    style={{ color: "var(--mr-text-muted)" }}
                  >
                    <span>Duration: {entry.readingDurationSeconds}s</span>
                    <span
                      style={{
                        color: entry.isValidView ? "var(--mr-success)" : "var(--mr-text-muted)",
                      }}
                    >
                      {entry.isValidView ? "✓ Valid View" : "Quick Open"}
                    </span>
                  </div>
                </div>

                <Link
                  to={`/manga/${entry.mangaSlug}/chapter/${entry.resumeChapterId}`}
                  className="rounded-[var(--mr-radius-sm)] px-3.5 py-1.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: "var(--mr-accent)" }}
                >
                  Continue (Page {entry.resumePageNumber}) →
                </Link>
              </li>
            ))}
          </ul>

          {historyQuery.data && (page > 1 || historyQuery.data.meta.hasNext) ? (
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="cursor-pointer rounded border px-3 py-1.5 text-sm disabled:opacity-40"
                style={{ borderColor: "var(--mr-border-strong)" }}
              >
                ← Previous
              </button>
              <span className="font-mono text-xs">Page {page}</span>
              <button
                type="button"
                disabled={!historyQuery.data.meta.hasNext}
                onClick={() => setPage((p) => p + 1)}
                className="cursor-pointer rounded border px-3 py-1.5 text-sm disabled:opacity-40"
                style={{ borderColor: "var(--mr-border-strong)" }}
              >
                Next →
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
