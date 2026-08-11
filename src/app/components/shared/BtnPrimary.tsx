import { type ReactNode } from "react";
import { Loader2 } from "lucide-react";

// loading: 処理中。ボタン自体は押せなくなるが、無効化のグレーではなく通常の
// 緑のまま横にぐるぐるを出して「いま動いている」ことを伝える（BRU11-031）。
export function BtnPrimary({ children, onClick, type = "button", disabled = false, loading = false }: { children: ReactNode; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean; loading?: boolean }) {
  const blocked = disabled || loading;
  return (
    <button type={type} onClick={onClick} disabled={blocked}
      style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 20px", background: disabled ? "#E5E7EB" : "linear-gradient(135deg,#059669,#047857)", color: disabled ? "#9CA3AF" : "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: disabled ? "not-allowed" : loading ? "progress" : "pointer", boxShadow: disabled ? "none" : "0 2px 10px rgba(5,150,105,0.30), inset 0 1px 0 rgba(255,255,255,0.12)", letterSpacing: "-0.01em", transition: "all 0.15s" }}
      onMouseEnter={e => { if (!blocked) (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(5,150,105,0.40), inset 0 1px 0 rgba(255,255,255,0.12)"; }}
      onMouseLeave={e => { if (!blocked) (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 10px rgba(5,150,105,0.30), inset 0 1px 0 rgba(255,255,255,0.12)"; }}>
      {children}
      {loading && (
        <>
          <style>{`@keyframes btn-primary-spin{to{transform:rotate(360deg)}}`}</style>
          <Loader2 style={{ width: 14, height: 14, flexShrink: 0, animation: "btn-primary-spin 0.8s linear infinite" }} />
        </>
      )}
    </button>
  );
}
