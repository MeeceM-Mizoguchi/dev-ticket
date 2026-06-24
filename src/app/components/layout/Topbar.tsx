import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, Trash2, ClipboardList, Check, Bug, Megaphone, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router";
import { NOTIFICATIONS as MOCK_NOTIFICATIONS } from "@/app/data/mock";
import { Avatar } from "@/app/components/shared/Avatar";
import { useAuth } from "@/app/contexts/AuthContext";
import { GlobalSearch } from "@/app/components/layout/GlobalSearch";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapNotification } from "@/app/lib/mappers";
import { BugReportModal } from "@/app/components/bug-report/BugReportModal";
import { AnnouncementModal } from "@/app/components/announcements/AnnouncementModal";
import type { AppNotification, ActionMemoCategory, NotificationType, Announcement, AnnouncementItem } from "@/app/types";

function notifTypeToCategory(type: NotificationType): ActionMemoCategory {
  if (type === "assign") return "todo";
  if (type === "review_request" || type === "revision_request") return "review";
  if (type === "review_approved") return "test";
  return "memo";
}

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

const NOTIF_VIEWED_KEY = "notif_last_viewed_at";

export function Topbar() {
  const { userName } = useAuth();
  const navigate = useNavigate();
  const [showBugReport, setShowBugReport] = useState(false);
  const closeBugReport = useCallback(() => setShowBugReport(false), []);
  const [showNotif, setShowNotif] = useState(false);
  const [hoveredNotifId, setHoveredNotifId] = useState<string | null>(null);
  const [existingActionNotifIds, setExistingActionNotifIds] = useState<Set<string>>(new Set());
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [hoveredActionBtnId, setHoveredActionBtnId] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<AppNotification[]>(
    !isSupabaseEnabled ? MOCK_NOTIFICATIONS : []
  );
  const [lastViewedAt, setLastViewedAt] = useState<string>(
    () => localStorage.getItem(NOTIF_VIEWED_KEY) ?? ""
  );

  // お知らせ
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [announcementAnchorX, setAnnouncementAnchorX] = useState(0);
  const announcementBtnRef = useRef<HTMLButtonElement>(null);

  const loadAnnouncement = useCallback(async () => {
    if (!isSupabaseEnabled) return;
    const { data } = await supabase!
      .from("announcements")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const items: AnnouncementItem[] = Array.isArray(data.items)
        ? data.items.map((r: Record<string, string>) => ({ imageUrl: r.image_url ?? "", description: r.description ?? "" }))
        : [];
      setAnnouncement({ id: data.id, orgId: data.org_id, title: data.title ?? "", items, isActive: data.is_active ?? true, createdAt: data.created_at ?? "", updatedAt: data.updated_at ?? "" });
    } else {
      setAnnouncement(null);
    }
  }, []);

  useEffect(() => { loadAnnouncement(); }, [loadAnnouncement]);

  const unreadCount = notifications.filter(n => !n.isRead).length;
  const hasNewSinceLastView = !showNotif && notifications.some(
    n => !n.isRead && (!lastViewedAt || n.createdAt > lastViewedAt)
  );

  const loadNotifications = async () => {
    if (!isSupabaseEnabled || !userName) return;
    const { data, error } = await supabase!
      .from("notifications")
      .select("*")
      .eq("user_name", userName)
      .is("hidden_at", null)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      const { data: d2, error: e2 } = await supabase!
        .from("notifications")
        .select("*")
        .eq("user_name", userName)
        .order("created_at", { ascending: false })
        .limit(20);
      if (e2) { console.error("[notifications] load failed:", e2.message); return; }
      if (d2) setNotifications(d2.map(mapNotification));
      return;
    }
    if (data) setNotifications(data.map(mapNotification));
  };

  const loadExistingActionIds = async () => {
    if (!isSupabaseEnabled || !userName) return;
    const { data, error } = await supabase!
      .from("action_memos")
      .select("source_notification_id")
      .eq("user_name", userName)
      .not("source_notification_id", "is", null);
    if (error) {
      console.error("[action_memos] load existing ids failed:", error.message);
      return;
    }
    if (data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setExistingActionNotifIds(new Set(data.map((r: any) => r.source_notification_id).filter(Boolean)));
    }
  };

  useEffect(() => {
    loadNotifications();
    if (!isSupabaseEnabled) return;
    const id = setInterval(loadNotifications, 30000);
    return () => clearInterval(id);
  }, [userName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpen = () => {
    const now = new Date().toISOString();
    setShowNotif(true);
    setLastViewedAt(now);
    localStorage.setItem(NOTIF_VIEWED_KEY, now);
    loadExistingActionIds();
  };

  const handleDeleteNotif = async (e: React.MouseEvent, notifId: string) => {
    e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== notifId));
    if (isSupabaseEnabled) {
      const { error } = await supabase!
        .from("notifications")
        .update({ hidden_at: new Date().toISOString() })
        .eq("id", notifId);
      if (error) console.error("[notifications] hide failed:", error.message);
    }
  };

  const handleAddToActionList = async (e: React.MouseEvent, notif: AppNotification) => {
    e.stopPropagation();
    if (existingActionNotifIds.has(notif.id)) return;
    const category = notifTypeToCategory(notif.type);
    if (isSupabaseEnabled && userName) {
      const { error } = await supabase!.from("action_memos").insert({
        user_name: userName,
        title: notif.title,
        content: notif.body,
        category,
        source_notification_id: notif.id,
        ticket_id: notif.ticketId ?? null,
        ticket_wbs: notif.ticketWbs ?? "",
        ticket_title: notif.ticketTitle ?? "",
        project_slug: notif.projectSlug ?? "",
      });
      if (error) {
        console.error("[action_memos] insert failed:", error.message);
        return;
      }
    }
    setExistingActionNotifIds(prev => new Set([...prev, notif.id]));
    setJustAddedId(notif.id);
    setTimeout(() => setJustAddedId(null), 1800);
  };

  const handleNotifClick = async (notif: AppNotification) => {
    setShowNotif(false);
    if (!notif.isRead && isSupabaseEnabled) {
      await supabase!.from("notifications").update({ is_read: true }).eq("id", notif.id);
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: true } : n));
    }
    if (notif.projectSlug && notif.ticketWbs) {
      const anchor = notif.mentionContext ? `?anchor=${encodeURIComponent(notif.mentionContext)}` : "";
      navigate(`/${notif.projectSlug}/${notif.ticketWbs}${anchor}`);
    } else if (notif.projectSlug) {
      navigate(`/${notif.projectSlug}`);
    }
  };

  return (
    <>
    {showBugReport && <BugReportModal onClose={closeBugReport} />}
    {showAnnouncement && announcement && (
      <AnnouncementModal announcement={announcement} onClose={() => setShowAnnouncement(false)} anchorX={announcementAnchorX} />
    )}
    <header style={{ height: 52, background: "#FFFFFF", borderBottom: "1px solid rgba(20,26,22,0.08)", display: "flex", alignItems: "center", padding: "0 20px", gap: 10, flexShrink: 0 }}>
      <style>{`
        @keyframes bellGlow { 0%,100%{box-shadow:0 0 0 0 rgba(5,150,105,0.45)} 50%{box-shadow:0 0 0 7px rgba(5,150,105,0)} }
      `}</style>
      <GlobalSearch />

      {/* お知らせバナー */}
      {announcement && (
        <button
          ref={announcementBtnRef}
          onClick={() => {
            if (announcement.items.length > 0) {
              if (announcementBtnRef.current) {
                const rect = announcementBtnRef.current.getBoundingClientRect();
                setAnnouncementAnchorX(Math.round(rect.left + rect.width / 2));
              }
              setShowAnnouncement(true);
            }
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "0 13px 0 9px",
            height: 34,
            borderRadius: 10,
            border: "none",
            background: "linear-gradient(135deg, #34D399 0%, #059669 100%)",
            boxShadow: "0 2px 8px rgba(5,150,105,0.30), inset 0 1px 0 rgba(255,255,255,0.22)",
            cursor: announcement.items.length > 0 ? "pointer" : "default",
            flexShrink: 0,
            maxWidth: 360,
            transition: "opacity 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={e => {
            if (announcement.items.length > 0) {
              (e.currentTarget as HTMLElement).style.opacity = "0.88";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 14px rgba(5,150,105,0.40), inset 0 1px 0 rgba(255,255,255,0.22)";
            }
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.opacity = "1";
            (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(5,150,105,0.30), inset 0 1px 0 rgba(255,255,255,0.22)";
          }}
        >
          <Megaphone style={{ width: 14, height: 14, color: "rgba(255,255,255,0.88)", flexShrink: 0 }} />
          <span style={{
            fontSize: 13, fontWeight: 700, color: "#fff",
            whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis",
            maxWidth: 260,
          }}>
            {announcement.title}
          </span>
          {announcement.items.length > 0 && (
            <ChevronRight style={{ width: 13, height: 13, color: "rgba(255,255,255,0.55)", flexShrink: 0 }} />
          )}
        </button>
      )}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
        {/* バグ報告ボタン */}
        <button
          onClick={() => setShowBugReport(true)}
          title="バグ・不具合を報告する"
          style={{ position: "relative", width: 34, height: 34, borderRadius: 9, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", transition: "background 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
          <Bug style={{ width: 15, height: 15, color: "#9E9690" }} />
        </button>

        <div style={{ position: "relative" }}>
          <button
            onClick={() => { if (showNotif) { setShowNotif(false); setHoveredNotifId(null); } else handleOpen(); }}
            style={{ position: "relative", width: 34, height: 34, borderRadius: 9, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: showNotif ? "#F4F5F6" : hasNewSinceLastView ? "rgba(5,150,105,0.06)" : "transparent", animation: hasNewSinceLastView ? "bellGlow 1.8s ease-in-out infinite" : "none", transition: "background 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { if (!showNotif) (e.currentTarget as HTMLElement).style.background = hasNewSinceLastView ? "rgba(5,150,105,0.06)" : "transparent"; }}>
            <Bell style={{ width: 15, height: 15, color: hasNewSinceLastView ? "#059669" : "#9E9690", transition: "color 0.15s" }} />
            {unreadCount > 0 && (
              <span style={{ position: "absolute", top: 4, right: 4, minWidth: 14, height: 14, borderRadius: 7, background: "#059669", border: "1.5px solid #FFFFFF", fontSize: 8, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, padding: "0 2px" }}>
                {unreadCount}
              </span>
            )}
          </button>

          {showNotif && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => { setShowNotif(false); setHoveredNotifId(null); }} />
              <div style={{ position: "absolute", top: 40, right: 0, width: 340, background: "#fff", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.06)", border: "1px solid rgba(26,23,20,0.08)", zIndex: 50, overflow: "hidden" }}>
                <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid rgba(26,23,20,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>お知らせ</span>
                  {unreadCount > 0 && <span style={{ fontSize: 10, background: "#ECFDF5", color: "#059669", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>{unreadCount}件 未読</span>}
                </div>

                <div style={{ maxHeight: 360, overflowY: "auto" }}>
                  {notifications.length === 0 ? (
                    <div style={{ padding: "32px 16px", textAlign: "center" as const, color: "#B0A9A4", fontSize: 12 }}>お知らせはありません</div>
                  ) : notifications.map(notif => {
                    const isAlreadyAdded = existingActionNotifIds.has(notif.id);
                    const isJustAdded = justAddedId === notif.id;
                    const isActionBtnHovered = hoveredActionBtnId === notif.id;

                    // アクションボタンの色をstate管理で決定（onMouseEnterCapture は使わない）
                    const actionIconColor = isJustAdded
                      ? "#059669"
                      : isAlreadyAdded
                        ? "#B0A9A4"
                        : isActionBtnHovered
                          ? "#059669"
                          : "#C9C4BB";

                    return (
                      <div key={notif.id}
                        onClick={() => handleNotifClick(notif)}
                        style={{ padding: "12px 16px", borderBottom: "1px solid rgba(26,23,20,0.04)", background: hoveredNotifId === notif.id ? "#F4F5F6" : notif.isRead ? "transparent" : "#F0FDF8", cursor: "pointer", transition: "background 0.12s" }}
                        onMouseEnter={() => setHoveredNotifId(notif.id)}
                        onMouseLeave={() => { setHoveredNotifId(null); setHoveredActionBtnId(null); }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: notif.isRead ? "transparent" : "#059669", marginTop: 5, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 12, fontWeight: 600, color: "#1A1714", lineHeight: 1.3, marginBottom: 2 }}>{notif.title}</p>
                            <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.4, marginBottom: 4 }}>{notif.body}</p>
                            <span style={{ fontSize: 10, color: "#C9C4BB", fontFamily: "var(--font-mono)" }}>{formatRelative(notif.createdAt)}</span>
                          </div>

                          {/* アクションボタン群 */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0, marginTop: 1, opacity: hoveredNotifId === notif.id ? 1 : 0, transition: "opacity 0.15s" }}>
                            {/* アクションリスト追加ボタン */}
                            <div style={{ position: "relative" }}>
                              <button
                                onClick={isAlreadyAdded ? e => e.stopPropagation() : e => handleAddToActionList(e, notif)}
                                onMouseEnter={() => setHoveredActionBtnId(notif.id)}
                                onMouseLeave={() => setHoveredActionBtnId(null)}
                                style={{
                                  background: isJustAdded ? "#ECFDF5" : "none",
                                  border: "none",
                                  cursor: isAlreadyAdded ? "default" : "pointer",
                                  padding: 4, borderRadius: 6,
                                  color: actionIconColor,
                                  transition: "color 0.15s, background 0.15s",
                                  opacity: isAlreadyAdded && !isJustAdded ? 0.45 : 1,
                                  lineHeight: 0,
                                  display: "block",
                                }}
                              >
                                {isAlreadyAdded ? <Check style={{ width: 13, height: 13 }} /> : <ClipboardList style={{ width: 13, height: 13 }} />}
                              </button>

                              {/* 追加済みツールチップ */}
                              {isAlreadyAdded && !isJustAdded && isActionBtnHovered && (
                                <div style={{
                                  position: "absolute", right: "calc(100% + 8px)", top: "50%",
                                  transform: "translateY(-50%)",
                                  background: "#1A1714", color: "#fff",
                                  fontSize: 10, fontWeight: 600,
                                  padding: "5px 9px", borderRadius: 6,
                                  whiteSpace: "nowrap" as const,
                                  zIndex: 200, pointerEvents: "none",
                                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                                }}>
                                  すでに追加されています
                                  <div style={{ position: "absolute", right: -4, top: "50%", transform: "translateY(-50%)", width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "5px solid #1A1714" }} />
                                </div>
                              )}

                              {/* 追加直後バルーン */}
                              {isJustAdded && (
                                <div style={{
                                  position: "absolute", right: "calc(100% + 8px)", top: "50%",
                                  transform: "translateY(-50%)",
                                  background: "#059669", color: "#fff",
                                  fontSize: 10, fontWeight: 600,
                                  padding: "5px 9px", borderRadius: 6,
                                  whiteSpace: "nowrap" as const,
                                  zIndex: 200, pointerEvents: "none",
                                  boxShadow: "0 2px 8px rgba(5,150,105,0.3)",
                                }}>
                                  アクションリストに追加しました
                                  <div style={{ position: "absolute", right: -4, top: "50%", transform: "translateY(-50%)", width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "5px solid #059669" }} />
                                </div>
                              )}
                            </div>

                            {/* 削除ボタン */}
                            <button
                              onClick={e => handleDeleteNotif(e, notif.id)}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "#C9C4BB", transition: "color 0.15s", lineHeight: 0, display: "block" }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#EF4444"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                              <Trash2 style={{ width: 13, height: 13 }} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(26,23,20,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button
                    onClick={async () => {
                      if (!isSupabaseEnabled || !userName) return;
                      await supabase!.from("notifications").update({ is_read: true }).eq("user_name", userName).eq("is_read", false);
                      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
                    }}
                    style={{ fontSize: 12, color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>
                    すべて既読にする
                  </button>
                  <button
                    onClick={async () => {
                      setNotifications([]);
                      if (isSupabaseEnabled && userName) {
                        await supabase!.from("notifications").update({ hidden_at: new Date().toISOString() }).eq("user_name", userName).is("hidden_at", null);
                      }
                    }}
                    style={{ fontSize: 12, color: "#EF4444", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>
                    すべて削除
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
    </>
  );
}
