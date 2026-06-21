import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { X, ClipboardList, BookOpen, FileText, FolderOpen, ChevronRight, ExternalLink } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { RichEditor } from "./RichEditor";
import { usePreviewPanel } from "@/app/contexts/PreviewPanelContext";

interface BacklogPreview {
  id: string; title: string; status: string; priority: string;
  description: string; images: string[];
}
interface WikiPreview {
  id: string; title: string; content: string; images: string[]; parentTitle?: string;
}
interface MinutePreview {
  id: string; title: string; meetingDate: string; attendees: string[]; content: string; images: string[];
}
type PreviewData =
  | { type: "backlog"; data: BacklogPreview }
  | { type: "wiki"; data: WikiPreview }
  | { type: "minute"; data: MinutePreview }
  | null;

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  todo:        { label: "未着手",   color: "#6B6458", bg: "#F4F5F6" },
  "in-progress": { label: "進行中", color: "#0284C7", bg: "#E0F2FE" },
  done:        { label: "完了",     color: "#059669", bg: "#D1FAE5" },
  blocked:     { label: "ブロック中", color: "#DC2626", bg: "#FEE2E2" },
};
const PRIORITY: Record<string, { label: string; color: string }> = {
  low:      { label: "低",  color: "#6B7280" },
  medium:   { label: "中",  color: "#D97706" },
  high:     { label: "高",  color: "#DC2626" },
  critical: { label: "緊急", color: "#7C3AED" },
};

function PanelIcon({ type }: { type?: "backlog" | "wiki" | "minute" | null }) {
  const base: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
  const ic: React.CSSProperties = { width: 16, height: 16 };
  if (type === "backlog") return <div style={{ ...base, background: "#EDE9FE" }}><ClipboardList style={{ ...ic, color: "#6D28D9" }} /></div>;
  if (type === "wiki")    return <div style={{ ...base, background: "#E0F2FE" }}><BookOpen    style={{ ...ic, color: "#0284C7" }} /></div>;
  return                         <div style={{ ...base, background: "#D1FAE5" }}><FileText    style={{ ...ic, color: "#059669" }} /></div>;
}

function BacklogContent({ d }: { d: BacklogPreview }) {
  const s = STATUS[d.status] ?? STATUS.todo;
  const p = PRIORITY[d.priority] ?? PRIORITY.medium;
  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", marginBottom: 12 }}>{d.title || "無題"}</h2>
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ padding: "2px 8px", borderRadius: 5, background: s.bg, color: s.color, fontSize: 11, fontWeight: 700 }}>{s.label}</span>
        <span style={{ padding: "2px 8px", borderRadius: 5, background: "#F4F5F6", color: p.color, fontSize: 11, fontWeight: 700 }}>優先度: {p.label}</span>
      </div>
      {d.description
        ? <RichEditor value={d.description} readOnly minHeight={80} style={{ border: "none", background: "transparent" }} />
        : <p style={{ color: "#C9C4BB", fontSize: 13 }}>説明がありません</p>}
      {d.images.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {d.images.map(src => <img key={src} src={src} style={{ maxWidth: "100%", borderRadius: 6 }} />)}
        </div>
      )}
    </div>
  );
}

function WikiContent({ d }: { d: WikiPreview }) {
  return (
    <div>
      {d.parentTitle && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6, fontSize: 11, color: "#A09790" }}>
          <FolderOpen style={{ width: 11, height: 11 }} />
          <span>{d.parentTitle}</span>
          <ChevronRight style={{ width: 10, height: 10 }} />
        </div>
      )}
      <h2 style={{ fontSize: 17, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", marginBottom: 16 }}>{d.title || "無題のページ"}</h2>
      {d.content
        ? <RichEditor value={d.content} readOnly minHeight={80} style={{ border: "none", background: "transparent" }} />
        : <p style={{ color: "#C9C4BB", fontSize: 13 }}>コンテンツがありません</p>}
      {d.images.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {d.images.map(src => <img key={src} src={src} style={{ maxWidth: "100%", borderRadius: 6 }} />)}
        </div>
      )}
    </div>
  );
}

function MinuteContent({ d }: { d: MinutePreview }) {
  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", marginBottom: 10 }}>{d.title || "新規議事録"}</h2>
      <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: 12, color: "#6B6458", flexWrap: "wrap" }}>
        {d.meetingDate && <span style={{ display: "flex", alignItems: "center", gap: 4 }}>開催日: {d.meetingDate.replace(/-/g, "/")}</span>}
        {d.attendees.length > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            出席者: {d.attendees.join(", ")}
          </span>
        )}
      </div>
      {d.content
        ? <RichEditor value={d.content} readOnly minHeight={80} style={{ border: "none", background: "transparent" }} />
        : <p style={{ color: "#C9C4BB", fontSize: 13 }}>コンテンツがありません</p>}
      {d.images.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {d.images.map(src => <img key={src} src={src} style={{ maxWidth: "100%", borderRadius: 6 }} />)}
        </div>
      )}
    </div>
  );
}

