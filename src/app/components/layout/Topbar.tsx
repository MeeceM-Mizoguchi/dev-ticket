import { useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router";
import { NOTIFICATIONS as MOCK_NOTIFICATIONS } from "@/app/data/mock";
import { Avatar } from "@/app/components/shared/Avatar";
import { useAuth } from "@/app/contexts/AuthContext";
import { GlobalSearch } from "@/app/components/layout/GlobalSearch";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapNotification } from "@/app/lib/mappers";
import type { AppNotification } from "@/app/types";

function formatRelative(ts: string): string {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "今";
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

export function Topbar() {
  const { userName } = useAuth();
  const navigate = useNavigate();
  const [showNotif, setShowNotif] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>(
    !isSupabaseEnabled ? MOCK_NOTIFICATIONS : []
  );

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const loadNotifications = async () => {
    if (!isSupabaseEnabled || !userName) return;
    const { data, error } = await supabase!
      .from("notifications")
      .select("*")
      .eq("user_name", userName)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) { console.error("[notifications] load failed:", error.message); return; }
    if (data) setNotifications(data.map(mapNotification));
  };

  useEffect(() => {
    loadNotifications();
    if (!isSupabaseEnabled) return;
    const id = setInterval(loadNotifications, 30000);
    return () => clearInterval(id);
  }, [userName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpen = async () => {
    setShowNotif(true);
    await loadNotifications();
  };

  const handleNotifClick = async (notif: AppNotification) => {
    setShowNotif(false);
    if (!notif.isRead && isSupabaseEnabled) {
      await supabase!.from("notifications").update({ is_read: true }).eq("id", notif.id);
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: true } : n));
    }
    if (notif.projectSlug && notif.ticketWbs) {
      navigate(`/${notif.projectSlug}/${notif.ticketWbs}`);
    }
  };

  return (
    <header style={{ height: 52, background: "#FFFFFF", borderBottom: "1px solid rgba(20,26,22,0.08)", display: "flex", alignItems: "center", padding: "0 20px", gap: 14, flexShrink: 0 }}>
      <GlobalSearch />
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => { if (showNotif) setShowNotif(false); else handleOpen(); }}
            style={{ position: "relative", width: 34, height: 34, borderRadius: 9, border: "none", background: showNotif ? "#F4F5F6" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { if (!showNotif) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <Bell style={{ width: 15, height: 15, color: "#9E9690" }} />
            {unreadCount > 0 && (
              <span style={{ position: "absolute", top: 4, right: 4, minWidth: 14, height: 14, borderRadius: 7, background: "#059669", border: "1.5px solid #FFFFFF", fontSize: 8, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, padding: "0 2px" }}>
                {unreadCount}
              </span>
            )}
          </button>
          {showNotif && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setShowNotif(false)} />
              <div style={{ position: "absolute", top: 40, right: 0, width: 320, background: "#fff", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.06)", border: "1px solid rgba(26,23,20,0.08)", zIndex: 50, overflow: "hidden" }}>
                <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid rgba(26,23,20,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>お知らせ</span>
                  {unreadCount > 0 && <span style={{ fontSize: 10, background: "#ECFDF5", color: "#059669", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>{unreadCount}件 未読</span>}
                </div>
                <div style={{ maxHeight: 360, overflowY: "auto" }}>
                  {notifications.length === 0 ? (
                    <div style={{ padding: "32px 16px", textAlign: "center" as const, color: "#B0A9A4", fontSize: 12 }}>お知らせはありません</div>
                  ) : notifications.map(notif => (
                    <div key={notif.id}
                      onClick={() => handleNotifClick(notif)}
                      style={{ padding: "12px 16px", borderBottom: "1px solid rgba(26,23,20,0.04)", background: notif.isRead ? "transparent" : "#F0FDF8", cursor: "pointer", transition: "background 0.12s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = notif.isRead ? "transparent" : "#F0FDF8"; }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: notif.isRead ? "transparent" : "#059669", marginTop: 5, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: "#1A1714", lineHeight: 1.3, marginBottom: 2 }}>{notif.title}</p>
                          <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.4, marginBottom: 4 }}>{notif.body}</p>
                          <span style={{ fontSize: 10, color: "#C9C4BB", fontFamily: "var(--font-mono)" }}>{formatRelative(notif.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(26,23,20,0.06)", textAlign: "center" as const }}>
                  <button
                    onClick={async () => {
                      if (!isSupabaseEnabled || !userName) return;
                      await supabase!.from("notifications").update({ is_read: true }).eq("user_name", userName).eq("is_read", false);
                      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
                    }}
                    style={{ fontSize: 12, color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>
                    すべて既読にする
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <div style={{ width: 1, height: 18, background: "rgba(26,23,20,0.08)", margin: "0 4px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 10px 4px 5px", borderRadius: 9999, background: "#F4F5F6", cursor: "default" }}>
          <Avatar name={userName} size="xs" />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#3D3732" }}>{userName}</span>
        </div>
      </div>
    </header>
  );
}
