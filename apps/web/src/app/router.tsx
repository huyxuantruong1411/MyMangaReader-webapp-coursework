import { Route, Routes } from "react-router-dom";
import { NotFoundState } from "../components/StateViews";
import {
  AccountSettingsPage,
  AdminAccountsPage,
  AdminDashboardPage,
  AdminEtlPage,
  AdminMangaPage,
  AdminReportsPage,
  AuthorDetailPage,
  ChapterReaderPage,
  ExplorePage,
  HomePage,
  MangaDetailPage,
  ProfilePage,
  ReadingHistoryPage,
  ReadingListDetailPage,
  ReadingListsPage,
  SearchPage,
} from "../features/RoutePlaceholders";
import { AdminLayout } from "../layouts/AdminLayout";
import { AuthenticatedLayout } from "../layouts/AuthenticatedLayout";
import { PublicLayout } from "../layouts/PublicLayout";
import { ReaderShellLayout } from "../layouts/ReaderShellLayout";

export function AppRoutes() {
  return (
    <Routes>
      {/* Public Discovery & Catalog Boundary */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/manga/:slug" element={<MangaDetailPage />} />
        <Route path="/author/:creatorId/:slug" element={<AuthorDetailPage />} />
        <Route path="/profile/:username" element={<ProfilePage />} />
      </Route>

      {/* Immersive Reader Engine Boundary */}
      <Route element={<ReaderShellLayout />}>
        <Route path="/manga/:slug/chapter/:chapterId" element={<ChapterReaderPage />} />
      </Route>

      {/* Authenticated Reader Boundary */}
      <Route element={<AuthenticatedLayout />}>
        <Route path="/history" element={<ReadingHistoryPage />} />
        <Route path="/reading-lists" element={<ReadingListsPage />} />
        <Route path="/reading-lists/:listId" element={<ReadingListDetailPage />} />
        <Route path="/settings" element={<AccountSettingsPage />} />
      </Route>

      {/* Administrator Boundary */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboardPage />} />
        <Route path="accounts" element={<AdminAccountsPage />} />
        <Route path="manga" element={<AdminMangaPage />} />
        <Route path="reports" element={<AdminReportsPage />} />
        <Route path="etl" element={<AdminEtlPage />} />
      </Route>

      {/* Routing Fallback (404) */}
      <Route element={<PublicLayout />}>
        <Route path="*" element={<NotFoundState />} />
      </Route>
    </Routes>
  );
}
