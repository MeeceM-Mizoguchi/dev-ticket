// コメント一覧ポップアップ（ENHA2-039）。未解決／解決済みをタブで分けて並べる。
//
// 解決済みのピンはキャンバスから消える（盤面を汚さないため）ので、後から見返す入口がここになる。
// 行をクリックすると該当ピンまで移動して吹き出しを開く（解決済みでもその時だけピンが出る）。
import { useMemo, useState } from "react";
import { X, CheckCircle2, MessageSquare } from "lucide-react";
import { formatCommentTime, initialOf, type WbComment, type WbCommentReply } from "@/app/lib/whiteboardComments";
import { wbUserColor } from "@/app/lib/whiteboardService";
import { MentionText } from "./MentionText";

interface Props {
  comments: WbComment[];
  replies: Record<string, WbCommentReply[]>;
  activeId: string | null;
  /** 本文中のメンションを色付きで出すためのメンバー名 */
  members: string[];
  /** 自分宛てのメンションだけ色を変える */
  selfName?: string;
  onJump: (commentId: string) => void;
  onClose: () => void;
  /**
   * 出す位置。開くボタンの近くに出したいので、画面ごとに変える。
   *   bottom … ホワイトボード（下部中央のツールバーを避けて右下）
   *   top    … ファイルビューア（一覧ボタンがヘッダー右上にあるのでその真下）
   */
  placement?: "bottom" | "top";
}

export function CommentListPanel({ comments, replies, activeId, members, selfName, onJump, onClose, placement = "bottom" }: Props) {
  const [tab, setTab] = useState<"open" | "resolved">("open");

  // 新しいものを上に（一覧は「最近の話題から追う」ほうが自然）
  const { open, resolved } = useMemo(() => {
    const sorted = [...comments].sort((a, b) => b.createdAt - a.createdAt);
    return {
      open: sorted.filter((c) => !c.resolved),
      resolved: sorted.filter((c) => c.resolved),
    };
  }, [comments]);

  const list = tab === "open" ? open : resolved;

  const tabBtn = (key: "open" | "resolved", label: string, count: number) => (
    <button
      onClick={() => setTab(key)}
      style={{
        flex: 1, padding: "6px 8px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
        color: tab === key ? "#1A1714" : "#A09790", background: "transparent", border: "none",
        borderBottom: `2px solid ${tab === key ? "#059669" : "transparent"}`,
      }}
    >{label}（{count}）</button>
  );

  return (
    <div
      data-wbc-ui
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: "absolute", right: 16, ...(placement === "top" ? { top: 12 } : { bottom: 64 }),
        // 件数で伸び縮みすると開くたびに位置が変わって落ち着かないので、高さは常に固定（中身が少なければ余白になる）
        width: 320, height: "60%", minHeight: 240, maxHeight: "calc(100% - 88px)", zIndex: 3,
        pointerEvents: "auto", display: "flex", flexDirection: "column",
        background: "#fff", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.18)", overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 12px", borderBottom: "1px solid rgba(26,23,20,0.07)" }}>
        <MessageSquare style={{ width: 13, height: 13, color: "#F59E0B" }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>コメント一覧</span>
        <button onClick={onClose} title="閉じる"
          style={{ marginLeft: "auto", padding: 3, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4", display: "flex" }}>
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid rgba(26,23,20,0.07)" }}>
        {tabBtn("open", "未解決", open.length)}
        {tabBtn("resolved", "解決済み", resolved.length)}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 6 }}>
        {list.length === 0 ? (
          <div style={{ padding: "22px 12px", fontSize: 11, color: "#A09790", textAlign: "center" }}>
            {tab === "open" ? "未解決のコメントはありません" : "解決済みのコメントはありません"}
          </div>
        ) : list.map((c) => {
          const count = (replies[c.id] ?? []).length;
          return (
            <button
              key={c.id}
              onClick={() => onJump(c.id)}
              style={{
                display: "flex", gap: 8, width: "100%", padding: "8px 8px", marginBottom: 2, textAlign: "left",
                background: activeId === c.id ? "#F0F9FF" : "transparent", border: "none", borderRadius: 8,
                cursor: "pointer", fontFamily: "inherit",
              }}
              onMouseEnter={(e) => { if (activeId !== c.id) e.currentTarget.style.background = "#F7F7F5"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = activeId === c.id ? "#F0F9FF" : "transparent"; }}
            >
              <div style={{
                width: 22, height: 22, flexShrink: 0, borderRadius: "50%", background: wbUserColor(c.userId || "anon"),
                color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
              }}>{initialOf(c.userName)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.userName}</span>
                  <span style={{ fontSize: 10, color: "#A09790", flexShrink: 0 }}>{formatCommentTime(c.createdAt)}</span>
                  {c.resolved && <CheckCircle2 style={{ width: 12, height: 12, color: "#059669", flexShrink: 0 }} />}
                </div>
                <div style={{
                  fontSize: 11, lineHeight: 1.6, color: "#6B6458", marginTop: 2,
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                  wordBreak: "break-word",
                }}>
                  <MentionText text={c.text} members={members} selfName={selfName} />
                </div>
                {count > 0 && (
                  <div style={{ fontSize: 10, color: "#0284C7", marginTop: 2, fontWeight: 600 }}>返信 {count} 件</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
