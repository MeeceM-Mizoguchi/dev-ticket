import { useState, useEffect, useCallback } from "react";
import { ClipboardList, RefreshCw, ChevronDown } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapSprintTicket } from "@/app/lib/mappers";
import { useAuth } from "@/app/contexts/AuthContext";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import type { SprintTicket } from "@/app/types";

interface ActionTicket extends SprintTicket {
  projectSlug: string;
  projectName: string;
  projectId: string;
  sprintId: string;
}

interface ProjectOption {
  id: string;
  slug: string;
  name: string;
}

type Tab = "assigned" | "review";

const STATUS_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  "todo":        { bg: "#F4F5F6", text: "#9E9690", border: "#E0DDD9" },
  "in-progress": { bg: "#FFF7ED", text: "#D97706", border: "#FED7AA" },
  "in-review":   { bg: "#F5F3FF", text: "#7C3AED", border: "#DDD6FE" },
  "review-done": { bg: "#F0F9FF", text: "#0284C7", border: "#BAE6FD" },
  "stg-test":    { bg: "#F0FDFA", text: "#0D9488", border: "#99F6E4" },
  "uat":         { bg: "#EEF2FF", text: "#4F46E5", border: "#C7D2FE" },
};

// ─── チケットチップ ───────────────────────────────────────────
function TicketChip({ ticket, onClick }: { ticket: ActionTicket; onClick: () => void }) {
  const c = STATUS_COLOR[ticket.status] ?? { bg: "#F4F5F6", text: "#9E9690", border: "#E0DDD9" };
  return (
    <button
      onClick={onClick}
      title={`${ticket.wbs}: ${ticket.title}\n${ticket.projectName}`}
      style={{
        display: "inline-flex", alignItems: "center",
        padding: "5px 18px 5px 10px",
        background: c.bg, border: `1.5px solid ${c.border}`, color: c.text,
        borderRadius: 4, fontSize: 11, fontWeight: 700,
        fontFamily: "var(--font-mono)", letterSpacing: "0.02em",
        cursor: "pointer", whiteSpace: "nowrap" as const,
        clipPath: "polygon(0% 0%, calc(100% - 9px) 0%, 100% 50%, calc(100% - 9px) 100%, 0% 100%)",
        transition: "transform 0.12s, box-shadow 0.12s",
        lineHeight: 1, minWidth: 56,
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform = "translateY(-1px)";
        el.style.boxShadow = `0 4px 10px ${c.text}33`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform = "translateY(0)";
        el.style.boxShadow = "none";
      }}
    >
      {ticket.wbs}
    </button>
  );
}

// ─── セクションラベル ─────────────────────────────────────────
function SectionLabel({
  dotColor, label, count, countBg, countColor,
}: {
  dotColor: string; label: string; count: number; countBg: string; countColor: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12, flexShrink: 0 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: "#4A4540", letterSpacing: "0.02em" }}>{label}</span>
      {count > 0 && (
        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20, background: countBg, color: countColor }}>
          {count}
        </span>
      )}
    </div>
  );
}

// ─── チップグリッド ───────────────────────────────────────────
function ChipGrid({ tickets, onSelect }: { tickets: ActionTicket[]; onSelect: (t: ActionTicket) => void }) {
  if (tickets.length === 0) {
    return <span style={{ fontSize: 11, color: "#D4CEC8", display: "block", paddingTop: 2 }}>なし</span>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8 }}>
      {tickets.map(t => <TicketChip key={t.id} ticket={t} onClick={() => onSelect(t)} />)}
    </div>
  );
}

