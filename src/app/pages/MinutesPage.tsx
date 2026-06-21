import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router";

function toMinuteSlug(createdAt: string | null | undefined): string {
  if (!createdAt) return "";
  const m = createdAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
}
import { FolderKanban, ChevronRight, Plus, FileText, Trash2, Users, Check, X } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { usePreviewPanel } from "@/app/contexts/PreviewPanelContext";
import { mapProject, mapMeetingMinute, mapActionMemo } from "@/app/lib/mappers";
import type { Project, MeetingMinute, ActionMemo, AccessLevel, UserPermissions } from "@/app/types";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { ImageAttachments } from "@/app/components/shared/ImageAttachments";

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// ─── アクション項目 ─────────────────────────────────────────
function ActionItemsPanel({
  minuteId, projectId, projectSlug, members, canEdit,
}: {
  minuteId: string; projectId: string; projectSlug: string; members: string[]; canEdit: boolean;
}) {
  const [items, setItems] = useState<ActionMemo[]>([]);
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState(members[0] ?? "");
  const { toast } = useToast();

  const load = useCallback(async () => {
    const { data } = await supabase!.from("action_memos").select("*").eq("meeting_minute_id", minuteId).order("created_at");
    setItems((data ?? []).map(mapActionMemo));
  }, [minuteId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!text.trim() || !assignee) return;
    const { error } = await supabase!.from("action_memos").insert({
      user_name: assignee, title: text.trim(), category: "todo",
      meeting_minute_id: minuteId, project_id: projectId, project_slug: projectSlug,
    });
    if (error) { toast("アクション項目の追加に失敗しました", "error"); return; }
    setText("");
    load();
  };

  const handleToggle = async (item: ActionMemo) => {
    await supabase!.from("action_memos").update({ is_done: !item.isDone, updated_at: new Date().toISOString() }).eq("id", item.id);
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, isDone: !i.isDone } : i));
  };

  const handleDelete = async (id: string) => {
    await supabase!.from("action_memos").delete().eq("id", id);
    setItems(prev => prev.filter(i => i.id !== id));
  };

  return (
    <div style={{ marginTop: 20 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: "#4A4540", marginBottom: 8 }}>アクション項目</p>
      {items.length === 0 ? (
        <p style={{ fontSize: 11, color: "#D4CEC8", marginBottom: 10 }}>なし</p>
      ) : (
        <div style={{ marginBottom: 10 }}>
          {items.map(item => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
              <button onClick={() => handleToggle(item)}
                style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${item.isDone ? "#059669" : "#D4CEC8"}`, background: item.isDone ? "#059669" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {item.isDone && <Check style={{ width: 10, height: 10, color: "#fff" }} />}
              </button>
              <span style={{ flex: 1, fontSize: 12, color: item.isDone ? "#B0A9A4" : "#1A1714", textDecoration: item.isDone ? "line-through" : "none" }}>{item.title}</span>
              <span style={{ fontSize: 10, color: "#9E9690", flexShrink: 0 }}>{item.userName}</span>
              {canEdit && (
                <button onClick={() => handleDelete(item.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 2 }}>
                  <X style={{ width: 11, height: 11 }} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <div style={{ display: "flex", gap: 6 }}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="アクション項目を入力..."
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
            style={{ flex: 1, padding: "7px 10px", fontSize: 12, border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 8, outline: "none", fontFamily: "inherit" }} />
          <div style={{ width: 140 }}>
            <CustomSelect value={assignee} onChange={setAssignee} options={members.map(m => ({ value: m, label: m }))} />
          </div>
          <button onClick={handleAdd} style={{ padding: "7px 14px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>追加</button>
        </div>
      )}
    </div>
  );
}

// ─── メインページ ─────────────────────────────────────────
export function MinutesPage() {
  const { projectSlug, minuteId: minuteIdParam } = useParams<{ projectSlug: string; minuteId?: string }>();
  const navigate = useNavigate();
  const { userPermissions, userName, userRole, userId } = useAuth();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [minutes, setMinutes] = useState<MeetingMinute[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<MeetingMinute | null>(null);
  const [effectiveMinutesPerm, setEffectiveMinutesPerm] = useState<AccessLevel>("none");
  const [effectiveWikiPerm, setEffectiveWikiPerm] = useState<AccessLevel>("none");
  const [effectiveBacklogPerm, setEffectiveBacklogPerm] = useState<AccessLevel>("none");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAdminRole = userRole === "owner" || userRole === "admin";
  const canEdit = effectiveMinutesPerm === "edit";
  const { open: openPreview } = usePreviewPanel();

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    const { data: bySlug } = await supabase!.from("projects").select("*").eq("slug", projectSlug).limit(1);
    const p = bySlug?.[0] ?? (await supabase!.from("projects").select("*").eq("id", projectSlug).maybeSingle()).data;
    if (!p) { setNotFound(true); setLoading(false); return; }
    setProject(mapProject(p));
    const [{ data }, permResult] = await Promise.all([
      supabase!.from("meeting_minutes").select("*").eq("project_id", p.id).order("meeting_date", { ascending: false }),
      isAdminRole ? Promise.resolve({ data: null }) :
        supabase!.from("project_member_permissions").select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle(),
    ]);
    setMinutes((data ?? []).map(mapMeetingMinute));

    if (isAdminRole) {
      setEffectiveMinutesPerm("edit");
      setEffectiveWikiPerm("edit");
      setEffectiveBacklogPerm("edit");
    } else {
      const perms = permResult.data?.permissions as Partial<UserPermissions> | null;
      setEffectiveMinutesPerm((perms?.minutesPermission as AccessLevel | undefined) ?? "none");
      setEffectiveWikiPerm((perms?.wikiPermission as AccessLevel | undefined) ?? "none");
      setEffectiveBacklogPerm((perms?.backlogPermission as AccessLevel | undefined) ?? "none");
    }
    setLoading(false);
  }, [projectSlug, userId, isAdminRole]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // URLパスパラメータからアイテム選択（UUID後方互換 + yyyymmdd-hhmmss スラグ対応）
  useEffect(() => {
    if (minuteIdParam && minutes.length > 0) {
      const found = minutes.find(m => m.id === minuteIdParam)
        ?? minutes.find(m => toMinuteSlug(m.createdAt) === minuteIdParam);
      if (found) setSelectedId(found.id);
    }
  }, [minuteIdParam, minutes]);

  const selected = minutes.find(m => m.id === selectedId) ?? null;

  useEffect(() => {
    setTitle(selected?.title ?? "");
    setMeetingDate(selected?.meetingDate ?? "");
    setAttendees(selected?.attendees ?? []);
    setContent(selected?.content ?? "");
    setImages(selected?.images ?? []);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = useCallback((patch: Partial<{ title: string; meetingDate: string; attendees: string[]; content: string }>) => {
    if (!selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await supabase!.from("meeting_minutes").update({
        title: patch.title, meeting_date: patch.meetingDate, attendees: patch.attendees, content: patch.content,
        updated_at: new Date().toISOString(),
      }).eq("id", selectedId);
      setMinutes(prev => prev.map(m => m.id === selectedId ? { ...m, ...patch } as MeetingMinute : m));
    }, 600);
  }, [selectedId]);

  const handleImagesChange = useCallback(async (next: string[]) => {
    if (!selectedId) return;
    setImages(next);
    setMinutes(prev => prev.map(m => m.id === selectedId ? { ...m, images: next } : m));
    if (isSupabaseEnabled) {
      await supabase!.from("meeting_minutes").update({ images: next, updated_at: new Date().toISOString() }).eq("id", selectedId);
    }
  }, [selectedId]);

  const handleAdd = async () => {
    if (!project) return;
    const id = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const { data: inserted, error } = await supabase!.from("meeting_minutes").insert({
      id, project_id: project.id, title: "新規議事録", meeting_date: today, attendees: [], content: "",
      created_by: userName || null,
    }).select("created_at").single();
    if (error) { toast("議事録の作成に失敗しました", "error"); return; }
    await load();
    const slug = toMinuteSlug(inserted?.created_at) || id;
    navigate(`/${projectSlug ?? project?.slug}/minutes/${slug}`);
  };

  const handleDelete = async (m: MeetingMinute) => {
    await supabase!.from("meeting_minutes").delete().eq("id", m.id);
    if (selectedId === m.id) {
      setSelectedId(null);
      navigate(`/${projectSlug ?? project?.slug}/minutes`);
    }
    toast(`「${m.title}」を削除しました`);
    load();
  };

  if (!loading && (notFound || !project)) return <Navigate to="/projects" replace />;
  if (!loading && effectiveMinutesPerm === "none") return <Navigate to="/dashboard" replace />;

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
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>議事録</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{project ? `${project.name} · ${minutes.length} 件` : "..."}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {effectiveMinutesPerm === "view" && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", background: "#FEF3C7", color: "#92400E", borderRadius: 20, border: "1px solid rgba(217,119,6,0.25)" }}>閲覧のみ</span>
          )}
          <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="minutes" marginBottom={0} minutesPerm={effectiveMinutesPerm} wikiPerm={effectiveWikiPerm} backlogPerm={effectiveBacklogPerm} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, height: "calc(100vh - 175px)", overflow: "hidden" }}>
        <div style={{ width: 260, flexShrink: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", padding: 10, overflowY: "auto" }}>
          {canEdit && (
            <button onClick={handleAdd}
              style={{ display: "flex", alignItems: "center", gap: 5, width: "100%", padding: "7px 10px", marginBottom: 6, background: "#ECFDF5", color: "#059669", border: "1.5px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <Plus style={{ width: 12, height: 12 }} />新規議事録
            </button>
          )}
          {minutes.length === 0 ? (
            <div style={{ padding: "24px 8px", textAlign: "center" }}>
              <FileText style={{ width: 24, height: 24, color: "#D4CEC8", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>議事録がありません</p>
            </div>
          ) : minutes.map(m => (
            <div key={m.id} onClick={() => navigate(`/${projectSlug ?? project?.slug}/minutes/${toMinuteSlug(m.createdAt) || m.id}`)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 7, cursor: "pointer", background: selectedId === m.id ? "#ECFDF5" : "transparent" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: selectedId === m.id ? 700 : 500, color: selectedId === m.id ? "#059669" : "#1A1714", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title || "新規議事録"}</p>
                <p style={{ fontSize: 10, color: "#B0A9A4", margin: 0 }}>{formatDate(m.meetingDate)}</p>
              </div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {!selected ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <FileText style={{ width: 32, height: 32, color: "#D4CEC8", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>左の一覧から議事録を選択するか、新規作成してください</p>
            </div>
          ) : (
            <>
              {/* 固定ヘッダー: タイトル・削除・開催日・出席者 */}
              <div style={{ padding: "20px 20px 12px", flexShrink: 0, borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
                  <input
                    value={title} disabled={!canEdit}
                    onChange={e => { setTitle(e.target.value); scheduleSave({ title: e.target.value, meetingDate, attendees, content }); }}
                    placeholder="議事録タイトル"
                    style={{ flex: 1, boxSizing: "border-box", border: "none", outline: "none", fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", padding: 0 }} />
                  {canEdit && (
                    <button onClick={() => setDeleteTarget(selected)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 4, flexShrink: 0 }}>
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>開催日</label>
                    <input type="date" value={meetingDate} disabled={!canEdit}
                      onChange={e => { setMeetingDate(e.target.value); scheduleSave({ title, meetingDate: e.target.value, attendees, content }); }}
                      style={{ padding: "6px 10px", fontSize: 12, border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 8, outline: "none", fontFamily: "inherit" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}><Users style={{ width: 10, height: 10 }} />出席者</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {(project?.members ?? []).map(member => {
                        const active = attendees.includes(member);
                        return (
                          <button key={member} disabled={!canEdit}
                            onClick={() => {
                              const next = active ? attendees.filter(a => a !== member) : [...attendees, member];
                              setAttendees(next);
                              scheduleSave({ title, meetingDate, attendees: next, content });
                            }}
                            style={{ padding: "3px 9px", fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: canEdit ? "pointer" : "default", border: `1.5px solid ${active ? "#059669" : "rgba(26,23,20,0.1)"}`, background: active ? "#ECFDF5" : "transparent", color: active ? "#059669" : "#9E9690" }}>
                            {member}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
              {/* エディター + アクション項目（内部でスクロール） */}
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "12px 20px 16px", display: "flex", flexDirection: "column" }}>
                <RichEditor value={content} readOnly={!canEdit}
                  onChange={v => { setContent(v); scheduleSave({ title, meetingDate, attendees, content: v }); }}
                  placeholder="議事内容を入力..." members={project?.members ?? []} minHeight={120}
                  style={{ flex: 1, minHeight: 0 }}
                  onBacklogClick={id => openPreview("backlog", id)}
                  onWikiClick={id => openPreview("wiki", id)}
                  onMinuteClick={id => openPreview("minute", id)}
                  onImageUpload={canEdit ? async (file) => {
                    if (!isSupabaseEnabled) return URL.createObjectURL(file);
                    const extMap: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
                    const ext = extMap[file.type] ?? "png";
                    const path = `minutes/${selected.id}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
                    const { data, error } = await supabase!.storage.from("ticket-images").upload(path, file, { upsert: true, contentType: file.type });
                    if (error || !data) return "";
                    return supabase!.storage.from("ticket-images").getPublicUrl(path).data.publicUrl;
                  } : undefined} />
                <ActionItemsPanel minuteId={selected.id} projectId={project.id} projectSlug={projectSlug ?? project.slug} members={project.members} canEdit={canEdit} />
              </div>
            </>
          )}
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="議事録の削除"
          message={`「${deleteTarget.title}」を削除します。`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
