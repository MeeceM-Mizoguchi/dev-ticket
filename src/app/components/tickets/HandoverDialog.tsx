// 担当交代（引継ぎ）ダイアログ。
//
// 担当プルダウンで別の人を選んだ時点で必ずここを通す。
// 「あとで引継ぎボタンを押す」方式にすると押し忘れた分の実績が分けられないため、
// 記録漏れが構造的に起きない側に倒してある。
//
// ここでやること:
//   ① 元担当の実績を確定する（区間の稼働時間から自動按分した値を初期表示。実態と違えば直せる）
//   ② 引継ぎの理由・申し送りを残す
//   ③ 呼び出し側がチケット更新 → コメント（handover）→ 通知 の順で流す
//
// ★1行入力欄の Enter は submitOnEnter 経由（IMEの変換確定Enterで確定させない）

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { Avatar } from "@/app/components/shared/Avatar";
import { formatPersonDays } from "@/app/lib/helpers";
import { parseHoursInput } from "@/app/lib/handover";
import { submitOnEnter, submitOnModEnter } from "@/app/lib/submitKey";

export interface HandoverResult {
  /** 元担当の実績（時間）。自動按分値のままなら null を入れて自動追随させる */
  hoursOverride: number | null;
  note: string;
}

export function HandoverDialog({
  prevAssignee,
  nextAssignee,
  totalHours,
  suggestedHours,
  onConfirm,
  onClose,
}: {
  prevAssignee: string;
  /** 空文字なら「割り当て解除」 */
  nextAssignee: string;
  /** チケット全体の実績（時間） */
  totalHours: number;
  /** 元担当ぶんの自動按分値（時間） */
  suggestedHours: number;
  onConfirm: (result: HandoverResult) => Promise<void> | void;
  onClose: () => void;
}) {
  const suggested = Math.round(suggestedHours * 100) / 100;
  const [hours, setHours] = useState<string>(suggested > 0 ? String(suggested) : "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // BUG-05: await を含む送信ハンドラは ref でガードする。
  // state だけだと同じレンダーのハンドラが2回走ったときに両方すり抜ける
  const submittingRef = useRef(false);
  const hoursInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => hoursInputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  const parsed = parseHoursInput(hours);
  const invalid = hours.trim() !== "" && parsed === null;
  const edited = parsed !== null && Math.abs(parsed - suggested) > 0.001;
  const nextHours = Math.max(0, Math.round((totalHours - (parsed ?? suggested)) * 100) / 100);

  const handleConfirm = async () => {
    if (submittingRef.current || invalid) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      await onConfirm({
        // 自動按分値のままなら override を書かない。書いてしまうと、このあと実績モニタで
        // チケット合計を直したときに元担当の取り分だけ古い値で固定されてしまう
        hoursOverride: edited ? parsed : null,
        note: note.trim(),
      });
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const label = (name: string) => name || "未割り当て";

  return (
    <DialogShell
      title="担当を引き継ぐ"
      onClose={saving ? () => {} : onClose}
      busy={saving}
      size="md"
      minHeight={0}
      zIndex={1200}
      footer={
        <>
          <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
          <button type="button" onClick={handleConfirm} disabled={saving || invalid}
            style={{ padding: "9px 20px", background: saving || invalid ? "rgba(5,150,105,0.35)" : "#059669", color: "#FFFFFF", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: saving || invalid ? "not-allowed" : "pointer", boxShadow: saving || invalid ? "none" : "0 4px 14px rgba(5,150,105,0.28)", transition: "all 0.15s" }}>
            {saving ? "引き継ぎ中..." : "引き継ぐ"}
          </button>
        </>
      }>

      {/* 誰から誰へ */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, padding: "14px 12px", background: "#FAFAF9", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Avatar name={prevAssignee} size="sm" />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#3D3732", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(prevAssignee)}</span>
          <span style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, letterSpacing: "0.06em" }}>これまでの担当</span>
        </div>
        <ArrowRight style={{ width: 16, height: 16, color: "#059669", flexShrink: 0 }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
          {nextAssignee ? <Avatar name={nextAssignee} size="sm" /> : <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#F4F5F6", border: "1px dashed rgba(26,23,20,0.18)" }} />}
          <span style={{ fontSize: 12, fontWeight: 700, color: nextAssignee ? "#059669" : "#B0A9A4", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(nextAssignee)}</span>
          <span style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, letterSpacing: "0.06em" }}>新しい担当</span>
        </div>
      </div>

      {/* 元担当の実績。まだ実績が付いていないチケット（着手前など）は分けるものが無いので出さない */}
      {totalHours <= 0 ? (
        <p style={{ fontSize: 11.5, color: "#9E9690", lineHeight: 1.7, background: "#FAFAF9", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px", margin: 0 }}>
          このチケットにはまだ実績工数が付いていないため、分ける実績はありません。<br />
          着手後に担当が替わった場合は、担当していた期間から自動で按分されます。
        </p>
      ) : (
      <div>
        <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
          {label(prevAssignee)} さんの実績
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            ref={hoursInputRef}
            type="number"
            min="0"
            step="0.5"
            value={hours}
            onChange={e => setHours(e.target.value)}
            onKeyDown={submitOnEnter(handleConfirm, { enabled: !saving && !invalid, onCancel: saving ? null : onClose })}
            disabled={saving}
            placeholder="0"
            style={{ width: 100, padding: "8px 10px", fontSize: 15, fontWeight: 700, border: `1.5px solid ${invalid ? "#EF4444" : "rgba(26,23,20,0.15)"}`, borderRadius: 9, outline: "none", color: "#1A1714", background: "#FFFFFF", textAlign: "right" }}
            onFocus={e => { if (!invalid) { e.currentTarget.style.borderColor = "#059669"; e.currentTarget.style.boxShadow = "0 0 0 2px rgba(5,150,105,0.12)"; } }}
            onBlur={e => { e.currentTarget.style.borderColor = invalid ? "#EF4444" : "rgba(26,23,20,0.15)"; e.currentTarget.style.boxShadow = "none"; }}
          />
          <span style={{ fontSize: 13, color: "#6B6458", fontWeight: 600 }}>時間</span>
          <span style={{ fontSize: 12, color: "#059669", fontFamily: "var(--font-mono)", fontWeight: 700, marginLeft: 2 }}>
            {formatPersonDays(parsed ?? 0)}
          </span>
          {!edited && suggested > 0 && (
            <span style={{ fontSize: 10, color: "#9E9690", background: "#F4F5F6", padding: "3px 9px", borderRadius: 20, fontWeight: 600 }}>自動計測値</span>
          )}
          {edited && (
            <button type="button" onClick={() => setHours(suggested > 0 ? String(suggested) : "")}
              style={{ fontSize: 11, color: "#059669", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
              自動計測値に戻す
            </button>
          )}
        </div>
        <p style={{ fontSize: 11, color: "#9E9690", marginTop: 7, lineHeight: 1.6 }}>
          担当していた期間の稼働時間（保留中は除外）から自動計算した値です。実態と違えば直してください。
          {totalHours > 0 && (
            <>
              <br />
              チケット全体の実績 {Math.round(totalHours * 100) / 100}時間 のうち、
              残りの <strong style={{ color: "#3D3732" }}>{nextHours}時間</strong> が
              {nextAssignee ? ` ${nextAssignee} さん以降の取り分` : "この先の担当者の取り分"}になります。
            </>
          )}
        </p>
        {invalid && <p style={{ fontSize: 11, color: "#EF4444", marginTop: 6, fontWeight: 600 }}>0以上の数値を入力してください</p>}
      </div>
      )}

      {/* 引継ぎメモ */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
          引継ぎ理由・申し送り<span style={{ marginLeft: 6, textTransform: "none", letterSpacing: 0, color: "#C9C4BB" }}>任意</span>
        </p>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={submitOnModEnter(handleConfirm, { enabled: !saving && !invalid })}
          disabled={saving}
          rows={3}
          placeholder="例）長期休暇のため。レビュー指摘の2件目まで対応済み、3件目から未着手です。"
          style={{ width: "100%", padding: "9px 11px", fontSize: 13, lineHeight: 1.7, border: "1.5px solid rgba(26,23,20,0.15)", borderRadius: 9, outline: "none", color: "#1A1714", background: "#FFFFFF", resize: "vertical", fontFamily: "inherit" }}
          onFocus={e => { e.currentTarget.style.borderColor = "#059669"; e.currentTarget.style.boxShadow = "0 0 0 2px rgba(5,150,105,0.12)"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.15)"; e.currentTarget.style.boxShadow = "none"; }}
        />
        <p style={{ fontSize: 11, color: "#9E9690", marginTop: 6 }}>
          コメント欄に引継ぎの履歴として残ります（⌘/Ctrl + Enter で確定）。
        </p>
      </div>
    </DialogShell>
  );
}
