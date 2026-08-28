// PRマージの確認（docs/github-integration-design.md 8-4）。
//
// マージは取り消しが難しいので、マージ先・CI・レビュー状況を全部出してから確認させる。
// 実行の前には必ずコンフリクトチェックを挟む（BRU13-038）。まとめてマージと同じ手順に
// 揃えてあり、引っかかったらマージそのものを行わない。
// 失敗してもダイアログは閉じない（原因を読ませるため）。
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { StepProgressPanel, type ProgressStep } from "@/app/components/shared/StepProgress";
import { MERGE_METHOD_LABELS, loadMergeMethod, saveMergeMethod, GithubApiError } from "@/app/lib/github";
import { MergePrecheckNotice } from "@/app/components/github/MergePrecheckNotice";
import { CheckGateNotice, REASON_MIN } from "@/app/components/github/CheckGateNotice";
import type {
  GithubPull, GithubMergeMethod, GithubMergePrecheckResult, GithubMergePrecheckRow,
} from "@/app/types";

const METHODS: GithubMergeMethod[] = ["merge", "squash", "rebase"];

/**
 * 押す前に出す警告の材料。
 *
 * サーバーの事前チェックを待たずに、一覧・詳細で既に分かっている CI の状態から組み立てる。
 * 押してから初めて理由が出る状態にしないため（BRU13-038 と同じ方針）。
 */
function warningFromPull(pull: GithubPull): GithubMergePrecheckRow[] {
  if (pull.checkState !== "failure") return [];
  const failed = (pull.checks ?? []).filter(c => c.state === "failure")
    .map(c => (c.description ? `${c.name}（${c.description}）` : c.name));
  return [{
    number: pull.number,
    title: pull.title,
    ok: true,
    conflict: false,
    checkGate: {
      level: "warn",
      summary: pull.checkSummary,
      // 詳細を開いていない場合は個別のチェック名が無いので、要約だけを出す
      failed: failed.length ? failed : [pull.checkSummary].filter(Boolean),
      blockedDeploy: !!pull.checkBlocked,
    },
    checkUnavailable: pull.checkUnavailable,
  }];
}

