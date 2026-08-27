// 本番反映の状態（docs/deploy-verification-design.md 層C）。
//
// 「GitHub上ではマージ成功しているのに本番に届いていない」を、気づける形で出す。
// 半日かけて人が突き止めた内容（本番のコミット／mainのコミット／未反映のPRと
// チケット／main のチェック結果）を1画面に揃えるのが目的なので、
// 「反映されていません」だけで終わらせず、次に見に行く場所まで必ず出す。
//
// 出さない場合も黙らない。確認先が未設定なら「確認していない」と書く。
// 確認していない状態を「問題なし」に見せると、この機能を入れた意味が無くなる。
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, Clock } from "lucide-react";
import { DEPLOY_LEVEL_TONE, elapsedSince, relativeTime } from "@/app/lib/github";
import type { GithubDeployStatus } from "@/app/types";

const MONO = "var(--font-mono)";

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "—";
}

/** GitHub の日時を「8月24日 19:03」形式に */
function jstShort(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${j.getUTCMonth() + 1}月${j.getUTCDate()}日 ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}

export function DeployStatusBanner({ deploy, onRecheck, checking, canManage, onOpenSettings }: {
  deploy: GithubDeployStatus | null;
  onRecheck?: () => void;
  checking?: boolean;
  /** 設定を直せる人か。直せない人に設定画面へのリンクを出さない */
  canManage?: boolean;
  onOpenSettings?: () => void;
}) {
  if (!deploy) return null;

  const repo = deploy.repo ?? "";
  const commitsUrl = repo ? `https://github.com/${repo}/commits/${deploy.defaultBranch ?? ""}` : "";
  const compareUrl = repo && deploy.deployedSha && deploy.headSha
    ? `https://github.com/${repo}/compare/${deploy.deployedSha}...${deploy.headSha}`
    : commitsUrl;

  // 未設定。確認していないという事実だけを、設定できる人にだけ小さく出す
  if (deploy.state === "not-configured" || !deploy.configured) {
    if (!canManage) return null;
    return (
      <Bar tone={{ bg: "#F9F8F6", border: "rgba(26,23,20,0.10)", text: "#6B6458" }}>
        <Clock style={{ width: 14, height: 14, color: "#A09790", flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, lineHeight: 1.7 }}>
            <strong>本番反映の確認が未設定です。</strong>
            マージできた時点で「リリース済み」にしているため、デプロイが止まっていても気づけません。
          </p>
        </div>
        {onOpenSettings && (
          <button onClick={onOpenSettings} style={ghostBtn}>設定する →</button>
        )}
      </Bar>
    );
  }

  // 確認そのものができなかった。「問題なし」と読ませない
  if (deploy.state === "unreachable" || deploy.state === "unknown" || deploy.state === "error") {
    return (
      <Bar tone={DEPLOY_LEVEL_TONE.notice}>
        <AlertTriangle style={{ width: 15, height: 15, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>本番への反映を確認できませんでした</p>
          <p style={{ fontSize: 12, lineHeight: 1.7 }}>
            {deploy.message ?? "確認先URLから応答がありませんでした。"}
            <br />
            確認できていないだけで、反映されているとは限りません。
          </p>
          {deploy.checkUrl && (
            <p style={{ fontSize: 11, marginTop: 4, fontFamily: MONO, opacity: 0.85, wordBreak: "break-all" }}>
              確認先: {deploy.checkUrl}
            </p>
          )}
        </div>
        <Actions deploy={deploy} url={commitsUrl} onRecheck={onRecheck} checking={checking}
          canManage={canManage} onOpenSettings={onOpenSettings} />
      </Bar>
    );
  }

  // 反映済み。1行だけ出す（出さないと「確認しているのかどうか」が分からない）
  if (deploy.state === "in-sync") {
    return (
      <Bar tone={{ bg: "#F0FDF4", border: "#BBF7D0", text: "#166534" }}>
        <CheckCircle2 style={{ width: 14, height: 14, color: "#059669", flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, lineHeight: 1.7 }}>
            本番は最新です（<span style={{ fontFamily: MONO }}>{shortSha(deploy.deployedSha)}</span>）
            {deploy.checkedAt && <span style={{ opacity: 0.75 }}> ・ {relativeTime(deploy.checkedAt)}に確認</span>}
          </p>
        </div>
        <Actions deploy={deploy} url={commitsUrl} onRecheck={onRecheck} checking={checking} />
      </Bar>
    );
  }

  // ここから「遅れている」。猶予（30分）の内側はまだ異常と呼ばない
  const tone = DEPLOY_LEVEL_TONE[deploy.level];
  const waiting = deploy.level === "none";
  const failing = deploy.checkState === "failure";
  const failed = deploy.checkDetail.filter(c => c.state === "failure");
  const since = elapsedSince(deploy.behindSince);

  if (waiting) {
    return (
      <Bar tone={DEPLOY_LEVEL_TONE.none}>
        <Clock style={{ width: 14, height: 14, color: "#0284C7", flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, lineHeight: 1.7 }}>
            本番へ反映中です（<strong>{deploy.behindBy}コミット</strong>が未反映 ・ {since}前から）。
            {failing && <> ただし <strong>{deploy.checkSummary}</strong> のため、このままでは反映されない可能性があります。</>}
          </p>
        </div>
        <Actions deploy={deploy} url={compareUrl} onRecheck={onRecheck} checking={checking} />
      </Bar>
    );
  }

  return (
    <div style={{
      background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 12,
      padding: "14px 16px", marginBottom: 12, color: tone.text,
    }}>
      <div style={{ display: "flex", gap: 11 }}>
        <AlertTriangle style={{ width: 17, height: 17, flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <p style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em" }}>
              本番に反映されていません
              {deploy.level === "critical" && <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 8 }}>（{since}以上）</span>}
            </p>
            <Actions deploy={deploy} url={compareUrl} onRecheck={onRecheck} checking={checking}
              canManage={canManage} onOpenSettings={onOpenSettings} />
          </div>

          {/* 本番とmainの実物を並べる。ここが「何が起きているか」の核心 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 20px", marginTop: 8, fontSize: 12, lineHeight: 1.8 }}>
            <span>
              <Label>本番</Label>
              <span style={{ fontFamily: MONO, fontWeight: 700 }}>{shortSha(deploy.deployedSha)}</span>
              {deploy.deployedRef && deploy.deployedRef !== deploy.deployedSha && (
                <span style={{ opacity: 0.7 }}>（{deploy.deployedRef}）</span>
              )}
            </span>
            <span>
              <Label>{deploy.defaultBranch || "main"}</Label>
              <span style={{ fontFamily: MONO, fontWeight: 700 }}>{shortSha(deploy.headSha)}</span>
              {deploy.headCommittedAt && <span style={{ opacity: 0.75 }}> ・ {jstShort(deploy.headCommittedAt)}</span>}
            </span>
            <span style={{ fontWeight: 700 }}>{deploy.behindBy}コミット遅れ</span>
            {since && <span style={{ opacity: 0.85 }}>{since}前から</span>}
          </div>

          {deploy.headMessage && (
            <p style={{ fontSize: 11, opacity: 0.8, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              最新コミット: {deploy.headMessage}
            </p>
          )}

          {/* 未反映のPR・チケット。「何が届いていないのか」を名指しで出す */}
          {deploy.pendingPulls.length > 0 && (
            <p style={{ fontSize: 12, marginTop: 8, lineHeight: 1.8, wordBreak: "break-word" }}>
              <Label>未反映のPR</Label>
              {deploy.pendingPulls.slice(0, 20).map((p, i) => (
                <span key={p.number}>
                  {i > 0 && " "}
                  <a href={p.url} target="_blank" rel="noopener noreferrer"
                    title={p.title}
                    style={{ color: "inherit", fontFamily: MONO, fontWeight: 700, textDecoration: "underline" }}>
                    #{p.number}
                  </a>
                </span>
              ))}
              {deploy.pendingPulls.length > 20 && <span> ほか{deploy.pendingPulls.length - 20}件</span>}
            </p>
          )}

          {deploy.pendingTickets.length > 0 && (
            <p style={{ fontSize: 12, marginTop: 4, lineHeight: 1.8, wordBreak: "break-word" }}>
              <Label>未反映のチケット</Label>
              {deploy.pendingTickets.slice(0, 12).map(t => t.wbs).filter(Boolean).join(" / ")}
              {deploy.pendingTickets.length > 12 && ` ほか${deploy.pendingTickets.length - 12}件`}
              {/* すでに「リリース済み」にされているものは、画面の表示と本番が食い違っている */}
              {deploy.pendingTickets.some(t => t.status === "released") && (
                <strong style={{ marginLeft: 6 }}>
                  （うち{deploy.pendingTickets.filter(t => t.status === "released").length}件はリリース済みとして扱われています）
                </strong>
              )}
            </p>
          )}

          {/* 遅れの理由。今回の事故ではここに「Deployment was blocked」が出ていた */}
          {failed.length > 0 && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${tone.border}` }}>
              <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>
                {deploy.defaultBranch || "main"} の最新コミットのチェック
              </p>
              {failed.slice(0, 6).map((c, i) => (
                <p key={`${c.name}-${i}`} style={{ fontSize: 12, lineHeight: 1.75, wordBreak: "break-word" }}>
                  ✗ <strong>{c.name}</strong>
                  {c.description && <> — {c.description}</>}
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer"
                      style={{ marginLeft: 6, color: "inherit", fontWeight: 700, textDecoration: "underline" }}>
                      詳細
                    </a>
                  )}
                </p>
              ))}
            </div>
          )}

          {/* 見られなかった情報源。「チェックなし＝問題なし」と読ませない */}
          {deploy.checkUnavailable.length > 0 && (
            <p style={{ fontSize: 11, marginTop: 6, opacity: 0.85, lineHeight: 1.7 }}>
              {deploy.checkUnavailable.join("・")} は権限が無いため確認できていません。
              GitHub App に読み取り権限を追加すると、止まっている理由まで表示できます。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 部品 ─────────────────────────────────────────────────────
const ghostBtn: React.CSSProperties = {
  padding: "5px 12px", fontSize: 11, fontWeight: 700, borderRadius: 8,
  border: "1px solid currentColor", background: "transparent", color: "inherit",
  cursor: "pointer", whiteSpace: "nowrap", opacity: 0.9,
};

function Label({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.75, marginRight: 6 }}>{children}</span>;
}

function Bar({ tone, children }: { tone: { bg: string; border: string; text: string }; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 10,
      padding: "10px 14px", marginBottom: 12, color: tone.text,
    }}>
      {children}
    </div>
  );
}

function Actions({ deploy, url, onRecheck, checking, canManage, onOpenSettings }: {
  deploy: GithubDeployStatus;
  url: string;
  onRecheck?: () => void;
  checking?: boolean;
  canManage?: boolean;
  onOpenSettings?: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer"
          style={{ ...ghostBtn, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
          GitHubで確認 <ExternalLink style={{ width: 10, height: 10 }} />
        </a>
      )}
      {onRecheck && (
        <button onClick={onRecheck} disabled={checking}
          title={deploy.checkedAt ? `${relativeTime(deploy.checkedAt)}に確認` : undefined}
          style={{ ...ghostBtn, display: "inline-flex", alignItems: "center", gap: 4, opacity: checking ? 0.55 : 0.9, cursor: checking ? "default" : "pointer" }}>
          <RefreshCw style={{ width: 10, height: 10 }} />{checking ? "確認中..." : "今すぐ確認"}
        </button>
      )}
      {canManage && onOpenSettings && (
        <button onClick={onOpenSettings} style={ghostBtn}>設定</button>
      )}
    </div>
  );
}
