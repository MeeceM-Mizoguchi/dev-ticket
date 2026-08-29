// 前回の操作がまだ実行中のときに、開き直した画面へ進捗モーダルを出し直す（BRU13-045）。
//
// マージもPR作成も、GitHubの呼び出しからリリース反映まで全部サーバー側の1リクエストで
// 終わる。クライアントが切断されても実行は止まらないので、タブやブラウザを閉じても
// 処理そのものは最後まで走り切る。止まるのは画面の取り直しだけ。
//
// ただし「終わったか」を画面から知る手段が無かったため、閉じてしまうと
// GitHub を直接見に行くしかなかった。サーバーは実行の開始時に running の行を残すので
// （supabase/add_github_action_runs.sql）、ログイン直後にそれを引いて結果まで見届ける。
//
// 引くのはユーザーIDなので、別のPC・別のブラウザから開き直しても復帰する。
// 記録用の表がまだ適用されていない環境では、単に何も出さない（実行は従来どおり動く）。
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { navigateInActiveTab } from "@/app/contexts/TabContext";
import { escStack } from "@/app/lib/escStack";
import type { GithubRunProgress } from "@/app/types";

/** 実行中の行を見に行く間隔 */
const POLL_MS = 2000;

/**
 * これを過ぎても running のままなら、結果は確認できないものとして扱う。
 * サーバー関数の上限は60秒（vercel.json の maxDuration）なので、
 * それを超えて running が残っているのは関数が打ち切られた場合に限られる。
 */
const STALE_MS = 90_000;

interface RunRow {
  id: string;
  project_slug: string | null;
  kind: string;
  label: string | null;
  state: "running" | "done" | "error";
  message: string | null;
  result: { merged?: number; failed?: number; number?: number | null } | null;
  /** サーバー側の現在地（supabase/add_github_action_run_progress.sql） */
  progress: GithubRunProgress | null;
  started_at: string;
}

const BASE_COLUMNS = "id, project_slug, kind, label, state, message, result, started_at";
const COLUMNS = `${BASE_COLUMNS}, progress`;

/**
 * 途中経過の列がまだ適用されていない環境では、progress 込みの select がまるごと失敗する。
 * ここで復帰モーダルごと出なくなると元の機能まで巻き添えになるので、
 * 一度失敗したら以降は列を外して引く（途中経過が出ないだけになる）。
 */
let withProgress = true;
const columns = () => (withProgress ? COLUMNS : BASE_COLUMNS);

/**
 * 現在地の1行。
 * 「実行中です」だけだと、まだ確認の段なのか、もうマージ先に入り始めたのかが分からない。
 * ここが読めるかどうかで、待っていてよいのかの判断が変わる（BRU13-042）。
 */
function progressLine(p: GithubRunProgress | null): string | null {
  if (!p) return null;
  const count = p.total > 0 ? `（${p.done}／${p.total}件）` : "";
  if (p.step === "precheck") return `マージ可否を確認しています${count}`;
  if (p.step === "trial") {
    return p.trialSkipped
      ? "試しマージは不要でした。マージへ進みます"
      : `使い捨てのブランチへ順番どおりに積んでいます${count}`;
  }
  return `マージ先へ順にマージしています${count}`;
}

const KEYFRAMES = `
@keyframes gro-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes gro-pop { from { opacity: 0; transform: translateY(10px) scale(0.96) } to { opacity: 1; transform: none } }
@keyframes gro-slide {
  0%   { transform: translateX(-140%) scaleX(0.55); }
  50%  { transform: translateX(55%)  scaleX(1); }
  100% { transform: translateX(260%) scaleX(0.55); }
}
@keyframes gro-spin { to { transform: rotate(360deg); } }
`;

const KIND_LABELS: Record<string, string> = {
  "merge": "マージ",
  "merge-bulk": "まとめてマージ",
  "create-pull": "プルリクエストの作成",
};

function elapsedMs(startedAt: string) {
  const t = new Date(startedAt).getTime();
  return Number.isNaN(t) ? 0 : Date.now() - t;
}

