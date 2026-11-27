// ENHA2-053 WBSのインポート（Excel / CSV から行をまとめて取り込む）。
//
// 流れ:
//   1. テンプレートをダウンロードして入力する（画面からエクスポートしたファイルも同じ形なので、そのまま使える）
//   2. ファイルを選ぶ → 中身を読み取って、取り込む内容とエラーを先に見せる
//   3. 「いまの行に追加する／いまの行をすべて置き換える」を選んで取り込む
//      KAIZEN2611-016「変わったところだけ反映する」を選ぶと、ダイアログを閉じて比べる画面を出す
//      （ファイルの行を「ID」の列で今の行と結びつけ、違いだけを反映する。ID の列が無いファイルでは選べない）
// エラーが1つでもあるうちは取り込まない（途中まで入った中途半端なWBSを作らないため）。
import { useRef, useState } from "react";
import { Check, Download, FileUp } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { downloadBlob } from "@/app/lib/articleExport/download";
import { buildWbsTemplateXlsx, readWbsFile } from "@/app/lib/wbsExcel";
import { parseWbsTable, type WbsImportResult } from "@/app/lib/wbsImport";
import { importWbsItems, loadWbsEditVersion } from "@/app/lib/wbsService";
import type { WbsImportItem } from "@/app/lib/wbsImport";
import type { WbsSheet, WbsStatus } from "@/app/types";

const LEVEL_LABELS = ["大項目", "中項目", "小項目"];

