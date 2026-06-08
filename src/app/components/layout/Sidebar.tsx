import { useState, type ElementType } from "react";
import { LayoutDashboard, FolderKanban, Building2, Users, Settings, LogOut, CalendarRange, Ticket, UserCog, BellRing } from "lucide-react";
import { useLocation } from "react-router";
import type { Page, Role, UserPermissions } from "@/app/types";
import { useAuth } from "@/app/contexts/AuthContext";

const NAV_ITEMS: { id: Page; label: string; icon: ElementType; roles?: Role[]; permission?: keyof UserPermissions }[] = [
  { id: "dashboard", label: "ダッシュ", icon: LayoutDashboard },
  { id: "projects", label: "PJ一覧", icon: FolderKanban },
  { id: "clients", label: "クライアント", icon: Building2, roles: ["admin", "project-manager"] },
  { id: "members", label: "メンバー", icon: Users, permission: "canAccessMembers" },
  { id: "permissions", label: "アサイン計画", icon: CalendarRange, permission: "canAccessGroups" },
  { id: "roles", label: "ロール設定", icon: UserCog, permission: "canAccessRoles" },
  { id: "admin-settings", label: "通知管理", icon: BellRing, permission: "canAccessAdminSettings" },
];

export function Sidebar() {
  const { userRole, userPermissions, logout } = useAuth();
  const location = useLocation();
  const [hoveredNav, setHoveredNav] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // 🌟【修正ポイント】動的なプロジェクトパス（/:slug や /:slug/:wbs）を正しく「プロジェクト」として検知させるロジックに変更
  const getActivePage = (): Exclude<Page, "login"> => {
    const p = location.pathname;

    // 完全にダッシュボード（ルート）の時
    if (p === "/" || p === "/dashboard") return "dashboard";

    // 既存の固定ルーティング設定
    if (p.startsWith("/projects")) return "projects";
    if (p.startsWith("/clients")) return "clients";
    if (p.startsWith("/members")) return "members";
    if (p.startsWith("/settings")) return "settings";
    if (p.startsWith("/permissions")) return "permissions";
    if (p.startsWith("/roles")) return "roles";
    if (p.startsWith("/admin-settings")) return "admin-settings";

    // 上記の固定パスに当てはまらない URL（例: /DevTicket や /DevTicket/TKT-001 など）は、
    // プロジェクト詳細画面やスプリント管理画面を表示しているため「プロジェクト」をハイライトさせる
    return "projects";
  };

  const page = getActivePage();
  const visible = NAV_ITEMS.filter(n => {
    if (n.roles && !n.roles.includes(userRole)) return false;
    if (n.permission && !userPermissions[n.permission]) return false;
    return true;
  });

  const TooltipEl = ({ label }: { label: string }) => (
    <div style={{
      position: "absolute", left: 68, top: "50%", transform: "translateY(-50%)",
      background: "#1A1714", color: "#fff", fontSize: 11, fontWeight: 600,
      padding: "5px 10px", borderRadius: 7, whiteSpace: "nowrap" as const,
      pointerEvents: "none", zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
    }}>
      {label}
      <div style={{ position: "absolute", right: "100%", top: "50%", transform: "translateY(-50%)", width: 0, height: 0, borderTop: "5px solid transparent", borderBottom: "5px solid transparent", borderRight: "6px solid #1A1714" }} />
    </div>
  );

  const NavBtn = ({ id, label, Icon }: { id: Page; label: string; Icon: ElementType }) => {
    const active = page === id;
    return (
      <div style={{ position: "relative" }}
        onMouseEnter={() => setHoveredNav(id)}
        onMouseLeave={() => setHoveredNav(null)}>
        <button onClick={() => { window.location.href = `/${id}`; }}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "11px 0", position: "relative", border: "none", background: "transparent", cursor: "pointer" }}>
          {active && <div style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: "0 99px 99px 0", background: "#059669" }} />}
          <div style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: active ? "#ECFDF5" : "transparent", border: active ? "1px solid rgba(5,150,105,0.18)" : "1px solid transparent", transition: "all 0.15s" }}
            onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; } }}
            onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "transparent"; } }}>
            <Icon style={{ width: 17, height: 17, color: active ? "#059669" : "#9E9690" }} />
          </div>
        </button>
        {hoveredNav === id && <TooltipEl label={label} />}
      </div>
    );
  };

  return (
    <aside style={{ width: 64, background: "#FFFFFF", borderRight: "1px solid rgba(26,23,20,0.07)", display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
      <div style={{ padding: "20px 0 10px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div title="Dev Ticket" style={{ width: 38, height: 38, borderRadius: 11, background: "linear-gradient(145deg, #34D399, #059669)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(5,150,105,0.35), inset 0 1px 0 rgba(255,255,255,0.30)" }}>
          <Ticket style={{ width: 17, height: 17, color: "#fff" }} />
        </div>
      </div>
      <div style={{ width: 28, height: 1, background: "rgba(26,23,20,0.06)", margin: "6px 0 4px" }} />
      <nav style={{ flex: 1, width: "100%", display: "flex", flexDirection: "column", paddingTop: 2 }}>
        {visible.map(({ id, label, icon: Icon }) => (
          <NavBtn key={id} id={id} label={label} Icon={Icon} />
        ))}
      </nav>
      <div style={{ width: "100%", paddingBottom: 16 }}>
        <div style={{ width: 28, height: 1, background: "rgba(26,23,20,0.06)", margin: "4px auto 4px" }} />
        <NavBtn id="settings" label="設定" Icon={Settings} />
        <div style={{ position: "relative" }}
          onMouseEnter={() => setHoveredNav("logout")}
          onMouseLeave={() => setHoveredNav(null)}>
          <button onClick={() => setShowLogoutConfirm(true)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "11px 0", border: "none", background: "transparent", cursor: "pointer" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <LogOut style={{ width: 16, height: 16, color: "#C9C4BB" }} />
            </div>
          </button>
          {hoveredNav === "logout" && <TooltipEl label="ログアウト" />}
        </div>
        {showLogoutConfirm && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => setShowLogoutConfirm(false)}>
            <div style={{ background: "#FFFFFF", borderRadius: 20, padding: "28px 28px 24px", width: 340, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <LogOut style={{ width: 22, height: 22, color: "#DC2626" }} />
              </div>
              <p style={{ fontSize: 16, fontWeight: 700, color: "#1A1714", textAlign: "center" as const, marginBottom: 8 }}>ログアウト</p>
              <p style={{ fontSize: 13, color: "#A09790", textAlign: "center" as const, marginBottom: 24, lineHeight: 1.5 }}>本当にログアウトしますか？<br />ログイン画面に戻ります。</p>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setShowLogoutConfirm(false)}
                  style={{ flex: 1, padding: "11px 0", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", cursor: "pointer", color: "#6B6458", transition: "background 0.15s" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  キャンセル
                </button>
                <button onClick={async () => { await logout(); window.location.href = "/login"; }}
                  style={{ flex: 1, padding: "11px 0", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", background: "#DC2626", color: "#fff", cursor: "pointer", transition: "background 0.15s" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#B91C1C"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#DC2626"; }}>
                  ログアウト
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}