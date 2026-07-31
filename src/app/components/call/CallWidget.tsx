// 通話中フローティングUI。画面右下に固定表示され、ページ遷移しても通話は継続する。
// ヘッダーを掴んでドラッグ移動でき、最小化・復帰もできる。
// 各参加者の音声は非表示の <audio> で再生する（最小化中も再生を継続）。
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Loader2, ScreenShare, ScreenShareOff, Minus, Maximize2, AlertTriangle } from "lucide-react";
import { Avatar } from "@/app/components/shared/Avatar";
import { useCall } from "@/app/contexts/CallContext";
import { type CallMember, type Participant } from "@/app/lib/callConstants";

const DRAG_MARGIN = 8; // 画面端との最小余白

// 経過秒数を 時:分:秒 形式（例 0:05:23）に整形する（BRU5-057-4）
function formatDuration(totalSec: number) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// リモート音声の再生専用要素。
// autoPlay 属性任せにせず、srcObject 設定後に明示的に play() を呼び、失敗(自動再生ブロック)を
// 検知して報告する。audioUnlockNonce が増えると(バナークリック=ユーザー操作)再生を再試行する。
function RemoteAudio({ stream }: { stream: MediaStream }) {
  const { reportAudioBlocked, audioUnlockNonce } = useCall();
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    const p = el.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => reportAudioBlocked());
    }
  }, [stream, audioUnlockNonce, reportAudioBlocked]);
  return <audio ref={ref} autoPlay playsInline />;
}

// 呼び出し中(招待済み・未応答)のメンバー。通話中の追加招待でも同じ行を使う(BRU5-066)。
function PendingRow({ m }: { m: CallMember }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", opacity: 0.65 }}>
      <div style={{ flexShrink: 0, padding: 2 }}><Avatar name={m.name} size="sm" /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
        <div style={{ fontSize: 10.5, color: "#A09790", display: "flex", alignItems: "center", gap: 4 }}>
          <Loader2 style={{ width: 10, height: 10, animation: "callSpin 1s linear infinite" }} /> 呼び出し中…
        </div>
      </div>
    </div>
  );
}

