import { inputCls, labelCls } from "@/app/lib/helpers";
import { submitOnModEnter } from "@/app/lib/submitKey";

export function FieldTextarea({ label, placeholder, value, onChange, onSubmit }: { label: string; placeholder?: string; value?: string; onChange?: (v: string) => void; onSubmit?: () => void }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {/* onSubmit を渡すと ⌘/Ctrl + Enter で確定できる（Enter 単体は改行のまま） */}
      <textarea rows={3} placeholder={placeholder} value={value} onChange={e => onChange?.(e.target.value)} onKeyDown={submitOnModEnter(onSubmit)} className={inputCls + " resize-none"} />
    </div>
  );
}
