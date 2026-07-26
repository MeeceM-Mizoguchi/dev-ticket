// 書式パネル共通の色スウォッチ／カラーピッカー（BRU7-056-2 で共通化）。
// TextBoxFormatPanel と TextColorPanel が使う。見た目は従来のまま。
import type { CSSProperties } from "react";

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
}

/** 好きな色を指定するカラーピッカー（虹色のスウォッチ。選択中は選んだ色を表示）。 */
export function CustomColorSwatch({ value, active, onPick }: CustomColorSwatchProps) {
  return (
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
}
