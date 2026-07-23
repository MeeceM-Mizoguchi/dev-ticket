import { useState, useCallback, useEffect, useRef } from "react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { ExternalLink, X, MessageSquare, Paperclip, User, Plus, AlertCircle, ChevronsRight } from "lucide-react";
import type { Sprint, SprintTicket, TicketStatus } from "@/app/types";
import { TICKET_STATUSES, formatDate, truncateName } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { usePlan } from "@/app/contexts/PlanContext";
import { PlanTooltip } from "@/app/components/shared/PlanTooltip";

// ステータスごとの進捗率（progress）を定義
const STATUS_PROGRESS: Record<TicketStatus, number> = {
  todo: 0, "in-progress": 10, "in-review": 30,
  "review-done": 50, "stg-test": 70, uat: 90, done: 100, closed: 100,
};
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { MEMBERS } from "@/app/data/mock";
import { recordMilestoneFromTicketStatus } from "@/app/hooks/useProject";
import { syncSprintStatusInDb } from "@/app/lib/syncSprintStatus";
import { escStack } from "@/app/lib/escStack";

const DRAG_TYPE = "SPRINT_TICKET";

const MODAL_STATUSES: TicketStatus[] = ["in-review", "review-done"];

const MODAL_LABELS: Partial<Record<TicketStatus, { title: string; placeholder: string; commentType: string }>> = {
  "in-review": { title: "レビュー依頼", placeholder: "レビュー依頼の内容・確認ポイントを入力（任意）...", commentType: "review_request" },
  "review-done": { title: "レビュー承認", placeholder: "承認コメントを入力（任意）...", commentType: "review_approved" },
};

const STATUS_RANK: Record<TicketStatus, number> = {
  "todo": 0, "in-progress": 1, "in-review": 2, "review-done": 3,
  "stg-test": 4, "uat": 5, "done": 6, "closed": 7,
};

function effectiveStatus(ticket: SprintTicket): string {
  if (ticket.progress === -1) return "pending";
  if (ticket.progress === -2) return "withdrawn";
  return ticket.status;
}

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

  if (newStatus === "in-review") {
    if (ticket.assignee && ticket.assignee !== userName) {
      return {
        ticketId: ticket.id,
        message: "このチケットの担当者のみレビュー依頼を送信できます",
      };
    }
  }

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

  if (newRank >= STATUS_RANK["stg-test"] && currentRank < STATUS_RANK["review-done"]) {
    return {
      ticketId: ticket.id,
      message: "レビュー完了していないため移動できません",
    };
  }

  return null;
}

