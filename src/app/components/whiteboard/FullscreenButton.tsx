// ボードを全画面表示するトグルボタン（Fullscreen API）。
import { useEffect, useState } from "react";
import { Maximize, Minimize } from "lucide-react";

export function FullscreenButton({ targetRef }: { targetRef: React.RefObject<HTMLDivElement | null> }) {
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = () => {
    const el = targetRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen?.();
    }
  };

  return (
    <button onClick={toggle} title={isFull ? "全画面を解除" : "全画面表示"}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32,
        color: "#6B6458", background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8,
        cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}>
      {isFull ? <Minimize style={{ width: 15, height: 15 }} /> : <Maximize style={{ width: 15, height: 15 }} />}
    </button>
  );
}
