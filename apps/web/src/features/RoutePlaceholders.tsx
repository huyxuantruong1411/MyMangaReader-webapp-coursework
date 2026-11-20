import { Link, useParams } from "react-router-dom";
import { PlaceholderPage } from "../components/PlaceholderPage";
import { useHealthStatus } from "../hooks/useHealthStatus";

export function HomePage() {
  const health = useHealthStatus();

  return (
    <div className="space-y-6">
      <PlaceholderPage
        title="Home / Discovery Hub"
        routePattern="/"
        roadmapPhase="Phase 5 — Catalog & Discovery"
        ucRefs="UC-3, UC-3.1, UC-3.7..3.9"
        description="Public entry frame for latest updates, featured public manga, continue-reading strip, and recommendations. Strictly enforces PUBLIC visibility."
      />

      <section
        aria-label="Backend connectivity status"
        className="rounded-[var(--mr-radius-lg)] border p-5"
        style={{
          backgroundColor: "var(--mr-bg-surface)",
          borderColor: "var(--mr-border-subtle)",
        }}
      >
        <h2 className="text-sm font-semibold" style={{ color: "var(--mr-text-primary)" }}>
          Foundation API Connectivity
        </h2>
        <p className="mt-1 text-xs" style={{ color: "var(--mr-text-secondary)" }}>
          {health.isLoading
            ? "Checking /api/v1/health..."
            : health.isError
              ? "Backend API offline (start FastAPI via `pnpm dev:api` to connect)."
              : `Connected: ${health.data?.data.service} v${health.data?.data.version} (${health.data?.data.environment})`}
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {[
            "/explore",
            "/search",
            "/manga/sample-slug",
            "/manga/sample-slug/chapter/ch-1",
            "/author/creator-1/sample-creator",
            "/profile/reader1",
            "/history",
            "/reading-lists",
            "/settings",
            "/admin",
          ].map((path) => (
            <Link
              key={path}
              to={path}
              className="rounded border px-2.5 py-1 font-mono"
              style={{
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-accent)",
              }}
            >
              {path}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

export function ExplorePage() {
  return (
    <PlaceholderPage
      title="Explore & Advanced Filters"
      routePattern="/explore"
      roadmapPhase="Phase 5 — Catalog & Discovery"
      ucRefs="UC-3.1, UC-3.2"
      description="Paginated PUBLIC manga catalog with Include/Exclude tag groups, demographic, publication status, year, language, and safe content-rating filtering (unknown != safe)."
    />
  );
}

export function SearchPage() {
  return (
    <PlaceholderPage
      title="Global Title & Creator Search"
      routePattern="/search"
      roadmapPhase="Phase 5 — Catalog & Discovery"
      ucRefs="UC-3.3, UC-3.4"
      description="Debounced autocomplete (max 10) and full-text/fuzzy search across primary/alternative manga titles and Author/Artist creator credits."
    />
  );
}

export function MangaDetailPage() {
  const { slug } = useParams();
  return (
    <PlaceholderPage
      title="Manga Detail"
      routePattern="/manga/:slug"
      roadmapPhase="Phase 5–7 — Detail, Chapters, Ratings & Comments"
      ucRefs="UC-3.5, UC-3.10, UC-4.1, UC-4.7, UC-5"
      description="Manga metadata, cover art, creator credits, reading status, Read First / Continue actions, ordered chapter list, comments, and recommendations."
      params={{ slug }}
    />
  );
}

export function ChapterReaderPage() {
  const { slug, chapterId } = useParams();
  return (
    <PlaceholderPage
      title="Chapter Reader Canvas"
      routePattern="/manga/:slug/chapter/:chapterId"
      roadmapPhase="Phase 6 — Reader Engine & Progress"
      ucRefs="UC-4.3..4.6"
      description="Supports VERTICAL_WEBTOON, SINGLE_PAGE, DOUBLE_PAGE (LTR/RTL), FIT_WIDTH/FIT_HEIGHT/ORIGINAL, anchor preservation on mode switch, runtime media URLs, and reader_progress."
      params={{ slug, chapterId }}
    />
  );
}

export function AuthorDetailPage() {
  const { creatorId, slug } = useParams();
  return (
    <PlaceholderPage
      title="Creator (Author / Artist) Detail"
      routePattern="/author/:creatorId/:slug"
      roadmapPhase="Phase 5 — Creator Pages"
      ucRefs="UC-3.6"
      description="Canonical creator identity, localized biography, external links, and PUBLIC manga works combining Author/Artist credits without duplicate cards."
      params={{ creatorId, slug }}
    />
  );
}

export function ProfilePage() {
  const { username } = useParams();
  return (
    <PlaceholderPage
      title="Reader Profile"
      routePattern="/profile/:username"
      roadmapPhase="Phase 2 — Account & Profile"
      ucRefs="UC-1.1, UC-1.5"
      description="Public display name, avatar, sanitized bio, privacy-gated birth date, and reading statistics (private email restricted to self/Admin)."
      params={{ username }}
    />
  );
}

export function ReadingHistoryPage() {
  return (
    <PlaceholderPage
      title="Reading History"
      routePattern="/history"
      roadmapPhase="Phase 6–7 — History & Progress"
      ucRefs="UC-3.11"
      description="Personal chronological chapter-open history paired with exact resume targets from reader_progress."
    />
  );
}

export function ReadingListsPage() {
  return (
    <PlaceholderPage
      title="My Reading Lists"
      routePattern="/reading-lists"
      roadmapPhase="Phase 8 — Reading Lists"
      ucRefs="UC-7.1, UC-7.3, UC-7.6"
      description="Private owner-only reading lists (ADR-009) with search, creation, and deduplicated clone/merge workflows."
    />
  );
}

export function ReadingListDetailPage() {
  const { listId } = useParams();
  return (
    <PlaceholderPage
      title="Reading List Detail & Metadata Stats"
      routePattern="/reading-lists/:listId"
      roadmapPhase="Phase 8 — List Items & Stats"
      ucRefs="UC-7.2, UC-8.1..8.5"
      description="Owner-guarded list items (PUBLIC manga only), in-list search/filter, membership removal, and dynamic tag/status/rating/creator metadata statistics."
      params={{ listId }}
    />
  );
}

export function AccountSettingsPage() {
  return (
    <PlaceholderPage
      title="Account & Reader Settings"
      routePattern="/settings"
      roadmapPhase="Phase 2 & Phase 6 — Account & Preferences"
      ucRefs="UC-4.4, UC-6.1..6.3"
      description="Profile editing, avatar upload, password rotation (revoking other sessions), and default reader display preferences."
    />
  );
}

export function AdminDashboardPage() {
  return (
    <PlaceholderPage
      title="Admin Dashboard"
      routePattern="/admin"
      roadmapPhase="Phase 9 — Admin Analytics & Operations"
      ucRefs="UC-1, UC-2, UC-2.5"
      description="Overview of pending moderation reports, ETL job health, and manga interaction statistics."
    />
  );
}

export function AdminAccountsPage() {
  return (
    <PlaceholderPage
      title="Admin — Accounts & Activity Logs"
      routePattern="/admin/accounts"
      roadmapPhase="Phase 2 & Phase 9 — Account Governance"
      ucRefs="UC-1.1..1.5"
      description="Reader lookup, lock/unlock workflows (with mandatory reason, session revocation, and audit), immutable activity logs, and reader statistics."
    />
  );
}

export function AdminMangaPage() {
  return (
    <PlaceholderPage
      title="Admin — Manga Management"
      routePattern="/admin/manga"
      roadmapPhase="Phase 4 & Phase 9 — Catalog Lifecycle"
      ucRefs="UC-2.1, UC-2.2, UC-2.4, UC-2.5"
      description="Hide/show visibility controls, safe local deletion guarded by is_syncing and CDC tombstones, and manga interaction analytics."
    />
  );
}

export function AdminReportsPage() {
  return (
    <PlaceholderPage
      title="Admin — Moderation Reports Queue"
      routePattern="/admin/reports"
      roadmapPhase="Phase 9 — Moderation Center"
      ucRefs="UC-1.6, UC-1.7"
      description="Filterable ACCOUNT/MANGA/COMMENT moderation queue across PENDING, RESOLVED, IGNORED, and CLOSED states with atomic resolution commands."
    />
  );
}

export function AdminEtlPage() {
  return (
    <PlaceholderPage
      title="Admin — External Source ETL & CDC"
      routePattern="/admin/etl"
      roadmapPhase="Phase 3–4 — Ingestion & CDC"
      ucRefs="UC-2.3"
      description="External manga-reader-package:2.0 catalog selection, per-manga CDC subscription toggles, batch job status, and per-item retry diagnostics."
    />
  );
}
