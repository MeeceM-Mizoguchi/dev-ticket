import { useEffect, useRef, useState, useCallback } from "react";
import { X, Paperclip, ChevronDown, ChevronUp, Trash2, FileCode2, ImageIcon, Pencil, Check, ChevronDown as CaretDown } from "lucide-react";
import type { SprintTicket, TicketComment, TicketSourceFile, Priority, TicketStatus, CommentType } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { TICKET_STATUSES } from "@/app/lib/helpers";
import { useAuth } from "@/app/contexts/AuthContext";
import { Avatar } from "@/app/components/shared/Avatar";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { mapComment, mapSourceFile, mapSprintTicket } from "@/app/lib/mappers";

const STATUS_PROGRESS: Record<TicketStatus, number> = {
  todo: 0, "in-progress": 10, "in-review": 30,
  "review-done": 50, "stg-test": 70, uat: 90, done: 100, closed: 100,
};

const ACTION_BUTTONS: Partial<Record<TicketStatus, { label: string; next: TicketStatus; color: string; bg: string }>> = {
  todo:          { label: "着手開始",   next: "in-progress", color: "#D97706", bg: "#FFF7ED" },
  "review-done": { label: "STG完了",    next: "stg-test",    color: "#0D9488", bg: "#F0FDFA" },
  "stg-test":    { label: "UAT完了",    next: "uat",         color: "#4F46E5", bg: "#EEF2FF" },
  uat:           { label: "リリース完了",next: "closed",      color: "#6B7280", bg: "#F3F4F6" },
};

const priorityMeta: Record<Priority, { label: string; color: string; bg: string }> = {
  high:   { label: "高", color: "#DC2626", bg: "#FEF2F2" },
  medium: { label: "中", color: "#D97706", bg: "#FFFBEB" },
  low:    { label: "低", color: "#0284C7", bg: "#F0F9FF" },
};

function formatTs(ts: string) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: string }) {
  const s = TICKET_STATUSES.find(x => x.value === status);
  if (!s) return null;
  return <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: s.bg, color: s.color, flexShrink: 0 }}>{s.label}</span>;
}

