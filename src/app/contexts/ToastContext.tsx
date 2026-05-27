import { createContext, useContext, useState, useRef, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Bell } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; msg: string; kind: ToastKind; }

const ToastContext = createContext<{ toast: (msg: string, kind?: ToastKind) => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const nextId = useRef(0);

  const toast = (msg: string, kind: ToastKind = "success") => {
    const id = ++nextId.current;
    setItems(p => [...p, { id, msg, kind }]);
    setTimeout(() => {
      setLeaving(p => new Set([...p, id]));
      setTimeout(() => {
        setItems(p => p.filter(x => x.id !== id));
        setLeaving(p => { const s = new Set(p); s.delete(id); return s; });
      }, 380);
    }, 4620);
  };

  const styleMap: Record<ToastKind, { bg: string; border: string; icon: ReactNode }> = {
    success: { bg: "#ECFDF5", border: "#059669", icon: <CheckCircle2 style={{ width: 16, height: 16, color: "#059669", flexShrink: 0 }} /> },
    error:   { bg: "#FEF2F2", border: "#DC2626", icon: <AlertTriangle style={{ width: 16, height: 16, color: "#DC2626", flexShrink: 0 }} /> },
    info:    { bg: "#F0F9FF", border: "#0284C7", icon: <Bell style={{ width: 16, height: 16, color: "#0284C7", flexShrink: 0 }} /> },
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10, pointerEvents: "none" }}>
        {items.map(t => {
          const s = styleMap[t.kind];
          return (
            <div key={t.id} style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              background: s.bg, borderRadius: 12, padding: "13px 16px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)",
              borderLeft: `3px solid ${s.border}`, border: `1px solid ${s.border}30`,
              minWidth: 280, maxWidth: 400, pointerEvents: "auto",
              animation: leaving.has(t.id) ? "dtOut 0.38s ease-in forwards" : "dtIn 0.42s cubic-bezier(0.175,0.885,0.32,1.1)",
            }}>
              {s.icon}
              <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.5 }}>{t.msg}</p>
            </div>
          );
        })}
      </div>
      <style>{`@keyframes dtIn{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes dtOut{from{transform:translateX(0);opacity:1}to{transform:translateX(110%);opacity:0}}`}</style>
    </ToastContext.Provider>
  );
}
