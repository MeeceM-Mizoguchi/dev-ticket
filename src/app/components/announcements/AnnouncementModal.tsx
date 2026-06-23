import { useEffect } from "react";
import { X, Megaphone } from "lucide-react";
import { escStack } from "@/app/lib/escStack";
import type { Announcement, AnnouncementItem } from "@/app/types";

interface Props {
  announcement: Announcement;
  onClose: () => void;
  anchorX?: number; // ヘッダーボタンの中心X座標（px）
}

export function AnnouncementModal({ announcement, onClose, anchorX = 0 }: Props) {
  useEffect(() => {
    escStack.push(onClose);
    return () => escStack.pop(onClose);
  }, [onClose]);

  const POPUP_WIDTH = Math.min(880, window.innerWidth - 48);
  const popupLeft = (window.innerWidth - POPUP_WIDTH) / 2;
  // ボタン中心をポップアップ左端からのオフセットに変換してクランプ
  const arrowLeft = anchorX > 0
    ? Math.max(24, Math.min(Math.round(anchorX - popupLeft), POPUP_WIDTH - 24))
    : Math.round(POPUP_WIDTH / 2);

  const items = announcement.items;

  return (
    <>
      <style>{`
        @keyframes announcePop {
          0%   { opacity: 0; transform: translateX(-50%) translateY(-10px) scale(0.97); }
          60%  { opacity: 1; transform: translateX(-50%) translateY(2px)   scale(1.005); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0)     scale(1); }
        }
      `}</style>

      {/* クリック外で閉じる透明オーバーレイ */}
      <div style={{ position: "fixed", inset: 0, zIndex: 1000 }} onClick={onClose} />

      {/* ポップオーバー本体 */}
      <div style={{
        position: "fixed",
        top: 52,
        left: "50%",
        transform: "translateX(-50%)",
        width: POPUP_WIDTH,
        maxWidth: "calc(100vw - 48px)",
        zIndex: 1001,
        animation: "announcePop 0.28s cubic-bezier(0.22, 1, 0.36, 1) forwards",
      }}>
        {/* 吹き出し矢印（三角形） */}
        <div style={{ position: "relative", height: 10, zIndex: 2 }}>
          {/* 影用の少し大きい三角（奥） */}
          <div style={{
            position: "absolute",
            top: 0,
            left: arrowLeft - 12,
            width: 0, height: 0,
            borderLeft: "12px solid transparent",
            borderRight: "12px solid transparent",
            borderBottom: "12px solid rgba(0,0,0,0.10)",
            filter: "blur(2px)",
          }} />
          {/* メインの三角 */}
          <div style={{
            position: "absolute",
            top: 1,
            left: arrowLeft - 11,
            width: 0, height: 0,
            borderLeft: "11px solid transparent",
            borderRight: "11px solid transparent",
            borderBottom: "11px solid #059669",
          }} />
        </div>

        {/* パネル本体 */}
        <div style={{
          background: "#fff",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,0.20), 0 4px 16px rgba(0,0,0,0.08)",
          maxHeight: "calc(100vh - 82px)",
          display: "flex",
          flexDirection: "column",
        }}>
          {/* ヘッダー */}
          <div style={{
            padding: "16px 22px",
            background: "linear-gradient(135deg, #059669 0%, #34D399 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Megaphone style={{ width: 16, height: 16, color: "#fff" }} />
              </div>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.01em" }}>
                {announcement.title || "リリースのお知らせ"}
              </h2>
            </div>
            <button
              onClick={onClose}
              style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "rgba(255,255,255,0.2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.35)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.2)"; }}
            >
              <X style={{ width: 14, height: 14, color: "#fff" }} />
            </button>
          </div>

          {/* コンテンツ */}
          <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
            {items.length === 0 ? (
              <p style={{ color: "#B0A9A4", fontSize: 13, textAlign: "center", padding: "32px 0" }}>
                内容がありません
              </p>
            ) : items.length === 1 ? (
              <ItemBlock item={items[0]} imageHeight={380} />
            ) : items.length === 2 ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
                {items.map((item, i) => <ItemBlock key={i} item={item} imageHeight={320} />)}
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16, alignItems: "start" }}>
                  {items.slice(0, 2).map((item, i) => <ItemBlock key={i} item={item} imageHeight={270} />)}
                </div>
                <ItemBlock item={items[2]} imageHeight={230} />
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ItemBlock({ item, imageHeight }: { item: AnnouncementItem; imageHeight: number }) {
  const hasImage = Boolean(item.imageUrl);
  const hasDesc = Boolean(item.description?.trim());
  if (!hasImage && !hasDesc) return null;

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(26,23,20,0.08)", background: "#FAFAF8" }}>
      {hasImage && (
        <img
          src={item.imageUrl}
          alt=""
          style={{ width: "100%", height: imageHeight, objectFit: "contain", display: "block", background: "#F1F5F9" }}
        />
      )}
      {hasDesc && (
        <div style={{ padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#3D3732", lineHeight: 1.75, margin: 0, whiteSpace: "pre-wrap" as const }}>
            {item.description}
          </p>
        </div>
      )}
    </div>
  );
}
