// BRU9-041 スキル更新履歴の表示（メンバー個別／組織全体の両方から使う）
//
// 1回の更新(run)を1ブロックとして、その中で起きた変更を並べる。
// onRestore を渡したときだけ「この時点に戻す」が出る（＝権限のある人にだけ渡す）。

import { Sparkles, User, RotateCcw, Flag, Undo2 } from "lucide-react";
import type { Skill, SkillUpdateKind, MemberSkillChange } from "@/app/types";
import type { SkillHistoryEntry } from "@/app/lib/skillsApi";
import { layerMeta } from "@/app/lib/skills";

const KIND_META: Record<SkillUpdateKind, { label: string; color: string; bg: string; Icon: typeof Sparkles }> = {
  seed:    { label: "初期",  color: "#6B7280", bg: "#F3F4F6", Icon: Flag },
  auto:    { label: "自動",  color: "#0284C7", bg: "#F0F9FF", Icon: Sparkles },
  manual:  { label: "手動",  color: "#059669", bg: "#ECFDF5", Icon: User },
  restore: { label: "復元",  color: "#D97706", bg: "#FFFBEB", Icon: Undo2 },
};

function formatWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** run の見出しに出す「3件昇格・1件追加」相当の一行 */
function summaryText(entry: SkillHistoryEntry): string {
  const c = entry.changes;
  const added = c.filter(x => x.changeType === "added").length;
  const removed = c.filter(x => x.changeType === "removed").length;
  const up = c.filter(x => x.changeType === "level_changed" && (x.newLevel ?? 0) > (x.oldLevel ?? 0)).length;
  const down = c.filter(x => x.changeType === "level_changed" && (x.newLevel ?? 0) < (x.oldLevel ?? 0)).length;
  const confirmed = c.filter(x => x.changeType === "source_changed").length;

  const parts: string[] = [];
  if (added) parts.push(`${added}件追加`);
  if (up) parts.push(`${up}件昇格`);
  if (down) parts.push(`${down}件降格`);
  if (removed) parts.push(`${removed}件削除`);
  if (confirmed) parts.push(`${confirmed}件確定`);
  // seed の初回投入は件数だけ出す（「追加」と言うと誤解を招くため）
  if (entry.run.kind === "seed") return `${c.length}件を記録`;
  return parts.join(" · ") || `${c.length}件`;
}

/** レベルの変化を「Lv2 → Lv3」の形で見せる */
function LevelDelta({ c }: { c: MemberSkillChange }) {
  const base = { fontSize: 10.5, fontWeight: 700 as const };
  if (c.changeType === "removed") {
    return (
      <span style={{ ...base, color: "#DC2626" }}>
        <span style={{ color: "#B0A9A4" }}>Lv{c.oldLevel}</span> → 削除
      </span>
    );
  }
  if (c.changeType === "added") {
    return <span style={{ ...base, color: "#059669" }}>＋追加 Lv{c.newLevel}</span>;
  }
  if (c.changeType === "source_changed") {
    return <span style={{ ...base, color: "#6B6458" }}>Lv{c.newLevel}（手動で確定）</span>;
  }
  const up = (c.newLevel ?? 0) > (c.oldLevel ?? 0);
  return (
    <span style={{ ...base, color: up ? "#059669" : "#D97706" }}>
      <span style={{ color: "#B0A9A4" }}>Lv{c.oldLevel}</span> → Lv{c.newLevel}
    </span>
  );
}

export function SkillHistoryView({ entries, skills, memberNameById, loading, onRestore }: {
  entries: SkillHistoryEntry[];
  skills: Skill[];
  /** 組織全体表示のときだけ渡す。渡すと各行にメンバー名が出る。 */
  memberNameById?: Map<string, string>;
  loading: boolean;
  /** 渡さなければ閲覧専用。渡すと「この時点に戻す」が出る。 */
  onRestore?: (entry: SkillHistoryEntry) => void;
}) {
  const skillById = new Map(skills.map(s => [s.id, s]));

  if (loading) {
    return <p style={{ fontSize: 12, color: "#A09790", textAlign: "center", padding: "40px 0" }}>読み込み中...</p>;
  }
  if (entries.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <p style={{ fontSize: 12, color: "#A09790" }}>まだ更新履歴がありません</p>
        <p style={{ fontSize: 11, color: "#C9C4BB", marginTop: 6, lineHeight: 1.6 }}>
          スキルを編集するか、毎日未明の自動更新でスキルが変わると、ここに記録されます。
        </p>
      </div>
    );
  }

  return (
    <div>
      {entries.map((entry, idx) => {
        const km = KIND_META[entry.run.kind] ?? KIND_META.manual;
        const { Icon } = km;
        const isLatest = idx === 0;

        return (
          <div key={entry.run.id} style={{ marginBottom: 14, border: "1px solid rgba(26,23,20,0.08)", borderRadius: 11, overflow: "hidden" }}>
            {/* run の見出し */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#FAFAFA", borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: km.bg, color: km.color, flexShrink: 0 }}>
                <Icon style={{ width: 10, height: 10 }} />{km.label}
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "#1A1714", flexShrink: 0 }}>
                {formatWhen(entry.run.createdAt)}
              </span>
              <span style={{ fontSize: 11, color: "#A09790", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {summaryText(entry)}
                {entry.run.restoredFromAt && `（${formatWhen(entry.run.restoredFromAt)} 時点へ）`}
                {entry.run.summary.skillDeleted && `（スキル「${entry.run.summary.skillDeleted}」を削除）`}
              </span>

              {onRestore && !isLatest && (
                <button onClick={() => onRestore(entry)} title="この時点直後の状態に戻す"
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", fontSize: 10.5, fontWeight: 600, borderRadius: 7, border: "1px solid rgba(217,119,6,0.35)", background: "#FFFFFF", color: "#D97706", cursor: "pointer", flexShrink: 0 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FFFBEB"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#FFFFFF"; }}>
                  <RotateCcw style={{ width: 10, height: 10 }} />この時点に戻す
                </button>
              )}
              {onRestore && isLatest && (
                <span style={{ fontSize: 10, color: "#C9C4BB", flexShrink: 0 }}>現在の状態</span>
              )}
            </div>

            {/* 変更の中身 */}
            <div style={{ padding: "6px 12px 8px" }}>
              {entry.changes.map(c => {
                const s = skillById.get(c.skillId);
                const lm = s ? layerMeta(s.layer) : null;
                return (
                  <div key={`${c.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(26,23,20,0.04)" }}>
                    {memberNameById && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#6B6458", width: 88, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {memberNameById.get(c.profileId) ?? "（削除済み）"}
                      </span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 600, color: s ? "#1A1714" : "#C9C4BB", width: 116, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {lm && <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: lm.color, marginRight: 5 }} />}
                      {s?.name ?? "（削除済みスキル）"}
                    </span>
                    <span style={{ flexShrink: 0, width: 108 }}><LevelDelta c={c} /></span>
                    <span style={{ fontSize: 10, color: "#C9C4BB", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.evidence?.doneCount ? `${c.evidence.doneCount}件完了` : ""}
                      {c.evidence?.avgHours ? ` · 平均${c.evidence.avgHours}h` : ""}
                      {c.evidence?.reviewCount ? ` · レビュー${c.evidence.reviewCount}件` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
