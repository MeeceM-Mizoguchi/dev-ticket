// エクスポート(Excel/Word/PDF)生成中に表示するグローバル進捗オーバーレイ。
// 生成処理はメインスレッドを一時ブロックするため、プログレスバーは transform ベースの
// CSSアニメ(コンポジタ駆動)にして、生成中でも滑らかに動き続けるようにしている。
// アプリ直下に1つだけマウントする。進捗は exportProgress ストアから購読。
import { useSyncExternalStore } from "react";
import { FileSpreadsheet, FileText, FileType2 } from "lucide-react";
import { subscribeExportProgress, getExportProgress } from "@/app/lib/articleExport/exportProgress";
import type { ExportFormat } from "@/app/lib/articleExport";

const META: Record<ExportFormat, { label: string; c1: string; c2: string; Icon: typeof FileText }> = {
  xlsx: { label: "Excel", c1: "#059669", c2: "#34D399", Icon: FileSpreadsheet },
  docx: { label: "Word", c1: "#2563EB", c2: "#60A5FA", Icon: FileText },
  pdf: { label: "PDF", c1: "#DC2626", c2: "#F87171", Icon: FileType2 },
};

const KEYFRAMES = `
@keyframes exp-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes exp-pop { from { opacity: 0; transform: translateY(10px) scale(0.96) } to { opacity: 1; transform: none } }
@keyframes exp-slide {
  0%   { transform: translateX(-140%) scaleX(0.55); }
  50%  { transform: translateX(55%)  scaleX(1); }
  100% { transform: translateX(260%) scaleX(0.55); }
}
@keyframes exp-dots { 0%, 20% { opacity: 0.2 } 50% { opacity: 1 } 80%, 100% { opacity: 0.2 } }
`;

export function ExportProgressOverlay() {
  const state = useSyncExternalStore(subscribeExportProgress, getExportProgress, getExportProgress);
  if (!state.active || !state.format) return null;

  const meta = META[state.format];
  const { Icon } = meta;
  const determinate = state.phase === "images" && state.total > 0;
  const pct = determinate ? Math.round((state.loaded / state.total) * 100) : 0;

  const phaseText =
    state.phase === "render" ? `${meta.label}ファイルを生成しています`
    : state.phase === "images" ? (state.total > 0 ? `画像を取得しています ${state.loaded}/${state.total}` : "画像を確認しています")
    : "エクスポートを準備しています";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100000,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(26,23,20,0.34)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        animation: "exp-fade 0.18s ease-out",
      }}
    >
      <style>{KEYFRAMES}</style>
      <div
        style={{
          width: 340, maxWidth: "88vw", background: "#FFFFFF", borderRadius: 20,
          padding: "26px 26px 24px", boxShadow: "0 24px 60px rgba(26,23,20,0.22), 0 2px 8px rgba(26,23,20,0.08)",
          border: "1px solid rgba(26,23,20,0.05)", animation: "exp-pop 0.24s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div
            style={{
              width: 46, height: 46, borderRadius: 13, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: `linear-gradient(135deg, ${meta.c1}, ${meta.c2})`,
              boxShadow: `0 6px 16px ${meta.c1}44`,
            }}
          >
            <Icon style={{ width: 22, height: 22, color: "#fff" }} strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>
              エクスポート中
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: meta.c1, background: `${meta.c1}14`, padding: "2px 8px", borderRadius: 999, verticalAlign: "middle" }}>
                {meta.label}
              </span>
            </div>
            {state.scope && (
              <div style={{ fontSize: 12, color: "#9E9690", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {state.scope}
              </div>
            )}
          </div>
        </div>

        {/* プログレスバー */}
        <div style={{ position: "relative", height: 8, borderRadius: 999, background: "#EEF0F1", overflow: "hidden" }}>
          {determinate ? (
            <div
              style={{
                height: "100%", width: `${pct}%`, borderRadius: 999,
                background: `linear-gradient(90deg, ${meta.c1}, ${meta.c2})`,
                transition: "width 0.35s cubic-bezier(0.4,0,0.2,1)",
              }}
            />
          ) : (
            <div
              style={{
                position: "absolute", top: 0, left: 0, height: "100%", width: "42%", borderRadius: 999,
                background: `linear-gradient(90deg, ${meta.c1}, ${meta.c2})`,
                animation: "exp-slide 1.15s ease-in-out infinite", willChange: "transform",
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <span style={{ fontSize: 12, color: "#6B6458", display: "inline-flex", alignItems: "center" }}>
            {phaseText}
            {!determinate && (
              <span style={{ display: "inline-flex", marginLeft: 3 }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{ animation: `exp-dots 1.2s ${i * 0.18}s infinite`, marginLeft: 1 }}>.</span>
                ))}
              </span>
            )}
          </span>
          {determinate && <span style={{ fontSize: 12, fontWeight: 700, color: meta.c1 }}>{pct}%</span>}
        </div>
      </div>
    </div>
  );
}
