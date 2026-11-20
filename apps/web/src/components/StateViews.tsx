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

export function LoadingState({ label = "Loading content..." }: { label?: string }) {
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
