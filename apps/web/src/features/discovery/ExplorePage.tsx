import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { CatalogPagination } from "../../components/CatalogPagination";
import { MangaCard } from "../../components/MangaCard";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { useAuth } from "../../hooks/useAuth";
import { apiClient, type CreatorSearchItem, type TagItem } from "../../services/apiClient";

export { CatalogPagination };

const SORTS = [
  { value: "UPDATED_DESC", label: "Latest Updated" },
  { value: "VIEWS_DESC", label: "Most Viewed" },
  { value: "RATING_DESC", label: "Highest Rated" },
  { value: "TITLE_ASC", label: "Title (A–Z)" },
  { value: "TITLE_DESC", label: "Title (Z–A)" },
  { value: "CREATED_DESC", label: "Newest Added to Catalog" },
  { value: "CHAPTERS_DESC", label: "Most Exported Chapters" },
  { value: "YEAR_DESC", label: "Publication Year (Newest)" },
  { value: "YEAR_ASC", label: "Publication Year (Oldest)" },
  { value: "RELEVANCE", label: "Relevance (Text Search)" },
];

const DEMOGRAPHICS = ["shounen", "shoujo", "seinen", "josei", "kodomo", "unknown"];
const PUB_STATUSES = ["ongoing", "completed", "hiatus", "cancelled", "unknown"];
const CONTENT_RATINGS = ["safe", "suggestive", "erotica", "pornographic", "unknown"];
const ORIGINAL_LANG_OPTIONS = [
  { code: "ja", label: "Japanese (ja)" },
  { code: "ko", label: "Korean (ko)" },
  { code: "zh", label: "Chinese (zh)" },
  { code: "en", label: "English (en)" },
  { code: "vi", label: "Vietnamese (vi)" },
];
const CHAPTER_LANG_OPTIONS = [
  { code: "vi", label: "Vietnamese (vi)" },
  { code: "en", label: "English (en)" },
  { code: "ja", label: "Japanese (ja)" },
  { code: "es", label: "Spanish (es)" },
  { code: "fr", label: "French (fr)" },
];
const ADDED_WINDOWS = [
  { value: "", label: "Any time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 1 year" },
];
const MIN_RATING_OPTIONS = [
  { value: "", label: "Any score" },
  { value: "5", label: "5.0+" },
  { value: "6", label: "6.0+" },
  { value: "7", label: "7.0+" },
  { value: "7.5", label: "7.5+" },
  { value: "8", label: "8.0+" },
  { value: "8.5", label: "8.5+" },
  { value: "9", label: "9.0+" },
];
const MIN_VIEWS_OPTIONS = [
  { value: "", label: "Any views" },
  { value: "100", label: "100+ views" },
  { value: "1000", label: "1,000+ views" },
  { value: "10000", label: "10,000+ views" },
  { value: "100000", label: "100,000+ views" },
];

type ViewMode = "comfortable" | "compact" | "list";
const VIEW_MODE_KEY = "mr_explore_view_mode";

function loadViewMode(): ViewMode {
  if (typeof window === "undefined") return "comfortable";
  const saved = window.localStorage.getItem(VIEW_MODE_KEY);
  return saved === "compact" || saved === "list" ? saved : "comfortable";
}

function splitCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toggleArrayItem(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function CreatorPickerField({
  label,
  role,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  role: "author" | "artist";
  value: string;
  onChange: (nextValue: string) => void;
  placeholder: string;
}) {
  const [suggestions, setSuggestions] = useState<CreatorSearchItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiClient.searchCreators(trimmed, role);
        setSuggestions(res.data.slice(0, 6));
      } catch {
        setSuggestions([]);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [value, role]);

  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-medium">{label}</label>
      <input
        type="text"
        value={value}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        placeholder={placeholder}
        className="w-full rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5 text-sm"
        style={{
          backgroundColor: "var(--mr-bg-elevated)",
          borderColor: "var(--mr-border-subtle)",
          color: "var(--mr-text-primary)",
        }}
      />
      {open && suggestions.length > 0 ? (
        <ul
          className="absolute right-0 left-0 z-20 mt-1 max-h-44 overflow-y-auto rounded border py-1 text-xs shadow-lg"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
          }}
        >
          {suggestions.map((c) => (
            <li key={c.creatorId}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(c.name);
                  setOpen(false);
                }}
                className="flex w-full cursor-pointer items-center justify-between px-2.5 py-1.5 text-left hover:opacity-80"
                style={{ color: "var(--mr-text-primary)" }}
              >
                <span className="truncate font-medium">{c.name}</span>
                <span style={{ color: "var(--mr-text-muted)" }}>{c.publicWorkCount} works</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ExplorePage() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const isAdvancedRoute =
    location.pathname.startsWith("/search/advanced") || location.pathname === "/search";
  const [searchParams, setSearchParams] = useSearchParams();

  // Search mode tab ("manga" catalog + advanced filters vs "creators" directory)
  const tab = (searchParams.get("tab") === "creators" ? "creators" : "manga") as
    "manga" | "creators";
  const roleFilter = (searchParams.get("role") || "").toLowerCase();

  // Applied URL parameters
  const appliedQ = searchParams.get("q") || "";
  const sort = searchParams.get("sort") || "UPDATED_DESC";
  const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
  const appliedInclude = useMemo(() => splitCsv(searchParams.get("includeTags")), [searchParams]);
  const appliedExclude = useMemo(() => splitCsv(searchParams.get("excludeTags")), [searchParams]);
  const appliedRatings = useMemo(() => splitCsv(searchParams.get("contentRating")), [searchParams]);
  const appliedDemographics = useMemo(
    () => splitCsv(searchParams.get("demographic")),
    [searchParams],
  );
  const appliedStatuses = useMemo(() => splitCsv(searchParams.get("status")), [searchParams]);
  const appliedOrigLangs = useMemo(
    () => splitCsv(searchParams.get("originalLanguage") || searchParams.get("language")),
    [searchParams],
  );
  const appliedChLangs = useMemo(
    () => splitCsv(searchParams.get("chapterLanguage")),
    [searchParams],
  );
  const appliedAuthor = searchParams.get("author") || "";
  const appliedArtist = searchParams.get("artist") || "";
  const appliedYearFrom = searchParams.get("yearFrom") || "";
  const appliedYearTo = searchParams.get("yearTo") || "";
  const appliedChaptersMin = searchParams.get("chaptersMin") || "";
  const appliedChaptersMax = searchParams.get("chaptersMax") || "";
  const appliedRatingMin = searchParams.get("ratingMin") || "";
  const appliedIncludeUnrated = searchParams.get("includeUnrated") === "true";
  const appliedViewsMin = searchParams.get("viewsMin") || "";
  const appliedAddedDays = searchParams.get("addedDays") || "";
  const appliedHideInStatus = searchParams.get("hideInStatus") === "true";
  const appliedHideInLists = searchParams.get("hideInLists") === "true";
  const appliedTagMode = searchParams.get("tagMode") || "GROUP_OR";

  // View & UI states
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode());
  const [drawerOpen, setDrawerOpen] = useState(() => isAdvancedRoute);
  const [titleInput, setTitleInput] = useState(appliedQ);
  const [creatorSort, setCreatorSort] = useState<"WORKS_DESC" | "NAME_ASC" | "NAME_DESC">(
    "WORKS_DESC",
  );
  const [creatorPage, setCreatorPage] = useState(1);
  const [tagFilterQuery, setTagFilterQuery] = useState("");
  const [selectedTagGroup, setSelectedTagGroup] = useState<string>("ALL");
  const [tagStateFilter, setTagStateFilter] = useState<"ALL" | "INCLUDED" | "EXCLUDED">("ALL");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isAdvancedRoute) {
      setDrawerOpen(true);
    }
  }, [isAdvancedRoute]);

  // Draft filter state inside panel
  const [draftInclude, setDraftInclude] = useState<string[]>(appliedInclude);
  const [draftExclude, setDraftExclude] = useState<string[]>(appliedExclude);
  const [draftRatings, setDraftRatings] = useState<string[]>(appliedRatings);
  const [draftDemographics, setDraftDemographics] = useState<string[]>(appliedDemographics);
  const [draftStatuses, setDraftStatuses] = useState<string[]>(appliedStatuses);
  const [draftOrigLangs, setDraftOrigLangs] = useState<string[]>(appliedOrigLangs);
  const [draftOrigLangCustom, setDraftOrigLangCustom] = useState("");
  const [draftChLangs, setDraftChLangs] = useState<string[]>(appliedChLangs);
  const [draftAuthor, setDraftAuthor] = useState(appliedAuthor);
  const [draftArtist, setDraftArtist] = useState(appliedArtist);
  const [draftYearFrom, setDraftYearFrom] = useState(appliedYearFrom);
  const [draftYearTo, setDraftYearTo] = useState(appliedYearTo);
  const [draftChaptersMin, setDraftChaptersMin] = useState(appliedChaptersMin);
  const [draftChaptersMax, setDraftChaptersMax] = useState(appliedChaptersMax);
  const [draftRatingMin, setDraftRatingMin] = useState(appliedRatingMin);
  const [draftIncludeUnrated, setDraftIncludeUnrated] = useState(appliedIncludeUnrated);
  const [draftViewsMin, setDraftViewsMin] = useState(appliedViewsMin);
  const [draftAddedDays, setDraftAddedDays] = useState(appliedAddedDays);
  const [draftHideInStatus, setDraftHideInStatus] = useState(appliedHideInStatus);
  const [draftHideInLists, setDraftHideInLists] = useState(appliedHideInLists);
  const [draftTagMode, setDraftTagMode] = useState(appliedTagMode);

  useEffect(() => {
    setTitleInput(appliedQ);
  }, [appliedQ]);

  useEffect(() => {
    setCreatorPage(1);
  }, [appliedQ, roleFilter, creatorSort, tab]);

  // Live debounced search syncing query text to catalog & creator search
  useEffect(() => {
    const trimmed = titleInput.trim();
    const currentQ = appliedQ.trim();
    if (trimmed === currentQ) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (trimmed) {
        next.set("q", trimmed);
        if (!next.get("sort") && tab === "manga") {
          next.set("sort", "RELEVANCE");
        }
      } else {
        next.delete("q");
        if (next.get("sort") === "RELEVANCE") {
          next.set("sort", "UPDATED_DESC");
        }
      }
      next.set("page", "1");
      setSearchParams(next, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [titleInput, appliedQ, tab, searchParams, setSearchParams]);

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiClient.listTags(),
    enabled: tab === "manga",
  });

  const catalogQuery = useQuery({
    queryKey: ["catalog", "explore", searchParams.toString()],
    queryFn: () =>
      apiClient.listCatalog({
        q: appliedQ || undefined,
        sort,
        page,
        pageSize: 24,
        includeTags: appliedInclude.join(",") || undefined,
        excludeTags: appliedExclude.join(",") || undefined,
        tagMode: appliedTagMode,
        contentRating: appliedRatings.join(",") || undefined,
        demographic: appliedDemographics.join(",") || undefined,
        status: appliedStatuses.join(",") || undefined,
        originalLanguage: appliedOrigLangs.join(",") || undefined,
        chapterLanguage: appliedChLangs.join(",") || undefined,
        author: appliedAuthor || undefined,
        artist: appliedArtist || undefined,
        yearFrom: appliedYearFrom ? Number(appliedYearFrom) : undefined,
        yearTo: appliedYearTo ? Number(appliedYearTo) : undefined,
        chaptersMin: appliedChaptersMin ? Number(appliedChaptersMin) : undefined,
        chaptersMax: appliedChaptersMax ? Number(appliedChaptersMax) : undefined,
        ratingMin: appliedRatingMin ? Number(appliedRatingMin) : undefined,
        includeUnrated: appliedIncludeUnrated || undefined,
        viewsMin: appliedViewsMin ? Number(appliedViewsMin) : undefined,
        addedDays: appliedAddedDays ? Number(appliedAddedDays) : undefined,
        hideInStatus: isAuthenticated && appliedHideInStatus ? true : undefined,
        hideInLists: isAuthenticated && appliedHideInLists ? true : undefined,
      }),
    enabled: tab === "manga",
  });

  const creatorsQuery = useQuery({
    queryKey: ["search", "creators", appliedQ, roleFilter],
    queryFn: () => apiClient.searchCreators(appliedQ, roleFilter || undefined),
    enabled: tab === "creators" && appliedQ.trim().length > 0,
  });

  const sortedCreators = useMemo(() => {
    const list = [...(creatorsQuery.data?.data ?? [])];
    if (creatorSort === "NAME_ASC") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (creatorSort === "NAME_DESC") {
      list.sort((a, b) => b.name.localeCompare(a.name));
    } else {
      list.sort((a, b) => b.publicWorkCount - a.publicWorkCount);
    }
    return list;
  }, [creatorsQuery.data, creatorSort]);

  const CREATORS_PAGE_SIZE = 18;
  const pagedCreators = useMemo(() => {
    const start = (creatorPage - 1) * CREATORS_PAGE_SIZE;
    return sortedCreators.slice(start, start + CREATORS_PAGE_SIZE);
  }, [sortedCreators, creatorPage]);

  function setSearchTab(nextTab: "manga" | "creators") {
    const next = new URLSearchParams(searchParams);
    if (nextTab === "creators") next.set("tab", "creators");
    else next.delete("tab");
    next.set("page", "1");
    setSearchParams(next);
  }

  const tagNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tagsQuery.data?.data ?? []) {
      map.set(t.slug, t.name);
    }
    return map;
  }, [tagsQuery.data]);

  const tagGroupsAvailable = useMemo(() => {
    const groups = new Set<string>();
    for (const tag of tagsQuery.data?.data ?? []) {
      groups.add(tag.group || "other");
    }
    return Array.from(groups);
  }, [tagsQuery.data]);

  const groupedTags = useMemo(() => {
    const map = new Map<string, TagItem[]>();
    const qNorm = tagFilterQuery.trim().toLowerCase();
    for (const tag of tagsQuery.data?.data ?? []) {
      const grp = tag.group || "other";
      if (selectedTagGroup !== "ALL" && grp !== selectedTagGroup) {
        continue;
      }
      const isInc = draftInclude.includes(tag.slug);
      const isExc = draftExclude.includes(tag.slug);
      if (tagStateFilter === "INCLUDED" && !isInc) continue;
      if (tagStateFilter === "EXCLUDED" && !isExc) continue;
      if (qNorm && !tag.name.toLowerCase().includes(qNorm) && !tag.slug.includes(qNorm)) {
        continue;
      }
      const list = map.get(grp) ?? [];
      list.push(tag);
      map.set(grp, list);
    }
    return Array.from(map.entries());
  }, [
    tagsQuery.data,
    tagFilterQuery,
    selectedTagGroup,
    tagStateFilter,
    draftInclude,
    draftExclude,
  ]);

  function openDrawer() {
    setDraftInclude(appliedInclude);
    setDraftExclude(appliedExclude);
    setDraftRatings(appliedRatings);
    setDraftDemographics(appliedDemographics);
    setDraftStatuses(appliedStatuses);
    setDraftOrigLangs(appliedOrigLangs);
    setDraftOrigLangCustom("");
    setDraftChLangs(appliedChLangs);
    setDraftAuthor(appliedAuthor);
    setDraftArtist(appliedArtist);
    setDraftYearFrom(appliedYearFrom);
    setDraftYearTo(appliedYearTo);
    setDraftChaptersMin(appliedChaptersMin);
    setDraftChaptersMax(appliedChaptersMax);
    setDraftRatingMin(appliedRatingMin);
    setDraftIncludeUnrated(appliedIncludeUnrated);
    setDraftViewsMin(appliedViewsMin);
    setDraftAddedDays(appliedAddedDays);
    setDraftHideInStatus(appliedHideInStatus);
    setDraftHideInLists(appliedHideInLists);
    setDraftTagMode(appliedTagMode);
    setValidationError(null);
    setDrawerOpen(true);
  }

  function cycleTag(slug: string) {
    // Neutral -> Include -> Exclude -> Neutral
    if (draftInclude.includes(slug)) {
      setDraftInclude((prev) => prev.filter((x) => x !== slug));
      setDraftExclude((prev) => [...prev, slug]);
    } else if (draftExclude.includes(slug)) {
      setDraftExclude((prev) => prev.filter((x) => x !== slug));
    } else {
      setDraftInclude((prev) => [...prev, slug]);
    }
  }

  function clearTagGroup(groupTags: TagItem[]) {
    const slugs = new Set(groupTags.map((t) => t.slug));
    setDraftInclude((prev) => prev.filter((s) => !slugs.has(s)));
    setDraftExclude((prev) => prev.filter((s) => !slugs.has(s)));
  }

  function handleTitleSearch(e: FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    const trimmed = titleInput.trim();
    if (trimmed) {
      next.set("q", trimmed);
      if (!searchParams.get("sort")) {
        next.set("sort", "RELEVANCE");
      }
    } else {
      next.delete("q");
      if (next.get("sort") === "RELEVANCE") {
        next.set("sort", "UPDATED_DESC");
      }
    }
    next.set("page", "1");
    setSearchParams(next);
  }

  function applyFilters() {
    setValidationError(null);
    const yf = draftYearFrom.trim() ? Number(draftYearFrom.trim()) : null;
    const yt = draftYearTo.trim() ? Number(draftYearTo.trim()) : null;
    if (yf !== null && yt !== null && yf > yt) {
      setValidationError("Publication Year 'From' cannot be greater than 'To'.");
      return;
    }

    const cm = draftChaptersMin.trim() ? Number(draftChaptersMin.trim()) : null;
    const cx = draftChaptersMax.trim() ? Number(draftChaptersMax.trim()) : null;
    if ((cm !== null && cm < 0) || (cx !== null && cx < 0)) {
      setValidationError("Exported chapter counts must be 0 or greater.");
      return;
    }
    if (cm !== null && cx !== null && cm > cx) {
      setValidationError("Minimum exported chapters cannot exceed maximum exported chapters.");
      return;
    }

    const combinedOrigLangs = [...draftOrigLangs];
    for (const part of splitCsv(draftOrigLangCustom.toLowerCase())) {
      if (!combinedOrigLangs.includes(part)) combinedOrigLangs.push(part);
    }

    const next = new URLSearchParams();
    if (titleInput.trim()) next.set("q", titleInput.trim());
    next.set("sort", sort);
    next.set("page", "1");
    if (draftInclude.length) next.set("includeTags", draftInclude.join(","));
    if (draftExclude.length) next.set("excludeTags", draftExclude.join(","));
    if (draftTagMode !== "GROUP_OR") next.set("tagMode", draftTagMode);
    if (draftRatings.length) next.set("contentRating", draftRatings.join(","));
    if (draftDemographics.length) next.set("demographic", draftDemographics.join(","));
    if (draftStatuses.length) next.set("status", draftStatuses.join(","));
    if (combinedOrigLangs.length) next.set("originalLanguage", combinedOrigLangs.join(","));
    if (draftChLangs.length) next.set("chapterLanguage", draftChLangs.join(","));
    if (draftAuthor.trim()) next.set("author", draftAuthor.trim());
    if (draftArtist.trim()) next.set("artist", draftArtist.trim());
    if (draftYearFrom.trim()) next.set("yearFrom", draftYearFrom.trim());
    if (draftYearTo.trim()) next.set("yearTo", draftYearTo.trim());
    if (draftChaptersMin.trim()) next.set("chaptersMin", draftChaptersMin.trim());
    if (draftChaptersMax.trim()) next.set("chaptersMax", draftChaptersMax.trim());
    if (draftRatingMin.trim()) next.set("ratingMin", draftRatingMin.trim());
    if (draftRatingMin.trim() && draftIncludeUnrated) next.set("includeUnrated", "true");
    if (draftViewsMin.trim()) next.set("viewsMin", draftViewsMin.trim());
    if (draftAddedDays.trim()) next.set("addedDays", draftAddedDays.trim());
    if (isAuthenticated && draftHideInStatus) next.set("hideInStatus", "true");
    if (isAuthenticated && draftHideInLists) next.set("hideInLists", "true");

    setSearchParams(next);
    if (!isAdvancedRoute) {
      setDrawerOpen(false);
    }
  }

  function clearFilters() {
    setTitleInput("");
    setTagFilterQuery("");
    setValidationError(null);
    setDraftInclude([]);
    setDraftExclude([]);
    setDraftRatings([]);
    setDraftDemographics([]);
    setDraftStatuses([]);
    setDraftOrigLangs([]);
    setDraftOrigLangCustom("");
    setDraftChLangs([]);
    setDraftAuthor("");
    setDraftArtist("");
    setDraftYearFrom("");
    setDraftYearTo("");
    setDraftChaptersMin("");
    setDraftChaptersMax("");
    setDraftRatingMin("");
    setDraftIncludeUnrated(false);
    setDraftViewsMin("");
    setDraftAddedDays("");
    setDraftHideInStatus(false);
    setDraftHideInLists(false);
    setDraftTagMode("GROUP_OR");
    setSearchParams({ sort: sort === "RELEVANCE" ? "UPDATED_DESC" : sort, page: "1" });
    setDrawerOpen(false);
  }

  function applyPreset(params: Record<string, string>) {
    const next = new URLSearchParams();
    next.set("page", "1");
    for (const [k, v] of Object.entries(params)) {
      next.set(k, v);
    }
    setSearchParams(next);
    if (!isAdvancedRoute) {
      setDrawerOpen(false);
    }
  }

  function removeCsvToken(paramName: string, token: string) {
    const next = new URLSearchParams(searchParams);
    const remaining = splitCsv(next.get(paramName)).filter((t) => t !== token);
    if (remaining.length > 0) next.set(paramName, remaining.join(","));
    else next.delete(paramName);
    next.set("page", "1");
    setSearchParams(next);
  }

  function removeParam(paramName: string, alsoDelete?: string) {
    const next = new URLSearchParams(searchParams);
    next.delete(paramName);
    if (alsoDelete) next.delete(alsoDelete);
    next.set("page", "1");
    setSearchParams(next);
  }

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    }
  }

  function setSort(nextSort: string) {
    const next = new URLSearchParams(searchParams);
    next.set("sort", nextSort);
    next.set("page", "1");
    setSearchParams(next);
  }

  function setPage(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(nextPage));
    setSearchParams(next);
  }

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (appliedQ) {
      chips.push({
        key: "q",
        label: `Title: "${appliedQ}"`,
        onRemove: () => {
          setTitleInput("");
          removeParam("q");
        },
      });
    }
    for (const slug of appliedInclude) {
      chips.push({
        key: `inc-${slug}`,
        label: `+ ${tagNameMap.get(slug) ?? slug}`,
        onRemove: () => removeCsvToken("includeTags", slug),
      });
    }
    for (const slug of appliedExclude) {
      chips.push({
        key: `exc-${slug}`,
        label: `− ${tagNameMap.get(slug) ?? slug}`,
        onRemove: () => removeCsvToken("excludeTags", slug),
      });
    }
    if (appliedTagMode !== "GROUP_OR" && appliedInclude.length > 0) {
      chips.push({
        key: "tagMode",
        label: `Tag mode: ${appliedTagMode}`,
        onRemove: () => removeParam("tagMode"),
      });
    }
    for (const r of appliedRatings) {
      chips.push({
        key: `cr-${r}`,
        label: `Rating: ${r === "unknown" ? "unclassified" : r}`,
        onRemove: () => removeCsvToken("contentRating", r),
      });
    }
    for (const d of appliedDemographics) {
      chips.push({
        key: `demo-${d}`,
        label: `Demographic: ${d}`,
        onRemove: () => removeCsvToken("demographic", d),
      });
    }
    for (const s of appliedStatuses) {
      chips.push({
        key: `st-${s}`,
        label: `Status: ${s}`,
        onRemove: () => removeCsvToken("status", s),
      });
    }
    for (const l of appliedOrigLangs) {
      chips.push({
        key: `ol-${l}`,
        label: `Original: ${l.toUpperCase()}`,
        onRemove: () => {
          const next = new URLSearchParams(searchParams);
          const rem = splitCsv(next.get("originalLanguage") || next.get("language")).filter(
            (x) => x !== l,
          );
          next.delete("language");
          if (rem.length > 0) next.set("originalLanguage", rem.join(","));
          else next.delete("originalLanguage");
          next.set("page", "1");
          setSearchParams(next);
        },
      });
    }
    for (const cl of appliedChLangs) {
      chips.push({
        key: `cl-${cl}`,
        label: `Translated: ${cl.toUpperCase()}`,
        onRemove: () => removeCsvToken("chapterLanguage", cl),
      });
    }
    if (appliedAuthor) {
      chips.push({
        key: "author",
        label: `Author: ${appliedAuthor}`,
        onRemove: () => removeParam("author"),
      });
    }
    if (appliedArtist) {
      chips.push({
        key: "artist",
        label: `Artist: ${appliedArtist}`,
        onRemove: () => removeParam("artist"),
      });
    }
    if (appliedYearFrom || appliedYearTo) {
      chips.push({
        key: "year",
        label: `Year: ${appliedYearFrom || "…"}–${appliedYearTo || "…"}`,
        onRemove: () => removeParam("yearFrom", "yearTo"),
      });
    }
    if (appliedChaptersMin || appliedChaptersMax) {
      chips.push({
        key: "chapters",
        label: `Exported Ch: ${appliedChaptersMin || "0"}–${appliedChaptersMax || "∞"}`,
        onRemove: () => removeParam("chaptersMin", "chaptersMax"),
      });
    }
    if (appliedRatingMin) {
      chips.push({
        key: "ratingMin",
        label: `Score ≥ ${appliedRatingMin}${appliedIncludeUnrated ? " (+unrated)" : ""}`,
        onRemove: () => removeParam("ratingMin", "includeUnrated"),
      });
    }
    if (appliedViewsMin) {
      chips.push({
        key: "viewsMin",
        label: `Views ≥ ${Number(appliedViewsMin).toLocaleString()}`,
        onRemove: () => removeParam("viewsMin"),
      });
    }
    if (appliedAddedDays) {
      chips.push({
        key: "addedDays",
        label: `Added ≤ ${appliedAddedDays}d`,
        onRemove: () => removeParam("addedDays"),
      });
    }
    if (isAuthenticated && appliedHideInStatus) {
      chips.push({
        key: "hideInStatus",
        label: "Hide in my Library",
        onRemove: () => removeParam("hideInStatus"),
      });
    }
    if (isAuthenticated && appliedHideInLists) {
      chips.push({
        key: "hideInLists",
        label: "Hide in my Lists",
        onRemove: () => removeParam("hideInLists"),
      });
    }
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, tagNameMap, isAuthenticated]);

  const activeFilterCount = activeChips.length;

  return (
    <div className="space-y-5">
      {/* Header & Top Toolbar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
            {tab === "creators"
              ? "Search Authors & Artists"
              : isAdvancedRoute
                ? "Advanced Manga Search"
                : "Explore Catalog"}
          </h1>
          <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
            Unified live search for canonical &amp; localized titles, Include/Exclude genre &amp;
            theme tags, creators, languages, exported chapters, years, and reader ratings.
          </p>
        </div>

        {tab === "manga" ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Sort catalog"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            <div
              role="group"
              aria-label="Result view mode"
              className="flex overflow-hidden rounded-[var(--mr-radius-sm)] border text-xs"
              style={{ borderColor: "var(--mr-border-strong)" }}
            >
              {(
                [
                  { id: "comfortable", label: "Grid" },
                  { id: "compact", label: "Compact" },
                  { id: "list", label: "List" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={viewMode === m.id}
                  onClick={() => changeViewMode(m.id)}
                  className="cursor-pointer px-2.5 py-1.5 font-medium"
                  style={{
                    backgroundColor:
                      viewMode === m.id ? "var(--mr-bg-elevated)" : "var(--mr-bg-surface)",
                    color: viewMode === m.id ? "var(--mr-accent)" : "var(--mr-text-secondary)",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              aria-expanded={drawerOpen}
              onClick={() => (drawerOpen ? setDrawerOpen(false) : openDrawer())}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm font-medium"
              style={{
                backgroundColor:
                  activeFilterCount > 0 ? "var(--mr-accent)" : "var(--mr-bg-surface)",
                borderColor: activeFilterCount > 0 ? "var(--mr-accent)" : "var(--mr-border-strong)",
                color: activeFilterCount > 0 ? "#ffffff" : "var(--mr-text-primary)",
              }}
            >
              Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
            </button>

            {activeFilterCount > 0 ? (
              <button
                type="button"
                onClick={clearFilters}
                className="cursor-pointer text-xs underline"
                style={{ color: "var(--mr-text-muted)" }}
              >
                Clear all
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              aria-label="Filter creator role"
              value={roleFilter}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams);
                if (e.target.value) next.set("role", e.target.value);
                else next.delete("role");
                setSearchParams(next);
              }}
              className="rounded border px-2.5 py-1.5"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="">All roles</option>
              <option value="author">Author</option>
              <option value="artist">Artist</option>
            </select>
            <select
              aria-label="Sort creators"
              value={creatorSort}
              onChange={(e) =>
                setCreatorSort(e.target.value as "WORKS_DESC" | "NAME_ASC" | "NAME_DESC")
              }
              className="rounded border px-2.5 py-1.5"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="WORKS_DESC">Most Public Works</option>
              <option value="NAME_ASC">Name (A–Z)</option>
              <option value="NAME_DESC">Name (Z–A)</option>
            </select>
          </div>
        )}
      </div>

      {/* Unified Mode Switcher: Manga Titles vs Authors & Artists */}
      <div
        role="tablist"
        aria-label="Search target mode"
        className="flex flex-wrap items-center gap-2 border-b pb-2"
        style={{ borderColor: "var(--mr-border-subtle)" }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "manga"}
          onClick={() => setSearchTab("manga")}
          className="cursor-pointer rounded-[var(--mr-radius-sm)] px-3.5 py-1.5 text-xs font-semibold"
          style={{
            backgroundColor: tab === "manga" ? "var(--mr-accent)" : "var(--mr-bg-surface)",
            color: tab === "manga" ? "#ffffff" : "var(--mr-text-secondary)",
          }}
        >
          Manga Catalog &amp; Advanced Filters
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "creators"}
          onClick={() => setSearchTab("creators")}
          className="cursor-pointer rounded-[var(--mr-radius-sm)] px-3.5 py-1.5 text-xs font-semibold"
          style={{
            backgroundColor: tab === "creators" ? "var(--mr-accent)" : "var(--mr-bg-surface)",
            color: tab === "creators" ? "#ffffff" : "var(--mr-text-secondary)",
          }}
        >
          Authors &amp; Artists
        </button>
      </div>

      {/* Title Search Input + Quick Presets */}
      <div className="space-y-2.5">
        <form onSubmit={handleTitleSearch} className="flex flex-wrap gap-2">
          <input
            type="search"
            aria-label="Filter by title or alternative title"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder={
              tab === "creators"
                ? "Live search authors or artists by name..."
                : "Live search by canonical title or alternative title (case & accent insensitive)..."
            }
            className="min-w-60 flex-1 rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          />
          <button
            type="submit"
            className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--mr-accent)" }}
          >
            {tab === "creators" ? "Search Creators" : "Search Titles"}
          </button>
        </form>

        {tab === "manga" ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span style={{ color: "var(--mr-text-muted)" }}>Quick presets:</span>
            <button
              type="button"
              onClick={() => applyPreset({ sort: "RATING_DESC", ratingMin: "8" })}
              className="cursor-pointer rounded-full border px-2.5 py-0.5"
              style={{
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-secondary)",
              }}
            >
              Top Rated (8.0+)
            </button>
            <button
              type="button"
              onClick={() => applyPreset({ sort: "UPDATED_DESC", status: "completed" })}
              className="cursor-pointer rounded-full border px-2.5 py-0.5"
              style={{
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-secondary)",
              }}
            >
              Completed Series
            </button>
            <button
              type="button"
              onClick={() => applyPreset({ sort: "UPDATED_DESC", contentRating: "safe" })}
              className="cursor-pointer rounded-full border px-2.5 py-0.5"
              style={{
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-secondary)",
              }}
            >
              Safe Only
            </button>
            <button
              type="button"
              onClick={() => applyPreset({ sort: "UPDATED_DESC", chapterLanguage: "vi" })}
              className="cursor-pointer rounded-full border px-2.5 py-0.5"
              style={{
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-secondary)",
              }}
            >
              Has Vietnamese Chapters
            </button>
            <button
              type="button"
              onClick={() => applyPreset({ sort: "UPDATED_DESC", chapterLanguage: "en" })}
              className="cursor-pointer rounded-full border px-2.5 py-0.5"
              style={{
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-secondary)",
              }}
            >
              Has English Chapters
            </button>
          </div>
        ) : null}
      </div>

      {/* Active Filter Chips Bar */}
      {activeChips.length > 0 ? (
        <div
          aria-label="Active search filters"
          className="flex flex-wrap items-center gap-1.5 rounded-[var(--mr-radius-md)] border p-2.5 text-xs"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-subtle)",
          }}
        >
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              aria-label={`Remove filter ${chip.label}`}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <span>{chip.label}</span>
              <span aria-hidden="true" style={{ color: "var(--mr-text-muted)" }}>
                ✕
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Advanced Filter Panel (UC-3.2 + 04_ADVANCED_SEARCH_UX_SPEC.md) */}
      {tab === "manga" && drawerOpen ? (
        <section
          aria-label="Advanced filters"
          className="space-y-5 rounded-[var(--mr-radius-lg)] border p-5"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
          }}
        >
          {/* Row 1: Creators, Year Range, Exported Chapter Range */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <CreatorPickerField
              label="Author"
              role="author"
              value={draftAuthor}
              onChange={setDraftAuthor}
              placeholder="Filter by author name..."
            />
            <CreatorPickerField
              label="Artist"
              role="artist"
              value={draftArtist}
              onChange={setDraftArtist}
              placeholder="Filter by artist name..."
            />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="filter-year-from" className="mb-1 block text-xs font-medium">
                  Year From
                </label>
                <input
                  id="filter-year-from"
                  type="number"
                  min={1800}
                  max={2200}
                  value={draftYearFrom}
                  onChange={(e) => setDraftYearFrom(e.target.value)}
                  placeholder="1990"
                  className="w-full rounded-[var(--mr-radius-sm)] border px-2 py-1.5 text-sm"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-text-primary)",
                  }}
                />
              </div>
              <div>
                <label htmlFor="filter-year-to" className="mb-1 block text-xs font-medium">
                  Year To
                </label>
                <input
                  id="filter-year-to"
                  type="number"
                  min={1800}
                  max={2200}
                  value={draftYearTo}
                  onChange={(e) => setDraftYearTo(e.target.value)}
                  placeholder="2026"
                  className="w-full rounded-[var(--mr-radius-sm)] border px-2 py-1.5 text-sm"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-text-primary)",
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="filter-ch-min" className="mb-1 block text-xs font-medium">
                  Exported Ch. Min
                </label>
                <input
                  id="filter-ch-min"
                  type="number"
                  min={0}
                  value={draftChaptersMin}
                  onChange={(e) => setDraftChaptersMin(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-[var(--mr-radius-sm)] border px-2 py-1.5 text-sm"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-text-primary)",
                  }}
                />
              </div>
              <div>
                <label htmlFor="filter-ch-max" className="mb-1 block text-xs font-medium">
                  Exported Ch. Max
                </label>
                <input
                  id="filter-ch-max"
                  type="number"
                  min={0}
                  value={draftChaptersMax}
                  onChange={(e) => setDraftChaptersMax(e.target.value)}
                  placeholder="500"
                  className="w-full rounded-[var(--mr-radius-sm)] border px-2 py-1.5 text-sm"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-text-primary)",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Row 2: Score, Views, Catalog Added Date */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="filter-rating-min" className="mb-1 block text-xs font-medium">
                Minimum Score
              </label>
              <select
                id="filter-rating-min"
                value={draftRatingMin}
                onChange={(e) => setDraftRatingMin(e.target.value)}
                className="w-full rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              >
                {MIN_RATING_OPTIONS.map((opt) => (
                  <option key={opt.value || "any"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {draftRatingMin ? (
                <label className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                  <input
                    type="checkbox"
                    checked={draftIncludeUnrated}
                    onChange={(e) => setDraftIncludeUnrated(e.target.checked)}
                  />
                  <span>Also include unrated titles</span>
                </label>
              ) : null}
            </div>

            <div>
              <label htmlFor="filter-views-min" className="mb-1 block text-xs font-medium">
                Minimum Valid Views
              </label>
              <select
                id="filter-views-min"
                value={draftViewsMin}
                onChange={(e) => setDraftViewsMin(e.target.value)}
                className="w-full rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              >
                {MIN_VIEWS_OPTIONS.map((opt) => (
                  <option key={opt.value || "any"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="filter-added-days" className="mb-1 block text-xs font-medium">
                Added to Catalog
              </label>
              <select
                id="filter-added-days"
                value={draftAddedDays}
                onChange={(e) => setDraftAddedDays(e.target.value)}
                className="w-full rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              >
                {ADDED_WINDOWS.map((opt) => (
                  <option key={opt.value || "any"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 3: Multi-select Enums (Content Rating, Demographic, Publication Status) */}
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="mb-1.5 text-xs font-medium">
                Content Rating (Safe hides unclassified titles)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {CONTENT_RATINGS.map((rating) => {
                  const active = draftRatings.includes(rating);
                  return (
                    <button
                      key={rating}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setDraftRatings((prev) => toggleArrayItem(prev, rating))}
                      className="cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium capitalize"
                      style={{
                        backgroundColor: active ? "var(--mr-accent)" : "var(--mr-bg-elevated)",
                        borderColor: active ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                        color: active ? "#ffffff" : "var(--mr-text-secondary)",
                      }}
                    >
                      {rating === "unknown" ? "unknown (not classified)" : rating}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium">Publication Demographic</p>
              <div className="flex flex-wrap gap-1.5">
                {DEMOGRAPHICS.map((demo) => {
                  const active = draftDemographics.includes(demo);
                  return (
                    <button
                      key={demo}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setDraftDemographics((prev) => toggleArrayItem(prev, demo))}
                      className="cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium capitalize"
                      style={{
                        backgroundColor: active ? "var(--mr-accent)" : "var(--mr-bg-elevated)",
                        borderColor: active ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                        color: active ? "#ffffff" : "var(--mr-text-secondary)",
                      }}
                    >
                      {demo}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium">Publication Status</p>
              <div className="flex flex-wrap gap-1.5">
                {PUB_STATUSES.map((st) => {
                  const active = draftStatuses.includes(st);
                  return (
                    <button
                      key={st}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setDraftStatuses((prev) => toggleArrayItem(prev, st))}
                      className="cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium capitalize"
                      style={{
                        backgroundColor: active ? "var(--mr-accent)" : "var(--mr-bg-elevated)",
                        borderColor: active ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                        color: active ? "#ffffff" : "var(--mr-text-secondary)",
                      }}
                    >
                      {st}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Row 4: Separate Original Language vs Translated Chapter Language */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-medium">Original Publication Language</p>
              <div className="flex flex-wrap gap-1.5">
                {ORIGINAL_LANG_OPTIONS.map((lang) => {
                  const active = draftOrigLangs.includes(lang.code);
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setDraftOrigLangs((prev) => toggleArrayItem(prev, lang.code))}
                      className="cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium"
                      style={{
                        backgroundColor: active ? "var(--mr-accent)" : "var(--mr-bg-elevated)",
                        borderColor: active ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                        color: active ? "#ffffff" : "var(--mr-text-secondary)",
                      }}
                    >
                      {lang.label}
                    </button>
                  );
                })}
                <input
                  type="text"
                  aria-label="Custom original language code"
                  value={draftOrigLangCustom}
                  onChange={(e) => setDraftOrigLangCustom(e.target.value)}
                  placeholder="Other ISO (e.g. pt-br)"
                  className="w-36 rounded border px-2 py-1 text-xs"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-text-primary)",
                  }}
                />
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium">Has Translated Chapters In</p>
              <div className="flex flex-wrap gap-1.5">
                {CHAPTER_LANG_OPTIONS.map((lang) => {
                  const active = draftChLangs.includes(lang.code);
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setDraftChLangs((prev) => toggleArrayItem(prev, lang.code))}
                      className="cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium"
                      style={{
                        backgroundColor: active ? "var(--mr-accent)" : "var(--mr-bg-elevated)",
                        borderColor: active ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                        color: active ? "#ffffff" : "var(--mr-text-secondary)",
                      }}
                    >
                      {lang.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Row 5: Personal Exclusion Filters (Authenticated Only) */}
          {isAuthenticated ? (
            <div
              className="flex flex-wrap items-center gap-4 rounded-[var(--mr-radius-sm)] border px-3 py-2.5 text-xs"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <span className="font-semibold">My Reading Data:</span>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={draftHideInStatus}
                  onChange={(e) => setDraftHideInStatus(e.target.checked)}
                />
                <span>Hide titles in my Reading Status Library</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={draftHideInLists}
                  onChange={(e) => setDraftHideInLists(e.target.checked)}
                />
                <span>Hide titles already in any Custom Reading List</span>
              </label>
            </div>
          ) : null}

          {/* Row 6: Android-Style Tri-State Tags with Category Tabs, State Filter & Explicit Matching Mode */}
          <div
            className="space-y-3 border-t pt-4"
            style={{ borderColor: "var(--mr-border-subtle)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold">
                  Genres &amp; Tags — 1st click:{" "}
                  <span style={{ color: "var(--mr-success)" }}>✓ Include</span> · 2nd click:{" "}
                  <span style={{ color: "var(--mr-danger)" }}>✕ Exclude</span> · 3rd click: Clear
                </p>
                <p className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                  Selected:{" "}
                  <span style={{ color: "var(--mr-success)" }}>{draftInclude.length} Included</span>
                  {" · "}
                  <span style={{ color: "var(--mr-danger)" }}>{draftExclude.length} Excluded</span>
                  {draftInclude.length + draftExclude.length > 0 ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => {
                          setDraftInclude([]);
                          setDraftExclude([]);
                        }}
                        className="cursor-pointer underline"
                        style={{ color: "var(--mr-accent)" }}
                      >
                        Clear All Tags
                      </button>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  aria-label="Search within tags"
                  value={tagFilterQuery}
                  onChange={(e) => setTagFilterQuery(e.target.value)}
                  placeholder="Filter tags..."
                  className="rounded border px-2.5 py-1 text-xs"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-text-primary)",
                  }}
                />
                <select
                  aria-label="Tag matching mode"
                  value={draftTagMode}
                  onChange={(e) => setDraftTagMode(e.target.value)}
                  className="rounded border px-2 py-1 text-xs"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-text-primary)",
                  }}
                >
                  <option value="GROUP_OR">Smart Group Match (Same Group OR, Cross AND)</option>
                  <option value="ALL_AND">Strict AND (Must have ALL included tags)</option>
                  <option value="ANY_OR">Flexible OR (Any included tag matches)</option>
                </select>
              </div>
            </div>

            {/* Category Tabs + Selection State Filter */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedTagGroup("ALL")}
                  className="cursor-pointer rounded border px-2.5 py-1 font-medium"
                  style={{
                    backgroundColor:
                      selectedTagGroup === "ALL" ? "var(--mr-accent)" : "var(--mr-bg-elevated)",
                    borderColor:
                      selectedTagGroup === "ALL" ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                    color: selectedTagGroup === "ALL" ? "#ffffff" : "var(--mr-text-secondary)",
                  }}
                >
                  All Categories
                </button>
                {tagGroupsAvailable.map((grp) => (
                  <button
                    key={grp}
                    type="button"
                    onClick={() => setSelectedTagGroup(grp)}
                    className="cursor-pointer rounded border px-2.5 py-1 font-medium capitalize"
                    style={{
                      backgroundColor:
                        selectedTagGroup === grp ? "var(--mr-accent)" : "var(--mr-bg-elevated)",
                      borderColor:
                        selectedTagGroup === grp ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                      color: selectedTagGroup === grp ? "#ffffff" : "var(--mr-text-secondary)",
                    }}
                  >
                    {grp}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                {(
                  [
                    { id: "ALL", label: "All Tags" },
                    { id: "INCLUDED", label: `✓ Included (${draftInclude.length})` },
                    { id: "EXCLUDED", label: `✕ Excluded (${draftExclude.length})` },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setTagStateFilter(st.id)}
                    className="cursor-pointer rounded border px-2 py-0.5 font-medium"
                    style={{
                      backgroundColor:
                        tagStateFilter === st.id ? "var(--mr-bg-canvas)" : "transparent",
                      borderColor:
                        tagStateFilter === st.id
                          ? "var(--mr-border-strong)"
                          : "var(--mr-border-subtle)",
                      color:
                        tagStateFilter === st.id
                          ? "var(--mr-text-primary)"
                          : "var(--mr-text-muted)",
                    }}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            {groupedTags.length === 0 ? (
              <p className="py-3 text-center text-xs" style={{ color: "var(--mr-text-muted)" }}>
                No tags matched the current category or state filter.
              </p>
            ) : (
              groupedTags.map(([groupName, tags]) => {
                const groupIncCount = tags.filter((t) => draftInclude.includes(t.slug)).length;
                const groupExcCount = tags.filter((t) => draftExclude.includes(t.slug)).length;
                return (
                  <div key={groupName}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <p
                        className="text-[11px] font-semibold tracking-wider uppercase"
                        style={{ color: "var(--mr-text-muted)" }}
                      >
                        {groupName}
                        {groupIncCount + groupExcCount > 0
                          ? ` (+${groupIncCount} / −${groupExcCount})`
                          : ""}
                      </p>
                      {groupIncCount + groupExcCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => clearTagGroup(tags)}
                          className="cursor-pointer text-[11px] underline"
                          style={{ color: "var(--mr-text-muted)" }}
                        >
                          Clear {groupName}
                        </button>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => {
                        const inc = draftInclude.includes(tag.slug);
                        const exc = draftExclude.includes(tag.slug);
                        const stateDesc = inc ? "Included" : exc ? "Excluded" : "Not selected";
                        return (
                          <button
                            key={tag.slug}
                            type="button"
                            aria-label={`${tag.name} (${stateDesc})`}
                            onClick={() => cycleTag(tag.slug)}
                            className="cursor-pointer rounded border px-2.5 py-1 text-xs font-medium"
                            style={{
                              backgroundColor: inc
                                ? "rgba(52, 211, 153, 0.16)"
                                : exc
                                  ? "rgba(248, 113, 113, 0.16)"
                                  : "var(--mr-bg-elevated)",
                              borderColor: inc
                                ? "var(--mr-success)"
                                : exc
                                  ? "var(--mr-danger)"
                                  : "var(--mr-border-subtle)",
                              color: inc
                                ? "var(--mr-success)"
                                : exc
                                  ? "var(--mr-danger)"
                                  : "var(--mr-text-secondary)",
                            }}
                          >
                            {inc ? "✓ " : exc ? "✕ " : ""}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {validationError ? (
            <p role="alert" className="text-xs font-medium" style={{ color: "var(--mr-danger)" }}>
              {validationError}
            </p>
          ) : null}

          <div
            className="sticky bottom-0 flex justify-end gap-2 border-t pt-3"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <button
              type="button"
              onClick={clearFilters}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm"
              style={{
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-secondary)",
              }}
            >
              Reset All
            </button>
            <button
              type="button"
              onClick={applyFilters}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-1.5 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Apply Filters
            </button>
          </div>
        </section>
      ) : null}

      {/* Results Grid / List */}
      {tab === "creators" ? (
        !appliedQ.trim() ? (
          <EmptyState
            title="Enter an author or artist name"
            description="Live search supports 49,937+ manga creators filtered by Author/Artist role and public work count."
          />
        ) : creatorsQuery.isLoading ? (
          <LoadingState variant="table" count={8} label="Searching authors & artists..." />
        ) : creatorsQuery.isError ? (
          <ErrorState onRetry={() => void creatorsQuery.refetch()} />
        ) : sortedCreators.length === 0 ? (
          <EmptyState
            title={`No creators found for "${appliedQ}"`}
            description="Try a different spelling or switch role filter to All roles."
          />
        ) : (
          <div className="space-y-4">
            <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
              Found {sortedCreators.length.toLocaleString()} matching creator(s) for &ldquo;
              {appliedQ}&rdquo;.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pagedCreators.map((c) => (
                <Link
                  key={c.creatorId}
                  to={`/author/${c.creatorId}/${c.slug}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--mr-radius-md)] border p-4 transition hover:border-[var(--mr-accent)]"
                  style={{
                    backgroundColor: "var(--mr-bg-surface)",
                    borderColor: "var(--mr-border-subtle)",
                  }}
                >
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-semibold"
                      style={{ color: "var(--mr-text-primary)" }}
                    >
                      {c.name}
                    </p>
                    <p
                      className="mt-0.5 text-xs capitalize"
                      style={{ color: "var(--mr-text-muted)" }}
                    >
                      {c.roles.join(" · ") || "Creator"}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold"
                    style={{
                      backgroundColor: "var(--mr-bg-elevated)",
                      color: "var(--mr-accent)",
                    }}
                  >
                    {c.publicWorkCount} works
                  </span>
                </Link>
              ))}
            </div>
            <CatalogPagination
              page={creatorPage}
              total={sortedCreators.length}
              pageSize={CREATORS_PAGE_SIZE}
              hasNext={creatorPage * CREATORS_PAGE_SIZE < sortedCreators.length}
              onPageChange={setCreatorPage}
              label="Creator search pagination"
            />
          </div>
        )
      ) : catalogQuery.isLoading ? (
        <LoadingState variant="grid" count={12} label="Filtering manga catalog..." />
      ) : catalogQuery.isError ? (
        <ErrorState onRetry={() => void catalogQuery.refetch()} />
      ) : catalogQuery.data && catalogQuery.data.data.length === 0 ? (
        <EmptyState
          title="No manga matched your filters"
          description="Try removing an excluded tag or widening the content rating, chapter range, or score filter."
          action={
            <button
              type="button"
              onClick={clearFilters}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Clear All Conditions
            </button>
          }
        />
      ) : (
        <>
          {(() => {
            const total = catalogQuery.data?.meta.total ?? 0;
            const itemCount = catalogQuery.data?.data.length ?? 0;
            const totalPages = Math.max(1, Math.ceil(total / 24));
            const startRank = itemCount > 0 ? (page - 1) * 24 + 1 : 0;
            const endRank = itemCount > 0 ? startRank + itemCount - 1 : 0;
            return (
              <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                Showing {startRank.toLocaleString()}–{endRank.toLocaleString()} of{" "}
                {total.toLocaleString()} public titles (Page {page.toLocaleString()} of{" "}
                {totalPages.toLocaleString()})
              </p>
            );
          })()}
          {viewMode === "list" ? (
            <div className="space-y-3">
              {catalogQuery.data?.data.map((manga) => (
                <MangaCard key={manga.mangaId} manga={manga} variant="horizontal" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {catalogQuery.data?.data.map((manga) => (
                <MangaCard
                  key={manga.mangaId}
                  manga={manga}
                  variant={viewMode === "compact" ? "compact" : "poster"}
                />
              ))}
            </div>
          )}

          {catalogQuery.data ? (
            <CatalogPagination
              page={page}
              total={catalogQuery.data.meta.total}
              pageSize={24}
              hasNext={catalogQuery.data.meta.hasNext}
              onPageChange={(nextPage) => {
                setPage(nextPage);
                if (typeof window.scrollTo === "function") {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
              label="Explore pagination"
            />
          ) : null}
        </>
      )}
    </div>
  );
}
