import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";

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
        <div className="flex flex-wrap items-center justify-center gap-4">
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
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="flex max-w-[80px] flex-col items-center justify-center overflow-hidden text-center leading-tight">
                <span
                  className="line-clamp-2 w-full break-words text-[9px] font-semibold uppercase"
                  style={{ color: "var(--mr-text-muted)" }}
                >
                  {active ? active.label : centerLabel}
                </span>
                <span
                  className="mt-0.5 text-sm font-bold"
                  style={{ color: "var(--mr-text-primary)" }}
                >
                  {active ? `${(active.pct * 100).toFixed(1)}%` : centerValue}
                </span>
              </div>
            </div>
          </div>

          <ul className="w-full min-w-[200px] flex-1 space-y-1.5 text-xs">
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
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: seg.color }}
                      />
                      <span
                        className="break-words leading-snug font-medium"
                        style={{ color: "var(--mr-text-primary)" }}
                      >
                        {seg.label}
                      </span>
                    </span>
                    <span
                      className="shrink-0 font-mono text-[11px]"
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
              <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
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

  const cx = 180;
  const cy = 132;
  const r = 74;

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
        lx: cx + Math.cos(angle) * (r + 22),
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
          <svg viewBox="0 0 360 264" className="h-auto w-full max-w-[360px]">
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
              const short = c.label.length > 14 ? `${c.label.slice(0, 13)}…` : c.label;
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
                <span
                  className="min-w-0 break-words font-semibold"
                  style={{ color: "var(--mr-text-primary)" }}
                >
                  {st.label}
                </span>
                <div className="flex shrink-0 items-center gap-2 font-mono">
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
              <p className="break-words text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                {st.hint}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
