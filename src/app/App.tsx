import { Routes, Route, Navigate } from "react-router";
import { ToastProvider } from "@/app/contexts/ToastContext";
import { AlertProvider } from "@/app/contexts/AlertContext";
import { AuthProvider } from "@/app/contexts/AuthContext";
import { ProtectedShell } from "@/app/components/layout/AppShell";
import { LoginPage } from "@/app/pages/LoginPage";
import { AcceptInvitePage } from "@/app/pages/AcceptInvitePage";
import { Dashboard } from "@/app/pages/Dashboard";
import { ProjectsPage } from "@/app/pages/ProjectsPage";
import { SprintPage } from "@/app/pages/SprintPage";
import { SprintDetailPage } from "@/app/pages/SprintDetailPage";
import { ClientsPage } from "@/app/pages/ClientsPage";
import { MembersPage } from "@/app/pages/MembersPage";
import { PermissionsPage } from "@/app/pages/PermissionsPage";
import { RolesPage } from "@/app/pages/RolesPage";
import { SettingsPage } from "@/app/pages/SettingsPage";
import { AdminSettingsPage } from "@/app/pages/AdminSettingsPage";
import { MyActionsPage } from "@/app/pages/MyActionsPage";
import { ReleaseNotesPage } from "@/app/pages/ReleaseNotesPage";
import { BacklogPage } from "@/app/pages/BacklogPage";
import { WikiPage } from "@/app/pages/WikiPage";
import { MinutesPage } from "@/app/pages/MinutesPage";

export default function App() {
  return (
    <ToastProvider>
      <AlertProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
            <Route element={<ProtectedShell />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/members" element={<MembersPage />} />
              <Route path="/permissions" element={<PermissionsPage />} />
              <Route path="/roles" element={<RolesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin-settings" element={<AdminSettingsPage />} />
              <Route path="/my-actions" element={<MyActionsPage />} />
              <Route path="/release-notes" element={<ReleaseNotesPage />} />
              {/* Sprint list */}
              <Route path="/:projectSlug" element={<SprintPage />} />
              <Route path="/:projectSlug/backlog" element={<BacklogPage />} />
              <Route path="/:projectSlug/wiki" element={<WikiPage />} />
              <Route path="/:projectSlug/minutes" element={<MinutesPage />} />
              {/* Sprint detail (チケット一覧) with optional ticket open */}
              <Route path="/:projectSlug/:segment" element={<SprintDetailPage />} />
            </Route>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </AlertProvider>
    </ToastProvider>
  );
}
