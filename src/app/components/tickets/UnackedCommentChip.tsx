// 一覧の行に出す「💬 未確認 ◯」（BRU25-002）。
// 未確認のコメント（確認済みのチェックが付いていないコメント）の件数。親の行には子の件数も足して出す。

export function UnackedCommentChip({ count, childCount = 0, compact }: { count: number; childCount?: number; compact?: boolean }) {
  if (count <= 0) return null;
  const title = childCount > 0
    ? `未確認のコメントが${count}件あります（うち子チケット ${childCount}件）`
    : `未確認のコメントが${count}件あります`;
  return (
    <span title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0, whiteSpace: "nowrap" as const,
        fontSize: compact ? 8 : 9, fontWeight: 700, padding: compact ? "1px 6px" : "2px 7px", borderRadius: 20,
        background: "#FFF7ED", color: "#C2410C", border: "1px solid rgba(249,115,22,0.35)",
      }}>
      💬 未確認 {count}
    </span>
  );
}
