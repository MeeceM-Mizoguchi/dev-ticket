// BRU9-041 組織全体のスキル変更履歴 ＋ 夜間バッチの学習ログ（閲覧専用）
//
// 「昨晩の自動更新で何が変わったのか」を組織全体で一覧するための画面。
// ★ここからは復元できない★ 復元はメンバー個別（スキル編集モーダルの「変更履歴」タブ）のみ。
//   全員をまとめて巻き戻す操作は影響範囲が大きく、実運用で必要になる場面もほぼ無いため。
//
// タブが2つある理由:
//   変更履歴 … スキルの値が変わったときだけ記録が残る（＝変化を追う）
//   学習ログ … 実行するたびに必ず1行残る（＝毎晩ちゃんと動いているかを見る）
//   前者だけだと「動いたが変更が無かった」と「そもそも動かなかった」が区別できない。

import { useEffect, useMemo, useState } from "react";
import { X, History, ClipboardList } from "lucide-react";
import type { Member, Skill, SkillUpdateKind, MlBatchRun, MlBatchTrigger } from "@/app/types";
import { fetchSkills, fetchSkillHistory, fetchMlBatchLogs, type SkillHistoryEntry } from "@/app/lib/skillsApi";
import { SkillHistoryView } from "@/app/components/members/SkillHistoryView";
import { MlBatchLogView, BatchLogFilter } from "@/app/components/members/MlBatchLogView";

const FILTERS: { key: SkillUpdateKind | "all"; label: string }[] = [
  { key: "all",     label: "すべて" },
  { key: "auto",    label: "自動" },
  { key: "manual",  label: "手動" },
  { key: "restore", label: "復元" },
];

export function SkillHistoryDialog({ orgId, members, onClose }: {
  orgId: string;
  members: Member[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"history" | "batchlog">("history");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [entries, setEntries] = useState<SkillHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SkillUpdateKind | "all">("all");
  const [batchRuns, setBatchRuns] = useState<MlBatchRun[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchTrigger, setBatchTrigger] = useState<MlBatchTrigger | "all">("daily");

  const memberNameById = useMemo(
    () => new Map(members.map(m => [m.id, m.name])),
    [members],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sk, hist] = await Promise.all([
          fetchSkills(orgId),
          fetchSkillHistory(orgId, { limit: 80 }),
        ]);
        if (cancelled) return;
        setSkills(sk);
        setEntries(hist);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  useEffect(() => {
    if (tab !== "batchlog") return;
    let cancelled = false;
    setBatchLoading(true);
    fetchMlBatchLogs(orgId, { trigger: batchTrigger })
      .then(r => { if (!cancelled) setBatchRuns(r); })
      .catch(() => { if (!cancelled) setBatchRuns([]); })
      .finally(() => { if (!cancelled) setBatchLoading(false); });
    return () => { cancelled = true; };
  }, [tab, orgId, batchTrigger]);

  const shown = filter === "all" ? entries : entries.filter(e => e.run.kind === filter);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#FFFFFF", borderRadius: 16, width: 760, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>

        <div style={{ padding: "18px 22px 0", borderBottom: "1px solid rgba(26,23,20,0.08)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", display: "flex", alignItems: "center", gap: 7 }}>
                <History style={{ width: 15, height: 15, color: "#059669" }} />スキル自動更新の記録
              </h2>
              <p style={{ fontSize: 11, color: "#A09790", marginTop: 3 }}>
                過去の状態へ戻すには、各メンバーの「スキル」→「変更履歴」から行ってください。
              </p>
            </div>
            <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#B0A9A4", padding: 4 }}>
              <X style={{ width: 18, height: 18 }} />
            </button>
          </div>

          <div style={{ display: "flex", gap: 2, marginTop: 14 }}>
            {([
              { key: "history" as const, label: "変更履歴", Icon: History },
              { key: "batchlog" as const, label: "学習ログ", Icon: ClipboardList },
            ]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", fontSize: 12, fontWeight: 700, border: "none", background: "transparent", cursor: "pointer", color: tab === t.key ? "#059669" : "#A09790", borderBottom: tab === t.key ? "2px solid #059669" : "2px solid transparent", marginBottom: -1 }}>
                <t.Icon style={{ width: 12, height: 12 }} />{t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px 18px" }}>
          {tab === "batchlog" ? (
            <>
              <BatchLogFilter value={batchTrigger} onChange={setBatchTrigger} />
              <MlBatchLogView runs={batchRuns} loading={batchLoading} />
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
                {FILTERS.map(f => (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    style={{ padding: "5px 12px", fontSize: 11.5, fontWeight: 600, borderRadius: 20, cursor: "pointer", border: filter === f.key ? "1px solid #059669" : "1px solid rgba(26,23,20,0.10)", background: filter === f.key ? "#ECFDF5" : "#FFFFFF", color: filter === f.key ? "#059669" : "#6B6458" }}>
                    {f.label}
                  </button>
                ))}
              </div>
              <SkillHistoryView
                entries={shown}
                skills={skills}
                memberNameById={memberNameById}
                loading={loading} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
