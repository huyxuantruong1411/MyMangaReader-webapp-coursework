import type {
  ActivityLogItem,
  AdminMangaItem,
  AdminMangaStatsResponse,
  AdminReportItem,
  ApiErrorEnvelope,
  ApiPaginatedEnvelope,
  ApiSuccessEnvelope,
  AutocompleteSuggestion,
  ChapterItem,
  CommentEditHistoryItem,
  CommentItem,
  CreatorDetail,
  CreatorSearchItem,
  EtlJobDetail,
  ExternalSourceItem,
  HealthResponse,
  ListMetadataStats,
  LoginResponse,
  MangaCardItem,
  MangaDetail,
  RatingHistoryEntry,
  ReaderOpenResponse,
  ReaderSettingsData,
  ReaderStatsPayload,
  ReadingHistoryEntry,
  ReadingLibraryEntry,
  ReadingListItem,
  RecommendationPayload,
  TagItem,
  UserSummary,
} from "./apiTypes";
import { frontendConfig } from "./config";

export * from "./apiTypes";

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId?: string;
  public readonly details?: Record<string, unknown>;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "ApiClientError";
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.details = params.details;
  }
}

function createClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      sp.set(k, String(v));
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export class ApiClient {
  private readonly baseUrl: string;
  private accessTokenProvider: () => string | null = () => null;
  private onUnauthorizedRefresh: (() => Promise<boolean>) | null = null;
  private inflightRefresh: Promise<boolean> | null = null;

  constructor(baseUrl: string = frontendConfig.apiBaseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  public configureAuth(options: {
    getAccessToken: () => string | null;
    refreshSession?: () => Promise<boolean>;
  }): void {
    this.accessTokenProvider = options.getAccessToken;
    this.onUnauthorizedRefresh = options.refreshSession ?? null;
  }

  public async requestRaw<T>(
    path: string,
    init: RequestInit = {},
    allowRefreshRetry: boolean = true,
  ): Promise<T> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (!headers.has("X-Request-ID")) {
      headers.set("X-Request-ID", createClientRequestId());
    }
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const token = this.accessTokenProvider();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(`${this.baseUrl}${normalizedPath}`, {
      ...init,
      headers,
      credentials: "include",
    });

    if (
      response.status === 401 &&
      allowRefreshRetry &&
      this.onUnauthorizedRefresh &&
      !normalizedPath.startsWith("/auth/")
    ) {
      if (!this.inflightRefresh) {
        this.inflightRefresh = this.onUnauthorizedRefresh().finally(() => {
          this.inflightRefresh = null;
        });
      }
      const refreshed = await this.inflightRefresh;
      if (refreshed) {
        return this.requestRaw<T>(path, init, false);
      }
    }

    const responseRequestId = response.headers.get("X-Request-ID") ?? undefined;
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const parsed: unknown = isJson ? await response.json() : null;

    if (!response.ok) {
      const errEnv = parsed as ApiErrorEnvelope | null;
      throw new ApiClientError({
        status: response.status,
        code: errEnv?.error?.code ?? `HTTP_${response.status}`,
        message: errEnv?.error?.message ?? response.statusText ?? "Request failed",
        requestId: errEnv?.meta?.requestId ?? responseRequestId,
        details: errEnv?.error?.details,
      });
    }

    return parsed as T;
  }

  public async request<T>(
    path: string,
    init: RequestInit = {},
    allowRefreshRetry: boolean = true,
  ): Promise<ApiSuccessEnvelope<T>> {
    return this.requestRaw<ApiSuccessEnvelope<T>>(path, init, allowRefreshRetry);
  }

  // Health
  public getHealth(signal?: AbortSignal) {
    return this.request<HealthResponse>("/health", { method: "GET", signal });
  }

  // Auth & Account
  public register(body: {
    email: string;
    username: string;
    password: string;
    displayName?: string;
  }) {
    return this.request<{
      accountId: string;
      username: string;
      status: string;
      verificationRequired: boolean;
      otpTtlSeconds: number;
      devOtpPreview?: string;
    }>("/auth/register", { method: "POST", body: JSON.stringify(body) });
  }

  public verifyOtp(body: { email: string; code: string }) {
    return this.request<{ accountId: string; status: string; verified: boolean }>(
      "/auth/verify-otp",
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  public resendOtp(email: string) {
    return this.request<{ sent: boolean; otpTtlSeconds: number; devOtpPreview?: string }>(
      "/auth/resend-otp",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
    );
  }

  public login(body: { identifier: string; password: string }) {
    return this.request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  public refresh() {
    return this.request<LoginResponse>("/auth/refresh", { method: "POST" }, false);
  }

  public logout() {
    return this.request<{ loggedOut: boolean }>("/auth/logout", { method: "POST" }, false);
  }

  public getMe() {
    return this.request<UserSummary>("/account/me");
  }

  public getProfileByUsername(username: string) {
    return this.request<UserSummary>(`/profiles/${encodeURIComponent(username)}`);
  }

  public updateProfile(body: {
    displayName?: string;
    bio?: string;
    birthDate?: string | null;
    isBirthDatePublic?: boolean;
  }) {
    return this.request<UserSummary>("/account/profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  public uploadAvatar(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return this.request<UserSummary>("/account/avatar", { method: "POST", body: fd });
  }

  public changePassword(body: { currentPassword: string; newPassword: string }) {
    return this.request<{ changed: boolean; otherSessionsRevoked: boolean }>("/account/password", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  public getMyReadingStatistics() {
    return this.request<ReaderStatsPayload>("/account/me/reading-statistics");
  }

  public getMyRatingHistory(page: number = 1, pageSize: number = 20) {
    return this.requestRaw<ApiPaginatedEnvelope<RatingHistoryEntry>>(
      `/account/me/rating-history${toQuery({ page, pageSize })}`,
    );
  }

  // Catalog, Search, Creators
  public listTags() {
    return this.request<TagItem[]>("/tags");
  }

  public listCatalog(params: {
    q?: string;
    sort?: string;
    includeTags?: string;
    excludeTags?: string;
    tagMode?: string;
    demographic?: string;
    status?: string;
    contentRating?: string;
    language?: string;
    originalLanguage?: string;
    chapterLanguage?: string;
    author?: string;
    artist?: string;
    yearFrom?: number;
    yearTo?: number;
    chaptersMin?: number;
    chaptersMax?: number;
    ratingMin?: number;
    includeUnrated?: boolean;
    viewsMin?: number;
    addedDays?: number;
    hideInStatus?: boolean;
    hideInLists?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    return this.requestRaw<ApiPaginatedEnvelope<MangaCardItem>>(`/manga${toQuery(params)}`);
  }

  public autocomplete(q: string, signal?: AbortSignal) {
    return this.request<AutocompleteSuggestion[]>(`/manga/autocomplete${toQuery({ q })}`, {
      signal,
    });
  }

  public searchManga(q: string, page: number = 1) {
    return this.requestRaw<ApiPaginatedEnvelope<MangaCardItem>>(
      `/manga/search${toQuery({ q, page, pageSize: 24 })}`,
    );
  }

  public searchCreators(q: string, role?: string) {
    return this.request<CreatorSearchItem[]>(`/creators/search${toQuery({ q, role })}`);
  }

  public getMangaDetail(slugOrId: string) {
    return this.request<MangaDetail>(`/manga/${encodeURIComponent(slugOrId)}`);
  }

  public listMangaChapters(
    slugOrId: string,
    params: { language?: string; volume?: string; order?: string } = {},
  ) {
    return this.request<ChapterItem[]>(
      `/manga/${encodeURIComponent(slugOrId)}/chapters${toQuery(params)}`,
    );
  }

  public getCreatorDetail(creatorId: string) {
    return this.request<CreatorDetail>(`/creators/${encodeURIComponent(creatorId)}`);
  }

  public listCreatorManga(
    creatorId: string,
    params: { tag?: string; status?: string; sort?: string; page?: number } = {},
  ) {
    return this.requestRaw<ApiPaginatedEnvelope<MangaCardItem>>(
      `/creators/${encodeURIComponent(creatorId)}/manga${toQuery(params)}`,
    );
  }

  // Reader, Progress, History, Status
  public openReader(params: { mangaId: string; actionType: string; chapterId?: string }) {
    return this.request<ReaderOpenResponse>(`/reader/open${toQuery(params)}`);
  }

  public saveProgress(body: {
    mangaId: string;
    chapterId: string;
    pageNumber: number;
    pageUid?: string | null;
    pagesRevision: number;
    clientSequence: number;
  }) {
    return this.request<Record<string, unknown>>("/reader/progress", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  public completeViewSession(historyId: string, durationSeconds: number) {
    return this.request<Record<string, unknown>>(
      `/reader/view-session/${encodeURIComponent(historyId)}/complete`,
      { method: "POST", body: JSON.stringify({ durationSeconds }) },
    );
  }

  public getReaderSettings() {
    return this.request<ReaderSettingsData>("/reader/settings");
  }

  public updateReaderSettings(body: ReaderSettingsData) {
    return this.request<ReaderSettingsData>("/reader/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  public getReadingHistory(page: number = 1, pageSize: number = 24) {
    return this.requestRaw<ApiPaginatedEnvelope<ReadingHistoryEntry>>(
      `/reader/history${toQuery({ page, pageSize })}`,
    );
  }

  public setReadingStatus(mangaId: string, status: string) {
    return this.request<{ mangaId: string; status: string }>(
      `/manga/${encodeURIComponent(mangaId)}/reading-status`,
      { method: "PUT", body: JSON.stringify({ status }) },
    );
  }

  public clearReadingStatus(mangaId: string) {
    return this.request<{ cleared: boolean }>(
      `/manga/${encodeURIComponent(mangaId)}/reading-status`,
      { method: "DELETE" },
    );
  }

  public listMyReadingStatuses() {
    return this.request<ReadingLibraryEntry[]>("/account/me/reading-status");
  }

  // Ratings
  public upsertRating(mangaId: string, score: number) {
    return this.request<{ score: number; averageRating: number; ratingCount: number }>(
      `/manga/${encodeURIComponent(mangaId)}/rating`,
      { method: "PUT", body: JSON.stringify({ score }) },
    );
  }

  public removeRating(mangaId: string) {
    return this.request<{ removed: boolean; averageRating: number; ratingCount: number }>(
      `/manga/${encodeURIComponent(mangaId)}/rating`,
      { method: "DELETE" },
    );
  }

  // Comments & Reactions
  public listComments(params: {
    mangaId: string;
    chapterId?: string;
    scope?: string;
    sort?: string;
    page?: number;
  }) {
    return this.requestRaw<ApiPaginatedEnvelope<CommentItem>>(`/comments${toQuery(params)}`);
  }

  public createComment(body: {
    mangaId: string;
    chapterId?: string | null;
    parentCommentId?: string | null;
    content: string;
    isSpoiler: boolean;
  }) {
    return this.request<CommentItem>("/comments", { method: "POST", body: JSON.stringify(body) });
  }

  public editComment(commentId: string, body: { content: string; isSpoiler: boolean }) {
    return this.request<CommentItem>(`/comments/${encodeURIComponent(commentId)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  public deleteComment(commentId: string) {
    return this.request<{ isDeleted: boolean }>(`/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
    });
  }

  public getCommentHistory(commentId: string) {
    return this.request<CommentEditHistoryItem[]>(
      `/comments/${encodeURIComponent(commentId)}/history`,
    );
  }

  public reactComment(commentId: string, reactionType: "LIKE" | "DISLIKE" | null) {
    return this.request<{
      myReaction: "LIKE" | "DISLIKE" | null;
      likeCount: number;
      dislikeCount: number;
    }>(`/comments/${encodeURIComponent(commentId)}/reaction`, {
      method: "PUT",
      body: JSON.stringify({ reactionType }),
    });
  }

  // Reading Lists
  public listMyLists(q?: string) {
    return this.request<ReadingListItem[]>(`/lists/my${toQuery({ q })}`);
  }

  public createList(body: { name: string; description?: string }) {
    return this.request<ReadingListItem>("/lists", { method: "POST", body: JSON.stringify(body) });
  }

  public quickCreateList(body: { name: string; description?: string }) {
    return this.request<ReadingListItem>("/lists/quick-create", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  public mergeCreateList(body: {
    sourceListIds: string[];
    newName: string;
    description?: string;
    confirmEmpty?: boolean;
  }) {
    return this.request<ReadingListItem>("/lists/merge-create", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  public getListDetail(listId: string) {
    return this.request<ReadingListItem>(`/lists/${encodeURIComponent(listId)}`);
  }

  public updateList(listId: string, body: { name?: string; description?: string }) {
    return this.request<ReadingListItem>(`/lists/${encodeURIComponent(listId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  public deleteList(listId: string) {
    return this.request<{ deleted: boolean }>(`/lists/${encodeURIComponent(listId)}`, {
      method: "DELETE",
    });
  }

  public listItemsInList(
    listId: string,
    params: {
      q?: string;
      tag?: string;
      status?: string;
      readingStatus?: string;
      sort?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    return this.requestRaw<ApiPaginatedEnvelope<MangaCardItem>>(
      `/lists/${encodeURIComponent(listId)}/manga${toQuery(params)}`,
    );
  }

  public removeItemFromList(listId: string, mangaId: string) {
    return this.request<{ itemCount: number }>(
      `/lists/${encodeURIComponent(listId)}/manga/${encodeURIComponent(mangaId)}`,
      { method: "DELETE" },
    );
  }

  public getListStats(listId: string) {
    return this.request<ListMetadataStats>(`/lists/${encodeURIComponent(listId)}/metadata-stats`);
  }

  public getMangaListMemberships(mangaId: string) {
    return this.request<{
      mangaId: string;
      lists: Array<{ listId: string; name: string; itemCount: number; selected: boolean }>;
    }>(`/manga/${encodeURIComponent(mangaId)}/my-list-memberships`);
  }

  public syncMangaListMemberships(mangaId: string, selectedListIds: string[]) {
    return this.request<{
      mangaId: string;
      lists: Array<{ listId: string; name: string; itemCount: number; selected: boolean }>;
    }>(`/manga/${encodeURIComponent(mangaId)}/my-list-memberships`, {
      method: "PUT",
      body: JSON.stringify({ selectedListIds }),
    });
  }

  // Recommendations
  public getMangaRecommendations(mangaId: string, type: "ITEM_BASED" | "CONTENT_BASED", limit = 6) {
    return this.request<RecommendationPayload>(
      `/manga/${encodeURIComponent(mangaId)}/recommendations${toQuery({ type, limit })}`,
    );
  }

  public getMyRecommendations(limit = 6) {
    return this.request<RecommendationPayload>(`/recommendations/me${toQuery({ limit })}`);
  }

  // Reader Reports
  public reportAccount(body: {
    targetAccountId: string;
    reasonCategory: string;
    description?: string;
  }) {
    return this.request<{ reportId: string; status: string }>("/reports/account", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  public reportManga(body: {
    targetMangaId: string;
    targetChapterId?: string | null;
    reasonCategory: string;
    description?: string;
  }) {
    return this.request<{ reportId: string; status: string }>("/reports/manga", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  public reportComment(body: {
    targetCommentId: string;
    reasonCategory: string;
    description?: string;
  }) {
    return this.request<{ reportId: string; status: string }>("/reports/comment", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Admin APIs
  public adminListAccounts(params: { q?: string; status?: string; page?: number } = {}) {
    return this.requestRaw<ApiPaginatedEnvelope<UserSummary>>(`/admin/accounts${toQuery(params)}`);
  }

  public adminLockAccount(accountId: string, reason: string) {
    return this.request<Record<string, unknown>>(
      `/admin/accounts/${encodeURIComponent(accountId)}/lock`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  }

  public adminUnlockAccount(accountId: string, reason: string) {
    return this.request<Record<string, unknown>>(
      `/admin/accounts/${encodeURIComponent(accountId)}/unlock`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  }

  public adminListActivityLogs(
    params: { accountId?: string; eventType?: string; page?: number } = {},
  ) {
    return this.requestRaw<ApiPaginatedEnvelope<ActivityLogItem>>(
      `/admin/activity-logs${toQuery(params)}`,
    );
  }

  public adminGetReaderStats(accountId: string) {
    return this.request<ReaderStatsPayload>(
      `/admin/accounts/${encodeURIComponent(accountId)}/reading-statistics`,
    );
  }

  public adminListManga(params: { q?: string; visibility?: string; page?: number } = {}) {
    return this.requestRaw<ApiPaginatedEnvelope<AdminMangaItem>>(`/admin/manga${toQuery(params)}`);
  }

  public adminHideManga(mangaId: string, reason: string) {
    return this.request<Record<string, unknown>>(
      `/admin/manga/${encodeURIComponent(mangaId)}/hide`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  }

  public adminShowManga(mangaId: string, reason?: string) {
    return this.request<Record<string, unknown>>(
      `/admin/manga/${encodeURIComponent(mangaId)}/show`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  }

  public adminDeleteManga(mangaId: string, reason: string) {
    return this.request<Record<string, unknown>>(
      `/admin/manga/${encodeURIComponent(mangaId)}/delete`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  }

  public adminToggleCdc(mangaId: string, enable: boolean) {
    return this.request<Record<string, unknown>>(
      `/admin/manga/${encodeURIComponent(mangaId)}/cdc/${enable ? "enable" : "disable"}`,
      { method: "POST" },
    );
  }

  public adminListReports(params: { reportType?: string; status?: string; page?: number } = {}) {
    return this.requestRaw<ApiPaginatedEnvelope<AdminReportItem>>(
      `/admin/reports${toQuery(params)}`,
    );
  }

  public adminGetReportDetail(reportId: string) {
    return this.request<AdminReportItem>(`/admin/reports/${encodeURIComponent(reportId)}`);
  }

  public adminResolveReport(
    reportId: string,
    body: { actionType: string; note: string; ignoreFutureReports?: boolean },
  ) {
    return this.request<AdminReportItem>(`/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  public adminListExternalSources() {
    return this.request<ExternalSourceItem[]>("/admin/external-sources");
  }

  public adminStartEtlSync(
    items: Array<{
      sourceMangaId?: string;
      poolMangaId?: string;
      enableCdc: boolean;
      packagePayload?: Record<string, unknown>;
    }>,
  ) {
    return this.request<EtlJobDetail>("/admin/etl-sync", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  }

  public adminListEtlJobs(page: number = 1) {
    return this.requestRaw<ApiPaginatedEnvelope<EtlJobDetail>>(
      `/admin/etl-jobs${toQuery({ page, pageSize: 20 })}`,
    );
  }

  public adminGetEtlJob(jobId: string) {
    return this.request<EtlJobDetail>(`/admin/etl-jobs/${encodeURIComponent(jobId)}`);
  }

  public adminRetryEtlItem(jobItemId: string) {
    return this.request<EtlJobDetail>(
      `/admin/etl-job-items/${encodeURIComponent(jobItemId)}/retry`,
      { method: "POST" },
    );
  }

  public adminMangaStatistics() {
    return this.request<AdminMangaStatsResponse>("/admin/manga/statistics");
  }

  public adminReconcileCounters() {
    return this.request<{ fixedLists: number; fixedComments: number; fixedRatings: number }>(
      "/admin/reconcile",
      { method: "POST" },
    );
  }
}

export const apiClient = new ApiClient();
