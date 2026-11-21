import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AdminMangaStatsResponse,
  ListMetadataStats,
  RatingHistoryEntry,
  ReaderStatsPayload,
} from "../services/apiTypes";

export interface StoryInsightCard {
  category: string;
  title: string;
  narrative: string;
  implication: string;
  tone: "accent" | "success" | "warning" | "danger";
  actionLabel?: string;
  actionTo?: string;
}

export interface StorytellingNarrativeProps {
  badge: string;
  personaTitle: string;
  personaSubtitle: string;
  headlineMetric?: { label: string; value: string; hint?: string };
  badges?: Array<{ label: string; tone?: "accent" | "success" | "warning" | "muted" }>;
  insights: StoryInsightCard[];
}

const TONE_COLORS: Record<"accent" | "success" | "warning" | "danger" | "muted", string> = {
  accent: "var(--mr-accent)",
  success: "var(--mr-success)",
  warning: "var(--mr-warning)",
  danger: "var(--mr-danger)",
  muted: "var(--mr-text-muted)",
};

const PALETTE = [
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb923c",
  "#22d3ee",
  "#f87171",
];

export function StorytellingNarrativeCard({
  badge,
  personaTitle,
  personaSubtitle,
  headlineMetric,
  badges = [],
  insights,
}: StorytellingNarrativeProps) {
  return (
    <section
      className="space-y-4 rounded-[var(--mr-radius-lg)] border p-5"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-strong)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <span
            className="inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              color: "var(--mr-accent)",
            }}
          >
            {badge}
          </span>
          <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
            {personaTitle}
          </h2>
          <p className="text-xs leading-relaxed" style={{ color: "var(--mr-text-secondary)" }}>
            {personaSubtitle}
          </p>
          {badges.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {badges.map((b) => (
                <span
                  key={b.label}
                  className="rounded border px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                    color: TONE_COLORS[b.tone ?? "muted"],
                  }}
                >
                  {b.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {headlineMetric ? (
          <div
            className="shrink-0 rounded-[var(--mr-radius-md)] border px-4 py-3 text-right"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <p
              className="text-[10px] font-semibold uppercase"
              style={{ color: "var(--mr-text-muted)" }}
            >
              {headlineMetric.label}
            </p>
            <p className="mt-0.5 text-2xl font-bold" style={{ color: "var(--mr-accent)" }}>
              {headlineMetric.value}
            </p>
            {headlineMetric.hint ? (
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                {headlineMetric.hint}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {insights.map((ins) => (
          <article
            key={ins.title}
            className="flex flex-col justify-between gap-2 rounded-[var(--mr-radius-md)] border p-3.5"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
              borderLeftWidth: "3px",
              borderLeftColor: TONE_COLORS[ins.tone],
            }}
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-[10px] font-bold tracking-wider uppercase"
                  style={{ color: TONE_COLORS[ins.tone] }}
                >
                  {ins.category}
                </span>
              </div>
              <h3 className="text-xs font-bold" style={{ color: "var(--mr-text-primary)" }}>
                {ins.title}
              </h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--mr-text-secondary)" }}>
                {ins.narrative}
              </p>
            </div>
            <div
              className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-[11px]"
              style={{ borderColor: "var(--mr-border-subtle)" }}
            >
              <span style={{ color: "var(--mr-text-muted)" }}>
                <strong style={{ color: "var(--mr-text-primary)" }}>Xu hướng &amp; Gợi ý:</strong>{" "}
                {ins.implication}
              </span>
              {ins.actionTo && ins.actionLabel ? (
                <Link
                  to={ins.actionTo}
                  className="shrink-0 font-semibold underline"
                  style={{ color: "var(--mr-accent)" }}
                >
                  {ins.actionLabel}
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color?: string;
  hint?: string;
}

export function InteractiveDonutChart({
  title,
  subtitle,
  centerLabel,
  centerValue,
  items,
}: {
  title: string;
  subtitle?: string;
  centerLabel: string;
  centerValue: string;
  items: DonutSegment[];
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const total = useMemo(() => items.reduce((acc, it) => acc + Math.max(0, it.value), 0), [items]);
  const radius = 56;
  const circumference = 2 * Math.PI * radius;

  const segments = useMemo(() => {
    let accumulated = 0;
    return items
      .filter((it) => it.value > 0)
      .map((it, idx) => {
        const pct = total > 0 ? it.value / total : 0;
        const length = pct * circumference;
        const offset = circumference - accumulated;
        accumulated += length;
        return {
          ...it,
          color: it.color || PALETTE[idx % PALETTE.length],
          pct,
          length,
          offset,
        };
      });
  }, [items, total, circumference]);

  const active = segments.find((s) => s.key === selectedKey) ?? null;

  return (
    <div
      className="flex flex-col justify-between gap-4 rounded-[var(--mr-radius-lg)] border p-4"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div>
        <h3 className="text-sm font-bold" style={{ color: "var(--mr-text-primary)" }}>
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
            {subtitle}
          </p>
        ) : null}
      </div>

      {total === 0 ? (
        <p className="py-8 text-center text-xs" style={{ color: "var(--mr-text-muted)" }}>
          Chưa có phân bổ dữ liệu.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="relative flex h-40 w-40 shrink-0 items-center justify-center">
            <svg viewBox="0 0 150 150" className="h-full w-full -rotate-90">
              <circle
                cx="75"
                cy="75"
                r={radius}
                fill="none"
                stroke="var(--mr-bg-elevated)"
                strokeWidth="18"
              />
              {segments.map((seg) => {
                const isSelected = active?.key === seg.key;
                return (
                  <circle
                    key={seg.key}
                    cx="75"
                    cy="75"
                    r={radius}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={isSelected ? 22 : 18}
                    strokeDasharray={`${Math.max(seg.length - 2, 1)} ${circumference}`}
                    strokeDashoffset={seg.offset}
                    className="cursor-pointer transition-all duration-200"
                    opacity={active && !isSelected ? 0.45 : 1}
                    onMouseEnter={() => setSelectedKey(seg.key)}
                    onClick={() => setSelectedKey((prev) => (prev === seg.key ? null : seg.key))}
                  />
                );
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
              <span
                className="max-w-full truncate text-[10px] font-semibold uppercase"
                style={{ color: "var(--mr-text-muted)" }}
              >
                {active ? active.label : centerLabel}
              </span>
              <span className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
                {active ? `${(active.pct * 100).toFixed(1)}%` : centerValue}
              </span>
            </div>
          </div>

          <ul className="w-full flex-1 space-y-1.5 text-xs">
            {segments.map((seg) => {
              const isSelected = active?.key === seg.key;
              return (
                <li key={seg.key}>
                  <button
                    type="button"
                    onMouseEnter={() => setSelectedKey(seg.key)}
                    onClick={() => setSelectedKey((prev) => (prev === seg.key ? null : seg.key))}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-left transition"
                    style={{
                      backgroundColor: isSelected ? "var(--mr-bg-elevated)" : "transparent",
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: seg.color }}
                      />
                      <span
                        className="truncate font-medium"
                        style={{ color: "var(--mr-text-primary)" }}
                      >
                        {seg.label}
                      </span>
                    </span>
                    <span
                      className="shrink-0 font-mono"
                      style={{ color: "var(--mr-text-secondary)" }}
                    >
                      {seg.value.toLocaleString()} ({(seg.pct * 100).toFixed(1)}%)
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {active?.hint ? (
        <p
          className="rounded border px-2.5 py-1.5 text-[11px]"
          style={{
            backgroundColor: "var(--mr-bg-elevated)",
            borderColor: "var(--mr-border-subtle)",
            color: "var(--mr-text-secondary)",
          }}
        >
          {active.hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TrendDatum {
  key: string;
  label: string;
  value: number;
  sublabel?: string;
  href?: string;
}

export function InteractiveTrendChart({
  title,
  subtitle,
  data,
  valueFormatter = (v) => v.toLocaleString(),
  defaultMode = "bar",
  accentColor = "#38bdf8",
  averageLabel = "Avg",
}: {
  title: string;
  subtitle?: string;
  data: TrendDatum[];
  valueFormatter?: (v: number) => string;
  defaultMode?: "bar" | "area";
  accentColor?: string;
  averageLabel?: string;
}) {
  const gradId = useId();
  const [mode, setMode] = useState<"bar" | "area">(defaultMode);
  const [selectedIdx, setSelectedIdx] = useState<number>(0);

  const safeData = useMemo(() => data.slice(0, 12), [data]);
  const maxVal = useMemo(() => Math.max(1, ...safeData.map((d) => d.value)), [safeData]);
  const avgVal = useMemo(
    () =>
      safeData.length > 0 ? safeData.reduce((acc, d) => acc + d.value, 0) / safeData.length : 0,
    [safeData],
  );

  const width = 560;
  const height = 210;
  const padLeft = 44;
  const padRight = 18;
  const padTop = 22;
  const padBottom = 38;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const activeIndex =
    safeData.length === 0 ? -1 : Math.min(Math.max(selectedIdx, 0), safeData.length - 1);
  const activeItem = activeIndex >= 0 ? safeData[activeIndex] : null;

  const points = useMemo(() => {
    const n = safeData.length;
    if (n === 0) return [];
    return safeData.map((d, i) => {
      const x =
        mode === "area" && n > 1
          ? padLeft + (i / (n - 1)) * plotW
          : padLeft + (i + 0.5) * (plotW / n);
      const y = padTop + plotH - (Math.max(0, d.value) / maxVal) * plotH;
      return { x, y, datum: d, idx: i };
    });
  }, [safeData, mode, plotW, plotH, maxVal]);

  const { linePath, areaPath } = useMemo(() => {
    const first = points[0];
    if (!first) return { linePath: "", areaPath: "" };
    if (points.length === 1) {
      return { linePath: `M ${first.x} ${first.y}`, areaPath: "" };
    }
    let lp = `M ${first.x} ${first.y}`;
    let ap = `M ${first.x} ${padTop + plotH} L ${first.x} ${first.y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      if (!prev || !curr) continue;
      const midX = (prev.x + curr.x) / 2;
      lp += ` C ${midX} ${prev.y}, ${midX} ${curr.y}, ${curr.x} ${curr.y}`;
      ap += ` C ${midX} ${prev.y}, ${midX} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    const last = points[points.length - 1] ?? first;
    ap += ` L ${last.x} ${padTop + plotH} Z`;
    return { linePath: lp, areaPath: ap };
  }, [points, plotH]);

  const avgY = padTop + plotH - (avgVal / maxVal) * plotH;
  const deltaPct =
    activeItem && avgVal > 0 ? Math.round(((activeItem.value - avgVal) / avgVal) * 100) : null;

  return (
    <div
      className="flex flex-col justify-between gap-3 rounded-[var(--mr-radius-lg)] border p-4"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold" style={{ color: "var(--mr-text-primary)" }}>
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
              {subtitle}
            </p>
          ) : null}
        </div>
        <div
          className="flex overflow-hidden rounded border text-[11px]"
          style={{ borderColor: "var(--mr-border-strong)" }}
        >
          <button
            type="button"
            onClick={() => setMode("bar")}
            className="cursor-pointer px-2 py-1 font-medium"
            style={{
              backgroundColor: mode === "bar" ? "var(--mr-bg-elevated)" : "transparent",
              color: mode === "bar" ? "var(--mr-accent)" : "var(--mr-text-muted)",
            }}
          >
            Bars
          </button>
          <button
            type="button"
            onClick={() => setMode("area")}
            className="cursor-pointer px-2 py-1 font-medium"
            style={{
              backgroundColor: mode === "area" ? "var(--mr-bg-elevated)" : "transparent",
              color: mode === "area" ? "var(--mr-accent)" : "var(--mr-text-muted)",
            }}
          >
            Trend Line
          </button>
        </div>
      </div>

      {safeData.length === 0 ? (
        <p className="py-10 text-center text-xs" style={{ color: "var(--mr-text-muted)" }}>
          Không có dữ liệu biểu đồ.
        </p>
      ) : (
        <>
          <div className="w-full overflow-x-auto">
            <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[320px]">
              <defs>
                <linearGradient id={`${gradId}-area`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentColor} stopOpacity="0.45" />
                  <stop offset="100%" stopColor={accentColor} stopOpacity="0.03" />
                </linearGradient>
                <linearGradient id={`${gradId}-bar`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentColor} stopOpacity="1" />
                  <stop offset="100%" stopColor={accentColor} stopOpacity="0.45" />
                </linearGradient>
              </defs>

              {/* Y Gridlines */}
              {[0, 0.25, 0.5, 0.75, 1].map((step) => {
                const y = padTop + plotH - plotH * step;
                const val = maxVal * step;
                return (
                  <g key={step}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      stroke="rgba(148, 163, 184, 0.16)"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={padLeft - 6}
                      y={y + 3}
                      textAnchor="end"
                      fontSize="9"
                      fill="var(--mr-text-muted)"
                    >
                      {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)}
                    </text>
                  </g>
                );
              })}

              {/* Average reference line */}
              {avgVal > 0 ? (
                <g>
                  <line
                    x1={padLeft}
                    y1={avgY}
                    x2={width - padRight}
                    y2={avgY}
                    stroke="#fbbf24"
                    strokeDasharray="5 4"
                    strokeWidth="1.2"
                  />
                  <text
                    x={width - padRight}
                    y={Math.max(10, avgY - 4)}
                    textAnchor="end"
                    fontSize="9"
                    fontWeight="bold"
                    fill="#fbbf24"
                  >
                    {averageLabel}: {valueFormatter(Math.round(avgVal * 10) / 10)}
                  </text>
                </g>
              ) : null}

              {mode === "area" ? (
                <>
                  {areaPath ? <path d={areaPath} fill={`url(#${gradId}-area)`} /> : null}
                  {linePath ? (
                    <path
                      d={linePath}
                      fill="none"
                      stroke={accentColor}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  ) : null}
                  {points.map((pt) => {
                    const isSel = pt.idx === activeIndex;
                    return (
                      <g
                        key={pt.datum.key}
                        className="cursor-pointer"
                        onMouseEnter={() => setSelectedIdx(pt.idx)}
                        onClick={() => setSelectedIdx(pt.idx)}
                      >
                        <circle cx={pt.x} cy={pt.y} r={isSel ? 6 : 4} fill={accentColor} />
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={isSel ? 2.8 : 1.6}
                          fill="var(--mr-bg-surface)"
                        />
                      </g>
                    );
                  })}
                </>
              ) : (
                points.map((pt) => {
                  const slotW = plotW / safeData.length;
                  const barW = Math.min(34, slotW * 0.62);
                  const barH = Math.max(3, padTop + plotH - pt.y);
                  const isSel = pt.idx === activeIndex;
                  return (
                    <rect
                      key={pt.datum.key}
                      x={pt.x - barW / 2}
                      y={pt.y}
                      width={barW}
                      height={barH}
                      rx={Math.min(5, barW / 3)}
                      fill={isSel ? "#fbbf24" : `url(#${gradId}-bar)`}
                      opacity={activeItem && !isSel ? 0.72 : 1}
                      className="cursor-pointer transition-opacity"
                      onMouseEnter={() => setSelectedIdx(pt.idx)}
                      onClick={() => setSelectedIdx(pt.idx)}
                    />
                  );
                })
              )}

              {/* X Labels */}
              {points.map((pt) => {
                const shortLabel =
                  pt.datum.label.length > 10 ? `${pt.datum.label.slice(0, 9)}…` : pt.datum.label;
                return (
                  <text
                    key={`x-${pt.datum.key}`}
                    x={pt.x}
                    y={height - 14}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight={pt.idx === activeIndex ? "bold" : "normal"}
                    fill={
                      pt.idx === activeIndex ? "var(--mr-text-primary)" : "var(--mr-text-muted)"
                    }
                  >
                    {shortLabel}
                  </text>
                );
              })}
            </svg>
          </div>

          {activeItem ? (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-xs"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <div className="min-w-0">
                <span className="font-semibold" style={{ color: "var(--mr-text-primary)" }}>
                  #{activeIndex + 1} {activeItem.label}
                </span>
                {activeItem.sublabel ? (
                  <span className="ml-2 text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                    {activeItem.sublabel}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 font-mono">
                <strong style={{ color: accentColor }}>{valueFormatter(activeItem.value)}</strong>
                {deltaPct !== null ? (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{
                      backgroundColor: "var(--mr-bg-surface)",
                      color: deltaPct >= 0 ? "var(--mr-success)" : "var(--mr-warning)",
                    }}
                  >
                    {deltaPct >= 0 ? `+${deltaPct}% vs avg` : `${deltaPct}% vs avg`}
                  </span>
                ) : null}
                {activeItem.href ? (
                  <Link
                    to={activeItem.href}
                    className="text-[11px] font-sans font-semibold underline"
                    style={{ color: "var(--mr-accent)" }}
                  >
                    Open →
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function GenreRadarChart({
  title,
  subtitle,
  axes,
}: {
  title: string;
  subtitle?: string;
  axes: Array<{ label: string; value: number; displayValue?: string }>;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const items = useMemo(() => axes.slice(0, 7), [axes]);
  const maxVal = useMemo(() => Math.max(1, ...items.map((a) => a.value)), [items]);

  const cx = 160;
  const cy = 128;
  const r = 82;

  const coords = useMemo(() => {
    const n = items.length;
    if (n < 3) return [];
    return items.map((item, idx) => {
      const angle = (Math.PI * 2 * idx) / n - Math.PI / 2;
      const norm = Math.max(0.12, item.value / maxVal);
      return {
        ...item,
        idx,
        norm,
        x: cx + Math.cos(angle) * r * norm,
        y: cy + Math.sin(angle) * r * norm,
        lx: cx + Math.cos(angle) * (r + 20),
        ly: cy + Math.sin(angle) * (r + 18),
        outerX: cx + Math.cos(angle) * r,
        outerY: cy + Math.sin(angle) * r,
      };
    });
  }, [items, maxVal]);

  const polygonPoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  return (
    <div
      className="flex flex-col justify-between gap-3 rounded-[var(--mr-radius-lg)] border p-4"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div>
        <h3 className="text-sm font-bold" style={{ color: "var(--mr-text-primary)" }}>
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
            {subtitle}
          </p>
        ) : null}
      </div>

      {items.length < 3 ? (
        <div className="space-y-2 py-4">
          {items.map((it) => (
            <div key={it.label} className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span>{it.label}</span>
                <span className="font-mono">{it.displayValue ?? it.value}</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded"
                style={{ backgroundColor: "var(--mr-bg-elevated)" }}
              >
                <div
                  className="h-full rounded"
                  style={{
                    width: `${Math.round((it.value / maxVal) * 100)}%`,
                    backgroundColor: "var(--mr-accent)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <svg viewBox="0 0 320 256" className="h-auto w-full max-w-[320px]">
            {[0.25, 0.5, 0.75, 1].map((ring) => {
              const ringPts = coords
                .map((_, idx) => {
                  const angle = (Math.PI * 2 * idx) / coords.length - Math.PI / 2;
                  const rx = cx + Math.cos(angle) * r * ring;
                  const ry = cy + Math.sin(angle) * r * ring;
                  return `${rx.toFixed(1)},${ry.toFixed(1)}`;
                })
                .join(" ");
              return (
                <polygon
                  key={ring}
                  points={ringPts}
                  fill="none"
                  stroke="rgba(148, 163, 184, 0.22)"
                  strokeWidth="1"
                />
              );
            })}

            {coords.map((c) => (
              <line
                key={`axis-${c.label}`}
                x1={cx}
                y1={cy}
                x2={c.outerX}
                y2={c.outerY}
                stroke="rgba(148, 163, 184, 0.22)"
                strokeWidth="1"
              />
            ))}

            <polygon
              points={polygonPoints}
              fill="rgba(56, 189, 248, 0.28)"
              stroke="#38bdf8"
              strokeWidth="2"
            />

            {coords.map((c) => {
              const isHov = hoveredIdx === c.idx;
              const short = c.label.length > 12 ? `${c.label.slice(0, 11)}…` : c.label;
              return (
                <g
                  key={`pt-${c.label}`}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(c.idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={isHov ? 5.5 : 3.8}
                    fill={isHov ? "#fbbf24" : "#38bdf8"}
                  />
                  <text
                    x={c.lx}
                    y={c.ly}
                    textAnchor={c.lx < cx - 8 ? "end" : c.lx > cx + 8 ? "start" : "middle"}
                    dominantBaseline="middle"
                    fontSize="10"
                    fontWeight={isHov ? "bold" : "600"}
                    fill={isHov ? "var(--mr-accent)" : "var(--mr-text-secondary)"}
                  >
                    {short}
                  </text>
                </g>
              );
            })}
          </svg>

          {hoveredIdx !== null && coords[hoveredIdx] ? (
            <p className="text-xs font-medium" style={{ color: "var(--mr-accent)" }}>
              {coords[hoveredIdx].label}:{" "}
              <span className="font-mono">
                {coords[hoveredIdx].displayValue ?? coords[hoveredIdx].value}
              </span>
            </p>
          ) : (
            <p className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
              Di chuột lên đỉnh đa giác để xem chi tiết tỷ trọng từng nhóm chủ đề.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function EngagementFunnelChart({
  title,
  subtitle,
  stages,
}: {
  title: string;
  subtitle?: string;
  stages: Array<{
    key: string;
    label: string;
    value: number;
    conversionLabel?: string;
    hint: string;
    color: string;
  }>;
}) {
  const maxVal = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div
      className="flex flex-col justify-between gap-3 rounded-[var(--mr-radius-lg)] border p-4"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div>
        <h3 className="text-sm font-bold" style={{ color: "var(--mr-text-primary)" }}>
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        {stages.map((st) => {
          const widthPct = Math.max(8, Math.round((st.value / maxVal) * 100));
          return (
            <div key={st.key} className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold" style={{ color: "var(--mr-text-primary)" }}>
                  {st.label}
                </span>
                <div className="flex items-center gap-2 font-mono">
                  <strong style={{ color: st.color }}>{st.value.toLocaleString()}</strong>
                  {st.conversionLabel ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: "var(--mr-bg-elevated)",
                        color: "var(--mr-text-secondary)",
                      }}
                    >
                      {st.conversionLabel}
                    </span>
                  ) : null}
                </div>
              </div>
              <div
                className="h-2.5 overflow-hidden rounded-full"
                style={{ backgroundColor: "var(--mr-bg-elevated)" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${widthPct}%`, backgroundColor: st.color }}
                />
              </div>
              <p className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                {st.hint}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildReaderDataStory(
  stats: ReaderStatsPayload,
  ratingHistory?: RatingHistoryEntry[],
): StorytellingNarrativeProps {
  const validRate =
    stats.chapterOpens > 0 ? Math.round((stats.validViews / stats.chapterOpens) * 100) : 0;
  const chaptersPerManga =
    stats.uniqueMangasInteracted > 0 ? stats.uniqueChaptersRead / stats.uniqueMangasInteracted : 0;
  const breakdown = stats.readingStatusBreakdown || {};
  const completedCnt = breakdown.COMPLETED ?? 0;
  const readingCnt = breakdown.READING ?? 0;
  const planCnt = breakdown.PLAN_TO_READ ?? 0;
  const totalTracked = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const topTag = stats.topTags[0];
  const secondTag = stats.topTags[1];
  const topCreator = stats.topCreators[0];

  let personaTitle = "Độc Giả Khám Phá · Curious Explorer";
  let personaSubtitle =
    "Bạn đang mở rộng danh mục qua nhiều đầu truyện mới để định hình gu đọc dài hạn.";
  if (chaptersPerManga >= 8 && validRate >= 65) {
    personaTitle = "Chiến Thần Cày Bộ · Deep Immersion Binger";
    personaSubtitle = `Tỷ lệ đọc sâu đạt ${validRate}% số lần mở chương với trung bình ${chaptersPerManga.toFixed(1)} chương/bộ — cho thấy bạn thường đọc liền mạch cả series thay vì lướt nhanh.`;
  } else if (stats.ratingsCount >= 5 && (stats.averageRatingGiven ?? 0) > 0) {
    personaTitle = "Nhà Phê Bình Tinh Tuyển · Selective Critic";
    personaSubtitle = `Bạn duy trì thói quen chấm điểm đều đặn (${stats.ratingsCount} bộ, TB ${(stats.averageRatingGiven ?? 0).toFixed(2)}/10), giúp thuật toán gợi ý cá nhân hóa chính xác cao.`;
  } else if (totalTracked >= 5 && planCnt > completedCnt + readingCnt) {
    personaTitle = "Nhà Sưu Tầm Kho Truyện · Backlog Curator";
    personaSubtitle = `Kho Dự định đọc chiếm tỷ trọng lớn (${planCnt}/${totalTracked} bộ đang theo dõi), phản ánh xu hướng lưu trữ nhiều tác phẩm tiềm năng trước khi cày.`;
  }

  const tagSum = stats.topTags.reduce((acc, t) => acc + t.count, 0);
  const topTagShare = topTag && tagSum > 0 ? Math.round((topTag.count / tagSum) * 100) : 0;

  const avgRating = stats.averageRatingGiven;
  const ratingStance =
    avgRating === null
      ? "Chưa có dữ liệu điểm đánh giá."
      : avgRating >= 8.2
        ? `Mức điểm TB ${avgRating.toFixed(2)}/10 cho thấy bạn ưu tiên chọn lọc kỹ các bộ hợp gu trước khi đọc và đánh giá.`
        : avgRating >= 6.8
          ? `Mức điểm TB ${avgRating.toFixed(2)}/10 phản ánh thước đo cân bằng giữa giải trí và phê bình khắt khe.`
          : `Mức điểm TB ${avgRating.toFixed(2)}/10 cho thấy bạn là độc giả khó tính, sẵn sàng chấm thấp nếu nhịp truyện đi xuống.`;

  const insights: StoryInsightCard[] = [
    {
      category: "Hành vi Đọc sâu (Retention)",
      title: `${validRate}% phiên mở chương trở thành Lượt đọc hợp lệ`,
      narrative: `${stats.validViews.toLocaleString()} lượt đọc sâu trên tổng ${stats.chapterOpens.toLocaleString()} lần mở chương (${stats.uniqueChaptersRead.toLocaleString()} chương khác nhau trên ${stats.uniqueMangasInteracted.toLocaleString()} tựa truyện).`,
      implication:
        validRate >= 70
          ? "Tỷ lệ giữ chân cao: nên bật Preload Ahead ≥ 4 trang để chuyển trang mượt khi đọc dài."
          : "Nhiều phiên lướt nhanh: dùng bộ lọc Exported Chapters Min ≥ 10 trên Advanced Search để tránh các bộ chỉ có vài chương đầu.",
      tone: validRate >= 60 ? "success" : "warning",
      actionLabel: "Tùy chỉnh Reader →",
      actionTo: "/settings",
    },
    {
      category: "ADN Thể loại & Xu hướng Gu",
      title: topTag
        ? `Trục chính xoay quanh ${topTag.name} (${topTagShare}% top tags)`
        : "Đa dạng thể loại",
      narrative: topTag
        ? `Nhóm chủ đề nổi bật nhất là ${topTag.name} (${topTag.count} bộ)${secondTag ? `, kết hợp cùng ${secondTag.name} (${secondTag.count} bộ)` : ""}.${topCreator ? ` Tác giả đọc nhiều nhất: ${topCreator.name}.` : ""}`
        : "Chưa đủ dữ liệu tag từ lịch sử tương tác.",
      implication: topTag
        ? `Gợi ý khám phá sâu các bộ mang thẻ ${topTag.name}${secondTag ? ` + ${secondTag.name}` : ""} với điểm ≥ 8.0.`
        : "Hãy thêm truyện vào Thư viện để hệ thống vẽ bản đồ DNA thể loại của bạn.",
      tone: "accent",
      actionLabel: topTag ? `Tìm thêm ${topTag.name} →` : "Mở Khám phá →",
      actionTo: topTag
        ? `/search/advanced?includeTags=${encodeURIComponent(topTag.slug)}&sort=RATING_DESC`
        : "/search/advanced",
    },
    {
      category: "Sức khỏe Thư viện (Backlog)",
      title:
        totalTracked > 0
          ? `${readingCnt} đang đọc · ${completedCnt} hoàn thành · ${planCnt} dự định đọc`
          : "Chưa phân loại trạng thái thư viện",
      narrative:
        totalTracked > 0
          ? `Tỷ lệ hoàn tất hiện tại là ${Math.round((completedCnt / totalTracked) * 100)}% tổng số đầu truyện đã lưu vào Thư viện.`
          : "Lịch sử mở chương đã có nhưng bạn chưa đánh dấu trạng thái trong Library.",
      implication:
        planCnt > completedCnt * 2 && planCnt > 0
          ? "Kho Plan-to-Read đang phình to: nên ưu tiên các bộ đã Completed để giải phóng backlog."
          : "Nhịp độ hoàn tất cân bằng: tiếp tục sử dụng nút Continue Reading trên Trang chủ để duy trì chuỗi đọc.",
      tone: planCnt > completedCnt * 2 && planCnt > 2 ? "warning" : "success",
      actionLabel: "Mở Thư viện →",
      actionTo: "/library",
    },
    {
      category: "Khẩu vị Chấm điểm & Phản hồi",
      title:
        avgRating !== null
          ? `Điểm trung bình đã chấm: ${avgRating.toFixed(2)}/10 (${stats.ratingsCount} lượt)`
          : "Chưa ghi nhận điểm đánh giá",
      narrative: `${ratingStance}${ratingHistory && ratingHistory.length > 0 ? ` Đã ghi nhận ${ratingHistory.length} biến động lịch sử điểm.` : ""}`,
      implication:
        stats.ratingsCount < 3
          ? "Chấm điểm ít nhất 3–5 bộ đã đọc để kích hoạt mô hình Gợi ý cá nhân hóa (User-Based CF)."
          : "Hệ thống đã đủ tín hiệu xếp hạng để lọc ra các tựa truyện cùng nhóm độc giả có khẩu vị tương đồng.",
      tone: stats.ratingsCount >= 3 ? "accent" : "warning",
    },
  ];

  return {
    badge: "Personal Reading Intelligence",
    personaTitle,
    personaSubtitle,
    headlineMetric: {
      label: "Valid Read Depth",
      value: `${validRate}%`,
      hint: `${chaptersPerManga.toFixed(1)} ch / tựa truyện`,
    },
    badges: [
      { label: `📚 ${stats.uniqueMangasInteracted} bộ tương tác`, tone: "accent" },
      { label: `✓ ${stats.validViews} lượt đọc hợp lệ`, tone: "success" },
      {
        label: `★ ${avgRating !== null ? `${avgRating.toFixed(1)}/10` : "Chưa chấm điểm"}`,
        tone: "warning",
      },
    ],
    insights,
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildListDataStory(stats: ListMetadataStats): StorytellingNarrativeProps {
  const topTag = stats.tagDistribution[0];
  const topStatus = stats.publicationStatusDistribution[0];
  const completedRow = stats.publicationStatusDistribution.find(
    (s) => s.status.toLowerCase() === "completed",
  );
  const completedPct = completedRow?.percent ?? 0;
  const chaptersPerTitle =
    stats.totalMangas > 0 ? stats.totalExportedChapters / stats.totalMangas : 0;

  let personaTitle = "Bộ sưu tập Đa sắc · Diverse Anthology";
  if (topTag && topTag.percent >= 60) {
    personaTitle = `Bộ sưu tập Chuyên đề ${topTag.tagName} · Thematic Vault`;
  } else if (completedPct >= 55) {
    personaTitle = "Tuyển tập Đã Hoàn Kết · Complete Binge Shelf";
  }

  return {
    badge: "Collection Data Storytelling",
    personaTitle,
    personaSubtitle: `Danh sách gồm ${stats.totalMangas} đầu truyện công khai với ${stats.totalExportedChapters.toLocaleString()} chương sẵn sàng đọc (trung bình ${chaptersPerTitle.toFixed(1)} chương/bộ).`,
    headlineMetric: {
      label: "Avg List Rating",
      value: stats.averageListRating !== null ? `★ ${stats.averageListRating.toFixed(2)}` : "—",
      hint: `${stats.ratedMangaCount}/${stats.totalMangas} bộ đã có điểm`,
    },
    badges: [
      { label: `${completedPct}% Completed`, tone: completedPct >= 50 ? "success" : "accent" },
      {
        label: topTag ? `Thống trị: ${topTag.tagName} (${topTag.percent}%)` : "Đa thể loại",
        tone: "accent",
      },
    ],
    insights: [
      {
        category: "Mức độ Hoàn thiện Series",
        title: topStatus
          ? `Nhóm lớn nhất: ${topStatus.status.toUpperCase()} (${topStatus.percent}%)`
          : "Cân bằng trạng thái phát hành",
        narrative: `Trong toàn danh sách có ${completedPct}% tác phẩm đã kết thúc trọn vẹn (${completedRow?.count ?? 0} bộ).`,
        implication:
          completedPct >= 50
            ? "Phù hợp để cày liên tục không lo gián đoạn."
            : "Tỷ lệ truyện còn Ongoing cao — nên theo dõi cập nhật định kỳ hoặc lọc theo Last Updated.",
        tone: completedPct >= 50 ? "success" : "accent",
      },
      {
        category: "Độ tập trung Chủ đề (Pareto)",
        title: topTag
          ? `Thẻ dẫn đầu: ${topTag.tagName} chiếm ${topTag.percent}%`
          : "Phân tán chủ đề",
        narrative: `Ghi nhận ${stats.tagDistribution.length} tag khác nhau trên tổng thể các đầu truyện thuộc danh sách.`,
        implication:
          topTag && topTag.percent >= 65
            ? "Tính đồng nhất rất cao — có thể dùng danh sách này để clone/merge làm bộ lọc gu đọc chuyên biệt."
            : "Danh sách mang tính pha trộn đa thể loại, thích hợp dùng luân phiên theo tâm trạng.",
        tone: "accent",
      },
    ],
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildAdminDataStory(
  summary: AdminMangaStatsResponse["summary"],
  items: AdminMangaStatsResponse["items"],
): StorytellingNarrativeProps {
  const totalTopViews = items.reduce((acc, it) => acc + it.validViews, 0);
  const top3Views = items.slice(0, 3).reduce((acc, it) => acc + it.validViews, 0);
  const top3Share = totalTopViews > 0 ? Math.round((top3Views / totalTopViews) * 100) : 0;
  const hiddenCount = items.filter((it) => it.visibilityStatus !== "PUBLIC").length;
  const engagementPer1kViews =
    summary.totalValidViews > 0
      ? Math.round(
          ((summary.totalListAdditions + summary.totalComments) / summary.totalValidViews) *
            1000 *
            10,
        ) / 10
      : 0;

  return {
    badge: "Platform Analytics & Trend Forecasting",
    personaTitle:
      summary.pendingReports > 0
        ? `Cần chú ý Kiểm duyệt · ${summary.pendingReports} báo cáo đang chờ xử lý`
        : "Hệ sinh thái Ổn định · Hàng đợi kiểm duyệt sạch",
    personaSubtitle: `Kho dữ liệu hiện có ${summary.totalMangas.toLocaleString()} đầu truyện tạo ra ${summary.totalValidViews.toLocaleString()} lượt đọc hợp lệ, ${summary.totalListAdditions.toLocaleString()} lượt lưu danh sách và ${summary.totalComments.toLocaleString()} bình luận.`,
    headlineMetric: {
      label: "Top-3 Traffic Share",
      value: `${top3Share}%`,
      hint: "Tỷ trọng view trong Top 100",
    },
    badges: [
      { label: `${engagementPer1kViews} tương tác / 1k views`, tone: "accent" },
      {
        label:
          summary.pendingReports > 0
            ? `⚠ ${summary.pendingReports} báo cáo chờ duyệt`
            : "✓ 0 báo cáo tồn đọng",
        tone: summary.pendingReports > 0 ? "warning" : "success",
      },
      { label: `${hiddenCount} truyện ẩn trong Top 100`, tone: "muted" },
    ],
    insights: [
      {
        category: "Tập trung Lưu lượng (Pareto)",
        title: `Top 3 đầu truyện dẫn đầu chiếm ${top3Share}% tổng view nhóm dẫn đầu`,
        narrative: (() => {
          const topItem = items[0];
          return topItem
            ? `Dẫn đầu hiện tại là "${topItem.title}" với ${topItem.validViews.toLocaleString()} lượt đọc hợp lệ (★ ${topItem.averageRating.toFixed(2)}).`
            : "Chưa có dữ liệu lưu lượng.";
        })(),
        implication:
          top3Share >= 50
            ? "Lưu lượng lệch mạnh về nhóm đầu bảng: nên đẩy các đầu truyện điểm cao ở nhóm sau lên mục Gợi ý / Trang chủ để phân bổ đều traffic."
            : "Lưu lượng phân bổ khỏe trên nhiều tựa truyện thay vì phụ thuộc vào một vài hit đơn lẻ.",
        tone: top3Share >= 60 ? "warning" : "success",
      },
      {
        category: "Áp lực Kiểm duyệt & Cộng đồng",
        title: `${summary.totalComments.toLocaleString()} bình luận · ${summary.pendingReports} báo cáo chờ xử lý`,
        narrative: `Cường độ tương tác xã hội đạt ${engagementPer1kViews} lượt lưu + bình luận trên mỗi 1,000 lượt đọc hợp lệ.`,
        implication:
          summary.pendingReports > 0
            ? "Ưu tiên giải quyết các báo cáo COMMENT/MANGA đang mở để giữ trải nghiệm đọc an toàn spoiler."
            : "Tiếp tục chạy Reconcile định kỳ khi có biến động lớn để đồng bộ hóa bộ đếm.",
        tone: summary.pendingReports > 0 ? "warning" : "success",
        actionLabel: summary.pendingReports > 0 ? "Mở Moderation Queue →" : undefined,
        actionTo: summary.pendingReports > 0 ? "/admin/reports" : undefined,
      },
    ],
  };
}
