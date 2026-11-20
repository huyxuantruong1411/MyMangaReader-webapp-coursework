import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import {
  ApiClientError,
  apiClient,
  type AdminReportItem,
  type EtlJobDetail,
  type ReaderStatsPayload,
} from "../../services/apiClient";
import { frontendConfig } from "../../services/config";

/* ============================================================================
 * 1. Admin Dashboard & Manga Interaction Statistics (/admin)
 * ============================================================================ */
export function AdminDashboardPage() {
  const statsQuery = useQuery({
    queryKey: ["admin", "manga-stats"],
    queryFn: () => apiClient.adminMangaStatistics(),
  });
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <LoadingState label="Loading admin statistics..." />
      ) : statsQuery.isError ? (
        <ErrorState onRetry={() => void statsQuery.refetch()} />
      ) : statsQuery.data ? (
        <>
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
                <p className="mt-1 text-xl font-bold">{card.val}</p>
              </div>
            ))}
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
                {statsQuery.data.data.items.map((row) => (
                  <tr key={row.mangaId}>
                    <td className="px-3 py-2 font-medium">{row.title}</td>
                    <td className="px-3 py-2 font-mono">{row.visibilityStatus}</td>
                    <td className="px-3 py-2 font-mono">{row.validViews}</td>
                    <td className="px-3 py-2 font-mono">{row.listAdditions}</td>
                    <td className="px-3 py-2 font-mono">
                      ★ {row.averageRating.toFixed(2)} ({row.ratingsCount})
                    </td>
                    <td className="px-3 py-2 font-mono">{row.commentsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [readerStats, setReaderStats] = useState<ReaderStatsPayload | null>(null);
  const [reason, setReason] = useState("Policy moderation action");
  const [notice, setNotice] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ["admin", "accounts", q, statusFilter],
    queryFn: () =>
      apiClient.adminListAccounts({ q: q.trim() || undefined, status: statusFilter || undefined }),
  });

  const logsQuery = useQuery({
    queryKey: ["admin", "activity-logs", selectedAccountId],
    queryFn: () => apiClient.adminListActivityLogs({ accountId: selectedAccountId ?? undefined }),
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

  async function inspectReaderStats(accountId: string) {
    setSelectedAccountId(accountId);
    try {
      const res = await apiClient.adminGetReaderStats(accountId);
      setReaderStats(res.data);
    } catch {
      setReaderStats(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin — Accounts &amp; Activity Logs</h1>
        <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
          Search readers, lock/unlock accounts with mandatory reason &amp; immediate session
          revocation, and inspect immutable audit logs.
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
          <option value="ACTIVE">ACTIVE</option>
          <option value="LOCKED">LOCKED</option>
          <option value="PENDING_VERIFICATION">PENDING_VERIFICATION</option>
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
        <LoadingState label="Loading accounts..." />
      ) : (
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
              {accountsQuery.data?.data.map((acc) => (
                <tr key={acc.accountId}>
                  <td className="px-3 py-2">
                    <p className="font-semibold">{acc.displayName}</p>
                    <p style={{ color: "var(--mr-text-muted)" }}>
                      @{acc.username} · {acc.email}
                    </p>
                  </td>
                  <td className="px-3 py-2 font-mono">{acc.role}</td>
                  <td className="px-3 py-2 font-mono">{acc.status}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => void inspectReaderStats(acc.accountId)}
                        className="cursor-pointer rounded border px-2 py-1"
                        style={{ borderColor: "var(--mr-border-strong)" }}
                      >
                        Logs &amp; Stats
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
                              acc.status === "LOCKED" ? "var(--mr-success)" : "var(--mr-danger)",
                            color:
                              acc.status === "LOCKED" ? "var(--mr-success)" : "var(--mr-danger)",
                          }}
                        >
                          {acc.status === "LOCKED" ? "Unlock" : "Lock"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {readerStats ? (
        <section
          className="rounded-[var(--mr-radius-md)] border p-4 text-xs"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Selected Reader Statistics</h2>
            <button
              type="button"
              onClick={() => {
                setSelectedAccountId(null);
                setReaderStats(null);
              }}
              className="cursor-pointer underline"
            >
              Clear filter
            </button>
          </div>
          <p>
            Opens: {readerStats.chapterOpens} · Valid Views: {readerStats.validViews} · Unique
            Chapters: {readerStats.uniqueChaptersRead} · Ratings: {readerStats.ratingsCount}
          </p>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">
          Activity Logs {selectedAccountId ? "(Filtered by Account)" : "(Recent All)"}
        </h2>
        <ul
          className="max-h-72 divide-y overflow-y-auto rounded-[var(--mr-radius-md)] border text-xs"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-subtle)",
          }}
        >
          {logsQuery.data?.data.map((log) => (
            <li key={log.logId} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span className="font-mono font-semibold" style={{ color: "var(--mr-accent)" }}>
                {log.eventType}
              </span>
              <span style={{ color: "var(--mr-text-secondary)" }}>
                {log.targetType ?? "—"} · {JSON.stringify(log.details)}
              </span>
              <span style={{ color: "var(--mr-text-muted)" }}>
                {new Date(log.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ============================================================================
 * 3. Admin Manga Catalog Management (/admin/manga)
 * ============================================================================ */
export function AdminMangaPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [visibility, setVisibility] = useState("");
  const [reason, setReason] = useState("Editorial moderation update");
  const [notice, setNotice] = useState<string | null>(null);

  const mangaQuery = useQuery({
    queryKey: ["admin", "manga", q, visibility],
    queryFn: () =>
      apiClient.adminListManga({ q: q.trim() || undefined, visibility: visibility || undefined }),
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
        <LoadingState label="Loading admin manga list..." />
      ) : (
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
                    <p className="font-semibold">{m.title}</p>
                    <p className="font-mono text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                      {m.slug} · {m.contentRating}
                    </p>
                  </td>
                  <td className="px-3 py-2 font-mono">{m.visibilityStatus}</td>
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
                              () => apiClient.adminHideManga(m.mangaId, reason.trim() || "Hidden"),
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
                              `Restored "${m.title}" to PUBLIC.`,
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
  const [selected, setSelected] = useState<AdminReportItem | null>(null);
  const [actionType, setActionType] = useState("");
  const [note, setNote] = useState("");
  const [ignoreFuture, setIgnoreFuture] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const reportsQuery = useQuery({
    queryKey: ["admin", "reports", reportType, status],
    queryFn: () =>
      apiClient.adminListReports({
        reportType: reportType || undefined,
        status: status || undefined,
      }),
  });

  async function openReport(reportId: string) {
    setFeedback(null);
    try {
      const res = await apiClient.adminGetReportDetail(reportId);
      setSelected(res.data);
      setActionType(res.data.allowedActions?.[0] ?? "IGNORE");
      setNote("");
      setIgnoreFuture(false);
    } catch (err) {
      setFeedback(err instanceof ApiClientError ? err.message : "Could not load report detail.");
    }
  }

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
      setFeedback(`Report resolved with action ${actionType}.`);
      void queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
    } catch (err) {
      setFeedback(err instanceof ApiClientError ? err.message : "Resolve failed.");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Admin — Moderation Reports Queue</h1>
        <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
          Inspect Account, Manga, and Comment reports. Missing targets automatically close via
          SYSTEM audit entry (`ADR-020`).
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <select
          value={reportType}
          onChange={(e) => setReportType(e.target.value)}
          className="rounded border px-2.5 py-1.5"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
            color: "var(--mr-text-primary)",
          }}
        >
          <option value="">All Report Types</option>
          <option value="ACCOUNT">ACCOUNT</option>
          <option value="MANGA">MANGA</option>
          <option value="COMMENT">COMMENT</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded border px-2.5 py-1.5"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
            color: "var(--mr-text-primary)",
          }}
        >
          <option value="PENDING">PENDING</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="IGNORED">IGNORED</option>
          <option value="CLOSED">CLOSED</option>
          <option value="">All Statuses</option>
        </select>
      </div>

      {feedback ? (
        <p className="text-xs font-medium" style={{ color: "var(--mr-accent)" }}>
          {feedback}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          {reportsQuery.isLoading ? (
            <LoadingState label="Loading reports queue..." />
          ) : reportsQuery.data && reportsQuery.data.data.length === 0 ? (
            <EmptyState title="No reports in this queue" />
          ) : (
            <ul
              className="divide-y rounded-[var(--mr-radius-md)] border text-xs"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              {reportsQuery.data?.data.map((rep) => (
                <li
                  key={rep.reportId}
                  className="flex items-center justify-between gap-2 px-3 py-2.5"
                >
                  <div>
                    <p className="font-semibold">
                      [{rep.reportType}] {rep.reasonCategory}
                    </p>
                    <p style={{ color: "var(--mr-text-muted)" }}>
                      By @{rep.reporter.username} · {rep.status}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openReport(rep.reportId)}
                    className="cursor-pointer rounded border px-2.5 py-1 font-medium"
                    style={{ borderColor: "var(--mr-accent)", color: "var(--mr-accent)" }}
                  >
                    Inspect
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected ? (
          <section
            className="space-y-4 rounded-[var(--mr-radius-md)] border p-4 text-xs"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
            }}
          >
            <h2 className="text-sm font-bold">
              Report Detail · {selected.reportType} ({selected.status})
            </h2>
            <p>
              <strong>Reason:</strong> {selected.reasonCategory}
            </p>
            <p>
              <strong>Description:</strong> {selected.description || "—"}
            </p>
            <p>
              <strong>Target Exists:</strong> {selected.targetExists ? "Yes" : "No (Auto-Closed)"}
            </p>
            <pre
              className="overflow-x-auto rounded p-2 text-[11px]"
              style={{ backgroundColor: "var(--mr-bg-elevated)" }}
            >
              {JSON.stringify(selected.target, null, 2)}
            </pre>

            {selected.status === "PENDING" && selected.allowedActions ? (
              <form
                onSubmit={handleResolve}
                className="space-y-3 border-t pt-3"
                style={{ borderColor: "var(--mr-border-subtle)" }}
              >
                <div>
                  <label className="mb-1 block font-semibold">Moderation Action</label>
                  <select
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
                        {act}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold">Resolution Note (required)</label>
                  <textarea
                    rows={2}
                    required
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
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
                  className="cursor-pointer rounded px-4 py-1.5 font-semibold text-white"
                  style={{ backgroundColor: "var(--mr-accent)" }}
                >
                  Apply Resolution
                </button>
              </form>
            ) : null}

            {selected.actionHistory && selected.actionHistory.length > 0 ? (
              <div
                className="space-y-1 border-t pt-3"
                style={{ borderColor: "var(--mr-border-subtle)" }}
              >
                <p className="font-semibold">Action Audit History</p>
                {selected.actionHistory.map((h) => (
                  <p key={h.actionHistoryId} style={{ color: "var(--mr-text-secondary)" }}>
                    [{h.actorType}] {h.actionType} ({h.previousStatus} → {h.newStatus}):{" "}
                    {h.actionNote}
                  </p>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
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
