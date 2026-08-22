// 議事録 / バックログ の階層ツリー（Wiki のツリーと同じ操作仕様）。
//
// Wiki(WikiPage.tsx) が持っていた挙動をそのまま切り出した共通版:
//   ・フォルダ行はクリックで開閉 + 選択
//   ・ダブルクリック / メニューの「名前を変更」でインラインリネーム
//   ・ドラッグ&ドロップでフォルダへ移動（ルートへ戻すのは親側の枠で受ける）
//   ・3点リーダー(Dropdown) と 右クリック(ContextMenu) で同じメニュー
//   ・作成直後のハイライト + スクロール
//
// 行の見た目はページごとに違う（議事録=開催日、バックログ=ID/優先度バッジ…）ので、
// フォルダ以外の行の中身だけ renderItemRow で差し込む。
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronRight, ChevronDown, Plus, FolderPlus, Folder, FolderOpen,
  FolderTree, Pencil, Trash2, MoreVertical, Link2, X,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/app/components/ui/dropdown-menu";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@/app/components/ui/context-menu";

/** ツリーが必要とする最小の形。実データ(議事録/バックログ)はこれを満たしていればよい */
export interface DocTreeItem {
  id: string;
  parentId: string | null;
  title: string;
  isFolder: boolean;
}

export interface DocTreeNode extends DocTreeItem {
  children: DocTreeNode[];
}

/**
 * フラットな配列を親子ツリーへ組み替える。
 * 並び順は「渡された配列の順序」をそのまま引き継ぐ（各階層で安定）。
 * 議事録は開催日降順、バックログは rank 昇順…とページごとに基準が違うので、
 * 並べ替えは呼び出し側で済ませてから渡す。
 */
export function buildDocTree<T extends DocTreeItem>(items: T[]): DocTreeNode[] {
  const byId = new Map<string, DocTreeNode>(items.map(i => [i.id, { ...i, children: [] }]));
  const roots: DocTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** 自分自身/自分の子孫フォルダ配下への移動になっていないか */
export function isCyclicMove(items: DocTreeItem[], draggedId: string, targetParentId: string | null): boolean {
  let cur = targetParentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === draggedId) return true;
    if (seen.has(cur)) return false; // 壊れたデータでの無限ループ避け
    seen.add(cur);
    cur = items.find(i => i.id === cur)?.parentId ?? null;
  }
  return false;
}

export interface DocTreeProps {
  tree: DocTreeNode[];
  selectedId: string | null;
  canEdit: boolean;
  /** 行クリック（フォルダも含む） */
  onSelect: (node: DocTreeNode) => void;
  /** メニューからの子作成。isFolder=false なら通常アイテム */
  onAddChild: (parentId: string, isFolder: boolean) => void;
  /** メニューに出す「◯◯を追加」の文言 */
  addItemLabel: string;
  addFolderLabel?: string;
  onRename: (id: string, nextTitle: string) => void | Promise<void>;
  onDelete: (node: DocTreeNode) => void;
  /** フォルダへドロップしたとき */
  onMove: (draggedId: string, targetParentId: string | null) => void | Promise<void>;
  /** アイテム行へドロップしたとき（並べ替え）。未指定なら何もしない */
  onReorder?: (draggedId: string, targetId: string) => void | Promise<void>;
  onOpenMoveModal: (node: DocTreeNode) => void;
  onCopyLink: (node: DocTreeNode) => void;
  /** フォルダ以外の行の中身（アイコン〜ラベル）。flex:1 の中に置かれる */
  renderItemRow: (node: DocTreeNode, isSelected: boolean) => ReactNode;
  /** 作成直後に一時的に色を付けるノード */
  highlightIds?: string[];
  /** 作成直後にここまでスクロールするノード */
  scrollToId?: string | null;
}

export function DocTree(props: DocTreeProps) {
  return (
    <>
      {props.tree.map(node => (
        <DocTreeRow key={node.id} node={node} depth={0} {...props} />
      ))}
    </>
  );
}

