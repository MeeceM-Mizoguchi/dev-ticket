import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router";
import { FolderKanban, ChevronRight, ChevronDown, Plus, FileText, Trash2, BookOpen, Folder, FolderOpen, FolderPlus, GripVertical, FolderTree, X, Pencil, Search } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { usePreviewPanel } from "@/app/contexts/PreviewPanelContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { mapProject, mapWikiPage } from "@/app/lib/mappers";
import type { Project, WikiPage as WikiPageType, AccessLevel, UserPermissions } from "@/app/types";

function titleToPathSegment(title: string): string {
  return encodeURIComponent(title || "無題のページ");
}
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { RichEditor } from "@/app/components/shared/RichEditor";

interface TreeNode extends WikiPageType {
  children: TreeNode[];
}

function buildTree(pages: WikiPageType[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(pages.map(p => [p.id, { ...p, children: [] }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortFn = (a: TreeNode, b: TreeNode) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);
  const sortRec = (nodes: TreeNode[]) => { nodes.sort(sortFn); nodes.forEach(n => sortRec(n.children)); };
  sortRec(roots);
  return roots;
}

function TreeItem({
  node, depth, selectedId, onSelectPage, onSelectFolder, onAddChild, onDelete, onMoveNode, onOpenMoveModal, onRename, canEdit,
}: {
  node: TreeNode; depth: number; selectedId: string | null;
  onSelectPage: (id: string) => void;
  onSelectFolder: (id: string) => void;
  onAddChild: (parentId: string, isFolder: boolean) => void;
  onDelete: (node: WikiPageType) => void;
  onMoveNode: (draggedId: string, targetParentId: string | null) => Promise<void>;
  onOpenMoveModal: (node: WikiPageType) => void;
  onRename: (id: string, newTitle: string) => Promise<void>;
  canEdit: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasChildren = node.children.length > 0;
  const isFolder = node.isFolder;
  const isSelected = selectedId === node.id;

  useEffect(() => {
    setEditTitle(node.title);
  }, [node.title]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRowClick = () => {
    if (isEditing) return;
    if (isFolder) {
      setExpanded(v => !v);
      onSelectFolder(node.id);
    } else {
      onSelectPage(node.id);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (!canEdit) return;
    e.dataTransfer.setData("text/plain", node.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!canEdit || !isFolder) return;
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.types.includes("text/plain") ? "valid" : "";
    if (draggedId) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (!canEdit || !isFolder) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === node.id) return;
    await onMoveNode(draggedId, node.id);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    setIsEditing(true);
  };

  const handleSaveRename = async () => {
    setIsEditing(false);
    const trimmed = editTitle.trim();
    if (!trimmed || trimmed === node.title) {
      setEditTitle(node.title);
      return;
    }
    await onRename(node.id, trimmed);
  };

  const FolderIcon = expanded ? FolderOpen : Folder;
  const ItemIcon = isFolder ? FolderIcon : FileText;
  const iconColor = isFolder ? "#F59E0B" : (isSelected ? "#059669" : "#B0A9A4");

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ background: isDragOver ? "rgba(5,150,105,0.08)" : "transparent", borderRadius: 8, transition: "background 0.15s" }}
    >
      <div
        draggable={canEdit}
        onDragStart={handleDragStart}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onClick={handleRowClick}
        onDoubleClick={handleDoubleClick}
        style={{
          display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", paddingLeft: 8 + depth * 16,
          borderRadius: 7, cursor: "pointer",
          background: isSelected ? "#ECFDF5" : (hovered ? "#F4F5F6" : "transparent"),
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
        <ItemIcon style={{ width: 12, height: 12, color: iconColor, flexShrink: 0 }} />

        {isEditing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onBlur={handleSaveRename}
            onKeyDown={e => {
              if (e.key === "Enter") handleSaveRename();
              if (e.key === "Escape") {
                setEditTitle(node.title);
                setIsEditing(false);
              }
            }}
            onClick={e => e.stopPropagation()}
            onDoubleClick={e => e.stopPropagation()}
            style={{
              flex: 1, minWidth: 0, fontSize: 12, padding: "1px 4px",
              border: "1px solid #059669", borderRadius: 4, outline: "none",
              color: "#1A1714", background: "#FFFFFF", height: "18px"
            }}
          />
        ) : (
          <span style={{
            flex: 1, minWidth: 0, fontSize: 12,
            fontWeight: isSelected ? 700 : 500,
            color: isSelected ? "#059669" : "#1A1714",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {node.title || (isFolder ? "無題のフォルダ" : "無題のページ")}
          </span>
        )}

        {hovered && !isEditing && (
          <>
            {canEdit && (
              <>
                <button
                  onClick={e => { e.stopPropagation(); onAddChild(node.id, false); }}
                  title="サブページを追加"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#9E9690", padding: 2, flexShrink: 0 }}>
                  <Plus style={{ width: 12, height: 12 }} />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onAddChild(node.id, true); }}
                  title="サブフォルダを追加"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#9E9690", padding: 2, flexShrink: 0 }}>
                  <FolderPlus style={{ width: 12, height: 12 }} />
                </button>
                <div
                  draggable
                  onDragStart={handleDragStart}
                  onClick={e => { e.stopPropagation(); onOpenMoveModal(node); }}
                  title={isFolder ? "フォルダを移動 (クリックで一覧から選択)" : "ページを移動 (クリックで一覧から選択)"}
                  style={{ display: "flex", alignItems: "center", justifySelf: "center", cursor: "pointer", color: isFolder ? "#F59E0B" : "#0284C7", padding: 2, flexShrink: 0 }}
                >
                  <GripVertical style={{ width: 12, height: 12 }} />
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setIsEditing(true); }}
                  title="名前を変更"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#9E9690", padding: 2, flexShrink: 0 }}>
                  <Pencil style={{ width: 11, height: 11 }} />
                </button>
              </>
            )}
            {canEdit && (
              <button
                onClick={e => { e.stopPropagation(); onDelete(node); }}
                title="削除"
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9E9690", padding: 2, flexShrink: 0 }}>
                <Trash2 style={{ width: 12, height: 12 }} />
              </button>
            )}
          </>
        )}
      </div>
      {(isFolder || hasChildren) && expanded && node.children.map(c => (
        <TreeItem key={c.id} node={c} depth={depth + 1} selectedId={selectedId}
          onSelectPage={onSelectPage} onSelectFolder={onSelectFolder} onAddChild={onAddChild} onDelete={onDelete} onMoveNode={onMoveNode} onOpenMoveModal={onOpenMoveModal} onRename={onRename} canEdit={canEdit} />
      ))}
    </div>
  );
}

export function WikiPage() {
  const { projectSlug, folderId, pageId, "*": wikiPath } = useParams<{ projectSlug: string; folderId?: string; pageId?: string; "*"?: string }>();
  const navigate = useNavigate();
  const { userName, userRole, userId } = useAuth();
  const { plan } = usePlan();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [pages, setPages] = useState<WikiPageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<WikiPageType | null>(null);
  const [effectiveWikiPerm, setEffectiveWikiPerm] = useState<AccessLevel>("view");
  const [effectiveBacklogPerm, setEffectiveBacklogPerm] = useState<AccessLevel>("view");
  const [effectiveMinutesPerm, setEffectiveMinutesPerm] = useState<AccessLevel>("view");
  const [permsLoaded, setPermsLoaded] = useState(false);
  const [isTreeDragOverRoot, setIsTreeDragOverRoot] = useState(false);

  const [movingNodeTarget, setMovingNodeTarget] = useState<WikiPageType | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAdminRole = userRole === "owner" || userRole === "admin";
  const canEdit = effectiveWikiPerm === "edit";
  const { open: openPreview } = usePreviewPanel();

  // URLからUUIDを確実に抜き出す共通関数
  const getUUIDFromURL = useCallback(() => {
    if (pageId) return pageId;
    if (folderId) return folderId;
    if (wikiPath) {
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const match = wikiPath.match(uuidRegex);
      if (match) return match[0];
    }
    return null;
  }, [pageId, folderId, wikiPath]);

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    // ロード開始時にloadingを確実にtrueにする（リロード対策）
    setLoading(true);
    
    const { data: bySlug } = await supabase!.from("projects").select("*").eq("slug", projectSlug).limit(1);
    const p = bySlug?.[0] ?? (await supabase!.from("projects").select("*").eq("id", projectSlug).maybeSingle()).data;
    if (!p) { setNotFound(true); setLoading(false); return; }
    setProject(mapProject(p));
    const [{ data }, permResult] = await Promise.all([
      supabase!.from("wiki_pages").select("*").eq("project_id", p.id).order("sort_order"),
      isAdminRole ? Promise.resolve({ data: null }) :
        supabase!.from("project_member_permissions").select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle(),
    ]);
    
    const mappedPages = (data ?? []).map(mapWikiPage);
    setPages(mappedPages);

    if (isAdminRole) {
      setEffectiveWikiPerm("edit");
      setEffectiveBacklogPerm("edit");
      setEffectiveMinutesPerm("edit");
    } else {
      const perms = permResult.data?.permissions as Partial<UserPermissions> | null;
      setEffectiveWikiPerm((perms?.wikiPermission as AccessLevel | undefined) ?? "none");
      setEffectiveBacklogPerm((perms?.backlogPermission as AccessLevel | undefined) ?? "none");
      setEffectiveMinutesPerm((perms?.minutesPermission as AccessLevel | undefined) ?? "none");
    }
    setPermsLoaded(true);

    // データ読み込みが100%完了した時点で、URLのIDに該当するデータを最優先でインライン展開
    const activeId = getUUIDFromURL();
    if (activeId) {
      const currentActiveNode = mappedPages.find(page => page.id.toLowerCase() === activeId.toLowerCase());
      if (currentActiveNode) {
        setSelectedId(currentActiveNode.id);
        setTitle(currentActiveNode.title);
        setContent(currentActiveNode.content ?? "");
        setImages(currentActiveNode.images ?? []);
      }
    }

    setLoading(false); // 全同期が安全に終わってからローディングロックを解除
  }, [projectSlug, userId, isAdminRole, getUUIDFromURL]);

  useEffect(() => { load(); }, [load]);

  const tree = useMemo(() => buildTree(pages), [pages]);
  const selected = useMemo(() => pages.find(p => p.id === selectedId) ?? null, [pages, selectedId]);

  // パンくず用：選択中ページの祖先フォルダ一覧
  const ancestors = useMemo(() => {
    if (!selected) return [];
    const list: WikiPageType[] = [];
    let current = selected;
    while (current.parentId) {
      const parent = pages.find(p => p.id === current.parentId);
      if (!parent) break;
      list.unshift(parent);
      current = parent;
    }
    return list;
  }, [selected, pages]);

  // URLパラメータのリアルタイム監視
  useEffect(() => {
    if (pages.length === 0 || loading) return; // 🌟 修正: 通信中(loading=true)の空上書きを絶対に阻止するガード
    const activeId = getUUIDFromURL();
    if (activeId) {
      const found = pages.find(p => p.id.toLowerCase() === activeId.toLowerCase());
      if (found) {
        setSelectedId(found.id);
        return;
      }
    }
    
    if (wikiPath && !activeId) {
      const parts = wikiPath.split("/").filter(Boolean);
      if (parts.length > 0) {
        const lastPart = decodeURIComponent(parts[parts.length - 1]);
        const foundByTitle = pages.find(p => p.title === lastPart);
        if (foundByTitle) setSelectedId(foundByTitle.id);
      }
    }
  }, [getUUIDFromURL, wikiPath, pages, loading]);

  // 選択データ切り替え時の同期
  useEffect(() => {
    if (loading) return; // 🌟 修正: 通信中の初期ステートの時は上書き同期をスキップ
    if (selected) {
      setTitle(selected.title);
      setContent(selected.content ?? "");
      setImages(selected.images ?? []);
    }
  }, [selectedId, selected, loading]);

  const handleSelectPage = useCallback((targetPageId: string) => {
    const slug = projectSlug ?? "";
    navigate(`/${slug}/wiki/pages/${targetPageId}`);
  }, [projectSlug, navigate]);

  const handleSelectFolder = useCallback((targetFolderId: string) => {
    const slug = projectSlug ?? "";
    navigate(`/${slug}/wiki/folders/${targetFolderId}`);
  }, [projectSlug, navigate]);

  const scheduleSave = useCallback((nextTitle: string, nextContent: string) => {
    if (!selectedId || loading) return; // 🌟 修正: 読み込み完了前は自動保存をガード
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await supabase!.from("wiki_pages").update({
        title: nextTitle, content: nextContent, updated_by: userName || null, updated_at: new Date().toISOString(),
      }).eq("id", selectedId);
      setPages(prev => prev.map(p => p.id === selectedId ? { ...p, title: nextTitle, content: nextContent } : p));
    }, 600);
  }, [selectedId, userName, loading]);

  const handleTreeItemRename = useCallback(async (id: string, nextTitle: string) => {
    setPages(prev => prev.map(p => p.id === id ? { ...p, title: nextTitle } : p));
    if (id === selectedId) {
      setTitle(nextTitle);
    }
    
    if (isSupabaseEnabled) {
      const { error } = await supabase!
        .from("wiki_pages")
        .update({ title: nextTitle, updated_by: userName || null, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) {
        console.error("[WikiPage] rename error:", error);
        toast("名前の変更に失敗しました", "error");
        load();
      } else {
        const { data: freshData } = await supabase!.from("wiki_pages").select("*").eq("project_id", project?.id).order("sort_order");
        if (freshData) {
          setPages(freshData.map(mapWikiPage));
        }
      }
    }
  }, [selectedId, userName, project?.id, load, toast]);

  const handleImagesChange = useCallback(async (next: string[]) => {
    if (!selectedId) return;
    setImages(next);
    setPages(prev => prev.map(p => p.id === selectedId ? { ...p, images: next } : p));
    if (isSupabaseEnabled) {
      await supabase!.from("wiki_pages").update({ images: next, updated_by: userName || null, updated_at: new Date().toISOString() }).eq("id", selectedId);
    }
  }, [selectedId, userName]);

  const handleMoveNode = useCallback(async (draggedId: string, targetParentId: string | null) => {
    if (draggedId === targetParentId) return;

    const checkCyclic = (parentId: string | null): boolean => {
      if (!parentId) return false;
      if (parentId === draggedId) return true;
      const p = pages.find(page => page.id === parentId);
      return p ? checkCyclic(p.parentId) : false;
    };
    if (checkCyclic(targetParentId)) {
      toast("フォルダを自身の子孫フォルダ配下に移動することはできません", "error");
      return;
    }

    const sortOrder = pages.filter(p => p.parentId === targetParentId).length;
    setPages(prev => prev.map(p => p.id === draggedId ? { ...p, parentId: targetParentId, sortOrder } : p));

    if (isSupabaseEnabled) {
      const { error } = await supabase!
        .from("wiki_pages")
        .update({ parent_id: targetParentId, sort_order: sortOrder, updated_by: userName || null, updated_at: new Date().toISOString() })
        .eq("id", draggedId);

      if (error) {
        console.error("[WikiPage] move node error:", error);
        toast("移動に失敗しました", "error");
        load();
      } else {
        toast("配置を変更しました");
        load();
      }
    }
  }, [pages, userName, load, toast]);

  const handleAddItem = async (parentId: string | null, isFolder: boolean) => {
    if (!project) return;
    const id = crypto.randomUUID();
    const { error } = await supabase!.from("wiki_pages").insert({
      id, project_id: project.id, parent_id: parentId,
      title: isFolder ? "無題のフォルダ" : "無題のページ",
      content: "", is_folder: isFolder,
      sort_order: pages.filter(p => p.parentId === parentId).length,
      created_by: userName || null, updated_by: userName || null,
    });
    if (error) {
      console.error("[WikiPage] insert error:", error);
      toast("作成に失敗しました", "error");
      return;
    }
    await load();
    if (!isFolder) handleSelectPage(id);
  };

  const handleDelete = async (page: WikiPageType) => {
    await supabase!.from("wiki_pages").delete().eq("id", page.id);
    if (selectedId === page.id) {
      setSelectedId(null);
      navigate(`/${projectSlug}/wiki`);
    }
    toast(`「${page.title || (page.isFolder ? "無題のフォルダ" : "無題のページ")}」を削除しました`);
    load();
  };

  const pageCount = useMemo(() => pages.filter(p => !p.isFolder).length, [pages]);

  if (!loading && (notFound || !project)) return <Navigate to="/projects" replace />;
  if (!loading && project && userRole !== "owner" && !(project.members ?? []).includes(userName)) return <Navigate to="/projects" replace />;
  if (!loading && effectiveWikiPerm === "none") return <Navigate to="/dashboard" replace />;

  return (
    <div style={{ padding: "24px 24px 0", minWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{project?.name ?? projectSlug ?? ""}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>Wiki</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{project ? `${project.name} · ${pageCount} ページ` : "..."}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {permsLoaded && effectiveWikiPerm === "view" && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", background: "#FEF3C7", color: "#92400E", borderRadius: 20, border: "1px solid rgba(217,119,6,0.25)" }}>閲覧のみ</span>
          )}
          <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="wiki" marginBottom={0} wikiPerm={effectiveWikiPerm} backlogPerm={effectiveBacklogPerm} minutesPerm={effectiveMinutesPerm} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, height: "calc(100vh - 175px)", overflow: "hidden" }}>
        <div
          onDragOver={(e) => { if (!canEdit || sidebarSearch) return; e.preventDefault(); setIsTreeDragOverRoot(true); }}
          onDragLeave={() => setIsTreeDragOverRoot(false)}
          onDrop={async (e) => {
            if (!canEdit || sidebarSearch) return;
            e.preventDefault();
            setIsTreeDragOverRoot(false);
            const draggedId = e.dataTransfer.getData("text/plain");
            if (draggedId) { await handleMoveNode(draggedId, null); }
          }}
          style={{
            width: 260, flexShrink: 0, background: "#FFFFFF", borderRadius: 14,
            border: isTreeDragOverRoot ? "1px dashed #059669" : "1px solid rgba(26,23,20,0.07)",
            padding: 10, overflowY: "auto", transition: "all 0.15s"
          }}
        >
          {/* 検索バー */}
          <div style={{ position: "relative", marginBottom: 8 }}>
            <Search style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 11, height: 11, color: sidebarSearch ? "#059669" : "#C9C4BB", pointerEvents: "none" }} />
            <input
              value={sidebarSearch}
              onChange={e => setSidebarSearch(e.target.value)}
              placeholder="検索..."
              style={{ width: "100%", boxSizing: "border-box", padding: "6px 26px 6px 26px", fontSize: 11, background: "#F4F5F6", border: `1px solid ${sidebarSearch ? "rgba(5,150,105,0.25)" : "transparent"}`, borderRadius: 7, outline: "none", fontFamily: "inherit" }}
            />
            {sidebarSearch && (
              <button onClick={() => setSidebarSearch("")} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 2, color: "#A09790", display: "flex", alignItems: "center" }}>
                <X style={{ width: 10, height: 10 }} />
              </button>
            )}
          </div>

          {canEdit && !sidebarSearch && (
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <button onClick={() => handleAddItem(null, false)}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 8px", background: "#ECFDF5", color: "#059669", border: "1.5px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                <Plus style={{ width: 12, height: 12 }} />新規ページ
              </button>
              <button onClick={() => handleAddItem(null, true)}
                title="新規フォルダ"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "7px 10px", background: "#FFFBEB", color: "#D97706", border: "1.5px solid #FDE68A", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                <FolderPlus style={{ width: 13, height: 13 }} />
              </button>
            </div>
          )}
          {sidebarSearch ? (
            (() => {
              const q = sidebarSearch.toLowerCase();
              const matched = pages.filter(p => !p.isFolder && (p.title.toLowerCase().includes(q) || (p.content ?? "").toLowerCase().includes(q)));
              if (matched.length === 0) return (
                <div style={{ padding: "24px 8px", textAlign: "center" }}>
                  <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>「{sidebarSearch}」に一致するページがありません</p>
                </div>
              );
              return (
                <div>
                  {matched.map(page => {
                    const parent = page.parentId ? pages.find(p => p.id === page.parentId) : null;
                    const isSelected = selectedId === page.id;
                    return (
                      <div key={page.id} onClick={() => handleSelectPage(page.id)}
                        style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "7px 8px", borderRadius: 7, cursor: "pointer", background: isSelected ? "#ECFDF5" : "transparent", marginBottom: 1 }}
                        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                        <FileText style={{ width: 12, height: 12, color: isSelected ? "#059669" : "#B0A9A4", flexShrink: 0, marginTop: 1 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: isSelected ? 700 : 500, color: isSelected ? "#059669" : "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{page.title || "無題のページ"}</div>
                          {parent && <div style={{ fontSize: 10, color: "#B0A9A4", marginTop: 1 }}>{parent.title || "無題のフォルダ"}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          ) : tree.length === 0 ? (
            <div style={{ padding: "24px 8px", textAlign: "center" }}>
              <BookOpen style={{ width: 24, height: 24, color: "#D4CEC8", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>ページがありません</p>
            </div>
          ) : tree.map(node => (
            <TreeItem key={node.id} node={node} depth={0} selectedId={selectedId}
              onSelectPage={handleSelectPage}
              onSelectFolder={handleSelectFolder}
              onAddChild={canEdit ? handleAddItem : () => {}}
              onDelete={canEdit ? setDeleteTarget : () => {}}
              onMoveNode={handleMoveNode}
              onOpenMoveModal={setMovingNodeTarget}
              onRename={handleTreeItemRename}
              canEdit={canEdit}
            />
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {loading ? (
            // 🌟 修正: 通信中に「ページを選択してください」等が一瞬表示されてステートが狂うのを防ぐローダー
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>読み込み中...</p>
            </div>
          ) : !selected ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <BookOpen style={{ width: 32, height: 32, color: "#D4CEC8", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>左のツリーからページを選択するか、新規ページを作成してください</p>
            </div>
          ) : selected.isFolder ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <FolderOpen style={{ width: 32, height: 32, color: "#FCD34D", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", margin: "0 0 6px" }}>{selected.title || "無題のフォルダ"}</p>
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>
                {pages.filter(p => p.parentId === selected.id).length} 件のアイテム
              </p>
            </div>
          ) : (
            <>
              <div style={{ padding: "20px 20px 12px", flexShrink: 0, borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#9E9690", marginBottom: 8, flexWrap: "wrap" }}>
                  <span onClick={() => { setSelectedId(null); navigate(`/${projectSlug ?? ""}/wiki`); }} style={{ color: "#059669", cursor: "pointer", fontWeight: 600 }}>Wikiホーム</span>
                  {ancestors.map(folder => (
                    <div key={folder.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span>&gt;</span>
                      <span onClick={() => handleSelectFolder(folder.id)} style={{ color: "#059669", cursor: "pointer", fontWeight: 600 }}>
                        {folder.title || "無題のフォルダ"}
                      </span>
                    </div>
                  ))}
                  <span>&gt;</span>
                  <span style={{ color: "#9E9690" }}>{selected.title || "無題のページ"}</span>
                </div>
                <input
                  value={title} disabled={!canEdit}
                  onChange={e => { setTitle(e.target.value); scheduleSave(e.target.value, content); }}
                  placeholder="ページタイトル"
                  style={{ width: "100%", boxSizing: "border-box", border: "none", outline: "none", fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", padding: 0 }} />
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "12px 20px 16px", display: "flex", flexDirection: "column" }}>
                <RichEditor value={content} readOnly={!canEdit}
                  onChange={v => { setContent(v); scheduleSave(title, v); }}
                  placeholder="ページの内容を入力..." minHeight={120}
                  style={{ flex: 1, minHeight: 0 }}
                  onBacklogClick={id => openPreview("backlog", id)}
                  onWikiClick={id => openPreview("wiki", id)}
                  onMinuteClick={id => openPreview("minute", id)}
                  onImageUpload={canEdit ? async (file) => {
                    if (plan.maxImagesPerItem !== null) {
                      const currentCount = (content.match(/<img/g) ?? []).length;
                      if (currentCount >= plan.maxImagesPerItem) { toast("現在のプランではこれ以上添付できません", "error"); return ""; }
                    }
                    if (!isSupabaseEnabled) return URL.createObjectURL(file);
                    const extMap: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
                    const ext = extMap[file.type] ?? "png";
                    const path = `wiki/${selected.id}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
                    const { data, error } = await supabase!.storage.from("ticket-images").upload(path, file, { upsert: true, contentType: file.type });
                    if (error || !data) return "";
                    return supabase!.storage.from("ticket-images").getPublicUrl(path).data.publicUrl;
                  } : undefined} />
              </div>
            </>
          )}
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.isFolder ? "フォルダの削除" : "ページの削除"}
          message={`「${deleteTarget.title || (deleteTarget.isFolder ? "無題のフォルダ" : "無題のページ")}」を削除します。${deleteTarget.isFolder ? "フォルダ内のページも一緒に削除されます。" : "子ページがある場合は一緒に削除されます。"}`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)} />
      )}

      {/* Googleドライブ風のフォルダ階層一覧選択移動モーダル */}
      {movingNodeTarget && (
        <GoogleDriveMoveModal
          node={movingNodeTarget}
          pages={pages}
          onClose={() => setMovingNodeTarget(null)}
          onConfirm={async (targetParentId) => {
            await handleMoveNode(movingNodeTarget.id, targetParentId);
            setMovingNodeTarget(null);
          }}
        />
      )}
    </div>
  );
}

function GoogleDriveMoveModal({
  node, pages, onClose, onConfirm
}: {
  node: WikiPageType; pages: WikiPageType[]; onClose: () => void; onConfirm: (targetParentId: string | null) => Promise<void>
}) {
  const foldersOnly = useMemo(() => pages.filter(p => p.isFolder && p.id !== node.id), [pages, node.id]);
  const folderTree = useMemo(() => buildTree(foldersOnly), [foldersOnly]);

  const [selectedParentId, setSelectedParentId] = useState<string | null>(node.parentId);

  const renderFolderOption = (folder: TreeNode, depth: number) => {
    const isChosen = selectedParentId === folder.id;
    return (
      <div key={folder.id}>
        <div
          onClick={() => setSelectedParentId(folder.id)}
          style={{
            display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px",
            paddingLeft: 12 + depth * 16, borderRadius: "8px", cursor: "pointer",
            background: isChosen ? "#ECFDF5" : "transparent",
            border: isChosen ? "1px solid #10B981" : "1px solid transparent",
            transition: "all 0.1s", marginBottom: "2px"
          }}
        >
          <Folder style={{ width: 14, height: 14, color: isChosen ? "#059669" : "#F59E0B" }} />
          <span style={{ fontSize: "12px", fontWeight: isChosen ? 700 : 500, color: isChosen ? "#059669" : "#1A1714" }}>
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
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "400px", background: "#FFFFFF", borderRadius: "14px", padding: "20px", zIndex: 401, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
        <div style={{ display: "flex", alignItems: "center", justifySelf: "space-between", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <FolderTree style={{ width: 16, height: 16, color: "#059669" }} />
            <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1A1714" }}>移動先フォルダーの選択</h3>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#B0A9A4" }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>
        <p style={{ fontSize: "11px", color: "#9E9690", marginBottom: "12px" }}>
          「{node.title || "無題"}」を配置する移動先フォルダーを選択してください。
        </p>

        <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: "10px", padding: "8px", maxHeight: "220px", overflowY: "auto", background: "#FAFAF8", marginBottom: "16px" }}>
          <div
            onClick={() => setSelectedParentId(null)}
            style={{
              display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "8px", cursor: "pointer",
              background: selectedParentId === null ? "#ECFDF5" : "transparent",
              border: selectedParentId === null ? "1px solid #10B981" : "1px solid transparent",
              transition: "all 0.1s", marginBottom: "4px"
            }}
          >
            <FolderTree style={{ width: 14, height: 14, color: selectedParentId === null ? "#059669" : "#B0A9A4" }} />
            <span style={{ fontSize: "12px", fontWeight: selectedParentId === null ? 700 : 500, color: selectedParentId === null ? "#059669" : "#1A1714" }}>
              / プロジェクトの最上位（ルート階層）
            </span>
          </div>

          <div style={{ height: "1px", background: "rgba(26,23,20,0.04)", margin: "4px 0" }} />

          {folderTree.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", fontSize: "11px", color: "#B0A9A4" }}>
              移動可能な他のフォルダがありません。
            </div>
          ) : (
            folderTree.map(f => renderFolderOption(f, 0))
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" onClick={onClose}
            style={{ padding: "8px 14px", fontSize: "12px", fontWeight: 600, color: "#6B6458", background: "#F4F5F6", border: "none", borderRadius: "8px", cursor: "pointer" }}>
            キャンセル
          </button>
          <button type="button" onClick={() => onConfirm(selectedParentId)}
            style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 600, color: "#FFFFFF", background: "#059669", border: "none", borderRadius: "8px", cursor: "pointer", boxShadow: "0 2px 4px rgba(5,150,105,0.2)" }}>
            この場所に移動
          </button>
        </div>
      </div>
    </>
  );
}