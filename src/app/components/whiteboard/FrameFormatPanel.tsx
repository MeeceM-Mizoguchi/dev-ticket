// フレーム選択時に出る書式パネル（背景色 / 枠線ON・OFF / 枠線色）。
// 書式は frame.customData.wbFrame に保存する（要素なのでYjs同期される）。描画は FrameDecorLayer。
import { useEffect, useRef, useState } from "react";
import type { WbFrameFormat } from "./FrameDecorLayer";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

// 背景色パレット（淡色＋なし）
const BG_COLORS = ["", "#fff9db", "#ffe3e3", "#e3fafc", "#ebfbee", "#f3f0ff", "#f1f3f5"];
// 枠線色パレット
const LINE_COLORS = ["#343a40", "#e5484d", "#1971c2", "#2f9e44", "#f08c00", "#ae3ec9"];

const isFrame = (e: any) => e?.type === "frame" || e?.type === "magicframe";
const rand = () => Math.floor(Math.random() * 0x7fffffff);

function sceneToLocal(api: any, containerRef: React.RefObject<HTMLDivElement | null>, sx: number, sy: number) {
  const st = api.getAppState();
  const rect = containerRef.current?.getBoundingClientRect();
  const zoom = st.zoom?.value ?? 1;
  return {
    x: sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - (rect?.left ?? 0),
    y: sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - (rect?.top ?? 0),
  };
}

export function FrameFormatPanel({ api, containerRef, canEdit }: Props) {
  const [frame, setFrame] = useState<any | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const raf = useRef<number>(0);
  const sigRef = useRef<string>("");

  useEffect(() => {
    if (!canEdit) { setFrame(null); return; }
    const tick = () => {
      try {
        const st = api.getAppState();
        const sel = st.selectedElementIds || {};
        const ids = Object.keys(sel).filter((id) => sel[id]);
        const interacting = !!(st.newElement || st.resizingElement || st.selectionElement);
        const el = ids.length === 1 && !interacting
          ? api.getSceneElements().find((e: any) => e.id === ids[0] && !e.isDeleted && isFrame(e))
          : null;
        if (el) {
          const fmt = el.customData?.wbFrame ?? {};
          const sig = `${el.id}:${el.x}:${el.y}:${el.width}:${st.zoom?.value}:${st.scrollX}:${st.scrollY}:${fmt.bg}:${fmt.border}:${fmt.borderColor}`;
          if (sig !== sigRef.current) {
            sigRef.current = sig;
            const p = sceneToLocal(api, containerRef, el.x, el.y);
            setPos({ x: p.x, y: p.y });
            setFrame(el);
          }
        } else if (sigRef.current !== "") {
          sigRef.current = "";
          setFrame(null);
        }
      } catch { /* noop */ }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [api, canEdit, containerRef]);

  if (!frame) return null;
  const fmt: WbFrameFormat = frame.customData?.wbFrame ?? {};

  const update = (patch: Partial<WbFrameFormat>) => {
    const next = { ...fmt, ...patch };
    const els = api.getSceneElements().map((e: any) =>
      e.id === frame.id
        ? { ...e, customData: { ...(e.customData ?? {}), wbFrame: next }, version: (e.version ?? 1) + 1, versionNonce: rand() }
        : e,
    );
    api.updateScene({ elements: els });
  };

  const swatch = (color: string, active: boolean, onClick: () => void, none = false) => (
    <button
      key={color || "none"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={none ? "なし" : color}
      style={{
        width: 20, height: 20, borderRadius: 5, cursor: "pointer",
        border: active ? "2px solid #1971c2" : "1px solid rgba(0,0,0,0.15)",
        background: none ? "#fff" : color,
        position: "relative",
      }}
    >{none && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#e5484d", fontSize: 14, lineHeight: 1 }}>／</span>}</button>
  );

  // 好きな色を指定するカラーピッカー（虹色のスウォッチ。選択中は選んだ色を表示）
  const picker = (value: string | undefined, onPick: (c: string) => void, active: boolean) => (
    <label
      title="好きな色を指定"
      style={{
        width: 20, height: 20, borderRadius: 5, cursor: "pointer", position: "relative", overflow: "hidden",
        border: active ? "2px solid #1971c2" : "1px solid rgba(0,0,0,0.15)",
        background: active && value ? value : "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
      }}
    >
      <input
        type="color"
        value={value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff"}
        onChange={(e) => onPick(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: "none", padding: 0 }}
      />
    </label>
  );

  const bgIsCustom = !!fmt.bg && !BG_COLORS.includes(fmt.bg);
  const borderIsCustom = !!fmt.borderColor && !LINE_COLORS.includes(fmt.borderColor);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 21, pointerEvents: "none" }}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "absolute", left: pos.x, top: pos.y - 96, pointerEvents: "auto",
          background: "#fff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10,
          boxShadow: "0 6px 20px rgba(0,0,0,0.15)", padding: "8px 10px",
          display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: "#444",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 34 }}>背景</span>
          {BG_COLORS.map((c) => swatch(c, (fmt.bg ?? "") === c, () => update({ bg: c || undefined }), c === ""))}
          {picker(fmt.bg, (c) => update({ bg: c }), bgIsCustom)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 34 }}>枠線</span>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => update({ border: !fmt.border })}
            style={{
              padding: "2px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11,
              border: "1px solid rgba(0,0,0,0.15)",
              background: fmt.border ? "#1971c2" : "#fff", color: fmt.border ? "#fff" : "#444",
            }}
          >{fmt.border ? "あり" : "なし"}</button>
          {fmt.border && LINE_COLORS.map((c) => swatch(c, (fmt.borderColor ?? "#343a40") === c, () => update({ borderColor: c })))}
          {fmt.border && picker(fmt.borderColor ?? "#343a40", (c) => update({ borderColor: c }), borderIsCustom)}
        </div>
      </div>
    </div>
  );
}
