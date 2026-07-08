// 通話系オーバーレイの集約。ProtectedShell配下に1つだけ常駐させる。
// 着信モーダル・通話ウィジェット・エラートーストをまとめてレンダリングする。
import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { IncomingCallModal } from "./IncomingCallModal";
import { CallWidget } from "./CallWidget";
import { ScreenShareStage } from "./ScreenShareStage";
import { useCall } from "@/app/contexts/CallContext";

export function CallLayer() {
  const { error, clearError } = useCall();

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 5000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  return (
    <>
      <IncomingCallModal />
      <ScreenShareStage />
      <CallWidget />
      {error && (
        <div style={{ position: "fixed", top: 64, left: "50%", transform: "translateX(-50%)", zIndex: 10001, display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", borderRadius: 11, background: "#FEF2F2", border: "1px solid rgba(239,68,68,0.28)", boxShadow: "0 8px 24px rgba(0,0,0,0.14)", maxWidth: 420 }}>
          <AlertTriangle style={{ width: 16, height: 16, color: "#DC2626", flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#DC2626" }}>{error}</span>
          <button onClick={clearError} style={{ background: "none", border: "none", cursor: "pointer", color: "#DC2626", padding: 2, lineHeight: 0 }}><X style={{ width: 14, height: 14 }} /></button>
        </div>
      )}
    </>
  );
}
