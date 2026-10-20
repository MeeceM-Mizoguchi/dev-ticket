import { useRef, useState } from "react";
import { ExternalLink, FileText, Globe, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { inputCls, labelCls } from "@/app/lib/helpers";
import { submitOnModEnter } from "@/app/lib/submitKey";
import type { EnvMemo } from "@/app/types";

// BRU20-021 環境メモは見出しの下にタグで並べていたが、件数が増えると見出しまわりが
// タグで埋まってしまう。「環境メモ」ボタン1つにまとめ、押すと横長のモーダルで
// 左に一覧・右に選んだメモの中身を出す。追加・編集・削除もこのモーダルで行う
// （設定モーダルの環境メモ欄は廃止した）。
//
// 保存は env_memos を丸ごと書き換える。同時に2人が編集すると後から保存した側の内容になる
// （設定モーダルで編集していた頃と同じ扱い）。

export const MAX_ENV_MEMOS = 10;

const memoLabel = (m: EnvMemo) => m.name || m.url || "メモ";
const isBlankMemo = (m: EnvMemo) => !m.name.trim() && !m.url.trim() && !(m.memo ?? "").trim();
const EMPTY_MEMO: EnvMemo = { name: "", url: "", memo: "" };

/** スプリント管理の見出しの下に置くボタン。モーダルは呼び出し側で描く（固定ヘッダーの外に出すため） */
export function EnvMemoButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: "#0284C7", background: "#F0F9FF", border: "1px solid rgba(2,132,199,0.2)", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#E0F2FE"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F0F9FF"; }}>
      <FileText style={{ width: 9, height: 9 }} />環境メモ（{count}）
    </button>
  );
}

const smallBtn = { display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 11, fontWeight: 600, borderRadius: 7, cursor: "pointer" } as const;

