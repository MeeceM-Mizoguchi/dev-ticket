// ホワイトボードのコメント機能（ENHA2-039）。FigJam/Figma のコメントと同じ操作感。
//
//   コメントモード（ツールバーのピンボタン / 「c」キー）
//     → カーソルがピンになり、キャンバスをクリックするとその場所に入力欄が出る
//     → 保存するとピンが立ち、投稿した内容がそのまま吹き出しで開く
//       （コメントモードは抜ける。別の場所をクリックするか Esc で吹き出しが閉じる）
//   ピンにマウスオーバー → 吹き出し（投稿者・日時・本文・返信・解決・⋯メニュー）
//     → 「返信を表示」を押すと返信一覧が下に開き、以後マウスを外しても閉じない（固定表示）
//     → 固定表示は「別の場所をクリック」か「Esc」で閉じる
//   本文中の「@メンバー名」はメンションとして通知＋Slack通知を飛ばす
//   「解決」にしたコメントはピンが消え、コメント一覧ポップアップから見返せる
//   ピンをドラッグ → その場所へ動かす
//     ・図形と一緒に囲んで選択でき、図形をドラッグすると選択中のピンも同じだけ動く
//     ・Shift+クリックで選択の付け外し。選択中のピンを掴めば選択ぶん全部がまとめて動く
//
// 【権限】コメントは閲覧のみのメンバーも投稿・返信できる（図形の編集権限とは別物として扱う）。
// 自分の投稿の編集・削除だけが本人限定。解決の切り替えは誰でもできる（Figma と同じ）。
//
// 【描画方式】ピンは Excalidraw の要素ではなく DOM オーバーレイ。
// scene座標→画面座標の変換は毎フレーム必要だが、React の再レンダーで追従させると
// パン/ズームのたびに全ピンが再構築されて重い＆ちらつく。そこで
//   ・React は「どのピンが在るか」だけを描く（位置は data-x/data-y に持たせる）
//   ・rAF ループが transform だけを書き換える（再レンダーなし）
// という分担にしている。他のオーバーレイ（FrameHighlightLayer 等）と同じ考え方。
// ドラッグ中の追従も同じ土俵に乗せる＝data-x/data-y を書き換えるだけにして、
// Yjs へは指を離した1回だけ書く（途中経過を配らない・再レンダーを起こさない）。
//
// 【図形と一緒に動かす仕組み】ピンは Excalidraw の要素ではないので、Excalidraw の選択にも
// ドラッグにも本来は乗らない。かといって appState の内部フラグ（selectionElement など）を
// 当てにすると版によって拾えないので、キャンバスを押してから離すまでを自前で1操作として記録し、
// **その操作が何だったのかを結果から見分ける**方式にしている。
//   押した時 … 押した点・Shift・スクロール位置・図形の配置の指紋を控える。
//              押した点が「選択中の図形の外接枠」の中なら＝選択ごと掴んだ（下の追従へ）。
//   動かす間 … 上のどれでもなければ囲み選択とみなし、押した点↔今の点の矩形に入るピンを選ぶ。
//              スクロールが動いていればパン、図形の指紋が変わっていれば図形のドラッグなので対象外。
//   離した時 … ほとんど動いていなければただのクリック＝ピンの選択を解く。
// 追従は「掴んだ瞬間の図形（リーダー）が動いた量」をそのままピンへ足すだけ。図形側には
// 一切手を入れない（矢印の結合・フレームの所属・ラベルの追従は Excalidraw 本体の担当）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { viewportCoordsToSceneCoords, CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
  MessageSquare, MoreHorizontal, Link2, Pencil, Trash2, CornerDownRight,
  ChevronDown, ChevronUp, CheckCircle2, RotateCcw,
} from "lucide-react";
import type * as Y from "yjs";
import { copyText } from "@/lib/clipboard";
import { appOrigin } from "@/app/lib/appOrigin";
import { buildWhiteboardCommentLink } from "@/app/lib/whiteboardLink";
import { escStack } from "@/app/lib/escStack";
import { isActiveWbInstance } from "@/app/lib/whiteboardInstance";
import { loadProjectMemberNames, wbUserColor } from "@/app/lib/whiteboardService";
import {
  addComment, addReply, deleteComment, deleteReply, formatCommentTime, initialOf, mentionQueryAt,
  moveComments, observeComments, readComments, readReplies, setCommentResolved, updateComment, updateReply,
  type WbComment, type WbCommentReply,
} from "@/app/lib/whiteboardComments";
import { notifyWhiteboardMentions, notifyWhiteboardReply } from "@/app/lib/whiteboardCommentNotify";
import { CommentListPanel } from "./CommentListPanel";
import type { WbUser } from "@/app/hooks/useWhiteboardSync";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  docRef: React.RefObject<Y.Doc | null>;
  user: WbUser;
  projectSlug: string;
  /** メンション候補（projects.members）の取得に使う。未指定ならメンション候補は出ない */
  projectId?: string | null;
  boardId: string;
  /** 通知の本文に出すボード名 */
  boardTitle: string;
  /** プライベートモード中は通知（ベル/Slack）を飛ばさない。コメント自体は従来どおり書ける */
  isPrivate?: boolean;
  /** コメントモード（ツールバーのピンボタンと共有するのでキャンバス側が持つ） */
  commentMode: boolean;
  setCommentMode: (v: boolean) => void;
  /** コメント一覧ポップアップの開閉（同上） */
  listOpen: boolean;
  setListOpen: (v: boolean) => void;
  /** リンク着地（?comment=&reply=）。見つかったらピンへ移動して固定表示する */
  focusCommentId?: string | null;
  focusReplyId?: string | null;
  /** 同じリンクを続けて踏んだ時も再着地させるための世代番号 */
  focusNonce?: number;
  onFocusResult?: (found: boolean) => void;
  onToast?: (message: string) => void;
  /** キャンバスが2枚あるとき（画面＋リンクプレビュー）どちらが操作対象かの識別キー */
  instanceKey: string;
}

