// ============================================================
// API連携: 外部のAI／システムから Dev Ticket を操作する公開API
//
//   GET  /api/v1/context   … 登録に必要な文脈（スプリント／メンバー／分類／候補値）
//   POST /api/v1/tickets   … チケットの登録（親子1階層まで）
//
// 認証は Dev Ticket が発行する APIキー:
//   Authorization: Bearer dvt_live_xxxxx
//
// ★ このファイルは意図的に「自己完結」させている ★
//   Vercel のサーバー関数(api/配下)は src/ フォルダを同梱しないため、src から import すると
//   デプロイ後に ERR_MODULE_NOT_FOUND でクラッシュする（api/ml/recommend.ts と同じ事情）。
//   そのため Markdown→HTML 変換・ステータスの写像・WBS採番を、このファイル内に持たせている。
//   複数エンドポイントを1ファイルに収めているのも、認証処理を複製しないため
//   （Vercel の [resource] 動的セグメント。api/project-files/[action].ts と同じ形）。
//
//   ⚠️ 変更したら、対応する以下も合わせて確認すること:
//     ・src/app/lib/mdTickets/parse.ts        （ステータス／優先度の写像）
//     ・src/app/lib/bulkTicketInsert.ts       （登録するカラムと通知）
//     ・src/app/lib/apiKeyPrompt.ts           （AIに渡す仕様書。ここと食い違うとAIが失敗する）
//     ・supabase/add_api_keys.sql             （reserve_ticket_wbs / consume_api_key_rate）
// ============================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

// ── 定数 ──────────────────────────────────────────────────────
const KEY_PREFIX = "dvt_live_";
/** 1キーあたり: RATE_WINDOW_SEC 秒間に RATE_LIMIT 回まで */
const RATE_LIMIT = 60;
const RATE_WINDOW_SEC = 60;
/** 1リクエストで作れる親チケット数 */
const MAX_PARENTS_PER_REQUEST = 200;
/** 親1件あたりの子チケット数 */
const MAX_CHILDREN_PER_PARENT = 50;
const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 100_000;

// ── ステータス／優先度の写像（src/app/lib/mdTickets/parse.ts と同じ内容） ──
const STATUS_LABELS = ["未着手", "進行中", "レビュー中", "レビュー完了", "STG完了", "UAT完了", "クローズ"];
const PRIORITY_LABELS = ["高", "中", "低"];

const STATUS_BY_LABEL: Record<string, string> = {
  "未着手": "todo",
  "進行中": "in-progress",
  "レビュー中": "in-review",
  "レビュー完了": "review-done",
  "stg完了": "stg-test",
  "uat完了": "uat",
  "クローズ": "closed",
  // AI が英語で返した場合の受け皿
  todo: "todo", notstarted: "todo", inprogress: "in-progress", inreview: "in-review",
  reviewdone: "review-done", stg: "stg-test", stgtest: "stg-test", uat: "uat",
  closed: "closed", done: "closed",
};

const PRIORITY_BY_LABEL: Record<string, string> = {
  "高": "high", "中": "medium", "低": "low",
  high: "high", medium: "medium", low: "low", normal: "medium", mid: "medium",
  "緊急": "high", "最高": "high", "最低": "low",
};

const STATUS_PROGRESS: Record<string, number> = {
  todo: 0, "in-progress": 10, "in-review": 30, "review-done": 50,
  "stg-test": 70, uat: 90, done: 100, closed: 100,
  "waiting-release": 100, released: 100, "on-hold": 0, withdrawn: 0,
};

/** 全角→半角・大文字小文字・記号を落として突き合わせる */
function normalizeValue(raw: string): string {
  return raw
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[\s　_\-/():：（）]/g, "");
}

