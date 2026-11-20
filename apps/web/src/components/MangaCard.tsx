import { Link } from "react-router-dom";
import type { MangaCardItem } from "../services/apiClient";

const RATING_BADGE_COLORS: Record<string, string> = {
  safe: "var(--mr-success)",
  suggestive: "var(--mr-warning)",
  erotica: "var(--mr-danger)",
  pornographic: "var(--mr-danger)",
  unknown: "var(--mr-text-muted)",
};

export function MangaCard({
  manga,
  subtitle,
  actionSlot,
}: {
  manga: MangaCardItem;
  subtitle?: string;
  actionSlot?: React.ReactNode;
}) {
  return (
    <article
      className="group flex flex-col overflow-hidden rounded-[var(--mr-radius-md)] border transition-colors"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <Link to={`/manga/${manga.slug}`} className="relative block aspect-[3/4] overflow-hidden">
        {manga.coverUrl ? (
          <img
            src={manga.coverUrl}
            alt={manga.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center p-4 text-center text-xs font-medium"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              color: "var(--mr-text-muted)",
            }}
          >
            No Cover
          </div>
        )}
        <span
          className="absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
          style={{
            backgroundColor: "rgba(15, 17, 23, 0.85)",
            color: RATING_BADGE_COLORS[manga.contentRating] ?? "var(--mr-text-primary)",
          }}
        >
          {manga.contentRating}
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

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <Link
          to={`/manga/${manga.slug}`}
          className="line-clamp-2 text-sm font-semibold hover:underline"
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
          <span>· {manga.totalViews.toLocaleString()} views</span>
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

        {manga.tags.length > 0 ? (
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {manga.tags.slice(0, 3).map((tag) => (
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
          </div>
        ) : null}

        {actionSlot ? <div className="pt-2">{actionSlot}</div> : null}
      </div>
    </article>
  );
}
