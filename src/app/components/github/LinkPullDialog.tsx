// チケット詳細の「PRを紐付ける」で開く、紐付け候補の選択（BRU20-006）。
//
// 以前は候補の一覧を関連PRの枠の一番下（「プルリクエスト不要」の下）に出していたため、
// 右上のボタンを押しても手元に変化が無く、何も起きていないように見えた。
// 押したらすぐこのモーダルを開き、候補の読み込み中もここに進捗を出す。
//
// 取得・紐付けの処理は呼び出し側（TicketPrSection の openPicker / handleLink）のまま。
// ここは表示だけを持つ。
import { Link2, Loader2 } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import type { GithubPull } from "@/app/types";

export function LinkPullDialog({ pulls, wbsKey, isLinked, linking, busy, onLink, onClose }: {
  /** オープンなPR。null なら読み込み中 */
  pulls: GithubPull[] | null;
  /** 大文字に揃えたチケットのWBS番号。一致の表示に使う */
  wbsKey: string;
  /** すでにこのチケットに紐付いているか。紐付け済みの行は押せなくする */
  isLinked: (number: number) => boolean;
  /** 紐付け処理中のPR番号 */
  linking: number | null;
  busy: boolean;
  onLink: (number: number) => void;
  onClose: () => void;
}) {
  // 紐付け中に閉じられると、完了後のトースト・一覧の更新と画面が食い違うので、閉じる操作をすべて塞ぐ
  const closing = linking !== null;

  return (
    <DialogShell title="プルリクエストを紐付ける" size="md" minHeight={0} onClose={onClose} busy={closing}
      footer={<BtnSecondary onClick={onClose} disabled={closing}>キャンセル</BtnSecondary>}>
      {/* spin は各画面で個別に定義されているので、名前をぶつけないよう接頭辞を付けて持つ */}
      <style>{"@keyframes lpd-spin { to { transform: rotate(360deg); } }"}</style>
      {!pulls ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "28px 0" }}>
          <Loader2 style={{ width: 16, height: 16, color: "#0284C7", animation: "lpd-spin 1s linear infinite" }} />
          <span style={{ fontSize: 13, color: "#6B6458" }}>オープンなプルリクエストを読み込んでいます...</span>
        </div>
      ) : pulls.length === 0 ? (
        <p style={{ fontSize: 13, color: "#8A837B", padding: "20px 0", textAlign: "center" as const }}>オープンなプルリクエストはありません。</p>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.7 }}>
            紐付けるプルリクエストを選んでください。{wbsKey && "このチケットの番号を含むものが上に並びます。"}
          </p>
          <div style={{ border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, overflow: "hidden" }}>
            <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
              {pulls.map(p => {
                const already = isLinked(p.number);
                // 押した行だけ進捗を出し、他の行は薄くして「今はこれを処理中」と分かるようにする
                const linkingThis = linking === p.number;
                return (
                  <button key={p.number} onClick={() => !already && onLink(p.number)} disabled={already || busy}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 12px", border: "none", borderBottom: "1px solid rgba(26,23,20,0.05)", background: linkingThis ? "#EFF6FF" : already ? "#F9FAFB" : "#FFF", cursor: already || busy ? "default" : "pointer", textAlign: "left" as const, opacity: linking !== null && !linkingThis ? 0.45 : 1, transition: "opacity .15s, background .15s" }}>
                    {linkingThis
                      ? <Loader2 style={{ width: 12, height: 12, color: "#0284C7", flexShrink: 0, animation: "lpd-spin 1s linear infinite" }} />
                      : <Link2 style={{ width: 12, height: 12, color: "#0284C7", flexShrink: 0 }} />}
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#8A837B", fontFamily: "var(--font-mono)", flexShrink: 0 }}>#{p.number}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.title}</span>
                    {linkingThis ? (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#0284C7", flexShrink: 0 }}>紐付け中...</span>
                    ) : (
                      <>
                        {wbsKey && p.detectedWbs.includes(wbsKey) && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", flexShrink: 0 }}>一致</span>
                        )}
                        {already && <span style={{ fontSize: 10, color: "#B0A9A4", flexShrink: 0 }}>紐付け済み</span>}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </DialogShell>
  );
}
