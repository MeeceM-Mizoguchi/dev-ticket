// 線・矢印の書式パネル（線の形: 直線/折れ線 ・ 折れ線の角: 角丸/角あり）。BRU5-069 / BRU5-081。
//
// Excalidraw 標準の Arrow type（Sharp/Elbow）は「矢印」にしか出ないため、棒（line）は標準UIからは
// 折れ線にできない。またネイティブ elbow は角丸固定・移動/複製不可なので、折れ線は自前実装
// （wbFolded）で描いている。その2つの都合をまとめて、線・矢印どちらでも同じUIで選べるようにする。
//
// 標準パネル(island)の真下にドッキングし、収まらない時は右隣に出す（重なり防止）。
import { useEffect, useRef, useState } from "react";
import { isTriangle } from "@/app/lib/whiteboardSnap";
import { applyConnectorVias, foldCorner, foldSelectedConnectors, readVias, unfoldSelectedConnectors } from "@/app/lib/whiteboardAutoConnect";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

// 線形要素の角丸は PROPORTIONAL_RADIUS(=2)。null で直角（角あり）。
const ROUND: { type: number } = { type: 2 };
const rand = () => Math.floor(Math.random() * 0x7fffffff);

// 対象: 自前で扱う線・矢印（三角形図形・mermaid由来・ネイティブelbowは除外）
const isConn = (e: any) =>
  !e?.isDeleted && (e?.type === "line" || e?.type === "arrow")
  && !e?.elbowed && !isTriangle(e) && !e?.customData?.wbMermaid;

// 折れ矢印(wbFolded)を選択している間、標準パネルの Arrow type ハイライトを Elbow 側へ付け替える。
// 自前の折れ線は内部的に elbowed:false なので、標準UIは Sharp を光らせてしまうため。
// クラス .wb-folded-arrow の付け外しは WhiteboardCanvas の onChange で同期的に行う（ちらつき防止）。
export const FOLD_HL_CSS = `
.wb-folded-arrow .App-menu__left label:has(input[data-testid="sharp-arrow"]),
.wb-folded-arrow .App-menu__left label:has(input[data-testid="elbow-arrow"]) {
  transition: none !important;
}
.wb-folded-arrow .App-menu__left label:has(input[data-testid="sharp-arrow"]) {
  background: transparent !important;
}
.wb-folded-arrow .App-menu__left label:has(input[data-testid="sharp-arrow"]) svg {
  color: var(--color-on-surface) !important;
}
.wb-folded-arrow .App-menu__left label:has(input[data-testid="elbow-arrow"]) {
  background: var(--color-surface-primary-container) !important;
}
.wb-folded-arrow .App-menu__left label:has(input[data-testid="elbow-arrow"]) svg {
  color: var(--color-on-primary-container) !important;
}
`;

const PANEL_W = 150;
const PANEL_H = 190; // 線の形 + 折れ線の角 + 折れ点（BRU7-043）

