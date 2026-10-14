// ENHA2-053 休日設定モーダル。
//
// 土日のほかに休みにする日（祝日・会社の休業日など）を登録する。登録した日は、
// 表の予定日数とガントから土日と同じく除く。
//
// 休日には2つの範囲がある:
//   ・全WBSに適用 … そのプロジェクトのすべてのWBSで休みになる（どのWBSの設定を開いても出てくる）
//   ・このWBSのみ … いま開いているWBSだけで休みになる
// 追加・CSV取り込みのときに、チェックボックス「全WBSに適用する」で選ぶ。
//
// CSV は形式を決めていない。日付と名前の列があれば自動で読み取る（lib/wbsHolidayCsv.ts）。
import { useRef, useState } from "react";
import { Check, FileUp, Plus, Trash2 } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { DatePicker } from "@/app/components/shared/DatePicker";
import { submitOnEnter } from "@/app/lib/submitKey";
import { createWbsHolidays, deleteWbsHoliday } from "@/app/lib/wbsService";
import { decodeCsvBytes, parseHolidayCsv, type HolidayCsvRow } from "@/app/lib/wbsHolidayCsv";
import type { WbsHoliday } from "@/app/types";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

function formatDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return s;
  return `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}（${DOW[new Date(y, m - 1, d).getDay()]}）`;
}

/** CSV を読み取った結果。取り込む前に中身を見せる */
interface CsvPreview {
  fileName: string;
  /** 新しく取り込む行（すでに登録されている日付は除いてある） */
  rows: HolidayCsvRow[];
  /** すでに登録されている日付で、取り込まない行の数 */
  existing: number;
  /** ファイルの中で日付が重なっていた行の数 */
  duplicated: number;
  /** 日付が読み取れなかった行の数 */
  unreadable: number;
}

