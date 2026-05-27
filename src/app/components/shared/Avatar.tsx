import { getAvatarColor, getInitials } from "@/app/lib/helpers";

export function Avatar({ name, size = "md" }: { name: string; size?: "xs" | "sm" | "md" | "lg" }) {
  const sz = { xs: 24, sm: 28, md: 36, lg: 48 };
  const fs = { xs: 9, sm: 10, md: 13, lg: 16 };
  const color = getAvatarColor(name);
  const s = sz[size];
  return (
    <div style={{ width: s, height: s, borderRadius: s / 2, background: color, color: "#fff", fontSize: fs[size], fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, userSelect: "none", letterSpacing: "-0.01em" }}>
      {getInitials(name)}
    </div>
  );
}
