import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router";
import { FolderKanban, ChevronRight, Plus, GripVertical, GitBranch, ClipboardList, Trash2, Ticket } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePreviewPanel } from "@/app/contexts/PreviewPanelContext";
import { useToast } from "@/app/contexts/ToastContext";
import { mapProject, mapBacklogItem, mapTicketCategory } from "@/app/lib/mappers";
import type { Project, BacklogItem, BacklogStatus, Priority, Sprint, TicketCategory, AccessLevel, UserPermissions } from "@/app/types";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { BtnSpinner } from "@/app/components/shared/PageLoader";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { ImageAttachments } from "@/app/components/shared/ImageAttachments";
import { NewSprintDialog } from "@/app/components/sprints/NewSprintDialog";

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
  item, project, sprints: initialSprints, onClose, onConverted,
}: {
  item: BacklogItem;
  project: Project;
  sprints: Sprint[];
  onClose: () => void;
  onConverted: () => void;
}) {
  const [sprints, setSprints] = useState<Sprint[]>(initialSprints);
  const [sprintId, setSprintId] = useState(initialSprints[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [showNewSprint, setShowNewSprint] = useState(false);
  const { userName } = useAuth();
  const { toast } = useToast();

  const reloadSprints = useCallback(async () => {
    if (!isSupabaseEnabled) return;
    const { data } = await supabase!
      .from("sprints")
      .select("id, project_id, name, goal, status, start_date, end_date, identifier")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false });
    const mapped: Sprint[] = (data ?? []).map((s: any) => ({
      id: s.id, projectId: s.project_id, name: s.name, goal: s.goal || "",
      status: s.status, startDate: s.start_date, endDate: s.end_date,
      identifier: s.identifier || "", tickets: [],
    }));
    setSprints(mapped);
    if (mapped.length > 0) setSprintId(mapped[0].id);
  }, [project.id]);

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
        images: item.images?.length ? item.images : [],
      });
      if (insErr) { toast("チケット作成に失敗しました", "error"); setSaving(false); return; }

      await supabase!.from("backlog_items").update({
        status: "converted", converted_ticket_id: ticketId, converted_ticket_wbs: wbs,
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);

      toast(`${wbs} としてチケットを作成しました`);
      onConverted();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
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
          {sprints.length === 0 ? (
            <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>スプリントがありません</p>
          ) : (
            <CustomSelect value={sprintId} onChange={setSprintId}
              options={sprints.map(s => ({ value: s.id, label: s.name }))} placeholder="スプリントを選択" />
          )}
          <button
            type="button"
            onClick={() => setShowNewSprint(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 7, cursor: "pointer" }}>
            <Plus style={{ width: 11, height: 11 }} />新規スプリントを作成
          </button>
        </div>
      </DialogShell>

      {showNewSprint && (
        <NewSprintDialog
          projectId={project.id}
          onClose={() => setShowNewSprint(false)}
          onCreated={() => { setShowNewSprint(false); reloadSprints(); }}
        />
      )}
    </>
  );
}

