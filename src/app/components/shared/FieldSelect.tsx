import { type ReactNode } from "react";
import { inputCls, labelCls } from "@/app/lib/helpers";

export function FieldSelect({ label, children, required, value, onChange }: { label: string; children: ReactNode; required?: boolean; value?: string; onChange?: (v: string) => void }) {
  return (
    <div>
      <label className={labelCls}>{label}{required && " *"}</label>
      <select value={value} onChange={e => onChange?.(e.target.value)} className={inputCls + " appearance-none cursor-pointer"}>
        {children}
      </select>
    </div>
  );
}
