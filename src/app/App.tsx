import { Routes, Route, Navigate } from "react-router";
import { ToastProvider } from "@/app/contexts/ToastContext";
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

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route element={<ProtectedShell />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/projects" element={<ProjectsPage />} />
            {/* Sprint detail (individual sprint view) */}
            <Route path="/:projectSlug/sprint/:sprintId" element={<SprintDetailPage />} />
            <Route path="/:projectSlug/sprint/:sprintId/:ticketWbs" element={<SprintDetailPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/permissions" element={<PermissionsPage />} />
            <Route path="/roles" element={<RolesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin-settings" element={<AdminSettingsPage />} />
            {/* Slug-based sprint list + ticket panel */}
            <Route path="/:projectSlug" element={<SprintPage />} />
            <Route path="/:projectSlug/:ticketWbs" element={<SprintPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}
