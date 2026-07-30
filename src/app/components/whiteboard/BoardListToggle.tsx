// ボード一覧サイドバーの開閉トグル（BRU9-046）。
// inline   : サイドバー上部に置く「たたむ」ボタン（軽量・控えめ）
// floating : たたんだ状態でキャンバス左上に浮かせる「表示」ボタン（FullscreenButton と同じ見た目）
// ※ Excalidraw 標準の左上ハンバーガー/サイドバートリガーは CSS で非表示（WhiteboardCanvas）、
//    左プロパティ島は margin-top:52px のため、キャンバス左上（y<52）は衝突しない空き領域。
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  variant: "inline" | "floating";
}

export function BoardListToggle({ collapsed, onToggle, variant }: Props) {
  const label = collapsed ? "ボード一覧を表示" : "ボード一覧をたたむ";
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  if (variant === "floating") {
    return (
      <button onClick={onToggle} title={label} aria-label={label}
        style={{
          position: "absolute", left: 10, top: 10, zIndex: 1,
          display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, flexShrink: 0,
          color: "#6B6458", background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8,
          cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}>
        <Icon style={{ width: 15, height: 15 }} />
      </button>
    );
  }

  return (
    <button onClick={onToggle} title={label} aria-label={label}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20,
        background: "none", border: "none", borderRadius: 5, cursor: "pointer", color: "#A09790", padding: 0,
      }}>
      <Icon style={{ width: 13, height: 13 }} />
    </button>
  );
}
