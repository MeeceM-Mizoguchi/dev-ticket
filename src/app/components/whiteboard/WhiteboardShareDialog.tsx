// プライベートボードの共有先（限定公開）を付け外しするダイアログ。
//
// プライベートモードは元々「作成者だけ」の二値だったが、
// 「自分と、選んだPJメンバーだけ」に見せたい場面が実際には多い。ここはその付け外しだけを担う。
//
// 付け外しできるのはボードの作成者だけ（RLS の wb_shares_write と同じ）。
// 呼び出し側（WhiteboardPage）が作成者のときしかメニューを出さないので、ここでは権限判定をしない。
//
// 「外す」側だけ重い処理になる（秘密トークンの作り直し＋開いている人の追い出し）ので、
// 実行中は busy でダイアログを閉じられないようにしている。
import { useMemo, useState } from "react";
import { Check, Info, Trash2, TriangleAlert, UserPlus, Users } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import type { ShareCandidate } from "@/app/lib/whiteboardService";
import type { Whiteboard, WhiteboardShareMember } from "@/app/types";

interface Props {
  board: Whiteboard;
  /** 共有先に選べるメンバー（そのPJにアサインされている人・自分を除く） */
  candidates: ShareCandidate[];
  /** 候補の読み込み中 */
  loadingCandidates: boolean;
  onAdd: (memberIds: string[]) => Promise<void>;
  onRemove: (member: WhiteboardShareMember) => Promise<void>;
  onClose: () => void;
}

export function WhiteboardShareDialog({ board, candidates, loadingCandidates, onAdd, onRemove, onClose }: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const shares = board.sharedWith;

  // 既に共有済みの相手は候補から外す（外したい時は上の一覧から消す）
  const available = useMemo(() => {
    const taken = new Set(shares.map((s) => s.id));
    return candidates.filter((c) => !taken.has(c.id));
  }, [candidates, shares]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const toggle = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleAdd = () => {
    if (picked.length === 0) return;
    void run(async () => { await onAdd(picked); setPicked([]); });
  };

  return (
    <DialogShell title="共有するメンバー" size="md" onClose={onClose} busy={busy}
      footer={<BtnSecondary onClick={onClose} disabled={busy}>閉じる</BtnSecondary>}>

      {/* 対象のボード。どれを共有しているのか見失わないように出す */}
      <div style={{ background: "#FAFAF9", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
        <p style={{ fontSize: 9.5, fontWeight: 700, color: "#A09790", letterSpacing: "0.08em", margin: "0 0 3px" }}>ホワイトボード</p>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", margin: 0, wordBreak: "break-all" }}>{board.title || "無題のボード"}</p>
      </div>

      <p style={{ display: "flex", gap: 7, fontSize: 11, color: "#6B6458", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 8, padding: "8px 10px", margin: 0, lineHeight: 1.6 }}>
        <Info style={{ width: 13, height: 13, color: "#0284C7", flexShrink: 0, marginTop: 1 }} />
        <span>
          このボードはプライベートモードです。ここで選んだメンバーだけが、あなたと同じように
          閲覧・編集できます（できることは、そのメンバーのプロジェクト権限に従います）。
          プライベートモードを解除すると、この共有設定も一緒に解除されます。
        </span>
      </p>

      {/* ── いまの共有先 ── */}
      <div>
        <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#6B6458", margin: "0 0 8px" }}>
          <Users style={{ width: 12, height: 12, color: "#6D28D9" }} />
          共有しているメンバー
          <span style={{ fontSize: 10, fontWeight: 700, color: "#6D28D9", background: "#F5F3FF", border: "1px solid rgba(124,58,237,0.28)", borderRadius: 99, padding: "0 7px", fontFamily: "var(--font-mono)" }}>
            {shares.length}
          </span>
        </p>

        {shares.length === 0 ? (
          <p style={{ fontSize: 11.5, color: "#A09790", margin: 0, padding: "10px 2px" }}>
            まだ誰にも共有していません。いまはあなただけがこのボードを見られます。
          </p>
        ) : (
          <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, overflow: "hidden" }}>
            {shares.map((s, i) => (
              <div key={s.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i === 0 ? "none" : "1px solid rgba(26,23,20,0.05)" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name || "（不明なユーザー）"}
                </span>
                <button type="button" title="共有を解除する" disabled={busy}
                  onClick={() => void run(() => onRemove(s))}
                  style={{ border: "none", background: "transparent", padding: 4, cursor: busy ? "default" : "pointer", display: "flex", color: "#C9C4BB", flexShrink: 0 }}
                  onMouseEnter={(e) => { if (!busy) (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                  <Trash2 style={{ width: 13, height: 13 }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 追加 ── */}
      <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 14 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", margin: "0 0 8px" }}>
          プロジェクトのメンバーから選ぶ
        </p>

        {loadingCandidates ? (
          <p style={{ fontSize: 11.5, color: "#A09790", margin: 0 }}>メンバーを読み込み中…</p>
        ) : available.length === 0 ? (
          <p style={{ fontSize: 11.5, color: "#A09790", margin: 0 }}>
            {candidates.length === 0
              ? "このプロジェクトに他のメンバーがいません。"
              : "このプロジェクトのメンバーには全員共有済みです。"}
          </p>
        ) : (
          <>
            <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
              {available.map((c, i) => {
                const on = picked.includes(c.id);
                return (
                  <label key={c.id}
                    style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", cursor: busy ? "default" : "pointer", borderTop: i === 0 ? "none" : "1px solid rgba(26,23,20,0.05)", background: on ? "#F5F3FF" : "transparent" }}>
                    <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(c.id)} style={{ display: "none" }} />
                    <span style={{
                      width: 16, height: 16, borderRadius: 5, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      background: on ? "#6D28D9" : "#FFFFFF", border: `1px solid ${on ? "#6D28D9" : "rgba(26,23,20,0.2)"}`,
                    }}>
                      {on && <Check style={{ width: 11, height: 11, color: "#FFFFFF" }} />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.name}
                    </span>
                    {/* 共有しても、ホワイトボードの権限が無い人は画面に辿り着けない。先に伝える */}
                    {!c.canOpenWhiteboard && (
                      <span title="このメンバーにはホワイトボードの権限がありません。共有しても開けないため、先に権限設定が必要です"
                        style={{ display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: "#92400E", background: "#FEF3C7", border: "1px solid rgba(217,119,6,0.25)", borderRadius: 4, padding: "2px 5px" }}>
                        <TriangleAlert style={{ width: 10, height: 10 }} />
                        権限なし
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            <button type="button" onClick={handleAdd} disabled={picked.length === 0 || busy}
              style={{
                marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
                fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none",
                color: picked.length === 0 || busy ? "#9CA3AF" : "#FFF",
                background: picked.length === 0 || busy ? "#E5E7EB" : "#6D28D9",
                cursor: picked.length === 0 || busy ? "not-allowed" : "pointer",
              }}>
              <UserPlus style={{ width: 13, height: 13 }} />
              共有する{picked.length > 1 ? `（${picked.length}人）` : ""}
            </button>
          </>
        )}
      </div>
    </DialogShell>
  );
}
