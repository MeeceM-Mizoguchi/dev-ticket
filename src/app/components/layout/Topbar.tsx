import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, Trash2, ClipboardList, Check, Bug, Megaphone, ChevronRight, Fingerprint, ShieldOff, Info, Copy, X, HelpCircle } from "lucide-react";
import { useNavigate } from "react-router";
import { useTabs } from "@/app/contexts/TabContext";
import { NOTIFICATIONS as MOCK_NOTIFICATIONS } from "@/app/data/mock";
import { Avatar } from "@/app/components/shared/Avatar";
import { useAuth } from "@/app/contexts/AuthContext";
import { biometricAuth } from "@/lib/biometricAuth";
import { GlobalSearch } from "@/app/components/layout/GlobalSearch";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapNotification } from "@/app/lib/mappers";
import { BugReportModal } from "@/app/components/bug-report/BugReportModal";
import { AnnouncementModal } from "@/app/components/announcements/AnnouncementModal";
import { APP_VERSION } from "@/lib/version";
import { copyText } from "@/lib/clipboard";
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
  const { userName, isSystemAdmin } = useAuth();
  const navigate = useNavigate();
  // Mac/iPad のタブモードでは、実URL遷移ではなくアクティブタブ内で遷移する。
  const tabs = useTabs();
  const openManual = (e: React.MouseEvent) => {
    if (tabs) {
      if (e.metaKey || e.ctrlKey) tabs.openTab("/manual");
      else tabs.navigateActive("/manual");
    } else {
      navigate("/manual");
    }
  };
  const [showBugReport, setShowBugReport] = useState(false);
  const closeBugReport = useCallback(() => setShowBugReport(false), []);
  const [showNotif, setShowNotif] = useState(false);
  const [hoveredNotifId, setHoveredNotifId] = useState<string | null>(null);
  const [existingActionNotifIds, setExistingActionNotifIds] = useState<Set<string>>(new Set());
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [hoveredActionBtnId, setHoveredActionBtnId] = useState<string | null>(null);

  // 生体認証メニュー
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioRegistered, setBioRegistered] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioToast, setBioToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // バージョン情報ポップアップ
  const [showVersion, setShowVersion] = useState(false);
  const [versionCopied, setVersionCopied] = useState(false);
  const [versionHistory, setVersionHistory] = useState<{ version: string; released_at: string }[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // お知らせ
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [announcementAnchorX, setAnnouncementAnchorX] = useState(0);
  const announcementBtnRef = useRef<HTMLButtonElement>(null);
  
  // お知らせの未読状態（光らせるフラグ）
  const [hasUnreadAnnounce, setHasUnreadAnnounce] = useState(false);

  const openVersion = useCallback(() => {
    setShowUserMenu(false);
    setVersionCopied(false);
    setShowVersion(true);
    if (isSystemAdmin && isSupabaseEnabled) {
      setHistoryLoading(true);
      setVersionHistory(null);
      supabase!.from("app_version").select("version, released_at").order("released_at", { ascending: false }).limit(50)
        .then(({ data }) => { setVersionHistory(data ?? []); setHistoryLoading(false); });
    }
  }, [isSystemAdmin]);

  const handleCopyVersion = useCallback(async () => {
    const ok = await copyText(APP_VERSION);
    if (ok) { setVersionCopied(true); setTimeout(() => setVersionCopied(false), 1800); }
  }, []);

  const refreshBioState = useCallback(async () => {
    try {
      const [supported, registered] = await Promise.all([
        biometricAuth.isSupported(),
        biometricAuth.isRegisteredOnThisDevice(),
      ]);
      setBioSupported(supported);
      setBioRegistered(registered);
    } catch { /* noop */ }
  }, []);

  useEffect(() => { void refreshBioState(); }, [refreshBioState]);

  useEffect(() => {
    if (!bioToast) return;
    const t = setTimeout(() => setBioToast(null), 3500);
    return () => clearTimeout(t);
  }, [bioToast]);

  const handleRegisterBio = useCallback(async () => {
    setBioBusy(true);
    try {
      const r = await biometricAuth.register();
      if (r.ok) {
        setBioRegistered(true);
        setBioToast({ kind: "success", text: "生体認証を登録しました。" });
      } else {
        setBioToast({ kind: "error", text: r.error || "生体認証の登録に失敗しました。" });
      }
    } catch (e: any) {
      setBioToast({ kind: "error", text: e?.message || "生体認証の登録に失敗しました。" });
    } finally {
      setBioBusy(false);
      setShowUserMenu(false);
    }
  }, []);

  const handleRemoveBio = useCallback(async () => {
    setBioBusy(true);
    try {
      const r = await biometricAuth.removeCredential();
      if (r.ok) {
        setBioRegistered(false);
        setBioToast({ kind: "success", text: "生体データを削除しました。" });
      } else {
        setBioToast({ kind: "error", text: r.error || "削除に失敗しました。" });
      }
    } catch (e: any) {
      setBioToast({ kind: "error", text: e?.message || "削除に失敗しました。" });
    } finally {
      setBioBusy(false);
      setShowUserMenu(false);
    }
  }, []);

  const [notifications, setNotifications] = useState<AppNotification[]>(
    !isSupabaseEnabled ? MOCK_NOTIFICATIONS : []
  );
  const [lastViewedAt, setLastViewedAt] = useState<string>(
    () => localStorage.getItem(NOTIF_VIEWED_KEY) ?? ""
  );

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
      
      const storageKey = `last_viewed_announcement_id_${userName || "guest"}`;
      const lastViewedId = localStorage.getItem(storageKey);
      
      if (!lastViewedId || lastViewedId !== `${data.id}_${data.updated_at || data.created_at}`) {
        setHasUnreadAnnounce(true);
      } else {
        setHasUnreadAnnounce(false);
      }
    } else {
      setAnnouncement(null);
    }
  }, [userName]);

  useEffect(() => { loadAnnouncement(); }, [loadAnnouncement]);

  const unreadCount = notifications.filter(n => !n.isRead).length;
  const hasNewSinceLastView = !showNotif && notifications.some(
    n => !n.isRead && (!lastViewedAt || n.createdAt > lastViewedAt)
  );

  const loadNotifications = async () => {
    if (!isSupabaseEnabled || !userName) return;
    const { data, error = null } = await supabase!
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
    const { data, error = null } = await supabase!
      .from("action_memos")
      .select("source_notification_id")
      .eq("user_name", userName)
      .not("source_notification_id", "is", null);
    if (error) {
      console.error("[action_memos] load existing ids failed:", error.message);
      return;
    }
    if (data) {
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

  const handleMarkAsReadAndClose = useCallback(() => {
    setShowAnnouncement(false);
    if (announcement) {
      const storageKey = `last_viewed_announcement_id_${userName || "guest"}`;
      localStorage.setItem(storageKey, `${announcement.id}_${announcement.updatedAt || announcement.createdAt}`);
      setHasUnreadAnnounce(false);
    }
  }, [announcement, userName]);

  return (
    <>
    {showBugReport && <BugReportModal onClose={closeBugReport} />}
    {showAnnouncement && announcement && (
      <AnnouncementModal announcement={announcement} onClose={handleMarkAsReadAndClose} anchorX={announcementAnchorX} />
    )}
    <header style={{ height: 52, background: "#FFFFFF", borderBottom: "1px solid rgba(20,26,22,0.08)", display: "flex", alignItems: "center", padding: "0 20px", gap: 10, flexShrink: 0 }}>
      <style>{`
        @keyframes bellGlow { 0%,100%{box-shadow:0 0 0 0 rgba(5,150,105,0.45)} 50%{box-shadow:0 0 0 7px rgba(5,150,105,0)} }
        @keyframes announcementPulse {
          0% { box-shadow: 0 2px 8px rgba(5,150,105,0.35), 0 0 0 0 rgba(5,150,105,0.5), inset 0 1px 0 rgba(255,255,255,0.22); }
          50% { box-shadow: 0 4px 14px rgba(5,150,105,0.50), 0 0 0 8px rgba(5,150,105,0), inset 0 1px 0 rgba(255,255,255,0.22); }
          100% { box-shadow: 0 2px 8px rgba(5,150,105,0.35), 0 0 0 0 rgba(5,150,105,0), inset 0 1px 0 rgba(255,255,255,0.22); }
        }
        /* 🌟 追加: バッジがピコピコと元気に飛び跳ねるアニメーション */
        @keyframes badgeBounce {
          0%, 100%, 20%, 50%, 80% { transform: translateY(0); }
          40% { transform: translateY(-5px); }
          60% { transform: translateY(-2.5px); }
        }
      `}</style>
      <GlobalSearch />

      {/* お知らせバナー */}
      {announcement && (
        <button
          ref={announcementBtnRef}
          onClick={() => {
            if (announcementBtnRef.current) {
              const rect = announcementBtnRef.current.getBoundingClientRect();
              setAnnouncementAnchorX(Math.round(rect.left + rect.width / 2));
            }
            setShowAnnouncement(true);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: hasUnreadAnnounce ? "0 13px 0 6px" : "0 13px 0 9px", // バッジの有無で左パディングを微調整
            height: 34,
            borderRadius: 10,
            border: "none",
            background: "linear-gradient(135deg, #34D399 0%, #059669 100%)",
            cursor: "pointer",
            flexShrink: 0,
            maxWidth: 360,
            transition: "opacity 0.15s, box-shadow 0.15s",
            animation: hasUnreadAnnounce ? "announcementPulse 2s infinite ease-in-out" : "none",
            boxShadow: hasUnreadAnnounce ? "none" : "0 2px 8px rgba(5,150,105,0.30), inset 0 1px 0 rgba(255,255,255,0.22)"
          }}
          onMouseEnter={e => {
            if (!hasUnreadAnnounce) e.currentTarget.style.boxShadow = "0 4px 14px rgba(5,150,105,0.45), inset 0 1px 0 rgba(255,255,255,0.22)";
          }}
          onMouseLeave={e => {
            if (!hasUnreadAnnounce) e.currentTarget.style.boxShadow = "0 2px 8px rgba(5,150,105,0.30), inset 0 1px 0 rgba(255,255,255,0.22)";
          }}
        >
          {/* 🌟 改善: 未読のときだけ、左側にピコピコ跳ねる赤い「NEW」バッジを出現させる */}
          {hasUnreadAnnounce ? (
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#EF4444",
              color: "#FFFFFF",
              fontSize: "9px",
              fontWeight: 900,
              padding: "1px 5px",
              borderRadius: "6px",
              height: "16px",
              boxShadow: "0 2px 4px rgba(239,68,68,0.3)",
              animation: "badgeBounce 2.5s infinite ease-in-out",
              flexShrink: 0
            }}>
              NEW
            </span>
          ) : (
            <Megaphone style={{ width: 14, height: 14, color: "rgba(255,255,255,0.88)", flexShrink: 0 }} />
          )}

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
          onClick={() => { setShowBugReport(true); }}
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

                          <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0, marginTop: 1, opacity: hoveredNotifId === notif.id ? 1 : 0, transition: "opacity 0.15s" }}>
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

        {/* 使い方ガイド（マニュアル）: ベルの右に常設。全ユーザー */}
        <button
          onClick={openManual}
          onContextMenu={tabs ? (e) => { e.preventDefault(); tabs.openTab("/manual"); } : undefined}
          title="使い方ガイド"
          style={{ position: "relative", width: 34, height: 34, borderRadius: 9, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", transition: "background 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
          <HelpCircle style={{ width: 16, height: 16, color: "#9E9690" }} />
        </button>

        <div style={{ width: 1, height: 18, background: "rgba(26,23,20,0.08)", margin: "0 4px" }} />
        <div style={{ position: "relative" }}>
          <button
            onClick={() => { if (showUserMenu) setShowUserMenu(false); else { void refreshBioState(); setShowUserMenu(true); } }}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 10px 4px 5px", borderRadius: 9999, background: showUserMenu ? "#ECECEC" : "#F4F5F6", border: "none", cursor: "pointer", transition: "background 0.15s" }}
            onMouseEnter={e => { if (!showUserMenu) (e.currentTarget as HTMLElement).style.background = "#ECECEC"; }}
            onMouseLeave={e => { if (!showUserMenu) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}>
            <Avatar name={userName} size="xs" />
            <span style={{ fontSize: 12, fontWeight: 600, color: "#3D3732" }}>{userName}</span>
          </button>

          {showUserMenu && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setShowUserMenu(false)} />
              <div style={{ position: "absolute", top: 40, right: 0, width: 264, background: "#fff", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.06)", border: "1px solid rgba(26,23,20,0.08)", zIndex: 50, overflow: "hidden", padding: 6 }}>
                {!bioSupported ? (
                  <div style={{ padding: "12px 12px", fontSize: 12, color: "#A09790", lineHeight: 1.5 }}>
                    この端末では生体認証を利用できません。
                  </div>
                ) : !bioRegistered ? (
                  <button
                    onClick={handleRegisterBio}
                    disabled={bioBusy}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 9, border: "none", background: "transparent", cursor: bioBusy ? "default" : "pointer", textAlign: "left", opacity: bioBusy ? 0.6 : 1, transition: "background 0.12s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                    <Fingerprint style={{ width: 16, height: 16, color: "#059669", flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1714" }}>{bioBusy ? "処理中…" : "生体認証を登録"}</span>
                  </button>
                ) : (
                  <button
                    onClick={handleRemoveBio}
                    disabled={bioBusy}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 9, border: "none", background: "transparent", cursor: bioBusy ? "default" : "pointer", textAlign: "left", opacity: bioBusy ? 0.6 : 1, transition: "background 0.12s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                    <ShieldOff style={{ width: 16, height: 16, color: "#EF4444", flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#EF4444" }}>{bioBusy ? "処理中…" : "生体データを削除"}</span>
                  </button>
                )}

                <div style={{ height: 1, background: "rgba(26,23,20,0.06)", margin: "4px 4px" }} />

                <button
                  onClick={openVersion}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", transition: "background 0.12s" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <Info style={{ width: 16, height: 16, color: "#6B6458", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", whiteSpace: "nowrap" }}>バージョン情報</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "#A09790", whiteSpace: "nowrap", flexShrink: 0 }}>{APP_VERSION}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 不具合・要望報告用モーダル */}
      {showBugReport && <BugReportModal onClose={closeBugReport} />}

      {/* リリース告知用モーダル */}
      {showAnnouncement && (
        <AnnouncementModal
          onClose={handleMarkAsReadAndClose}
          announcement={announcement}
        />
      )}

      {/* 生体認証用トースト */}
      {bioToast && (
        <div style={{ 
          position: "fixed", top: 64, right: 20, zIndex: 60, 
          display: "flex", alignItems: "center", gap: 8, 
          padding: "10px 14px", borderRadius: 10, 
          background: bioToast.kind === "success" ? "#ECFDF5" : "#FEF2F2", 
          border: `1px solid ${bioToast.kind === "success" ? "rgba(5,150,105,0.25)" : "rgba(239,68,68,0.25)"}`, 
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)" 
        }}>
          {bioToast.kind === "success"
            ? <Check style={{ width: 15, height: 15, color: "#059669" }} />
            : <ShieldOff style={{ width: 15, height: 15, color: "#EF4444" }} />}
          <span style={{ fontSize: 12.5, fontWeight: 600, color: bioToast.kind === "success" ? "#047857" : "#DC2626" }}>{bioToast.text}</span>
        </div>
      )}
    </header>
    </>
  );
}