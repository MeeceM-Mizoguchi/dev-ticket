// タスクの共有先を付け外しするダイアログ。
//
// これが出るまでは、共有は「担当者に指名する」の副作用でしか張れなかった
// （syncAssigneeShare）。そのため
//   ・担当にはしたくないが見せたい
//   ・閲覧だけ許したい（can_edit=false は DB にはあった）
//   ・一度張った共有を外したい
// のいずれもできなかった。ここはその3つだけを担当する。
//
// 付け外しできるのはタスクの所有者だけ（RLS の task_shares_write と同じ）。
// 呼び出し側（TaskWorkspace）が所有者のときしかボタンを出さないので、
// ここでは権限判定はせず「所有者が開いている」前提で描く。
import { useMemo, useState } from "react";
import { Eye, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { PickerCell, type PickerOption } from "@/app/components/tasks/TaskPickerCell";
import type { MemberOption } from "@/app/lib/taskService";
import type { Task, TaskShare } from "@/app/types";

/** 権限の選択肢。can_edit の true/false をそのまま文言にしただけ */
const PERM_OPTIONS: PickerOption[] = [
  { value: "edit", label: "編集可", color: "#059669" },
  { value: "view", label: "閲覧のみ", color: "#0284C7" },
];

export function TaskShareDialog({
  task, shares, members, currentUserId, projectName,
  onAdd, onChangePermission, onRemove, onClose,
}: {
  task: Task;
  /** いまの共有相手。所有者として開いているので全件入っている */
  shares: TaskShare[];
  members: MemberOption[];
  currentUserId: string;
  /** プロジェクトタスクなら、その名前（注意書きに出す） */
  projectName?: string;
  onAdd: (member: MemberOption, canEdit: boolean) => Promise<void>;
  onChangePermission: (share: TaskShare, canEdit: boolean) => Promise<void>;
  onRemove: (share: TaskShare) => Promise<void>;
  onClose: () => void;
}) {
  const [pickedId, setPickedId] = useState("");
  const [pickedPerm, setPickedPerm] = useState("edit");
  const [busy, setBusy] = useState(false);

  // 自分自身と、既に共有済みの相手は候補から外す
  const candidates = useMemo(() => {
    const taken = new Set(shares.map(s => s.profileId));
    return members.filter(m => m.id !== currentUserId && !taken.has(m.id));
  }, [members, shares, currentUserId]);

  const candidateOptions = useMemo<PickerOption[]>(
    () => [{ value: "", label: "メンバーを選ぶ" }, ...candidates.map(m => ({ value: m.id, label: m.name }))],
    [candidates]);

  /** 表示名。profiles を引けなかった相手は members から補う */
  const nameOf = (s: TaskShare) =>
    s.name || members.find(m => m.id === s.profileId)?.name || "（不明なユーザー）";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const handleAdd = () => {
    const m = candidates.find(x => x.id === pickedId);
    if (!m) return;
    run(async () => {
      await onAdd(m, pickedPerm === "edit");
      setPickedId("");
    });
  };

  return (
    <DialogShell title="タスクを共有" size="md" onClose={onClose} zIndex={320}
      footer={<BtnSecondary onClick={onClose}>閉じる</BtnSecondary>}>

      {/* 対象のタスク。どれを共有しているのか見失わないように出す */}
      <div style={{ background: "#FAFAF9", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
        <p style={{ fontSize: 9.5, fontWeight: 700, color: "#A09790", letterSpacing: "0.08em", margin: "0 0 3px" }}>タスク</p>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", margin: 0, wordBreak: "break-all" }}>{task.title}</p>
      </div>

      {/* プロジェクトタスクは共有を張らなくてもPJメンバーには見えている。
          ここで足すのは「PJの外の人にも見せたい」ときだけ、と分かるようにする */}
      {task.projectId && (
        <p style={{ fontSize: 11, color: "#6B6458", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 8, padding: "8px 10px", margin: 0, lineHeight: 1.6 }}>
          このタスクは{projectName ? `「${projectName}」の` : ""}プロジェクトタスクです。
          プロジェクトのメンバーは共有を張らなくても閲覧・編集できます。
          ここでの共有は、プロジェクトに参加していない人にも見せたいときに使ってください。
        </p>
      )}

      {/* ── いまの共有相手 ── */}
      <div>
        <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#6B6458", margin: "0 0 8px" }}>
          <Users style={{ width: 12, height: 12, color: "#059669" }} />
          共有している相手
          <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 99, padding: "0 7px", fontFamily: "var(--font-mono)" }}>
            {shares.length}
          </span>
        </p>

        {shares.length === 0 ? (
          <p style={{ fontSize: 11.5, color: "#A09790", margin: 0, padding: "10px 2px" }}>
            まだ誰にも共有していません。下から相手を選んで追加できます。
          </p>
        ) : (
          <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, overflow: "hidden" }}>
            {shares.map((s, i) => {
              const isAssignee = !!task.assignee && nameOf(s) === task.assignee;
              return (
                <div key={s.profileId}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                    borderTop: i === 0 ? "none" : "1px solid rgba(26,23,20,0.05)",
                  }}>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {nameOf(s)}
                    </span>
                    {/* 担当者の共有を外すと「振ったのに見えない」に逆戻りするので目印を出す */}
                    {isAssignee && (
                      <span title="このタスクの担当者です"
                        style={{ fontSize: 9.5, fontWeight: 700, color: "#D97706", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>
                        担当者
                      </span>
                    )}
                  </span>

                  {/* 権限。upsert なのでその場で付け替えられる */}
                  <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
                    {s.canEdit
                      ? <Pencil style={{ width: 11, height: 11, color: "#059669" }} />
                      : <Eye style={{ width: 11, height: 11, color: "#0284C7" }} />}
                    <PickerCell variant="chip" width={104} value={s.canEdit ? "edit" : "view"} title="この相手の権限"
                      options={PERM_OPTIONS} disabled={busy}
                      onChange={v => run(() => onChangePermission(s, v === "edit"))} />
                  </span>

                  <button type="button" title="共有を解除する" disabled={busy}
                    onClick={() => run(() => onRemove(s))}
                    style={{ border: "none", background: "transparent", padding: 4, cursor: busy ? "default" : "pointer", display: "flex", color: "#C9C4BB", flexShrink: 0 }}
                    onMouseEnter={e => { if (!busy) (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                    <Trash2 style={{ width: 13, height: 13 }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 追加 ── */}
      <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 14 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", margin: "0 0 8px" }}>共有相手を追加</p>
        {candidates.length === 0 ? (
          <p style={{ fontSize: 11.5, color: "#A09790", margin: 0 }}>
            追加できるメンバーがいません（全員に共有済みです）。
          </p>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <PickerCell variant="chip" width={190} value={pickedId} title="共有する相手"
              options={candidateOptions} disabled={busy} onChange={setPickedId} />
            <PickerCell variant="chip" width={116} value={pickedPerm} title="権限"
              options={PERM_OPTIONS} disabled={busy} onChange={setPickedPerm} />
            <button type="button" onClick={handleAdd} disabled={!pickedId || busy}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
                fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none",
                color: !pickedId || busy ? "#9CA3AF" : "#FFF",
                background: !pickedId || busy ? "#E5E7EB" : "#059669",
                cursor: !pickedId || busy ? "not-allowed" : "pointer",
              }}>
              <UserPlus style={{ width: 13, height: 13 }} />共有する
            </button>
          </div>
        )}
        <p style={{ fontSize: 10.5, color: "#A09790", margin: "8px 0 0", lineHeight: 1.6 }}>
          「閲覧のみ」で共有した相手は、内容は見られますが書き換えはできません。
          どちらの場合も、削除できるのは作成した本人だけです。
        </p>
      </div>
    </DialogShell>
  );
}
