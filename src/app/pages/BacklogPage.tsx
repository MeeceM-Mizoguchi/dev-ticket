import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, Navigate } from "react-router";
import { FolderKanban, ChevronRight, Plus, GripVertical, GitBranch, ClipboardList, Trash2 } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { mapProject, mapBacklogItem, mapTicketCategory } from "@/app/lib/mappers";
import type { Project, BacklogItem, BacklogStatus, Priority, Sprint, TicketCategory } from "@/app/types";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { BtnSpinner } from "@/app/components/shared/PageLoader";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { RichEditor } from "@/app/components/shared/RichEditor";

const PRIORITY_META: Record<Priority, { label: string; color: string; bg: string }> = {
  high: { label: "高", color: "#DC2626", bg: "#FEF2F2" },
  medium: { label: "中", color: "#D97706", bg: "#FFF7ED" },
  low: { label: "低", color: "#0284C7", bg: "#F0F9FF" },
};

const STATUS_META: Record<BacklogStatus, { label: string; color: string; bg: string }> = {
  open: { label: "未対応", color: "#6B7280", bg: "#F3F4F6" },
  "in-progress": { label: "対応中", color: "#D97706", bg: "#FFF7ED" },
  converted: { label: "チケット化済", color: "#059669", bg: "#ECFDF5" },
  archived: { label: "アーカイブ", color: "#9CA3AF", bg: "#F4F5F6" },
};

async function nextBacklogId(): Promise<string> {
  const { data } = await supabase!
    .from("backlog_items").select("id")
    .like("id", "B-%")
    .order("id", { ascending: false }).limit(1).maybeSingle();
  const next = (parseInt(data?.id?.slice(2) ?? "0", 10) || 0) + 1;
  return `B-${String(next).padStart(3, "0")}`;
}

