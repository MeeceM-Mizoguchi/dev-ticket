import { AppBackdrop, DimOverlay } from "./AppBackdrop";

const s = (o: React.CSSProperties) => o;

// 実アプリの工程別入力ラベル
const SEGMENTS: { label: string; value: string }[] = [
  { label: "レビュー承認 → STG完了", value: "8" },
  { label: "STG完了 → UAT完了", value: "6" },
  { label: "UAT完了 → 対応完了", value: "4" },
];

/** 実績工数入力（CompletionOverlay 準拠）。詳細画面から開く工数記録モーダル。 */
export function ScreenCompletionOverlay() {
  return (
    <AppBackdrop>
      <DimOverlay />
      <div style={s({ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" })}>
        <div data-spot="hours" style={s({ width: 420, background: "#fff", borderRadius: 16, boxShadow: "0 24px 60px rgba(0,0,0,0.25)", padding: "22px 24px" })}>
          {/* チェックアイコン */}
          <div style={s({ display: "flex", justifyContent: "center", marginBottom: 12 })}>
            <svg viewBox="0 0 100 100" style={{ width: 52, height: 52 }}>
              <circle cx="50" cy="50" r="45" fill="rgba(5,150,105,0.08)" />
              <circle cx="50" cy="50" r="45" fill="none" stroke="#059669" strokeWidth="5" />
              <path d="M26 52 L42 68 L74 32" fill="none" stroke="#059669" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={s({ fontSize: 16, fontWeight: 800, color: "#1A1714", textAlign: "center", marginBottom: 3 })}>対応工数を記録してください</div>
          <div style={s({ fontSize: 11, color: "#9E9690", textAlign: "center", marginBottom: 18 })}>サンプルチケット：一覧画面の作成</div>
          <div style={s({ fontSize: 10.5, color: "#9E9690", marginBottom: 12 })}>各工程の実際の時間を入力してください（時間単位）</div>

          {/* 工程別入力 */}
          <div style={s({ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 })}>
            {SEGMENTS.map((seg) => (
              <div key={seg.label} style={s({ display: "flex", alignItems: "center", gap: 8 })}>
                <span style={s({ flex: 1, fontSize: 11.5, color: "#4B4744", fontWeight: 500 })}>{seg.label}</span>
                <div style={s({ width: 72, height: 30, borderRadius: 8, border: "1.5px solid rgba(26,23,20,0.15)", display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 8px", fontSize: 13, fontWeight: 700, color: "#1A1714" })}>{seg.value}</div>
                <span style={s({ fontSize: 11, color: "#6B6458", width: 14 })}>h</span>
              </div>
            ))}
          </div>

          {/* 合計 */}
          <div style={s({ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1.5px solid rgba(26,23,20,0.08)", paddingTop: 12 })}>
            <span style={s({ fontSize: 12.5, fontWeight: 700, color: "#3D3732" })}>合計</span>
            <span style={s({ fontSize: 14, fontWeight: 800, color: "#059669" })}>18h（2.25人日）</span>
          </div>

          <div style={s({ width: "100%", height: 40, marginTop: 14, borderRadius: 11, background: "#059669", color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(5,150,105,0.30)" })}>完了する</div>
          <div style={s({ fontSize: 11, color: "#B0A9A4", textAlign: "center", marginTop: 12, textDecoration: "underline" })}>チケット詳細に戻る</div>
        </div>
      </div>
    </AppBackdrop>
  );
}
