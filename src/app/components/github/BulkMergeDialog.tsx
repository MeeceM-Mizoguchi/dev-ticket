// 複数のプルリクエストをまとめてマージする（docs/github-integration-design.md）。
//
// 1件ずつ順番に実行するため、途中で失敗しても残りは続行する。
// 結果は1件ごとに表示し、失敗した理由をその場で読めるようにする。
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { MERGE_METHOD_LABELS, loadMergeMethod, saveMergeMethod, mergeBlockReason } from "@/app/lib/github";
import type { GithubPull, GithubMergeMethod, GithubBulkMergeResult } from "@/app/types";

const METHODS: GithubMergeMethod[] = ["merge", "squash", "rebase"];
const BLACK = "#1F2328";

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

  const handleRun = async () => {
    setMerging(true);
    setError("");
    try {
      const r = await onMerge(pulls.map(p => p.number), method);
      saveMergeMethod(method);
      setResult(r);
      await onDone();
    } catch (e) {
      setError((e as Error)?.message ?? "マージに失敗しました。");
    } finally {
      setMerging(false);
    }
  };

  // 実行後は結果表示だけにする（同じ内容を二度実行させない）
  if (result) {
    return (
      <DialogShell title="まとめてマージの結果" size="lg" onClose={onClose}
        footer={<BtnSecondary onClick={onClose}>閉じる</BtnSecondary>}>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
          <p style={{ fontSize: 13, color: "#1A1714" }}>
            <strong style={{ color: "#059669" }}>{result.merged}件</strong> をマージしました
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
          {result.failed > 0 && (
            <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.7 }}>
              前のマージでマージ先が進むため、後続がコンフリクトになることがあります。
              失敗した分は一覧を更新してから、あらためてお試しください。
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

        <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, overflow: "hidden" }}>
          {pulls.map((p, i) => {
            const blocked = mergeBlockReason(p);
            return (
              <div key={p.number} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 13px", borderBottom: i < pulls.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none" }}>
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
            この操作は取り消せません。1件ずつ順番に実行し、途中で失敗しても残りは続行します。<br />
            前のマージでマージ先が進むため、<strong>後続がコンフリクトになることがあります</strong>。<br />
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