const TIP_W = 300;             // 吹き出しの幅
const TIP_GAP = 12;            // ピンと吹き出しの隙間
const REPLY_LIST_MAX_H = 176;  // 返信リストの最大高さ（約2件ぶん。以降はスクロール）
const HOVER_CLOSE_MS = 220;    // ピン⇔吹き出し間をマウスが渡る猶予
const FOCUS_RETRY_MS = 200;    // リンク着地: 対象が現れるまでの再探索間隔
const FOCUS_RETRY_MAX = 30;    // 同 最大回数（≒6秒。Yjs の後追い差分を待つ）
const MENTION_MAX = 6;         // メンション候補の表示件数
const PIN_SIZE = 26;           // ピンの一辺(px・画面)。位置は左下＝コメント座標
const DRAG_SLOP = 3;           // これ未満の動きはクリック（＝吹き出しを開く）として扱う
const SELECT_ACCENT = "#6965db"; // Excalidraw の選択色に合わせる
const KEY_MOVE_MS = 400;       // 矢印キーでの移動を「ひと続き」とみなす猶予
const HIT_PAD = 8;             // 選択枠の掴み判定に足す余白(px・画面)

/** 選択中のIDが実質同じか（毎フレームの setState で無駄な再レンダーを起こさないため） */
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// コメントモード中のカーソル（ピン）。Excalidraw は canvas に style.cursor を直接
// 書き込むため、クラス側は !important でないと勝てない。
const PIN_CURSOR = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">`
  + `<path d="M6 3.5h16a2.5 2.5 0 0 1 2.5 2.5v11a2.5 2.5 0 0 1-2.5 2.5H12l-5.5 5v-5H6A2.5 2.5 0 0 1 3.5 17V6A2.5 2.5 0 0 1 6 3.5z"`
  + ` fill="#F59E0B" stroke="#ffffff" stroke-width="2"/></svg>`,
);
const COMMENT_MODE_CSS = `
.wb-comment-mode .excalidraw canvas,
.wb-comment-mode .excalidraw .excalidraw-canvas-buttons {
  cursor: url("data:image/svg+xml;charset=utf-8,${PIN_CURSOR}") 4 26, crosshair !important;
}
`;

