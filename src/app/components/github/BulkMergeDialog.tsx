// 複数のプルリクエストをまとめてマージする（docs/github-integration-design.md）。
//
// 1件ずつ順番に実行するため、途中で失敗しても残りは続行する。
// 結果は1件ごとに表示し、失敗した理由をその場で読めるようにする。
//
// 並び順は「PRを作った順（古い順）」を既定にする。一覧の並び（更新の新しい順）を
// そのまま使うと、前のブランチの上に積んで作ったPRが先に来てしまい、
// 先に入れた側に後続の変更まで含まれてしまう。順番は画面から入れ替えられる。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { MERGE_METHOD_LABELS, loadMergeMethod, saveMergeMethod, mergeBlockReason } from "@/app/lib/github";
import type { GithubPull, GithubMergeMethod, GithubBulkMergeResult } from "@/app/types";

const METHODS: GithubMergeMethod[] = ["merge", "squash", "rebase"];
const BLACK = "#1F2328";

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

export function BulkMergeDialog({ pulls, repo, actorName, onClose, onMerge, onDone }: {
  pulls: GithubPull[];
  repo: string;
  actorName: string;
  onClose: () => void;
  onMerge: (numbers: number[], method: GithubMergeMethod) => Promise<GithubBulkMergeResult>;
  /** 実行後に一覧を取り直すためのコールバック */
  onDone: () => void | Promise<void>;
}) {
  const [method, setMethod] = useState<GithubMergeMethod>(loadMergeMethod());
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<GithubBulkMergeResult | null>(null);
  const [error, setError] = useState("");
  /** マージ自体は終わったが、一覧の取り直しだけが失敗した状態 */
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [order, setOrder] = useState<GithubPull[]>(() => inCreatedOrder(pulls));

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
    setMerging(true);
    setError("");
    let r: GithubBulkMergeResult;
    try {
      r = await onMerge(order.map(p => p.number), method);
    } catch (e) {
      setError((e as Error)?.message ?? "マージに失敗しました。");
      setMerging(false);
      return;
    }
    saveMergeMethod(method);
    setResult(r);
    // 一覧の取り直しに失敗しても、実行済みの結果は必ず読ませる。
    // ここで例外を上の catch に流すと、結果の代わりにエラーだけが出てしまう
    try {
      await onDone();
    } catch {
      setRefreshFailed(true);
    }
    setMerging(false);
  };

  // 実行後は結果表示だけにする（同じ内容を二度実行させない）
  if (result) {
    return (
      <DialogShell title="まとめてマージの結果" size="lg" onClose={onClose}
        footer={<BtnSecondary onClick={onClose}>閉じる</BtnSecondary>}>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
          <p style={{ fontSize: 13, color: "#1A1714" }}>
            {result.merged > 0
              ? <><strong style={{ color: "#059669" }}>{result.merged}件</strong> をマージしました</>
              : <>マージできたものはありません</>}
            {result.failed > 0 && <>／<strong style={{ color: "#DC2626" }}>{result.failed}件</strong> は失敗しました</>}
          </p>
          <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, overflow: "hidden" }}>
            {result.results.map((r, i) => (
              <div key={r.number} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 13px", borderBottom: i < result.results.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none", background: r.ok ? "#FFF" : "#FEF2F2" }}>
                <span style={{ fontSize: 13, color: r.ok ? "#059669" : "#DC2626", flexShrink: 0 }}>{r.ok ? "✔" : "✕"}</span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 12, color: "#1A1714" }}>
                    <span style={{ fontFamily: "var(--font-mono)", color: "#8A837B" }}>#{r.number}</span> {r.title}
                  </p>
                  {r.error && <p style={{ fontSize: 11, color: "#B91C1C", marginTop: 2, lineHeight: 1.6 }}>{r.error}</p>}
                </div>
              </div>
            ))}
          </div>
          {/* 「前のマージの影響で後続が失敗した」の説明は、実際に1件でも通ったときだけ意味を持つ。
              1件も通っていないときに出すと、原因の見当違いな方へ誘導してしまう */}
          {result.failed > 0 && result.merged > 0 && (
            <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.7 }}>
              前のマージでマージ先が進むため、後続がコンフリクトになることがあります。
              失敗した分は一覧を更新してから、あらためてお試しください。
            </p>
          )}
          {result.failed > 0 && result.merged === 0 && (
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
    <DialogShell title={`${pulls.length}件をまとめてマージ`} size="lg" onClose={merging ? () => {} : onClose}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={merging}>キャンセル</BtnSecondary>
        <button type="button" onClick={handleRun} disabled={merging}
          style={{ padding: "9px 20px", background: merging ? "#9CA3AF" : BLACK, color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: merging ? "not-allowed" : "pointer" }}>
          {merging ? "マージ中..." : `${pulls.length}件をマージする`}
        </button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
        <p style={{ fontSize: 13, color: "#1A1714" }}>
          以下のプルリクエストを<strong>上から順番に</strong>マージします。
        </p>
        <p style={{ fontSize: 12, color: "#6B6458" }}>
          リポジトリ <strong style={{ fontFamily: "var(--font-mono)" }}>{repo}</strong>
        </p>

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
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 3, flexShrink: 0 }}>
                  <OrderButton label={`#${p.number} を1つ上へ`} disabled={merging || i === 0}
                    onClick={() => move(i, i - 1)}>
                    <ChevronUp style={{ width: 13, height: 13 }} />
                  </OrderButton>
                  <OrderButton label={`#${p.number} を1つ下へ`} disabled={merging || i === order.length - 1}
                    onClick={() => move(i, i + 1)}>
                    <ChevronDown style={{ width: 13, height: 13 }} />
                  </OrderButton>
                </div>
              </div>
            );
          })}
        </div>

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
            この操作は取り消せません。1件ずつ<strong>上から順番に</strong>実行し、途中で失敗しても残りは続行します。<br />
            前のマージでマージ先が進むため、<strong>順番を誤ると後続がコンフリクトになることがあります</strong>。<br />
            GitHub 上は Dev Ticket[bot] 名義で記録され、各マージコミットに「{actorName}」が実行者として残ります。
          </p>
        </div>

        {error && (
          <div style={{ padding: "11px 13px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 9 }}>
            <p style={{ fontSize: 12, color: "#B91C1C", lineHeight: 1.7, fontWeight: 600 }}>{error}</p>
          </div>
        )}
      </div>
    </DialogShell>
  );
}