// ─── クローズ パネル ─────────────────────────────────────────
function ClosedPanel({ tickets, onSelect }: { tickets: ActionTicket[]; onSelect: (t: ActionTicket) => void }) {
  return (
    <div style={{
      width: 196, flexShrink: 0,
      background: "#FFFFFF",
      borderRadius: 16,
      border: "1px solid rgba(26,23,20,0.07)",
      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
      overflow: "hidden",
      display: "flex", flexDirection: "column" as const,
    }}>
      <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid rgba(26,23,20,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#9CA3AF", flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#4A4540" }}>クローズ</span>
          {tickets.length > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: "#F3F4F6", color: "#6B7280" }}>
              {tickets.length}
            </span>
          )}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" as const, padding: "6px 0" }}>
        {tickets.length === 0 ? (
          <p style={{ fontSize: 11, color: "#D4CEC8", textAlign: "center" as const, padding: "20px 12px", margin: 0 }}>なし</p>
        ) : tickets.map(t => (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            title={`${t.wbs}: ${t.title}`}
            style={{
              display: "block", width: "100%", padding: "7px 12px",
              background: "transparent", border: "none", cursor: "pointer",
              textAlign: "left" as const, transition: "background 0.1s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <span style={{
              fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)",
              background: "#F3F4F6", color: "#6B7280",
              padding: "1px 5px", borderRadius: 3, letterSpacing: "0.02em",
              display: "inline-block", marginBottom: 3,
            }}>{t.wbs}</span>
            <p style={{
              fontSize: 11, color: "#6B6458", margin: 0, lineHeight: 1.3,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
            }}>{t.title}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── 担当チケット タブ ────────────────────────────────────────
function AssignedTab({
  todo, inProgress, inReview, testing, closed, onSelect,
}: {
  todo: ActionTicket[]; inProgress: ActionTicket[];
  inReview: ActionTicket[]; testing: ActionTicket[];
  closed: ActionTicket[];
  onSelect: (t: ActionTicket) => void;
}) {
  const cellBase: React.CSSProperties = {
    padding: "18px 20px", overflowY: "auto" as const,
    display: "flex", flexDirection: "column" as const,
  };

  return (
    <div style={{ flex: 1, display: "flex", gap: 12, overflow: "hidden", minHeight: 0 }}>
      {/* 2×2象限 */}
      <div style={{
        flex: 1, minWidth: 0,
        background: "#FFFFFF",
        borderRadius: 16,
        border: "1px solid rgba(26,23,20,0.07)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
      }}>
        <div style={{ ...cellBase, borderRight: "1px solid rgba(26,23,20,0.07)", borderBottom: "1px solid rgba(26,23,20,0.07)" }}>
          <SectionLabel dotColor="#9E9690" label="未着手" count={todo.length} countBg="#F4F5F6" countColor="#9E9690" />
          <ChipGrid tickets={todo} onSelect={onSelect} />
        </div>
        <div style={{ ...cellBase, borderBottom: "1px solid rgba(26,23,20,0.07)" }}>
          <SectionLabel dotColor="#D97706" label="進行中" count={inProgress.length} countBg="#FFF7ED" countColor="#D97706" />
          <ChipGrid tickets={inProgress} onSelect={onSelect} />
        </div>
        <div style={{ ...cellBase, borderRight: "1px solid rgba(26,23,20,0.07)" }}>
          <SectionLabel dotColor="#7C3AED" label="レビュー中" count={inReview.length} countBg="#F5F3FF" countColor="#7C3AED" />
          <ChipGrid tickets={inReview} onSelect={onSelect} />
        </div>
        <div style={{ ...cellBase }}>
          <SectionLabel dotColor="#0D9488" label="テスト中" count={testing.length} countBg="#F0FDFA" countColor="#0D9488" />
          <ChipGrid tickets={testing} onSelect={onSelect} />
        </div>
      </div>

      {/* クローズ */}
      <ClosedPanel tickets={closed} onSelect={onSelect} />
    </div>
  );
}

// ─── レビューセクションカード ─────────────────────────────────
function ReviewSection({
  label, description, count, tickets, onSelect,
  dotColor, countBg, countColor,
}: {
  label: string; description: string; count: number; tickets: ActionTicket[];
  onSelect: (t: ActionTicket) => void;
  dotColor: string; countBg: string; countColor: string;
}) {
  return (
    <div style={{
      flex: 1, minHeight: 0,
      background: "#FFFFFF",
      borderRadius: 16,
      border: "1px solid rgba(26,23,20,0.07)",
      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
      overflow: "hidden",
      display: "flex", flexDirection: "column" as const,
    }}>
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid rgba(26,23,20,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{label}</span>
          {count > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: countBg, color: countColor }}>{count}</span>
          )}
        </div>
        <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0, marginLeft: 15, lineHeight: 1.4 }}>{description}</p>
      </div>
      <div style={{ flex: 1, overflowY: "auto" as const, padding: "14px 20px" }}>
        <ChipGrid tickets={tickets} onSelect={onSelect} />
      </div>
    </div>
  );
}

