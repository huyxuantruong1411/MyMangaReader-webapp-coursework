import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { MangaCard } from "../../components/MangaCard";
import { EmptyState, ErrorState, LoadingState, NotFoundState } from "../../components/StateViews";
import { ApiClientError, apiClient } from "../../services/apiClient";

export function AuthorDetailPage() {
  const { creatorId = "" } = useParams();
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("UPDATED_DESC");
  const [bioLang, setBioLang] = useState<string>("");

  const detailQuery = useQuery({
    queryKey: ["creator", "detail", creatorId],
    queryFn: () => apiClient.getCreatorDetail(creatorId),
    enabled: Boolean(creatorId),
  });

  const worksQuery = useQuery({
    queryKey: ["creator", "works", creatorId, status, sort],
    queryFn: () =>
      apiClient.listCreatorManga(creatorId, {
        status: status || undefined,
        sort,
      }),
    enabled: Boolean(creatorId),
  });

  if (detailQuery.isLoading) return <LoadingState label="Loading creator profile..." />;
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

        <p className="whitespace-pre-line text-sm" style={{ color: "var(--mr-text-secondary)" }}>
          {displayedBio}
        </p>

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
          <div className="flex gap-2 text-xs">
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
          </div>
        </div>

        {worksQuery.isLoading ? (
          <LoadingState label="Loading creator works..." />
        ) : worksQuery.data && worksQuery.data.data.length === 0 ? (
          <EmptyState title="No public works found" />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {worksQuery.data?.data.map((manga) => (
              <MangaCard key={manga.mangaId} manga={manga} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
