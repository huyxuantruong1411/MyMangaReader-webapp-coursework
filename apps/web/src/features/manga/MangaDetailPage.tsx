import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AddToListsModal } from "../../components/AddToListsModal";
import { MangaCard } from "../../components/MangaCard";
import { ReportModal } from "../../components/ReportModal";
import { EmptyState, ErrorState, LoadingState, NotFoundState } from "../../components/StateViews";
import { useAuth } from "../../hooks/useAuth";
import { ApiClientError, apiClient } from "../../services/apiClient";
import { CommentsSection } from "./CommentsSection";

const READING_STATUSES = [
  { value: "", label: "Set reading status..." },
  { value: "READING", label: "Reading" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "DROPPED", label: "Dropped" },
  { value: "PLAN_TO_READ", label: "Plan to Read" },
  { value: "RE_READING", label: "Re-Reading" },
];

export function MangaDetailPage() {
  const { slug = "" } = useParams();
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const [chapterLang, setChapterLang] = useState("");
  const [chapterOrder, setChapterOrder] = useState<"ASC" | "DESC">("ASC");
  const [listsModalOpen, setListsModalOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const detailQuery = useQuery({
    queryKey: ["manga", "detail", slug],
    queryFn: () => apiClient.getMangaDetail(slug),
    enabled: Boolean(slug),
  });

  const manga = detailQuery.data?.data;

  const chaptersQuery = useQuery({
    queryKey: ["manga", "chapters", slug, chapterLang, chapterOrder],
    queryFn: () =>
      apiClient.listMangaChapters(slug, {
        language: chapterLang || undefined,
        order: chapterOrder,
      }),
    enabled: Boolean(manga),
  });

  const itemRecsQuery = useQuery({
    queryKey: ["manga", "recs", manga?.mangaId, "ITEM_BASED"],
    queryFn: () => apiClient.getMangaRecommendations(manga!.mangaId, "ITEM_BASED", 6),
    enabled: Boolean(manga?.mangaId),
  });

  const contentRecsQuery = useQuery({
    queryKey: ["manga", "recs", manga?.mangaId, "CONTENT_BASED"],
    queryFn: () => apiClient.getMangaRecommendations(manga!.mangaId, "CONTENT_BASED", 6),
    enabled: Boolean(manga?.mangaId),
  });

  const groupedTags = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const tag of manga?.tags ?? []) {
      const grp = tag.group || "other";
      const arr = map.get(grp) ?? [];
      arr.push(tag.name);
      map.set(grp, arr);
    }
    return Array.from(map.entries());
  }, [manga?.tags]);

  if (detailQuery.isLoading) {
    return <LoadingState label="Loading manga details..." />;
  }
  if (detailQuery.isError) {
    const err = detailQuery.error;
    if (err instanceof ApiClientError && err.status === 404) {
      return (
        <NotFoundState
          title="Manga unavailable"
          description="This manga does not exist or is currently hidden from the public catalog."
        />
      );
    }
    return <ErrorState onRetry={() => void detailQuery.refetch()} />;
  }
  if (!manga) {
    return <NotFoundState />;
  }

  async function handleStatusChange(nextStatus: string) {
    if (!manga) return;
    setFeedback(null);
    try {
      if (!nextStatus) {
        await apiClient.clearReadingStatus(manga.mangaId);
        setFeedback({ tone: "ok", text: "Reading status cleared." });
      } else {
        await apiClient.setReadingStatus(manga.mangaId, nextStatus);
        setFeedback({ tone: "ok", text: `Status updated to ${nextStatus.replace("_", " ")}.` });
      }
      void queryClient.invalidateQueries({ queryKey: ["manga", "detail", slug] });
    } catch (err) {
      setFeedback({
        tone: "err",
        text: err instanceof ApiClientError ? err.message : "Unable to update reading status.",
      });
    }
  }

  async function handleRate(score: number) {
    if (!manga) return;
    setFeedback(null);
    try {
      const res = await apiClient.upsertRating(manga.mangaId, score);
      setFeedback({
        tone: "ok",
        text: `Rated ${res.data.score}/10 (Average: ${res.data.averageRating.toFixed(2)}).`,
      });
      void queryClient.invalidateQueries({ queryKey: ["manga", "detail", slug] });
    } catch (err) {
      setFeedback({
        tone: "err",
        text: err instanceof ApiClientError ? err.message : "Could not save rating.",
      });
    }
  }

  async function handleRemoveRating() {
    if (!manga) return;
    setFeedback(null);
    try {
      await apiClient.removeRating(manga.mangaId);
      setFeedback({ tone: "ok", text: "Your rating has been removed." });
      void queryClient.invalidateQueries({ queryKey: ["manga", "detail", slug] });
    } catch (err) {
      setFeedback({
        tone: "err",
        text: err instanceof ApiClientError ? err.message : "Could not remove rating.",
      });
    }
  }

  const viewer = manga.viewerState;
  const hasChapters = (chaptersQuery.data?.data.length ?? manga.stats.exportedChapterCount) > 0;

  return (
    <div className="space-y-8">
      {/* Top Hero Card */}
      <section
        className="grid gap-6 rounded-[var(--mr-radius-lg)] border p-6 md:grid-cols-[220px_1fr]"
        style={{
          backgroundColor: "var(--mr-bg-surface)",
          borderColor: "var(--mr-border-subtle)",
        }}
      >
        <div className="space-y-3">
          <div
            className="aspect-[3/4] overflow-hidden rounded-[var(--mr-radius-md)] border"
            style={{ borderColor: "var(--mr-border-subtle)" }}
          >
            {manga.coverUrl ? (
              <img src={manga.coverUrl} alt={manga.title} className="h-full w-full object-cover" />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center text-xs"
                style={{ backgroundColor: "var(--mr-bg-elevated)", color: "var(--mr-text-muted)" }}
              >
                No Cover
              </div>
            )}
          </div>

          <div
            className="grid grid-cols-2 gap-2 rounded-[var(--mr-radius-sm)] border p-2.5 text-center text-xs"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <div>
              <p className="font-bold" style={{ color: "var(--mr-warning)" }}>
                ★ {manga.averageRating.toFixed(2)}
              </p>
              <p style={{ color: "var(--mr-text-muted)" }}>{manga.ratingCount} ratings</p>
            </div>
            <div>
              <p className="font-bold" style={{ color: "var(--mr-text-primary)" }}>
                {manga.totalViews.toLocaleString()}
              </p>
              <p style={{ color: "var(--mr-text-muted)" }}>valid views</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase">
              <span
                className="rounded px-2 py-0.5"
                style={{ backgroundColor: "var(--mr-bg-elevated)", color: "var(--mr-accent)" }}
              >
                {manga.publicationStatus}
              </span>
              <span
                className="rounded px-2 py-0.5"
                style={{ backgroundColor: "var(--mr-bg-elevated)", color: "var(--mr-warning)" }}
              >
                {manga.contentRating}
              </span>
              <span
                className="rounded px-2 py-0.5"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  color: "var(--mr-text-secondary)",
                }}
              >
                {manga.publicationDemographic}
              </span>
              {manga.year ? (
                <span style={{ color: "var(--mr-text-muted)" }}>{manga.year}</span>
              ) : null}
            </div>

            <h1 className="mt-2 text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
              {manga.title}
            </h1>
            {manga.altTitles.length > 0 ? (
              <p className="mt-1 text-xs" style={{ color: "var(--mr-text-muted)" }}>
                Also known as: {manga.altTitles.join(" · ")}
              </p>
            ) : null}
          </div>

          {manga.creators.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span style={{ color: "var(--mr-text-muted)" }}>Creators:</span>
              {manga.creators.map((c) => (
                <Link
                  key={c.creatorId}
                  to={`/author/${c.creatorId}/${c.slug}`}
                  className="rounded border px-2 py-0.5 font-medium hover:underline"
                  style={{
                    borderColor: "var(--mr-border-strong)",
                    color: "var(--mr-accent)",
                  }}
                >
                  {c.name} ({c.roles.join("/")})
                </Link>
              ))}
            </div>
          ) : null}

          <p
            className="whitespace-pre-line text-sm leading-relaxed"
            style={{ color: "var(--mr-text-secondary)" }}
          >
            {manga.description || "No description provided."}
          </p>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {hasChapters ? (
              <>
                <Link
                  to={`/manga/${manga.slug}/read?action=START`}
                  className="rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-semibold text-white"
                  style={{ backgroundColor: "var(--mr-accent)" }}
                >
                  Start Reading
                </Link>
                {viewer?.progress ? (
                  <Link
                    to={`/manga/${manga.slug}/chapter/${viewer.progress.chapterId}`}
                    className="rounded-[var(--mr-radius-sm)] border px-4 py-2 text-sm font-semibold"
                    style={{
                      borderColor: "var(--mr-success)",
                      color: "var(--mr-success)",
                    }}
                  >
                    Continue (Page {viewer.progress.pageNumber})
                  </Link>
                ) : null}
              </>
            ) : (
              <span
                className="rounded-[var(--mr-radius-sm)] border px-3 py-2 text-xs"
                style={{ borderColor: "var(--mr-border-subtle)", color: "var(--mr-text-muted)" }}
              >
                Metadata-only entry (0 exported chapters)
              </span>
            )}

            {isAuthenticated ? (
              <>
                <select
                  aria-label="Reading status"
                  value={viewer?.readingStatus ?? ""}
                  onChange={(e) => void handleStatusChange(e.target.value)}
                  className="rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-strong)",
                    color: "var(--mr-text-primary)",
                  }}
                >
                  {READING_STATUSES.map((st) => (
                    <option key={st.value || "none"} value={st.value}>
                      {st.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setListsModalOpen(true)}
                  className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3.5 py-2 text-sm font-medium"
                  style={{
                    borderColor: "var(--mr-border-strong)",
                    color: "var(--mr-text-primary)",
                  }}
                >
                  + Reading Lists
                </button>
                <button
                  type="button"
                  onClick={() => setReportOpen(true)}
                  className="ml-auto cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-2 text-xs font-medium"
                  style={{
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-danger)",
                  }}
                >
                  Report Issue
                </button>
              </>
            ) : null}
          </div>

          {/* 1–10 Rating Bar (UC-5.1 / UC-5.2) */}
          <div
            className="rounded-[var(--mr-radius-md)] border p-3"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold">
                Your Rating (1–10):{" "}
                {viewer?.myRating ? (
                  <strong style={{ color: "var(--mr-warning)" }}>{viewer.myRating}/10</strong>
                ) : (
                  <span style={{ color: "var(--mr-text-muted)" }}>Not rated</span>
                )}
              </span>
              {viewer?.myRating ? (
                <button
                  type="button"
                  onClick={() => void handleRemoveRating()}
                  className="cursor-pointer text-xs underline"
                  style={{ color: "var(--mr-danger)" }}
                >
                  Remove rating
                </button>
              ) : null}
            </div>
            {isAuthenticated ? (
              viewer?.canRate ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
                    <button
                      key={score}
                      type="button"
                      onClick={() => void handleRate(score)}
                      className="h-7 w-7 cursor-pointer rounded border text-xs font-semibold"
                      style={{
                        backgroundColor:
                          viewer.myRating === score ? "var(--mr-warning)" : "var(--mr-bg-surface)",
                        borderColor:
                          viewer.myRating === score
                            ? "var(--mr-warning)"
                            : "var(--mr-border-strong)",
                        color: viewer.myRating === score ? "#0f172a" : "var(--mr-text-primary)",
                      }}
                    >
                      {score}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-xs" style={{ color: "var(--mr-text-muted)" }}>
                  Open at least one chapter of this manga before submitting a rating.
                </p>
              )
            ) : (
              <p className="mt-1.5 text-xs" style={{ color: "var(--mr-text-muted)" }}>
                Sign in and read a chapter to rate this title.
              </p>
            )}
          </div>

          {feedback ? (
            <p
              className="text-xs font-medium"
              style={{
                color: feedback.tone === "ok" ? "var(--mr-success)" : "var(--mr-danger)",
              }}
            >
              {feedback.text}
            </p>
          ) : null}

          {/* Tags + Package Stats */}
          <div
            className="space-y-2 border-t pt-3"
            style={{ borderColor: "var(--mr-border-subtle)" }}
          >
            {groupedTags.map(([grp, names]) => (
              <div key={grp} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span
                  className="w-16 shrink-0 text-[10px] font-semibold uppercase"
                  style={{ color: "var(--mr-text-muted)" }}
                >
                  {grp}
                </span>
                {names.map((name) => (
                  <span
                    key={name}
                    className="rounded px-2 py-0.5 text-[11px]"
                    style={{
                      backgroundColor: "var(--mr-bg-elevated)",
                      color: "var(--mr-text-secondary)",
                    }}
                  >
                    {name}
                  </span>
                ))}
              </div>
            ))}
            <div
              className="flex flex-wrap gap-4 pt-1 text-[11px]"
              style={{ color: "var(--mr-text-muted)" }}
            >
              <span>Official Chapters: {manga.officialChapters ?? "N/A"}</span>
              <span>Official Volumes: {manga.officialVolumes ?? "N/A"}</span>
              <span>Exported Chapters: {manga.stats.exportedChapterCount}</span>
              <span>Exported Pages: {manga.stats.exportedPageCount}</span>
              <span>Languages: {manga.stats.languages.join(", ") || "N/A"}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Chapter List */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
            Chapters ({chaptersQuery.data?.data.length ?? 0})
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <select
              aria-label="Filter chapter language"
              value={chapterLang}
              onChange={(e) => setChapterLang(e.target.value)}
              className="rounded border px-2.5 py-1"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="">All Languages</option>
              {manga.stats.languages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang.toUpperCase()}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setChapterOrder((prev) => (prev === "ASC" ? "DESC" : "ASC"))}
              className="cursor-pointer rounded border px-2.5 py-1"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              Order: {chapterOrder}
            </button>
          </div>
        </div>

        {chaptersQuery.isLoading ? (
          <LoadingState label="Loading chapter list..." />
        ) : chaptersQuery.data && chaptersQuery.data.data.length === 0 ? (
          <EmptyState
            title="No chapters available"
            description="This title currently has no readable chapters matching your filter."
          />
        ) : (
          <ul
            className="divide-y rounded-[var(--mr-radius-md)] border"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            {chaptersQuery.data?.data.map((ch) => (
              <li
                key={ch.chapterId}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                style={{ borderColor: "var(--mr-border-subtle)" }}
              >
                <Link
                  to={`/manga/${manga.slug}/chapter/${ch.chapterId}`}
                  className="flex flex-wrap items-center gap-2 font-medium hover:underline"
                  style={{ color: "var(--mr-text-primary)" }}
                >
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-xs"
                    style={{ backgroundColor: "var(--mr-bg-elevated)", color: "var(--mr-accent)" }}
                  >
                    Ch. {ch.chapterNumber}
                  </span>
                  {ch.volume ? (
                    <span className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                      Vol. {ch.volume}
                    </span>
                  ) : null}
                  <span>{ch.title || `Chapter ${ch.chapterNumber}`}</span>
                </Link>
                <div
                  className="flex items-center gap-3 text-xs"
                  style={{ color: "var(--mr-text-muted)" }}
                >
                  <span className="uppercase">{ch.language}</span>
                  <span>{ch.pageCount} pages</span>
                  {ch.scanlationGroup ? <span>{ch.scanlationGroup}</span> : null}
                  <span>{ch.viewCount} views</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recommendations: Item-Based & Content-Based */}
      {itemRecsQuery.data && itemRecsQuery.data.data.items.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
              Readers Also Liked
            </h2>
            <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
              {itemRecsQuery.data.data.method}
              {itemRecsQuery.data.data.fallbackReason
                ? ` · ${itemRecsQuery.data.data.fallbackReason}`
                : ""}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
            {itemRecsQuery.data.data.items.map((item) => (
              <MangaCard key={item.mangaId} manga={item} />
            ))}
          </div>
        </section>
      ) : null}

      {contentRecsQuery.data && contentRecsQuery.data.data.items.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
              Similar Content &amp; Themes
            </h2>
            <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
              {contentRecsQuery.data.data.method}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
            {contentRecsQuery.data.data.items.map((item) => (
              <MangaCard key={item.mangaId} manga={item} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Threaded Comments */}
      <CommentsSection mangaId={manga.mangaId} />

      {listsModalOpen ? (
        <AddToListsModal
          mangaId={manga.mangaId}
          mangaTitle={manga.title}
          onClose={() => setListsModalOpen(false)}
        />
      ) : null}

      {reportOpen ? (
        <ReportModal
          target={{ kind: "MANGA", mangaId: manga.mangaId, label: manga.title }}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </div>
  );
}
