import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AddToListsModal } from "../../components/AddToListsModal";
import { CatalogPagination } from "../../components/CatalogPagination";
import { FormattedMarkdownText } from "../../components/FormattedMarkdownText";
import { MangaCard } from "../../components/MangaCard";
import { ReportModal } from "../../components/ReportModal";
import { EmptyState, ErrorState, LoadingState, NotFoundState } from "../../components/StateViews";
import { useAuth } from "../../hooks/useAuth";
import { ApiClientError, apiClient, type ChapterItem } from "../../services/apiClient";
import { compareVolumeKeys, getLocalePriority, resolveLocaleBadge } from "../../utils/localization";
import { CommentsSection } from "./CommentsSection";

const READING_STATUSES = [
  { value: "", label: "Set reading status..." },
  { value: "READING", label: "Reading" },
  { value: "PLAN_TO_READ", label: "Plan to Read" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "DROPPED", label: "Dropped" },
];

function formatRecMethodLabel(method: string, fallbackReason?: string | null): string {
  const base =
    method === "ITEM_BASED"
      ? "Recommended based on readers with similar reading habits"
      : method === "CONTENT_BASED"
        ? "Recommended by shared genres, themes, and synopsis similarity"
        : method === "POPULAR_FALLBACK"
          ? "Popular highly-rated titles in the catalog"
          : method;
  if (fallbackReason === "SPARSE_ITEM_INTERACTIONS") {
    return `${base} (Showing popular picks while reading interactions grow)`;
  }
  return base;
}

