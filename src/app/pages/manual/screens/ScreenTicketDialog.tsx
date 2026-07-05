import { AppBackdrop, DimOverlay } from "./AppBackdrop";
import { X, ChevronDown } from "lucide-react";

const s = (o: React.CSSProperties) => o;

function Label({ children, req }: { children: React.ReactNode; req?: boolean }) {
  return (
    <div style={s({ fontSize: 10, fontWeight: 600, color: "#374151", marginBottom: 4 })}>
      {children}{req && <span style={{ color: "#DC2626" }}> *</span>}
    </div>
  );
}
function Input({ value, ph }: { value?: string; ph?: string }) {
  return (
    <div style={s({ height: 30, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#fff", display: "flex", alignItems: "center", padding: "0 10px", fontSize: 11, color: value ? "#1A1714" : "#B0A9A4" })}>{value ?? ph}</div>
  );
}
function Select({ value }: { value: string }) {
  return (
    <div style={s({ height: 30, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px", fontSize: 11, color: "#1A1714" })}>
      {value}<ChevronDown style={{ width: 12, height: 12, color: "#B0A9A4" }} />
    </div>
  );
}

/** チケット作成ダイアログ（NewTicketDialog 準拠）。スプリントから「チケット作成」で開くフォーム。 */
export function ScreenTicketDialog() {
  return (
    <AppBackdrop>
      <DimOverlay />
      <div style={s({ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" })}>
        <div style={s({ width: 460, maxHeight: "92%", background: "#fff", borderRadius: 14, boxShadow: "0 24px 60px rgba(0,0,0,0.25)", overflow: "hidden", display: "flex", flexDirection: "column" })}>
          {/* header */}
          <div style={s({ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px", borderBottom: "1px solid rgba(26,23,20,0.07)" })}>
            <span style={s({ fontSize: 14, fontWeight: 800, color: "#1A1714" })}>チケットを作成</span>
            <X style={{ width: 16, height: 16, color: "#B0A9A4" }} />
          </div>
          {/* body */}
          <div style={s({ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 11, overflow: "hidden" })}>
            <div><Label req>チケット名</Label><Input ph="例: ログイン機能の修正" /></div>
            <div style={s({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 })}>
              <div><Label>ステータス</Label><Select value="未着手" /></div>
              <div><Label>優先度</Label><Select value="中" /></div>
            </div>
            <div style={s({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 })}>
              <div><Label>分類</Label><Select value="分類なし" /></div>
              <div><Label>担当者</Label><Select value="田中 太郎" /></div>
            </div>
            <div style={s({ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 })}>
              <div><Label>開始日</Label><Input value="2026/06/01" /></div>
              <div><Label>終了日</Label><Input value="2026/06/05" /></div>
              <div><Label>見積(人日)</Label><Input value="3.0" /></div>
            </div>
            <div><Label>詳細</Label>
              <div style={s({ height: 44, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#fff", padding: "7px 10px", fontSize: 10.5, color: "#B0A9A4" })}>詳細を入力…（@メンション・画像添付も可）</div>
            </div>
            <div><Label>ラベル（最大3つ）</Label>
              <div style={s({ display: "flex", gap: 5 })}>
                <span style={s({ fontSize: 9, fontWeight: 700, color: "#0369A1", background: "#F0F9FF", borderRadius: 999, padding: "2px 8px" })}>UI</span>
                <span style={s({ fontSize: 9, fontWeight: 700, color: "#6B7280", background: "#F3F4F6", borderRadius: 999, padding: "2px 8px" })}>＋ ラベル</span>
              </div>
            </div>
          </div>
          {/* footer */}
          <div style={s({ display: "flex", gap: 10, padding: "12px 18px", borderTop: "1px solid rgba(26,23,20,0.07)" })}>
            <div style={s({ flex: 1, height: 36, borderRadius: 9, border: "1px solid rgba(26,23,20,0.14)", background: "#fff", color: "#6B6458", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" })}>キャンセル</div>
            <div data-spot="create" style={s({ flex: 1, height: 36, borderRadius: 9, background: "#059669", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" })}>作成する</div>
          </div>
        </div>
      </div>
    </AppBackdrop>
  );
}
