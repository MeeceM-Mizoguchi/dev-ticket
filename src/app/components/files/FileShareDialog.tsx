// ファイルボックスのファイルの公開範囲（限定公開）を設定するダイアログ。
//
// 公開範囲は2通り:
//   ・プロジェクト全員 … 従来どおり（aclId が null）
//   ・限定公開         … 所有者と、ここで選んだメンバーだけ。共有先ゼロなら「自分のみ」
// オーナー（role='owner'）は限定公開のファイルも常に見られる。
//
// 設定できるのは所有者（最初にアップロードした人）だけ。判定はサーバー側（api/project-files）が行い、
// ここでの出し分け（canManage）は見た目の補助。所有者でない人（共有された人・オーナー）には、
// 誰に共有されているかを読み取り専用で見せる。
//
// 操作感はホワイトボードの共有ダイアログ（WhiteboardShareDialog）に合わせてある。
import { useMemo, useState } from "react";
import { Check, Info, Lock, Trash2, UserPlus, Users } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { PRIVATE_BG, PRIVATE_BORDER, PRIVATE_COLOR } from "@/app/components/whiteboard/PrivateBadge";
import { isGoogleFile } from "@/app/lib/projectFiles";
import type { FileShareMember, ProjectFile } from "@/app/types";

interface Props {
  file: ProjectFile;
  /** いまの共有先（限定公開でなければ空） */
  shares: FileShareMember[];
  /** 自分が所有者か。false なら読み取り専用 */
  canManage: boolean;
  /** 共有先に選べるメンバー（そのプロジェクトを見られる人・自分とオーナーを除く） */
  candidates: FileShareMember[];
  loadingCandidates: boolean;
  onMakePrivate: () => Promise<void>;
  onMakePublic: () => Promise<void>;
  onAdd: (memberIds: string[]) => Promise<void>;
  onRemove: (member: FileShareMember) => Promise<void>;
  onClose: () => void;
}

