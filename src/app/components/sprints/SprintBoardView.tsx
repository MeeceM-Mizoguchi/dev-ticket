import { useState, useCallback, useEffect, useRef } from "react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { ExternalLink, X, MessageSquare, Paperclip, User, Plus, AlertCircle, ChevronsRight } from "lucide-react";
import type { Sprint, SprintTicket, TicketStatus } from "@/app/types";
import { TICKET_STATUSES, formatDate } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { MEMBERS } from "@/app/data/mock";

const DRAG_TYPE = "SPRINT_TICKET";

const MODAL_STATUSES: TicketStatus[] = ["in-review", "review-done"];

const MODAL_LABELS: Partial<Record<TicketStatus, { title: string; placeholder: string; commentType: string }>> = {
  "in-review":    { title: "レビュー依頼", placeholder: "レビュー依頼の内容・確認ポイントを入力（任意）...", commentType: "review_request" },
  "review-done":  { title: "レビュー承認", placeholder: "承認コメントを入力（任意）...", commentType: "review_approved" },
};

const STATUS_RANK: Record<TicketStatus, number> = {
  "todo": 0, "in-progress": 1, "in-review": 2, "review-done": 3,
  "stg-test": 4, "uat": 5, "done": 6, "closed": 7,
};

interface DragItem { id: string; sprintId: string; currentStatus: TicketStatus }
interface PendingDrop { ticketId: string; sprintId: string; newStatus: TicketStatus }
interface PendingError {
  ticketId: string;
  message: string;
  skipLabel?: string;
  skipStatus?: TicketStatus;
}

function validateDrop(
  ticket: SprintTicket,
  newStatus: TicketStatus,
  userName: string,
  canSkipReview: boolean
): PendingError | null {
  const currentRank = STATUS_RANK[ticket.status] ?? 0;
  const newRank = STATUS_RANK[newStatus] ?? 0;

  // in-review: 担当者のみ
  if (newStatus === "in-review") {
    const assignees = ticket.assignees?.length ? ticket.assignees : (ticket.assignee ? [ticket.assignee] : []);
    if (assignees.length > 0 && !assignees.includes(userName)) {
      return {
        ticketId: ticket.id,
        message: "このチケットの担当者のみレビュー依頼を送信できます",
      };
    }
  }

  // review-done へ in-review を経由せずに移動
  if (newStatus === "review-done" && currentRank < STATUS_RANK["in-review"]) {
    if (canSkipReview) {
      return {
        ticketId: ticket.id,
        message: "レビュー依頼が完了していません。\nレビューをスキップしてレビュー完了に進みますか？",
        skipLabel: "レビュースキップ → レビュー完了へ",
        skipStatus: "review-done",
      };
    }
    return {
      ticketId: ticket.id,
      message: "レビュー依頼が完了していないため移動できません",
    };
  }

  // stg-test 以降へ review-done を経由せずに移動
  if (newRank >= STATUS_RANK["stg-test"] && currentRank < STATUS_RANK["review-done"]) {
    return {
      ticketId: ticket.id,
      message: "レビュー完了していないため移動できません",
    };
  }

  return null;
}

