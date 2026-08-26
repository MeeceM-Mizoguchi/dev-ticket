// PR一覧と詳細（docs/github-integration-design.md 8-3-C）。
//
// 「view」の人にはマージ系ボタンをそもそも描画しない（押せないボタンを見せない）。
// マージできない状態のときは、淡色のボタンと理由を並べて出す。
//
// マージ可否（mergeable_state）は一覧APIでは取れないため、行を開いたときに引いた詳細を優先して使う。
// その詳細は refreshedAt が変わったら捨てる。残すと更新ボタンが効かなく見える（BRU13-021）。
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ExternalLink, ChevronDown, ChevronUp, GitPullRequest, Link2 } from "lucide-react";
import { fetchPull, mergeBlockReason, relativeTime, GithubApiError } from "@/app/lib/github";
import type { GithubPull, GithubAccessLevel, TicketGithubLink } from "@/app/types";

const BLACK = "#1F2328";

export function PullRequestList({ projectId, projectSlug, repo, pulls, level, links, selected, onToggleSelect, onMergeClick, onLinkClick, onDetailLoaded, writeBlocked, refreshedAt }: {
  projectId: string;
  /** 紐付いたチケットへ飛ばすために使う */
  projectSlug: string;
  repo: string;
  pulls: GithubPull[];
  level: GithubAccessLevel;
  links: TicketGithubLink[];
  /** まとめてマージ用の選択状態。undefined なら選択機能を出さない */
  selected?: Set<number>;
  onToggleSelect?: (number: number) => void;
  onMergeClick: (pull: GithubPull) => void;
  onLinkClick?: (pull: GithubPull) => void;
  /**
   * 行を開いて引いた詳細を親へ渡す。マージ可否（mergeable_state）は一覧APIでは
   * 判定中のことがあり、親が持つ一覧と行の表示が食い違うため（BRU13-036）
   */
  onDetailLoaded?: (pull: GithubPull) => void;
  /**
   * PRの状態ではなく App の権限でマージできない場合の理由。
   * 入っていれば全件マージできないので、押せるボタンを出さない
   */
  writeBlocked?: string | null;
  /**
   * 一覧を取得した時刻。値が変わったら「更新した」の合図として、
   * 各行が開いたときに引いた詳細を捨てる（BRU13-021）
   */
  refreshedAt?: string | null;
}) {
  if (!pulls.length) {
    return <Empty>オープンなプルリクエストはありません。</Empty>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
      {pulls.map(p => (
        <PullRow key={p.number} projectId={projectId} projectSlug={projectSlug} repo={repo} pull={p} level={level}
          linked={links.filter(l => l.kind === "pull" && l.number === p.number)}
          checked={selected?.has(p.number) ?? false}
          onToggleSelect={onToggleSelect} writeBlocked={writeBlocked} refreshedAt={refreshedAt}
          onMergeClick={onMergeClick} onLinkClick={onLinkClick} onDetailLoaded={onDetailLoaded} />
      ))}
    </div>
  );
}