function ParticipantRow({ p, isSelf }: { p: Participant; isSelf: boolean }) {
  // 自己修復を試し切って繋がらなかった相手。通話自体は他の参加者と継続する(BRU5-066)。
  const failed = !isSelf && p.connState === "failed";
  const connecting = !isSelf && !failed && p.connState !== "connected";
  if (failed) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px" }}>
        <div style={{ flexShrink: 0, padding: 2, opacity: 0.5 }}><Avatar name={p.name} size="sm" /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
          <div style={{ fontSize: 10.5, color: "#DC2626", display: "flex", alignItems: "center", gap: 4 }}>
            <AlertTriangle style={{ width: 10, height: 10 }} /> 接続できませんでした
          </div>
        </div>
      </div>
    );
  }
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

  const containerRef = useRef<HTMLDivElement>(null);
  // pos=null のときは既定の右下配置。ドラッグすると left/top 座標で固定する。
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number; w: number; h: number } | null>(null);
  // 非対応端末（iPad/iPhone）で画面共有ボタンをタップした際に表示する説明ツールチップ
  const [showShareTip, setShowShareTip] = useState(false);
  const shareTipTimer = useRef<number | null>(null);
  const flashShareTip = useCallback(() => {
    setShowShareTip(true);
    if (shareTipTimer.current) window.clearTimeout(shareTipTimer.current);
    shareTipTimer.current = window.setTimeout(() => setShowShareTip(false), 2800);
  }, []);
  useEffect(() => () => { if (shareTipTimer.current) window.clearTimeout(shareTipTimer.current); }, []);

  // 通話時間の計測: 接続(active)した時刻から1秒ごとに経過秒を更新する（BRU5-057-4）
  const startedAt = call?.startedAt;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  // 画面端を超えないように座標を丸める
  const clamp = useCallback((x: number, y: number, w: number, h: number) => ({
    x: Math.max(DRAG_MARGIN, Math.min(x, window.innerWidth - w - DRAG_MARGIN)),
    y: Math.max(DRAG_MARGIN, Math.min(y, window.innerHeight - h - DRAG_MARGIN)),
  }), []);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    const el = containerRef.current;
    if (!el || e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  }, []);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPos(clamp(e.clientX - d.dx, e.clientY - d.dy, d.w, d.h));
  }, [clamp]);

  const onDragEnd = useCallback((e: React.PointerEvent) => {
    if (dragRef.current) {
      dragRef.current = null;
      setDragging(false);
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    }
  }, []);

  // ウィンドウリサイズ・最小化切替時に画面外へはみ出さないよう再クランプ
  useEffect(() => {
    const reclamp = () => {
      const el = containerRef.current;
      if (!el) return;
      setPos((prev) => {
        if (!prev) return prev;
        const rect = el.getBoundingClientRect();
        return clamp(prev.x, prev.y, rect.width, rect.height);
      });
    };
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [clamp, minimized]);

  if (!call) return null;

  const others = call.participants.filter((p) => p.connState !== "self");
  const self = call.participants.find((p) => p.connState === "self");
  const title = call.status === "outgoing" ? "呼び出し中…" : "通話中";

  // 画面共有ボタンの状態
  const iAmSharing = !!screenShare?.isSelf;
  const otherSharing = !!screenShare && !screenShare.isSelf;
  // iPad/Safari 等は getDisplayMedia 非対応で画面共有を開始できない。ボタンは出すが無効化して理由を示す。
  const shareUnsupported = !screenShareSupported;
  // 非対応端末のときはタップでツールチップを出したいので disabled にはせず、それ以外の理由でのみ無効化する。
  const shareOtherDisabled = otherSharing || others.length === 0;
  const shareDisabled = shareUnsupported || shareOtherDisabled;
  const shareTitle = shareUnsupported ? "この端末（iPad / Safari など）は画面共有に対応していません"
    : iAmSharing ? "画面共有を停止"
    : otherSharing ? `${screenShare!.presenterName}さんが画面共有中`
    : others.length === 0 ? "相手が参加すると共有できます"
    : "画面を共有";

  const posStyle = pos ? { left: pos.x, top: pos.y } : { right: 20, bottom: 20 };
  const dragHandlers = { onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragEnd };
  const stopDrag = (e: React.PointerEvent) => e.stopPropagation(); // ボタン操作でドラッグを開始させない

  // 最小化中も音声を鳴らし続けるための非表示 <audio>
  const hiddenAudios = others.map((p) => p.stream && <RemoteAudio key={p.id} stream={p.stream} />);

  if (minimized) {
    return (
      <div ref={containerRef} style={{ position: "fixed", ...posStyle, zIndex: 9998, background: "#fff", borderRadius: 999, boxShadow: "0 12px 40px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.08)", border: "1px solid rgba(26,23,20,0.08)", display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 6px 12px", touchAction: "none" }}>
        <style>{`@keyframes callSpin { to { transform: rotate(360deg) } } @keyframes callPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
        <div {...dragHandlers} style={{ display: "flex", alignItems: "center", gap: 8, cursor: dragging ? "grabbing" : "grab", flex: 1, minWidth: 0, touchAction: "none" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: call.status === "outgoing" ? "#D97706" : "#059669", flexShrink: 0, animation: "callPulse 1.4s ease-in-out infinite" }} />
          <span style={{ fontSize: 12.5, fontWeight: 800, color: "#047857", whiteSpace: "nowrap" }}>{title}</span>
          {startedAt
            ? <span style={{ fontSize: 11, fontWeight: 700, color: "#059669", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{formatDuration(elapsed)}</span>
            : others.length > 0 && <span style={{ fontSize: 11, color: "#A09790", whiteSpace: "nowrap" }}>{call.participants.length}人</span>}
        </div>
        <button onClick={() => setMinimized(false)} onPointerDown={stopDrag} title="元のサイズに戻す"
          style={{ width: 30, height: 30, borderRadius: "50%", border: "none", cursor: "pointer", background: "#F4F5F6", color: "#3D3732", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Maximize2 style={{ width: 14, height: 14 }} />
        </button>
        <button onClick={hangup} onPointerDown={stopDrag} title="退出"
          style={{ width: 30, height: 30, borderRadius: "50%", border: "none", cursor: "pointer", background: "#DC2626", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <PhoneOff style={{ width: 14, height: 14 }} />
        </button>
        {hiddenAudios}
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "fixed", ...posStyle, zIndex: 9998, width: 268, background: "#fff", borderRadius: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.08)", border: "1px solid rgba(26,23,20,0.08)", overflow: "hidden" }}>
      <style>{`@keyframes callSpin { to { transform: rotate(360deg) } }`}</style>
      <div {...dragHandlers} style={{ padding: "12px 16px 10px", background: "linear-gradient(145deg,#ECFDF5,#F0FDF8)", borderBottom: "1px solid rgba(5,150,105,0.1)", cursor: dragging ? "grabbing" : "grab", touchAction: "none", display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#047857" }}>{title}</div>
            {startedAt && (
              <span style={{ fontSize: 12, fontWeight: 700, color: "#059669", fontVariantNumeric: "tabular-nums" }}>{formatDuration(elapsed)}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#A09790", marginTop: 1 }}>{call.projectName}</div>
          {screenShare && (
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, color: "#2563EB" }}>
              <ScreenShare style={{ width: 12, height: 12 }} />
              {iAmSharing ? "あなたが画面共有中" : `${screenShare.presenterName}さんが画面共有中`}
            </div>
          )}
        </div>
        <button onClick={() => setMinimized(true)} onPointerDown={stopDrag} title="最小化"
          style={{ width: 26, height: 26, borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(5,150,105,0.08)", color: "#047857", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: -2 }}>
          <Minus style={{ width: 15, height: 15 }} />
        </button>
      </div>

      <div style={{ padding: "6px 12px", maxHeight: 220, overflowY: "auto" }}>
        {self && <ParticipantRow p={self} isSelf />}
        {others.map((p) => <ParticipantRow key={p.id} p={p} isSelf={false} />)}
        {call.pending.map((m) => <PendingRow key={m.id} m={m} />)}
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
        <div style={{ position: "relative", display: "flex" }}>
          {showShareTip && (
            <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", width: 150, background: "#1A1714", color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.4, padding: "6px 9px", borderRadius: 8, textAlign: "center", boxShadow: "0 4px 14px rgba(0,0,0,0.25)", zIndex: 10, pointerEvents: "none" }}>
              iPad・iPhone端末ではご利用いただけません
              <span style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "5px solid #1A1714" }} />
            </div>
          )}
          <button
            onClick={iAmSharing ? stopScreenShare : shareUnsupported ? flashShareTip : shareOtherDisabled ? undefined : startScreenShare}
            disabled={!iAmSharing && shareOtherDisabled}
            title={shareTitle}
            style={{ width: 52, height: 42, borderRadius: 12, border: "none", cursor: !iAmSharing && shareDisabled ? "not-allowed" : "pointer", background: iAmSharing ? "#EFF6FF" : "#F4F5F6", color: iAmSharing ? "#2563EB" : "#3D3732", opacity: !iAmSharing && shareDisabled ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {iAmSharing ? <ScreenShareOff style={{ width: 17, height: 17 }} /> : <ScreenShare style={{ width: 17, height: 17 }} />}
          </button>
        </div>
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
