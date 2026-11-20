import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MangaCard } from "../../components/MangaCard";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { apiClient } from "../../services/apiClient";

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") || "";
  const tab = (searchParams.get("tab") || "manga") as "manga" | "creators";
  const roleFilter = searchParams.get("role") || "";
  const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);

  const [input, setInput] = useState(q);

  const mangaQuery = useQuery({
    queryKey: ["search", "manga", q, page],
    queryFn: () => apiClient.searchManga(q, page),
    enabled: tab === "manga" && q.trim().length > 0,
  });

  const creatorsQuery = useQuery({
    queryKey: ["search", "creators", q, roleFilter],
    queryFn: () => apiClient.searchCreators(q, roleFilter || undefined),
    enabled: tab === "creators" && q.trim().length > 0,
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    next.set("q", input.trim());
    next.set("page", "1");
    setSearchParams(next);
  }

  function setTab(nextTab: "manga" | "creators") {
    const next = new URLSearchParams(searchParams);
    next.set("tab", nextTab);
    next.set("page", "1");
    setSearchParams(next);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
          Search Catalog &amp; Creators
        </h1>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search by canonical title, localized alt-title, or creator name..."
            className="min-w-60 flex-1 rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          />
          <button
            type="submit"
            className="cursor-pointer rounded-[var(--mr-radius-sm)] px-5 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--mr-accent)" }}
          >
            Search
          </button>
        </form>

        <div
          className="flex flex-wrap items-center gap-2 border-b pb-2"
          style={{ borderColor: "var(--mr-border-subtle)" }}
        >
          <button
            type="button"
            onClick={() => setTab("manga")}
            className="cursor-pointer rounded-[var(--mr-radius-sm)] px-3 py-1.5 text-sm font-medium"
            style={{
              backgroundColor: tab === "manga" ? "var(--mr-bg-elevated)" : "transparent",
              color: tab === "manga" ? "var(--mr-accent)" : "var(--mr-text-secondary)",
            }}
          >
            Manga Titles
          </button>
          <button
            type="button"
            onClick={() => setTab("creators")}
            className="cursor-pointer rounded-[var(--mr-radius-sm)] px-3 py-1.5 text-sm font-medium"
            style={{
              backgroundColor: tab === "creators" ? "var(--mr-bg-elevated)" : "transparent",
              color: tab === "creators" ? "var(--mr-accent)" : "var(--mr-text-secondary)",
            }}
          >
            Authors &amp; Artists
          </button>
          {tab === "creators" ? (
            <select
              aria-label="Filter creator role"
              value={roleFilter}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams);
                if (e.target.value) next.set("role", e.target.value);
                else next.delete("role");
                setSearchParams(next);
              }}
              className="ml-auto rounded border px-2 py-1 text-xs"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="">All roles</option>
              <option value="AUTHOR">Author</option>
              <option value="ARTIST">Artist</option>
            </select>
          ) : null}
        </div>
      </div>

      {!q.trim() ? (
        <EmptyState
          title="Enter a search keyword"
          description="Supports case-insensitive, accent-insensitive, localized alt-title, and fuzzy matching."
        />
      ) : tab === "manga" ? (
        mangaQuery.isLoading ? (
          <LoadingState label="Searching manga..." />
        ) : mangaQuery.isError ? (
          <ErrorState onRetry={() => void mangaQuery.refetch()} />
        ) : mangaQuery.data && mangaQuery.data.data.length === 0 ? (
          <EmptyState
            title={`No manga found for "${q}"`}
            description="Try a shorter keyword or switch to the Authors & Artists tab."
          />
        ) : (
          <div className="space-y-4">
            <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
              Found {mangaQuery.data?.meta.total ?? 0} manga result(s) for &ldquo;{q}&rdquo;
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {mangaQuery.data?.data.map((manga) => (
                <MangaCard key={manga.mangaId} manga={manga} />
              ))}
            </div>
          </div>
        )
      ) : creatorsQuery.isLoading ? (
        <LoadingState label="Searching authors & artists..." />
      ) : creatorsQuery.isError ? (
        <ErrorState onRetry={() => void creatorsQuery.refetch()} />
      ) : creatorsQuery.data && creatorsQuery.data.data.length === 0 ? (
        <EmptyState title={`No creators found for "${q}"`} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {creatorsQuery.data?.data.map((creator) => (
            <Link
              key={creator.creatorId}
              to={`/author/${creator.creatorId}/${creator.slug}`}
              className="flex items-center justify-between rounded-[var(--mr-radius-md)] border p-4 transition-colors"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <div>
                <h2 className="font-semibold" style={{ color: "var(--mr-text-primary)" }}>
                  {creator.name}
                </h2>
                <div className="mt-1 flex gap-1.5">
                  {creator.roles.map((r) => (
                    <span
                      key={r}
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                      style={{
                        backgroundColor: "var(--mr-bg-elevated)",
                        color: "var(--mr-accent)",
                      }}
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
              <span className="text-xs font-mono" style={{ color: "var(--mr-text-muted)" }}>
                {creator.publicWorkCount} works
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
