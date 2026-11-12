// ENHA2-055-3 高度検索。
//
// 質問を入れて「プロンプトを生成してコピー」を押すと、調査を「待機中」で1件作り、APIキー・調査のID・API の使い方が
// 入ったプロンプトをコピーする。利用者がそれを CLI の AI（Claude Code など）に貼ると、AI が Dev Ticket の API で
// 議事録・Wiki・チケット・コメント・バックログを調べ、research-start → research-result を送ってくる。
// 画面は開いている間、待機中・処理中の調査を数秒ごとに確かめ、処理中になったらモーダルを出し、完了したら結果を出す。
// Dev Ticket からは AI を呼ばない（従量課金の AI API を使わない）。
//
//   ・キーは「自分が発行したキー」を使う（API が「キーを発行した人＝調査を作った人」で受け付けるため）。
//     無ければ「APIキーを発行しますか？」と聞き、読み取りのみのキーを作ってからコピーする。
//   ・過去の調査は本人の分だけ（RLS）。結果に、見られる人を絞った議事録の内容が入りうるため。
//   ・結果の Markdown は ResearchMarkdown で React の要素として組み立てる（HTML として入れない）。
//   ・出典を押すと資料の画面へ移り、根拠の文を ResearchQuoteHighlighter が黄色で目立たせる。
//   ・BUG-02/03: 一度表示したら、状態の確認中もスピナーで隠さない。BUG-05: コピー・発行・キャンセルは ref で二重押しを防ぐ。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  FolderKanban, ChevronRight, Copy, KeyRound, Loader2, Telescope, Clock, AlertTriangle, Terminal, Lightbulb, FileText, FolderOpen,
} from "lucide-react";
import { backfillFileTexts } from "@/app/lib/projectFiles";
import { isSupabaseEnabled, supabase } from "@/lib/supabase";
import { copyText } from "@/lib/clipboard";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { mapProject } from "@/app/lib/mappers";
import type { AccessLevel, Project, UserPermissions } from "@/app/types";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { projectAccessView } from "@/app/components/shared/NotFoundView";
import { findProjectBySlug } from "@/app/lib/projectResolve";
import { useCanonicalSlugRedirect } from "@/app/hooks/useCanonicalSlugRedirect";
import { escStack } from "@/app/lib/escStack";
import { submitOnModEnter } from "@/app/lib/submitKey";
import { getResearchApiKey, createResearchApiKey } from "@/app/lib/apiKeys";
import { buildResearchPrompt } from "@/app/lib/apiAskPrompt";
import {
  listResearchJobs, createResearchJob, cancelResearchJob, isActiveResearch,
  RESEARCH_STATUS_META, RESEARCH_SOURCE_KIND_LABEL,
  type ResearchJob, type ResearchSource,
} from "@/app/lib/researchJobs";
import { ResearchMarkdown, stripSourcesSection } from "@/app/components/research/ResearchMarkdown";
import { ApiIntegrationDialog } from "@/app/components/tickets/ApiIntegrationDialog";

const GREEN = "#059669";
const PURPLE = "#7C3AED";
/** 待機中・処理中の調査があるときに、状態を確かめる間隔 */
const POLL_MS = 3000;

const EXAMPLES = [
  "ログイン方式はいつ、どう決まった？",
  "まだ決まっていない仕様をまとめて",
  "先月の定例で出た課題を一覧にして",
];

