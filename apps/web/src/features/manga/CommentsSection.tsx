import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CatalogPagination } from "../../components/CatalogPagination";
import { ReportModal, type ReportTarget } from "../../components/ReportModal";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { UserAvatar } from "../../components/UserAvatar";
import { useAuth } from "../../hooks/useAuth";
import {
  ApiClientError,
  apiClient,
  type CommentEditHistoryItem,
  type CommentItem,
} from "../../services/apiClient";

const MAX_COMMENT_LENGTH = 2000;

function CommentCard({
  comment,
  mangaId,
  isReply,
  onMutated,
  onReport,
}: {
  comment: CommentItem;
  mangaId: string;
  isReply?: boolean;
  onMutated: () => void;
  onReport: (target: ReportTarget) => void;
}) {
  const { isAuthenticated } = useAuth();
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [replySpoiler, setReplySpoiler] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [editSpoiler, setEditSpoiler] = useState(comment.isSpoiler);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<CommentEditHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleReact(type: "LIKE" | "DISLIKE") {
    if (!isAuthenticated) return;
    setActionError(null);
    const desired = comment.myReaction === type ? null : type;
    try {
      await apiClient.reactComment(comment.commentId, desired);
      onMutated();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Reaction failed.");
    }
  }

  async function handleReplySubmit(e: FormEvent) {
    e.preventDefault();
    if (!replyContent.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiClient.createComment({
        mangaId,
        chapterId: comment.chapterId,
        parentCommentId: comment.commentId,
        content: replyContent,
        isSpoiler: replySpoiler,
      });
      setReplyContent("");
      setReplySpoiler(false);
      setReplyOpen(false);
      onMutated();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Reply failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await apiClient.editComment(comment.commentId, {
        content: editContent,
        isSpoiler: comment.isSpoilerLockedByAdmin ? true : editSpoiler,
      });
      setEditing(false);
      onMutated();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Edit failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setActionError(null);
    try {
      await apiClient.deleteComment(comment.commentId);
      onMutated();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await apiClient.getCommentHistory(comment.commentId);
      setHistoryItems(res.data);
    } catch {
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  const masked = comment.isSpoiler && !spoilerRevealed && !comment.isDeleted;

  return (
    <article
      className={`rounded-[var(--mr-radius-md)] border p-3.5 ${isReply ? "ml-6 mt-2" : ""}`}
      style={{
        backgroundColor: isReply ? "var(--mr-bg-elevated)" : "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/profile/${comment.author.username}`}
            className="flex items-center gap-2 font-semibold hover:underline"
            style={{ color: "var(--mr-text-primary)" }}
          >
            <UserAvatar
              src={comment.author.avatarUrl}
              name={comment.author.displayName}
              size="sm"
            />
            <span>{comment.author.displayName}</span>
          </Link>
          <span style={{ color: "var(--mr-text-muted)" }}>
            @{comment.author.username} · {new Date(comment.createdAt).toLocaleString()}
          </span>
          {comment.isEdited && !comment.isDeleted ? (
            <button
              type="button"
              onClick={toggleHistory}
              className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] underline"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                color: "var(--mr-accent)",
              }}
            >
              Edited (history)
            </button>
          ) : null}
          {comment.isSpoiler && !comment.isDeleted ? (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
              style={{
                backgroundColor: "rgba(251, 191, 36, 0.15)",
                color: "var(--mr-warning)",
              }}
            >
              Spoiler{comment.isSpoilerLockedByAdmin ? " (Admin Locked)" : ""}
            </span>
          ) : null}
        </div>
      </div>

      {editing ? (
        <form onSubmit={handleEditSubmit} className="mt-2 space-y-2">
          <textarea
            rows={3}
            maxLength={MAX_COMMENT_LENGTH}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-canvas)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={comment.isSpoilerLockedByAdmin ? true : editSpoiler}
                disabled={comment.isSpoilerLockedByAdmin}
                onChange={(e) => setEditSpoiler(e.target.checked)}
              />
              <span>
                Mark as spoiler
                {comment.isSpoilerLockedByAdmin ? " (locked by moderator)" : ""}
              </span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="cursor-pointer rounded border px-2.5 py-1"
                style={{ borderColor: "var(--mr-border-strong)" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="cursor-pointer rounded px-3 py-1 font-medium text-white"
                style={{ backgroundColor: "var(--mr-accent)" }}
              >
                Save Edit
              </button>
            </div>
          </div>
        </form>
      ) : comment.isDeleted ? (
        <p className="mt-2 text-sm italic" style={{ color: "var(--mr-text-muted)" }}>
          {comment.content}
        </p>
      ) : masked ? (
        <div
          className="mt-2 flex items-center justify-between rounded border px-3 py-2 text-xs"
          style={{
            backgroundColor: "var(--mr-bg-elevated)",
            borderColor: "var(--mr-warning)",
          }}
        >
          <span style={{ color: "var(--mr-warning)" }}>This comment is flagged as a spoiler.</span>
          <button
            type="button"
            onClick={() => setSpoilerRevealed(true)}
            className="cursor-pointer rounded border px-2 py-0.5 font-semibold"
            style={{ borderColor: "var(--mr-warning)", color: "var(--mr-warning)" }}
          >
            Reveal Spoiler
          </button>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: "var(--mr-text-primary)" }}>
          {comment.content}
        </p>
      )}

      {!comment.isDeleted ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-3 text-xs"
          style={{ color: "var(--mr-text-secondary)" }}
        >
          <button
            type="button"
            disabled={!isAuthenticated}
            onClick={() => void handleReact("LIKE")}
            className="cursor-pointer rounded border px-2 py-0.5 disabled:opacity-50"
            style={{
              borderColor:
                comment.myReaction === "LIKE" ? "var(--mr-success)" : "var(--mr-border-subtle)",
              color:
                comment.myReaction === "LIKE" ? "var(--mr-success)" : "var(--mr-text-secondary)",
            }}
          >
            👍 {comment.likeCount}
          </button>
          <button
            type="button"
            disabled={!isAuthenticated}
            onClick={() => void handleReact("DISLIKE")}
            className="cursor-pointer rounded border px-2 py-0.5 disabled:opacity-50"
            style={{
              borderColor:
                comment.myReaction === "DISLIKE" ? "var(--mr-danger)" : "var(--mr-border-subtle)",
              color:
                comment.myReaction === "DISLIKE" ? "var(--mr-danger)" : "var(--mr-text-secondary)",
            }}
          >
            👎 {comment.dislikeCount}
          </button>

          {!isReply && isAuthenticated ? (
            <button
              type="button"
              onClick={() => setReplyOpen((prev) => !prev)}
              className="cursor-pointer hover:underline"
            >
              Reply
            </button>
          ) : null}

          {comment.canEdit ? (
            <button
              type="button"
              onClick={() => {
                setEditContent(comment.content);
                setEditSpoiler(comment.isSpoiler);
                setEditing(true);
              }}
              className="cursor-pointer hover:underline"
            >
              Edit
            </button>
          ) : null}

          {comment.canDelete ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDelete()}
              className="cursor-pointer hover:underline"
              style={{ color: "var(--mr-danger)" }}
            >
              Delete
            </button>
          ) : null}

          {isAuthenticated && !comment.canEdit ? (
            <button
              type="button"
              onClick={() =>
                onReport({
                  kind: "COMMENT",
                  commentId: comment.commentId,
                  label: `Comment by @${comment.author.username}`,
                })
              }
              className="ml-auto cursor-pointer hover:underline"
              style={{ color: "var(--mr-text-muted)" }}
            >
              Report
            </button>
          ) : null}
        </div>
      ) : null}

      {actionError ? (
        <p className="mt-2 text-xs font-medium" style={{ color: "var(--mr-danger)" }}>
          {actionError}
        </p>
      ) : null}

      {historyOpen ? (
        <div
          className="mt-3 rounded border p-2.5 text-xs"
          style={{
            backgroundColor: "var(--mr-bg-canvas)",
            borderColor: "var(--mr-border-subtle)",
          }}
        >
          <p className="mb-1.5 font-semibold" style={{ color: "var(--mr-text-secondary)" }}>
            Edit History (read-only)
          </p>
          {historyLoading ? (
            <p style={{ color: "var(--mr-text-muted)" }}>Loading history...</p>
          ) : historyItems.length === 0 ? (
            <p style={{ color: "var(--mr-text-muted)" }}>No earlier versions recorded.</p>
          ) : (
            <ul className="space-y-1.5">
              {historyItems.map((h) => (
                <li
                  key={h.editId}
                  className="rounded border p-2"
                  style={{ borderColor: "var(--mr-border-subtle)" }}
                >
                  <p className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                    {new Date(h.editedAt).toLocaleString()} · Spoiler:{" "}
                    {h.previousIsSpoiler ? "Yes" : "No"}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap">{h.previousContent}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {replyOpen ? (
        <form onSubmit={handleReplySubmit} className="mt-3 space-y-2">
          <textarea
            rows={2}
            maxLength={MAX_COMMENT_LENGTH}
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            placeholder={`Reply to ${comment.author.displayName}...`}
            className="w-full rounded border px-3 py-1.5 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-canvas)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          />
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={replySpoiler}
                onChange={(e) => setReplySpoiler(e.target.checked)}
              />
              <span>Spoiler</span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReplyOpen(false)}
                className="cursor-pointer rounded border px-2 py-1"
                style={{ borderColor: "var(--mr-border-strong)" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !replyContent.trim()}
                className="cursor-pointer rounded px-3 py-1 font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--mr-accent)" }}
              >
                Post Reply
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {comment.replies.length > 0 ? (
        <div className="mt-2 space-y-2">
          {comment.replies.map((reply) => (
            <CommentCard
              key={reply.commentId}
              comment={reply}
              mangaId={mangaId}
              isReply
              onMutated={onMutated}
              onReport={onReport}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function CommentsSection({ mangaId, chapterId }: { mangaId: string; chapterId?: string }) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const [scope, setScope] = useState<string>(chapterId ? "CHAPTER" : "ALL");
  const [sort, setSort] = useState<string>("NEWEST");
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [spoilerFilter, setSpoilerFilter] = useState<"ALL" | "NON_SPOILER" | "SPOILER_ONLY">("ALL");
  const [content, setContent] = useState("");
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  useEffect(() => {
    setPage(1);
  }, [mangaId, chapterId, scope, sort]);

  const commentsQuery = useQuery({
    queryKey: ["comments", mangaId, chapterId ?? "none", scope, sort, page],
    queryFn: () =>
      apiClient.listComments({
        mangaId,
        chapterId: scope === "CHAPTER" ? chapterId : undefined,
        scope,
        sort,
        page,
      }),
  });

  const visibleComments = useMemo(() => {
    const items = commentsQuery.data?.data ?? [];
    const q = keyword.trim().toLowerCase();
    return items.filter((cm) => {
      if (spoilerFilter === "NON_SPOILER" && cm.isSpoiler) return false;
      if (spoilerFilter === "SPOILER_ONLY" && !cm.isSpoiler) return false;
      if (!q) return true;
      const rootMatch =
        cm.content.toLowerCase().includes(q) ||
        cm.author.displayName.toLowerCase().includes(q) ||
        cm.author.username.toLowerCase().includes(q);
      const replyMatch = cm.replies.some(
        (r) =>
          r.content.toLowerCase().includes(q) ||
          r.author.displayName.toLowerCase().includes(q) ||
          r.author.username.toLowerCase().includes(q),
      );
      return rootMatch || replyMatch;
    });
  }, [commentsQuery.data, keyword, spoilerFilter]);

  function refreshComments() {
    void queryClient.invalidateQueries({ queryKey: ["comments", mangaId] });
  }

  async function handlePost(e: FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await apiClient.createComment({
        mangaId,
        chapterId: chapterId ?? null,
        content,
        isSpoiler,
      });
      setContent("");
      setIsSpoiler(false);
      refreshComments();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not post comment.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
          Comments ({commentsQuery.data?.meta.total ?? 0})
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="search"
            aria-label="Filter loaded comments"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Filter text or user..."
            className="w-40 rounded border px-2.5 py-1"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          />
          <select
            aria-label="Filter spoiler comments"
            value={spoilerFilter}
            onChange={(e) =>
              setSpoilerFilter(e.target.value as "ALL" | "NON_SPOILER" | "SPOILER_ONLY")
            }
            className="rounded border px-2.5 py-1"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <option value="ALL">All Visibility</option>
            <option value="NON_SPOILER">Hide Spoilers</option>
            <option value="SPOILER_ONLY">Spoilers Only</option>
          </select>
          {!chapterId ? (
            <select
              aria-label="Filter comment scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="rounded border px-2.5 py-1"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="ALL">All Comments</option>
              <option value="MANGA_ONLY">Manga Discussion Only</option>
            </select>
          ) : null}
          <select
            aria-label="Sort comments"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded border px-2.5 py-1"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <option value="NEWEST">Newest First</option>
            <option value="OLDEST">Oldest First</option>
            <option value="TOP_LIKED">Most Liked</option>
          </select>
        </div>
      </div>

      {isAuthenticated ? (
        <form
          onSubmit={handlePost}
          className="space-y-2 rounded-[var(--mr-radius-md)] border p-4"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-subtle)",
          }}
        >
          <textarea
            rows={3}
            maxLength={MAX_COMMENT_LENGTH}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              chapterId ? "Share your thoughts on this chapter..." : "Write a comment..."
            }
            className="w-full rounded border px-3 py-2 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
              color: "var(--mr-text-primary)",
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={isSpoiler}
                  onChange={(e) => setIsSpoiler(e.target.checked)}
                />
                <span>Contains spoiler</span>
              </label>
              <span style={{ color: "var(--mr-text-muted)" }}>
                {content.length}/{MAX_COMMENT_LENGTH}
              </span>
            </div>
            <button
              type="submit"
              disabled={posting || !content.trim()}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-1.5 font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              {posting ? "Posting..." : "Post Comment"}
            </button>
          </div>
          {error ? (
            <p className="text-xs font-medium" style={{ color: "var(--mr-danger)" }}>
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <p
          className="rounded-[var(--mr-radius-md)] border p-3 text-xs"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-subtle)",
            color: "var(--mr-text-secondary)",
          }}
        >
          <Link
            to="/login"
            className="font-semibold underline"
            style={{ color: "var(--mr-accent)" }}
          >
            Sign in
          </Link>{" "}
          to post comments, reply, and react.
        </p>
      )}

      {commentsQuery.isLoading ? (
        <LoadingState variant="table" count={4} label="Loading comments..." />
      ) : commentsQuery.isError ? (
        <ErrorState onRetry={() => void commentsQuery.refetch()} />
      ) : commentsQuery.data && commentsQuery.data.data.length === 0 ? (
        <EmptyState
          title="No comments yet"
          description="Be the first reader to start the discussion."
        />
      ) : visibleComments.length === 0 ? (
        <EmptyState
          title="No comments matched your filter"
          description="Clear the text or spoiler filter to view comments on this page."
        />
      ) : (
        <>
          <div className="space-y-3">
            {visibleComments.map((comment) => (
              <CommentCard
                key={comment.commentId}
                comment={comment}
                mangaId={mangaId}
                onMutated={refreshComments}
                onReport={setReportTarget}
              />
            ))}
          </div>
          {commentsQuery.data ? (
            <CatalogPagination
              page={page}
              total={commentsQuery.data.meta.total}
              pageSize={commentsQuery.data.meta.pageSize || 20}
              hasNext={commentsQuery.data.meta.hasNext}
              onPageChange={setPage}
              label="Comments pagination"
            />
          ) : null}
        </>
      )}

      {reportTarget ? (
        <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />
      ) : null}
    </section>
  );
}
