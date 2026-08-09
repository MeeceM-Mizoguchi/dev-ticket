// 「このボードは自分にしか見えていない」ことを示すバッジ。
// ボード内（キャンバス右上）・ホワイトボード画面のヘッダー・リンクプレビューのヘッダーで共有する。
import { Lock } from "lucide-react";

export const PRIVATE_COLOR = "#6D28D9";
export const PRIVATE_BG = "#F5F3FF";
export const PRIVATE_BORDER = "rgba(124,58,237,0.28)";

interface Props {
  /** canvas = キャンバス右上（Excalidraw の標準ボタンと高さを揃える） / header = 画面ヘッダー */
  variant?: "canvas" | "header";
}

export function PrivateBadge({ variant = "header" }: Props) {
  const canvas = variant === "canvas";
  return (
    <span
      title="プライベートモード: このボードは作成者のあなたにしか見えません"
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, whiteSpace: "nowrap",
        height: canvas ? 32 : undefined,
        padding: canvas ? "0 10px" : "4px 10px",
        fontSize: 11, fontWeight: 700, lineHeight: 1,
        color: PRIVATE_COLOR, background: PRIVATE_BG,
        border: `1px solid ${PRIVATE_BORDER}`, borderRadius: 20,
      }}>
      <Lock style={{ width: 12, height: 12 }} />
      プライベート
    </span>
  );
}
