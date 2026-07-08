import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router";
import { Capacitor } from "@capacitor/core";
import { setWebNavigate } from "@/app/contexts/TabContext";
import { ToastProvider } from "@/app/contexts/ToastContext";
import { AlertProvider } from "@/app/contexts/AlertContext";
import { AuthProvider } from "@/app/contexts/AuthContext";
import { PreviewPanelProvider } from "@/app/contexts/PreviewPanelContext";
import { LinkPreviewPanel } from "@/app/components/shared/LinkPreviewPanel";
import { ExportProgressOverlay } from "@/app/components/shared/ExportProgressOverlay";
import { ProtectedShell } from "@/app/components/layout/AppShell";
import { PROTECTED_ROUTES } from "@/app/components/layout/AppRoutes";
import { LoginPage } from "@/app/pages/LoginPage";
import { AcceptInvitePage } from "@/app/pages/AcceptInvitePage";
import { LandingPage } from "@/app/pages/lp/LandingPage";
import { DemoBookingPage } from "@/app/pages/lp/DemoBookingPage";
import { DemoPreviewPage } from "@/app/pages/lp/DemoPreviewPage";
import { PrivacyPolicyPage } from "@/app/pages/lp/PrivacyPolicyPage";
import { TermsOfServicePage } from "@/app/pages/lp/TermsOfServicePage";
import { NewsListPage } from "@/app/pages/lp/news/NewsListPage";
import { NewsArticlePage } from "@/app/pages/lp/news/NewsArticlePage";
import { OrgProvider } from "@/app/contexts/OrgContext";
import { PlanProvider } from "@/app/contexts/PlanContext";

// ネイティブアプリ(macOS/iPad)では営業用LPを表示せず、
// ログイン済みならダッシュボード、未ログインならログイン画面へ直行する。
// Web版は従来どおりLPを表示する。
// Web(非タブ)環境で BrowserRouter の navigate をモジュールブリッジへ登録する。
// これにより navigateInActiveTab がフルリロードなしで SPA 遷移でき、通話中の
// 画面遷移で CallProvider がアンマウント→通話が切れる問題を防ぐ。
// タブモード(ネイティブ)では navigateInActiveTab がタブ遷移を優先するため無害。
function WebNavBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setWebNavigate(navigate);
    return () => setWebNavigate(null);
  }, [navigate]);
  return null;
}

function RootRoute() {
  if (Capacitor.isNativePlatform()) {
    const loggedIn = sessionStorage.getItem("isLoggedIn") === "true";
    return <Navigate to={loggedIn ? "/dashboard" : "/login"} replace />;
  }
  return <LandingPage />;
}

export default function App() {
  return (
    <ToastProvider>
      <AlertProvider>
        <AuthProvider>
          <PreviewPanelProvider>
          <WebNavBridge />
          <LinkPreviewPanel />
          <ExportProgressOverlay />
          <Routes>
            <Route path="/" element={<RootRoute />} />
            <Route path="/book-demo" element={<DemoBookingPage />} />
            <Route path="/demo-preview" element={<DemoPreviewPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsOfServicePage />} />
            <Route path="/news" element={<NewsListPage />} />
            <Route path="/news/:slug" element={<NewsArticlePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
            <Route element={<OrgProvider><PlanProvider><ProtectedShell /></PlanProvider></OrgProvider>}>
              {PROTECTED_ROUTES.map((r) => (
                <Route key={r.path} path={r.path} element={r.element} />
              ))}
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </PreviewPanelProvider>
        </AuthProvider>
      </AlertProvider>
    </ToastProvider>
  );
}
