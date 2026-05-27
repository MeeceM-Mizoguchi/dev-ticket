import { type ReactNode } from "react";

export function BtnSecondary({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ padding: "9px 20px", background: "transparent", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "1px solid rgba(26,23,20,0.12)", cursor: "pointer", transition: "all 0.15s" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
      {children}
    </button>
  );
}