// ─── 左サイドバー アイテム行 ─────────────────────────────────
function BacklogSidebarItem({
  item, isSelected, canEdit, isDone, isDragOver, projectSlug,
  onSelect, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  item: BacklogItem; isSelected: boolean;
  canEdit: boolean; isDone: boolean; isDragOver?: boolean;
  projectSlug: string;
  onSelect: () => void;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const navigate = useNavigate();
  const pMeta = PRIORITY_META[item.priority];
  const sMeta = STATUS_META[item.status];
  const isConverted = item.status === "converted" && !!(item.convertedTicketWbs || item.convertedTicketId);

  const handleOpenTicket = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.convertedTicketWbs) {
      navigate(`/${projectSlug}/${item.convertedTicketWbs}`);
      return;
    }
    if (item.convertedTicketId && isSupabaseEnabled) {
      const { data } = await supabase!.from("sprint_tickets").select("wbs").eq("id", item.convertedTicketId).maybeSingle();
      if (data?.wbs) navigate(`/${projectSlug}/${data.wbs}`);
    }
  };

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
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: pMeta.bg, color: pMeta.color }}>{pMeta.label}</span>
          <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: sMeta.bg, color: sMeta.color }}>{sMeta.label}</span>
          {item.isUserInquiry && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: "#FFF7ED", color: "#D97706" }}>問い合わせ</span>
          )}
          {isConverted && (
            <button
              onClick={handleOpenTicket}
              title={`チケット ${item.convertedTicketWbs ?? ""} を開く`}
              style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "1px 5px", fontSize: 9, fontWeight: 700, borderRadius: 8, background: "#F5F3FF", color: "#6D28D9", border: "none", cursor: "pointer" }}>
              <Ticket style={{ width: 9, height: 9 }} />{item.convertedTicketWbs ?? "開く"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── メインページ ─────────────────────────────────────────
export function BacklogPage() {
  const { projectSlug, itemId: itemIdParam } = useParams<{ projectSlug: string; itemId?: string }>();
  const navigate = useNavigate();
  const { userPermissions, userName, userRole, userId } = useAuth();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [effectiveBacklogPerm, setEffectiveBacklogPerm] = useState<AccessLevel>("none");
  const [effectiveWikiPerm, setEffectiveWikiPerm] = useState<AccessLevel>("none");
  const [effectiveMinutesPerm, setEffectiveMinutesPerm] = useState<AccessLevel>("none");
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
  const [editImages, setEditImages] = useState<string[]>([]);
  const editImagesRef = useRef<string[]>([]);
  editImagesRef.current = editImages;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAdminRole = userRole === "owner" || userRole === "admin";
  const canEdit = effectiveBacklogPerm === "edit";
  const { open: openPreview } = usePreviewPanel();
  const canCreate = userPermissions.canCreateTicket;

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    const { data: bySlug } = await supabase!.from("projects").select("*").eq("slug", projectSlug).limit(1);
    const p = bySlug?.[0] ?? (await supabase!.from("projects").select("*").eq("id", projectSlug).maybeSingle()).data;
    if (!p) { setNotFound(true); setLoading(false); return; }
    setProject(mapProject(p));

    const [{ data: itemRows }, { data: sprintRows }, { data: catRows }, { data: permData }] = await Promise.all([
      supabase!.from("backlog_items").select("*").eq("project_id", p.id).order("rank"),
      supabase!.from("sprints").select("id, project_id, name, goal, status, start_date, end_date, identifier").eq("project_id", p.id),
      supabase!.from("ticket_categories").select("*").eq("project_id", p.id).order("name"),
      isAdminRole ? Promise.resolve({ data: null }) :
        supabase!.from("project_member_permissions").select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle(),
    ]);
    setItems((itemRows ?? []).map(mapBacklogItem));
    setSprints((sprintRows ?? []).map((s: any) => ({ id: s.id, projectId: s.project_id, name: s.name, goal: s.goal || "", status: s.status, startDate: s.start_date, endDate: s.end_date, identifier: s.identifier || "", tickets: [] })));
    setCategories((catRows ?? []).map(mapTicketCategory));

    if (isAdminRole) {
      setEffectiveBacklogPerm("edit");
      setEffectiveWikiPerm("edit");
      setEffectiveMinutesPerm("edit");
    } else {
      const perms = permData?.permissions as Partial<UserPermissions> | null;
      setEffectiveBacklogPerm((perms?.backlogPermission as AccessLevel | undefined) ?? "none");
      setEffectiveWikiPerm((perms?.wikiPermission as AccessLevel | undefined) ?? "none");
      setEffectiveMinutesPerm((perms?.minutesPermission as AccessLevel | undefined) ?? "none");
    }
    setLoading(false);
  }, [projectSlug, userId, isAdminRole]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // URLパスパラメータからアイテム選択
  useEffect(() => {
    if (itemIdParam && items.length > 0) {
      const found = items.find(i => i.id === itemIdParam);
      if (found) setSelectedId(found.id);
    }
  }, [itemIdParam, items]);

  const selectedItem = useMemo(() => items.find(i => i.id === selectedId) ?? null, [items, selectedId]);
  // チケット化済・アーカイブ済の項目は編集不可
  const itemCanEdit = canEdit && selectedItem != null && selectedItem.status !== "converted" && selectedItem.status !== "archived";

  // 選択アイテムが変わったら編集ステートを同期
  useEffect(() => {
    setEditTitle(selectedItem?.title ?? "");
    setEditDescription(selectedItem?.description ?? "");
    setEditPriority(selectedItem?.priority ?? "medium");
    setEditStatus(selectedItem?.status ?? "open");
    setEditAssignee(selectedItem?.assignee ?? "");
    setEditHours(selectedItem?.estimatedHours ?? 0);
    setEditCategoryId(selectedItem?.categoryId ?? null);
    setEditImages(selectedItem?.images ?? []);
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

  const handleImagesChange = useCallback(async (next: string[]) => {
    if (!selectedId) return;
    setEditImages(next);
    setItems(prev => prev.map(i => i.id === selectedId ? { ...i, images: next } : i));
    if (isSupabaseEnabled) {
      await supabase!.from("backlog_items").update({ images: next, updated_at: new Date().toISOString() }).eq("id", selectedId);
    }
  }, [selectedId]);

  // RichEditor上でのペースト・ドロップ画像をImageAttachmentsに追加（インライン挿入しない）
  const onEditorImageUpload = useCallback(async (file: File): Promise<string> => {
    if (!selectedId) return "";
    let url: string;
    if (!isSupabaseEnabled) {
      url = URL.createObjectURL(file);
    } else {
      const extMap: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
      const ext = extMap[file.type] ?? "png";
      const path = `backlog/${selectedId}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { data, error } = await supabase!.storage.from("ticket-images").upload(path, file, { upsert: true, contentType: file.type || "image/png" });
      if (error || !data) return "";
      url = supabase!.storage.from("ticket-images").getPublicUrl(path).data.publicUrl;
    }
    if (url) {
      const next = [...editImagesRef.current, url];
      editImagesRef.current = next;
      handleImagesChange(next);
    }
    return ""; // インライン挿入を抑制
  }, [selectedId, handleImagesChange]);

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
    if (selectedId === item.id) {
      setSelectedId(null);
      navigate(`/${projectSlug ?? project?.slug}/backlog`);
    }
    toast(`${item.id} を削除しました`);
  };

  if (!loading && (notFound || !project)) return <Navigate to="/projects" replace />;
  if (!loading && effectiveBacklogPerm === "none") return <Navigate to="/dashboard" replace />;

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
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>バックログ</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{project ? `${project.name} · ${items.length} 件` : "..."}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {effectiveBacklogPerm === "view" && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", background: "#FEF3C7", color: "#92400E", borderRadius: 20, border: "1px solid rgba(217,119,6,0.25)" }}>閲覧のみ</span>
          )}
          <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="backlog" marginBottom={0} backlogPerm={effectiveBacklogPerm} wikiPerm={effectiveWikiPerm} minutesPerm={effectiveMinutesPerm} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, height: "calc(100vh - 175px)", overflow: "hidden" }}>
        {/* ─── 左サイドバー ─── */}
        <div style={{ width: 260, flexShrink: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", padding: 10, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {canEdit && canCreate && (
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
                  projectSlug={projectSlug ?? project?.slug ?? ""}
                  isDragOver={dragOverId === item.id && dragId !== item.id}
                  onSelect={() => navigate(`/${projectSlug ?? project?.slug}/backlog/${item.id}`)}
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
                      projectSlug={projectSlug ?? project?.slug ?? ""}
                      onSelect={() => navigate(`/${projectSlug ?? project?.slug}/backlog/${item.id}`)} />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* ─── 右パネル ─── */}
        <div style={{ flex: 1, minWidth: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {!selectedItem ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <ClipboardList style={{ width: 32, height: 32, color: "#D4CEC8", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>左の一覧から項目を選択するか、新規追加してください</p>
            </div>
          ) : (
            <>
              {/* 固定ヘッダー: タイトル + アクションボタン + フィールド行 */}
              <div style={{ padding: "20px 20px 14px", flexShrink: 0, borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
                  <input
                    value={editTitle}
                    disabled={!itemCanEdit}
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
                    {selectedItem.status === "converted" && !!(selectedItem.convertedTicketWbs || selectedItem.convertedTicketId) && (
                      <button
                        onClick={async () => {
                          if (selectedItem.convertedTicketWbs) {
                            navigate(`/${projectSlug ?? project?.slug ?? ""}/${selectedItem.convertedTicketWbs}`);
                            return;
                          }
                          if (selectedItem.convertedTicketId && isSupabaseEnabled) {
                            const { data } = await supabase!.from("sprint_tickets").select("wbs").eq("id", selectedItem.convertedTicketId).maybeSingle();
                            if (data?.wbs) navigate(`/${projectSlug ?? project?.slug ?? ""}/${data.wbs}`);
                          }
                        }}
                        title={`チケット ${selectedItem.convertedTicketWbs ?? ""} を開く`}
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#ECFDF5", color: "#059669", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        <Ticket style={{ width: 12, height: 12 }} />{selectedItem.convertedTicketWbs ?? "チケットを開く"}
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
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 160, flex: 1, pointerEvents: itemCanEdit ? "auto" : "none", opacity: itemCanEdit ? 1 : 0.6 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>分類</label>
                    <CustomSelect
                      value={editCategoryId ?? ""}
                      onChange={v => { setEditCategoryId(v || null); scheduleSave({ categoryId: v || null }); }}
                      options={[{ value: "", label: "分類なし" }, ...categories.map(c => ({ value: c.id, label: c.name }))]}
                      placeholder="分類なし" />
                  </div>
                  <div style={{ width: 110, pointerEvents: itemCanEdit ? "auto" : "none", opacity: itemCanEdit ? 1 : 0.6 }}>
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
                  <div style={{ width: 155, pointerEvents: itemCanEdit ? "auto" : "none", opacity: itemCanEdit ? 1 : 0.6 }}>
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
                  <div style={{ minWidth: 140, pointerEvents: itemCanEdit ? "auto" : "none", opacity: itemCanEdit ? 1 : 0.6 }}>
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
                      type="number" min={0} value={editHours} disabled={!itemCanEdit}
                      onChange={e => { const v = Number(e.target.value); setEditHours(v); scheduleSave({ estimatedHours: v }); }}
                      style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12, border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 9, outline: "none", fontFamily: "inherit" }} />
                  </div>
                </div>
              </div>

              {/* エディター + 画像添付（エディター内部でスクロール） */}
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "12px 20px 16px", display: "flex", flexDirection: "column" }}>
                <RichEditor
                  value={editDescription}
                  readOnly={!itemCanEdit}
                  onChange={v => { setEditDescription(v); scheduleSave({ description: v }); }}
                  placeholder="背景や要件を入力..."
                  members={project?.members ?? []}
                  minHeight={120}
                  style={{ flex: 1, minHeight: 0 }}
                  onBacklogClick={id => openPreview("backlog", id)}
                  onWikiClick={id => openPreview("wiki", id)}
                  onMinuteClick={id => openPreview("minute", id)}
                  onImageUpload={itemCanEdit ? onEditorImageUpload : undefined} />
                <div style={{ marginTop: 16, flexShrink: 0 }}>
                  <ImageAttachments
                    images={editImages}
                    onImagesChange={handleImagesChange}
                    uploadPathPrefix={`backlog/${selectedItem.id}`}
                    readOnly={!itemCanEdit}
                  />
                </div>
              </div>
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
