import { Ticket, Fingerprint } from "lucide-react";

const fill: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

/** ログイン画面のコーディング再現モック（data-spot で強調対象を指定） */
export function ScreenLogin() {
  return (
    <div style={{ ...fill, background: "linear-gradient(135deg,#ECFDF5,#F4F5F6)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif" }}>
      <div style={{ width: "62%", maxWidth: 320, background: "#fff", borderRadius: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.12)", padding: "26px 26px 22px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 18 }}>
          <div style={{ width: 44, height: 44, borderRadius: 13, background: "linear-gradient(145deg,#34D399,#059669)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 16px rgba(5,150,105,0.35)" }}>
            <Ticket style={{ width: 22, height: 22, color: "#fff" }} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#1A1714", marginTop: 10 }}>Dev Ticket</div>
          <div style={{ fontSize: 11, color: "#A09790", marginTop: 2 }}>ログインしてください</div>
        </div>

        {/* メール＋パスワードの入力区画（強調対象） */}
        <div data-spot="credentials" style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#6B6458", marginBottom: 4 }}>メールアドレス</div>
          <div style={{ height: 34, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#FAFAFA", display: "flex", alignItems: "center", padding: "0 10px", fontSize: 11, color: "#9E9690", marginBottom: 10 }}>you@example.com</div>

          <div style={{ fontSize: 10, fontWeight: 600, color: "#6B6458", marginBottom: 4 }}>パスワード</div>
          <div style={{ height: 34, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#FAFAFA", display: "flex", alignItems: "center", padding: "0 10px", fontSize: 11, color: "#9E9690" }}>••••••••</div>
        </div>

        <div data-spot="login" style={{ height: 36, borderRadius: 9, background: "#059669", color: "#fff", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>ログイン</div>

        <div data-spot="biometric" style={{ height: 34, borderRadius: 9, border: "1px solid rgba(5,150,105,0.35)", color: "#059669", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Fingerprint style={{ width: 14, height: 14 }} /> 生体認証でログイン
        </div>
      </div>
    </div>
  );
}
