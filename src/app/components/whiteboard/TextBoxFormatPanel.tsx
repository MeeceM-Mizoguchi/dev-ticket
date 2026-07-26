// テキストボックス選択時の書式（背景色 / 文字色 / 枠線ON・OFF / 枠線色）。
// Excalidraw標準の「線」は文字色(strokeColor)なので、枠線色はここで別途指定する（BRU5-054）。
//
// レイアウト統一（BRU5-054）: 図形パネルは「線 → 背景 → …」の順で並ぶため、テキストでも
// 標準パネル（.App-menu__left .panelColumn）の“先頭セクション（線）の直後”へ差し込み、
// 「背景」が図形と同じ位置（2番目）に来るようにする。DOMへ実ノードを挿入して React portal で中身を描く。
// legend/fieldset は .panelColumn の子孫スタイルが自動適用されるので標準セクションと同じ体裁になる。
// 書式は text.customData.wbTextBox に保存（要素なのでYjs同期される）。描画は whiteboardTextBoxBg
// の影矩形(rectangle)で行う（旧オーバーレイ TextBoxDecorLayer は BRU5-062 で廃止）。
//
// 文字色（BRU7-056-2）: 標準の「線」は実体が文字色なのに“線”と表示され紛らわしいので隠し、
// 図形パネルと同じ「文字色」セクションへ一本化する（背景の直下＝図形の TextColorPanel と同じ位置）。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isPlainTextBox, type WbTextBoxFormat } from "@/app/lib/whiteboardTextBoxBg";
import { TEXT_COLORS, readTextColor, setTextColor } from "@/app/lib/whiteboardTextColor";
import { CustomColorSwatch, Swatch, swatchRow } from "./ColorSwatch";
import { HIDE_NATIVE_STROKE } from "./TextColorPanel";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

// 背景色パレット（淡色＋なし）
const BG_COLORS = ["", "#fff9db", "#ffe3e3", "#e3fafc", "#ebfbee", "#f3f0ff", "#f1f3f5"];
// 枠線色パレット
const LINE_COLORS = ["#343a40", "#e5484d", "#1971c2", "#2f9e44", "#f08c00", "#ae3ec9"];

const rand = () => Math.floor(Math.random() * 0x7fffffff);

export function TextBoxFormatPanel({ api, containerRef, canEdit }: Props) {
  const [text, setText] = useState<any | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null); // 標準パネルへ差し込む実ノード
  const raf = useRef<number>(0);
  const sigRef = useRef<string>("");

  // 差し込み用ノードを1つだけ生成（.panelColumn と同じ縦並び間隔にする）
  if (!mountRef.current && typeof document !== "undefined") {
    const node = document.createElement("div");
    node.style.display = "flex";
    node.style.flexDirection = "column";
    node.style.rowGap = "0.75rem";
    mountRef.current = node;
  }

  useEffect(() => {
    const mount = mountRef.current;
    if (!canEdit) { setText(null); return; }
    const detach = () => { if (mount?.parentNode) mount.parentNode.removeChild(mount); };

    const tick = () => {
      try {
        const st = api.getAppState();
        const sel = st.selectedElementIds || {};
        const ids = Object.keys(sel).filter((id) => sel[id]);
        // 新規描画/リサイズ/範囲選択/テキスト編集中はパネルを出さない（操作の邪魔をしない）
        const interacting = !!(st.newElement || st.resizingElement || st.selectionElement || st.editingTextElement);
        const el = ids.length === 1 && !interacting
          ? api.getSceneElements().find((e: any) => e.id === ids[0] && isPlainTextBox(e))
          : null;
        if (el && mount) {
          // 標準プロパティパネルの縦列を探し、先頭セクション（線）の直後へ実ノードを配置する
          const host = containerRef.current?.querySelector(".App-menu__left .panelColumn") as HTMLElement | null;
          if (host) {
            const first = host.firstElementChild;
            // 位置がズレている時だけDOMを触る（毎フレームの再挿入を避け、Excalidrawの再描画にも自己修復）
            if (first && first !== mount && mount.previousElementSibling !== first) {
              host.insertBefore(mount, first.nextSibling);
            } else if (!mount.parentNode) {
              host.appendChild(mount); // 万一先頭が取れない時のフォールバック
            }
          }
          const fmt = el.customData?.wbTextBox ?? {};
          const sig = `${el.id}:${fmt.bg}:${fmt.border}:${fmt.borderColor}:${readTextColor(el)}:${!!host}`;
          if (sig !== sigRef.current) {
            sigRef.current = sig;
            setText(el);
          }
        } else if (sigRef.current !== "") {
          sigRef.current = "";
          detach();
          setText(null);
        }
      } catch { /* noop */ }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); detach(); };
  }, [api, canEdit, containerRef]);

  if (!text || !mountRef.current) return null;
  const fmt: WbTextBoxFormat = text.customData?.wbTextBox ?? {};

  const update = (patch: Partial<WbTextBoxFormat>) => {
    const next = { ...fmt, ...patch };
    const els = api.getSceneElements().map((e: any) =>
      e.id === text.id
        ? { ...e, customData: { ...(e.customData ?? {}), wbTextBox: next }, version: (e.version ?? 1) + 1, versionNonce: rand() }
        : e,
    );
    api.updateScene({ elements: els });
  };

  const bgIsCustom = !!fmt.bg && !BG_COLORS.includes(fmt.bg);
  const borderIsCustom = !!fmt.borderColor && !LINE_COLORS.includes(fmt.borderColor);
  const textColor = readTextColor(text);
  const textIsCustom = !TEXT_COLORS.includes(textColor);

  // legend/fieldset は .panelColumn 配下のスタイルが自動適用され、標準セクションと同じ見た目になる
  const content = (
    <>
      <style>{HIDE_NATIVE_STROKE}</style>
      <fieldset>
        <legend>背景</legend>
        <div style={swatchRow}>
          {BG_COLORS.map((c) => (
            <Swatch key={c || "none"} color={c} active={(fmt.bg ?? "") === c} onPick={() => update({ bg: c || undefined })} none={c === ""} />
          ))}
          <CustomColorSwatch value={fmt.bg} active={bgIsCustom} onPick={(c) => update({ bg: c })} />
        </div>
      </fieldset>
      <fieldset>
        <legend>文字色</legend>
        <div style={swatchRow}>
          {TEXT_COLORS.map((c) => (
            <Swatch key={c} color={c} active={textColor === c} onPick={() => setTextColor(api, [text.id], c)} />
          ))}
          <CustomColorSwatch value={textColor} active={textIsCustom} onPick={(c) => setTextColor(api, [text.id], c)} />
        </div>
      </fieldset>
      <fieldset>
        <legend>枠線</legend>
        <div style={swatchRow}>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => update({ border: !fmt.border })}
            style={{
              padding: "2px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11,
              border: "1px solid rgba(0,0,0,0.15)",
              background: fmt.border ? "#1971c2" : "#fff", color: fmt.border ? "#fff" : "#444",
            }}
          >{fmt.border ? "あり" : "なし"}</button>
          {fmt.border && LINE_COLORS.map((c) => (
            <Swatch key={c} color={c} active={(fmt.borderColor ?? "#343a40") === c} onPick={() => update({ borderColor: c })} />
          ))}
          {fmt.border && <CustomColorSwatch value={fmt.borderColor ?? "#343a40"} active={borderIsCustom} onPick={(c) => update({ borderColor: c })} />}
        </div>
      </fieldset>
    </>
  );

  return createPortal(content, mountRef.current);
}
