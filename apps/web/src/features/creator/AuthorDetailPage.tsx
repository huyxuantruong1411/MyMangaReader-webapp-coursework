import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CatalogPagination } from "../../components/CatalogPagination";
import { FormattedMarkdownText } from "../../components/FormattedMarkdownText";
import { MangaCard } from "../../components/MangaCard";
import { EmptyState, ErrorState, LoadingState, NotFoundState } from "../../components/StateViews";
import { ApiClientError, apiClient } from "../../services/apiClient";

export function AuthorDetailPage() {
  const { creatorId = "" } = useParams();
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("UPDATED_DESC");
  const [titleFilter, setTitleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<"poster" | "compact" | "horizontal">("poster");
  const [bioLang, setBioLang] = useState<string>("");

  useEffect(() => {
    setPage(1);
  }, [creatorId, status, sort]);

  const detailQuery = useQuery({
    queryKey: ["creator", "detail", creatorId],
    queryFn: () => apiClient.getCreatorDetail(creatorId),
    enabled: Boolean(creatorId),
  });

  const worksQuery = useQuery({
    queryKey: ["creator", "works", creatorId, status, sort, page],
    queryFn: () =>
      apiClient.listCreatorManga(creatorId, {
        status: status || undefined,
        sort,
        page,
      }),
    enabled: Boolean(creatorId),
  });

  const visibleWorks = useMemo(() => {
    const items = worksQuery.data?.data ?? [];
    const q = titleFilter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.tags ?? []).some((t) => t.name.toLowerCase().includes(q)),
    );
  }, [worksQuery.data, titleFilter]);

  if (detailQuery.isLoading)
    return <LoadingState variant="detail" label="Loading creator profile..." />;
  if (detailQuery.isError) {
    if (detailQuery.error instanceof ApiClientError && detailQuery.error.status === 404) {
      return <NotFoundState title="Creator not found" />;
    }
    return <ErrorState onRetry={() => void detailQuery.refetch()} />;
  }
  const creator = detailQuery.data?.data;
  if (!creator) return <NotFoundState title="Creator not found" />;

  const bioLanguages = Object.keys(creator.localizedBiographies || {});
  const displayedBio =
    (bioLang && creator.localizedBiographies[bioLang]) ||
    creator.biography ||
    "No biography available.";
  const linkEntries = Object.entries(creator.links || {});

  return (
    <div className="space-y-6">
      <section
        className="space-y-4 rounded-[var(--mr-radius-lg)] border p-6"
        style={{
          backgroundColor: "var(--mr-bg-surface)",
          borderColor: "var(--mr-border-subtle)",
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase" style={{ color: "var(--mr-accent)" }}>
              Author / Artist Profile
            </p>
            <h1 className="mt-1 text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
              {creator.name}
            </h1>
          </div>
          {bioLanguages.length > 1 ? (
            <select
              aria-label="Biography language"
              value={bioLang}
              onChange={(e) => setBioLang(e.target.value)}
              className="rounded border px-2.5 py-1 text-xs"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="">Default Biography</option>
              {bioLanguages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang.toUpperCase()}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <FormattedMarkdownText content={displayedBio} />

        {linkEntries.length > 0 ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {linkEntries.map(([site, url]) => (
              <a
                key={site}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="rounded border px-2.5 py-1 font-medium underline"
                style={{ borderColor: "var(--mr-border-strong)", color: "var(--mr-accent)" }}
              >
                {site}
              </a>
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
            Public Works ({worksQuery.data?.meta.total ?? 0})
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="search"
              aria-label="Filter works on this page"
              value={titleFilter}
              onChange={(e) => setTitleFilter(e.target.value)}
              placeholder="Filter title or tag..."
              className="w-44 rounded border px-2.5 py-1"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            />
            <select
              aria-label="Filter works status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded border px-2.5 py-1"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="">All Statuses</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="hiatus">Hiatus</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              aria-label="Sort works"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded border px-2.5 py-1"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="UPDATED_DESC">Latest Updated</option>
              <option value="RATING_DESC">Highest Rated</option>
              <option value="VIEWS_DESC">Most Viewed</option>
              <option value="TITLE_ASC">Title (A–Z)</option>
            </select>
            <div
              className="flex overflow-hidden rounded border"
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
                  className="cursor-pointer px-2 py-1 font-medium"
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
        </div>

        {worksQuery.isLoading ? (
          <LoadingState variant="grid" label="Loading creator works..." />
        ) : worksQuery.data && worksQuery.data.data.length === 0 ? (
          <EmptyState title="No public works found" />
        ) : visibleWorks.length === 0 ? (
          <EmptyState
            title={`No works matched "${titleFilter}"`}
            description="Try clearing the filter or checking another page."
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
              {visibleWorks.map((manga) => (
                <MangaCard key={manga.mangaId} manga={manga} variant={viewMode} />
              ))}
            </div>
            {worksQuery.data ? (
              <CatalogPagination
                page={page}
                total={worksQuery.data.meta.total}
                pageSize={worksQuery.data.meta.pageSize || 24}
                hasNext={worksQuery.data.meta.hasNext}
                onPageChange={setPage}
                label="Creator works pagination"
              />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
