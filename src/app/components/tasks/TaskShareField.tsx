// ENHA2-032 タスクの共有相手を付け外しする欄。
//
// 共有できるのはタスクの所有者だけ（RLS の task_shares_write と同じ条件）。
// 所有者以外には現在の共有相手を読み取り専用で見せる。
import { useEffect, useRef, useState } from "react";
import { Plus, X, Search, Eye, Pencil } from "lucide-react";
import { Avatar } from "@/app/components/shared/Avatar";
import { addTaskShare, removeTaskShare, type MemberOption } from "@/app/lib/taskService";
import { escStack } from "@/app/lib/escStack";
import type { TaskShare } from "@/app/types";

export function TaskShareField({
  taskId, shares, members, canManage, ownerName, onChange, onShared,
}: {
  taskId: string;
  shares: TaskShare[];
  members: MemberOption[];
  canManage: boolean;
  /** 所有者の名前。候補から自分自身を除くために使う */
  ownerName: string;
  onChange: (next: TaskShare[]) => void;
  /** 新しく共有した相手（通知を飛ばすため） */
  onShared: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    escStack.push(close);
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => { escStack.pop(close); document.removeEventListener("mousedown", onDocDown); };
  }, [open]);

  const sharedIds = new Set(shares.map(s => s.profileId));
  const candidates = members
    .filter(m => !sharedIds.has(m.id) && m.name !== ownerName)
    .filter(m => !q || m.name.toLowerCase().includes(q.toLowerCase()));

  const add = async (m: MemberOption) => {
    setOpen(false);
    setQ("");
    onChange([...shares, { profileId: m.id, name: m.name, canEdit: true }]);
    const ok = await addTaskShare(taskId, m.id, true);
    if (ok) onShared(m.name);
  };

  const remove = async (s: TaskShare) => {
    onChange(shares.filter(x => x.profileId !== s.profileId));
    await removeTaskShare(taskId, s.profileId);
  };

  const toggleEdit = async (s: TaskShare) => {
    const next = !s.canEdit;
    onChange(shares.map(x => x.profileId === s.profileId ? { ...x, canEdit: next } : x));
    await addTaskShare(taskId, s.profileId, next);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {shares.length === 0 && !canManage && (
          <span style={{ fontSize: 12, color: "#B0A9A4" }}>共有なし</span>
        )}
        {shares.map(s => (
          <span key={s.profileId}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 4px 3px 3px", background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 99 }}>
            <Avatar name={s.name} size="xs" />
            <span style={{ fontSize: 11.5, color: "#1A1714", fontWeight: 600 }}>{s.name || "(不明)"}</span>
            {canManage ? (
              <>
                <button type="button" onClick={() => toggleEdit(s)}
                  title={s.canEdit ? "編集できます（クリックで閲覧のみに）" : "閲覧のみ（クリックで編集可に）"}
                  style={{ display: "flex", alignItems: "center", border: "none", background: "transparent", cursor: "pointer", padding: 2, color: s.canEdit ? "#059669" : "#A09790" }}>
                  {s.canEdit ? <Pencil style={{ width: 11, height: 11 }} /> : <Eye style={{ width: 11, height: 11 }} />}
                </button>
                <button type="button" onClick={() => remove(s)} title="共有を解除"
                  style={{ display: "flex", alignItems: "center", border: "none", background: "transparent", cursor: "pointer", padding: 2, color: "#B0A9A4" }}>
                  <X style={{ width: 11, height: 11 }} />
                </button>
              </>
            ) : (
              <span style={{ padding: "0 4px", color: s.canEdit ? "#059669" : "#A09790", display: "flex" }}>
                {s.canEdit ? <Pencil style={{ width: 11, height: 11 }} /> : <Eye style={{ width: 11, height: 11 }} />}
              </span>
            )}
          </span>
        ))}

        {canManage && (
          <button type="button" onClick={() => setOpen(o => !o)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 11.5, fontWeight: 600, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 99, cursor: "pointer" }}>
            <Plus style={{ width: 11, height: 11 }} />共有する
          </button>
        )}
      </div>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20, width: 240, background: "#FFF", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,0.14)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
            <Search style={{ width: 12, height: 12, color: "#B0A9A4" }} />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="メンバーを検索"
              style={{ flex: 1, border: "none", outline: "none", fontSize: 12, color: "#1A1714", background: "transparent" }} />
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {candidates.length === 0 && (
              <p style={{ padding: "14px 12px", fontSize: 11.5, color: "#B0A9A4", margin: 0 }}>候補がありません</p>
            )}
            {candidates.map(m => (
              <button key={m.id} type="button" onClick={() => add(m)}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" as const }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F7F8F9"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                <Avatar name={m.name} size="xs" />
                <span style={{ fontSize: 12, color: "#1A1714" }}>{m.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
