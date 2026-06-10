import { useState, useEffect, useCallback, useRef } from "react";
import { ClipboardList, RefreshCw, ChevronDown, Plus, X, Hash, Maximize2, Minimize2, ExternalLink, Pencil, Check } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapSprintTicket, mapActionMemo } from "@/app/lib/mappers";
import { useAuth } from "@/app/contexts/AuthContext";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { TICKET_STATUSES } from "@/app/lib/helpers";
import type { SprintTicket, ActionMemo, ActionMemoCategory, TicketStatus } from "@/app/types";

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

interface MemoTicketPanel {
  ticket: SprintTicket;
  projectId: string;
  sprintId: string;
  projectSlug: string;
}

type Tab = "assigned" | "review" | "from_notification";

// 自動削除対象のステータス条件
const TODO_AUTO_DELETE_STATUS: TicketStatus[] = ["closed"];
const REVIEW_AUTO_DELETE_STATUS: TicketStatus[] = ["review-done", "stg-test", "uat", "done", "closed"];

const STATUS_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  "todo":        { bg: "#F4F5F6", text: "#9E9690", border: "#E0DDD9" },
  "in-progress": { bg: "#FFF7ED", text: "#D97706", border: "#FED7AA" },
  "in-review":   { bg: "#F5F3FF", text: "#7C3AED", border: "#DDD6FE" },
  "review-done": { bg: "#F0F9FF", text: "#0284C7", border: "#BAE6FD" },
  "stg-test":    { bg: "#F0FDFA", text: "#0D9488", border: "#99F6E4" },
  "uat":         { bg: "#EEF2FF", text: "#4F46E5", border: "#C7D2FE" },
  "done":        { bg: "#F0FDF4", text: "#059669", border: "#A7F3D0" },
  "closed":      { bg: "#F3F4F6", text: "#6B7280", border: "#D1D5DB" },
};

const CATEGORY_META: Record<ActionMemoCategory, { label: string; dotColor: string; bg: string; color: string }> = {
  todo:   { label: "開発TODO",      dotColor: "#D97706", bg: "#FFF7ED", color: "#D97706" },
  review: { label: "レビュータスク", dotColor: "#7C3AED", bg: "#F5F3FF", color: "#7C3AED" },
  test:   { label: "テスト実行",    dotColor: "#0D9488", bg: "#F0FDFA", color: "#0D9488" },
  memo:   { label: "メモ",          dotColor: "#6B7280", bg: "#F3F4F6", color: "#6B7280" },
};

// ─── チケットステータスバッジ ─────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const s = TICKET_STATUSES.find(x => x.value === status);
  const c = STATUS_COLOR[status] ?? { bg: "#F3F4F6", text: "#6B7280", border: "#E5E7EB" };
  if (!s) return null;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 10,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      flexShrink: 0, lineHeight: 1.4,
    }}>{s.label}</span>
  );
}