export function TicketDetailPanel({
  ticket, onClose, onUpdated,
}: { ticket: SprintTicket | null; onClose: () => void; onUpdated?: () => void }) {

  const { userName, userRole } = useAuth();
  const isAdminOrPM = userRole === "admin" || userRole === "project-manager";

  // editable state
  const [status, setStatus]         = useState<TicketStatus>(ticket?.status ?? "todo");
  const [priority, setPriority]     = useState<Priority>(ticket?.priority ?? "medium");
  const [assignees, setAssignees]   = useState<string[]>(
    ticket?.assignees?.length ? ticket.assignees : (ticket?.assignee ? [ticket.assignee] : [])
  );
  const [assigneesOpen, setAssigneesOpen] = useState(false);
  const [startDate, setStartDate]   = useState(ticket?.startDate ?? "");
  const [dueDate, setDueDate]       = useState(ticket?.dueDate ?? "");
  const [estimatedH, setEstimatedH] = useState(ticket?.estimatedHours ?? 0);
  const [progress, setProgress]     = useState(ticket?.progress ?? 0);
  const [description, setDescription] = useState(ticket?.description ?? "");
  const [reviewerName, setReviewerName] = useState(ticket?.reviewerName ?? "");
  const [reviewRound, setReviewRound]   = useState(ticket?.reviewRound ?? 0);

  // related data
  const [comments, setComments]       = useState<TicketComment[]>([]);
  const [sourceFiles, setSourceFiles] = useState<TicketSourceFile[]>([]);
  const [memberNames, setMemberNames] = useState<string[]>([]);

  // review request form
  const [reviewContent, setReviewContent] = useState("");
  const [reviewFiles, setReviewFiles]     = useState<{ name: string; file: File }[]>([]);
  // reviewer's input for revision/approval comment
  const [revisionInput, setRevisionInput] = useState("");

  // comment form
  const [commentText, setCommentText]     = useState("");
  const [commentImages, setCommentImages] = useState<string[]>([]);

  // ticket-level images
  const [ticketImages, setTicketImages] = useState<string[]>([]);

  // comment editing
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  // accordion
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set([1]));

  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // sync when ticket changes — set from prop immediately, then fetch fresh from DB
  useEffect(() => {
    if (!ticket) return;
    setStatus(ticket.status);
    setPriority(ticket.priority);
    const a = ticket.assignees?.length ? ticket.assignees : (ticket.assignee ? [ticket.assignee] : []);
    setAssignees(a);
    setStartDate(ticket.startDate ?? "");
    setDueDate(ticket.dueDate ?? "");
    setEstimatedH(ticket.estimatedHours);
    setProgress(ticket.progress);
    setDescription(ticket.description ?? "");
    setReviewerName(ticket.reviewerName ?? "");
    setReviewRound(ticket.reviewRound ?? 0);
    // reset form state on ticket change
    setCommentText("");
    setCommentImages([]);
    setReviewContent("");
    setReviewFiles([]);
    setRevisionInput("");
    setEditingId(null);
    setAssigneesOpen(false);
    // fetch fresh data from DB (in case sprint cache is stale)
    if (ticket.id && isSupabaseEnabled) {
      supabase!.from("sprint_tickets").select("*").eq("id", ticket.id).single()
        .then(({ data }) => {
          if (!data) return;
          const t = mapSprintTicket(data);
          setStatus(t.status);
          setPriority(t.priority);
          const fresh = t.assignees?.length ? t.assignees : (t.assignee ? [t.assignee] : []);
          setAssignees(fresh);
          setStartDate(t.startDate ?? "");
          setDueDate(t.dueDate ?? "");
          setEstimatedH(t.estimatedHours);
          setProgress(t.progress);
          setDescription(t.description ?? "");
          setReviewerName(t.reviewerName ?? "");
          setReviewRound(t.reviewRound ?? 0);
        });
    }
    if (ticket.id) loadRelated(ticket.id);
  }, [ticket?.id]);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!.from("profiles").select("name").order("name")
      .then(({ data }) => { if (data) setMemberNames(data.map((r: { name: string }) => r.name)); });
  }, []);

  const loadRelated = useCallback(async (ticketId: string) => {
    if (!isSupabaseEnabled) return;
    const [{ data: cData }, { data: fData }] = await Promise.all([
      supabase!.from("ticket_comments").select("*").eq("ticket_id", ticketId).order("created_at"),
      supabase!.from("ticket_source_files").select("*").eq("ticket_id", ticketId).order("created_at"),
    ]);
    if (cData) setComments(cData.map(mapComment));
    if (fData) setSourceFiles(fData.map(mapSourceFile));
  }, []);

  const save = useCallback(async (fields: Record<string, unknown>) => {
    if (!ticket || !isSupabaseEnabled) return;
    await supabase!.from("sprint_tickets").update(fields).eq("id", ticket.id);
    onUpdated?.();
  }, [ticket?.id]);

  const saveDebounced = useCallback((fields: Record<string, unknown>) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(fields), 1200);
  }, [save]);

  const setStatusAndProgress = (newStatus: TicketStatus) => {
    const p = STATUS_PROGRESS[newStatus] ?? progress;
    setStatus(newStatus);
    setProgress(p);
    save({ status: newStatus, progress: p });
  };

  const handleStatusAction = async (btn: { label: string; next: TicketStatus }) => {
    if (!ticket) return;
    const newStatus = btn.next;
    const p = STATUS_PROGRESS[newStatus];
    setStatus(newStatus);
    setProgress(p);
    if (isSupabaseEnabled) {
      await supabase!.from("sprint_tickets").update({ status: newStatus, progress: p }).eq("id", ticket.id);
    }
    const newLabel = TICKET_STATUSES.find(s => s.value === newStatus)?.label ?? newStatus;
    await addComment(`<p>${btn.label}：ステータスを「${newLabel}」に変更しました</p>`, "status_change", [], newStatus);
    onUpdated?.();
  };

  const saveAssignees = (newList: string[]) => {
    setAssignees(newList);
    save({ assignees: newList, assignee: newList[0] || "" });
  };

  const addComment = async (content: string, type: CommentType = "comment", images: string[] = [], explicitStatus?: TicketStatus) => {
    if (!ticket) return;
    const ts = explicitStatus ?? status;
    const row = { id: `CMT-${Date.now()}`, ticket_id: ticket.id, user_name: userName, content, ticket_status: ts, comment_type: type, images };
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("ticket_comments").insert(row);
      if (error) { console.error("comment insert failed:", error); return; }
      await loadRelated(ticket.id);
    } else {
      setComments(prev => [...prev, { ...row, ticketId: ticket.id, userName, ticketStatus: ts, commentType: type, createdAt: new Date().toISOString() }]);
    }
  };

  const uploadSourceFile = async (file: File, round: number): Promise<string> => {
    if (!ticket || !isSupabaseEnabled) return "";
    const path = `${ticket.id}/${round}/${Date.now()}_${file.name}`;
    const { data } = await supabase!.storage.from("ticket-files").upload(path, file, { upsert: true });
    if (!data) return "";
    const { data: urlData } = supabase!.storage.from("ticket-files").getPublicUrl(path);
    const row = { id: `SF-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, ticket_id: ticket.id, file_name: file.name, file_size: file.size, file_type: file.type, uploaded_by: userName, review_round: round, file_url: urlData.publicUrl };
    await supabase!.from("ticket_source_files").insert(row);
    return urlData.publicUrl;
  };

  const handleDate = (field: "start_date" | "due_date", v: string) => {
    const s = field === "start_date" ? v : startDate;
    const d = field === "due_date"   ? v : dueDate;
    if (field === "start_date") setStartDate(v); else setDueDate(v);
    const days = s && d ? Math.max(0, Math.round((new Date(d).getTime() - new Date(s).getTime()) / 86400000)) : 0;
    const h = days * 8;
    setEstimatedH(h);
    save({ [field]: v || null, estimated_hours: h });
  };

  const handleReviewRequest = async () => {
    if (!reviewerName || status !== "in-progress" || !ticket) return;
    const round = reviewRound + 1;
    const newStatus: TicketStatus = "in-review";
    const newProgress = STATUS_PROGRESS[newStatus];
    // update local state immediately
    setReviewRound(round);
    setStatus(newStatus);
    setProgress(newProgress);
    // single awaited DB save (prevents onUpdated firing mid-flow)
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("sprint_tickets").update({
        status: newStatus, progress: newProgress,
        reviewer_name: reviewerName, review_round: round,
      }).eq("id", ticket.id);
      if (error) {
        console.error("handleReviewRequest save failed:", error);
        setStatus("in-progress"); setProgress(STATUS_PROGRESS["in-progress"]); setReviewRound(round - 1);
        return;
      }
    }
    for (const rf of reviewFiles) await uploadSourceFile(rf.file, round);
    setReviewFiles([]);
    const content = reviewContent.trim()
      ? reviewContent
      : `<p><strong>@${reviewerName}</strong> にレビュー依頼を送信しました（第${round}回）</p>`;
    await addComment(content, "review_request", [], newStatus);
    setReviewContent("");
    setExpandedRounds(prev => new Set([...prev, round]));
    onUpdated?.();
  };

  const handleRevisionRequest = async (revisionText: string = "") => {
    if (!ticket) return;
    const newStatus: TicketStatus = "in-progress";
    const newProgress = STATUS_PROGRESS[newStatus];
    setStatus(newStatus); setProgress(newProgress);
    if (isSupabaseEnabled) {
      await supabase!.from("sprint_tickets").update({ status: newStatus, progress: newProgress }).eq("id", ticket.id);
    }
    const mentions = assignees.length > 0 ? assignees.map(a => `<strong>@${a}</strong>`).join(" ") : "";
    const content = revisionText.trim()
      ? revisionText
      : `<p>${mentions} に修正依頼を送信しました</p>`;
    await addComment(content, "revision_request", [], newStatus);
    setRevisionInput("");
    onUpdated?.();
  };

  const handleReviewApproval = async (approvalText: string = "") => {
    if (!ticket) return;
    const newStatus: TicketStatus = "review-done";
    const newProgress = STATUS_PROGRESS[newStatus];
    setStatus(newStatus); setProgress(newProgress);
    if (isSupabaseEnabled) {
      await supabase!.from("sprint_tickets").update({ status: newStatus, progress: newProgress }).eq("id", ticket.id);
    }
    const content = approvalText.trim() ? approvalText : "<p>✅ レビューを承認しました</p>";
    await addComment(content, "review_approved", [], newStatus);
    setRevisionInput("");
    onUpdated?.();
  };

  const handleAddComment = async () => {
    if (!commentText.trim() || !ticket) return;
    await addComment(commentText, "comment", commentImages);
    setCommentText("");
    setCommentImages([]);
  };

  const handleDeleteComment = async (id: string) => {
    if (isSupabaseEnabled) await supabase!.from("ticket_comments").delete().eq("id", id);
    setComments(prev => prev.filter(c => c.id !== id));
  };

  const handleEditComment = (c: TicketComment) => { setEditingId(c.id); setEditContent(c.content); };
  const handleSaveEdit = async (id: string) => {
    if (isSupabaseEnabled) await supabase!.from("ticket_comments").update({ content: editContent }).eq("id", id);
    setComments(prev => prev.map(c => c.id === id ? { ...c, content: editContent } : c));
    setEditingId(null);
  };

  const handleDeleteSourceFile = async (id: string) => {
    if (isSupabaseEnabled) await supabase!.from("ticket_source_files").delete().eq("id", id);
    setSourceFiles(prev => prev.filter(f => f.id !== id));
  };

  if (!ticket) return null;

  const todayStr = new Date().toISOString().split("T")[0];
  const isOverdue = status !== "done" && status !== "closed" && !!dueDate && dueDate < todayStr;
  const pm = priorityMeta[priority];
  const smeta = TICKET_STATUSES.find(s => s.value === status)!;

  const filesByRound = sourceFiles.reduce<Record<number, TicketSourceFile[]>>((acc, f) => {
    (acc[f.reviewRound] = acc[f.reviewRound] || []).push(f); return acc;
  }, {});
  const rounds = Object.keys(filesByRound).map(Number).sort((a, b) => a - b);

  const actionBtn = ACTION_BUTTONS[status];

  // 担当者チェック: 自分が担当者かどうか
  const isAssignee = assignees.length === 0 || assignees.includes(userName);
  const canSendReview = status === "in-progress" && !!reviewerName && isAssignee;
  // レビュアーボタン: 指定されたレビュアー or 管理者/PM かつ担当者ではない
  const canReview = (userName === reviewerName || isAdminOrPM) && !isAssignee;
  const latestReviewReqId = [...comments].reverse().find(c => c.commentType === "review_request")?.id ?? null;

  const assigneeLabel = assignees.length === 0 ? "未割り当て"
    : assignees.length === 1 ? assignees[0]
    : `${assignees[0]} 他${assignees.length - 1}名`;

  return (
    <>
      <style>{`@keyframes slideInPanel{from{transform:translateX(102%)}to{transform:translateX(0)}}`}</style>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(10,14,12,0.30)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "56%", minWidth: 520, background: "#FAFAF8", zIndex: 201, boxShadow: "-16px 0 60px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", animation: "slideInPanel 0.28s cubic-bezier(0.16,1,0.3,1)" }}>

        {/* Header */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFF", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", background: "#F4F5F6", padding: "2px 8px", borderRadius: 5 }}>{ticket.id}</span>
                {ticket.wbs && <span style={{ fontSize: 10, color: "#C9C4BB", fontFamily: "var(--font-mono)" }}>WBS {ticket.wbs}</span>}
                <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: smeta?.bg ?? "#F4F5F6", color: smeta?.color ?? "#9E9690" }}>{smeta?.label}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: pm.bg, color: pm.color }}>優先度: {pm.label}</span>
                {isOverdue && <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: "#FEF2F2", color: "#DC2626", border: "1px solid rgba(220,38,38,0.3)" }}>期限超過</span>}
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.025em", lineHeight: 1.3 }}>{ticket.title}</h2>
            </div>
            <button onClick={onClose} style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4", flexShrink: 0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 32px", display: "flex", flexDirection: "column", gap: 16 }} onClick={() => assigneesOpen && setAssigneesOpen(false)}>

          {/* Progress bar */}
          <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#6B6458" }}>進捗</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{progress}%</span>
            </div>
            <div style={{ height: 8, background: "#EDE9E0", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "#059669", borderRadius: 99, transition: "width 0.6s ease" }} />
            </div>
          </div>

          {/* Action button */}
          {actionBtn && isAssignee && (
            <button onClick={() => handleStatusAction(actionBtn)}
              style={{ padding: "11px 0", fontSize: 13, fontWeight: 700, borderRadius: 10, border: `1.5px solid ${actionBtn.color}33`, cursor: "pointer", background: actionBtn.bg, color: actionBtn.color, width: "100%" }}>
              {actionBtn.label} →
            </button>
          )}

          {/* Metadata */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {/* 担当者 (複数選択) */}
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px", position: "relative" }}>
              <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>担当者</p>
              <button onClick={e => { e.stopPropagation(); setAssigneesOpen(o => !o); }}
                style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 13, fontWeight: 600, color: assignees.length === 0 ? "#C9C4BB" : "#1A1714", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", padding: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>{assigneeLabel}</span>
                <CaretDown style={{ width: 12, height: 12, color: "#B0A9A4", flexShrink: 0, transform: assigneesOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>
              {assigneesOpen && (
                <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFF", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden", marginTop: 4 }}>
                  {memberNames.length === 0
                    ? <p style={{ padding: "10px 12px", fontSize: 12, color: "#B0A9A4" }}>メンバーがいません</p>
                    : memberNames.map(n => (
                      <label key={n} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", background: assignees.includes(n) ? "#ECFDF5" : "transparent", transition: "background 0.1s" }}
                        onMouseEnter={e => { if (!assignees.includes(n)) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = assignees.includes(n) ? "#ECFDF5" : "transparent"; }}>
                        <input type="checkbox" checked={assignees.includes(n)} style={{ accentColor: "#059669", width: 14, height: 14 }}
                          onChange={e => {
                            const next = e.target.checked ? [...assignees, n] : assignees.filter(a => a !== n);
                            saveAssignees(next);
                          }} />
                        <Avatar name={n} size="xs" />
                        <span style={{ fontSize: 12, fontWeight: 500, color: "#1A1714" }}>{n}</span>
                        {assignees.includes(n) && <Check style={{ width: 12, height: 12, color: "#059669", marginLeft: "auto" }} />}
                      </label>
                    ))}
                  <div style={{ padding: "6px 12px", borderTop: "1px solid rgba(26,23,20,0.06)" }}>
                    <button onClick={() => { saveAssignees([]); setAssigneesOpen(false); }}
                      style={{ fontSize: 11, color: "#B0A9A4", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                      割り当て解除
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>優先度</p>
              <select value={priority} onChange={e => { const v = e.target.value as Priority; setPriority(v); save({ priority: v }); }}
                style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 13, fontWeight: 600, color: pm.color, cursor: "pointer" }}>
                <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
              </select>
            </div>
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>開始日</p>
              <input type="date" value={startDate} onChange={e => handleDate("start_date", e.target.value)}
                style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 12, color: "#6B6458", fontFamily: "var(--font-mono)", cursor: "pointer" }} />
            </div>
            <div style={{ background: "#FFF", border: `1px solid ${isOverdue ? "rgba(220,38,38,0.30)" : "rgba(26,23,20,0.07)"}`, borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: isOverdue ? "#DC2626" : "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>期限日 {isOverdue ? "⚠" : ""}</p>
              <input type="date" value={dueDate} onChange={e => handleDate("due_date", e.target.value)}
                style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 12, color: isOverdue ? "#DC2626" : "#6B6458", fontFamily: "var(--font-mono)", fontWeight: isOverdue ? 700 : 400, cursor: "pointer" }} />
            </div>
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>見積工数（自動）</p>
              <span style={{ fontSize: 18, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{estimatedH}<span style={{ fontSize: 11, fontWeight: 400, color: "#9E9690", marginLeft: 2 }}>h</span></span>
            </div>
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>ステータス</p>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: smeta?.color }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: smeta?.color }}>{smeta?.label}</span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 7 }}>詳細・説明</p>
            <RichEditor value={description} onChange={v => { setDescription(v); saveDebounced({ description: v }); }} placeholder="チケットの詳細説明、要件、受け入れ条件..." minHeight={120} />
          </div>

          {/* Ticket images */}
          <div>
            <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 7 }}>
              <ImageIcon style={{ width: 10, height: 10, display: "inline", marginRight: 4 }} />チケット添付画像
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", border: "2px dashed rgba(26,23,20,0.10)", borderRadius: 10, cursor: "pointer", background: "#FAFAF8" }}>
              <ImageIcon style={{ width: 14, height: 14, color: "#B0A9A4" }} />
              <span style={{ fontSize: 12, color: "#B0A9A4" }}>クリックして画像を追加</span>
              <input type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={e => { Array.from(e.target.files || []).forEach(f => { if (f.type.startsWith("image/")) setTicketImages(prev => [...prev, URL.createObjectURL(f)]); }); e.target.value = ""; }} />
            </label>
            {ticketImages.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {ticketImages.map((img, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img src={img} alt="" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 7, border: "1px solid rgba(26,23,20,0.08)" }} />
                    <button onClick={() => setTicketImages(prev => prev.filter((_, j) => j !== i))}
                      style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <X style={{ width: 9, height: 9, color: "#FFF" }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Source files */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                <FileCode2 style={{ width: 10, height: 10, display: "inline", marginRight: 4 }} />ソースファイル
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: "#ECFDF5", color: "#059669", fontSize: 11, fontWeight: 600, borderRadius: 7, cursor: "pointer", border: "1px solid rgba(5,150,105,0.20)" }}>
                <Paperclip style={{ width: 11, height: 11 }} />アップロード
                <input type="file" multiple style={{ display: "none" }}
                  onChange={async e => {
                    if (!e.target.files) return;
                    const round = reviewRound || 1;
                    for (const f of Array.from(e.target.files)) await uploadSourceFile(f, round);
                    if (isSupabaseEnabled && ticket) loadRelated(ticket.id);
                    else {
                      const newFiles: TicketSourceFile[] = Array.from(e.target.files).map(f => ({ id: `SF-${Date.now()}`, ticketId: ticket!.id, fileName: f.name, fileSize: f.size, fileType: f.type, uploadedBy: userName, reviewRound: round, fileUrl: "", createdAt: new Date().toISOString() }));
                      setSourceFiles(prev => [...prev, ...newFiles]);
                    }
                    setExpandedRounds(prev => new Set([...prev, round]));
                    e.target.value = "";
                  }} />
              </label>
            </div>
            {rounds.length === 0 ? (
              <div style={{ border: "2px dashed rgba(26,23,20,0.10)", borderRadius: 10, padding: "20px", textAlign: "center", color: "#C9C4BB", fontSize: 12 }}>ファイルがありません</div>
            ) : rounds.map(round => {
              const isOpen = expandedRounds.has(round);
              const files = filesByRound[round];
              return (
                <div key={round} style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, marginBottom: 6, overflow: "hidden" }}>
                  <button onClick={() => setExpandedRounds(prev => { const s = new Set(prev); isOpen ? s.delete(round) : s.add(round); return s; })}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", background: "transparent", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#1A1714" }}>
                    <span>第{round}回レビュー <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 400 }}>({files.length}ファイル)</span></span>
                    {isOpen ? <ChevronUp style={{ width: 13, height: 13, color: "#B0A9A4" }} /> : <ChevronDown style={{ width: 13, height: 13, color: "#B0A9A4" }} />}
                  </button>
                  {isOpen && (
                    <div style={{ borderTop: "1px solid rgba(26,23,20,0.06)", padding: "6px 14px" }}>
                      {files.map(f => (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(26,23,20,0.04)" }}>
                          <FileCode2 style={{ width: 13, height: 13, color: "#059669", flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {f.fileUrl
                              ? <a href={f.fileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 500, color: "#059669", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.fileName}</a>
                              : <span style={{ fontSize: 12, color: "#1A1714", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.fileName}</span>}
                            <span style={{ fontSize: 10, color: "#B0A9A4" }}>{f.uploadedBy} · {formatTs(f.createdAt)}</span>
                          </div>
                          <button onClick={() => handleDeleteSourceFile(f.id)} style={{ padding: 3, borderRadius: 5, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                            <Trash2 style={{ width: 12, height: 12 }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Review flow (担当者のみ表示) ── */}
          {isAssignee && (
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "14px 16px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#1A1714", marginBottom: 12 }}>
                レビューフロー
                {reviewRound > 0 && <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 400, marginLeft: 6 }}>第{reviewRound}回</span>}
                {status === "in-review" && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#F5F3FF", color: "#7C3AED", marginLeft: 8 }}>審査中</span>}
              </p>

              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>レビュアー</p>
                <select value={reviewerName} onChange={e => setReviewerName(e.target.value)}
                  disabled={status === "in-review"}
                  style={{ width: "100%", background: status === "in-review" ? "#F4F5F6" : "#F9F8F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 8, padding: "7px 10px", fontSize: 12, color: "#1A1714", outline: "none", cursor: status === "in-review" ? "default" : "pointer", opacity: status === "in-review" ? 0.7 : 1 }}>
                  <option value="">レビュアーを選択...</option>
                  {memberNames.filter(n => !assignees.includes(n)).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>レビュー依頼内容</p>
                <div style={{ opacity: status === "in-review" ? 0.6 : 1, pointerEvents: status === "in-review" ? "none" : "auto" }}>
                  <RichEditor value={reviewContent} onChange={setReviewContent} placeholder="レビューしてほしい内容・確認ポイントを入力..." minHeight={80} />
                </div>
              </div>

              {reviewFiles.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                  {reviewFiles.map((rf, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, background: "#F4F5F6", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "#6B6458" }}>
                      <FileCode2 style={{ width: 11, height: 11, color: "#059669" }} />{rf.name}
                      <button onClick={() => setReviewFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 0 }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#F4F5F6", color: "#6B6458", fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "1px solid rgba(26,23,20,0.10)", flexShrink: 0, opacity: status === "in-review" ? 0.5 : 1, pointerEvents: status === "in-review" ? "none" : "auto" }}>
                  <Paperclip style={{ width: 12, height: 12 }} />ファイル添付
                  <input type="file" multiple style={{ display: "none" }} onChange={e => { Array.from(e.target.files || []).forEach(f => setReviewFiles(prev => [...prev, { name: f.name, file: f }])); e.target.value = ""; }} />
                </label>
                <button onClick={handleReviewRequest}
                  disabled={!canSendReview}
                  style={{ flex: 1, padding: "7px 14px", background: canSendReview ? "#7C3AED" : "#F4F5F6", color: canSendReview ? "#FFF" : "#B0A9A4", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: canSendReview ? "pointer" : "not-allowed" }}>
                  {status === "in-review" ? "レビュー依頼中..." : "レビュー依頼を送信"}
                </button>
              </div>
              {status === "in-review" && <p style={{ fontSize: 10, color: "#7C3AED", marginTop: 6, textAlign: "center" }}>修正依頼を受けてから再度送信できます</p>}
            </div>
          )}

          {/* Comments */}
          <div>
            <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>コメント ({comments.length})</p>

            {comments.map(c => {
              const isOwn = c.userName === userName;
              const isReviewReq = c.commentType === "review_request";
              const isRevisionReq = c.commentType === "revision_request";
              const isApproved = c.commentType === "review_approved";
              const isStatusChange = c.commentType === "status_change";
              const isSystem = isReviewReq || isRevisionReq || isApproved || isStatusChange;

              const sysColor = isReviewReq ? "#7C3AED" : isRevisionReq ? "#D97706" : isApproved ? "#059669" : "#6B7280";
              const sysBg = isReviewReq ? "#F5F3FF" : isRevisionReq ? "#FFF7ED" : isApproved ? "#ECFDF5" : "#F4F5F6";
              const sysBorder = isReviewReq ? "rgba(124,58,237,0.15)" : isRevisionReq ? "rgba(217,119,6,0.15)" : isApproved ? "rgba(5,150,105,0.15)" : "rgba(26,23,20,0.08)";
              const sysLabel = isReviewReq ? "レビュー依頼" : isRevisionReq ? "修正依頼（差戻し）" : isApproved ? "✅ レビュー承認" : "";

              if (isStatusChange) {
                return (
                  <div key={c.id} style={{ margin: "6px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 1, background: "rgba(26,23,20,0.06)" }} />
                      <Avatar name={c.userName} size="xs" />
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#9E9690", whiteSpace: "nowrap" as const }}>{c.userName}</span>
                      <span style={{ fontSize: 10, color: "#C9C4BB", whiteSpace: "nowrap" as const }}>{formatTs(c.createdAt)}</span>
                      <span style={{ fontSize: 10, color: "#9E9690", whiteSpace: "nowrap" as const }}>{c.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}</span>
                      <div style={{ flex: 1, height: 1, background: "rgba(26,23,20,0.06)" }} />
                    </div>
                  </div>
                );
              }

              if (isSystem) {
                const isLatestReviewReq = isReviewReq && c.id === latestReviewReqId;
                const showReviewForm = isLatestReviewReq && canReview && status === "in-review" && editingId !== c.id;
                return (
                  <div key={c.id} style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                    <Avatar name={c.userName} size="xs" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" as const }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>{c.userName}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: sysColor, background: sysBg, padding: "2px 8px", borderRadius: 20, border: `1px solid ${sysBorder}`, flexShrink: 0 }}>{sysLabel}</span>
                        <span style={{ fontSize: 10, color: "#C9C4BB" }}>{formatTs(c.createdAt)}</span>
                        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                          {isOwn && editingId !== c.id && (
                            <button onClick={() => handleEditComment(c)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                              <Pencil style={{ width: 11, height: 11 }} />
                            </button>
                          )}
                          {isOwn && (
                            <button onClick={() => handleDeleteComment(c.id)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                              <Trash2 style={{ width: 11, height: 11 }} />
                            </button>
                          )}
                        </div>
                      </div>
                      {editingId === c.id ? (
                        <div>
                          <RichEditor value={editContent} onChange={setEditContent} minHeight={60} />
                          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            <button onClick={() => handleSaveEdit(c.id)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#059669", color: "#FFF", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", cursor: "pointer" }}>
                              <Check style={{ width: 11, height: 11 }} />保存
                            </button>
                            <button onClick={() => setEditingId(null)} style={{ padding: "5px 10px", background: "#F4F5F6", color: "#6B6458", fontSize: 11, borderRadius: 7, border: "none", cursor: "pointer" }}>キャンセル</button>
                          </div>
                        </div>
                      ) : (
                        c.content && (
                          <div style={{ background: sysBg, border: `1px solid ${sysBorder}`, borderRadius: 8, padding: "10px 12px", marginBottom: showReviewForm ? 10 : 0 }}>
                            <RichEditor value={c.content} readOnly minHeight={20} />
                          </div>
                        )
                      )}
                      {showReviewForm && (
                        <div style={{ padding: "14px 16px", background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
                          <p style={{ fontSize: 10, fontWeight: 700, color: "#6B6458", marginBottom: 8 }}>レビューコメント（任意）</p>
                          <RichEditor value={revisionInput} onChange={setRevisionInput} placeholder="指摘内容・承認コメントを入力..." minHeight={60} />
                          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                            <button onClick={() => handleRevisionRequest(revisionInput)}
                              style={{ flex: 1, padding: "8px 0", background: "#FFF7ED", color: "#D97706", fontSize: 11, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(217,119,6,0.25)", cursor: "pointer" }}>
                              修正依頼（差戻し）
                            </button>
                            <button onClick={() => handleReviewApproval(revisionInput)}
                              style={{ flex: 1, padding: "8px 0", background: "#ECFDF5", color: "#059669", fontSize: 11, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(5,150,105,0.25)", cursor: "pointer" }}>
                              ✅ レビュー承認
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              // normal comment
              return (
                <div key={c.id} style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                  <Avatar name={c.userName} size="xs" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>{c.userName}</span>
                      <StatusBadge status={c.ticketStatus} />
                      <span style={{ fontSize: 10, color: "#C9C4BB" }}>{formatTs(c.createdAt)}</span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                        {isOwn && editingId !== c.id && (
                          <button onClick={() => handleEditComment(c)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                            <Pencil style={{ width: 11, height: 11 }} />
                          </button>
                        )}
                        {isOwn && (
                          <button onClick={() => handleDeleteComment(c.id)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                            <Trash2 style={{ width: 11, height: 11 }} />
                          </button>
                        )}
                      </div>
                    </div>

                    {editingId === c.id ? (
                      <div>
                        <RichEditor value={editContent} onChange={setEditContent} minHeight={60} />
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <button onClick={() => handleSaveEdit(c.id)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#059669", color: "#FFF", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", cursor: "pointer" }}>
                            <Check style={{ width: 11, height: 11 }} />保存
                          </button>
                          <button onClick={() => setEditingId(null)} style={{ padding: "5px 10px", background: "#F4F5F6", color: "#6B6458", fontSize: 11, borderRadius: 7, border: "none", cursor: "pointer" }}>キャンセル</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 8, padding: "10px 12px" }}>
                        <RichEditor value={c.content} readOnly minHeight={20} />
                        {c.images.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                            {c.images.map((img, i) => <img key={i} src={img} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)" }} />)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Add comment */}
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <Avatar name={userName} size="xs" />
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1714" }}>{userName}</span>
                  <StatusBadge status={status} />
                </div>
              </div>
              <RichEditor value={commentText} onChange={setCommentText} placeholder="コメントを入力..." minHeight={72} />
              {commentImages.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
                  {commentImages.map((img, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={img} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6 }} />
                      <button onClick={() => setCommentImages(prev => prev.filter((_, j) => j !== i))}
                        style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <X style={{ width: 8, height: 8, color: "#FFF" }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "#B0A9A4" }}>
                  <ImageIcon style={{ width: 13, height: 13 }} />画像
                  <input type="file" accept="image/*" multiple style={{ display: "none" }}
                    onChange={e => { Array.from(e.target.files || []).forEach(f => { if (f.type.startsWith("image/")) setCommentImages(prev => [...prev, URL.createObjectURL(f)]); }); e.target.value = ""; }} />
                </label>
                <button onClick={handleAddComment} disabled={!commentText.trim()}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: !commentText.trim() ? "#F4F5F6" : "#059669", color: !commentText.trim() ? "#B0A9A4" : "#FFF", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: !commentText.trim() ? "not-allowed" : "pointer" }}>
                  投稿
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
