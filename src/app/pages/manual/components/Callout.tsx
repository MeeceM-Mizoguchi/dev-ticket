import type { ReactNode } from "react";
import { Info, Lightbulb, AlertTriangle, Lock } from "lucide-react";

type Variant = "info" | "tip" | "warn" | "permission";

const STYLES: Record<Variant, { bg: string; border: string; color: string; Icon: typeof Info }> = {
  info: { bg: "#F0F9FF", border: "rgba(2,132,199,0.25)", color: "#0369A1", Icon: Info },
  tip: { bg: "#F0FDF4", border: "rgba(5,150,105,0.25)", color: "#047857", Icon: Lightbulb },
  warn: { bg: "#FFFBEB", border: "rgba(217,119,6,0.3)", color: "#B45309", Icon: AlertTriangle },
  permission: { bg: "#F5F3FF", border: "rgba(124,58,237,0.25)", color: "#6D28D9", Icon: Lock },
};

/** ヒント・注意・権限注記のボックス */
export function Callout({ variant = "info", children }: { variant?: Variant; children: ReactNode }) {
  const s = STYLES[variant];
  const Icon = s.Icon;
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 10,
        padding: "10px 13px",
        margin: "10px 0",
      }}
    >
      <Icon style={{ width: 16, height: 16, color: s.color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ fontSize: 13, color: "#3D3732", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}
