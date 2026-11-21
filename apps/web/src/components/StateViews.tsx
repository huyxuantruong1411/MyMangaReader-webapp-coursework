import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface BaseStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

function StateCard({
  tone,
  badge,
  title,
  description,
  action,
  role = "status",
}: BaseStateProps & {
  tone: "neutral" | "danger" | "warning";
  badge: string;
  role?: "status" | "alert";
}) {
  const accentColor =
    tone === "danger"
      ? "var(--mr-danger)"
      : tone === "warning"
        ? "var(--mr-warning)"
        : "var(--mr-accent)";

  return (
    <section
      role={role}
      className="mx-auto my-8 max-w-xl rounded-[var(--mr-radius-lg)] border p-6 text-center"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <p
        className="mb-2 text-xs font-semibold tracking-wider uppercase"
        style={{ color: accentColor }}
      >
        {badge}
      </p>
      <h2 className="text-lg font-semibold" style={{ color: "var(--mr-text-primary)" }}>
        {title}
      </h2>
      {description ? (
        <p className="mt-2 text-sm" style={{ color: "var(--mr-text-secondary)" }}>
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center gap-3">{action}</div> : null}
    </section>
  );
}

export type LoadingVariant = "default" | "grid" | "detail" | "table" | "dashboard";

export function LoadingState({
  label = "Loading content...",
  variant = "default",
  count = 12,
}: {
  label?: string;
  variant?: LoadingVariant;
  count?: number;
}) {
  if (variant === "grid") {
    return (
      <section role="status" aria-busy="true" className="space-y-3">
        <p className="text-xs font-medium" style={{ color: "var(--mr-text-muted)" }}>
          {label}
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: count }).map((_, idx) => (
            <div
              key={idx}
              className="overflow-hidden rounded-[var(--mr-radius-md)] border"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <div
                className="aspect-[3/4] w-full animate-pulse"
                style={{ backgroundColor: "var(--mr-bg-elevated)" }}
              />
              <div className="space-y-2 p-2.5">
                <div
                  className="h-3.5 w-5/6 animate-pulse rounded"
                  style={{ backgroundColor: "var(--mr-bg-elevated)" }}
                />
                <div
                  className="h-2.5 w-1/2 animate-pulse rounded"
                  style={{ backgroundColor: "var(--mr-bg-elevated)" }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (variant === "detail") {
    return (
      <section role="status" aria-busy="true" className="space-y-6">
        <p className="text-xs font-medium" style={{ color: "var(--mr-text-muted)" }}>
          {label}
        </p>
        <div
          className="grid gap-6 rounded-[var(--mr-radius-lg)] border p-6 md:grid-cols-[220px_1fr]"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-subtle)",
          }}
        >
          <div
            className="aspect-[3/4] w-full animate-pulse rounded-[var(--mr-radius-md)]"
            style={{ backgroundColor: "var(--mr-bg-elevated)" }}
          />
          <div className="space-y-3">
            <div className="flex gap-2">
              <div
                className="h-5 w-20 animate-pulse rounded"
                style={{ backgroundColor: "var(--mr-bg-elevated)" }}
              />
              <div
                className="h-5 w-20 animate-pulse rounded"
                style={{ backgroundColor: "var(--mr-bg-elevated)" }}
              />
            </div>
            <div
              className="h-7 w-2/3 animate-pulse rounded"
              style={{ backgroundColor: "var(--mr-bg-elevated)" }}
            />
            <div
              className="h-4 w-1/2 animate-pulse rounded"
              style={{ backgroundColor: "var(--mr-bg-elevated)" }}
            />
            <div
              className="h-24 w-full animate-pulse rounded"
              style={{ backgroundColor: "var(--mr-bg-elevated)" }}
            />
            <div className="flex gap-2">
              <div
                className="h-9 w-36 animate-pulse rounded"
                style={{ backgroundColor: "var(--mr-bg-elevated)" }}
              />
              <div
                className="h-9 w-36 animate-pulse rounded"
                style={{ backgroundColor: "var(--mr-bg-elevated)" }}
              />
            </div>
          </div>
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-12 w-full animate-pulse rounded-[var(--mr-radius-sm)] border"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            />
          ))}
        </div>
      </section>
    );
  }

  if (variant === "table") {
    return (
      <section role="status" aria-busy="true" className="space-y-2.5">
        <p className="text-xs font-medium" style={{ color: "var(--mr-text-muted)" }}>
          {label}
        </p>
        <div
          className="divide-y rounded-[var(--mr-radius-md)] border"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-subtle)",
          }}
        >
          {Array.from({ length: Math.min(count, 8) }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 px-4 py-3"
              style={{ borderColor: "var(--mr-border-subtle)" }}
            >
              <div className="flex flex-1 items-center gap-3">
                <div
                  className="h-10 w-8 shrink-0 animate-pulse rounded"
                  style={{ backgroundColor: "var(--mr-bg-elevated)" }}
                />
                <div className="flex-1 space-y-1.5">
                  <div
                    className="h-3.5 w-1/3 animate-pulse rounded"
                    style={{ backgroundColor: "var(--mr-bg-elevated)" }}
                  />
                  <div
                    className="h-2.5 w-2/3 animate-pulse rounded"
                    style={{ backgroundColor: "var(--mr-bg-elevated)" }}
                  />
                </div>
              </div>
              <div
                className="h-7 w-20 animate-pulse rounded"
                style={{ backgroundColor: "var(--mr-bg-elevated)" }}
              />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (variant === "dashboard") {
    return (
      <section role="status" aria-busy="true" className="space-y-4">
        <p className="text-xs font-medium" style={{ color: "var(--mr-text-muted)" }}>
          {label}
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="space-y-2 rounded-[var(--mr-radius-md)] border p-4"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <div
                className="h-3 w-24 animate-pulse rounded"
                style={{ backgroundColor: "var(--mr-bg-elevated)" }}
              />
              <div
                className="h-7 w-16 animate-pulse rounded"
                style={{ backgroundColor: "var(--mr-bg-elevated)" }}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div
            className="h-64 animate-pulse rounded-[var(--mr-radius-lg)] border"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          />
          <div
            className="h-64 animate-pulse rounded-[var(--mr-radius-lg)] border"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      role="status"
      aria-busy="true"
      className="mx-auto my-8 max-w-3xl space-y-4 rounded-[var(--mr-radius-lg)] border p-6"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div
        className="h-5 w-44 animate-pulse rounded"
        style={{ backgroundColor: "var(--mr-bg-elevated)" }}
      />
      <div
        className="h-24 w-full animate-pulse rounded"
        style={{ backgroundColor: "var(--mr-bg-elevated)" }}
      />
      <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
        {label}
      </p>
    </section>
  );
}

export function EmptyState({
  title,
  description = "No records are available yet.",
  action,
}: BaseStateProps) {
  return (
    <StateCard
      tone="neutral"
      badge="Empty"
      title={title}
      description={description}
      action={action}
    />
  );
}

export function ErrorState({
  title = "Unable to load this view",
  description = "An unexpected error occurred while communicating with the server.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <StateCard
      tone="danger"
      badge="Error"
      role="alert"
      title={title}
      description={description}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: "var(--mr-accent)" }}
          >
            Retry
          </button>
        ) : undefined
      }
    />
  );
}

export function ForbiddenState({
  title = "Access denied",
  description = "You do not have permission to view this area.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <StateCard
      tone="warning"
      badge="403 Forbidden"
      role="alert"
      title={title}
      description={description}
      action={
        <Link
          to="/"
          className="rounded-[var(--mr-radius-sm)] border px-4 py-2 text-sm font-medium"
          style={{
            borderColor: "var(--mr-border-strong)",
            color: "var(--mr-text-primary)",
          }}
        >
          Return Home
        </Link>
      }
    />
  );
}

export function NotFoundState({
  title = "Page not found",
  description = "The requested page does not exist or is currently unavailable.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <StateCard
      tone="neutral"
      badge="404 Not Found"
      title={title}
      description={description}
      action={
        <Link
          to="/"
          className="rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: "var(--mr-accent)" }}
        >
          Back to Discovery
        </Link>
      }
    />
  );
}
