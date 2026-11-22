import { useState } from "react";

interface ReadingListCoverProps {
  name: string;
  coverUrl?: string | null;
  previewCovers?: string[];
  itemCount?: number;
  variant?: "card" | "detail" | "thumb";
}

function EmptyListArtwork({ name, compact }: { name: string; compact?: boolean }) {
  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden select-none"
      style={{
        background:
          "linear-gradient(145deg, var(--mr-bg-elevated) 0%, var(--mr-bg-surface) 55%, rgba(56, 189, 248, 0.14) 100%)",
        color: "var(--mr-text-secondary)",
      }}
    >
      <svg
        viewBox="0 0 80 80"
        aria-hidden="true"
        className={compact ? "h-6 w-6 opacity-85" : "h-12 w-12 opacity-90"}
      >
        <rect
          x="14"
          y="16"
          width="36"
          height="48"
          rx="4"
          fill="var(--mr-bg-surface)"
          stroke="var(--mr-border-strong)"
          strokeWidth="2.5"
        />
        <rect
          x="28"
          y="22"
          width="36"
          height="46"
          rx="4"
          fill="var(--mr-bg-elevated)"
          stroke="var(--mr-accent)"
          strokeWidth="2.5"
        />
        <path
          d="M36 35h20M36 44h16M36 53h12"
          stroke="var(--mr-accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {!compact ? (
        <div className="mt-2 max-w-[90%] px-2 text-center">
          <span
            className="inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-muted)",
            }}
          >
            Empty List
          </span>
          <p
            className="mt-1 line-clamp-1 text-[10px] font-medium"
            style={{ color: "var(--mr-text-muted)" }}
          >
            {name}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function ReadingListCover({
  name,
  coverUrl,
  previewCovers,
  itemCount,
  variant = "card",
}: ReadingListCoverProps) {
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});

  const candidates = Array.from(
    new Set([...(previewCovers ?? []), ...(coverUrl ? [coverUrl] : [])].filter(Boolean)),
  ).filter((url) => !failedUrls[url]);

  const markFailed = (url: string) => {
    setFailedUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };

  if (variant === "thumb") {
    const thumb = candidates[0];
    return (
      <div
        className="h-12 w-9 shrink-0 overflow-hidden rounded-[var(--mr-radius-sm)] border"
        style={{
          backgroundColor: "var(--mr-bg-elevated)",
          borderColor: "var(--mr-border-subtle)",
        }}
      >
        {thumb ? (
          <img
            src={thumb}
            alt={`${name} cover`}
            loading="lazy"
            onError={() => markFailed(thumb)}
            className="h-full w-full object-cover"
          />
        ) : (
          <EmptyListArtwork name={name} compact />
        )}
      </div>
    );
  }

  const containerClass =
    variant === "detail"
      ? "relative aspect-[3/4] w-28 shrink-0 overflow-hidden rounded-[var(--mr-radius-md)] border sm:w-32"
      : "relative aspect-[16/10] w-full overflow-hidden rounded-[var(--mr-radius-sm)] border";

  const coversToShow =
    candidates.length >= 4
      ? candidates.slice(0, 4)
      : candidates.length >= 2
        ? candidates.slice(0, 2)
        : candidates.slice(0, 1);

  return (
    <div
      className={containerClass}
      style={{
        backgroundColor: "var(--mr-bg-elevated)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      {coversToShow.length === 0 ? (
        <EmptyListArtwork name={name} />
      ) : coversToShow.length === 1 ? (
        <img
          src={coversToShow[0]}
          alt={`${name} cover`}
          loading="lazy"
          onError={() => markFailed(coversToShow[0]!)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : coversToShow.length === 2 ? (
        <div className="grid h-full w-full grid-cols-2 gap-0.5">
          {coversToShow.map((url, idx) => (
            <img
              key={`${url}-${idx}`}
              src={url}
              alt={`${name} cover ${idx + 1}`}
              loading="lazy"
              onError={() => markFailed(url)}
              className="h-full w-full object-cover"
            />
          ))}
        </div>
      ) : (
        <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-0.5">
          {coversToShow.map((url, idx) => (
            <img
              key={`${url}-${idx}`}
              src={url}
              alt={`${name} cover ${idx + 1}`}
              loading="lazy"
              onError={() => markFailed(url)}
              className="h-full w-full object-cover"
            />
          ))}
        </div>
      )}

      {typeof itemCount === "number" && coversToShow.length > 0 ? (
        <span
          className="absolute right-2 bottom-2 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold"
          style={{ backgroundColor: "rgba(15, 17, 23, 0.84)", color: "#ffffff" }}
        >
          {itemCount} title{itemCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}
