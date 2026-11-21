import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CatalogPagination } from "../../components/CatalogPagination";
import { MangaCard } from "../../components/MangaCard";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { ApiClientError, apiClient, type ReadingLibraryEntry } from "../../services/apiClient";

const STATUS_TABS = [
  { value: "ALL", label: "All" },
  { value: "READING", label: "Reading" },
  { value: "PLAN_TO_READ", label: "Plan to Read" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "DROPPED", label: "Dropped" },
] as const;

const EDITABLE_STATUSES = [
  { value: "READING", label: "Reading" },
  { value: "PLAN_TO_READ", label: "Plan to Read" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "DROPPED", label: "Dropped" },
];

export function LibraryPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [pubStatusFilter, setPubStatusFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState<"UPDATED" | "TITLE" | "TITLE_DESC" | "RATING" | "VIEWS">(
    "UPDATED",
  );
  const [viewMode, setViewMode] = useState<"grid" | "compact" | "list">("grid");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const libraryQuery = useQuery({
    queryKey: ["reader", "library"],
    queryFn: () => apiClient.listMyReadingStatuses(),
  });

  const entries: ReadingLibraryEntry[] = useMemo(
    () => (Array.isArray(libraryQuery.data?.data) ? libraryQuery.data.data : []),
    [libraryQuery.data],
  );

  const availableTags = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of entries) {
      for (const tag of item.tags ?? []) {
        map.set(tag.slug, tag.name);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const countsByStatus = useMemo(() => {
    const map: Record<string, number> = { ALL: entries.length };
    for (const st of EDITABLE_STATUSES) map[st.value] = 0;
    for (const item of entries) {
      const key = item.readingStatus || item.status;
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = entries.filter((item) => {
      const status = item.readingStatus || item.status;
      if (activeTab !== "ALL" && status !== activeTab) return false;
      if (pubStatusFilter && item.publicationStatus !== pubStatusFilter) return false;
      if (tagFilter && !(item.tags ?? []).some((t) => t.slug === tagFilter)) return false;
      if (q && !item.title.toLowerCase().includes(q)) return false;
      return true;
    });
    const sorted = [...list];
    if (sort === "TITLE") {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === "TITLE_DESC") {
      sorted.sort((a, b) => b.title.localeCompare(a.title));
    } else if (sort === "RATING") {
      sorted.sort((a, b) => (b.averageRating ?? 0) - (a.averageRating ?? 0));
    } else if (sort === "VIEWS") {
      sorted.sort((a, b) => (b.totalViews ?? 0) - (a.totalViews ?? 0));
    }
    return sorted;
  }, [entries, activeTab, pubStatusFilter, tagFilter, search, sort]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, pubStatusFilter, tagFilter, search, sort, pageSize]);

  const pagedEntries = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  async function handleStatusUpdate(mangaId: string, nextStatus: string) {
    setFeedback(null);
    try {
      if (!nextStatus) {
        await apiClient.clearReadingStatus(mangaId);
        setFeedback({ tone: "ok", text: "Removed from reading library." });
      } else {
        await apiClient.setReadingStatus(mangaId, nextStatus);
        setFeedback({ tone: "ok", text: `Updated status to ${nextStatus.replace(/_/g, " ")}.` });
      }
      void queryClient.invalidateQueries({ queryKey: ["reader", "library"] });
    } catch (err) {
      setFeedback({
        tone: "err",
        text: err instanceof ApiClientError ? err.message : "Failed to update status.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
            Personal Reading Library
          </h1>
          <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
            Track reading status separately from your custom Reading Lists and exact-page resume
            checkpoints.
          </p>
        </div>
        <Link
          to="/reading-lists"
          className="rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: "var(--mr-border-strong)", color: "var(--mr-accent)" }}
        >
          Manage Custom Reading Lists →
        </Link>
      </div>

      {/* Status Filter Tabs */}
      <div
        role="tablist"
        aria-label="Reading status filter"
        className="flex flex-wrap gap-2 border-b pb-3"
        style={{ borderColor: "var(--mr-border-subtle)" }}
      >
        {STATUS_TABS.map((tab) => {
          const active = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-xs font-medium"
              style={{
                backgroundColor: active ? "var(--mr-accent)" : "var(--mr-bg-surface)",
                borderColor: active ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                color: active ? "#ffffff" : "var(--mr-text-secondary)",
              }}
            >
              {tab.label} ({countsByStatus[tab.value] ?? 0})
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <input
          type="search"
          aria-label="Search library titles"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter titles in library..."
          className="min-w-52 flex-1 rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm sm:max-w-xs"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
            color: "var(--mr-text-primary)",
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter publication status"
            value={pubStatusFilter}
            onChange={(e) => setPubStatusFilter(e.target.value)}
            className="rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <option value="">All Pub. Statuses</option>
            <option value="ongoing">Ongoing</option>
            <option value="completed">Completed</option>
            <option value="hiatus">Hiatus</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {availableTags.length > 0 ? (
            <select
              aria-label="Filter library by tag"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="">All Tags</option>
              {availableTags.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          <select
            aria-label="Sort library"
            value={sort}
            onChange={(e) =>
              setSort(e.target.value as "UPDATED" | "TITLE" | "TITLE_DESC" | "RATING" | "VIEWS")
            }
            className="rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <option value="UPDATED">Recently Updated</option>
            <option value="TITLE">Title (A–Z)</option>
            <option value="TITLE_DESC">Title (Z–A)</option>
            <option value="RATING">Highest Rated</option>
            <option value="VIEWS">Most Viewed</option>
          </select>
          <select
            aria-label="Library items per page"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-[var(--mr-radius-sm)] border px-2 py-1.5"
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
          <div
            className="flex rounded-[var(--mr-radius-sm)] border"
            style={{ borderColor: "var(--mr-border-strong)" }}
          >
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className="cursor-pointer px-2.5 py-1 font-medium"
              style={{
                backgroundColor: viewMode === "grid" ? "var(--mr-bg-elevated)" : "transparent",
                color: viewMode === "grid" ? "var(--mr-accent)" : "var(--mr-text-secondary)",
              }}
            >
              Grid
            </button>
            <button
              type="button"
              onClick={() => setViewMode("compact")}
              className="cursor-pointer px-2.5 py-1 font-medium"
              style={{
                backgroundColor: viewMode === "compact" ? "var(--mr-bg-elevated)" : "transparent",
                color: viewMode === "compact" ? "var(--mr-accent)" : "var(--mr-text-secondary)",
              }}
            >
              Compact
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className="cursor-pointer px-2.5 py-1 font-medium"
              style={{
                backgroundColor: viewMode === "list" ? "var(--mr-bg-elevated)" : "transparent",
                color: viewMode === "list" ? "var(--mr-accent)" : "var(--mr-text-secondary)",
              }}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {feedback ? (
        <p
          role="status"
          className="text-xs font-medium"
          style={{ color: feedback.tone === "ok" ? "var(--mr-success)" : "var(--mr-danger)" }}
        >
          {feedback.text}
        </p>
      ) : null}

      {libraryQuery.isLoading ? (
        <LoadingState variant="grid" count={12} label="Loading your reading library..." />
      ) : libraryQuery.isError ? (
        <ErrorState onRetry={() => void libraryQuery.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No manga in this reading status"
          description="Set a reading status from any manga detail page to track your progress here."
          action={
            <Link
              to="/explore"
              className="rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Explore Manga
            </Link>
          }
        />
      ) : (
        <>
          <div
            className={
              viewMode === "list"
                ? "space-y-3"
                : "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
            }
          >
            {pagedEntries.map((item) => {
              const currentStatus = item.readingStatus || item.status;
              return (
                <MangaCard
                  key={item.mangaId}
                  manga={item}
                  variant={
                    viewMode === "list"
                      ? "horizontal"
                      : viewMode === "compact"
                        ? "compact"
                        : "poster"
                  }
                  subtitle={
                    item.progress ? `Saved checkpoint: Page ${item.progress.pageNumber}` : undefined
                  }
                  actionSlot={
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        aria-label={`Change reading status for ${item.title}`}
                        value={currentStatus}
                        onChange={(e) => void handleStatusUpdate(item.mangaId, e.target.value)}
                        className="min-w-0 flex-1 rounded border px-1.5 py-1 text-[11px]"
                        style={{
                          backgroundColor: "var(--mr-bg-elevated)",
                          borderColor: "var(--mr-border-subtle)",
                          color: "var(--mr-text-primary)",
                        }}
                      >
                        {EDITABLE_STATUSES.map((st) => (
                          <option key={st.value} value={st.value}>
                            {st.label}
                          </option>
                        ))}
                        <option value="">Remove Status</option>
                      </select>
                      {item.progress ? (
                        <Link
                          to={`/manga/${item.slug}/chapter/${item.progress.chapterId}`}
                          className="rounded px-2 py-1 text-[11px] font-semibold text-white"
                          style={{ backgroundColor: "var(--mr-accent)" }}
                        >
                          Continue
                        </Link>
                      ) : null}
                    </div>
                  }
                />
              );
            })}
          </div>

          <CatalogPagination
            page={page}
            total={filtered.length}
            pageSize={pageSize}
            hasNext={page * pageSize < filtered.length}
            onPageChange={setPage}
            label="Library pagination"
          />
        </>
      )}
    </div>
  );
}
