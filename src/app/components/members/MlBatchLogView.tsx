// 夜間バッチの学習ログ（メンバー個別／組織全体の両方から使う）
//
// 「ちゃんと毎晩動いているか」を確認するための画面。
// 変更履歴（member_skill_changes）は "スキルが変わったときだけ" 残るので、
// 「動いたが変更が無かった」「そもそも動かなかった」が区別できなかった。
// このログは1回の実行につき必ず1行残る。
//
// 表示は 日時 / 学習結果 / サマリ の3列。行をクリックすると①②の内訳が開く。

import { useState } from "react";
import { ChevronRight, CheckCircle2, AlertTriangle, MinusCircle } from "lucide-react";
import type { MlBatchRun, MlBatchResult, MlBatchTrigger } from "@/app/types";

/**
 * 表示範囲の切り替え。
 * 既定は「毎晩の実行」だけ。デプロイ時や手動実行を混ぜると、
 * 「毎晩ちゃんと動いているか」という一番見たいことが読み取れなくなるため。
 */
const TRIGGERS: { key: MlBatchTrigger | "all"; label: string }[] = [
  { key: "daily", label: "毎晩の実行" },
  { key: "all",   label: "すべて" },
];

export function BatchLogFilter({ value, onChange }: {
  value: MlBatchTrigger | "all";
  onChange: (v: MlBatchTrigger | "all") => void;
}) {
  return (
    <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
      {TRIGGERS.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          style={{ padding: "5px 12px", fontSize: 11.5, fontWeight: 600, borderRadius: 20, cursor: "pointer", border: value === t.key ? "1px solid #059669" : "1px solid rgba(26,23,20,0.10)", background: value === t.key ? "#ECFDF5" : "#FFFFFF", color: value === t.key ? "#059669" : "#6B6458" }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

const RESULT_META: Record<MlBatchResult, { label: string; color: string; bg: string; border: string; Icon: typeof CheckCircle2 }> = {
  completed: { label: "完了",   color: "#047857", bg: "#ECFDF5", border: "#A7F3D0", Icon: CheckCircle2 },
  failed:    { label: "問題あり", color: "#B91C1C", bg: "#FEF2F2", border: "#FECACA", Icon: AlertTriangle },
  not_run:   { label: "未実行",  color: "#B45309", bg: "#FFFBEB", border: "#FDE68A", Icon: MinusCircle },
  // 記録そのものが無い日。原因が分からないので「未実行」と同じ扱いで見せる。
  missing:   { label: "未実行",  color: "#B45309", bg: "#FFFBEB", border: "#FDE68A", Icon: MinusCircle },
};

/** yyyy年mm月dd日 hh:mm:ss（JST） */
function formatWhen(iso: string, withTime: boolean): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日`;
  if (!withTime) return `${date} —`;
  return `${date} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 内訳（detail.analyze / detail.train）を人が読める行にする */
function phaseLines(run: MlBatchRun): { title: string; status: string; note: string }[] {
  const d = run.detail as { analyze?: Record<string, unknown>; train?: Record<string, unknown> };
  const out: { title: string; status: string; note: string }[] = [];

  const label = (s: unknown) =>
    s === "done" ? "完了" : s === "failed" ? "問題あり" : s === "skipped" ? "未実行" : "記録なし";

  if (d?.analyze) {
    const a = d.analyze;
    const changed = Number(a.changed ?? 0);
    const members = Number(a.changedMembers ?? 0);
    const required = Number(a.requiredWritten ?? 0);
    const notes: string[] = [];
    if (changed > 0) notes.push(`スキル ${members}名・${changed}件を更新`);
    else notes.push("スキルの修正はありませんでした");
    if (required > 0) notes.push(`必要スキル ${required}件を自動付与`);
    if (a.error) notes.push(String(a.error));
    else if (a.reason) notes.push(String(a.reason));
    out.push({ title: "① スキル分析", status: label(a.status), note: notes.join(" / ") });
  }

  if (d?.train) {
    const t = d.train;
    const notes: string[] = [];
    if (t.version) notes.push(`モデル v${t.version} を${t.active ? "採用" : "見送り"}`);
    if (t.error) notes.push(String(t.error));
    else if (t.reason) notes.push(String(t.reason));
    const m = t.metrics as Record<string, unknown> | undefined;
    if (m?.precision_at_1_model !== undefined) {
      notes.push(`精度 ${m.precision_at_1_model}（ルールベース ${m.precision_at_1_baseline}）`);
    }
    out.push({ title: "② モデル学習", status: label(t.status), note: notes.join(" / ") || "—" });
  }

  return out;
}

export function MlBatchLogView({ runs, loading }: {
  runs: MlBatchRun[];
  loading?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading) {
    return <p style={{ fontSize: 12, color: "#A09790", textAlign: "center", padding: "40px 0" }}>読み込み中...</p>;
  }
  if (runs.length === 0) {
    return (
      <p style={{ fontSize: 12, color: "#A09790", textAlign: "center", padding: "40px 0", lineHeight: 1.7 }}>
        まだ実行ログがありません。
        <br />夜間バッチが1回走ると、ここに結果が残ります。
      </p>
    );
  }

  return (
    <div>
      {/* 見出し行 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px 7px", fontSize: 10.5, fontWeight: 700, color: "#A09790" }}>
        <span style={{ width: 176, flexShrink: 0 }}>日時</span>
        <span style={{ width: 74, flexShrink: 0 }}>学習結果</span>
        <span style={{ flex: 1 }}>サマリ</span>
      </div>

      {runs.map(run => {
        const meta = RESULT_META[run.result] ?? RESULT_META.not_run;
        const open = openId === run.id;
        // 記録が無い日は開始時刻そのものが存在しないので、時刻は出さない
        const hasTime = run.result !== "missing";
        const lines = phaseLines(run);

        return (
          <div key={run.id}
            style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, marginBottom: 6, background: "#FFFFFF", overflow: "hidden" }}>
            <button
              onClick={() => setOpenId(open ? null : run.id)}
              disabled={lines.length === 0}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px", textAlign: "left",
                background: "transparent", border: "none", cursor: lines.length === 0 ? "default" : "pointer",
              }}>
              <span style={{ width: 176, flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: "#1A1714", fontVariantNumeric: "tabular-nums" }}>
                {formatWhen(run.startedAt, hasTime)}
              </span>

              <span style={{ width: 74, flexShrink: 0 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 10.5, fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}>
                  <meta.Icon style={{ width: 11, height: 11 }} />{meta.label}
                </span>
              </span>

              <span style={{ flex: 1, fontSize: 11.5, color: "#6B6458", lineHeight: 1.5, wordBreak: "break-word" }}>
                {run.summary}
              </span>

              {lines.length > 0 && (
                <ChevronRight style={{ width: 13, height: 13, color: "#C9C4BB", flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
              )}
            </button>

            {open && lines.length > 0 && (
              <div style={{ borderTop: "1px solid rgba(26,23,20,0.06)", background: "#FAFAFA", padding: "10px 12px" }}>
                {lines.map(l => (
                  <div key={l.title} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 6 }}>
                    <span style={{ width: 92, flexShrink: 0, fontSize: 11, fontWeight: 700, color: "#1A1714" }}>{l.title}</span>
                    <span style={{ width: 56, flexShrink: 0, fontSize: 11, fontWeight: 600, color: "#6B6458" }}>{l.status}</span>
                    <span style={{ flex: 1, fontSize: 11, color: "#6B6458", lineHeight: 1.6, wordBreak: "break-word" }}>{l.note}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
