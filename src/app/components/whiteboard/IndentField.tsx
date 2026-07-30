// 書式パネルの「インデント」セクション（BRU9-040）。
//
// TextBoxFormatPanel（テキストボックス選択時）と TextColorPanel（図形のラベル／入力中）の
// 両方から同じものを描く。差し込み位置は既に2つのパネルが取り合っているので、3本目の portal は
// 作らず「部品」として既存パネルの中に置く（ColorSwatch と同じレイヤ）。
//
// 対応するのは左揃え・右揃えのみ（whiteboardIndent の方針）。中央揃えのときはボタンを非活性にし、
// その場で「左揃えにする」を出す。標準の「テキストの配置」はパネルをかなり下までスクロールしないと
// 出てこないため、非活性のまま放置すると「押せないのに直し方が画面外」という導線になってしまう。
//
// ※このファイルは **コンポーネントだけを export する**（react-refresh の制約）。
//   キー処理（handleIndentKey）を同居させると「全部がコンポーネントではないモジュール」になり、
//   Fast Refresh の対象外＝更新のたびに import 元まで無効化が伝播して HMR が詰まりやすい。
//   キー処理は whiteboardIndent.ts（ただの .ts）に置いてある。
import { useState, type CSSProperties } from "react";
import {
  INDENT_STEPS, INDENT_STEP_LABELS, indentEditor, indentElements, indentSideOf,
  readIndentStep, setTextAlignLeft, writeIndentStep,
} from "@/app/lib/whiteboardIndent";

interface Props {
  api: any;
  /** インデント対象のテキスト要素（揃えの判定に使う）。null ならセクションを出さない */
  text: any | null;
  /** ボタンで書き換える対象の要素id（テキスト要素・図形どちらでもよい） */
  ids: string[];
}

const btn = (enabled: boolean): CSSProperties => ({
  width: 28, height: 24, borderRadius: 6, padding: 0, fontSize: 13, lineHeight: 1,
  border: "1px solid rgba(0,0,0,0.15)",
  background: "#fff",
  color: enabled ? "#444" : "#bbb",
  cursor: enabled ? "pointer" : "not-allowed",
});

const stepBtn = (active: boolean): CSSProperties => ({
  padding: "2px 8px", borderRadius: 6, cursor: "pointer", fontSize: 11,
  border: "1px solid rgba(0,0,0,0.15)",
  background: active ? "#1971c2" : "#fff",
  color: active ? "#fff" : "#444",
});

/** 編集中の textarea（開いていれば非null） */
function liveEditor(): HTMLTextAreaElement | null {
  const ta = document.querySelector(".excalidraw-wysiwyg") as HTMLTextAreaElement | null;
  return ta && ta.offsetParent !== null ? ta : null;
}

export function IndentField({ api, text, ids }: Props) {
  const [step, setStep] = useState<number>(readIndentStep);
  if (!text) return null;

  const side = indentSideOf(text);
  const enabled = !!side;

  // 編集中はカーソル行だけ（Tab と同じ）／非編集中はその要素の全行に効かせる
  const apply = (delta: number) => {
    if (!side) return;
    const ta = liveEditor();
    if (ta) indentEditor(ta, delta, step, side);
    else indentElements(api, ids, delta, step);
  };

  const pickStep = (n: number) => { setStep(n); writeIndentStep(n); };

  return (
    <fieldset>
      <legend>インデント</legend>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <button
          onMouseDown={(e) => e.preventDefault()} // 入力中にフォーカスを奪わない
          onClick={() => apply(-1)}
          disabled={!enabled}
          title={enabled ? "インデントを減らす（Shift+Tab）" : "中央揃えではインデントできません"}
          style={btn(enabled)}
        >⇤</button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply(1)}
          disabled={!enabled}
          title={enabled ? "インデントを増やす（Tab）" : "中央揃えではインデントできません"}
          style={btn(enabled)}
        >⇥</button>
        <span style={{ fontSize: 11, color: "#888", marginLeft: 4 }}>刻み</span>
        {INDENT_STEPS.map((n) => (
          <button
            key={n}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pickStep(n)}
            title={`半角スペース${n}個ぶん`}
            style={stepBtn(step === n)}
          >{INDENT_STEP_LABELS[n]}</button>
        ))}
      </div>
      {!enabled && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 11, color: "#888" }}>中央揃えでは使えません</span>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTextAlignLeft(api, ids)}
            style={{ ...stepBtn(false), whiteSpace: "nowrap" }}
          >左揃えにする</button>
        </div>
      )}
    </fieldset>
  );
}