function PullRow({ projectId, projectSlug, repo, pull, level, linked, checked, onToggleSelect, onMergeClick, onLinkClick, onDetailLoaded, writeBlocked, refreshedAt }: {
  projectId: string;
  projectSlug: string;
  repo: string;
  pull: GithubPull;
  level: GithubAccessLevel;
  linked: TicketGithubLink[];
  checked: boolean;
  onToggleSelect?: (number: number) => void;
  onMergeClick: (pull: GithubPull) => void;
  onLinkClick?: (pull: GithubPull) => void;
  onDetailLoaded?: (pull: GithubPull) => void;
  writeBlocked?: string | null;
  refreshedAt?: string | null;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<GithubPull | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");

  // 一覧を取り直したら、開いたときに引いた詳細はもう古い（BRU13-021）。
  //
  // 行は key={PR番号} で描画されるため、更新ボタンで一覧が入れ替わっても
  // この行の state は残る。下の shown は detail を優先するので、捨てないと
  // 「更新しても古いマージ可否・変更ファイル数が出続け、F5でしか直らない」状態になる。
  // （実際に、コンフリクトを解消して更新しても「マージ不可」が消えなかった）
  //
  // useEffect ではなくレンダー中に捨てるのは、副作用だと1フレームぶん
  // 古い詳細のまま描かれてしまうため。開いたままなら下の effect が引き直す
  const [detailAt, setDetailAt] = useState(refreshedAt);
  if (detailAt !== refreshedAt) {
    setDetailAt(refreshedAt);
    setDetail(null);
    setDetailError("");
  }

  const shown = detail ?? pull;
  // 権限で止まっているときは、PR個別の事情より先にそちらを理由として出す
  const blocked = writeBlocked || mergeBlockReason(shown);

  // 更新を挟んだかどうかを、返ってきた時点で確かめるための目印。
  // 取得中に更新を押されたら、その応答は更新前のものなので捨てる
  const detailAtRef = useRef(detailAt);
  detailAtRef.current = detailAt;

  // 親へ渡すコールバックは ref 経由で持つ。effect の依存に入れると、
  // 親が再描画されるたびに詳細を引き直しかねない
  const onDetailLoadedRef = useRef(onDetailLoaded);
  onDetailLoadedRef.current = onDetailLoaded;

  // mergeable_state は一覧では取れないので、開いたときに詳細を引く。
  // 更新で detail を捨てたあとも、開いたままならここで引き直される
  useEffect(() => {
    if (!open || detail || loadingDetail) return;
    const at = detailAt;
    setLoadingDetail(true);
    fetchPull(projectId, pull.number)
      .then(r => {
        if (detailAtRef.current !== at) return;
        setDetail(r.pull);
        // 引き直した可否は一覧側の判断（まとめてマージの母数）にも反映させる
        onDetailLoadedRef.current?.(r.pull);
      })
      .catch(e => {
        if (detailAtRef.current === at) setDetailError(e instanceof GithubApiError ? e.message : "詳細を取得できませんでした");
      })
      .finally(() => setLoadingDetail(false));
  }, [open, detail, loadingDetail, detailAt, projectId, pull.number]);

  return (
    <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.09)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          {/* まとめてマージ用の選択。マージできない状態のものは選ばせない */}
          {onToggleSelect && level === "merge" && (
            <input type="checkbox" checked={checked} disabled={!!blocked}
              onChange={() => onToggleSelect(pull.number)}
              title={blocked ?? "まとめてマージの対象にする"}
              style={{ marginTop: 3, flexShrink: 0, cursor: blocked ? "not-allowed" : "pointer" }} />
          )}
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
                // このチップは「紐付いたチケット」なので、飛び先は GitHub ではなく Dev Ticket 側。
                // PR そのものへはタイトル側のリンクから飛べる。
                linked.map(l => {
                  const wbs = l.ticketWbs ?? "";
                  const clickable = !!(wbs && projectSlug);
                  return (
                    <button key={l.id} type="button"
                      title={clickable ? `チケット ${wbs} を開く` : (l.ticketTitle ?? undefined)}
                      disabled={!clickable}
                      onClick={() => clickable && navigate(`/${encodeURIComponent(projectSlug)}/${encodeURIComponent(wbs)}`)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#0284C7", fontWeight: 600, background: "transparent", border: "none", padding: 0, cursor: clickable ? "pointer" : "default", textDecoration: clickable ? "underline" : "none", textUnderlineOffset: 2 }}>
                      <Link2 style={{ width: 11, height: 11 }} />
                      {wbs || l.ticketId}
                      {l.ticketTitle && <span style={{ color: "#6B6458", fontWeight: 400, textDecoration: "none" }}>{l.ticketTitle}</span>}
                    </button>
                  );
                })
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
                  {writeBlocked ? "権限不足 ⓘ" : "マージ不可 ⓘ"}
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
