// 「このボードはプロジェクト全体には見えていない」ことを示すバッジ。
// ボード内（キャンバス右上）・ホワイトボード画面のヘッダー・リンクプレビューのヘッダーで共有する。
//
// プライベートには2つの状態がある（同じ visibility='private' の中の区別）:
//   ・共有先ゼロ = 作成者だけが見られる → 「プライベート」
//   ・共有先あり = 選ばれた人だけが見られる → 「限定公開」
import { Lock, Users } from "lucide-react";
import type { WhiteboardShareMember } from "@/app/types";

export const PRIVATE_COLOR = "#6D28D9";
export const PRIVATE_BG = "#F5F3FF";
export const PRIVATE_BORDER = "rgba(124,58,237,0.28)";

interface Props {
  /** canvas = キャンバス右上（Excalidraw の標準ボタンと高さを揃える） / header = 画面ヘッダー */
  variant?: "canvas" | "header";
  /** 限定公開先。空なら素のプライベート表示 */
  sharedWith?: WhiteboardShareMember[];
  /**
   * 自分がこのボードの作成者か。
   * false（＝共有された側）のときは、他に誰が見ているかを人数で語らない
   * ―― 共有相手から見た sharedWith は自分以外も含むが、文言は「共有されています」の方が正確。
   */
  isOwner?: boolean;
}

export function PrivateBadge({ variant = "header", sharedWith = [], isOwner = true }: Props) {
  const canvas = variant === "canvas";
  const shared = sharedWith.length > 0;
  const names = sharedWith.map((m) => m.name || "（不明なユーザー）").join("、");
  const label = !shared ? "プライベート" : isOwner ? `限定公開 ${sharedWith.length}人` : "限定公開";
  const title = !shared
    ? "プライベートモード: このボードは作成者のあなたにしか見えません"
    : isOwner
      ? `限定公開: あなたと ${names} だけが見られます`
      : "限定公開: 作成者から共有された、選ばれたメンバーだけが見られるボードです";
  const Icon = shared ? Users : Lock;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, whiteSpace: "nowrap",
        height: canvas ? 32 : undefined,
        padding: canvas ? "0 10px" : "4px 10px",
        fontSize: 11, fontWeight: 700, lineHeight: 1,
        color: PRIVATE_COLOR, background: PRIVATE_BG,
        border: `1px solid ${PRIVATE_BORDER}`, borderRadius: 20,
      }}>
      <Icon style={{ width: 12, height: 12 }} />
      {label}
    </span>
  );
}
