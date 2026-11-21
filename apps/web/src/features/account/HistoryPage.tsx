import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CatalogPagination } from "../../components/CatalogPagination";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { apiClient, type ReadingHistoryEntry } from "../../services/apiClient";

function getDateBucket(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfEntry = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfEntry) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "This Week";
  return date.toLocaleDateString();
}

export function ReadingHistoryPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [query, setQuery] = useState("");
  const [viewTypeFilter, setViewTypeFilter] = useState<"ALL" | "VALID_ONLY" | "QUICK_ONLY">("ALL");
  const [sortOrder, setSortOrder] = useState<"RECENT" | "DURATION_DESC" | "TITLE_ASC">("RECENT");

  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  const historyQuery = useQuery({
    queryKey: ["reader", "history", page, pageSize],
    queryFn: () => apiClient.getReadingHistory(page, pageSize),
  });

  const groupedEntries = useMemo(() => {
    const items = historyQuery.data?.data ?? [];
    const norm = query.trim().toLowerCase();
    const filtered = items.filter((entry) => {
      if (viewTypeFilter === "VALID_ONLY" && !entry.isValidView) return false;
      if (viewTypeFilter === "QUICK_ONLY" && entry.isValidView) return false;
      if (
        norm &&
        !entry.mangaTitle.toLowerCase().includes(norm) &&
        !entry.chapterNumber.toLowerCase().includes(norm)
      ) {
        return false;
      }
      return true;
    });

    const sorted = [...filtered];
    if (sortOrder === "DURATION_DESC") {
      sorted.sort((a, b) => b.readingDurationSeconds - a.readingDurationSeconds);
      return [["Sorted by Reading Duration", sorted] as [string, ReadingHistoryEntry[]]];
    }
    if (sortOrder === "TITLE_ASC") {
      sorted.sort((a, b) => a.mangaTitle.localeCompare(b.mangaTitle));
      return [["Sorted by Title (A–Z)", sorted] as [string, ReadingHistoryEntry[]]];
    }

    const groups = new Map<string, ReadingHistoryEntry[]>();
    for (const item of sorted) {
      const bucket = getDateBucket(item.openedAt);
      const list = groups.get(bucket) ?? [];
      list.push(item);
      groups.set(bucket, list);
    }
    return Array.from(groups.entries());
  }, [historyQuery.data, query, viewTypeFilter, sortOrder]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
            Reading History
          </h1>
          <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
            Chronological chapter opens grouped by date with cover art and exact-page resume
            checkpoints.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="search"
            aria-label="Filter history by manga title"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter title or chapter..."
            className="w-48 rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          />
          <select
            aria-label="Filter reading session type"
            value={viewTypeFilter}
            onChange={(e) =>
              setViewTypeFilter(e.target.value as "ALL" | "VALID_ONLY" | "QUICK_ONLY")
            }
            className="rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <option value="ALL">All Opens</option>
            <option value="VALID_ONLY">Valid Reads Only</option>
            <option value="QUICK_ONLY">Quick Opens Only</option>
          </select>
          <select
            aria-label="Sort reading history"
            value={sortOrder}
            onChange={(e) =>
              setSortOrder(e.target.value as "RECENT" | "DURATION_DESC" | "TITLE_ASC")
            }
            className="rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <option value="RECENT">Most Recent</option>
            <option value="DURATION_DESC">Longest Duration</option>
            <option value="TITLE_ASC">Title (A–Z)</option>
          </select>
          <select
            aria-label="History entries per page"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <option value={12}>12 / page</option>
            <option value={24}>24 / page</option>
            <option value={48}>48 / page</option>
          </select>
        </div>
      </div>

      {historyQuery.isLoading ? (
        <LoadingState variant="table" count={8} label="Loading reading history..." />
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
      ) : groupedEntries.every(([, arr]) => arr.length === 0) ? (
        <EmptyState
          title={query ? `No history entries matched "${query}"` : "No entries match filter"}
          description="Try clearing the title filter or checking another page."
        />
      ) : (
        <>
          <div className="space-y-5">
            {groupedEntries.map(([bucket, entries]) =>
              entries.length === 0 ? null : (
                <section key={bucket} className="space-y-2">
                  <h2
                    className="text-xs font-semibold tracking-wider uppercase"
                    style={{ color: "var(--mr-text-muted)" }}
                  >
                    {bucket} ({entries.length})
                  </h2>
                  <ul
                    className="divide-y rounded-[var(--mr-radius-lg)] border"
                    style={{
                      backgroundColor: "var(--mr-bg-surface)",
                      borderColor: "var(--mr-border-subtle)",
                    }}
                  >
                    {entries.map((entry) => (
                      <li
                        key={entry.historyId}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
                        style={{ borderColor: "var(--mr-border-subtle)" }}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3.5">
                          <Link
                            to={`/manga/${entry.mangaSlug}`}
                            className="aspect-[3/4] w-12 shrink-0 overflow-hidden rounded-[var(--mr-radius-sm)] border"
                            style={{
                              backgroundColor: "var(--mr-bg-elevated)",
                              borderColor: "var(--mr-border-subtle)",
                            }}
                          >
                            {entry.mangaCoverUrl ? (
                              <img
                                src={entry.mangaCoverUrl}
                                alt={entry.mangaTitle}
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span
                                className="flex h-full w-full items-center justify-center text-xs font-bold"
                                style={{ color: "var(--mr-text-muted)" }}
                              >
                                {entry.mangaTitle.slice(0, 2).toUpperCase()}
                              </span>
                            )}
                          </Link>
                          <div className="min-w-0 space-y-0.5">
                            <Link
                              to={`/manga/${entry.mangaSlug}`}
                              className="block truncate font-semibold hover:underline"
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
                                  color: entry.isValidView
                                    ? "var(--mr-success)"
                                    : "var(--mr-text-muted)",
                                }}
                              >
                                {entry.isValidView ? "✓ Valid Read" : "Quick Open"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <Link
                          to={`/manga/${entry.mangaSlug}/chapter/${entry.resumeChapterId}`}
                          className="shrink-0 rounded-[var(--mr-radius-sm)] px-3.5 py-1.5 text-xs font-semibold text-white"
                          style={{ backgroundColor: "var(--mr-accent)" }}
                        >
                          Continue (Page {entry.resumePageNumber}) →
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            )}
          </div>

          {historyQuery.data ? (
            <CatalogPagination
              page={page}
              total={historyQuery.data.meta.total}
              pageSize={pageSize}
              hasNext={historyQuery.data.meta.hasNext}
              onPageChange={setPage}
              label="Reading history pagination"
            />
          ) : null}
        </>
      )}
    </div>
  );
}
