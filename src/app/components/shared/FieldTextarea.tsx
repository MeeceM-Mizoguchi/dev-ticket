import { inputCls, labelCls } from "@/app/lib/helpers";

export function FieldTextarea({ label, placeholder, value, onChange }: { label: string; placeholder?: string; value?: string; onChange?: (v: string) => void }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <textarea rows={3} placeholder={placeholder} value={value} onChange={e => onChange?.(e.target.value)} className={inputCls + " resize-none"} />
    </div>
  );
}
