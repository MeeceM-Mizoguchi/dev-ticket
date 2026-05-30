import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  color?: string;
  bg?: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}

export function CustomSelect({ value, options, onChange, placeholder = "選択してください" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "7px 10px",
          background: open ? "#FFF" : "#F7F8F9",
          border: `1.5px solid ${open ? "rgba(5,150,105,0.5)" : "rgba(26,23,20,0.12)"}`,
          borderRadius: 9, cursor: "pointer", outline: "none",
          boxShadow: open ? "0 0 0 3px rgba(5,150,105,0.08)" : "none",
          transition: "all 0.15s", textAlign: "left" as const,
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          {selected ? (
            selected.color ? (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: selected.bg ?? `${selected.color}18`,
                color: selected.color,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: selected.color, display: "inline-block", flexShrink: 0 }} />
                {selected.label}
              </span>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 500, color: "#1A1714" }}>{selected.label}</span>
            )
          ) : (
            <span style={{ fontSize: 13, color: "#C9C4BB" }}>{placeholder}</span>
          )}
        </span>
        <ChevronDown style={{
          width: 12, height: 12, color: "#B0A9A4", flexShrink: 0,
          transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s",
        }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 30,
          background: "#FFF", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden",
        }}>
          {options.map(opt => {
            const isSel = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "9px 12px",
                  background: isSel ? "#ECFDF5" : "transparent",
                  border: "none", cursor: "pointer", textAlign: "left" as const,
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSel ? "#ECFDF5" : "transparent"; }}
              >
                {opt.color ? (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                    background: opt.bg ?? `${opt.color}18`, color: opt.color, flex: 1,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: opt.color, display: "inline-block", flexShrink: 0 }} />
                    {opt.label}
                  </span>
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 500, color: isSel ? "#059669" : "#1A1714", flex: 1 }}>{opt.label}</span>
                )}
                {isSel && <Check style={{ width: 12, height: 12, color: "#059669", flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