// ─── チケット化モーダル ─────────────────────────────────────
function ConvertToTicketModal({
  item, project, sprints, onClose, onConverted,
}: {
  item: BacklogItem;
  project: Project;
  sprints: Sprint[];
  onClose: () => void;
  onConverted: () => void;
}) {
  const [sprintId, setSprintId] = useState(sprints[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const { userName } = useAuth();
  const { toast } = useToast();

  const handleConvert = async () => {
    if (!sprintId) { toast("スプリントを選択してください", "error"); return; }
    setSaving(true);
    try {
      const sprint = sprints.find(s => s.id === sprintId);
      const prefix = sprint?.identifier || project.wbsPrefix || "T";
      const { data: maxRow } = await supabase!
        .from("sprint_tickets").select("wbs").in("sprint_id", sprints.map(s => s.id))
        .like("wbs", `${prefix}-%`).order("wbs", { ascending: false }).limit(1).maybeSingle();
      const nextNum = (parseInt(maxRow?.wbs?.slice(prefix.length + 1) ?? "0", 10) || 0) + 1;
      const wbs = `${prefix}-${String(nextNum).padStart(3, "0")}`;
      const ticketId = `T-${Date.now()}`;

      const { error: insErr } = await supabase!.from("sprint_tickets").insert({
        id: ticketId, sprint_id: sprintId, wbs, title: item.title, status: "todo",
        priority: item.priority, assignee: item.assignee || "", estimated_hours: item.estimatedHours || 0,
        progress: 0, description: item.description || "", created_by: userName || null,
      });
      if (insErr) { toast("チケット作成に失敗しました", "error"); setSaving(false); return; }

      await supabase!.from("backlog_items").update({
        status: "converted", converted_ticket_id: ticketId, updated_at: new Date().toISOString(),
      }).eq("id", item.id);

      toast(`${wbs} としてチケットを作成しました`);
      onConverted();
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell title={`${item.id} をチケット化`} onClose={onClose} size="sm"
      footer={<>
        <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
        <button type="button" onClick={handleConvert} disabled={saving}
          style={{ padding: "9px 20px", background: saving ? "#9CA3AF" : "#059669", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          {saving && <BtnSpinner />}{saving ? "作成中..." : "チケットを作成"}
        </button>
      </>}>
      <p style={{ fontSize: 13, color: "#1A1714", margin: 0 }}>{item.title}</p>
      <div>
        <label style={{ fontSize: 11, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 5 }}>追加先スプリント</label>
        <CustomSelect value={sprintId} onChange={setSprintId}
          options={sprints.map(s => ({ value: s.id, label: s.name }))} placeholder="スプリントを選択" />
      </div>
    </DialogShell>
  );
}

// ─── 左サイドバー アイテム行 ─────────────────────────────────
function BacklogSidebarItem({
  item, isSelected, canEdit, isDone, isDragOver,
  onSelect, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  item: BacklogItem; isSelected: boolean;
  canEdit: boolean; isDone: boolean; isDragOver?: boolean;
  onSelect: () => void;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const pMeta = PRIORITY_META[item.priority];
  const sMeta = STATUS_META[item.status];

  return (
    <div
      draggable={canEdit && !isDone}
      onDragStart={e => { e.dataTransfer.effectAllowed = "move"; onDragStart?.(); }}
      onDragOver={e => { e.preventDefault(); onDragOver?.(); }}
      onDrop={e => { e.preventDefault(); onDrop?.(); }}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "flex-start", gap: 4, padding: "8px 10px 8px 4px", borderRadius: 8, cursor: "pointer",
        background: isSelected ? "#ECFDF5" : hovered ? "#F4F5F6" : "transparent",
        opacity: isDone ? 0.65 : 1, marginBottom: 2,
        outline: isDragOver ? "2px solid #059669" : "none",
        outlineOffset: -1,
      }}>
      {canEdit && !isDone ? (
        <div style={{ color: hovered || isSelected ? "#B0A9A4" : "#DEDAD5", cursor: "grab", flexShrink: 0, paddingTop: 3, display: "flex" }}>
          <GripVertical style={{ width: 13, height: 13 }} />
        </div>
      ) : (
        <div style={{ width: 13, flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)", background: isSelected ? "#A7F3D0" : "#EDE9FE", color: isSelected ? "#065F46" : "#6D28D9", padding: "1px 5px", borderRadius: 4, flexShrink: 0 }}>{item.id}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: isSelected ? 700 : 500, color: isSelected ? "#059669" : "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title || "無題"}</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: pMeta.bg, color: pMeta.color }}>{pMeta.label}</span>
          <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: sMeta.bg, color: sMeta.color }}>{sMeta.label}</span>
        </div>
      </div>
    </div>
  );
}

// ─── メインページ ─────────────────────────────────────────
export function BacklogPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { userPermissions, userName } = useAuth();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BacklogItem | null>(null);
  const [convertTarget, setConvertTarget] = useState<BacklogItem | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // 右パネル編集ステート
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<Priority>("medium");
  const [editStatus, setEditStatus] = useState<BacklogStatus>("open");
  const [editAssignee, setEditAssignee] = useState("");
  const [editHours, setEditHours] = useState(0);
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEdit = userPermissions.canEditDelete;
  const canCreate = userPermissions.canCreateTicket;

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    const { data: bySlug } = await supabase!.from("projects").select("*").eq("slug", projectSlug).limit(1);
    const p = bySlug?.[0] ?? (await supabase!.from("projects").select("*").eq("id", projectSlug).maybeSingle()).data;
    if (!p) { setNotFound(true); setLoading(false); return; }
    setProject(mapProject(p));

    const [{ data: itemRows }, { data: sprintRows }, { data: catRows }] = await Promise.all([
      supabase!.from("backlog_items").select("*").eq("project_id", p.id).order("rank"),
      supabase!.from("sprints").select("id, project_id, name, goal, status, start_date, end_date, identifier").eq("project_id", p.id),
      supabase!.from("ticket_categories").select("*").eq("project_id", p.id).order("name"),
    ]);
    setItems((itemRows ?? []).map(mapBacklogItem));
    setSprints((sprintRows ?? []).map((s: any) => ({ id: s.id, projectId: s.project_id, name: s.name, goal: s.goal || "", status: s.status, startDate: s.start_date, endDate: s.end_date, identifier: s.identifier || "", tickets: [] })));
    setCategories((catRows ?? []).map(mapTicketCategory));
    setLoading(false);
  }, [projectSlug]);

  useEffect(() => { load(); }, [load]);

  // URLパラメータからアイテム選択
  useEffect(() => {
    const itemParam = searchParams.get("item");
    if (itemParam && items.length > 0) {
      const found = items.find(i => i.id === itemParam);
      if (found) setSelectedId(found.id);
    }
  }, [searchParams, items]);

  const selectedItem = useMemo(() => items.find(i => i.id === selectedId) ?? null, [items, selectedId]);

  // 選択アイテムが変わったら編集ステートを同期
  useEffect(() => {
    setEditTitle(selectedItem?.title ?? "");
    setEditDescription(selectedItem?.description ?? "");
    setEditPriority(selectedItem?.priority ?? "medium");
    setEditStatus(selectedItem?.status ?? "open");
    setEditAssignee(selectedItem?.assignee ?? "");
    setEditHours(selectedItem?.estimatedHours ?? 0);
    setEditCategoryId(selectedItem?.categoryId ?? null);
  }, [selectedItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = useCallback((patch: {
    title?: string; description?: string; priority?: Priority;
    status?: BacklogStatus; assignee?: string; estimatedHours?: number; categoryId?: string | null;
  }) => {
    if (!selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.title !== undefined) updateData.title = patch.title;
      if (patch.description !== undefined) updateData.description = patch.description;
      if (patch.priority !== undefined) updateData.priority = patch.priority;
      if (patch.status !== undefined) updateData.status = patch.status;
      if (patch.assignee !== undefined) updateData.assignee = patch.assignee;
      if (patch.estimatedHours !== undefined) updateData.estimated_hours = patch.estimatedHours;
      if ("categoryId" in patch) updateData.category_id = patch.categoryId ?? null;
      await supabase!.from("backlog_items").update(updateData).eq("id", selectedId);
      setItems(prev => prev.map(i => i.id === selectedId ? { ...i, ...patch } : i));
    }, 600);
  }, [selectedId]);

  const grouped = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.rank - b.rank);
    const active = sorted.filter(i => i.status === "open" || i.status === "in-progress");
    const done = sorted.filter(i => i.status === "converted" || i.status === "archived");
    return { active, done };
  }, [items]);

  const handleAddItem = async () => {
    if (!project) return;
    const id = await nextBacklogId();
    const { error } = await supabase!.from("backlog_items").insert({
      id, project_id: project.id, title: "新規バックログ項目", description: "", priority: "medium",
      assignee: "", estimated_hours: 0, status: "open", rank: Date.now(), created_by: userName || null,
    });
    if (error) { toast("作成に失敗しました", "error"); return; }
    await load();
    setSelectedId(id);
  };

  const reorderItems = useCallback(async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const active = grouped.active;
    const fromIdx = active.findIndex(i => i.id === fromId);
    const toIdx = active.findIndex(i => i.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...active];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const newRanks = reordered.map((item, idx) => ({ id: item.id, rank: (idx + 1) * 1000 }));
    setItems(prev => prev.map(i => {
      const r = newRanks.find(u => u.id === i.id);
      return r ? { ...i, rank: r.rank } : i;
    }));
    await Promise.all(newRanks.map(({ id, rank }) =>
      supabase!.from("backlog_items").update({ rank }).eq("id", id)
    ));
  }, [grouped.active]);

  const handleDelete = async (item: BacklogItem) => {
    await supabase!.from("backlog_items").delete().eq("id", item.id);
    setItems(prev => prev.filter(i => i.id !== item.id));
    if (selectedId === item.id) setSelectedId(null);
    toast(`${item.id} を削除しました`);
  };

  if (!loading && (notFound || !project)) return <Navigate to="/projects" replace />;
  if (!loading && !userPermissions.canAccessBacklog) return <Navigate to="/dashboard" replace />;

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
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>バックログ</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{project ? `${project.name} · ${items.length} 件` : "..."}</p>
        </div>
        <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="backlog" marginBottom={0} />
      </div>

      <div style={{ display: "flex", gap: 16, height: "calc(100vh - 175px)", overflow: "hidden" }}>
        {/* ─── 左サイドバー ─── */}
        <div style={{ width: 260, flexShrink: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", padding: 10, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {canCreate && (
            <button onClick={handleAddItem}
              style={{ display: "flex", alignItems: "center", gap: 5, width: "100%", padding: "7px 10px", marginBottom: 8, background: "#ECFDF5", color: "#059669", border: "1.5px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <Plus style={{ width: 12, height: 12 }} />新規追加
            </button>
          )}

          {grouped.active.length === 0 && grouped.done.length === 0 ? (
            <div style={{ padding: "24px 8px", textAlign: "center" }}>
              <ClipboardList style={{ width: 24, height: 24, color: "#D4CEC8", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>バックログ項目がありません</p>
            </div>
          ) : (
            <>
              {grouped.active.map((item) => (
                <BacklogSidebarItem key={item.id} item={item}
                  isSelected={selectedId === item.id}
                  canEdit={canEdit} isDone={false}
                  isDragOver={dragOverId === item.id && dragId !== item.id}
                  onSelect={() => setSelectedId(item.id)}
                  onDragStart={() => setDragId(item.id)}
                  onDragOver={() => { if (dragId && dragId !== item.id) setDragOverId(item.id); }}
                  onDrop={() => { if (dragId) reorderItems(dragId, item.id); }}
                  onDragEnd={() => { setDragId(null); setDragOverId(null); }} />
              ))}
              {grouped.done.length > 0 && (
                <>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "#C9C4BB", padding: "8px 4px 4px", margin: 0 }}>完了・アーカイブ ({grouped.done.length})</p>
                  {grouped.done.map((item) => (
                    <BacklogSidebarItem key={item.id} item={item}
                      isSelected={selectedId === item.id}
                      canEdit={false} isDone
                      onSelect={() => setSelectedId(item.id)} />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* ─── 右パネル ─── */}
        <div style={{ flex: 1, minWidth: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", padding: 20, overflowY: "auto" }}>
          {!selectedItem ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <ClipboardList style={{ width: 32, height: 32, color: "#D4CEC8", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>左の一覧から項目を選択するか、新規追加してください</p>
            </div>
          ) : (
            <>
              {/* タイトル + アクションボタン */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
                <input
                  value={editTitle}
                  disabled={!canEdit}
                  onChange={e => { setEditTitle(e.target.value); scheduleSave({ title: e.target.value }); }}
                  placeholder="バックログ項目のタイトル"
                  style={{ flex: 1, boxSizing: "border-box", border: "none", outline: "none", fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", padding: 0 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  {canCreate && selectedItem.status !== "converted" && (
                    <button onClick={() => setConvertTarget(selectedItem)} title="チケット化"
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#EDE9FE", color: "#6D28D9", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      <GitBranch style={{ width: 12, height: 12 }} />チケット化
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => setDeleteTarget(selectedItem)} title="削除"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 4 }}>
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  )}
                </div>
              </div>

              {/* フィールド行 */}
              <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <div style={{ minWidth: 140, pointerEvents: canEdit ? "auto" : "none", opacity: canEdit ? 1 : 0.6 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>分類</label>
                  <CustomSelect
                    value={editCategoryId ?? ""}
                    onChange={v => { setEditCategoryId(v || null); scheduleSave({ categoryId: v || null }); }}
                    options={[{ value: "", label: "分類なし" }, ...categories.map(c => ({ value: c.id, label: c.name }))]}
                    placeholder="分類なし" />
                </div>
                <div style={{ width: 100, pointerEvents: canEdit ? "auto" : "none", opacity: canEdit ? 1 : 0.6 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>優先度</label>
                  <CustomSelect
                    value={editPriority}
                    onChange={v => { setEditPriority(v as Priority); scheduleSave({ priority: v as Priority }); }}
                    options={[
                      { value: "high", label: "高", color: PRIORITY_META.high.color },
                      { value: "medium", label: "中", color: PRIORITY_META.medium.color },
                      { value: "low", label: "低", color: PRIORITY_META.low.color },
                    ]} />
                </div>
                <div style={{ width: 120, pointerEvents: canEdit ? "auto" : "none", opacity: canEdit ? 1 : 0.6 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>状態</label>
                  <CustomSelect
                    value={editStatus}
                    onChange={v => { setEditStatus(v as BacklogStatus); scheduleSave({ status: v as BacklogStatus }); }}
                    options={[
                      { value: "open", label: "未対応", color: STATUS_META.open.color },
                      { value: "in-progress", label: "対応中", color: STATUS_META["in-progress"].color },
                      { value: "converted", label: "チケット化済", color: STATUS_META.converted.color },
                      { value: "archived", label: "アーカイブ", color: STATUS_META.archived.color },
                    ]} />
                </div>
                <div style={{ minWidth: 120, pointerEvents: canEdit ? "auto" : "none", opacity: canEdit ? 1 : 0.6 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>担当者</label>
                  <CustomSelect
                    value={editAssignee}
                    onChange={v => { setEditAssignee(v); scheduleSave({ assignee: v }); }}
                    options={(project?.members ?? []).map(m => ({ value: m, label: m }))}
                    placeholder="未割当" />
                </div>
                <div style={{ width: 90 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>見積(h)</label>
                  <input
                    type="number" min={0} value={editHours} disabled={!canEdit}
                    onChange={e => { const v = Number(e.target.value); setEditHours(v); scheduleSave({ estimatedHours: v }); }}
                    style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12, border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 9, outline: "none", fontFamily: "inherit" }} />
                </div>
              </div>

              {/* 詳細エディター */}
              <RichEditor
                value={editDescription}
                readOnly={!canEdit}
                onChange={v => { setEditDescription(v); scheduleSave({ description: v }); }}
                placeholder="背景や要件を入力..."
                members={project?.members ?? []}
                minHeight="calc(100vh - 366px)" />
            </>
          )}
        </div>
      </div>

      {convertTarget && project && (
        <ConvertToTicketModal item={convertTarget} project={project} sprints={sprints}
          onClose={() => setConvertTarget(null)}
          onConverted={() => { setConvertTarget(null); load(); }} />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="バックログ項目の削除"
          message={`${deleteTarget.id}「${deleteTarget.title}」を削除します。`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