function Radio({ on, label, desc, danger, disabled, onClick }: { on: boolean; label: string; desc: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  const color = danger ? "#DC2626" : "#059669";
  return (
    <button type="button" role="radio" aria-checked={on} aria-disabled={disabled} onClick={disabled ? undefined : onClick}
      style={{ flex: 1, display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", textAlign: "left", cursor: disabled ? "not-allowed" : "pointer", borderRadius: 10,
        opacity: disabled ? 0.55 : 1,
        background: on ? (danger ? "#FEF2F2" : "#ECFDF5") : "#FFFFFF", border: `1.5px solid ${on ? color : "rgba(26,23,20,0.10)"}` }}>
      <span style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", background: on ? color : "#FFF", border: on ? "none" : "1.5px solid rgba(26,23,20,0.18)" }}>
        {on && <Check style={{ width: 10, height: 10, color: "#FFF" }} />}
      </span>
      <span>
        <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{label}</span>
        <span style={{ display: "block", fontSize: 11, color: "#6B6458", marginTop: 2, lineHeight: 1.6 }}>{desc}</span>
      </span>
    </button>
  );
}

/** KAIZEN2611-016 取り込み方。diff ＝ 変わったところだけ反映する */
type ImportMode = "append" | "replace" | "diff";

export function WbsImportDialog({ sheet, statuses, existingRowCount, tailSortOrder, ticketIdByNumber, onImported, onCompare, onClose }: {
  sheet: WbsSheet;
  statuses: WbsStatus[];
  /** いまこのWBSにある行の数（置き換えの確認に出す） */
  existingRowCount: number;
  /** いまある大項目の末尾に積むための並び順 */
  tailSortOrder: number;
  /** チケット番号 → チケットの id（「チケット」列の紐づけに使う） */
  ticketIdByNumber: ReadonlyMap<string, string>;
  onImported: () => Promise<void>;
  /**
   * KAIZEN2611-016「変わったところだけ反映する」で「新旧を見比べる」を押したとき。
   * version はファイルを読んだときの版の番号（反映のときに DB が今の版の番号と比べる）。
   * 渡されないとき（バックアップの仕組みが無い環境）は、この取り込み方を出さない
   */
  onCompare?: (fileItems: WbsImportItem[], version: number) => void;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<WbsImportResult | null>(null);
  const [mode, setMode] = useState<ImportMode>("append");
  const replace = mode === "replace";
  // ファイルを読んだときの版の番号（変わったところだけ反映するときに使う）
  const [readVersion, setReadVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 取り込み・ダウンロードの連打で二重に走らせないためのガード
  const busyRef = useRef(false);

  const guarded = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await fn(); } finally { busyRef.current = false; setBusy(false); }
  };

  const downloadTemplate = () => guarded(async () => {
    try {
      downloadBlob(await buildWbsTemplateXlsx(statuses.map(s => s.name), sheet.levels), "WBSテンプレート.xlsx");
    } catch {
      setMessage("テンプレートを作れませんでした。");
    }
  });

  const handleFile = (file: File | undefined) => guarded(async () => {
    if (!file) return;
    setMessage(null);
    setParsed(null);
    setFileName(file.name);
    if (/\.xls$/i.test(file.name)) {
      setMessage("古い形式の Excel（.xls）は読めません。Excel で「.xlsx」として保存し直してください。");
      return;
    }
    try {
      // 版の番号はファイルの中身と比べる前の今の WBS のもの。読んだあとに WBS が直されたら、反映のときに止める
      const version = onCompare ? await loadWbsEditVersion(sheet.id) : null;
      const result = parseWbsTable(await readWbsFile(file), sheet.levels, statuses.map(s => s.name));
      setReadVersion(version);
      setParsed(result);
      // ID の列が無いファイルで「変わったところだけ」を選んでいたら、追加に戻す
      if (!result.hasIdColumn) setMode(m => (m === "diff" ? "append" : m));
    } catch {
      setMessage("ファイルを読み込めませんでした。Excel（.xlsx）か CSV のファイルかを確かめてください。");
    }
  });

  // チケット番号のうち、このプロジェクトに無いもの（紐づけずに取り込む）
  const unknownTickets = parsed
    ? [...new Set(parsed.items.flatMap(i => i.ticketNumbers).filter(n => !ticketIdByNumber.has(n)))]
    : [];
  const canImport = !!parsed && parsed.errors.length === 0 && parsed.items.length > 0;

  const diffAvailable = !!onCompare && !!parsed?.hasIdColumn && readVersion !== null;
  const diffUnavailableReason = !onCompare
    ? "この環境では使えません（バックアップの仕組みが必要です）"
    : parsed && !parsed.hasIdColumn
      ? "このファイルには ID の列がありません。画面の「エクスポート」で作ったファイルを直して使ってください（テンプレート・古いファイルでは使えません）"
      : "";

  const handleImport = () => guarded(async () => {
    if (!parsed || !canImport) return;
    setMessage(null);
    if (mode === "diff") {
      if (!diffAvailable || !onCompare || readVersion === null) return;
      onCompare(parsed.items, readVersion);
      onClose();
      return;
    }
    const ok = await importWbsItems({
      sheetId: sheet.id, replace, items: parsed.items, statuses, newStatuses: parsed.newStatuses,
      baseSortOrder: replace ? 0 : tailSortOrder, ticketIdByNumber,
    });
    await onImported();
    if (ok) onClose();
    else setMessage("取り込みの途中で失敗しました。一部だけ入っている可能性があるので、表を確かめてください。");
  });

  return (
    <DialogShell title="WBSをインポート" size="lg" minHeight={0} onClose={busy ? () => {} : onClose} busy={busy}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={busy}>キャンセル</BtnSecondary>
        <BtnPrimary onClick={handleImport} disabled={!canImport || (mode === "diff" && !diffAvailable)} loading={busy && canImport}>
          {mode === "diff" ? "新旧を見比べる" : parsed && canImport ? `${parsed.items.length} 行を取り込む` : "取り込む"}
        </BtnPrimary>
      </>}>
      <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.7 }}>
        Excel（.xlsx）か CSV で作った行を、「{sheet.name}」にまとめて取り込みます。
        テンプレートに入力するか、この画面からエクスポートしたファイルを直して使ってください。
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={downloadTemplate} disabled={busy}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", fontSize: 13, fontWeight: 600, color: "#4B5563", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 10, cursor: busy ? "not-allowed" : "pointer" }}>
          <Download style={{ width: 13, height: 13 }} />テンプレートをダウンロード
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt,text/csv" style={{ display: "none" }}
          onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", fontSize: 13, fontWeight: 700, color: "#FFFFFF", background: busy ? "#9CA3AF" : "#059669", border: "none", borderRadius: 10, cursor: busy ? "not-allowed" : "pointer" }}>
          <FileUp style={{ width: 13, height: 13 }} />ファイルを選ぶ
        </button>
        {fileName && <span style={{ fontSize: 12, color: "#6B6458", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</span>}
      </div>

      {parsed && (
        <div style={{ padding: 12, background: "#F7F8F9", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
          {parsed.errors.length > 0 ? (
            <>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#DC2626" }}>このままでは取り込めません（{parsed.errors.length}件）</p>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, maxHeight: 180, overflowY: "auto", fontSize: 12, color: "#1A1714", lineHeight: 1.8 }}>
                {parsed.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
              <p style={{ fontSize: 11, color: "#6B6458", marginTop: 6 }}>ファイルを直してから、もう一度選んでください。</p>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.7 }}>
                <b>{parsed.items.length} 行</b>を取り込みます（
                {parsed.counts.map((n, i) => (n > 0 ? `${LEVEL_LABELS[i]} ${n}` : "")).filter(Boolean).join("・")}）。
              </p>
              {parsed.newStatuses.length > 0 && (
                <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.7 }}>
                  このWBSに無いステータスを追加します：{parsed.newStatuses.join("、")}
                </p>
              )}
              {unknownTickets.length > 0 && (
                <p style={{ fontSize: 12, color: "#B45309", lineHeight: 1.7 }}>
                  このプロジェクトに無いチケット番号は紐づけません：{unknownTickets.slice(0, 10).join("、")}{unknownTickets.length > 10 ? ` ほか${unknownTickets.length - 10}件` : ""}
                </p>
              )}
            </>
          )}
          {parsed.warnings.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, maxHeight: 90, overflowY: "auto", fontSize: 11, color: "#B45309", lineHeight: 1.8 }}>
              {parsed.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}

      {canImport && (
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#A09790", marginBottom: 6 }}>取り込み方</p>
          <div role="radiogroup" style={{ display: "flex", gap: 8 }}>
            <Radio on={mode === "append"} onClick={() => setMode("append")} label="いまの行に追加する"
              desc={existingRowCount > 0 ? `いまある ${existingRowCount} 行は残し、その下に追加します。` : "このWBSにはまだ行がありません。"} />
            <Radio on={replace} danger onClick={() => setMode("replace")} label="いまの行をすべて置き換える"
              desc={existingRowCount > 0 ? `いまある ${existingRowCount} 行と、そのチケットの紐づけを削除してから取り込みます。元に戻せません。` : "いまある行を削除してから取り込みます。"} />
            {onCompare && (
              <Radio on={mode === "diff"} disabled={!diffAvailable} onClick={() => setMode("diff")} label="変わったところだけ反映する"
                desc={diffAvailable
                  ? "ファイルの行を ID で今の行と結びつけ、違いだけを反映します。反映の前に新旧を見比べられます。"
                  : diffUnavailableReason} />
            )}
          </div>
        </div>
      )}

      {message && <p style={{ fontSize: 12, color: "#DC2626", lineHeight: 1.7 }}>{message}</p>}
    </DialogShell>
  );
}
