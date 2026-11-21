import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CatalogPagination } from "../../components/CatalogPagination";
import {
  buildListDataStory,
  GenreRadarChart,
  InteractiveDonutChart,
  InteractiveTrendChart,
  StorytellingNarrativeCard,
} from "../../components/DataStoryCharts";
import { MangaCard } from "../../components/MangaCard";
import { EmptyState, ErrorState, LoadingState, NotFoundState } from "../../components/StateViews";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { ApiClientError, apiClient } from "../../services/apiClient";

export function ReadingListDetailPage() {
  const { listId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<"items" | "stats">("items");
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 280);
  const [statusFilter, setStatusFilter] = useState("");
  const [readingStatusFilter, setReadingStatusFilter] = useState("");
  const [sort, setSort] = useState("ADDED_DESC");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<"poster" | "compact" | "horizontal">("poster");

  useEffect(() => {
    setPage(1);
  }, [listId, debouncedQ, statusFilter, readingStatusFilter, sort]);

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["lists", "detail", listId],
    queryFn: () => apiClient.getListDetail(listId),
    enabled: Boolean(listId),
  });

  const itemsQuery = useQuery({
    queryKey: ["lists", "items", listId, debouncedQ, statusFilter, readingStatusFilter, sort, page],
    queryFn: () =>
      apiClient.listItemsInList(listId, {
        q: debouncedQ.trim() || undefined,
        status: statusFilter || undefined,
        readingStatus: readingStatusFilter || undefined,
        sort,
        page,
        pageSize: 24,
      }),
    enabled: Boolean(detailQuery.data),
  });

  const statsQuery = useQuery({
    queryKey: ["lists", "stats", listId],
    queryFn: () => apiClient.getListStats(listId),
    enabled: Boolean(detailQuery.data) && tab === "stats",
  });

  if (detailQuery.isLoading) return <LoadingState label="Loading reading list..." />;
  if (detailQuery.isError) {
    if (detailQuery.error instanceof ApiClientError && detailQuery.error.status === 404) {
      return (
        <NotFoundState
          title="Reading list not found"
          description="This private list does not exist or belongs to another account."
        />
      );
    }
    return <ErrorState onRetry={() => void detailQuery.refetch()} />;
  }

  const list = detailQuery.data?.data;
  if (!list) return <NotFoundState title="Reading list not found" />;

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiClient.updateList(listId, { name: editName.trim(), description: editDesc.trim() });
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["lists", "detail", listId] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not update list.");
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await apiClient.deleteList(listId);
      navigate("/reading-lists");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not delete list.");
    }
  }

  async function handleRemoveItem(mangaId: string) {
    setError(null);
    try {
      await apiClient.removeItemFromList(listId, mangaId);
      void queryClient.invalidateQueries({ queryKey: ["lists", "items", listId] });
      void queryClient.invalidateQueries({ queryKey: ["lists", "detail", listId] });
      void queryClient.invalidateQueries({ queryKey: ["lists", "stats", listId] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not remove item.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/reading-lists"
            className="text-xs underline"
            style={{ color: "var(--mr-accent)" }}
          >
            ← All My Lists
          </Link>
          <h1 className="mt-1 text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
            {list.name}
          </h1>
          {list.description ? (
            <p className="mt-1 text-sm" style={{ color: "var(--mr-text-secondary)" }}>
              {list.description}
            </p>
          ) : null}
          <p className="mt-1 text-xs" style={{ color: "var(--mr-text-muted)" }}>
            {list.itemCount} stored item(s)
            {typeof list.visibleItemCount === "number" && list.visibleItemCount !== list.itemCount
              ? ` (${list.visibleItemCount} currently public)`
              : ""}{" "}
            · Private
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setEditName(list.name);
              setEditDesc(list.description ?? "");
              setEditing((o) => !o);
            }}
            className="cursor-pointer rounded border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--mr-border-strong)" }}
          >
            Edit List
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="cursor-pointer rounded px-3 py-1.5 text-xs font-semibold text-white"
                style={{ backgroundColor: "var(--mr-danger)" }}
              >
                Confirm Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="cursor-pointer rounded border px-2.5 py-1.5 text-xs"
                style={{ borderColor: "var(--mr-border-strong)" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="cursor-pointer rounded border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--mr-danger)", color: "var(--mr-danger)" }}
            >
              Delete List
            </button>
          )}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-xs font-medium" style={{ color: "var(--mr-danger)" }}>
          {error}
        </p>
      ) : null}

      {editing ? (
        <form
          onSubmit={handleSaveEdit}
          className="max-w-lg space-y-3 rounded-[var(--mr-radius-md)] border p-4"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
          }}
        >
          <input
            type="text"
            required
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full rounded border px-3 py-1.5 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
              color: "var(--mr-text-primary)",
            }}
          />
          <textarea
            rows={2}
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            className="w-full rounded border px-3 py-1.5 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
              color: "var(--mr-text-primary)",
            }}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="cursor-pointer rounded border px-3 py-1 text-xs"
              style={{ borderColor: "var(--mr-border-strong)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cursor-pointer rounded px-3 py-1 text-xs font-semibold text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Save
            </button>
          </div>
        </form>
      ) : null}

      <div className="flex gap-2 border-b pb-2" style={{ borderColor: "var(--mr-border-subtle)" }}>
        <button
          type="button"
          onClick={() => setTab("items")}
          className="cursor-pointer rounded px-3 py-1.5 text-sm font-medium"
          style={{
            backgroundColor: tab === "items" ? "var(--mr-bg-elevated)" : "transparent",
            color: tab === "items" ? "var(--mr-accent)" : "var(--mr-text-secondary)",
          }}
        >
          Manga Titles
        </button>
        <button
          type="button"
          onClick={() => setTab("stats")}
          className="cursor-pointer rounded px-3 py-1.5 text-sm font-medium"
          style={{
            backgroundColor: tab === "stats" ? "var(--mr-bg-elevated)" : "transparent",
            color: tab === "stats" ? "var(--mr-accent)" : "var(--mr-text-secondary)",
          }}
        >
          Dynamic Metadata Statistics
        </button>
      </div>

      {tab === "items" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter items in list..."
              className="rounded border px-3 py-1.5"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            />
            <select
              aria-label="Filter by publication status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded border px-2.5 py-1.5"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="">All Publication Status</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="hiatus">Hiatus</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              aria-label="Filter by my reading status"
              value={readingStatusFilter}
              onChange={(e) => setReadingStatusFilter(e.target.value)}
              className="rounded border px-2.5 py-1.5"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="">All Reading Statuses</option>
              <option value="READING">Reading</option>
              <option value="PLAN_TO_READ">Plan to Read</option>
              <option value="COMPLETED">Completed</option>
              <option value="ON_HOLD">On Hold</option>
              <option value="DROPPED">Dropped</option>
            </select>
            <select
              aria-label="Sort reading list items"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded border px-2.5 py-1.5"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="ADDED_DESC">Recently Added</option>
              <option value="TITLE_ASC">Title (A–Z)</option>
              <option value="RATING_DESC">Highest Rated</option>
            </select>
            <div
              className="ml-auto flex overflow-hidden rounded border"
              style={{ borderColor: "var(--mr-border-strong)" }}
            >
              {(
                [
                  { id: "poster", label: "Grid" },
                  { id: "compact", label: "Compact" },
                  { id: "horizontal", label: "List" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setViewMode(m.id)}
                  className="cursor-pointer px-2.5 py-1 font-medium"
                  style={{
                    backgroundColor:
                      viewMode === m.id ? "var(--mr-bg-elevated)" : "var(--mr-bg-surface)",
                    color: viewMode === m.id ? "var(--mr-accent)" : "var(--mr-text-secondary)",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {itemsQuery.isLoading ? (
            <LoadingState variant="grid" count={12} label="Loading list items..." />
          ) : itemsQuery.data && itemsQuery.data.data.length === 0 ? (
            <EmptyState
              title="No manga in this list"
              description="Open any manga detail page and click '+ Reading Lists' to add it here."
            />
          ) : (
            <>
              <div
                className={
                  viewMode === "horizontal"
                    ? "space-y-3"
                    : "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
                }
              >
                {itemsQuery.data?.data.map((manga) => (
                  <MangaCard
                    key={manga.mangaId}
                    manga={manga}
                    variant={viewMode}
                    actionSlot={
                      <button
                        type="button"
                        onClick={() => void handleRemoveItem(manga.mangaId)}
                        className="w-full cursor-pointer rounded border py-1 text-[11px] font-medium"
                        style={{ borderColor: "var(--mr-danger)", color: "var(--mr-danger)" }}
                      >
                        Remove from List
                      </button>
                    }
                  />
                ))}
              </div>
              {itemsQuery.data ? (
                <CatalogPagination
                  page={page}
                  total={itemsQuery.data.meta.total}
                  pageSize={itemsQuery.data.meta.pageSize || 24}
                  hasNext={itemsQuery.data.meta.hasNext}
                  onPageChange={setPage}
                  label="Reading list items pagination"
                />
              ) : null}
            </>
          )}
        </div>
      ) : statsQuery.isLoading ? (
        <LoadingState variant="dashboard" label="Calculating dynamic list metadata statistics..." />
      ) : statsQuery.data?.data.empty ? (
        <EmptyState
          title={statsQuery.data.data.emptyMessage || "Danh sách chưa có truyện nào để thống kê"}
          description="Add one or more public manga titles to this reading list to view distributions."
        />
      ) : statsQuery.data ? (
        <div className="space-y-6">
          <StorytellingNarrativeCard {...buildListDataStory(statsQuery.data.data)} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div
              className="rounded-[var(--mr-radius-md)] border p-4"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                Public Titles
              </p>
              <p className="mt-1 text-xl font-bold">{statsQuery.data.data.totalMangas}</p>
            </div>
            <div
              className="rounded-[var(--mr-radius-md)] border p-4"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                Exported Chapters
              </p>
              <p className="mt-1 text-xl font-bold">{statsQuery.data.data.totalExportedChapters}</p>
            </div>
            <div
              className="rounded-[var(--mr-radius-md)] border p-4"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                Avg List Rating
              </p>
              <p className="mt-1 text-xl font-bold" style={{ color: "var(--mr-warning)" }}>
                {statsQuery.data.data.averageListRating !== null
                  ? statsQuery.data.data.averageListRating.toFixed(2)
                  : "—"}
              </p>
            </div>
            <div
              className="rounded-[var(--mr-radius-md)] border p-4"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                Rated Titles
              </p>
              <p className="mt-1 text-xl font-bold">{statsQuery.data.data.ratedMangaCount}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <InteractiveDonutChart
              title="Publication Status Distribution"
              subtitle="Phân bổ trạng thái phát hành các tựa truyện trong danh sách"
              centerLabel="Titles"
              centerValue={String(statsQuery.data.data.totalMangas)}
              items={statsQuery.data.data.publicationStatusDistribution.map((row) => ({
                key: row.status,
                label: row.status.toUpperCase(),
                value: row.count,
                hint: `${row.status} chiếm ${row.percent}% tổng số đầu truyện trong danh sách.`,
              }))}
            />

            <GenreRadarChart
              title="List Thematic DNA"
              subtitle="Cấu trúc các nhóm chủ đề & thể loại định hình danh sách"
              axes={statsQuery.data.data.tagDistribution.slice(0, 7).map((t) => ({
                label: t.tagName,
                value: t.count,
                displayValue: `${t.count} titles (${t.percent}%)`,
              }))}
            />
          </div>

          <InteractiveTrendChart
            title="Tag Presence Comparison"
            subtitle="So sánh mức độ xuất hiện giữa các thể loại hàng đầu trong danh sách"
            data={statsQuery.data.data.tagDistribution.slice(0, 10).map((t) => ({
              key: t.tagSlug,
              label: t.tagName,
              value: t.count,
              sublabel: `${t.percent}% of list`,
              href: `/search/advanced?includeTags=${encodeURIComponent(t.tagSlug)}`,
            }))}
            valueFormatter={(v) => `${v} titles`}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <div
              className="space-y-2 rounded-[var(--mr-radius-md)] border p-4"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <h3 className="text-sm font-semibold">Tag Distribution Breakdown</h3>
              {statsQuery.data.data.tagDistribution.map((row) => (
                <div key={row.tagSlug} className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <Link
                      to={`/search/advanced?includeTags=${encodeURIComponent(row.tagSlug)}`}
                      className="hover:underline"
                    >
                      {row.tagName}
                    </Link>
                    <span className="font-mono">
                      {row.count} ({row.percent}%)
                    </span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded"
                    style={{ backgroundColor: "var(--mr-bg-elevated)" }}
                  >
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.min(100, row.percent)}%`,
                        backgroundColor: "var(--mr-accent)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div
              className="space-y-3 rounded-[var(--mr-radius-md)] border p-4"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <h3 className="text-sm font-semibold">Top Creators in This List</h3>
              <ul className="space-y-2 text-xs">
                {statsQuery.data.data.topCreators.map((c) => (
                  <li key={c.creatorId} className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">
                      {c.name}{" "}
                      <span style={{ color: "var(--mr-text-muted)" }}>({c.roles.join("/")})</span>
                    </span>
                    <span
                      className="shrink-0 rounded px-2 py-0.5 font-mono"
                      style={{ backgroundColor: "var(--mr-bg-elevated)" }}
                    >
                      {c.workCount} works
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
