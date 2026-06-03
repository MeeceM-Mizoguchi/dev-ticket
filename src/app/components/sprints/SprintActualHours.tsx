import { formatActualHours } from "@/app/lib/helpers";

export function SprintActualHours({
  actualHours,
  loading,
}: {
  actualHours: number | null;
  loading?: boolean;
}) {
  return (
    <div style={{ textAlign: "center" as const }}>
      <p style={{
        fontSize: 16, fontWeight: 800,
        color: loading ? "#C9C4BB" : actualHours !== null && actualHours > 0 ? "#059669" : "#B0A9A4",
        fontFamily: "var(--font-heading)", letterSpacing: "-0.02em",
      }}>
        {loading ? "—" : actualHours !== null ? formatActualHours(actualHours) : "—"}
      </p>
      <p style={{ fontSize: 10, color: "#B0A9A4" }}>実績(h)</p>
    </div>
  );
}