export function MergeConfirmDialog({ pull, repo, actorName, onClose, onPrecheck, onMerge }: {
  pull: GithubPull;
  repo: string;
  actorName: string;
  onClose: () => void;
  /** マージ前のコンフリクトチェック。通らなければマージには進まない */
  onPrecheck: (number: number) => Promise<GithubMergePrecheckResult>;
  /**
   * マージの実行。GitHub へのマージが終わった時点で onMerged を呼ぶと、
   * 進捗の2段目が完了して「画面の更新」へ進む。呼ばなくても動く（最後まで2段目のまま）。
   * reason は「失敗チェックのまま続ける理由」（層A）。
   */
  onMerge: (method: GithubMergeMethod, onMerged: () => void, reason: string) => Promise<void>;
}) {
  const [method, setMethod] = useState<GithubMergeMethod>(loadMergeMethod());
  /** idle … 確認中／checking … コンフリクト確認中／merging … GitHubへ依頼中／refreshing … 呼び出し元が画面を取り直している最中 */
  const [phase, setPhase] = useState<"idle" | "checking" | "merging" | "refreshing">("idle");
  const [error, setError] = useState("");
  /** コンフリクトチェックで止めた結果。入っているときはマージしていない */
  const [precheck, setPrecheck] = useState<GithubMergePrecheckResult | null>(null);
  /** 失敗チェックのまま続ける理由（層A）。サーバーが要求したときだけ必須になる */
  const [reason, setReason] = useState("");
  const [needsReason, setNeedsReason] = useState(false);
  const merging = phase !== "idle";

  // サーバーが返した結果があればそれを、まだ押していなければ手元の CI 状態を使う
  const gateRows = precheck?.results.filter(r => r.checkGate) ?? warningFromPull(pull);
  const hardBlocked = gateRows.some(r => r.checkGate?.level === "block");
  const reasonMissing = needsReason && reason.trim().length < REASON_MIN;

  const handleMerge = async () => {
    setError("");
    setPrecheck(null);

    // 押してから初めてコンフリクトに気付く状態にしない（BRU13-038）
    setPhase("checking");
    try {
      const checked = await onPrecheck(pull.number);
      // 失敗チェックがあり、理由がまだ書かれていない（層A）。
      // ここで止めて入力欄を出す。マージはしていない
      if (checked.needsReason && reason.trim().length < REASON_MIN) {
        setPrecheck(checked);
        setNeedsReason(true);
        setPhase("idle");
        return;
      }
      if (!checked.ok) {
        setPrecheck(checked);
        setNeedsReason(!!checked.needsReason);
        setPhase("idle");
        return;
      }
    } catch (e) {
      setError((e as Error)?.message ?? "コンフリクトの確認に失敗しました。");
      setPhase("idle");
      return;
    }

    setPhase("merging");
    try {
      await onMerge(method, () => setPhase("refreshing"), reason.trim());
      saveMergeMethod(method);
      onClose();
    } catch (e) {
      // 閉じずに理由を見せる。
      // 確認してから押すまでの間に状態が変わり、サーバー側のチェックで止まった場合は
      // 理由まで返っているので、そのまま出す（マージはされていない）
      if (e instanceof GithubApiError && e.precheck?.results?.length) {
        setPrecheck(e.precheck);
        setNeedsReason(!!e.precheck.needsReason);
      }
      setError((e as Error)?.message ?? "マージに失敗しました。");
      setPhase("idle");
    }
  };

  // コンフリクトの確認・マージそのもの・そのあとの画面の取り直しを分けて出す。
  // 「マージ中...」だけだと、GitHub 側が終わっているのかどうかが分からない
  const steps: ProgressStep[] = [
    {
      key: "precheck",
      state: phase === "checking" ? "running" : "done",
      text: phase === "checking" ? `#${pull.number} のコンフリクトを確認しています...` : `#${pull.number} のコンフリクトを確認しました`,
      hint: phase === "checking" ? "コンフリクトしている場合はマージしません" : undefined,
    },
    {
      key: "merge",
      state: phase === "checking" ? "pending" : phase === "merging" ? "running" : "done",
      text: phase === "checking"
        ? "マージの開始を待っています"
        : phase === "merging" ? `#${pull.number} を ${pull.base} にマージしています...` : `#${pull.number} をマージしました`,
    },
    {
      key: "refresh",
      state: phase === "refreshing" ? "running" : "pending",
      text: phase === "refreshing" ? "画面を最新の状態にしています..." : "画面の更新を待っています",
    },
  ];

  return (
    <DialogShell title="マージの確認" minHeight={merging ? 0 : undefined} onClose={onClose} busy={merging}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={merging}>キャンセル</BtnSecondary>
        <button type="button" onClick={handleMerge} disabled={merging || hardBlocked || reasonMissing}
          title={hardBlocked ? "失敗しているチェックがあるためマージできません" : reasonMissing ? "続ける理由を入力してください" : undefined}
          style={{ padding: "9px 20px", background: (merging || hardBlocked || reasonMissing) ? "#9CA3AF" : "#1F2328", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: (merging || hardBlocked || reasonMissing) ? "not-allowed" : "pointer" }}>
          {phase === "checking" ? "コンフリクト確認中..."
            : phase === "merging" ? "マージ中..."
              : phase === "refreshing" ? "画面を更新中..."
                : needsReason ? "理由を添えてマージする"
                  : precheck ? "もう一度確認してマージする"
                    : "マージする"}
        </button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
        <p style={{ fontSize: 13, color: "#1A1714" }}>
          {merging ? "マージを実行しています。" : "以下のプルリクエストをマージします。"}
        </p>

        <div style={{ background: "#F9FAFB", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column" as const, gap: 7 }}>
          <Row label="リポジトリ" value={repo} />
          <Row label="プルリク" value={`#${pull.number}  ${pull.title}`} />
          <Row label="マージ先" value={`${pull.base}  ←  ${pull.head}`} />
          <Row label="CI" value={pull.checkSummary || "—"} tone={pull.checkState === "failure" ? "bad" : pull.checkState === "success" ? "good" : "normal"} />
          {/* 確認できていない情報源があるなら、CI行の直下で言い添える。
              「チェックなし」を「問題なし」と読ませないため（BRU13-041） */}
          {(pull.checkUnavailable?.length ?? 0) > 0 && (
            <p style={{ fontSize: 11, color: "#B45309", paddingLeft: 88, lineHeight: 1.6 }}>
              {pull.checkUnavailable!.join("・")} は権限が無いため確認できていません。
            </p>
          )}
          <Row label="レビュー" value={pull.reviewSummary || "—"} tone={pull.reviewState === "approved" ? "good" : pull.reviewState === "changes_requested" ? "bad" : "normal"} />
        </div>

        {/* 実行が始まったら方式は変えられないので、選択肢と警告は進捗に差し替える */}
        {merging ? (
          <StepProgressPanel steps={steps} note={`方式: ${MERGE_METHOD_LABELS[method]}／終わるまでこの画面は閉じないでください。`} />
        ) : (<>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 8, letterSpacing: "0.04em" }}>マージ方式</p>
          {METHODS.map(m => (
            <label key={m}
              onClick={() => !merging && setMethod(m)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9, cursor: merging ? "default" : "pointer", marginBottom: 5, background: method === m ? "rgba(31,35,40,0.05)" : "#F9F8F6", border: `1.5px solid ${method === m ? "rgba(31,35,40,0.25)" : "transparent"}` }}>
              <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${method === m ? "#1F2328" : "rgba(26,23,20,0.20)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {method === m && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#1F2328" }} />}
              </div>
              <span style={{ fontSize: 13, fontWeight: method === m ? 700 : 500, color: "#1A1714" }}>{MERGE_METHOD_LABELS[m]}</span>
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: 9, padding: "11px 13px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 9 }}>
          <AlertTriangle style={{ width: 14, height: 14, color: "#DC2626", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 11, color: "#B91C1C", lineHeight: 1.7 }}>
            この操作は取り消せません。実行前にコンフリクトを確認し、
            引っかかっていれば<strong>マージしません</strong>。<br />
            GitHub 上は Dev Ticket[bot] 名義で記録され、マージコミットに「{actorName}」が実行者として残ります。
          </p>
        </div>
        </>)}

        {/* 層A: 失敗しているチェックのままマージしようとしている。
            押す前から出す（precheck が無いうちは手元の CI 状態から組み立てる） */}
        {gateRows.length > 0 && (
          <CheckGateNotice
            rows={gateRows}
            repo={repo}
            needsReason={needsReason}
            reason={reason}
            onReasonChange={setReason}
            disabled={merging}
          />
        )}

        {precheck && <MergePrecheckNotice precheck={precheck} repo={repo} single />}

        {error && (
          <div style={{ padding: "11px 13px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 9 }}>
            <p style={{ fontSize: 12, color: "#B91C1C", lineHeight: 1.7, fontWeight: 600 }}>{error}</p>
          </div>
        )}
      </div>
    </DialogShell>
  );
}

function Row({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "good" | "bad" }) {
  const color = tone === "good" ? "#059669" : tone === "bad" ? "#DC2626" : "#1A1714";
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
      <span style={{ width: 76, flexShrink: 0, color: "#8A837B", fontWeight: 600 }}>{label}</span>
      <span style={{ color, wordBreak: "break-word" as const }}>{value}</span>
    </div>
  );
}
