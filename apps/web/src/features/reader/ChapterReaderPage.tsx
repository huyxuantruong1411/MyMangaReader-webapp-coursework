import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ReportModal } from "../../components/ReportModal";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { useAuth } from "../../hooks/useAuth";
import {
  ApiClientError,
  apiClient,
  type ReaderOpenResponse,
  type ReaderPageItem,
  type ReaderSettingsData,
} from "../../services/apiClient";
import { CommentsSection } from "../manga/CommentsSection";

const GUEST_SETTINGS_KEY = "mr_guest_reader_settings";
const DEFAULT_SETTINGS: ReaderSettingsData = {
  displayMode: "VERTICAL_WEBTOON",
  readingDirection: "LTR",
  fitMode: "FIT_WIDTH",
  preloadPageCount: 3,
};

function loadGuestSettings(): ReaderSettingsData {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(GUEST_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ReaderSettingsData>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function fitImageClass(fitMode: ReaderSettingsData["fitMode"], doubleMode: boolean): string {
  if (fitMode === "FIT_HEIGHT") {
    return "max-h-[88vh] w-auto object-contain mx-auto";
  }
  if (fitMode === "ORIGINAL") {
    return "max-w-none w-auto h-auto mx-auto";
  }
  return doubleMode ? "w-full h-auto object-contain" : "w-full max-w-3xl h-auto mx-auto";
}

function PageImage({
  page,
  className,
  onReport,
}: {
  page: ReaderPageItem;
  className: string;
  onReport?: () => void;
}) {
  const [retryCount, setRetryCount] = useState(0);
  const [failed, setFailed] = useState(false);

  const src = retryCount > 0 ? `${page.url}&retry=${retryCount}` : page.url;

  if (failed) {
    return (
      <div
        className="mx-auto my-4 flex max-w-xl flex-col items-center gap-3 rounded-lg border p-6 text-center text-sm"
        style={{ borderColor: "#334155", backgroundColor: "#111827" }}
      >
        <p className="font-medium text-red-400">
          Failed to load page {page.pageNumber} ({page.filename})
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setRetryCount((c) => c + 1);
            }}
            className="cursor-pointer rounded bg-sky-500 px-3 py-1 text-xs font-semibold text-white"
          >
            Retry Image
          </button>
          {onReport ? (
            <button
              type="button"
              onClick={onReport}
              className="cursor-pointer rounded border border-red-400 px-3 py-1 text-xs text-red-300"
            >
              Report Broken Page
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`Page ${page.pageNumber}`}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

export function ChapterReaderPage() {
  const { slug = "", chapterId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const actionParam = searchParams.get("action") || (chapterId ? "SELECT" : "CONTINUE");

  const [payload, setPayload] = useState<ReaderOpenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [settings, setSettings] = useState<ReaderSettingsData>(() => loadGuestSettings());
  const [activePage, setActivePage] = useState<number>(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [narrowViewport, setNarrowViewport] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const sequenceRef = useRef(0);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const openedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    function handleResize() {
      setNarrowViewport(window.innerWidth < 768);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const loadChapter = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.openReader({
        mangaId: slug,
        actionType: chapterId ? "SELECT" : actionParam,
        chapterId,
      });
      setPayload(res.data);
      setActivePage(Math.max(1, res.data.initialPage || 1));
      if (isAuthenticated && res.data.settings) {
        setSettings(res.data.settings);
      } else {
        setSettings(loadGuestSettings());
      }
      openedAtRef.current = Date.now();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to open chapter.");
    } finally {
      setLoading(false);
    }
  }, [slug, chapterId, actionParam, isAuthenticated]);

  useEffect(() => {
    void loadChapter();
  }, [loadChapter]);

  // Valid-view completion timer (UC-4.4)
  useEffect(() => {
    if (!isAuthenticated || !payload?.historyId) return;
    const historyId = payload.historyId;
    const timer = window.setTimeout(() => {
      const elapsed = Math.max(5, Math.round((Date.now() - openedAtRef.current) / 1000));
      void apiClient.completeViewSession(historyId, elapsed).catch(() => {});
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [isAuthenticated, payload?.historyId]);

  // Debounced exact-page progress checkpoint (ADR-001)
  useEffect(() => {
    if (!isAuthenticated || !payload) return;
    const currentObj = payload.pages.find((p) => p.pageNumber === activePage);
    const timer = window.setTimeout(() => {
      sequenceRef.current += 1;
      void apiClient
        .saveProgress({
          mangaId: payload.manga.mangaId,
          chapterId: payload.chapter.chapterId,
          pageNumber: activePage,
          pageUid: currentObj?.pageUid ?? null,
          pagesRevision: payload.chapter.pagesRevision,
          clientSequence: sequenceRef.current,
        })
        .catch(() => {});
    }, 600);
    return () => window.clearTimeout(timer);
  }, [isAuthenticated, payload, activePage]);

  // Preload next N images
  useEffect(() => {
    if (!payload || settings.preloadPageCount <= 0) return;
    const upcoming = payload.pages.filter(
      (p) => p.pageNumber > activePage && p.pageNumber <= activePage + settings.preloadPageCount,
    );
    for (const pg of upcoming) {
      const img = new Image();
      img.src = pg.url;
    }
  }, [payload, activePage, settings.preloadPageCount]);

  // Vertical mode scroll tracking
  useEffect(() => {
    if (settings.displayMode !== "VERTICAL_WEBTOON" || !payload) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const num = Number((entry.target as HTMLElement).dataset.pageNumber);
            if (num >= 1) setActivePage(num);
          }
        }
      },
      { threshold: 0.4 },
    );
    for (const el of pageRefs.current.values()) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [settings.displayMode, payload]);

  const totalPages = payload?.pages.length ?? 0;
  const effectiveDouble = settings.displayMode === "DOUBLE_PAGE" && !narrowViewport;
  const pageStep = effectiveDouble ? 2 : 1;

  const goToPage = useCallback(
    (nextPage: number) => {
      if (totalPages === 0) return;
      const clamped = Math.max(1, Math.min(totalPages, nextPage));
      setActivePage(clamped);
      if (settings.displayMode === "VERTICAL_WEBTOON") {
        const node = pageRefs.current.get(clamped);
        if (node && typeof node.scrollIntoView === "function") {
          node.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    },
    [totalPages, settings.displayMode],
  );

  // Keyboard navigation respecting LTR / RTL
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goToPage(
          settings.readingDirection === "RTL" ? activePage - pageStep : activePage + pageStep,
        );
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPage(
          settings.readingDirection === "RTL" ? activePage + pageStep : activePage - pageStep,
        );
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePage, goToPage, pageStep, settings.readingDirection]);

  async function updateSettings(patch: Partial<ReaderSettingsData>) {
    // Switching modes strictly preserves `activePage` identity (`07_READER_ENGINE_PROGRESS_MEDIA.md`)
    const next: ReaderSettingsData = { ...settings, ...patch };
    setSettings(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(GUEST_SETTINGS_KEY, JSON.stringify(next));
    }
    if (isAuthenticated) {
      try {
        const res = await apiClient.updateReaderSettings(next);
        setSettings(res.data);
        setSaveStatus("Preferences synced");
        window.setTimeout(() => setSaveStatus(null), 1500);
      } catch {
        setSaveStatus("Saved locally");
      }
    }
  }

  const visibleSpreadPages = useMemo(() => {
    if (!payload) return [];
    if (settings.displayMode === "VERTICAL_WEBTOON") return payload.pages;
    if (effectiveDouble) {
      const start = activePage % 2 === 0 ? activePage - 1 : activePage;
      const pair = payload.pages.filter(
        (p) => p.pageNumber === start || p.pageNumber === start + 1,
      );
      return settings.readingDirection === "RTL" ? [...pair].reverse() : pair;
    }
    const single = payload.pages.find((p) => p.pageNumber === activePage);
    return single ? [single] : [];
  }, [payload, settings.displayMode, settings.readingDirection, effectiveDouble, activePage]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <LoadingState label="Opening chapter reader..." />
      </div>
    );
  }
  if (error || !payload) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <ErrorState
          title="Unable to open chapter"
          description={error ?? "Chapter data unavailable."}
          onRetry={() => void loadChapter()}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top Reader Toolbar */}
      <header
        className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs"
        style={{ backgroundColor: "#0c0f16", borderColor: "#1f2937" }}
      >
        <div className="flex items-center gap-3">
          <Link
            to={`/manga/${payload.manga.slug}`}
            className="font-semibold text-sky-400 hover:underline"
          >
            ← {payload.manga.title}
          </Link>
          <span className="font-mono text-slate-300">
            Ch. {payload.chapter.chapterNumber}
            {payload.chapter.title ? ` — ${payload.chapter.title}` : ""} (
            {payload.chapter.language.toUpperCase()})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="reader-page-indicator"
            className="rounded bg-slate-800 px-2 py-1 font-mono text-slate-200"
          >
            Page {activePage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setDrawerOpen((o) => !o)}
            className="cursor-pointer rounded border border-slate-600 px-2.5 py-1 font-medium text-slate-100"
          >
            ⚙ Settings
          </button>
          <button
            type="button"
            onClick={() => setCommentsOpen((o) => !o)}
            className="cursor-pointer rounded border border-slate-600 px-2.5 py-1 font-medium text-slate-100"
          >
            💬 Comments
          </button>
          {isAuthenticated ? (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="cursor-pointer rounded border border-red-500/60 px-2.5 py-1 text-red-300"
            >
              Report
            </button>
          ) : null}
        </div>
      </header>

      {/* Live Reader Settings Drawer */}
      {drawerOpen ? (
        <aside
          aria-label="Reader settings"
          className="border-b px-4 py-4 text-xs"
          style={{ backgroundColor: "#131824", borderColor: "#1f2937" }}
        >
          <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-4">
            <div>
              <label
                htmlFor="reader-mode-select"
                className="mb-1 block font-semibold text-slate-300"
              >
                Display Mode
              </label>
              <select
                id="reader-mode-select"
                value={settings.displayMode}
                onChange={(e) =>
                  void updateSettings({
                    displayMode: e.target.value as ReaderSettingsData["displayMode"],
                  })
                }
                className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-slate-100"
              >
                <option value="VERTICAL_WEBTOON">Vertical Scroll (Webtoon)</option>
                <option value="SINGLE_PAGE">Single Page</option>
                <option value="DOUBLE_PAGE">Double Page Spread</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="reader-dir-select"
                className="mb-1 block font-semibold text-slate-300"
              >
                Reading Direction
              </label>
              <select
                id="reader-dir-select"
                value={settings.readingDirection}
                onChange={(e) =>
                  void updateSettings({
                    readingDirection: e.target.value as ReaderSettingsData["readingDirection"],
                  })
                }
                className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-slate-100"
              >
                <option value="LTR">Left-to-Right (LTR)</option>
                <option value="RTL">Right-to-Left (Manga RTL)</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="reader-fit-select"
                className="mb-1 block font-semibold text-slate-300"
              >
                Fit Mode
              </label>
              <select
                id="reader-fit-select"
                value={settings.fitMode}
                onChange={(e) =>
                  void updateSettings({
                    fitMode: e.target.value as ReaderSettingsData["fitMode"],
                  })
                }
                className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-slate-100"
              >
                <option value="FIT_WIDTH">Fit Width</option>
                <option value="FIT_HEIGHT">Fit Height</option>
                <option value="ORIGINAL">Original Size</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="reader-preload-input"
                className="mb-1 block font-semibold text-slate-300"
              >
                Preload Ahead ({settings.preloadPageCount} pages)
              </label>
              <input
                id="reader-preload-input"
                type="range"
                min={0}
                max={10}
                value={settings.preloadPageCount}
                onChange={(e) => void updateSettings({ preloadPageCount: Number(e.target.value) })}
                className="w-full"
              />
              {saveStatus ? (
                <p className="mt-1 text-[11px] text-emerald-400">{saveStatus}</p>
              ) : null}
            </div>
          </div>
        </aside>
      ) : null}

      {payload.resumeNote ? (
        <div className="bg-amber-950/60 px-4 py-2 text-center text-xs text-amber-200">
          {payload.resumeNote}
        </div>
      ) : null}

      {settings.displayMode === "DOUBLE_PAGE" && narrowViewport ? (
        <div className="bg-slate-800 px-4 py-1.5 text-center text-xs text-slate-300">
          Viewport is narrow — automatically displaying Single Page while keeping Double Page saved.
        </div>
      ) : null}

      {/* Page Canvas */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-2 py-4">
        {totalPages === 0 ? (
          <EmptyState title="No pages in this chapter" />
        ) : settings.displayMode === "VERTICAL_WEBTOON" ? (
          <div className="space-y-1">
            {payload.pages.map((pg) => (
              <div
                key={pg.pageUid}
                data-page-number={pg.pageNumber}
                ref={(el) => {
                  if (el) pageRefs.current.set(pg.pageNumber, el);
                  else pageRefs.current.delete(pg.pageNumber);
                }}
              >
                <PageImage
                  page={pg}
                  className={fitImageClass(settings.fitMode, false)}
                  onReport={isAuthenticated ? () => setReportOpen(true) : undefined}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className={
                effectiveDouble
                  ? "grid grid-cols-2 items-start justify-center gap-1"
                  : "flex justify-center"
              }
            >
              {visibleSpreadPages.map((pg) => (
                <div key={pg.pageUid} className="w-full">
                  <PageImage
                    page={pg}
                    className={fitImageClass(settings.fitMode, effectiveDouble)}
                    onReport={isAuthenticated ? () => setReportOpen(true) : undefined}
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
              <button
                type="button"
                disabled={activePage <= 1}
                onClick={() => goToPage(activePage - pageStep)}
                className="cursor-pointer rounded border border-slate-600 px-4 py-1.5 disabled:opacity-40"
              >
                ← Previous Page
              </button>
              <input
                aria-label="Jump to page"
                type="range"
                min={1}
                max={totalPages}
                value={activePage}
                onChange={(e) => goToPage(Number(e.target.value))}
                className="w-48"
              />
              <button
                type="button"
                disabled={activePage >= totalPages}
                onClick={() => goToPage(activePage + pageStep)}
                className="cursor-pointer rounded border border-slate-600 px-4 py-1.5 disabled:opacity-40"
              >
                Next Page →
              </button>
            </div>
          </div>
        )}

        {/* Bottom Chapter Navigation */}
        <nav
          aria-label="Chapter navigation"
          className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm"
          style={{ borderColor: "#1f2937", backgroundColor: "#0f131c" }}
        >
          {payload.prevChapter ? (
            <button
              type="button"
              onClick={() =>
                navigate(`/manga/${payload.manga.slug}/chapter/${payload.prevChapter!.chapterId}`)
              }
              className="cursor-pointer rounded border border-slate-600 px-4 py-2 font-medium text-slate-100"
            >
              ← Ch. {payload.prevChapter.chapterNumber}
            </button>
          ) : (
            <span className="text-xs text-slate-500">First Chapter</span>
          )}

          <Link
            to={`/manga/${payload.manga.slug}`}
            className="text-xs font-medium text-sky-400 underline"
          >
            Back to Manga Detail
          </Link>

          {payload.nextChapter ? (
            <button
              type="button"
              onClick={() =>
                navigate(`/manga/${payload.manga.slug}/chapter/${payload.nextChapter!.chapterId}`)
              }
              className="cursor-pointer rounded bg-sky-500 px-4 py-2 font-semibold text-white"
            >
              Ch. {payload.nextChapter.chapterNumber} →
            </button>
          ) : (
            <span className="text-xs text-slate-500">Latest Chapter</span>
          )}
        </nav>

        {commentsOpen ? (
          <div className="mt-8 rounded-lg border p-4" style={{ borderColor: "#1f2937" }}>
            <CommentsSection
              mangaId={payload.manga.mangaId}
              chapterId={payload.chapter.chapterId}
            />
          </div>
        ) : null}
      </main>

      {reportOpen ? (
        <ReportModal
          target={{
            kind: "MANGA",
            mangaId: payload.manga.mangaId,
            chapterId: payload.chapter.chapterId,
            label: `${payload.manga.title} — Ch. ${payload.chapter.chapterNumber}`,
          }}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </div>
  );
}
