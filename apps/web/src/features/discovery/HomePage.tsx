import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MangaCard } from "../../components/MangaCard";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { useAuth } from "../../hooks/useAuth";
import { apiClient } from "../../services/apiClient";

export function HomePage() {
  const { isAuthenticated, user } = useAuth();

  const latestQuery = useQuery({
    queryKey: ["catalog", "home", "UPDATED_DESC"],
    queryFn: () => apiClient.listCatalog({ sort: "UPDATED_DESC", page: 1, pageSize: 12 }),
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
            <p
              className="text-xs font-semibold tracking-wider uppercase"
              style={{ color: "var(--mr-accent)" }}
            >
              Discovery Hub
            </p>
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
                to="/history"
                className="rounded-[var(--mr-radius-sm)] border px-4 py-2 text-sm font-medium"
                style={{
                  borderColor: "var(--mr-border-strong)",
                  color: "var(--mr-text-primary)",
                }}
              >
                Continue Reading
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

      {/* Personalized Recommendations (UC-10.2) */}
      {isAuthenticated && myRecsQuery.data && myRecsQuery.data.data.items.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
                Recommended For You
              </h2>
              <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                Method: {myRecsQuery.data.data.method}
                {myRecsQuery.data.data.fallbackReason
                  ? ` · ${myRecsQuery.data.data.fallbackReason}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {myRecsQuery.data.data.items.map((manga) => (
              <MangaCard key={manga.mangaId} manga={manga} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Latest Updated Catalog */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
            Latest Updated
          </h2>
          <Link
            to="/explore?sort=UPDATED_DESC"
            className="text-xs font-medium underline"
            style={{ color: "var(--mr-accent)" }}
          >
            View all →
          </Link>
        </div>

        {latestQuery.isLoading ? (
          <LoadingState label="Loading latest manga catalog..." />
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {latestQuery.data?.data.map((manga) => (
              <MangaCard key={manga.mangaId} manga={manga} />
            ))}
          </div>
        )}
      </section>

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
