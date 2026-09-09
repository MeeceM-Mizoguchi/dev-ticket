// チケット詳細の「関連PR」でマージを押したときに挟む分岐（BRU14-007）。
//
// チケットから1件だけマージすると、リポジトリに溜まっている他のPRが見えないまま
// マージ先だけが進む。次にマージする人はその分のコンフリクトを踏むことになるので、
// 押した時点で「他に何が溜まっているか」を出し、まとめて入れるかどうかを選ばせる。
//
// 選択肢は2つだけにしてある（やめるのは × と ESC）。
//   ・はい          … まとめてマージへ進む（BulkMergeDialog）
//   ・単体でマージ  … 押したPRだけをマージする（MergeConfirmDialog）
//
// 「はい」でマージできないPRが混ざっていた場合は、そのまま進めても
// まとめてマージは1件もマージせずに止まる（BRU13-038）。押し直しになるだけなので、
// 先に「除外して進む／PRを見直す」を選ばせる。
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ExternalLink, GitMerge } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { mergeBlockReason } from "@/app/lib/github";
import type { GithubPull } from "@/app/types";

const BLACK = "#1F2328";

/**
 * ok       … 今すぐマージできる
 * conflict … コンフリクトしている
 * blocked  … コンフリクト以外の理由でマージできない（Draft・必須チェック待ち等）
 * unknown  … GitHub側が判定中、または一覧の下位で可否を引いていない
 */
type PrStateKind = "ok" | "conflict" | "blocked" | "unknown";

interface PrState {
  kind: PrStateKind;
  label: string;
  fg: string;
  bg: string;
}

const TONE: Record<PrStateKind, { fg: string; bg: string }> = {
  ok:       { fg: "#059669", bg: "#ECFDF5" },
  conflict: { fg: "#DC2626", bg: "#FEF2F2" },
  blocked:  { fg: "#D97706", bg: "#FFFBEB" },
  unknown:  { fg: "#6B6458", bg: "#F4F5F6" },
};

/**
 * 一覧に出すマージ可否。判断そのものは mergeBlockReason に任せ、
 * ここでは「人がやることが違うもの」を言い分けるためだけに種類へ振り分ける。
 *
 * 判定中・未確認を「マージできます」と言い切らないのは、
 * 一覧は上位15件しかマージ可否を引いていないため（サーバー側の handlePulls）。
 * ここで断定すると、除外の判断を間違った情報でさせることになる。
 */
function prState(p: GithubPull): PrState {
  const undecided = p.mergeableState === "unknown"
    || (p.mergeableState == null && p.mergeable == null);
  if (undecided) return { kind: "unknown", label: "マージ可否は未確認", ...TONE.unknown };

  const reason = mergeBlockReason(p);
  if (!reason) return { kind: "ok", label: "マージできます", ...TONE.ok };

  const conflict = p.mergeableState === "dirty" || p.mergeable === false;
  return conflict
    ? { kind: "conflict", label: "コンフリクト", ...TONE.conflict }
    : { kind: "blocked", label: reason, ...TONE.blocked };
}

/** まとめてマージから外すべきもの。未確認はサーバー側の事前チェックに任せて残す */
const isExcluded = (s: PrState) => s.kind === "conflict" || s.kind === "blocked";

/**
 * PR番号は必ず作られた順に振られるので、番号の昇順が作成順になる。
 * まとめてマージも既定はこの順番なので、ここでも同じ並びで見せる
 */
const inCreatedOrder = (list: GithubPull[]) => [...list].sort((a, b) => a.number - b.number);

function PrimaryButton({ onClick, disabled, title, children }: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      style={{ padding: "9px 20px", background: disabled ? "#9CA3AF" : BLACK, color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: disabled ? "not-allowed" : "pointer" }}>
      {children}
    </button>
  );
}

function OutlineButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      style={{ padding: "9px 20px", background: "#FFF", color: BLACK, fontSize: 13, fontWeight: 700, borderRadius: 10, border: "1px solid rgba(26,23,20,0.20)", cursor: "pointer" }}>
      {children}
    </button>
  );
}

export function BulkMergePromptDialog({ target, pulls, repo, onSingle, onProceed, onReview, onClose }: {
  /** 押したPR。一覧の中でどれのことか分かるように印を付ける */
  target: GithubPull;
  /** target を含む、リポジトリのオープンなPR全件 */
  pulls: GithubPull[];
  repo: string;
  /** 「単体でマージ」。押したPRだけをマージする */
  onSingle: () => void;
  /**
   * まとめてマージへ進む。マージできないものを外したあとの一覧を渡す。
   * 1件しか残らなかった場合もそのまま渡すので、呼び出し側で単体へ振り分けてよい
   */
  onProceed: (targets: GithubPull[]) => void;
  /** 「PRを見直す」。GitHubの画面へ移動する */
  onReview: () => void;
  onClose: () => void;
}) {
  /** ask … まとめるかどうか／conflict … マージできないPRを除外するかどうか */
  const [step, setStep] = useState<"ask" | "conflict">("ask");

  const rows = useMemo(
    () => inCreatedOrder(pulls).map(p => ({ pull: p, state: prState(p) })),
    [pulls],
  );
  const excluded = useMemo(() => rows.filter(r => isExcluded(r.state)), [rows]);
  const remaining = useMemo(() => rows.filter(r => !isExcluded(r.state)).map(r => r.pull), [rows]);
  const targetExcluded = excluded.some(r => r.pull.number === target.number);

  const handleYes = () => {
    // 全件そのまま通せるなら、いちいち確認を挟まない
    if (!excluded.length) { onProceed(rows.map(r => r.pull)); return; }
    setStep("conflict");
  };

  if (step === "conflict") {
    return (
      <DialogShell
        title={excluded.some(r => r.state.kind === "conflict") ? "コンフリクトしているPRがあります" : "マージできないPRがあります"}
        size="lg" minHeight={0} onClose={onClose}
        footer={<>
          <OutlineButton onClick={onReview}>PRを見直す</OutlineButton>
          <PrimaryButton onClick={() => onProceed(remaining)} disabled={remaining.length === 0}
            title={remaining.length === 0 ? "マージできるプルリクエストが1件もありません" : undefined}>
            {remaining.length === 0
              ? "マージできるPRがありません"
              : remaining.length === 1
                ? `はい、#${remaining[0].number} だけをマージする`
                : `はい、除外して${remaining.length}件をマージする`}
          </PrimaryButton>
        </>}>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
          <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.8 }}>
            下の<strong>{excluded.length}件</strong>は、今のままではマージできません。
            このまま進めても<strong>1件もマージされずに止まります</strong>ので、
            除外して残りだけをマージするか、GitHubの画面でPRを見直してください。
          </p>

          <div style={{ border: "1px solid rgba(220,38,38,0.25)", borderRadius: 10, overflow: "hidden" }}>
            {excluded.map((r, i) => (
              <div key={r.pull.number}
                style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 13px", background: r.state.bg, borderBottom: i < excluded.length - 1 ? "1px solid rgba(26,23,20,0.06)" : "none" }}>
                <GitMerge style={{ width: 13, height: 13, color: r.state.fg, flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontSize: 12, color: "#1A1714", wordBreak: "break-word" as const }}>
                    <span style={{ fontFamily: "var(--font-mono)", color: "#8A837B" }}>#{r.pull.number}</span> {r.pull.title}
                    {r.pull.number === target.number && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#B45309" }}>今回のPR</span>
                    )}
                  </p>
                  <p style={{ fontSize: 11, color: r.state.fg, marginTop: 2, fontWeight: 600 }}>
                    {r.state.label}
                    {repo && (
                      <a href={`https://github.com/${repo}/pull/${r.pull.number}`} target="_blank" rel="noopener noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 8, fontWeight: 700, color: r.state.fg, textDecoration: "underline" }}>
                        GitHubで開く<ExternalLink style={{ width: 10, height: 10 }} />
                      </a>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* 押したPR自身が外れる場合。ここを黙って通すと「マージしたつもりが入っていない」になる */}
          {targetExcluded && (
            <div style={{ display: "flex", gap: 9, padding: "11px 13px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 9 }}>
              <AlertTriangle style={{ width: 14, height: 14, color: "#DC2626", flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 11, color: "#B91C1C", lineHeight: 1.7 }}>
                今回マージしようとした <strong style={{ fontFamily: "var(--font-mono)" }}>#{target.number}</strong> も除外されます。
                このチケットのPRはマージされないので、GitHub上で解消してからやり直してください。
              </p>
            </div>
          )}

          <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.7 }}>
            「PRを見直す」を押すと、このプロジェクトのGitHub画面へ移動します（マージは実行しません）。
          </p>
        </div>
      </DialogShell>
    );
  }

  const others = rows.length - 1;
  return (
    <DialogShell title="他のPRもまとめてマージしますか？" size="lg" minHeight={0} onClose={onClose}
      footer={<>
        <OutlineButton onClick={onSingle}>単体でマージする</OutlineButton>
        <PrimaryButton onClick={handleYes}>はい、まとめてマージする</PrimaryButton>
      </>}>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
        <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.8 }}>
          このリポジトリには、今回の <strong style={{ fontFamily: "var(--font-mono)" }}>#{target.number}</strong> のほかに
          <strong>{others}件</strong>のオープンなプルリクエストがあります。
        </p>
        <p style={{ fontSize: 12, color: "#6B6458" }}>
          リポジトリ <strong style={{ fontFamily: "var(--font-mono)" }}>{repo}</strong>
        </p>

        <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, overflow: "hidden" }}>
          {rows.map((r, i) => (
            <div key={r.pull.number}
              style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 13px", background: r.pull.number === target.number ? "#F5F7FF" : "#FFF", borderBottom: i < rows.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: 12, color: "#1A1714", wordBreak: "break-word" as const }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "#8A837B" }}>#{r.pull.number}</span> {r.pull.title}
                  {r.pull.number === target.number && (
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#4F46E5" }}>今回のPR</span>
                  )}
                </p>
                <p style={{ fontSize: 11, color: "#A09790", marginTop: 2 }}>
                  {r.pull.base} ← {r.pull.head}
                  {r.pull.checkSummary && ` ・ ${r.pull.checkSummary}`}
                  {r.pull.reviewSummary && ` ・ レビュー ${r.pull.reviewSummary}`}
                </p>
              </div>
              <span style={{ flexShrink: 0, padding: "3px 9px", borderRadius: 999, fontSize: 10, fontWeight: 700, color: r.state.fg, background: r.state.bg, whiteSpace: "nowrap" as const }}>
                {r.state.label}
              </span>
            </div>
          ))}
        </div>

        {/* 押す前に「そのまま進めると止まる」ことが分かるようにしておく。
            押してから初めて理由が出る状態にしない（BRU13-038 と同じ方針） */}
        {excluded.length > 0 && (
          <div style={{ display: "flex", gap: 9, padding: "11px 13px", background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.28)", borderRadius: 9 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 11, color: "#92400E", lineHeight: 1.7 }}>
              このうち<strong>{excluded.length}件</strong>は今のままではマージできません。
              「はい」を押すと、除外して進めるかどうかを確認します。
            </p>
          </div>
        )}

        <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.7 }}>
          まとめてマージは、<strong>作成順に上から1件ずつ</strong>マージします。
          実行前に全件を確認し、1件でも通らなければ<strong>1件もマージしません</strong>。<br />
          「単体でマージする」を選ぶと、今回の <span style={{ fontFamily: "var(--font-mono)" }}>#{target.number}</span> だけをマージします。
        </p>
      </div>
    </DialogShell>
  );
}
