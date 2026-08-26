import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Copy, CheckCheck } from "lucide-react";
import { escStack } from "@/app/lib/escStack";

// マウスを止めてからコントロールを隠すまでの時間
const IDLE_MS = 3000;

interface Props {
  /** 同じ文脈で並んでいる画像のURL一覧（この順に矢印で送る） */
  images: string[];
  /** いま表示している画像の位置 */
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  zIndex?: number;
  /** コピーボタンを出すか（既定: 出す） */
  showCopy?: boolean;
}

/**
 * 画像の拡大表示。左右の矢印 / ←→キーで前後の画像へ送れる。
 * コントロール（矢印・閉じる・コピー・枚数）はマウスを動かすと現れ、3秒動かないと消える。
 */
export function ImageLightbox({ images, index, onIndexChange, onClose, zIndex = 9999, showCopy = true }: Props) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const [copied, setCopied] = useState(false);
  const idleTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const total = images.length;
  const src = images[index];

  // マウスが動いたら出す → 一定時間動かなければ消す
  const wake = useCallback(() => {
    setControlsVisible(true);
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => setControlsVisible(false), IDLE_MS);
  }, []);

  useEffect(() => {
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("wheel", wake, { passive: true });
    return () => {
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("wheel", wake);
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    };
  }, [wake]);

  const go = useCallback((delta: number) => {
    if (total < 2) return;
    onIndexChange((index + delta + total) % total);
    wake();
  }, [index, total, onIndexChange, wake]);

  // Esc は共通スタック経由（最後に積んだものが優先される）
  useEffect(() => {
    escStack.push(onClose);
    return () => escStack.pop(onClose);
  }, [onClose]);

  // ←→キー。captureで拾い、エディタのキャレット移動などに食われないようにする
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      go(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [go]);

  // 前後の画像を先読みしておくと送ったときに一瞬白くならない
  useEffect(() => {
    if (total < 2) return;
    for (const d of [1, -1]) {
      const img = new Image();
      img.src = images[(index + d + total) % total];
    }
  }, [images, index, total]);

  const copyImage = useCallback(async () => {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      let pngBlob: Blob;
      if (blob.type === "image/png") {
        pngBlob = blob;
      } else {
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width; canvas.height = bmp.height;
        canvas.getContext("2d")!.drawImage(bmp, 0, 0);
        pngBlob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png")
        );
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy image:", e);
    }
  }, [src]);

  if (!src) return null;

  const controlStyle = (extra: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    borderRadius: "50%",
    background: "rgba(255,255,255,0.15)",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#FFF",
    opacity: controlsVisible ? 1 : 0,
    pointerEvents: controlsVisible ? "auto" : "none",
    transition: "opacity 0.22s ease, background 0.15s",
    ...extra,
  });

  return createPortal(
    <div
      onClick={onClose}
      // タッチ環境（iPad/Macアプリ）ではマウスが動かないので、タップでコントロールを出しスワイプで送る
      onTouchStart={e => {
        wake();
        const t = e.touches[0];
        touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={e => {
        const start = touchStartRef.current;
        touchStartRef.current = null;
        const t = e.changedTouches[0];
        if (!start || !t) return;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      }}
      style={{ position: "fixed", inset: 0, zIndex, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}
    >
      <img src={src} alt="" onClick={e => e.stopPropagation()}
        style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 24px 80px rgba(0,0,0,0.6)", cursor: "default" }} />

      {showCopy && (
        <button onClick={e => { e.stopPropagation(); void copyImage(); }} title="画像をコピー"
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.28)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.15)"; }}
          style={controlStyle({ top: 16, right: 60, width: 36, height: 36 })}>
          {copied ? <CheckCheck style={{ width: 18, height: 18, color: "#4ADE80" }} /> : <Copy style={{ width: 18, height: 18 }} />}
        </button>
      )}

      <button onClick={e => { e.stopPropagation(); onClose(); }} title="閉じる"
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.28)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.15)"; }}
        style={controlStyle({ top: 16, right: 16, width: 36, height: 36 })}>
        <X style={{ width: 18, height: 18 }} />
      </button>

      {total > 1 && (
        <>
          <button onClick={e => { e.stopPropagation(); go(-1); }} title="前の画像（←）"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.28)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.15)"; }}
            style={controlStyle({ left: 20, top: "50%", transform: "translateY(-50%)", width: 48, height: 48 })}>
            <ChevronLeft style={{ width: 26, height: 26 }} />
          </button>
          <button onClick={e => { e.stopPropagation(); go(1); }} title="次の画像（→）"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.28)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.15)"; }}
            style={controlStyle({ right: 20, top: "50%", transform: "translateY(-50%)", width: 48, height: 48 })}>
            <ChevronRight style={{ width: 26, height: 26 }} />
          </button>
          <div style={controlStyle({ bottom: 22, left: "50%", transform: "translateX(-50%)", width: "auto", padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", cursor: "default" })}>
            {index + 1} / {total}
          </div>
        </>
      )}
    </div>,
    document.body
  );
}

/** ライトボックスの開閉状態をまとめて持つためのフック */
export function useImageLightbox() {
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const openLightbox = useCallback((images: string[], index = 0) => {
    if (images.length === 0) return;
    setLightbox({ images, index: Math.max(0, Math.min(index, images.length - 1)) });
  }, []);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const setLightboxIndex = useCallback((index: number) => {
    setLightbox(prev => prev ? { ...prev, index } : prev);
  }, []);
  return { lightbox, openLightbox, closeLightbox, setLightboxIndex };
}
