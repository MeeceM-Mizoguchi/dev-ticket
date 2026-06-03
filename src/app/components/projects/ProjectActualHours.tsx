import { useProjectActualHours } from "@/app/hooks/useProjectActualHours";
import { formatActualHours } from "@/app/lib/helpers";
import { Clock } from "lucide-react";

export function ProjectActualHours({ projectId }: { projectId: string }) {
  const { actualHours, loading } = useProjectActualHours(projectId);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <Clock style={{ width: 10, height: 10, color: "#B0A9A4", flexShrink: 0 }} />
      <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 600 }}>実績工数</span>
      <span style={{
        fontSize: 10,
        color: loading ? "#C9C4BB" : actualHours !== null && actualHours > 0 ? "#059669" : "#B0A9A4",
        fontFamily: "var(--font-mono)", fontWeight: 700,
      }}>
        {loading ? "—" : actualHours !== null ? formatActualHours(actualHours) : "—"}
      </span>
    </div>
  );
}
