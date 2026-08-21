import { Ticket, Check } from "lucide-react";

const fill: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

/** 招待受諾（パスワード設定）画面のモック */
export function ScreenInvite() {
  return (
    <div style={{ ...fill, background: "linear-gradient(135deg,#ECFDF5,#F4F5F6)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif" }}>
      <div style={{ width: "64%", maxWidth: 330, background: "#fff", borderRadius: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.12)", padding: "24px 26px 22px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 16 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "linear-gradient(145deg,#34D399,#059669)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ticket style={{ width: 20, height: 20, color: "#fff" }} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", marginTop: 9 }}>アカウントを有効化</div>
          <div style={{ fontSize: 11, color: "#A09790", marginTop: 2, textAlign: "center" }}>パスワードを設定してください</div>
        </div>

        <div data-spot="pass" style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#6B6458", marginBottom: 4 }}>パスワード（8文字以上）</div>
          <div style={{ height: 34, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#FAFAFA", display: "flex", alignItems: "center", padding: "0 10px", fontSize: 11, color: "#9E9690", marginBottom: 10 }}>••••••••</div>

          <div style={{ fontSize: 10, fontWeight: 600, color: "#6B6458", marginBottom: 4 }}>パスワード（確認）</div>
          <div style={{ height: 34, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#FAFAFA", display: "flex", alignItems: "center", padding: "0 10px", fontSize: 11, color: "#9E9690" }}>••••••••</div>
        </div>

        <div data-spot="activate" style={{ height: 36, borderRadius: 9, background: "#059669", color: "#fff", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Check style={{ width: 15, height: 15 }} /> 設定して有効化する
        </div>
      </div>
    </div>
  );
}