function TicketCard({ ticket, sprintId, onSelect, parentTicket }: {
  ticket: SprintTicket; sprintId: string; onSelect?: (t: SprintTicket) => void;
  parentTicket?: SprintTicket;
}) {
  const [{ isDragging }, drag] = useDrag<DragItem, void, { isDragging: boolean }>(() => ({
    type: DRAG_TYPE,
    item: { id: ticket.id, sprintId, currentStatus: ticket.status },
    collect: m => ({ isDragging: m.isDragging() }),
  }), [ticket.id, sprintId, ticket.status]);

  const [showParentTooltip, setShowParentTooltip] = useState(false);

  const priBg = ticket.priority === "high" ? "#FEF2F2" : ticket.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
  const priColor = ticket.priority === "high" ? "#DC2626" : ticket.priority === "medium" ? "#D97706" : "#0284C7";
  const priLabel = ticket.priority === "high" ? "高" : ticket.priority === "medium" ? "中" : "低";
  const isChild = !!ticket.parentId;
  const needsHours = ticket.status === "waiting-release" && (ticket.actualWorkHours == null);

  return (
    <div style={{ position: "relative" }}>
      {isChild && showParentTooltip && parentTicket && (
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50, background: "#1A1714", color: "#FFF", borderRadius: 8, padding: "8px 10px", fontSize: 10, lineHeight: 1.5, boxShadow: "0 4px 16px rgba(0,0,0,0.25)", pointerEvents: "none" }}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", marginBottom: 2 }}>親チケット</div>
          <div style={{ fontWeight: 700, fontSize: 10, color: "#059669" }}>{parentTicket.wbs}</div>
          <div style={{ fontSize: 10, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{parentTicket.title}</div>
          <div style={{ position: "absolute", bottom: -5, left: 12, width: 10, height: 10, background: "#1A1714", transform: "rotate(45deg)", borderRadius: 2 }} />
        </div>
      )}
      <div ref={drag} onClick={() => onSelect?.(ticket)}
        onMouseEnter={e => { if (!isDragging) { (e.currentTarget as HTMLElement).style.boxShadow = needsHours ? "0 0 0 2px rgba(239,68,68,0.35), 0 3px 10px rgba(0,0,0,0.10)" : "0 3px 10px rgba(0,0,0,0.10)"; if (isChild) setShowParentTooltip(true); } }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = isDragging ? "none" : needsHours ? "0 0 0 2px rgba(239,68,68,0.25), 0 1px 3px rgba(0,0,0,0.04)" : "0 1px 3px rgba(0,0,0,0.04)"; setShowParentTooltip(false); }}
        style={{ background: needsHours ? "#FFF5F5" : "#FFF", borderRadius: 9, padding: "10px 12px", border: needsHours ? "1px solid rgba(239,68,68,0.30)" : isChild ? "1px solid rgba(5,150,105,0.20)" : "1px solid rgba(26,23,20,0.08)", marginBottom: 6, cursor: "grab", opacity: isDragging ? 0.35 : 1, transition: "opacity 0.15s, box-shadow 0.15s", boxShadow: isDragging ? "none" : needsHours ? "0 0 0 2px rgba(239,68,68,0.25), 0 1px 3px rgba(0,0,0,0.04)" : "0 1px 3px rgba(0,0,0,0.04)" }}>
        {isChild && (
          <div style={{ fontSize: 9, color: "#059669", fontFamily: "var(--font-mono)", marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 8, height: 8, border: "1px solid rgba(5,150,105,0.4)", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 6 }}>↳</span>
            {ticket.wbs}
          </div>
        )}
        <p style={{ fontSize: 11, fontWeight: 600, color: "#1A1714", marginBottom: 6, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>{ticket.title}</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Avatar name={ticket.assignee} size="xs" />
            <span style={{ fontSize: 10, color: "#9E9690" }}>{truncateName(ticket.assignee) || "未割当"}</span>
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: priBg, color: priColor, flexShrink: 0 }}>{priLabel}</span>
        </div>
      </div>
    </div>
  );
}

function DropColumn({ sprintId, col, tickets, allTickets, onDrop, onSelectTicket, style: extraStyle }: {
  sprintId: string;
  col: typeof TICKET_STATUSES[number];
  tickets: SprintTicket[];
  allTickets: SprintTicket[];
  onDrop: (item: DragItem, targetStatus: TicketStatus) => void;
  onSelectTicket?: (t: SprintTicket) => void;
  style?: React.CSSProperties;
}) {
  const [{ isOver, canDrop }, drop] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>(() => ({
    accept: DRAG_TYPE,
    canDrop: item => item.sprintId === sprintId && item.currentStatus !== col.value && col.value !== "pending" && col.value !== "withdrawn",
    drop: item => onDrop(item, col.value),
    collect: m => ({ isOver: m.isOver(), canDrop: m.canDrop() }),
  }), [sprintId, col.value, onDrop]);

  const isActive = isOver && canDrop;

  return (
    <div ref={drop} style={{
      borderRadius: 8, padding: 8, minHeight: 120, transition: "background 0.15s, border-color 0.15s",
      background: isActive ? col.bg : "rgba(26,23,20,0.02)",
      border: `1.5px ${isActive ? "solid" : "dashed"} ${isActive ? col.color + "55" : "rgba(26,23,20,0.08)"}`,
      ...extraStyle
    }}>
      {tickets.length === 0 && !isActive && (
        <div style={{ padding: "20px 0", textAlign: "center" as const, color: "#D5D0CB", fontSize: 11 }}>なし</div>
      )}
      {tickets.map(t => {
        const parent = t.parentId ? allTickets.find(p => p.id === t.parentId) : undefined;
        return <TicketCard key={t.id} ticket={t} sprintId={sprintId} onSelect={onSelectTicket} parentTicket={parent} />;
      })}
    </div>
  );
}

