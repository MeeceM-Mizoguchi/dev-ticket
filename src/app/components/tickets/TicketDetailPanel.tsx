import { useEffect, useRef, useState, useCallback } from "react";
import { X, Plus, Send, Paperclip, ChevronDown, ChevronUp, Trash2, FileCode2, ImageIcon } from "lucide-react";
import type { SprintTicket, TicketComment, TicketSourceFile, Priority } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { TICKET_STATUSES } from "@/app/lib/helpers";
import { useAuth } from "@/app/contexts/AuthContext";
import { Avatar } from "@/app/components/shared/Avatar";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { mapComment, mapSourceFile } from "@/app/lib/mappers";

// ───────────────── helpers ──────────────────────────────────────────────────

function calcHoursFromDates(start: string, due: string): number {
  if (!start || !due) return 0;
  const days = Math.round((new Date(due).getTime() - new Date(start).getTime()) / 86400000);
  return Math.max(0, days) * 8;
}

function formatTs(ts: string) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function statusBadge(status: string) {
  const s = TICKET_STATUSES.find(x => x.value === status);
  return s ? (
    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: s.bg, color: s.color, flexShrink: 0 }}>
      {s.label}
    </span>
  ) : null;
}

const priorityMeta: Record<Priority, { label: string; color: string; bg: string }> = {
  high:   { label: "高", color: "#DC2626", bg: "#FEF2F2" },
  medium: { label: "中", color: "#D97706", bg: "#FFFBEB" },
  low:    { label: "低", color: "#0284C7", bg: "#F0F9FF" },
};

// ───────────────── main component ───────────────────────────────────────────

