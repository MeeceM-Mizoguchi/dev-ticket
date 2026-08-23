// PR一覧と詳細（docs/github-integration-design.md 8-3-C）。
//
// 「view」の人にはマージ系ボタンをそもそも描画しない（押せないボタンを見せない）。
// マージできない状態のときは、淡色のボタンと理由を並べて出す。
import { useEffect, useState } from "react";
import { ExternalLink, ChevronDown, ChevronUp, GitPullRequest, Link2 } from "lucide-react";
import { fetchPull, mergeBlockReason, relativeTime, GithubApiError } from "@/app/lib/github";
import type { GithubPull, GithubAccessLevel, TicketGithubLink } from "@/app/types";

const BLACK = "#1F2328";

export function PullRequestList({ projectId, repo, pulls, level, links, onMergeClick, onLinkClick }: {
  projectId: string;
  repo: string;
  pulls: GithubPull[];
  level: GithubAccessLevel;
  links: TicketGithubLink[];
  onMergeClick: (pull: GithubPull) => void;
  onLinkClick?: (pull: GithubPull) => void;
}) {
  if (!pulls.length) {
    return <Empty>オープンなプルリクエストはありません。</Empty>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
      {pulls.map(p => (
        <PullRow key={p.number} projectId={projectId} repo={repo} pull={p} level={level}
          linked={links.filter(l => l.kind === "pull" && l.number === p.number)}
          onMergeClick={onMergeClick} onLinkClick={onLinkClick} />
      ))}
    </div>
  );
}

