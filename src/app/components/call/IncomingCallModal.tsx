// 着信モーダル。個人着信チャンネルで invite を受けたときに表示する。
import { Phone, PhoneOff, Users, Loader2 } from "lucide-react";
import { useCall } from "@/app/contexts/CallContext";

export function IncomingCallModal() {
  const { incoming, acceptIncoming, declineIncoming, accepting } = useCall();
  if (!incoming) return null;

  const otherCount = Math.max(0, incoming.members.length - 1);
  const isGroup = incoming.members.length > 2;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(20,26,22,0.45)", backdropFilter: "blur(2px)" }}>
      <style>{`@keyframes callPulse { 0%,100%{box-shadow:0 0 0 0 rgba(5,150,105,0.5)} 50%{box-shadow:0 0 0 14px rgba(5,150,105,0)} }`}</style>
      <div style={{ width: 340, background: "#fff", borderRadius: 20, padding: "28px 24px 22px", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", textAlign: "center" }}>
        <div style={{ margin: "0 auto 16px", width: 76, height: 76, borderRadius: "50%", background: "linear-gradient(145deg,#34D399,#059669)", display: "flex", alignItems: "center", justifyContent: "center", animation: "callPulse 1.6s ease-in-out infinite" }}>
          <Phone style={{ width: 30, height: 30, color: "#fff" }} />
        </div>
        <div style={{ fontSize: 12, color: "#059669", fontWeight: 700, marginBottom: 4 }}>音声通話の着信</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#1A1714" }}>{incoming.fromName}</div>
        <div style={{ fontSize: 12, color: "#A09790", marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <span>{incoming.projectName}</span>
          {isGroup && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Users style={{ width: 12, height: 12 }} /> グループ({incoming.members.length}人)
            </span>
          )}
          {!isGroup && otherCount > 0 && <span>1対1</span>}
        </div>

        {/* 応答処理中(マイク取得待ち)は「接続中…」を表示し、拒否ボタンを隠して
            「応答→即拒否」のレース(拒否したのに通話へ入ってしまう)を UI 段階で防ぐ。 */}
        <style>{`@keyframes incomingSpin { to { transform: rotate(360deg) } }`}</style>
        {accepting ? (
          <div style={{ marginTop: 24, height: 48, borderRadius: 14, background: "#ECFDF5", color: "#047857", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Loader2 style={{ width: 18, height: 18, animation: "incomingSpin 1s linear infinite" }} /> 接続中…
          </div>
        ) : (
          <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
            <button
              onClick={declineIncoming}
              style={{ flex: 1, height: 48, borderRadius: 14, border: "none", cursor: "pointer", background: "#FEF2F2", color: "#DC2626", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <PhoneOff style={{ width: 18, height: 18 }} /> 拒否
            </button>
            <button
              onClick={() => { void acceptIncoming(); }}
              style={{ flex: 1, height: 48, borderRadius: 14, border: "none", cursor: "pointer", background: "linear-gradient(145deg,#34D399,#059669)", color: "#fff", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Phone style={{ width: 18, height: 18 }} /> 応答
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
