// 失敗しているチェックのままマージしようとしたときの関門（層A / docs/deploy-verification-design.md）。
//
// GitHub のブランチ保護（Required status checks）が未設定だと、チェックが真っ赤でも
// mergeable_state は clean のままで、GitHub 側には関門が無い。
// 実際、失敗したままのマージが積み上がり、本番へ11コミット届かない状態が11日間続いた。
//
// ここでの方針は「塞がない・黙って通さない」。
// 完全に塞ぐと運用が回らず機能ごと切られるので、既定は「理由を書けば通す」にして、
// 理由を監査ログに残す。押し切ったこと自体が後から数えられる状態にするのが目的。
import { AlertTriangle } from "lucide-react";
import type { GithubMergePrecheckRow } from "@/app/types";

const AMBER_BG = "#FFFBEB";
const AMBER_BORDER = "rgba(217,119,6,0.32)";
const AMBER_TEXT = "#92400E";
const RED_BG = "#FEF2F2";
const RED_BORDER = "rgba(220,38,38,0.32)";
const RED_TEXT = "#B91C1C";

export const REASON_MIN = 5;

export function CheckGateNotice({ rows, repo, needsReason, reason, onReasonChange, disabled }: {
  /** 失敗チェックが見つかった行だけを渡す（checkGate を持つもの） */
  rows: GithubMergePrecheckRow[];
  repo?: string;
  /** 理由の入力が必要か（サーバーが needsReason を返した場合） */
  needsReason?: boolean;
  reason?: string;
  onReasonChange?: (v: string) => void;
  disabled?: boolean;
}) {
  const gated = rows.filter(r => r.checkGate);
  if (!gated.length) return null;

  const hardBlock = gated.some(r => r.checkGate?.level === "block");
  const blockedDeploy = gated.some(r => r.checkGate?.blockedDeploy);
  const tone = hardBlock
    ? { bg: RED_BG, border: RED_BORDER, text: RED_TEXT }
    : { bg: AMBER_BG, border: AMBER_BORDER, text: AMBER_TEXT };

  const title = blockedDeploy
    ? "デプロイが止められています"
    : hardBlock
      ? "失敗しているチェックがあるため、マージできません"
      : "失敗しているチェックがあります";

  return (
    <div style={{ display: "flex", gap: 10, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 10, padding: "12px 14px" }}>
      <AlertTriangle style={{ width: 15, height: 15, color: tone.text, flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0, flex: 1, color: tone.text }}>
        <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{title}</p>
        <p style={{ fontSize: 12, lineHeight: 1.75 }}>
          {blockedDeploy
            ? "ビルドが実行される前に止められています。このままマージしても、変更は本番に届きません。"
            : "このままマージしても、変更が本番に反映されない可能性があります。"}
          {hardBlock
            ? "このプロジェクトでは、失敗したままのマージを禁止しています。"
            : needsReason
              ? "続ける場合は、下に理由を入力してください（監査ログに残ります）。"
              : ""}
        </p>

        <div style={{ marginTop: 7, display: "flex", flexDirection: "column" as const, gap: 5 }}>
          {gated.map(r => (
            <div key={r.number} style={{ fontSize: 11, lineHeight: 1.7, wordBreak: "break-word" as const }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>#{r.number}</span> {r.title}
              {repo && (
                <a href={`https://github.com/${repo}/pull/${r.number}/checks`} target="_blank" rel="noopener noreferrer"
                  style={{ marginLeft: 6, color: "inherit", fontWeight: 700, textDecoration: "underline" }}>
                  チェックを開く
                </a>
              )}
              {(r.checkGate?.failed ?? []).slice(0, 4).map((f, i) => (
                <span key={i} style={{ display: "block", paddingLeft: 12, opacity: 0.95 }}>✗ {f}</span>
              ))}
            </div>
          ))}
        </div>

        {/* 確認できていない情報源があるなら、それも言う。
            「チェックなし＝問題なし」と読ませないため */}
        {gated.some(r => (r.checkUnavailable?.length ?? 0) > 0) && (
          <p style={{ fontSize: 11, marginTop: 6, opacity: 0.85, lineHeight: 1.7 }}>
            {Array.from(new Set(gated.flatMap(r => r.checkUnavailable ?? []))).join("・")} は権限が無いため確認できていません。
          </p>
        )}

        {needsReason && !hardBlock && (
          <div style={{ marginTop: 9 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
              このままマージする理由（必須）
            </label>
            <textarea
              value={reason ?? ""}
              disabled={disabled}
              onChange={e => onReasonChange?.(e.target.value)}
              rows={2}
              placeholder="例: 失敗しているのは Vercel のプレビュー用チェックのみで、本番デプロイには影響しないことを確認済み"
              style={{
                width: "100%", boxSizing: "border-box" as const, padding: "8px 10px", fontSize: 12,
                borderRadius: 8, border: `1px solid ${tone.border}`, background: "#FFF", color: "#1A1714",
                outline: "none", resize: "vertical" as const, lineHeight: 1.6,
              }}
            />
            {(reason ?? "").trim().length > 0 && (reason ?? "").trim().length < REASON_MIN && (
              <p style={{ fontSize: 11, marginTop: 3 }}>もう少し具体的に入力してください。</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
