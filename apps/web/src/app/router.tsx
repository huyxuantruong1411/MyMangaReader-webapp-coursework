import { Route, Routes } from "react-router-dom";
import { NotFoundState } from "../components/StateViews";
import { ReadingHistoryPage } from "../features/account/HistoryPage";
import { ProfilePage } from "../features/account/ProfilePage";
import { AccountSettingsPage } from "../features/account/SettingsPage";
import {
  AdminAccountsPage,
  AdminDashboardPage,
  AdminEtlPage,
  AdminMangaPage,
  AdminReportsPage,
} from "../features/admin/AdminPages";
import { LoginPage, RegisterPage } from "../features/auth/AuthPages";
import { AuthorDetailPage } from "../features/creator/AuthorDetailPage";
import { ExplorePage } from "../features/discovery/ExplorePage";
import { HomePage } from "../features/discovery/HomePage";
import { SearchPage } from "../features/discovery/SearchPage";
import { ReadingListDetailPage } from "../features/lists/ReadingListDetailPage";
import { ReadingListsPage } from "../features/lists/ReadingListsPage";
import { MangaDetailPage } from "../features/manga/MangaDetailPage";
import { ChapterReaderPage } from "../features/reader/ChapterReaderPage";
import { AdminLayout } from "../layouts/AdminLayout";
import { AuthenticatedLayout } from "../layouts/AuthenticatedLayout";
import { PublicLayout } from "../layouts/PublicLayout";
import { ReaderShellLayout } from "../layouts/ReaderShellLayout";

export function AppRoutes() {
  return (
    <Routes>
      {/* Public Discovery, Auth & Catalog Boundary */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/manga/:slug" element={<MangaDetailPage />} />
        <Route path="/author/:creatorId/:slug" element={<AuthorDetailPage />} />
        <Route path="/profile/:username" element={<ProfilePage />} />
      </Route>

      {/* Immersive Reader Engine Boundary */}
      <Route element={<ReaderShellLayout />}>
        <Route path="/manga/:slug/read" element={<ChapterReaderPage />} />
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
