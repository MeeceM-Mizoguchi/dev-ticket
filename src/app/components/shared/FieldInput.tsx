import { inputCls, labelCls } from "@/app/lib/helpers";

export function FieldInput({ label, type = "text", placeholder, required, value, onChange, readOnly, error, autoComplete }: {
  label: string; type?: string; placeholder?: string; required?: boolean;
  value?: string; onChange?: (v: string) => void; readOnly?: boolean; error?: string; autoComplete?: string;
}) {
  const borderCls = error ? " border-red-400 focus:border-red-400 focus:ring-red-500/20" : "";
  return (
    <div>
      <label className={labelCls}>{label}{required && " *"}</label>
      <input type={type} placeholder={placeholder} value={value} readOnly={readOnly}
        autoComplete={autoComplete}
        onChange={e => onChange?.(e.target.value)}
        className={inputCls + (readOnly ? " opacity-60 cursor-default" : "") + borderCls} />
      {error && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>{error}</p>}
    </div>
  );
}
