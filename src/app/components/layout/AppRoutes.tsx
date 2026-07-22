import { Routes, Route, Navigate, useLocation } from "react-router";
import type { ReactElement } from "react";
import { ErrorBoundary } from "@/app/components/ErrorBoundary";
import { Dashboard } from "@/app/pages/Dashboard";
import { ProjectsPage } from "@/app/pages/ProjectsPage";
import { SprintPage } from "@/app/pages/SprintPage";
import { SprintDetailPage } from "@/app/pages/SprintDetailPage";
import { ClientsPage } from "@/app/pages/ClientsPage";
import { MembersPage } from "@/app/pages/MembersPage";
import { PermissionsPage } from "@/app/pages/PermissionsPage";
import { RolesPage } from "@/app/pages/RolesPage";
import { AdminSettingsPage } from "@/app/pages/AdminSettingsPage";
import { MyActionsPage } from "@/app/pages/MyActionsPage";
import { ReleaseNotesPage } from "@/app/pages/ReleaseNotesPage";
import { ReportsPage } from "@/app/pages/ReportsPage";
import { BacklogPage } from "@/app/pages/BacklogPage";
import { BugReportsPage } from "@/app/pages/BugReportsPage";
import { WikiPage } from "@/app/pages/WikiPage";
import { MinutesPage } from "@/app/pages/MinutesPage";
import { FileBoxPage } from "@/app/pages/FileBoxPage";
import { WhiteboardPage } from "@/app/pages/WhiteboardPage";
import { OrganizationPage } from "@/app/pages/OrganizationPage";
import { AnnouncementSettingsPage } from "@/app/pages/AnnouncementSettingsPage";

// 保護下(ログイン後)ページの単一定義。
export const PROTECTED_ROUTES: { path: string; element: ReactElement }[] = [
  { path: "/dashboard", element: <Dashboard /> },
  { path: "/projects", element: <ProjectsPage /> },
  { path: "/clients", element: <ClientsPage /> },
  { path: "/members", element: <MembersPage /> },
  { path: "/permissions", element: <PermissionsPage /> },
  { path: "/roles", element: <RolesPage /> },
  { path: "/settings", element: <Navigate to="/admin-settings" replace /> },
  { path: "/admin-settings", element: <AdminSettingsPage /> },
  { path: "/announcement-settings", element: <AnnouncementSettingsPage /> },
  { path: "/my-actions", element: <MyActionsPage /> },
  { path: "/release-notes", element: <ReleaseNotesPage /> },
  { path: "/reports", element: <ReportsPage /> },
  { path: "/bug-reports", element: <BugReportsPage /> },
  { path: "/organization", element: <OrganizationPage /> },
  // Sprint list
  { path: "/:projectSlug", element: <SprintPage /> },
  { path: "/:projectSlug/backlog", element: <BacklogPage /> },
  { path: "/:projectSlug/backlog/:itemId", element: <BacklogPage /> },
  
  // 🌟 修正: Wikiの動的パスパラメータを明示的にマッピング
  { path: "/:projectSlug/wiki", element: <WikiPage /> },
  { path: "/:projectSlug/wiki/folders/:folderId", element: <WikiPage /> },
  { path: "/:projectSlug/wiki/pages/:pageId", element: <WikiPage /> },
  { path: "/:projectSlug/wiki/*", element: <WikiPage /> },
  
  { path: "/:projectSlug/minutes", element: <MinutesPage /> },
  { path: "/:projectSlug/minutes/:minuteId", element: <MinutesPage /> },
  // ENHA2-035 ファイルボックス（静的セグメントなので /:projectSlug/:segment より優先される）
  { path: "/:projectSlug/files", element: <FileBoxPage /> },
  { path: "/:projectSlug/whiteboard", element: <WhiteboardPage /> },
  { path: "/:projectSlug/whiteboard/:boardId", element: <WhiteboardPage /> },
  // Sprint detail (チケット一覧) with optional ticket open
  { path: "/:projectSlug/:segment", element: <SprintDetailPage /> },
];

export function ProtectedRoutes({ location }: { location?: string }) {
  const current = useLocation();
  // アクティブタブは location 未指定(=実ルーター現在地)。境界リセット用のキーは実際に描画を
  // 駆動している経路にそろえる（固定 location があればそれ、無ければ現在地）。
  const resetKey = location ?? current.pathname + current.search;
  return (
    // アプリ全体の保険（BRU7-043）: いずれかのページが描画中に例外を投げても白画面にしない。
    // 画面遷移のたびに境界をリセットし、他画面へ移れば自然に復帰する。
    <ErrorBoundary resetKeys={[resetKey]}>
      <Routes location={location}>
        {PROTECTED_ROUTES.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}