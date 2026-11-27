// 一括操作用のチェックボックス。
// スプリント一覧・スプリント詳細のどちらの表でも同じ見た目・操作感にするため共通化している。

//
// KAIZEN2611-023 hit を渡すと、押せる範囲を行の余白（上下・左）まで広げる。
// 負の margin と同じ値の padding で、行の padding の分だけ外へ広げる（見た目の位置・大きさは変わらない）。
// 渡さなければ今と同じ（チェックボックスの列の幅 × 四角の高さ）。

export function SelBox({ checked, indeterminate, onClick, hit }: {
  checked: boolean; indeterminate?: boolean; onClick: (e: React.MouseEvent) => void;
  /** 押せる範囲を広げる幅（px）。y は上下、left は左。行の padding と同じ値を渡す */
  hit?: { y: number; left: number };
}) {
  const hitStyle: React.CSSProperties = hit ? {
    alignSelf: "stretch", boxSizing: "content-box",
    margin: `-${hit.y}px 0 -${hit.y}px -${hit.left}px`,
    padding: `${hit.y}px 0 ${hit.y}px ${hit.left}px`,
  } : {};
  return (
    <div onClick={onClick} title="選択" style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", width: "100%", ...hitStyle }}>
      <div style={{ width: 15, height: 15, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", border: (checked || indeterminate) ? "none" : "1.5px solid rgba(26,23,20,0.28)", background: checked ? "#059669" : indeterminate ? "#9CA3AF" : "transparent", transition: "all 0.1s" }}>
        {checked && <span style={{ color: "#fff", fontSize: 10, fontWeight: 800, lineHeight: 1 }}>✓</span>}
        {indeterminate && !checked && <span style={{ color: "#fff", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>−</span>}
      </div>
    </div>
  );
}
