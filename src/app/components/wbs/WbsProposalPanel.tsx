// KAIZEN2611-015 AI からの更新の案を開いたときの画面（/:projectSlug/wbs/:sheetId?proposal=<案のid>）。
//
// 案（wbs_proposals）と今の WBS の中身を読み、wbsDiff.ts で新旧を組み立てて WbsDiffView に渡す。
// 「この内容で反映」「取り消す」は、押した人の権限で api/wbs の proposal-apply / proposal-reject を呼ぶ。
// 版の番号（案を作ったときの edit_version）が今と違えば、DB が反映を止める。
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/app/contexts/ToastContext";
import type { WbsItem, WbsSheet, WbsStatus } from "@/app/types";
import type { WbsTicketRef } from "@/app/components/wbs/WbsTicketLinkDialog";
import { WbsDiffView } from "@/app/components/wbs/WbsDiffView";
import { buildWbsDiff } from "@/app/lib/wbsDiff";
import {
  decideWbsProposal, loadWbsEditVersion, loadWbsItemTickets, loadWbsItems, loadWbsProposal, loadWbsStatuses, type WbsProposal,
} from "@/app/lib/wbsService";

function receivedAtText(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function WbsProposalPanel({ sheet, proposalId, canEdit, tickets, onDecided, onClose }: {
  sheet: WbsSheet;
  proposalId: string;
  canEdit: boolean;
  tickets: WbsTicketRef[];
  /** 反映した（applied = true）・取り消した（false）あと。いつもの表に戻す */
  onDecided: (applied: boolean) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [proposal, setProposal] = useState<WbsProposal | null>(null);
  const [data, setData] = useState<{ items: WbsItem[]; statuses: WbsStatus[]; links: Map<string, string[]>; version: number | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // BUG-05 反映・取り消しは await を含むので ref で二重送信を止める
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    setProposal(null); setData(null); setLoadError(null); setNotice(null);
    (async () => {
      // 版の番号は画面が持っている値だと古いことがあるので、開いたときに読み直す
      const [p, items, statuses, links, version] = await Promise.all([
        loadWbsProposal(proposalId), loadWbsItems(sheet.id), loadWbsStatuses(sheet.id), loadWbsItemTickets(sheet.id), loadWbsEditVersion(sheet.id),
      ]);
      if (!alive) return;
      if (!p || p.sheetId !== sheet.id) { setLoadError("案が見つかりません（URL が違うか、見られない WBS の案です）"); return; }
      setProposal(p);
      setData({ items, statuses, links, version });
    })().catch(e => { if (alive) setLoadError(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [proposalId, sheet.id]);

  const ticketWbs = useMemo(() => new Map(tickets.map(t => [t.ticket.id, t.ticket.wbs])), [tickets]);
  const model = useMemo(() => (proposal && data
    ? buildWbsDiff({ items: data.items, statuses: data.statuses, levels: sheet.levels, links: data.links, ticketWbs, ops: proposal.ops })
    : null), [proposal, data, sheet.levels, ticketWbs]);

  const decide = async (action: "apply" | "reject") => {
    if (!proposal || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const r = await decideWbsProposal(proposal.id, action);
      if (r.ok) {
        toast(action === "apply" ? "案の内容で WBS を反映しました（反映の前の状態はバックアップに残っています）" : "案を取り消しました");
        onDecided(action === "apply");
        return;
      }
      setNotice(r.code === "conflict" ? "案のあとに WBS が変わったため反映できません。AI にもう一度案を作ってもらってください" : r.error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <p style={{ fontSize: 13, color: "#6B6458" }}>{loadError}</p>
        <button type="button" onClick={onClose} style={{ height: 30, padding: "0 12px", fontSize: 12, fontWeight: 600, border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, background: "#FFF", cursor: "pointer" }}>閉じる</button>
      </div>
    );
  }
  if (!proposal || !model) {
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#A09790" }}>案を読み込み中...</div>;
  }

  const decided = proposal.status !== "pending";
  const disabledReason = decided
    ? (proposal.status === "applied" ? "この案はすでに反映されています" : "この案はすでに取り消されています")
    : !canEdit ? "この WBS を編集する権限が無いため、反映・取り消しはできません" : undefined;
  const source = [proposal.apiKeyName && `API連携「${proposal.apiKeyName}」`, proposal.createdByName && `キーの発行者：${proposal.createdByName}`]
    .filter(Boolean).join("・");

  return (
    <WbsDiffView
      title={decided ? `AIからの更新の案（${proposal.status === "applied" ? "反映済み" : "取り消し済み"}）` : "AIからの更新の案"}
      meta={<>受け取った日時：{receivedAtText(proposal.createdAt)}{source ? `　${source}` : ""}</>}
      model={model}
      warnings={proposal.warnings}
      notice={notice ?? (data?.version !== null && data?.version !== undefined && data.version !== proposal.baseVersion && !decided
        ? "案を作ったあとに WBS が変わっています。このまま反映しようとしても反映されません"
        : null)}
      canApply={canEdit && !decided}
      disabledReason={disabledReason}
      busy={busy}
      onApply={() => { void decide("apply"); }}
      onReject={() => { void decide("reject"); }}
      onClose={onClose}
    />
  );
}