export function TicketDetailPanel({
  ticket, onClose, onUpdated,
}: { ticket: SprintTicket | null; onClose: () => void; onUpdated?: () => void }) {

  const { userName, userRole } = useAuth();

  // local editable state (synced from ticket prop)
  const [status, setStatus] = useState(ticket?.status ?? "todo");
  const [priority, setPriority] = useState<Priority>(ticket?.priority ?? "medium");
  const [assignee, setAssignee] = useState(ticket?.assignee ?? "");
  const [startDate, setStartDate] = useState(ticket?.startDate ?? "");
  const [dueDate, setDueDate] = useState(ticket?.dueDate ?? "");
  const [estimatedHours, setEstimatedHours] = useState(ticket?.estimatedHours ?? 0);
  const [progress, setProgress] = useState(ticket?.progress ?? 0);
  const [description, setDescription] = useState(ticket?.description ?? "");
  const [reviewerName, setReviewerName] = useState(ticket?.reviewerName ?? "");
  const [reviewRound, setReviewRound] = useState(ticket?.reviewRound ?? 0);

  // related data
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [sourceFiles, setSourceFiles] = useState<TicketSourceFile[]>([]);
  const [memberNames, setMemberNames] = useState<string[]>([]);

  // UI state
  const [commentText, setCommentText] = useState("");
  const [commentImages, setCommentImages] = useState<string[]>([]);
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set([1]));

  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // ── sync when ticket changes ──────────────────────────────────────────────
  useEffect(() => {
    if (!ticket) return;
    setStatus(ticket.status);
    setPriority(ticket.priority);
    setAssignee(ticket.assignee);
    setStartDate(ticket.startDate ?? "");
    setDueDate(ticket.dueDate ?? "");
    setEstimatedHours(ticket.estimatedHours);
    setProgress(ticket.progress);
    setDescription(ticket.description ?? "");
    setReviewerName(ticket.reviewerName ?? "");
    setReviewRound(ticket.reviewRound ?? 0);
    loadRelated(ticket.id);
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

  // ── auto-save helpers ────────────────────────────────────────────────────
  const save = useCallback(async (fields: Record<string, unknown>) => {
    if (!ticket || !isSupabaseEnabled) return;
    await supabase!.from("sprint_tickets").update(fields).eq("id", ticket.id);
    onUpdated?.();
  }, [ticket?.id]);

  const saveDebounced = useCallback((fields: Record<string, unknown>) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(fields), 1200);
  }, [save]);

  // ── handlers ─────────────────────────────────────────────────────────────
  const handleStatus = (v: typeof status) => { setStatus(v); save({ status: v }); };
  const handlePriority = (v: Priority) => { setPriority(v); save({ priority: v }); };
  const handleAssignee = (v: string) => { setAssignee(v); save({ assignee: v }); };

  const handleDate = (field: "start_date" | "due_date", v: string) => {
    const newStart = field === "start_date" ? v : startDate;
    const newDue   = field === "due_date"   ? v : dueDate;
    if (field === "start_date") setStartDate(v);
    else setDueDate(v);
    const h = calcHoursFromDates(newStart, newDue);
    setEstimatedHours(h);
    save({ [field]: v || null, estimated_hours: h });
  };

  const handleProgress = (v: number) => { setProgress(v); saveDebounced({ progress: v }); };
  const handleDescription = (html: string) => { setDescription(html); saveDebounced({ description: html }); };
  const handleReviewer = (v: string) => { setReviewerName(v); saveDebounced({ reviewer_name: v }); };

  const handleReviewRequest = async () => {
    if (!ticket || !reviewerName.trim()) return;
    const round = reviewRound + 1;
    setReviewRound(round);
    setStatus("in-review");
    await save({ status: "in-review", reviewer_name: reviewerName, review_round: round });
    setExpandedRounds(prev => new Set([...prev, round]));
    // post comment about review request
    await addSystemComment(`@${reviewerName} にレビュー依頼を送信しました（第${round}回）`);
  };

  const handleRevisionRequest = async () => {
    if (!ticket) return;
    setStatus("in-progress");
    await save({ status: "in-progress" });
    await addSystemComment(`@${ticket.assignee} に修正依頼を送信しました`);
  };

  const addSystemComment = async (text: string) => {
    if (!ticket || !isSupabaseEnabled) return;
    const c = { id: `CMT-${Date.now()}`, ticket_id: ticket.id, user_name: userName, content: `<p>${text}</p>`, ticket_status: status, images: [] };
    await supabase!.from("ticket_comments").insert(c);
    loadRelated(ticket.id);
  };

  const handleAddComment = async () => {
    if (!commentText.trim() || !ticket) return;
    const c = {
      id: `CMT-${Date.now()}`,
      ticket_id: ticket.id,
      user_name: userName,
      content: commentText,
      ticket_status: status,
      images: commentImages,
    };
    if (isSupabaseEnabled) {
      await supabase!.from("ticket_comments").insert(c);
    } else {
      setComments(prev => [...prev, { ...c, ticketId: ticket.id, userName: userName, ticketStatus: status, createdAt: new Date().toISOString() }]);
    }
    setCommentText("");
    setCommentImages([]);
    if (isSupabaseEnabled) loadRelated(ticket.id);
  };

  const handleDeleteComment = async (id: string) => {
    if (isSupabaseEnabled) await supabase!.from("ticket_comments").delete().eq("id", id);
    setComments(prev => prev.filter(c => c.id !== id));
  };

  const handleUploadSourceFile = async (files: FileList | null) => {
    if (!files || !ticket) return;
    const round = reviewRound || 1;
    for (const file of Array.from(files)) {
      let fileUrl = "";
      if (isSupabaseEnabled) {
        const path = `${ticket.id}/${round}/${Date.now()}_${file.name}`;
        const { data: upData } = await supabase!.storage.from("ticket-files").upload(path, file, { upsert: true });
        if (upData) {
          const { data: urlData } = supabase!.storage.from("ticket-files").getPublicUrl(path);
          fileUrl = urlData.publicUrl;
        }
      }
      const row = {
        id: `SF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ticket_id: ticket.id,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type,
        uploaded_by: userName,
        review_round: round,
        file_url: fileUrl,
      };
      if (isSupabaseEnabled) {
        await supabase!.from("ticket_source_files").insert(row);
      } else {
        setSourceFiles(prev => [...prev, { ...row, ticketId: ticket.id, fileName: file.name, fileSize: file.size, fileType: file.type, uploadedBy: userName, reviewRound: round, fileUrl, createdAt: new Date().toISOString() }]);
      }
    }
    if (isSupabaseEnabled) loadRelated(ticket.id);
    setExpandedRounds(prev => new Set([...prev, round]));
  };

  const handleDeleteSourceFile = async (id: string) => {
    if (isSupabaseEnabled) await supabase!.from("ticket_source_files").delete().eq("id", id);
    setSourceFiles(prev => prev.filter(f => f.id !== id));
  };

  if (!ticket) return null;

  const todayStr = new Date().toISOString().split("T")[0];
  const isOverdue = status !== "done" && status !== "closed" && !!dueDate && dueDate < todayStr;
  const pm = priorityMeta[priority];

  // group source files by review round
  const filesByRound = sourceFiles.reduce<Record<number, TicketSourceFile[]>>((acc, f) => {
    (acc[f.reviewRound] = acc[f.reviewRound] || []).push(f);
    return acc;
  }, {});
  const rounds = Object.keys(filesByRound).map(Number).sort((a, b) => a - b);

  const canReview = userRole === "admin" || userRole === "project-manager";

  return (
    <>
      <style>{`@keyframes slideInPanel{from{transform:translateX(102%)}to{transform:translateX(0)}}`}</style>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(10,14,12,0.30)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "56%", minWidth: 520, background: "#FAFAF8", zIndex: 201, boxShadow: "-16px 0 60px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", animation: "slideInPanel 0.28s cubic-bezier(0.16,1,0.3,1)" }}>

        {/* ── Header ── */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFF", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", background: "#F4F5F6", padding: "2px 8px", borderRadius: 5 }}>{ticket.id}</span>
                {ticket.wbs && <span style={{ fontSize: 10, color: "#C9C4BB", fontFamily: "var(--font-mono)" }}>WBS {ticket.wbs}</span>}
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

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ── Status buttons ── */}
          <div>
            <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 7 }}>ステータス</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {TICKET_STATUSES.map(s => (
                <button key={s.value} onClick={() => handleStatus(s.value)}
                  style={{ padding: "5px 11px", fontSize: 11, fontWeight: 700, borderRadius: 8, border: `1.5px solid ${status === s.value ? s.color : "rgba(26,23,20,0.10)"}`, background: status === s.value ? s.bg : "transparent", color: status === s.value ? s.color : "#9E9690", cursor: "pointer", transition: "all 0.12s" }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Metadata grid ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {/* Assignee */}
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>担当者</p>
              <select value={assignee} onChange={e => handleAssignee(e.target.value)}
                style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 13, fontWeight: 600, color: "#1A1714", cursor: "pointer" }}>
                {memberNames.length > 0
                  ? memberNames.map(n => <option key={n} value={n}>{n}</option>)
                  : <option value={assignee}>{assignee || "—"}</option>
                }
              </select>
            </div>
            {/* Priority */}
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>優先度</p>
              <select value={priority} onChange={e => handlePriority(e.target.value as Priority)}
                style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 13, fontWeight: 600, color: pm.color, cursor: "pointer" }}>
                {(["high", "medium", "low"] as Priority[]).map(p => (
                  <option key={p} value={p}>{priorityMeta[p].label}</option>
                ))}
              </select>
            </div>
            {/* Start date */}
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>開始日</p>
              <input type="date" value={startDate} onChange={e => handleDate("start_date", e.target.value)}
                style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 12, color: "#6B6458", fontFamily: "var(--font-mono)", cursor: "pointer" }} />
            </div>
            {/* Due date */}
            <div style={{ background: "#FFF", border: `1px solid ${isOverdue ? "rgba(220,38,38,0.30)" : "rgba(26,23,20,0.07)"}`, borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: isOverdue ? "#DC2626" : "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>期限日 {isOverdue ? "⚠" : ""}</p>
              <input type="date" value={dueDate} onChange={e => handleDate("due_date", e.target.value)}
                style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 12, color: isOverdue ? "#DC2626" : "#6B6458", fontFamily: "var(--font-mono)", fontWeight: isOverdue ? 700 : 400, cursor: "pointer" }} />
            </div>
            {/* Estimated hours (auto-calc) */}
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>見積工数（自動計算）</p>
              <span style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{estimatedHours}<span style={{ fontSize: 11, fontWeight: 400, color: "#9E9690", marginLeft: 2 }}>h</span></span>
            </div>
            {/* Progress */}
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>進捗: {progress}%</p>
              <input type="range" min={0} max={100} value={progress} onChange={e => handleProgress(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#059669", cursor: "pointer" }} />
            </div>
          </div>

          {/* ── Description (rich text) ── */}
          <div>
            <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 7 }}>詳細・説明</p>
            <RichEditor value={description} onChange={handleDescription} placeholder="チケットの詳細説明、要件、受け入れ条件などを入力..." minHeight={140} />
          </div>

          {/* ── Image attachments ── */}
          <div>
            <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 7 }}>
              <ImageIcon style={{ width: 10, height: 10, display: "inline", marginRight: 4 }} />画像添付
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", border: "2px dashed rgba(26,23,20,0.10)", borderRadius: 10, cursor: "pointer", background: "#FAFAF8" }}>
              <Plus style={{ width: 14, height: 14, color: "#B0A9A4" }} />
              <span style={{ fontSize: 12, color: "#B0A9A4" }}>画像をクリックして追加</span>
              <input type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={e => {
                  Array.from(e.target.files || []).forEach(file => {
                    if (!file.type.startsWith("image/")) return;
                    const url = URL.createObjectURL(file);
                    // store in comment images or ticket description as attachment
                    setCommentImages(prev => [...prev, url]);
                  });
                  e.target.value = "";
                }} />
            </label>
          </div>

          {/* ── Source files (versioned accordion) ── */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                <FileCode2 style={{ width: 10, height: 10, display: "inline", marginRight: 4 }} />ソースファイル
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: "#ECFDF5", color: "#059669", fontSize: 11, fontWeight: 600, borderRadius: 7, cursor: "pointer", border: "1px solid rgba(5,150,105,0.20)" }}>
                <Paperclip style={{ width: 11, height: 11 }} />アップロード
                <input type="file" multiple style={{ display: "none" }} onChange={e => handleUploadSourceFile(e.target.files)} />
              </label>
            </div>

            {rounds.length === 0 ? (
              <div style={{ background: "#FFF", border: "2px dashed rgba(26,23,20,0.10)", borderRadius: 10, padding: "20px", textAlign: "center", color: "#C9C4BB", fontSize: 12 }}>
                ファイルがありません
              </div>
            ) : rounds.map(round => {
              const isOpen = expandedRounds.has(round);
              const files = filesByRound[round];
              return (
                <div key={round} style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, marginBottom: 6, overflow: "hidden" }}>
                  <button onClick={() => setExpandedRounds(prev => { const s = new Set(prev); isOpen ? s.delete(round) : s.add(round); return s; })}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "transparent", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#1A1714" }}>
                    <span>第{round}回レビュー <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 400 }}>({files.length}ファイル)</span></span>
                    {isOpen ? <ChevronUp style={{ width: 13, height: 13, color: "#B0A9A4" }} /> : <ChevronDown style={{ width: 13, height: 13, color: "#B0A9A4" }} />}
                  </button>
                  {isOpen && (
                    <div style={{ borderTop: "1px solid rgba(26,23,20,0.06)", padding: "8px 14px" }}>
                      {files.map(f => (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(26,23,20,0.04)" }}>
                          <FileCode2 style={{ width: 14, height: 14, color: "#059669", flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {f.fileUrl
                              ? <a href={f.fileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 500, color: "#059669", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{f.fileName}</a>
                              : <span style={{ fontSize: 12, fontWeight: 500, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{f.fileName}</span>
                            }
                            <span style={{ fontSize: 10, color: "#B0A9A4" }}>{f.uploadedBy} · {formatTs(f.createdAt)}</span>
                          </div>
                          <button onClick={() => handleDeleteSourceFile(f.id)} style={{ padding: 4, borderRadius: 5, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
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

          {/* ── Review flow ── */}
          <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "14px 16px" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#1A1714", marginBottom: 10 }}>レビューフロー {reviewRound > 0 && <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 400 }}>（第{reviewRound}回）</span>}</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input value={reviewerName} onChange={e => handleReviewer(e.target.value)} placeholder="レビュアー名を入力..."
                list="reviewer-list"
                style={{ flex: 1, background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 8, padding: "7px 10px", fontSize: 12, outline: "none", color: "#1A1714" }} />
              <datalist id="reviewer-list">
                {memberNames.map(n => <option key={n} value={n} />)}
              </datalist>
              <button onClick={handleReviewRequest} disabled={!reviewerName.trim()}
                style={{ padding: "7px 14px", background: !reviewerName.trim() ? "#F4F5F6" : "#7C3AED", color: !reviewerName.trim() ? "#B0A9A4" : "#FFF", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: !reviewerName.trim() ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                レビュー依頼
              </button>
            </div>
            {canReview && (
              <button onClick={handleRevisionRequest}
                style={{ padding: "7px 14px", background: "#FFF7ED", color: "#D97706", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(217,119,6,0.25)", cursor: "pointer", width: "100%" }}>
                修正依頼（担当者に差し戻し）
              </button>
            )}
          </div>

          {/* ── Comments ── */}
          <div>
            <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>コメント ({comments.length})</p>

            {comments.map(c => (
              <div key={c.id} style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <Avatar name={c.userName} size="xs" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>{c.userName}</span>
                    {statusBadge(c.ticketStatus)}
                    <span style={{ fontSize: 10, color: "#C9C4BB" }}>{formatTs(c.createdAt)}</span>
                    <button onClick={() => handleDeleteComment(c.id)} style={{ marginLeft: "auto", padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                      <Trash2 style={{ width: 11, height: 11 }} />
                    </button>
                  </div>
                  <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 8, padding: "10px 12px" }}>
                    <RichEditor value={c.content} readOnly minHeight={20} />
                  </div>
                  {c.images.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {c.images.map((img, i) => (
                        <img key={i} src={img} alt="" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)" }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Add comment */}
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <Avatar name={userName} size="xs" />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1714", alignSelf: "center" }}>{userName}</span>
                {statusBadge(status)}
              </div>
              <RichEditor value={commentText} onChange={setCommentText} placeholder="コメントを入力... (@名前でメンション)" minHeight={80} />
              {commentImages.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
                  {commentImages.map((img, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={img} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6 }} />
                      <button onClick={() => setCommentImages(prev => prev.filter((_, j) => j !== i))}
                        style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <X style={{ width: 8, height: 8, color: "#FFF" }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "#B0A9A4" }}>
                  <ImageIcon style={{ width: 13, height: 13 }} />画像添付
                  <input type="file" accept="image/*" multiple style={{ display: "none" }}
                    onChange={e => {
                      Array.from(e.target.files || []).forEach(f => { if (f.type.startsWith("image/")) setCommentImages(prev => [...prev, URL.createObjectURL(f)]); });
                      e.target.value = "";
                    }} />
                </label>
                <button onClick={handleAddComment} disabled={!commentText.trim()}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: !commentText.trim() ? "#F4F5F6" : "#059669", color: !commentText.trim() ? "#B0A9A4" : "#FFF", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: !commentText.trim() ? "not-allowed" : "pointer" }}>
                  <Send style={{ width: 12, height: 12 }} />投稿
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
