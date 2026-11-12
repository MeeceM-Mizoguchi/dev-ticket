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
//
// BRU25-015-3「使う AI」で「ブラウザの AI（Gemini・ChatGPT・Claude）」を選ぶと、APIキーを使わずに調べられる。
//   ①「資料をダウンロード」… その人が見られる資料をまとめた .md（POST /api/research/materials。AI ごとに必要なら分ける）
//   ②「プロンプトをコピー」… ブラウザの AI 用のプロンプト（APIキーは入らない）。このときに調査を待機中（mode = browser）で作る
//   ③ 利用者が AI に①を添付し、②を貼って送る
//   ④ AI の答えを貼って「結果を取り込む」… POST /api/research/import で読み取り、今と同じ結果の画面を出す
//   ブラウザの AI の調査は AI から状態が届かないので、定期の確認・処理中のモーダルの対象にしない。
//   ダウンロード・コピー・取り込みも ref で二重押しを防ぐ（BUG-05）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  FolderKanban, ChevronRight, Copy, KeyRound, Loader2, Telescope, Clock, AlertTriangle, Terminal, Lightbulb, FileText, FolderOpen,
  Globe, Download, ClipboardPaste, CheckCircle2, RefreshCw,
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
import { buildResearchPrompt, buildBrowserResearchPrompt } from "@/app/lib/apiAskPrompt";
import {
  listResearchJobs, createResearchJob, cancelResearchJob, isActiveResearch,
  RESEARCH_STATUS_META, RESEARCH_SOURCE_KIND_LABEL,
  fetchResearchMaterialsSummary, fetchResearchMaterialsFile, importResearchAnswer, BROWSER_AI_LABEL,
  type ResearchJob, type ResearchSource, type ResearchMode, type BrowserAi, type ResearchMaterialsSummary,
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

const BROWSER_AIS: BrowserAi[] = ["gemini", "chatgpt", "claude"];

/** 「約38万トークン」の形 */
function formatTokens(n: number): string {
  if (n >= 10_000) return `約${Math.round(n / 10_000).toLocaleString()}万トークン`;
  if (n >= 1_000) return `約${(Math.round(n / 1_000) / 10).toLocaleString()}万トークン`;
  return `約${n.toLocaleString()}トークン`;
}

/** 資料ファイルを保存させる（文字だけの .md） */
function saveTextFile(name: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

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

  // BRU25-015-3 使う AI（既定はターミナルの AI＝今までの動き）と、ブラウザの AI の手順
  const [mode, setMode] = useState<ResearchMode>("cli");
  const [browserAi, setBrowserAi] = useState<BrowserAi>("gemini");
  const [materials, setMaterials] = useState<ResearchMaterialsSummary | null>(null);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const materialsLoadingRef = useRef(false);
  const [downloading, setDownloading] = useState<{ done: number; total: number } | null>(null);
  const downloadingRef = useRef(false);
  const [browserCopying, setBrowserCopying] = useState(false);
  const browserCopyingRef = useRef(false);
  const importingRef = useRef(false);

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

  // ブラウザの AI の調査は AI から状態が届かない（画面で取り込む）ので、確かめる対象にしない
  const hasActive = jobs.some(j => isActiveResearch(j) && j.mode !== "browser");
  // 開いている間、待機中・処理中の調査があれば数秒ごとに確かめる
  useEffect(() => {
    if (!hasActive) return;
    const id = window.setInterval(() => { void loadJobs(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [hasActive, loadJobs]);

  const runningJob = jobs.find(j => j.status === "running" && j.mode !== "browser") ?? null;
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

  // ── ブラウザの AI（BRU25-015-3） ─────────────────────────────
  /** 資料の量と AI ごとの分け方を数える。BUG-02/03: 数え直しの間も、前の結果は隠さない */
  const loadMaterials = useCallback(async () => {
    if (materialsLoadingRef.current || !projectId) return;
    materialsLoadingRef.current = true;
    setMaterialsLoading(true);
    try {
      const r = await fetchResearchMaterialsSummary(projectId);
      if (r.ok) { setMaterials(r.summary); setMaterialsError(null); }
      else setMaterialsError(r.error);
    } finally {
      materialsLoadingRef.current = false;
      setMaterialsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (mode === "browser" && projectId && !materials && !materialsError) void loadMaterials();
  }, [mode, projectId, materials, materialsError, loadMaterials]);

  const browserFiles = materials?.plans[browserAi]?.files ?? 1;

  const handleDownload = useCallback(async () => {
    if (downloadingRef.current || !projectId) return;
    downloadingRef.current = true;
    try {
      let total = browserFiles;
      setDownloading({ done: 0, total });
      for (let part = 1; part <= total; part++) {
        const r = await fetchResearchMaterialsFile(projectId, browserAi, part);
        if (!r.ok) { toast(r.error, "error"); return; }
        // 数えたあとに資料が増減したときは、いまの分け方に合わせる
        total = r.file.total;
        setMaterials(r.summary);
        saveTextFile(r.file.name, r.file.content);
        setDownloading({ done: part, total });
        // 続けて保存すると、ブラウザが2つ目以降を止めることがあるので少し間を空ける
        if (part < total) await new Promise(resolve => window.setTimeout(resolve, 600));
      }
      toast(total > 1 ? `資料ファイルを ${total} つ保存しました` : "資料ファイルを保存しました");
    } finally {
      downloadingRef.current = false;
      setDownloading(null);
    }
  }, [projectId, browserAi, browserFiles, toast]);

  const canBrowserCopy = !!question.trim() && !!projectId && !!materials && !browserCopying;

  const handleBrowserCopy = useCallback(async () => {
    // BUG-05: 素早く2回押しても、調査が2件できないように ref で止める
    if (browserCopyingRef.current || !question.trim() || !projectId || !materials) return;
    browserCopyingRef.current = true;
    setBrowserCopying(true);
    try {
      const q = question.trim();
      const created = await createResearchJob({
        projectId, organizationId: project?.organizationId ?? userOrgId ?? null, userId, question: q, mode: "browser",
      });
      if (!created.ok) { toast(created.error, "error"); return; }
      const job = created.job;
      prevStatusRef.current.set(job.id, job.status);
      setJobs(prev => [job, ...prev]);
      setSelectedId(job.id);
      setView("report");
      const prompt = buildBrowserResearchPrompt({
        projectName: project?.name ?? slug, question: q, aiLabel: BROWSER_AI_LABEL[browserAi], files: materials.plans[browserAi].files,
      });
      const ok = await copyText(prompt);
      if (ok) toast("プロンプトをコピーしました");
      else setManualCopyText(prompt);
    } finally {
      browserCopyingRef.current = false;
      setBrowserCopying(false);
    }
  }, [question, projectId, materials, project?.organizationId, project?.name, userOrgId, userId, slug, browserAi, toast]);

  /** 貼られた答えを取り込む。取り込めなかったときは、画面に出す文を返す */
  const handleImport = useCallback(async (job: ResearchJob, answer: string): Promise<string | null> => {
    if (importingRef.current) return null;
    importingRef.current = true;
    try {
      const r = await importResearchAnswer({ projectId, jobId: job.id, answer });
      if (!r.ok) return r.error;
      toast("結果を取り込みました");
      await loadJobs();
      setSelectedId(job.id);
      setView("report");
      return null;
    } finally {
      importingRef.current = false;
    }
  }, [projectId, loadJobs, toast]);

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
                    <span style={{ fontSize: 10.5, color: "#9E9690", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {formatDateTime(j.createdAt)}
                      {j.mode === "browser" && (
                        <span title="ブラウザの AI で調べた調査" style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 700, color: "#2563EB", background: "#EFF6FF", borderRadius: 4, padding: "0 5px" }}>
                          <Globe style={{ width: 10, height: 10 }} />ブラウザ
                        </span>
                      )}
                    </span>
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
              onKeyDown={mode === "browser"
                ? submitOnModEnter(() => { void handleBrowserCopy(); }, { enabled: canBrowserCopy })
                : submitOnModEnter(() => { void handleCopy(); }, { enabled: canCopy })}
              placeholder="例：ログイン方式はいつ、どう決まった？"
              rows={4}
              style={{ display: "block", width: "100%", marginTop: 8, padding: "12px 14px", fontSize: 14, lineHeight: 1.7, border: "1px solid rgba(26,23,20,0.14)", borderRadius: 10, resize: "vertical", color: "#1A1714", background: "#FFFFFF" }} />

            {/* 使う AI（BRU25-015-3） */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#6B6458" }}>使う AI</span>
              <div role="radiogroup" aria-label="使う AI" style={{ display: "inline-flex", gap: 2, padding: 3, background: "#F3F1EE", borderRadius: 9 }}>
                {([
                  { v: "cli" as const, label: "ターミナルの AI（Claude Code など）", icon: Terminal },
                  { v: "browser" as const, label: "ブラウザの AI（Gemini・ChatGPT・Claude）", icon: Globe },
                ]).map(o => (
                  <button key={o.v} type="button" role="radio" aria-checked={mode === o.v} onClick={() => setMode(o.v)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: 12, fontWeight: 700, border: "none", borderRadius: 7, cursor: "pointer", background: mode === o.v ? GREEN : "transparent", color: mode === o.v ? "#FFFFFF" : "#6B6458" }}>
                    <o.icon style={{ width: 13, height: 13 }} />{o.label}
                  </button>
                ))}
              </div>
            </div>

            {mode === "browser" ? (
              <BrowserSteps
                materials={materials} materialsError={materialsError} materialsLoading={materialsLoading}
                onRecount={() => void loadMaterials()}
                ai={browserAi} onAi={setBrowserAi}
                downloading={downloading} onDownload={() => void handleDownload()}
                canCopy={canBrowserCopy} copying={browserCopying} onCopy={() => void handleBrowserCopy()}
                questionEmpty={!question.trim()}
              />
            ) : (
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
            )}
          </section>

          {jobsError && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "12px 14px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 10, fontSize: 12.5, color: "#B91C1C" }}>
              <AlertTriangle style={{ width: 15, height: 15, flexShrink: 0, marginTop: 1 }} />{jobsError}
            </div>
          )}

          {/* 結果 */}
          {jobsLoaded && !jobsError && jobs.length === 0 ? (
            <FirstGuide mode={mode} onExample={q => { setQuestion(q); questionRef.current?.focus(); }} />
          ) : selected ? (
            <ResultPanel key={selected.id} job={selected} view={view} onView={setView} onSource={openSource} onCancel={job => void handleCancel(job)} onImport={handleImport} />
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
function FirstGuide({ mode, onExample }: { mode: ResearchMode; onExample: (q: string) => void }) {
  const steps: { no: string; title: string; body: string; icon: typeof Lightbulb }[] = mode === "browser" ? [
    { no: "1", title: "調べたいことを書く", body: "上の欄に、知りたいことを文章で書きます。", icon: Lightbulb },
    { no: "2", title: "資料とプロンプトを AI に送る", body: "①資料をダウンロードし、②プロンプトをコピーして、Gemini などのブラウザの AI に添付・貼り付けて送ります。", icon: Globe },
    { no: "3", title: "答えを貼って取り込む", body: "AI の答えを全部コピーして貼り、「結果を取り込む」を押すと、ここに調査レポートが出ます。", icon: FileText },
  ] : [
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
        {mode === "browser" ? (
          <>
            <li>使える AI：ブラウザで使う Gemini・ChatGPT・Claude。APIキーの発行は要りません。</li>
            <li>資料は、選んだ AI のサービスに送られます。会社の決まりに沿って使ってください。</li>
          </>
        ) : (
          <>
            <li>使える AI：ターミナルで動く AI（Claude Code、Gemini CLI など）。ブラウザで使う AI は、上の「使う AI」で「ブラウザの AI」を選んでください。</li>
            <li>初めてコピーするときは、APIキーの発行の案内が出ます。「発行する」を押すと、あなた用の読み取りのキーが作られます。</li>
          </>
        )}
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

function ResultPanel({ job, view, onView, onSource, onCancel, onImport }: {
  job: ResearchJob; view: ResultView; onView: (v: ResultView) => void;
  onSource: (s: ResearchSource) => void; onCancel: (job: ResearchJob) => void;
  onImport: (job: ResearchJob, answer: string) => Promise<string | null>;
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

  // ブラウザの AI の待機中の調査は、③④の手順と答えの貼り付けの欄を出す（処理中のモーダルは出さない）
  if (job.status === "queued" && job.mode === "browser") {
    return (
      <section style={box}>
        {head}
        <BrowserImportPanel job={job} onImport={onImport} onCancel={onCancel} />
      </section>
    );
  }
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

// ── ブラウザの AI の手順（BRU25-015-3） ─────────────────────────
const stepNo = (n: string) => (
  <span style={{ width: 20, height: 20, borderRadius: 999, background: GREEN, color: "#FFFFFF", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</span>
);

function BrowserSteps({
  materials, materialsError, materialsLoading, onRecount, ai, onAi, downloading, onDownload, canCopy, copying, onCopy, questionEmpty,
}: {
  materials: ResearchMaterialsSummary | null; materialsError: string | null; materialsLoading: boolean; onRecount: () => void;
  ai: BrowserAi; onAi: (ai: BrowserAi) => void;
  downloading: { done: number; total: number } | null; onDownload: () => void;
  canCopy: boolean; copying: boolean; onCopy: () => void; questionEmpty: boolean;
}) {
  const files = materials?.plans[ai]?.files ?? 1;
  const c = materials?.counts;
  const btn = (enabled: boolean) => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, color: "#FFFFFF",
    background: GREEN, border: "none", borderRadius: 9, cursor: enabled ? "pointer" : "not-allowed", opacity: enabled ? 1 : 0.45, whiteSpace: "nowrap" as const,
  });
  const canDownload = !!materials && !downloading;
  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 注意書き */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.25)", borderRadius: 9, fontSize: 12, color: "#92400E", lineHeight: 1.7 }}>
        <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2 }} />
        <span>資料は、選んだ AI のサービスに送られます。会社の決まりに沿って使ってください。APIキーの発行は要りません。</span>
      </div>

      {/* 資料の量と、AI ごとの入る／分ける */}
      <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: "12px 14px", background: "#FAFAF8" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#6B6458" }}>資料の量（あなたが見られる資料をすべて入れます）</span>
          <button type="button" onClick={onRecount} disabled={materialsLoading}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", fontSize: 11, fontWeight: 700, color: "#6B6458", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 6, cursor: materialsLoading ? "not-allowed" : "pointer" }}>
            <RefreshCw className={materialsLoading ? "animate-spin" : undefined} style={{ width: 11, height: 11 }} />数え直す
          </button>
        </div>
        {materials && c ? (
          <>
            <p style={{ fontSize: 13, color: "#1A1714", marginTop: 8, lineHeight: 1.7 }}>
              <strong>{formatTokens(materials.totalTokens)}</strong>
              <span style={{ marginLeft: 12, color: "#4B4640" }}>
                議事録 {c.minutes.toLocaleString()}件・Wiki {c.wiki.toLocaleString()}ページ・チケット {c.ticket.toLocaleString()}件（コメント {c.comment.toLocaleString()}件）・バックログ {c.backlog.toLocaleString()}件・ファイル {c.file.toLocaleString()}件
              </span>
            </p>
            {materials.excluded.length > 0 && (
              <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 11, color: "#9E9690", lineHeight: 1.7, listStyle: "disc" }}>
                {materials.excluded.map(e => <li key={e.kind}>{e.reason}</li>)}
              </ul>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8 }}>
              {BROWSER_AIS.map(a => {
                const n = materials.plans[a]?.files ?? 1;
                return (
                  <div key={a} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ width: 64, fontWeight: 700, color: "#4B4640" }}>{BROWSER_AI_LABEL[a]}</span>
                    {n <= 1 ? (
                      <span style={{ color: GREEN, display: "inline-flex", alignItems: "center", gap: 4 }}><CheckCircle2 style={{ width: 13, height: 13 }} />1つのファイルで入ります</span>
                    ) : (
                      <span style={{ color: "#B45309", display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle style={{ width: 13, height: 13 }} />{n}つのファイルに分けます</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : materialsError ? (
          <p style={{ fontSize: 12, color: "#B91C1C", marginTop: 8 }}>資料の量を数えられませんでした：{materialsError}</p>
        ) : (
          <p style={{ fontSize: 12, color: "#9E9690", marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />資料の量を数えています…
          </p>
        )}
      </div>

      {/* 送る AI */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#6B6458" }}>送る AI</span>
        <div role="radiogroup" aria-label="送る AI" style={{ display: "inline-flex", gap: 2, padding: 3, background: "#F3F1EE", borderRadius: 9 }}>
          {BROWSER_AIS.map(a => (
            <button key={a} type="button" role="radio" aria-checked={ai === a} onClick={() => onAi(a)}
              style={{ padding: "5px 14px", fontSize: 12, fontWeight: 700, border: "none", borderRadius: 7, cursor: "pointer", background: ai === a ? GREEN : "transparent", color: ai === a ? "#FFFFFF" : "#6B6458" }}>
              {BROWSER_AI_LABEL[a]}
            </button>
          ))}
        </div>
      </div>

      {/* ①② */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {stepNo("1")}
          <button type="button" onClick={onDownload} disabled={!canDownload} style={btn(canDownload)}>
            {downloading ? <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> : <Download style={{ width: 14, height: 14 }} />}
            {downloading ? `保存しています（${downloading.done} / ${downloading.total}）` : files > 1 ? `資料をダウンロード（${files}ファイル）` : "資料をダウンロード"}
          </button>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {stepNo("2")}
          <button type="button" onClick={onCopy} disabled={!canCopy} style={btn(canCopy)}
            title={questionEmpty ? "調べたいことを書くと押せます" : undefined}>
            {copying ? <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
            プロンプトをコピー
          </button>
        </span>
      </div>
      <p style={{ fontSize: 11.5, color: "#9E9690", lineHeight: 1.7 }}>
        {questionEmpty ? "②は、調べたいことを書くと押せます。" : "②を押すと、調査が「待機中」で1件でき、下に答えを貼る欄が出ます。⌘/Ctrl+Enter でもコピーできます。"}
      </p>

      {/* ③④ */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12.5, color: "#4B4640", lineHeight: 1.7 }}>
        {stepNo("3")}
        <span>
          {BROWSER_AI_LABEL[ai]} を開いて、①のファイルを添付し、②を貼って送ります。
          {files > 1 && `ファイルを ${files} つに分けたときは、同じ会話に残りのファイルを順に添付して「続き」と送ります。`}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12.5, color: "#4B4640", lineHeight: 1.7 }}>
        {stepNo("4")}
        <span>AI の答えを全部コピーして、下の欄に貼り、「結果を取り込む」を押します。</span>
      </div>
    </div>
  );
}

function BrowserImportPanel({ job, onImport, onCancel }: {
  job: ResearchJob;
  onImport: (job: ResearchJob, answer: string) => Promise<string | null>;
  onCancel: (job: ResearchJob) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const canImport = !!answer.trim() && !importing;
  const submit = async () => {
    // BUG-05: 素早く2回押しても、取り込みを2回送らない
    if (importingRef.current || !answer.trim()) return;
    importingRef.current = true;
    setImporting(true);
    try {
      const err = await onImport(job, answer);
      setError(err);
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12.5, color: "#4B4640", lineHeight: 1.7 }}>
        {stepNo("3")}
        <span>ブラウザの AI を開いて、①の資料ファイルを添付し、②でコピーしたプロンプトを貼って送ります。ファイルを分けたときは、同じ会話に残りのファイルを順に添付して「続き」と送ります。</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {stepNo("4")}
        <label htmlFor={`research-answer-${job.id}`} style={{ fontSize: 12, fontWeight: 700, color: "#6B6458" }}>AI の答えを貼り付け</label>
      </div>
      <textarea id={`research-answer-${job.id}`} value={answer}
        onChange={e => { setAnswer(e.target.value); if (error) setError(null); }}
        onKeyDown={submitOnModEnter(() => { void submit(); }, { enabled: canImport })}
        placeholder="AI の答えを全部コピーして、ここに貼ってください（説明の文が付いたままでかまいません）"
        rows={8}
        style={{ display: "block", width: "100%", padding: "10px 12px", fontSize: 12.5, lineHeight: 1.6, fontFamily: "var(--font-mono)", border: `1px solid ${error ? "rgba(220,38,38,0.45)" : "rgba(26,23,20,0.14)"}`, borderRadius: 10, resize: "vertical", color: "#1A1714", background: "#FFFFFF" }} />
      {error && (
        <div role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 9, fontSize: 12.5, color: "#B91C1C", whiteSpace: "pre-wrap" }}>
          <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2 }} />{error}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <button type="button" onClick={() => onCancel(job)}
          style={{ padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "#6B6458", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 8, cursor: "pointer" }}>
          この調査をキャンセル
        </button>
        <button type="button" onClick={() => void submit()} disabled={!canImport}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 18px", fontSize: 13, fontWeight: 700, color: "#FFFFFF", background: GREEN, border: "none", borderRadius: 10, cursor: canImport ? "pointer" : "not-allowed", opacity: canImport ? 1 : 0.45 }}>
          {importing ? <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> : <ClipboardPaste style={{ width: 14, height: 14 }} />}
          結果を取り込む
        </button>
      </div>
    </div>
  );
}
