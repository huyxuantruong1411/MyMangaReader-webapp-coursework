import { useEffect, useState, type FormEvent } from "react";

function buildPageTokens(
  currentPage: number,
  totalPages: number,
): Array<number | "left" | "right"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const tokens: Array<number | "left" | "right"> = [1];
  const windowStart = Math.max(2, currentPage - 2);
  const windowEnd = Math.min(totalPages - 1, currentPage + 2);
  if (windowStart > 2) tokens.push("left");
  for (let p = windowStart; p <= windowEnd; p += 1) {
    tokens.push(p);
  }
  if (windowEnd < totalPages - 1) tokens.push("right");
  tokens.push(totalPages);
  return tokens;
}

export function CatalogPagination({
  page,
  total,
  pageSize,
  hasNext,
  onPageChange,
  label = "Catalog pagination",
}: {
  page: number;
  total: number;
  pageSize: number;
  hasNext: boolean;
  onPageChange: (nextPage: number) => void;
  label?: string;
}) {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const [jumpValue, setJumpValue] = useState(String(page));

  useEffect(() => {
    setJumpValue(String(page));
  }, [page]);

  if (page <= 1 && !hasNext && totalPages <= 1) {
    return null;
  }

  const tokens = buildPageTokens(page, totalPages);

  function submitJump(e: FormEvent) {
    e.preventDefault();
    const parsed = Number.parseInt(jumpValue, 10);
    if (Number.isNaN(parsed)) return;
    onPageChange(Math.max(1, Math.min(totalPages, parsed)));
  }

  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 pt-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm disabled:opacity-40"
          style={{ borderColor: "var(--mr-border-strong)", color: "var(--mr-text-primary)" }}
        >
          ← Previous
        </button>
        {tokens.map((tok, idx) =>
          typeof tok === "string" ? (
            <span
              key={`${tok}-${idx}`}
              className="px-1.5 text-xs"
              style={{ color: "var(--mr-text-muted)" }}
            >
              …
            </span>
          ) : (
            <button
              key={tok}
              type="button"
              aria-current={tok === page ? "page" : undefined}
              onClick={() => onPageChange(tok)}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5 font-mono text-xs font-semibold"
              style={{
                backgroundColor: tok === page ? "var(--mr-accent)" : "var(--mr-bg-surface)",
                borderColor: tok === page ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                color: tok === page ? "#ffffff" : "var(--mr-text-primary)",
              }}
            >
              {tok.toLocaleString()}
            </button>
          ),
        )}
        <button
          type="button"
          disabled={!hasNext && page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm disabled:opacity-40"
          style={{ borderColor: "var(--mr-border-strong)", color: "var(--mr-text-primary)" }}
        >
          Next →
        </button>
      </div>

      <form onSubmit={submitJump} className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono" style={{ color: "var(--mr-text-muted)" }}>
          Page {page.toLocaleString()} of {totalPages.toLocaleString()}
        </span>
        <label className="flex items-center gap-1.5">
          <span style={{ color: "var(--mr-text-secondary)" }}>Go to page</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            inputMode="numeric"
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            aria-label="Go to page"
            className="w-20 rounded-[var(--mr-radius-sm)] border px-2 py-1 font-mono text-xs"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
              color: "var(--mr-text-primary)",
            }}
          />
        </label>
        <button
          type="submit"
          className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-2.5 py-1 font-medium"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
            color: "var(--mr-text-primary)",
          }}
        >
          Go
        </button>
      </form>
    </nav>
  );
}
