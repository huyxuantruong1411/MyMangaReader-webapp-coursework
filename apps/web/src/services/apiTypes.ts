export interface ApiMeta {
  requestId: string;
  page?: number;
  pageSize?: number;
  total?: number;
  hasNext?: boolean;
}

export interface ApiSuccessEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiPaginatedEnvelope<T> {
  data: T[];
  meta: ApiMeta & { page: number; pageSize: number; total: number; hasNext: boolean };
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: ApiMeta;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  environment: string;
  timestampUtc: string;
}

export interface UserSummary {
  accountId: string;
  username: string;
  email?: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  birthDate?: string | null;
  isBirthDatePublic?: boolean;
  role: "READER" | "ADMIN";
  status: "PENDING_VERIFICATION" | "ACTIVE" | "LOCKED";
  adminRoleLevel?: string | null;
  lockReason?: string | null;
  lockedAt?: string | null;
  createdAt?: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
  sessionId: string;
  user: UserSummary;
}

export interface TagItem {
  tagId?: number;
  slug: string;
  name: string;
  group: string;
  localizedNames?: Record<string, string>;
}

export interface MangaCardItem {
  mangaId: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  publicationStatus: string;
  contentRating: string;
  publicationDemographic: string;
  originalLanguage: string | null;
  year: number | null;
  totalViews: number;
  averageRating: number;
  latestChapter: {
    chapterId: string;
    chapterNumber: string;
    title: string;
    language: string;
    publishAt: string | null;
  } | null;
  tags: TagItem[];
  updatedAt: string;
  creatorRoles?: string[];
  addedAt?: string;
  similarityScore?: number;
  recommendationScore?: number;
}

export interface MangaDetail extends MangaCardItem {
  altTitles: string[];
  description: string;
  publishedStartDate: string | null;
  publishedEndDate: string | null;
  officialVolumes: number | null;
  officialChapters: number | null;
  coverArts: Array<{
    coverId: string | null;
    volume: string | null;
    locale: string | null;
    description: string | null;
    url: string | null;
  }>;
  creators: Array<{
    creatorId: string;
    slug: string;
    name: string;
    roles: string[];
  }>;
  links: Array<{ site: string; url: string }>;
  stats: {
    exportedChapterCount: number;
    exportedPageCount: number;
    totalSizeBytes: number;
    languages: string[];
  };
  ratingCount: number;
  viewerState: {
    readingStatus: string | null;
    progress: {
      chapterId: string;
      pageNumber: number;
      pageUid: string | null;
      updatedAt: string;
    } | null;
    myRating: number | null;
    canRate: boolean;
  } | null;
}

export interface ChapterItem {
  chapterId: string;
  mangaId: string;
  chapterNumber: string;
  chapterNumeric: number;
  volume: string | null;
  title: string;
  language: string;
  scanlationGroup: string | null;
  pageCount: number;
  pagesRevision: number;
  viewCount: number;
  publishAt: string | null;
}

export interface ReaderSettingsData {
  displayMode: "VERTICAL_WEBTOON" | "SINGLE_PAGE" | "DOUBLE_PAGE";
  readingDirection: "LTR" | "RTL";
  fitMode: "FIT_WIDTH" | "FIT_HEIGHT" | "ORIGINAL";
  preloadPageCount: number;
  updatedAt?: string;
}

export interface ReaderPageItem {
  pageNumber: number;
  pageUid: string;
  filename: string;
  width: number | null;
  height: number | null;
  contentType: string | null;
  url: string;
}

export interface ReaderOpenResponse {
  manga: { mangaId: string; slug: string; title: string };
  chapter: {
    chapterId: string;
    chapterNumber: string;
    chapterNumeric: number;
    volume: string | null;
    title: string;
    language: string;
    scanlationGroup: string | null;
    pagesRevision: number;
    pageCount: number;
  };
  initialPage: number;
  resumeNote: string | null;
  pages: ReaderPageItem[];
  prevChapter: {
    chapterId: string;
    chapterNumber: string;
    title: string;
    language: string;
  } | null;
  nextChapter: {
    chapterId: string;
    chapterNumber: string;
    title: string;
    language: string;
  } | null;
  historyId: string | null;
  settings: ReaderSettingsData;
}

export interface AutocompleteSuggestion {
  type: "MANGA" | "CREATOR";
  id: string;
  slug: string;
  label: string;
  sublabel: string;
}

export interface CreatorSearchItem {
  creatorId: string;
  slug: string;
  name: string;
  roles: string[];
  publicWorkCount: number;
}

export interface CreatorDetail {
  creatorId: string;
  slug: string;
  name: string;
  biography: string | null;
  localizedBiographies: Record<string, string>;
  links: Record<string, string>;
}

