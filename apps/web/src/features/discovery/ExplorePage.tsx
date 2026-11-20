import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MangaCard } from "../../components/MangaCard";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { apiClient, type TagItem } from "../../services/apiClient";

const SORTS = [
  { value: "UPDATED_DESC", label: "Latest Updated" },
  { value: "VIEWS_DESC", label: "Most Viewed" },
  { value: "RATING_DESC", label: "Highest Rated" },
  { value: "TITLE_ASC", label: "Title (A–Z)" },
];

const DEMOGRAPHICS = ["", "shounen", "shoujo", "seinen", "josei", "none"];
const PUB_STATUSES = ["", "ongoing", "completed", "hiatus", "cancelled", "unknown"];
const CONTENT_RATINGS = ["safe", "suggestive", "erotica", "pornographic", "unknown"];

export function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const sort = searchParams.get("sort") || "UPDATED_DESC";
  const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
  const appliedInclude = useMemo(
    () => (searchParams.get("includeTags") || "").split(",").filter(Boolean),
    [searchParams],
  );
  const appliedExclude = useMemo(
    () => (searchParams.get("excludeTags") || "").split(",").filter(Boolean),
    [searchParams],
  );
  const appliedRatings = useMemo(
    () => (searchParams.get("contentRating") || "").split(",").filter(Boolean),
    [searchParams],
  );
  const appliedDemographic = searchParams.get("demographic") || "";
  const appliedStatus = searchParams.get("status") || "";
  const appliedLanguage = searchParams.get("language") || "";
  const appliedYearFrom = searchParams.get("yearFrom") || "";
  const appliedYearTo = searchParams.get("yearTo") || "";
  const appliedTagMode = searchParams.get("tagMode") || "GROUP_OR";

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draftInclude, setDraftInclude] = useState<string[]>(appliedInclude);
  const [draftExclude, setDraftExclude] = useState<string[]>(appliedExclude);
  const [draftRatings, setDraftRatings] = useState<string[]>(appliedRatings);
  const [draftDemographic, setDraftDemographic] = useState(appliedDemographic);
  const [draftStatus, setDraftStatus] = useState(appliedStatus);
  const [draftLanguage, setDraftLanguage] = useState(appliedLanguage);
  const [draftYearFrom, setDraftYearFrom] = useState(appliedYearFrom);
  const [draftYearTo, setDraftYearTo] = useState(appliedYearTo);
  const [draftTagMode, setDraftTagMode] = useState(appliedTagMode);

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiClient.listTags(),
  });

  const catalogQuery = useQuery({
    queryKey: [
      "catalog",
      "explore",
      sort,
      page,
      appliedInclude.join(","),
      appliedExclude.join(","),
      appliedRatings.join(","),
      appliedDemographic,
      appliedStatus,
      appliedLanguage,
      appliedYearFrom,
      appliedYearTo,
      appliedTagMode,
    ],
    queryFn: () =>
      apiClient.listCatalog({
        sort,
        page,
        pageSize: 24,
        includeTags: appliedInclude.join(",") || undefined,
        excludeTags: appliedExclude.join(",") || undefined,
        tagMode: appliedTagMode,
        contentRating: appliedRatings.join(",") || undefined,
        demographic: appliedDemographic || undefined,
        status: appliedStatus || undefined,
        language: appliedLanguage || undefined,
        yearFrom: appliedYearFrom ? Number(appliedYearFrom) : undefined,
        yearTo: appliedYearTo ? Number(appliedYearTo) : undefined,
      }),
  });

  const groupedTags = useMemo(() => {
    const map = new Map<string, TagItem[]>();
    for (const tag of tagsQuery.data?.data ?? []) {
      const grp = tag.group || "other";
      const list = map.get(grp) ?? [];
      list.push(tag);
      map.set(grp, list);
    }
    return Array.from(map.entries());
  }, [tagsQuery.data]);

  function openDrawer() {
    setDraftInclude(appliedInclude);
    setDraftExclude(appliedExclude);
    setDraftRatings(appliedRatings);
    setDraftDemographic(appliedDemographic);
    setDraftStatus(appliedStatus);
    setDraftLanguage(appliedLanguage);
    setDraftYearFrom(appliedYearFrom);
    setDraftYearTo(appliedYearTo);
    setDraftTagMode(appliedTagMode);
    setDrawerOpen(true);
  }

  function cycleTag(slug: string) {
    // Neutral -> Include -> Exclude -> Neutral
    if (draftInclude.includes(slug)) {
      setDraftInclude((prev) => prev.filter((x) => x !== slug));
      setDraftExclude((prev) => [...prev, slug]);
    } else if (draftExclude.includes(slug)) {
      setDraftExclude((prev) => prev.filter((x) => x !== slug));
    } else {
      setDraftInclude((prev) => [...prev, slug]);
    }
  }

  function toggleRating(rating: string) {
    setDraftRatings((prev) =>
      prev.includes(rating) ? prev.filter((r) => r !== rating) : [...prev, rating],
    );
  }

  function applyFilters() {
    const next = new URLSearchParams();
    next.set("sort", sort);
    next.set("page", "1");
    if (draftInclude.length) next.set("includeTags", draftInclude.join(","));
    if (draftExclude.length) next.set("excludeTags", draftExclude.join(","));
    if (draftTagMode !== "GROUP_OR") next.set("tagMode", draftTagMode);
    if (draftRatings.length) next.set("contentRating", draftRatings.join(","));
    if (draftDemographic) next.set("demographic", draftDemographic);
    if (draftStatus) next.set("status", draftStatus);
    if (draftLanguage.trim()) next.set("language", draftLanguage.trim());
    if (draftYearFrom.trim()) next.set("yearFrom", draftYearFrom.trim());
    if (draftYearTo.trim()) next.set("yearTo", draftYearTo.trim());
    setSearchParams(next);
    setDrawerOpen(false);
  }

  function clearFilters() {
    setDraftInclude([]);
    setDraftExclude([]);
    setDraftRatings([]);
    setDraftDemographic("");
    setDraftStatus("");
    setDraftLanguage("");
    setDraftYearFrom("");
    setDraftYearTo("");
    setDraftTagMode("GROUP_OR");
    setSearchParams({ sort, page: "1" });
    setDrawerOpen(false);
  }

  function setSort(nextSort: string) {
    const next = new URLSearchParams(searchParams);
    next.set("sort", nextSort);
    next.set("page", "1");
    setSearchParams(next);
  }

  function setPage(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(nextPage));
    setSearchParams(next);
  }

  const activeFilterCount =
    appliedInclude.length +
    appliedExclude.length +
    appliedRatings.length +
    (appliedDemographic ? 1 : 0) +
    (appliedStatus ? 1 : 0) +
    (appliedLanguage ? 1 : 0) +
    (appliedYearFrom ? 1 : 0) +
    (appliedYearTo ? 1 : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
            Explore Catalog
          </h1>
          <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
            Public manga catalog with multi-tag Include/Exclude filtering (`safe` strictly excludes
            `unknown`).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Sort catalog"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => (drawerOpen ? setDrawerOpen(false) : openDrawer())}
            className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm font-medium"
            style={{
              backgroundColor: activeFilterCount > 0 ? "var(--mr-accent)" : "var(--mr-bg-surface)",
              borderColor: activeFilterCount > 0 ? "var(--mr-accent)" : "var(--mr-border-strong)",
              color: activeFilterCount > 0 ? "#ffffff" : "var(--mr-text-primary)",
            }}
          >
            Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
          </button>

          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="cursor-pointer text-xs underline"
              style={{ color: "var(--mr-text-muted)" }}
            >
              Clear all
            </button>
          ) : null}
        </div>
      </div>

      {/* Advanced Filter Panel (UC-2.2) */}
      {drawerOpen ? (
        <section
          aria-label="Advanced filters"
          className="space-y-4 rounded-[var(--mr-radius-lg)] border p-5"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
          }}
        >
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Demographic</label>
              <select
                value={draftDemographic}
                onChange={(e) => setDraftDemographic(e.target.value)}
                className="w-full rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              >
                {DEMOGRAPHICS.map((d) => (
                  <option key={d || "all"} value={d}>
                    {d ? d : "All demographics"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Publication Status</label>
              <select
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value)}
                className="w-full rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              >
                {PUB_STATUSES.map((st) => (
                  <option key={st || "all"} value={st}>
                    {st ? st : "All statuses"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Original Language</label>
              <input
                type="text"
                value={draftLanguage}
                onChange={(e) => setDraftLanguage(e.target.value)}
                placeholder="e.g. ja, ko, vi, en"
                className="w-full rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Year From</label>
                <input
                  type="number"
                  value={draftYearFrom}
                  onChange={(e) => setDraftYearFrom(e.target.value)}
                  placeholder="1990"
                  className="w-full rounded-[var(--mr-radius-sm)] border px-2 py-1.5 text-sm"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-text-primary)",
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Year To</label>
                <input
                  type="number"
                  value={draftYearTo}
                  onChange={(e) => setDraftYearTo(e.target.value)}
                  placeholder="2026"
                  className="w-full rounded-[var(--mr-radius-sm)] border px-2 py-1.5 text-sm"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-text-primary)",
                  }}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium">
              Content Rating (selecting <code>safe</code> excludes <code>unknown</code>)
            </p>
            <div className="flex flex-wrap gap-2">
              {CONTENT_RATINGS.map((rating) => {
                const active = draftRatings.includes(rating);
                return (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => toggleRating(rating)}
                    className="cursor-pointer rounded-full border px-3 py-1 text-xs font-medium capitalize"
                    style={{
                      backgroundColor: active ? "var(--mr-accent)" : "var(--mr-bg-elevated)",
                      borderColor: active ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                      color: active ? "#ffffff" : "var(--mr-text-secondary)",
                    }}
                  >
                    {rating}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium">
                Tags — click once to <span style={{ color: "var(--mr-success)" }}>+ Include</span>,
                twice to <span style={{ color: "var(--mr-danger)" }}>− Exclude</span>, third time to
                reset:
              </p>
              <select
                aria-label="Tag matching mode"
                value={draftTagMode}
                onChange={(e) => setDraftTagMode(e.target.value)}
                className="rounded border px-2 py-1 text-xs"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              >
                <option value="GROUP_OR">Group OR / Cross-group AND</option>
                <option value="ALL_AND">Match ALL Included Tags</option>
              </select>
            </div>

            {groupedTags.map(([groupName, tags]) => (
              <div key={groupName}>
                <p
                  className="mb-1 text-[11px] font-semibold tracking-wider uppercase"
                  style={{ color: "var(--mr-text-muted)" }}
                >
                  {groupName}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const inc = draftInclude.includes(tag.slug);
                    const exc = draftExclude.includes(tag.slug);
                    return (
                      <button
                        key={tag.slug}
                        type="button"
                        onClick={() => cycleTag(tag.slug)}
                        className="cursor-pointer rounded border px-2.5 py-1 text-xs font-medium"
                        style={{
                          backgroundColor: inc
                            ? "rgba(52, 211, 153, 0.15)"
                            : exc
                              ? "rgba(248, 113, 113, 0.15)"
                              : "var(--mr-bg-elevated)",
                          borderColor: inc
                            ? "var(--mr-success)"
                            : exc
                              ? "var(--mr-danger)"
                              : "var(--mr-border-subtle)",
                          color: inc
                            ? "var(--mr-success)"
                            : exc
                              ? "var(--mr-danger)"
                              : "var(--mr-text-secondary)",
                        }}
                      >
                        {inc ? "+ " : exc ? "− " : ""}
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={clearFilters}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm"
              style={{
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-secondary)",
              }}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={applyFilters}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-1.5 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Apply Filters
            </button>
          </div>
        </section>
      ) : null}

      {/* Results Grid */}
      {catalogQuery.isLoading ? (
        <LoadingState label="Filtering manga catalog..." />
      ) : catalogQuery.isError ? (
        <ErrorState onRetry={() => void catalogQuery.refetch()} />
      ) : catalogQuery.data && catalogQuery.data.data.length === 0 ? (
        <EmptyState
          title="No manga matched your filters"
          description="Try removing an excluded tag or widening the content rating or year range."
          action={
            <button
              type="button"
              onClick={clearFilters}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Reset Filters
            </button>
          }
        />
      ) : (
        <>
          <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
            Showing {catalogQuery.data?.data.length ?? 0} of {catalogQuery.data?.meta.total ?? 0}{" "}
            public titles
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {catalogQuery.data?.data.map((manga) => (
              <MangaCard key={manga.mangaId} manga={manga} />
            ))}
          </div>

          {catalogQuery.data && (page > 1 || catalogQuery.data.meta.hasNext) ? (
            <div className="flex items-center justify-center gap-3 pt-4">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="cursor-pointer rounded border px-3 py-1.5 text-sm disabled:opacity-40"
                style={{ borderColor: "var(--mr-border-strong)" }}
              >
                ← Previous
              </button>
              <span className="text-xs font-mono">Page {page}</span>
              <button
                type="button"
                disabled={!catalogQuery.data.meta.hasNext}
                onClick={() => setPage(page + 1)}
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
