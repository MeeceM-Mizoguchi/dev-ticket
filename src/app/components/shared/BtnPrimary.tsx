import { type ReactNode } from "react";

export function BtnPrimary({ children, onClick, type = "button", disabled = false }: { children: ReactNode; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      style={{ padding: "9px 20px", background: disabled ? "#E5E7EB" : "linear-gradient(135deg,#059669,#047857)", color: disabled ? "#9CA3AF" : "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: disabled ? "not-allowed" : "pointer", boxShadow: disabled ? "none" : "0 2px 10px rgba(5,150,105,0.30), inset 0 1px 0 rgba(255,255,255,0.12)", letterSpacing: "-0.01em", transition: "all 0.15s" }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(5,150,105,0.40), inset 0 1px 0 rgba(255,255,255,0.12)"; }}
      onMouseLeave={e => { if (!disabled) (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 10px rgba(5,150,105,0.30), inset 0 1px 0 rgba(255,255,255,0.12)"; }}>
      {children}
    </button>
  );
}
