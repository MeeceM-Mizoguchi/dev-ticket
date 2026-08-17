// ピン留めコメントの共通部品（ホワイトボード ENHA2-039 / ファイルボックス BRU12-025）。
//
// もとは CommentLayer.tsx の中に閉じていたが、ファイルボックスのコメント（BRU12-025）で
// 「ホワイトボードと全く同じ操作感」を出す必要が出たので、見た目と入力の作法をここへ出した。
// 片方だけ直して見た目や Enter/Ctrl+Enter の作法がズレるのを防ぐのが目的なので、
// 両者で違ってよいもの（ピンの置き方・座標系・保存先）はここには置かない。
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Link2, Pencil, Trash2 } from "lucide-react";
import { escStack } from "@/app/lib/escStack";
import { initialOf, mentionQueryAt } from "@/app/lib/whiteboardComments";
import { wbUserColor } from "@/app/lib/whiteboardService";
import { MentionBackdrop } from "../whiteboard/MentionText";

const MENTION_MAX = 6; // メンション候補の表示件数

// コメントモード中のカーソル（ピン）。ホワイトボードもファイルビューアも同じ絵にする
// （どちらの画面でも「今コメントを置こうとしている」ことが同じ見た目で分かるように）。
const PIN_CURSOR_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">`
  + `<path d="M6 3.5h16a2.5 2.5 0 0 1 2.5 2.5v11a2.5 2.5 0 0 1-2.5 2.5H12l-5.5 5v-5H6A2.5 2.5 0 0 1 3.5 17V6A2.5 2.5 0 0 1 6 3.5z"`
  + ` fill="#F59E0B" stroke="#ffffff" stroke-width="2"/></svg>`,
);
/** style.cursor / CSS の cursor にそのまま入れられる値。 */
export const PIN_CURSOR = `url("data:image/svg+xml;charset=utf-8,${PIN_CURSOR_SVG}") 4 26, crosshair`;

/** 投稿者のアバター（userId から色を決めるので、同じ人はどの画面でも同じ色）。 */
export function Avatar({ userId, name, size = 22 }: { userId: string; name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, flexShrink: 0, borderRadius: "50%", background: wbUserColor(userId || "anon"),
      color: "#fff", fontSize: Math.round(size * 0.46), fontWeight: 700,
      display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none",
    }}>{initialOf(name)}</div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "7px 9px",
  background: "transparent", border: "none", borderRadius: 6, cursor: "pointer",
  fontSize: 11, fontWeight: 600, color: "#1A1714", whiteSpace: "nowrap", fontFamily: "inherit",
};

/**
 * コメント／返信の三点リーダーメニュー。
 * 「リンクをコピー」は誰でも、「編集」「削除」は投稿者本人にだけ出す。
 * 削除は取り消せないので、メニュー内で二段確認する（モーダルを出すと
 * 吹き出しの外側クリック判定に引っかかって一緒に閉じてしまうため）。
 */
