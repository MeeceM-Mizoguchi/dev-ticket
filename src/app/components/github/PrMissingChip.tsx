// 一覧の行に出す「PR未紐付け」バッジ（BRU13-013）。
//
// 行を赤くするだけだと、工数未入力の赤と見分けが付かない。何が足りないのかを行の中で言い切る。
import { GitPullRequest } from "lucide-react";
import { prLinkAlertTitle } from "@/app/lib/prLinkAlert";

export function PrMissingChip({ compact }: { compact?: boolean }) {
  return (
    <span title={prLinkAlertTitle()}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0, whiteSpace: "nowrap" as const,
        fontSize: compact ? 8 : 9, fontWeight: 700, padding: compact ? "1px 6px" : "2px 7px", borderRadius: 20,
        background: "#FEF2F2", color: "#DC2626", border: "1px solid rgba(220,38,38,0.25)",
      }}>
      <GitPullRequest style={{ width: compact ? 8 : 9, height: compact ? 8 : 9 }} />
      PR未紐付け
    </span>
  );
}