type ResultView = "report" | "short";

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatElapsed(fromIso: string | null, now: number): string {
  if (!fromIso) return "0秒";
  const sec = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

/** 出典から移る先の画面のパス。種類と ID から作る（AI が送った url は画面外の URL のこともあるので使わない） */
function sourcePath(slug: string, s: ResearchSource): string | null {
  const id = encodeURIComponent(String(s.id ?? ""));
  if (!slug || !id) return null;
  switch (s.kind) {
    case "minutes": return `/${slug}/minutes/${id}`;
    case "wiki": return `/${slug}/wiki/pages/${id}`;
    case "backlog": return `/${slug}/backlog/${id}`;
    case "ticket":
    case "comment": return `/${slug}/${id}`;
    // ENHA2-056 ファイルボックスでそのファイルを開く（ファイルの中の文は目立たせない）
    case "file": return `/${slug}/files?file=${id}`;
    default: {
      if (!s.url) return null;
      try {
        const u = new URL(s.url, window.location.origin);
        return u.origin === window.location.origin ? u.pathname : null;
      } catch { return null; }
    }
  }
}

function StatusBadge({ status }: { status: ResearchJob["status"] }) {
  const meta = RESEARCH_STATUS_META[status];
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
      {meta.label}
    </span>
  );
}

