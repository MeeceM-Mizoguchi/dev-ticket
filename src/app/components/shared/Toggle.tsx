export function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange}
      style={{ width: 44, height: 24, borderRadius: 12, background: checked ? "#059669" : "#C9C4BB", position: "relative", flexShrink: 0, border: "none", cursor: "pointer", transition: "background 0.2s" }}>
      <span style={{ position: "absolute", top: 2, left: checked ? 22 : 2, width: 20, height: 20, background: "#fff", borderRadius: 10, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
    </button>
  );
}
