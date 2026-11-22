import { useState } from "react";
import { Link } from "react-router-dom";
import type { MangaCardItem } from "../services/apiClient";

const RATING_BADGE_COLORS: Record<string, string> = {
  safe: "var(--mr-success)",
  suggestive: "var(--mr-warning)",
  erotica: "var(--mr-danger)",
  pornographic: "var(--mr-danger)",
  unknown: "var(--mr-text-secondary)",
};

function formatContentRatingLabel(rating: string): string {
  return rating === "unknown" ? "unclassified" : rating;
}

export function MangaCard({
  manga,
  subtitle,
  actionSlot,
  variant = "poster",
}: {
  manga: MangaCardItem;
  subtitle?: string;
  actionSlot?: React.ReactNode;
  variant?: "poster" | "compact" | "horizontal";
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showCover = Boolean(manga.coverUrl && failedUrl !== manga.coverUrl);
  const ratingLabel = formatContentRatingLabel(manga.contentRating);
  const ratingColor = RATING_BADGE_COLORS[manga.contentRating] ?? "var(--mr-text-primary)";

  if (variant === "horizontal") {
    const visibleTags = manga.tags.slice(0, 5);
    const overflowCount = Math.max(0, manga.tags.length - visibleTags.length);
    return (
      <article
        className="group flex flex-col gap-3 rounded-[var(--mr-radius-md)] border p-3.5 transition-colors sm:flex-row"
        style={{
          backgroundColor: "var(--mr-bg-surface)",
          borderColor: "var(--mr-border-subtle)",
        }}
      >
        <Link
          to={`/manga/${manga.slug}`}
          className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-[var(--mr-radius-sm)] border sm:w-28"
          style={{ borderColor: "var(--mr-border-subtle)" }}
        >
          {showCover ? (
            <img
              src={manga.coverUrl!}
              alt={manga.title}
              loading="lazy"
              onError={() => setFailedUrl(manga.coverUrl)}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center p-2 text-center text-[11px] font-semibold"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                color: "var(--mr-text-muted)",
              }}
            >
              {manga.title.slice(0, 2).toUpperCase()}
            </div>
          )}
        </Link>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link
              to={`/manga/${manga.slug}`}
              className="line-clamp-2 text-base font-semibold hover:underline"
              style={{ color: "var(--mr-text-primary)" }}
            >
              {manga.title}
            </Link>
            <div className="flex shrink-0 items-center gap-1.5 text-xs">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                style={{ backgroundColor: "var(--mr-bg-elevated)", color: ratingColor }}
              >
                {ratingLabel}
              </span>
              {manga.averageRating > 0 ? (
                <span
                  className="rounded px-1.5 py-0.5 font-bold"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    color: "var(--mr-warning)",
                  }}
                >
                  ★ {manga.averageRating.toFixed(2)}
                </span>
              ) : (
                <span className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                  Unrated
                </span>
              )}
            </div>
          </div>

          <div
            className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs"
            style={{ color: "var(--mr-text-secondary)" }}
          >
            <span className="capitalize">{manga.publicationStatus}</span>
            {manga.publicationDemographic && manga.publicationDemographic !== "unknown" ? (
              <span className="capitalize">· {manga.publicationDemographic}</span>
            ) : null}
            {manga.originalLanguage ? (
              <span className="uppercase">· Orig: {manga.originalLanguage}</span>
            ) : null}
            {manga.year ? <span>· {manga.year}</span> : null}
            {typeof manga.exportedChapterCount === "number" ? (
              <span>· {manga.exportedChapterCount} exported ch.</span>
            ) : null}
            {manga.chapterLanguages && manga.chapterLanguages.length > 0 ? (
              <span className="uppercase">· Langs: {manga.chapterLanguages.join(", ")}</span>
            ) : null}
            <span>· {manga.totalViews.toLocaleString()} views</span>
          </div>

          {manga.creators && manga.creators.length > 0
            ? (() => {
                const authors = manga.creators.filter(
                  (c) => c.roles.some((r) => r.toLowerCase() === "author") || c.roles.length === 0,
                );
                const artists = manga.creators.filter((c) =>
                  c.roles.some((r) => r.toLowerCase() === "artist"),
                );
                return (
                  <div
                    className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px]"
                    style={{ color: "var(--mr-text-muted)" }}
                  >
                    {authors.length > 0 ? (
                      <span className="truncate">
                        <strong
                          className="font-semibold"
                          style={{ color: "var(--mr-text-secondary)" }}
                        >
                          Author:
                        </strong>{" "}
                        {authors
                          .slice(0, 2)
                          .map((c) => c.name)
                          .join(", ")}
                        {authors.length > 2 ? ` +${authors.length - 2}` : ""}
                      </span>
                    ) : null}
                    {artists.length > 0 ? (
                      <span className="truncate">
                        <strong
                          className="font-semibold"
                          style={{ color: "var(--mr-text-secondary)" }}
                        >
                          Artist:
                        </strong>{" "}
                        {artists
                          .slice(0, 2)
                          .map((c) => c.name)
                          .join(", ")}
                        {artists.length > 2 ? ` +${artists.length - 2}` : ""}
                      </span>
                    ) : null}
                  </div>
                );
              })()
            : null}

          {manga.description ? (
            <p className="line-clamp-2 text-xs" style={{ color: "var(--mr-text-secondary)" }}>
              {manga.description}
            </p>
          ) : null}

          {subtitle ? (
            <p className="text-xs font-medium" style={{ color: "var(--mr-accent)" }}>
              {subtitle}
            </p>
          ) : null}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap gap-1">
              {visibleTags.map((tag) => (
                <span
                  key={tag.slug}
                  className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    color: "var(--mr-text-secondary)",
                  }}
                >
                  {tag.name}
                </span>
              ))}
              {overflowCount > 0 ? (
                <span
                  className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    color: "var(--mr-text-muted)",
                  }}
                >
                  +{overflowCount}
                </span>
              ) : null}
            </div>

            {manga.latestChapter ? (
              <span className="text-xs font-medium" style={{ color: "var(--mr-accent)" }}>
                Latest: Ch. {manga.latestChapter.chapterNumber}
                {manga.latestChapter.language
                  ? ` (${manga.latestChapter.language.toUpperCase()})`
                  : ""}
              </span>
            ) : null}
          </div>

          {actionSlot ? <div className="pt-1">{actionSlot}</div> : null}
        </div>
      </article>
    );
  }

  const isCompact = variant === "compact";
  const maxTags = isCompact ? 0 : 3;
  const visibleTags = manga.tags.slice(0, maxTags);
  const overflowCount = maxTags > 0 ? Math.max(0, manga.tags.length - visibleTags.length) : 0;

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-[var(--mr-radius-md)] border transition-colors"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <Link to={`/manga/${manga.slug}`} className="relative block aspect-[3/4] overflow-hidden">
        {showCover ? (
          <img
            src={manga.coverUrl!}
            alt={manga.title}
            loading="lazy"
            onError={() => setFailedUrl(manga.coverUrl)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-1 p-4 text-center"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              color: "var(--mr-text-muted)",
            }}
          >
            <span className="text-lg font-bold">{manga.title.slice(0, 2).toUpperCase()}</span>
            <span className="text-[11px]">No Cover</span>
          </div>
        )}
        <span
          className="absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
          style={{
            backgroundColor: "rgba(15, 17, 23, 0.85)",
            color: ratingColor,
          }}
        >
          {ratingLabel}
        </span>
        {manga.averageRating > 0 ? (
          <span
            className="absolute top-2 right-2 rounded px-1.5 py-0.5 text-[11px] font-bold"
            style={{
              backgroundColor: "rgba(15, 17, 23, 0.85)",
              color: "var(--mr-warning)",
            }}
          >
            ★ {manga.averageRating.toFixed(1)}
          </span>
        ) : null}
        {manga.latestChapter ? (
          <span
            className="absolute right-2 bottom-2 left-2 truncate rounded px-2 py-0.5 text-[11px] font-medium"
            style={{
              backgroundColor: "rgba(15, 17, 23, 0.85)",
              color: "#f8fafc",
            }}
          >
            Ch. {manga.latestChapter.chapterNumber}
            {manga.latestChapter.language ? ` · ${manga.latestChapter.language.toUpperCase()}` : ""}
          </span>
        ) : null}
      </Link>

      <div className={`flex flex-1 flex-col gap-1.5 ${isCompact ? "p-2" : "p-3"}`}>
        <Link
          to={`/manga/${manga.slug}`}
          className={`line-clamp-2 font-semibold hover:underline ${isCompact ? "text-xs" : "text-sm"}`}
          style={{ color: "var(--mr-text-primary)" }}
        >
          {manga.title}
        </Link>

        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]"
          style={{ color: "var(--mr-text-muted)" }}
        >
          <span className="capitalize">{manga.publicationStatus}</span>
          {manga.year ? <span>· {manga.year}</span> : null}
          {!isCompact ? <span>· {manga.totalViews.toLocaleString()} views</span> : null}
        </div>

        {subtitle ? (
          <p className="text-xs font-medium" style={{ color: "var(--mr-accent)" }}>
            {subtitle}
          </p>
        ) : null}

        {manga.creatorRoles && manga.creatorRoles.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {manga.creatorRoles.map((role) => (
              <span
                key={role}
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  color: "var(--mr-accent)",
                }}
              >
                {role}
              </span>
            ))}
          </div>
        ) : null}

        {visibleTags.length > 0 ? (
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {visibleTags.map((tag) => (
              <span
                key={tag.slug}
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  color: "var(--mr-text-secondary)",
                }}
              >
                {tag.name}
              </span>
            ))}
            {overflowCount > 0 ? (
              <span
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  color: "var(--mr-text-muted)",
                }}
              >
                +{overflowCount}
              </span>
            ) : null}
          </div>
        ) : null}

        {actionSlot ? <div className="pt-2">{actionSlot}</div> : null}
      </div>
    </article>
  );
}