export function GithubRunOverlay() {
  const { userId } = useAuth();
  const [run, setRun] = useState<RunRow | null>(null);
  /** 上限を過ぎても running のまま。結果を確認できなかった状態 */
  const [stale, setStale] = useState(false);
  /** 一度閉じたら同じセッションでは出し直さない */
  const closedRef = useRef<Set<string>>(new Set());

  const running = !!run && run.state === "running" && !stale;

  // ログインが済んだ時点で1回だけ探す。
  // このタブが今から始める実行はまだ記録されていないので、ここで拾うのは
  // 「前に閉じた（あるいは再読み込みした）ときに走っていたもの」だけになる
  useEffect(() => {
    if (!isSupabaseEnabled || !userId) return;
    let alive = true;
    (async () => {
      const find = () => supabase!
        .from("github_action_runs")
        .select(columns())
        .eq("actor_id", userId)
        .eq("state", "running")
        .gt("started_at", new Date(Date.now() - STALE_MS).toISOString())
        .order("started_at", { ascending: false })
        .limit(1);
      let { data, error } = await find();
      if (error && withProgress) { withProgress = false; ({ data } = await find()); }
      const row = (data?.[0] ?? null) as RunRow | null;
      if (!alive || !row || closedRef.current.has(row.id)) return;
      setStale(false);
      setRun(row);
    })();
    return () => { alive = false; };
  }, [userId]);

  const close = useCallback(() => {
    setRun(prev => { if (prev) closedRef.current.add(prev.id); return null; });
  }, []);

  // 実行中の間だけ引き直す。終わったら結果に切り替え、上限を過ぎたら諦める。
  // 行そのものではなく id と開始時刻を見る（毎回の取り直しでタイマーを張り直さないため）
  const runId = run?.id;
  const startedAt = run?.started_at;
  useEffect(() => {
    if (!running || !runId || !startedAt) return;
    const id = window.setInterval(async () => {
      if (elapsedMs(startedAt) > STALE_MS) { setStale(true); return; }
      const find = () => supabase!
        .from("github_action_runs").select(columns()).eq("id", runId).maybeSingle();
      let { data, error } = await find();
      if (error && withProgress) { withProgress = false; ({ data } = await find()); }
      if (data) setRun(data as RunRow);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [running, runId, startedAt]);

  // 実行中は ESC でも閉じられない。積んでおかないと裏の画面の閉じる処理に届いてしまう
  useEffect(() => {
    if (!runId) return;
    const handler = running ? () => {} : close;
    escStack.push(handler);
    return () => escStack.pop(handler);
  }, [runId, running, close]);

  const openGithub = useCallback(() => {
    if (!run?.project_slug) return;
    const path = `/${run.project_slug}/github`;
    close();
    // タブモード（ネイティブ）でも同じ場所へ行けるようにブリッジ経由で飛ぶ。
    // 画面はマウント時に取り直すので、着いた先は最新の一覧になる
    if (!navigateInActiveTab(path)) window.location.assign(path);
  }, [run, close]);

  if (!run) return null;

  const kindLabel = KIND_LABELS[run.kind] ?? "処理";
  const failed = stale || run.state === "error";
  const merged = run.result?.merged;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100001, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(26,23,20,0.34)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", animation: "gro-fade 0.18s ease-out" }}>
      <style>{KEYFRAMES}</style>
      <div style={{ width: 400, maxWidth: "88vw", background: "#FFFFFF", borderRadius: 20, padding: "26px 26px 22px", boxShadow: "0 24px 60px rgba(26,23,20,0.22), 0 2px 8px rgba(26,23,20,0.08)", border: "1px solid rgba(26,23,20,0.05)", animation: "gro-pop 0.24s cubic-bezier(0.16,1,0.3,1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: failed ? "linear-gradient(135deg, #B45309, #F59E0B)" : "linear-gradient(135deg, #059669, #34D399)" }}>
            {running
              ? <span style={{ width: 18, height: 18, borderRadius: "50%", border: "3px solid rgba(255,255,255,0.4)", borderTopColor: "#FFF", animation: "gro-spin 0.9s linear infinite" }} />
              : failed
                ? <AlertTriangle style={{ width: 21, height: 21, color: "#FFF" }} strokeWidth={2.2} />
                : <Check style={{ width: 22, height: 22, color: "#FFF" }} strokeWidth={3} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>
              {running ? `${kindLabel}を実行中です`
                : stale ? `${kindLabel}の結果を確認できませんでした`
                  : run.state === "error" ? `${kindLabel}は失敗しました`
                    : `${kindLabel}が完了しました`}
            </p>
            {run.label && (
              <p style={{ fontSize: 12, color: "#9E9690", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {run.label}
              </p>
            )}
          </div>
        </div>

        {running && (
          <div style={{ position: "relative", height: 8, borderRadius: 999, background: "#EEF0F1", overflow: "hidden", marginBottom: 12 }}>
            <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: "42%", borderRadius: 999, background: "linear-gradient(90deg, #059669, #34D399)", animation: "gro-slide 1.15s ease-in-out infinite", willChange: "transform" }} />
          </div>
        )}

        {/* 何をしている最中かは、待てるかどうかの判断に直結するので本文より先に出す。
            記録用の列が未適用の環境では出ないだけで、実行は従来どおり動く */}
        {running && progressLine(run.progress) && (
          <p style={{ fontSize: 12, fontWeight: 700, color: "#1A1714", lineHeight: 1.7, marginBottom: 8 }}>
            {progressLine(run.progress)}
          </p>
        )}

        <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.8 }}>
          {running ? (<>
            画面を閉じたあともサーバー側で処理が続いていました。
            結果が出るまでこの画面は閉じられません。そのままお待ちください。
          </>) : stale ? (<>
            処理を開始したところまでは記録されていますが、結果が残っていません。
            GitHub の画面で、実際にマージ・作成されたかどうかをご確認ください。
          </>) : run.state === "error" ? (
            run.message || "理由は記録されていません。GitHub の画面で状態をご確認ください。"
          ) : run.kind === "merge-bulk" && typeof merged === "number" ? (<>
            {merged}件をマージしました{run.result?.failed ? `／${run.result.failed}件は実行できませんでした` : ""}。
          </>) : (
            "処理は最後まで終わっています。画面をひらいて最新の状態をご確認ください。"
          )}
        </p>

        {!running && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={close}
              style={{ padding: "9px 18px", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "1px solid rgba(26,23,20,0.14)", background: "#FFF", color: "#4B4540", cursor: "pointer" }}>
              閉じる
            </button>
            {run.project_slug && (
              <button type="button" onClick={openGithub}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 18px", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", background: "#1F2328", color: "#FFF", cursor: "pointer" }}>
                GitHubの画面をひらく<ArrowRight style={{ width: 13, height: 13 }} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