export function EnvMemoDialog({ projectId, memos: initialMemos, onClose, onSaved }: {
  projectId: string;
  memos: EnvMemo[];
  onClose: () => void;
  /** 保存・削除のあと。画面側のプロジェクト情報を読み直してもらう */
  onSaved: () => void;
}) {
  const [memos, setMemos] = useState<EnvMemo[]>(initialMemos);
  const [selected, setSelected] = useState(0);
  // 右側の状態。編集中の draft の行番号は、追加のときは memos.length（末尾に足す）
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [editIndex, setEditIndex] = useState(0);
  const [draft, setDraft] = useState<EnvMemo>(EMPTY_MEMO);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // BUG-05 連打で二重に保存しない
  const [error, setError] = useState<string | null>(null);

  const current = memos[selected] ?? null;
  const editing = mode === "edit";
  const atLimit = memos.length >= MAX_ENV_MEMOS;

  const startAdd = () => {
    if (atLimit) return;
    setEditIndex(memos.length);
    setDraft(EMPTY_MEMO);
    setError(null);
    setMode("edit");
  };
  const startEdit = () => {
    if (!current) return;
    setEditIndex(selected);
    setDraft({ name: current.name, url: current.url, memo: current.memo ?? "" });
    setError(null);
    setMode("edit");
  };
  const cancel = () => { setError(null); setMode("view"); };

  /** env_memos を丸ごと書き換える。成功したら true */
  const persist = async (next: EnvMemo[]): Promise<boolean> => {
    if (!isSupabaseEnabled) return true;
    const { data, error: err } = await supabase!.from("projects")
      .update({ env_memos: next }).eq("id", projectId).select("id");
    if (err) { setError("保存に失敗しました。時間をおいて再度お試しください。"); return false; }
    if (!data || data.length === 0) { setError("保存できませんでした。編集権限をご確認ください。"); return false; }
    return true;
  };

  const run = async (next: EnvMemo[], nextSelected: number) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (!await persist(next)) return;
      setMemos(next);
      setSelected(Math.max(0, Math.min(nextSelected, next.length - 1)));
      setMode("view");
      onSaved();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (isBlankMemo(draft)) return;
    const cleaned: EnvMemo = { name: draft.name.trim(), url: draft.url.trim(), memo: draft.memo ?? "" };
    const next = editIndex >= memos.length
      ? [...memos, cleaned]
      : memos.map((m, i) => (i === editIndex ? cleaned : m));
    void run(next, editIndex);
  };

  const handleDelete = () => {
    void run(memos.filter((_, i) => i !== selected), selected);
  };

  const canSave = !saving && !isBlankMemo(draft);

  return (
    // 編集中に ×・背景・ESC で閉じようとしたら確認する（打ちかけの内容を黙って捨てない）
    <DialogShell title="環境メモ" size="xl" minHeight={0} onClose={onClose} confirmClose={editing} busy={saving}
      footer={<BtnSecondary onClick={onClose} disabled={editing || saving}>閉じる</BtnSecondary>}>
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, height: "min(440px, 60vh)" }}>
        {/* 左: メモの一覧。編集中は切り替えさせない */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: 6, background: "#FAFAF8", opacity: editing ? 0.55 : 1 }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {memos.map((m, i) => {
              const isSel = editing ? i === editIndex : i === selected;
              const Icon = m.url ? Globe : FileText;
              return (
                <button key={i} type="button" disabled={editing || saving}
                  onClick={() => { setSelected(i); setMode("view"); setError(null); }}
                  style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%", textAlign: "left", padding: "9px 10px", marginBottom: 2, borderRadius: 8, border: "none", cursor: editing ? "not-allowed" : "pointer", background: isSel ? "#E0F2FE" : "transparent" }}>
                  <Icon style={{ width: 13, height: 13, color: "#0284C7", flexShrink: 0, marginTop: 2 }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12, fontWeight: isSel ? 700 : 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{memoLabel(m)}</span>
                    {m.name && m.url && (
                      <span style={{ display: "block", fontSize: 10, color: "#A09790", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.url}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ paddingTop: 6, borderTop: memos.length > 0 ? "1px solid rgba(26,23,20,0.06)" : "none" }}>
            <button type="button" onClick={startAdd} disabled={editing || saving || atLimit}
              style={{ ...smallBtn, width: "100%", justifyContent: "center", padding: "8px 10px", color: atLimit ? "#9CA3AF" : "#059669", background: atLimit ? "#F3F4F6" : "#ECFDF5", border: `1px solid ${atLimit ? "rgba(156,163,175,0.30)" : "rgba(5,150,105,0.2)"}`, cursor: editing || atLimit ? "not-allowed" : "pointer" }}>
              <Plus style={{ width: 12, height: 12 }} />{atLimit ? `最大${MAX_ENV_MEMOS}件まで` : "メモを追加"}
            </button>
          </div>
        </div>

        {/* 右: 選んだメモの中身／編集欄 */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", overflowY: "auto", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "16px 18px" }}>
          {editing ? (
            <>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: "0 0 200px" }}>
                  <label className={labelCls}>項目名</label>
                  <input className={inputCls} placeholder="例: 本番環境" autoFocus
                    value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label className={labelCls}>URL</label>
                  <input className={inputCls} placeholder="https://example.com"
                    value={draft.url} onChange={e => setDraft(d => ({ ...d, url: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, marginTop: 10 }}>
                <label className={labelCls}>メモ（ログイン情報・注意点など）</label>
                <textarea className={inputCls}
                  placeholder={"例: admin / password123\n本番DBに直接接続しているので注意"}
                  value={draft.memo ?? ""}
                  onChange={e => setDraft(d => ({ ...d, memo: e.target.value }))}
                  onKeyDown={submitOnModEnter(() => { if (canSave) handleSave(); })}
                  style={{ flex: 1, minHeight: 120, resize: "none", fontFamily: "inherit", lineHeight: 1.7 }} />
              </div>
              {error && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 8 }}>{error}</p>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <BtnSecondary onClick={cancel} disabled={saving}>キャンセル</BtnSecondary>
                <BtnPrimary onClick={handleSave} disabled={!canSave} loading={saving}>{saving ? "保存中..." : "保存する"}</BtnPrimary>
              </div>
            </>
          ) : !current ? (
            <p style={{ fontSize: 12, color: "#B0A9A4", margin: "auto", textAlign: "center", lineHeight: 1.8 }}>
              環境メモはまだありません。<br />左の「メモを追加」から、本番・検証環境のURLやログイン情報などを残せます。
            </p>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <h3 style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: "#1A1714", margin: 0, wordBreak: "break-word" }}>{memoLabel(current)}</h3>
                {mode === "view" && (
                  <>
                    <button type="button" onClick={startEdit}
                      style={{ ...smallBtn, color: "#2563EB", background: "#EFF6FF", border: "1px solid rgba(37,99,235,0.2)" }}>
                      <Pencil style={{ width: 11, height: 11 }} />編集
                    </button>
                    <button type="button" onClick={() => { setError(null); setMode("delete"); }}
                      style={{ ...smallBtn, color: "#DC2626", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)" }}>
                      <Trash2 style={{ width: 11, height: 11 }} />削除
                    </button>
                  </>
                )}
              </div>
              {mode === "delete" && (
                <div style={{ marginTop: 10, padding: "10px 12px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 9 }}>
                  <p style={{ fontSize: 12, color: "#1A1714", margin: 0 }}>「{memoLabel(current)}」を削除しますか？ この操作は取り消せません。</p>
                  {error && <p style={{ fontSize: 11, color: "#DC2626", margin: "6px 0 0" }}>{error}</p>}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                    <BtnSecondary onClick={cancel} disabled={saving}>キャンセル</BtnSecondary>
                    <button type="button" onClick={handleDelete} disabled={saving}
                      style={{ padding: "9px 20px", background: saving ? "#9CA3AF" : "#DC2626", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: saving ? "not-allowed" : "pointer" }}>
                      {saving ? "削除中..." : "削除する"}
                    </button>
                  </div>
                </div>
              )}
              {current.url && (
                <a href={current.url} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 12, color: "#0284C7", wordBreak: "break-all", alignSelf: "flex-start" }}>
                  <ExternalLink style={{ width: 12, height: 12, flexShrink: 0 }} />{current.url}
                </a>
              )}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(26,23,20,0.07)" }}>
                {current.memo
                  ? <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{current.memo}</p>
                  : <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>メモはありません</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