// ─── レビュー管理 タブ ────────────────────────────────────────
function ReviewTab({
  pendingReview, revisionRequested, approved, closed, onSelect,
}: {
  pendingReview: ActionTicket[]; revisionRequested: ActionTicket[];
  approved: ActionTicket[]; closed: ActionTicket[];
  onSelect: (t: ActionTicket) => void;
}) {
  return (
    <div style={{ flex: 1, display: "flex", gap: 12, overflow: "hidden", minHeight: 0 }}>
      {/* 左: レビュー依頼 */}
      <ReviewSection
        label="レビュー依頼"
        description="レビューを依頼されているチケット"
        count={pendingReview.length}
        tickets={pendingReview}
        onSelect={onSelect}
        dotColor="#7C3AED"
        countBg="#F5F3FF"
        countColor="#7C3AED"
      />

      {/* 中: 修正依頼中 + 承認済み (等分) */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" as const, gap: 12, overflow: "hidden" }}>
        <ReviewSection
          label="修正依頼中"
          description="修正を依頼したチケット"
          count={revisionRequested.length}
          tickets={revisionRequested}
          onSelect={onSelect}
          dotColor="#D97706"
          countBg="#FFF7ED"
          countColor="#D97706"
        />
        <ReviewSection
          label="承認済み"
          description="レビューを承認したチケット"
          count={approved.length}
          tickets={approved}
          onSelect={onSelect}
          dotColor="#059669"
          countBg="#ECFDF5"
          countColor="#059669"
        />
      </div>

      {/* 右: クローズ */}
      <ClosedPanel tickets={closed} onSelect={onSelect} />
    </div>
  );
}

// ─── メインページ ─────────────────────────────────────────────
export function MyActionsPage() {
  const { userName } = useAuth();
  const [tab, setTab] = useState<Tab>("assigned");
  const [allAssigned, setAllAssigned] = useState<ActionTicket[]>([]);
  const [allReview, setAllReview] = useState<ActionTicket[]>([]);
  const [closedAssigned, setClosedAssigned] = useState<ActionTicket[]>([]);
  const [closedReview, setClosedReview] = useState<ActionTicket[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedTicket, setSelectedTicket] = useState<ActionTicket | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !userName) { setLoading(false); return; }
    setLoading(true);
    try {
      const [projectsRes, sprintsRes] = await Promise.all([
        supabase!.from("projects").select("id, slug, name"),
        supabase!.from("sprints").select("id, project_id"),
      ]);

      const projectMap: Record<string, { slug: string; name: string }> = Object.fromEntries(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (projectsRes.data ?? []).map((p: any) => [p.id, { slug: p.slug, name: p.name }])
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setProjects((projectsRes.data ?? []).map((p: any) => ({ id: p.id, slug: p.slug, name: p.name })));

      const sprintMap: Record<string, string> = Object.fromEntries(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sprintsRes.data ?? []).map((s: any) => [s.id, s.project_id])
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toAction = (r: any): ActionTicket => {
        const ticket = mapSprintTicket(r);
        const projectId = sprintMap[r.sprint_id] ?? "";
        const proj = projectMap[projectId] ?? { slug: "", name: "" };
        return { ...ticket, projectSlug: proj.slug, projectName: proj.name, projectId, sprintId: r.sprint_id ?? "" };
      };

      const [aRes, rRes, acRes, rcRes] = await Promise.all([
        supabase!.from("sprint_tickets").select("*")
          .or(`assignee.eq.${userName},assignees.cs.{${userName}}`)
          .not("status", "in", '("done","closed")'),
        supabase!.from("sprint_tickets").select("*")
          .eq("reviewer_name", userName)
          .not("status", "in", '("done","closed")'),
        supabase!.from("sprint_tickets").select("*")
          .or(`assignee.eq.${userName},assignees.cs.{${userName}}`)
          .eq("status", "closed"),
        supabase!.from("sprint_tickets").select("*")
          .eq("reviewer_name", userName)
          .eq("status", "closed"),
      ]);

      setAllAssigned((aRes.data ?? []).map(toAction));
      setAllReview((rRes.data ?? []).map(toAction));
      setClosedAssigned((acRes.data ?? []).map(toAction));
      setClosedReview((rcRes.data ?? []).map(toAction));
    } catch (err) {
      console.error("[MyActionsPage] load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [userName]);

  useEffect(() => { load(); }, [load]);

  const filter = (tickets: ActionTicket[]) =>
    selectedProjectId ? tickets.filter(t => t.projectId === selectedProjectId) : tickets;

  const assignedTickets = filter(allAssigned);
  const reviewTickets   = filter(allReview);
  const closedA         = filter(closedAssigned);
  const closedR         = filter(closedReview);

  const todo       = assignedTickets.filter(t => t.status === "todo");
  const inProgress = assignedTickets.filter(t => t.status === "in-progress");
  const inReview   = assignedTickets.filter(t => t.status === "in-review");
  const testing    = assignedTickets.filter(t => ["review-done", "stg-test", "uat"].includes(t.status));

  const pendingReview     = reviewTickets.filter(t => t.status === "in-review");
  const revisionRequested = reviewTickets.filter(t => t.status === "in-progress" && (t.reviewRound ?? 0) > 0);
  const approved          = reviewTickets.filter(t => ["review-done", "stg-test", "uat"].includes(t.status));

  const tabDefs: { id: Tab; label: string; count: number }[] = [
    { id: "assigned", label: "担当チケット", count: assignedTickets.length },
    { id: "review",   label: "レビュー管理", count: reviewTickets.length },
  ];

  const handleSelectTicket = (t: ActionTicket) => setSelectedTicket(t);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" as const, overflow: "hidden", background: "#FAFAF9" }}>
      <style>{`@keyframes spin-ma { to { transform: rotate(360deg) } }`}</style>

      {/* ─── ヘッダー + タブ ─── */}
      <div style={{ padding: "20px 32px 0", background: "#FFFFFF", borderBottom: "1px solid rgba(26,23,20,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
          {/* Title */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: "linear-gradient(145deg, #34D399, #059669)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 3px 8px rgba(5,150,105,0.25)", flexShrink: 0,
            }}>
              <ClipboardList style={{ width: 15, height: 15, color: "#fff" }} />
            </div>
            <div>
              <h1 style={{ fontSize: 16, fontWeight: 700, color: "#1A1714", margin: 0, fontFamily: "var(--font-heading)", lineHeight: 1.3 }}>
                アクション一覧
              </h1>
              <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0, lineHeight: 1.4 }}>
                担当チケットとレビュー依頼を確認できます
              </p>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Project filter */}
            <div style={{ position: "relative" as const }}>
              <select
                value={selectedProjectId}
                onChange={e => setSelectedProjectId(e.target.value)}
                style={{
                  fontSize: 12, fontWeight: 600,
                  color: selectedProjectId ? "#1A1714" : "#9E9690",
                  background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.1)",
                  borderRadius: 8, padding: "6px 28px 6px 10px",
                  cursor: "pointer",
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  appearance: "none" as any,
                  WebkitAppearance: "none",
                  outline: "none", transition: "all 0.15s", minWidth: 120,
                }}
              >
                <option value="">すべてのPJ</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <ChevronDown style={{
                position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)",
                width: 12, height: 12, color: "#9E9690", pointerEvents: "none",
              }} />
            </div>

            {/* Refresh */}
            <button
              onClick={() => load()}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 12px", fontSize: 11, fontWeight: 600,
                color: "#9E9690", background: "transparent",
                border: "1px solid rgba(26,23,20,0.1)", borderRadius: 8,
                cursor: loading ? "default" : "pointer", opacity: loading ? 0.5 : 1,
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <RefreshCw style={{ width: 11, height: 11, ...(loading ? { animation: "spin-ma 0.8s linear infinite" } : {}) }} />
              更新
            </button>
          </div>
        </div>

        {/* タブ */}
        <div style={{ display: "flex" }}>
          {tabDefs.map(({ id, label, count }) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: "10px 20px", fontSize: 13, fontWeight: 600,
              color: tab === id ? "#059669" : "#9E9690",
              background: "transparent", border: "none",
              borderBottom: `2px solid ${tab === id ? "#059669" : "transparent"}`,
              cursor: "pointer", transition: "all 0.15s",
              display: "flex", alignItems: "center", gap: 7,
            }}>
              {label}
              {count > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20,
                  background: tab === id ? "#ECFDF5" : "#F4F5F6",
                  color: tab === id ? "#059669" : "#B0A9A4",
                  transition: "all 0.15s",
                }}>{count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ─── コンテンツ ─── */}
      <div style={{ flex: 1, minHeight: 0, padding: "14px 32px 16px", display: "flex", flexDirection: "column" as const, overflow: "hidden" }}>
        {loading ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #E5E3E0", borderTopColor: "#059669", animation: "spin-ma 0.8s linear infinite" }} />
            <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>読み込み中...</p>
          </div>
        ) : tab === "assigned" ? (
          <AssignedTab
            todo={todo} inProgress={inProgress} inReview={inReview} testing={testing}
            closed={closedA} onSelect={handleSelectTicket}
          />
        ) : (
          <ReviewTab
            pendingReview={pendingReview} revisionRequested={revisionRequested}
            approved={approved} closed={closedR} onSelect={handleSelectTicket}
          />
        )}
      </div>

      {/* ─── チケット詳細パネル ─── */}
      {selectedTicket && (
        <TicketDetailPanel
          ticket={selectedTicket}
          projectId={selectedTicket.projectId}
          sprintId={selectedTicket.sprintId}
          projectSlug={selectedTicket.projectSlug}
          onClose={() => setSelectedTicket(null)}
          onUpdated={() => load()}
          onDeleted={() => { setSelectedTicket(null); load(); }}
          onSelectTicket={child => setSelectedTicket({
            ...child,
            projectSlug: selectedTicket.projectSlug,
            projectName: selectedTicket.projectName,
            projectId: selectedTicket.projectId,
            sprintId: selectedTicket.sprintId,
          } as ActionTicket)}
        />
      )}
    </div>
  );
}
