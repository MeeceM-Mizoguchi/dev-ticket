export function ProgressBar({ value }: { value: number }) {
  const color = value >= 70 ? "#059669" : value >= 30 ? "#059669" : "#C9C4BB";
  return (
    <div style={{ height: 5, background: "#EDE9E0", borderRadius: 9999, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(value, 100)}%`, background: color, borderRadius: 9999, transition: "width 0.6s ease" }} />
    </div>
  );
}
