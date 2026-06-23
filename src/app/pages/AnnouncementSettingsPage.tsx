import { useState, useEffect, useRef, useCallback } from "react";
import { Megaphone, Plus, Trash2, Image as ImageIcon, Save, Eye } from "lucide-react";
import { Navigate } from "react-router";
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { AnnouncementModal } from "@/app/components/announcements/AnnouncementModal";
import type { Announcement, AnnouncementItem } from "@/app/types";

const MAX_ITEMS = 3;

function emptyItem(): AnnouncementItem {
  return { imageUrl: "", description: "" };
}

async function uploadAnnouncementImage(file: File): Promise<string> {
  if (!isSupabaseEnabled || !supabase) return URL.createObjectURL(file);
  const extMap: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
  const ext = extMap[file.type] ?? "png";
  const path = `announcements/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const { data, error } = await supabase.storage.from("ticket-images").upload(path, file, { upsert: true, contentType: file.type });
  if (error || !data) return "";
  const { data: urlData } = supabase.storage.from("ticket-images").getPublicUrl(path);
  return urlData.publicUrl;
}

export function AnnouncementSettingsPage() {
  const { userPermissions } = useAuth();
  if (!userPermissions.canUpdateAnnouncement) return <Navigate to="/dashboard" replace />;

  const [title, setTitle] = useState("");
  const [items, setItems] = useState<AnnouncementItem[]>([emptyItem()]);
  const [announcementId, setAnnouncementId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [focusedSlotIdx, setFocusedSlotIdx] = useState<number | null>(null);
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const itemsRef = useRef<AnnouncementItem[]>(items);
  const focusedIdxRef = useRef<number | null>(null);
  itemsRef.current = items;
  focusedIdxRef.current = focusedSlotIdx;

  const loadAnnouncement = useCallback(async () => {
    if (!isSupabaseEnabled) { setLoading(false); return; }
    const { data } = await supabase!
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setAnnouncementId(data.id);
      setTitle(data.title ?? "");
      const rawItems: AnnouncementItem[] = Array.isArray(data.items)
        ? data.items.map((r: Record<string, string>) => ({ imageUrl: r.image_url ?? "", description: r.description ?? "" }))
        : [];
      setItems(rawItems.length > 0 ? rawItems : [emptyItem()]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAnnouncement(); }, [loadAnnouncement]);

  const handleImageUpload = useCallback(async (idx: number, file: File) => {
    setUploadingIdx(idx);
    const url = await uploadAnnouncementImage(file);
    setUploadingIdx(null);
    if (!url) return;
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, imageUrl: url } : item));
  }, []);

  useEffect(() => {
    const handler = async (e: ClipboardEvent) => {
      const clipItems = Array.from(e.clipboardData?.items ?? []);
      const imgItem = clipItems.find(i => i.type.startsWith("image/"));
      if (!imgItem) return;
      const file = imgItem.getAsFile();
      if (!file) return;
      const current = itemsRef.current;
      const focused = focusedIdxRef.current;
      const targetIdx = (focused !== null && focused < current.length)
        ? focused
        : current.findIndex(it => !it.imageUrl);
      if (targetIdx < 0) return;
      e.preventDefault();
      await handleImageUpload(targetIdx, file);
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [handleImageUpload]);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const dbItems = items.filter(it => it.imageUrl || it.description).map(it => ({ image_url: it.imageUrl, description: it.description }));
    if (isSupabaseEnabled) {
      const payload = { title: title.trim(), items: dbItems, is_active: true, updated_at: new Date().toISOString() };
      if (announcementId) {
        await supabase!.from("announcements").update(payload).eq("id", announcementId);
      } else {
        const { data } = await supabase!.from("announcements").insert({ ...payload, created_at: new Date().toISOString() }).select("id").single();
        if (data) setAnnouncementId(data.id);
      }
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const previewAnnouncement: Announcement = {
    id: announcementId ?? "preview",
    orgId: "",
    title: title || "プレビュー",
    items: items.filter(it => it.imageUrl || it.description),
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (loading) {
    return <div style={{ padding: 32, color: "#B0A9A4", fontSize: 13 }}>読み込み中...</div>;
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "calc(100vh - 52px)",
      padding: "20px 28px",
      boxSizing: "border-box" as const,
      overflow: "hidden",
    }}>
      {/* ── ヘッダー行 ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(145deg, #34D399, #059669)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Megaphone style={{ width: 16, height: 16, color: "#fff" }} />
          </div>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0, letterSpacing: "-0.01em" }}>お知らせ設定</h1>
            <p style={{ fontSize: 11, color: "#9CA3AF", margin: 0 }}>共通ヘッダーのリリースお知らせを管理します（全ユーザー向け）</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => previewAnnouncement.items.length > 0 && setShowPreview(true)}
            disabled={previewAnnouncement.items.length === 0}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.14)", background: "transparent", color: previewAnnouncement.items.length > 0 ? "#374151" : "#C9C4BB", cursor: previewAnnouncement.items.length > 0 ? "pointer" : "not-allowed" }}
            onMouseEnter={e => { if (previewAnnouncement.items.length > 0) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <Eye style={{ width: 13, height: 13 }} /> プレビュー
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || saving}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "none", cursor: title.trim() && !saving ? "pointer" : "not-allowed", background: title.trim() && !saving ? "linear-gradient(135deg, #34D399, #059669)" : "#E5E7EB", color: title.trim() && !saving ? "#fff" : "#9CA3AF", boxShadow: title.trim() && !saving ? "0 2px 8px rgba(5,150,105,0.3)" : "none" }}
          >
            <Save style={{ width: 13, height: 13 }} />
            {saving ? "保存中..." : saved ? "保存しました ✓" : "保存する"}
          </button>
        </div>
      </div>

      {/* ── タイトル ── */}
      <div style={{ marginBottom: 14, flexShrink: 0 }}>
        <label style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 5 }}>
          タイトル <span style={{ color: "#EF4444" }}>*</span>
          <span style={{ fontWeight: 400, color: "#9CA3AF", fontSize: 10 }}>
            タイトルのみの場合、ヘッダークリックで詳細は表示されません
          </span>
        </label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="例：v2.5 リリースのお知らせ"
          style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid rgba(26,23,20,0.14)", borderRadius: 9, outline: "none", color: "#1A1714", background: "#fff", boxSizing: "border-box" as const }}
          onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = "#059669"; }}
          onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.14)"; }}
        />
      </div>

      {/* ── 3カラムグリッド（残り高さをすべて使用） ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${MAX_ITEMS}, 1fr)`,
        gap: 14,
        flex: 1,
        minHeight: 0,
      }}>
        {items.map((item, idx) => {
          const isDragOver = dragOverIdx === idx;
          const isUploading = uploadingIdx === idx;
          return (
            <div
              key={idx}
              style={{
                display: "flex",
                flexDirection: "column",
                border: `1px solid ${isDragOver ? "rgba(5,150,105,0.5)" : "rgba(26,23,20,0.10)"}`,
                borderRadius: 12,
                padding: "12px 14px",
                background: isDragOver ? "rgba(5,150,105,0.03)" : "#FAFAF8",
                transition: "border-color 0.15s, background 0.15s",
                overflow: "hidden",
                boxSizing: "border-box" as const,
              }}
              onFocus={() => setFocusedSlotIdx(idx)}
              onBlur={() => setFocusedSlotIdx(prev => prev === idx ? null : prev)}
              onDragOver={e => { e.preventDefault(); setDragOverIdx(idx); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverIdx(null); }}
              onDrop={async e => {
                e.preventDefault(); setDragOverIdx(null);
                const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith("image/"));
                if (f) await handleImageUpload(idx, f);
              }}
            >
              {/* カードヘッダー */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
                  セット {idx + 1}
                </span>
                {items.length > 1 && (
                  <button
                    onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 3, borderRadius: 5, color: "#C9C4BB", lineHeight: 0 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#EF4444"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}
                  >
                    <Trash2 style={{ width: 12, height: 12 }} />
                  </button>
                )}
              </div>

              {/* 画像エリア（flex:1 で縦スペースを使い切る） */}
              <div style={{ flex: 1, minHeight: 0, marginBottom: 10, position: "relative", borderRadius: 9, overflow: "hidden" }}>
                {item.imageUrl ? (
                  <>
                    <img
                      src={item.imageUrl} alt=""
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#F1F5F9" }}
                    />
                    <button
                      onClick={() => setItems(prev => prev.map((it, i) => i === idx ? { ...it, imageUrl: "" } : it))}
                      style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: "50%", background: "rgba(26,23,20,0.75)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}
                    >
                      <Trash2 style={{ width: 10, height: 10, color: "#fff" }} />
                    </button>
                  </>
                ) : (
                  <label
                    style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 8, border: `1.5px dashed ${isDragOver ? "rgba(5,150,105,0.6)" : "rgba(26,23,20,0.12)"}`, borderRadius: 9, cursor: "pointer", background: isDragOver ? "rgba(5,150,105,0.04)" : "#fff", opacity: isUploading ? 0.6 : 1, transition: "border-color 0.15s" }}
                    onMouseEnter={e => { if (!isUploading) (e.currentTarget as HTMLElement).style.borderColor = "rgba(5,150,105,0.4)"; }}
                    onMouseLeave={e => { if (!isDragOver) (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.12)"; }}
                  >
                    <ImageIcon style={{ width: 24, height: 24, color: isDragOver ? "#059669" : "#C9C4BB" }} />
                    <span style={{ fontSize: 11, color: isDragOver ? "#059669" : "#9CA3AF", fontWeight: 500, textAlign: "center" as const, lineHeight: 1.6 }}>
                      {isUploading ? "アップロード中..." : "クリック・Ctrl+V\nドラッグ&ドロップ"}
                    </span>
                    <input
                      ref={el => { fileInputRefs.current[idx] = el; }}
                      type="file" accept="image/*" style={{ display: "none" }}
                      onChange={async e => {
                        const f = e.target.files?.[0];
                        if (f) await handleImageUpload(idx, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>

              {/* 説明テキスト */}
              <textarea
                value={item.description}
                onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, description: e.target.value } : it))}
                placeholder="説明を入力..."
                rows={3}
                style={{ flexShrink: 0, width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, outline: "none", resize: "none" as const, color: "#1A1714", background: "#fff", fontFamily: "inherit", boxSizing: "border-box" as const, lineHeight: 1.6 }}
                onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = "#059669"; }}
                onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.12)"; }}
              />
            </div>
          );
        })}

        {/* 追加カード */}
        {items.length < MAX_ITEMS && (
          <button
            onClick={() => setItems(prev => [...prev, emptyItem()])}
            style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 10, border: "1.5px dashed rgba(26,23,20,0.12)", borderRadius: 12, background: "transparent", cursor: "pointer", transition: "border-color 0.15s, background 0.15s" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(5,150,105,0.4)";
              (e.currentTarget as HTMLElement).style.background = "rgba(5,150,105,0.03)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.12)";
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <div style={{ width: 38, height: 38, borderRadius: "50%", border: "1.5px dashed rgba(26,23,20,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Plus style={{ width: 16, height: 16, color: "#9CA3AF" }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#9CA3AF" }}>セットを追加</span>
          </button>
        )}

        {/* セット数が1のとき空カラムで3列維持 */}
        {items.length === 1 && <div />}
      </div>

      {showPreview && (
        <AnnouncementModal announcement={previewAnnouncement} onClose={() => setShowPreview(false)} />
      )}
    </div>
  );
}
