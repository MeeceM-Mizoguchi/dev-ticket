// ENHA2-035 Word エディタのツールバー
//
// Word で設定できる書式を一通り並べる。文字書式は DocxSpan（span の style）、
// 段落書式は DocxBlockStyle（ブロックの style）に流し込むので、
// ここで付けた書式はそのまま docx へ書き戻る。

import { useEffect, useReducer, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline, Strikethrough, Superscript, Subscript,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered,
  IndentIncrease, IndentDecrease, Undo2, Redo2, Link2, Table as TableIcon,
  RemoveFormatting, Save, Loader2, Baseline, Highlighter, ChevronDown,
} from "lucide-react";
import { styleValue } from "@/app/lib/docxTiptap";

const FONTS = [
  "游ゴシック", "游明朝", "メイリオ", "Meiryo UI", "MS Pゴシック", "MS P明朝",
  "ヒラギノ角ゴシック", "Arial", "Arial Unicode MS", "Calibri", "Century", "Times New Roman", "Courier New",
];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const LINE_HEIGHTS: Array<[string, string]> = [["1.0", "1"], ["1.15", "1.15"], ["1.5", "1.5"], ["2.0", "2"]];
const COLORS = [
  "#000000", "#404040", "#808080", "#BFBFBF", "#FFFFFF",
  "#C00000", "#FF0000", "#FFC000", "#FFFF00", "#92D050",
  "#00B050", "#00B0F0", "#0070C0", "#002060", "#7030A0",
  "#188038", "#1155CC", "#E06666", "#674EA7", "#B45309",
];
const HIGHLIGHTS = ["#FFFF00", "#00FF00", "#00FFFF", "#FF00FF", "#0000FF", "#FF0000", "#808000", "#C0C0C0"];

interface Props {
  editor: Editor | null;
  saving: boolean;
  loading: boolean;
  onSave: () => void;
}

