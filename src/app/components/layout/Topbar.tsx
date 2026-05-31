import { useState } from "react";
import { Bell } from "lucide-react";
import { NOTIFICATIONS } from "@/app/data/mock";
import { Avatar } from "@/app/components/shared/Avatar";
import { useAuth } from "@/app/contexts/AuthContext";
import { GlobalSearch } from "@/app/components/layout/GlobalSearch";

export function Topbar() {
  const { userName } = useAuth();
  const [showNotif, setShowNotif] = useState(false);
  const unreadCount = NOTIFICATIONS.filter(n => !n.read).length;

  return (
    <header style={{ height: 52, background: "#FFFFFF", borderBottom: "1px solid rgba(20,26,22,0.08)", display: "flex", alignItems: "center", padding: "0 20px", gap: 14, flexShrink: 0 }}>
      <GlobalSearch />
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ position: "relative" }}>
          <button onClick={() => setShowNotif(!showNotif)}
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
                <div>
                  {NOTIFICATIONS.map(notif => (
                    <div key={notif.id}
                      style={{ padding: "12px 16px", borderBottom: "1px solid rgba(26,23,20,0.04)", background: notif.read ? "transparent" : "#F0FDF8", cursor: "pointer", transition: "background 0.12s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = notif.read ? "transparent" : "#F0FDF8"; }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: notif.read ? "transparent" : "#059669", marginTop: 5, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: "#1A1714", lineHeight: 1.3, marginBottom: 2 }}>{notif.title}</p>
                          <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.4, marginBottom: 4 }}>{notif.body}</p>
                          <span style={{ fontSize: 10, color: "#C9C4BB", fontFamily: "var(--font-mono)" }}>{notif.time}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(26,23,20,0.06)", textAlign: "center" as const }}>
                  <button style={{ fontSize: 12, color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>すべてのお知らせを見る</button>
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