export function ConnectorFormatPanel({ api, containerRef, canEdit }: Props) {
  const [state, setState] = useState<
    { ids: string[]; folded: boolean; sharp: boolean; vias: boolean; left: number; top: number } | null
  >(null);
  const raf = useRef<number>(0);
  const sigRef = useRef<string>("");

  useEffect(() => {
    if (!canEdit) { setState(null); return; }
    const tick = () => {
      try {
        const st = api.getAppState();
        const sel = st.selectedElementIds || {};
        const interacting = !!(st.newElement || st.resizingElement || st.selectionElement);
        const conns = interacting ? [] : (api.getSceneElements() as any[]).filter((e) => sel[e.id] && isConn(e));
        const box = containerRef.current?.getBoundingClientRect();

        if (conns.length === 0 || !box) {
          if (sigRef.current !== "") { sigRef.current = ""; setState(null); }
        } else {
          // 標準パネル(island)の真下へドッキング。入りきらない時は右隣へ逃がすが、
          // その際は上部ツールバーの下端より下に置く（どちらのメニューとも重ならないように・BRU5-084）。
          const menu = containerRef.current?.querySelector(".App-menu__left") as HTMLElement | null;
          const bar = containerRef.current?.querySelector(".App-toolbar") as HTMLElement | null;
          let left = 12, top = 12;
          if (menu) {
            const m = menu.getBoundingClientRect();
            const below = m.bottom - box.top + 8;
            if (below + PANEL_H < box.height - 70) { // 下部ツールバーの手前まで収まる
              left = Math.round(m.left - box.left);
              top = Math.round(below);
            } else {
              // 右隣。上部ツールバーの下端を下回らないようにクランプする
              const barBottom = bar ? bar.getBoundingClientRect().bottom - box.top + 8 : 8;
              left = Math.round(m.right - box.left + 8);
              top = Math.round(Math.max(m.top - box.top, barBottom));
            }
          }
          const folded = conns.every((e) => !!e.customData?.wbFolded);
          const sharp = conns.every((e) => !e.roundness);
          const vias = conns.some((e) => readVias(e.customData).length > 0); // 手動の折れ点を持つか
          const ids = conns.map((e) => e.id);
          const sig = `${ids.join(",")}:${folded}:${sharp}:${vias}:${left}:${top}`;
          if (sig !== sigRef.current) { sigRef.current = sig; setState({ ids, folded, sharp, vias, left, top }); }
        }
      } catch { /* noop */ }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [api, canEdit, containerRef]);

  if (!state) return <style>{FOLD_HL_CSS}</style>;

  // 線の形: 直線(Sharp) / 折れ線(Elbow)。棒(line)にも効く。
  const setShape = (fold: boolean) => {
    const st = api.getAppState();
    if (fold) foldSelectedConnectors(api, st);
    else unfoldSelectedConnectors(api, st, false);
  };

  // 折れ線の角: 角丸 / 角あり。以後に折る線の既定にもする。
  // Excalidraw の currentItemRoundness は図形の角丸とも共有される設定なので触らない。
  const setCorner = (sharp: boolean) => {
    foldCorner.round = !sharp;
    const ids = new Set(state.ids);
    const els = (api.getSceneElements() as any[]).map((e) =>
      ids.has(e.id)
        ? { ...e, roundness: sharp ? null : ROUND, version: (e.version ?? 1) + 1, versionNonce: rand() }
        : e,
    );
    api.updateScene({ elements: els });
  };

  const btn = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "inherit",
        border: "1px solid rgba(0,0,0,0.15)",
        background: active ? "#1971c2" : "#fff",
        color: active ? "#fff" : "#444",
      }}
    >{label}</button>
  );

  const heading = (label: string) => (
    <span style={{ fontSize: 11, fontWeight: 600, color: "#868e96" }}>{label}</span>
  );

  return (
    <>
      <style>{FOLD_HL_CSS}</style>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "absolute", left: state.left, top: state.top, width: PANEL_W, zIndex: 21, pointerEvents: "auto",
          background: "#fff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12,
          boxShadow: "0 6px 20px rgba(0,0,0,0.15)", padding: "10px 12px",
          display: "flex", flexDirection: "column", gap: 10, fontSize: 11, color: "#444",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {heading("線の形")}
          <div style={{ display: "flex", gap: 6 }}>
            {btn("直線", !state.folded, () => setShape(false))}
            {btn("折れ線", state.folded, () => setShape(true))}
          </div>
        </div>
        {state.folded && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {heading("折れ線の角")}
            <div style={{ display: "flex", gap: 6 }}>
              {btn("角丸", !state.sharp, () => setCorner(false))}
              {btn("角あり", state.sharp, () => setCorner(true))}
            </div>
          </div>
        )}
        {/* 手動の折れ点（BRU7-043）。追加/移動は線上のつまみで行い、ここでは全消しだけ提供する。 */}
        {state.folded && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {heading("折れ点")}
            {state.vias
              ? btn("リセット", false, () => { for (const id of state.ids) applyConnectorVias(api, id, [], true); })
              : <span style={{ fontSize: 10, color: "#adb5bd", lineHeight: 1.5 }}>線上の丸をドラッグすると<br />折れ点を追加できます</span>}
          </div>
        )}
      </div>
    </>
  );
}
