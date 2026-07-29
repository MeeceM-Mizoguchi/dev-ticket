// BRU9-041 組織全体のスキル更新履歴（閲覧専用）
//
// 「昨晩の自動更新で何が変わったのか」を組織全体で一覧するための画面。
// ★ここからは復元できない★ 復元はメンバー個別（スキル編集モーダルの「履歴」タブ）のみ。
//   全員をまとめて巻き戻す操作は影響範囲が大きく、実運用で必要になる場面もほぼ無いため。

import { useEffect, useMemo, useState } from "react";
import { X, History } from "lucide-react";
import type { Member, Skill, SkillUpdateKind } from "@/app/types";
import { fetchSkills, fetchSkillHistory, type SkillHistoryEntry } from "@/app/lib/skillsApi";
import { SkillHistoryView } from "@/app/components/members/SkillHistoryView";

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
  const [skills, setSkills] = useState<Skill[]>([]);
  const [entries, setEntries] = useState<SkillHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SkillUpdateKind | "all">("all");

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

  const shown = filter === "all" ? entries : entries.filter(e => e.run.kind === filter);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#FFFFFF", borderRadius: 16, width: 760, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>

        <div style={{ padding: "18px 22px", borderBottom: "1px solid rgba(26,23,20,0.08)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", display: "flex", alignItems: "center", gap: 7 }}>
              <History style={{ width: 15, height: 15, color: "#059669" }} />スキル更新履歴
            </h2>
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 3 }}>
              組織全体の更新を新しい順に表示します。過去の状態へ戻すには、各メンバーの「スキル」→「履歴」から行ってください。
            </p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#B0A9A4", padding: 4 }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div style={{ padding: "12px 22px 0", display: "flex", gap: 5 }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{ padding: "5px 12px", fontSize: 11.5, fontWeight: 600, borderRadius: 20, cursor: "pointer", border: filter === f.key ? "1px solid #059669" : "1px solid rgba(26,23,20,0.10)", background: filter === f.key ? "#ECFDF5" : "#FFFFFF", color: filter === f.key ? "#059669" : "#6B6458" }}>
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px 18px" }}>
          <SkillHistoryView
            entries={shown}
            skills={skills}
            memberNameById={memberNameById}
            loading={loading} />
        </div>
      </div>
    </div>
  );
}
