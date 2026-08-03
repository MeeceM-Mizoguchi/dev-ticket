// 書式パネル共通の色スウォッチ／カラーピッカー（BRU7-056-2 で共通化）。
// TextBoxFormatPanel / TextColorPanel と、標準パネルへ差し込む ShapeColorPalette（BRU10-045）が使う。
import { useCallback, useEffect, useRef, type CSSProperties } from "react";

/** スウォッチを並べる行のスタイル（折り返しあり） */
export const swatchRow: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 };

interface SwatchProps {
  color: string;
  active: boolean;
  onPick: () => void;
  /** 「なし」（白地に赤スラッシュ）として描く */
  none?: boolean;
}

/** 定型色のスウォッチ。選択中は青枠で示す。 */
export function Swatch({ color, active, onPick, none }: SwatchProps) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      title={none ? "なし" : color}
      style={{
        width: 20, height: 20, borderRadius: 5, cursor: "pointer", padding: 0,
        border: active ? "2px solid #1971c2" : "1px solid rgba(0,0,0,0.15)",
        background: none ? "#fff" : color,
        position: "relative",
      }}
    >
      {none && (
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#e5484d", fontSize: 14, lineHeight: 1 }}>／</span>
      )}
    </button>
  );
}

interface CustomColorSwatchProps {
  value: string | undefined;
  active: boolean;
  onPick: (color: string) => void;
  /** スウォッチの大きさ。標準パネルの行へ差し込む時は native の定型色と揃える（既定 20px / 角丸 5px）。 */
  size?: number | string;
  radius?: number | string;
  /**
   * 選択中でも虹色のままにする（BRU10-045）。定型色の並びに混ざって置く場合、選んだ色で塗ると
   * ただの色見本と見分けが付かず「カラーピッカーがどこにあるか分からない」状態になるため。
   */
  alwaysGradient?: boolean;
}

const GRADIENT = "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)";

/** 好きな色を指定するカラーピッカー（虹色のスウォッチ。選択中は選んだ色を表示）。 */
export function CustomColorSwatch({ value, active, onPick, size = 20, radius = 5, alwaysGradient }: CustomColorSwatchProps) {
  // OSのカラーピッカーはドラッグ中 input を連射する。そのまま流すとシーン更新と Yjs 配信が
  // 過剰になるので 1フレームに1回へ間引く（間引いても最後の値は必ず適用される）。
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pending = useRef<string | null>(null);
  const raf = useRef(0);

  const flush = useCallback(() => {
    raf.current = 0;
    const c = pending.current;
    pending.current = null;
    if (c !== null) pickRef.current(c);
  }, []);

  // 取りこぼし防止: 間引き待ちのまま消えたら、その色を適用してから終わる
  useEffect(() => () => { if (raf.current) { cancelAnimationFrame(raf.current); flush(); } }, [flush]);

  const queue = (c: string) => {
    pending.current = c;
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  };

  return (
    <label
      title="好きな色を指定"
      style={{
        width: size, height: size, borderRadius: radius, cursor: "pointer", position: "relative", overflow: "hidden",
        boxSizing: "border-box", flex: "none",
        border: active ? "2px solid #1971c2" : "1px solid rgba(0,0,0,0.15)",
        background: !alwaysGradient && active && value ? value : GRADIENT,
      }}
    >
      <input
        type="color"
        value={value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff"}
        onChange={(e) => queue(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: "none", padding: 0 }}
      />
    </label>
  );
}
