import { useState } from "react";
import { GripVertical, ChevronUp, ChevronDown, Users, User } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { computeSprintStatus, getSprintStatusMeta, formatDate } from "@/app/lib/helpers";
import type { Sprint } from "@/app/types";
import type { SprintOrderScope } from "@/app/lib/sprintOrder";

// BRU10-068: スプリント一覧の並び順をドラッグ&ドロップで入れ替えるモーダル。
// 保存時に「全員に適用 / 個人のみに適用」を選ぶダイアログを重ねて表示する。
export function SprintOrderDialog({ sprints, onClose, onSave }: {
  sprints: Sprint[];
  onClose: () => void;
  /** 並び替え後のスプリントIDと適用範囲を受け取り、保存と再読み込みを行う */
  onSave: (sprintIds: string[], scope: SprintOrderScope) => Promise<void>;
}) {
  const [items, setItems] = useState<Sprint[]>(sprints);
  // ドラッグ中の行と、いま乗っている行。並べ替えはドロップ時に確定する
  // （ドラッグ中にDOMを動かすとブラウザによってはドラッグが中断されるため）
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [showScope, setShowScope] = useState(false);
  const [scope, setScope] = useState<SprintOrderScope | null>(null);
  const [saving, setSaving] = useState(false);

  const moveTo = (fromId: string, toIndex: number) => {
    setItems(prev => {
      const from = prev.findIndex(s => s.id === fromId);
      if (from < 0 || toIndex < 0 || toIndex >= prev.length || from === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const endDrag = () => { setDragId(null); setOverId(null); };

  const handleSave = async () => {
    if (!scope || saving) return;
    setSaving(true);
    try {
      await onSave(items.map(s => s.id), scope);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogShell
        title="スプリント並び替え"
        onClose={onClose}
        size="lg"
        footer={
          <>
            <BtnSecondary onClick={onClose}>キャンセル</BtnSecondary>
            <BtnPrimary onClick={() => setShowScope(true)} disabled={items.length === 0}>保存する</BtnPrimary>
          </>
        }
      >
        <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.7, margin: 0 }}>
          行をドラッグ&ドロップ（または右側の矢印）で並び替えます。ここで決めた順番が、スプリント管理のリスト・ボード・ガントチャートの表示順になります。
        </p>

        {items.length === 0 ? (
          <div style={{ padding: "36px 0", textAlign: "center", fontSize: 12.5, color: "#9E9690" }}>
            並び替えできるスプリントがありません。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {items.map((s, i) => {
              const meta = getSprintStatusMeta(computeSprintStatus(s));
              const isDragging = dragId === s.id;
              const isOver = !!dragId && dragId !== s.id && overId === s.id;
              return (
                <div
                  key={s.id}
                  draggable
                  onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setDragId(s.id); }}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragId && dragId !== s.id) setOverId(s.id); }}
                  onDragLeave={() => { if (overId === s.id) setOverId(null); }}
                  onDrop={e => { e.preventDefault(); if (dragId && dragId !== s.id) moveTo(dragId, i); endDrag(); }}
                  onDragEnd={endDrag}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    background: isOver ? "#ECFDF5" : "#FFFFFF",
                    border: `1px solid ${isOver ? "#059669" : "rgba(26,23,20,0.10)"}`,
                    borderRadius: 10, cursor: "grab", opacity: isDragging ? 0.5 : 1,
                    boxShadow: isOver ? "0 4px 14px rgba(5,150,105,0.16)" : "none",
                    transition: "background 0.12s, border-color 0.12s, opacity 0.12s",
                  }}
                >
                  <GripVertical style={{ width: 15, height: 15, color: "#C9C4BB", flexShrink: 0 }} />
                  <span style={{ width: 22, fontSize: 11, fontWeight: 700, color: "#9E9690", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                      {s.identifier && (
                        <span style={{ fontSize: 9.5, fontFamily: "var(--font-mono)", color: "#9CA3AF", background: "#F3F4F6", padding: "2px 6px", borderRadius: 5, fontWeight: 600, flexShrink: 0 }}>{s.identifier}</span>
                      )}
                    </span>
                    <span style={{ display: "block", fontSize: 10.5, color: "#9E9690", marginTop: 2 }}>
                      {formatDate(s.startDate)} 〜 {formatDate(s.endDate)} · {s.tickets.length} チケット
                    </span>
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, padding: "3px 9px", borderRadius: 6, flexShrink: 0 }}>
                    {meta.label}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                    <OrderArrow dir="up" disabled={i === 0} onClick={() => moveTo(s.id, i - 1)} />
                    <OrderArrow dir="down" disabled={i === items.length - 1} onClick={() => moveTo(s.id, i + 1)} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </DialogShell>

      {showScope && (
        <DialogShell
          title="並び順の適用範囲"
          onClose={() => { if (!saving) setShowScope(false); }}
          size="sm"
          zIndex={320}
          footer={
            <>
              <BtnSecondary onClick={() => setShowScope(false)} disabled={saving}>戻る</BtnSecondary>
              <BtnPrimary onClick={handleSave} disabled={!scope || saving}>{saving ? "保存中..." : "保存する"}</BtnPrimary>
            </>
          }
        >
          <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.7, margin: 0 }}>
            この並び順を誰に適用するか選んでください。
          </p>
          <ScopeOption
            icon={Users} label="全員に適用" selected={scope === "all"} onClick={() => setScope("all")}
            hint="このプロジェクトのメンバー全員が、この並び順で表示されるようになります（メンバーごとの個人設定は解除されます）。"
          />
          <ScopeOption
            icon={User} label="個人のみに適用" selected={scope === "personal"} onClick={() => setScope("personal")}
            hint="自分の画面だけこの並び順になります。他のメンバーの表示はこれまで通りです。"
          />
        </DialogShell>
      )}
    </>
  );
}

function OrderArrow({ dir, disabled, onClick }: { dir: "up" | "down"; disabled: boolean; onClick: () => void }) {
  const Icon = dir === "up" ? ChevronUp : ChevronDown;
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      title={dir === "up" ? "上へ" : "下へ"}
      style={{
        width: 22, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
        border: "1px solid rgba(26,23,20,0.10)", borderRadius: 5, background: "#FFFFFF",
        color: disabled ? "#DCD8D2" : "#6B6458", cursor: disabled ? "not-allowed" : "pointer", padding: 0,
      }}>
      <Icon style={{ width: 11, height: 11 }} />
    </button>
  );
}

function ScopeOption({ icon: Icon, label, hint, selected, onClick }: {
  icon: typeof Users; label: string; hint: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, width: "100%", textAlign: "left",
        padding: "12px 13px", borderRadius: 11, cursor: "pointer", transition: "all 0.15s",
        border: `1.5px solid ${selected ? "#059669" : "rgba(26,23,20,0.12)"}`,
        background: selected ? "#ECFDF5" : "#FFFFFF",
      }}>
      <span style={{
        width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: selected ? "#059669" : "#F4F5F6",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon style={{ width: 15, height: 15, color: selected ? "#FFFFFF" : "#9E9690" }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#1A1714" }}>{label}</span>
        <span style={{ display: "block", fontSize: 10.5, color: "#9E9690", marginTop: 2, lineHeight: 1.6 }}>{hint}</span>
      </span>
    </button>
  );
}