export function WbsHolidayDialog({ projectId, projectName, sheetId, sheetName, holidays, onChanged, onClose }: {
  projectId: string;
  projectName: string;
  /** いま開いているWBS。「このWBSのみ」の休日はここに付ける */
  sheetId: string;
  sheetName: string;
  /** このWBSで有効な休日（全WBSに適用のものと、このWBSのみのもの） */
  holidays: WbsHoliday[];
  /** 保存のたびに呼ぶ。呼び出し側で休日を読み直す */
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  // 全WBSに適用するか。追加と CSV 取り込みの両方に効く
  const [applyAll, setApplyAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 追加・削除・取り込みの連打で二重に走らせないためのガード
  const busyRef = useRef(false);

  const run = async (fn: () => Promise<boolean>, failMessage: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const ok = await fn();
      if (!ok) setError(failMessage);
      await onChanged();
      return ok;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const scopeSheetId = applyAll ? null : sheetId;

  const handleAdd = async () => {
    if (!date) { setError("日付を選んでください。"); return; }
    if (holidays.some(h => h.date === date)) { setError("その日付は、すでに登録されています。"); return; }
    const ok = await run(
      () => createWbsHolidays(projectId, scopeSheetId, [{ date, name: name.trim() }]),
      "休日を追加できませんでした。",
    );
    if (ok) { setDate(""); setName(""); }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const parsed = parseHolidayCsv(decodeCsvBytes(await file.arrayBuffer()));
      const registered = new Set(holidays.map(h => h.date));
      const rows = parsed.rows.filter(r => !registered.has(r.date));
      if (parsed.rows.length === 0) {
        setPreview(null);
        setError("このファイルから日付を読み取れませんでした。日付（例：2026/10/12）の入った列があるかを確かめてください。");
        return;
      }
      setPreview({ fileName: file.name, rows, existing: parsed.rows.length - rows.length, duplicated: parsed.duplicated, unreadable: parsed.unreadable });
    } catch {
      setPreview(null);
      setError("ファイルを読み込めませんでした。");
    }
  };

  const handleImport = async () => {
    if (!preview || preview.rows.length === 0) return;
    const ok = await run(() => createWbsHolidays(projectId, scopeSheetId, preview.rows), "休日を取り込めませんでした。");
    if (ok) setPreview(null);
  };

  return (
    <DialogShell title="休日設定" size="lg" minHeight={0} onClose={busy ? () => {} : onClose} busy={busy}
      footer={<BtnSecondary onClick={onClose} disabled={busy}>閉じる</BtnSecondary>}>
      <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.7 }}>
        土日のほかに休みにする日（祝日・会社の休業日など）を登録します。登録した日は、予定日数とガントから土日と同じように除きます。
      </p>

      <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
        {holidays.length === 0 ? (
          <p style={{ fontSize: 12, color: "#A09790", padding: 14 }}>登録されている休日はありません。</p>
        ) : holidays.map(h => {
          const all = h.sheetId === null;
          return (
            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
              <span style={{ width: 130, fontSize: 13, color: "#1A1714", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{formatDate(h.date)}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: h.name ? "#1A1714" : "#C9C4BB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name || "（名前なし）"}</span>
              {/* どの範囲の休日か。全WBSのものは、消すとほかのWBSからも消える */}
              <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 5, padding: "2px 7px", flexShrink: 0,
                color: all ? "#1E3989" : "#6B6458", background: all ? "#E3E9FB" : "#EFEDE9" }}>
                {all ? "全WBS" : "このWBSのみ"}
              </span>
              <button type="button" disabled={busy} aria-label={`${formatDate(h.date)}を削除`}
                title={all ? "削除（全WBSに適用されているので、ほかのWBSからも消えます）" : "削除"}
                onClick={() => { run(() => deleteWbsHoliday(h.id), "休日を削除できませんでした。"); }}
                style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", borderRadius: 6, cursor: busy ? "not-allowed" : "pointer", color: "#DC2626", flexShrink: 0 }}>
                <Trash2 style={{ width: 14, height: 14 }} />
              </button>
            </div>
          );
        })}
      </div>

      {/* 適用する範囲。下の「追加」と「CSVから取り込む」の両方に効く */}
      <button type="button" role="checkbox" aria-checked={applyAll} onClick={() => setApplyAll(v => !v)} disabled={busy}
        style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", textAlign: "left", cursor: "pointer", borderRadius: 10,
          background: applyAll ? "#ECFDF5" : "#F9F8F6", border: `1.5px solid ${applyAll ? "#059669" : "transparent"}` }}>
        <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", background: applyAll ? "#059669" : "#FFF", border: applyAll ? "none" : "1.5px solid rgba(26,23,20,0.18)" }}>
          {applyAll && <Check style={{ width: 11, height: 11, color: "#FFF" }} />}
        </span>
        <span>
          <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#1A1714" }}>全WBSに適用する</span>
          <span style={{ display: "block", fontSize: 11, color: "#6B6458", marginTop: 2, lineHeight: 1.6 }}>
            {applyAll
              ? `これから追加する休日は、「${projectName}」のすべてのWBSで休みになります。`
              : `これから追加する休日は、このWBS（${sheetName}）だけで休みになります。`}
          </span>
        </span>
      </button>

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#A09790", marginBottom: 6 }}>休日を追加</p>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 170, flexShrink: 0 }}>
            <DatePicker value={date} onChange={v => { setDate(v); setError(null); }} />
          </div>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="休日名（例：文化の日）"
            onKeyDown={submitOnEnter(handleAdd, { enabled: !busy })}
            style={{ flex: 1, minWidth: 0, height: 38, padding: "0 10px", fontSize: 13, color: "#1A1714", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 10, outline: "none", boxSizing: "border-box" }} />
          <button type="button" onClick={handleAdd} disabled={busy}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 38, padding: "0 14px", fontSize: 13, fontWeight: 700, color: "#FFFFFF", background: busy ? "#9CA3AF" : "#059669", border: "none", borderRadius: 10, cursor: busy ? "not-allowed" : "pointer", flexShrink: 0 }}>
            <Plus style={{ width: 13, height: 13 }} />追加
          </button>
        </div>
      </div>

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#A09790", marginBottom: 6 }}>CSV からまとめて追加</p>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" style={{ display: "none" }}
            onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", fontSize: 13, fontWeight: 600, color: "#4B5563", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 10, cursor: busy ? "not-allowed" : "pointer", flexShrink: 0 }}>
            <FileUp style={{ width: 13, height: 13 }} />CSVファイルを選ぶ
          </button>
          <span style={{ fontSize: 11, color: "#A09790", lineHeight: 1.6 }}>
            決まった形式はありません。日付の列（例：2026/10/12）と名前の列があれば、自動で読み取ります。
          </span>
        </div>

        {preview && (
          <div style={{ marginTop: 10, padding: 12, background: "#F7F8F9", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
            <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.7 }}>
              「{preview.fileName}」から <b>{preview.rows.length} 件</b>を追加します
              （{applyAll ? "全WBSに適用" : "このWBSのみ"}）。
            </p>
            {(preview.existing > 0 || preview.duplicated > 0 || preview.unreadable > 0) && (
              <p style={{ fontSize: 11, color: "#6B6458", lineHeight: 1.7 }}>
                追加しない行：
                {[
                  preview.existing > 0 ? `すでに登録されている日付 ${preview.existing} 件` : "",
                  preview.duplicated > 0 ? `ファイルの中で日付が重なっている ${preview.duplicated} 件` : "",
                  preview.unreadable > 0 ? `日付を読み取れなかった ${preview.unreadable} 件` : "",
                ].filter(Boolean).join("、")}
              </p>
            )}
            {preview.rows.length > 0 && (
              <div style={{ maxHeight: 140, overflowY: "auto", marginTop: 8, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 8 }}>
                {preview.rows.map(r => (
                  <div key={r.date} style={{ display: "flex", gap: 10, padding: "5px 10px", fontSize: 12, borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
                    <span style={{ width: 120, color: "#1A1714", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{formatDate(r.date)}</span>
                    <span style={{ flex: 1, minWidth: 0, color: r.name ? "#1A1714" : "#C9C4BB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name || "（名前なし）"}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <BtnSecondary onClick={() => setPreview(null)} disabled={busy}>やめる</BtnSecondary>
              <BtnPrimary onClick={handleImport} disabled={preview.rows.length === 0} loading={busy}>
                {preview.rows.length} 件を追加する
              </BtnPrimary>
            </div>
          </div>
        )}
      </div>

      {error && <p style={{ fontSize: 12, color: "#DC2626", lineHeight: 1.7 }}>{error}</p>}
    </DialogShell>
  );
}
