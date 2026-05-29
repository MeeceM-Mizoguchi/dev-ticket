import { type ReactNode } from "react";
import { inputCls, labelCls } from "@/app/lib/helpers";

export function FieldSelect({ label, children, required, value, onChange, disabled }: { label: string; children: ReactNode; required?: boolean; value?: string; onChange?: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <label className={labelCls}>{label}{required && " *"}</label>
      <select value={value} onChange={e => onChange?.(e.target.value)} disabled={disabled}
        className={inputCls + " appearance-none" + (disabled ? " opacity-50 cursor-not-allowed" : " cursor-pointer")}>
        {children}
      </select>
    </div>
  );
}