// ─── #チケットNo テキスト レンダラー ─────────────────────────
function MemoContent({ content, onNavigate }: { content: string; onNavigate: (wbs: string) => void }) {
  const parts = content.split(/(#[A-Za-z0-9_]+-\d+)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (/^#[A-Za-z0-9_]+-\d+$/.test(part)) {
          const wbs = part.slice(1);
          return (
            <button
              key={i}
              onClick={e => { e.stopPropagation(); onNavigate(wbs); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 2,
                fontSize: "inherit", fontWeight: 700,
                color: "#059669", background: "#ECFDF5",
                border: "1px solid #A7F3D0", borderRadius: 4,
                padding: "0 5px", cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              <Hash style={{ width: 10, height: 10 }} />
              {wbs}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

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
      width: 196, flexShrink: 0, background: "#FFFFFF", borderRadius: 16,
      border: "1px solid rgba(26,23,20,0.07)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
      overflow: "hidden", display: "flex", flexDirection: "column" as const,
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
            <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)", background: "#F3F4F6", color: "#6B7280", padding: "1px 5px", borderRadius: 3, letterSpacing: "0.02em", display: "inline-block", marginBottom: 3 }}>{t.wbs}</span>
            <p style={{ fontSize: 11, color: "#6B6458", margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{t.title}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── 担当チケット タブ ────────────────────────────────────────
function AssignedTab({ todo, inProgress, inReview, testing, closed, onSelect }: {
  todo: ActionTicket[]; inProgress: ActionTicket[];
  inReview: ActionTicket[]; testing: ActionTicket[];
  closed: ActionTicket[]; onSelect: (t: ActionTicket) => void;
}) {
  const cellBase: React.CSSProperties = { padding: "18px 20px", overflowY: "auto", display: "flex", flexDirection: "column" };
  return (
    <div style={{ flex: 1, display: "flex", gap: 12, overflow: "hidden", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, background: "#FFFFFF", borderRadius: 16, border: "1px solid rgba(26,23,20,0.07)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)", overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}>
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
      <ClosedPanel tickets={closed} onSelect={onSelect} />
    </div>
  );
}

// ─── レビューセクションカード ─────────────────────────────────
function ReviewSection({ label, description, count, tickets, onSelect, dotColor, countBg, countColor }: {
  label: string; description: string; count: number; tickets: ActionTicket[];
  onSelect: (t: ActionTicket) => void;
  dotColor: string; countBg: string; countColor: string;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, background: "#FFFFFF", borderRadius: 16, border: "1px solid rgba(26,23,20,0.07)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)", overflow: "hidden", display: "flex", flexDirection: "column" as const }}>
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid rgba(26,23,20,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{label}</span>
          {count > 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: countBg, color: countColor }}>{count}</span>}
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
function ReviewTab({ pendingReview, revisionRequested, approved, closed, onSelect }: {
  pendingReview: ActionTicket[]; revisionRequested: ActionTicket[];
  approved: ActionTicket[]; closed: ActionTicket[];
  onSelect: (t: ActionTicket) => void;
}) {
  return (
    <div style={{ flex: 1, display: "flex", gap: 12, overflow: "hidden", minHeight: 0 }}>
      <ReviewSection label="レビュー依頼" description="レビューを依頼されているチケット" count={pendingReview.length} tickets={pendingReview} onSelect={onSelect} dotColor="#7C3AED" countBg="#F5F3FF" countColor="#7C3AED" />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" as const, gap: 12, overflow: "hidden" }}>
        <ReviewSection label="修正依頼中" description="修正を依頼したチケット" count={revisionRequested.length} tickets={revisionRequested} onSelect={onSelect} dotColor="#D97706" countBg="#FFF7ED" countColor="#D97706" />
        <ReviewSection label="承認済み" description="レビューを承認したチケット" count={approved.length} tickets={approved} onSelect={onSelect} dotColor="#059669" countBg="#ECFDF5" countColor="#059669" />
      </div>
      <ClosedPanel tickets={closed} onSelect={onSelect} />
    </div>
  );
}

// ─── アクションメモ行 ─────────────────────────────────────────
function ActionMemoRow({
  memo, ticketStatus, onSelect, onToggleDone, onDelete,
}: {
  memo: ActionMemo;
  ticketStatus: string | null;
  onSelect: (memo: ActionMemo, rect: DOMRect) => void;
  onToggleDone: (memo: ActionMemo) => void;
  onDelete: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={e => { if ((e.target as HTMLElement).closest("button")) return; onSelect(memo, e.currentTarget.getBoundingClientRect()); }}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10,
        padding: "10px 16px",
        background: hovered ? "#F4F5F6" : "transparent",
        borderBottom: "1px solid rgba(26,23,20,0.04)",
        transition: "background 0.1s",
        opacity: memo.isDone ? 0.5 : 1,
        cursor: "pointer",
      }}
    >
      {/* 完了チェック */}
      <button
        onClick={e => { e.stopPropagation(); onToggleDone(memo); }}
        style={{
          flexShrink: 0, marginTop: 2,
          width: 16, height: 16, borderRadius: 4,
          border: `2px solid ${memo.isDone ? "#059669" : "#D4CEC8"}`,
          background: memo.isDone ? "#059669" : "transparent",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s",
        }}
      >
        {memo.isDone && <span style={{ color: "#fff", fontSize: 9, fontWeight: 900 }}>✓</span>}
      </button>

      {/* 本文 */}
      <div
        style={{ flex: 1, minWidth: 0 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" as const }}>
          {memo.ticketWbs && (
            <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", background: "#F3F4F6", color: "#6B7280", padding: "1px 6px", borderRadius: 3, letterSpacing: "0.02em", flexShrink: 0 }}>
              {memo.ticketWbs}
            </span>
          )}
          {ticketStatus && <StatusBadge status={ticketStatus} />}
          <span style={{
            fontSize: 12, fontWeight: 600, color: memo.isDone ? "#B0A9A4" : "#1A1714",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
            textDecoration: memo.isDone ? "line-through" : "none",
            flex: 1, minWidth: 0,
          }}>{memo.title}</span>
        </div>
        {memo.content && (
          <p style={{ fontSize: 11, color: "#9E9690", margin: 0, lineHeight: 1.4, wordBreak: "break-word" as const,
            overflow: "hidden", textOverflow: "ellipsis",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
          }}>
            {memo.content}
          </p>
        )}
      </div>

      {/* 削除ボタン */}
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(memo.id); }}
          style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "#C9C4BB", transition: "color 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#EF4444"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}
        >
          <X style={{ width: 12, height: 12 }} />
        </button>
      )}
    </div>
  );
}

// ─── 通知から追加 タブ ────────────────────────────────────────
function FromNotificationTab({
  memos, ticketStatusMap, onSelect, onToggleDone, onDelete,
}: {
  memos: ActionMemo[];
  ticketStatusMap: Record<string, string>;
  onSelect: (memo: ActionMemo, rect: DOMRect) => void;
  onToggleDone: (memo: ActionMemo) => void;
  onDelete: (id: string) => void;
}) {
  const categories: ActionMemoCategory[] = ["todo", "review", "test", "memo"];

  if (memos.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" as const, gap: 8 }}>
        <ClipboardList style={{ width: 32, height: 32, color: "#D4CEC8" }} />
        <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0, textAlign: "center" as const }}>
          お知らせからアクションリストに追加したものが<br />ここに表示されます
        </p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", gap: 12, overflow: "hidden", minHeight: 0 }}>
      {categories.map(cat => {
        const catMemos = memos.filter(m => m.category === cat);
        const meta = CATEGORY_META[cat];
        return (
          <div key={cat} style={{
            flex: 1, minWidth: 0, minHeight: 0,
            background: "#FFFFFF", borderRadius: 16,
            border: "1px solid rgba(26,23,20,0.07)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            overflow: "hidden", display: "flex", flexDirection: "column" as const,
          }}>
            <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(26,23,20,0.06)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: meta.dotColor, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#4A4540" }}>{meta.label}</span>
                {catMemos.length > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: meta.bg, color: meta.color }}>
                    {catMemos.length}
                  </span>
                )}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto" as const }}>
              {catMemos.length === 0 ? (
                <p style={{ fontSize: 11, color: "#D4CEC8", textAlign: "center" as const, padding: "20px 12px", margin: 0 }}>なし</p>
              ) : catMemos.map(m => (
                <ActionMemoRow
                  key={m.id}
                  memo={m}
                  ticketStatus={m.ticketId ? (ticketStatusMap[m.ticketId] ?? null) : null}
                  onSelect={onSelect}
                  onToggleDone={onToggleDone}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── メモ詳細ウィンドウ ───────────────────────────────────────
function MemoDetailModal({
  memo,
  ticketStatus,
  anchorPos,
  onClose,
  onOpenTicket,
  onToggleDone,
  onSave,
}: {
  memo: ActionMemo;
  ticketStatus: string | null;
  anchorPos?: { left: number; top: number };
  onClose: () => void;
  onOpenTicket?: () => void;
  onToggleDone: (memo: ActionMemo) => void;
  onSave: (id: string, title: string, content: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(memo.title);
  const [editContent, setEditContent] = useState(memo.content);
  const [saving, setSaving] = useState(false);
  const meta = CATEGORY_META[memo.category];

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) return;
    setSaving(true);
    await onSave(memo.id, editTitle.trim(), editContent.trim());
    setSaving(false);
    setEditing(false);
  };

  const iconBtnStyle: React.CSSProperties = {
    background: "none", border: "none", cursor: "pointer",
    padding: 4, borderRadius: 6, color: "#B0A9A4",
    lineHeight: 0, transition: "color 0.15s",
  };

  const modalWidth = expanded ? 520 : 360;
  const smallPos: React.CSSProperties = (() => {
    if (expanded) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    if (!anchorPos) return { right: 24, bottom: 24 };
    const leftPos = anchorPos.left - modalWidth - 8;
    const clampedLeft = leftPos < 8 ? 8 : leftPos;
    // 行のY位置からポップアップが画面内に収まるか判定
    const fitsBelow = anchorPos.top + 300 + 8 <= window.innerHeight;
    if (fitsBelow) {
      // 収まる→行のY位置に合わせる
      return { left: clampedLeft, top: anchorPos.top };
    } else {
      // 収まらない→画面最下部に固定（実際の高さに関わらず底付き）
      return { left: clampedLeft, bottom: 8 };
    }
  })();

  return (
    <>
      {/* オーバーレイ */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 290, background: "rgba(0,0,0,0.06)" }}
        onClick={onClose}
      />
      {/* ウィンドウ本体 */}
      <div style={{
        position: "fixed",
        ...smallPos,
        width: modalWidth,
        maxHeight: expanded ? "72vh" : 300,
        background: "#FFFFFF",
        borderRadius: 16,
        border: "1px solid rgba(26,23,20,0.1)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.08)",
        zIndex: 300,
        display: "flex", flexDirection: "column" as const,
        overflow: "hidden",
        transition: "width 0.2s ease, max-height 0.2s ease",
      }}>
        {/* ヘッダー */}
        <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid rgba(26,23,20,0.06)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: meta.bg, color: meta.color, flexShrink: 0 }}>
            {meta.label}
          </span>
          {ticketStatus && <StatusBadge status={ticketStatus} />}
          <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
            {memo.ticketWbs ? `[${memo.ticketWbs}] ` : ""}{memo.title}
          </span>
          {/* 完了チェック */}
          <button
            onClick={() => onToggleDone(memo)}
            title={memo.isDone ? "未完了に戻す" : "完了にする"}
            style={{ ...iconBtnStyle, color: memo.isDone ? "#059669" : "#B0A9A4" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#059669"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = memo.isDone ? "#059669" : "#B0A9A4"; }}
          >
            <Check style={{ width: 13, height: 13 }} />
          </button>
          {/* 編集 */}
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              title="編集"
              style={iconBtnStyle}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#1A1714"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}
            >
              <Pencil style={{ width: 13, height: 13 }} />
            </button>
          )}
          {/* 拡大/縮小 */}
          <button
            onClick={() => setExpanded(v => !v)}
            title={expanded ? "縮小" : "拡大"}
            style={iconBtnStyle}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#1A1714"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}
          >
            {expanded ? <Minimize2 style={{ width: 13, height: 13 }} /> : <Maximize2 style={{ width: 13, height: 13 }} />}
          </button>
          {/* 閉じる */}
          <button
            onClick={onClose}
            title="閉じる"
            style={iconBtnStyle}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#EF4444"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}
          >
            <X style={{ width: 13, height: 13 }} />
          </button>
        </div>

        {/* コンテンツ */}
        <div style={{ flex: 1, overflowY: "auto" as const, padding: "14px 16px" }}>
          {editing ? (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9E9690", marginBottom: 4 }}>タイトル</div>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  autoFocus
                  style={{
                    width: "100%", boxSizing: "border-box" as const,
                    padding: "7px 10px", fontSize: 12, color: "#1A1714",
                    border: "1.5px solid #059669", borderRadius: 8,
                    outline: "none", fontFamily: "inherit", background: "#FAFAF9",
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9E9690", marginBottom: 4 }}>
                  内容
                  <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 400, marginLeft: 6 }}>
                    <Hash style={{ width: 9, height: 9, display: "inline", verticalAlign: "middle" }} />
                    WBS でリンク（例: #PRJ-001）
                  </span>
                </div>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={expanded ? 8 : 4}
                  style={{
                    width: "100%", boxSizing: "border-box" as const,
                    padding: "7px 10px", fontSize: 12, color: "#1A1714",
                    border: "1.5px solid #059669", borderRadius: 8,
                    outline: "none", fontFamily: "inherit", resize: "vertical",
                    background: "#FAFAF9", lineHeight: 1.5,
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => { setEditing(false); setEditTitle(memo.title); setEditContent(memo.content); }}
                  style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#9E9690", background: "#F4F5F6", border: "none", borderRadius: 8, cursor: "pointer" }}
                >キャンセル</button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving || !editTitle.trim()}
                  style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#fff", background: editTitle.trim() ? "#059669" : "#D4CEC8", border: "none", borderRadius: 8, cursor: editTitle.trim() ? "pointer" : "default" }}
                >{saving ? "保存中..." : "保存"}</button>
              </div>
            </div>
          ) : (
            <>
              {memo.content ? (
                <p style={{ fontSize: 12, color: "#4A4540", lineHeight: 1.7, margin: "0 0 12px", whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const }}>
                  <MemoContent content={memo.content} onNavigate={() => {}} />
                </p>
              ) : (
                <p style={{ fontSize: 12, color: "#D4CEC8", margin: "0 0 12px", fontStyle: "italic" }}>内容なし</p>
              )}
              <span style={{ fontSize: 10, color: "#C9C4BB" }}>
                {new Date(memo.createdAt).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </>
          )}
        </div>

        {/* フッター: チケット詳細を開く */}
        {onOpenTicket && !editing && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(26,23,20,0.06)", flexShrink: 0 }}>
            <button
              onClick={onOpenTicket}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                fontSize: 12, fontWeight: 600, color: "#059669",
                background: "#ECFDF5", border: "1.5px solid #A7F3D0",
                borderRadius: 8, padding: "6px 14px", cursor: "pointer",
                width: "100%", justifyContent: "center",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#D1FAE5"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}
            >
              <ExternalLink style={{ width: 13, height: 13 }} />
              チケット詳細を開く
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── アクションメモ追加モーダル ───────────────────────────────
function AddMemoModal({
  onSave, onCancel,
}: {
  onSave: (title: string, content: string, category: ActionMemoCategory) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<ActionMemoCategory>("memo");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    const ok = await onSave(title.trim(), content.trim(), category);
    setSaving(false);
    if (!ok) setError("保存に失敗しました。DBテーブルを確認してください。");
  };

  const categories: { id: ActionMemoCategory; label: string }[] = [
    { id: "todo",   label: "開発TODO" },
    { id: "review", label: "レビュータスク" },
    { id: "test",   label: "テスト実行" },
    { id: "memo",   label: "メモ" },
  ];

  return (
    <div style={{
      position: "fixed",
      top: "50%", right: 32,
      transform: "translateY(-50%)",
      width: 340,
      background: "#FFFFFF", borderRadius: 16,
      border: "1px solid rgba(26,23,20,0.1)",
      boxShadow: "0 12px 40px rgba(0,0,0,0.16), 0 4px 12px rgba(0,0,0,0.06)",
      zIndex: 200,
      padding: "20px 20px 16px",
      display: "flex", flexDirection: "column" as const, gap: 12,
    }}>
      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <ClipboardList style={{ width: 14, height: 14, color: "#059669" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>アクションメモ追加</span>
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "#B0A9A4", lineHeight: 0 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#1A1714"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* カテゴリ */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#9E9690", marginBottom: 5 }}>カテゴリ</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" as const }}>
          {categories.map(c => {
            const meta = CATEGORY_META[c.id];
            const selected = category === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                style={{
                  padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: "pointer",
                  border: `1.5px solid ${selected ? meta.dotColor : "rgba(26,23,20,0.1)"}`,
                  background: selected ? meta.bg : "transparent",
                  color: selected ? meta.color : "#9E9690",
                  transition: "all 0.15s",
                }}
              >{c.label}</button>
            );
          })}
        </div>
      </div>

      {/* タイトル */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#9E9690", marginBottom: 5 }}>タイトル <span style={{ color: "#EF4444" }}>*</span></div>
        <input
          ref={titleRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); } }}
          placeholder="タイトルを入力..."
          style={{
            width: "100%", boxSizing: "border-box" as const,
            padding: "8px 10px", fontSize: 12, color: "#1A1714",
            border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 8,
            outline: "none", fontFamily: "inherit",
            background: "#FAFAF9", transition: "border-color 0.15s",
          }}
          onFocus={e => { e.currentTarget.style.borderColor = "#059669"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.12)"; }}
        />
      </div>

      {/* 内容 */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#9E9690", marginBottom: 5 }}>
          内容
          <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 400, marginLeft: 6 }}>
            <Hash style={{ width: 9, height: 9, display: "inline", verticalAlign: "middle" }} />
            WBS でチケットリンク（例: #PRJ-001）
          </span>
        </div>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="内容を入力... (#WBS番号 でチケットリンク)"
          rows={4}
          style={{
            width: "100%", boxSizing: "border-box" as const,
            padding: "8px 10px", fontSize: 12, color: "#1A1714",
            border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 8,
            outline: "none", fontFamily: "inherit", resize: "vertical",
            background: "#FAFAF9", lineHeight: 1.5, transition: "border-color 0.15s",
          }}
          onFocus={e => { e.currentTarget.style.borderColor = "#059669"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.12)"; }}
        />
      </div>

      {/* エラー表示 */}
      {error && (
        <p style={{ fontSize: 11, color: "#EF4444", margin: 0, background: "#FEF2F2", padding: "6px 10px", borderRadius: 6, border: "1px solid #FECACA" }}>
          {error}
        </p>
      )}

      {/* ボタン */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexShrink: 0 }}>
        <button
          onClick={onCancel}
          style={{ padding: "7px 16px", fontSize: 12, fontWeight: 600, color: "#9E9690", background: "#F4F5F6", border: "none", borderRadius: 8, cursor: "pointer" }}
        >キャンセル</button>
        <button
          onClick={handleSave}
          disabled={saving || !title.trim()}
          style={{
            padding: "7px 16px", fontSize: 12, fontWeight: 600,
            color: "#fff",
            background: title.trim() ? "#059669" : "#D4CEC8",
            border: "none", borderRadius: 8, cursor: title.trim() ? "pointer" : "default",
            transition: "background 0.15s",
          }}
        >{saving ? "保存中..." : "保存"}</button>
      </div>
    </div>
  );
}

// ─── メインページ ─────────────────────────────────────────────
export function MyActionsPage() {
  const { userName, userRole } = useAuth();
  const isAdmin = userRole === "admin";
  const [tab, setTab] = useState<Tab>("assigned");
  const [allAssigned, setAllAssigned] = useState<ActionTicket[]>([]);
  const [allReview, setAllReview] = useState<ActionTicket[]>([]);
  const [closedAssigned, setClosedAssigned] = useState<ActionTicket[]>([]);
  const [closedReview, setClosedReview] = useState<ActionTicket[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedTicket, setSelectedTicket] = useState<ActionTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);

  // アクションメモ
  const [actionMemos, setActionMemos] = useState<ActionMemo[]>([]);
  const [ticketStatusMap, setTicketStatusMap] = useState<Record<string, string>>({});
  const [memosLoading, setMemosLoading] = useState(false);
  const [showAddMemo, setShowAddMemo] = useState(false);

  // メモ詳細ウィンドウ
  const [selectedMemo, setSelectedMemo] = useState<ActionMemo | null>(null);
  const [memoAnchorPos, setMemoAnchorPos] = useState<{ left: number; top: number } | undefined>(undefined);
  // 通知タブのチケット詳細パネル
  const [memoPanel, setMemoPanel] = useState<MemoTicketPanel | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);

  // ─── チケット一覧ロード ───────────────────────────────────
  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !userName) { setLoading(false); return; }
    setLoading(true);
    try {
      const [projectsRes, sprintsRes] = await Promise.all([
        supabase!.from("projects").select("id, slug, name, members"),
        supabase!.from("sprints").select("id, project_id"),
      ]);

      const projectMap: Record<string, { slug: string; name: string }> = Object.fromEntries(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (projectsRes.data ?? []).map((p: any) => [p.id, { slug: p.slug, name: p.name }])
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accessibleProjects = (projectsRes.data ?? []).filter((p: any) => {
        if (isAdmin) return true;
        return Array.isArray(p.members) && p.members.includes(userName);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setProjects(accessibleProjects.map((p: any) => ({ id: p.id, slug: p.slug, name: p.name })));

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
        supabase!.from("sprint_tickets").select("*").or(`assignee.eq.${userName},assignees.cs.{${userName}}`).not("status", "in", '("done","closed")'),
        supabase!.from("sprint_tickets").select("*").eq("reviewer_name", userName).not("status", "in", '("done","closed")'),
        supabase!.from("sprint_tickets").select("*").or(`assignee.eq.${userName},assignees.cs.{${userName}}`).eq("status", "closed"),
        supabase!.from("sprint_tickets").select("*").eq("reviewer_name", userName).eq("status", "closed"),
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

  // ─── アクションメモロード（ステータス取得＋自動削除） ────
  const loadMemos = useCallback(async () => {
    if (!isSupabaseEnabled || !userName) return;
    setMemosLoading(true);
    try {
      // 全アクションメモを取得（手動追加 + 通知から追加）
      const { data, error } = await supabase!
        .from("action_memos")
        .select("*")
        .eq("user_name", userName)
        .order("created_at", { ascending: false });
      if (error) { console.error("[action_memos] load failed:", error.message); return; }

      const memos = (data ?? []).map(mapActionMemo);

      // チケットIDが存在するメモのステータスを一括取得
      const ticketIds = memos.filter(m => m.ticketId).map(m => m.ticketId!);
      let newStatusMap: Record<string, string> = {};

      if (ticketIds.length > 0) {
        const { data: tickets } = await supabase!
          .from("sprint_tickets")
          .select("id, status")
          .in("id", ticketIds);
        newStatusMap = Object.fromEntries((tickets ?? []).map((t: any) => [t.id, t.status]));
      }
      setTicketStatusMap(newStatusMap);

      // 自動削除チェック
      const toDeleteIds: string[] = [];
      for (const memo of memos) {
        if (!memo.ticketId) continue;
        const status = newStatusMap[memo.ticketId] as TicketStatus | undefined;
        if (!status) continue;
        if (memo.category === "todo" && TODO_AUTO_DELETE_STATUS.includes(status)) {
          toDeleteIds.push(memo.id);
        }
        if (memo.category === "review" && REVIEW_AUTO_DELETE_STATUS.includes(status)) {
          toDeleteIds.push(memo.id);
        }
        // memo / test カテゴリは自動削除しない
      }

      if (toDeleteIds.length > 0) {
        await supabase!.from("action_memos").delete().in("id", toDeleteIds);
      }

      setActionMemos(memos.filter(m => !toDeleteIds.includes(m.id)));
    } finally {
      setMemosLoading(false);
    }
  }, [userName]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "from_notification") loadMemos(); }, [tab, loadMemos]);

  // ─── フィルター ───────────────────────────────────────────
  const filter = (tickets: ActionTicket[]) =>
    selectedProjectId ? tickets.filter(t => t.projectId === selectedProjectId) : tickets;

  const assignedTickets = filter(allAssigned);
  const reviewTickets = filter(allReview);
  const closedA = filter(closedAssigned);
  const closedR = filter(closedReview);

  const todo = assignedTickets.filter(t => t.status === "todo");
  const inProgress = assignedTickets.filter(t => t.status === "in-progress");
  const inReview = assignedTickets.filter(t => t.status === "in-review");
  const testing = assignedTickets.filter(t => ["review-done", "stg-test", "uat"].includes(t.status));

  const pendingReview = reviewTickets.filter(t => t.status === "in-review");
  const revisionRequested = reviewTickets.filter(t => t.status === "in-progress" && (t.reviewRound ?? 0) > 0);
  const approved = reviewTickets.filter(t => ["review-done", "stg-test", "uat"].includes(t.status));

  const notifTabCount = actionMemos.filter(m => !m.isDone).length;
  const tabDefs: { id: Tab; label: string; count: number }[] = [
    { id: "assigned", label: "担当チケット", count: assignedTickets.length },
    { id: "review",   label: "レビュー管理",  count: reviewTickets.length },
    { id: "from_notification", label: "通知から追加", count: notifTabCount },
  ];

  // ─── メモのチケット詳細をパネルで開く ────────────────────
  const handleMemoOpen = async (memo: ActionMemo) => {
    if (!memo.ticketId || !isSupabaseEnabled) return;
    setPanelLoading(true);
    try {
      const { data: ticketData } = await supabase!
        .from("sprint_tickets").select("*").eq("id", memo.ticketId).single();
      if (!ticketData) return;

      const sprintId: string = ticketData.sprint_id ?? "";
      let projectId = "";
      let projectSlug = memo.projectSlug;

      if (sprintId) {
        const { data: sprintData } = await supabase!
          .from("sprints").select("project_id").eq("id", sprintId).single();
        if (sprintData) {
          projectId = sprintData.project_id ?? "";
          if (!projectSlug && projectId) {
            const { data: projData } = await supabase!
              .from("projects").select("slug").eq("id", projectId).single();
            if (projData) projectSlug = (projData as any).slug ?? "";
          }
        }
      }

      setMemoPanel({
        ticket: mapSprintTicket(ticketData),
        projectId,
        sprintId,
        projectSlug,
      });
    } finally {
      setPanelLoading(false);
    }
  };

  // content内の#WBSクリック → 同プロジェクトのチケットを検索して開く
  const handleNavigateWbs = async (wbs: string, memo: ActionMemo) => {
    if (!isSupabaseEnabled) return;
    const { data } = await supabase!
      .from("sprint_tickets").select("*").eq("wbs", wbs).single();
    if (!data) return;
    const sprintId: string = data.sprint_id ?? "";
    let projectId = "";
    let projectSlug = memo.projectSlug;
    if (sprintId) {
      const { data: sd } = await supabase!.from("sprints").select("project_id").eq("id", sprintId).single();
      if (sd) projectId = sd.project_id ?? "";
    }
    setMemoPanel({ ticket: mapSprintTicket(data), projectId, sprintId, projectSlug });
  };

  const handleToggleDone = async (memo: ActionMemo) => {
    const newVal = !memo.isDone;
    setActionMemos(prev => prev.map(m => m.id === memo.id ? { ...m, isDone: newVal } : m));
    if (isSupabaseEnabled) {
      await supabase!.from("action_memos")
        .update({ is_done: newVal, updated_at: new Date().toISOString() })
        .eq("id", memo.id);
    }
  };

  const handleDeleteMemo = async (id: string) => {
    setActionMemos(prev => prev.filter(m => m.id !== id));
    if (isSupabaseEnabled) {
      await supabase!.from("action_memos").delete().eq("id", id);
    }
  };

  // メモ詳細ウィンドウからの編集保存
  const handleMemoEdit = async (id: string, title: string, content: string) => {
    setActionMemos(prev => prev.map(m => m.id === id ? { ...m, title, content, updatedAt: new Date().toISOString() } : m));
    if (selectedMemo?.id === id) setSelectedMemo(prev => prev ? { ...prev, title, content } : prev);
    if (isSupabaseEnabled) {
      await supabase!.from("action_memos")
        .update({ title, content, updated_at: new Date().toISOString() })
        .eq("id", id);
    }
  };

  // アクションメモ保存（true=成功, false=失敗）
  const handleSaveMemo = async (title: string, content: string, category: ActionMemoCategory): Promise<boolean> => {
    if (!userName) return false;
    if (isSupabaseEnabled) {
      const { data, error } = await supabase!.from("action_memos")
        .insert({ user_name: userName, title, content, category })
        .select().single();
      if (error) {
        console.error("[action_memos] insert failed:", error.message);
        return false;
      }
      if (data) {
        const newMemo = mapActionMemo(data);
        // "通知から追加"タブが開いていればリストに追加
        setActionMemos(prev => [newMemo, ...prev]);
      }
    }
    setShowAddMemo(false);
    return true;
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" as const, overflow: "hidden", background: "#FAFAF9" }}>
      <style>{`@keyframes spin-ma { to { transform: rotate(360deg) } }`}</style>

      {/* 背景オーバーレイ（メモ追加小モーダル用） */}
      {showAddMemo && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 190, background: "rgba(0,0,0,0.08)" }}
          onClick={() => setShowAddMemo(false)}
        />
      )}

      {/* ─── ヘッダー + タブ ─── */}
      <div style={{ padding: "20px 32px 0", background: "#FFFFFF", borderBottom: "1px solid rgba(26,23,20,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
          {/* Title */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(145deg, #34D399, #059669)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 3px 8px rgba(5,150,105,0.25)", flexShrink: 0 }}>
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
            {/* アクションメモ追加ボタン */}
            <button
              onClick={() => setShowAddMemo(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 14px", fontSize: 12, fontWeight: 600,
                color: showAddMemo ? "#fff" : "#059669",
                background: showAddMemo ? "#059669" : "#ECFDF5",
                border: `1.5px solid ${showAddMemo ? "#059669" : "#A7F3D0"}`,
                borderRadius: 8, cursor: "pointer", transition: "all 0.15s",
              }}
              onMouseEnter={e => { if (!showAddMemo) (e.currentTarget as HTMLElement).style.background = "#D1FAE5"; }}
              onMouseLeave={e => { if (!showAddMemo) (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}
            >
              <Plus style={{ width: 13, height: 13 }} />
              アクションメモ追加
            </button>

            {/* Project filter: 通知から追加タブでは非表示 */}
            {tab !== "from_notification" && <div style={{ position: "relative" }}>
              <button
                onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
                onBlur={() => setTimeout(() => setProjectDropdownOpen(false), 200)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  fontSize: 12, fontWeight: 600,
                  color: selectedProjectId ? "#1A1714" : "#9E9690",
                  background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.1)",
                  borderRadius: 8, padding: "6px 10px",
                  cursor: "pointer", outline: "none", transition: "all 0.15s", minWidth: 200,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selectedProjectId ? projects.find(p => p.id === selectedProjectId)?.name || "すべてのPJ" : "すべてのPJ"}
                </span>
                <ChevronDown style={{ width: 12, height: 12, color: "#9E9690", flexShrink: 0, marginLeft: 8, transform: projectDropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>
              {projectDropdownOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, background: "#FFF", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 100, minWidth: "100%", maxHeight: 240, overflowY: "auto", padding: 4 }}>
                  <button
                    onClick={() => { setSelectedProjectId(""); setProjectDropdownOpen(false); }}
                    style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", background: selectedProjectId === "" ? "#ECFDF5" : "transparent", color: selectedProjectId === "" ? "#059669" : "#1A1714", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "background 0.1s" }}
                    onMouseEnter={e => { if (selectedProjectId !== "") e.currentTarget.style.background = "#F4F5F6"; }}
                    onMouseLeave={e => { if (selectedProjectId !== "") e.currentTarget.style.background = "transparent"; }}
                  >すべてのPJ</button>
                  {projects.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProjectId(p.id); setProjectDropdownOpen(false); }}
                      style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", background: selectedProjectId === p.id ? "#ECFDF5" : "transparent", color: selectedProjectId === p.id ? "#059669" : "#1A1714", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "background 0.1s" }}
                      onMouseEnter={e => { if (selectedProjectId !== p.id) e.currentTarget.style.background = "#F4F5F6"; }}
                      onMouseLeave={e => { if (selectedProjectId !== p.id) e.currentTarget.style.background = "transparent"; }}
                    >{p.name}</button>
                  ))}
                </div>
              )}
            </div>}

            {/* Refresh */}
            <button
              onClick={() => { load(); if (tab === "from_notification") loadMemos(); }}
              disabled={loading}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 11, fontWeight: 600, color: "#9E9690", background: "transparent", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 8, cursor: loading ? "default" : "pointer", opacity: loading ? 0.5 : 1, transition: "all 0.15s" }}
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
        {loading && tab !== "from_notification" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #E5E3E0", borderTopColor: "#059669", animation: "spin-ma 0.8s linear infinite" }} />
            <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>読み込み中...</p>
          </div>
        ) : tab === "assigned" ? (
          <AssignedTab todo={todo} inProgress={inProgress} inReview={inReview} testing={testing} closed={closedA} onSelect={t => setSelectedTicket(t)} />
        ) : tab === "review" ? (
          <ReviewTab pendingReview={pendingReview} revisionRequested={revisionRequested} approved={approved} closed={closedR} onSelect={t => setSelectedTicket(t)} />
        ) : (
          memosLoading ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #E5E3E0", borderTopColor: "#059669", animation: "spin-ma 0.8s linear infinite" }} />
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>読み込み中...</p>
            </div>
          ) : (
            <FromNotificationTab
              memos={actionMemos}
              ticketStatusMap={ticketStatusMap}
              onSelect={(memo, rect) => { setSelectedMemo(memo); setMemoAnchorPos({ left: rect.left, top: rect.top }); }}
              onToggleDone={handleToggleDone}
              onDelete={handleDeleteMemo}
            />
          )
        )}
      </div>

      {/* ─── アクションメモ追加モーダル ─── */}
      {showAddMemo && (
        <AddMemoModal
          onSave={handleSaveMemo}
          onCancel={() => setShowAddMemo(false)}
        />
      )}

      {/* ─── 担当/レビュータブのチケット詳細パネル ─── */}
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

      {/* ─── 通知タブのチケット詳細パネル ─── */}
      {memoPanel && (
        <TicketDetailPanel
          ticket={memoPanel.ticket}
          projectId={memoPanel.projectId}
          sprintId={memoPanel.sprintId}
          projectSlug={memoPanel.projectSlug}
          onClose={() => setMemoPanel(null)}
          onUpdated={() => loadMemos()}
          onDeleted={() => { setMemoPanel(null); loadMemos(); }}
        />
      )}

      {/* ─── メモ詳細ウィンドウ ─── */}
      {selectedMemo && (
        <MemoDetailModal
          memo={selectedMemo}
          ticketStatus={selectedMemo.ticketId ? (ticketStatusMap[selectedMemo.ticketId] ?? null) : null}
          anchorPos={memoAnchorPos}
          onClose={() => { setSelectedMemo(null); setMemoAnchorPos(undefined); }}
          onOpenTicket={selectedMemo.ticketId ? () => { handleMemoOpen(selectedMemo); setSelectedMemo(null); setMemoAnchorPos(undefined); } : undefined}
          onToggleDone={handleToggleDone}
          onSave={handleMemoEdit}
        />
      )}
    </div>
  );
}
