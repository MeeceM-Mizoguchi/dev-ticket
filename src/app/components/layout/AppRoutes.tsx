import { Routes, Route, Navigate } from "react-router";
import type { ReactElement } from "react";
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
import { OrganizationPage } from "@/app/pages/OrganizationPage";
import { AnnouncementSettingsPage } from "@/app/pages/AnnouncementSettingsPage";

// 保護下(ログイン後)ページの単一定義。
// Web版は App.tsx のネストルート(<Outlet/>)配下で、
// Mac/iPad版は TabPane の <Routes location> 配下で、同じ定義を再利用する。
// ※パスは絶対パス。Web のネスト(pathless レイアウトルート配下)でも、
//   タブの <Routes location> でも、どちらも絶対パスで動作する。
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
  { path: "/:projectSlug/wiki", element: <WikiPage /> },
  { path: "/:projectSlug/wiki/*", element: <WikiPage /> },
  { path: "/:projectSlug/minutes", element: <MinutesPage /> },
  { path: "/:projectSlug/minutes/:minuteId", element: <MinutesPage /> },
  // Sprint detail (チケット一覧) with optional ticket open
  { path: "/:projectSlug/:segment", element: <SprintDetailPage /> },
];

// Mac/iPad のタブ配下で使う Routes。
// react-router 7 は Router の入れ子を禁止するため、タブごとに MemoryRouter は
// 作らず、単一の BrowserRouter 内で <Routes location> によりタブ固有の
// ロケーションを描画する。
//  - アクティブタブ: location 未指定 → 実ルーターの現在地で描画(遷移が効く)
//  - 非アクティブタブ: location 指定 → そのパスに固定して keep-alive(状態保持)
export function ProtectedRoutes({ location }: { location?: string }) {
  return (
    <Routes location={location}>
      {PROTECTED_ROUTES.map((r) => (
        <Route key={r.path} path={r.path} element={r.element} />
      ))}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
