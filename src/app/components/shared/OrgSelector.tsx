import { useState, useRef, useEffect } from "react";
import { Globe, ChevronDown, Check } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";

export function OrgSelector() {
  const { userRole } = useAuth();
  const { orgs, selectedOrgId, selectedOrgName, setSelectedOrg } = useOrg();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (userRole !== "owner" || orgs.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "7px 12px",
          background: selectedOrgId ? "#ECFDF5" : "#FFFFFF",
          border: `1.5px solid ${selectedOrgId ? "rgba(5,150,105,0.35)" : "rgba(26,23,20,0.12)"}`,
          borderRadius: 10, fontSize: 13, fontWeight: 600,
          color: selectedOrgId ? "#059669" : "#6B6458",
          cursor: "pointer", transition: "all 0.15s",
          whiteSpace: "nowrap" as const,
        }}
      >
        <Globe style={{ width: 13, height: 13 }} />
        {selectedOrgName}
        <ChevronDown style={{ width: 12, height: 12, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0,
          background: "#FFFFFF", border: "1.5px solid rgba(26,23,20,0.08)",
          borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          zIndex: 300, minWidth: 200, overflow: "hidden",
        }}>
          {orgs.map(org => {
            const active = org.id === selectedOrgId;
            return (
              <button
                key={org.id}
                onClick={() => { setSelectedOrg(org.id); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", padding: "10px 14px",
                  fontSize: 13, fontWeight: active ? 700 : 500,
                  color: active ? "#059669" : "#1A1714",
                  background: active ? "#ECFDF5" : "transparent",
                  border: "none", cursor: "pointer", textAlign: "left" as const,
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "#F9FAFB"; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span>{org.name}</span>
                {active && <Check style={{ width: 13, height: 13, color: "#059669" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
