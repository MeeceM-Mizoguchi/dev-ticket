// 複数のプルリクエストをまとめてマージする（docs/github-integration-design.md）。
//
// 実行の前に必ず全件を確認し、1件でも引っかかったら1件もマージしない
// （BRU13-038 / BRU13-042）。途中まで入ってしまうと「マージ済みの分」と
// 「コンフリクトで残った分」が混ざり、直すときに取り漏れが出るため。
//
// 確認は2段階で、どちらもこの画面からは1回の操作に見える。
//   1. 1件ずつ単独のマージ可否（サーバーの merge-precheck）
//   2. 捨てブランチへ実際の順番どおりに積む試しマージ（サーバーの merge-bulk の中）
// GitHub のマージ可否は「今のマージ先に対して」しか計算されないため、1 だけでは
// 2件目以降が通るか分からない。押すのは1回のままで、2 の結果もここに出す。
//
// 全部通ったときだけ本番のマージへ進む。そこでなお失敗した場合（マージ先が
// 第三者に動かされた等）は、その時点で打ち切って残りは実行しない。
//
// 結果は1件ごとに表示し、失敗した理由をその場で読めるようにする。
//
// 並び順は「PRを作った順（古い順）」を既定にする。一覧の並び（更新の新しい順）を
// そのまま使うと、前のブランチの上に積んで作ったPRが先に来てしまい、
// 先に入れた側に後続の変更まで含まれてしまう。順番は画面から入れ替えられる。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { StepProgressPanel, type ProgressStep, type StepState } from "@/app/components/shared/StepProgress";
import {
  MERGE_METHOD_LABELS, loadMergeMethod, saveMergeMethod, mergeBlockReason, GithubApiError,
  newRunId, fetchRunProgress,
} from "@/app/lib/github";
import { PermissionBlockNotice } from "@/app/components/github/PermissionBlockNotice";
import { MergePrecheckNotice } from "@/app/components/github/MergePrecheckNotice";
import { CheckGateNotice, REASON_MIN } from "@/app/components/github/CheckGateNotice";
import type {
  GithubPull, GithubMergeMethod, GithubBulkMergeResult, GithubPermissionBlock, GithubMergePrecheckResult,
  GithubMergePrecheckRow, GithubRunProgress,
} from "@/app/types";

const METHODS: GithubMergeMethod[] = ["merge", "squash", "rebase"];
const BLACK = "#1F2328";

/**
 * サーバーが通しで走らせる段。この並びがそのまま進捗の行の順番になる。
 * 画面はサーバーが書いた「今どこか」を引いて、手前を完了・その先を待機として出す。
 */
const RUN_STEPS = ["precheck", "trial", "merge"] as const;

/** 途中経過を引き直す間隔。1件ごとに書かれるので、これくらいで十分追える */
const PROGRESS_POLL_MS = 1500;

/** 並べ替えの上下ボタン。押せないときは押せないと分かる見た目にする */
function OrderButton({ label, disabled, onClick, children }: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 20, borderRadius: 6, border: "1px solid rgba(26,23,20,0.12)", background: "#FFF", color: disabled ? "#D6D1CC" : "#1A1714", cursor: disabled ? "default" : "pointer", padding: 0 }}>
      {children}
    </button>
  );
}

/**
 * 作られた順（古い順）に並べ替える。
 * 作成日時が同じ場合はPR番号の小さい方を先にする（番号は必ず作成順に振られるため）。
 */
function inCreatedOrder(list: GithubPull[]): GithubPull[] {
  return [...list].sort((a, b) => {
    // ISO8601 は文字列比較で時系列順になる
    const d = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    return d !== 0 ? d : a.number - b.number;
  });
}

