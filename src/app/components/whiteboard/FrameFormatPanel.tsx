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

export function FrameFormatPanel({ api, containerRef, canEdit }: Props) {
  const [frame, setFrame] = useState<any | null>(null);
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
          // 子要素数も署名に含める。グループ解除で子のframeIdが変わってもフレーム自体の
          // 書式は不変なため、これが無いとボタン表示(件数)が再描画されない（BRU4-054）。
          // パネルは左側固定なので座標/ズームは署名に含めない（タイトルに重ならないよう常時左ドック）。
          const childCount = api.getSceneElements().filter((e: any) => e.frameId === el.id && !e.isDeleted).length;
          const sig = `${el.id}:${fmt.bg}:${fmt.border}:${fmt.borderColor}:${childCount}`;
          if (sig !== sigRef.current) {
            sigRef.current = sig;
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

  // このフレームに属する子要素数（グループ解除ボタンの活性判定・表示用）
  const childCount = api.getSceneElements().filter((e: any) => e.frameId === frame.id && !e.isDeleted).length;

  // グループ解除: 子要素の frameId を外し、以後フレームを動かしても追従しないようにする（BRU4-054）。
  const ungroup = () => {
    const els = api.getSceneElements().map((e: any) =>
      e.frameId === frame.id && !e.isDeleted
        ? { ...e, frameId: null, version: (e.version ?? 1) + 1, versionNonce: rand() }
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

  // セクション見出し（画像2の図形パネルに合わせた淡いグレーのラベル）
  const heading = (label: string) => (
    <span style={{ fontSize: 11, fontWeight: 600, color: "#868e96" }}>{label}</span>
  );

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 21, pointerEvents: "none" }}>
      {/* 四角/三角などの図形パネルと同じく、フレームのタイトルに重ならないよう左端に固定して縦並びで集約する */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "auto",
          background: "#fff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12,
          boxShadow: "0 6px 20px rgba(0,0,0,0.15)", padding: "14px 16px",
          display: "flex", flexDirection: "column", gap: 14, fontSize: 11, color: "#444",
          width: 200, maxHeight: "calc(100% - 24px)", overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {heading("背景")}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {BG_COLORS.map((c) => swatch(c, (fmt.bg ?? "") === c, () => update({ bg: c || undefined }), c === ""))}
            {picker(fmt.bg, (c) => update({ bg: c }), bgIsCustom)}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {heading("枠線")}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {heading("グループ")}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={ungroup}
            disabled={childCount === 0}
            title={childCount === 0 ? "このフレームに含まれる図形はありません" : "フレーム内の図形のグループを解除し、フレームを動かしても追従しないようにします"}
            style={{
              padding: "2px 10px", borderRadius: 6, fontSize: 11, alignSelf: "flex-start",
              border: "1px solid rgba(0,0,0,0.15)",
              background: childCount === 0 ? "#f1f3f5" : "#fff",
              color: childCount === 0 ? "#adb5bd" : "#e5484d",
              cursor: childCount === 0 ? "not-allowed" : "pointer",
            }}
          >グループ解除{childCount > 0 ? `（${childCount}）` : ""}</button>
        </div>
      </div>
    </div>
  );
}