export function MangaDetailPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const [chapterLang, setChapterLang] = useState("");
  const [chapterVolume, setChapterVolume] = useState("");
  const [chapterSearch, setChapterSearch] = useState("");
  const [chapterOrder, setChapterOrder] = useState<"ASC" | "DESC">("ASC");
  const [chapterViewMode, setChapterViewMode] = useState<"VOLUME_GROUPS" | "FLAT">("VOLUME_GROUPS");
  const [collapsedVolumes, setCollapsedVolumes] = useState<Record<string, boolean>>({});
  const [chapterRangeIdx, setChapterRangeIdx] = useState<number>(-1);
  const [chapterPage, setChapterPage] = useState<number>(1);
  const [chapterPageSize, setChapterPageSize] = useState<number>(50);
  const [jumpChapterInput, setJumpChapterInput] = useState("");
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [altTitlesExpanded, setAltTitlesExpanded] = useState(false);
  const [altTitleSearch, setAltTitleSearch] = useState("");
  const [coverLocaleFilter, setCoverLocaleFilter] = useState<string>("PRIMARY");
  const [coverSortAsc, setCoverSortAsc] = useState<boolean>(true);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
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
    queryKey: [
      "manga",
      "chapters",
      slug,
      chapterLang,
      chapterVolume === "__NONE__" ? "" : chapterVolume,
      chapterOrder,
    ],
    queryFn: () =>
      apiClient.listMangaChapters(slug, {
        language: chapterLang || undefined,
        volume: chapterVolume && chapterVolume !== "__NONE__" ? chapterVolume : undefined,
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
    const map = new Map<string, Array<{ slug: string; name: string }>>();
    for (const tag of manga?.tags ?? []) {
      const grp = tag.group || "other";
      const arr = map.get(grp) ?? [];
      arr.push({ slug: tag.slug, name: tag.name });
      map.set(grp, arr);
    }
    return Array.from(map.entries());
  }, [manga?.tags]);

  const localizedAltTitles = useMemo(() => {
    const entries =
      manga?.altTitleEntries && manga.altTitleEntries.length > 0
        ? manga.altTitleEntries
        : (manga?.altTitles ?? []).map((title) => ({ title, languageCode: null }));
    return entries.map((e, idx) => ({
      id: `${idx}-${e.title}`,
      title: e.title,
      badge: resolveLocaleBadge(e.languageCode, e.title),
    }));
  }, [manga?.altTitleEntries, manga?.altTitles]);

  const filteredAltTitles = useMemo(() => {
    const norm = altTitleSearch.trim().normalize("NFC").toLowerCase();
    if (!norm) return localizedAltTitles;
    return localizedAltTitles.filter(
      (item) =>
        item.title.normalize("NFC").toLowerCase().includes(norm) ||
        item.badge.code.toLowerCase().includes(norm) ||
        item.badge.label.toLowerCase().includes(norm),
    );
  }, [localizedAltTitles, altTitleSearch]);

  const allCovers = useMemo(() => {
    const arts = (manga?.coverArts ?? []).filter((c) => Boolean(c.url));
    if (arts.length > 0) return arts;
    if (manga?.coverUrl) {
      return [
        {
          coverId: "primary",
          volume: null,
          locale: manga.originalLanguage || null,
          description: "Primary Cover",
          url: manga.coverUrl,
        },
      ];
    }
    return [];
  }, [manga?.coverArts, manga?.coverUrl, manga?.originalLanguage]);

  const coverLocaleTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of allCovers) {
      const loc = (c.locale || manga?.originalLanguage || "").trim().toLowerCase();
      counts.set(loc, (counts.get(loc) ?? 0) + 1);
    }
    const locales = Array.from(counts.keys()).sort((a, b) => {
      const pa = getLocalePriority(a, manga?.originalLanguage);
      const pb = getLocalePriority(b, manga?.originalLanguage);
      return pa !== pb ? pa - pb : a.localeCompare(b);
    });
    const tabs: Array<{ key: string; label: string; flag: string; count: number }> = [];
    if (locales.length > 1) {
      tabs.push({
        key: "PRIMARY",
        label: "Primary (1/Vol)",
        flag: "⭐",
        count: allCovers.length,
      });
    }
    tabs.push({
      key: "ALL",
      label: `All Locales`,
      flag: "🖼️",
      count: allCovers.length,
    });
    for (const loc of locales) {
      const info = resolveLocaleBadge(loc || null);
      tabs.push({
        key: `LOC:${loc}`,
        label: loc ? `${info.label} (${info.code})` : "Unspecified",
        flag: info.flag,
        count: counts.get(loc) ?? 0,
      });
    }
    return tabs;
  }, [allCovers, manga?.originalLanguage]);

  useEffect(() => {
    if (!coverLocaleTabs.some((t) => t.key === coverLocaleFilter)) {
      setCoverLocaleFilter(coverLocaleTabs[0]?.key ?? "ALL");
    }
  }, [coverLocaleTabs, coverLocaleFilter]);

  const visibleCovers = useMemo(() => {
    let list = [...allCovers];
    if (coverLocaleFilter.startsWith("LOC:")) {
      const targetLoc = coverLocaleFilter.slice(4);
      list = list.filter(
        (c) => (c.locale || manga?.originalLanguage || "").trim().toLowerCase() === targetLoc,
      );
    }
    const orig = manga?.originalLanguage || "";
    list.sort((a, b) => {
      const vc = compareVolumeKeys(a.volume, b.volume, coverSortAsc);
      if (vc !== 0) return vc;
      const la = (a.locale || orig).trim().toLowerCase();
      const lb = (b.locale || orig).trim().toLowerCase();
      const lp = getLocalePriority(la, orig) - getLocalePriority(lb, orig);
      if (lp !== 0) return lp;
      return (a.coverId || "").localeCompare(b.coverId || "");
    });
    if (coverLocaleFilter === "PRIMARY") {
      const deduped: typeof list = [];
      const winningLocaleByVol = new Map<string, string>();
      for (const c of list) {
        const volKey = (c.volume || "").trim().toLowerCase();
        if (!volKey) {
          deduped.push(c);
          continue;
        }
        const locKey = (c.locale || orig).trim().toLowerCase();
        const winner = winningLocaleByVol.get(volKey);
        if (winner === undefined) {
          winningLocaleByVol.set(volKey, locKey);
          deduped.push(c);
        } else if (winner === locKey) {
          deduped.push(c);
        }
      }
      list = deduped;
    }
    return list;
  }, [allCovers, coverLocaleFilter, coverSortAsc, manga?.originalLanguage]);

  const { distinctVolumes, hasNoVolumeChapters } = useMemo(() => {
    const vols = new Set<string>();
    let noVol = false;
    for (const ch of chaptersQuery.data?.data ?? []) {
      const v = (ch.volume || "").trim();
      if (v) vols.add(v);
      else noVol = true;
    }
    return {
      distinctVolumes: Array.from(vols).sort((a, b) => compareVolumeKeys(a, b, true)),
      hasNoVolumeChapters: noVol,
    };
  }, [chaptersQuery.data]);

  const filteredChapters = useMemo(() => {
    const list = chaptersQuery.data?.data ?? [];
    const q = chapterSearch.trim().normalize("NFC").toLowerCase();
    return list.filter((ch) => {
      if (chapterVolume === "__NONE__" && (ch.volume || "").trim() !== "") return false;
      if (
        q &&
        !ch.chapterNumber.toLowerCase().includes(q) &&
        !ch.title.normalize("NFC").toLowerCase().includes(q) &&
        !(ch.scanlationGroup ?? "").normalize("NFC").toLowerCase().includes(q) &&
        !(ch.volume ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [chaptersQuery.data, chapterSearch, chapterVolume]);

  const volumeGroups = useMemo(() => {
    const buckets = new Map<string, ChapterItem[]>();
    for (const ch of filteredChapters) {
      const volKey = (ch.volume || "").trim() || "__NONE__";
      const arr = buckets.get(volKey) ?? [];
      arr.push(ch);
      buckets.set(volKey, arr);
    }
    const keys = Array.from(buckets.keys()).sort((a, b) => {
      if (a === "__NONE__") return 1;
      if (b === "__NONE__") return -1;
      return compareVolumeKeys(a, b, chapterOrder === "ASC");
    });
    return keys.map((key) => {
      const items = buckets.get(key) ?? [];
      return {
        key,
        isNoVolume: key === "__NONE__",
        label: key === "__NONE__" ? "Unassigned · No Volume" : `Volume ${key}`,
        chapters: items,
      };
    });
  }, [filteredChapters, chapterOrder]);

  const CHAPTER_GROUP_SIZE = 50;
  const chapterRangeGroups = useMemo(() => {
    if (filteredChapters.length <= CHAPTER_GROUP_SIZE) return [];
    const groups: Array<{ index: number; label: string; start: number; end: number }> = [];
    for (let i = 0; i < filteredChapters.length; i += CHAPTER_GROUP_SIZE) {
      const slice = filteredChapters.slice(i, i + CHAPTER_GROUP_SIZE);
      const firstCh = slice[0]?.chapterNumber ?? String(i + 1);
      const lastCh = slice[slice.length - 1]?.chapterNumber ?? String(i + slice.length);
      groups.push({
        index: groups.length,
        label: `Ch. ${firstCh}–${lastCh}`,
        start: i,
        end: i + CHAPTER_GROUP_SIZE,
      });
    }
    return groups;
  }, [filteredChapters]);

  const rangeScopedChapters = useMemo(() => {
    if (
      chapterRangeIndexValid(chapterRangeIdx, chapterRangeGroups.length) &&
      chapterRangeGroups[chapterRangeIdx]
    ) {
      const grp = chapterRangeGroups[chapterRangeIdx];
      return filteredChapters.slice(grp.start, grp.end);
    }
    return filteredChapters;
  }, [filteredChapters, chapterRangeGroups, chapterRangeIdx]);

  function chapterRangeIndexValid(idx: number, totalGroups: number): boolean {
    return idx >= 0 && idx < totalGroups;
  }

  useEffect(() => {
    setChapterRangeIdx(-1);
    setChapterPage(1);
  }, [slug, chapterLang, chapterVolume, chapterOrder, chapterSearch]);

  useEffect(() => {
    setChapterPage(1);
  }, [chapterRangeIdx, chapterPageSize]);

  const pagedChapters = useMemo(() => {
    const start = (chapterPage - 1) * chapterPageSize;
    return rangeScopedChapters.slice(start, start + chapterPageSize);
  }, [rangeScopedChapters, chapterPage, chapterPageSize]);

  function handleJumpToChapter(e: FormEvent) {
    e.preventDefault();
    const target = jumpChapterInput.trim().toLowerCase();
    if (!target || !manga) return;
    const match = filteredChapters.find(
      (ch) =>
        ch.chapterNumber.toLowerCase() === target ||
        ch.chapterNumber.toLowerCase().startsWith(target),
    );
    if (match) {
      navigate(`/manga/${manga.slug}/chapter/${match.chapterId}`);
    }
  }

  const validExternalLinks = useMemo(
    () => (manga?.links ?? []).filter((lnk) => /^https?:\/\//i.test(lnk.url)),
    [manga?.links],
  );

  useEffect(() => {
    setCollapsedVolumes({});
  }, [slug, chapterLang, chapterVolume, chapterOrder, chapterSearch]);

  if (detailQuery.isLoading) {
    return <LoadingState variant="detail" label="Loading manga details..." />;
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
        className="grid gap-6 rounded-[var(--mr-radius-lg)] border p-6 md:grid-cols-[240px_1fr]"
        style={{
          backgroundColor: "var(--mr-bg-surface)",
          borderColor: "var(--mr-border-subtle)",
        }}
      >
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              if (visibleCovers.length > 0) setLightboxIdx(0);
            }}
            className="group relative block aspect-[3/4] w-full cursor-pointer overflow-hidden rounded-[var(--mr-radius-md)] border"
            style={{ borderColor: "var(--mr-border-subtle)" }}
            title="Click to inspect cover art"
          >
            {manga.coverUrl ? (
              <img
                src={manga.coverUrl}
                alt={manga.title}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center text-xs"
                style={{ backgroundColor: "var(--mr-bg-elevated)", color: "var(--mr-text-muted)" }}
              >
                No Cover
              </div>
            )}
            {allCovers.length > 0 ? (
              <span
                className="absolute right-2 bottom-2 rounded px-2 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: "rgba(15, 17, 23, 0.85)", color: "#ffffff" }}
              >
                🖼️ {allCovers.length} cover{allCovers.length > 1 ? "s" : ""}
              </span>
            ) : null}
          </button>

          <div
            className="grid grid-cols-2 gap-2 rounded-[var(--mr-radius-sm)] border p-2.5 text-center text-xs"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <div>
              <p className="font-bold" style={{ color: "var(--mr-warning)" }}>
                {manga.ratingCount > 0 ? `★ ${manga.averageRating.toFixed(2)}` : "No ratings"}
              </p>
              <p style={{ color: "var(--mr-text-muted)" }}>
                {manga.ratingCount > 0 ? `${manga.ratingCount} ratings` : "Chưa có đánh giá"}
              </p>
            </div>
            <div>
              <p className="font-bold" style={{ color: "var(--mr-text-primary)" }}>
                {manga.totalViews.toLocaleString()}
              </p>
              <p style={{ color: "var(--mr-text-muted)" }}>valid views</p>
            </div>
          </div>

          {localizedAltTitles.length > 0 ? (
            <div
              className="space-y-2 rounded-[var(--mr-radius-md)] border p-3 text-xs"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-[11px] font-bold tracking-wider uppercase"
                  style={{ color: "var(--mr-text-muted)" }}
                >
                  Also Known As ({localizedAltTitles.length})
                </span>
                {localizedAltTitles.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setAltTitlesExpanded((prev) => !prev)}
                    className="cursor-pointer text-[11px] font-semibold underline"
                    style={{ color: "var(--mr-accent)" }}
                  >
                    {altTitlesExpanded ? "Collapse" : "View all"}
                  </button>
                ) : null}
              </div>

              {altTitlesExpanded && localizedAltTitles.length > 6 ? (
                <input
                  type="search"
                  aria-label="Filter localized titles"
                  value={altTitleSearch}
                  onChange={(e) => setAltTitleSearch(e.target.value)}
                  placeholder="Filter language or title..."
                  className="w-full rounded border px-2 py-1 text-[11px]"
                  style={{
                    backgroundColor: "var(--mr-bg-surface)",
                    borderColor: "var(--mr-border-strong)",
                    color: "var(--mr-text-primary)",
                  }}
                />
              ) : null}

              <ul className="space-y-1.5">
                {(altTitlesExpanded ? filteredAltTitles : localizedAltTitles.slice(0, 5)).map(
                  (entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start gap-1.5 rounded border px-2 py-1"
                      style={{
                        backgroundColor: entry.badge.bg,
                        borderColor: entry.badge.border,
                      }}
                    >
                      <span
                        className="shrink-0 font-mono text-[10px] font-bold"
                        style={{ color: entry.badge.color }}
                        title={entry.badge.label}
                      >
                        {entry.badge.flag} {entry.badge.code}
                      </span>
                      <span
                        className="min-w-0 flex-1 break-words text-[11px] leading-snug"
                        style={{ color: "var(--mr-text-primary)" }}
                      >
                        {entry.title}
                      </span>
                    </li>
                  ),
                )}
              </ul>

              {!altTitlesExpanded && localizedAltTitles.length > 5 ? (
                <button
                  type="button"
                  onClick={() => setAltTitlesExpanded(true)}
                  className="w-full cursor-pointer rounded border py-1 text-center text-[11px] font-medium"
                  style={{
                    backgroundColor: "var(--mr-bg-surface)",
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-accent)",
                  }}
                >
                  +{localizedAltTitles.length - 5} more localized titles
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="min-w-0">
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
                {manga.contentRating === "unknown" ? "Unclassified" : manga.contentRating}
              </span>
              {manga.publicationDemographic && manga.publicationDemographic !== "unknown" ? (
                <span
                  className="rounded px-2 py-0.5"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    color: "var(--mr-text-secondary)",
                  }}
                >
                  {manga.publicationDemographic}
                </span>
              ) : null}
              {manga.originalLanguage ? (
                <span
                  className="rounded px-2 py-0.5"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    color: "var(--mr-text-secondary)",
                  }}
                >
                  {resolveLocaleBadge(manga.originalLanguage).flag}{" "}
                  {manga.originalLanguage.toUpperCase()}
                </span>
              ) : null}
              {manga.year ? (
                <span style={{ color: "var(--mr-text-muted)" }}>{manga.year}</span>
              ) : null}
            </div>

            <h1
              className="mt-2 break-words [overflow-wrap:anywhere] text-2xl font-bold"
              style={{ color: "var(--mr-text-primary)" }}
            >
              {manga.title}
            </h1>
            {localizedAltTitles.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                {localizedAltTitles.slice(0, 3).map((entry) => (
                  <span
                    key={`top-${entry.id}`}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                    style={{
                      backgroundColor: entry.badge.bg,
                      borderColor: entry.badge.border,
                      color: entry.badge.color,
                    }}
                  >
                    <span className="shrink-0">{entry.badge.flag}</span>
                    <span className="shrink-0 font-semibold">{entry.badge.code}</span>
                    <span className="min-w-0 truncate" style={{ color: "var(--mr-text-primary)" }}>
                      {entry.title}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {(() => {
            const authors = manga.creators.filter(
              (c) => c.roles.some((r) => r.toLowerCase() === "author") || c.roles.length === 0,
            );
            const artists = manga.creators.filter((c) =>
              c.roles.some((r) => r.toLowerCase() === "artist"),
            );
            return (
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div
                  className="rounded-[var(--mr-radius-sm)] border p-2.5 text-xs"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                  }}
                >
                  <p
                    className="mb-1.5 text-[10px] font-bold tracking-wider uppercase"
                    style={{ color: "var(--mr-text-muted)" }}
                  >
                    Authors (Story)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {authors.length > 0 ? (
                      authors.map((c) => (
                        <Link
                          key={`author-${c.creatorId}`}
                          to={`/author/${c.creatorId}/${c.slug}`}
                          className="max-w-full break-words rounded border px-2 py-0.5 font-medium hover:underline"
                          style={{
                            backgroundColor: "var(--mr-bg-surface)",
                            borderColor: "var(--mr-border-strong)",
                            color: "var(--mr-accent)",
                          }}
                        >
                          {c.name}
                        </Link>
                      ))
                    ) : (
                      <span style={{ color: "var(--mr-text-muted)" }}>Not specified</span>
                    )}
                  </div>
                </div>

                <div
                  className="rounded-[var(--mr-radius-sm)] border p-2.5 text-xs"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                  }}
                >
                  <p
                    className="mb-1.5 text-[10px] font-bold tracking-wider uppercase"
                    style={{ color: "var(--mr-text-muted)" }}
                  >
                    Artists (Illustration)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {artists.length > 0 ? (
                      artists.map((c) => (
                        <Link
                          key={`artist-${c.creatorId}`}
                          to={`/author/${c.creatorId}/${c.slug}`}
                          className="max-w-full break-words rounded border px-2 py-0.5 font-medium hover:underline"
                          style={{
                            backgroundColor: "var(--mr-bg-surface)",
                            borderColor: "var(--mr-border-strong)",
                            color: "var(--mr-accent)",
                          }}
                        >
                          {c.name}
                        </Link>
                      ))
                    ) : (
                      <span style={{ color: "var(--mr-text-muted)" }}>Not specified</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="space-y-1.5">
            <FormattedMarkdownText
              content={manga.description || "No description provided."}
              clampLines={
                !synopsisExpanded && (manga.description?.length ?? 0) > 320 ? 5 : undefined
              }
            />
            {(manga.description?.length ?? 0) > 320 ? (
              <button
                type="button"
                onClick={() => setSynopsisExpanded((prev) => !prev)}
                className="cursor-pointer text-xs font-medium underline"
                style={{ color: "var(--mr-accent)" }}
              >
                {synopsisExpanded ? "Show less" : "Show full synopsis"}
              </button>
            ) : null}
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {hasChapters ? (
              <>
                {viewer?.progress ? (
                  <Link
                    to={`/manga/${manga.slug}/chapter/${viewer.progress.chapterId}`}
                    className="rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-semibold text-white"
                    style={{ backgroundColor: "var(--mr-accent)" }}
                  >
                    Continue Reading (Page {viewer.progress.pageNumber})
                  </Link>
                ) : null}
                <Link
                  to={`/manga/${manga.slug}/read?action=START`}
                  className={
                    viewer?.progress
                      ? "rounded-[var(--mr-radius-sm)] border px-4 py-2 text-sm font-medium"
                      : "rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-semibold text-white"
                  }
                  style={
                    viewer?.progress
                      ? {
                          borderColor: "var(--mr-border-strong)",
                          color: "var(--mr-text-primary)",
                        }
                      : { backgroundColor: "var(--mr-accent)" }
                  }
                >
                  {viewer?.progress ? "Read from Beginning" : "Start Reading"}
                </Link>
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
            {groupedTags.map(([grp, tagList]) => (
              <div key={grp} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span
                  className="w-16 shrink-0 text-[10px] font-semibold uppercase"
                  style={{ color: "var(--mr-text-muted)" }}
                >
                  {grp}
                </span>
                {tagList.map((tag) => (
                  <Link
                    key={tag.slug}
                    to={`/explore?includeTags=${encodeURIComponent(tag.slug)}`}
                    className="rounded px-2 py-0.5 text-[11px] hover:underline"
                    style={{
                      backgroundColor: "var(--mr-bg-elevated)",
                      color: "var(--mr-text-secondary)",
                    }}
                  >
                    {tag.name}
                  </Link>
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
              <span>Available Chapter Languages: {manga.stats.languages.join(", ") || "N/A"}</span>
            </div>
            {validExternalLinks.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span style={{ color: "var(--mr-text-muted)" }}>External Links:</span>
                {validExternalLinks.map((lnk) => (
                  <a
                    key={`${lnk.site}-${lnk.url}`}
                    href={lnk.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border px-2 py-0.5 text-[11px] font-medium hover:underline"
                    style={{
                      borderColor: "var(--mr-border-strong)",
                      color: "var(--mr-accent)",
                    }}
                  >
                    {lnk.site} ↗
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Cover Art Gallery Grouped & Filtered by Locale */}
      {allCovers.length > 0 ? (
        <section
          aria-label="Cover art gallery"
          className="space-y-3 rounded-[var(--mr-radius-lg)] border p-5"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-subtle)",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
                Cover Art Gallery ({visibleCovers.length})
              </h2>
              <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                Filter official volume covers by release locale or inspect full-size artwork.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCoverSortAsc((prev) => !prev)}
              className="cursor-pointer rounded border px-2.5 py-1 text-xs font-medium"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              {coverSortAsc ? "Volume Asc ↑" : "Volume Desc ↓"}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 text-xs">
            {coverLocaleTabs.map((tabItem) => {
              const active = coverLocaleFilter === tabItem.key;
              return (
                <button
                  key={tabItem.key}
                  type="button"
                  onClick={() => setCoverLocaleFilter(tabItem.key)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1 font-medium"
                  style={{
                    backgroundColor: active ? "var(--mr-accent)" : "var(--mr-bg-elevated)",
                    borderColor: active ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                    color: active ? "#ffffff" : "var(--mr-text-secondary)",
                  }}
                >
                  <span>{tabItem.flag}</span>
                  <span>{tabItem.label}</span>
                  <span className="font-mono text-[10px] opacity-80">({tabItem.count})</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {visibleCovers.map((cover, idx) => {
              const locInfo = resolveLocaleBadge(cover.locale || manga.originalLanguage);
              return (
                <button
                  key={`${cover.coverId ?? idx}-${cover.volume ?? "x"}-${cover.locale ?? "loc"}`}
                  type="button"
                  onClick={() => setLightboxIdx(idx)}
                  className="group flex cursor-pointer flex-col overflow-hidden rounded-[var(--mr-radius-md)] border text-left transition hover:border-[var(--mr-accent)]"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                  }}
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden">
                    <img
                      src={cover.url!}
                      alt={`${manga.title} ${cover.volume ? `Vol. ${cover.volume}` : "Cover"}`}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <span
                      className="absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold"
                      style={{ backgroundColor: "rgba(15, 17, 23, 0.85)", color: "#ffffff" }}
                    >
                      {cover.volume ? `Vol. ${cover.volume}` : "Special"}
                    </span>
                    <span
                      className="absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{
                        backgroundColor: "rgba(15, 17, 23, 0.85)",
                        color: locInfo.color,
                      }}
                    >
                      {locInfo.flag} {locInfo.code}
                    </span>
                  </div>
                  {cover.description ? (
                    <p
                      className="line-clamp-1 px-2 py-1.5 text-[11px]"
                      style={{ color: "var(--mr-text-muted)" }}
                    >
                      {cover.description}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Chapter List */}
      <section id="chapters" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
            Chapters ({filteredChapters.length.toLocaleString()})
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div
              role="group"
              aria-label="Chapter grouping mode"
              className="flex overflow-hidden rounded border"
              style={{ borderColor: "var(--mr-border-strong)" }}
            >
              <button
                type="button"
                aria-pressed={chapterViewMode === "VOLUME_GROUPS"}
                onClick={() => setChapterViewMode("VOLUME_GROUPS")}
                className="cursor-pointer px-2.5 py-1 font-medium"
                style={{
                  backgroundColor:
                    chapterViewMode === "VOLUME_GROUPS"
                      ? "var(--mr-bg-elevated)"
                      : "var(--mr-bg-surface)",
                  color:
                    chapterViewMode === "VOLUME_GROUPS"
                      ? "var(--mr-accent)"
                      : "var(--mr-text-secondary)",
                }}
              >
                Group by Volume
              </button>
              <button
                type="button"
                aria-pressed={chapterViewMode === "FLAT"}
                onClick={() => setChapterViewMode("FLAT")}
                className="cursor-pointer px-2.5 py-1 font-medium"
                style={{
                  backgroundColor:
                    chapterViewMode === "FLAT" ? "var(--mr-bg-elevated)" : "var(--mr-bg-surface)",
                  color:
                    chapterViewMode === "FLAT" ? "var(--mr-accent)" : "var(--mr-text-secondary)",
                }}
              >
                Flat List
              </button>
            </div>
            <input
              type="search"
              aria-label="Search chapters"
              value={chapterSearch}
              onChange={(e) => setChapterSearch(e.target.value)}
              placeholder="Search ch., vol., or group..."
              className="w-40 rounded border px-2.5 py-1"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            />
            {filteredChapters.length > 0 ? (
              <form onSubmit={handleJumpToChapter} className="flex items-center gap-1">
                <input
                  type="text"
                  aria-label="Jump to chapter number"
                  value={jumpChapterInput}
                  onChange={(e) => setJumpChapterInput(e.target.value)}
                  placeholder="Jump to Ch. #"
                  className="w-24 rounded border px-2 py-1 font-mono text-xs"
                  style={{
                    backgroundColor: "var(--mr-bg-surface)",
                    borderColor: "var(--mr-border-strong)",
                    color: "var(--mr-text-primary)",
                  }}
                />
                <button
                  type="submit"
                  className="cursor-pointer rounded border px-2 py-1 font-medium"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-strong)",
                    color: "var(--mr-accent)",
                  }}
                >
                  Open
                </button>
              </form>
            ) : null}
            {distinctVolumes.length > 0 || hasNoVolumeChapters ? (
              <select
                aria-label="Filter chapter volume"
                value={chapterVolume}
                onChange={(e) => setChapterVolume(e.target.value)}
                className="rounded border px-2.5 py-1"
                style={{
                  backgroundColor: "var(--mr-bg-surface)",
                  borderColor: "var(--mr-border-strong)",
                  color: "var(--mr-text-primary)",
                }}
              >
                <option value="">All Volumes</option>
                {distinctVolumes.map((vol) => (
                  <option key={vol} value={vol}>
                    Vol. {vol}
                  </option>
                ))}
                {hasNoVolumeChapters ? (
                  <option value="__NONE__">No Volume (Unassigned)</option>
                ) : null}
              </select>
            ) : null}
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
            <select
              aria-label="Chapters per page"
              value={chapterPageSize}
              onChange={(e) => setChapterPageSize(Number(e.target.value))}
              className="rounded border px-2 py-1"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
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
              Order: {chapterOrder === "ASC" ? "Oldest First (ASC)" : "Newest First (DESC)"}
            </button>
          </div>
        </div>

        {/* Chapter Range Tabs when manga has > 50 chapters in Flat List mode */}
        {chapterViewMode === "FLAT" && chapterRangeGroups.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
              Chapter ranges:
            </span>
            <button
              type="button"
              onClick={() => setChapterRangeIdx(-1)}
              className="cursor-pointer rounded border px-2.5 py-1 font-medium"
              style={{
                backgroundColor:
                  chapterRangeIdx === -1 ? "var(--mr-accent)" : "var(--mr-bg-surface)",
                borderColor:
                  chapterRangeIdx === -1 ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                color: chapterRangeIdx === -1 ? "#ffffff" : "var(--mr-text-secondary)",
              }}
            >
              All ({filteredChapters.length})
            </button>
            {chapterRangeGroups.map((grp) => (
              <button
                key={grp.index}
                type="button"
                onClick={() => setChapterRangeIdx(grp.index)}
                className="cursor-pointer rounded border px-2.5 py-1 font-mono text-[11px] font-medium"
                style={{
                  backgroundColor:
                    chapterRangeIdx === grp.index ? "var(--mr-accent)" : "var(--mr-bg-surface)",
                  borderColor:
                    chapterRangeIdx === grp.index ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                  color: chapterRangeIdx === grp.index ? "#ffffff" : "var(--mr-text-secondary)",
                }}
              >
                {grp.label}
              </button>
            ))}
          </div>
        ) : null}

        {chaptersQuery.isLoading ? (
          <LoadingState variant="table" count={8} label="Loading chapter list..." />
        ) : filteredChapters.length === 0 ? (
          <EmptyState
            title="No chapters available"
            description="This title currently has no readable chapters matching your filter."
          />
        ) : chapterViewMode === "VOLUME_GROUPS" ? (
          <div className="space-y-3">
            {volumeGroups.length > 1 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span style={{ color: "var(--mr-text-muted)" }}>
                  Grouped into {volumeGroups.length} section(s){" "}
                  {hasNoVolumeChapters ? "(No Volume chapters separated cleanly)" : ""}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCollapsedVolumes({})}
                    className="cursor-pointer rounded border px-2.5 py-1 font-medium"
                    style={{
                      borderColor: "var(--mr-border-strong)",
                      color: "var(--mr-accent)",
                    }}
                  >
                    Expand All Volumes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const allCollapsed: Record<string, boolean> = {};
                      for (const g of volumeGroups) allCollapsed[g.key] = true;
                      setCollapsedVolumes(allCollapsed);
                    }}
                    className="cursor-pointer rounded border px-2.5 py-1 font-medium"
                    style={{
                      borderColor: "var(--mr-border-strong)",
                      color: "var(--mr-text-secondary)",
                    }}
                  >
                    Collapse All
                  </button>
                </div>
              </div>
            ) : null}

            {volumeGroups.map((grp) => {
              const isCollapsed = Boolean(collapsedVolumes[grp.key]);
              const firstCh = grp.chapters[0]?.chapterNumber ?? "";
              const lastCh = grp.chapters[grp.chapters.length - 1]?.chapterNumber ?? "";
              return (
                <div
                  key={grp.key}
                  className="overflow-hidden rounded-[var(--mr-radius-md)] border"
                  style={{
                    backgroundColor: "var(--mr-bg-surface)",
                    borderColor: grp.isNoVolume
                      ? "var(--mr-border-strong)"
                      : "var(--mr-border-subtle)",
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsedVolumes((prev) => ({
                        ...prev,
                        [grp.key]: !prev[grp.key],
                      }))
                    }
                    className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-xs font-semibold transition hover:opacity-90"
                    style={{
                      backgroundColor: "var(--mr-bg-elevated)",
                      color: "var(--mr-text-primary)",
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span style={{ color: "var(--mr-accent)" }}>{isCollapsed ? "▸" : "▾"}</span>
                      <span>{grp.label}</span>
                      <span
                        className="rounded px-2 py-0.5 font-mono text-[10px]"
                        style={{
                          backgroundColor: "var(--mr-bg-surface)",
                          color: "var(--mr-text-secondary)",
                        }}
                      >
                        {grp.chapters.length} ch.
                      </span>
                      {firstCh ? (
                        <span className="font-normal" style={{ color: "var(--mr-text-muted)" }}>
                          {firstCh === lastCh ? `Ch. ${firstCh}` : `Ch. ${firstCh} – ${lastCh}`}
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                      {isCollapsed ? "Click to expand" : "Click to collapse"}
                    </span>
                  </button>

                  {!isCollapsed ? (
                    <ul className="divide-y" style={{ borderColor: "var(--mr-border-subtle)" }}>
                      {grp.chapters.map((ch) => {
                        const isCurrentProgress = viewer?.progress?.chapterId === ch.chapterId;
                        return (
                          <li
                            key={ch.chapterId}
                            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                            style={{
                              borderColor: "var(--mr-border-subtle)",
                              backgroundColor: isCurrentProgress
                                ? "var(--mr-bg-elevated)"
                                : "transparent",
                            }}
                          >
                            <Link
                              to={`/manga/${manga.slug}/chapter/${ch.chapterId}`}
                              className="flex min-w-0 flex-1 flex-wrap items-center gap-2 break-words font-medium hover:underline"
                              style={{ color: "var(--mr-text-primary)" }}
                            >
                              <span
                                className="shrink-0 rounded px-1.5 py-0.5 font-mono text-xs"
                                style={{
                                  backgroundColor: "var(--mr-bg-elevated)",
                                  color: "var(--mr-accent)",
                                }}
                              >
                                Ch. {ch.chapterNumber}
                              </span>
                              <span className="min-w-0 break-words">
                                {ch.title || `Chapter ${ch.chapterNumber}`}
                              </span>
                              {isCurrentProgress ? (
                                <span
                                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                  style={{
                                    backgroundColor: "rgba(52, 211, 153, 0.15)",
                                    color: "var(--mr-success)",
                                  }}
                                >
                                  Resume Page {viewer?.progress?.pageNumber}
                                </span>
                              ) : null}
                            </Link>
                            <div
                              className="flex flex-wrap items-center gap-3 text-xs"
                              style={{ color: "var(--mr-text-muted)" }}
                            >
                              <span className="uppercase">{ch.language}</span>
                              <span>{ch.pageCount} pages</span>
                              {ch.scanlationGroup ? <span>{ch.scanlationGroup}</span> : null}
                              {ch.publishAt ? (
                                <span>{new Date(ch.publishAt).toLocaleDateString()}</span>
                              ) : null}
                              <span>{ch.viewCount} views</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <ul
              className="divide-y rounded-[var(--mr-radius-md)] border"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              {pagedChapters.map((ch) => {
                const isCurrentProgress = viewer?.progress?.chapterId === ch.chapterId;
                return (
                  <li
                    key={ch.chapterId}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                    style={{
                      borderColor: "var(--mr-border-subtle)",
                      backgroundColor: isCurrentProgress ? "var(--mr-bg-elevated)" : "transparent",
                    }}
                  >
                    <Link
                      to={`/manga/${manga.slug}/chapter/${ch.chapterId}`}
                      className="flex flex-wrap items-center gap-2 font-medium hover:underline"
                      style={{ color: "var(--mr-text-primary)" }}
                    >
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-xs"
                        style={{
                          backgroundColor: "var(--mr-bg-elevated)",
                          color: "var(--mr-accent)",
                        }}
                      >
                        Ch. {ch.chapterNumber}
                      </span>
                      {ch.volume ? (
                        <span className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                          Vol. {ch.volume}
                        </span>
                      ) : (
                        <span className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                          No Vol.
                        </span>
                      )}
                      <span>{ch.title || `Chapter ${ch.chapterNumber}`}</span>
                      {isCurrentProgress ? (
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            backgroundColor: "rgba(52, 211, 153, 0.15)",
                            color: "var(--mr-success)",
                          }}
                        >
                          Resume Page {viewer?.progress?.pageNumber}
                        </span>
                      ) : null}
                    </Link>
                    <div
                      className="flex flex-wrap items-center gap-3 text-xs"
                      style={{ color: "var(--mr-text-muted)" }}
                    >
                      <span className="uppercase">{ch.language}</span>
                      <span>{ch.pageCount} pages</span>
                      {ch.scanlationGroup ? <span>{ch.scanlationGroup}</span> : null}
                      {ch.publishAt ? (
                        <span>{new Date(ch.publishAt).toLocaleDateString()}</span>
                      ) : null}
                      <span>{ch.viewCount} views</span>
                    </div>
                  </li>
                );
              })}
            </ul>

            <CatalogPagination
              page={chapterPage}
              total={rangeScopedChapters.length}
              pageSize={chapterPageSize}
              hasNext={chapterPage * chapterPageSize < rangeScopedChapters.length}
              onPageChange={setChapterPage}
              label="Chapter list pagination"
            />
          </>
        )}
      </section>

      {/* Recommendations: Item-Based & Content-Based */}
      {(itemRecsQuery.data?.data?.items?.length ?? 0) > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
              Readers Also Liked
            </h2>
            <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
              {formatRecMethodLabel(
                itemRecsQuery.data!.data.method,
                itemRecsQuery.data!.data.fallbackReason,
              )}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
            {itemRecsQuery.data!.data.items.map((item) => (
              <MangaCard key={item.mangaId} manga={item} />
            ))}
          </div>
        </section>
      ) : null}

      {(contentRecsQuery.data?.data?.items?.length ?? 0) > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold" style={{ color: "var(--mr-text-primary)" }}>
              Similar Content &amp; Themes
            </h2>
            <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
              {formatRecMethodLabel(
                contentRecsQuery.data!.data.method,
                contentRecsQuery.data!.data.fallbackReason,
              )}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
            {contentRecsQuery.data!.data.items.map((item) => (
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

      {lightboxIdx !== null && visibleCovers[lightboxIdx] ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cover artwork lightbox"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightboxIdx(null);
          }}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-xl flex-col gap-3 rounded-[var(--mr-radius-lg)] border p-4 shadow-2xl"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
            }}
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold" style={{ color: "var(--mr-text-primary)" }}>
                  {visibleCovers[lightboxIdx].volume
                    ? `Volume ${visibleCovers[lightboxIdx].volume}`
                    : "Cover Artwork"}
                </span>
                {(() => {
                  const info = resolveLocaleBadge(
                    visibleCovers[lightboxIdx].locale || manga.originalLanguage,
                  );
                  return (
                    <span
                      className="rounded px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: info.bg, color: info.color }}
                    >
                      {info.flag} {info.label} ({info.code})
                    </span>
                  );
                })()}
              </div>
              <button
                type="button"
                onClick={() => setLightboxIdx(null)}
                className="cursor-pointer rounded border px-2.5 py-1 font-medium"
                style={{ borderColor: "var(--mr-border-strong)" }}
              >
                Close ✕
              </button>
            </div>
            <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded">
              <img
                src={visibleCovers[lightboxIdx].url!}
                alt={manga.title}
                className="max-h-[68vh] w-auto rounded object-contain"
              />
            </div>
            {visibleCovers[lightboxIdx].description ? (
              <p className="text-center text-xs" style={{ color: "var(--mr-text-secondary)" }}>
                {visibleCovers[lightboxIdx].description}
              </p>
            ) : null}
            {visibleCovers.length > 1 ? (
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() =>
                    setLightboxIdx((lightboxIdx - 1 + visibleCovers.length) % visibleCovers.length)
                  }
                  className="cursor-pointer rounded border px-3 py-1 font-medium"
                  style={{ borderColor: "var(--mr-border-strong)" }}
                >
                  ← Previous Cover
                </button>
                <span className="font-mono" style={{ color: "var(--mr-text-muted)" }}>
                  {lightboxIdx + 1} / {visibleCovers.length}
                </span>
                <button
                  type="button"
                  onClick={() => setLightboxIdx((lightboxIdx + 1) % visibleCovers.length)}
                  className="cursor-pointer rounded border px-3 py-1 font-medium"
                  style={{ borderColor: "var(--mr-border-strong)" }}
                >
                  Next Cover →
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
