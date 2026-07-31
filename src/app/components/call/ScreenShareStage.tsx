// ENHA2-030 画面共有ステージ。共有中に開く大きめのオーバーレイ。
// 共有映像(<video>)の上にポインター/アノテーションのレイヤーを重ねる。
// 共有者=ポインター送信(自己プレビュー)・視聴者=手書き/テキスト送信(5秒で消滅)。
// ウィンドウはヘッダードラッグで移動・右下ハンドルでリサイズ可。対応ブラウザ(Chrome等)では
// Document Picture-in-Picture で本物の別ウィンドウとして切り出し、外部モニターへ移動できる。
// ※PiPは別ドキュメントになりReactの合成イベントが跨げないため、PiPウィンドウ内に専用のReactルートを
//   作って StagePanel を描画する(こうするとPiP内でもクリック/描画が効く)。
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ScreenShare, ScreenShareOff, MousePointer2, Pencil, Type, Minimize2, Maximize2, ExternalLink } from "lucide-react";
import { useCall } from "@/app/contexts/CallContext";
import { contentRect, toNorm, fromNorm, type Rect } from "@/app/lib/screenShareGeom";
import type { AnnotationInput, ScreenShareState } from "@/app/lib/callConstants";

const COLORS = ["#EF4444", "#2563EB", "#059669", "#F59E0B", "#7C3AED", "#111827"];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`);
const KEYFRAMES = `@keyframes ssPing { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.4);opacity:0} } @keyframes annFade { 0%,80%{opacity:1} 100%{opacity:0} }`;

// Document Picture-in-Picture 対応判定(Chrome/Edge のデスクトップ)。
const pipSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;

interface PanelActions {
  sendPointer: (nx: number, ny: number, visible: boolean) => void;
  sendAnnotation: (ann: AnnotationInput) => void;
  stopScreenShare: () => void;
}

// ── 中身(video+オーバーレイ+ツールバー)。ページ内/PiPウィンドウの両方で同一に使う自己完結コンポーネント ──
function StagePanel({
  screenShare, inPip, actions, onMinimize, onRequestPip, onClosePip,
}: {
  screenShare: ScreenShareState;
  inPip: boolean;
  actions: PanelActions;
  onMinimize?: () => void;
  onRequestPip?: () => void;
  onClosePip?: () => void;
}) {
  const { sendPointer, sendAnnotation, stopScreenShare } = actions;
  const isSelf = screenShare.isSelf;
  const stream = screenShare.stream;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pointerMode, setPointerMode] = useState(false);
  const [tool, setTool] = useState<"none" | "pen" | "text">("none");
  const [color, setColor] = useState(COLORS[0]);
  const [draft, setDraft] = useState<{ nx: number; ny: number }[] | null>(null);
  const [textInput, setTextInput] = useState<{ nx: number; ny: number; value: string } | null>(null);

  // ページ内表示のときの位置・サイズ(PiPではウィンドウいっぱい)
  const win = inPip ? (typeof globalThis !== "undefined" ? globalThis : undefined) : (typeof window !== "undefined" ? window : undefined);
  const [pos, setPos] = useState(() => ({ x: Math.max(12, ((win?.innerWidth ?? 1200) / 2) - 440), y: 76 }));
  const [size, setSize] = useState(() => ({ w: Math.min(880, (win?.innerWidth ?? 900) * 0.92), h: Math.min(560, (win?.innerHeight ?? 700) * 0.72) }));
  // ヘッダーのダブルクリック/ダブルタップで画面いっぱいに最大化⇄元のサイズをトグルする(ページ内のみ)
  const [maximized, setMaximized] = useState(false);
  const lastTapRef = useRef(0);
  const toggleMaximize = useCallback(() => { if (!inPip) setMaximized((v) => !v); }, [inPip]);

  const recompute = useCallback(() => {
    const v = videoRef.current;
    if (v) setRect(contentRect(v));
  }, []);

  // ストリームを video に流し込む(video が作り直されても再アタッチ=黒画面対策)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== (stream ?? null)) v.srcObject = stream ?? null;
    void v.play?.().catch(() => {});
    recompute();
  }, [stream, recompute]);

  // サイズ/メタデータ変化で描画矩形を再計算
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const doc = v.ownerDocument;
    const view = doc.defaultView;
    const ro = new ResizeObserver(recompute);
    ro.observe(v);
    v.addEventListener("loadedmetadata", recompute);
    view?.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      v.removeEventListener("loadedmetadata", recompute);
      view?.removeEventListener("resize", recompute);
    };
  }, [recompute]);

  const interactive = isSelf ? pointerMode : tool !== "none";

  // ── ポインター(共有者) / 描画(視聴者) ──
  const onPointerMove = (e: ReactPointerEvent) => {
    const v = videoRef.current;
    if (!v) return;
    if (isSelf && pointerMode) {
      const n = toNorm(v, e.clientX, e.clientY);
      if (n) sendPointer(n.nx, n.ny, true); else sendPointer(0, 0, false);
      return;
    }
    if (!isSelf && tool === "pen" && draft) {
      const n = toNorm(v, e.clientX, e.clientY);
      if (n) setDraft((prev) => (prev ? [...prev, n] : [n]));
    }
  };
  const onPointerLeave = () => { if (isSelf && pointerMode) sendPointer(0, 0, false); };
  const onPointerDown = (e: ReactPointerEvent) => {
    const v = videoRef.current;
    if (!v || isSelf) return;
    const n = toNorm(v, e.clientX, e.clientY);
    if (!n) return;
    if (tool === "pen") { (e.target as Element).setPointerCapture?.(e.pointerId); setDraft([n]); }
    else if (tool === "text") setTextInput({ nx: n.nx, ny: n.ny, value: "" });
  };
  const onPointerUp = () => {
    if (isSelf || tool !== "pen" || !draft) return;
    if (draft.length >= 2) sendAnnotation({ id: uid(), kind: "stroke", color, points: draft } as AnnotationInput);
    setDraft(null);
  };
  const commitText = () => {
    if (!textInput) return;
    const text = textInput.value.trim();
    if (text) sendAnnotation({ id: uid(), kind: "text", color, nx: textInput.nx, ny: textInput.ny, text } as AnnotationInput);
    setTextInput(null);
  };

  // ── ヘッダードラッグで移動 / 右下ハンドルでリサイズ(ページ内のみ) ──
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const onHeaderDown = (e: ReactPointerEvent) => {
    if (inPip || (e.target as HTMLElement).closest("button")) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHeaderMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d || maximized) return; // 最大化中は移動しない
    const w = win ?? window;
    setPos({ x: Math.min(Math.max(0, d.ox + (e.clientX - d.sx)), w.innerWidth - 120), y: Math.min(Math.max(0, d.oy + (e.clientY - d.sy)), w.innerHeight - 48) });
  };
  const onHeaderUp = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (!d) return;
    // ほぼ動いていない=タップ。350ms以内の連続タップ(ダブルクリック/ダブルタップ)で最大化をトグル。
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 6) {
      const now = (win ?? window).performance.now();
      if (now - lastTapRef.current < 350) { toggleMaximize(); lastTapRef.current = 0; }
      else lastTapRef.current = now;
    }
  };

  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);
  const onResizeDown = (e: ReactPointerEvent) => { e.stopPropagation(); resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: size.w, oh: size.h }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onResizeMove = (e: ReactPointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    setSize({ w: Math.max(360, r.ow + (e.clientX - r.sx)), h: Math.max(240, r.oh + (e.clientY - r.sy)) });
    recompute();
  };
  const onResizeUp = (e: ReactPointerEvent) => { resizeRef.current = null; try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ } };

  return (
    <div style={inPip
      ? { display: "flex", flexDirection: "column", width: "100%", height: "100vh", background: "#0B0F17", overflow: "hidden" }
      : maximized
      ? { position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: 9990, display: "flex", flexDirection: "column", background: "#0B0F17", overflow: "hidden" }
      : { position: "fixed", left: pos.x, top: pos.y, width: size.w, height: size.h, minWidth: 360, minHeight: 240, zIndex: 9990, display: "flex", flexDirection: "column", background: "#0B0F17", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
      <style>{KEYFRAMES}</style>

      {/* ヘッダ(ドラッグ移動ハンドル) */}
      <div
        onPointerDown={onHeaderDown} onPointerMove={onHeaderMove} onPointerUp={onHeaderUp}
        title={inPip ? undefined : "ダブルクリックで全画面表示 / 元に戻す"}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: "rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: inPip || maximized ? "default" : "move", flexShrink: 0, userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: "#E5E7EB" }}>
          <ScreenShare style={{ width: 15, height: 15, color: "#60A5FA" }} />
          {isSelf ? "あなたの画面を共有中" : `${screenShare.presenterName}さんの画面`}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {inPip ? (
            <button onClick={onClosePip} title="ページに戻す" style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 9px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.1)", color: "#D1D5DB", fontSize: 11.5, fontWeight: 700 }}>
              <Minimize2 style={{ width: 14, height: 14 }} /> 戻す
            </button>
          ) : (
            <>
              {onRequestPip && (
                <button onClick={onRequestPip} title="別ウィンドウで開く（外部モニターに移動可）" style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", padding: 4, lineHeight: 0 }}>
                  <ExternalLink style={{ width: 15, height: 15 }} />
                </button>
              )}
              <button onClick={onMinimize} title="最小化" style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", padding: 4, lineHeight: 0 }}>
                <Minimize2 style={{ width: 15, height: 15 }} />
              </button>
            </>
          )}
          {isSelf && (
            <button onClick={stopScreenShare} title="共有を停止" style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: "#DC2626", color: "#fff", fontSize: 11.5, fontWeight: 700 }}>
              <ScreenShareOff style={{ width: 14, height: 14 }} /> 停止
            </button>
          )}
        </div>
      </div>

      {/* 映像 + オーバーレイ(残り領域いっぱい) */}
      <div style={{ position: "relative", flex: 1, minHeight: 0, background: "#000" }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />

        <div
          onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} onPointerDown={onPointerDown} onPointerUp={onPointerUp}
          style={{ position: "absolute", inset: 0, cursor: interactive ? (tool === "text" && !isSelf ? "text" : "crosshair") : "default", pointerEvents: interactive ? "auto" : "none", touchAction: "none" }}
        />

        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {screenShare.annotations.map((a) => {
            if (a.kind !== "stroke") return null;
            const pts = a.points.map((p) => { const q = fromNorm(rect, p.nx, p.ny); return `${q.x},${q.y}`; }).join(" ");
            return <polyline key={a.id} points={pts} fill="none" stroke={a.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{ animation: "annFade 5s linear forwards" }} />;
          })}
          {draft && draft.length >= 2 && (
            <polyline points={draft.map((p) => { const q = fromNorm(rect, p.nx, p.ny); return `${q.x},${q.y}`; }).join(" ")} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>

        {screenShare.annotations.map((a) => {
          if (a.kind !== "text") return null;
          const q = fromNorm(rect, a.nx, a.ny);
          return (
            <div key={a.id} style={{ position: "absolute", left: q.x, top: q.y, transform: "translate(-2px,-50%)", maxWidth: 260, padding: "3px 7px", borderRadius: 6, background: "rgba(255,255,255,0.92)", color: a.color, fontSize: 14, fontWeight: 700, pointerEvents: "none", whiteSpace: "pre-wrap", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", animation: "annFade 5s linear forwards" }}>
              {a.text}
            </div>
          );
        })}

        {(() => {
          const ptr = screenShare.pointer;
          if (!ptr || !rect) return null;
          const q = fromNorm(rect, ptr.nx, ptr.ny);
          return (
            <div style={{ position: "absolute", left: q.x, top: q.y, transform: "translate(-50%,-50%)", pointerEvents: "none" }}>
              <div style={{ position: "absolute", left: -9, top: -9, width: 18, height: 18, borderRadius: "50%", border: "2px solid #F87171", animation: "ssPing 1s ease-out infinite" }} />
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#EF4444", boxShadow: "0 0 8px rgba(239,68,68,0.9)", transform: "translate(-50%,-50%)" }} />
              <div style={{ position: "absolute", top: 10, left: 8, fontSize: 10.5, fontWeight: 700, color: "#fff", background: "rgba(239,68,68,0.9)", padding: "1px 5px", borderRadius: 5, whiteSpace: "nowrap" }}>{ptr.name}</div>
            </div>
          );
        })()}

        {textInput && rect && (() => {
          const q = fromNorm(rect, textInput.nx, textInput.ny);
          return (
            <input
              autoFocus value={textInput.value}
              onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") commitText(); else if (e.key === "Escape") setTextInput(null); }}
              onBlur={commitText}
              placeholder="テキスト（Enterで確定）"
              style={{ position: "absolute", left: q.x, top: q.y, transform: "translateY(-50%)", minWidth: 160, padding: "3px 7px", borderRadius: 6, border: `2px solid ${color}`, background: "rgba(255,255,255,0.95)", color, fontSize: 14, fontWeight: 700, outline: "none" }}
            />
          );
        })()}
      </div>

      {/* ツールバー */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "rgba(255,255,255,0.04)", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        {isSelf ? (
          <button
            onClick={() => setPointerMode((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 9, border: "none", cursor: "pointer", background: pointerMode ? "#2563EB" : "rgba(255,255,255,0.1)", color: pointerMode ? "#fff" : "#D1D5DB", fontSize: 12, fontWeight: 700 }}>
            <MousePointer2 style={{ width: 14, height: 14 }} /> ポインター{pointerMode ? "ON" : "OFF"}
          </button>
        ) : (
          <>
            <button onClick={() => setTool((t) => (t === "pen" ? "none" : "pen"))} title="ペン" style={toolBtn(tool === "pen")}><Pencil style={{ width: 15, height: 15 }} /></button>
            <button onClick={() => setTool((t) => (t === "text" ? "none" : "text"))} title="テキスト" style={toolBtn(tool === "text")}><Type style={{ width: 15, height: 15 }} /></button>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 4 }}>
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} title="色" style={{ width: 18, height: 18, borderRadius: "50%", background: c, border: color === c ? "2px solid #fff" : "2px solid transparent", boxShadow: color === c ? "0 0 0 1px rgba(0,0,0,0.4)" : "none", cursor: "pointer", padding: 0 }} />
              ))}
            </div>
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#9CA3AF" }}>描いた線・文字は5秒で消えます</span>
          </>
        )}
      </div>

      {!inPip && !maximized && (
        <div
          onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp}
          title="サイズ変更"
          style={{ position: "absolute", right: 0, bottom: 0, width: 20, height: 20, cursor: "nwse-resize", touchAction: "none", background: "linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.35) 50%)" }}
        />
      )}
    </div>
  );
}

// ── コンテナ: ページ内表示・最小化ピル・PiP別ウィンドウ(専用Reactルート)を出し分ける ──
export function ScreenShareStage() {
  const { screenShare, sendPointer, sendAnnotation, stopScreenShare } = useCall();
  const [minimized, setMinimized] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const pipRootRef = useRef<Root | null>(null);

  useEffect(() => { pipWindowRef.current = pipWindow; }, [pipWindow]);

  const closePip = useCallback(() => { pipWindowRef.current?.close(); setPipWindow(null); }, []);

  const openPip = useCallback(async () => {
    if (!pipSupported) return;
    try {
      const w: Window = await (window as unknown as { documentPictureInPicture: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } })
        .documentPictureInPicture.requestWindow({ width: 900, height: 620 });
      w.document.body.style.margin = "0";
      w.document.body.style.background = "#0B0F17";
      w.document.body.style.overflow = "hidden";
      w.addEventListener("pagehide", () => setPipWindow(null));
      setMinimized(false);
      setPipWindow(w);
    } catch { /* ユーザーが拒否/未対応 */ }
  }, []);

  // PiPウィンドウ内に専用ルートを作る(合成イベントを効かせるため)
  useEffect(() => {
    if (!pipWindow) return;
    const root = createRoot(pipWindow.document.body);
    pipRootRef.current = root;
    return () => { root.unmount(); pipRootRef.current = null; };
  }, [pipWindow]);

  // PiPルートへ現在の状態を反映(screenShare が変わるたび再描画)
  useEffect(() => {
    if (!pipWindow || !pipRootRef.current) return;
    if (!screenShare) return;
    pipRootRef.current.render(
      <StagePanel screenShare={screenShare} inPip actions={{ sendPointer, sendAnnotation, stopScreenShare }} onClosePip={closePip} />
    );
  }, [pipWindow, screenShare, sendPointer, sendAnnotation, stopScreenShare, closePip]);

  // 共有終了 / アンマウントで別ウィンドウを閉じる
  useEffect(() => { if (!screenShare && pipWindow) closePip(); }, [screenShare, pipWindow, closePip]);
  useEffect(() => () => { pipWindowRef.current?.close(); }, []);

  if (!screenShare) return null;
  if (pipWindow) return null; // 中身はPiPルートに描画

  if (minimized) {
    return (
      <div style={{ position: "fixed", top: 76, left: "50%", transform: "translateX(-50%)", zIndex: 9990, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#111827", color: "#fff", borderRadius: 999, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
        <ScreenShare style={{ width: 14, height: 14, color: "#60A5FA" }} />
        <span style={{ fontSize: 12, fontWeight: 700 }}>{screenShare.isSelf ? "画面を共有中" : `${screenShare.presenterName}さんの画面`}</span>
        <button onClick={() => setMinimized(false)} title="展開" style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 2, lineHeight: 0 }}>
          <Maximize2 style={{ width: 14, height: 14 }} />
        </button>
      </div>
    );
  }

  return (
    <StagePanel
      screenShare={screenShare}
      inPip={false}
      actions={{ sendPointer, sendAnnotation, stopScreenShare }}
      onMinimize={() => setMinimized(true)}
      onRequestPip={pipSupported ? openPip : undefined}
    />
  );
}

function toolBtn(active: boolean): CSSProperties {
  return { display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 30, borderRadius: 9, border: "none", cursor: "pointer", background: active ? "#2563EB" : "rgba(255,255,255,0.1)", color: active ? "#fff" : "#D1D5DB" };
}