export function ItemMenu({ own, onCopyLink, onEdit, onDelete }: {
  own: boolean; onCopyLink: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) { setOpen(false); setConfirming(false); }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "flex" }}>
      <button
        onClick={() => { setOpen((o) => !o); setConfirming(false); }}
        title="その他"
        style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: open ? "#0284C7" : "#B9B3AC", display: "flex" }}
      >
        <MoreHorizontal style={{ width: 13, height: 13 }} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, minWidth: 150, padding: 4,
          background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 5,
        }}>
          {confirming ? (
            <>
              <div style={{ padding: "6px 9px", fontSize: 11, color: "#6B6458" }}>削除しますか？</div>
              <button onClick={() => { setOpen(false); setConfirming(false); onDelete(); }}
                style={{ ...menuItemStyle, color: "#DC2626" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#FEF2F2"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                <Trash2 style={{ width: 12, height: 12 }} />削除する
              </button>
              <button onClick={() => setConfirming(false)} style={{ ...menuItemStyle, color: "#6B6458" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#F4F5F6"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                キャンセル
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { setOpen(false); onCopyLink(); }} style={menuItemStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#F0F9FF"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                <Link2 style={{ width: 12, height: 12, color: "#0284C7" }} />リンクをコピー
              </button>
              {own && (
                <button onClick={() => { setOpen(false); onEdit(); }} style={menuItemStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#F0F9FF"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                  <Pencil style={{ width: 12, height: 12, color: "#0284C7" }} />編集
                </button>
              )}
              {own && (
                <button onClick={() => setConfirming(true)} style={{ ...menuItemStyle, color: "#DC2626" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#FEF2F2"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                  <Trash2 style={{ width: 12, height: 12 }} />削除
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "7px 9px", fontSize: 12, lineHeight: 1.6,
  color: "#1A1714", background: "#fff", border: "1px solid rgba(26,23,20,0.15)", borderRadius: 8,
  outline: "none", resize: "none", fontFamily: "inherit", whiteSpace: "pre-wrap",
};

// 下地（MentionBackdrop）は textarea と同じ文字組みにしないとズレる。
// 差し替えるのは「重ね方」だけ＝位置・枠の見え方・折り返しのみで、余白と字面は textareaStyle のまま。
const BACKDROP_OVERRIDE: React.CSSProperties = {
  position: "absolute", inset: 0, borderColor: "transparent", overflowWrap: "break-word",
};

const primaryBtn: React.CSSProperties = {
  padding: "5px 12px", fontSize: 11, fontWeight: 700, color: "#fff", background: "#059669",
  border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
};
const ghostBtn: React.CSSProperties = {
  padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#6B6458", background: "transparent",
  border: "1px solid rgba(26,23,20,0.12)", borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
};

/** 吹き出し・入力欄で共用するカード（白地・角丸・影）。 */
export const commentCardStyle: React.CSSProperties = {
  background: "#fff", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 12,
  boxShadow: "0 10px 30px rgba(0,0,0,0.16)", padding: 12, boxSizing: "border-box",
  display: "flex", flexDirection: "column", gap: 8,
};

/**
 * 入力欄（新規コメント・返信・編集で共用）。Enter は改行、Ctrl/⌘+Enter で保存。
 * 「@」を打つとメンバー候補を出す（↑↓で選択、Enter/Tab で確定）。素の textarea なので
 * リッチエディタのメンション拡張は使えず、ここで最小限を自前で持つ。
 */
export function Composer({ value, onChange, onSubmit, onCancel, placeholder, submitLabel, autoFocus, minRows = 2, members, selfName }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void;
  placeholder: string; submitLabel: string; autoFocus?: boolean; minRows?: number; members: string[];
  selfName?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [sug, setSug] = useState<{ items: string[]; start: number; index: number } | null>(null);

  useEffect(() => { if (autoFocus) requestAnimationFrame(() => ref.current?.focus()); }, [autoFocus]);

  // 候補が出ている間の Esc は「候補を閉じるだけ」にする（入力欄まで閉じない）。
  // escStack は最後に積んだものから消化されるので、ここで積めば自然に優先される。
  useEffect(() => {
    if (!sug) return;
    const close = () => setSug(null);
    escStack.push(close);
    return () => escStack.pop(close);
  }, [sug]);

  const refresh = (text: string, caret: number) => {
    if (!members.length) { setSug(null); return; }
    const q = mentionQueryAt(text, caret);
    if (!q) { setSug(null); return; }
    const needle = q.query.toLowerCase();
    const items = members.filter((m) => m.toLowerCase().includes(needle)).slice(0, MENTION_MAX);
    setSug(items.length ? { items, start: q.start, index: 0 } : null);
  };

  const pick = (name: string) => {
    const el = ref.current;
    if (!el || !sug) return;
    const caret = el.selectionStart ?? value.length;
    const next = `${value.slice(0, sug.start)}@${name} ${value.slice(caret)}`;
    const pos = sug.start + name.length + 2;
    onChange(next);
    setSug(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  };

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6 }}>
      {/* 入力中もメンションが成立しているか分かるように、textarea の背後に色だけを敷く */}
      <div style={{ position: "relative" }}>
        <MentionBackdrop
          innerRef={backdropRef} text={value} members={members} selfName={selfName}
          style={{ ...textareaStyle, ...BACKDROP_OVERRIDE }}
        />
        <textarea
          ref={ref}
          value={value}
          rows={minRows}
          placeholder={placeholder}
          onChange={(e) => { onChange(e.target.value); refresh(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
          onClick={(e) => refresh(value, e.currentTarget.selectionStart ?? value.length)}
          onBlur={() => setTimeout(() => setSug(null), 120)}
          onScroll={(e) => { if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop; }}
          onKeyDown={(e) => {
            const composing = e.nativeEvent.isComposing;
            if (sug && !composing) {
              if (e.key === "ArrowDown") { e.preventDefault(); setSug({ ...sug, index: (sug.index + 1) % sug.items.length }); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setSug({ ...sug, index: (sug.index - 1 + sug.items.length) % sug.items.length }); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(sug.items[sug.index]); return; }
            }
            // Enter は改行（仕様）。保存は Ctrl/⌘+Enter とボタン。
            // IME変換中の Enter を拾わないよう isComposing を必ず見る。
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !composing) {
              e.preventDefault();
              onSubmit();
            }
          }}
          // 背景は下地（MentionBackdrop）に描かせるので透かす。display:block は
          // inline 要素のベースライン隙間で下地が数px はみ出すのを防ぐため。
          style={{ ...textareaStyle, position: "relative", background: "transparent", display: "block" }}
        />
      </div>
      {sug && (
        <div style={{
          position: "absolute", left: 0, top: "100%", marginTop: 2, width: "100%", zIndex: 6,
          background: "#fff", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: 4, boxSizing: "border-box",
        }}>
          {sug.items.map((m, i) => (
            <button
              key={m}
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              onMouseEnter={() => setSug({ ...sug, index: i })}
              style={{
                display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "5px 7px",
                background: i === sug.index ? "#F0F9FF" : "transparent", border: "none", borderRadius: 6,
                cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#1A1714", fontFamily: "inherit",
              }}
            >
              <span style={{ color: "#0284C7" }}>@</span>{m}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button onClick={onCancel} style={ghostBtn}>キャンセル</button>
        <button onClick={onSubmit} disabled={!value.trim()}
          style={{ ...primaryBtn, ...(value.trim() ? {} : { background: "#D8D3CC", cursor: "default" }) }}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
