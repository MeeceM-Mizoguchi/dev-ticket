import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { escStack } from "@/app/lib/escStack";

export function AlertDialog({
  title = "確認",
  message,
  onClose,
}: {
  title?: string;
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    escStack.push(onClose);
    return () => escStack.pop(onClose);
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div style={{ position: "relative", zIndex: 10, width: "100%", maxWidth: 400, background: "#FFFFFF", borderRadius: 20, boxShadow: "0 24px 80px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.08)", overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(135deg, #D97706 0%, #B45309 60%, #92400E 100%)", padding: "22px 24px 20px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
          <div style={{ position: "absolute", bottom: -30, left: 40, width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <AlertTriangle style={{ width: 18, height: 18, color: "#FFFFFF" }} />
            </div>
            <div>
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 5 }}>Dev Ticket</p>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: "#FFFFFF", fontFamily: "var(--font-heading)", letterSpacing: "-0.025em", lineHeight: 1.1 }}>{title}</h2>
            </div>
          </div>
        </div>
        <div style={{ padding: "24px 24px 8px" }}>
          <p style={{ fontSize: 14, color: "#1A1714", lineHeight: 1.7 }}>{message}</p>
        </div>
        <div style={{ padding: "16px 24px 20px", display: "flex", justifyContent: "flex-end", borderTop: "1px solid rgba(26,23,20,0.07)", marginTop: 16 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: "9px 24px", background: "#D97706", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(217,119,6,0.30)", transition: "background 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#B45309"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#D97706"; }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