// ── Draggable ticket card ──────────────────────────────────────────────────
function TicketCard({ ticket, sprintId, onSelect }: {
  ticket: SprintTicket; sprintId: string; onSelect?: (t: SprintTicket) => void;
}) {
  const [{ isDragging }, drag] = useDrag<DragItem, void, { isDragging: boolean }>(() => ({
    type: DRAG_TYPE,
    item: { id: ticket.id, sprintId, currentStatus: ticket.status },
    collect: m => ({ isDragging: m.isDragging() }),
  }), [ticket.id, sprintId, ticket.status]);

  const priBg    = ticket.priority === "high" ? "#FEF2F2" : ticket.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
  const priColor = ticket.priority === "high" ? "#DC2626"  : ticket.priority === "medium" ? "#D97706"  : "#0284C7";
  const priLabel = ticket.priority === "high" ? "高"       : ticket.priority === "medium" ? "中"       : "低";

  return (
    <div ref={drag} onClick={() => onSelect?.(ticket)}
      style={{ background: "#FFF", borderRadius: 9, padding: "10px 12px", border: "1px solid rgba(26,23,20,0.08)", marginBottom: 6, cursor: "grab", opacity: isDragging ? 0.35 : 1, transition: "opacity 0.15s, box-shadow 0.15s", boxShadow: isDragging ? "none" : "0 1px 3px rgba(0,0,0,0.04)" }}
      onMouseEnter={e => { if (!isDragging) (e.currentTarget as HTMLElement).style.boxShadow = "0 3px 10px rgba(0,0,0,0.10)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = isDragging ? "none" : "0 1px 3px rgba(0,0,0,0.04)"; }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: "#1A1714", marginBottom: 6, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>{ticket.title}</p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden" }}>
          <Avatar name={ticket.assignee} size="xs" />
          <span style={{ fontSize: 10, color: "#9E9690", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{ticket.assignee || "未割当"}</span>
        </div>
        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: priBg, color: priColor, flexShrink: 0 }}>{priLabel}</span>
      </div>
    </div>
  );
}

// ── Droppable status column ────────────────────────────────────────────────
function DropColumn({ sprintId, col, tickets, onDrop, onSelectTicket, style: extraStyle }: {
  sprintId: string;
  col: typeof TICKET_STATUSES[number];
  tickets: SprintTicket[];
  onDrop: (item: DragItem, targetStatus: TicketStatus) => void;
  onSelectTicket?: (t: SprintTicket) => void;
  style?: React.CSSProperties;
}) {
  const [{ isOver, canDrop }, drop] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>(() => ({
    accept: DRAG_TYPE,
    canDrop: item => item.sprintId === sprintId && item.currentStatus !== col.value,
    drop: item => onDrop(item, col.value),
    collect: m => ({ isOver: m.isOver(), canDrop: m.canDrop() }),
  }), [sprintId, col.value, onDrop]);

  const isActive = isOver && canDrop;

  return (
    <div ref={drop} style={{ borderRadius: 8, padding: 8, minHeight: 120, transition: "background 0.15s, border-color 0.15s",
      background: isActive ? col.bg : "rgba(26,23,20,0.02)",
      border: `1.5px ${isActive ? "solid" : "dashed"} ${isActive ? col.color + "55" : "rgba(26,23,20,0.08)"}`,
      ...extraStyle }}>
      {tickets.length === 0 && !isActive && (
        <div style={{ padding: "20px 0", textAlign: "center" as const, color: "#D5D0CB", fontSize: 11 }}>なし</div>
      )}
      {tickets.map(t => <TicketCard key={t.id} ticket={t} sprintId={sprintId} onSelect={onSelectTicket} />)}
    </div>
  );
}

// ── Main component (exported) ──────────────────────────────────────────────
function SprintBoardInner({ sprints, onSelectSprint, onSelectTicket, onUpdated, onCreateTicket }: {
  sprints: Sprint[];
  onSelectSprint: (s: Sprint) => void;
  onSelectTicket?: (t: SprintTicket) => void;
  onUpdated?: () => void;
  onCreateTicket?: (sprintId: string) => void;
}) {
  const { userName, userPermissions } = useAuth();
  const canCreateTicket = userPermissions.canCreateTicket;
  const canSkipReview = userPermissions.canSkipReview;

  const [selectedSprintId, setSelectedSprintId] = useState(sprints[0]?.id ?? "");
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [pendingError, setPendingError] = useState<PendingError | null>(null);
  const [modalComment, setModalComment] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [reviewerList, setReviewerList] = useState<string[]>(MEMBERS.map(m => m.name));
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const currentSprint = sprints.find(s => s.id === selectedSprintId) ?? sprints[0] ?? null;
  const currentSprintRef = useRef(currentSprint);
  currentSprintRef.current = currentSprint;

  // Keep selectedSprintId valid when sprints prop changes
  useEffect(() => {
    if (sprints.length && !sprints.find(s => s.id === selectedSprintId)) {
      setSelectedSprintId(sprints[0].id);
    }
  }, [sprints, selectedSprintId]);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!.from("profiles").select("name").order("name")
      .then(({ data }) => { if (data?.length) setReviewerList(data.map((d: { name: string }) => d.name)); });
  }, []);

  const applyStatusUpdate = useCallback(async (
    ticketId: string, newStatus: TicketStatus, comment: string,
    reviewer?: string, srcFile?: File | null, srcUrl?: string
  ) => {
    setSaving(true);
    try {
      if (isSupabaseEnabled) {
        const updateData: Record<string, unknown> = { status: newStatus };
        if (newStatus === "in-review" && reviewer) updateData.reviewer_name = reviewer;
        await supabase!.from("sprint_tickets").update(updateData).eq("id", ticketId);

        if (comment.trim()) {
          const meta = MODAL_LABELS[newStatus];
          await supabase!.from("ticket_comments").insert({
            id: `CMT-${Date.now()}`, ticket_id: ticketId, user_name: userName,
            content: `<p>${comment.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
            ticket_status: newStatus, comment_type: meta?.commentType ?? "comment", images: [],
          });
        }

        if (newStatus === "in-review") {
          if (srcFile) {
            const path = `${ticketId}/${Date.now()}_${srcFile.name}`;
            const { data: uploadData } = await supabase!.storage.from("ticket-files").upload(path, srcFile);
            if (uploadData) {
              const { data: urlData } = supabase!.storage.from("ticket-files").getPublicUrl(path);
              await supabase!.from("ticket_source_files").insert({
                id: `SF-${Date.now()}`, ticket_id: ticketId, file_name: srcFile.name, file_size: srcFile.size,
                file_type: srcFile.type, uploaded_by: userName, review_round: 1,
                file_url: urlData.publicUrl, created_at: new Date().toISOString(),
              });
            }
          } else if (srcUrl?.trim()) {
            await supabase!.from("ticket_source_files").insert({
              id: `SF-${Date.now()}`, ticket_id: ticketId, file_name: srcUrl, file_size: 0,
              file_type: "url", uploaded_by: userName, review_round: 1,
              file_url: srcUrl, created_at: new Date().toISOString(),
            });
          }
        }
      }
      onUpdated?.();
    } finally {
      setSaving(false);
      setPendingDrop(null);
      setPendingError(null);
      setModalComment("");
      setReviewerName("");
      setSourceUrl("");
      setSourceFile(null);
    }
  }, [userName, onUpdated]);

  const handleDrop = useCallback((item: DragItem, newStatus: TicketStatus) => {
    const sprint = currentSprintRef.current;
    if (!sprint) return;
    const ticket = sprint.tickets.find(t => t.id === item.id);

    if (ticket) {
      const err = validateDrop(ticket, newStatus, userName, canSkipReview);
      if (err) {
        setPendingError(err);
        return;
      }
    }

    if (MODAL_STATUSES.includes(newStatus)) {
      setPendingDrop({ ticketId: item.id, sprintId: item.sprintId, newStatus });
    } else {
      applyStatusUpdate(item.id, newStatus, "");
    }
  }, [applyStatusUpdate, userName, canSkipReview]);

  const confirmModal = () => {
    if (!pendingDrop || saving) return;
    applyStatusUpdate(pendingDrop.ticketId, pendingDrop.newStatus, modalComment, reviewerName, sourceFile, sourceUrl);
  };

  const handleSkipFromModal = () => {
    if (!pendingDrop || saving) return;
    applyStatusUpdate(pendingDrop.ticketId, "review-done", modalComment || "レビュースキップ");
  };

  const cancelModal = () => { setPendingDrop(null); setModalComment(""); setReviewerName(""); setSourceUrl(""); setSourceFile(null); };

  const modalMeta = pendingDrop ? MODAL_LABELS[pendingDrop.newStatus] : null;
  const isReviewRequest = pendingDrop?.newStatus === "in-review";

  if (sprints.length === 0) return (
    <div style={{ padding: "48px 0", textAlign: "center", color: "#C9C4BB", fontSize: 13 }}>スプリントがありません</div>
  );

  return (
    <div>
      {/* ── Tab bar ── */}
      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid rgba(26,23,20,0.08)", marginBottom: 16, flexWrap: "wrap" as const }}>
        {sprints.map(sprint => {
          const isActive = sprint.id === selectedSprintId;
          return (
            <button key={sprint.id} onClick={() => setSelectedSprintId(sprint.id)}
              style={{ padding: "10px 16px", fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? "#059669" : "#6B6458", border: "none", borderBottom: isActive ? "2px solid #059669" : "2px solid transparent", background: "transparent", cursor: "pointer", whiteSpace: "nowrap" as const, transition: "all 0.15s", marginBottom: -2 }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = "#1A1714"; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = "#6B6458"; }}>
              {sprint.name}
            </button>
          );
        })}
      </div>

      {/* ── Sprint info bar ── */}
      {currentSprint && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "0 2px" }}>
          {currentSprint.goal && (
            <p style={{ flex: 1, fontSize: 12, color: "#9E9690", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, minWidth: 0 }}>{currentSprint.goal}</p>
          )}
          {!currentSprint.goal && <div style={{ flex: 1 }} />}
          <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" as const, flexShrink: 0 }}>{formatDate(currentSprint.startDate)} → {formatDate(currentSprint.endDate)}</span>
          <button onClick={() => onSelectSprint(currentSprint)}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#059669", background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.20)", borderRadius: 7, cursor: "pointer", flexShrink: 0 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#D1FAE5"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}>
            <ExternalLink style={{ width: 11, height: 11 }} />詳細
          </button>
          {onCreateTicket && canCreateTicket && (
            <button onClick={() => onCreateTicket(currentSprint.id)}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#7C3AED", background: "#F5F3FF", border: "1px solid rgba(124,58,237,0.20)", borderRadius: 7, cursor: "pointer", flexShrink: 0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#EDE9FE"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F5F3FF"; }}>
              <Plus style={{ width: 11, height: 11 }} />新規チケット
            </button>
          )}
        </div>
      )}

      {/* ── Kanban board ── */}
      {currentSprint && (
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 8, minWidth: "fit-content", minHeight: "calc(100vh - 390px)" }}>
            {TICKET_STATUSES.map(col => {
              const colTickets = currentSprint.tickets.filter(t => t.status === col.value);
              return (
                <div key={col.value} style={{ flex: "0 0 180px", display: "flex", flexDirection: "column", gap: 4 }}>
                  {/* Column header */}
                  <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", borderRadius: 6, background: col.bg }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: col.color }}>{col.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: col.color, fontFamily: "var(--font-mono)" }}>{colTickets.length}</span>
                  </div>
                  {/* Drop zone */}
                  <DropColumn sprintId={currentSprint.id} col={col} tickets={colTickets} onDrop={handleDrop} onSelectTicket={onSelectTicket}
                    style={{ flex: 1 }} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Validation error / skip modal ── */}
      {pendingError && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.40)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setPendingError(null); }}>
          <div style={{ background: "#FFF", borderRadius: 16, padding: "28px 28px 24px", width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.20)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 22 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: pendingError.skipStatus ? "#FFF7ED" : "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <AlertCircle style={{ width: 20, height: 20, color: pendingError.skipStatus ? "#D97706" : "#DC2626" }} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 14, fontWeight: 800, color: "#1A1714", marginBottom: 8, fontFamily: "var(--font-heading)" }}>移動できません</h3>
                <p style={{ fontSize: 13, color: "#6B6458", lineHeight: 1.65 }}>
                  {pendingError.message.split("\n").map((line, i, arr) => (
                    <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
                  ))}
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {pendingError.skipStatus && (
                <button
                  onClick={() => { applyStatusUpdate(pendingError!.ticketId, pendingError!.skipStatus!, ""); }}
                  disabled={saving}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", background: saving ? "#F4F5F6" : "#FFFBEB", color: saving ? "#B0A9A4" : "#F59E0B", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "1.5px solid rgba(245,158,11,0.35)", cursor: saving ? "not-allowed" : "pointer", transition: "background 0.15s" }}
                  onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLElement).style.background = "#FEF3C7"; }}
                  onMouseLeave={e => { if (!saving) (e.currentTarget as HTMLElement).style.background = "#FFFBEB"; }}>
                  <ChevronsRight style={{ width: 14, height: 14 }} />
                  {pendingError.skipLabel}
                </button>
              )}
              <button onClick={() => setPendingError(null)}
                style={{ padding: "10px 20px", background: "#F4F5F6", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer", flexShrink: 0 }}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Review modal ── */}
      {pendingDrop && modalMeta && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.40)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) cancelModal(); }}>
          <div style={{ background: "#FFFFFF", borderRadius: 16, padding: "28px 28px 24px", width: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.20)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{modalMeta.title}</h3>
                <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>ステータスを変更します。各項目は省略可能です。</p>
              </div>
              <button onClick={cancelModal} style={{ padding: 6, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
              <MessageSquare style={{ width: 12, height: 12, color: "#B0A9A4" }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>コメント（任意）</span>
            </div>
            <textarea value={modalComment} onChange={e => setModalComment(e.target.value)}
              placeholder={modalMeta.placeholder}
              style={{ width: "100%", minHeight: 80, padding: "10px 12px", background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, fontSize: 13, color: "#1A1714", resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" as const }}
              onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = "#059669"; (e.currentTarget as HTMLElement).style.background = "#FFF"; }}
              onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.10)"; (e.currentTarget as HTMLElement).style.background = "#F9F8F6"; }} />

            {isReviewRequest && (
              <>
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                    <User style={{ width: 12, height: 12, color: "#B0A9A4" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>レビュアー（任意）</span>
                  </div>
                  <select value={reviewerName} onChange={e => setReviewerName(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, fontSize: 13, color: reviewerName ? "#1A1714" : "#B0A9A4", cursor: "pointer", boxSizing: "border-box" as const, outline: "none" }}
                    onFocus={e => { e.currentTarget.style.borderColor = "#059669"; e.currentTarget.style.background = "#FFF"; }}
                    onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; e.currentTarget.style.background = "#F9F8F6"; }}>
                    <option value="">担当者を選択...</option>
                    {reviewerList.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                    <Paperclip style={{ width: 12, height: 12, color: "#B0A9A4" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>ソースファイル（任意）</span>
                  </div>
                  <input type="text" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}
                    placeholder="URLを入力（例: https://github.com/...）"
                    style={{ width: "100%", padding: "9px 12px", background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, fontSize: 13, color: "#1A1714", outline: "none", boxSizing: "border-box" as const, marginBottom: 8, fontFamily: "inherit" }}
                    onFocus={e => { e.currentTarget.style.borderColor = "#059669"; e.currentTarget.style.background = "#FFF"; }}
                    onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; e.currentTarget.style.background = "#F9F8F6"; }} />
                  <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#F4F5F6", border: "1.5px dashed rgba(26,23,20,0.15)", borderRadius: 9, cursor: "pointer", fontSize: 12, color: sourceFile ? "#1A1714" : "#9E9690", boxSizing: "border-box" as const }}>
                    <Paperclip style={{ width: 13, height: 13, color: "#B0A9A4", flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{sourceFile ? sourceFile.name : "ファイルを選択..."}</span>
                    <input type="file" style={{ display: "none" }} onChange={e => setSourceFile(e.target.files?.[0] ?? null)} />
                  </label>
                  {sourceFile && (
                    <button onClick={() => setSourceFile(null)} style={{ marginTop: 4, fontSize: 11, color: "#B0A9A4", background: "none", border: "none", cursor: "pointer", padding: 0 }}>削除</button>
                  )}
                </div>
              </>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button onClick={confirmModal} disabled={saving}
                style={{ flex: 1, padding: "10px 0", background: saving ? "#F4F5F6" : "#059669", color: saving ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: saving ? "not-allowed" : "pointer" }}>
                {saving ? "処理中..." : "確定"}
              </button>
              <button onClick={cancelModal} disabled={saving}
                style={{ flex: 1, padding: "10px 0", background: "#F4F5F6", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer" }}>
                キャンセル
              </button>
            </div>

            {/* レビュースキップボタン（canSkipReview かつ in-review モーダル） */}
            {isReviewRequest && canSkipReview && (
              <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)", marginTop: 16, paddingTop: 16 }}>
                <button onClick={handleSkipFromModal} disabled={saving}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 0", background: saving ? "#F4F5F6" : "#FFFBEB", color: saving ? "#B0A9A4" : "#F59E0B", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "1.5px solid rgba(245,158,11,0.35)", cursor: saving ? "not-allowed" : "pointer", transition: "background 0.15s" }}
                  onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLElement).style.background = "#FEF3C7"; }}
                  onMouseLeave={e => { if (!saving) (e.currentTarget as HTMLElement).style.background = "#FFFBEB"; }}>
                  <ChevronsRight style={{ width: 14, height: 14 }} />
                  レビュースキップ → レビュー完了へ
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SprintBoardView(props: {
  sprints: Sprint[];
  onSelectSprint: (s: Sprint) => void;
  onSelectTicket?: (t: SprintTicket) => void;
  onUpdated?: () => void;
  onCreateTicket?: (sprintId: string) => void;
}) {
  return (
    <DndProvider backend={HTML5Backend}>
      <SprintBoardInner {...props} />
    </DndProvider>
  );
}
