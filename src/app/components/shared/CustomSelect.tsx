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
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(o => o.value === value);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = () => setOpen(false);
    window.addEventListener("scroll", h, true);
    window.addEventListener("resize", h);
    return () => {
      window.removeEventListener("scroll", h, true);
      window.removeEventListener("resize", h);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
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
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {selected ? (
            selected.color ? (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 13, fontWeight: 500, color: "#1A1714", whiteSpace: "nowrap",
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: selected.color, display: "inline-block", flexShrink: 0 }} />
                {selected.label}
              </span>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 500, color: "#1A1714", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{selected.label}</span>
            )
          ) : (
            <span style={{ fontSize: 13, color: "#C9C4BB", whiteSpace: "nowrap" }}>{placeholder}</span>
          )}
        </span>
        <ChevronDown style={{
          width: 12, height: 12, color: "#B0A9A4", flexShrink: 0,
          transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s",
        }} />
      </button>

      {open && dropPos && (
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            top: dropPos.top,
            left: dropPos.left,
            width: dropPos.width,
            zIndex: 9999,
            background: "#FFF",
            border: "1px solid rgba(26,23,20,0.12)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            overflow: "hidden",
          }}
        >
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
                    fontSize: 13, fontWeight: 500, color: "#1A1714", flex: 1,
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
