import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../src/app/App";
import { AppRoutes } from "../src/app/router";
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  NotFoundState,
} from "../src/components/StateViews";
import type { AuthUser } from "../src/services/authStore";

function renderRoute(initialPath: string, initialUser: AuthUser | null = null) {
  return render(
    <AppProviders initialUser={initialUser}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

const ACTIVE_READER: AuthUser = {
  accountId: "11111111-1111-4111-8111-111111111111",
  username: "reader01",
  displayName: "Reader One",
  role: "READER",
  status: "ACTIVE",
};

const ACTIVE_ADMIN: AuthUser = {
  accountId: "22222222-2222-4222-8222-222222222222",
  username: "admin01",
  displayName: "Admin One",
  role: "ADMIN",
  status: "ACTIVE",
};

function makeJsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json", "X-Request-ID": "req-test" }),
    json: async () => payload,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();

  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/tags")) {
        return makeJsonResponse({
          data: [
            { slug: "action", name: "Action", group: "genre" },
            { slug: "fantasy", name: "Fantasy", group: "genre" },
          ],
          meta: { requestId: "req-test" },
        });
      }

      if (url.includes("/manga/azure-blade/chapters")) {
        return makeJsonResponse({
          data: [
            {
              chapterId: "ch-10",
              mangaId: "m-1",
              chapterNumber: "10",
              chapterNumeric: 10,
              volume: "2",
              title: "The Awakening",
              language: "en",
              scanlationGroup: "Demo Scans",
              pageCount: 4,
              pagesRevision: 1,
              viewCount: 120,
              publishAt: "2026-11-20T00:00:00Z",
            },
          ],
          meta: { requestId: "req-test" },
        });
      }

      if (url.includes("/manga/azure-blade/recommendations")) {
        return makeJsonResponse({
          data: {
            method: "CONTENT_BASED",
            modelVersion: "tfidf-v1",
            fallbackReason: null,
            items: [],
          },
          meta: { requestId: "req-test" },
        });
      }

      if (url.includes("/manga/azure-blade")) {
        return makeJsonResponse({
          data: {
            mangaId: "m-1",
            slug: "azure-blade",
            title: "Chronicles of the Azure Blade",
            altTitles: ["Ao no Yaiba"],
            description: "An epic blade story.",
            publicationStatus: "ongoing",
            contentRating: "safe",
            publicationDemographic: "shounen",
            originalLanguage: "ja",
            year: 2024,
            publishedStartDate: null,
            publishedEndDate: null,
            officialVolumes: 5,
            officialChapters: 50,
            coverUrl: null,
            coverArts: [],
            creators: [
              {
                creatorId: "cr-1",
                slug: "akira",
                name: "Akira Kuroda",
                roles: ["author", "artist"],
              },
            ],
            tags: [{ slug: "action", name: "Action", group: "genre" }],
            links: [],
            stats: {
              exportedChapterCount: 10,
              exportedPageCount: 200,
              totalSizeBytes: 1000,
              languages: ["en", "vi"],
            },
            totalViews: 1200,
            averageRating: 9.2,
            ratingCount: 15,
            latestChapter: null,
            updatedAt: "2026-11-20T00:00:00Z",
            viewerState: {
              readingStatus: "READING",
              progress: {
                chapterId: "ch-10",
                pageNumber: 2,
                pageUid: "p-2",
                updatedAt: "2026-11-20T00:00:00Z",
              },
              myRating: 9,
              canRate: true,
            },
          },
          meta: { requestId: "req-test" },
        });
      }

      if (url.includes("/account/me/reading-status")) {
        return makeJsonResponse({
          data: [
            {
              mangaId: "m-1",
              slug: "azure-blade",
              title: "Chronicles of the Azure Blade",
              coverUrl: null,
              publicationStatus: "ongoing",
              contentRating: "safe",
              publicationDemographic: "shounen",
              originalLanguage: "ja",
              year: 2024,
              totalViews: 1200,
              averageRating: 9.2,
              latestChapter: null,
              tags: [{ slug: "action", name: "Action", group: "genre" }],
              updatedAt: "2026-11-20T00:00:00Z",
              status: "READING",
              readingStatus: "READING",
              progress: { chapterId: "ch-10", pageNumber: 2, updatedAt: "2026-11-20T00:00:00Z" },
            },
          ],
          meta: { requestId: "req-test" },
        });
      }

      if (url.includes("/comments")) {
        return makeJsonResponse({
          data: [],
          meta: { requestId: "req-test", page: 1, pageSize: 20, total: 0, hasNext: false },
        });
      }

      if (url.includes("/manga?") || url.endsWith("/manga")) {
        return makeJsonResponse({
          data: [
            {
              mangaId: "m-1",
              slug: "azure-blade",
              title: "Chronicles of the Azure Blade",
              coverUrl: null,
              publicationStatus: "ongoing",
              contentRating: "safe",
              publicationDemographic: "shounen",
              originalLanguage: "ja",
              year: 2024,
              totalViews: 1200,
              averageRating: 9.2,
              latestChapter: {
                chapterId: "ch-10",
                chapterNumber: "10",
                title: "The Awakening",
                language: "en",
                publishAt: null,
              },
              tags: [{ slug: "action", name: "Action", group: "genre" }],
              updatedAt: "2026-11-20T00:00:00Z",
            },
          ],
          meta: { requestId: "req-test", page: 1, pageSize: 12, total: 1, hasNext: false },
        });
      }

      if (url.includes("/reader/open")) {
        return makeJsonResponse({
          data: {
            manga: { mangaId: "m-1", slug: "azure-blade", title: "Chronicles of the Azure Blade" },
            chapter: {
              chapterId: "ch-10",
              chapterNumber: "10",
              chapterNumeric: 10,
              volume: "2",
              title: "The Awakening",
              language: "en",
              scanlationGroup: "Demo Scans",
              pagesRevision: 1,
              pageCount: 4,
            },
            initialPage: 1,
            resumeNote: null,
            pages: [
              {
                pageNumber: 1,
                pageUid: "p-1",
                filename: "001.webp",
                width: 800,
                height: 1200,
                contentType: "image/webp",
                url: "/api/v1/media/b/1.webp?exp=9&sig=x",
              },
              {
                pageNumber: 2,
                pageUid: "p-2",
                filename: "002.webp",
                width: 800,
                height: 1200,
                contentType: "image/webp",
                url: "/api/v1/media/b/2.webp?exp=9&sig=x",
              },
              {
                pageNumber: 3,
                pageUid: "p-3",
                filename: "003.webp",
                width: 800,
                height: 1200,
                contentType: "image/webp",
                url: "/api/v1/media/b/3.webp?exp=9&sig=x",
              },
              {
                pageNumber: 4,
                pageUid: "p-4",
                filename: "004.webp",
                width: 800,
                height: 1200,
                contentType: "image/webp",
                url: "/api/v1/media/b/4.webp?exp=9&sig=x",
              },
            ],
            prevChapter: null,
            nextChapter: { chapterId: "ch-11", chapterNumber: "11", title: "Next", language: "en" },
            historyId: null,
            settings: {
              displayMode: "SINGLE_PAGE",
              readingDirection: "LTR",
              fitMode: "FIT_WIDTH",
              preloadPageCount: 3,
            },
          },
          meta: { requestId: "req-test" },
        });
      }

      if (url.includes("/lists/list-42/metadata-stats")) {
        return makeJsonResponse({
          data: {
            empty: true,
            emptyMessage: "Danh sách chưa có truyện nào để thống kê",
            totalMangas: 0,
            totalExportedChapters: 0,
            tagDistribution: [],
            publicationStatusDistribution: [],
            averageListRating: null,
            ratedMangaCount: 0,
            topCreators: [],
            calculatedAt: "2026-11-20T12:00:00Z",
          },
          meta: { requestId: "req-test" },
        });
      }

      if (url.includes("/lists/list-42/manga")) {
        return makeJsonResponse({
          data: [],
          meta: { requestId: "req-test", page: 1, pageSize: 24, total: 0, hasNext: false },
        });
      }

      if (url.includes("/lists/list-42")) {
        return makeJsonResponse({
          data: {
            listId: "list-42",
            name: "Weekend Action Picks",
            description: "Curated action manga",
            itemCount: 0,
            visibility: "PRIVATE",
            createdAt: "2026-11-20T00:00:00Z",
            updatedAt: "2026-11-20T00:00:00Z",
          },
          meta: { requestId: "req-test" },
        });
      }

      if (url.includes("/reader/history")) {
        return makeJsonResponse({
          data: [
            {
              historyId: "hist-1",
              mangaId: "m-1",
              mangaSlug: "azure-blade",
              mangaTitle: "Chronicles of the Azure Blade",
              mangaCoverUrl: "/api/v1/media/manga-media/covers/azure.jpg?exp=9&sig=x",
              chapterId: "ch-10",
              chapterNumber: "10",
              chapterTitle: "The Awakening",
              openedAt: "2026-11-20T09:00:00Z",
              readingDurationSeconds: 42,
              isValidView: true,
              resumePageNumber: 3,
              resumeChapterId: "ch-10",
            },
          ],
          meta: { requestId: "req-test", page: 1, pageSize: 24, total: 1, hasNext: false },
        });
      }

      if (url.includes("/admin/accounts/11111111-1111-4111-8111-111111111111/reading-statistics")) {
        return makeJsonResponse({
          data: {
            accountId: "11111111-1111-4111-8111-111111111111",
            hasData: true,
            chapterOpens: 14,
            validViews: 11,
            uniqueChaptersRead: 10,
            uniqueMangasInteracted: 4,
            ratingsCount: 2,
            averageRatingGiven: 8.5,
            readingStatusBreakdown: { READING: 3, COMPLETED: 1 },
            topTags: [{ slug: "action", name: "Action", count: 4 }],
            topCreators: [{ creatorId: "cr-1", name: "Akira Kuroda", workCount: 2 }],
          },
          meta: { requestId: "req-test" },
        });
      }

      if (url.includes("/admin/accounts")) {
        return makeJsonResponse({
          data: [ACTIVE_READER],
          meta: { requestId: "req-test", page: 1, pageSize: 24, total: 1, hasNext: false },
        });
      }

      if (url.includes("/admin/activity-logs")) {
        return makeJsonResponse({
          data: [
            {
              logId: "log-1",
              accountId: ACTIVE_READER.accountId,
              eventType: "AVATAR_UPDATE",
              targetType: "ACCOUNT",
              targetId: ACTIVE_READER.accountId,
              ipAddress: "127.0.0.1",
              details: { bucket: "manga-media" },
              createdAt: "2026-11-20T10:00:00Z",
            },
          ],
          meta: { requestId: "req-test", page: 1, pageSize: 30, total: 1, hasNext: false },
        });
      }

      if (url.includes("/admin/reports/rep-1")) {
        return makeJsonResponse({
          data: {
            reportId: "rep-1",
            reportType: "COMMENT",
            status: "PENDING",
            reasonCategory: "SPOILER_UNMARKED",
            description: "Contains ending spoiler",
            reporter: { accountId: "u-2", username: "reporter02" },
            targetExists: true,
            target: {
              targetId: "c-1",
              commentAuthorId: "u-3",
              commentAuthorUsername: "spoileruser",
              commentAuthorDisplayName: "Spoiler User",
              mangaId: "m-1",
              mangaTitle: "Chronicles of the Azure Blade",
              mangaSlug: "azure-blade",
              snapshot: "Ending spoiler text preview",
              isDeleted: false,
              isSpoilerLocked: false,
            },
            allowedActions: ["DELETE_COMMENT", "FORCE_SPOILER", "LOCK_ACCOUNT", "IGNORE"],
            actionTaken: null,
            resolutionNote: null,
            createdAt: "2026-11-20T10:00:00Z",
            resolvedAt: null,
            actionHistory: [],
          },
          meta: { requestId: "req-test" },
        });
      }

      if (url.endsWith("/account/avatar")) {
        return makeJsonResponse({
          data: {
            ...ACTIVE_READER,
            avatarUrl: "/api/v1/media/manga-media/avatars/new-avatar.png?exp=9&sig=x",
          },
          meta: { requestId: "req-test" },
        });
      }

      if (url.endsWith("/account/me")) {
        return makeJsonResponse({
          data: ACTIVE_READER,
          meta: { requestId: "req-test" },
        });
      }

      if (url.includes("/profiles/reader01")) {
        return makeJsonResponse({
          data: {
            ...ACTIVE_READER,
            bio: "Manga fan",
            birthDate: null,
            isBirthDatePublic: false,
            createdAt: "2026-11-20T00:00:00Z",
          },
          meta: { requestId: "req-test" },
        });
      }

      if (url.includes("/admin/reports")) {
        return makeJsonResponse({
          data: [],
          meta: { requestId: "req-test", page: 1, pageSize: 20, total: 0, hasNext: false },
        });
      }

      return makeJsonResponse({
        data: {},
        meta: { requestId: "req-test" },
      });
    }),
  );
});