function PullRow({ projectId, repo, pull, level, linked, onMergeClick, onLinkClick }: {
  projectId: string;
  repo: string;
  pull: GithubPull;
  level: GithubAccessLevel;
  linked: TicketGithubLink[];
  onMergeClick: (pull: GithubPull) => void;
  onLinkClick?: (pull: GithubPull) => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<GithubPull | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");

  const shown = detail ?? pull;
  const blocked = mergeBlockReason(shown);

  // mergeable_state は一覧では取れないので、開いたときに詳細を引く
  useEffect(() => {
    if (!open || detail || loadingDetail) return;
    setLoadingDetail(true);
    fetchPull(projectId, pull.number)
      .then(r => setDetail(r.pull))
      .catch(e => setDetailError(e instanceof GithubApiError ? e.message : "詳細を取得できませんでした"))
      .finally(() => setLoadingDetail(false));
  }, [open, detail, loadingDetail, projectId, pull.number]);

  return (
    <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.09)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <GitPullRequest style={{ width: 15, height: 15, color: pull.draft ? "#8A837B" : "#059669", flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#8A837B", fontFamily: "var(--font-mono)" }}>#{pull.number}</span>
              <a href={pull.url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", textDecoration: "none", wordBreak: "break-word" as const }}>
                {pull.title}
              </a>
              {pull.draft && <Chip bg="#F3F4F6" color="#6B7280">Draft</Chip>}
              <StatusChip state={pull.checkState} label={pull.checkSummary} />
            </div>

            <p style={{ fontSize: 11, color: "#A09790", marginTop: 4 }}>
              {pull.user.login} が {relativeTime(pull.createdAt)}に作成 ・ {pull.base} ← {pull.head}
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const, marginTop: 6 }}>
              {linked.length > 0 ? (
                linked.map(l => (
                  <span key={l.id} title={l.ticketTitle ?? undefined}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#0284C7", fontWeight: 600 }}>
                    <Link2 style={{ width: 11, height: 11 }} />
                    {l.ticketWbs ?? l.ticketId}
                    {l.ticketTitle && <span style={{ color: "#6B6458", fontWeight: 400 }}>{l.ticketTitle}</span>}
                  </span>
                ))
              ) : pull.detectedWbs.length > 0 ? (
                <span style={{ fontSize: 11, color: "#A09790" }}>
                  検出: {pull.detectedWbs.join(", ")}
                  {onLinkClick && level === "merge" && (
                    <button onClick={() => onLinkClick(pull)}
                      style={{ marginLeft: 6, padding: "1px 8px", fontSize: 10, fontWeight: 600, borderRadius: 6, border: "1px solid rgba(2,132,199,0.3)", background: "#F0F9FF", color: "#0284C7", cursor: "pointer" }}>
                      チケットに紐付ける
                    </button>
                  )}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: "#C9C4BB" }}>未紐付け</span>
              )}
              <ReviewChip state={pull.reviewState} label={pull.reviewSummary} />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button onClick={() => setOpen(v => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#FFF", color: "#4B4540", cursor: "pointer", whiteSpace: "nowrap" as const }}>
              詳細 {open ? <ChevronUp style={{ width: 11, height: 11 }} /> : <ChevronDown style={{ width: 11, height: 11 }} />}
            </button>

            {/* view の人にはマージ系ボタンをそもそも出さない */}
            {level === "merge" && (
              blocked ? (
                <span title={blocked}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.10)", background: "#F4F5F6", color: "#B0A9A4", cursor: "not-allowed", whiteSpace: "nowrap" as const }}>
                  マージ不可 ⓘ
                </span>
              ) : (
                <button onClick={() => onMergeClick(shown)}
                  style={{ padding: "6px 14px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", background: BLACK, color: "#FFF", cursor: "pointer", whiteSpace: "nowrap" as const }}>
                  マージする
                </button>
              )
            )}
          </div>
        </div>

        {level === "merge" && blocked && (
          <p style={{ fontSize: 11, color: "#D97706", marginTop: 8, marginLeft: 25 }}>{blocked}</p>
        )}
      </div>

      {open && (
        <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)", background: "#FAFAF8", padding: "12px 14px" }}>
          {loadingDetail && <p style={{ fontSize: 12, color: "#B0A9A4" }}>読み込み中...</p>}
          {detailError && <p style={{ fontSize: 12, color: "#DC2626" }}>{detailError}</p>}
          {detail && (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" as const, fontSize: 11, color: "#6B6458" }}>
                <span>変更ファイル {detail.changedFiles ?? 0}件</span>
                <span style={{ color: "#059669" }}>+{detail.additions ?? 0}</span>
                <span style={{ color: "#DC2626" }}>-{detail.deletions ?? 0}</span>
                <a href={`${detail.url}/files`} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#0284C7", textDecoration: "none" }}>
                  差分をGitHubで見る <ExternalLink style={{ width: 10, height: 10 }} />
                </a>
              </div>

              {detail.checks && detail.checks.length > 0 && (
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "#8A837B", letterSpacing: "0.06em", marginBottom: 5 }}>チェック</p>
                  <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5 }}>
                    {detail.checks.map(c => (
                      <span key={c.name} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: c.state === "success" ? "#ECFDF5" : c.state === "failure" ? "#FEF2F2" : "#FFFBEB", color: c.state === "success" ? "#059669" : c.state === "failure" ? "#DC2626" : "#D97706" }}>
                        {c.state === "success" ? "✔" : c.state === "failure" ? "✕" : "…"} {c.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {detail.body && (
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "#8A837B", letterSpacing: "0.06em", marginBottom: 5 }}>本文</p>
                  <pre style={{ fontSize: 11, color: "#4B4540", lineHeight: 1.7, whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, maxHeight: 220, overflowY: "auto", fontFamily: "inherit", margin: 0 }}>
                    {detail.body}
                  </pre>
                </div>
              )}

              <p style={{ fontSize: 10, color: "#B0A9A4" }}>{repo}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ children, bg, color }: { children: React.ReactNode; bg: string; color: string }) {
  return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: bg, color }}>{children}</span>;
}

function StatusChip({ state, label }: { state: GithubPull["checkState"]; label: string }) {
  if (state === "none") return null;
  const map = {
    success: { bg: "#ECFDF5", color: "#059669", mark: "✔" },
    failure: { bg: "#FEF2F2", color: "#DC2626", mark: "✕" },
    pending: { bg: "#FFFBEB", color: "#D97706", mark: "●" },
  } as const;
  const s = map[state];
  return <Chip bg={s.bg} color={s.color}>{s.mark} {label}</Chip>;
}

function ReviewChip({ state, label }: { state: GithubPull["reviewState"]; label: string }) {
  if (!label) return null;
  const map = {
    approved: { bg: "#ECFDF5", color: "#059669", mark: "✔" },
    changes_requested: { bg: "#FEF2F2", color: "#DC2626", mark: "✕" },
    pending: { bg: "#F3F4F6", color: "#6B7280", mark: "○" },
  } as const;
  const s = map[state];
  return <span style={{ fontSize: 11, color: s.color, fontWeight: 600 }}>レビュー {s.mark} {label}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "36px 20px", textAlign: "center" as const, background: "#FFF", border: "1px dashed rgba(26,23,20,0.12)", borderRadius: 12 }}>
      <p style={{ fontSize: 12, color: "#B0A9A4" }}>{children}</p>
    </div>
  );
}
