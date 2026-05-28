import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { labelCls } from "@/app/lib/helpers";

interface Props {
  value: string;          // YYYY-MM-DD or ""
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  min?: string;           // YYYY-MM-DD
  max?: string;           // YYYY-MM-DD
  required?: boolean;
}

const MONTH_NAMES = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
const DOW = ["日","月","火","水","木","金","土"];

function pad(n: number) { return String(n).padStart(2, "0"); }
function toStr(y: number, m: number, d: number) { return `${y}-${pad(m+1)}-${pad(d)}`; }
function parseDate(s: string): [number, number, number] | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return [y, m - 1, d];
}

export function DatePicker({ value, onChange, label, placeholder = "年/月/日", min, max, required }: Props) {
  const today = new Date().toISOString().split("T")[0];
  const [open, setOpen] = useState(false);
  const wrapRef    = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popupRef   = useRef<HTMLDivElement>(null);   // portal popup — NOT inside wrapRef
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });

  // Calendar month navigation
  const parsed = parseDate(value);
  const todayParsed = parseDate(today)!;
  const [calYear, setCalYear]   = useState(parsed ? parsed[0] : todayParsed[0]);
  const [calMonth, setCalMonth] = useState(parsed ? parsed[1] : todayParsed[1]);

  useEffect(() => {
    const p = parseDate(value);
    if (p) { setCalYear(p[0]); setCalMonth(p[1]); }
  }, [value]);

  const calcPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const POPUP_H = 320;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow >= POPUP_H ? rect.bottom + 6 : Math.max(8, rect.top - POPUP_H - 6);
    setPopupPos({ top, left: rect.left });
  }, []);

  const handleToggle = useCallback(() => {
    calcPosition();
    setOpen(o => !o);
  }, [calcPosition]);

  // Close on outside click — check both the trigger wrapper AND the portal popup
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const inWrap  = wrapRef.current?.contains(e.target as Node);
      const inPopup = popupRef.current?.contains(e.target as Node);
      if (!inWrap && !inPopup) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDow    = new Date(calYear, calMonth, 1).getDay();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const isDisabled = (d: number) => {
    const s = toStr(calYear, calMonth, d);
    return (!!min && s < min) || (!!max && s > max);
  };
  const isToday    = (d: number) => toStr(calYear, calMonth, d) === today;
  const isSelected = (d: number) => toStr(calYear, calMonth, d) === value;

  const prevMonth = () => { if (calMonth === 0) { setCalYear(y => y-1); setCalMonth(11); } else setCalMonth(m => m-1); };
  const nextMonth = () => { if (calMonth === 11) { setCalYear(y => y+1); setCalMonth(0); } else setCalMonth(m => m+1); };

  const select = (d: number) => { if (!isDisabled(d)) { onChange(toStr(calYear, calMonth, d)); setOpen(false); } };

  const displayValue = value ? value.replace(/-/g, "/") : "";
  const todayDisabled = isDisabled(todayParsed[2]) || calYear !== todayParsed[0] || calMonth !== todayParsed[1];
  const todayInRange = today >= (min ?? "0000-00-00") && today <= (max ?? "9999-99-99");

  const calendarPopup = (
    <div ref={popupRef} style={{ position: "fixed", top: popupPos.top, left: popupPos.left, zIndex: 9999, background: "#FFFFFF", borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.07)", border: "1px solid rgba(26,23,20,0.09)", padding: "14px 14px 12px", width: 262 }}>
      {/* Month nav */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={e => { e.stopPropagation(); prevMonth(); }} style={{ padding: "3px 6px", borderRadius: 6, border: "none", background: "#F4F5F6", cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center" }}>
          <ChevronLeft style={{ width: 14, height: 14 }} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{calYear}年 {MONTH_NAMES[calMonth]}</span>
        <button onClick={e => { e.stopPropagation(); nextMonth(); }} style={{ padding: "3px 6px", borderRadius: 6, border: "none", background: "#F4F5F6", cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center" }}>
          <ChevronRight style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* Day-of-week header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 }}>
        {DOW.map((d, i) => (
          <div key={d} style={{ textAlign: "center" as const, fontSize: 10, fontWeight: 700, color: i === 0 ? "#EF4444" : i === 6 ? "#3B82F6" : "#9E9690", paddingBottom: 4 }}>{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dis  = isDisabled(day);
          const tod  = isToday(day);
          const sel  = isSelected(day);
          const dow  = (firstDow + day - 1) % 7;
          return (
            <button key={i} onClick={e => { e.stopPropagation(); select(day); }}
              style={{ padding: "5px 0", borderRadius: 7, border: sel ? "none" : tod ? "1.5px solid #059669" : "none", cursor: dis ? "not-allowed" : "pointer", fontSize: 12, fontWeight: sel || tod ? 700 : 400,
                background: sel ? "#059669" : "transparent",
                color: dis ? "#D5D0CB" : sel ? "#FFF" : tod ? "#059669" : dow === 0 ? "#EF4444" : dow === 6 ? "#3B82F6" : "#1A1714",
                opacity: dis ? 0.5 : 1, transition: "background 0.1s" }}
              onMouseEnter={e => { if (!dis && !sel) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
              onMouseLeave={e => { if (!dis && !sel) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              {day}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(26,23,20,0.06)" }}>
        <button onClick={e => { e.stopPropagation(); onChange(""); setOpen(false); }}
          style={{ fontSize: 11, color: "#B0A9A4", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>削除</button>
        {todayInRange && (
          <button onClick={e => {
            e.stopPropagation();
            const tp = parseDate(today)!;
            setCalYear(tp[0]); setCalMonth(tp[1]);
            if (!todayDisabled) { onChange(today); setOpen(false); }
          }}
            style={{ fontSize: 11, color: "#059669", fontWeight: 700, background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>今日</button>
        )}
      </div>
    </div>
  );

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {label && (
        <label className={labelCls}>
          {label}{required && <span style={{ color: "#DC2626", marginLeft: 2 }}>*</span>}
        </label>
      )}
      <div ref={triggerRef} onClick={handleToggle}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: open ? "#FFF" : "#F7F8F9", border: `1px solid ${open ? "#059669" : "rgba(26,23,20,0.12)"}`, borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontSize: 13, color: displayValue ? "#1A1714" : "#B0A9A4", transition: "all 0.15s", userSelect: "none" as const, boxShadow: open ? "0 0 0 3px rgba(5,150,105,0.08)" : "none" }}>
        <span>{displayValue || placeholder}</span>
        <Calendar style={{ width: 14, height: 14, color: open ? "#059669" : "#B0A9A4", flexShrink: 0 }} />
      </div>

      {open && createPortal(calendarPopup, document.body)}
    </div>
  );
}
