import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CatalogPagination } from "../../components/CatalogPagination";
import {
  buildAdminDataStory,
  EngagementFunnelChart,
  InteractiveDonutChart,
  InteractiveTrendChart,
  StorytellingNarrativeCard,
} from "../../components/DataStoryCharts";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { UserAvatar } from "../../components/UserAvatar";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import {
  ApiClientError,
  apiClient,
  type ActivityLogItem,
  type AdminReportItem,
  type EtlJobDetail,
  type ReaderStatsPayload,
  type UserSummary,
} from "../../services/apiClient";
import { frontendConfig } from "../../services/config";

const REPORT_REASON_META: Record<
  string,
  { title: string; summary: string; severity: "danger" | "warning" | "accent" }
> = {
  UNMARKED_SPOILER: {
    title: "Unmarked Story Spoiler",
    summary: "Reader flagged plot spoilers posted without hiding behind spoiler warning.",
    severity: "warning",
  },
  SPOILER_UNMARKED: {
    title: "Unmarked Story Spoiler",
    summary: "Reader flagged plot spoilers posted without hiding behind spoiler warning.",
    severity: "warning",
  },
  HARASSMENT: {
    title: "Harassment or Personal Attack",
    summary: "Abusive language, targeted harassment, or community conduct breach.",
    severity: "danger",
  },
  SPAM: {
    title: "Spam or Promotional Link",
    summary: "Unsolicited advertisements, repetitive noise, or off-topic self-promotion.",
    severity: "warning",
  },
  INAPPROPRIATE_CONTENT: {
    title: "Inappropriate or Explicit Content",
    summary: "Content violating platform age-rating or safety standards.",
    severity: "danger",
  },
  WRONG_METADATA: {
    title: "Incorrect Title or Metadata",
    summary: "Mismatched cover art, synopsis, tags, or chapter numbering issue.",
    severity: "accent",
  },
  BROKEN_PAGES: {
    title: "Broken or Unreadable Chapter Pages",
    summary: "Missing images, corrupted chapter order, or unreadable scan upload.",
    severity: "warning",
  },
  COMMUNITY_REPORT: {
    title: "Community Policy Violation",
    summary: "Community-submitted moderation flag requiring moderator review.",
    severity: "warning",
  },
};

function getReasonMeta(code: string) {
  return (
    REPORT_REASON_META[code.toUpperCase()] ?? {
      title: code.replace(/_/g, " "),
      summary: "User-submitted report requiring editorial verification.",
      severity: "accent" as const,
    }
  );
}

const ACTION_LABELS: Record<string, string> = {
  DELETE_COMMENT: "Delete violating comment",
  FORCE_SPOILER: "Lock & hide comment behind spoiler warning",
  LOCK_ACCOUNT: "Lock user account & revoke active sessions",
  HIDE_MANGA: "Hide manga from public catalog",
  DELETE_MANGA: "Soft-delete manga title (with tombstone)",
  IGNORE: "Dismiss report (no violation found)",
  SYSTEM_AUTO_CLOSE_TARGET_MISSING: "Automatically closed (target no longer exists)",
  AUTO_IGNORE_FUTURE_REPORTS_DISABLED: "Auto-ignored (future reports disabled on manga)",
};

const REPORT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Pending Review", color: "var(--mr-warning)" },
  RESOLVED: { label: "Resolved", color: "var(--mr-success)" },
  IGNORED: { label: "Dismissed", color: "var(--mr-text-muted)" },
  CLOSED: { label: "Auto-Closed", color: "var(--mr-text-muted)" },
};

function humanizeActionCode(code: string | null | undefined): string {
  if (!code) return "—";
  return ACTION_LABELS[code] ?? code.replace(/_/g, " ");
}

function formatActivityLogSummary(log: ActivityLogItem): {
  title: string;
  summary: string;
} {
  const details = log.details || {};
  const labels: Record<string, string> = {
    LOGIN: "Signed in to platform",
    ACCOUNT_REGISTERED: "Registered new account",
    EMAIL_VERIFICATION_SUCCEEDED: "Completed email OTP verification",
    PROFILE_UPDATE: "Updated profile details",
    AVATAR_UPDATE: "Uploaded new profile avatar",
    PASSWORD_CHANGE: "Changed password & revoked other sessions",
    RATING: "Manga rating updated",
    COMMENT: "Posted a comment",
    COMMENT_DELETED: "Comment deleted",
    COMMENT_FORCE_SPOILER: "Comment locked as spoiler by moderator",
    REPORT: "Submitted moderation report",
    REPORT_RESOLVE: "Resolved moderation report",
    REPORT_IGNORED: "Dismissed moderation report",
    SYSTEM_REPORT_CLOSED: "System auto-closed report (target missing)",
    ACCOUNT_LOCK: "Account locked by administrator",
    ACCOUNT_UNLOCK: "Account unlocked by administrator",
    MANGA_HIDE: "Manga hidden from public catalog",
    MANGA_SHOW: "Manga restored to public catalog",
    MANGA_DELETE: "Manga soft-deleted",
  };
  const title = labels[log.eventType] ?? log.eventType.replace(/_/g, " ");
  const parts: string[] = [];
  if (typeof details.action === "string") {
    parts.push(`Action: ${humanizeActionCode(details.action)}`);
  }
  if (typeof details.score === "number") {
    parts.push(`Score: ${details.score}/10`);
  }
  if (typeof details.previous_score === "number") {
    parts.push(`Previous score: ${details.previous_score}/10`);
  }
  if (typeof details.category === "string") {
    parts.push(`Reason: ${details.category}`);
  }
  if (typeof details.reason === "string") {
    parts.push(`Note: ${details.reason}`);
  }
  if (typeof details.note === "string") {
    parts.push(`Note: ${details.note}`);
  }
  if (typeof details.new_status === "string") {
    parts.push(`New status: ${details.new_status}`);
  }
  if (details.by_admin === true) {
    parts.push("Performed by moderator");
  }
  if (parts.length === 0 && log.targetType) {
    parts.push(`Target: ${log.targetType.toLowerCase()}`);
  }
  return {
    title,
    summary: parts.length > 0 ? parts.join(" · ") : "Recorded system audit event",
  };
}

