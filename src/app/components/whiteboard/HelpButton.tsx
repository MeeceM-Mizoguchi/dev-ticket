// キーボードショートカット一覧（Excalidraw標準のHelpDialog）を開くアイコンボタン。
// 標準のハンバーガーメニュー/ヘルプはCSSで隠し、これだけを右上に出す。
import { HelpCircle } from "lucide-react";

export function HelpButton({ api }: { api: any }) {
  return (
    <button
      onClick={() => api.updateScene({ appState: { openDialog: { name: "help" } } })}
      title="キーボードショートカット一覧"
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32,
        color: "#6B6458", background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8,
        cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <HelpCircle style={{ width: 15, height: 15 }} />
    </button>
  );
}