function buildNavUrl(
  type: "backlog" | "wiki" | "minute",
  id: string,
  projectSlug: string,
  data: PreviewData
): string {
  if (!projectSlug) return "";
  if (type === "backlog") return `/${projectSlug}/backlog/${id}`;
  if (type === "minute") {
    const slugFromId = id.match(/^\d{8}-\d{6}$/) ? id : "";
    return slugFromId ? `/${projectSlug}/minutes/${slugFromId}` : `/${projectSlug}/minutes/${id}`;
  }
  // wiki
  if (data?.type === "wiki") {
    const parent = data.data.parentTitle;
    const title = data.data.title || "無題のページ";
    const encoded = encodeURIComponent(title);
    if (parent) return `/${projectSlug}/wiki/${encodeURIComponent(parent)}/${encoded}`;
    return `/${projectSlug}/wiki/${encoded}`;
  }
  return `/${projectSlug}/wiki`;
}

export function LinkPreviewPanel() {
  const { target, close } = usePreviewPanel();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<PreviewData>(null);
  const [loading, setLoading] = useState(false);
  const prevId = useRef<string | null>(null);

  const projectSlug = typeof window !== "undefined"
    ? window.location.pathname.split("/").filter(Boolean)[0] ?? ""
    : "";

  // マウント/アンマウントアニメーション
  useEffect(() => {
    if (target) {
      setMounted(true);
      // 2フレーム後にvisibleにしてトランジションを発火
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    } else {
      setVisible(false);
      const t = setTimeout(() => { setMounted(false); setData(null); prevId.current = null; }, 300);
      return () => clearTimeout(t);
    }
  }, [target]);

  // データ取得
  useEffect(() => {
    if (!target || !isSupabaseEnabled) return;
    if (target.id === prevId.current) return;
    prevId.current = target.id;
    setLoading(true);
    setData(null);

    if (target.type === "backlog") {
      supabase!.from("backlog_items").select("id, title, status, priority, description, images").eq("id", target.id).maybeSingle()
        .then(({ data: r }) => {
          if (r) setData({ type: "backlog", data: { id: r.id, title: r.title || "", status: r.status || "todo", priority: r.priority || "medium", description: r.description || "", images: r.images || [] } });
          setLoading(false);
        });
    } else if (target.type === "wiki") {
      supabase!.from("wiki_pages").select("id, title, content, images, parent_id").eq("id", target.id).maybeSingle()
        .then(async ({ data: r }) => {
          if (!r) { setLoading(false); return; }
          let parentTitle: string | undefined;
          if (r.parent_id) {
            const { data: par } = await supabase!.from("wiki_pages").select("title").eq("id", r.parent_id).maybeSingle();
            parentTitle = par?.title;
          }
          setData({ type: "wiki", data: { id: r.id, title: r.title || "", content: r.content || "", images: r.images || [], parentTitle } });
          setLoading(false);
        });
    } else {
      supabase!.from("meeting_minutes").select("id, title, meeting_date, attendees, content, images").eq("id", target.id).maybeSingle()
        .then(({ data: r }) => {
          if (r) setData({ type: "minute", data: { id: r.id, title: r.title || "", meetingDate: r.meeting_date || "", attendees: r.attendees || [], content: r.content || "", images: r.images || [] } });
          setLoading(false);
        });
    }
  }, [target]);

  // ESC で閉じる
  useEffect(() => {
    if (!mounted) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [mounted, close]);

  if (!mounted) return null;

  const typeLabel = target?.type === "backlog" ? "バックログ" : target?.type === "wiki" ? "Wiki" : "議事録";

  return (
    <>
      {/* 背景オーバーレイ */}
      <div
        onClick={close}
        style={{
          position: "fixed", inset: 0, zIndex: 900,
          background: "rgba(10,14,12,0.35)",
          backdropFilter: "blur(2px)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.28s",
        }}
      />

      {/* スライドパネル */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: 500, zIndex: 901,
        background: "#FFFFFF",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.16)",
        display: "flex", flexDirection: "column",
        transform: visible ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)",
      }}>
        {/* ヘッダー */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(26,23,20,0.08)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <PanelIcon type={target?.type} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#A09790", letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
              {typeLabel}
            </span>
          </div>
          {target && projectSlug && (
            <button
              onClick={() => {
                const url = buildNavUrl(target.type, target.id, projectSlug, data);
                if (url) { close(); navigate(url); }
              }}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "#4B4540", cursor: "pointer", whiteSpace: "nowrap" as const }}>
              <ExternalLink style={{ width: 12, height: 12 }} />
              このページを開く
            </button>
          )}
          <button onClick={close} style={{ padding: 6, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* ボディ */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 32px" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#B0A9A4", fontSize: 13 }}>
              読み込み中...
            </div>
          ) : data ? (
            data.type === "backlog" ? <BacklogContent d={data.data} /> :
            data.type === "wiki"    ? <WikiContent    d={data.data} /> :
                                      <MinuteContent  d={data.data} />
          ) : !loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#B0A9A4", fontSize: 13 }}>
              コンテンツが見つかりません
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
