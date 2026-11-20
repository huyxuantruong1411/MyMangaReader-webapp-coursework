interface PlaceholderPageProps {
  title: string;
  routePattern: string;
  roadmapPhase: string;
  ucRefs: string;
  description: string;
  params?: Record<string, string | undefined>;
}

/**
 * Architectural route placeholder (`02_SCREEN_FRAME_EVENT_FLOWS.md`).
 * Intentionally avoids fabricating feature business logic before its roadmap phase.
 */
export function PlaceholderPage({
  title,
  routePattern,
  roadmapPhase,
  ucRefs,
  description,
  params,
}: PlaceholderPageProps) {
  const paramEntries = Object.entries(params ?? {}).filter(([, v]) => v !== undefined);

  return (
    <article
      className="rounded-[var(--mr-radius-lg)] border p-6"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className="rounded px-2 py-0.5 font-mono"
          style={{
            backgroundColor: "var(--mr-bg-elevated)",
            color: "var(--mr-accent)",
          }}
        >
          {routePattern}
        </span>
        <span
          className="rounded px-2 py-0.5 font-medium"
          style={{
            backgroundColor: "var(--mr-bg-elevated)",
            color: "var(--mr-text-secondary)",
          }}
        >
          {roadmapPhase}
        </span>
        <span style={{ color: "var(--mr-text-muted)" }}>{ucRefs}</span>
      </div>

      <h1 className="mt-3 text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
        {title}
      </h1>
      <p
        className="mt-2 max-w-2xl text-sm leading-relaxed"
        style={{ color: "var(--mr-text-secondary)" }}
      >
        {description}
      </p>

      {paramEntries.length > 0 ? (
        <dl
          className="mt-4 inline-grid grid-cols-2 gap-x-6 gap-y-1 rounded-[var(--mr-radius-md)] border px-4 py-3 text-xs"
          style={{
            backgroundColor: "var(--mr-bg-elevated)",
            borderColor: "var(--mr-border-subtle)",
          }}
        >
          {paramEntries.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="font-mono" style={{ color: "var(--mr-text-muted)" }}>
                :{key}
              </dt>
              <dd className="font-mono" style={{ color: "var(--mr-text-primary)" }}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}
