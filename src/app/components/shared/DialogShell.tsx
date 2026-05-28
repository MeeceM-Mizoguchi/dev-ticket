import { type ReactNode } from "react";
import { X } from "lucide-react";

export function DialogShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div style={{ position: "relative", zIndex: 10, width: "100%", maxWidth: 580, background: "#FFFFFF", borderRadius: 20, boxShadow: "0 24px 80px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.08)", overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(135deg, #059669 0%, #047857 60%, #065F46 100%)", padding: "22px 24px 20px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
          <div style={{ position: "absolute", bottom: -30, left: 40, width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 5 }}>Dev Ticket</p>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: "#FFFFFF", fontFamily: "var(--font-heading)", letterSpacing: "-0.025em", lineHeight: 1.1 }}>{title}</h2>
            </div>
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid rgba(255,255,255,0.20)", background: "rgba(255,255,255,0.10)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.8)", flexShrink: 0, transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.20)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)"; }}>
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>
        <div style={{ padding: "24px 24px 20px", display: "flex", flexDirection: "column", gap: 14, maxHeight: "80vh", minHeight: 320, overflowY: "auto" }}>{children}</div>
        <div style={{ padding: "14px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid rgba(26,23,20,0.07)" }}>{footer}</div>
      </div>
    </div>
  );
}
