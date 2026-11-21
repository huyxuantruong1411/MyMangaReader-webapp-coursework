import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CatalogPagination } from "../../components/CatalogPagination";
import { ReportModal } from "../../components/ReportModal";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { useAuth } from "../../hooks/useAuth";
import {
  ApiClientError,
  apiClient,
  type ChapterItem,
  type ReaderOpenResponse,
  type ReaderPageItem,
  type ReaderSettingsData,
} from "../../services/apiClient";
import { compareVolumeKeys } from "../../utils/localization";
import { CommentsSection } from "../manga/CommentsSection";

const GUEST_SETTINGS_KEY = "mr_guest_reader_settings";
const READER_BG_KEY = "mr_reader_bg_theme";
const READER_SOLO_COVER_KEY = "mr_reader_solo_cover";
const READER_GAP_KEY = "mr_reader_page_gap";

type ReaderBgTheme = "black" | "dark" | "gray" | "light";
type PageGapMode = "none" | "compact" | "wide";

const READER_BG_STYLES: Record<ReaderBgTheme, { bg: string; text: string; label: string }> = {
  black: { bg: "#050608", text: "#f1f5f9", label: "Pure Black" },
  dark: { bg: "#0f1117", text: "#f1f5f9", label: "Dark Slate" },
  gray: { bg: "#1e2430", text: "#f1f5f9", label: "Soft Gray" },
  light: { bg: "#f1f5f9", text: "#0f172a", label: "Paper Light" },
};

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

function loadReaderBg(): ReaderBgTheme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(READER_BG_KEY);
  return saved === "black" || saved === "gray" || saved === "light" ? saved : "dark";
}

function loadSoloCover(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(READER_SOLO_COVER_KEY) === "true";
}