function ReportTargetCard({ report }: { report: AdminReportItem }) {
  const t = report.target || {};
  const str = (key: string): string | null => {
    const val = t[key];
    return typeof val === "string" && val.trim() ? val : null;
  };
  const bool = (key: string): boolean => Boolean(t[key]);

  if (report.reportType === "COMMENT") {
    const snapshot = str("snapshot") ?? "(No comment snapshot available)";
    const authorDisplay = str("commentAuthorDisplayName");
    const authorUser = str("commentAuthorUsername");
    const mangaSlug = str("mangaSlug");
    const mangaTitle = str("mangaTitle");
    const chapterNumber = str("chapterNumber");
    const createdAt = str("createdAt");
    const isDeleted = bool("isDeleted");
    const isSpoilerLocked = bool("isSpoilerLocked");

    return (
      <div
        className="space-y-3 rounded-[var(--mr-radius-md)] border p-3.5 text-xs"
        style={{
          backgroundColor: "var(--mr-bg-elevated)",
          borderColor: "var(--mr-border-subtle)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold" style={{ color: "var(--mr-text-primary)" }}>
            Reported Comment Preview
          </span>
          <div className="flex flex-wrap gap-1.5">
            <span
              className="rounded px-2 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: isDeleted
                  ? "rgba(248, 113, 113, 0.15)"
                  : "rgba(52, 211, 153, 0.15)",
                color: isDeleted ? "var(--mr-danger)" : "var(--mr-success)",
              }}
            >
              {isDeleted ? "Deleted Comment" : "Currently Visible"}
            </span>
            <span
              className="rounded px-2 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: isSpoilerLocked
                  ? "rgba(251, 191, 36, 0.15)"
                  : "var(--mr-bg-surface)",
                color: isSpoilerLocked ? "var(--mr-warning)" : "var(--mr-text-muted)",
              }}
            >
              {isSpoilerLocked ? "Spoiler Locked by Admin" : "Spoiler Not Locked"}
            </span>
          </div>
        </div>

        <blockquote
          className="rounded border-l-4 px-3 py-2 text-sm italic"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-accent)",
            color: "var(--mr-text-primary)",
          }}
        >
          &ldquo;{snapshot}&rdquo;
        </blockquote>

        <div className="grid gap-1.5 sm:grid-cols-2" style={{ color: "var(--mr-text-secondary)" }}>
          <div>
            <span style={{ color: "var(--mr-text-muted)" }}>Comment Author: </span>
            {authorUser ? (
              <Link
                to={`/profile/${authorUser}`}
                className="font-semibold hover:underline"
                style={{ color: "var(--mr-accent)" }}
              >
                {authorDisplay || authorUser} (@{authorUser})
              </Link>
            ) : (
              <span>Unavailable</span>
            )}
          </div>
          <div>
            <span style={{ color: "var(--mr-text-muted)" }}>Posted On: </span>
            {mangaSlug ? (
              <Link
                to={`/manga/${mangaSlug}`}
                className="font-medium hover:underline"
                style={{ color: "var(--mr-accent)" }}
              >
                {mangaTitle || mangaSlug}
                {chapterNumber ? ` · Ch. ${chapterNumber}` : ""}
              </Link>
            ) : (
              <span>Manga record</span>
            )}
          </div>
          {createdAt ? (
            <div>
              <span style={{ color: "var(--mr-text-muted)" }}>Comment Date: </span>
              <span>{new Date(createdAt).toLocaleString()}</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (report.reportType === "MANGA") {
    const mangaTitle = str("mangaTitle") ?? str("snapshot") ?? "Unknown Manga";
    const mangaSlug = str("mangaSlug");
    const chapterSnap = str("chapterSnapshot");
    const vis = str("currentVisibility") ?? "UNKNOWN";
    const pubStatus = str("publicationStatus");
    const contentRating = str("contentRating");
    const ignoreFuture = bool("ignoreAllReports");

    return (
      <div
        className="space-y-2.5 rounded-[var(--mr-radius-md)] border p-3.5 text-xs"
        style={{
          backgroundColor: "var(--mr-bg-elevated)",
          borderColor: "var(--mr-border-subtle)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold" style={{ color: "var(--mr-text-primary)" }}>
            Reported Manga Details
          </span>
          <span
            className="rounded px-2 py-0.5 text-[10px] font-semibold"
            style={{
              backgroundColor:
                vis === "PUBLIC" ? "rgba(52, 211, 153, 0.15)" : "rgba(251, 191, 36, 0.15)",
              color: vis === "PUBLIC" ? "var(--mr-success)" : "var(--mr-warning)",
            }}
          >
            Visibility: {vis}
          </span>
        </div>
        <p className="text-sm font-semibold">
          {mangaSlug ? (
            <Link
              to={`/manga/${mangaSlug}`}
              className="hover:underline"
              style={{ color: "var(--mr-accent)" }}
            >
              {mangaTitle}
            </Link>
          ) : (
            mangaTitle
          )}
        </p>
        <div className="space-y-1" style={{ color: "var(--mr-text-secondary)" }}>
          <p>
            <strong style={{ color: "var(--mr-text-muted)" }}>Chapter Scope:</strong>{" "}
            {chapterSnap || "Whole Manga Series"}
          </p>
          {pubStatus || contentRating ? (
            <p className="capitalize">
              <strong style={{ color: "var(--mr-text-muted)" }}>Classification:</strong>{" "}
              {[pubStatus, contentRating].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          <p>
            <strong style={{ color: "var(--mr-text-muted)" }}>Auto-ignore future reports:</strong>{" "}
            {ignoreFuture ? "Enabled" : "Disabled"}
          </p>
        </div>
      </div>
    );
  }

  // ACCOUNT report
  const username = str("username");
  const displayName = str("displayName") ?? str("snapshot") ?? "Reader Account";
  const accountStatus = str("currentStatus") ?? "UNKNOWN";
  const email = str("email");

  return (
    <div
      className="space-y-2 rounded-[var(--mr-radius-md)] border p-3.5 text-xs"
      style={{
        backgroundColor: "var(--mr-bg-elevated)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold" style={{ color: "var(--mr-text-primary)" }}>
          Reported Account Details
        </span>
        <span
          className="rounded px-2 py-0.5 text-[10px] font-semibold"
          style={{
            backgroundColor:
              accountStatus === "ACTIVE" ? "rgba(52, 211, 153, 0.15)" : "rgba(248, 113, 113, 0.15)",
            color: accountStatus === "ACTIVE" ? "var(--mr-success)" : "var(--mr-danger)",
          }}
        >
          Status: {accountStatus}
        </span>
      </div>
      <p className="text-sm font-semibold">
        {username ? (
          <Link
            to={`/profile/${username}`}
            className="hover:underline"
            style={{ color: "var(--mr-accent)" }}
          >
            {displayName} (@{username})
          </Link>
        ) : (
          displayName
        )}
      </p>
      {email ? <p style={{ color: "var(--mr-text-secondary)" }}>Email: {email}</p> : null}
    </div>
  );
}

/* ============================================================================
 * 1. Admin Dashboard & Manga Interaction Statistics (/admin)
 * ============================================================================ */
const DASHBOARD_PAGE_SIZE = 20;

export function AdminDashboardPage() {
  const statsQuery = useQuery({
    queryKey: ["admin", "manga-stats"],
    queryFn: () => apiClient.adminMangaStatistics(),
  });
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");
  const [chartMetric, setChartMetric] = useState<
    "validViews" | "listAdditions" | "commentsCount" | "averageRating"
  >("validViews");
  const [sortBy, setSortBy] = useState<
    | "VIEWS_DESC"
    | "RATING_DESC"
    | "RATINGS_COUNT_DESC"
    | "LISTS_DESC"
    | "COMMENTS_DESC"
    | "TITLE_ASC"
  >("VIEWS_DESC");
  const [page, setPage] = useState(1);

  const filteredItems = useMemo(() => {
    const raw = statsQuery.data?.data.items ?? [];
    const norm = q.trim().toLowerCase();
    const list = raw.filter((row) => {
      if (visibilityFilter && row.visibilityStatus !== visibilityFilter) return false;
      if (
        norm &&
        !row.title.toLowerCase().includes(norm) &&
        !row.slug.toLowerCase().includes(norm)
      ) {
        return false;
      }
      return true;
    });
    const sorted = [...list];
    if (sortBy === "RATING_DESC") {
      sorted.sort((a, b) => b.averageRating - a.averageRating);
    } else if (sortBy === "RATINGS_COUNT_DESC") {
      sorted.sort((a, b) => b.ratingsCount - a.ratingsCount);
    } else if (sortBy === "LISTS_DESC") {
      sorted.sort((a, b) => b.listAdditions - a.listAdditions);
    } else if (sortBy === "COMMENTS_DESC") {
      sorted.sort((a, b) => b.commentsCount - a.commentsCount);
    } else if (sortBy === "TITLE_ASC") {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      sorted.sort((a, b) => b.validViews - a.validViews);
    }
    return sorted;
  }, [statsQuery.data, q, visibilityFilter, sortBy]);

  useEffect(() => {
    setPage(1);
  }, [q, visibilityFilter, sortBy]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * DASHBOARD_PAGE_SIZE;
    return filteredItems.slice(start, start + DASHBOARD_PAGE_SIZE);
  }, [filteredItems, page]);

  async function handleReconcile() {
    setBusy(true);
    setReconcileResult(null);
    try {
      const res = await apiClient.adminReconcileCounters();
      setReconcileResult(
        `Reconciled counters — lists: ${res.data.fixedLists}, comments: ${res.data.fixedComments}, ratings: ${res.data.fixedRatings}.`,
      );
      void statsQuery.refetch();
    } catch (err) {
      setReconcileResult(err instanceof ApiClientError ? err.message : "Reconciliation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
            Admin — Analytics Dashboard
          </h1>
          <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
            Real-time manga interaction metrics, pending moderation reports, and counter
            reconciliation.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleReconcile()}
          className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-xs font-semibold"
          style={{ borderColor: "var(--mr-accent)", color: "var(--mr-accent)" }}
        >
          {busy ? "Reconciling..." : "Reconcile Denormalized Counters"}
        </button>
      </div>

      {reconcileResult ? (
        <p className="text-xs font-medium" style={{ color: "var(--mr-success)" }}>
          {reconcileResult}
        </p>
      ) : null}

      {statsQuery.isLoading ? (
        <LoadingState variant="dashboard" label="Loading admin statistics..." />
      ) : statsQuery.isError ? (
        <ErrorState onRetry={() => void statsQuery.refetch()} />
      ) : statsQuery.data ? (
        <>
          <StorytellingNarrativeCard
            {...buildAdminDataStory(statsQuery.data.data.summary, statsQuery.data.data.items)}
          />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { label: "Total Mangas", val: statsQuery.data.data.summary.totalMangas },
              { label: "Valid Views", val: statsQuery.data.data.summary.totalValidViews },
              { label: "List Additions", val: statsQuery.data.data.summary.totalListAdditions },
              { label: "Comments", val: statsQuery.data.data.summary.totalComments },
              { label: "Pending Reports", val: statsQuery.data.data.summary.pendingReports },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-[var(--mr-radius-md)] border p-4"
                style={{
                  backgroundColor: "var(--mr-bg-surface)",
                  borderColor: "var(--mr-border-subtle)",
                }}
              >
                <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                  {card.label}
                </p>
                <p className="mt-1 text-xl font-bold">{card.val.toLocaleString()}</p>
              </div>
            ))}
          </div>

          {/* Interactive Charts */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold" style={{ color: "var(--mr-text-muted)" }}>
                Interactive Visual Analytics (Top 12 Titles in View)
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: "validViews", label: "Valid Views" },
                    { id: "listAdditions", label: "List Saves" },
                    { id: "commentsCount", label: "Comments" },
                    { id: "averageRating", label: "Avg Rating" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setChartMetric(m.id)}
                    className="cursor-pointer rounded-full border px-2.5 py-0.5 font-medium"
                    style={{
                      backgroundColor:
                        chartMetric === m.id ? "var(--mr-accent)" : "var(--mr-bg-surface)",
                      borderColor:
                        chartMetric === m.id ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                      color: chartMetric === m.id ? "#ffffff" : "var(--mr-text-secondary)",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
              <InteractiveTrendChart
                title="Top Manga Performance Comparison"
                subtitle="So sánh trực tiếp với đường trung bình và chuyển đổi Bar / Trend Line"
                data={filteredItems.slice(0, 12).map((row) => ({
                  key: row.mangaId,
                  label: row.title,
                  value: row[chartMetric],
                  sublabel: `★ ${row.averageRating.toFixed(2)} · ${row.ratingsCount} ratings`,
                  href: `/manga/${row.slug}`,
                }))}
                valueFormatter={(v) =>
                  chartMetric === "averageRating" ? `${v.toFixed(2)}/10` : v.toLocaleString()
                }
              />
              <InteractiveDonutChart
                title="Catalog Visibility Split"
                subtitle="Tỷ lệ trạng thái hiển thị trong Top 100"
                centerLabel="Tracked"
                centerValue={String(statsQuery.data.data.items.length)}
                items={[
                  {
                    key: "PUBLIC",
                    label: "Public Catalog",
                    value: statsQuery.data.data.items.filter(
                      (it) => it.visibilityStatus === "PUBLIC",
                    ).length,
                    color: "#34d399",
                    hint: "Truyện hiển thị công khai cho toàn bộ độc giả.",
                  },
                  {
                    key: "HIDDEN",
                    label: "Hidden / Moderated",
                    value: statsQuery.data.data.items.filter(
                      (it) => it.visibilityStatus !== "PUBLIC",
                    ).length,
                    color: "#fbbf24",
                    hint: "Truyện đang bị ẩn khỏi tìm kiếm công khai.",
                  },
                ]}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <h2 className="text-sm font-semibold">
              Top Manga Interaction Metrics ({filteredItems.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              <input
                type="search"
                aria-label="Search manga metrics"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter manga title..."
                className="w-48 rounded border px-2.5 py-1"
                style={{
                  backgroundColor: "var(--mr-bg-surface)",
                  borderColor: "var(--mr-border-strong)",
                  color: "var(--mr-text-primary)",
                }}
              />
              <select
                aria-label="Filter visibility"
                value={visibilityFilter}
                onChange={(e) => setVisibilityFilter(e.target.value)}
                className="rounded border px-2 py-1"
                style={{
                  backgroundColor: "var(--mr-bg-surface)",
                  borderColor: "var(--mr-border-strong)",
                  color: "var(--mr-text-primary)",
                }}
              >
                <option value="">All Visibility</option>
                <option value="PUBLIC">Public Only</option>
                <option value="HIDDEN">Hidden Only</option>
              </select>
              <select
                aria-label="Sort manga metrics"
                value={sortBy}
                onChange={(e) =>
                  setSortBy(
                    e.target.value as
                      | "VIEWS_DESC"
                      | "RATING_DESC"
                      | "RATINGS_COUNT_DESC"
                      | "LISTS_DESC"
                      | "COMMENTS_DESC"
                      | "TITLE_ASC",
                  )
                }
                className="rounded border px-2 py-1"
                style={{
                  backgroundColor: "var(--mr-bg-surface)",
                  borderColor: "var(--mr-border-strong)",
                  color: "var(--mr-text-primary)",
                }}
              >
                <option value="VIEWS_DESC">Most Valid Views</option>
                <option value="RATING_DESC">Highest Average Rating</option>
                <option value="RATINGS_COUNT_DESC">Most Ratings</option>
                <option value="LISTS_DESC">Most List Additions</option>
                <option value="COMMENTS_DESC">Most Comments</option>
                <option value="TITLE_ASC">Title (A–Z)</option>
              </select>
            </div>
          </div>

          <div
            className="overflow-x-auto rounded-[var(--mr-radius-md)] border"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <table className="w-full text-left text-xs">
              <thead
                className="border-b uppercase"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-muted)",
                }}
              >
                <tr>
                  <th className="px-3 py-2">Manga</th>
                  <th className="px-3 py-2">Visibility</th>
                  <th className="px-3 py-2">Valid Views</th>
                  <th className="px-3 py-2">In Lists</th>
                  <th className="px-3 py-2">Rating</th>
                  <th className="px-3 py-2">Comments</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--mr-border-subtle)" }}>
                {pagedItems.map((row) => (
                  <tr key={row.mangaId}>
                    <td className="px-3 py-2 font-medium">
                      <Link
                        to={`/manga/${row.slug}`}
                        className="hover:underline"
                        style={{ color: "var(--mr-text-primary)" }}
                      >
                        {row.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          backgroundColor:
                            row.visibilityStatus === "PUBLIC"
                              ? "rgba(52, 211, 153, 0.15)"
                              : "rgba(251, 191, 36, 0.15)",
                          color:
                            row.visibilityStatus === "PUBLIC"
                              ? "var(--mr-success)"
                              : "var(--mr-warning)",
                        }}
                      >
                        {row.visibilityStatus === "PUBLIC" ? "Public" : "Hidden"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono">{row.validViews.toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono">{row.listAdditions.toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono">
                      ★ {row.averageRating.toFixed(2)} ({row.ratingsCount})
                    </td>
                    <td className="px-3 py-2 font-mono">{row.commentsCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <CatalogPagination
            page={page}
            total={filteredItems.length}
            pageSize={DASHBOARD_PAGE_SIZE}
            hasNext={page * DASHBOARD_PAGE_SIZE < filteredItems.length}
            onPageChange={setPage}
            label="Admin dashboard pagination"
          />
        </>
      ) : null}
    </div>
  );
}

/* ============================================================================
 * 2. Admin Accounts & Activity Logs (/admin/accounts)
 * ============================================================================ */
export function AdminAccountsPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 280);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [logsPage, setLogsPage] = useState(1);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<UserSummary | null>(null);
  const [readerStats, setReaderStats] = useState<ReaderStatsPayload | null>(null);
  const [inspectLoading, setInspectLoading] = useState<string | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [reason, setReason] = useState("Policy moderation action");
  const [notice, setNotice] = useState<string | null>(null);

  const selectedAccountId = selectedAccount?.accountId ?? null;

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, statusFilter]);

  useEffect(() => {
    setLogsPage(1);
  }, [selectedAccountId, eventTypeFilter]);

  const accountsQuery = useQuery({
    queryKey: ["admin", "accounts", debouncedQ, statusFilter, page],
    queryFn: () =>
      apiClient.adminListAccounts({
        q: debouncedQ.trim() || undefined,
        status: statusFilter || undefined,
        page,
      }),
  });

  const logsQuery = useQuery({
    queryKey: ["admin", "activity-logs", selectedAccountId, eventTypeFilter, logsPage],
    queryFn: () =>
      apiClient.adminListActivityLogs({
        accountId: selectedAccountId ?? undefined,
        eventType: eventTypeFilter || undefined,
        page: logsPage,
      }),
  });

  async function handleLockToggle(accountId: string, currentlyLocked: boolean) {
    setNotice(null);
    try {
      if (currentlyLocked) {
        await apiClient.adminUnlockAccount(accountId, reason.trim() || "Admin unlock");
        setNotice("Account unlocked.");
      } else {
        await apiClient.adminLockAccount(accountId, reason.trim() || "Admin lock");
        setNotice("Account locked and active sessions revoked.");
      }
      void queryClient.invalidateQueries({ queryKey: ["admin", "accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "activity-logs"] });
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "Action failed.");
    }
  }

  async function inspectReaderStats(acc: UserSummary) {
    setSelectedAccount(acc);
    setLogsPage(1);
    setInspectLoading(acc.accountId);
    setInspectError(null);
    setInspectModalOpen(true);
    try {
      const res = await apiClient.adminGetReaderStats(acc.accountId);
      setReaderStats(res.data);
    } catch (err) {
      setReaderStats(null);
      setInspectError(
        err instanceof ApiClientError ? err.message : "Could not load reader statistics.",
      );
    } finally {
      setInspectLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin — Accounts &amp; Activity Logs</h1>
        <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
          Search readers, lock/unlock accounts with mandatory reason &amp; immediate session
          revocation, and inspect user statistics &amp; human-readable activity logs.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search username, email, display name..."
          className="min-w-56 rounded border px-3 py-1.5"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
            color: "var(--mr-text-primary)",
          }}
        />
        <select
          aria-label="Filter account status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border px-2.5 py-1.5"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
            color: "var(--mr-text-primary)",
          }}
        >
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="LOCKED">Locked</option>
          <option value="PENDING_VERIFICATION">Pending Email Verification</option>
        </select>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Lock/Unlock audit reason..."
          className="min-w-56 flex-1 rounded border px-3 py-1.5"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
            color: "var(--mr-text-primary)",
          }}
        />
      </div>

      {notice ? (
        <p className="text-xs font-medium" style={{ color: "var(--mr-accent)" }}>
          {notice}
        </p>
      ) : null}

      {accountsQuery.isLoading ? (
        <LoadingState variant="table" count={8} label="Loading accounts..." />
      ) : accountsQuery.data && accountsQuery.data.data.length === 0 ? (
        <EmptyState title="No accounts matched your search" />
      ) : (
        <>
          <div
            className="overflow-x-auto rounded-[var(--mr-radius-md)] border"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <table className="w-full text-left text-xs">
              <thead
                className="border-b uppercase"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-muted)",
                }}
              >
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--mr-border-subtle)" }}>
                {accountsQuery.data?.data.map((acc) => {
                  const isSelected = selectedAccountId === acc.accountId;
                  return (
                    <tr
                      key={acc.accountId}
                      style={{
                        backgroundColor: isSelected ? "var(--mr-bg-elevated)" : "transparent",
                      }}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar src={acc.avatarUrl} name={acc.displayName} size="sm" />
                          <div>
                            <Link
                              to={`/profile/${acc.username}`}
                              className="font-semibold hover:underline"
                              style={{ color: "var(--mr-text-primary)" }}
                            >
                              {acc.displayName}
                            </Link>
                            <p style={{ color: "var(--mr-text-muted)" }}>
                              @{acc.username} · {acc.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="rounded px-2 py-0.5 text-[10px] font-semibold"
                          style={{
                            backgroundColor: "var(--mr-bg-elevated)",
                            color:
                              acc.role === "ADMIN"
                                ? "var(--mr-accent)"
                                : "var(--mr-text-secondary)",
                          }}
                        >
                          {acc.role === "ADMIN" ? "Administrator" : "Reader"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="rounded px-2 py-0.5 text-[10px] font-semibold"
                          style={{
                            backgroundColor:
                              acc.status === "ACTIVE"
                                ? "rgba(52, 211, 153, 0.15)"
                                : acc.status === "LOCKED"
                                  ? "rgba(248, 113, 113, 0.15)"
                                  : "rgba(251, 191, 36, 0.15)",
                            color:
                              acc.status === "ACTIVE"
                                ? "var(--mr-success)"
                                : acc.status === "LOCKED"
                                  ? "var(--mr-danger)"
                                  : "var(--mr-warning)",
                          }}
                        >
                          {acc.status === "PENDING_VERIFICATION"
                            ? "Pending Verification"
                            : acc.status === "LOCKED"
                              ? "Locked"
                              : "Active"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => void inspectReaderStats(acc)}
                            className="cursor-pointer rounded border px-2.5 py-1 font-medium"
                            style={{
                              backgroundColor: isSelected ? "var(--mr-accent)" : "transparent",
                              borderColor: isSelected
                                ? "var(--mr-accent)"
                                : "var(--mr-border-strong)",
                              color: isSelected ? "#ffffff" : "var(--mr-text-primary)",
                            }}
                          >
                            {inspectLoading === acc.accountId ? "Loading..." : "Logs & Stats"}
                          </button>
                          {acc.role === "READER" ? (
                            <button
                              type="button"
                              onClick={() =>
                                void handleLockToggle(acc.accountId, acc.status === "LOCKED")
                              }
                              className="cursor-pointer rounded border px-2 py-1 font-medium"
                              style={{
                                borderColor:
                                  acc.status === "LOCKED"
                                    ? "var(--mr-success)"
                                    : "var(--mr-danger)",
                                color:
                                  acc.status === "LOCKED"
                                    ? "var(--mr-success)"
                                    : "var(--mr-danger)",
                              }}
                            >
                              {acc.status === "LOCKED" ? "Unlock" : "Lock"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {accountsQuery.data ? (
            <CatalogPagination
              page={page}
              total={accountsQuery.data.meta.total}
              pageSize={accountsQuery.data.meta.pageSize || 24}
              hasNext={accountsQuery.data.meta.hasNext}
              onPageChange={setPage}
              label="Admin accounts pagination"
            />
          ) : null}
        </>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">
              Activity Logs{" "}
              {selectedAccount
                ? `— ${selectedAccount.displayName} (@${selectedAccount.username})`
                : "(All Recent Events)"}
            </h2>
            {selectedAccount ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedAccount(null);
                  setReaderStats(null);
                }}
                className="cursor-pointer text-xs underline"
                style={{ color: "var(--mr-accent)" }}
              >
                Show all accounts logs
              </button>
            ) : null}
          </div>
          <select
            aria-label="Filter activity log event type"
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value)}
            className="rounded border px-2.5 py-1.5 text-xs"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <option value="">All Event Types</option>
            <option value="LOGIN">Sign-ins</option>
            <option value="AVATAR_UPDATE">Avatar Updates</option>
            <option value="PROFILE_UPDATE">Profile Updates</option>
            <option value="RATING">Ratings</option>
            <option value="COMMENT">Comments</option>
            <option value="REPORT">Reports</option>
            <option value="ACCOUNT_LOCK">Account Locks</option>
            <option value="ACCOUNT_UNLOCK">Account Unlocks</option>
          </select>
        </div>

        {logsQuery.isLoading ? (
          <LoadingState label="Loading activity logs..." />
        ) : logsQuery.data && logsQuery.data.data.length === 0 ? (
          <EmptyState title="No activity logs recorded" />
        ) : (
          <>
            <ul
              className="divide-y rounded-[var(--mr-radius-md)] border text-xs"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              {logsQuery.data?.data.map((log) => {
                const formatted = formatActivityLogSummary(log);
                return (
                  <li
                    key={log.logId}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                  >
                    <div className="space-y-0.5">
                      <p className="font-semibold" style={{ color: "var(--mr-accent)" }}>
                        {formatted.title}
                      </p>
                      <p style={{ color: "var(--mr-text-secondary)" }}>{formatted.summary}</p>
                    </div>
                    <span className="shrink-0" style={{ color: "var(--mr-text-muted)" }}>
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ul>
            {logsQuery.data ? (
              <CatalogPagination
                page={logsPage}
                total={logsQuery.data.meta.total}
                pageSize={logsQuery.data.meta.pageSize || 30}
                hasNext={logsQuery.data.meta.hasNext}
                onPageChange={setLogsPage}
                label="Activity logs pagination"
              />
            ) : null}
          </>
        )}
      </section>

      {/* Account Logs & Stats Modal Drawer (Immediate Visual Feedback when clicking Logs & Stats) */}
      {inspectModalOpen && selectedAccount ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Account logs and statistics"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInspectModalOpen(false);
          }}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-[var(--mr-radius-lg)] border shadow-2xl"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <div
              className="flex items-center justify-between gap-3 border-b px-5 py-4"
              style={{ borderColor: "var(--mr-border-subtle)" }}
            >
              <div className="flex items-center gap-3">
                <UserAvatar
                  src={selectedAccount.avatarUrl}
                  name={selectedAccount.displayName}
                  size="md"
                />
                <div>
                  <h2 className="text-base font-bold">
                    {selectedAccount.displayName} (@{selectedAccount.username})
                  </h2>
                  <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                    {selectedAccount.email} · {selectedAccount.role} · {selectedAccount.status}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close account inspection modal"
                onClick={() => setInspectModalOpen(false)}
                className="cursor-pointer rounded border px-3 py-1 text-xs font-medium"
                style={{ borderColor: "var(--mr-border-strong)" }}
              >
                Close ✕
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
              {selectedAccount.lockReason ? (
                <div
                  className="rounded border px-3 py-2"
                  style={{
                    backgroundColor: "rgba(248, 113, 113, 0.12)",
                    borderColor: "var(--mr-danger)",
                    color: "var(--mr-danger)",
                  }}
                >
                  <strong>Lock Reason:</strong> {selectedAccount.lockReason}
                </div>
              ) : null}

              <div>
                <h3 className="mb-2 text-sm font-semibold">Reader Behavior Statistics</h3>
                {inspectLoading ? (
                  <LoadingState label="Computing reading statistics..." />
                ) : inspectError ? (
                  <p style={{ color: "var(--mr-danger)" }}>{inspectError}</p>
                ) : readerStats ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      {[
                        { label: "Chapter Opens", val: readerStats.chapterOpens },
                        { label: "Valid Reads", val: readerStats.validViews },
                        { label: "Unique Chapters", val: readerStats.uniqueChaptersRead },
                        { label: "Manga Interacted", val: readerStats.uniqueMangasInteracted },
                        { label: "Ratings Submitted", val: readerStats.ratingsCount },
                        {
                          label: "Avg Score Given",
                          val:
                            readerStats.averageRatingGiven !== null
                              ? `${readerStats.averageRatingGiven.toFixed(2)} / 10`
                              : "No ratings",
                        },
                      ].map((kpi) => (
                        <div
                          key={kpi.label}
                          className="rounded border p-3"
                          style={{
                            backgroundColor: "var(--mr-bg-elevated)",
                            borderColor: "var(--mr-border-subtle)",
                          }}
                        >
                          <p style={{ color: "var(--mr-text-muted)" }}>{kpi.label}</p>
                          <p className="mt-0.5 text-base font-bold">{kpi.val}</p>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <EngagementFunnelChart
                        title="Reader Engagement Funnel"
                        stages={[
                          {
                            key: "opens",
                            label: "Chapter Opens",
                            value: readerStats.chapterOpens,
                            hint: "Total chapter opens recorded",
                            color: "#38bdf8",
                          },
                          {
                            key: "valid",
                            label: "Valid Reads",
                            value: readerStats.validViews,
                            conversionLabel:
                              readerStats.chapterOpens > 0
                                ? `${Math.round((readerStats.validViews / readerStats.chapterOpens) * 100)}%`
                                : "0%",
                            hint: "Qualified sustained reads",
                            color: "#34d399",
                          },
                          {
                            key: "unique",
                            label: "Unique Chapters",
                            value: readerStats.uniqueChaptersRead,
                            hint: `Across ${readerStats.uniqueMangasInteracted} series`,
                            color: "#a78bfa",
                          },
                        ]}
                      />
                      {Object.keys(readerStats.readingStatusBreakdown || {}).length > 0 ? (
                        <InteractiveDonutChart
                          title="Library Status Mix"
                          centerLabel="Saved"
                          centerValue={String(
                            Object.values(readerStats.readingStatusBreakdown).reduce(
                              (a, b) => a + b,
                              0,
                            ),
                          )}
                          items={Object.entries(readerStats.readingStatusBreakdown).map(
                            ([st, cnt]) => ({
                              key: st,
                              label: st.replace(/_/g, " "),
                              value: cnt,
                            }),
                          )}
                        />
                      ) : null}
                    </div>

                    {Object.keys(readerStats.readingStatusBreakdown || {}).length > 0 ? (
                      <div>
                        <p className="mb-1.5 font-semibold">Reading Library Breakdown</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(readerStats.readingStatusBreakdown).map(([st, cnt]) => (
                            <span
                              key={st}
                              className="rounded border px-2.5 py-1 capitalize"
                              style={{
                                backgroundColor: "var(--mr-bg-elevated)",
                                borderColor: "var(--mr-border-subtle)",
                              }}
                            >
                              {st.replace(/_/g, " ").toLowerCase()}: <strong>{cnt}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {readerStats.topTags.length > 0 || readerStats.topCreators.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {readerStats.topTags.length > 0 ? (
                          <div
                            className="rounded border p-3"
                            style={{
                              backgroundColor: "var(--mr-bg-elevated)",
                              borderColor: "var(--mr-border-subtle)",
                            }}
                          >
                            <p className="mb-1.5 font-semibold">Favorite Genres &amp; Tags</p>
                            <ul className="space-y-1">
                              {readerStats.topTags.map((t) => (
                                <li key={t.slug} className="flex justify-between">
                                  <span>{t.name}</span>
                                  <span className="font-mono">{t.count}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {readerStats.topCreators.length > 0 ? (
                          <div
                            className="rounded border p-3"
                            style={{
                              backgroundColor: "var(--mr-bg-elevated)",
                              borderColor: "var(--mr-border-subtle)",
                            }}
                          >
                            <p className="mb-1.5 font-semibold">Top Creators Read</p>
                            <ul className="space-y-1">
                              {readerStats.topCreators.map((c) => (
                                <li key={c.creatorId} className="flex justify-between">
                                  <span>{c.name}</span>
                                  <span className="font-mono">{c.workCount} titles</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p style={{ color: "var(--mr-text-muted)" }}>
                    No reading statistics available for this account.
                  </p>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">
                  Recent Activity History ({logsQuery.data?.meta.total ?? 0})
                </h3>
                {logsQuery.isLoading ? (
                  <LoadingState label="Loading account activity logs..." />
                ) : logsQuery.data && logsQuery.data.data.length === 0 ? (
                  <p style={{ color: "var(--mr-text-muted)" }}>
                    No activity logs recorded for this user yet.
                  </p>
                ) : (
                  <>
                    <ul
                      className="divide-y rounded border"
                      style={{
                        backgroundColor: "var(--mr-bg-elevated)",
                        borderColor: "var(--mr-border-subtle)",
                      }}
                    >
                      {logsQuery.data?.data.map((log) => {
                        const formatted = formatActivityLogSummary(log);
                        return (
                          <li
                            key={`modal-${log.logId}`}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                          >
                            <div>
                              <p className="font-semibold" style={{ color: "var(--mr-accent)" }}>
                                {formatted.title}
                              </p>
                              <p style={{ color: "var(--mr-text-secondary)" }}>
                                {formatted.summary}
                              </p>
                            </div>
                            <span style={{ color: "var(--mr-text-muted)" }}>
                              {new Date(log.createdAt).toLocaleString()}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {logsQuery.data ? (
                      <CatalogPagination
                        page={logsPage}
                        total={logsQuery.data.meta.total}
                        pageSize={logsQuery.data.meta.pageSize || 30}
                        hasNext={logsQuery.data.meta.hasNext}
                        onPageChange={setLogsPage}
                        label="Selected user activity logs pagination"
                      />
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================================
 * 3. Admin Manga Catalog Management (/admin/manga)
 * ============================================================================ */
export function AdminMangaPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 280);
  const [visibility, setVisibility] = useState("");
  const [page, setPage] = useState(1);
  const [reason, setReason] = useState("Editorial moderation update");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, visibility]);

  const mangaQuery = useQuery({
    queryKey: ["admin", "manga", debouncedQ, visibility, page],
    queryFn: () =>
      apiClient.adminListManga({
        q: debouncedQ.trim() || undefined,
        visibility: visibility || undefined,
        page,
      }),
  });

  async function runAction(fn: () => Promise<unknown>, okText: string) {
    setNotice(null);
    try {
      await fn();
      setNotice(okText);
      void queryClient.invalidateQueries({ queryKey: ["admin", "manga"] });
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "Operation failed.");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Admin — Manga Catalog Management</h1>
        <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
          {frontendConfig.externalEtlEnabled
            ? "Toggle visibility (`PUBLIC`/`HIDDEN`), manage CDC subscriptions, or permanently delete with tombstone protection."
            : "Toggle visibility (`PUBLIC`/`HIDDEN`) or permanently delete titles with tombstone protection. (External CDC sync is currently on hold.)"}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search manga title or slug..."
          className="min-w-52 rounded border px-3 py-1.5"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
            color: "var(--mr-text-primary)",
          }}
        />
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          className="rounded border px-2.5 py-1.5"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
            color: "var(--mr-text-primary)",
          }}
        >
          <option value="">All Visibility</option>
          <option value="PUBLIC">PUBLIC</option>
          <option value="HIDDEN">HIDDEN</option>
        </select>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Moderation reason..."
          className="min-w-56 flex-1 rounded border px-3 py-1.5"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
            color: "var(--mr-text-primary)",
          }}
        />
      </div>

      {notice ? (
        <p className="text-xs font-medium" style={{ color: "var(--mr-accent)" }}>
          {notice}
        </p>
      ) : null}

      {mangaQuery.isLoading ? (
        <LoadingState variant="table" count={8} label="Loading admin manga list..." />
      ) : mangaQuery.data && mangaQuery.data.data.length === 0 ? (
        <EmptyState title="No manga matched your filter" />
      ) : (
        <>
          <div
            className="overflow-x-auto rounded-[var(--mr-radius-md)] border"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <table className="w-full text-left text-xs">
              <thead
                className="border-b uppercase"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-muted)",
                }}
              >
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Visibility</th>
                  {frontendConfig.externalEtlEnabled ? <th className="px-3 py-2">CDC</th> : null}
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--mr-border-subtle)" }}>
                {mangaQuery.data?.data.map((m) => (
                  <tr key={m.mangaId}>
                    <td className="px-3 py-2">
                      <Link
                        to={`/manga/${m.slug}`}
                        className="font-semibold hover:underline"
                        style={{ color: "var(--mr-text-primary)" }}
                      >
                        {m.title}
                      </Link>
                      <p className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                        {m.publicationStatus} ·{" "}
                        {m.contentRating === "unknown" ? "Unclassified" : m.contentRating} ·{" "}
                        {m.totalViews.toLocaleString()} views · ★ {m.averageRating.toFixed(1)}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="rounded px-2 py-0.5 text-[10px] font-semibold"
                        style={{
                          backgroundColor:
                            m.visibilityStatus === "PUBLIC"
                              ? "rgba(52, 211, 153, 0.15)"
                              : "rgba(251, 191, 36, 0.15)",
                          color:
                            m.visibilityStatus === "PUBLIC"
                              ? "var(--mr-success)"
                              : "var(--mr-warning)",
                        }}
                      >
                        {m.visibilityStatus === "PUBLIC" ? "Public" : "Hidden"}
                      </span>
                    </td>
                    {frontendConfig.externalEtlEnabled ? (
                      <td className="px-3 py-2 font-mono">{m.isCdcEnabled ? "ENABLED" : "OFF"}</td>
                    ) : null}
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {m.visibilityStatus === "PUBLIC" ? (
                          <button
                            type="button"
                            onClick={() =>
                              void runAction(
                                () =>
                                  apiClient.adminHideManga(m.mangaId, reason.trim() || "Hidden"),
                                `Hidden "${m.title}".`,
                              )
                            }
                            className="cursor-pointer rounded border px-2 py-1"
                            style={{ borderColor: "var(--mr-warning)", color: "var(--mr-warning)" }}
                          >
                            Hide
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              void runAction(
                                () => apiClient.adminShowManga(m.mangaId, reason.trim() || "Shown"),
                                `Restored "${m.title}" to Public.`,
                              )
                            }
                            className="cursor-pointer rounded border px-2 py-1"
                            style={{ borderColor: "var(--mr-success)", color: "var(--mr-success)" }}
                          >
                            Show
                          </button>
                        )}
                        {frontendConfig.externalEtlEnabled ? (
                          <button
                            type="button"
                            onClick={() =>
                              void runAction(
                                () => apiClient.adminToggleCdc(m.mangaId, !m.isCdcEnabled),
                                `CDC ${!m.isCdcEnabled ? "enabled" : "disabled"} for "${m.title}".`,
                              )
                            }
                            className="cursor-pointer rounded border px-2 py-1"
                            style={{ borderColor: "var(--mr-accent)", color: "var(--mr-accent)" }}
                          >
                            {m.isCdcEnabled ? "Disable CDC" : "Enable CDC"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(
                              () =>
                                apiClient.adminDeleteManga(
                                  m.mangaId,
                                  reason.trim() || "Deleted by Admin",
                                ),
                              `Deleted "${m.title}" and recorded tombstone.`,
                            )
                          }
                          className="cursor-pointer rounded border px-2 py-1"
                          style={{ borderColor: "var(--mr-danger)", color: "var(--mr-danger)" }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mangaQuery.data ? (
            <CatalogPagination
              page={page}
              total={mangaQuery.data.meta.total}
              pageSize={mangaQuery.data.meta.pageSize || 24}
              hasNext={mangaQuery.data.meta.hasNext}
              onPageChange={setPage}
              label="Admin manga pagination"
            />
          ) : null}
        </>
      )}
    </div>
  );
}

/* ============================================================================
 * 4. Admin Moderation Reports Queue (/admin/reports)
 * ============================================================================ */
export function AdminReportsPage() {
  const queryClient = useQueryClient();
  const [reportType, setReportType] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [selected, setSelected] = useState<AdminReportItem | null>(null);
  const [actionType, setActionType] = useState("");
  const [note, setNote] = useState("");
  const [ignoreFuture, setIgnoreFuture] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setPage(1);
  }, [reportType, status]);

  const reportsQuery = useQuery({
    queryKey: ["admin", "reports", reportType, status, page],
    queryFn: () =>
      apiClient.adminListReports({
        reportType: reportType || undefined,
        status: status || undefined,
        page,
      }),
  });

  const visibleReports = useMemo(() => {
    const items = reportsQuery.data?.data ?? [];
    const norm = searchText.trim().toLowerCase();
    if (!norm) return items;
    return items.filter(
      (rep) =>
        rep.reasonCategory.toLowerCase().includes(norm) ||
        getReasonMeta(rep.reasonCategory).title.toLowerCase().includes(norm) ||
        (rep.description ?? "").toLowerCase().includes(norm) ||
        rep.reporter.username.toLowerCase().includes(norm) ||
        String(rep.target?.snapshot ?? "")
          .toLowerCase()
          .includes(norm),
    );
  }, [reportsQuery.data, searchText]);

  const queueCounts = useMemo(() => {
    const all = visibleReports;
    return {
      total: reportsQuery.data?.meta.total ?? all.length,
      pending: all.filter((r) => r.status === "PENDING").length,
      comments: all.filter((r) => r.reportType === "COMMENT").length,
      mangaAndAccount: all.filter((r) => r.reportType !== "COMMENT").length,
    };
  }, [visibleReports, reportsQuery.data?.meta.total]);

  async function openReport(reportId: string) {
    setFeedback(null);
    try {
      const res = await apiClient.adminGetReportDetail(reportId);
      setSelected(res.data);
      setActionType(res.data.allowedActions?.[0] ?? "IGNORE");
      setNote("");
      setIgnoreFuture(false);
    } catch (err) {
      setFeedback({
        tone: "err",
        text: err instanceof ApiClientError ? err.message : "Could not load report detail.",
      });
    }
  }

  // Automatically pre-select first visible report so right-hand workbench is immediately useful
  useEffect(() => {
    const firstVisible = visibleReports[0];
    if (!firstVisible) {
      setSelected(null);
      return;
    }
    const stillVisible =
      selected && visibleReports.some((item) => item.reportId === selected.reportId);
    if (!stillVisible) {
      void openReport(firstVisible.reportId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleReports]);

  async function handleResolve(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setFeedback(null);
    try {
      const res = await apiClient.adminResolveReport(selected.reportId, {
        actionType,
        note: note.trim(),
        ignoreFutureReports: ignoreFuture,
      });
      setSelected(res.data);
      setFeedback({ tone: "ok", text: `Report updated: ${humanizeActionCode(actionType)}.` });
      void queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
    } catch (err) {
      setFeedback({
        tone: "err",
        text: err instanceof ApiClientError ? err.message : "Resolve failed.",
      });
    }
  }

  const QUICK_NOTES = [
    "Confirmed unmarked plot spoiler — locked behind warning.",
    "Confirmed policy violation — content removed and logged.",
    "Reviewed reported target — no rule violation found.",
    "Metadata/chapter issue verified and addressed.",
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Admin — Moderation Reports Queue</h1>
          <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
            Review reader reports for Comments, Manga titles, and Accounts with plain-language
            context, quick triage templates, and full audit history.
          </p>
        </div>
      </div>

      {/* Queue Triage KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Matching Reports", val: queueCounts.total, color: "var(--mr-accent)" },
          { label: "Pending on Page", val: queueCounts.pending, color: "var(--mr-warning)" },
          { label: "Comment Flags", val: queueCounts.comments, color: "var(--mr-text-primary)" },
          {
            label: "Manga & Account Flags",
            val: queueCounts.mangaAndAccount,
            color: "var(--mr-text-primary)",
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-[var(--mr-radius-md)] border px-4 py-3"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <p className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
              {kpi.label}
            </p>
            <p className="mt-0.5 text-xl font-bold" style={{ color: kpi.color }}>
              {kpi.val}
            </p>
          </div>
        ))}
      </div>

      {/* Filter Bar + Quick Status & Category Pills */}
      <div
        className="space-y-3 rounded-[var(--mr-radius-md)] border p-3.5 text-xs"
        style={{
          backgroundColor: "var(--mr-bg-surface)",
          borderColor: "var(--mr-border-subtle)",
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Filter reports queue"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search reason, reporter, or target snapshot..."
            className="min-w-56 flex-1 rounded border px-3 py-1.5"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          />
          <select
            aria-label="Filter report category"
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            className="rounded border px-2.5 py-1.5"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <option value="">All Report Types</option>
            <option value="COMMENT">Comment Reports</option>
            <option value="MANGA">Manga Reports</option>
            <option value="ACCOUNT">Account Reports</option>
          </select>
          <select
            aria-label="Filter report status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border px-2.5 py-1.5"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <option value="PENDING">Pending Review</option>
            <option value="RESOLVED">Resolved</option>
            <option value="IGNORED">Dismissed</option>
            <option value="CLOSED">Auto-Closed</option>
            <option value="">All Statuses</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span style={{ color: "var(--mr-text-muted)" }}>Queue Status:</span>
            {(
              [
                { value: "PENDING", label: "Pending Review" },
                { value: "RESOLVED", label: "Resolved" },
                { value: "IGNORED", label: "Dismissed" },
                { value: "CLOSED", label: "Auto-Closed" },
                { value: "", label: "All" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setStatus(opt.value)}
                className="cursor-pointer rounded-full border px-2.5 py-0.5 font-medium"
                style={{
                  backgroundColor: status === opt.value ? "var(--mr-accent)" : "transparent",
                  borderColor:
                    status === opt.value ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                  color: status === opt.value ? "#ffffff" : "var(--mr-text-secondary)",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span style={{ color: "var(--mr-text-muted)" }}>Type:</span>
            {(
              [
                { value: "", label: "All" },
                { value: "COMMENT", label: "Comments" },
                { value: "MANGA", label: "Manga" },
                { value: "ACCOUNT", label: "Accounts" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setReportType(opt.value)}
                className="cursor-pointer rounded-full border px-2.5 py-0.5 font-medium"
                style={{
                  backgroundColor:
                    reportType === opt.value ? "var(--mr-bg-elevated)" : "transparent",
                  borderColor:
                    reportType === opt.value ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                  color: reportType === opt.value ? "var(--mr-accent)" : "var(--mr-text-secondary)",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {feedback ? (
        <div
          role="status"
          className="rounded-[var(--mr-radius-sm)] border px-3 py-2 text-xs font-medium"
          style={{
            borderColor: feedback.tone === "ok" ? "var(--mr-success)" : "var(--mr-danger)",
            color: feedback.tone === "ok" ? "var(--mr-success)" : "var(--mr-danger)",
            backgroundColor: "var(--mr-bg-surface)",
          }}
        >
          {feedback.text}
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(360px,5fr)_minmax(440px,7fr)]">
        {/* Left Queue Pane */}
        <div className="space-y-3">
          {reportsQuery.isLoading ? (
            <LoadingState variant="table" count={6} label="Loading reports queue..." />
          ) : reportsQuery.data && reportsQuery.data.data.length === 0 ? (
            <EmptyState title="No reports in this queue" />
          ) : visibleReports.length === 0 ? (
            <EmptyState title={`No reports matched "${searchText}"`} />
          ) : (
            <>
              <ul className="space-y-2.5 text-xs">
                {visibleReports.map((rep) => {
                  const statusCfg = REPORT_STATUS_LABELS[rep.status] ?? {
                    label: rep.status,
                    color: "var(--mr-text-muted)",
                  };
                  const reasonMeta = getReasonMeta(rep.reasonCategory);
                  const preview =
                    typeof rep.target?.snapshot === "string"
                      ? rep.target.snapshot
                      : typeof rep.target?.mangaTitle === "string"
                        ? rep.target.mangaTitle
                        : null;
                  const isActive = selected?.reportId === rep.reportId;
                  return (
                    <li
                      key={rep.reportId}
                      className="rounded-[var(--mr-radius-md)] border p-3.5 transition"
                      style={{
                        backgroundColor: isActive
                          ? "var(--mr-bg-elevated)"
                          : "var(--mr-bg-surface)",
                        borderColor: isActive ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                              style={{
                                backgroundColor: "var(--mr-bg-canvas)",
                                color: "var(--mr-accent)",
                              }}
                            >
                              {rep.reportType}
                            </span>
                            <span
                              className="font-semibold"
                              style={{ color: "var(--mr-text-primary)" }}
                            >
                              {reasonMeta.title}
                            </span>
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                              style={{
                                backgroundColor: "var(--mr-bg-canvas)",
                                color: statusCfg.color,
                              }}
                            >
                              {statusCfg.label}
                            </span>
                          </div>
                          {preview ? (
                            <p
                              className="line-clamp-2 text-[11px] leading-snug"
                              style={{ color: "var(--mr-text-secondary)" }}
                            >
                              &ldquo;{preview}&rdquo;
                            </p>
                          ) : null}
                          <p className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                            Reported by @{rep.reporter.username} ·{" "}
                            {new Date(rep.createdAt).toLocaleString()}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => void openReport(rep.reportId)}
                          className="shrink-0 cursor-pointer rounded border px-3 py-1.5 font-semibold"
                          style={{
                            backgroundColor: isActive ? "var(--mr-accent)" : "transparent",
                            borderColor: "var(--mr-accent)",
                            color: isActive ? "#ffffff" : "var(--mr-accent)",
                          }}
                        >
                          {isActive ? "Inspecting" : "Inspect"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {reportsQuery.data ? (
                <CatalogPagination
                  page={page}
                  total={reportsQuery.data.meta.total}
                  pageSize={reportsQuery.data.meta.pageSize || 20}
                  hasNext={reportsQuery.data.meta.hasNext}
                  onPageChange={setPage}
                  label="Admin reports pagination"
                />
              ) : null}
            </>
          )}
        </div>

        {/* Right Sticky Workbench */}
        {selected ? (
          <section
            aria-label="Moderation report inspector"
            className="space-y-4 rounded-[var(--mr-radius-lg)] border p-5 text-xs lg:sticky lg:top-20"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
            }}
          >
            <div
              className="flex flex-wrap items-start justify-between gap-2 border-b pb-3"
              style={{ borderColor: "var(--mr-border-subtle)" }}
            >
              <div>
                <p
                  className="text-[10px] font-bold tracking-wider uppercase"
                  style={{ color: "var(--mr-accent)" }}
                >
                  Case Inspector · {selected.reportType}
                </p>
                <h2 className="mt-0.5 text-base font-bold">
                  {getReasonMeta(selected.reasonCategory).title}
                </h2>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                  {getReasonMeta(selected.reasonCategory).summary}
                </p>
              </div>
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  color: (
                    REPORT_STATUS_LABELS[selected.status] ?? { color: "var(--mr-text-muted)" }
                  ).color,
                }}
              >
                {(REPORT_STATUS_LABELS[selected.status] ?? { label: selected.status }).label}
              </span>
            </div>

            <div
              className="grid gap-2.5 sm:grid-cols-2"
              style={{ color: "var(--mr-text-secondary)" }}
            >
              <div
                className="rounded border p-2.5"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                }}
              >
                <p className="text-[10px] uppercase" style={{ color: "var(--mr-text-muted)" }}>
                  Reported By
                </p>
                <p className="mt-0.5 font-semibold">
                  <Link
                    to={`/profile/${selected.reporter.username}`}
                    className="hover:underline"
                    style={{ color: "var(--mr-accent)" }}
                  >
                    @{selected.reporter.username}
                  </Link>
                </p>
                <p className="mt-0.5 text-[10px]" style={{ color: "var(--mr-text-muted)" }}>
                  {new Date(selected.createdAt).toLocaleString()}
                </p>
              </div>

              <div
                className="rounded border p-2.5"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                }}
              >
                <p className="text-[10px] uppercase" style={{ color: "var(--mr-text-muted)" }}>
                  Target State
                </p>
                <p
                  className="mt-0.5 font-semibold"
                  style={{
                    color: selected.targetExists ? "var(--mr-success)" : "var(--mr-danger)",
                  }}
                >
                  {selected.targetExists ? "Active on platform" : "Target removed (Auto-Closed)"}
                </p>
                <p
                  className="mt-0.5 font-mono text-[10px]"
                  style={{ color: "var(--mr-text-muted)" }}
                >
                  Code: {selected.reasonCategory}
                </p>
              </div>
            </div>

            {selected.description ? (
              <div
                className="rounded border px-3 py-2"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                }}
              >
                <p
                  className="text-[10px] font-semibold uppercase"
                  style={{ color: "var(--mr-text-muted)" }}
                >
                  Reporter Explanation
                </p>
                <p className="mt-1 text-xs" style={{ color: "var(--mr-text-primary)" }}>
                  {selected.description}
                </p>
              </div>
            ) : null}

            <ReportTargetCard report={selected} />

            {selected.status === "PENDING" && selected.allowedActions ? (
              <form
                onSubmit={handleResolve}
                className="space-y-3 border-t pt-4"
                style={{ borderColor: "var(--mr-border-subtle)" }}
              >
                <div>
                  <label
                    htmlFor="moderation-decision-select"
                    className="mb-1.5 block font-semibold"
                  >
                    Moderation Decision
                  </label>
                  <div className="mb-2 grid gap-1.5 sm:grid-cols-2">
                    {selected.allowedActions.map((act) => {
                      const active = actionType === act;
                      return (
                        <button
                          key={act}
                          type="button"
                          onClick={() => setActionType(act)}
                          className="cursor-pointer rounded border px-2.5 py-2 text-left text-[11px] font-medium transition"
                          style={{
                            backgroundColor: active
                              ? "var(--mr-bg-elevated)"
                              : "var(--mr-bg-canvas)",
                            borderColor: active ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                            color: active ? "var(--mr-accent)" : "var(--mr-text-secondary)",
                          }}
                        >
                          {humanizeActionCode(act)}
                        </button>
                      );
                    })}
                  </div>
                  <select
                    id="moderation-decision-select"
                    aria-label="Moderation Decision"
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value)}
                    className="w-full rounded border px-2.5 py-1.5"
                    style={{
                      backgroundColor: "var(--mr-bg-elevated)",
                      borderColor: "var(--mr-border-subtle)",
                      color: "var(--mr-text-primary)",
                    }}
                  >
                    {selected.allowedActions.map((act) => (
                      <option key={act} value={act}>
                        {humanizeActionCode(act)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block font-semibold">Resolution Note (required)</label>
                  <div className="flex flex-wrap gap-1">
                    {QUICK_NOTES.map((tpl) => (
                      <button
                        key={tpl}
                        type="button"
                        onClick={() => setNote(tpl)}
                        className="cursor-pointer rounded border px-2 py-0.5 text-[10px] hover:opacity-85"
                        style={{
                          backgroundColor: "var(--mr-bg-elevated)",
                          borderColor: "var(--mr-border-subtle)",
                          color: "var(--mr-text-secondary)",
                        }}
                      >
                        + {tpl.slice(0, 34)}…
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={2}
                    required
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Explain the decision for the immutable audit log..."
                    className="w-full rounded border px-2.5 py-1.5"
                    style={{
                      backgroundColor: "var(--mr-bg-elevated)",
                      borderColor: "var(--mr-border-subtle)",
                      color: "var(--mr-text-primary)",
                    }}
                  />
                </div>

                {selected.reportType === "MANGA" && actionType === "IGNORE" ? (
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={ignoreFuture}
                      onChange={(e) => setIgnoreFuture(e.target.checked)}
                    />
                    <span>Ignore all future reports on this manga</span>
                  </label>
                ) : null}

                <button
                  type="submit"
                  className="w-full cursor-pointer rounded px-4 py-2 font-semibold text-white"
                  style={{ backgroundColor: "var(--mr-accent)" }}
                >
                  Apply Resolution
                </button>
              </form>
            ) : null}

            {selected.actionHistory && selected.actionHistory.length > 0 ? (
              <div
                className="space-y-2 border-t pt-3"
                style={{ borderColor: "var(--mr-border-subtle)" }}
              >
                <p className="font-semibold">Moderation Audit Timeline</p>
                <ul
                  className="space-y-2 border-l-2 pl-3"
                  style={{ borderColor: "var(--mr-accent)" }}
                >
                  {selected.actionHistory.map((h) => (
                    <li
                      key={h.actionHistoryId}
                      className="rounded border px-3 py-2"
                      style={{
                        backgroundColor: "var(--mr-bg-elevated)",
                        borderColor: "var(--mr-border-subtle)",
                      }}
                    >
                      <p className="font-semibold" style={{ color: "var(--mr-text-primary)" }}>
                        {h.actorType === "SYSTEM" ? "Automated System" : "Moderator"} ·{" "}
                        {humanizeActionCode(h.actionType)}
                      </p>
                      <p style={{ color: "var(--mr-text-secondary)" }}>
                        {h.previousStatus} → {h.newStatus}
                        {h.actionNote ? ` · Note: ${h.actionNote}` : ""}
                      </p>
                      <p className="mt-0.5 text-[10px]" style={{ color: "var(--mr-text-muted)" }}>
                        {new Date(h.performedAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : (
          <section
            className="hidden items-center justify-center rounded-[var(--mr-radius-lg)] border p-10 text-center text-xs lg:flex"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
              color: "var(--mr-text-muted)",
            }}
          >
            Select any report on the left to inspect its context, target preview, and resolution
            options.
          </section>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * 5. Admin Source ETL & CDC Console (/admin/etl)
 * ============================================================================ */
export function AdminEtlPage() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [cdcFlags, setCdcFlags] = useState<Record<string, boolean>>({});
  const [customJson, setCustomJson] = useState("");
  const [customCdc, setCustomCdc] = useState(true);
  const [selectedJob, setSelectedJob] = useState<EtlJobDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sourcesQuery = useQuery({
    queryKey: ["admin", "external-sources"],
    queryFn: () => apiClient.adminListExternalSources(),
    enabled: frontendConfig.externalEtlEnabled,
  });

  const jobsQuery = useQuery({
    queryKey: ["admin", "etl-jobs"],
    queryFn: () => apiClient.adminListEtlJobs(1),
    enabled: frontendConfig.externalEtlEnabled,
  });

  if (!frontendConfig.externalEtlEnabled) {
    return (
      <section
        className="space-y-3 rounded-[var(--mr-radius-lg)] border p-6"
        style={{
          backgroundColor: "var(--mr-bg-surface)",
          borderColor: "var(--mr-border-strong)",
        }}
      >
        <p
          className="text-xs font-semibold tracking-wider uppercase"
          style={{ color: "var(--mr-warning)" }}
        >
          On Hold · Local Reading Mode
        </p>
        <h1 className="text-xl font-bold">External ETL &amp; CDC Integration Paused</h1>
        <p className="text-sm" style={{ color: "var(--mr-text-secondary)" }}>
          Third-party external ETL ingestion and CDC webhook sync are temporarily on hold in this
          local build. The catalog is currently populated from your local <code>MangaLibrary</code>{" "}
          database and MinIO cover storage, with live MangaDex At-Home + illustrated demo page
          fallback for seamless reading.
        </p>
        <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
          To re-enable this console later, set <code>VITE_EXTERNAL_ETL_ENABLED=true</code> and{" "}
          <code>EXTERNAL_ETL_ENABLED=true</code> in <code>.env</code>.
        </p>
      </section>
    );
  }

  async function handleRunSelected() {
    const items = Object.entries(selectedIds)
      .filter(([, checked]) => checked)
      .map(([sourceMangaId]) => ({
        sourceMangaId,
        enableCdc: Boolean(cdcFlags[sourceMangaId]),
      }));
    if (items.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiClient.adminStartEtlSync(items);
      setSelectedJob(res.data);
      setNotice(
        `ETL batch job ${res.data.jobId.slice(0, 8)} finished with status ${res.data.status}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin", "etl-jobs"] });
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "ETL sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportJson(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const parsed = JSON.parse(customJson) as Record<string, unknown>;
      const res = await apiClient.adminStartEtlSync([
        { enableCdc: customCdc, packagePayload: parsed },
      ]);
      setSelectedJob(res.data);
      setNotice(`Package v2.0 JSON import completed with status ${res.data.status}.`);
      void queryClient.invalidateQueries({ queryKey: ["admin", "etl-jobs"] });
    } catch (err) {
      setNotice(
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? `Invalid JSON: ${err.message}`
            : "Import failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function inspectJob(jobId: string) {
    const res = await apiClient.adminGetEtlJob(jobId);
    setSelectedJob(res.data);
  }

  async function retryItem(jobItemId: string) {
    setBusy(true);
    try {
      const res = await apiClient.adminRetryEtlItem(jobItemId);
      setSelectedJob(res.data);
      void queryClient.invalidateQueries({ queryKey: ["admin", "etl-jobs"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin — Source ETL &amp; CDC Console</h1>
        <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
          Select external Manga Package v2.0 packages or upload custom JSON, configure per-manga CDC
          subscriptions, and monitor per-item isolated retries.
        </p>
      </div>

      {notice ? (
        <p className="text-xs font-medium" style={{ color: "var(--mr-accent)" }}>
          {notice}
        </p>
      ) : null}

      {/* External Sample Sources */}
      <section
        className="space-y-3 rounded-[var(--mr-radius-md)] border p-4"
        style={{ backgroundColor: "var(--mr-bg-surface)", borderColor: "var(--mr-border-subtle)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Upstream Package v2.0 Catalog</h2>
          <button
            type="button"
            disabled={busy || !Object.values(selectedIds).some(Boolean)}
            onClick={() => void handleRunSelected()}
            className="cursor-pointer rounded px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--mr-accent)" }}
          >
            {busy ? "Running ETL..." : "Run Batch ETL Sync"}
          </button>
        </div>

        <div className="space-y-1.5 text-xs">
          {sourcesQuery.data?.data.map((src) => (
            <div
              key={src.sourceMangaId}
              className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(selectedIds[src.sourceMangaId])}
                  onChange={(e) =>
                    setSelectedIds((prev) => ({ ...prev, [src.sourceMangaId]: e.target.checked }))
                  }
                />
                <span className="font-semibold">{src.title}</span>
                <span style={{ color: "var(--mr-text-muted)" }}>
                  ({src.chapterCount} ch · {src.contentRating})
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={Boolean(cdcFlags[src.sourceMangaId])}
                  onChange={(e) =>
                    setCdcFlags((prev) => ({ ...prev, [src.sourceMangaId]: e.target.checked }))
                  }
                />
                <span>Enable CDC</span>
              </label>
            </div>
          ))}
        </div>
      </section>

      {/* Direct Package v2.0 JSON Import */}
      <form
        onSubmit={handleImportJson}
        className="space-y-3 rounded-[var(--mr-radius-md)] border p-4"
        style={{ backgroundColor: "var(--mr-bg-surface)", borderColor: "var(--mr-border-subtle)" }}
      >
        <h2 className="text-sm font-semibold">Direct Package v2.0 JSON Ingestion</h2>
        <textarea
          rows={4}
          value={customJson}
          onChange={(e) => setCustomJson(e.target.value)}
          placeholder="Paste a manga-reader-package v2.0 JSON document here..."
          className="w-full rounded border p-2 font-mono text-xs"
          style={{
            backgroundColor: "var(--mr-bg-elevated)",
            borderColor: "var(--mr-border-subtle)",
            color: "var(--mr-text-primary)",
          }}
        />
        <div className="flex items-center justify-between text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={customCdc}
              onChange={(e) => setCustomCdc(e.target.checked)}
            />
            <span>Subscribe to CDC webhooks</span>
          </label>
          <button
            type="submit"
            disabled={busy || !customJson.trim()}
            className="cursor-pointer rounded px-3.5 py-1.5 font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--mr-accent)" }}
          >
            Validate &amp; Ingest JSON
          </button>
        </div>
      </form>

      {/* Jobs History & Selected Job Detail */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Recent ETL Jobs</h2>
          <ul
            className="divide-y rounded-[var(--mr-radius-md)] border text-xs"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            {jobsQuery.data?.data.map((job) => (
              <li key={job.jobId} className="flex items-center justify-between gap-2 px-3 py-2">
                <div>
                  <p className="font-mono font-semibold">
                    {job.jobId.slice(0, 8)} · {job.status}
                  </p>
                  <p style={{ color: "var(--mr-text-muted)" }}>
                    {job.jobType} ({job.batchSize} items)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void inspectJob(job.jobId)}
                  className="cursor-pointer rounded border px-2 py-1"
                  style={{ borderColor: "var(--mr-border-strong)" }}
                >
                  Details
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selectedJob ? (
          <div
            className="space-y-2 rounded-[var(--mr-radius-md)] border p-4 text-xs"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
            }}
          >
            <h3 className="font-bold">
              Job {selectedJob.jobId.slice(0, 8)} — {selectedJob.status}
            </h3>
            {selectedJob.items?.map((it) => (
              <div
                key={it.jobItemId}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
                style={{ borderColor: "var(--mr-border-subtle)" }}
              >
                <div>
                  <p className="font-mono font-semibold">
                    {it.sourceMangaId} → {it.status}
                  </p>
                  {it.errorMessage ? (
                    <p style={{ color: "var(--mr-danger)" }}>{it.errorMessage}</p>
                  ) : null}
                </div>
                {it.status === "FAILED" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void retryItem(it.jobItemId)}
                    className="cursor-pointer rounded border px-2 py-1"
                    style={{ borderColor: "var(--mr-warning)", color: "var(--mr-warning)" }}
                  >
                    Retry Item
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
