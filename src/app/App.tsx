import { Routes, Route, Navigate } from "react-router";
import { ToastProvider } from "@/app/contexts/ToastContext";
import { AlertProvider } from "@/app/contexts/AlertContext";
import { AuthProvider } from "@/app/contexts/AuthContext";
import { PreviewPanelProvider } from "@/app/contexts/PreviewPanelContext";
import { LinkPreviewPanel } from "@/app/components/shared/LinkPreviewPanel";
import { ProtectedShell } from "@/app/components/layout/AppShell";
import { LoginPage } from "@/app/pages/LoginPage";
import { AcceptInvitePage } from "@/app/pages/AcceptInvitePage";
import { LandingPage } from "@/app/pages/lp/LandingPage";
import { DemoBookingPage } from "@/app/pages/lp/DemoBookingPage";
import { DemoPreviewPage } from "@/app/pages/lp/DemoPreviewPage";
import { PrivacyPolicyPage } from "@/app/pages/lp/PrivacyPolicyPage";
import { TermsOfServicePage } from "@/app/pages/lp/TermsOfServicePage";
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
import { BacklogPage } from "@/app/pages/BacklogPage";
import { BugReportsPage } from "@/app/pages/BugReportsPage";
import { WikiPage } from "@/app/pages/WikiPage";
import { MinutesPage } from "@/app/pages/MinutesPage";
import { OrganizationPage } from "@/app/pages/OrganizationPage";
import { AnnouncementSettingsPage } from "@/app/pages/AnnouncementSettingsPage";
import { OrgProvider } from "@/app/contexts/OrgContext";

export default function App() {
  return (
    <ToastProvider>
      <AlertProvider>
        <AuthProvider>
          <PreviewPanelProvider>
          <LinkPreviewPanel />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/book-demo" element={<DemoBookingPage />} />
            <Route path="/demo-preview" element={<DemoPreviewPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsOfServicePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
            <Route element={<OrgProvider><ProtectedShell /></OrgProvider>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/members" element={<MembersPage />} />
              <Route path="/permissions" element={<PermissionsPage />} />
              <Route path="/roles" element={<RolesPage />} />
              <Route path="/settings" element={<Navigate to="/admin-settings" replace />} />
              <Route path="/admin-settings" element={<AdminSettingsPage />} />
              <Route path="/announcement-settings" element={<AnnouncementSettingsPage />} />
              <Route path="/my-actions" element={<MyActionsPage />} />
              <Route path="/release-notes" element={<ReleaseNotesPage />} />
              <Route path="/bug-reports" element={<BugReportsPage />} />
              <Route path="/organization" element={<OrganizationPage />} />
              {/* Sprint list */}
              <Route path="/:projectSlug" element={<SprintPage />} />
              <Route path="/:projectSlug/backlog" element={<BacklogPage />} />
              <Route path="/:projectSlug/backlog/:itemId" element={<BacklogPage />} />
              <Route path="/:projectSlug/wiki" element={<WikiPage />} />
              <Route path="/:projectSlug/wiki/*" element={<WikiPage />} />
              <Route path="/:projectSlug/minutes" element={<MinutesPage />} />
              <Route path="/:projectSlug/minutes/:minuteId" element={<MinutesPage />} />
              {/* Sprint detail (チケット一覧) with optional ticket open */}
              <Route path="/:projectSlug/:segment" element={<SprintDetailPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </PreviewPanelProvider>
        </AuthProvider>
      </AlertProvider>
    </ToastProvider>
  );
}