export function ResearchPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const { userId, userName, userRole, userOrgId } = useAuth();
  const { toast } = useToast();
  const isAdmin = userRole === "owner" || userRole === "admin";

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [notFound, setNotFound] = useState(false);
  const [aliasCanonicalSlug, setAliasCanonicalSlug] = useState<string | null>(null);
  const [projectPermissions, setProjectPermissions] = useState<UserPermissions | null>(null);
  const [projectPermissionsLoaded, setProjectPermissionsLoaded] = useState(false);

  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  // BUG-02/03: 一度でも読んだら、以後の確認でスピナーに差し替えない
  const jobsLoadedRef = useRef(false);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ResultView>("report");

  const [question, setQuestion] = useState("");
  /** 自分のキーの平文。undefined = まだ確かめていない / null = 無い */
  const [ownKey, setOwnKey] = useState<string | null | undefined>(undefined);
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);
  const [keyConfirm, setKeyConfirm] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const issuingRef = useRef(false);
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);
  const [keysDialog, setKeysDialog] = useState(false);
  const cancellingRef = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const questionRef = useRef<HTMLTextAreaElement | null>(null);

  // ── プロジェクト ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isSupabaseEnabled || !projectSlug) { setLoading(false); setProjectPermissionsLoaded(true); return; }
      setNotFound(false);
      const found = await findProjectBySlug(projectSlug);
      if (cancelled) return;
      if (!found) { setNotFound(true); setLoading(false); setProjectPermissionsLoaded(true); return; }
      setAliasCanonicalSlug(found.viaAlias ? found.canonicalSlug : null);
      const p = mapProject(found.row);
      setProject(p);
      if (userId && !isAdmin) {
        const { data: pmp } = await supabase!.from("project_member_permissions").select("permissions")
          .eq("project_id", p.id).eq("member_id", userId).maybeSingle();
        if (cancelled) return;
        if (pmp?.permissions) setProjectPermissions(pmp.permissions as UserPermissions);
      }
      setProjectPermissionsLoaded(true);
      setLoading(false);
    })().catch(() => { if (!cancelled) { setNotFound(true); setLoading(false); setProjectPermissionsLoaded(true); } });
    return () => { cancelled = true; };
  }, [projectSlug, userId, isAdmin]);

  useCanonicalSlugRedirect(projectSlug, aliasCanonicalSlug);

  const projectId = project?.id ?? "";
  const slug = project?.slug ?? projectSlug ?? "";

  // ── 調査の一覧 ────────────────────────────────────────────────
  /** 前回読んだときの状態。待機中・処理中だったものが終わったら、その結果を開く */
  const prevStatusRef = useRef<Map<string, ResearchJob["status"]>>(new Map());
  const loadJobs = useCallback(async () => {
    if (!projectId || !userId) return;
    const r = await listResearchJobs(projectId, userId);
    if (!r.ok) { setJobsError(r.error); jobsLoadedRef.current = true; setJobsLoaded(true); return; }
    setJobsError(null);
    const prev = prevStatusRef.current;
    const finished = r.jobs.find(j => {
      const before = prev.get(j.id);
      return before && (before === "queued" || before === "running") && (j.status === "done" || j.status === "failed");
    });
    prevStatusRef.current = new Map(r.jobs.map(j => [j.id, j.status]));
    setJobs(r.jobs);
    if (finished) { setSelectedId(finished.id); setView("report"); }
    else if (!jobsLoadedRef.current && r.jobs[0]) setSelectedId(r.jobs[0].id);
    jobsLoadedRef.current = true;
    setJobsLoaded(true);
  }, [projectId, userId]);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const hasActive = jobs.some(isActiveResearch);
  // 開いている間、待機中・処理中の調査があれば数秒ごとに確かめる
  useEffect(() => {
    if (!hasActive) return;
    const id = window.setInterval(() => { void loadJobs(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [hasActive, loadJobs]);

  const runningJob = jobs.find(j => j.status === "running") ?? null;
  // 処理中のモーダルの経過時間
  useEffect(() => {
    if (!runningJob) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [runningJob]);

  // 自分のキーは、コピーを押したときに待たせないよう先に確かめておく
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void getResearchApiKey(projectId).then(r => { if (!cancelled && r.ok) setOwnKey(r.plainKey); });
    return () => { cancelled = true; };
  }, [projectId]);

  // ESC は確認ダイアログ・手動コピーだけを閉じる（処理中のモーダルはキャンセルを押して閉じる）
  useEffect(() => {
    if (!keyConfirm) return;
    const close = () => setKeyConfirm(false);
    escStack.push(close);
    return () => escStack.pop(close);
  }, [keyConfirm]);
  useEffect(() => {
    if (manualCopyText === null) return;
    const close = () => setManualCopyText(null);
    escStack.push(close);
    return () => escStack.pop(close);
  }, [manualCopyText]);

  // ── コピー ────────────────────────────────────────────────────
  const createAndCopy = useCallback(async (plainKey: string) => {
    const q = question.trim();
    const created = await createResearchJob({ projectId, organizationId: project?.organizationId ?? userOrgId ?? null, userId, question: q });
    if (!created.ok) { toast(created.error, "error"); return; }
    const job = created.job;
    prevStatusRef.current.set(job.id, job.status);
    setJobs(prev => [job, ...prev]);
    setSelectedId(job.id);
    const prompt = buildResearchPrompt({
      baseUrl: window.location.origin, projectName: project?.name ?? slug, plainKey, jobId: job.id, question: q,
    });
    const ok = await copyText(prompt);
    if (ok) toast("コピーしました");
    else setManualCopyText(prompt);
  }, [question, projectId, project?.organizationId, project?.name, userOrgId, userId, slug, toast]);

  const canCopy = !!question.trim() && !!projectId && !copying && !issuing;

  const handleCopy = useCallback(async () => {
    // BUG-05: 同じレンダーのハンドラが2回走っても、調査が2件できないように ref で止める
    if (copyingRef.current || !question.trim() || !projectId) return;
    copyingRef.current = true;
    setCopying(true);
    try {
      let plain = ownKey;
      if (plain === undefined) {
        const r = await getResearchApiKey(projectId);
        if (!r.ok) { toast(r.error, "error"); return; }
        plain = r.plainKey;
        setOwnKey(plain);
      }
      if (!plain) { setKeyConfirm(true); return; }
      await createAndCopy(plain);
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  }, [question, projectId, ownKey, createAndCopy, toast]);

  const handleIssueAndCopy = useCallback(async () => {
    if (issuingRef.current) return;
    issuingRef.current = true;
    setIssuing(true);
    try {
      const r = await createResearchApiKey(projectId);
      if (!r.ok) { toast(r.error, "error"); return; }
      setOwnKey(r.plainKey);
      setKeyConfirm(false);
      toast("APIキー「高度検索用」を発行しました");
      await createAndCopy(r.plainKey);
    } finally {
      issuingRef.current = false;
      setIssuing(false);
    }
  }, [projectId, createAndCopy, toast]);

  const handleCancel = useCallback(async (job: ResearchJob) => {
    if (cancellingRef.current) return;
    cancellingRef.current = true;
    try {
      const r = await cancelResearchJob(job.id);
      if (r.error) { toast(r.error, "error"); return; }
      toast("調査をキャンセルしました");
      await loadJobs();
    } finally {
      cancellingRef.current = false;
    }
  }, [loadJobs, toast]);

  // ENHA2-056 既存のファイルの文字をまとめて取り出す（管理者・オーナーだけ）。
  // サーバーは1回で時間の許す分だけ進めるので、残りが 0 になるまで繰り返し呼ぶ。
  const [backfill, setBackfill] = useState<{ done: number; total: number } | null>(null);
  const backfillRef = useRef(false);
  const handleBackfill = useCallback(async () => {
    if (backfillRef.current || !projectId) return;
    if (!window.confirm("このプロジェクトのファイルボックスにある既存のファイル（Excel・Word・PDF・PowerPoint）から文字を取り出し、高度検索の対象にします。ファイルが多いと数分かかります。始めますか？")) return;
    backfillRef.current = true;
    let failed = 0;
    try {
      for (let round = 0; round < 200; round++) {
        const r = await backfillFileTexts(projectId);
        failed += r.failed;
        setBackfill({ done: r.total - r.remaining, total: r.total });
        if (r.remaining <= 0 || r.processed === 0) break;
      }
      toast(failed > 0 ? `ファイルの文字を取り出しました（取り出せなかったファイル：${failed}件。古い形式・画像だけのPDFなど）` : "ファイルの文字を取り出しました");
    } catch (e) {
      toast(e instanceof Error ? e.message : "ファイルの文字を取り出せませんでした", "error");
    } finally {
      backfillRef.current = false;
      setBackfill(null);
    }
  }, [projectId, toast]);

  const openSource = useCallback((s: ResearchSource) => {
    const path = sourcePath(slug, s);
    if (!path) { toast("この出典の画面を開けませんでした", "error"); return; }
    // ファイルの中（Excel・PDF など）では文を目立たせられないので、文は渡さない（ENHA2-056）
    navigate(path, s.quote && s.kind !== "file" ? { state: { researchQuote: s.quote } } : undefined);
  }, [slug, navigate, toast]);

  const selected = jobs.find(j => j.id === selectedId) ?? null;

  // ── ガード ─────────────────────────────────────────────────
  const accessBlocked = projectAccessView(notFound ? null : project, { userRole, userName, userOrgId });
  if (!loading && accessBlocked) return accessBlocked;

  const subNavPerm = (key: keyof UserPermissions | string): AccessLevel => {
    if (isAdmin) return "edit";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (projectPermissions as any)?.[key] as AccessLevel | undefined;
    return v ?? (projectPermissionsLoaded ? "none" : "view");
  };

  return (
    <div style={{ padding: 24, minWidth: 1100 }}>
      {/* パンくずと「APIキー管理」 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <button onClick={() => navigate("/projects")}
            style={{ color: GREEN, fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
          </button>
          <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
          <button onClick={() => navigate(`/${slug}`)}
            style={{ color: GREEN, fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
            {project?.name ?? projectSlug ?? ""}
          </button>
          <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
          <span style={{ color: "#1A1714", fontWeight: 600 }}>高度検索</span>
        </div>
        {isAdmin && project && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={() => void handleBackfill()} disabled={!!backfill}
              title="ファイルボックスに前からあるファイルの中の文字を取り出して、高度検索の対象にします"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12, fontWeight: 700, color: "#6B6458", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 8, cursor: backfill ? "not-allowed" : "pointer" }}>
              {backfill ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} /> : <FolderOpen style={{ width: 13, height: 13 }} />}
              {backfill ? `ファイルの文字を取り出し中（${backfill.done} / ${backfill.total}）` : "既存ファイルの文字を取り出す"}
            </button>
            <button type="button" onClick={() => setKeysDialog(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12, fontWeight: 700, color: PURPLE, background: "#FFFFFF", border: "1px solid rgba(124,58,237,0.25)", borderRadius: 8, cursor: "pointer" }}>
              <KeyRound style={{ width: 13, height: 13 }} /> APIキー管理
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18, gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>高度検索</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            議事録・Wiki・チケット・コメント・バックログ・ファイルボックスのファイルを、AI がまとめて調べてレポートにします
          </p>
        </div>
        <ProjectSubNav projectSlug={slug} active="research" marginBottom={0}
          wikiPerm={subNavPerm("wikiPermission")} backlogPerm={subNavPerm("backlogPermission")}
          minutesPerm={subNavPerm("minutesPermission")} whiteboardPerm={subNavPerm("whiteboardPermission")} />
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* 過去の調査 */}
        <aside style={{ width: 260, flexShrink: 0, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", fontSize: 12, fontWeight: 700, color: "#6B6458", borderBottom: "1px solid rgba(26,23,20,0.06)" }}>過去の調査</div>
          <div style={{ maxHeight: "calc(100vh - 260px)", overflowY: "auto" }}>
            {!jobsLoaded ? (
              <div style={{ padding: 16, display: "flex", justifyContent: "center" }}><Loader2 className="animate-spin" style={{ width: 16, height: 16, color: "#9E9690" }} /></div>
            ) : jobs.length === 0 ? (
              <p style={{ padding: "16px 14px", fontSize: 12, color: "#9E9690" }}>まだ調査はありません</p>
            ) : jobs.map(j => {
              const active = j.id === selectedId;
              return (
                <button key={j.id} type="button" onClick={() => { setSelectedId(j.id); setView("report"); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderBottom: "1px solid rgba(26,23,20,0.05)", background: active ? "#ECFDF5" : "transparent", cursor: "pointer" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={j.question}>{j.question}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, gap: 6 }}>
                    <span style={{ fontSize: 10.5, color: "#9E9690" }}>{formatDateTime(j.createdAt)}</span>
                    <StatusBadge status={j.status} />
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* 質問の入力 */}
          <section style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: 18 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#6B6458" }}>調べたいこと</label>
            <textarea ref={questionRef} value={question} onChange={e => setQuestion(e.target.value)}
              onKeyDown={submitOnModEnter(() => { void handleCopy(); }, { enabled: canCopy })}
              placeholder="例：ログイン方式はいつ、どう決まった？"
              rows={4}
              style={{ display: "block", width: "100%", marginTop: 8, padding: "12px 14px", fontSize: 14, lineHeight: 1.7, border: "1px solid rgba(26,23,20,0.14)", borderRadius: 10, resize: "vertical", color: "#1A1714", background: "#FFFFFF" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 12 }}>
              <p style={{ fontSize: 11.5, color: "#9E9690" }}>
                コピーしたプロンプトを、ターミナルで動く AI（Claude Code・Gemini CLI など）に貼って実行してください。⌘/Ctrl+Enter でもコピーできます。
              </p>
              <button type="button" onClick={() => void handleCopy()} disabled={!canCopy}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px", fontSize: 13, fontWeight: 700, color: "#FFFFFF", background: GREEN, border: "none", borderRadius: 10, cursor: canCopy ? "pointer" : "not-allowed", opacity: canCopy ? 1 : 0.45, whiteSpace: "nowrap", flexShrink: 0 }}>
                {copying ? <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
                プロンプトを生成してコピー
              </button>
            </div>
          </section>

          {jobsError && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "12px 14px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 10, fontSize: 12.5, color: "#B91C1C" }}>
              <AlertTriangle style={{ width: 15, height: 15, flexShrink: 0, marginTop: 1 }} />{jobsError}
            </div>
          )}

          {/* 結果 */}
          {jobsLoaded && !jobsError && jobs.length === 0 ? (
            <FirstGuide onExample={q => { setQuestion(q); questionRef.current?.focus(); }} />
          ) : selected ? (
            <ResultPanel job={selected} view={view} onView={setView} onSource={openSource} onCancel={job => void handleCancel(job)} />
          ) : null}
        </div>
      </div>

      {/* 処理中のモーダル（AI が research-start を送った時点で出る） */}
      {runningJob && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.35)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div role="dialog" aria-modal="true" style={{ width: "min(92vw, 460px)", background: "#FFFFFF", borderRadius: 16, padding: "26px 26px 20px", boxShadow: "0 24px 80px rgba(0,0,0,0.22)", textAlign: "center" }}>
            <Loader2 className="animate-spin" style={{ width: 30, height: 30, color: PURPLE, margin: "0 auto" }} />
            <p style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", marginTop: 14 }}>AI が調べています…</p>
            <p style={{ fontSize: 12.5, color: "#4B4640", marginTop: 10, lineHeight: 1.7, background: "#FAFAF8", borderRadius: 8, padding: "10px 12px", textAlign: "left", maxHeight: 120, overflowY: "auto", whiteSpace: "pre-wrap" }}>{runningJob.question}</p>
            <p style={{ fontSize: 12, color: "#9E9690", marginTop: 10, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Clock style={{ width: 12, height: 12 }} /> 経過時間 {formatElapsed(runningJob.startedAt, now)}
            </p>
            <div style={{ marginTop: 18 }}>
              <button type="button" onClick={() => void handleCancel(runningJob)}
                style={{ padding: "9px 18px", fontSize: 12.5, fontWeight: 700, color: "#6B6458", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 9, cursor: "pointer" }}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* キーが無いとき */}
      {keyConfirm && (
        <div onClick={() => !issuing && setKeyConfirm(false)} style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.35)", zIndex: 410, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" style={{ width: "min(92vw, 440px)", background: "#FFFFFF", borderRadius: 16, padding: 24, boxShadow: "0 24px 80px rgba(0,0,0,0.22)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <KeyRound style={{ width: 18, height: 18, color: PURPLE }} />
              <p style={{ fontSize: 15, fontWeight: 800, color: "#1A1714" }}>APIキーを発行しますか？</p>
            </div>
            <p style={{ fontSize: 12.5, color: "#4B4640", marginTop: 12, lineHeight: 1.8 }}>
              AI が Dev Ticket の資料を読むために、あなた用の「読み取りのみ」のAPIキー（名前：高度検索用、期限：90日）を発行します。
              キーはプロンプトに入り、AI はあなたが見られる資料だけを読めます。
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button type="button" onClick={() => setKeyConfirm(false)} disabled={issuing}
                style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 700, color: "#6B6458", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 9, cursor: issuing ? "not-allowed" : "pointer" }}>
                やめる
              </button>
              <button type="button" onClick={() => void handleIssueAndCopy()} disabled={issuing}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, color: "#FFFFFF", background: GREEN, border: "none", borderRadius: 9, cursor: issuing ? "not-allowed" : "pointer", opacity: issuing ? 0.6 : 1 }}>
                {issuing && <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />}発行する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* クリップボードへ書き込めなかったとき */}
      {manualCopyText !== null && (
        <div onClick={() => setManualCopyText(null)} style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.35)", zIndex: 410, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "min(92vw, 560px)", background: "#FFFFFF", borderRadius: 16, padding: 22 }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: "#1A1714" }}>自動でコピーできませんでした</p>
            <p style={{ fontSize: 12, color: "#6B6458", marginTop: 6 }}>下の欄を選んでコピーし、AI に貼ってください（調査は作成済みです）。</p>
            <textarea readOnly value={manualCopyText} onFocus={e => e.currentTarget.select()} autoFocus
              style={{ width: "100%", height: 180, marginTop: 10, padding: "10px 12px", fontSize: 11, fontFamily: "var(--font-mono)", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 9, color: "#4B4640", resize: "vertical" }} />
            <div style={{ textAlign: "right", marginTop: 10 }}>
              <button type="button" onClick={() => setManualCopyText(null)}
                style={{ padding: "8px 16px", fontSize: 12.5, fontWeight: 700, color: "#6B6458", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 9, cursor: "pointer" }}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {keysDialog && project && (
        <ApiIntegrationDialog keysOnly sprintId="" sprintName="" projectId={project.id} projectName={project.name}
          zIndexBase={420} onClose={() => setKeysDialog(false)} />
      )}
    </div>
  );
}

// ── はじめての方へ ───────────────────────────────────────────
function FirstGuide({ onExample }: { onExample: (q: string) => void }) {
  const steps: { no: string; title: string; body: string; icon: typeof Lightbulb }[] = [
    { no: "1", title: "調べたいことを書く", body: "上の欄に、知りたいことを文章で書きます。", icon: Lightbulb },
    { no: "2", title: "コピーして AI に貼る", body: "「プロンプトを生成してコピー」を押し、Claude Code などの AI に貼って実行します。", icon: Terminal },
    { no: "3", title: "結果がここに出る", body: "AI が調べ終わると、この場所に調査レポートが出ます。", icon: FileText },
  ];
  return (
    <section style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Telescope style={{ width: 18, height: 18, color: GREEN }} />
        <p style={{ fontSize: 15, fontWeight: 800, color: "#1A1714" }}>はじめての方へ</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 16 }}>
        {steps.map(s => (
          <div key={s.no} style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: 16, background: "#FAFAF8" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, background: GREEN, color: "#FFFFFF", fontSize: 12, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{s.no}</span>
              <s.icon style={{ width: 15, height: 15, color: GREEN }} />
            </div>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", marginTop: 10 }}>{s.title}</p>
            <p style={{ fontSize: 12, color: "#6B6458", marginTop: 6, lineHeight: 1.7 }}>{s.body}</p>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, fontWeight: 700, color: "#6B6458", marginTop: 20 }}>質問の例（押すと入力欄に入ります）</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {EXAMPLES.map(q => (
          <button key={q} type="button" onClick={() => onExample(q)}
            style={{ padding: "7px 12px", fontSize: 12.5, color: GREEN, background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.2)", borderRadius: 999, cursor: "pointer" }}>
            {q}
          </button>
        ))}
      </div>
      <ul style={{ marginTop: 18, paddingLeft: 18, fontSize: 12, color: "#6B6458", lineHeight: 1.9, listStyle: "disc" }}>
        <li>使える AI：ターミナルで動く AI（Claude Code、Gemini CLI など）。ブラウザ版の ChatGPT・Claude では使えません。</li>
        <li>初めてコピーするときは、APIキーの発行の案内が出ます。「発行する」を押すと、あなた用の読み取りのキーが作られます。</li>
      </ul>
    </section>
  );
}

// ── 結果 ─────────────────────────────────────────────────────
function SourcesList({ sources, onSource }: { sources: ResearchSource[]; onSource: (s: ResearchSource) => void }) {
  if (sources.length === 0) return <p style={{ fontSize: 12.5, color: "#9E9690" }}>出典はありません</p>;
  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      {sources.map(s => (
        <li key={s.no} id={`research-source-${s.no}`}>
          <button type="button" onClick={() => onSource(s)} title={s.quote ? `根拠：${s.quote}` : undefined}
            style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px", border: "none", borderRadius: 8, background: "transparent", cursor: "pointer", fontSize: 12.5, color: "#2C2824" }}>
            <span style={{ fontWeight: 800, color: GREEN, minWidth: 22 }}>[{s.no}]</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", background: "#F3F1EE", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>
              {RESEARCH_SOURCE_KIND_LABEL[s.kind] ?? s.kind}
            </span>
            <span style={{ flex: 1, minWidth: 0, color: GREEN, textDecoration: "underline", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
            {s.date && <span style={{ fontSize: 11, color: "#9E9690", whiteSpace: "nowrap" }}>{s.date}</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}

function ResultPanel({ job, view, onView, onSource, onCancel }: {
  job: ResearchJob; view: ResultView; onView: (v: ResultView) => void;
  onSource: (s: ResearchSource) => void; onCancel: (job: ResearchJob) => void;
}) {
  const citeNos = useMemo(() => new Set(job.sources.map(s => s.no)), [job.sources]);
  const cite = (no: number) => {
    const s = job.sources.find(x => x.no === no);
    if (s) onSource(s);
  };
  const box = { background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: 22 } as const;
  const head = (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 800, color: "#1A1714", whiteSpace: "pre-wrap" }}>{job.question}</p>
        <p style={{ fontSize: 11, color: "#9E9690", marginTop: 4 }}>{formatDateTime(job.createdAt)}</p>
      </div>
      <StatusBadge status={job.status} />
    </div>
  );

  if (job.status === "queued") {
    return (
      <section style={box}>
        {head}
        <p style={{ fontSize: 12.5, color: "#6B6458", lineHeight: 1.8 }}>
          AI が調べ始めるのを待っています。コピーしたプロンプトを、ターミナルで動く AI に貼って実行してください。始まると「処理中」の表示に切り替わります。
        </p>
        <button type="button" onClick={() => onCancel(job)}
          style={{ marginTop: 12, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "#6B6458", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 8, cursor: "pointer" }}>
          この調査をキャンセル
        </button>
      </section>
    );
  }
  if (job.status === "running") {
    return <section style={box}>{head}<p style={{ fontSize: 12.5, color: "#6B6458" }}>AI が調べています…</p></section>;
  }
  if (job.status === "cancelled") {
    return <section style={box}>{head}<p style={{ fontSize: 12.5, color: "#9E9690" }}>この調査はキャンセルしました。</p></section>;
  }
  if (job.status === "failed") {
    return (
      <section style={box}>
        {head}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "12px 14px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 10, fontSize: 12.5, color: "#B91C1C", whiteSpace: "pre-wrap" }}>
          <AlertTriangle style={{ width: 15, height: 15, flexShrink: 0, marginTop: 1 }} />
          <span>AI が調べられませんでした。理由：{job.error || "（理由が送られていません）"}</span>
        </div>
      </section>
    );
  }

  const tabBtn = (v: ResultView, label: string) => (
    <button type="button" onClick={() => onView(v)}
      style={{ padding: "6px 14px", fontSize: 12, fontWeight: 700, border: "none", borderRadius: 7, cursor: "pointer", background: view === v ? GREEN : "transparent", color: view === v ? "#FFFFFF" : "#6B6458" }}>
      {label}
    </button>
  );
  const sectionTitle = (t: string) => (
    <div style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", margin: "18px 0 8px", paddingBottom: 4, borderBottom: "1px solid rgba(26,23,20,0.08)" }}>{t}</div>
  );

  return (
    <section style={box}>
      {head}
      <div style={{ display: "inline-flex", gap: 2, padding: 3, background: "#F3F1EE", borderRadius: 9, marginBottom: 16 }}>
        {tabBtn("report", "レポート型")}
        {tabBtn("short", "短い回答型")}
      </div>
      {view === "report" ? (
        <>
          <ResearchMarkdown markdown={stripSourcesSection(job.result ?? "")} citeNos={citeNos} onCite={cite} />
          {sectionTitle("出典")}
        </>
      ) : (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", margin: "0 0 8px", paddingBottom: 4, borderBottom: "1px solid rgba(26,23,20,0.08)" }}>回答</div>
          <ResearchMarkdown markdown={stripSourcesSection(job.resultShort ?? "")} citeNos={citeNos} onCite={cite} />
          {sectionTitle("出典")}
        </>
      )}
      <SourcesList sources={job.sources} onSource={onSource} />
    </section>
  );
}