export function WordToolbar({ editor, saving, loading, onSave }: Props) {
  // TipTap v3 は既定では選択変更で再描画しないので、自前で購読して状態を映す
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    const h = () => rerender();
    editor.on("transaction", h);
    return () => { editor.off("transaction", h); };
  }, [editor]);

  if (!editor) return null;
  const chain = () => editor.chain().focus() as any;
  const runStyle = (patch: Record<string, string | null>) => chain().setRunStyle(patch).run();
  const blockStyle = (patch: Record<string, string | null>) => chain().setBlockStyle(patch).run();

  const runAttrs = editor.getAttributes("docxSpan");
  const blockAttrs = editor.getAttributes(editor.isActive("heading") ? "heading" : "paragraph");
  const currentFont = (styleValue(runAttrs.style, "font-family") ?? "").replace(/['"]/g, "").split(",")[0];
  const currentSize = (styleValue(runAttrs.style, "font-size") ?? "").replace("pt", "");
  const currentAlign = styleValue(blockAttrs.style, "text-align") ?? "left";
  const currentLine = styleValue(blockAttrs.style, "line-height") ?? "";
  const headingLevel = [1, 2, 3, 4, 5, 6].find(l => editor.isActive("heading", { level: l }));

  const setHeading = (value: string) => {
    if (value === "p") chain().setParagraph().run();
    else chain().setNode("heading", { level: Number(value) }).run();
  };

  const insertLink = () => {
    const current = editor.getAttributes("link").href ?? "";
    const url = window.prompt("リンク先URL（空で解除）", current);
    if (url === null) return;
    if (!url.trim()) chain().unsetLink().run();
    else chain().setLink({ href: url.trim() }).run();
  };

  const clearFormat = () => {
    chain().unsetAllMarks().setBlockStyle({
      "text-align": null, "line-height": null, "margin-left": null, "margin-right": null,
      "text-indent": null, "background-color": null,
      "border-top": null, "border-bottom": null, "border-left": null, "border-right": null,
    }).run();
  };

  return (
    <div style={{ borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FBFAF9", flexShrink: 0 }}>
      {/* 1段目：文字の書式 */}
      <div style={row}>
        <TB onClick={() => chain().undo().run()} title="元に戻す"><Undo2 style={ic} /></TB>
        <TB onClick={() => chain().redo().run()} title="やり直し"><Redo2 style={ic} /></TB>
        <Sep />
        <Select value={headingLevel ? String(headingLevel) : "p"} onChange={setHeading} width={92} title="段落スタイル"
          options={[["p", "本文"], ["1", "見出し1"], ["2", "見出し2"], ["3", "見出し3"], ["4", "見出し4"], ["5", "見出し5"], ["6", "見出し6"]]} />
        <Select value={currentFont} onChange={v => runStyle({ "font-family": v ? `'${v}'` : null })} width={130} title="フォント"
          options={[["", "（既定）"], ...FONTS.map(f => [f, f] as [string, string])]} />
        <Select value={currentSize} onChange={v => runStyle({ "font-size": v ? `${v}pt` : null })} width={66} title="サイズ"
          options={[["", "既定"], ...SIZES.map(s => [String(s), String(s)] as [string, string])]} />
        <Sep />
        <TB onClick={() => chain().toggleBold().run()} active={editor.isActive("bold")} title="太字"><Bold style={ic} /></TB>
        <TB onClick={() => chain().toggleItalic().run()} active={editor.isActive("italic")} title="斜体"><Italic style={ic} /></TB>
        <TB onClick={() => chain().toggleUnderline().run()} active={editor.isActive("underline")} title="下線"><Underline style={ic} /></TB>
        <TB onClick={() => chain().toggleStrike().run()} active={editor.isActive("strike")} title="取り消し線"><Strikethrough style={ic} /></TB>
        <TB onClick={() => chain().toggleMark("superscript").run()} active={editor.isActive("superscript")} title="上付き"><Superscript style={ic} /></TB>
        <TB onClick={() => chain().toggleMark("subscript").run()} active={editor.isActive("subscript")} title="下付き"><Subscript style={ic} /></TB>
        <Sep />
        <ColorPicker title="文字色" icon={<Baseline style={ic} />} colors={COLORS}
          onPick={c => runStyle({ color: c })} onClear={() => runStyle({ color: null })} clearLabel="自動（黒）" />
        <ColorPicker title="蛍光ペン" icon={<Highlighter style={ic} />} colors={HIGHLIGHTS}
          onPick={c => runStyle({ "background-color": c })} onClear={() => runStyle({ "background-color": null })} clearLabel="なし" />
        <TB onClick={clearFormat} title="書式をクリア"><RemoveFormatting style={ic} /></TB>
      </div>

      {/* 2段目：段落の書式 */}
      <div style={{ ...row, borderTop: "1px solid rgba(26,23,20,0.05)" }}>
        <TB onClick={() => blockStyle({ "text-align": "left" })} active={currentAlign === "left"} title="左揃え"><AlignLeft style={ic} /></TB>
        <TB onClick={() => blockStyle({ "text-align": "center" })} active={currentAlign === "center"} title="中央揃え"><AlignCenter style={ic} /></TB>
        <TB onClick={() => blockStyle({ "text-align": "right" })} active={currentAlign === "right"} title="右揃え"><AlignRight style={ic} /></TB>
        <TB onClick={() => blockStyle({ "text-align": "justify" })} active={currentAlign === "justify"} title="両端揃え"><AlignJustify style={ic} /></TB>
        <Sep />
        <Select value={currentLine} onChange={v => blockStyle({ "line-height": v || null })} width={78} title="行間"
          options={[["", "行間"], ...LINE_HEIGHTS]} />
        <Sep />
        <TB onClick={() => chain().toggleBulletList().run()} active={editor.isActive("bulletList")} title="箇条書き"><List style={ic} /></TB>
        <TB onClick={() => chain().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="番号付き"><ListOrdered style={ic} /></TB>
        <TB onClick={() => chain().changeIndent(-48).run()} title="インデントを減らす"><IndentDecrease style={ic} /></TB>
        <TB onClick={() => chain().changeIndent(48).run()} title="インデントを増やす"><IndentIncrease style={ic} /></TB>
        <Sep />
        <Menu title="表" icon={<TableIcon style={ic} />} items={[
          // 新しい表は Word と同じく実線の罫線付きで作る
          ["表を挿入（3×3）", () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .setTableStyle({ "--dv-cell-border": "1px solid #000000" }).run()],
          ["上に行を追加", () => chain().addRowBefore().run()],
          ["下に行を追加", () => chain().addRowAfter().run()],
          ["左に列を追加", () => chain().addColumnBefore().run()],
          ["右に列を追加", () => chain().addColumnAfter().run()],
          ["行を削除", () => chain().deleteRow().run()],
          ["列を削除", () => chain().deleteColumn().run()],
          ["セルを結合", () => chain().mergeCells().run()],
          ["結合を解除", () => chain().splitCell().run()],
          ["表を削除", () => chain().deleteTable().run()],
          ["罫線を引く", () => chain().setTableStyle({ "--dv-cell-border": "1px solid #000000" }).run()],
          ["罫線を消す", () => chain().setTableStyle({ "--dv-cell-border": null }).run()],
        ]} />
        <ColorPicker title="セル・段落の網かけ" icon={<span style={{ fontSize: 11, fontWeight: 700 }}>塗</span>} colors={COLORS}
          onPick={c => blockStyle({ "background-color": c })} onClear={() => blockStyle({ "background-color": null })} clearLabel="なし" />
        <TB onClick={insertLink} active={editor.isActive("link")} title="リンク"><Link2 style={ic} /></TB>
        <div style={{ flex: 1 }} />
        <button onClick={onSave} disabled={saving || loading}
          style={{
            display: "flex", alignItems: "center", gap: 5, padding: "6px 14px",
            background: loading ? "#D4CEC8" : "#059669", color: "#fff", border: "none", borderRadius: 8,
            fontSize: 12, fontWeight: 700, cursor: saving || loading ? "default" : "pointer",
          }}>
          {saving ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Save style={{ width: 12, height: 12 }} />}
          {saving ? "保存中..." : "保存（新バージョン）"}
        </button>
      </div>
    </div>
  );
}

// ── 部品 ─────────────────────────────────────────────────

const row: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 2, padding: "6px 12px", flexWrap: "wrap",
};
const ic: React.CSSProperties = { width: 14, height: 14 };

function Sep() {
  return <div style={{ width: 1, height: 18, background: "rgba(26,23,20,0.10)", margin: "0 5px" }} />;
}

function TB({ onClick, active, title, children }: { onClick: () => void; active?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title} style={{
      display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 26,
      borderRadius: 6, cursor: "pointer", border: "none",
      background: active ? "#ECFDF5" : "transparent", color: active ? "#059669" : "#6B6458",
    }}>{children}</button>
  );
}

function Select({ value, onChange, options, width, title }: {
  value: string; onChange: (v: string) => void; options: Array<[string, string]>; width: number; title?: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} title={title}
      style={{
        width, height: 26, fontSize: 11, color: "#4B4540", background: "#FFF",
        border: "1px solid rgba(26,23,20,0.12)", borderRadius: 6, padding: "0 4px", cursor: "pointer",
      }}>
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}

/** 押すと色見本が開くボタン */
function ColorPicker({ title, icon, colors, onPick, onClear, clearLabel }: {
  title: string; icon: React.ReactNode; colors: string[];
  onPick: (color: string) => void; onClear: () => void; clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen(o => !o)} title={title} style={{
        display: "flex", alignItems: "center", gap: 1, height: 26, padding: "0 4px",
        borderRadius: 6, cursor: "pointer", border: "none", background: open ? "#ECFDF5" : "transparent",
        color: open ? "#059669" : "#6B6458",
      }}>
        {icon}<ChevronDown style={{ width: 10, height: 10 }} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: 30, left: 0, zIndex: 10000, background: "#FFF", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.16)", border: "1px solid rgba(26,23,20,0.08)", padding: 8, width: 176,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
            {colors.map(c => (
              <button key={c} type="button" onClick={() => { onPick(c); setOpen(false); }} title={c}
                style={{ width: 28, height: 22, borderRadius: 4, background: c, border: "1px solid rgba(26,23,20,0.15)", cursor: "pointer" }} />
            ))}
          </div>
          <button type="button" onClick={() => { onClear(); setOpen(false); }}
            style={{
              marginTop: 8, width: "100%", padding: "5px 0", fontSize: 11, color: "#6B6458",
              background: "#F4F5F6", border: "none", borderRadius: 6, cursor: "pointer",
            }}>{clearLabel}</button>
        </div>
      )}
    </div>
  );
}

/** 押すと項目が並ぶメニュー（表の操作用） */
function Menu({ title, icon, items }: { title: string; icon: React.ReactNode; items: Array<[string, () => void]> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen(o => !o)} title={title} style={{
        display: "flex", alignItems: "center", gap: 1, height: 26, padding: "0 4px",
        borderRadius: 6, cursor: "pointer", border: "none", background: open ? "#ECFDF5" : "transparent",
        color: open ? "#059669" : "#6B6458",
      }}>
        {icon}<ChevronDown style={{ width: 10, height: 10 }} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: 30, left: 0, zIndex: 10000, background: "#FFF", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.16)", border: "1px solid rgba(26,23,20,0.08)", padding: 4, minWidth: 172,
        }}>
          {items.map(([label, run]) => (
            <button key={label} type="button" onClick={() => { run(); setOpen(false); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "7px 10px", fontSize: 12,
                color: "#1A1714", background: "transparent", border: "none", borderRadius: 6, cursor: "pointer",
              }}>{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