// ── 小物UI ────────────────────────────────────────────────
function Avatar({ userId, name, size = 22 }: { userId: string; name: string; size?: number }) {
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
function ItemMenu({ own, onCopyLink, onEdit, onDelete }: {
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

const primaryBtn: React.CSSProperties = {
  padding: "5px 12px", fontSize: 11, fontWeight: 700, color: "#fff", background: "#059669",
  border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
};
const ghostBtn: React.CSSProperties = {
  padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#6B6458", background: "transparent",
  border: "1px solid rgba(26,23,20,0.12)", borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
};

/**
 * 入力欄（新規コメント・返信・編集で共用）。Enter は改行、Ctrl/⌘+Enter で保存。
 * 「@」を打つとメンバー候補を出す（↑↓で選択、Enter/Tab で確定）。素の textarea なので
 * リッチエディタのメンション拡張は使えず、ここで最小限を自前で持つ。
 */
function Composer({ value, onChange, onSubmit, onCancel, placeholder, submitLabel, autoFocus, minRows = 2, members }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void;
  placeholder: string; submitLabel: string; autoFocus?: boolean; minRows?: number; members: string[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
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
      <textarea
        ref={ref}
        value={value}
        rows={minRows}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); refresh(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
        onClick={(e) => refresh(value, e.currentTarget.selectionStart ?? value.length)}
        onBlur={() => setTimeout(() => setSug(null), 120)}
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
        style={textareaStyle}
      />
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

export function CommentLayer({
  api, containerRef, docRef, user, projectSlug, projectId, boardId, boardTitle, isPrivate = false,
  commentMode, setCommentMode, listOpen, setListOpen,
  focusCommentId, focusReplyId, focusNonce, onFocusResult, onToast, instanceKey,
}: Props) {
  const [comments, setComments] = useState<WbComment[]>([]);
  const [replies, setReplies] = useState<Record<string, WbCommentReply[]>>({});
  const [members, setMembers] = useState<string[]>([]);
  // 新規コメントの下書き（クリックした scene 座標に仮ピンを出す）
  const [draft, setDraft] = useState<{ x: number; y: number; text: string } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [stickyId, setStickyId] = useState<string | null>(null); // 固定表示（マウスを外しても消えない）
  const [showReplies, setShowReplies] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [editing, setEditing] = useState<{ kind: "comment" | "reply"; id: string } | null>(null);
  const [editText, setEditText] = useState("");
  // 図形と一緒に動かすために選択されているピン（Excalidraw の選択とは別に自前で持つ）
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const layerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeId = stickyId ?? hoverId;
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const draftRef = useRef<typeof draft>(null);
  draftRef.current = draft;
  const listOpenRef = useRef(false);
  listOpenRef.current = listOpen;
  const commentsRef = useRef<WbComment[]>([]);
  commentsRef.current = comments;
  const selectedRef = useRef<string[]>([]);
  selectedRef.current = selectedIds;

  // ドラッグ関連（すべて ref。毎フレームの再レンダーを起こさないため）
  type Pos = Map<string, { x: number; y: number }>;
  const pinDrag = useRef<{ pointerId: number; cx: number; cy: number; base: Pos; moved: boolean } | null>(null);
  const dragPos = useRef<Pos | null>(null);      // ドラッグ中の暫定位置（指を離した時に Yjs へ書く）
  const suppressClick = useRef(false);           // 動かした直後の click で吹き出しを開かない
  // キャンバスを押してから離すまでの1操作ぶんの記録（囲み選択かどうかをここで見分ける）
  const gesture = useRef<{
    cx: number; cy: number; sx: number; sy: number; shift: boolean;
    scrollX: number; scrollY: number; sig: string; grabbed: boolean;
  } | null>(null);
  // 図形の移動をピンへ写すためのセッション（key=矢印キー起点。時間切れで確定する）
  const followRef = useRef<{ id: string; x: number; y: number; base: Pos; last: Pos | null; key: boolean } | null>(null);
  const keyMoveUntil = useRef(0);

  // ── Yjs 購読 ───────────────────────────────────────────
  // docRef.current は親（useWhiteboardSync）の effect で入る。万一まだ空でも
  // 取りこぼさないよう、入るまで少し待って張り直す。
  const [docTick, setDocTick] = useState(0);
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) {
      const t = setTimeout(() => setDocTick((n) => n + 1), 100);
      return () => clearTimeout(t);
    }
    const sync = () => { setComments(readComments(doc)); setReplies(readReplies(doc)); };
    sync();
    return observeComments(doc, sync);
    // docRef.current は boardId ごとに作り直されるので boardId を依存に置く
  }, [docRef, boardId, docTick]);

  // ── メンション候補（プロジェクト参加メンバー） ─────────────
  useEffect(() => {
    if (!projectId) { setMembers([]); return; }
    let cancelled = false;
    void loadProjectMemberNames(projectId).then((names) => { if (!cancelled) setMembers(names); });
    return () => { cancelled = true; };
  }, [projectId]);

  // ── 吹き出しの開閉 ─────────────────────────────────────
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHoverId(null), HOVER_CLOSE_MS);
  }, [cancelClose]);

  const closeTooltip = useCallback(() => {
    cancelClose();
    setHoverId(null);
    setStickyId(null);
    setShowReplies(false);
    setReplyOpen(false);
    setReplyText("");
    setEditing(null);
  }, [cancelClose]);

  // 固定表示にする（ピンのクリック / 返信 / 返信を表示 / 保存直後 / リンク着地）
  const pinOpen = useCallback((id: string) => {
    cancelClose();
    setHoverId(id);
    setStickyId(id);
  }, [cancelClose]);

  // ── ピンの移動（ドラッグ / 図形への追従） ─────────────────
  // 位置は data-x/data-y に書くだけ。実際の translate は下の rAF ループが当てる。
  const paintPositions = useCallback((positions: Pos) => {
    const layer = layerRef.current;
    if (!layer) return;
    positions.forEach((p, id) => {
      const node = layer.querySelector<HTMLElement>(`[data-wbc-anchor][data-id="${CSS.escape(id)}"]`);
      if (!node) return;
      node.dataset.x = String(p.x);
      node.dataset.y = String(p.y);
    });
  }, []);

  // 動かした結果を Yjs へ書く（＝共有・保存される）。ドラッグ確定時に1回だけ。
  const commitPositions = useCallback((positions: Pos | null) => {
    const doc = docRef.current;
    if (!doc || !positions?.size) return;
    moveComments(doc, Array.from(positions, ([id, p]) => ({ id, x: p.x, y: p.y })));
  }, [docRef]);

  // 指定IDのいまの位置を控える（ドラッグの起点）
  const basePositions = useCallback((ids: string[]): Pos => {
    const base: Pos = new Map();
    for (const id of ids) {
      const c = commentsRef.current.find((x) => x.id === id);
      if (c) base.set(id, { x: c.x, y: c.y });
    }
    return base;
  }, []);

  const zoomOf = useCallback(() => {
    try { return api.getAppState().zoom?.value ?? 1; } catch { return 1; }
  }, [api]);

  // 画面(client)座標 → scene座標（他のオーバーレイと同じ式）
  const toScene = useCallback((cx: number, cy: number) => {
    const st = api.getAppState();
    const zoom = st.zoom?.value ?? 1;
    return { x: (cx - (st.offsetLeft ?? 0)) / zoom - st.scrollX, y: (cy - (st.offsetTop ?? 0)) / zoom - st.scrollY };
  }, [api]);

  // 図形の姿の指紋。押した時と今とで違えば「図形が動いた／伸びた／回った＝囲み選択ではない」と分かる。
  // 位置だけだと、右下ハンドルでのリサイズや回転（x,y が動かない）を見逃すので寸法と角度も混ぜる。
  const sceneSignature = useCallback((): string => {
    try {
      const els = api.getSceneElements() as any[];
      let a = 0, b = 0;
      for (const e of els) { a += e.x + (e.width ?? 0); b += e.y + (e.height ?? 0) + (e.angle ?? 0); }
      return `${els.length}:${a.toFixed(2)}:${b.toFixed(2)}`;
    } catch { return ""; }
  }, [api]);

  /** 選択中の図形をまとめた外接枠（Excalidraw はこの中を掴むと選択ごと動かせる） */
  const selectedElementsBox = useCallback((st: any) => {
    const sel = st.selectedElementIds ?? {};
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    try {
      for (const el of api.getSceneElements() as any[]) {
        if (!sel[el.id]) continue;
        x1 = Math.min(x1, el.x); y1 = Math.min(y1, el.y);
        x2 = Math.max(x2, el.x + (el.width ?? 0)); y2 = Math.max(y2, el.y + (el.height ?? 0));
      }
    } catch { return null; }
    return Number.isFinite(x1) ? { x1, y1, x2, y2 } : null;
  }, [api]);

  /** 矩形（scene座標）の中に根元が入っているピン */
  const pinsInRect = useCallback((x1: number, y1: number, x2: number, y2: number): string[] => (
    commentsRef.current
      .filter((c) => !c.resolved && c.x >= Math.min(x1, x2) && c.x <= Math.max(x1, x2)
        && c.y >= Math.min(y1, y2) && c.y <= Math.max(y1, y2))
      .map((c) => c.id)
  ), []);

  const applySelection = useCallback((ids: string[], add: boolean) => {
    setSelectedIds((prev) => {
      const next = add ? Array.from(new Set([...prev, ...ids])) : ids;
      return sameIds(prev, next) ? prev : next;
    });
  }, []);

  /** 選択中の図形の移動をピンへ写すセッションを始める */
  const startFollow = useCallback((st: any, byKey: boolean) => {
    if (!selectedRef.current.length) return;
    // 矢印キーのセッションが残っていたら、先に確定してから掴み直す（移動量を取りこぼさない）
    if (followRef.current?.key) { const f = followRef.current; followRef.current = null; commitPositions(f.last); }
    const sel = st.selectedElementIds ?? {};
    let leader: any = null;
    try { leader = (api.getSceneElements() as any[]).find((e) => sel[e.id]); } catch { /* noop */ }
    if (!leader) return;
    followRef.current = { id: leader.id, x: leader.x, y: leader.y, base: basePositions(selectedRef.current), last: null, key: byKey };
  }, [api, basePositions, commitPositions]);

  const endFollow = useCallback(() => {
    const f = followRef.current;
    if (!f) return;
    followRef.current = null;
    commitPositions(f.last);
  }, [commitPositions]);

  // ピンを掴む。選択済みのピンを掴んだ時は選択ぶんまとめて動かす。
  const onPinPointerDown = (e: React.PointerEvent, c: WbComment) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.shiftKey) {
      // Shift+クリックは選択の付け外しだけ（吹き出しは開かない・動かさない）
      suppressClick.current = true;
      setSelectedIds((prev) => (prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id]));
      return;
    }
    suppressClick.current = false; // 前回のドラッグの取りこぼしを引きずらない
    const sel = selectedRef.current;
    const ids = sel.includes(c.id) ? sel : [c.id];
    if (!sel.includes(c.id)) setSelectedIds([c.id]);
    pinDrag.current = { pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, base: basePositions(ids), moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  // キャンバスを押した時点で「選択を掴んだのか、選び直し（＝これから囲む）なのか」を決める。
  // 選択中の図形の外接枠の中から始まったドラッグは選択ごと動かす操作なのでピンの選択を保ち、
  // そのまま図形の移動をピンへ写す。それ以外は選択を解いて、囲み選択の記録を始める。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement | null)?.tagName !== "CANVAS") return; // ツールバー・自前パネル・ピンは対象外
      gesture.current = null;
      if (commentMode) return;  // コメントを置いている最中は選択の話ではない
      let st: any;
      try { st = api.getAppState(); } catch { return; }
      if (st.activeTool?.type !== "selection") return; // 図形を描いている最中など
      const p = toScene(e.clientX, e.clientY);
      const pad = HIT_PAD / (st.zoom?.value ?? 1);
      const box = selectedRef.current.length ? selectedElementsBox(st) : null;
      const grabbed = !!box && !e.shiftKey
        && p.x >= box.x1 - pad && p.x <= box.x2 + pad && p.y >= box.y1 - pad && p.y <= box.y2 + pad;
      gesture.current = {
        cx: e.clientX, cy: e.clientY, sx: p.x, sy: p.y, shift: e.shiftKey,
        scrollX: st.scrollX, scrollY: st.scrollY, sig: sceneSignature(), grabbed,
      };
      if (grabbed) startFollow(st, false);           // 選択ごと動かす
      else if (!e.shiftKey) setSelectedIds((prev) => (prev.length ? [] : prev)); // 選び直し
    };
    el.addEventListener("pointerdown", onDown, true);
    return () => el.removeEventListener("pointerdown", onDown, true);
  }, [api, containerRef, commentMode, sceneSignature, selectedElementsBox, startFollow, toScene]);

  // ピンのドラッグ／囲み選択の追跡。囲んでいる間は「入るピン」を随時光らせる。
  useEffect(() => {
    const band = (e: PointerEvent, commit: boolean) => {
      const g = gesture.current;
      if (!g || g.grabbed) return;
      if (Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < DRAG_SLOP) {
        // 動いていない＝ただのクリック。離した時点で選択を解く（Shift中は保つ）
        if (commit && !g.shift) setSelectedIds((prev) => (prev.length ? [] : prev));
        return;
      }
      let st: any;
      try { st = api.getAppState(); } catch { return; }
      // パン（画面が動いた）／図形が動いた・増えた＝囲み選択ではない
      if (st.scrollX !== g.scrollX || st.scrollY !== g.scrollY) return;
      if (sceneSignature() !== g.sig) return;
      const p = toScene(e.clientX, e.clientY);
      applySelection(pinsInRect(g.sx, g.sy, p.x, p.y), g.shift);
    };

    const onMove = (e: PointerEvent) => {
      const d = pinDrag.current;
      if (d && e.pointerId === d.pointerId) {
        const dx = e.clientX - d.cx;
        const dy = e.clientY - d.cy;
        if (!d.moved) {
          if (Math.hypot(dx, dy) < DRAG_SLOP) return;
          d.moved = true;
          closeTooltip(); // 動かしている間は吹き出しが邪魔になる
        }
        const zoom = zoomOf();
        const next: Pos = new Map();
        d.base.forEach((p, id) => next.set(id, { x: p.x + dx / zoom, y: p.y + dy / zoom }));
        dragPos.current = next;
        paintPositions(next);
        return;
      }
      band(e, false);
    };

    const onUp = (e: PointerEvent) => {
      const d = pinDrag.current;
      if (d && e.pointerId === d.pointerId) {
        pinDrag.current = null;
        if (d.moved) {
          suppressClick.current = true;
          commitPositions(dragPos.current);
          dragPos.current = null;
        }
      }
      band(e, true);
      gesture.current = null;
      if (!followRef.current?.key) endFollow(); // 図形と一緒に動かした結果を確定
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [api, applySelection, closeTooltip, commitPositions, endFollow, paintPositions, pinsInRect, sceneSignature, toScene, zoomOf]);

  // 矢印キーでの移動にも追従させる（Excalidraw が図形を動かした分をそのまま写す）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.key.startsWith("Arrow") || !selectedRef.current.length) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      keyMoveUntil.current = Date.now() + KEY_MOVE_MS;
      if (followRef.current) return;
      try { startFollow(api.getAppState(), true); } catch { /* noop */ }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [api, startFollow]);

  // 別のコメントへホバーが移ったら、その都度サブ状態を畳む。
  // 「返信リンクから開いた」時だけは畳まずに返信一覧を開いた状態で見せたいので、
  // 開く側が pendingReplies に意図を置いてから開く（この effect は開いた後に走るため）。
  const pendingReplies = useRef(false);
  const prevActive = useRef<string | null>(null);
  useEffect(() => {
    if (prevActive.current === activeId) return;
    prevActive.current = activeId;
    setShowReplies(pendingReplies.current);
    pendingReplies.current = false;
    setReplyOpen(false);
    setReplyText("");
    setEditing(null);
  }, [activeId]);

  // ── コメントモード: カーソル・キー・クリック ───────────────
  // カーソルをピンにする（Excalidraw の canvas へ !important で被せる）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.classList.toggle("wb-comment-mode", commentMode);
    return () => { el.classList.remove("wb-comment-mode"); };
  }, [commentMode, containerRef]);

  // 「c」でコメントモードに入る/出る。入力中・図形のテキスト編集中は無視する。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "c" && e.key !== "C") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (!isActiveWbInstance(instanceKey)) return; // キャンバスが2枚あるとき両方に効かせない
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (containerRef.current?.querySelector(".excalidraw-wysiwyg")) return;
      // キャンバスが画面に無い（別タブ/非表示）ときは拾わない
      const el = containerRef.current;
      if (!el || el.closest("[inert]")) return;
      e.preventDefault();
      e.stopPropagation();
      setCommentMode(!commentMode);
    };
    // Excalidraw のショートカットより先に握る（window のキャプチャ段階）
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [commentMode, setCommentMode, containerRef, instanceKey]);

  // コメントモードに入ったら選択ツールへ戻す（図形を描き始めてしまうのを防ぐ）。
  // 逆に、ユーザーが Excalidraw のツールを選んだらコメントモードは自動で抜ける。
  useEffect(() => {
    if (!commentMode) return;
    try { api.setActiveTool({ type: "selection" }); } catch { /* noop */ }
    let raf = 0;
    // setActiveTool の反映は次の描画以降なので、選択ツールになったのを一度見届けてから
    // 監視を始める（見届ける前に判定すると、直前のツールを見て即座に抜けてしまう）。
    let armed = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      try {
        const selection = api.getAppState().activeTool?.type === "selection";
        if (!armed) { armed = selection; return; }
        if (!selection) setCommentMode(false);
      } catch { /* noop */ }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [api, commentMode, setCommentMode]);

  // キャンバスのクリックでピンを落とす。Excalidraw に届く前にキャプチャ段階で握り潰す
  // （届くと選択解除や図形描画が走ってしまう）。ツールバー・自前パネル・ピン自身は
  // canvas ではないので、この判定だけで巻き込まずに済む。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !commentMode) return;
    const isCanvas = (e: Event) => (e.target as HTMLElement | null)?.tagName === "CANVAS";
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !isCanvas(e)) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
        // 入力途中でも位置だけ差し替える（書いた文字は捨てない）
        setDraft((d) => ({ x: p.x, y: p.y, text: d?.text ?? "" }));
        closeTooltip();
      } catch { /* noop */ }
    };
    // pointerdown を止めても click/pointerup は続けて飛ぶため、まとめて塞ぐ。
    // 左ボタンだけを対象にする（中ボタンドラッグでのパンはコメントモード中も使えるように）。
    const swallow = (e: Event) => {
      if ((e as MouseEvent).button !== 0 || !isCanvas(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointerup", swallow, true);
    el.addEventListener("click", swallow, true);
    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointerup", swallow, true);
      el.removeEventListener("click", swallow, true);
    };
  }, [api, commentMode, containerRef, closeTooltip]);

  // 別の場所をクリックしたら固定表示を閉じる（吹き出し/ピン/一覧の中は除く）
  useEffect(() => {
    if (!stickyId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-wbc-ui]")) return;
      closeTooltip();
    };
    // キャンバス上のクリックは Excalidraw が stopPropagation することがあるのでキャプチャで受ける
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [stickyId, closeTooltip]);

  // Esc: 入力中なら入力を、開いていれば吹き出しを、次に一覧を、最後にコメントモードを閉じる。
  // escStack は capture 段階で先に走るので、Excalidraw の Esc（選択解除）とは競合しない。
  useEffect(() => {
    if (!draft && !activeId && !commentMode && !listOpen && !selectedIds.length) return;
    const onEsc = () => {
      if (draftRef.current) { setDraft(null); return; }
      if (activeIdRef.current) { closeTooltip(); return; }
      if (selectedRef.current.length) { setSelectedIds([]); return; }
      if (listOpenRef.current) { setListOpen(false); return; }
      setCommentMode(false);
    };
    escStack.push(onEsc);
    return () => escStack.pop(onEsc);
  }, [draft, activeId, commentMode, listOpen, selectedIds, closeTooltip, setCommentMode, setListOpen]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  // ── 位置の追従（毎フレーム transform だけ書き換える） ──────
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const layer = layerRef.current;
      const container = containerRef.current;
      if (!layer || !container) return;
      let st: any;
      try { st = api.getAppState(); } catch { return; }
      if (!st) return;

      // 図形の移動をピンへ写す。掴んだ時の図形（リーダー）が動いた量をそのまま足すだけ。
      // 図形側には触らない（矢印の結合・フレーム所属は Excalidraw 本体の担当）。
      const follow = followRef.current;
      if (follow) {
        if (follow.key && Date.now() > keyMoveUntil.current) {
          endFollow();  // 矢印キーは押し終わりが無いので、途切れたら確定する
        } else {
          let leader: any = null;
          try { leader = (api.getSceneElements() as any[]).find((e) => e.id === follow.id); } catch { /* noop */ }
          if (leader) {
            const dx = leader.x - follow.x;
            const dy = leader.y - follow.y;
            const next: Pos = new Map();
            follow.base.forEach((p, id) => next.set(id, { x: p.x + dx, y: p.y + dy }));
            follow.last = next;
            paintPositions(next);
          }
        }
      }

      const rect = container.getBoundingClientRect();
      const zoom = st.zoom?.value ?? 1;
      const dx = st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left;
      const dy = st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top;
      const nodes = layer.querySelectorAll<HTMLElement>("[data-wbc-anchor]");
      nodes.forEach((node) => {
        const sx = Number(node.dataset.x);
        const sy = Number(node.dataset.y);
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
        node.style.transform = `translate3d(${Math.round(sx * zoom + dx)}px, ${Math.round(sy * zoom + dy)}px, 0)`;
      });
      // 吹き出し/入力欄は、はみ出す側と反対へ寄せる（ピンが画面端でも読める）
      const panels = layer.querySelectorAll<HTMLElement>("[data-wbc-panel]");
      panels.forEach((panel) => {
        const anchor = panel.parentElement;
        if (!anchor) return;
        const ax = Number(anchor.dataset.x) * zoom + dx;
        const ay = Number(anchor.dataset.y) * zoom + dy;
        const w = panel.offsetWidth || TIP_W;
        const h = panel.offsetHeight || 0;
        const flipX = ax + TIP_GAP + 26 + w > container.clientWidth - 8;
        panel.style.left = flipX ? `${-(w + TIP_GAP)}px` : `${26 + TIP_GAP}px`;
        // 既定はピンの上端から下へ伸ばす。下に入りきらない時だけ上へ伸ばす。
        const flipY = ay + h > container.clientHeight - 8 && ay - h > 8;
        panel.style.top = flipY ? `${-h - 4}px` : "-30px";
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [api, containerRef, endFollow, paintPositions]);

  // ── コメントへ移動して開く（リンク着地・一覧からのジャンプ共通） ──
  const focusTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const focusComment = useCallback((commentId: string, replyId?: string | null): boolean => {
    const doc = docRef.current;
    const target = doc ? readComments(doc).find((c) => c.id === commentId) : null;
    if (!target) return false;
    try {
      const st = api.getAppState();
      // キャンバスの実寸がまだ決まっていないと画面中央を計算できない。次の試行に回す。
      if (!st?.width || !st?.height) return false;
      const zoom = st.zoom?.value ?? 1;
      api.updateScene({
        appState: {
          ...st,
          scrollX: (st.width ?? 0) / 2 / zoom - target.x,
          scrollY: (st.height ?? 0) / 2 / zoom - target.y,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    } catch { /* 移動できなくても固定表示だけはする */ }
    pendingReplies.current = !!replyId; // 返信のリンクなら返信一覧を開いた状態で着地する
    pinOpen(commentId);
    return true;
  }, [api, docRef, pinOpen]);

  // Yjs の差分が届くまで対象が居ないことがあるので、見つかるまで再探索する
  const runFocusComment = useCallback((commentId: string | null, replyId?: string | null) => {
    if (focusTimer.current) { clearInterval(focusTimer.current); focusTimer.current = null; }
    if (!commentId) return;
    if (focusComment(commentId, replyId)) { onFocusResult?.(true); return; }
    let tries = 0;
    focusTimer.current = setInterval(() => {
      tries++;
      if (focusComment(commentId, replyId)) {
        clearInterval(focusTimer.current!); focusTimer.current = null;
        onFocusResult?.(true);
        return;
      }
      if (tries >= FOCUS_RETRY_MAX) {
        clearInterval(focusTimer.current!); focusTimer.current = null;
        onFocusResult?.(false); // 削除済み・別ボードのリンク
      }
    }, FOCUS_RETRY_MS);
  }, [focusComment, onFocusResult]);

  useEffect(() => {
    if (!focusCommentId) return;
    runFocusComment(focusCommentId, focusReplyId);
  }, [focusCommentId, focusReplyId, focusNonce, runFocusComment]);

  useEffect(() => () => { if (focusTimer.current) clearInterval(focusTimer.current); }, []);

  // ── 保存系 ─────────────────────────────────────────────
  const author = useMemo(() => ({ id: user.id, name: user.name }), [user.id, user.name]);
  const notifyBase = useCallback((commentId: string, replyId?: string | null) => ({
    projectSlug, boardId, boardTitle, commentId, replyId, fromUserName: user.name, isPrivate,
  }), [projectSlug, boardId, boardTitle, user.name, isPrivate]);

  const saveDraft = () => {
    const doc = docRef.current;
    const text = draft?.text.trim();
    if (!doc || !draft || !text) return;
    const c = addComment(doc, draft.x, draft.y, text, author);
    setDraft(null);
    // 投稿したコメントをそのまま見せ、コメントモードは抜ける
    // （続けて置きたい時はもう一度ピンボタン/「c」。誤ってピンが増えるのを防ぐ）
    setCommentMode(false);
    pinOpen(c.id);
    void notifyWhiteboardMentions(notifyBase(c.id), text, members);
  };

  const saveReply = (comment: WbComment) => {
    const doc = docRef.current;
    const text = replyText.trim();
    if (!doc || !text) return;
    const r = addReply(doc, comment.id, text, author);
    setReplyText("");
    setReplyOpen(false);   // 「返信」を押したら入力欄は閉じる（仕様）
    setShowReplies(true);  // 書いた返信がそのまま見えるように一覧は開く
    void notifyWhiteboardMentions(notifyBase(comment.id, r.id), text, members);
    void notifyWhiteboardReply(notifyBase(comment.id, r.id), text, comment.userName);
  };

  const saveEdit = (comment: WbComment) => {
    const doc = docRef.current;
    const text = editText.trim();
    if (!doc || !editing || !text) return;
    if (editing.kind === "comment") {
      const prev = comment.text;
      updateComment(doc, editing.id, text);
      void notifyWhiteboardMentions(notifyBase(comment.id), text, members, prev);
    } else {
      const prev = (replies[comment.id] ?? []).find((r) => r.id === editing.id)?.text;
      updateReply(doc, editing.id, text);
      void notifyWhiteboardMentions(notifyBase(comment.id, editing.id), text, members, prev);
    }
    setEditing(null);
  };

  const removeComment = (id: string) => {
    const doc = docRef.current;
    if (!doc) return;
    deleteComment(doc, id);
    closeTooltip();
  };

  const removeReply = (id: string) => {
    const doc = docRef.current;
    if (doc) deleteReply(doc, id);
  };

  const toggleResolved = (c: WbComment) => {
    const doc = docRef.current;
    if (!doc) return;
    setCommentResolved(doc, c.id, !c.resolved, user.name);
    // 解決にしたら盤面からピンが消えるので、吹き出しも畳んでおく
    if (!c.resolved) closeTooltip();
  };

  const copyLink = async (commentId: string, replyId?: string) => {
    if (!appOrigin()) {
      onToast?.("共有URLの設定(VITE_PUBLIC_APP_ORIGIN)がないためリンクを作れません");
      return;
    }
    const url = buildWhiteboardCommentLink(projectSlug, boardId, commentId, replyId);
    onToast?.(await copyText(url) ? "コメントへのリンクをコピーしました" : "コピーに失敗しました");
  };

  // ── 描画 ───────────────────────────────────────────────
  const renderTooltip = (c: WbComment) => {
    const list = replies[c.id] ?? [];
    const editingThis = editing?.kind === "comment" && editing.id === c.id;
    return (
      <div
        data-wbc-ui data-wbc-panel
        onMouseEnter={cancelClose}
        onMouseLeave={() => { if (!stickyId) scheduleClose(); }}
        onWheel={(e) => e.stopPropagation()}   // 返信一覧のスクロールをキャンバスのズームに奪われない
        style={{
          position: "absolute", left: 26 + TIP_GAP, top: -30, width: TIP_W, zIndex: 2,
          pointerEvents: "auto", background: "#fff", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,0.16)", padding: 12, boxSizing: "border-box",
          display: "flex", flexDirection: "column", gap: 8, cursor: "default",
        }}
      >
        {c.resolved && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", background: "#ECFDF5", borderRadius: 6, fontSize: 10, fontWeight: 700, color: "#059669" }}>
            <CheckCircle2 style={{ width: 12, height: 12 }} />
            解決済み{c.resolvedByName ? `（${c.resolvedByName}）` : ""}
          </div>
        )}

        {/* 投稿者・日時・⋯ */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Avatar userId={c.userId} name={c.userName} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.userName}</div>
            <div style={{ fontSize: 10, color: "#A09790" }}>
              {formatCommentTime(c.createdAt)}{c.updatedAt ? "（編集済み）" : ""}
            </div>
          </div>
          {/* 解決の切り替えは誰でもできる（Figma と同じ） */}
          <button
            onClick={() => toggleResolved(c)}
            title={c.resolved ? "未解決に戻す" : "解決済みにする（ピンは盤面から消え、コメント一覧に残ります）"}
            style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: c.resolved ? "#059669" : "#B9B3AC", display: "flex" }}
          >
            {c.resolved ? <RotateCcw style={{ width: 13, height: 13 }} /> : <CheckCircle2 style={{ width: 14, height: 14 }} />}
          </button>
          <ItemMenu
            own={c.userId === user.id}
            onCopyLink={() => void copyLink(c.id)}
            onEdit={() => { pinOpen(c.id); setEditing({ kind: "comment", id: c.id }); setEditText(c.text); }}
            onDelete={() => removeComment(c.id)}
          />
        </div>

        {/* 本文（編集中は入力欄に差し替え） */}
        {editingThis ? (
          <Composer
            value={editText} onChange={setEditText} onSubmit={() => saveEdit(c)} onCancel={() => setEditing(null)}
            placeholder="コメントを入力…" submitLabel="保存" autoFocus members={members}
          />
        ) : (
          <div style={{ fontSize: 12, lineHeight: 1.7, color: "#1A1714", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.text}</div>
        )}

        {/* 返信アイコン ／ 返信を表示 */}
        {!editingThis && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => { pinOpen(c.id); setReplyOpen(true); }}
              title="このコメントに返信"
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 7px", fontSize: 11, fontWeight: 600, color: "#0284C7", background: "transparent", border: "1px solid rgba(2,132,199,0.25)", borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}
            >
              <CornerDownRight style={{ width: 12, height: 12 }} />返信
            </button>
            {list.length > 0 && (
              <button
                onClick={() => { pinOpen(c.id); setShowReplies((v) => !v); }}
                style={{ display: "flex", alignItems: "center", gap: 3, padding: 0, fontSize: 11, fontWeight: 600, color: "#6B6458", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
              >
                {showReplies ? <ChevronUp style={{ width: 12, height: 12 }} /> : <ChevronDown style={{ width: 12, height: 12 }} />}
                {showReplies ? "返信を隠す" : `返信を表示（${list.length}）`}
              </button>
            )}
          </div>
        )}

        {/* 返信一覧（2件ぶんくらいで頭打ちにして、以降はスクロール） */}
        {showReplies && list.length > 0 && (
          <div style={{ maxHeight: REPLY_LIST_MAX_H, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 8 }}>
            {list.map((r) => {
              const editingReply = editing?.kind === "reply" && editing.id === r.id;
              return (
                <div key={r.id} style={{ display: "flex", gap: 7 }}>
                  <Avatar userId={r.userId} name={r.userName} size={18} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.userName}</span>
                      <span style={{ fontSize: 10, color: "#A09790", flexShrink: 0 }}>
                        {formatCommentTime(r.createdAt)}{r.updatedAt ? "（編集済み）" : ""}
                      </span>
                      <div style={{ marginLeft: "auto" }}>
                        <ItemMenu
                          own={r.userId === user.id}
                          onCopyLink={() => void copyLink(c.id, r.id)}
                          onEdit={() => { pinOpen(c.id); setEditing({ kind: "reply", id: r.id }); setEditText(r.text); }}
                          onDelete={() => removeReply(r.id)}
                        />
                      </div>
                    </div>
                    {editingReply ? (
                      <Composer
                        value={editText} onChange={setEditText} onSubmit={() => saveEdit(c)} onCancel={() => setEditing(null)}
                        placeholder="返信を入力…" submitLabel="保存" autoFocus minRows={2} members={members}
                      />
                    ) : (
                      <div style={{ fontSize: 12, lineHeight: 1.7, color: "#1A1714", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.text}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 返信の入力欄 */}
        {replyOpen && !editingThis && (
          <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 8 }}>
            <Composer
              value={replyText} onChange={setReplyText}
              onSubmit={() => saveReply(c)}
              onCancel={() => { setReplyOpen(false); setReplyText(""); }}
              placeholder="返信を入力…（Enterで改行 / @でメンション）" submitLabel="返信" autoFocus members={members}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <style>{COMMENT_MODE_CSS}</style>
      <div ref={layerRef} style={{ position: "absolute", inset: 0, zIndex: 22, pointerEvents: "none", overflow: "hidden" }}>
        {comments.map((c) => {
          const list = replies[c.id] ?? [];
          const active = activeId === c.id;
          const selected = selectedIds.includes(c.id);
          // 解決済みのピンは盤面から消す。ただし一覧やリンクから開いている間だけは出す。
          if (c.resolved && !active) return null;
          return (
            <div key={c.id} data-wbc-anchor data-id={c.id} data-x={c.x} data-y={c.y}
              style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}>
              <button
                data-wbc-ui
                onMouseEnter={() => { if (pinDrag.current) return; cancelClose(); setHoverId(c.id); }}
                onMouseLeave={() => { if (!stickyId && !pinDrag.current) scheduleClose(); }}
                onPointerDown={(e) => onPinPointerDown(e, c)}
                onClick={(e) => {
                  e.stopPropagation();
                  // 動かした／Shiftで選び直した直後は吹き出しを開かない
                  if (suppressClick.current) { suppressClick.current = false; return; }
                  pinOpen(c.id);
                }}
                title={`${c.userName} のコメント（ドラッグで移動）`}
                style={{
                  position: "absolute", left: 0, top: 0, transform: "translateY(-100%)",
                  width: PIN_SIZE, height: PIN_SIZE, padding: 0, pointerEvents: "auto",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: c.resolved ? "#9CA3AF" : wbUserColor(c.userId || "anon"), color: "#fff",
                  border: "2px solid #fff", borderRadius: "13px 13px 13px 3px",
                  boxShadow: selected
                    ? `0 0 0 3px ${SELECT_ACCENT}, 0 4px 12px rgba(0,0,0,0.25)`
                    : active ? "0 0 0 3px rgba(2,132,199,0.35), 0 4px 12px rgba(0,0,0,0.25)" : "0 3px 10px rgba(0,0,0,0.22)",
                  cursor: "grab", fontSize: 11, fontWeight: 700, fontFamily: "inherit", lineHeight: 1,
                  touchAction: "none", // タッチでもドラッグできるように（スクロールに奪わせない）
                }}
              >
                {initialOf(c.userName)}
                {list.length > 0 && (
                  <span style={{
                    position: "absolute", right: -5, top: -5, minWidth: 14, height: 14, padding: "0 3px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "#F59E0B", color: "#fff", border: "1.5px solid #fff", borderRadius: 7,
                    fontSize: 9, fontWeight: 700, boxSizing: "border-box",
                  }}>{list.length}</span>
                )}
              </button>
              {active && renderTooltip(c)}
            </div>
          );
        })}

        {/* 新規コメントの下書き（仮ピン＋入力欄） */}
        {draft && (
          <div data-wbc-anchor data-x={draft.x} data-y={draft.y}
            style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}>
            <div style={{
              position: "absolute", left: 0, top: 0, transform: "translateY(-100%)",
              width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
              background: wbUserColor(user.id || "anon"), color: "#fff", border: "2px dashed #fff",
              borderRadius: "13px 13px 13px 3px", boxShadow: "0 3px 10px rgba(0,0,0,0.22)",
            }}>
              <MessageSquare style={{ width: 13, height: 13 }} />
            </div>
            <div
              data-wbc-ui data-wbc-panel
              onWheel={(e) => e.stopPropagation()}
              style={{
                position: "absolute", left: 26 + TIP_GAP, top: -30, width: TIP_W, zIndex: 2,
                pointerEvents: "auto", background: "#fff", border: "1px solid rgba(26,23,20,0.10)",
                borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.16)", padding: 12, boxSizing: "border-box",
                display: "flex", flexDirection: "column", gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Avatar userId={user.id} name={user.name} />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>{user.name}</span>
              </div>
              <Composer
                value={draft.text}
                onChange={(v) => setDraft((d) => (d ? { ...d, text: v } : d))}
                onSubmit={saveDraft}
                onCancel={() => setDraft(null)}
                placeholder="コメントを入力…（Enterで改行 / @でメンション）"
                submitLabel="保存"
                autoFocus
                minRows={3}
                members={members}
              />
            </div>
          </div>
        )}

        {/* コメント一覧ポップアップ（未解決/解決済み）。
            一覧に出ている＝すでに手元にあるので、飛ぶ時にリンク着地のような再探索は要らない。 */}
        {listOpen && (
          <CommentListPanel
            comments={comments}
            replies={replies}
            activeId={activeId}
            onJump={(id) => { focusComment(id); }}
            onClose={() => setListOpen(false)}
          />
        )}
      </div>
    </>
  );
}
