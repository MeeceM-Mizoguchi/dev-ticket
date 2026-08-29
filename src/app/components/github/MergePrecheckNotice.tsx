// マージ前のチェックで止まったときの案内（BRU13-038 / BRU13-042）。
//
// 「1件もマージしていない」ことを最初に言い切る。ここが曖昧だと、
// 一部だけ入ったのかどうかを確かめに行く手間が毎回発生する。
// そのうえで、直すべきPRだけを理由つきで並べる。
//
// 止まった理由は2種類あり、人がやることが違うので言い分ける。
//   ・単独で見てもマージできない  … そのPRをGitHub上で直す
//   ・この順番だと通らない（trial）… 並べ替えるか、そのPRを直す
import { ExternalLink, GitMerge } from "lucide-react";
import type { GithubMergePrecheckResult } from "@/app/types";

const RED_TEXT = "#B91C1C";

export function MergePrecheckNotice({ precheck, repo, single }: {
  precheck: GithubMergePrecheckResult;
  /** PRへのリンクを組み立てるために使う（owner/repo） */
  repo?: string;
  /** 1件だけマージしようとした場合。文言から「まとめて」を外す */
  single?: boolean;
}) {
  // 失敗チェックで止まったものは CheckGateNotice が理由も入力欄も出すので、ここでは重ねない。
  // ただしコンフリクトが理由のものは別。CheckGateNotice は順番の話（conflictAfter）を
  // 出さないので、CI の警告も付いているPRだと止まった本当の理由が消えてしまう
  const bad = precheck.results.filter(r => !r.ok && (!r.checkGate || r.conflict || !!r.conflictAfter?.length));
  if (!bad.length) return null;

  return (
    <div style={{ display: "flex", gap: 10, background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.30)", borderRadius: 10, padding: "12px 14px" }}>
      <GitMerge style={{ width: 15, height: 15, color: "#DC2626", flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: RED_TEXT, marginBottom: 4 }}>
          {precheck.trial
            ? "この順番ではマージできません"
            : precheck.conflicts > 0
              ? `コンフリクトが ${precheck.conflicts}件 見つかりました`
              : "マージできない状態のプルリクエストがあります"}
        </p>
        <p style={{ fontSize: 12, color: RED_TEXT, lineHeight: 1.75 }}>
          {precheck.trial
            // 単独では全件通っている。「そのPRが壊れている」と読ませないための言い方にする
            ? "1件もマージしていません。実際の順番どおりに試したところ、下のプルリクエストが手前のマージのあとで通らなくなりました。順番を入れ替えるか、GitHub上で解消してから、あらためて実行してください。"
            : single
              ? "マージは実行していません。GitHub上で解消してから、やり直してください。"
              : "1件もマージしていません。下のプルリクエストをGitHub上で解消してから、あらためて実行してください。"}
        </p>
        <div style={{ marginTop: 7, display: "flex", flexDirection: "column" as const, gap: 4 }}>
          {bad.map(r => (
            <p key={r.number} style={{ fontSize: 11, color: RED_TEXT, lineHeight: 1.7, wordBreak: "break-word" as const }}>
              ・<span style={{ fontFamily: "var(--font-mono)" }}>#{r.number}</span> {r.title}
              {r.reason && <> — <strong>{r.reason}</strong></>}
              {/* どこまで入れた状態で失敗したのかを出す。これが無いと
                  「単独では通るのになぜ」が読めず、直す相手を間違える */}
              {!!r.conflictAfter?.length && (
                <>（<strong>{r.conflictAfter.map(n => `#${n}`).join("、")}</strong> のあとに入れた場合）</>
              )}
              {repo && (
                <a href={`https://github.com/${repo}/pull/${r.number}`} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 6, fontWeight: 700, color: RED_TEXT, textDecoration: "underline" }}>
                  GitHubで開く<ExternalLink style={{ width: 10, height: 10 }} />
                </a>
              )}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
