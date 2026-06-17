import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router";
import { FolderKanban, ChevronRight, ChevronDown, Plus, FileText, Trash2, BookOpen } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { mapProject, mapWikiPage } from "@/app/lib/mappers";
import type { Project, WikiPage as WikiPageType } from "@/app/types";
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
  node, depth, selectedId, onSelect, onAddChild, onDelete,
}: {
  node: TreeNode; depth: number; selectedId: string | null;
  onSelect: (id: string) => void; onAddChild: (parentId: string) => void; onDelete: (node: WikiPageType) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onClick={() => onSelect(node.id)}
        style={{
          display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", paddingLeft: 8 + depth * 16,
          borderRadius: 7, cursor: "pointer", background: selectedId === node.id ? "#ECFDF5" : (hovered ? "#F4F5F6" : "transparent"),
        }}>
        <span onClick={e => { e.stopPropagation(); if (hasChildren) setExpanded(v => !v); }} style={{ width: 14, flexShrink: 0, display: "flex" }}>
          {hasChildren && (expanded ? <ChevronDown style={{ width: 11, height: 11, color: "#9E9690" }} /> : <ChevronRight style={{ width: 11, height: 11, color: "#9E9690" }} />)}
        </span>
        <FileText style={{ width: 12, height: 12, color: selectedId === node.id ? "#059669" : "#B0A9A4", flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: selectedId === node.id ? 700 : 500, color: selectedId === node.id ? "#059669" : "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.title || "無題のページ"}
        </span>
        {hovered && (
          <>
            <button onClick={e => { e.stopPropagation(); onAddChild(node.id); }} title="サブページを追加" style={{ background: "none", border: "none", cursor: "pointer", color: "#9E9690", padding: 2, flexShrink: 0 }}>
              <Plus style={{ width: 12, height: 12 }} />
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(node); }} title="削除" style={{ background: "none", border: "none", cursor: "pointer", color: "#9E9690", padding: 2, flexShrink: 0 }}>
              <Trash2 style={{ width: 12, height: 12 }} />
            </button>
          </>
        )}
      </div>
      {hasChildren && expanded && node.children.map(c => (
        <TreeItem key={c.id} node={c} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} onAddChild={onAddChild} onDelete={onDelete} />
      ))}
    </div>
  );
}

export function WikiPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const { userPermissions, userName } = useAuth();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [pages, setPages] = useState<WikiPageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WikiPageType | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEdit = userPermissions.canEditDelete;

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    const { data: bySlug } = await supabase!.from("projects").select("*").eq("slug", projectSlug).limit(1);
    const p = bySlug?.[0] ?? (await supabase!.from("projects").select("*").eq("id", projectSlug).maybeSingle()).data;
    if (!p) { setNotFound(true); setLoading(false); return; }
    setProject(mapProject(p));
    const { data } = await supabase!.from("wiki_pages").select("*").eq("project_id", p.id).order("sort_order");
    setPages((data ?? []).map(mapWikiPage));
    setLoading(false);
  }, [projectSlug]);

  useEffect(() => { load(); }, [load]);

  const tree = useMemo(() => buildTree(pages), [pages]);
  const selected = useMemo(() => pages.find(p => p.id === selectedId) ?? null, [pages, selectedId]);

  useEffect(() => {
    setTitle(selected?.title ?? "");
    setContent(selected?.content ?? "");
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

  const handleAddPage = async (parentId: string | null) => {
    if (!project) return;
    const id = crypto.randomUUID();
    const { error } = await supabase!.from("wiki_pages").insert({
      id, project_id: project.id, parent_id: parentId, title: "無題のページ", content: "",
      sort_order: pages.filter(p => p.parentId === parentId).length, created_by: userName || null, updated_by: userName || null,
    });
    if (error) { toast("ページの作成に失敗しました", "error"); return; }
    await load();
    setSelectedId(id);
  };

  const handleDelete = async (page: WikiPageType) => {
    await supabase!.from("wiki_pages").delete().eq("id", page.id);
    if (selectedId === page.id) setSelectedId(null);
    toast(`「${page.title || "無題のページ"}」を削除しました`);
    load();
  };

  if (!loading && (notFound || !project)) return <Navigate to="/projects" replace />;
  if (!loading && !userPermissions.canAccessWiki) return <Navigate to="/dashboard" replace />;

  return (
    <div style={{ padding: "24px 24px 0" }}>
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
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{project ? `${project.name} · ${pages.length} ページ` : "..."}</p>
        </div>
        <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="wiki" marginBottom={0} />
      </div>

      <div style={{ display: "flex", gap: 16, height: "calc(100vh - 175px)", overflow: "hidden" }}>
        <div style={{ width: 260, flexShrink: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", padding: 10, overflowY: "auto" }}>
          {canEdit && (
            <button onClick={() => handleAddPage(null)}
              style={{ display: "flex", alignItems: "center", gap: 5, width: "100%", padding: "7px 10px", marginBottom: 6, background: "#ECFDF5", color: "#059669", border: "1.5px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <Plus style={{ width: 12, height: 12 }} />新規ページ
            </button>
          )}
          {tree.length === 0 ? (
            <div style={{ padding: "24px 8px", textAlign: "center" }}>
              <BookOpen style={{ width: 24, height: 24, color: "#D4CEC8", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>ページがありません</p>
            </div>
          ) : tree.map(node => (
            <TreeItem key={node.id} node={node} depth={0} selectedId={selectedId}
              onSelect={setSelectedId} onAddChild={canEdit ? handleAddPage : () => {}} onDelete={canEdit ? setDeleteTarget : () => {}} />
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", padding: 20, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {!selected ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <BookOpen style={{ width: 32, height: 32, color: "#D4CEC8", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>左のツリーからページを選択するか、新規ページを作成してください</p>
            </div>
          ) : (
            <>
              <input
                value={title} disabled={!canEdit}
                onChange={e => { setTitle(e.target.value); scheduleSave(e.target.value, content); }}
                placeholder="ページタイトル"
                style={{ width: "100%", boxSizing: "border-box", border: "none", outline: "none", fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", marginBottom: 14, padding: 0, flexShrink: 0 }} />
              <RichEditor value={content} readOnly={!canEdit}
                onChange={v => { setContent(v); scheduleSave(title, v); }}
                placeholder="ページの内容を入力..." minHeight="calc(100vh - 302px)" />
            </>
          )}
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="ページの削除"
          message={`「${deleteTarget.title || "無題のページ"}」を削除します。子ページがある場合は一緒に削除されます。`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
