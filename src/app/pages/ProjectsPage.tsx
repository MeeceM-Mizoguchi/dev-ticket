import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router";
import { Search, Plus, FolderKanban, ChevronDown, X, Check } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { useOrg } from "@/app/contexts/OrgContext";
import { OrgSelector } from "@/app/components/shared/OrgSelector";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, CLIENTS } from "@/app/data/mock";
import { mapProject, mapClient, mapSprint } from "@/app/lib/mappers";
import { downloadProjectCsv } from "@/app/lib/csvExport";
import type { Project, Client } from "@/app/types";
import { ProjectCard } from "@/app/components/projects/ProjectCard";
import { NewProjectDialog } from "@/app/components/projects/NewProjectDialog";
import { EditProjectDialog } from "@/app/components/projects/EditProjectDialog";
import { CategorySettingsModal } from "@/app/components/projects/CategorySettingsModal";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { PageLoader } from "@/app/components/shared/PageLoader";

const CACHE_STATUS_KEY = "projects_page_status_filter";
const CACHE_TAGS_KEY = "projects_page_multiple_tags_filter";

export function ProjectsPage() {
  const { userRole, userName, userOrgId } = useAuth();
  const { toast } = useToast();
  const { selectedOrgId } = useOrg();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  
  // 更新維持用の各種フィルターステート
  const [statusFilter, setStatusFilter] = useState(() => localStorage.getItem(CACHE_STATUS_KEY) || "all");
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(CACHE_TAGS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [tagSearchQuery, setTagSearchQuery] = useState("");

  const [showDialog, setShowDialog] = useState(false);
  const [projects, setProjects] = useState<Project[]>(isSupabaseEnabled ? [] : PROJECTS);
  const [clients, setClients] = useState<Client[]>(isSupabaseEnabled ? [] : CLIENTS);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [categoryTarget, setCategoryTarget] = useState<Project | null>(null);
  const [tagsEditTarget, setProjectTagsEditTarget] = useState<Project | null>(null);

  const [loading, setLoading] = useState(isSupabaseEnabled);
  const isOwner = userRole === "owner";
  const canManage = isOwner || userRole === "admin" || userRole === "project-manager";

  useEffect(() => {
    localStorage.setItem(CACHE_STATUS_KEY, statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    localStorage.setItem(CACHE_TAGS_KEY, JSON.stringify(selectedTags));
  }, [selectedTags]);

  const injectLocalTags = (projectList: Project[]): Project[] => {
    try {
      const localTagsStore = localStorage.getItem("local_project_tags_map");
      if (!localTagsStore) return projectList;
      const tagMap = JSON.parse(localTagsStore);
      
      return projectList.map(p => {
        const projectTags = tagMap[p.id] || (p.slug ? tagMap[p.slug] : []) || [];
        return { ...p, tags: projectTags } as any;
      });
    } catch (e) {
      console.error("Failed to parse project tags from localStorage", e);
      return projectList;
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const computeTicketCounts = (sprints: any[]) => {
    const map = new Map<string, { done: number; inProgress: number; todo: number }>();
    for (const sprint of sprints) {
      const pid = sprint.project_id;
      if (!map.has(pid)) map.set(pid, { done: 0, inProgress: 0, todo: 0 });
      const counts = map.get(pid)!;
      for (const t of (sprint.sprint_tickets ?? [])) {
        if (t.status === "done" || t.status === "closed") counts.done++;
        else if (t.status === "todo") counts.todo++;
        else counts.inProgress++;
      }
    }
    return map;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mergeTicketCounts = (projectRows: any[], counts: Map<string, { done: number; inProgress: number; todo: number }>) =>
    projectRows.map(r => {
      const mapped = mapProject(r);
      const c = counts.get(r.id);
      if (c) { mapped.done = c.done; mapped.inProgress = c.inProgress; mapped.todo = c.todo; }
      return mapped;
    });

  const buildProjectQuery = () => {
    let q = supabase!.from("projects").select("*").order("id");
    if (isOwner) {
      if (selectedOrgId) q = q.eq("organization_id", selectedOrgId);
    } else if (userOrgId) {
      q = q.or(`organization_id.eq.${userOrgId},organization_id.is.null`);
    }
    return q;
  };

  const refreshProjects = () => {
    if (!isSupabaseEnabled) {
      setProjects(injectLocalTags(PROJECTS));
      return;
    }
    Promise.all([
      buildProjectQuery(),
      supabase!.from("sprints").select("project_id, sprint_tickets(status)").order("id"),
    ]).then(([{ data: p }, { data: s }]) => {
      if (p) {
        const merged = mergeTicketCounts(p, computeTicketCounts(s ?? []));
        setProjects(injectLocalTags(merged));
      }
    });
  };

  useEffect(() => {
    if (!isSupabaseEnabled) {
      setProjects(injectLocalTags(PROJECTS));
      return;
    }
    Promise.all([
      buildProjectQuery(),
      (() => {
        let q = supabase!.from("clients").select("*").order("id");
        if (isOwner) { if (selectedOrgId) q = q.eq("organization_id", selectedOrgId); }
        else if (userOrgId) q = (q as any).or(`organization_id.eq.${userOrgId},organization_id.is.null`);
        return q;
      })(),
      supabase!.from("sprints").select("project_id, sprint_tickets(status)").order("id"),
    ]).then(([{ data: p }, { data: c }, { data: s }]) => {
      if (p) {
        const merged = mergeTicketCounts(p, computeTicketCounts(s ?? []));
        setProjects(injectLocalTags(merged));
      }
      if (c) setClients(c.map(mapClient));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [isOwner, userOrgId, selectedOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menuOpen) return;
    const clickOutsideHandler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", clickOutsideHandler);
    return () => document.removeEventListener("mousedown", clickOutsideHandler);
  }, [menuOpen]);

  const handleDeleteProject = async (project: Project) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("projects").delete().eq("id", project.id);
      if (error) { toast("削除に失敗しました", "error"); throw error; }
    }
    setProjects(prev => prev.filter(p => p.id !== project.id));
    toast(`「${project.name}」を削除しました`);
  };

  const handleDownloadProject = async (project: Project) => {
    if (!isSupabaseEnabled) return;
    const [{ data: sprintData }, { data: categoryData }] = await Promise.all([
      supabase!.from("sprints").select("*, sprint_tickets(*)").eq("project_id", project.id).order("id"),
      supabase!.from("ticket_categories").select("id, name").eq("project_id", project.id),
    ]);
    const sprints = (sprintData ?? []).map(mapSprint);
    const categories = (categoryData ?? []) as Array<{ id: string; name: string }>;
    downloadProjectCsv(project.name, sprints, categories);
  };

  const visibleProjects = (isOwner || userRole === "admin")
    ? projects
    : projects.filter(p => p.members.includes(userName));

  // 動的タグ一覧の抽出
  const allUniqueTags = Array.from(
    new Set(visibleProjects.flatMap(p => (p as any).tags && Array.isArray((p as any).tags) ? (p as any).tags : []))
  ) as string[];

  const filteredTagsInMenu = allUniqueTags.filter(tag => tag.toLowerCase().includes(tagSearchQuery.toLowerCase()));

  const handleToggleTag = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const filtered = visibleProjects.filter(p => {
    const ms = p.name.includes(search) || p.client.includes(search) || p.id.includes(search);
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    const projectTags = (p as any).tags && Array.isArray((p as any).tags) ? (p as any).tags : [];
    const matchesTags = selectedTags.length === 0 || selectedTags.every(t => projectTags.includes(t));
    return ms && matchesStatus && matchesTags;
  });

  const statusOpts = [
    { value: "all", label: "すべて", count: visibleProjects.length },
    { value: "in-progress", label: "進行中", count: visibleProjects.filter(p => p.status === "in-progress").length },
    { value: "planning", label: "計画中", count: visibleProjects.filter(p => p.status === "planning").length },
    { value: "on-hold", label: "保留中", count: visibleProjects.filter(p => p.status === "on-hold").length },
    { value: "completed", label: "完了", count: visibleProjects.filter(p => p.status === "completed").length },
  ];

  const hasActiveTags = selectedTags.length > 0;

  return (
    <div style={{ padding: "24px", minWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>プロジェクト管理</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>進行中のプロジェクトとスプリント</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <OrgSelector />
          {canManage && (
            <button onClick={() => setShowDialog(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
              <Plus style={{ width: 15, height: 15 }} />新規プロジェクト
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "#B0A9A4" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="名前、クライアントで検索..."
            style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "8px 12px 8px 30px", fontSize: 12, color: "#1A1714", outline: "none", width: 240 }} />
        </div>
        
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {statusOpts.map(opt => (
            <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", fontSize: 12, fontWeight: 500, borderRadius: 8, border: "1px solid", cursor: "pointer", transition: "all 0.15s", background: statusFilter === opt.value ? "#059669" : "#FFFFFF", color: statusFilter === opt.value ? "#fff" : "#6B6458", borderColor: statusFilter === opt.value ? "#059669" : "rgba(26,23,20,0.10)" }}>
              {opt.label} <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", opacity: 0.7 }}>{opt.count}</span>
            </button>
          ))}

          {/* 複数タグ選択対応のマルチセレクトプルダウン */}
          <div ref={dropdownRef} style={{ position: "relative", marginLeft: 6 }}>
            <button type="button" onClick={() => { setMenuOpen(!menuOpen); setTagSearchQuery(""); }}
              style={{ 
                display: "flex", 
                alignItems: "center", 
                gap: 4, 
                padding: "6px 12px", 
                fontSize: 12, 
                fontWeight: 500, 
                borderRadius: 8, 
                border: "1px solid", 
                cursor: "pointer", 
                transition: "all 0.15s", 
                background: hasActiveTags ? "#059669" : "#FFFFFF", 
                color: hasActiveTags ? "#FFFFFF" : "#6B6458", 
                borderColor: hasActiveTags ? "#059669" : "rgba(26,23,20,0.10)" 
              }}>
              {selectedTags.length === 0 ? "すべてのタグ" : selectedTags.length === 1 ? `#${selectedTags[0]}` : `タグ: ${selectedTags.length}`}
              <ChevronDown style={{ width: 12, height: 12, opacity: 0.7, marginLeft: 2 }} />
            </button>

            {/* 🌟 修正: 影の階層、ボーダー、余白をスプリントページのフィルタポップアップ（リッチシャドウ仕様）と完璧に同一化 */}
            {menuOpen && (
              <div style={{ 
                position: "absolute", 
                top: "calc(100% + 4px)", 
                left: 0, 
                zIndex: 100, 
                background: "#FFFFFF", 
                borderRadius: 10, 
                // スプリントページやパネル等と共通の、柔らかく馴染むクリーンなシャドウ設計
                boxShadow: "0 4px 20px rgba(26,23,20,0.08), 0 2px 6px rgba(26,23,20,0.04)", 
                border: "1px solid rgba(26,23,20,0.06)", 
                padding: "5px", 
                minWidth: 200, 
                maxHeight: 280, 
                overflowY: "auto", 
                display: "flex", 
                flexDirection: "column", 
                gap: "2px" 
              }}>
                {/* 検索窓領域 */}
                <div style={{ position: "relative", marginBottom: "4px", padding: "2px" }} onClick={e => e.stopPropagation()}>
                  <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 11, height: 11, color: "#B0A9A4" }} />
                  <input value={tagSearchQuery} onChange={e => setTagSearchQuery(e.target.value)} placeholder="タグ名で絞り込み..."
                    style={{ width: "100%", background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.06)", borderRadius: 6, padding: "5px 8px 5px 24px", fontSize: 11, color: "#1A1714", outline: "none" }} />
                  {tagSearchQuery && <X onClick={() => setTagSearchQuery("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 11, height: 11, color: "#B0A9A4", cursor: "pointer" }} />}
                </div>

                {/* すべてのタグをクリア */}
                <button type="button" onClick={() => { setSelectedTags([]); setMenuOpen(false); }}
                  style={{ width: "100%", padding: "7px 10px", fontSize: 11, fontWeight: 500, textAlign: "left", border: "none", borderRadius: 6, cursor: "pointer", background: "transparent", color: "#A09790" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#F4F5F6"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  すべてのタグをクリア
                </button>

                <div style={{ height: "1px", background: "rgba(26,23,20,0.05)", margin: "2px 4px" }} />

                {/* 複数選択チェック付きタグ項目の一覧 */}
                {filteredTagsInMenu.length === 0 ? (
                  <div style={{ padding: "12px 10px", fontSize: 11, color: "#C9C4BB", textAlign: "center" }}>該当タグなし</div>
                ) : (
                  filteredTagsInMenu.map(tag => {
                    const isChecked = selectedTags.includes(tag);
                    return (
                      <div key={tag} onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleToggleTag(tag); }}
                        style={{ 
                          width: "100%", 
                          padding: "6px 10px", 
                          fontSize: 12, 
                          fontWeight: isChecked ? 600 : 500, 
                          borderRadius: 6, 
                          cursor: "pointer", 
                          background: isChecked ? "rgba(5,150,105,0.03)" : "transparent", 
                          color: isChecked ? "#1A1714" : "#6B6458", 
                          display: "flex", 
                          alignItems: "center", 
                          gap: "10px",
                          transition: "all 0.1s"
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = isChecked ? "rgba(5,150,105,0.06)" : "#F4F5F6"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = isChecked ? "rgba(5,150,105,0.03)" : "transparent"; }}>
                        <div style={{ 
                          width: "15px", 
                          height: "15px", 
                          borderRadius: "4px", 
                          border: isChecked ? "1px solid #059669" : "1px solid #C9C4BB", 
                          background: isChecked ? "#059669" : "#FFFFFF", 
                          display: "flex", 
                          alignItems: "center", 
                          justifyContent: "center", 
                          flexShrink: 0,
                          transition: "all 0.1s"
                        }}>
                          {isChecked && <Check style={{ width: 11, height: 11, color: "#FFFFFF", strokeWidth: 3 }} />}
                        </div>
                        <span style={{ fontSize: "12px", fontFamily: "var(--font-sans)", lineHeight: 1 }}>{tag}</span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{ width: 56, height: 56, background: "#F4F5F6", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <FolderKanban style={{ width: 24, height: 24, color: "#B0A9A4" }} />
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#3D3732" }}>プロジェクトが見つかりません</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {filtered.map(p => (
            <ProjectCard key={p.id} project={p}
              onNavigate={() => navigate(p.slug ? `/${p.slug}` : `/${p.id}`)}
              onEdit={canManage ? () => setEditTarget(p) : undefined}
              onDelete={canManage ? () => setDeleteTarget(p) : undefined}
              onCategorySettings={canManage ? () => setCategoryTarget(p) : undefined}
              onDownload={() => handleDownloadProject(p)}
              onEditTags={() => setProjectTagsEditTarget(p)}
            />
          ))}
        </div>
      )}

      {showDialog && <NewProjectDialog onClose={() => setShowDialog(false)} clients={clients} onCreated={refreshProjects} />}
      {editTarget && <EditProjectDialog project={editTarget} onClose={() => setEditTarget(null)} onUpdated={() => { refreshProjects(); setEditTarget(null); }} />}
      {deleteTarget && (
        <ConfirmDialog message={`「${deleteTarget.name}」を削除しますか？`} onConfirm={() => handleDeleteProject(deleteTarget)} onClose={() => setDeleteTarget(null)} />
      )}
      {categoryTarget && (
        <CategorySettingsModal projectId={categoryTarget.id} projectName={categoryTarget.name} onClose={() => setCategoryTarget(null)} />
      )}

      {/* タグ個別編集用モーダルダイアログ */}
      {tagsEditTarget && (
        <ProjectTagsEditDialog 
          project={tagsEditTarget} 
          onClose={() => setProjectTagsEditTarget(null)} 
          onUpdated={() => { refreshProjects(); setProjectTagsEditTarget(null); }} 
        />
      )}
    </div>
  );
}

function ProjectTagsEditDialog({ project, onClose, onUpdated }: { project: Project; onClose: () => void; onUpdated: () => void }) {
  const currentTags = (project as any).tags && Array.isArray((project as any).tags) ? (project as any).tags : [];
  const [tagsList, setTagsArray] = useState<string[]>(currentTags);
  const [inputTag, setInputTag] = useState("");

  const handleAddTag = () => {
    const trimmed = inputTag.trim();
    if (!trimmed) return;
    if (tagsList.includes(trimmed)) {
      setInputTag("");
      return;
    }
    setTagsArray([...tagsList, trimmed]);
    setInputTag("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTagsArray(tagsList.filter(t => t !== tagToRemove));
  };

  const handleSaveTags = () => {
    try {
      const storeStr = localStorage.getItem("local_project_tags_map") || "{}";
      const currentMap = JSON.parse(storeStr);
      
      currentMap[project.id] = tagsList;
      if (project.slug) {
        currentMap[project.slug] = tagsList;
      }

      localStorage.setItem("local_project_tags_map", JSON.stringify(currentMap));
      onUpdated();
    } catch (e) {
      console.error("Failed to save project tags to localStorage", e);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(10,14,12,0.30)", backdropFilter: "blur(2px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "440px", background: "#FFFFFF", borderRadius: "14px", padding: "22px", zIndex: 301, boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}>
        <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1A1714", marginBottom: "4px" }}>プロジェクトのタグ編集</h3>
        <p style={{ fontSize: "12px", color: "#A09790", marginBottom: "18px" }}>「{project.name}」の属性タグを設定します。</p>
        
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#6B6458", marginBottom: "6px" }}>新しいタグを追加</label>
          <div style={{ display: "flex", gap: "6px" }}>
            <input 
              type="text"
              value={inputTag}
              onChange={e => setInputTag(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(); } }}
              placeholder="例: 重要顧客"
              style={{ flex: 1, padding: "8px 12px", fontSize: "13px", color: "#1A1714", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.15)", borderRadius: "8px", outline: "none" }}
            />
            <button 
              type="button"
              onClick={handleAddTag}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", background: "#059669", color: "#FFFFFF", border: "none", borderRadius: "8px", cursor: "pointer", transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = "#047857"}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}
            >
              <Plus style={{ width: 18, height: 18 }} />
            </button>
          </div>
        </div>

        <div style={{ marginBottom: "22px" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#6B6458", marginBottom: "8px" }}>設定済みのタグ ({tagsList.length})</label>
          {tagsList.length === 0 ? (
            <div style={{ padding: "16px", background: "#FAFAF8", border: "1px dashed rgba(26,23,20,0.08)", borderRadius: "8px", textAlign: "center", fontSize: "11px", color: "#B0A9A4" }}>
              タグが設定されていません。上のフォームから追加してください。
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", background: "#FAFAF8", padding: "10px", borderRadius: "8px", border: "1px solid rgba(26,23,20,0.04)" }}>
              {tagsList.map(tag => (
                <span
                  key={tag}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "#F0F9FF",
                    color: "#0284C7",
                    border: "1px solid rgba(2, 132, 199, 0.15)",
                    borderRadius: "6px",
                    padding: "3px 6px 3px 8px",
                    fontSize: "11px",
                    fontWeight: 700
                  }}
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0284C7", opacity: 0.6, display: "flex", alignItems: "center" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "0.6"; }}
                  >
                    <X style={{ width: 12, height: 12 }} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid rgba(26,23,20,0.06)", paddingTop: "14px" }}>
          <button type="button" onClick={onClose}
            style={{ padding: "8px 14px", fontSize: "12px", fontWeight: 600, color: "#6B6458", background: "#F4F5F6", border: "none", borderRadius: "8px", cursor: "pointer" }}>
            キャンセル
          </button>
          <button type="button" onClick={handleSaveTags}
            style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 600, color: "#FFFFFF", background: "#059669", border: "none", borderRadius: "8px", cursor: "pointer", boxShadow: "0 2px 4px rgba(5,150,105,0.2)" }}>
            変更を保存
          </button>
        </div>
      </div>
    </>
  );
}