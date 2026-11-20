import { useState, type FormEvent } from "react";
import { ApiClientError, apiClient } from "../services/apiClient";

export type ReportTarget =
  | { kind: "ACCOUNT"; accountId: string; label: string }
  | { kind: "MANGA"; mangaId: string; chapterId?: string | null; label: string }
  | { kind: "COMMENT"; commentId: string; label: string };

const REASON_OPTIONS: Record<ReportTarget["kind"], Array<{ value: string; label: string }>> = {
  ACCOUNT: [
    { value: "SPAM", label: "Spam or abusive behavior" },
    { value: "HARASSMENT", label: "Harassment or hate speech" },
    { value: "IMPERSONATION", label: "Impersonation" },
    { value: "OTHER", label: "Other policy violation" },
  ],
  MANGA: [
    { value: "BROKEN_IMAGES", label: "Broken or missing pages" },
    { value: "WRONG_METADATA", label: "Wrong metadata or chapter order" },
    { value: "COPYRIGHT", label: "Copyright / DMCA issue" },
    { value: "NSFW_MISTAGGED", label: "Incorrect content rating" },
    { value: "OTHER", label: "Other issue" },
  ],
  COMMENT: [
    { value: "UNMARKED_SPOILER", label: "Unmarked spoiler" },
    { value: "HARASSMENT", label: "Harassment or offensive language" },
    { value: "SPAM", label: "Spam or self-promotion" },
    { value: "OTHER", label: "Other violation" },
  ],
};

export function ReportModal({
  target,
  onClose,
  onSubmitted,
}: {
  target: ReportTarget;
  onClose: () => void;
  onSubmitted?: (reportId: string) => void;
}) {
  const options = REASON_OPTIONS[target.kind];
  const [reasonCategory, setReasonCategory] = useState(options[0]?.value ?? "OTHER");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      let res: { data: { reportId: string } };
      if (target.kind === "ACCOUNT") {
        res = await apiClient.reportAccount({
          targetAccountId: target.accountId,
          reasonCategory,
          description: description.trim() || undefined,
        });
      } else if (target.kind === "MANGA") {
        res = await apiClient.reportManga({
          targetMangaId: target.mangaId,
          targetChapterId: target.chapterId ?? undefined,
          reasonCategory,
          description: description.trim() || undefined,
        });
      } else {
        res = await apiClient.reportComment({
          targetCommentId: target.commentId,
          reasonCategory,
          description: description.trim() || undefined,
        });
      }
      setDoneId(res.data.reportId);
      onSubmitted?.(res.data.reportId);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to submit report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Report ${target.kind.toLowerCase()}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        className="w-full max-w-md rounded-[var(--mr-radius-lg)] border p-5 shadow-2xl"
        style={{
          backgroundColor: "var(--mr-bg-surface)",
          borderColor: "var(--mr-border-strong)",
          color: "var(--mr-text-primary)",
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Report {target.kind.toLowerCase()}</h3>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded px-2 py-0.5 text-sm"
            style={{ color: "var(--mr-text-muted)" }}
          >
            ✕
          </button>
        </div>

        <p className="mb-4 text-xs" style={{ color: "var(--mr-text-secondary)" }}>
          Target: <strong style={{ color: "var(--mr-text-primary)" }}>{target.label}</strong>
        </p>

        {doneId ? (
          <div className="space-y-4">
            <p
              className="rounded-[var(--mr-radius-sm)] border p-3 text-sm"
              style={{
                borderColor: "var(--mr-success)",
                color: "var(--mr-success)",
              }}
            >
              Report submitted successfully (ID: <code>{doneId.slice(0, 8)}</code>). Our moderation
              team will review it shortly.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-1.5 text-sm font-medium text-white"
                style={{ backgroundColor: "var(--mr-accent)" }}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Reason category</label>
              <select
                value={reasonCategory}
                onChange={(e) => setReasonCategory(e.target.value)}
                className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              >
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">Details (optional)</label>
              <textarea
                rows={3}
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Provide context or specific page/comment details..."
                className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              />
            </div>

            {error ? (
              <p className="text-xs font-medium" style={{ color: "var(--mr-danger)" }}>
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm"
                style={{
                  borderColor: "var(--mr-border-strong)",
                  color: "var(--mr-text-secondary)",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: "var(--mr-danger)" }}
              >
                {submitting ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
