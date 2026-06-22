import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router";
import { FolderKanban, ChevronRight, ChevronDown, Plus, FileText, Trash2, BookOpen, Folder, FolderOpen, FolderPlus } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { usePreviewPanel } from "@/app/contexts/PreviewPanelContext";
import { mapProject, mapWikiPage } from "@/app/lib/mappers";
import type { Project, WikiPage as WikiPageType, AccessLevel, UserPermissions } from "@/app/types";

function titleToPathSegment(title: string): string {
  return encodeURIComponent(title || "無題のページ");
}
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { ImageAttachments } from "@/app/components/shared/ImageAttachments";

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
  node, depth, selectedId, onSelect, onAddChild, onDelete,
}: {
  node: TreeNode; depth: number; selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string, isFolder: boolean) => void;
  onDelete: (node: WikiPageType) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const hasChildren = node.children.length > 0;
  const isFolder = node.isFolder;
  const isSelected = selectedId === node.id;

  const handleRowClick = () => {
    if (isFolder) {
      setExpanded(v => !v);
    } else {
      onSelect(node.id);
    }
  };

  const FolderIcon = expanded ? FolderOpen : Folder;
  const ItemIcon = isFolder ? FolderIcon : FileText;
  const iconColor = isFolder ? "#F59E0B" : (isSelected ? "#059669" : "#B0A9A4");

  return (
    <div>
      <div
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onClick={handleRowClick}
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
        <span style={{
          flex: 1, minWidth: 0, fontSize: 12,
          fontWeight: isSelected ? 700 : 500,
          color: isSelected ? "#059669" : "#1A1714",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {node.title || (isFolder ? "無題のフォルダ" : "無題のページ")}
        </span>
        {hovered && (
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
            <button
              onClick={e => { e.stopPropagation(); onDelete(node); }}
              title="削除"
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9E9690", padding: 2, flexShrink: 0 }}>
              <Trash2 style={{ width: 12, height: 12 }} />
            </button>
          </>
        )}
      </div>
      {(isFolder || hasChildren) && expanded && node.children.map(c => (
        <TreeItem key={c.id} node={c} depth={depth + 1} selectedId={selectedId}
          onSelect={onSelect} onAddChild={onAddChild} onDelete={onDelete} />
      ))}
    </div>
  );
}

export function WikiPage() {
  const { projectSlug, "*": wikiPath } = useParams<{ projectSlug: string; "*"?: string }>();
  const navigate = useNavigate();
  const { userPermissions, userName, userRole, userId } = useAuth();
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
  const [effectiveWikiPerm, setEffectiveWikiPerm] = useState<AccessLevel>("none");
  const [effectiveBacklogPerm, setEffectiveBacklogPerm] = useState<AccessLevel>("none");
  const [effectiveMinutesPerm, setEffectiveMinutesPerm] = useState<AccessLevel>("none");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAdminRole = userRole === "owner" || userRole === "admin";
  const canEdit = effectiveWikiPerm === "edit";
  const { open: openPreview } = usePreviewPanel();

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    const { data: bySlug } = await supabase!.from("projects").select("*").eq("slug", projectSlug).limit(1);
    const p = bySlug?.[0] ?? (await supabase!.from("projects").select("*").eq("id", projectSlug).maybeSingle()).data;
    if (!p) { setNotFound(true); setLoading(false); return; }
    setProject(mapProject(p));
    const [{ data }, permResult] = await Promise.all([
      supabase!.from("wiki_pages").select("*").eq("project_id", p.id).order("sort_order"),
      isAdminRole ? Promise.resolve({ data: null }) :
        supabase!.from("project_member_permissions").select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle(),
    ]);
    setPages((data ?? []).map(mapWikiPage));

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
    setLoading(false);
  }, [projectSlug, userId, isAdminRole]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const tree = useMemo(() => buildTree(pages), [pages]);
  const selected = useMemo(() => pages.find(p => p.id === selectedId) ?? null, [pages, selectedId]);

  // URLパスからページを選択 (/:projectSlug/wiki/フォルダ名/ページ名 or /:projectSlug/wiki/ページ名)
  useEffect(() => {
    if (!wikiPath || pages.length === 0) return;
    const parts = wikiPath.split("/").map(s => decodeURIComponent(s)).filter(Boolean);
    if (parts.length === 0) return;
    let found: WikiPageType | undefined;
    if (parts.length === 1) {
      found = pages.find(p => !p.isFolder && p.title === parts[0] && !p.parentId);
      if (!found) found = pages.find(p => !p.isFolder && p.title === parts[0]);
    } else {
      const folderTitle = parts[parts.length - 2];
      const pageTitle = parts[parts.length - 1];
      const folder = pages.find(p => p.isFolder && p.title === folderTitle);
      if (folder) found = pages.find(p => !p.isFolder && p.title === pageTitle && p.parentId === folder.id);
      if (!found) found = pages.find(p => !p.isFolder && p.title === pageTitle);
    }
    if (found && found.id !== selectedId) setSelectedId(found.id);
  }, [wikiPath, pages]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectPage = useCallback((pageId: string) => {
    const page = pages.find(p => p.id === pageId);
    if (!page || page.isFolder) return;
    const parent = page.parentId ? pages.find(p => p.id === page.parentId) : null;
    const slug = projectSlug ?? "";
    const path = parent
      ? `/${slug}/wiki/${titleToPathSegment(parent.title)}/${titleToPathSegment(page.title)}`
      : `/${slug}/wiki/${titleToPathSegment(page.title)}`;
    navigate(path);
  }, [pages, projectSlug, navigate]);

  useEffect(() => {
    setTitle(selected?.title ?? "");
    setContent(selected?.content ?? "");
    setImages(selected?.images ?? []);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = useCallback((nextTitle: string, nextContent: string) => {
    if (!selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await supabase!.from("wiki_pages").update({
        title: nextTitle, content: nextContent, updated_by: userName || null, updated_at: new Date().toISOString(),
      }).eq("id", selectedId);
      setPages(prev => prev.map(p => p.id === selectedId ? { ...p, title: nextTitle, content: nextContent } : p));
    }, 600);
  }, [selectedId, userName]);

  const handleImagesChange = useCallback(async (next: string[]) => {
    if (!selectedId) return;
    setImages(next);
    setPages(prev => prev.map(p => p.id === selectedId ? { ...p, images: next } : p));
    if (isSupabaseEnabled) {
      await supabase!.from("wiki_pages").update({ images: next, updated_by: userName || null, updated_at: new Date().toISOString() }).eq("id", selectedId);
    }
  }, [selectedId, userName]);

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
      const msg = error.message?.includes("column") || error.code === "42703"
        ? "DBにis_folderカラムが存在しません。supabase/add_wiki_folder.sql を Supabase Dashboard で実行してください。"
        : (isFolder ? "フォルダの作成に失敗しました" : "ページの作成に失敗しました");
      toast(msg, "error");
      return;
    }
    await load();
    if (!isFolder) setSelectedId(id);
  };

  const handleDelete = async (page: WikiPageType) => {
    await supabase!.from("wiki_pages").delete().eq("id", page.id);
    if (selectedId === page.id) setSelectedId(null);
    toast(`「${page.title || (page.isFolder ? "無題のフォルダ" : "無題のページ")}」を削除しました`);
    load();
  };

  const pageCount = useMemo(() => pages.filter(p => !p.isFolder).length, [pages]);

  if (!loading && (notFound || !project)) return <Navigate to="/projects" replace />;
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
          {effectiveWikiPerm === "view" && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", background: "#FEF3C7", color: "#92400E", borderRadius: 20, border: "1px solid rgba(217,119,6,0.25)" }}>閲覧のみ</span>
          )}
          <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="wiki" marginBottom={0} wikiPerm={effectiveWikiPerm} backlogPerm={effectiveBacklogPerm} minutesPerm={effectiveMinutesPerm} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, height: "calc(100vh - 175px)", overflow: "hidden" }}>
        <div style={{ width: 260, flexShrink: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", padding: 10, overflowY: "auto" }}>
          {canEdit && (
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
          {tree.length === 0 ? (
            <div style={{ padding: "24px 8px", textAlign: "center" }}>
              <BookOpen style={{ width: 24, height: 24, color: "#D4CEC8", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>ページがありません</p>
            </div>
          ) : tree.map(node => (
            <TreeItem key={node.id} node={node} depth={0} selectedId={selectedId}
              onSelect={handleSelectPage}
              onAddChild={canEdit ? handleAddItem : () => {}}
              onDelete={canEdit ? setDeleteTarget : () => {}} />
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {!selected ? (
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
    </div>
  );
}
