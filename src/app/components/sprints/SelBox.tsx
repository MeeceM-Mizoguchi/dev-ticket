// 一括操作用のチェックボックス。
// スプリント一覧・スプリント詳細のどちらの表でも同じ見た目・操作感にするため共通化している。

export function SelBox({ checked, indeterminate, onClick }: { checked: boolean; indeterminate?: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <div onClick={onClick} title="選択" style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", width: "100%" }}>
      <div style={{ width: 15, height: 15, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", border: (checked || indeterminate) ? "none" : "1.5px solid rgba(26,23,20,0.28)", background: checked ? "#059669" : indeterminate ? "#9CA3AF" : "transparent", transition: "all 0.1s" }}>
        {checked && <span style={{ color: "#fff", fontSize: 10, fontWeight: 800, lineHeight: 1 }}>✓</span>}
        {indeterminate && !checked && <span style={{ color: "#fff", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>−</span>}
      </div>
    </div>
  );
}