export interface CommentItem {
  commentId: string;
  mangaId: string;
  chapterId: string | null;
  parentCommentId: string | null;
  author: { accountId: string; username: string; displayName: string };
  content: string;
  isDeleted: boolean;
  isSpoiler: boolean;
  isSpoilerLockedByAdmin: boolean;
  isEdited: boolean;
  likeCount: number;
  dislikeCount: number;
  myReaction: "LIKE" | "DISLIKE" | null;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
  replies: CommentItem[];
}

export interface CommentEditHistoryItem {
  editId: string;
  previousContent: string;
  previousIsSpoiler: boolean;
  editedAt: string;
}

export interface ReadingHistoryEntry {
  historyId: string;
  mangaId: string;
  mangaSlug: string;
  mangaTitle: string;
  chapterId: string;
  chapterNumber: string;
  chapterTitle: string;
  openedAt: string;
  readingDurationSeconds: number;
  isValidView: boolean;
  resumePageNumber: number;
  resumeChapterId: string;
}

export interface RatingHistoryEntry {
  ratingHistoryId: string;
  mangaId: string;
  mangaSlug: string;
  mangaTitle: string;
  actionType: "CREATE" | "UPDATE" | "REMOVE";
  previousScore: number | null;
  newScore: number | null;
  recordedAt: string;
}

export interface ReadingListItem {
  listId: string;
  name: string;
  description: string | null;
  itemCount: number;
  visibleItemCount?: number;
  visibility: "PRIVATE";
  createdAt: string;
  updatedAt: string;
}

export interface ListMetadataStats {
  empty: boolean;
  emptyMessage: string | null;
  totalMangas: number;
  totalExportedChapters: number;
  tagDistribution: Array<{ tagSlug: string; tagName: string; count: number; percent: number }>;
  publicationStatusDistribution: Array<{ status: string; count: number; percent: number }>;
  averageListRating: number | null;
  ratedMangaCount: number;
  topCreators: Array<{ creatorId: string; name: string; workCount: number; roles: string[] }>;
  calculatedAt: string;
}

export interface RecommendationPayload {
  method: string;
  modelVersion: string;
  fallbackReason: string | null;
  items: MangaCardItem[];
}

export interface ReaderStatsPayload {
  accountId: string;
  hasData: boolean;
  chapterOpens: number;
  validViews: number;
  uniqueChaptersRead: number;
  uniqueMangasInteracted: number;
  ratingsCount: number;
  averageRatingGiven: number | null;
  readingStatusBreakdown: Record<string, number>;
  topTags: Array<{ slug: string; name: string; count: number }>;
  topCreators: Array<{ creatorId: string; name: string; workCount: number }>;
}

export interface AdminMangaItem {
  mangaId: string;
  poolMangaId: string;
  sourceMangaId: string;
  slug: string;
  title: string;
  visibilityStatus: "PUBLIC" | "HIDDEN";
  publicationStatus: string;
  contentRating: string;
  isCdcEnabled: boolean;
  isSyncing: boolean;
  ignoreAllReports: boolean;
  totalViews: number;
  averageRating: number;
  updatedAt: string;
}

export interface AdminReportItem {
  reportId: string;
  reportType: "ACCOUNT" | "MANGA" | "COMMENT";
  status: "PENDING" | "RESOLVED" | "IGNORED" | "CLOSED";
  reasonCategory: string;
  description: string | null;
  reporter: { accountId: string; username: string };
  targetExists: boolean;
  target: Record<string, unknown>;
  allowedActions?: string[];
  actionTaken: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  actionHistory?: Array<{
    actionHistoryId: string;
    actorType: string;
    adminAccountId: string | null;
    actionType: string;
    previousStatus: string;
    newStatus: string;
    actionNote: string | null;
    performedAt: string;
  }>;
}

export interface ExternalSourceItem {
  sourceMangaId: string;
  poolMangaId: string;
  title: string;
  slug: string;
  contentRating: string;
  status: string;
  chapterCount: number;
  contractName: string;
  contractVersion: string;
}

export interface EtlJobDetail {
  jobId: string;
  jobType: string;
  status: string;
  sourceSystem: string | null;
  batchSize: number;
  errorSummary: string | null;
  createdAt: string;
  completedAt: string | null;
  items?: Array<{
    jobItemId: string;
    mangaId: string | null;
    sourceMangaId: string;
    poolMangaId: string | null;
    enableCdc: boolean;
    status: string;
    attemptCount: number;
    checksumValidated: boolean | null;
    payloadSha256: string | null;
    errorMessage: string | null;
  }>;
}

export interface ActivityLogItem {
  logId: string;
  accountId: string | null;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AdminMangaStatsResponse {
  summary: {
    totalMangas: number;
    totalValidViews: number;
    totalListAdditions: number;
    totalComments: number;
    pendingReports: number;
  };
  items: Array<{
    mangaId: string;
    slug: string;
    title: string;
    visibilityStatus: string;
    validViews: number;
    listAdditions: number;
    ratingsCount: number;
    averageRating: number;
    commentsCount: number;
  }>;
}
