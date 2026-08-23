// PRマージの確認（docs/github-integration-design.md 8-4）。
//
// マージは取り消しが難しいので、マージ先・CI・レビュー状況を全部出してから確認させる。
// 失敗してもダイアログは閉じない（原因を読ませるため）。
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { MERGE_METHOD_LABELS, loadMergeMethod, saveMergeMethod } from "@/app/lib/github";
import type { GithubPull, GithubMergeMethod } from "@/app/types";

const METHODS: GithubMergeMethod[] = ["merge", "squash", "rebase"];

export function MergeConfirmDialog({ pull, repo, actorName, onClose, onMerge }: {
  pull: GithubPull;
  repo: string;
  actorName: string;
  onClose: () => void;
  onMerge: (method: GithubMergeMethod) => Promise<void>;
}) {
  const [method, setMethod] = useState<GithubMergeMethod>(loadMergeMethod());
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState("");

  const handleMerge = async () => {
    setMerging(true);
    setError("");
    try {
      await onMerge(method);
      saveMergeMethod(method);
      onClose();
    } catch (e) {
      // 閉じずに理由を見せる
      setError((e as Error)?.message ?? "マージに失敗しました。");
      setMerging(false);
    }
  };

  return (
    <DialogShell title="マージの確認" onClose={merging ? () => {} : onClose}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={merging}>キャンセル</BtnSecondary>
        <button type="button" onClick={handleMerge} disabled={merging}
          style={{ padding: "9px 20px", background: merging ? "#9CA3AF" : "#1F2328", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: merging ? "not-allowed" : "pointer" }}>
          {merging ? "マージ中..." : "マージする"}
        </button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
        <p style={{ fontSize: 13, color: "#1A1714" }}>以下のプルリクエストをマージします。</p>

        <div style={{ background: "#F9FAFB", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column" as const, gap: 7 }}>
          <Row label="リポジトリ" value={repo} />
          <Row label="プルリク" value={`#${pull.number}  ${pull.title}`} />
          <Row label="マージ先" value={`${pull.base}  ←  ${pull.head}`} />
          <Row label="CI" value={pull.checkSummary || "—"} tone={pull.checkState === "failure" ? "bad" : pull.checkState === "success" ? "good" : "normal"} />
          <Row label="レビュー" value={pull.reviewSummary || "—"} tone={pull.reviewState === "approved" ? "good" : pull.reviewState === "changes_requested" ? "bad" : "normal"} />
        </div>

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
            この操作は取り消せません。<br />
            GitHub 上は Dev Ticket[bot] 名義で記録され、マージコミットに「{actorName}」が実行者として残ります。
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

function Row({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "good" | "bad" }) {
  const color = tone === "good" ? "#059669" : tone === "bad" ? "#DC2626" : "#1A1714";
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
      <span style={{ width: 76, flexShrink: 0, color: "#8A837B", fontWeight: 600 }}>{label}</span>
      <span style={{ color, wordBreak: "break-word" as const }}>{value}</span>
    </div>
  );
}