function loadPageGap(): PageGapMode {
  if (typeof window === "undefined") return "compact";
  const saved = window.localStorage.getItem(READER_GAP_KEY);
  return saved === "none" || saved === "wide" ? saved : "compact";
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
      loading="lazy"
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
  const [chapterOptions, setChapterOptions] = useState<ChapterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [settings, setSettings] = useState<ReaderSettingsData>(() => loadGuestSettings());
  const [readerBg, setReaderBg] = useState<ReaderBgTheme>(() => loadReaderBg());
  const [soloCover, setSoloCover] = useState<boolean>(() => loadSoloCover());
  const [pageGap, setPageGap] = useState<PageGapMode>(() => loadPageGap());
  const [focusMode, setFocusMode] = useState(false);

  const [activePage, setActivePage] = useState<number>(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const [chapterPickerSearch, setChapterPickerSearch] = useState("");
  const [chapterPickerVolume, setChapterPickerVolume] = useState<string>("");
  const [chapterPickerRange, setChapterPickerRange] = useState<number>(0);
  const [chapterPickerPage, setChapterPickerPage] = useState(1);
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

  // Populate chapter quick-selector in the active chapter's language
  useEffect(() => {
    if (!payload) return;
    let active = true;
    apiClient
      .listMangaChapters(payload.manga.slug, {
        language: payload.chapter.language,
        order: "ASC",
      })
      .then((res) => {
        if (active && Array.isArray(res.data)) {
          setChapterOptions(res.data);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [payload]);

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

  // Keyboard navigation respecting LTR / RTL + Focus Mode ('F') + Escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
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
      } else if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setFocusMode((prev) => !prev);
      } else if (e.key === "Escape") {
        if (chapterPickerOpen) setChapterPickerOpen(false);
        else if (commentsOpen) setCommentsOpen(false);
        else if (drawerOpen) setDrawerOpen(false);
        else if (focusMode) setFocusMode(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activePage,
    goToPage,
    pageStep,
    settings.readingDirection,
    chapterPickerOpen,
    commentsOpen,
    drawerOpen,
    focusMode,
  ]);

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

  function changeReaderBg(bg: ReaderBgTheme) {
    setReaderBg(bg);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(READER_BG_KEY, bg);
    }
  }

  function toggleSoloCover(next: boolean) {
    setSoloCover(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(READER_SOLO_COVER_KEY, String(next));
    }
  }

  function changePageGap(gap: PageGapMode) {
    setPageGap(gap);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(READER_GAP_KEY, gap);
    }
  }

  const visibleSpreadPages = useMemo(() => {
    if (!payload) return [];
    if (settings.displayMode === "VERTICAL_WEBTOON") return payload.pages;
    if (effectiveDouble) {
      if (soloCover) {
        if (activePage === 1) {
          return payload.pages.filter((p) => p.pageNumber === 1);
        }
        const start = activePage % 2 === 0 ? activePage : activePage - 1;
        const pair = payload.pages.filter(
          (p) => p.pageNumber === start || p.pageNumber === start + 1,
        );
        return settings.readingDirection === "RTL" ? [...pair].reverse() : pair;
      }
      const start = activePage % 2 === 0 ? activePage - 1 : activePage;
      const pair = payload.pages.filter(
        (p) => p.pageNumber === start || p.pageNumber === start + 1,
      );
      return settings.readingDirection === "RTL" ? [...pair].reverse() : pair;
    }
    const single = payload.pages.find((p) => p.pageNumber === activePage);
    return single ? [single] : [];
  }, [
    payload,
    settings.displayMode,
    settings.readingDirection,
    effectiveDouble,
    activePage,
    soloCover,
  ]);

  const PICKER_CHUNK = 50;
  const PICKER_PAGE_SIZE = 25;

  const { pickerVolumes, pickerHasNoVolume } = useMemo(() => {
    const vols = new Set<string>();
    let noVol = false;
    for (const ch of chapterOptions) {
      const v = (ch.volume || "").trim();
      if (v) vols.add(v);
      else noVol = true;
    }
    return {
      pickerVolumes: Array.from(vols).sort((a, b) => compareVolumeKeys(a, b, true)),
      pickerHasNoVolume: noVol,
    };
  }, [chapterOptions]);

  const pickerVolumeFiltered = useMemo(() => {
    if (!chapterPickerVolume) return chapterOptions;
    if (chapterPickerVolume === "__NONE__") {
      return chapterOptions.filter((ch) => !(ch.volume || "").trim());
    }
    return chapterOptions.filter((ch) => (ch.volume || "").trim() === chapterPickerVolume);
  }, [chapterOptions, chapterPickerVolume]);

  const pickerRanges = useMemo(() => {
    if (pickerVolumeFiltered.length <= PICKER_CHUNK) return [];
    const chunks: Array<{ index: number; label: string; start: number; end: number }> = [];
    for (let i = 0; i < pickerVolumeFiltered.length; i += PICKER_CHUNK) {
      const slice = pickerVolumeFiltered.slice(i, i + PICKER_CHUNK);
      const firstLabel = slice[0]?.chapterNumber ?? String(i + 1);
      const lastLabel = slice[slice.length - 1]?.chapterNumber ?? String(i + slice.length);
      chunks.push({
        index: chunks.length,
        label: `Ch. ${firstLabel}–${lastLabel}`,
        start: i,
        end: i + PICKER_CHUNK,
      });
    }
    return chunks;
  }, [pickerVolumeFiltered]);

  const filteredPickerChapters = useMemo(() => {
    const q = chapterPickerSearch.trim().toLowerCase();
    const base =
      pickerRanges.length > 0 && chapterPickerRange >= 0 && pickerRanges[chapterPickerRange] && !q
        ? pickerVolumeFiltered.slice(
            pickerRanges[chapterPickerRange].start,
            pickerRanges[chapterPickerRange].end,
          )
        : pickerVolumeFiltered;
    if (!q) return base;
    return base.filter(
      (ch) =>
        ch.chapterNumber.toLowerCase().includes(q) ||
        ch.title.toLowerCase().includes(q) ||
        (ch.volume ?? "").toLowerCase().includes(q) ||
        (ch.scanlationGroup ?? "").toLowerCase().includes(q),
    );
  }, [pickerVolumeFiltered, chapterPickerSearch, chapterPickerRange, pickerRanges]);

  const pagedPickerChapters = useMemo(() => {
    const start = (chapterPickerPage - 1) * PICKER_PAGE_SIZE;
    return filteredPickerChapters.slice(start, start + PICKER_PAGE_SIZE);
  }, [filteredPickerChapters, chapterPickerPage]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <LoadingState variant="detail" label="Opening chapter reader..." />
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

  const bgTheme = READER_BG_STYLES[readerBg];
  const verticalGapClass =
    pageGap === "none" ? "space-y-0" : pageGap === "wide" ? "space-y-4" : "space-y-1";

  return (
    <div
      className="flex min-h-screen flex-col transition-colors"
      style={{ backgroundColor: bgTheme.bg, color: bgTheme.text }}
    >
      {/* Floating Restore Button when Focus Mode hides the toolbar */}
      {focusMode ? (
        <button
          type="button"
          onClick={() => setFocusMode(false)}
          className="fixed top-3 right-3 z-40 cursor-pointer rounded-full border border-slate-600 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-slate-100 shadow-lg"
        >
          Show Toolbar (F)
        </button>
      ) : null}

      {/* Sticky Top Reader Toolbar + Docked Settings Drawer */}
      {!focusMode ? (
        <div className="sticky top-0 z-30 shadow-md">
          <header
            className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs"
            style={{ backgroundColor: "#0c0f16", borderColor: "#1f2937", color: "#f1f5f9" }}
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                to={`/manga/${payload.manga.slug}`}
                className="font-semibold text-sky-400 hover:underline"
              >
                ← {payload.manga.title}
              </Link>
              {chapterOptions.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label="Select chapter"
                    value={payload.chapter.chapterId}
                    onChange={(e) =>
                      navigate(`/manga/${payload.manga.slug}/chapter/${e.target.value}`)
                    }
                    className="max-w-56 rounded border border-slate-600 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100"
                  >
                    {chapterOptions.map((ch) => (
                      <option key={ch.chapterId} value={ch.chapterId}>
                        Ch. {ch.chapterNumber}
                        {ch.title ? ` — ${ch.title}` : ""} ({ch.language.toUpperCase()})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-expanded={chapterPickerOpen}
                    onClick={() => {
                      setChapterPickerSearch("");
                      setChapterPickerPage(1);
                      setChapterPickerOpen(true);
                    }}
                    className="cursor-pointer rounded border border-slate-600 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:border-sky-400"
                  >
                    All Chapters ({chapterOptions.length})
                  </button>
                </div>
              ) : (
                <span className="font-mono text-slate-300">
                  Ch. {payload.chapter.chapterNumber}
                  {payload.chapter.title ? ` — ${payload.chapter.title}` : ""} (
                  {payload.chapter.language.toUpperCase()})
                </span>
              )}
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
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((o) => !o)}
                className={`cursor-pointer rounded border px-2.5 py-1 font-medium transition-colors ${
                  drawerOpen
                    ? "border-sky-400 bg-sky-500/20 text-sky-300"
                    : "border-slate-600 text-slate-100 hover:border-slate-400"
                }`}
              >
                ⚙ Settings
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  setCommentsOpen(false);
                  setFocusMode(true);
                }}
                className="cursor-pointer rounded border border-slate-600 px-2.5 py-1 font-medium text-slate-100 hover:border-slate-400"
              >
                Focus (F)
              </button>
              <button
                type="button"
                aria-expanded={commentsOpen}
                onClick={() => setCommentsOpen((o) => !o)}
                className={`cursor-pointer rounded border px-2.5 py-1 font-medium transition-colors ${
                  commentsOpen
                    ? "border-sky-400 bg-sky-500/20 text-sky-300"
                    : "border-slate-600 text-slate-100 hover:border-slate-400"
                }`}
              >
                💬 Comments
              </button>
              {isAuthenticated ? (
                <button
                  type="button"
                  onClick={() => setReportOpen(true)}
                  className="cursor-pointer rounded border border-red-500/60 px-2.5 py-1 text-red-300 hover:bg-red-950/40"
                >
                  Report
                </button>
              ) : null}
            </div>
          </header>

          {/* Live Reader Settings Drawer (pinned inside sticky header so always visible in viewport) */}
          {drawerOpen ? (
            <aside
              aria-label="Reader settings"
              className="max-h-[70vh] overflow-y-auto border-b px-4 py-4 text-xs text-slate-100 shadow-2xl"
              style={{ backgroundColor: "#131824", borderColor: "#1f2937" }}
            >
              <div className="mx-auto mb-3 flex max-w-5xl items-center justify-between border-b border-slate-700/70 pb-2">
                <span className="font-semibold text-sky-300">Reader Display &amp; Controls</span>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="cursor-pointer rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300 hover:text-white"
                >
                  Close ✕
                </button>
              </div>
              <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-3 lg:grid-cols-6">
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
                    htmlFor="reader-bg-select"
                    className="mb-1 block font-semibold text-slate-300"
                  >
                    Canvas Background
                  </label>
                  <select
                    id="reader-bg-select"
                    value={readerBg}
                    onChange={(e) => changeReaderBg(e.target.value as ReaderBgTheme)}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-slate-100"
                  >
                    {Object.entries(READER_BG_STYLES).map(([key, cfg]) => (
                      <option key={key} value={key}>
                        {cfg.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="reader-gap-select"
                    className="mb-1 block font-semibold text-slate-300"
                  >
                    Webtoon Page Gap
                  </label>
                  <select
                    id="reader-gap-select"
                    value={pageGap}
                    onChange={(e) => changePageGap(e.target.value as PageGapMode)}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-slate-100"
                  >
                    <option value="none">Seamless (0px)</option>
                    <option value="compact">Compact</option>
                    <option value="wide">Wide</option>
                  </select>
                  <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={soloCover}
                      onChange={(e) => toggleSoloCover(e.target.checked)}
                    />
                    <span>Solo cover in double-page</span>
                  </label>
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
                    onChange={(e) =>
                      void updateSettings({ preloadPageCount: Number(e.target.value) })
                    }
                    className="w-full"
                  />
                  {saveStatus ? (
                    <p className="mt-1 text-[11px] text-emerald-400">{saveStatus}</p>
                  ) : null}
                </div>
              </div>
            </aside>
          ) : null}
        </div>
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
          <div className={verticalGapClass}>
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
                effectiveDouble && visibleSpreadPages.length > 1
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
          className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm text-slate-100"
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

          <div className="flex items-center gap-3">
            <Link
              to={`/manga/${payload.manga.slug}`}
              className="text-xs font-medium text-sky-400 underline"
            >
              Back to Manga Detail
            </Link>
            <button
              type="button"
              onClick={() => setCommentsOpen(true)}
              className="cursor-pointer rounded border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-sky-400"
            >
              💬 Open Chapter Comments
            </button>
          </div>

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
      </main>

      {/* Slide-Over Chapter Comments Drawer (always opens inside current viewport) */}
      {commentsOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Chapter comments drawer"
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCommentsOpen(false);
          }}
        >
          <div
            className="flex h-full w-full max-w-xl flex-col border-l shadow-2xl"
            style={{
              backgroundColor: "var(--mr-bg-canvas)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <div
              className="flex items-center justify-between border-b px-4 py-3"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <div>
                <h2 className="text-sm font-bold">
                  Chapter Comments · Ch. {payload.chapter.chapterNumber}
                </h2>
                <p className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                  {payload.manga.title}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close comments drawer"
                onClick={() => setCommentsOpen(false)}
                className="cursor-pointer rounded border px-2.5 py-1 text-xs font-medium"
                style={{
                  borderColor: "var(--mr-border-strong)",
                  color: "var(--mr-text-secondary)",
                }}
              >
                Close ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <CommentsSection
                mangaId={payload.manga.mangaId}
                chapterId={payload.chapter.chapterId}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Searchable & Range-Grouped Chapter Picker Modal */}
      {chapterPickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Chapter selector"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setChapterPickerOpen(false);
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-[var(--mr-radius-lg)] border shadow-2xl"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            <div
              className="flex items-center justify-between gap-2 border-b px-4 py-3"
              style={{ borderColor: "var(--mr-border-subtle)" }}
            >
              <h2 className="text-sm font-bold">
                Select Chapter ({filteredPickerChapters.length} available)
              </h2>
              <button
                type="button"
                aria-label="Close chapter selector"
                onClick={() => setChapterPickerOpen(false)}
                className="cursor-pointer rounded border px-2.5 py-1 text-xs"
                style={{ borderColor: "var(--mr-border-strong)" }}
              >
                Close ✕
              </button>
            </div>

            <div
              className="space-y-2 border-b px-4 py-3"
              style={{ borderColor: "var(--mr-border-subtle)" }}
            >
              <div className="flex flex-wrap gap-2">
                <input
                  type="search"
                  value={chapterPickerSearch}
                  onChange={(e) => {
                    setChapterPickerSearch(e.target.value);
                    setChapterPickerPage(1);
                  }}
                  placeholder="Search chapter number, volume, title, or group..."
                  className="min-w-48 flex-1 rounded border px-3 py-1.5 text-xs"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-strong)",
                    color: "var(--mr-text-primary)",
                  }}
                />
                {pickerVolumes.length > 0 || pickerHasNoVolume ? (
                  <select
                    aria-label="Filter selector by volume"
                    value={chapterPickerVolume}
                    onChange={(e) => {
                      setChapterPickerVolume(e.target.value);
                      setChapterPickerRange(0);
                      setChapterPickerPage(1);
                    }}
                    className="rounded border px-2.5 py-1.5 text-xs"
                    style={{
                      backgroundColor: "var(--mr-bg-elevated)",
                      borderColor: "var(--mr-border-strong)",
                      color: "var(--mr-text-primary)",
                    }}
                  >
                    <option value="">All Volumes</option>
                    {pickerVolumes.map((vol) => (
                      <option key={vol} value={vol}>
                        Vol. {vol}
                      </option>
                    ))}
                    {pickerHasNoVolume ? <option value="__NONE__">No Volume</option> : null}
                  </select>
                ) : null}
              </div>
              {pickerRanges.length > 0 && !chapterPickerSearch.trim() ? (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setChapterPickerRange(-1);
                      setChapterPickerPage(1);
                    }}
                    className="cursor-pointer rounded border px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      backgroundColor:
                        chapterPickerRange === -1 ? "var(--mr-accent)" : "var(--mr-bg-elevated)",
                      borderColor:
                        chapterPickerRange === -1 ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                      color: chapterPickerRange === -1 ? "#ffffff" : "var(--mr-text-secondary)",
                    }}
                  >
                    All ({pickerVolumeFiltered.length})
                  </button>
                  {pickerRanges.map((rng) => (
                    <button
                      key={rng.index}
                      type="button"
                      onClick={() => {
                        setChapterPickerRange(rng.index);
                        setChapterPickerPage(1);
                      }}
                      className="cursor-pointer rounded border px-2 py-0.5 font-mono text-[11px] font-medium"
                      style={{
                        backgroundColor:
                          chapterPickerRange === rng.index
                            ? "var(--mr-accent)"
                            : "var(--mr-bg-elevated)",
                        borderColor:
                          chapterPickerRange === rng.index
                            ? "var(--mr-accent)"
                            : "var(--mr-border-subtle)",
                        color:
                          chapterPickerRange === rng.index ? "#ffffff" : "var(--mr-text-secondary)",
                      }}
                    >
                      {rng.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <ul className="divide-y text-xs" style={{ borderColor: "var(--mr-border-subtle)" }}>
                {pagedPickerChapters.map((ch) => {
                  const isCurrent = ch.chapterId === payload.chapter.chapterId;
                  return (
                    <li key={ch.chapterId}>
                      <button
                        type="button"
                        onClick={() => {
                          setChapterPickerOpen(false);
                          navigate(`/manga/${payload.manga.slug}/chapter/${ch.chapterId}`);
                        }}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left hover:opacity-85"
                        style={{
                          backgroundColor: isCurrent ? "var(--mr-bg-elevated)" : "transparent",
                          color: isCurrent ? "var(--mr-accent)" : "var(--mr-text-primary)",
                        }}
                      >
                        <span className="truncate font-medium">
                          {ch.volume ? `Vol. ${ch.volume} · ` : ""}Ch. {ch.chapterNumber}
                          {ch.title ? ` — ${ch.title}` : ""}
                        </span>
                        <span
                          className="shrink-0 font-mono text-[11px]"
                          style={{ color: "var(--mr-text-muted)" }}
                        >
                          {ch.pageCount}p · {ch.language.toUpperCase()}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <CatalogPagination
                page={chapterPickerPage}
                total={filteredPickerChapters.length}
                pageSize={PICKER_PAGE_SIZE}
                hasNext={chapterPickerPage * PICKER_PAGE_SIZE < filteredPickerChapters.length}
                onPageChange={setChapterPickerPage}
                label="Reader chapter selector pagination"
              />
            </div>
          </div>
        </div>
      ) : null}

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
