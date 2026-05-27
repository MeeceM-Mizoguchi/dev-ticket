import { useState, useCallback } from "react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { ChevronDown, ExternalLink, X, MessageSquare } from "lucide-react";
import type { Sprint, SprintTicket, TicketStatus } from "@/app/types";
import { TICKET_STATUSES, getSprintStatusMeta, formatDate } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";

const DRAG_TYPE = "SPRINT_TICKET";

// Statuses that trigger a comment modal on drop
const MODAL_STATUSES: TicketStatus[] = ["in-review", "review-done"];

const MODAL_LABELS: Partial<Record<TicketStatus, { title: string; placeholder: string; commentType: string }>> = {
  "in-review":    { title: "レビュー依頼", placeholder: "レビュー依頼の内容・確認ポイントを入力（任意）...", commentType: "review_request" },
  "review-done":  { title: "レビュー承認", placeholder: "承認コメントを入力（任意）...", commentType: "review_approved" },
};

interface DragItem { id: string; sprintId: string; currentStatus: TicketStatus }
interface PendingDrop { ticketId: string; sprintId: string; newStatus: TicketStatus }

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
function DropColumn({ sprintId, col, tickets, onDrop, onSelectTicket }: {
  sprintId: string;
  col: typeof TICKET_STATUSES[number];
  tickets: SprintTicket[];
  onDrop: (item: DragItem, targetStatus: TicketStatus) => void;
  onSelectTicket?: (t: SprintTicket) => void;
}) {
  const [{ isOver, canDrop }, drop] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>(() => ({
    accept: DRAG_TYPE,
    canDrop: item => item.sprintId === sprintId && item.currentStatus !== col.value,
    drop: item => onDrop(item, col.value),
    collect: m => ({ isOver: m.isOver(), canDrop: m.canDrop() }),
  }), [sprintId, col.value, onDrop]);

  const isActive = isOver && canDrop;

  return (
    <div ref={drop} style={{ flex: "0 0 170px", borderRadius: 8, padding: 8, minHeight: 80, transition: "background 0.15s, border-color 0.15s",
      background: isActive ? col.bg : "rgba(26,23,20,0.02)",
      border: `1.5px ${isActive ? "solid" : "dashed"} ${isActive ? col.color + "55" : "rgba(26,23,20,0.08)"}` }}>
      {tickets.length === 0 && !isActive && (
        <div style={{ padding: "20px 0", textAlign: "center" as const, color: "#D5D0CB", fontSize: 11 }}>なし</div>
      )}
      {tickets.map(t => <TicketCard key={t.id} ticket={t} sprintId={sprintId} onSelect={onSelectTicket} />)}
    </div>
  );
}

