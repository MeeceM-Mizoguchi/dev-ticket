export function PageLoader({ label = "読み込み中..." }: { label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div style={{ width: 34, height: 34, border: "3px solid rgba(5,150,105,0.15)", borderTop: "3px solid #059669", borderRadius: "50%", animation: "pageloader-spin 0.75s linear infinite" }} />
        <p style={{ fontSize: 12, color: "#A09790" }}>{label}</p>
      </div>
      <style>{`@keyframes pageloader-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function BtnSpinner() {
  return (
    <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid rgba(255,255,255,0.35)", borderTop: "2px solid #fff", borderRadius: "50%", animation: "pageloader-spin 0.75s linear infinite", verticalAlign: "middle", marginRight: 6 }} />
  );
}