function DocTreeRow({
  node, depth, selectedId, canEdit, onSelect, onAddChild, addItemLabel, addFolderLabel,
  onRename, onDelete, onMove, onReorder, onOpenMoveModal, onCopyLink, renderItemRow,
  highlightIds, scrollToId, tree,
}: DocTreeProps & { node: DocTreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  // 3点リーダー/右クリックメニューを開いている行。開いている間だけ枠を出して
  // 「どの行のメニューか」を示す。選択(右パネル表示)は動かさない。
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const hasChildren = node.children.length > 0;
  const isFolder = node.isFolder;
  const isSelected = selectedId === node.id;
  const highlights = highlightIds ?? [];
  const isHighlighted = highlights.includes(node.id);

  // 作成したものが畳んだフォルダの中だと見えないので、子孫がハイライト対象なら開く
  const hasHighlightedDescendant = useMemo(() => {
    if (highlights.length === 0) return false;
    const walk = (nodes: DocTreeNode[]): boolean =>
      nodes.some(n => highlights.includes(n.id) || walk(n.children));
    return walk(node.children);
  }, [highlights, node.children]);

  useEffect(() => { if (hasHighlightedDescendant) setExpanded(true); }, [hasHighlightedDescendant]);

  useEffect(() => {
    if (scrollToId !== node.id) return;
    rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [scrollToId, node.id]);

  useEffect(() => { setEditTitle(node.title); }, [node.title]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRowClick = () => {
    if (isEditing) return;
    if (isFolder) setExpanded(v => !v);
    onSelect(node);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === node.id) return;
    if (isFolder) await onMove(draggedId, node.id);
    else await onReorder?.(draggedId, node.id);
  };

  const handleSaveRename = async () => {
    setIsEditing(false);
    const trimmed = editTitle.trim();
    if (!trimmed || trimmed === node.title) { setEditTitle(node.title); return; }
    await onRename(node.id, trimmed);
  };

  const FolderIcon = expanded ? FolderOpen : Folder;
  const menuIconStyle = { width: 14, height: 14 };
  const canDropHere = canEdit && (isFolder || !!onReorder);

  // 3点リーダー(Dropdown)と右クリック(ContextMenu)で同じ項目を描く。
  // Radix の Dropdown/Context は別プリミティブなので、同名APIのコンポーネントを差し替えて再利用する。
  const renderMenuItems = (P: { Item: React.ElementType; Separator: React.ElementType }) => (
    <>
      {canEdit && isFolder && (
        <>
          <P.Item onSelect={() => onAddChild(node.id, false)}><Plus style={menuIconStyle} />{addItemLabel}</P.Item>
          <P.Item onSelect={() => onAddChild(node.id, true)}><FolderPlus style={menuIconStyle} />{addFolderLabel ?? "サブフォルダを追加"}</P.Item>
        </>
      )}
      {canEdit && (
        <>
          <P.Item onSelect={() => onOpenMoveModal(node)}><FolderTree style={menuIconStyle} />移動</P.Item>
          <P.Item onSelect={() => setIsEditing(true)}><Pencil style={menuIconStyle} />名前を変更</P.Item>
        </>
      )}
      <P.Item onSelect={() => onCopyLink(node)}><Link2 style={menuIconStyle} />リンクをコピー</P.Item>
      {canEdit && <P.Separator />}
      {canEdit && (
        <P.Item onSelect={() => onDelete(node)} className="text-red-600 focus:text-red-600">
          <Trash2 style={menuIconStyle} />削除
        </P.Item>
      )}
    </>
  );

  return (
    <div
      onDragOver={e => {
        if (!canDropHere) return;
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer.types.includes("text/plain")) setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      style={{
        background: isDragOver && isFolder ? "rgba(5,150,105,0.08)" : "transparent",
        borderRadius: 8, transition: "background 0.15s",
        outline: isDragOver && !isFolder ? "2px solid #059669" : "none", outlineOffset: -1,
      }}
    >
      {/* 右クリックは「メニューを出すだけ」。選択・開閉・遷移はしない */}
      <ContextMenu onOpenChange={setMenuOpen}>
        <ContextMenuTrigger asChild>
          <div
            ref={rowRef}
            draggable={canEdit && !isEditing}
            onDragStart={e => {
              if (!canEdit) return;
              e.dataTransfer.setData("text/plain", node.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={handleRowClick}
            onDoubleClick={e => { e.stopPropagation(); if (canEdit) setIsEditing(true); }}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "6px 8px", paddingLeft: 8 + depth * 16,
              borderRadius: 7, cursor: "pointer",
              // 作成直後は琥珀色で数秒だけ光らせる。解除時は transition でそっと戻す。
              background: isHighlighted ? "#FEF3C7" : (isSelected ? "#ECFDF5" : (hovered || menuOpen ? "#F4F5F6" : "transparent")),
              // 枠は inset で行の内側に描く。外側(0 0 0 Npx)だとサイドバーの
              // overflow で端が切れたり、隣の行に食い込んで欠けて見えるため。
              boxShadow: isHighlighted
                ? "inset 0 0 0 2px rgba(217,119,6,0.45)"
                : (menuOpen ? "inset 0 0 0 1.5px rgba(5,150,105,0.35)" : "none"),
              transition: "background 0.45s ease, box-shadow 0.45s ease",
            }}>
            <span
              onClick={e => { e.stopPropagation(); if (hasChildren || isFolder) setExpanded(v => !v); }}
              style={{ width: 14, flexShrink: 0, display: "flex" }}>
              {(isFolder || hasChildren) && (
                expanded
                  ? <ChevronDown style={{ width: 11, height: 11, color: "#9E9690" }} />
                  : <ChevronRight style={{ width: 11, height: 11, color: "#9E9690" }} />
              )}
            </span>

            {isEditing ? (
              <input
                ref={inputRef}
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onBlur={handleSaveRename}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSaveRename();
                  if (e.key === "Escape") { setEditTitle(node.title); setIsEditing(false); }
                }}
                onClick={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()}
                style={{
                  flex: 1, minWidth: 0, fontSize: 12, padding: "1px 4px",
                  border: "1px solid #059669", borderRadius: 4, outline: "none",
                  color: "#1A1714", background: "#FFFFFF", height: 18,
                }}
              />
            ) : isFolder ? (
              <>
                <FolderIcon style={{ width: 12, height: 12, color: "#F59E0B", flexShrink: 0 }} />
                <span style={{
                  flex: 1, minWidth: 0, fontSize: 12,
                  fontWeight: isSelected ? 700 : 500,
                  color: isSelected ? "#059669" : "#1A1714",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {node.title || "無題のフォルダ"}
                </span>
              </>
            ) : (
              renderItemRow(node, isSelected)
            )}

            {!isEditing && (
              <DropdownMenu onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={e => e.stopPropagation()}
                    onPointerDown={e => e.stopPropagation()}
                    onDoubleClick={e => e.stopPropagation()}
                    title="メニュー"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#9E9690", padding: 2, flexShrink: 0, display: "flex", opacity: hovered || menuOpen ? 1 : 0.5 }}>
                    <MoreVertical style={{ width: 14, height: 14 }} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                  {renderMenuItems({ Item: DropdownMenuItem, Separator: DropdownMenuSeparator })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {renderMenuItems({ Item: ContextMenuItem, Separator: ContextMenuSeparator })}
        </ContextMenuContent>
      </ContextMenu>

      {(isFolder || hasChildren) && expanded && node.children.map(child => (
        <DocTreeRow
          key={child.id} node={child} depth={depth + 1}
          tree={tree} selectedId={selectedId} canEdit={canEdit}
          onSelect={onSelect} onAddChild={onAddChild}
          addItemLabel={addItemLabel} addFolderLabel={addFolderLabel}
          onRename={onRename} onDelete={onDelete} onMove={onMove} onReorder={onReorder}
          onOpenMoveModal={onOpenMoveModal} onCopyLink={onCopyLink} renderItemRow={renderItemRow}
          highlightIds={highlightIds} scrollToId={scrollToId}
        />
      ))}
    </div>
  );
}

// ─── 移動先フォルダの選択モーダル（Googleドライブ風。Wiki と同じ） ───────────
export function FolderMoveModal({
  node, items, onClose, onConfirm,
}: {
  node: DocTreeItem;
  items: DocTreeItem[];
  onClose: () => void;
  onConfirm: (targetParentId: string | null) => Promise<void> | void;
}) {
  // 自分自身と、自分の子孫フォルダは移動先にできない
  const foldersOnly = useMemo(
    () => items.filter(i => i.isFolder && i.id !== node.id && !isCyclicMove(items, node.id, i.id)),
    [items, node.id],
  );
  const folderTree = useMemo(() => buildDocTree(foldersOnly), [foldersOnly]);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(node.parentId);

  const renderFolderOption = (folder: DocTreeNode, depth: number) => {
    const isChosen = selectedParentId === folder.id;
    return (
      <div key={folder.id}>
        <div
          onClick={() => setSelectedParentId(folder.id)}
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
            paddingLeft: 12 + depth * 16, borderRadius: 8, cursor: "pointer",
            background: isChosen ? "#ECFDF5" : "transparent",
            border: isChosen ? "1px solid #10B981" : "1px solid transparent",
            transition: "all 0.1s", marginBottom: 2,
          }}
        >
          <Folder style={{ width: 14, height: 14, color: isChosen ? "#059669" : "#F59E0B" }} />
          <span style={{ fontSize: 12, fontWeight: isChosen ? 700 : 500, color: isChosen ? "#059669" : "#1A1714" }}>
            {folder.title || "無題のフォルダ"}
          </span>
        </div>
        {folder.children.map(c => renderFolderOption(c, depth + 1))}
      </div>
    );
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.35)", backdropFilter: "blur(2px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 400, background: "#FFFFFF", borderRadius: 14, padding: 20, zIndex: 401, boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FolderTree style={{ width: 16, height: 16, color: "#059669" }} />
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1A1714" }}>移動先フォルダーの選択</h3>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#B0A9A4" }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>
        <p style={{ fontSize: 11, color: "#9E9690", marginBottom: 12 }}>
          「{node.title || "無題"}」を配置する移動先フォルダーを選択してください。
        </p>

        <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: 8, maxHeight: 220, overflowY: "auto", background: "#FAFAF8", marginBottom: 16 }}>
          <div
            onClick={() => setSelectedParentId(null)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, cursor: "pointer",
              background: selectedParentId === null ? "#ECFDF5" : "transparent",
              border: selectedParentId === null ? "1px solid #10B981" : "1px solid transparent",
              transition: "all 0.1s", marginBottom: 4,
            }}
          >
            <FolderTree style={{ width: 14, height: 14, color: selectedParentId === null ? "#059669" : "#B0A9A4" }} />
            <span style={{ fontSize: 12, fontWeight: selectedParentId === null ? 700 : 500, color: selectedParentId === null ? "#059669" : "#1A1714" }}>
              / プロジェクトの最上位（ルート階層）
            </span>
          </div>

          <div style={{ height: 1, background: "rgba(26,23,20,0.04)", margin: "4px 0" }} />

          {folderTree.length === 0 ? (
            <div style={{ padding: 16, textAlign: "center", fontSize: 11, color: "#B0A9A4" }}>
              移動可能な他のフォルダがありません。
            </div>
          ) : (
            folderTree.map(f => renderFolderOption(f, 0))
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose}
            style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "#6B6458", background: "#F4F5F6", border: "none", borderRadius: 8, cursor: "pointer" }}>
            キャンセル
          </button>
          <button type="button" onClick={() => onConfirm(selectedParentId)}
            style={{ padding: "8px 16px", fontSize: 12, fontWeight: 600, color: "#FFFFFF", background: "#059669", border: "none", borderRadius: 8, cursor: "pointer", boxShadow: "0 2px 4px rgba(5,150,105,0.2)" }}>
            この場所に移動
          </button>
        </div>
      </div>
    </>
  );
}
