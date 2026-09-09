// ホワイトボード一覧サイドバー（議事録の分割ペインUXに合わせる）。
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, X, Trash2, Pencil, PenTool, MoreVertical, Lock, LockOpen, Users, Archive, ArchiveRestore, ChevronRight, ChevronDown } from "lucide-react";
import type { Whiteboard } from "@/app/types";
import { BoardListToggle } from "./BoardListToggle";
import { PRIVATE_BG, PRIVATE_BORDER, PRIVATE_COLOR } from "./PrivateBadge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { TruncatedText } from "@/app/components/shared/TruncatedText";

interface Props {
  boards: Whiteboard[];
  selectedId: string | null;
  canEdit: boolean;
  loading?: boolean;
  /** プライベート切替を出すかの判定に使う（作成者本人にだけ出す） */
  userId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onTogglePrivate: (id: string) => void;
  /** アーカイブ（片付け）の付け外し。削除ではないのでいつでも戻せる */
  onToggleArchive: (id: string) => void;
  /** プライベートボードの共有先ダイアログを開く（作成者のみ） */
  onOpenShare: (id: string) => void;
  onCollapse: () => void;
}

export function BoardListSidebar({ boards, selectedId, canEdit, loading, userId, onSelect, onCreate, onRename, onDelete, onTogglePrivate, onToggleArchive, onOpenShare, onCollapse }: Props) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // アーカイブ済みの折りたたみ。既定は閉じる（片付けたものを毎回見せない）
  const [showArchived, setShowArchived] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 入力欄に一度でもフォーカスが載ったか。ドロップダウンが閉じる時にトリガーへフォーカスを
  // 戻そうとするので、autoFocus だけだと載る前に blur が飛んで即確定してしまう。
  const focusedRef = useRef(false);

  useEffect(() => {
    focusedRef.current = false;
    if (!editingId) return;
    const raf = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    return () => cancelAnimationFrame(raf);
  }, [editingId]);

  // 現役 / アーカイブ済みに仕分ける。検索は両方を対象にする
  // （片付けたボードを名前で探せないと、戻す手段が実質無くなるため）。
  const { activeBoards, archivedBoards } = useMemo(() => {
    const q = search.toLowerCase();
    const hit = boards.filter((b) => b.title.toLowerCase().includes(q));
    return {
      activeBoards: hit.filter((b) => !b.archivedAt),
      archivedBoards: hit.filter((b) => !!b.archivedAt),
    };
  }, [boards, search]);

  // アーカイブ済みのボードを開いている / 検索で引っかかった時は、畳んだままだと
  // 「どこにいるのか」「見つかったのか」が分からないので自動で開く。
  const selectedIsArchived = archivedBoards.some((b) => b.id === selectedId);
  useEffect(() => {
    if (selectedIsArchived || (search && archivedBoards.length > 0)) setShowArchived(true);
  }, [selectedIsArchived, search, archivedBoards.length]);

  const commitRename = (id: string) => {
    const t = draft.trim();
    if (t) onRename(id, t);
    setEditingId(null);
  };

  const renderRow = (b: Whiteboard) => {
    const active = b.id === selectedId;
    const isPrivate = b.visibility === "private";
    const isArchived = !!b.archivedAt;
    // プライベート切替・共有先の設定は作成者本人にだけ出す
    // （実際の可否は DB 側の whiteboards_guard_ownership / RLS が決める）。
    const isOwner = !!userId && b.createdBy === userId;
    const shareCount = b.sharedWith.length;
    // 作成者から見た印は「自分のみ / N人に共有」、共有された側から見た印は「共有」。
    // 共有された側にとっては人数より「これは限定公開のボードだ」という事実の方が大事。
    const privateLabel = !isOwner ? "共有" : shareCount > 0 ? `${shareCount}人に共有` : "自分のみ";
    const privateHint = !isOwner
      ? "作成者から共有された、選ばれたメンバーだけが見られるボードです"
      : shareCount > 0
        ? `あなたと ${b.sharedWith.map((m) => m.name || "（不明なユーザー）").join("、")} だけが見られます`
        : "自分だけが見られるボードです";
    const RowIcon = isArchived ? Archive : isPrivate ? (shareCount > 0 ? Users : Lock) : PenTool;
    const iconColor = isArchived ? "#A09790" : isPrivate ? PRIVATE_COLOR : active ? "#059669" : "#C9C4BB";
    return (
      <div key={b.id} onClick={() => onSelect(b.id)}
        style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 9px", borderRadius: 8, cursor: "pointer", background: active ? "#ECFDF5" : "transparent", border: `1px solid ${active ? "rgba(5,150,105,0.25)" : "transparent"}`, opacity: isArchived && !active ? 0.6 : 1 }}>
        <RowIcon style={{ width: 12, height: 12, color: iconColor, flexShrink: 0 }} />
        {editingId === b.id ? (
          <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
            onFocus={() => { focusedRef.current = true; }}
            onBlur={() => { if (focusedRef.current) commitRename(b.id); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename(b.id); if (e.key === "Escape") setEditingId(null); }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, fontSize: 12, border: "1px solid rgba(5,150,105,0.3)", borderRadius: 5, padding: "2px 5px", outline: "none", fontFamily: "inherit" }} />
        ) : (
          <>
            <TruncatedText text={b.title}
              style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: active ? 600 : 500, color: isArchived ? "#6B6560" : "#1A1714" }} />
            {isPrivate && (
              <span title={privateHint}
                style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, lineHeight: 1, padding: "3px 5px", borderRadius: 4, color: PRIVATE_COLOR, background: PRIVATE_BG, border: `1px solid ${PRIVATE_BORDER}` }}>
                {privateLabel}
              </span>
            )}
          </>
        )}
        {canEdit && editingId !== b.id && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* 行の onClick（ボード選択）へ抜けないよう、押下系のイベントは全部ここで止める */}
              <button onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
                title="メニュー" aria-label="メニュー"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#C9C4BB", display: "flex", flexShrink: 0 }}>
                <MoreVertical style={{ width: 13, height: 13 }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => { setEditingId(b.id); setDraft(b.title); }}>
                <Pencil style={{ width: 13, height: 13 }} />名前変更
              </DropdownMenuItem>
              {/* アーカイブは削除の手前の選択肢。プライベートボードを畳めるのは作成者だけ
                  （RLS の wb_update が同じ条件で弾く）。 */}
              {(!isPrivate || isOwner) && (
                <DropdownMenuItem onSelect={() => onToggleArchive(b.id)}>
                  {isArchived
                    ? <><ArchiveRestore style={{ width: 13, height: 13 }} />アーカイブから戻す</>
                    : <><Archive style={{ width: 13, height: 13 }} />アーカイブ</>}
                </DropdownMenuItem>
              )}
              {/* プライベートボードを消せるのは作成者だけ（RLS の wb_delete）。
                  共有された側に出すと、押しても何も起きないメニューになる */}
              {(!isPrivate || isOwner) && (
                <DropdownMenuItem onSelect={() => onDelete(b.id)}>
                  <Trash2 style={{ width: 13, height: 13 }} />ボード削除
                </DropdownMenuItem>
              )}
              {isOwner && (
                <>
                  <DropdownMenuSeparator />
                  {/* 共有先はプライベート中だけ意味を持つ（公開ボードはPJ全員が見られる） */}
                  {isPrivate && (
                    <DropdownMenuItem onSelect={() => onOpenShare(b.id)}>
                      <Users style={{ width: 13, height: 13 }} />共有するメンバー
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => onTogglePrivate(b.id)}>
                    {isPrivate
                      ? <><LockOpen style={{ width: 13, height: 13 }} />プライベートモード解除</>
                      : <><Lock style={{ width: 13, height: 13 }} />プライベートモード</>}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  return (
    <div style={{ width: 260, flexShrink: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", padding: 10, overflowY: "auto", display: "flex", flexDirection: "column" }}>
      {/* たたむボタン（BRU9-046）。閉じる対象のすぐ内側に置き、右寄せで検索欄の上へ。 */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <BoardListToggle collapsed={false} onToggle={onCollapse} variant="inline" />
      </div>

      <div style={{ position: "relative", marginBottom: 8 }}>
        <Search style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 11, height: 11, color: search ? "#059669" : "#C9C4BB", pointerEvents: "none" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="検索..."
          style={{ width: "100%", boxSizing: "border-box", padding: "6px 26px", fontSize: 11, background: "#F4F5F6", border: `1px solid ${search ? "rgba(5,150,105,0.25)" : "transparent"}`, borderRadius: 7, outline: "none", fontFamily: "inherit" }} />
        {search && (
          <button onClick={() => setSearch("")} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 2, color: "#A09790", display: "flex" }}>
            <X style={{ width: 10, height: 10 }} />
          </button>
        )}
      </div>

      {canEdit && (
        <button onClick={onCreate}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 10px", marginBottom: 8, fontSize: 11, fontWeight: 600, color: "#fff", background: "#059669", border: "none", borderRadius: 7, cursor: "pointer" }}>
          <Plus style={{ width: 12, height: 12 }} />新規ボード
        </button>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {loading ? (
          // 読み込み中はスピナー＋スケルトンを表示（空表示「ボードがありません」の誤表示を防ぐ）
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "24px 8px" }}>
            <style>{"@keyframes wbspin{to{transform:rotate(360deg)}}@keyframes wbshimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}"}</style>
            <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid #E7E5E1", borderTopColor: "#059669", animation: "wbspin 0.7s linear infinite" }} />
            <span style={{ fontSize: 11, color: "#A09790" }}>ボードを読み込み中…</span>
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ height: 30, borderRadius: 8, background: "linear-gradient(90deg,#F4F5F6,#E7E5E1,#F4F5F6)", backgroundSize: "200% 100%", animation: "wbshimmer 1.2s linear infinite", opacity: 1 - i * 0.2 }} />
              ))}
            </div>
          </div>
        ) : activeBoards.length === 0 && (
          <div style={{ padding: "20px 8px", fontSize: 11, color: "#A09790", textAlign: "center" }}>
            {archivedBoards.length > 0 ? "現役のボードはありません" : "ボードがありません"}
          </div>
        )}
        {!loading && activeBoards.map(renderRow)}
      </div>

      {/* ── アーカイブ済み ──────────────────────────────────
          畳んだボードは既定で隠すが、消したわけではないので必ず開けるようにしておく。
          件数を見出しに出しておくと「どこかにあるはず」が探せる。 */}
      {!loading && archivedBoards.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 8 }}>
          <button onClick={() => setShowArchived((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 5, width: "100%", padding: "5px 6px", background: "none", border: "none", borderRadius: 6, cursor: "pointer", color: "#A09790", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>
            {showArchived
              ? <ChevronDown style={{ width: 12, height: 12, flexShrink: 0 }} />
              : <ChevronRight style={{ width: 12, height: 12, flexShrink: 0 }} />}
            <Archive style={{ width: 11, height: 11, flexShrink: 0 }} />
            <span>アーカイブ済み（{archivedBoards.length}）</span>
          </button>
          {showArchived && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 3 }}>
              {archivedBoards.map(renderRow)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
