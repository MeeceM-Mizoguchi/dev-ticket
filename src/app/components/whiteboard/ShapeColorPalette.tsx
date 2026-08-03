// 標準プロパティパネルの「線」「背景」にも、文字色と同じ“好きな色”スウォッチを足す（BRU10-045）。
//
// 症状: 自由に色を選べるのは自前で作ったセクション（文字色 / テキストボックスの背景・枠線 /
// フレームの背景・枠線）だけで、Excalidraw 標準が描いている「線」「背景」では
// ポップオーバーを開いて Hexコードを手入力するしかなかった。
//
// 方針: 標準セクションを自前パネルで置き換えず（定型色・影・Hex・ショートカットはそのまま活かす）、
// 標準の定型色の行（.color-picker__top-picks）の末尾へ虹色スウォッチを1つ挿し込む。
// TextColorPanel / TextBoxFormatPanel と同じく「実 DOM ノードを挿入 → React portal で中身を描く」方式。
//
// どちらが 線 でどちらが 背景 かは **出現順** で決める（0=線 / 1=背景）。見出し文字はロケール依存、
// color-picker-type-* クラスはポップオーバーを開いた時しか出ないため、既存 TextColorPanel の
// anchorSection と同じ「並び順で判定」の規約に合わせている。背景を持たない要素（矢印・線・
// テキスト）では標準セクションが1つしか出ず、その場合は 線 だけになる。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CustomColorSwatch } from "./ColorSwatch";
import { setShapeColor, type ColorKind } from "@/app/lib/whiteboardShapeColor";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

const KINDS: ColorKind[] = ["stroke", "background"];

// 標準の定型色ボタンと同じ寸法（.color-picker__button の width/height と --radius）
const SWATCH_SIZE = "1.35rem";
const SWATCH_RADIUS = ".25rem";

interface Slot {
  kind: ColorKind;
  /** いま塗られている色（標準の大きいスウォッチが出している --swatch-color） */
  color: string | undefined;
  /** 定型色ではない＝自由に選んだ色を使っている（虹色スウォッチを選択中表示にする） */
  custom: boolean;
}

export function ShapeColorPalette({ api, containerRef, canEdit }: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const mounts = useRef<HTMLDivElement[]>([]); // 標準の行へ差し込む実ノード（線用 / 背景用）
  const raf = useRef<number>(0);
  const sigRef = useRef<string>("");

  // 差し込み用ノードを種類ごとに1つだけ生成（定型色と同じ flex 行に並ぶ）
  if (mounts.current.length === 0 && typeof document !== "undefined") {
    mounts.current = KINDS.map(() => {
      const node = document.createElement("div");
      node.className = "wb-free-color";
      node.style.display = "flex";
      node.style.alignItems = "center";
      return node;
    });
  }

  useEffect(() => {
    const nodes = mounts.current;
    if (!canEdit) { setSlots([]); return; }
    const detach = (n: HTMLDivElement | undefined) => { if (n?.parentNode) n.parentNode.removeChild(n); };

    const tick = () => {
      try {
        const host = containerRef.current?.querySelector(".App-menu__left .panelColumn") as HTMLElement | null;
        const rows = host
          ? (Array.from(host.querySelectorAll(".color-picker-container")) as HTMLElement[]).slice(0, KINDS.length)
          : [];

        const next: Slot[] = [];
        for (let i = 0; i < rows.length; i++) {
          const picks = rows[i].querySelector(".color-picker__top-picks") as HTMLElement | null;
          const node = nodes[i];
          if (!picks || !node) break; // 想定外の構造。以降のインデックスもズレるので打ち切る
          // 位置がズレている時だけDOMを触る（毎フレームの再挿入を避け、Excalidrawの再描画にも自己修復）
          if (picks.lastElementChild !== node) picks.appendChild(node);

          // 現在色とハイライトは appState を自前で解釈せず、標準UIが出しているDOMをそのまま読む
          const trigger = rows[i].querySelector(".color-picker__button.active-color") as HTMLElement | null;
          const color = trigger?.style.getPropertyValue("--swatch-color").trim() || undefined;
          // 定型色が光っていない＝自由に選んだ色。複数選択で色が混在している時は color 自体が空になる。
          // 透明は定型色の1つ（.active が付く）なので、ここでは自由色扱いにならない。
          const custom = !!color && color !== "transparent" && !picks.querySelector(".color-picker__button.active");
          next.push({ kind: KINDS[i], color, custom });
        }
        for (let i = next.length; i < nodes.length; i++) detach(nodes[i]);

        const sig = next.map((s) => `${s.kind}:${s.color}:${s.custom}`).join("|");
        if (sig !== sigRef.current) { sigRef.current = sig; setSlots(next); }
      } catch { /* noop */ }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); nodes.forEach(detach); };
  }, [canEdit, containerRef]);

  if (!slots.length) return null;

  // 素のテキスト選択中／テキスト入力中は標準の「線」セクションごと非表示になる
  // （TextColorPanel の HIDE_NATIVE_STROKE）。内側のこのスウォッチも一緒に消えるので特別扱いは不要。
  return (
    <>
      {slots.map((s, i) => createPortal(
        <CustomColorSwatch
          value={s.color}
          active={s.custom}
          size={SWATCH_SIZE}
          radius={SWATCH_RADIUS}
          alwaysGradient
          onPick={(c) => setShapeColor(api, s.kind, c)}
        />,
        mounts.current[i],
        s.kind,
      ))}
    </>
  );
}
