import { type ReactNode } from "react";

export function BtnSecondary({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ padding: "9px 20px", background: "transparent", color: disabled ? "#C9C4BB" : "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "1px solid rgba(26,23,20,0.12)", cursor: disabled ? "not-allowed" : "pointer", transition: "all 0.15s", opacity: disabled ? 0.6 : 1 }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
      {children}
    </button>
  );
}