describe("Manga Reader Frontend Application", () => {
  it("renders home discovery hub and seeded manga cards", async () => {
    renderRoute("/");
    expect(
      screen.getByRole("heading", { name: /Read, Track, and Discover Manga/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText("Chronicles of the Azure Blade").length).toBeGreaterThan(0);
    });
  });

  it("preserves exact active page when switching Reader display modes", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "mr_guest_reader_settings",
      JSON.stringify({
        displayMode: "SINGLE_PAGE",
        readingDirection: "LTR",
        fitMode: "FIT_WIDTH",
        preloadPageCount: 3,
      }),
    );

    renderRoute("/manga/azure-blade/chapter/ch-10");
    await waitFor(() => {
      expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent("Page 1 / 4");
    });

    await user.click(screen.getByRole("button", { name: /Next Page/i }));
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent("Page 2 / 4");

    await user.click(screen.getByRole("button", { name: /Settings/i }));
    const modeSelect = screen.getByLabelText(/Display Mode/i);
    await user.selectOptions(modeSelect, "VERTICAL_WEBTOON");
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent("Page 2 / 4");

    await user.selectOptions(modeSelect, "DOUBLE_PAGE");
    expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent("Page 2 / 4");
  });

  it("enforces authenticated boundary for personal routes", () => {
    renderRoute("/reading-lists", null);
    expect(screen.getByRole("heading", { name: /Sign in required/i })).toBeInTheDocument();
    const signInLinks = screen.getAllByRole("link", { name: /Sign In/i });
    expect(
      signInLinks.some((el) => el.getAttribute("href") === "/login?next=%2Freading-lists"),
    ).toBe(true);
  });

  it("renders login screen with local dev demo autofill buttons", async () => {
    const user = userEvent.setup();
    renderRoute("/login", null);
    expect(screen.getByRole("heading", { name: /Sign In/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Reader 1 \(reader1\)/i }));
    expect(screen.getByLabelText(/Username or Email/i)).toHaveValue("reader1");
  });

  it("renders explore filter drawer and tags from catalog API", async () => {
    const user = userEvent.setup();
    renderRoute("/explore", null);
    expect(screen.getByRole("heading", { name: /Explore Catalog/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Filters/i }));
    expect(screen.getByRole("region", { name: /Advanced filters/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply Filters/i })).toBeInTheDocument();

    // Verify tri-state tag cycling (Neutral -> Include -> Exclude -> Neutral) and active chips
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Action \(Not selected\)/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Action \(Not selected\)/i }));
    expect(screen.getByRole("button", { name: /Action \(Included\)/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Apply Filters/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Remove filter \+ Action/i })).toBeInTheDocument();
    });
  });

  it("renders personal reading library route with canonical 5 statuses", async () => {
    renderRoute("/library", ACTIVE_READER);
    expect(screen.getByRole("heading", { name: /Personal Reading Library/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Chronicles of the Azure Blade")).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: /Reading \(1\)/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Re-Reading/i })).not.toBeInTheDocument();
  });

  it("renders manga detail without unsupported RE_READING status and with clickable tags", async () => {
    renderRoute("/manga/azure-blade", ACTIVE_READER);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Chronicles of the Azure Blade" }),
      ).toBeInTheDocument();
    });
    const statusSelect = screen.getByLabelText("Reading status");
    expect(statusSelect).toHaveValue("READING");
    expect(screen.queryByRole("option", { name: /Re-Reading/i })).not.toBeInTheDocument();
    const actionTagLink = screen.getByRole("link", { name: "Action" });
    expect(actionTagLink).toHaveAttribute("href", "/explore?includeTags=action");
  });

  it("uses canonical lowercase creator roles in SearchPage filter", () => {
    renderRoute("/search?tab=creators&q=Akira", null);
    const roleSelect = screen.getByLabelText("Filter creator role");
    const authorOpt = screen.getByRole("option", { name: "Author" }) as HTMLOptionElement;
    const artistOpt = screen.getByRole("option", { name: "Artist" }) as HTMLOptionElement;
    expect(roleSelect).toBeInTheDocument();
    expect(authorOpt.value).toBe("author");
    expect(artistOpt.value).toBe("artist");
  });

  it("renders private reading list detail and exact empty Vietnamese metadata stats copy", async () => {
    const user = userEvent.setup();
    renderRoute("/reading-lists/list-42", ACTIVE_READER);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Weekend Action Picks/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Dynamic Metadata Statistics/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Danh sách chưa có truyện nào để thống kê/i }),
      ).toBeInTheDocument();
    });
  });

  it("blocks non-admin readers from admin layout boundary", () => {
    renderRoute("/admin/etl", ACTIVE_READER);
    expect(
      screen.getByRole("heading", { name: /Administrator access required/i }),
    ).toBeInTheDocument();
  });

  it("renders admin console routes for active admin user and holds external ETL UI", async () => {
    renderRoute("/admin/reports", ACTIVE_ADMIN);
    expect(
      screen.getByRole("heading", { name: /Admin — Moderation Reports Queue/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Source ETL & CDC/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/No reports in this queue/i)).toBeInTheDocument();
    });
  });

  it("displays explicit on-hold state when navigating directly to /admin/etl", () => {
    renderRoute("/admin/etl", ACTIVE_ADMIN);
    expect(
      screen.getByRole("heading", { name: /External ETL & CDC Integration Paused/i }),
    ).toBeInTheDocument();
  });

  it("renders 404 NotFound fallback for unknown routes", () => {
    renderRoute("/this-route-does-not-exist");
    expect(screen.getByRole("heading", { name: /Page not found/i })).toBeInTheDocument();
  });

  it("renders standardized state components cleanly", () => {
    render(
      <MemoryRouter>
        <LoadingState />
        <EmptyState title="Nothing here" />
        <ErrorState onRetry={() => {}} />
        <ForbiddenState />
        <NotFoundState />
      </MemoryRouter>,
    );
    expect(screen.getByText("Loading content...")).toBeInTheDocument();
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("403 Forbidden")).toBeInTheDocument();
    expect(screen.getByText("404 Not Found")).toBeInTheDocument();
  });

  it("opens Reader Comments drawer and Chapter selector modal right inside viewport", async () => {
    const user = userEvent.setup();
    renderRoute("/manga/azure-blade/chapter/ch-10");
    await waitFor(() => {
      expect(screen.getByTestId("reader-page-indicator")).toHaveTextContent("Page 1 / 4");
    });

    await user.click(screen.getByRole("button", { name: "💬 Comments" }));
    expect(screen.getByRole("dialog", { name: /Chapter comments drawer/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Close comments drawer/i }));
    expect(
      screen.queryByRole("dialog", { name: /Chapter comments drawer/i }),
    ).not.toBeInTheDocument();
  });

  it("opens /search/advanced with full filters and Android-style category tabs immediately visible", async () => {
    renderRoute("/search/advanced", null);
    expect(screen.getByRole("heading", { name: /Advanced Manga Search/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Advanced filters/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All Categories/i })).toBeInTheDocument();
  });

  it("renders manga cover art in Reading History", async () => {
    renderRoute("/history", ACTIVE_READER);
    await waitFor(() => {
      expect(screen.getByText("Chronicles of the Azure Blade")).toBeInTheDocument();
    });
    const cover = screen.getByRole("img", { name: "Chronicles of the Azure Blade" });
    expect(cover).toHaveAttribute("src", "/api/v1/media/manga-media/covers/azure.jpg?exp=9&sig=x");
  });

  it("opens human-readable Logs & Stats modal in AdminAccountsPage without raw JSON", async () => {
    const user = userEvent.setup();
    renderRoute("/admin/accounts", ACTIVE_ADMIN);
    await waitFor(() => {
      expect(screen.getByText("Reader One")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Logs & Stats/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: /Account logs and statistics/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Reader Behavior Statistics")).toBeInTheDocument();
    expect(screen.getAllByText(/Uploaded new profile avatar/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/"bucket":/)).not.toBeInTheDocument();
  });

  it("uploads a chosen image file as avatar in AccountSettingsPage without presets", async () => {
    const user = userEvent.setup();
    renderRoute("/settings", ACTIVE_READER);

    expect(screen.getByText(/Current Avatar/i)).toBeInTheDocument();
    expect(screen.queryByText(/Quick Preset Avatars/i)).not.toBeInTheDocument();

    const fileInput = screen.getByLabelText(/Choose avatar image file/i) as HTMLInputElement;
    const pngFile = new File([new Uint8Array([137, 80, 78, 71])], "my-avatar.png", {
      type: "image/png",
    });
    await user.upload(fileInput, pngFile);

    expect(screen.getByText(/my-avatar\.png/i)).toBeInTheDocument();
    const uploadBtn = screen.getByRole("button", { name: /^Upload Avatar$/i });
    expect(uploadBtn).toBeEnabled();
    await user.click(uploadBtn);

    await waitFor(() => {
      expect(screen.getByText(/Avatar image uploaded and updated\./i)).toBeInTheDocument();
    });
  });

  it("uploads a chosen image file directly from own ProfilePage", async () => {
    const user = userEvent.setup();
    renderRoute("/profile/reader01", ACTIVE_READER);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Upload Avatar Image/i })).toBeInTheDocument();
    });

    const fileInput = screen.getByLabelText(/Upload new avatar image/i) as HTMLInputElement;
    const pngFile = new File([new Uint8Array([137, 80, 78, 71])], "profile-pic.png", {
      type: "image/png",
    });
    await user.upload(fileInput, pngFile);

    await waitFor(() => {
      expect(screen.getByText(/Avatar image updated successfully\./i)).toBeInTheDocument();
    });
  });

  it("removes redundant Search link from header nav while preserving Explore and Advanced Search", () => {
    renderRoute("/", null);
    expect(screen.getAllByRole("link", { name: /^Explore$/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /^Advanced Search$/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /^Search$/i })).not.toBeInTheDocument();
  });

  it("renders localized Also Known As badges, Cover Art locale filter, and Volume/No Volume chapter groups", async () => {
    const user = userEvent.setup();
    const prevFetch = globalThis.fetch;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/manga/azure-blade/chapters")) {
        return makeJsonResponse({
          data: [
            {
              chapterId: "ch-vol1",
              mangaId: "m-1",
              chapterNumber: "1",
              chapterNumeric: 1,
              volume: "1",
              title: "Departure",
              language: "en",
              scanlationGroup: "Demo Scans",
              pageCount: 20,
              isExported: false,
              publishAt: null,
              createdAt: "2026-11-20T00:00:00Z",
              readProgress: null,
            },
            {
              chapterId: "ch-extra",
              mangaId: "m-1",
              chapterNumber: "0.5",
              chapterNumeric: 0.5,
              volume: null,
              title: "Prologue Oneshot",
              language: "en",
              scanlationGroup: "Demo Scans",
              pageCount: 12,
              isExported: false,
              publishAt: null,
              createdAt: "2026-11-20T00:00:00Z",
              readProgress: null,
            },
          ],
          meta: { requestId: "req-test", page: 1, pageSize: 50, total: 2, hasNext: false },
        });
      }
      if (url.endsWith("/manga/azure-blade") || url.includes("/manga/azure-blade?")) {
        const res = await prevFetch(input, init);
        const payload = (await res.json()) as { data: Record<string, unknown>; meta: unknown };
        payload.data.creators = [
          {
            creatorId: "cr-asano",
            slug: "cr-asano",
            name: "Asano Inio",
            roles: ["author", "artist"],
          },
        ];
        payload.data.altTitles = ["おやすみプンプン", "Bonne nuit Punpun"];
        payload.data.altTitleEntries = [
          { title: "おやすみプンプン", languageCode: "ja" },
          { title: "Bonne nuit Punpun", languageCode: "fr" },
        ];
        payload.data.coverArts = [
          {
            coverId: "cov-ja",
            volume: "1",
            locale: "ja",
            description: "Japanese Vol 1",
            url: "/api/v1/media/manga-media/covers/ja-v1.jpg",
          },
          {
            coverId: "cov-en",
            volume: "1",
            locale: "en",
            description: "English Vol 1",
            url: "/api/v1/media/manga-media/covers/en-v1.jpg",
          },
        ];
        return makeJsonResponse(payload);
      }
      return prevFetch(input, init);
    });

    renderRoute("/manga/azure-blade", ACTIVE_READER);
    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: /Asano Inio/i }).length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByText(/Authors \(Story\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Artists \(Illustration\)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/おやすみプンプン/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /Cover Art Gallery/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All Locales/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Chapters \(2\)/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/Unassigned · No Volume/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /English.*\(1\)/i }));
    expect(screen.getAllByText(/Volume 1/i).length).toBeGreaterThan(0);
  });

  it("formats markdown author biography cleanly without raw asterisks", async () => {
    const prevFetch = globalThis.fetch;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/creators/cr-rikitake/manga")) {
        return makeJsonResponse({
          data: [],
          meta: { requestId: "req-test", page: 1, pageSize: 20, total: 0, hasNext: false },
        });
      }
      if (url.includes("/creators/cr-rikitake")) {
        return makeJsonResponse({
          data: {
            creatorId: "cr-rikitake",
            slug: "cr-rikitake",
            name: "Rikitake",
            roles: ["author", "artist"],
            biography: "**Native Name:** リキタケ\n\nKnown for psychological drama.",
            localizedBiographies: {
              en: "**Native Name:** リキタケ\n\nKnown for psychological drama.",
            },
            links: {},
            workCount: 0,
            totalViews: 0,
            averageRating: null,
          },
          meta: { requestId: "req-test" },
        });
      }
      return prevFetch(input, init);
    });

    renderRoute("/author/cr-rikitake/rikitake", null);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Rikitake" })).toBeInTheDocument();
    });
    expect(screen.getByText("Native Name:")).toBeInTheDocument();
    expect(screen.getByText(/リキタケ/)).toBeInTheDocument();
    expect(screen.queryByText(/\*\*Native Name:\*\*/)).not.toBeInTheDocument();
  });

  it("renders Reader Experience Studio and Data Storytelling stats in SettingsPage including for admins", async () => {
    const user = userEvent.setup();
    const prevFetch = globalThis.fetch;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/account/me/reading-statistics")) {
        return makeJsonResponse({
          data: {
            accountId: ACTIVE_ADMIN.accountId,
            hasData: true,
            chapterOpens: 42,
            validViews: 35,
            uniqueChaptersRead: 32,
            uniqueMangasInteracted: 5,
            ratingsCount: 3,
            averageRatingGiven: 8.6,
            readingStatusBreakdown: { READING: 2, COMPLETED: 2, PLAN_TO_READ: 1 },
            topTags: [
              { slug: "drama", name: "Drama", count: 18 },
              { slug: "psychological", name: "Psychological", count: 12 },
              { slug: "action", name: "Action", count: 9 },
            ],
            topCreators: [
              {
                creatorId: "cr-asano",
                name: "Asano Inio",
                workCount: 3,
                roles: ["author", "artist"],
              },
            ],
          },
          meta: { requestId: "req-test" },
        });
      }
      return prevFetch(input, init);
    });

    renderRoute("/settings", ACTIVE_ADMIN);
    await user.click(screen.getByRole("button", { name: /Password & Security/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Confirm New Password/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Password Strength/i)).toBeInTheDocument();
    expect(screen.getByText(/Reset Password via OTP/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Reader Preferences/i }));
    await waitFor(() => {
      expect(screen.getByText(/Live Reader Simulator/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /My Reading Stats/i }));
    await waitFor(() => {
      expect(screen.getByText(/Reading Commitment Funnel/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Personal Reading Intelligence/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Library Lifecycle Distribution/i)).toBeInTheDocument();
    expect(screen.getByText(/Top Genres Radar/i)).toBeInTheDocument();
    expect(screen.getByText(/Top Authors \(Story\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Top Artists \(Illustration\)/i)).toBeInTheDocument();
  });

  it("renders AdminReportsPage triage KPI workbench and auto-selects pending report", async () => {
    const prevFetch = globalThis.fetch;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/admin/reports?") || url.endsWith("/admin/reports")) {
        return makeJsonResponse({
          data: [
            {
              reportId: "rep-1",
              reportType: "COMMENT",
              status: "PENDING",
              reasonCategory: "SPOILER_UNMARKED",
              description: "Contains ending spoiler",
              reporter: { accountId: "u-2", username: "reporter02" },
              targetSummary: {
                targetId: "c-1",
                commentAuthorId: "u-1",
                commentAuthorUsername: "reader01",
                mangaTitle: "Chronicles of the Azure Blade",
                mangaSlug: "azure-blade",
                snapshot: "Ending spoiler text preview",
                isDeleted: false,
                isSpoilerLocked: false,
              },
              actionTaken: null,
              createdAt: "2026-11-20T10:00:00Z",
              resolvedAt: null,
            },
          ],
          meta: { requestId: "req-test", page: 1, pageSize: 20, total: 1, hasNext: false },
        });
      }
      return prevFetch(input, init);
    });

    renderRoute("/admin/reports", ACTIVE_ADMIN);
    await waitFor(() => {
      expect(screen.getByText(/Total Matching Reports/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Pending on Page/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Case Inspector · COMMENT/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Moderation Decision/i)).toBeInTheDocument();
  });

  it("completes 3-step Forgot Password Email OTP recovery flow", async () => {
    const user = userEvent.setup();
    const prevFetch = globalThis.fetch;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/auth/forgot-password")) {
        return makeJsonResponse({
          data: {
            sent: true,
            email: "reader01@example.com",
            username: "reader01",
            otpTtlSeconds: 120,
          },
          meta: { requestId: "req-test" },
        });
      }
      if (url.endsWith("/auth/verify-reset-otp")) {
        return makeJsonResponse({
          data: {
            valid: true,
            email: "reader01@example.com",
            username: "reader01",
          },
          meta: { requestId: "req-test" },
        });
      }
      if (url.endsWith("/auth/reset-password")) {
        return makeJsonResponse({
          data: {
            reset: true,
            email: "reader01@example.com",
            username: "reader01",
            sessionsRevoked: true,
          },
          meta: { requestId: "req-test" },
        });
      }
      return prevFetch(input, init);
    });

    renderRoute("/forgot-password", null);
    await user.type(screen.getByLabelText(/Email Address or Username/i), "reader01");
    await user.click(screen.getByRole("button", { name: /Send Reset OTP to Email/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/6-digit Reset OTP/i)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/6-digit Reset OTP/i), "654321");
    await user.click(screen.getByRole("button", { name: /Verify OTP Code/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/New Strong Password/i)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/New Strong Password/i), "StrongPass@99");
    await user.type(screen.getByLabelText(/Confirm New Password/i), "StrongPass@99");
    await user.click(screen.getByRole("button", { name: /Reset Password & Sign In/i }));

    await waitFor(() => {
      expect(screen.getByText(/Password updated successfully for @reader01/i)).toBeInTheDocument();
    });
  });
});
