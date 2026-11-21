import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CatalogPagination } from "../../components/CatalogPagination";
import { MangaCard } from "../../components/MangaCard";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { useAuth } from "../../hooks/useAuth";
import { apiClient, type ReadingHistoryEntry } from "../../services/apiClient";

const HOME_LATEST_PAGE_SIZE = 24;

export function HomePage() {
  const { isAuthenticated, user } = useAuth();
  const [homePage, setHomePage] = useState(1);

  const latestQuery = useQuery({
    queryKey: ["catalog", "home", "UPDATED_DESC", homePage],
    queryFn: () =>
      apiClient.listCatalog({
        sort: "UPDATED_DESC",
        page: homePage,
        pageSize: HOME_LATEST_PAGE_SIZE,
      }),
  });

  const recentlyAddedQuery = useQuery({
    queryKey: ["catalog", "home", "CREATED_DESC"],
    queryFn: () => apiClient.listCatalog({ sort: "CREATED_DESC", page: 1, pageSize: 6 }),
  });

  const topRatedQuery = useQuery({
    queryKey: ["catalog", "home", "RATING_DESC"],
    queryFn: () => apiClient.listCatalog({ sort: "RATING_DESC", page: 1, pageSize: 6 }),
  });

  const myRecsQuery = useQuery({
    queryKey: ["recommendations", "me", user?.accountId],
    queryFn: () => apiClient.getMyRecommendations(6),
    enabled: isAuthenticated,
  });

  const historyQuery = useQuery({
    queryKey: ["reader", "history", "home", user?.accountId],
    queryFn: () => apiClient.getReadingHistory(1),
    enabled: isAuthenticated,
  });

  const continueReadingItems = useMemo(() => {
    const entries = historyQuery.data?.data ?? [];
    const seen = new Set<string>();
    const deduped: ReadingHistoryEntry[] = [];
    for (const item of entries) {
      if (seen.has(item.mangaId)) continue;
      seen.add(item.mangaId);
      deduped.push(item);
      if (deduped.length >= 6) break;
    }
    return deduped;
  }, [historyQuery.data]);

  const recMethodLabel = myRecsQuery.data?.data
    ? myRecsQuery.data.data.method === "POPULAR_FALLBACK"
      ? "Popular fallback (read & rate more titles to unlock personalized recommendations)"
      : myRecsQuery.data.data.method === "USER_BASED"
        ? "Personalized collaborative filtering"
        : myRecsQuery.data.data.method
    : "";

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <section
        className="rounded-[var(--mr-radius-lg)] border p-6"
        style={{
          backgroundColor: "var(--mr-bg-surface)",
          borderColor: "var(--mr-border-subtle)",
        }}
      >
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p
                className="text-xs font-semibold tracking-wider uppercase"
                style={{ color: "var(--mr-accent)" }}
              >
                Discovery Hub
              </p>
              {latestQuery.data && latestQuery.data.meta.total > 0 ? (
                <span
                  className="rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-text-secondary)",
                  }}
                >
                  {latestQuery.data.meta.total.toLocaleString()} titles ·{" "}
                  {Math.max(
                    1,
                    Math.ceil(latestQuery.data.meta.total / HOME_LATEST_PAGE_SIZE),
                  ).toLocaleString()}{" "}
                  pages
                </span>
              ) : null}
            </div>
            <h1 className="mt-1 text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
              Read, Track, and Discover Manga
            </h1>
            <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--mr-text-secondary)" }}>
              Explore multi-language chapters with exact-page resume, private reading lists,
              metadata analytics, spoiler-safe discussions, and personalized recommendations.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/explore"
              className="rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Advanced Explore
            </Link>
            {isAuthenticated ? (
              <Link
                to="/library"
                className="rounded-[var(--mr-radius-sm)] border px-4 py-2 text-sm font-medium"
                style={{
                  borderColor: "var(--mr-border-strong)",
                  color: "var(--mr-text-primary)",
                }}
              >
                My Library
              </Link>
            ) : (
              <Link
                to="/login"
                className="rounded-[var(--mr-radius-sm)] border px-4 py-2 text-sm font-medium"
                style={{
                  borderColor: "var(--mr-border-strong)",
                  color: "var(--mr-text-primary)",
                }}
              >
                Sign In to Sync
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Continue Reading Shelf (Authenticated Users with Progress) */}
      {isAuthenticated && continueReadingItems.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
              Continue Reading
            </h2>
            <Link
              to="/history"
              className="text-xs font-medium underline"
              style={{ color: "var(--mr-accent)" }}
            >
              Reading history →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {continueReadingItems.map((entry) => (
              <div
                key={entry.historyId}
                className="flex items-center justify-between gap-3 rounded-[var(--mr-radius-md)] border p-3"
                style={{
                  backgroundColor: "var(--mr-bg-surface)",
                  borderColor: "var(--mr-border-subtle)",
                }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Link
                    to={`/manga/${entry.mangaSlug}`}
                    className="aspect-[3/4] w-11 shrink-0 overflow-hidden rounded-[var(--mr-radius-sm)] border"
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
                        className="flex h-full w-full items-center justify-center text-[10px] font-bold"
                        style={{ color: "var(--mr-text-muted)" }}
                      >
                        {entry.mangaTitle.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </Link>
                  <div className="min-w-0">
                    <Link
                      to={`/manga/${entry.mangaSlug}`}
                      className="block truncate text-sm font-semibold hover:underline"
                      style={{ color: "var(--mr-text-primary)" }}
                    >
                      {entry.mangaTitle}
                    </Link>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--mr-text-secondary)" }}>
                      Ch. {entry.chapterNumber} · Resume Page {entry.resumePageNumber}
                    </p>
                  </div>
                </div>
                <Link
                  to={`/manga/${entry.mangaSlug}/chapter/${entry.resumeChapterId}`}
                  className="shrink-0 rounded-[var(--mr-radius-sm)] px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: "var(--mr-accent)" }}
                >
                  Resume →
                </Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Personalized Recommendations (UC-10.2) */}
      {isAuthenticated && (myRecsQuery.data?.data?.items?.length ?? 0) > 0 ? (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
                Recommended For You
              </h2>
              <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                {recMethodLabel}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {myRecsQuery.data!.data.items.map((manga) => (
              <MangaCard key={manga.mangaId} manga={manga} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Latest Updated Catalog */}
      <section id="home-latest-updated" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
              Latest Updated
            </h2>
            {latestQuery.data && latestQuery.data.meta.total > 0 ? (
              <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                Showing{" "}
                {(
                  (homePage - 1) * HOME_LATEST_PAGE_SIZE +
                  (latestQuery.data.data.length > 0 ? 1 : 0)
                ).toLocaleString()}
                –
                {(
                  (homePage - 1) * HOME_LATEST_PAGE_SIZE +
                  latestQuery.data.data.length
                ).toLocaleString()}{" "}
                of {latestQuery.data.meta.total.toLocaleString()} titles · Page{" "}
                {homePage.toLocaleString()} of{" "}
                {Math.max(
                  1,
                  Math.ceil(latestQuery.data.meta.total / HOME_LATEST_PAGE_SIZE),
                ).toLocaleString()}
              </p>
            ) : null}
          </div>
          <Link
            to="/explore?sort=UPDATED_DESC"
            className="text-xs font-medium underline"
            style={{ color: "var(--mr-accent)" }}
          >
            View all in Explore →
          </Link>
        </div>

        {latestQuery.isLoading ? (
          <LoadingState variant="grid" count={12} label="Loading latest manga catalog..." />
        ) : latestQuery.isError ? (
          <ErrorState
            description="Could not load the catalog from the API."
            onRetry={() => void latestQuery.refetch()}
          />
        ) : latestQuery.data && latestQuery.data.data.length === 0 ? (
          <EmptyState
            title="No public manga available yet"
            description="Run the dev seeder or import a Manga Package v2.0 via the Admin ETL Console."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {latestQuery.data?.data.map((manga) => (
                <MangaCard key={manga.mangaId} manga={manga} />
              ))}
            </div>
            {latestQuery.data ? (
              <CatalogPagination
                page={homePage}
                total={latestQuery.data.meta.total}
                pageSize={HOME_LATEST_PAGE_SIZE}
                hasNext={latestQuery.data.meta.hasNext}
                onPageChange={(nextPage) => {
                  setHomePage(nextPage);
                  const anchor = document.getElementById("home-latest-updated");
                  if (anchor && typeof anchor.scrollIntoView === "function") {
                    anchor.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                label="Home latest updated pagination"
              />
            ) : null}
          </>
        )}
      </section>

      {/* Recently Added Strip */}
      {recentlyAddedQuery.data && recentlyAddedQuery.data.data.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
              Recently Added
            </h2>
            <Link
              to="/explore?sort=CREATED_DESC"
              className="text-xs font-medium underline"
              style={{ color: "var(--mr-accent)" }}
            >
              Browse newest →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {recentlyAddedQuery.data.data.map((manga) => (
              <MangaCard key={manga.mangaId} manga={manga} variant="compact" />
            ))}
          </div>
        </section>
      ) : null}

      {/* Top Rated Strip */}
      {topRatedQuery.data && topRatedQuery.data.data.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
              Top Rated
            </h2>
            <Link
              to="/explore?sort=RATING_DESC"
              className="text-xs font-medium underline"
              style={{ color: "var(--mr-accent)" }}
            >
              Browse top rated →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {topRatedQuery.data.data.map((manga) => (
              <MangaCard key={manga.mangaId} manga={manga} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
