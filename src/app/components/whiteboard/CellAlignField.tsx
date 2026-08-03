// 表セルの「文字の配置」「縦の位置」セクション（BRU10-054-1）。
//
// まだどのセルにも文字が入っていない表を選んでいる間だけ出す。Excalidraw の標準パネルは
// 「選択の中にテキスト要素が1つでもある」ときしか文字の配置の節を描かないため、作りたての表では
// 書式を先に決める手段がそもそも無い（＝列を選んで左寄せにしておけない）。
// 押した値はセル矩形の customData.wbTextFmt に記録され、あとから入力したラベルへ着せられる
// （whiteboardCellFormat）。文字が入っているセルを含む選択では標準の節が出るので、こちらは出さない。
//
// ※このファイルは **コンポーネントだけを export する**（react-refresh の制約・IndentField と同じ）。
import type { CSSProperties } from "react";
import { setCellTextFormat, type WbTextFmt } from "@/app/lib/whiteboardCellFormat";

interface Props {
  api: any;
  /** 対象セルのid（空なら何も描かない） */
  ids: string[];
  /** 現在の記録（全会一致した項目だけ入る） */
  fmt: WbTextFmt;
}

const btn = (active: boolean): CSSProperties => ({
  width: 28, height: 24, borderRadius: 6, padding: 0, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  border: active ? "1px solid #1971c2" : "1px solid rgba(0,0,0,0.15)",
  background: active ? "#e7f5ff" : "#fff",
  color: "#444",
});

const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 };

// 行の長短で揃えを表すアイコン（標準パネルの文字の配置アイコンと同じ発想）
function HIcon({ side }: { side: "left" | "center" | "right" }) {
  const short = 7, full = 12;
  const x = (w: number) => (side === "left" ? 1 : side === "right" ? 1 + full - w : 1 + (full - w) / 2);
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {[3, 7, 11].map((y, i) => {
        const w = i === 1 ? short : full;
        return <rect key={y} x={x(w)} y={y - 1} width={w} height="1.6" rx="0.8" fill="currentColor" />;
      })}
    </svg>
  );
}

// 枠の中のどこに文字が乗るかで縦位置を表すアイコン
function VIcon({ side }: { side: "top" | "middle" | "bottom" }) {
  const y = side === "top" ? 3 : side === "bottom" ? 9.4 : 6.2;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" strokeOpacity="0.3" />
      <rect x="3.5" y={y} width="7" height="1.6" rx="0.8" fill="currentColor" />
    </svg>
  );
}

export function CellAlignField({ api, ids, fmt }: Props) {
  if (!ids.length) return null;

  const apply = (patch: WbTextFmt) => setCellTextFormat(api, ids, patch);
  const label = ids.length > 1 ? `選択した${ids.length}セル` : "このセル";

  return (
    <>
      <fieldset>
        <legend>文字の配置</legend>
        <div style={row}>
          {(["left", "center", "right"] as const).map((v) => (
            <button
              key={v}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply({ textAlign: v })}
              title={`${label}に入力する文字を${v === "left" ? "左" : v === "right" ? "右" : "中央"}に寄せる`}
              style={btn((fmt.textAlign ?? "center") === v)}
            ><HIcon side={v} /></button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>縦の位置</legend>
        <div style={row}>
          {(["top", "middle", "bottom"] as const).map((v) => (
            <button
              key={v}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply({ verticalAlign: v })}
              title={`${label}に入力する文字を${v === "top" ? "上" : v === "bottom" ? "下" : "中央"}に置く`}
              style={btn((fmt.verticalAlign ?? "middle") === v)}
            ><VIcon side={v} /></button>
          ))}
        </div>
      </fieldset>
    </>
  );
}