function SprintBoardInner({ sprints, loading, onSelectSprint, onSelectTicket, onUpdated, onCreateTicket, onBulkCreate, stickyTop }: {
  sprints: Sprint[];
  loading?: boolean;
  onSelectSprint: (s: Sprint) => void;
  onSelectTicket?: (t: SprintTicket) => void;
  onUpdated?: () => void;
  onCreateTicket?: (sprintId: string) => void;
  onBulkCreate?: (sprintId: string) => void;
  // 🌟 BRU5-043: 上部固定バーの高さ分だけ sticky ヘッダーを下げるオフセット
  stickyTop?: number;
}) {
  const { userName, userPermissions, userOrgId } = useAuth();
  const canCreateTicket = userPermissions.canCreateTicket;
  const { plan } = usePlan();
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

  // 🌟 ヘッダー(overflowX:hidden)と本体(overflowX:auto)の横スクロールを同期する。
  //    横スクロールを外枠ではなく本体側に持たせることで、ステータスヘッダーの
  //    position:sticky がアプリのスクロール領域(上部固定バー直下)に正しく吸着する。
  const boardBodyRef = useRef<HTMLDivElement>(null);
  const boardHeaderRef = useRef<HTMLDivElement>(null);
  const handleBoardScroll = () => {
    if (boardBodyRef.current && boardHeaderRef.current) {
      boardHeaderRef.current.scrollLeft = boardBodyRef.current.scrollLeft;
    }
  };

  useEffect(() => {
    if (sprints.length && !sprints.find(s => s.id === selectedSprintId)) {
      setSelectedSprintId(sprints[0].id);
    }
  }, [sprints, selectedSprintId]);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    let q = supabase!.from("profiles").select("name").order("name");
    if (userOrgId) q = (q as any).or(`organization_id.eq.${userOrgId},role.eq.owner`);
    q.then(({ data }) => { if (data?.length) setReviewerList(data.map((d: { name: string }) => d.name)); });
  }, [userOrgId]);


  const applyStatusUpdate = useCallback(async (
    ticketId: string, newStatus: TicketStatus, comment: string,
    reviewer?: string, srcFile?: File | null, srcUrl?: string
  ) => {
    setSaving(true);
    try {
      if (isSupabaseEnabled) {
        const updateData: Record<string, unknown> = {
          status: newStatus,
          progress: STATUS_PROGRESS[newStatus]
        };
        if (newStatus === "in-review" && reviewer) updateData.reviewer_name = reviewer;
        await supabase!.from("sprint_tickets").update(updateData).eq("id", ticketId);

        recordMilestoneFromTicketStatus(ticketId, newStatus);

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
        // ステータス変更後、所属スプリントの完了判定をDBへ同期する
        void syncSprintStatusInDb(currentSprintRef.current?.id);
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

  const cancelModal = useCallback(() => { setPendingDrop(null); setModalComment(""); setReviewerName(""); setSourceUrl(""); setSourceFile(null); }, []);

  useEffect(() => {
    if (!pendingError) return;
    const fn = () => setPendingError(null);
    escStack.push(fn);
    return () => escStack.pop(fn);
  }, [pendingError]);

  useEffect(() => {
    if (!pendingDrop) return;
    escStack.push(cancelModal);
    return () => escStack.pop(cancelModal);
  }, [pendingDrop, cancelModal]);

  const modalMeta = pendingDrop ? MODAL_LABELS[pendingDrop.newStatus] : null;
  const isReviewRequest = pendingDrop?.newStatus === "in-review";

  if (loading) return (
    <div style={{ padding: "32px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", marginBottom: 20, background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12 }}>
        <div style={{ display: "flex", gap: 5 }}>
          <span className="loading-dot" />
          <span className="loading-dot" />
          <span className="loading-dot" />
        </div>
        <span style={{ fontSize: 12, color: "#A09790", fontWeight: 500 }}>スプリントデータを読み込んでいます...</span>
        <div className="loading-bar-track" style={{ flex: 1, height: 5 }}>
          <div className="loading-bar-fill" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {[...Array(3)].map((_, i) => (
          <div key={i} style={{ flex: 1, background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: 16, minHeight: 200 }}>
            <div className="skeleton-shimmer" style={{ width: "70%", height: 14, marginBottom: 12 }} />
            {[...Array(3)].map((_, j) => (
              <div key={j} className="skeleton-shimmer" style={{ width: "100%", height: 60, marginBottom: 8, borderRadius: 8 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );

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
          {onBulkCreate && canCreateTicket && (
            <PlanTooltip text="現在のプランではご利用できません" active={!plan.featureBulkCreate} placement="bottom-left">
              <button onClick={plan.featureBulkCreate ? () => onBulkCreate(currentSprint.id) : undefined}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: plan.featureBulkCreate ? "#0284C7" : "#9CA3AF", background: plan.featureBulkCreate ? "#F0F9FF" : "#F3F4F6", border: `1px solid ${plan.featureBulkCreate ? "rgba(2,132,199,0.20)" : "rgba(156,163,175,0.30)"}`, borderRadius: 7, cursor: plan.featureBulkCreate ? "pointer" : "not-allowed", flexShrink: 0 }}
                onMouseEnter={e => { if (plan.featureBulkCreate) (e.currentTarget as HTMLElement).style.background = "#E0F2FE"; }}
                onMouseLeave={e => { if (plan.featureBulkCreate) (e.currentTarget as HTMLElement).style.background = "#F0F9FF"; }}>
                <Plus style={{ width: 11, height: 11 }} />一括作成
              </button>
            </PlanTooltip>
          )}
        </div>
      )}

      {/* ── Kanban board ── */}
      {currentSprint && (
        <div>
          {/* Sticky status header row.
              🌟 横スクロールを外枠ではなく本体(下の overflowX:auto)側へ移した。外枠が overflow を持たない
                 ことで、このヘッダーの position:sticky はアプリのスクロール領域(<main>)＝上部固定バー直下に
                 正しく吸着する。旧実装は外枠の overflowX:auto がスクロールコンテナになって sticky を捕捉し、
                 top オフセット(stickyTop)分だけヘッダーがカラム中央へ押し下げられていた。
                 内側の overflowX:hidden 要素(boardHeaderRef)は本体の横スクロールに追従させる。 */}
          <div style={{ position: "sticky", top: stickyTop ?? 0, zIndex: 10, background: "#F5F6F8", marginBottom: 4 }}>
            <div ref={boardHeaderRef} style={{ overflowX: "hidden" }}>
              <div style={{ display: "flex", gap: 8, minWidth: "fit-content" }}>
                {TICKET_STATUSES.map(col => {
                  const count = currentSprint.tickets.filter(t => effectiveStatus(t) === col.value).length;
                  return (
                    <div key={col.value} style={{ flex: "0 0 180px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", borderRadius: 6, background: col.bg }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: col.color }}>{col.label}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: col.color, fontFamily: "var(--font-mono)" }}>{count}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {/* Board body — 横スクロールはここで行い、ヘッダーの scrollLeft と同期する */}
          <div ref={boardBodyRef} onScroll={handleBoardScroll} style={{ overflowX: "auto" }}>
            <div style={{ display: "flex", gap: 8, minWidth: "fit-content", minHeight: "calc(100vh - 390px)" }}>
              {TICKET_STATUSES.map(col => {
                const colTickets = currentSprint.tickets.filter(t => effectiveStatus(t) === col.value);
                return (
                  <div key={col.value} style={{ flex: "0 0 180px", display: "flex", flexDirection: "column" }}>
                    <DropColumn sprintId={currentSprint.id} col={col} tickets={colTickets} allTickets={currentSprint.tickets} onDrop={handleDrop} onSelectTicket={onSelectTicket}
                      style={{ flex: 1 }} />
                  </div>
                );
              })}
            </div>
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

// 🌟 修正: 読み込みエラーを完全に防止するデフォルトエクスポート宣言
export default function SprintBoardView(props: {
  sprints: Sprint[];
  loading?: boolean;
  onSelectSprint: (s: Sprint) => void;
  onSelectTicket?: (t: SprintTicket) => void;
  onUpdated?: () => void;
  onCreateTicket?: (sprintId: string) => void;
  onBulkCreate?: (sprintId: string) => void;
  // 🌟 BRU5-043: 上部固定バーの高さ分だけ sticky ヘッダーを下げるオフセット
  stickyTop?: number;
}) {
  return (
    <DndProvider backend={HTML5Backend}>
      <SprintBoardInner {...props} />
    </DndProvider>
  );
}