// ── 日付・工数 ────────────────────────────────────────────────
/** "2026/08/03" "2026-8-3" "20260803" → "2026-08-03"。読めなければ null */
function parseDate(raw: string): string | null {
  const s = raw.trim().replace(/[年月]/g, "/").replace(/日$/, "");
  let m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const yy = Number(y), mm = Number(mo), dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** "4" "4h" "4時間" "4.5" → 数値。読めなければ null */
function parseHours(raw: unknown): number | null {
  if (typeof raw === "number") return isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const m = raw.replace(/[Ａ-Ｚａ-ｚ０-９．]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// ── Markdown → HTML（TipTap スキーマ準拠の最小サブセット） ────
// 対応: 段落 / 太字 / 斜体 / 打消し / インラインコード / リンク /
//       箇条書き / 番号付きリスト / 引用 / コードブロック / 水平線 / 見出し
// ※ AI に渡す仕様（apiKeyPrompt.ts）で「本文は太字ラベル＋段落＋箇条書き」に
//    寄せているため、表や入れ子リストまでは対応しない（そのまま段落になる）。
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function safeHref(href: string): string | null {
  const s = href.trim();
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  return s;
}

// コード（`…`）を一時退避するときの目印。本文に絶対に現れない NUL を使う。
const CODE_MARK = "\u0000";

/** インライン装飾を HTML へ。エスケープはこの中で行う。 */
function inlineToHtml(text: string): string {
  // 先にコード（`...`）を退避しておく。中身は装飾解釈をしない。
  const codes: string[] = [];
  let s = text.split(CODE_MARK).join("").replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${esc(code)}</code>`);
    return `${CODE_MARK}${codes.length - 1}${CODE_MARK}`;
  });

  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const h = safeHref(href.replace(/&amp;/g, "&"));
    return h ? `<a href="${esc(h)}">${label}</a>` : label;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");

  return s.replace(new RegExp(CODE_MARK + "(\\d+)" + CODE_MARK, "g"), (_m, i: string) => codes[Number(i)] ?? "");
}

// export しているのは検証用（scripts から直接呼んで出力を確認できるようにするため）。
// ルーティングには影響しない（Vercel が見るのは default export のみ）。
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p>${para.map(inlineToHtml).join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    out.push(`<${tag}>${list.items.map(t => `<li><p>${inlineToHtml(t)}</p></li>`).join("")}</${tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    out.push(`<blockquote><p>${quote.map(inlineToHtml).join("<br>")}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // コードブロック
    const fence = trimmed.match(/^(`{3,}|~{3,})\s*(\S*)/);
    if (fence) {
      flushAll();
      const marker = fence[1][0];
      const lang = fence[2] || "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      out.push(`<pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }

    if (trimmed === "") { flushAll(); continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushAll(); out.push("<hr>"); continue; }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      out.push(`<h${heading[1].length}>${inlineToHtml(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    const bq = trimmed.match(/^>\s?(.*)$/);
    if (bq) { flushPara(); flushList(); quote.push(bq[1]); continue; }
    flushQuote();

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      flushPara();
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushPara();
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(ordered[1]);
      continue;
    }

    flushList();
    para.push(trimmed);
  }

  flushAll();
  return out.join("");
}

// ── Supabase ─────────────────────────────────────────────────
function admin(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface ApiKeyRow {
  id: string;
  name: string;
  project_id: string;
  organization_id: string | null;
  created_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

type AuthResult =
  | { ok: true; key: ApiKeyRow }
  | { ok: false; status: number; error: string };

/**
 * Authorization ヘッダの APIキーを検証する。
 *
 * service_role で接続するため RLS は効かない。ここで引いた key.project_id が
 * 唯一のテナント境界になるので、この先の処理は必ず project_id で絞ること。
 */
async function authenticate(sb: SupabaseClient, req: any): Promise<AuthResult> {
  const header: string = req.headers?.authorization || req.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    return { ok: false, status: 401, error: "APIキーがありません。Authorization: Bearer <APIキー> を付けてください" };
  }
  if (!token.startsWith(KEY_PREFIX)) {
    return { ok: false, status: 401, error: `APIキーの形式が正しくありません（${KEY_PREFIX}… で始まります）` };
  }

  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const { data: key } = await sb
    .from("api_keys")
    .select("id, name, project_id, organization_id, created_by, expires_at, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();

  if (!key) return { ok: false, status: 401, error: "APIキーが無効です" };
  if (key.revoked_at) return { ok: false, status: 401, error: "このAPIキーは失効しています" };
  if (key.expires_at && new Date(key.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 401, error: "このAPIキーは有効期限が切れています" };
  }

  // レート制限（last_used_at の更新もここで行われる）
  const { data: allowed, error: rateError } = await sb.rpc("consume_api_key_rate", {
    p_key_id: key.id,
    p_limit: RATE_LIMIT,
    p_window_seconds: RATE_WINDOW_SEC,
  });
  if (rateError) {
    return { ok: false, status: 500, error: `レート制限の判定に失敗しました: ${rateError.message}` };
  }
  if (allowed === false) {
    return { ok: false, status: 429, error: `リクエストが多すぎます（${RATE_WINDOW_SEC}秒あたり${RATE_LIMIT}回まで）。少し待ってから再試行してください` };
  }

  return { ok: true, key: key as ApiKeyRow };
}

// ── プラン上限 ────────────────────────────────────────────────
async function fetchPlanLimits(sb: SupabaseClient, organizationId: string | null) {
  if (!organizationId) return { maxTicketsPerSprint: null as number | null, featureBulkCreate: true };
  const { data: org } = await sb.from("organizations").select("plan_id").eq("id", organizationId).maybeSingle();
  if (!org?.plan_id) return { maxTicketsPerSprint: null as number | null, featureBulkCreate: true };
  const { data: plan } = await sb
    .from("plans").select("max_tickets_per_sprint, feature_bulk_create").eq("id", org.plan_id).maybeSingle();
  return {
    maxTicketsPerSprint: (plan?.max_tickets_per_sprint as number | null) ?? null,
    featureBulkCreate: (plan?.feature_bulk_create as boolean | undefined) ?? true,
  };
}

// ── 入力の型 ──────────────────────────────────────────────────
interface TicketInput {
  title?: unknown;
  status?: unknown;
  priority?: unknown;
  category?: unknown;
  assignee?: unknown;
  startDate?: unknown;
  dueDate?: unknown;
  estimatedHours?: unknown;
  description?: unknown;
  children?: unknown;
}

interface NormalizedTicket {
  title: string;
  status: string;
  priority: string;
  categoryId: string | null;
  assignee: string;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number;
  descriptionHtml: string | null;
  children: NormalizedTicket[];
}

interface NormalizeCtx {
  members: string[];
  categories: { id: string; name: string }[];
  warnings: string[];
}

function matchByName(raw: string, candidates: string[]): string | null {
  const exact = candidates.find(c => c === raw.trim());
  if (exact) return exact;
  const key = normalizeValue(raw);
  return candidates.find(c => normalizeValue(c) === key) ?? null;
}

/** 1件ぶんの入力を DB に入れられる形へ。読めなかった項目は warnings に積んで空欄にする。 */
function normalizeTicket(input: TicketInput, ctx: NormalizeCtx, isChild: boolean): NormalizedTicket | { error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { error: "title は必須です" };
  if (title.length > MAX_TITLE_LENGTH) return { error: `title が長すぎます（${MAX_TITLE_LENGTH}文字まで）` };

  const warn = (m: string) => ctx.warnings.push(`「${title}」: ${m}`);

  let status = "todo";
  if (typeof input.status === "string" && input.status.trim()) {
    const mapped = STATUS_BY_LABEL[normalizeValue(input.status)];
    if (mapped) status = mapped;
    else warn(`ステータス「${input.status}」は候補にないため未着手にしました`);
  }

  let priority = "medium";
  if (typeof input.priority === "string" && input.priority.trim()) {
    const mapped = PRIORITY_BY_LABEL[normalizeValue(input.priority)];
    if (mapped) priority = mapped;
    else warn(`優先度「${input.priority}」は候補にないため中にしました`);
  }

  let categoryId: string | null = null;
  if (typeof input.category === "string" && input.category.trim()) {
    const matched = ctx.categories.find(c => c.name === input.category!.toString().trim())
      ?? ctx.categories.find(c => normalizeValue(c.name) === normalizeValue(input.category as string));
    if (matched) categoryId = matched.id;
    else warn(`分類「${input.category}」はこのプロジェクトに登録されていないため分類なしにしました`);
  }

  // sprint_tickets.assignee は text not null default ''。担当者なしは空文字で表す。
  let assignee = "";
  if (typeof input.assignee === "string" && input.assignee.trim()) {
    const matched = matchByName(input.assignee, ctx.members);
    if (matched) assignee = matched;
    else warn(`担当者「${input.assignee}」はプロジェクトのメンバーに見つからないため空欄にしました`);
  }

  let startDate: string | null = null;
  if (typeof input.startDate === "string" && input.startDate.trim()) {
    startDate = parseDate(input.startDate);
    if (!startDate) warn(`開始日「${input.startDate}」を日付として読めませんでした`);
  }

  let dueDate: string | null = null;
  if (typeof input.dueDate === "string" && input.dueDate.trim()) {
    dueDate = parseDate(input.dueDate);
    if (!dueDate) warn(`期限日「${input.dueDate}」を日付として読めませんでした`);
  }
  if (startDate && dueDate && dueDate < startDate) warn("期限日が開始日より前です");

  // estimated_hours は int 列。小数のまま送ると 400 になるので必ず整数へ丸める。
  let estimatedHours = 0;
  if (input.estimatedHours !== undefined && input.estimatedHours !== null && input.estimatedHours !== "") {
    const h = parseHours(input.estimatedHours);
    if (h === null) warn(`見積工数「${String(input.estimatedHours)}」を数値として読めませんでした`);
    else {
      const rounded = Math.max(0, Math.round(h));
      if (rounded !== h) warn(`見積工数「${String(input.estimatedHours)}」を ${rounded} 時間に丸めました`);
      estimatedHours = rounded;
    }
  }

  let descriptionHtml: string | null = null;
  if (typeof input.description === "string" && input.description.trim()) {
    if (input.description.length > MAX_DESCRIPTION_LENGTH) {
      return { error: `description が長すぎます（${MAX_DESCRIPTION_LENGTH}文字まで）` };
    }
    descriptionHtml = mdToHtml(input.description) || null;
  }

  const children: NormalizedTicket[] = [];
  if (!isChild && Array.isArray(input.children)) {
    if (input.children.length > MAX_CHILDREN_PER_PARENT) {
      return { error: `子チケットが多すぎます（1件あたり${MAX_CHILDREN_PER_PARENT}件まで）` };
    }
    for (const c of input.children) {
      const normalized = normalizeTicket((c ?? {}) as TicketInput, ctx, true);
      if ("error" in normalized) return normalized;
      children.push(normalized);
    }
  } else if (isChild && Array.isArray(input.children) && input.children.length > 0) {
    warn("子チケットの階層は1段までのため、孫チケットは無視しました");
  }

  return { title, status, priority, categoryId, assignee, startDate, dueDate, estimatedHours, descriptionHtml, children };
}

function newTicketId(): string {
  return `TKT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── GET /api/v1/context ──────────────────────────────────────
async function handleContext(sb: SupabaseClient, key: ApiKeyRow, res: any) {
  const [{ data: project }, { data: sprints }, { data: categories }] = await Promise.all([
    sb.from("projects").select("id, name, slug, members").eq("id", key.project_id).maybeSingle(),
    sb.from("sprints").select("id, name, identifier, start_date, end_date").eq("project_id", key.project_id).order("start_date"),
    sb.from("ticket_categories").select("id, name").eq("project_id", key.project_id).order("created_at"),
  ]);

  if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

  return res.status(200).json({
    project: { id: project.id, name: project.name, slug: project.slug },
    sprints: (sprints ?? []).map((s: any) => ({
      id: s.id, name: s.name, prefix: s.identifier,
      startDate: s.start_date, endDate: s.end_date,
    })),
    members: Array.isArray(project.members) ? project.members : [],
    categories: (categories ?? []).map((c: any) => c.name),
    statuses: STATUS_LABELS,
    priorities: PRIORITY_LABELS,
  });
}

// ── POST /api/v1/tickets ─────────────────────────────────────
async function handleCreateTickets(sb: SupabaseClient, key: ApiKeyRow, body: any, res: any) {
  const sprintId = typeof body?.sprintId === "string" ? body.sprintId.trim() : "";
  const sprintName = typeof body?.sprintName === "string" ? body.sprintName.trim() : "";
  if (!sprintId && !sprintName) {
    return res.status(400).json({ error: "sprintId（または sprintName）は必須です。GET /api/v1/context で確認できます" });
  }

  const rawTickets = body?.tickets;
  if (!Array.isArray(rawTickets) || rawTickets.length === 0) {
    return res.status(400).json({ error: "tickets は1件以上の配列で指定してください" });
  }
  if (rawTickets.length > MAX_PARENTS_PER_REQUEST) {
    return res.status(400).json({ error: `1回のリクエストで作れるのは${MAX_PARENTS_PER_REQUEST}件までです` });
  }

  // ── スプリントの特定（キーのプロジェクト内に限定する＝テナント境界） ──
  const { data: sprintRows, error: sprintError } = await sb
    .from("sprints").select("id, name, identifier").eq("project_id", key.project_id);
  if (sprintError) return res.status(500).json({ error: sprintError.message });

  const sprints = sprintRows ?? [];
  const sprint = sprintId
    ? sprints.find((s: any) => s.id === sprintId)
    : sprints.find((s: any) => s.name === sprintName)
      ?? sprints.find((s: any) => normalizeValue(s.name) === normalizeValue(sprintName));

  if (!sprint) {
    return res.status(404).json({
      error: sprintId
        ? "指定されたスプリントが、このAPIキーのプロジェクトに見つかりません"
        : `スプリント「${sprintName}」が見つかりません`,
      availableSprints: sprints.map((s: any) => ({ id: s.id, name: s.name })),
    });
  }

  // ── 文脈（メンバー・分類）と入力の正規化 ──
  const [{ data: project }, { data: categoryRows }] = await Promise.all([
    sb.from("projects").select("slug, members, organization_id").eq("id", key.project_id).maybeSingle(),
    sb.from("ticket_categories").select("id, name").eq("project_id", key.project_id),
  ]);

  const ctx: NormalizeCtx = {
    members: Array.isArray(project?.members) ? (project!.members as string[]) : [],
    categories: (categoryRows ?? []) as { id: string; name: string }[],
    warnings: [],
  };

  const tickets: NormalizedTicket[] = [];
  for (const raw of rawTickets) {
    const normalized = normalizeTicket((raw ?? {}) as TicketInput, ctx, false);
    if ("error" in normalized) return res.status(400).json({ error: normalized.error });
    tickets.push(normalized);
  }

  const total = tickets.reduce((n, t) => n + 1 + t.children.length, 0);

  // ── プラン上限（画面側と同じ判定をサーバーでも行う） ──
  const limits = await fetchPlanLimits(sb, key.organization_id ?? (project?.organization_id as string | null) ?? null);
  if (!limits.featureBulkCreate) {
    return res.status(403).json({ error: "現在のプランではAPIからのチケット作成をご利用いただけません" });
  }
  if (limits.maxTicketsPerSprint != null) {
    const { count } = await sb
      .from("sprint_tickets").select("id", { count: "exact", head: true }).eq("sprint_id", sprint.id);
    const current = count ?? 0;
    const remaining = Math.max(0, limits.maxTicketsPerSprint - current);
    if (total > remaining) {
      return res.status(403).json({
        error: `プランの上限数（${limits.maxTicketsPerSprint}件）を超えるため作成できません。残り作成可能件数: ${remaining}件（今回: ${total}件）`,
      });
    }
  }

  // ── WBS採番（DB側で直列化。並列に叩かれても番号が重複しない） ──
  const prefix = (sprint as any).identifier || "T";
  const { data: startNo, error: seqError } = await sb.rpc("reserve_ticket_wbs", {
    p_project_id: key.project_id,
    p_prefix: prefix,
    p_count: tickets.length,
  });
  if (seqError || typeof startNo !== "number") {
    return res.status(500).json({
      error: `WBSの採番に失敗しました: ${seqError?.message ?? "unknown"}。supabase/add_api_keys.sql が適用されているか確認してください`,
    });
  }

  // ── 行の組み立て（親子を1回の insert にまとめる） ──
  const rows: Record<string, unknown>[] = [];
  const created: { wbs: string; title: string; id: string }[] = [];
  const notifySource: { assignee: string; id: string; wbs: string; title: string }[] = [];

  const toRow = (t: NormalizedTicket, wbs: string, id: string, parentId: string | null) => ({
    id, sprint_id: sprint.id, wbs,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee,
    start_date: t.startDate,
    due_date: t.dueDate,
    estimated_hours: t.estimatedHours,
    progress: STATUS_PROGRESS[t.status] ?? 0,
    description: t.descriptionHtml,
    category_id: t.categoryId,
    created_by: key.created_by || null,
    images: [], parent_id: parentId,
  });

  let n = startNo;
  for (const parent of tickets) {
    const parentWbs = `${prefix}-${String(n++).padStart(3, "0")}`;
    const parentId = newTicketId();
    rows.push(toRow(parent, parentWbs, parentId, null));
    created.push({ wbs: parentWbs, title: parent.title, id: parentId });
    if (parent.assignee) notifySource.push({ assignee: parent.assignee, id: parentId, wbs: parentWbs, title: parent.title });

    // 新規作成した親なので既存の子は存在しない。枝番は1から振れる（既存仕様と同形式）
    let childNum = 1;
    for (const child of parent.children) {
      const childWbs = `${parentWbs}-${childNum++}`;
      const childId = newTicketId();
      rows.push(toRow(child, childWbs, childId, parentId));
      created.push({ wbs: childWbs, title: child.title, id: childId });
      if (child.assignee) notifySource.push({ assignee: child.assignee, id: childId, wbs: childWbs, title: child.title });
    }
  }

  const { error: insertError } = await sb.from("sprint_tickets").insert(rows);
  if (insertError) {
    return res.status(500).json({ error: `チケットの登録に失敗しました: ${insertError.message}` });
  }

  if (notifySource.length > 0) {
    await sb.from("notifications").insert(
      notifySource.map(t => ({
        user_name: t.assignee, type: "assign",
        title: "チケットが割り当てられました",
        body: `${t.wbs}: ${t.title}`,
        ticket_id: t.id, ticket_wbs: t.wbs, ticket_title: t.title,
        project_slug: project?.slug ?? null, is_read: false,
      })),
    );
  }

  return res.status(201).json({
    ok: true,
    count: created.length,
    sprint: { id: sprint.id, name: (sprint as any).name },
    created: created.map(c => ({ wbs: c.wbs, title: c.title })),
    warnings: ctx.warnings,
  });
}

// ── エントリポイント ──────────────────────────────────────────
export default async function handler(req: any, res: any) {
  // サーバー間通信が主だが、ブラウザから直接叩く連携もありうるので CORS を開けておく。
  // 認証は Cookie ではなく APIキーなので、オリジンを絞る意味は薄い。
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  const resource = String(req.query?.resource ?? "");
  if (resource !== "tickets" && resource !== "context") {
    return res.status(404).json({ error: `不明なエンドポイントです: /api/v1/${resource}（tickets / context のいずれか）` });
  }

  let sb: SupabaseClient;
  try { sb = admin(); } catch { return res.status(500).json({ error: "Supabase not configured" }); }

  const auth = await authenticate(sb, req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  if (resource === "context") {
    if (req.method !== "GET") return res.status(405).json({ error: "GET を使ってください" });
    return handleContext(sb, auth.key, res);
  }

  // resource === "tickets"
  if (req.method !== "POST") return res.status(405).json({ error: "POST を使ってください" });

  let body: any;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  } catch {
    return res.status(400).json({ error: "リクエストボディが JSON として読めません" });
  }

  try {
    return await handleCreateTickets(sb, auth.key, body, res);
  } catch (e: any) {
    return res.status(500).json({ error: `処理中にエラーが発生しました: ${e?.message ?? String(e)}` });
  }
}
