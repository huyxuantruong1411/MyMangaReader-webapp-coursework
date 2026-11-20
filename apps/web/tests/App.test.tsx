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

  it("renders admin console routes for active admin user", async () => {
    renderRoute("/admin/reports", ACTIVE_ADMIN);
    expect(
      screen.getByRole("heading", { name: /Admin — Moderation Reports Queue/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/No reports in this queue/i)).toBeInTheDocument();
    });
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
});