export function FileShareDialog({
  file, shares, canManage, candidates, loadingCandidates,
  onMakePrivate, onMakePublic, onAdd, onRemove, onClose,
}: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // 解除は「全員に見えるようになる」取り返しのつきにくい操作なので、もう一度押させる
  const [confirmPublic, setConfirmPublic] = useState(false);

  const isPrivate = !!file.aclId;
  const isGoogle = isGoogleFile(file);

  // 既に共有済みの相手は候補から外す（外したい時は上の一覧から消す）
  const available = useMemo(() => {
    const taken = new Set(shares.map(s => s.id));
    return candidates.filter(c => !taken.has(c.id));
  }, [candidates, shares]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const toggle = (id: string) => {
    setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const handleAdd = () => {
    if (picked.length === 0) return;
    void run(async () => { await onAdd(picked); setPicked([]); });
  };

  const primaryBtn = (disabled: boolean) => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
    fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none",
    color: disabled ? "#9CA3AF" : "#FFF",
    background: disabled ? "#E5E7EB" : PRIVATE_COLOR,
    cursor: disabled ? "not-allowed" : "pointer",
  } as const);

  return (
    <DialogShell title="公開範囲" size="md" onClose={onClose} busy={busy}
      footer={<BtnSecondary onClick={onClose} disabled={busy}>閉じる</BtnSecondary>}>

      {/* 対象のファイル。どれを設定しているのか見失わないように出す */}
      <div style={{ background: "#FAFAF9", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
        <p style={{ fontSize: 9.5, fontWeight: 700, color: "#A09790", letterSpacing: "0.08em", margin: "0 0 3px" }}>ファイル</p>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", margin: 0, wordBreak: "break-all" }}>{file.fileName}</p>
      </div>

      {!isPrivate ? (
        <>
          <p style={{ fontSize: 12, color: "#1A1714", margin: 0, lineHeight: 1.8 }}>
            いまは<strong>プロジェクトのメンバー全員</strong>が、このファイルを見られます。
          </p>
          <p style={{ display: "flex", gap: 7, fontSize: 11, color: "#6B6458", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 8, padding: "8px 10px", margin: 0, lineHeight: 1.6 }}>
            <Info style={{ width: 13, height: 13, color: "#0284C7", flexShrink: 0, marginTop: 1 }} />
            <span>
              限定公開にすると、あなただけが見られる状態になります。そのあと、見せたいメンバーを選んで共有できます。
              過去のバージョンとコメントも同じ範囲に限られます。
              {isGoogle && " Googleドライブ側でも、共有先以外のメンバーを編集者から外し、リンク共有を解除します（Googleドライブの画面で手動で追加した相手と、共有ドライブ自体のメンバーは対象外です）。"}
            </span>
          </p>
          <div>
            <button type="button" disabled={busy} onClick={() => void run(onMakePrivate)} style={primaryBtn(busy)}>
              <Lock style={{ width: 13, height: 13 }} />
              限定公開にする
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ display: "flex", gap: 7, fontSize: 11, color: "#6B6458", background: PRIVATE_BG, border: `1px solid ${PRIVATE_BORDER}`, borderRadius: 8, padding: "8px 10px", margin: 0, lineHeight: 1.6 }}>
            <Lock style={{ width: 13, height: 13, color: PRIVATE_COLOR, flexShrink: 0, marginTop: 1 }} />
            <span>
              {canManage
                ? "このファイルは限定公開です。あなたと、ここで選んだメンバーだけが見られます。"
                : "このファイルは限定公開です。追加した人と、下のメンバーだけが見られます。公開範囲を変更できるのは、追加した人だけです。"}
            </span>
          </p>

          {/* ── いまの共有先 ── */}
          <div>
            <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#6B6458", margin: "0 0 8px" }}>
              <Users style={{ width: 12, height: 12, color: PRIVATE_COLOR }} />
              共有しているメンバー
              <span style={{ fontSize: 10, fontWeight: 700, color: PRIVATE_COLOR, background: PRIVATE_BG, border: `1px solid ${PRIVATE_BORDER}`, borderRadius: 99, padding: "0 7px", fontFamily: "var(--font-mono)" }}>
                {shares.length}
              </span>
            </p>

            {shares.length === 0 ? (
              <p style={{ fontSize: 11.5, color: "#A09790", margin: 0, padding: "10px 2px" }}>
                {canManage
                  ? "まだ誰にも共有していません。いまはあなただけがこのファイルを見られます。"
                  : "誰にも共有されていません。追加した人だけが見られます。"}
              </p>
            ) : (
              <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, overflow: "hidden" }}>
                {shares.map((s, i) => (
                  <div key={s.id}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i === 0 ? "none" : "1px solid rgba(26,23,20,0.05)" }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.name || "（不明なユーザー）"}
                    </span>
                    {canManage && (
                      <button type="button" title="共有を解除する" disabled={busy}
                        onClick={() => void run(() => onRemove(s))}
                        style={{ border: "none", background: "transparent", padding: 4, cursor: busy ? "default" : "pointer", display: "flex", color: "#C9C4BB", flexShrink: 0 }}>
                        <Trash2 style={{ width: 13, height: 13 }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 追加 ── */}
          {canManage && (
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
                          style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", cursor: busy ? "default" : "pointer", borderTop: i === 0 ? "none" : "1px solid rgba(26,23,20,0.05)", background: on ? PRIVATE_BG : "transparent" }}>
                          <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(c.id)} style={{ display: "none" }} />
                          <span style={{
                            width: 16, height: 16, borderRadius: 5, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                            background: on ? PRIVATE_COLOR : "#FFFFFF", border: `1px solid ${on ? PRIVATE_COLOR : "rgba(26,23,20,0.2)"}`,
                          }}>
                            {on && <Check style={{ width: 11, height: 11, color: "#FFFFFF" }} />}
                          </span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.name}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  <button type="button" onClick={handleAdd} disabled={picked.length === 0 || busy}
                    style={{ ...primaryBtn(picked.length === 0 || busy), marginTop: 10 }}>
                    <UserPlus style={{ width: 13, height: 13 }} />
                    共有する{picked.length > 1 ? `（${picked.length}人）` : ""}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── 解除 ── */}
          {canManage && (
            <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 14 }}>
              {!confirmPublic ? (
                <button type="button" disabled={busy} onClick={() => setConfirmPublic(true)}
                  style={{ padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: busy ? "not-allowed" : "pointer", color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A" }}>
                  限定公開を解除する
                </button>
              ) : (
                <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "10px 12px" }}>
                  <p style={{ fontSize: 12, color: "#92400E", margin: "0 0 10px", lineHeight: 1.7 }}>
                    このファイルをプロジェクトのメンバー全員に公開します。共有先の設定も一緒に解除されます。よろしいですか？
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" disabled={busy}
                      onClick={() => void run(async () => { await onMakePublic(); setConfirmPublic(false); })}
                      style={{ padding: "7px 14px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", color: "#FFF", background: busy ? "#9CA3AF" : "#D97706", cursor: busy ? "not-allowed" : "pointer" }}>
                      全員に公開する
                    </button>
                    <button type="button" disabled={busy} onClick={() => setConfirmPublic(false)}
                      style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", color: "#1A1714", background: "#F4F5F6", cursor: busy ? "not-allowed" : "pointer" }}>
                      やめる
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </DialogShell>
  );
}
