// BRU6-002 一括操作の共通ロジック
//
// チケットの複数選択と、それに対する一括アクション（自動アサイン / スプリント移動 /
// リンクコピー / 削除）をまとめたフック。もともと SprintListView にだけ実装されていたが、
// スプリント詳細のチケット一覧でも同じ機能を使うため共通化した。
// 選択状態・確認ダイアログ・進捗モーダルはすべてこのフックが持ち、呼び出し側は
// 返り値の ui を描画してチェックボックスを置くだけでよい。

import { useMemo, useState } from "react";
import type { Sprint, SprintTicket, DevScale } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { copyText } from "@/lib/clipboard";
import { useAuth } from "@/app/contexts/AuthContext";
import { useAlert } from "@/app/contexts/AlertContext";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BulkActionBar } from "@/app/components/sprints/BulkActionBar";
import { BulkAssignProgress, type BulkAssignPhase } from "@/app/components/sprints/BulkAssignProgress";
import { MoveToSprintDialog } from "@/app/components/sprints/MoveToSprintDialog";
import { bulkDeleteTickets, bulkMoveTickets } from "@/app/lib/bulkTicketOps";
import { fetchSkills, fetchBulkRecommendations, logRecommendationAccepted } from "@/app/lib/skillsApi";
import { detectSkillKeywords, ticketSearchText } from "@/app/lib/skills";
import { fireSlackNotify } from "@/app/utils/slackNotify";

function estimateScale(hours: number): DevScale | null {
  if (!hours || hours <= 0) return null;
  if (hours <= 3) return "S";
  if (hours <= 8) return "M";
  if (hours <= 40) return "L";
  return "XL";
}

