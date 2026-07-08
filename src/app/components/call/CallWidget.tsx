// 通話中フローティングUI。画面右下に固定表示され、ページ遷移しても通話は継続する。
// 各参加者の音声は非表示の <audio> で再生する。
import { useEffect, useRef } from "react";
import { Mic, MicOff, PhoneOff, Loader2, ScreenShare, ScreenShareOff } from "lucide-react";
import { Avatar } from "@/app/components/shared/Avatar";
import { useCall } from "@/app/contexts/CallContext";
import type { Participant } from "@/app/lib/callConstants";

// リモート音声の再生専用要素
function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}

function ParticipantRow({ p, isSelf }: { p: Participant; isSelf: boolean }) {
  const connecting = !isSelf && p.connState !== "connected";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px" }}>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <div style={{ borderRadius: "50%", padding: 2, background: p.speaking ? "#059669" : "transparent", transition: "background 0.1s" }}>
          <Avatar name={p.name} size="sm" />
        </div>
        {p.muted && (
          <div style={{ position: "absolute", right: -2, bottom: -2, width: 16, height: 16, borderRadius: "50%", background: "#EF4444", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff" }}>
            <MicOff style={{ width: 8, height: 8, color: "#fff" }} />
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {p.name}{isSelf && <span style={{ color: "#A09790", fontWeight: 500 }}>（あなた）</span>}
        </div>
        <div style={{ fontSize: 10.5, color: connecting ? "#D97706" : "#059669", display: "flex", alignItems: "center", gap: 4 }}>
          {connecting ? (<><Loader2 style={{ width: 10, height: 10, animation: "callSpin 1s linear infinite" }} /> 接続中…</>)
            : isSelf ? "接続済み" : p.speaking ? "発話中" : "接続済み"}
        </div>
      </div>
      {p.stream && <RemoteAudio stream={p.stream} />}
    </div>
  );
}

export function CallWidget() {
  const { call, hangup, toggleMute, screenShare, screenShareSupported, startScreenShare, stopScreenShare } = useCall();
  if (!call) return null;

  const others = call.participants.filter((p) => p.connState !== "self");
  const self = call.participants.find((p) => p.connState === "self");
  const title = call.status === "outgoing" ? "呼び出し中…" : others.length > 1 ? `グループ通話（${call.participants.length}人）` : "通話中";

  // 画面共有ボタンの状態
  const iAmSharing = !!screenShare?.isSelf;
  const otherSharing = !!screenShare && !screenShare.isSelf;
  const shareDisabled = otherSharing || others.length === 0;
  const shareTitle = iAmSharing ? "画面共有を停止"
    : otherSharing ? `${screenShare!.presenterName}さんが画面共有中`
    : others.length === 0 ? "相手が参加すると共有できます"
    : "画面を共有";

  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 9998, width: 268, background: "#fff", borderRadius: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.08)", border: "1px solid rgba(26,23,20,0.08)", overflow: "hidden" }}>
      <style>{`@keyframes callSpin { to { transform: rotate(360deg) } }`}</style>
      <div style={{ padding: "12px 16px 10px", background: "linear-gradient(145deg,#ECFDF5,#F0FDF8)", borderBottom: "1px solid rgba(5,150,105,0.1)" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#047857" }}>{title}</div>
        <div style={{ fontSize: 11, color: "#A09790", marginTop: 1 }}>{call.projectName}</div>
        {screenShare && (
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, color: "#2563EB" }}>
            <ScreenShare style={{ width: 12, height: 12 }} />
            {iAmSharing ? "あなたが画面共有中" : `${screenShare.presenterName}さんが画面共有中`}
          </div>
        )}
      </div>

      <div style={{ padding: "6px 12px", maxHeight: 220, overflowY: "auto" }}>
        {self && <ParticipantRow p={self} isSelf />}
        {others.map((p) => <ParticipantRow key={p.id} p={p} isSelf={false} />)}
        {call.status === "outgoing" && others.length === 0 && (
          <div style={{ padding: "8px 4px", fontSize: 11.5, color: "#A09790" }}>相手の応答を待っています…</div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, padding: "10px 14px 14px" }}>
        <button
          onClick={toggleMute}
          title={call.muted ? "ミュート解除" : "ミュート"}
          style={{ flex: 1, height: 42, borderRadius: 12, border: "none", cursor: "pointer", background: call.muted ? "#FEF2F2" : "#F4F5F6", color: call.muted ? "#DC2626" : "#3D3732", fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
          {call.muted ? <MicOff style={{ width: 16, height: 16 }} /> : <Mic style={{ width: 16, height: 16 }} />}
          {call.muted ? "ミュート中" : "ミュート"}
        </button>
        {screenShareSupported && (
          <button
            onClick={iAmSharing ? stopScreenShare : startScreenShare}
            disabled={!iAmSharing && shareDisabled}
            title={shareTitle}
            style={{ width: 52, height: 42, borderRadius: 12, border: "none", cursor: !iAmSharing && shareDisabled ? "not-allowed" : "pointer", background: iAmSharing ? "#EFF6FF" : "#F4F5F6", color: iAmSharing ? "#2563EB" : "#3D3732", opacity: !iAmSharing && shareDisabled ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {iAmSharing ? <ScreenShareOff style={{ width: 17, height: 17 }} /> : <ScreenShare style={{ width: 17, height: 17 }} />}
          </button>
        )}
        <button
          onClick={hangup}
          title="退出"
          style={{ width: 52, height: 42, borderRadius: 12, border: "none", cursor: "pointer", background: "#DC2626", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <PhoneOff style={{ width: 18, height: 18 }} />
        </button>
      </div>
    </div>
  );
}
