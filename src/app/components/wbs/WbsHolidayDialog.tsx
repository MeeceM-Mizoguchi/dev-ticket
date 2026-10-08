// ENHA2-053 祝日設定モーダル。
//
// 祝日はプロジェクトごとに持ち、そのプロジェクトの全WBSで共通に使う。
// 登録した祝日は、表の予定日数とガントにすぐ反映する（土日と同じく稼働日から除く）。
import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { DatePicker } from "@/app/components/shared/DatePicker";
import { submitOnEnter } from "@/app/lib/submitKey";
import { createWbsHoliday, deleteWbsHoliday } from "@/app/lib/wbsService";
import type { WbsHoliday } from "@/app/types";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

function formatDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return s;
  return `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}（${DOW[new Date(y, m - 1, d).getDay()]}）`;
}

export function WbsHolidayDialog({ projectId, projectName, holidays, onChanged, onClose }: {
  projectId: string;
  projectName: string;
  holidays: WbsHoliday[];
  /** 保存のたびに呼ぶ。呼び出し側で祝日を読み直す */
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 追加・削除の連打で二重に走らせないためのガード
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

  const handleAdd = async () => {
    if (!date) { setError("日付を選んでください。"); return; }
    if (holidays.some(h => h.date === date)) { setError("その日付は、すでに登録されています。"); return; }
    const ok = await run(async () => !!(await createWbsHoliday({ projectId, date, name: name.trim() })), "祝日を追加できませんでした。");
    if (ok) { setDate(""); setName(""); }
  };

  return (
    <DialogShell title="祝日設定" size="md" minHeight={0} onClose={busy ? () => {} : onClose}
      footer={<BtnSecondary onClick={onClose} disabled={busy}>閉じる</BtnSecondary>}>
      <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.7 }}>
        「{projectName}」の祝日です。このプロジェクトのすべてのWBSで共通に使い、予定日数とガントから土日と同じように除きます。
      </p>

      <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
        {holidays.length === 0 ? (
          <p style={{ fontSize: 12, color: "#A09790", padding: 14 }}>登録されている祝日はありません。</p>
        ) : holidays.map(h => (
          <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
            <span style={{ width: 130, fontSize: 13, color: "#1A1714", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{formatDate(h.date)}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: h.name ? "#1A1714" : "#C9C4BB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name || "（名前なし）"}</span>
            <button type="button" disabled={busy} title="削除" aria-label={`${formatDate(h.date)}を削除`}
              onClick={() => { run(() => deleteWbsHoliday(h.id), "祝日を削除できませんでした。"); }}
              style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", borderRadius: 6, cursor: busy ? "not-allowed" : "pointer", color: "#DC2626", flexShrink: 0 }}>
              <Trash2 style={{ width: 14, height: 14 }} />
            </button>
          </div>
        ))}
      </div>

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#A09790", marginBottom: 6 }}>祝日を追加</p>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 170, flexShrink: 0 }}>
            <DatePicker value={date} onChange={v => { setDate(v); setError(null); }} />
          </div>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="祝日名（例：文化の日）"
            onKeyDown={submitOnEnter(handleAdd, { enabled: !busy })}
            style={{ flex: 1, minWidth: 0, height: 38, padding: "0 10px", fontSize: 13, color: "#1A1714", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 10, outline: "none", boxSizing: "border-box" }} />
          <button type="button" onClick={handleAdd} disabled={busy}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 38, padding: "0 14px", fontSize: 13, fontWeight: 700, color: "#FFFFFF", background: busy ? "#9CA3AF" : "#059669", border: "none", borderRadius: 10, cursor: busy ? "not-allowed" : "pointer", flexShrink: 0 }}>
            <Plus style={{ width: 13, height: 13 }} />追加
          </button>
        </div>
        {error && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>{error}</p>}
      </div>
    </DialogShell>
  );
}