export function useBulkTicketActions({
  tickets, moveTargets, projectId, projectSlug, projectMembers, onUpdated, onFlash, onMoved, onBeforeMove,
}: {
  /** 選択対象になりうるチケット（親・子を含む全件） */
  tickets: SprintTicket[];
  /** スプリント移動の移動先候補（プロジェクト内の全スプリント） */
  moveTargets?: Sprint[];
  projectId?: string | null;
  projectSlug?: string;
  projectMembers?: string[];
  onUpdated?: () => void | Promise<void>;
  /** 一括アサイン後に対象行を強調表示したい場合のコールバック */
  onFlash?: (ticketIds: string[]) => void;
  /**
   * 🌟 BRU10-077: スプリント移動が完了したときのコールバック。
   * 移動後（採番し直し後）のWBSと移動先スプリントIDを渡す。呼び出し側で
   * 移動先までスクロールして強調表示するために使う。
   * 完了ダイアログを閉じた直後に呼ぶ（ダイアログで隠れている間に強調が消えないようにするため）。
   */
  onMoved?: (movedWbs: string[], targetSprintId: string) => void;
  /** 移動先候補を遅延取得したい場合に使う。移動ダイアログを開く前に await される */
  onBeforeMove?: () => void | Promise<void>;
}) {
  const { userOrgId } = useAuth();
  const { showAlert } = useAlert();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<null | "delete" | "move">(null);
  const [assignState, setAssignState] = useState<{ phase: BulkAssignPhase; current: number; total: number; message?: string } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // 🌟 BRU10-077: 完了ダイアログを閉じたあとに実行する「移動先の強調表示」の予約
  const [pendingMoved, setPendingMoved] = useState<{ wbsList: string[]; targetSprintId: string } | null>(null);

  const selectedTickets = useMemo(() => tickets.filter(t => selectedIds.has(t.id)), [tickets, selectedIds]);

  const clearSelection = () => setSelectedIds(new Set());
  const toggleTicket = (id: string) => setSelectedIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const setSelection = (targets: SprintTicket[], checked: boolean) => setSelectedIds(prev => {
    const n = new Set(prev); targets.forEach(t => { checked ? n.add(t.id) : n.delete(t.id); }); return n;
  });

  // 親を選ぶと子も一緒に削除されるため、確認ダイアログで巻き添え件数を伝える
  const impliedChildCount = useMemo(
    () => tickets.filter(t => t.parentId && selectedIds.has(t.parentId) && !selectedIds.has(t.id)).length,
    [tickets, selectedIds],
  );

  const runBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    const n = selectedTickets.length;
    try {
      await bulkDeleteTickets(ids);
      clearSelection();
      onUpdated?.();
      setSuccessMessage(`${n}件のチケットを削除しました。`);
    } catch (e) {
      showAlert("削除に失敗しました。\n\n" + String(e), "エラー");
    }
  };

  const runBulkCopyLinks = async () => {
    if (!projectSlug) { showAlert("プロジェクト情報が取得できませんでした。", "エラー"); return; }
    const targets = selectedTickets;
    if (targets.length === 0) return;
    const links = targets.map(t => `${window.location.origin}/${projectSlug}/${t.wbs}`).join("\n");
    if (await copyText(links)) {
      setSuccessMessage(`${targets.length}件のチケットのリンクをコピーしました。`);
    } else {
      showAlert("リンクのコピーに失敗しました。", "エラー");
    }
  };

  const runBulkMove = async (targetSprintId: string) => {
    if (!projectId) return;
    const ids = Array.from(selectedIds);
    try {
      const { moved, movedWbs } = await bulkMoveTickets({ ticketIds: ids, targetSprintId, projectId });
      const target = (moveTargets ?? []).find(s => s.id === targetSprintId);
      await onUpdated?.();
      clearSelection();
      setBulkAction(null);
      // 完了ダイアログを閉じた時点で移動先へスクロール＆強調する（BRU10-077）
      if (movedWbs.length > 0) setPendingMoved({ wbsList: movedWbs, targetSprintId });
      setSuccessMessage(`${moved}件のチケットを「${target?.name ?? "スプリント"}」へ移動しました。`);
    } catch (e) {
      showAlert("移動に失敗しました。\n\n" + String(e), "エラー");
    }
  };

  const runBulkAssign = async () => {
    if (!userOrgId) { showAlert("組織情報が取得できませんでした。", "エラー"); return; }
    const targets = selectedTickets.slice();
    if (targets.length === 0) return;

    setAssignState({ phase: "analyzing", current: 0, total: targets.length });
    try {
      const skills = await fetchSkills(userOrgId);

      const ids = targets.map(t => t.id);
      const { data: savedSkills } = isSupabaseEnabled
        ? await supabase!.from("ticket_required_skills").select("ticket_id, skill_id, importance").in("ticket_id", ids)
        : { data: [] as any[] };
      const savedByTicket = new Map<string, { skillId: string; importance: number }[]>();
      for (const r of savedSkills ?? []) {
        const arr = savedByTicket.get(r.ticket_id) ?? [];
        arr.push({ skillId: r.skill_id, importance: r.importance ?? 3 });
        savedByTicket.set(r.ticket_id, arr);
      }

      const resolved = targets.map(t => {
        let required = savedByTicket.get(t.id) ?? [];
        if (required.length === 0) {
          required = detectSkillKeywords(
            ticketSearchText({ title: t.title, description: (t.description ?? "").replace(/<[^>]*>/g, " "), prefixes: t.prefixes ?? [] }),
            skills,
          ).map(id => ({ skillId: id, importance: 3 }));
        }
        const scale = t.devScale ?? estimateScale(t.estimatedHours || 0);
        return { ticket: t, required, scale };
      });

      const { results } = await fetchBulkRecommendations({
        organizationId: userOrgId,
        candidateNames: projectMembers,
        tickets: resolved.map(r => ({
          ticketId: r.ticket.id,
          requiredSkillIds: r.required,
          devScale: r.scale,
          estimatedHours: r.ticket.estimatedHours || 0,
          priority: r.ticket.priority,
          startDate: r.ticket.startDate || null,
          dueDate: r.ticket.dueDate || null,
        })),
      });
      const byTicket = new Map(results.map(r => [r.ticketId, r]));

      setAssignState({ phase: "saving", current: 0, total: targets.length });
      const assignedIds: string[] = [];
      const notifRows: Record<string, unknown>[] = [];
      let done = 0;
      for (const r of resolved) {
        const rec = byTicket.get(r.ticket.id);
        const chosen = rec?.chosen ?? null;
        if (chosen && chosen.name && isSupabaseEnabled) {
          const prev = r.ticket.assignee;
          await supabase!.from("sprint_tickets")
            .update({ assignee: chosen.name, assignees: [chosen.name], dev_scale: r.scale })
            .eq("id", r.ticket.id);
          // ★ 自動付与行(source='auto')は消さない ★ 消すと夜間バッチが翌日また生やして
          //   「消したのに戻る」ように見える。人が確定した行だけを入れ替える。
          await supabase!.from("ticket_required_skills")
            .delete().eq("ticket_id", r.ticket.id).eq("source", "manual");
          if (r.required.length > 0) {
            // 同じスキルが自動付与済みのことがあるので upsert（insert だと主キー衝突する）
            await supabase!.from("ticket_required_skills").upsert(
              r.required.map(s => ({ ticket_id: r.ticket.id, skill_id: s.skillId, importance: s.importance, source: "manual" })),
              { onConflict: "ticket_id,skill_id" },
            );
          }
          if (rec) void logRecommendationAccepted({ organizationId: userOrgId, ticketId: r.ticket.id, candidates: rec.candidates, chosen, source: rec.source });
          if (chosen.name !== prev && projectSlug) {
            notifRows.push({
              user_name: chosen.name, type: "assign", title: "チケットが割り当てられました",
              body: `${r.ticket.wbs}: ${r.ticket.title}（担当: ${prev || "未割り当て"} → ${chosen.name}）`,
              ticket_id: r.ticket.id, ticket_wbs: r.ticket.wbs, ticket_title: r.ticket.title,
              project_slug: projectSlug, is_read: false,
            });
            fireSlackNotify({ recipientUserNames: [chosen.name], projectSlug, title: "チケットが割り当てられました", body: `${r.ticket.wbs}: ${r.ticket.title}` });
          }
          assignedIds.push(r.ticket.id);
        }
        done++;
        setAssignState({ phase: "saving", current: done, total: targets.length });
      }
      if (notifRows.length > 0 && isSupabaseEnabled) {
        await supabase!.from("notifications").insert(notifRows);
      }

      setAssignState(null);
      clearSelection();
      onUpdated?.();
      onFlash?.(assignedIds);
      setSuccessMessage(assignedIds.length === 0
        ? "推奨できる担当者が見つかりませんでした。スキルマスタや条件をご確認ください。"
        : `${assignedIds.length}件のチケットに担当者を自動アサインしました。`);
    } catch (e) {
      setAssignState({ phase: "error", current: 0, total: 0, message: String(e) });
    }
  };

  // 完了ダイアログを閉じる。スプリント移動の直後なら、そのタイミングで強調表示を始める。
  const closeSuccess = () => {
    setSuccessMessage(null);
    if (pendingMoved) {
      const { wbsList, targetSprintId } = pendingMoved;
      setPendingMoved(null);
      onMoved?.(wbsList, targetSprintId);
    }
  };

  const ui = (
    <>
      <BulkActionBar
        count={selectedIds.size}
        disabled={!!assignState}
        onAssign={runBulkAssign}
        onMove={async () => { await onBeforeMove?.(); setBulkAction("move"); }}
        onCopyLinks={runBulkCopyLinks}
        onDelete={() => setBulkAction("delete")}
        onClear={clearSelection}
      />

      {bulkAction === "delete" && (
        <ConfirmDialog
          title="チケットの一括削除"
          message={`選択した ${selectedTickets.length}件 のチケットを削除します。`
            + (impliedChildCount > 0 ? `\n（子チケット ${impliedChildCount}件 も一緒に削除されます）` : "")}
          confirmLabel="削除する"
          onConfirm={runBulkDelete}
          onClose={() => setBulkAction(null)}
        />
      )}

      {bulkAction === "move" && (
        <MoveToSprintDialog
          sprints={moveTargets ?? []}
          count={selectedTickets.length}
          onClose={() => setBulkAction(null)}
          onConfirm={runBulkMove}
        />
      )}

      {assignState && (
        <BulkAssignProgress
          phase={assignState.phase}
          current={assignState.current}
          total={assignState.total}
          message={assignState.message}
          onClose={() => setAssignState(null)}
        />
      )}

      {successMessage && (
        <DialogShell
          title="完了"
          onClose={closeSuccess}
          size="sm"
          footer={<BtnPrimary onClick={closeSuccess}>OK</BtnPrimary>}
        >
          <p style={{ fontSize: 13, color: "#1A1714", margin: 0, lineHeight: 1.5 }}>{successMessage}</p>
        </DialogShell>
      )}
    </>
  );

  return { selectedIds, selectedCount: selectedIds.size, clearSelection, toggleTicket, setSelection, ui };
}
