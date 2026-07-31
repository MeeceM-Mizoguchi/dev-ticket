// ボードを全画面表示するトグル。
// Mac/PC: ネイティブ Fullscreen API。iPad(WKWebView)などFS非対応環境: CSS疑似全画面にフォールバック。
// 全画面中の Esc 挙動（フォーカスを外す→もう一度で解除）は WhiteboardCanvas 側で一元管理する（BRU6-004-2）。
import { Maximize, Minimize } from "lucide-react";

interface Props {
  targetRef: React.RefObject<HTMLDivElement | null>;
  pseudoFull: boolean;
  setPseudoFull: (v: boolean) => void;
}

// ネイティブ全画面が使えるか（iPadのWKWebViewでは false になる）
function nativeFullscreenSupported(el: HTMLElement | null): boolean {
  if (typeof document === "undefined") return false;
  const anyDoc = document as any;
  const enabled = document.fullscreenEnabled ?? anyDoc.webkitFullscreenEnabled ?? false;
  const canReq = !!(el && (el.requestFullscreen || (el as any).webkitRequestFullscreen));
  return !!enabled && canReq;
}

export function FullscreenButton({ targetRef, pseudoFull, setPseudoFull }: Props) {
  const native = nativeFullscreenSupported(targetRef.current);
  const isFull = (typeof document !== "undefined" && !!document.fullscreenElement) || pseudoFull;

  const toggle = () => {
    const el = targetRef.current;
    if (!el) return;
    if (native) {
      const anyDoc = document as any;
      if (document.fullscreenElement || anyDoc.webkitFullscreenElement) {
        (document.exitFullscreen || anyDoc.webkitExitFullscreen)?.call(document);
      } else {
        (el.requestFullscreen || (el as any).webkitRequestFullscreen)?.call(el);
      }
    } else {
      setPseudoFull(!pseudoFull);
    }
  };

  return (
    <button onClick={toggle} title={isFull ? "全画面を解除" : "全画面表示"}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, flexShrink: 0,
        color: "#6B6458", background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8,
        cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}>
      {isFull ? <Minimize style={{ width: 15, height: 15 }} /> : <Maximize style={{ width: 15, height: 15 }} />}
    </button>
  );
}