// ── Main component (exported) ──────────────────────────────────────────────
function SprintBoardInner({ sprints, onSelectSprint, onSelectTicket, onUpdated }: {
  sprints: Sprint[];
  onSelectSprint: (s: Sprint) => void;
  onSelectTicket?: (t: SprintTicket) => void;
  onUpdated?: () => void;
}) {
  const { userName } = useAuth();
  const [expanded, setExpanded] = useState<Set<string>>(new Set(sprints.map(s => s.id)));
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [modalComment, setModalComment] = useState("");
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const applyStatusUpdate = useCallback(async (ticketId: string, newStatus: TicketStatus, comment: string) => {
    setSaving(true);
    try {
      if (isSupabaseEnabled) {
        await supabase!.from("sprint_tickets").update({ status: newStatus }).eq("id", ticketId);
        if (comment.trim()) {
          const meta = MODAL_LABELS[newStatus];
          await supabase!.from("ticket_comments").insert({
            id: `CMT-${Date.now()}`,
            ticket_id: ticketId,
            user_name: userName,
            content: `<p>${comment.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
            ticket_status: newStatus,
            comment_type: meta?.commentType ?? "comment",
            images: [],
          });
        }
      }
      onUpdated?.();
    } finally {
      setSaving(false);
      setPendingDrop(null);
      setModalComment("");
    }
  }, [userName, onUpdated]);

  const handleDrop = useCallback((item: DragItem, newStatus: TicketStatus) => {
    if (MODAL_STATUSES.includes(newStatus)) {
      setPendingDrop({ ticketId: item.id, sprintId: item.sprintId, newStatus });
    } else {
      applyStatusUpdate(item.id, newStatus, "");
    }
  }, [applyStatusUpdate]);

  const confirmModal = () => {
    if (!pendingDrop || saving) return;
    applyStatusUpdate(pendingDrop.ticketId, pendingDrop.newStatus, modalComment);
  };

  const cancelModal = () => { setPendingDrop(null); setModalComment(""); };

  const modalMeta = pendingDrop ? MODAL_LABELS[pendingDrop.newStatus] : null;

  return (
    <div>
      {sprints.length === 0 && (
        <div style={{ padding: "48px 0", textAlign: "center", color: "#C9C4BB", fontSize: 13 }}>スプリントがありません</div>
      )}

      {sprints.map(sprint => {
        const isExp = expanded.has(sprint.id);
        const sm = getSprintStatusMeta(sprint.status);

        return (
          <div key={sprint.id} style={{ background: "#FFFFFF", borderRadius: 12, border: "1px solid rgba(26,23,20,0.08)", marginBottom: 12, overflow: "hidden" }}>
            {/* Sprint swimlane header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", background: "#F9F8F6", cursor: "pointer", borderBottom: isExp ? "1px solid rgba(26,23,20,0.06)" : "none" }}
              onClick={() => toggle(sprint.id)}>
              <ChevronDown style={{ width: 13, height: 13, color: "#B0A9A4", transform: isExp ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{sprint.name}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 8px", borderRadius: 20, background: sm.bg, color: sm.color }}>{sm.label}</span>
                  <span style={{ fontSize: 10, color: "#B0A9A4" }}>{sprint.tickets.length}チケット</span>
                </div>
                {sprint.goal && <p style={{ fontSize: 11, color: "#A09790", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{sprint.goal}</p>}
              </div>
              <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" as const, marginRight: 8 }}>{formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}</span>
              <button onClick={e => { e.stopPropagation(); onSelectSprint(sprint); }}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#059669", background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.20)", borderRadius: 7, cursor: "pointer", flexShrink: 0 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#D1FAE5"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}>
                <ExternalLink style={{ width: 11, height: 11 }} />詳細
              </button>
            </div>

            {/* Kanban columns */}
            {isExp && (
              <div style={{ overflowX: "auto", padding: "12px 14px" }}>
                {/* Column headers */}
                <div style={{ display: "flex", gap: 8, marginBottom: 8, minWidth: "fit-content" }}>
                  {TICKET_STATUSES.map(col => {
                    const count = sprint.tickets.filter(t => t.status === col.value).length;
                    return (
                      <div key={col.value} style={{ flex: "0 0 170px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", borderRadius: 6, background: col.bg }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: col.color }}>{col.label}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: col.color, fontFamily: "var(--font-mono)" }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
                {/* Drop zones */}
                <div style={{ display: "flex", gap: 8, minWidth: "fit-content" }}>
                  {TICKET_STATUSES.map(col => (
                    <DropColumn
                      key={col.value}
                      sprintId={sprint.id}
                      col={col}
                      tickets={sprint.tickets.filter(t => t.status === col.value)}
                      onDrop={handleDrop}
                      onSelectTicket={onSelectTicket}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Comment modal for review-related status drops */}
      {pendingDrop && modalMeta && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.40)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) cancelModal(); }}>
          <div style={{ background: "#FFFFFF", borderRadius: 16, padding: "28px 28px 24px", width: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.20)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{modalMeta.title}</h3>
                <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>ステータスを変更します。コメントは省略可能です。</p>
              </div>
              <button onClick={cancelModal} style={{ padding: 6, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
            <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
              <MessageSquare style={{ width: 12, height: 12, color: "#B0A9A4" }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>コメント（任意）</span>
            </div>
            <textarea value={modalComment} onChange={e => setModalComment(e.target.value)}
              placeholder={modalMeta.placeholder}
              style={{ width: "100%", minHeight: 90, padding: "10px 12px", background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, fontSize: 13, color: "#1A1714", resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" as const }}
              onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = "#059669"; (e.currentTarget as HTMLElement).style.background = "#FFF"; }}
              onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.10)"; (e.currentTarget as HTMLElement).style.background = "#F9F8F6"; }} />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={confirmModal} disabled={saving}
                style={{ flex: 1, padding: "10px 0", background: saving ? "#F4F5F6" : "#059669", color: saving ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: saving ? "not-allowed" : "pointer", transition: "background 0.15s" }}>
                {saving ? "処理中..." : "確定"}
              </button>
              <button onClick={cancelModal} disabled={saving}
                style={{ flex: 1, padding: "10px 0", background: "#F4F5F6", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer" }}>
                キャンセル
              </button>
            </div>
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
}) {
  return (
    <DndProvider backend={HTML5Backend}>
      <SprintBoardInner {...props} />
    </DndProvider>
  );
}