export function BulkMergeDialog({ pulls, repo, actorName, onClose, onPrecheck, onMerge, onDone }: {
  pulls: GithubPull[];
  repo: string;
  actorName: string;
  onClose: () => void;
  /** マージ前のコンフリクトチェック。1件でも通らなければマージには進まない */
  onPrecheck: (numbers: number[]) => Promise<GithubMergePrecheckResult>;
  /**
   * reason は「失敗チェックのまま続ける理由」（層A）。監査ログに残る。
   * runId は実行の記録の主キー。実行中の途中経過をこの画面から引くために先に作って渡す
   */
  onMerge: (numbers: number[], method: GithubMergeMethod, reason: string, runId: string) => Promise<GithubBulkMergeResult>;
  /** 実行後に一覧を取り直すためのコールバック */
  onDone: () => void | Promise<void>;
}) {
  const [method, setMethod] = useState<GithubMergeMethod>(loadMergeMethod());
  /** idle … 確認中／checking … コンフリクト確認中／merging … 実行中／refreshing … 一覧を取り直している最中 */
  const [phase, setPhase] = useState<"idle" | "checking" | "merging" | "refreshing">("idle");
  const merging = phase !== "idle";
  const [result, setResult] = useState<GithubBulkMergeResult | null>(null);
  const [error, setError] = useState("");
  /**
   * App の権限で止められた状態。実行前に弾かれた場合も、実行中に分かった場合もここへ入れる。
   * 「失敗しました」で終わらせず、直しに行く画面まで出すために持つ。
   */
  const [blocked, setBlocked] = useState<GithubPermissionBlock | null>(null);
  /**
   * コンフリクトチェックで止めた結果。入っているときは1件もマージしていない。
   * 直したあとに同じ画面から押し直せるよう、結果画面には切り替えずここに出す
   */
  const [precheck, setPrecheck] = useState<GithubMergePrecheckResult | null>(null);
  /** マージ自体は終わったが、一覧の取り直しだけが失敗した状態 */
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [order, setOrder] = useState<GithubPull[]>(() => inCreatedOrder(pulls));
  /** 失敗チェックのまま続ける理由（層A）。サーバーが要求したときだけ必須になる */
  const [reason, setReason] = useState("");
  const [needsReason, setNeedsReason] = useState(false);
  /**
   * サーバー側の現在地。実行は1リクエストで通しで走るので、応答を待つ間は
   * これを引いて「今どこか」を出す（取れない環境では null のまま大まかな表示に落ちる）
   */
  const [progress, setProgress] = useState<GithubRunProgress | null>(null);
  /**
   * 試しマージの段だけは通り過ぎたあとも中身を出したいので控えておく。
   * 省かれた場合（変更ファイルが重ならない）に「不要でした」と言えるようにするため
   */
  const [trialInfo, setTrialInfo] = useState<GithubRunProgress | null>(null);
  const runIdRef = useRef("");

  // 実行中だけ引き直す。終わった時点で止める（結果は応答そのものから作る）
  useEffect(() => {
    if (phase !== "merging" || !runIdRef.current) return;
    const id = runIdRef.current;
    const timer = window.setInterval(async () => {
      const p = await fetchRunProgress(id).catch(() => null);
      if (!p) return;
      setProgress(p);
      if (p.step === "trial") setTrialInfo(p);
    }, PROGRESS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [phase]);

  /**
   * 押す前に出す警告の材料。
   * サーバーの事前チェックを待たず、一覧で既に分かっている CI の状態から組み立てる。
   * 選んだ時点で「これは本番に届かないかもしれない」と分かるようにするため。
   */
  const gateRows: GithubMergePrecheckRow[] = useMemo(() => {
    const fromServer = precheck?.results.filter(r => r.checkGate) ?? [];
    if (fromServer.length) return fromServer;
    return order
      .filter(p => p.checkState === "failure")
      .map(p => {
        const failed = (p.checks ?? []).filter(c => c.state === "failure")
          .map(c => (c.description ? `${c.name}（${c.description}）` : c.name));
        return {
          number: p.number, title: p.title, ok: true, conflict: false,
          checkGate: {
            level: "warn" as const,
            summary: p.checkSummary,
            failed: failed.length ? failed : [p.checkSummary].filter(Boolean),
            blockedDeploy: !!p.checkBlocked,
          },
          checkUnavailable: p.checkUnavailable,
        };
      });
  }, [precheck, order]);

  const hardBlocked = gateRows.some(r => r.checkGate?.level === "block");
  const reasonMissing = needsReason && reason.trim().length < REASON_MIN;

  // 選択が変わったら並びも作り直す。並べ替えの途中で作り直さないよう、
  // 見るのは「どのPRが選ばれているか」だけにする
  const selectionKey = useMemo(
    () => pulls.map(p => p.number).sort((a, b) => a - b).join(","),
    [pulls],
  );
  useEffect(() => {
    setOrder(inCreatedOrder(pulls));
    // pulls そのものを見ると、一覧の再取得のたびに並べ替えが巻き戻る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  const isCreatedOrder = useMemo(
    () => order.map(p => p.number).join(",") === inCreatedOrder(pulls).map(p => p.number).join(","),
    [order, pulls],
  );

  const move = (from: number, to: number) => {
    if (merging || to < 0 || to >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
  };

  const handleRun = async () => {
    const numbers = order.map(p => p.number);
    setError("");
    setBlocked(null);
    setPrecheck(null);
    setProgress(null);
    setTrialInfo(null);
    // 実行IDは先に作る。サーバーがこのIDで途中経過を書くので、待っている間に引ける
    runIdRef.current = newRunId();

    // マージの前に必ず全件を確認する。1件でも通らなければ1件もマージしない（BRU13-038）
    setPhase("checking");
    try {
      const checked = await onPrecheck(numbers);
      // 失敗チェックがあり、理由がまだ書かれていない（層A）。
      // 全件チェックと同じで、ここで止めた時点では1件もマージしていない
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
      if (e instanceof GithubApiError && e.permission) setBlocked(e.permission);
      setError((e as Error)?.message ?? "コンフリクトの確認に失敗しました。");
      setPhase("idle");
      return;
    }

    setPhase("merging");
    let r: GithubBulkMergeResult;
    try {
      r = await onMerge(numbers, method, reason.trim(), runIdRef.current);
    } catch (e) {
      // 実行前に権限で弾かれた場合。1件もマージされていないので、直し先だけを出す
      if (e instanceof GithubApiError && e.permission) setBlocked(e.permission);
      // 確認してから押すまでの間に状態が変わり、サーバー側のチェックで止まった場合。
      // どのPRで止まったかまで返っているので、そのまま出す（1件もマージされていない）
      if (e instanceof GithubApiError && e.precheck?.results?.length) {
        setPrecheck(e.precheck);
        setNeedsReason(!!e.precheck.needsReason);
      }
      setError((e as Error)?.message ?? "マージに失敗しました。");
      setPhase("idle");
      return;
    }
    saveMergeMethod(method);
    // 一覧の取り直しに失敗しても、実行済みの結果は必ず読ませる。
    // ここで例外を上の catch に流すと、結果の代わりにエラーだけが出てしまう。
    // 結果に切り替えるのは取り直しが終わってから。先に切り替えると、
    // 進捗の2段目（一覧の更新）を出す前に画面が変わってしまう
    setPhase("refreshing");
    try {
      await onDone();
    } catch {
      setRefreshFailed(true);
    }
    setBlocked(r.permission ?? null);
    setResult(r);
    setPhase("idle");
  };

  // 実行はサーバー側の1リクエストで通しで走る。「マージ中」の一言で数十秒待たせると、
  // 待つべきなのか壊れているのかが判断できないので、サーバーが書いた現在地を出す
  // （記録が引けない環境では最初の段を実行中にしたまま進むだけで、実行には影響しない）。
  const at = progress?.step ?? "precheck";
  const stepState = (key: typeof RUN_STEPS[number]): StepState => {
    if (phase === "checking") return key === "precheck" ? "running" : "pending";
    if (phase !== "merging") return "done";
    const d = RUN_STEPS.indexOf(key) - RUN_STEPS.indexOf(at);
    if (d < 0) return "done";
    if (d > 0) return "pending";
    // 試しマージが要らなかった場合は、走っていないことが分かる状態で出す
    return key === "trial" && progress?.trialSkipped ? "none" : "running";
  };

  const sPrecheck = stepState("precheck");
  // 通り過ぎたあとも「省かれた」ことは残す。完了扱いで黙って流すと、
  // 試したのか試していないのかが後から分からない
  const sTrial = trialInfo?.trialSkipped && stepState("trial") !== "pending" ? "none" : stepState("trial");
  const sMerge = stepState("merge");
  /** 実際に捨てブランチへ積んだ件数。省かれた場合は 0 */
  const stacked = trialInfo?.total ?? 0;

  const steps: ProgressStep[] = [
    {
      key: "precheck",
      state: sPrecheck,
      text: sPrecheck === "running"
        ? `${order.length}件のマージ可否を確認しています...`
        : `${order.length}件のマージ可否を確認しました`,
      hint: sPrecheck === "running" ? "1件でもマージできなければ、1件もマージしません" : undefined,
    },
    {
      key: "trial",
      state: sTrial,
      text: sTrial === "pending"
        ? "試しマージの開始を待っています"
        : sTrial === "none"
          ? "試しマージは不要でした（変更ファイルが重なっていません）"
          : sTrial === "running"
            ? `使い捨てのブランチへ、この順番どおりに積んでいます...（${progress?.done ?? 0}／${progress?.total ?? order.length}件）`
            : `${stacked}件を使い捨てのブランチへ積んで、全件通ることを確認しました`,
      hint: sTrial === "running"
        ? "マージ先にはまだ触れていません。1件でも通らなければ、ここで中止して1件もマージしません"
        : undefined,
    },
    {
      key: "merge",
      state: sMerge,
      text: sMerge === "pending"
        ? "マージの開始を待っています"
        : sMerge === "running"
          ? `上から順にマージしています...（${progress?.done ?? 0}／${progress?.total ?? order.length}件）`
          : `${order.length}件のマージを実行しました`,
      hint: sMerge === "running" ? "全件が通ることは確認済みです" : undefined,
    },
    {
      key: "refresh",
      state: phase === "refreshing" ? "running" : "pending",
      text: phase === "refreshing" ? "一覧を最新の状態にしています..." : "一覧の更新を待っています",
    },
  ];

  // 実行後は結果表示だけにする（同じ内容を二度実行させない）
  if (result) {
    const skippedCount = result.results.filter(r => r.skipped).length;
    const failedCount = result.failed - skippedCount;
    return (
      <DialogShell title="まとめてマージの結果" size="lg" onClose={onClose}
        footer={<BtnSecondary onClick={onClose}>閉じる</BtnSecondary>}>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
          <p style={{ fontSize: 13, color: "#1A1714" }}>
            {result.merged > 0
              ? <><strong style={{ color: "#059669" }}>{result.merged}件</strong> をマージしました</>
              : <>マージできたものはありません</>}
            {/* 失敗と未実行は分けて数える。まとめると「何件直せばいいのか」が読めない */}
            {failedCount > 0 && <>／<strong style={{ color: "#DC2626" }}>{failedCount}件</strong> は失敗しました</>}
            {skippedCount > 0 && <>／<strong style={{ color: "#6B6458" }}>{skippedCount}件</strong> は未実行です</>}
          </p>
          {/* 原因が App の権限なら、直しに行く画面をここで出し切る。
              「管理者に依頼してください」で終わると、依頼先の画面が分からず何度も同じ失敗を繰り返す */}
          {blocked && <PermissionBlockNotice block={blocked} compact />}
          <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, overflow: "hidden" }}>
            {result.results.map((r, i) => (
              // 未実行（打ち切りで飛ばした分）は失敗と同じ赤にしない。
              // 「このPRに問題があった」と読まれると、直す相手を間違える
              <div key={r.number} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 13px", borderBottom: i < result.results.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none", background: r.ok ? "#FFF" : r.skipped ? "#F9F8F6" : "#FEF2F2" }}>
                <span style={{ fontSize: 13, color: r.ok ? "#059669" : r.skipped ? "#A09790" : "#DC2626", flexShrink: 0 }}>
                  {r.ok ? "✔" : r.skipped ? "—" : "✕"}
                </span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 12, color: "#1A1714" }}>
                    <span style={{ fontFamily: "var(--font-mono)", color: "#8A837B" }}>#{r.number}</span> {r.title}
                  </p>
                  {r.error && <p style={{ fontSize: 11, color: r.skipped ? "#A09790" : "#B91C1C", marginTop: 2, lineHeight: 1.6 }}>{r.error}</p>}
                </div>
              </div>
            ))}
          </div>
          {/* 「前のマージの影響で後続が失敗した」の説明は、実際に1件でも通ったときだけ意味を持つ。
              1件も通っていないときに出すと、原因の見当違いな方へ誘導してしまう */}
          {result.failed > 0 && result.merged > 0 && (
            <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.7 }}>
              前のマージでマージ先が進むため、後続がコンフリクトになることがあります。
              {result.aborted && <>失敗した時点で<strong>残りは実行していません</strong>。</>}
              一覧を更新してから、残りをあらためてお試しください。
            </p>
          )}
          {/* 打ち切りで未実行になった分があるときは出さない。
              「全件が同じ理由で落ちた」ときの案内で、1件失敗して残りを止めた場合とは別の話 */}
          {failedCount > 0 && result.merged === 0 && skippedCount === 0 && !blocked && (
            <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.7 }}>
              1件も通っていないため、PRごとの事情ではなく設定側が原因の可能性があります。
              上の理由が全件で同じ場合は、管理者に「外部連携」画面の確認を依頼してください。
            </p>
          )}
          {refreshFailed && (
            <p style={{ fontSize: 11, color: "#B45309", lineHeight: 1.7 }}>
              マージの実行は終わっていますが、一覧の取り直しに失敗しました。
              閉じたあと「更新」を押して最新の状態にしてください。
            </p>
          )}
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title={`${pulls.length}件をまとめてマージ`} size="lg" minHeight={merging ? 0 : undefined} onClose={onClose} busy={merging}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={merging}>キャンセル</BtnSecondary>
        {/* 権限で弾かれたあとは押させない。押しても同じ理由で必ず失敗するため */}
        <button type="button" onClick={handleRun} disabled={merging || !!blocked || hardBlocked || reasonMissing}
          title={hardBlocked ? "失敗しているチェックがあるためマージできません" : reasonMissing ? "続ける理由を入力してください" : undefined}
          style={{ padding: "9px 20px", background: (merging || blocked || hardBlocked || reasonMissing) ? "#9CA3AF" : BLACK, color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: (merging || blocked || hardBlocked || reasonMissing) ? "not-allowed" : "pointer" }}>
          {phase === "checking" ? "コンフリクト確認中..."
            : phase === "merging" ? "マージ中..."
              : phase === "refreshing" ? "一覧を更新中..."
                : needsReason ? "理由を添えてマージする"
                  // 一度止めたあとは「もう一度確認してから」だと分かる文言にする
                  : precheck ? "もう一度確認してマージする"
                    : `${pulls.length}件をマージする`}
        </button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
        <p style={{ fontSize: 13, color: "#1A1714" }}>
          以下のプルリクエストを<strong>上から順番に</strong>マージします。
        </p>
        <p style={{ fontSize: 12, color: "#6B6458" }}>
          リポジトリ <strong style={{ fontFamily: "var(--font-mono)" }}>{repo}</strong>
        </p>

        {/* 実行が始まったら並べ替えも方式も変えられない。案内は進捗に差し替える */}
        {merging ? (
          <StepProgressPanel steps={steps} note={`方式: ${MERGE_METHOD_LABELS[method]}／終わるまでこの画面は閉じないでください。`} />
        ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" as const }}>
          <p style={{ fontSize: 11, color: "#6B6458", lineHeight: 1.7 }}>
            <strong>プルリクエストを作った順</strong>に並べています。
            前のブランチの上に積んで作ったものは、先に作った方から入れてください。
            <br />
            右の <ChevronUp style={{ width: 10, height: 10, display: "inline", verticalAlign: "middle" }} />
            <ChevronDown style={{ width: 10, height: 10, display: "inline", verticalAlign: "middle" }} /> で順番を入れ替えられます。
          </p>
          {!isCreatedOrder && (
            <button type="button" onClick={() => setOrder(inCreatedOrder(pulls))} disabled={merging}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 11, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#FFF", color: "#1A1714", cursor: merging ? "default" : "pointer", whiteSpace: "nowrap" as const }}>
              <RotateCcw style={{ width: 11, height: 11 }} />作成順に戻す
            </button>
          )}
        </div>
        )}

        <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, overflow: "hidden" }}>
          {order.map((p, i) => {
            const blocked = mergeBlockReason(p);
            return (
              <div key={p.number} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 13px", borderBottom: i < order.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none" }}>
                <span style={{ fontSize: 11, color: "#B0A9A4", flexShrink: 0, width: 16 }}>{i + 1}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontSize: 12, color: "#1A1714" }}>
                    <span style={{ fontFamily: "var(--font-mono)", color: "#8A837B" }}>#{p.number}</span> {p.title}
                  </p>
                  <p style={{ fontSize: 11, color: "#A09790", marginTop: 2 }}>
                    {p.base} ← {p.head}
                    {p.checkSummary && ` ・ ${p.checkSummary}`}
                    {p.reviewSummary && ` ・ レビュー ${p.reviewSummary}`}
                  </p>
                  {blocked && <p style={{ fontSize: 11, color: "#D97706", marginTop: 2 }}>{blocked}</p>}
                </div>
                {/* 実行が始まったら順番はもう変えられないので、ボタンごと消す。
                    押せないまま残しておくと「まだ入れ替えられる画面」に見えてしまう（BRU13-054） */}
                {!merging && (
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 3, flexShrink: 0 }}>
                    <OrderButton label={`#${p.number} を1つ上へ`} disabled={i === 0}
                      onClick={() => move(i, i - 1)}>
                      <ChevronUp style={{ width: 13, height: 13 }} />
                    </OrderButton>
                    <OrderButton label={`#${p.number} を1つ下へ`} disabled={i === order.length - 1}
                      onClick={() => move(i, i + 1)}>
                      <ChevronDown style={{ width: 13, height: 13 }} />
                    </OrderButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!merging && (<>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 8, letterSpacing: "0.04em" }}>マージ方式（全件に適用）</p>
          {METHODS.map(m => (
            <label key={m} onClick={() => !merging && setMethod(m)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9, cursor: merging ? "default" : "pointer", marginBottom: 5, background: method === m ? "rgba(31,35,40,0.05)" : "#F9F8F6", border: `1.5px solid ${method === m ? "rgba(31,35,40,0.25)" : "transparent"}` }}>
              <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${method === m ? BLACK : "rgba(26,23,20,0.20)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {method === m && <div style={{ width: 7, height: 7, borderRadius: "50%", background: BLACK }} />}
              </div>
              <span style={{ fontSize: 13, fontWeight: method === m ? 700 : 500, color: "#1A1714" }}>{MERGE_METHOD_LABELS[m]}</span>
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: 9, padding: "11px 13px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 9 }}>
          <AlertTriangle style={{ width: 14, height: 14, color: "#DC2626", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 11, color: "#B91C1C", lineHeight: 1.7 }}>
            この操作は取り消せません。実行前に、<strong>使い捨てのブランチへこの順番どおりに全件を積んで確認</strong>します。
            1件でも通らなければ<strong>マージ先には一切触れません</strong>（1件もマージされません）。<br />
            全件通ったときだけ、上から順番に本番のマージを実行します。そこでなお失敗した場合は<strong>残りは実行しません</strong>。<br />
            前のマージでマージ先が進むため、<strong>順番によって通る／通らないが変わります</strong>。<br />
            GitHub 上は Dev Ticket[bot] 名義で記録され、各マージコミットに「{actorName}」が実行者として残ります。
          </p>
        </div>
        </>)}

        {/* 層A: 失敗しているチェックのままマージしようとしている。
            選んだ時点で分かるよう、押す前から出す */}
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

        {/* コンフリクトで止めたときは、権限の案内より先にこちらを出す
            （実際に押して止まった理由はこちらのため） */}
        {precheck && <MergePrecheckNotice precheck={precheck} repo={repo} />}

        {blocked
          ? <PermissionBlockNotice block={blocked} compact />
          : error && (
            <div style={{ padding: "11px 13px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 9 }}>
              <p style={{ fontSize: 12, color: "#B91C1C", lineHeight: 1.7, fontWeight: 600 }}>{error}</p>
            </div>
          )}
      </div>
    </DialogShell>
  );
}
