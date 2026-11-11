// ============================================================
// API連携: 外部のAI／システムから Dev Ticket を操作する公開API
//
//   GET  /api/v1/context        … 登録に必要な文脈（スプリント／メンバー／分類／候補値）
//   GET  /api/v1/tickets        … 既存チケットの一覧（子チケットを足す親を探すため）
//   POST /api/v1/tickets        … チケットの登録（親子1階層まで／既存チケットへの子の追加も可）
//   GET  /api/v1/ticket         … チケット1件の中身（本文・画像・添付・コメント・子チケット）
//   POST /api/v1/ticket-status  … ステータスを前へ進める（進行中〜クローズ／子は進行中・対応完了）
//   POST /api/v1/ticket-update  … 既存チケットの項目（タイトル・本文・担当者・日付・ステータスなど）を画面と同じく直す（ENHA2-057）
//   POST /api/v1/ticket-pull    … 外部で作ったプルリクエストをチケットへ紐づける
//   POST /api/v1/ticket-comment … AIの確認の質問をコメントとして登録し、起票者へ知らせる（BRU25-001）
//   GET  /api/v1/backlog        … バックログ項目の一覧（重複登録の防止用。BRU24-002）
//   POST /api/v1/backlog        … バックログ項目の登録（親子1段まで／フォルダ指定可。BRU24-002）
//
// PRの作成とマージを bot 名義で行うAPI（ticket-pull-create / ticket-merge）は、GitHub App の
// ヘルパーがある api/github/[resource].ts 側に置いている（BRU21-001）。「AIで実装」の手順書はそちらを使う。
//
// 下の3つは「AIがチケットを読み取って実装する」ためのもの。キーの権限（scope）で使える範囲が変わる:
//   write … 登録のみ（context / tickets / backlog の POST）    ← これまでに発行されたキーはすべてこれ
//   read  … 読み取りのみ（context / tickets の GET / ticket / backlog の GET）
//   full  … すべて（ticket-status / ticket-update / ticket-pull / ticket-comment はこの権限のみ）
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
//     ・src/app/lib/apiImplementPrompt.ts     （AIに渡す実装用の手順書。同上）
//     ・src/app/components/tickets/TicketDetailPanel.tsx（ステータス変更時の副作用。handleUpdateStatus と揃える）
//     ・supabase/add_api_keys.sql             （reserve_ticket_wbs / consume_api_key_rate）
//     ・supabase/add_api_key_scopes.sql       （api_keys.scope）
//     ・supabase/add_backlog_parent_attachments_BRU24-001.sql（reserve_backlog_ids / parent_item_id）
//     ・src/app/lib/apiKeyPrompt.ts / apiSamples.ts のバックログ登録用（BRU24-002。ここと食い違うとAIが失敗する）
// ============================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authenticateApiKey, SCOPE_LABEL, type ApiKeyRow } from "../_lib/apiKeyAuth.js";

// ── 定数 ──────────────────────────────────────────────────────
// キーの形式・権限（scope）・レート制限は api/_lib/apiKeyAuth.ts にある（api/github と共用。BRU21-001）
/** 1リクエストで送れる tickets[] の要素数 */
const MAX_PARENTS_PER_REQUEST = 200;
/** 親1件あたりの子チケット数（1リクエストで足せる数。既存の子の数は数えない） */
const MAX_CHILDREN_PER_PARENT = 50;
const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 100_000;
/** GET /api/v1/tickets の既定／最大の返却件数 */
const LIST_DEFAULT_LIMIT = 100;
const LIST_MAX_LIMIT = 500;
/** GET /api/v1/ticket で1チケットあたりに返すコメントの上限（新しいほうから） */
const MAX_COMMENTS_PER_TICKET = 200;

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

// 一覧（GET /api/v1/tickets）で返す表示名。DB には上の7種以外の値も入る
// （保留・取下・リリース待ちなど）ため、helpers.ts の TICKET_STATUSES と同じ日本語を持たせる。
const STATUS_LABEL_BY_VALUE: Record<string, string> = {
  todo: "未着手", "in-progress": "進行中", "in-review": "レビュー中", "review-done": "レビュー完了",
  "stg-test": "STG完了", uat: "UAT完了", done: "対応完了", closed: "クローズ",
  "waiting-release": "リリース待ち", released: "クローズ", "on-hold": "保留中", withdrawn: "取下",
};

const PRIORITY_LABEL_BY_VALUE: Record<string, string> = { high: "高", medium: "中", low: "低" };

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

/**
 * "2026-10-20" → その日の日本時間 0:00。started_at / released_at は時刻の列で、
 * 日付だけを送ると UTC の 0:00（日本時間 9:00）になるため、日本の日付として揃える。
 */
function jstStartOfDay(date: string): string {
  return `${date}T00:00:00+09:00`;
}

/** parseDate の結果が実在する日か（"2026-02-31" のような日は DB が受け付けず、登録全体が失敗するため） */
function isRealDate(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
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
// そのままの URL から作ったリンクを一時退避する目印。URL の中の * ~ を太字・打消しと読まないため
const URL_MARK = "\u0001";

// そのままの URL（エスケープ済みの文字列の上で探す）。URL に使える半角の文字だけを拾うので、
// 日本語・全角の文字（「）」「。」など）でそこで切れる。& は &amp; の形のときだけ含める（&quot; などで切る）
const BARE_URL_RE = /(?<![A-Za-z0-9])https?:\/\/(?:&amp;|[A-Za-z0-9\-._~:/?#[\]@!$'()*+,;=%])+/g;

/** URL の末尾の句読点・閉じかっこを外す。かっこは URL の中で閉じていないものだけ外す */
function trimUrlTail(url: string): string {
  let u = url;
  for (;;) {
    const last = u.slice(-1);
    if (/[.,;:!?'*~]/.test(last)) { u = u.slice(0, -1); continue; }
    if (last === ")" && (u.split("(").length < u.split(")").length)) { u = u.slice(0, -1); continue; }
    if (last === "]" && (u.split("[").length < u.split("]").length)) { u = u.slice(0, -1); continue; }
    return u;
  }
}

/**
 * そのままの URL を <a href="URL">URL</a> に変える（BRU24-005）。
 * 画面は文字と href が同じリンクだけを関連チケットのラベルにするので、文字は URL のまま変えない。
 * すでに <a> の中にあるものは触らない。作ったリンクは URL_MARK で退避して links に入れる。
 */
function linkBareUrls(s: string, links: string[]): string {
  return s.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/).map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(BARE_URL_RE, (m: string) => {
      const url = trimUrlTail(m);
      const rest = m.slice(url.length);
      if (!/^https?:\/\/[^/?#]/i.test(url)) return m;
      const h = safeHref(url.replace(/&amp;/g, "&"));
      if (!h) return m;
      links.push(`<a href="${esc(h)}">${url}</a>`);
      return `${URL_MARK}${links.length - 1}${URL_MARK}${rest}`;
    });
  }).join("");
}

/** インライン装飾を HTML へ。エスケープはこの中で行う。 */
function inlineToHtml(text: string): string {
  // 先にコード（`...`）を退避しておく。中身は装飾解釈をしない。
  const codes: string[] = [];
  let s = text.split(CODE_MARK).join("").split(URL_MARK).join("").replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${esc(code)}</code>`);
    return `${CODE_MARK}${codes.length - 1}${CODE_MARK}`;
  });

  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const h = safeHref(href.replace(/&amp;/g, "&"));
    return h ? `<a href="${esc(h)}">${label}</a>` : label;
  });
  // [文字](URL) の変換のあと。そのままの URL もリンクにする（コードは退避済みなので変わらない）
  const links: string[] = [];
  s = linkBareUrls(s, links);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");

  s = s.replace(new RegExp(URL_MARK + "(\\d+)" + URL_MARK, "g"), (_m, i: string) => links[Number(i)] ?? "");
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
  parentWbs?: unknown;
  parentId?: unknown;
  prLinkWaived?: unknown;
  actualHours?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
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
  /**
   * 既に登録されているチケットの配下へ子として足す場合の親の指定。
   * tickets[] の直下の要素にだけ意味がある（children の中に書いても無視する）。
   * 両方書かれていたら parentId を優先する。
   */
  parentWbs: string | null;
  parentId: string | null;
  /**
   * PR不要（sprint_tickets.pr_link_waived）。null は1件ずつの指定なし。
   * 指定なしのものは、リクエスト直下の prLinkWaived（それも無ければ false）で登録する。
   */
  prLinkWaived: boolean | null;
  /**
   * 完了済みの作業を後から登録するときの実績（BRU22-005）。null は指定なし。
   * 指定なしの項目は insert に列ごと含めない（本番DBに無い列を全件に足して登録が全滅した BRU21-002 の再発防止）。
   * actualHours → actual_work_hours、startedAt → started_at、completedAt → released_at（クローズのときだけ）
   */
  actualHours: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** 既存チケットの子を足すときに引いてくる親チケットの行 */
interface ParentRow {
  id: string;
  wbs: string;
  title: string;
  sprint_id: string;
  parent_id: string | null;
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

  // 既存チケットへの追加指定。children の中（isChild）に書かれていても親は決まっているので無視する。
  let parentWbs: string | null = null;
  let parentId: string | null = null;
  if (!isChild) {
    if (typeof input.parentWbs === "string" && input.parentWbs.trim()) parentWbs = input.parentWbs.trim();
    if (typeof input.parentId === "string" && input.parentId.trim()) parentId = input.parentId.trim();
  } else if (input.parentWbs !== undefined || input.parentId !== undefined) {
    warn("子チケットの中の parentWbs / parentId は使われません（親は既に決まっています）");
  }

  let prLinkWaived: boolean | null = null;
  if (typeof input.prLinkWaived === "boolean") prLinkWaived = input.prLinkWaived;
  else if (input.prLinkWaived !== undefined && input.prLinkWaived !== null) {
    warn(`prLinkWaived「${String(input.prLinkWaived)}」は true / false ではないため無視しました`);
  }

  // ── 実績（BRU22-005）。読めない・負・順番が逆の値は、その項目だけ無視して warnings に出す（登録は止めない）
  const given = (v: unknown) => v !== undefined && v !== null && v !== "";

  // actual_work_hours は小数を持てる列（画面の手入力も小数第1位まで書いている）。小数第1位に丸める
  let actualHours: number | null = null;
  if (given(input.actualHours)) {
    const h = parseHours(input.actualHours);
    if (h === null) warn(`実績工数「${String(input.actualHours)}」を数値として読めないため無視しました`);
    else if (h < 0) warn(`実績工数「${String(input.actualHours)}」が負の値のため無視しました`);
    else {
      actualHours = Math.round(h * 10) / 10;
      if (actualHours !== h) warn(`実績工数「${String(input.actualHours)}」を ${actualHours} 時間に丸めました`);
    }
  }

  const readDate = (v: unknown, label: string): string | null => {
    if (!given(v)) return null;
    const d = typeof v === "string" ? parseDate(v) : null;
    if (!d || !isRealDate(d)) {
      warn(`${label}「${String(v)}」を日付として読めないため無視しました`);
      return null;
    }
    return d;
  };
  const startedAt = readDate(input.startedAt, "着手日");
  let completedAt = readDate(input.completedAt, "完了日");
  if (completedAt && status !== "closed") {
    warn(`完了日「${String(input.completedAt)}」は、ステータスがクローズのときだけ登録します。無視しました`);
    completedAt = null;
  }
  if (completedAt && startedAt && completedAt < startedAt) {
    warn(`完了日「${String(input.completedAt)}」が着手日より前のため無視しました`);
    completedAt = null;
  }

  const children: NormalizedTicket[] = [];
  if (!isChild && (parentWbs || parentId)) {
    // 既存チケットの子として作るものに、さらに子は付けられない（階層は1段まで）
    if (Array.isArray(input.children) && input.children.length > 0) {
      return { error: `「${title}」: parentWbs／parentId を指定した要素に children は書けません（階層は1段までです）` };
    }
  } else if (!isChild && Array.isArray(input.children)) {
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

  return {
    title, status, priority, categoryId, assignee, startDate, dueDate,
    estimatedHours, descriptionHtml, children, parentWbs, parentId, prLinkWaived,
    actualHours, startedAt, completedAt,
  };
}

function newTicketId(): string {
  return `TKT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── GET /api/v1/context ──────────────────────────────────────
async function handleContext(sb: SupabaseClient, key: ApiKeyRow, res: any) {
  const [{ data: project }, { data: sprints }, { data: categories }, { data: folders }] = await Promise.all([
    sb.from("projects").select("id, name, slug, members").eq("id", key.project_id).maybeSingle(),
    sb.from("sprints").select("id, name, identifier, start_date, end_date").eq("project_id", key.project_id).order("start_date"),
    sb.from("ticket_categories").select("id, name").eq("project_id", key.project_id).order("created_at"),
    // バックログのフォルダ（POST /api/v1/backlog の folderId に使う。BRU24-002）
    sb.from("backlog_items").select("id, title, parent_id").eq("project_id", key.project_id).eq("is_folder", true)
      .order("rank", { ascending: true }).order("id", { ascending: true }),
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
    backlogFolders: (folders ?? []).map((f: any) => ({ id: f.id, name: f.title || "無題のフォルダ", parentId: f.parent_id ?? null })),
  });
}

// ── GET /api/v1/tickets ──────────────────────────────────────
//
// 既存チケットに子を足すには「どの親に付けるか」を呼び出し側が知っている必要がある。
// POST が受ける parentWbs / parentId は、ここで返す wbs / id をそのまま使える。
//
// 返すのは入れ子ではなくフラットな配列（parentWbs で親子が分かる）。
// 絞り込みの結果、親だけ／子だけが残ることがあり、入れ子だと表現できないため。
async function handleListTickets(sb: SupabaseClient, key: ApiKeyRow, query: any, res: any) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : Array.isArray(v) ? String(v[0] ?? "").trim() : "");
  const sprintIdQ = str(query?.sprintId);
  const sprintNameQ = str(query?.sprintName);
  const wbsQ = str(query?.wbs);
  const titleQ = str(query?.q);

  const rawLimit = Number(str(query?.limit));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), LIST_MAX_LIMIT)
    : LIST_DEFAULT_LIMIT;

  const { data: sprintRows, error: sprintError } = await sb
    .from("sprints").select("id, name, identifier").eq("project_id", key.project_id)
    .order("start_date", { ascending: true }).order("id", { ascending: true });
  if (sprintError) return res.status(500).json({ error: sprintError.message });

  const sprints = sprintRows ?? [];
  if (sprints.length === 0) return res.status(200).json({ count: 0, hasMore: false, tickets: [] });

  // スプリントの絞り込み。指定が無ければプロジェクト全体から探す
  let targetSprints = sprints;
  if (sprintIdQ) {
    targetSprints = sprints.filter((s: any) => s.id === sprintIdQ);
  } else if (sprintNameQ) {
    targetSprints = sprints.filter((s: any) => s.name === sprintNameQ);
    if (targetSprints.length === 0) {
      targetSprints = sprints.filter((s: any) => normalizeValue(s.name) === normalizeValue(sprintNameQ));
    }
  }
  if (targetSprints.length === 0) {
    return res.status(404).json({
      error: sprintIdQ
        ? "指定されたスプリントが、このAPIキーのプロジェクトに見つかりません"
        : `スプリント「${sprintNameQ}」が見つかりません`,
      availableSprints: sprints.map((s: any) => ({ id: s.id, name: s.name })),
    });
  }

  // BUG-01: .order() が無いとDBが毎回違う順序で返すため、wbs + id で安定ソートする
  let q = sb
    .from("sprint_tickets")
    .select("id, wbs, title, status, priority, assignee, sprint_id, parent_id")
    .in("sprint_id", targetSprints.map((s: any) => s.id))
    .order("wbs", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1);   // +1 は hasMore の判定用

  // wbs 指定は「そのチケットとその子」を返す（子を足す前に既存の子を確認できるように）。
  // or(...) は文字列をそのまま PostgREST へ渡すため、区切り記号を含む値は先に弾く。
  if (wbsQ) {
    if (!/^[A-Za-z0-9_-]+$/.test(wbsQ)) {
      return res.status(400).json({ error: `wbs の形式が正しくありません: ${wbsQ}` });
    }
    q = q.or(`wbs.eq.${wbsQ},wbs.like.${wbsQ}-%`);
  }
  if (titleQ) q = q.ilike("title", `%${titleQ}%`);

  const { data: rows, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const all = rows ?? [];
  const hasMore = all.length > limit;
  const page = hasMore ? all.slice(0, limit) : all;

  const sprintById = new Map(sprints.map((s: any) => [s.id, s]));
  const wbsById = new Map(page.map((t: any) => [t.id, t.wbs as string]));

  return res.status(200).json({
    count: page.length,
    hasMore,
    tickets: page.map((t: any) => ({
      id: t.id,
      wbs: t.wbs,
      title: t.title,
      status: STATUS_LABEL_BY_VALUE[t.status] ?? t.status,
      priority: PRIORITY_LABEL_BY_VALUE[t.priority] ?? t.priority,
      assignee: t.assignee || null,
      // 絞り込みで親が page に入らないこともあるので、その場合は wbs から親を切り出す
      parentWbs: t.parent_id ? (wbsById.get(t.parent_id) ?? String(t.wbs).replace(/-\d+$/, "")) : null,
      sprintId: t.sprint_id,
      sprintName: (sprintById.get(t.sprint_id) as any)?.name ?? null,
    })),
  });
}

// ── HTML → テキスト（AIに読ませるための逆変換） ───────────────
// 本文とコメントは TipTap の HTML で保存されている。そのまま返すとタグが大半を占めて
// 読みにくいので、Markdown 風のテキストへ直して返す。mdToHtml の完全な逆変換ではなく
// 「読んで内容が分かること」が目的（表は | 区切りの行、入れ子のリストは平らな箇条書きになる）。
// 画像は ![画像](URL) として本文中の位置に残し、URL は images にも集めて返す。

function decodeEntities(s: string): string {
  const fromCode = (n: number) => { try { return String.fromCodePoint(n); } catch { return ""; } };
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => fromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => fromCode(Number(d)))
    // &amp; は最後。先に戻すと "&amp;lt;" が "<" まで戻ってしまう
    .replace(/&amp;/g, "&");
}

/** タグの中から属性値を取り出す。data-src を src と取り違えないよう、直前は空白に限る */
function attrOf(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeEntities(m?.[1] ?? m?.[2] ?? "");
}

// export しているのは検証用（mdToHtml と同じ理由）。
export function htmlToText(html: string): { text: string; images: string[] } {
  const images: string[] = [];
  const blocks: string[] = [];

  let s = html.split(CODE_MARK).join("").replace(/\r\n?/g, "\n");

  // コードブロックは中の改行と字下げをそのまま残すため、先に退避する
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, body: string) => {
    const code = decodeEntities(body.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\n+$/, "");
    blocks.push("```\n" + code + "\n```");
    return `\n\n${CODE_MARK}${blocks.length - 1}${CODE_MARK}\n\n`;
  });

  // HTML ソース上の改行は空白と同じ意味しか持たない
  s = s.replace(/\n+/g, " ");

  s = s.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
    const src = attrOf(attrs, "src");
    if (!src) return "";
    // 貼り付けた画像が data: のまま入っている古い本文がある。返すと応答が数MBになるので捨てる
    if (/^data:/i.test(src)) return "（本文に直接埋め込まれた画像。URLが無いため取得できません）";
    images.push(src);
    return `![${attrOf(attrs, "alt") || "画像"}](${src})`;
  });

  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, label: string) => {
    const href = attrOf(attrs, "href");
    const text = label.replace(/<[^>]+>/g, "").trim();
    if (!href) return text;
    // 文字はエスケープされたまま（&amp; など）なので、戻してから href と比べる。比べないと URL が二重になる（BRU24-005）
    if (!text || decodeEntities(text) === href) return href;
    return `[${text}](${href})`;
  });

  s = s
    .replace(/<\/?(strong|b)\b[^>]*>/gi, "**")
    .replace(/<\/?(em|i)\b[^>]*>/gi, "*")
    .replace(/<\/?(s|del|strike)\b[^>]*>/gi, "~~")
    .replace(/<\/?code\b[^>]*>/gi, "`");

  // TipTap は <li><p>…</p></li> の形で出す。<p> を残すと項目ごとに空行が入るので剥がす（表のセルも同じ）
  s = s
    .replace(/<li\b([^>]*)>\s*<p\b[^>]*>/gi, "<li$1>").replace(/<\/p>\s*<\/li>/gi, "</li>")
    .replace(/<(td|th)\b([^>]*)>\s*<p\b[^>]*>/gi, "<$1$2>").replace(/<\/p>\s*<\/(td|th)>/gi, "</$1>");

  // 番号付きリストは番号を振り直す（入れ子でないものだけ。入れ子は下の箇条書きに落ちる）
  s = s.replace(/<ol\b[^>]*>((?:(?!<\/?[ou]l\b)[\s\S])*?)<\/ol>/gi, (_m, inner: string) => {
    let n = 0;
    return "\n\n" + inner.replace(/<li\b[^>]*>/gi, () => `\n${++n}. `) + "\n\n";
  });
  s = s.replace(/<li\b([^>]*)>/gi, (_m, attrs: string) => {
    const checked = attrOf(attrs, "data-checked");
    return checked === "true" ? "\n- [x] " : checked === "false" ? "\n- [ ] " : "\n- ";
  });

  s = s
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<blockquote\b[^>]*>/gi, "\n\n> ")
    .replace(/<hr\b[^>]*>/gi, "\n\n---\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<table\b[^>]*>/gi, "\n\n")
    .replace(/<tr\b[^>]*>/gi, "\n| ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(p|div|h[1-6]|blockquote|ul|ol|table)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");

  s = decodeEntities(s)
    .split("\n").map(line => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  s = s.replace(new RegExp(CODE_MARK + "(\\d+)" + CODE_MARK, "g"), (_m, i: string) => blocks[Number(i)] ?? "");
  return { text: s, images };
}

// ── チケットの解決（読み取り・ステータス更新で共通） ──────────
/** 画面（helpers.ts の STATUS_RANK）と同じ並び。「後ろへ戻さない」の判定に使う */
const STATUS_RANK: Record<string, number> = {
  todo: 0, "in-progress": 1, "in-review": 2, "review-done": 3,
  "stg-test": 4, uat: 5, done: 6, closed: 7, "waiting-release": 8, released: 9,
  "on-hold": -1, withdrawn: -2,
};

/** 子チケットの closed は画面で「対応完了」と呼んでいる（親の「クローズ」とは別の意味） */
function statusLabelFor(status: string, isChild: boolean): string {
  if (isChild && status === "closed") return "対応完了";
  return STATUS_LABEL_BY_VALUE[status] ?? status;
}

/** "T-012-2" と "T-012-10" を数値として比べる（文字列比較だと 10 が 2 より前に来る） */
function compareWbs(a: string, b: string): number {
  const as = String(a).split("-"), bs = String(b).split("-");
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const an = /^\d+$/.test(as[i]), bn = /^\d+$/.test(bs[i]);
    const d = an && bn ? Number(as[i]) - Number(bs[i]) : as[i].localeCompare(bs[i]);
    if (d !== 0) return d;
  }
  return as.length - bs.length;
}

type TicketLookup =
  | { ok: true; row: any; sprints: { id: string; name: string }[] }
  | { ok: false; status: number; error: string };

/**
 * WBS（または id）からチケットを1件引く。
 *
 * 引くのは「このAPIキーのプロジェクトに属するスプリント」の中だけ。
 * service_role 接続で RLS が効かないため、ここを絞らないと他テナントのチケットを
 * 読めたり、ステータスを書き換えられたりしてしまう。
 */
async function lookupTicket(
  sb: SupabaseClient, key: ApiKeyRow, ref: { wbs: string; id: string }, cols: string,
): Promise<TicketLookup> {
  if (!ref.wbs && !ref.id) return { ok: false, status: 400, error: "wbs（または id）は必須です" };
  if (ref.wbs && !/^[A-Za-z0-9_-]+$/.test(ref.wbs)) {
    return { ok: false, status: 400, error: `wbs の形式が正しくありません: ${ref.wbs}` };
  }

  const { data: sprintRows, error: sprintError } = await sb
    .from("sprints").select("id, name").eq("project_id", key.project_id);
  if (sprintError) return { ok: false, status: 500, error: sprintError.message };
  const sprints = (sprintRows ?? []) as { id: string; name: string }[];
  const label = ref.id || ref.wbs;
  const notFound: TicketLookup = {
    ok: false, status: 404,
    error: `チケット「${label}」がこのAPIキーのプロジェクトに見つかりません。GET /api/v1/tickets で探せます`,
  };
  if (sprints.length === 0) return notFound;

  let q = sb.from("sprint_tickets").select(cols).in("sprint_id", sprints.map(s => s.id));
  // 小文字で書かれたWBS（bru19-001）も受ける
  q = ref.id ? q.eq("id", ref.id) : q.in("wbs", [...new Set([ref.wbs, ref.wbs.toUpperCase()])]);
  const { data, error } = await q.order("id", { ascending: true }).limit(5);
  if (error) return { ok: false, status: 500, error: error.message };

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return notFound;
  const exact = ref.id ? rows : rows.filter(r => r.wbs === ref.wbs);
  const hit = exact.length > 0 ? exact : rows;
  if (hit.length > 1) {
    return {
      ok: false, status: 409,
      error: `WBS「${ref.wbs}」のチケットが複数あります。id で指定してください（${hit.map(r => r.id).join(" / ")}）`,
    };
  }
  return { ok: true, row: hit[0], sprints };
}

// ── GET /api/v1/ticket ───────────────────────────────────────
//
// AI がチケットを読み取って実装するためのもの。1回の呼び出しで
// 「そのチケット・親（子を指定した場合）・子チケット全部」の本文・画像・添付・コメントを返す。
// 人が画面からコピーして貼り直していた内容を、これ1つで渡せるようにしている。
//
// 画像と添付は public バケットの URL をそのまま返す（認証なしで GET できる）。
//
// 本文はAIが読みやすいテキスト（description）のほかに、保存されているHTML（descriptionHtml）も返す。
// POST /api/v1/ticket-update で本文を直すときは、descriptionHtml を直して送り返すと
// 画像・表・メンションが消えない（Markdown の変換は画像と表に対応していないため。ENHA2-057）。
// 修正できる項目の今の値（labels・releaseDate など）と、409 の判定に使う updatedAt もここで返す。
// 列はすべて本番DBにあることを確かめてある（closed_at は本番に無いので読まない）。
const DETAIL_COLS =
  "id, wbs, title, status, priority, assignee, start_date, due_date, estimated_hours, description, images, category_id, sprint_id, parent_id"
  + ", prefixes, pr_link_waived, reviewer_name, review_round, release_date, is_release_date_undecided"
  + ", is_operation_verified, actual_work_hours, actual_work_hours_breakdown, updated_at";

const urlList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && !!u && !/^data:/i.test(u)) : [];

// ── 関連チケット（BRU25-007） ──
// 本文・コメントで参照されている同じプロジェクトのチケットも、linkedTickets として一緒に返す。
// 拾うのは「#」から候補を選んだリンク（span class="ticket-mention" の data-id）と、
// 貼り付けたアプリのチケットURL（/プロジェクトのslug/WBS）の2つ。手で打っただけの「#BRU25-002」は拾わない。
/** 返す関連チケットの上限 */
const MAX_LINKED_TICKETS = 10;
/** 引きに行く WBS の上限（本文に大量のリンクがあっても問い合わせを膨らませない） */
const MAX_LINKED_CANDIDATES = 50;
/** 画面の判定（src/app/lib/appOrigin.ts の PRODUCTION_ORIGINS）と同じ本番のオリジン */
const PRODUCTION_APP_ORIGINS = ["https://dv-ticket.com", "https://www.dv-ticket.com"];
/** チケットのURLの WBS の形（src/app/lib/internalLink.ts の TICKET_SEGMENT_RE と同じ。使える文字は lookupTicket に合わせる） */
const LINKED_WBS_RE = /^[A-Za-z0-9_-]+-\d+$/;

/** HTML から、関連チケットとして参照されている WBS を出てきた順に拾う */
export function extractLinkedWbs(html: string, projectSlug: string, appOrigins: string[]): string[] {
  const out: string[] = [];
  if (!html) return out;
  const re = /<span\b([^>]*)>|https?:\/\/[^\s"'<>]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) {
      const attrs = m[1];
      if (!attrOf(attrs, "class").split(/\s+/).includes("ticket-mention")) continue;
      const id = attrOf(attrs, "data-id").trim();
      if (LINKED_WBS_RE.test(id)) out.push(id);
      continue;
    }
    let url: URL;
    try { url = new URL(decodeEntities(m[0])); } catch { continue; }
    if (!appOrigins.includes(url.origin.toLowerCase())) continue;
    const seg = url.pathname.split("/").filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
    if (seg.length !== 2 || !projectSlug || seg[0].toLowerCase() !== projectSlug.toLowerCase()) continue;
    if (LINKED_WBS_RE.test(seg[1])) out.push(seg[1]);
  }
  return out;
}

async function handleTicketDetail(sb: SupabaseClient, key: ApiKeyRow, query: any, res: any) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : Array.isArray(v) ? String(v[0] ?? "").trim() : "");
  const found = await lookupTicket(sb, key, { wbs: str(query?.wbs), id: str(query?.id) }, DETAIL_COLS);
  if (!found.ok) return res.status(found.status).json({ error: found.error });
  const row = found.row;

  // 子を指定されたら親を、親を指定されたら子を全部引く（階層は1段まで）
  const [{ data: project }, { data: categoryRows }, related] = await Promise.all([
    sb.from("projects").select("name, slug").eq("id", key.project_id).maybeSingle(),
    sb.from("ticket_categories").select("id, name").eq("project_id", key.project_id),
    row.parent_id
      ? sb.from("sprint_tickets").select(DETAIL_COLS).eq("id", row.parent_id).limit(1)
      : sb.from("sprint_tickets").select(DETAIL_COLS).eq("parent_id", row.id)
        .order("wbs", { ascending: true }).order("id", { ascending: true }),
  ]);
  if (related.error) return res.status(500).json({ error: related.error.message });

  const relatedRows = (related.data ?? []) as any[];
  const parentRow = row.parent_id ? (relatedRows[0] ?? null) : null;
  const childRows = row.parent_id ? [] : [...relatedRows].sort((a, b) => compareWbs(a.wbs, b.wbs));
  const all: any[] = [row, ...(parentRow ? [parentRow] : []), ...childRows];
  const ids = all.map(t => t.id as string);

  const commentsByTicket = new Map<string, any[]>();
  const attachByTicket = new Map<string, any[]>();
  /** チケットのコメント・添付を引いて、上の Map に足す。失敗したらエラー文を返す */
  const loadCommentsAndAttachments = async (ticketIds: string[]): Promise<string | null> => {
    if (ticketIds.length === 0) return null;
    // コメントは新しい順に引いて、チケットごとに上限で切ってから古い順へ戻す。
    // 古い順のまま引くと、行数の上限に当たったとき「最近のやり取り」のほうが落ちる。
    // status_change（ステータス変更の自動記録）は実装の材料にならないので返さない。
    const [commentsRes, attachRes] = await Promise.all([
      sb.from("ticket_comments").select("*").in("ticket_id", ticketIds).neq("comment_type", "status_change")
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1000),
      sb.from("ticket_attachments").select("*").in("ticket_id", ticketIds)
        .order("created_at", { ascending: true }).order("id", { ascending: true }),
    ]);
    if (commentsRes.error) return commentsRes.error.message;
    // 添付は後から足したテーブル（add_ticket_attachments.sql）。無い環境では添付なしとして続ける
    if (attachRes.error) console.error("[api/v1] attachments:", attachRes.error.message);
    for (const c of (commentsRes.data ?? []) as any[]) {
      const list = commentsByTicket.get(c.ticket_id) ?? [];
      list.push(c);
      commentsByTicket.set(c.ticket_id, list);
    }
    for (const a of (attachRes.data ?? []) as any[]) {
      const list = attachByTicket.get(a.ticket_id) ?? [];
      list.push(a);
      attachByTicket.set(a.ticket_id, list);
    }
    return null;
  };
  const loadError = await loadCommentsAndAttachments(ids);
  if (loadError) return res.status(500).json({ error: loadError });

  const origin = appPublicOrigin();
  const slug = String(project?.slug ?? "");

  // 関連チケット（BRU25-007）。応答に入るチケット（自分・親・子）の本文とコメントから拾い、
  // 同じプロジェクトのスプリントの中から引く。関連チケットの中のリンクはたどらない（1段まで）
  const appOrigins = Array.from(new Set([origin, ...PRODUCTION_APP_ORIGINS].filter(Boolean).map(o => o.toLowerCase())));
  const ownWbs = new Set(all.map(t => String(t.wbs).toUpperCase()));
  const candidates: string[] = [];
  const seenWbs = new Set<string>();
  for (const t of all) {
    const htmls = [String(t.description ?? ""), ...(commentsByTicket.get(t.id) ?? []).map(c => String(c.content ?? ""))];
    for (const html of htmls) {
      for (const w of extractLinkedWbs(html, slug, appOrigins)) {
        const key = w.toUpperCase();
        if (ownWbs.has(key) || seenWbs.has(key)) continue;
        seenWbs.add(key);
        candidates.push(w);
      }
    }
  }
  const lookupWbs = candidates.slice(0, MAX_LINKED_CANDIDATES);
  let linkedRows: any[] = [];
  let linkedMissing: string[] = [];
  if (lookupWbs.length > 0) {
    const { data: linkedData, error: linkedError } = await sb.from("sprint_tickets").select(DETAIL_COLS)
      .in("sprint_id", found.sprints.map(s => s.id))
      .in("wbs", Array.from(new Set(lookupWbs.flatMap(w => [w, w.toUpperCase()]))))
      .order("wbs", { ascending: true }).order("id", { ascending: true }); // BUG-01
    if (linkedError) return res.status(500).json({ error: linkedError.message });
    const byWbs = new Map<string, any>();
    for (const r of (linkedData ?? []) as any[]) {
      const k = String(r.wbs).toUpperCase();
      if (!byWbs.has(k)) byWbs.set(k, r);
    }
    linkedRows = lookupWbs.map(w => byWbs.get(w.toUpperCase())).filter(Boolean).slice(0, MAX_LINKED_TICKETS);
    linkedMissing = lookupWbs.filter(w => !byWbs.has(w.toUpperCase()));
  }
  const linkedLoadError = await loadCommentsAndAttachments(linkedRows.map(t => t.id as string));
  if (linkedLoadError) return res.status(500).json({ error: linkedLoadError });

  const sprintNameById = new Map(found.sprints.map(s => [s.id, s.name]));
  const categoryNameById = new Map(((categoryRows ?? []) as any[]).map(c => [c.id as string, c.name as string]));
  const wbsById = new Map([...all, ...linkedRows].map(t => [t.id as string, t.wbs as string]));

  const toView = (t: any) => {
    const isChild = !!t.parent_id;
    const body = htmlToText(String(t.description ?? ""));
    const allComments = commentsByTicket.get(t.id) ?? [];
    const comments = allComments.slice(0, MAX_COMMENTS_PER_TICKET).reverse().map(c => {
      const text = htmlToText(String(c.content ?? ""));
      return {
        id: c.id,
        author: c.user_name,
        type: c.comment_type,
        createdAt: c.created_at,
        replyTo: c.reply_to ?? null,
        body: text.text,
        images: [...new Set([...text.images, ...urlList(c.images)])],
      };
    });
    return {
      id: t.id,
      wbs: t.wbs,
      title: t.title,
      status: statusLabelFor(t.status, isChild),
      priority: PRIORITY_LABEL_BY_VALUE[t.priority] ?? t.priority,
      assignee: t.assignee || null,
      category: categoryNameById.get(t.category_id) ?? null,
      startDate: t.start_date ?? null,
      dueDate: t.due_date ?? null,
      estimatedHours: t.estimated_hours ?? 0,
      sprintName: sprintNameById.get(t.sprint_id) ?? null,
      parentWbs: isChild ? (wbsById.get(t.parent_id) ?? String(t.wbs).replace(/-\d+$/, "")) : null,
      url: origin && slug ? `${origin}/${encodeURIComponent(slug)}/${encodeURIComponent(t.wbs)}` : null,
      description: body.text,
      // 本文に貼られた画像と、画像欄に添付された画像の両方
      images: [...new Set([...body.images, ...urlList(t.images)])],
      attachments: (attachByTicket.get(t.id) ?? []).map(a => ({
        fileName: a.file_name, fileType: a.file_type, fileSize: a.file_size, url: a.file_url,
      })),
      comments,
      // 上限で落としたコメントの件数（古いほうから落ちる）
      commentsOmitted: Math.max(0, allComments.length - comments.length),
      // ── ここから下は POST /api/v1/ticket-update で直すときに使う今の値（ENHA2-057） ──
      // 保存されている本文のHTML（そのまま）。直すときはこれを直して descriptionHtml で送り返す
      descriptionHtml: String(t.description ?? ""),
      // 読んだ時点の更新日時。修正するときに updatedAt として送り返す（画面で直されていたら 409）
      updatedAt: t.updated_at ?? null,
      labels: Array.isArray(t.prefixes) ? t.prefixes.filter((p: unknown) => typeof p === "string") : [],
      prLinkWaived: t.pr_link_waived === true,
      // 本文の下の画像欄の画像だけ（images は本文に貼られた画像も含む）。外す・並べ替えるときに使う
      attachedImages: Array.isArray(t.images) ? t.images.filter((u: unknown) => typeof u === "string" && !!u) : [],
      reviewer: t.reviewer_name || null,
      reviewRound: t.review_round ?? 0,
      releaseDate: t.release_date ?? null,
      releaseDateUndecided: t.is_release_date_undecided === true,
      operationVerified: t.is_operation_verified === true,
      // 手入力・完了時に計測した実績工数。null は未入力（画面は各工程の日時から計算する）
      actualHours: t.actual_work_hours ?? null,
      // 親チケットの工程ごとの実績（着手→レビュー依頼／レビュー依頼→承認／承認→STG／STG→UAT／UAT→リリース）
      actualHoursBreakdown: Array.isArray(t.actual_work_hours_breakdown)
        ? t.actual_work_hours_breakdown.map((v: unknown) => Number(v) || 0)
        : null,
    };
  };

  return res.status(200).json({
    project: { name: project?.name ?? null, slug: slug || null },
    ticket: toView(row),
    parent: parentRow ? toView(parentRow) : null,
    children: childRows.map(toView),
    // 本文・コメントで参照されている関連チケット（背景・決定事項として読むためのもの。BRU25-007）
    linkedTickets: linkedRows.map(toView),
    // 参照されているが、このプロジェクトに見つからなかった WBS
    linkedTicketsMissing: linkedMissing,
  });
}

// ── POST /api/v1/ticket-status ───────────────────────────────
//
// AI が実装の進み具合に合わせてステータスを前へ進めるためのもの。
// 画面（TicketDetailPanel）のボタンを押したときと同じ結果になるよう、ステータスのほかに
// 進捗率・マイルストーン時刻・コメント欄の履歴も書く。
//
// 決まりごと:
//   ・行き先は、親が 進行中／レビュー中／レビュー完了／STG完了／UAT完了／リリース待ち／クローズ、
//     子が 進行中／対応完了。「AIで実装」で利用者が選んだ「最後に進めるステータス」まで進める（BRU21-004）。
//   ・親の「クローズ」は released、子の「対応完了」は closed（同じ「完了」でも値が違う。statusLabelFor）。
//   ・「クローズ」は、本番反映の確認（層B）が gate のプロジェクトでは「リリース待ち」にとどめる。
//     本番へ届いたことを syncProjectReleases（api/github）が確かめてからクローズにする。
//     API から直接 released にすると、層Cの「本番へ届いていないものをリリース済みにしない」をすり抜けるため。
//   ・前へ進めるだけ。すでに同じか先のステータスなら何もしない（changed: false）。
//     AI が同じ呼び出しを2回送っても、履歴が2行になったり後戻りしたりしない。
//   ・保留中・取下のチケットには触らない。
//   ・レビュー中にするとき、レビュアーの指定・レビュー回数の加算・レビュー依頼の通知は行わない
//     （画面の「レビュー依頼」とは別物。AI は誰に依頼するかを決められないため）。
type StatusTarget =
  | "in-progress" | "in-review" | "review-done" | "stg-test" | "uat" | "waiting-release" | "released" | "closed";

const STATUS_TARGET_BY_LABEL: Record<string, StatusTarget> = {
  "進行中": "in-progress", "対応中": "in-progress", inprogress: "in-progress",
  "レビュー中": "in-review", inreview: "in-review",
  "レビュー完了": "review-done", reviewdone: "review-done",
  "stg完了": "stg-test", stg: "stg-test", stgtest: "stg-test",
  "uat完了": "uat", uat: "uat",
  "リリース待ち": "waiting-release", waitingrelease: "waiting-release",
  "クローズ": "released", released: "released",
  "対応完了": "closed", "完了": "closed", closed: "closed", done: "closed",
};

/** 子チケットに指定できる行き先 */
const CHILD_STATUS_TARGETS: StatusTarget[] = ["in-progress", "closed"];

const STATUS_TARGET_LIST_TEXT =
  "進行中 / レビュー中 / レビュー完了 / STG完了 / UAT完了 / リリース待ち / クローズ（親チケット）、進行中 / 対応完了（子チケット）";

/** 親をこのステータスにするとき、子に求める最低ランク（helpers.ts の PARENT_STATUS_MIN_CHILD_RANK と同じ値） */
const PARENT_STATUS_MIN_CHILD_RANK: Record<string, number> = {
  "in-review": 3, "stg-test": 4, uat: 5, done: 6, closed: 6,
};

/**
 * 親を target にするとき、子に求める最低ランク。
 * 画面は1段ずつ進めるので、途中の段（レビュー中など）の判定を必ず通る。
 * API は段を飛ばして進められるため、target までの段で一番厳しい値を使う（レビュー完了なら レビュー中 の 3）。
 */
function requiredChildRank(target: string): number {
  let rank = 0;
  for (const [s, r] of Object.entries(PARENT_STATUS_MIN_CHILD_RANK)) {
    if ((STATUS_RANK[s] ?? 0) <= (STATUS_RANK[target] ?? 0)) rank = Math.max(rank, r);
  }
  return rank;
}

/** 親のマイルストーンの列。ステータスと順番は useProject.ts の STATUS_TO_MILESTONE / MILESTONE_ORDER と同じ */
const MILESTONE_COLUMNS = [
  "started_at", "review_requested_at", "review_approved_at", "stg_completed_at", "uat_completed_at", "released_at",
] as const;
const MILESTONE_BY_STATUS: Record<string, (typeof MILESTONE_COLUMNS)[number]> = {
  "in-progress": "started_at", "in-review": "review_requested_at", "review-done": "review_approved_at",
  "stg-test": "stg_completed_at", uat: "uat_completed_at", "waiting-release": "released_at", released: "released_at",
};

function newCommentId(): string {
  // 画面は CMT-<ミリ秒> だが、こちらは子と親へ続けて書くので同じミリ秒に重なりうる
  return `CMT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function handleUpdateStatus(sb: SupabaseClient, key: ApiKeyRow, body: any, res: any) {
  const wbs = typeof body?.wbs === "string" ? body.wbs.trim() : "";
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const rawStatus = typeof body?.status === "string" ? body.status.trim() : "";

  const requested = STATUS_TARGET_BY_LABEL[normalizeValue(rawStatus)];
  if (!requested) {
    return res.status(400).json({
      error: `status「${rawStatus}」は指定できません。APIから変更できるのは ${STATUS_TARGET_LIST_TEXT} です`,
    });
  }

  const found = await lookupTicket(sb, key, { wbs, id },
    `id, wbs, title, status, sprint_id, parent_id, ${MILESTONE_COLUMNS.join(", ")}`);
  if (!found.ok) return res.status(found.status).json({ error: found.error });
  const row = found.row;
  const isChild = !!row.parent_id;
  const current = String(row.status ?? "todo");

  if (isChild && !CHILD_STATUS_TARGETS.includes(requested)) {
    return res.status(400).json({
      error: `「${row.wbs}」は子チケットです。子チケットに指定できるのは 進行中 / 対応完了 だけです（親チケットの「${statusLabelFor(requested, false)}」は子にはありません）`,
    });
  }
  if (requested === "closed" && !isChild) {
    return res.status(400).json({ error: `「${row.wbs}」は親チケットです。「対応完了」にできるのは子チケットだけです（親は「クローズ」を指定します）` });
  }
  if (current === "on-hold" || current === "withdrawn") {
    return res.status(409).json({
      error: `「${row.wbs}」は${statusLabelFor(current, isChild)}のため、ステータスを変更しません`,
    });
  }

  const warnings: string[] = [];

  // 層Bが gate のプロジェクトでは、クローズの代わりにリリース待ちにする。
  // クローズへは syncProjectReleases が本番への反映を確かめてから進める
  let target: StatusTarget = requested;
  if (requested === "released") {
    const { data: project, error: projectError } = await sb
      .from("projects").select("deploy_check_mode").eq("id", key.project_id).maybeSingle();
    if (projectError) return res.status(500).json({ error: projectError.message });
    if (project?.deploy_check_mode === "gate") {
      target = "waiting-release";
      warnings.push("このプロジェクトは本番への反映を確認してからクローズにする設定のため、「リリース待ち」にしました。本番への反映を確認できたら自動でクローズになります");
    }
  }

  const fromLabel = statusLabelFor(current, isChild);
  const toLabel = statusLabelFor(target, isChild);

  // 後ろへは戻さない。同じステータスへの再送もここで止まる
  if ((STATUS_RANK[current] ?? 0) >= STATUS_RANK[target]) {
    return res.status(200).json({
      ok: true, changed: false, wbs: row.wbs, status: fromLabel, parentStarted: null,
      message: `すでに「${fromLabel}」のため変更していません`,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  }

  // 親を進められるのは、子がその段階に必要なところまで終わっているときだけ
  //（画面の validateParentStatusChange と同じ。取下の子は数えない）
  const minChildRank = isChild ? 0 : requiredChildRank(target);
  if (minChildRank > 0) {
    const { data: childRows, error: childError } = await sb
      .from("sprint_tickets").select("wbs, status").eq("parent_id", row.id);
    if (childError) return res.status(500).json({ error: childError.message });
    const blocking = ((childRows ?? []) as any[])
      .filter(c => c.status !== "withdrawn" && (STATUS_RANK[c.status] ?? 0) < minChildRank)
      .sort((a, b) => compareWbs(a.wbs, b.wbs));
    if (blocking.length > 0) {
      return res.status(409).json({
        error: `子チケット ${blocking.length}件（${blocking.map(c => c.wbs).join(" / ")}）が対応完了していないため「${toLabel}」にできません`,
      });
    }
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: target, progress: STATUS_PROGRESS[target] ?? 0 };
  if (isChild) {
    // 子は実績モニター非対応。着手と完了の時刻だけを持つ（画面の startChildSelf / handleChildComplete と同じ）。
    // 実績工数（actual_work_hours）は書かない。空のままなら画面が着手〜完了から自動で計算する
    if (target === "in-progress") patch.started_at = now;
    if (target === "closed") patch.released_at = now;
  } else {
    // 親はマイルストーンを行き先の段まで順に埋める（recordMilestoneFromTicketStatus の「前進」と同じ）。
    // 段を飛ばしたときは、飛ばした段も同じ時刻で埋まる
    const last = MILESTONE_COLUMNS.indexOf(MILESTONE_BY_STATUS[target]);
    for (let i = 0; i <= last; i++) {
      if (!row[MILESTONE_COLUMNS[i]]) patch[MILESTONE_COLUMNS[i]] = now;
    }
  }

  // 条件に元のステータスを入れておく。読んでから書くまでの間に人が画面で動かしていたら上書きしない
  const { data: updated, error: updateError } = await sb
    .from("sprint_tickets").update(patch).eq("id", row.id).eq("status", current).select("id");
  if (updateError) return res.status(500).json({ error: `ステータスの更新に失敗しました: ${updateError.message}` });
  if (!updated || updated.length === 0) {
    return res.status(409).json({ error: `「${row.wbs}」のステータスが直前に変更されたため、更新を取りやめました。もう一度読み取ってから判断してください` });
  }

  // コメント欄の履歴。誰の操作かは「キーを発行した人」で残し、API経由であることを本文に書く
  const actor = key.created_by || "API連携";
  const via = `API連携（${esc(key.name)}）`;
  const comments: Record<string, unknown>[] = [{
    id: newCommentId(), ticket_id: row.id, user_name: actor,
    content: isChild
      ? (target === "closed" ? `<p>対応完了しました（${via}）</p>` : `<p>着手開始しました（${via}）</p>`)
      : `<p>${via}：ステータスを「${toLabel}」に変更しました</p>`,
    ticket_status: target, comment_type: "status_change", images: [],
  }];

  // 子に着手したとき親が未着手なら、親も進行中にする（画面の startParentTicket と同じ）
  let parentStarted: string | null = null;
  if (isChild && target === "in-progress") {
    const { data: parent } = await sb
      .from("sprint_tickets").select("id, wbs, status, started_at").eq("id", row.parent_id).maybeSingle();
    if (parent && parent.status === "todo") {
      const parentPatch: Record<string, unknown> = { status: "in-progress", progress: STATUS_PROGRESS["in-progress"] };
      if (!parent.started_at) parentPatch.started_at = now;
      const { data: parentUpdated, error: parentError } = await sb
        .from("sprint_tickets").update(parentPatch).eq("id", parent.id).eq("status", "todo").select("id");
      if (parentError) {
        warnings.push(`親チケット「${parent.wbs}」を進行中にできませんでした: ${parentError.message}`);
      } else if (parentUpdated && parentUpdated.length > 0) {
        parentStarted = parent.wbs as string;
        comments.push({
          id: newCommentId(), ticket_id: parent.id, user_name: actor,
          content: `<p>子チケット着手に伴い、ステータスを「進行中」に変更しました（${via}）</p>`,
          ticket_status: "in-progress", comment_type: "status_change", images: [],
        });
      }
    }
  }

  // ステータス自体は変わっているので、履歴の失敗で応答を落とさない
  const { error: commentError } = await sb.from("ticket_comments").insert(comments);
  if (commentError) warnings.push(`コメント欄への履歴の記録に失敗しました: ${commentError.message}`);

  return res.status(200).json({
    ok: true, changed: true, wbs: row.wbs, from: fromLabel, status: toLabel, parentStarted, warnings,
  });
}

// ── POST /api/v1/ticket-pull ─────────────────────────────────
//
// 「AIで実装」で AI が gh pr create したPRを、その場でチケットへ紐づけるためのもの。
// 画面から作ったPRや Webhook の経路（api/github/[resource].ts の autoLink）を通らないため、
// これが無いと誰かがPR一覧を開くまで紐づかなかった（BRU20-004）。
//
// GitHub のヘルパー（installationToken 等）は api/github 側にしか無いので、GitHub へは問い合わせない。
// 受け取った URL がプロジェクトのリポジトリのPRで、番号と一致することだけを確かめて保存する。
// state は open で保存する。マージ済みなどへの更新は PR一覧・Webhook・マージ時の autoLink が行う。
const PULL_URL_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?$/i;

async function handleLinkPull(sb: SupabaseClient, key: ApiKeyRow, body: any, res: any) {
  const wbs = typeof body?.wbs === "string" ? body.wbs.trim() : "";
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const number = typeof body?.number === "number" ? body.number
    : typeof body?.number === "string" && /^\d+$/.test(body.number.trim()) ? Number(body.number.trim()) : NaN;

  if (!Number.isInteger(number) || number <= 0) {
    return res.status(400).json({ error: "number（プルリクエストの番号）は正の整数で指定してください" });
  }
  if (!url) return res.status(400).json({ error: "url（プルリクエストのURL）は必須です" });
  if (!title) return res.status(400).json({ error: "title（プルリクエストのタイトル）は必須です" });
  if (title.length > MAX_TITLE_LENGTH) return res.status(400).json({ error: `title が長すぎます（${MAX_TITLE_LENGTH}文字まで）` });

  const { data: project, error: projectError } = await sb
    .from("projects").select("github_repo_full_name").eq("id", key.project_id).maybeSingle();
  // GitHub連携の列（add_github_integration.sql）が無い環境もエラーになるので、未登録と同じ扱いにする
  const repo = projectError ? "" : String(project?.github_repo_full_name ?? "");
  if (!repo) {
    return res.status(400).json({ error: "このプロジェクトには GitHub リポジトリが登録されていないため、PRを紐づけできません" });
  }

  const m = url.match(PULL_URL_RE);
  if (!m || `${m[1]}/${m[2]}`.toLowerCase() !== repo.toLowerCase()) {
    return res.status(400).json({
      error: `url がこのプロジェクトのリポジトリ（${repo}）のプルリクエストではありません。https://github.com/${repo}/pull/<番号> の形で指定してください`,
    });
  }
  if (Number(m[3]) !== number) {
    return res.status(400).json({ error: `number（${number}）と url の番号（${m[3]}）が一致しません` });
  }

  const found = await lookupTicket(sb, key, { wbs, id }, "id, wbs");
  if (!found.ok) return res.status(found.status).json({ error: found.error });
  const row = found.row;

  const { data: prev, error: prevError } = await sb
    .from("ticket_github_links").select("id, auto_linked, state, title, url")
    .eq("project_id", key.project_id).eq("ticket_id", row.id).eq("kind", "pull").eq("number", number)
    .maybeSingle();
  if (prevError) return res.status(500).json({ error: prevError.message });

  const done = (message: string) => res.status(200).json({ ok: true, changed: false, wbs: row.wbs, number, url, message });
  // 人が手で付けた紐づけ（auto_linked=false）は上書きしない（autoLink / linkByBranch と同じ扱い）
  if (prev?.auto_linked === false) return done(`「${row.wbs}」には PR #${number} が手動で紐づけ済みのため、変更していません`);
  if (prev && prev.title === title && prev.url === url) return done(`「${row.wbs}」には PR #${number} が紐づけ済みです`);

  const { error: upsertError } = await sb.from("ticket_github_links").upsert({
    project_id: key.project_id,
    ticket_id: row.id,
    kind: "pull",
    number,
    title,
    // 既に紐づいていれば state はそのまま（マージ済みを open へ戻さない）
    state: prev?.state ?? "open",
    url,
    auto_linked: true,
    auto_reason: "AIで実装（APIから登録）",
  }, { onConflict: "project_id,ticket_id,kind,number" });
  if (upsertError) return res.status(500).json({ error: `PRの紐づけに失敗しました: ${upsertError.message}` });

  return res.status(200).json({ ok: true, changed: true, wbs: row.wbs, number, url });
}

// ── 担当者への Slack 通知 ─────────────────────────────────────
// 画面から作ったとき（/api/slack-notify）と同じ見た目で、プロジェクトのチャンネルへ投稿する。
// 担当者ごとに1投稿にまとめ、チケット名はチケット詳細へのリンクにする。

/** リンクに使う公開オリジン。未設定ならリンク無しで送る */
function appPublicOrigin(): string {
  return (process.env.PUBLIC_URL || process.env.VITE_PUBLIC_APP_ORIGIN || "").replace(/\/+$/, "");
}

/** 1投稿に並べるチケットの上限。超えた分は「ほかN件」にまとめる */
const SLACK_MAX_TICKET_LINES = 20;

function escapeSlackText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function notifyAssignSlack(
  sb: SupabaseClient,
  project: any,
  tickets: { assignee: string; wbs: string; title: string }[],
): Promise<void> {
  if (!project?.slack_notifications_enabled || !project?.slack_channel || !project?.slack_access_token) return;
  const slug = String(project.slug ?? "");
  const origin = appPublicOrigin();

  const byAssignee = new Map<string, { wbs: string; title: string }[]>();
  for (const t of tickets) {
    const list = byAssignee.get(t.assignee) ?? [];
    list.push(t);
    byAssignee.set(t.assignee, list);
  }

  const { data: profiles } = await sb
    .from("profiles").select("name, slack_member_id").in("name", Array.from(byAssignee.keys()));

  for (const [assignee, list] of byAssignee) {
    const memberId = (profiles ?? []).find((p: any) => p.name === assignee)?.slack_member_id;
    const mention = memberId ? `<@${memberId}>` : assignee;
    const lines = list.slice(0, SLACK_MAX_TICKET_LINES).map(t => {
      const label = escapeSlackText(`${t.wbs}: ${t.title}`);
      return origin && slug
        ? `<${origin}/${encodeURIComponent(slug)}/${encodeURIComponent(t.wbs)}|${label}>`
        : label;
    });
    if (list.length > SLACK_MAX_TICKET_LINES) lines.push(`ほか${list.length - SLACK_MAX_TICKET_LINES}件`);
    const title = list.length > 1 ? `チケットが${list.length}件割り当てられました` : "チケットが割り当てられました";
    const text = `*${title}*\n${mention} ${lines.join("\n")}`;

    const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${project.slack_access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: project.slack_channel, text }),
    });
    const json = await slackRes.json() as { ok: boolean; error?: string };
    if (!json.ok) console.error("[api/v1] slack:", json.error);
  }
}

// ── POST /api/v1/ticket-comment（BRU25-001） ─────────────────
//
// 「AIで実装」で AI が仕様を確認したいとき、質問をそのチケットのコメントとして登録する。
// 今までは質問がチャットにしか出ず、人がチケット詳細へ貼り直していた。
// ふつうのコメント（comment_type = comment）として入れ、起票者へベルと Slack で知らせる。
// 子チケットで起票者が空なら、親チケットの起票者へ知らせる。
async function handleCreateComment(sb: SupabaseClient, key: ApiKeyRow, body: any, res: any) {
  const wbs = typeof body?.wbs === "string" ? body.wbs.trim() : "";
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return res.status(400).json({ error: "body（コメントの本文）は必須です" });
  if (text.length > MAX_DESCRIPTION_LENGTH) {
    return res.status(400).json({ error: `body が長すぎます（${MAX_DESCRIPTION_LENGTH}文字まで）` });
  }

  const found = await lookupTicket(sb, key, { wbs, id }, "id, wbs, title, status, parent_id, created_by");
  if (!found.ok) return res.status(found.status).json({ error: found.error });
  const row = found.row;
  const warnings: string[] = [];

  const { data: project } = await sb
    .from("projects")
    .select("slug, organization_id, slack_access_token, slack_channel, slack_notifications_enabled")
    .eq("id", key.project_id).maybeSingle();

  // プランのコメント件数の上限（画面と同じく comment_type = comment の件数で数える）
  const orgId = (project?.organization_id as string | null | undefined) ?? key.organization_id;
  if (orgId) {
    const { data: org } = await sb.from("organizations").select("plan_id").eq("id", orgId).maybeSingle();
    if (org?.plan_id) {
      const { data: plan } = await sb
        .from("plans").select("max_comments_per_ticket").eq("id", org.plan_id).maybeSingle();
      const max = (plan?.max_comments_per_ticket as number | null | undefined) ?? null;
      if (max !== null) {
        const { count, error: countError } = await sb
          .from("ticket_comments").select("id", { count: "exact", head: true })
          .eq("ticket_id", row.id).eq("comment_type", "comment");
        if (countError) return res.status(500).json({ error: countError.message });
        if ((count ?? 0) >= max) {
          return res.status(409).json({
            error: `「${row.wbs}」のコメントがプランの上限（${max}件）に達しているため、登録できません`,
          });
        }
      }
    }
  }

  // 知らせる相手：起票者。子チケットで空なら親チケットの起票者
  let recipient = String(row.created_by ?? "").trim();
  if (!recipient && row.parent_id) {
    const { data: parent } = await sb
      .from("sprint_tickets").select("created_by").eq("id", row.parent_id).maybeSingle();
    recipient = String(parent?.created_by ?? "").trim();
  }

  const actor = key.created_by || "API連携";
  const via = `AIからの確認（API連携（${esc(key.name)}））`;
  // 先頭の「@起票者名」は、コメント欄で候補を選んだときと同じメンションの印で書く。
  // 画面では緑のメンションの表示になり、「確認済み」チェックの対象になる（BRU25-006）
  const head = recipient
    ? `<p><span data-type="mention" class="mention" data-id="${esc(recipient)}">@${esc(recipient)}</span> ${via}</p>`
    : `<p>${via}</p>`;
  const commentId = newCommentId();
  const { error: insertError } = await sb.from("ticket_comments").insert({
    id: commentId, ticket_id: row.id, user_name: actor,
    content: head + mdToHtml(text),
    ticket_status: row.status, comment_type: "comment", images: [],
  });
  if (insertError) return res.status(500).json({ error: `コメントの登録に失敗しました: ${insertError.message}` });

  const slug = String(project?.slug ?? "");
  const origin = appPublicOrigin();
  const url = origin && slug ? `${origin}/${encodeURIComponent(slug)}/${encodeURIComponent(row.wbs)}` : null;

  // コメントは登録済みなので、通知の失敗で応答を落とさず warnings に入れる
  if (!recipient) {
    warnings.push("起票者が不明のため通知していません");
  } else {
    const title = `${actor}さん（AI）から確認の質問があります`;
    const { error: notifyError } = await sb.from("notifications").insert({
      user_name: recipient, type: "mention",
      title,
      body: `${row.wbs}: ${row.title}`,
      ticket_id: row.id, ticket_wbs: row.wbs, ticket_title: row.title,
      project_slug: slug || null, is_read: false,
    });
    if (notifyError) warnings.push(`起票者への通知に失敗しました: ${notifyError.message}`);

    // Slack は notifyAssignSlack と同じ作り（プロジェクトで有効なときだけ。profiles.slack_member_id でメンション）
    if (project?.slack_notifications_enabled && project?.slack_channel && project?.slack_access_token) {
      try {
        const { data: profile } = await sb
          .from("profiles").select("slack_member_id").eq("name", recipient).maybeSingle();
        const mention = profile?.slack_member_id ? `<@${profile.slack_member_id}>` : recipient;
        const label = escapeSlackText(`${row.wbs}: ${row.title}`);
        const link = url ? `<${url}|${label}>` : label;
        const plain = text.replace(/\s+/g, " ").trim();
        const excerpt = escapeSlackText(plain.length > 300 ? `${plain.slice(0, 300)}…` : plain);
        const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${project.slack_access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ channel: project.slack_channel, text: `*${escapeSlackText(title)}*\n${mention} ${link}\n${excerpt}` }),
        });
        const json = await slackRes.json() as { ok: boolean; error?: string };
        if (!json.ok) warnings.push(`Slack への通知に失敗しました: ${json.error ?? "unknown"}`);
      } catch (e) {
        warnings.push(`Slack への通知に失敗しました: ${(e as Error)?.message ?? String(e)}`);
      }
    }
  }

  return res.status(201).json({ ok: true, wbs: row.wbs, commentId, url, warnings });
}

// ── 本文のHTMLを安全な形にする（ENHA2-057） ─────────────────
//
// ticket-update の descriptionHtml は、AI や外部のシステムが書いたHTMLをそのまま保存するため、
// 保存の前に「許可したタグと属性だけを残す」形で組み立て直す。
// 残すのは RichEditor（tiptap）が出すもの（段落・見出し・リスト・表・画像・リンク・コード・
// メンションの span・Mermaid の div など）。script・iframe・on〜属性・javascript: のリンクなどは落とす。
// サーバーには DOM が無く、このファイルは外部のライブラリを持たない作りなので（冒頭の注記）、自前で字句を読む。

/** 中身ごと捨てるタグ（中の文字も表示させない） */
const HTML_DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template", "textarea", "select", "button",
  "svg", "math", "frame", "frameset", "noembed", "noframes", "xmp", "title", "head", "applet",
  "audio", "video", "canvas",
]);

/** 残すタグと、タグごとに残す属性（class・style・title・data-* はどのタグでも残す） */
const HTML_ALLOWED_TAGS: Record<string, string[]> = {
  p: [], br: [], hr: [], div: [], span: [],
  strong: [], b: [], em: [], i: [], s: [], del: [], strike: [], u: [], sub: [], sup: [], mark: [],
  code: [], pre: [], blockquote: [],
  h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
  ul: [], ol: ["start", "type"], li: [],
  a: ["href", "target", "rel"],
  img: ["src", "alt", "width", "height"],
  table: [], thead: [], tbody: [], tfoot: [], tr: [], colgroup: [],
  td: ["colspan", "rowspan", "colwidth"], th: ["colspan", "rowspan", "colwidth"], col: ["span", "width"],
};
const HTML_GLOBAL_ATTRS = new Set(["class", "style", "title"]);
const HTML_VOID_TAGS = new Set(["br", "hr", "img", "col"]);

// 属性の値に引用符の中身として > を含められるよう、引用符の中は丸ごと読み飛ばす
const HTML_TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const HTML_ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const escHtmlText = (s: string) => s
  .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, "&amp;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * href / src に入れてよい URL か。http(s)・mailto・tel・相対パス・# だけを通す。
 * 画像の src に限り、data:image（png / gif / jpeg / webp）も通す（古い本文に埋め込みの画像があるため）。
 * 判定は空白・制御文字を除いた形で行う（"java\tscript:" のようなすり抜けを防ぐ）。
 */
function safeHtmlUrl(raw: string, allowDataImage: boolean): string | null {
  const v = raw.trim();
  const probe = v.replace(/[\u0000- \u007f-\u009f]+/g, "").toLowerCase();
  if (/^(https?:|mailto:|tel:)/.test(probe)) return v;
  if (allowDataImage && /^data:image\/(png|gif|jpe?g|webp);base64,/.test(probe)) return v;
  if (/^[a-z][a-z0-9+.-]*:/.test(probe)) return null;
  return v;
}

/** style 属性から、スクリプトや外部読み込みにつながる宣言を落とす。落とした宣言の数も返す */
function safeHtmlStyle(raw: string): { style: string; dropped: number } {
  const decls = raw.replace(/\/\*[\s\S]*?\*\//g, "").split(";").map(d => d.trim()).filter(Boolean);
  const kept = decls.filter(d => {
    const i = d.indexOf(":");
    if (i <= 0) return false;
    const prop = d.slice(0, i).trim().toLowerCase();
    const val = d.slice(i + 1).toLowerCase();
    if (!/^-?[a-z][a-z-]*$/.test(prop) || prop === "behavior" || prop === "-moz-binding") return false;
    return !/expression|javascript:|vbscript:|url\s*\(|@import|[\\<>]/.test(val);
  });
  return { style: kept.join("; "), dropped: decls.length - kept.length };
}

function cleanHtmlAttrs(tag: string, raw: string, onRemoved: () => void): string {
  const allowed = HTML_ALLOWED_TAGS[tag] ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  let hasTarget = false;
  HTML_ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HTML_ATTR_RE.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    if (name === "/") continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const value = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
    if (!HTML_GLOBAL_ATTRS.has(name) && !allowed.includes(name) && !/^data-[a-z0-9-]+$/.test(name)) {
      onRemoved();
      continue;
    }
    let v: string | null = value;
    if (name === "style") {
      const cleaned = safeHtmlStyle(value);
      if (cleaned.dropped > 0) onRemoved();
      v = cleaned.style;
      if (!v) continue;
    } else if (name === "href" || name === "src") {
      v = safeHtmlUrl(value, tag === "img" && name === "src");
      if (v === null) { onRemoved(); continue; }
    } else if (name === "target") {
      if (value !== "_blank") { onRemoved(); continue; }
      hasTarget = true;
    } else if (name === "rel") {
      continue; // target と一緒に付け直す
    }
    out.push(`${name}="${esc(v)}"`);
  }
  // 別タブで開くリンクは、開いた先から元の画面を操作されないようにする（RichEditor と同じ値）
  if (tag === "a" && hasTarget) out.push(`rel="noopener noreferrer"`);
  return out.length > 0 ? ` ${out.join(" ")}` : "";
}

// export しているのは検証用（mdToHtml と同じ理由）。
/** 許可したタグ・属性だけを残したHTMLと、取り除いた箇所の数を返す */
export function sanitizeHtml(html: string): { html: string; removed: number } {
  let removed = 0;
  const onRemoved = () => { removed++; };
  // コメント・CDATA・<!DOCTYPE>・<?xml?> は表示に関係しないので捨てる
  const s = html.split("\u0000").join("")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g, "")
    .replace(/<[!?][^>]*>?/g, "");

  const out: string[] = [];
  let last = 0;
  /** 中身ごと捨てているタグ。閉じタグが来るまで、間の文字もタグも捨てる */
  let skipping: string | null = null;
  HTML_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HTML_TAG_RE.exec(s)) !== null) {
    const text = s.slice(last, m.index);
    last = HTML_TAG_RE.lastIndex;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (skipping) {
      if (closing && name === skipping) skipping = null;
      continue;
    }
    out.push(escHtmlText(text));
    if (HTML_DROP_WITH_CONTENT.has(name)) {
      onRemoved();
      if (!closing && !/\/\s*$/.test(m[3])) skipping = name;
      continue;
    }
    if (!HTML_ALLOWED_TAGS[name]) {
      // 表示に要らない枠（html・body・font など）は、タグだけ外して中の文字は残す
      onRemoved();
      continue;
    }
    if (closing) {
      if (!HTML_VOID_TAGS.has(name)) out.push(`</${name}>`);
      continue;
    }
    out.push(`<${name}${cleanHtmlAttrs(name, m[3], onRemoved)}>`);
  }
  // 閉じられないまま終わった script などの後ろは捨てる
  if (!skipping) out.push(escHtmlText(s.slice(last)));
  return { html: out.join(""), removed };
}

// ── POST /api/v1/ticket-update（ENHA2-057） ──────────────────
//
// 外部のAI・システムが、既存チケットの項目をチケット詳細の画面と同じように直すためのもの。
// 決まりごと:
//   ・送った項目だけを変える。送らなかった項目は update に含めない（列ごと送らない。BRU21-002 の再発防止）
//   ・updatedAt（GET /api/v1/ticket で読んだ値）が今の値と違えば、画面で誰かが直したということなので 409 で返す
//   ・メンバーにいない担当者・登録されていない分類など、解決できない値はその項目だけ変えずに warnings に理由を返す
//   ・担当者を変えても通知しない（担当の期間 ticket_assignments は DB のトリガーで切り替わる）。
//     通知するのはレビュー中にしたときのレビュアーへの依頼だけ（画面のレビュー依頼と同じ）
//   ・ステータスは画面のボタンと同じ動き（TicketDetailPanel の handleStatusAction / handleReviewRequest /
//     handleToggleHold / handleToggleWithdraw / executeResetToTodo / 子の着手・完了）に合わせる。
//     画面の今の動き（保留解除でリリース待ちが「対応完了」に戻る、レビューを取り下げてもレビュー依頼日が残る）もそのまま
//   ・変えた内容は、コメント欄に履歴を1件だけ残す
//   ⚠️ 画面の動きを変えたら、ここも合わせること（apiKeyPrompt.ts / apiSamples.ts の説明も）

/** 送ってよいキー。これ以外は無視して warnings に出す */
const UPDATE_KEYS = new Set([
  "wbs", "id", "updatedAt", "title", "labels", "priority", "prLinkWaived", "category", "assignee",
  "startDate", "dueDate", "description", "descriptionHtml", "attachedImages", "actualHours", "actualHoursBreakdown",
  "releaseDate", "releaseDateUndecided", "operationVerified", "status", "reviewer",
]);
/** 本文のHTMLの上限。古い本文には画像が data: のまま埋め込まれているものがあり、Markdown より大きくなる */
const MAX_DESCRIPTION_HTML_LENGTH = 2_000_000;
const MAX_LABELS = 3;
/** 親チケットの工程ごとの実績の数（着手→レビュー依頼／レビュー依頼→承認／承認→STG／STG→UAT／UAT→リリース） */
const ACTUAL_BREAKDOWN_SEGMENTS = 5;

type UpdateStatusOp =
  | { kind: "set"; target: string }
  | { kind: "hold" } | { kind: "unhold" } | { kind: "withdraw" } | { kind: "unwithdraw" } | { kind: "reset" };

const UPDATE_STATUS_BY_LABEL: Record<string, UpdateStatusOp> = {
  "未着手": { kind: "reset" }, todo: { kind: "reset" }, "未着手に戻す": { kind: "reset" },
  "進行中": { kind: "set", target: "in-progress" }, "対応中": { kind: "set", target: "in-progress" }, inprogress: { kind: "set", target: "in-progress" },
  "レビュー中": { kind: "set", target: "in-review" }, inreview: { kind: "set", target: "in-review" },
  "レビュー完了": { kind: "set", target: "review-done" }, reviewdone: { kind: "set", target: "review-done" },
  "stg完了": { kind: "set", target: "stg-test" }, stg: { kind: "set", target: "stg-test" },
  "uat完了": { kind: "set", target: "uat" }, uat: { kind: "set", target: "uat" },
  "リリース待ち": { kind: "set", target: "waiting-release" }, waitingrelease: { kind: "set", target: "waiting-release" },
  "クローズ": { kind: "set", target: "released" }, released: { kind: "set", target: "released" },
  "対応完了": { kind: "set", target: "closed" }, "完了": { kind: "set", target: "closed" }, closed: { kind: "set", target: "closed" },
  "保留": { kind: "hold" }, "保留中": { kind: "hold" }, "保留する": { kind: "hold" }, onhold: { kind: "hold" },
  "保留解除": { kind: "unhold" }, "保留を解除": { kind: "unhold" },
  "取下": { kind: "withdraw" }, "取下げ": { kind: "withdraw" }, "取り下げ": { kind: "withdraw" }, "取下する": { kind: "withdraw" }, withdrawn: { kind: "withdraw" },
  "取下解除": { kind: "unwithdraw" }, "取下げ解除": { kind: "unwithdraw" }, "取り下げ解除": { kind: "unwithdraw" },
};
const UPDATE_STATUS_LIST_TEXT =
  "未着手 / 進行中 / レビュー中 / レビュー完了 / STG完了 / UAT完了 / リリース待ち / クローズ（親）／ 未着手 / 進行中 / 対応完了（子）／ 保留 / 保留解除 / 取下 / 取下解除";

/** 保留・取下を解除するとき、残しておいた進捗率から元のステータスを決める（TicketDetailPanel の getStatusFromProgress と同じ） */
function statusFromProgress(progress: number): string {
  if (progress >= 100) return "done";
  if (progress >= 90) return "uat";
  if (progress >= 70) return "stg-test";
  if (progress >= 50) return "review-done";
  if (progress >= 30) return "in-review";
  if (progress > 0) return "in-progress";
  return "todo";
}

/** 保留の開始・終了の文言（src/app/lib/holdHours.ts と同じ。保留時間の集計がこの文字で探すので変えない） */
const HOLD_START_MARKER = "チケットを保留にしました";
const HOLD_END_MARKER = "保留を解除しました";

/**
 * 親チケットのステータスを変えたときのマイルストーンの書き方（useProject.ts の recordMilestoneFromTicketStatus と同じ）。
 * 先の工程に記録があれば（後ろへ戻したとき）それより後ろを消し、無ければ行き先の工程まで空いているところを今の時刻で埋める。
 */
function milestonePatchFor(row: any, status: string, now: string): Record<string, string | null> {
  const col = MILESTONE_BY_STATUS[status] ?? (status === "done" || status === "closed" ? "released_at" : undefined);
  if (!col) return {};
  const idx = MILESTONE_COLUMNS.indexOf(col);
  const patch: Record<string, string | null> = {};
  const movedBackward = MILESTONE_COLUMNS.slice(idx + 1).some(c => !!row[c]);
  if (movedBackward) {
    for (const c of MILESTONE_COLUMNS.slice(idx + 1)) patch[c] = null;
  } else {
    for (const c of MILESTONE_COLUMNS.slice(0, idx + 1)) if (!row[c]) patch[c] = now;
  }
  return patch;
}

/** 開始日・期限日から見積工数を出す（TicketDetailPanel の handleDate と同じ「日数×8時間」） */
function estimatedHoursFromDates(start: string | null, due: string | null): number {
  if (!start || !due) return 0;
  const days = Math.max(0, Math.round((new Date(due).getTime() - new Date(start).getTime()) / 86400000) + 1);
  return days * 8;
}

/** 履歴に書く日付（"2026-11-20" → "11/20"。画面の formatDate と同じ） */
const historyDate = (d: string | null | undefined) => (d ? d.slice(5).replace("-", "/") : "未設定");
const historyText = (v: string | null | undefined) => (v ? `「${v}」` : "未設定");

// export しているのは検証用（mdToHtml と同じ理由。DB の代わりを渡して動きを確かめられるようにするため）。
export async function handleUpdateTicket(sb: SupabaseClient, key: ApiKeyRow, body: any, res: any) {
  const b = (body ?? {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;
  const wbs = typeof b.wbs === "string" ? b.wbs.trim() : "";
  const id = typeof b.id === "string" ? b.id.trim() : "";
  const updatedAt = typeof b.updatedAt === "string" ? b.updatedAt.trim() : "";
  if (!updatedAt) {
    return res.status(400).json({
      error: "updatedAt は必須です。GET /api/v1/ticket で読んだ ticket.updatedAt をそのまま送ってください（読んでから送るまでに画面で直されていないかを確かめるため）",
    });
  }

  const warnings: string[] = [];
  for (const k of Object.keys(b)) {
    if (UPDATE_KEYS.has(k)) continue;
    warnings.push(k === "estimatedHours"
      ? "estimatedHours は直接は変えられません（開始日・期限日から「日数×8時間」で自動で計算されます）。無視しました"
      : `「${k}」は修正できない項目のため無視しました`);
  }

  const found = await lookupTicket(sb, key, { wbs, id },
    "id, wbs, title, status, progress, priority, assignee, start_date, due_date, description, images, category_id, sprint_id, parent_id"
    + ", prefixes, pr_link_waived, reviewer_name, review_round, release_date, is_release_date_undecided, is_operation_verified"
    + `, actual_work_hours, actual_work_hours_breakdown, updated_at, ${MILESTONE_COLUMNS.join(", ")}`);
  if (!found.ok) return res.status(found.status).json({ error: found.error });
  const row = found.row;
  const isChild = !!row.parent_id;
  const current = String(row.status ?? "todo");

  // ── 読んでから今までに、画面で直されていないか（比較は DB に任せる。時刻の文字の形の違いで誤判定しないため）
  const conflict = () => res.status(409).json({
    error: `「${row.wbs}」は、読み取ったあとに画面などで更新されています。上書きしないよう、修正を取りやめました。もう一度 GET /api/v1/ticket で読み直し、最新の内容に対して直してください`,
    updatedAt: row.updated_at ?? null,
  });
  const { data: same, error: sameError } = await sb
    .from("sprint_tickets").select("id").eq("id", row.id).eq("updated_at", updatedAt).maybeSingle();
  if (sameError) return res.status(400).json({ error: `updatedAt「${updatedAt}」を日時として読めません: ${sameError.message}` });
  if (!same) return conflict();

  const [{ data: project }, { data: categoryRows }] = await Promise.all([
    sb.from("projects")
      .select("slug, members, deploy_check_mode, slack_access_token, slack_channel, slack_notifications_enabled")
      .eq("id", key.project_id).maybeSingle(),
    sb.from("ticket_categories").select("id, name").eq("project_id", key.project_id),
  ]);
  const members = Array.isArray(project?.members) ? (project!.members as string[]) : [];
  const categories = (categoryRows ?? []) as { id: string; name: string }[];

  const patch: Record<string, unknown> = {};
  /** 履歴に書く変更の内容（「期限日 11/20 → 11/25」の形） */
  const changes: string[] = [];
  const given = (v: unknown) => v !== null && v !== "";

  // ── タイトル ──
  if (has("title")) {
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (!title) return res.status(400).json({ error: "title は空にできません" });
    if (title.length > MAX_TITLE_LENGTH) return res.status(400).json({ error: `title が長すぎます（${MAX_TITLE_LENGTH}文字まで）` });
    if (title !== row.title) { patch.title = title; changes.push(`タイトル ${historyText(row.title)} → ${historyText(title)}`); }
  }

  // ── ラベル（3つまで・重複なし。画面の addPrefix と同じ） ──
  if (has("labels")) {
    if (b.labels !== null && !Array.isArray(b.labels)) {
      return res.status(400).json({ error: "labels は文字列の配列で指定してください（外すときは []）" });
    }
    const raw = ((b.labels ?? []) as unknown[]).filter((v): v is string => typeof v === "string").map(v => v.trim()).filter(Boolean);
    const labels = [...new Set(raw)];
    if (labels.length < raw.length) warnings.push("labels の重複を1つにまとめました");
    if (labels.length > MAX_LABELS) return res.status(400).json({ error: `labels は${MAX_LABELS}つまでです（${labels.length}つ送られました）` });
    const prev: string[] = Array.isArray(row.prefixes) ? row.prefixes : [];
    if (labels.join("\u0000") !== prev.join("\u0000")) {
      patch.prefixes = labels;
      changes.push(`ラベル ${prev.length ? prev.join("・") : "なし"} → ${labels.length ? labels.join("・") : "なし"}`);
    }
  }

  // ── 優先度 ──
  if (has("priority")) {
    const mapped = typeof b.priority === "string" ? PRIORITY_BY_LABEL[normalizeValue(b.priority)] : undefined;
    if (!mapped) warnings.push(`優先度「${String(b.priority)}」は候補（${PRIORITY_LABELS.join(" / ")}）にないため変えていません`);
    else if (mapped !== row.priority) {
      patch.priority = mapped;
      changes.push(`優先度 ${PRIORITY_LABEL_BY_VALUE[row.priority] ?? row.priority} → ${PRIORITY_LABEL_BY_VALUE[mapped]}`);
    }
  }

  // ── PR不要 ──
  if (has("prLinkWaived")) {
    if (typeof b.prLinkWaived !== "boolean") warnings.push(`prLinkWaived「${String(b.prLinkWaived)}」は true / false ではないため変えていません`);
    else if (b.prLinkWaived !== (row.pr_link_waived === true)) {
      patch.pr_link_waived = b.prLinkWaived;
      changes.push(`PR不要 ${row.pr_link_waived ? "あり" : "なし"} → ${b.prLinkWaived ? "あり" : "なし"}`);
    }
  }

  // ── 分類（登録済みの分類から選ぶ。新しい分類は作らない） ──
  if (has("category")) {
    const nameOf = (cid: string | null) => categories.find(c => c.id === cid)?.name ?? null;
    if (!given(b.category)) {
      if (row.category_id) { patch.category_id = null; changes.push(`分類 ${historyText(nameOf(row.category_id))} → 分類なし`); }
    } else {
      const raw = String(b.category).trim();
      const matched = categories.find(c => c.name === raw) ?? categories.find(c => normalizeValue(c.name) === normalizeValue(raw));
      if (!matched) warnings.push(`分類「${raw}」はこのプロジェクトに登録されていないため変えていません（新しい分類は作りません）`);
      else if (matched.id !== row.category_id) {
        patch.category_id = matched.id;
        changes.push(`分類 ${row.category_id ? historyText(nameOf(row.category_id)) : "分類なし"} → ${historyText(matched.name)}`);
      }
    }
  }

  // ── 担当者（プロジェクトのメンバーから選ぶ。通知は送らない） ──
  if (has("assignee")) {
    let next: string | null = null;
    if (!given(b.assignee)) next = "";
    else {
      next = matchByName(String(b.assignee), members);
      if (next === null) warnings.push(`担当者「${String(b.assignee)}」はプロジェクトのメンバーに見つからないため変えていません`);
    }
    if (next !== null && next !== (row.assignee ?? "")) {
      // 画面（applyAssignee）と同じく assignees も揃える
      patch.assignee = next;
      patch.assignees = next ? [next] : [];
      changes.push(`担当者 ${row.assignee ? historyText(row.assignee) : "未割り当て"} → ${next ? historyText(next) : "未割り当て"}`);
    }
  }

  // ── 開始日・期限日（見積工数は「日数×8時間」で計算し直す） ──
  const readDateField = (k: "startDate" | "dueDate", label: string): string | null | undefined => {
    if (!has(k)) return undefined;
    if (!given(b[k])) return null;
    const d = typeof b[k] === "string" ? parseDate(b[k] as string) : null;
    if (!d || !isRealDate(d)) { warnings.push(`${label}「${String(b[k])}」を日付として読めないため変えていません`); return undefined; }
    return d;
  };
  const nextStart = readDateField("startDate", "開始日");
  const nextDue = readDateField("dueDate", "期限日");
  if ((nextStart !== undefined && nextStart !== (row.start_date ?? null)) || (nextDue !== undefined && nextDue !== (row.due_date ?? null))) {
    const s = nextStart !== undefined ? nextStart : (row.start_date ?? null);
    const d = nextDue !== undefined ? nextDue : (row.due_date ?? null);
    if (nextStart !== undefined && nextStart !== (row.start_date ?? null)) {
      patch.start_date = nextStart;
      changes.push(`開始日 ${historyDate(row.start_date)} → ${historyDate(nextStart)}`);
    }
    if (nextDue !== undefined && nextDue !== (row.due_date ?? null)) {
      patch.due_date = nextDue;
      changes.push(`期限日 ${historyDate(row.due_date)} → ${historyDate(nextDue)}`);
    }
    if (s && d && d < s) warnings.push("期限日が開始日より前です");
    patch.estimated_hours = estimatedHoursFromDates(s, d);
  }

  // ── 本文（丸ごと置き換え。HTML は安全な形にしてから保存） ──
  if (has("description") && has("descriptionHtml")) {
    return res.status(400).json({ error: "description（Markdown）と descriptionHtml（HTML）は、どちらか一方だけを送ってください" });
  }
  if (has("description") || has("descriptionHtml")) {
    const isHtml = has("descriptionHtml");
    const raw = isHtml ? b.descriptionHtml : b.description;
    if (raw !== null && typeof raw !== "string") {
      return res.status(400).json({ error: `${isHtml ? "descriptionHtml" : "description"} は文字列で指定してください` });
    }
    const text = (raw ?? "") as string;
    const max = isHtml ? MAX_DESCRIPTION_HTML_LENGTH : MAX_DESCRIPTION_LENGTH;
    if (text.length > max) return res.status(400).json({ error: `${isHtml ? "descriptionHtml" : "description"} が長すぎます（${max}文字まで）` });
    let html = "";
    if (text.trim()) {
      if (isHtml) {
        const cleaned = sanitizeHtml(text);
        html = cleaned.html;
        if (cleaned.removed > 0) warnings.push(`本文のHTMLから、保存できないタグ・属性を ${cleaned.removed} か所取り除きました（script・on〜属性・javascript: のリンクなど）`);
      } else {
        html = mdToHtml(text);
      }
    }
    const next = html.trim() ? html : null;
    if ((next ?? "") !== String(row.description ?? "")) {
      patch.description = next;
      changes.push(next ? "本文を更新" : "本文を空にしました");
    }
  }

  // ── 本文の下の画像（今あるURLを外す・並べ替えるだけ。新しいURLは足さない） ──
  if (has("attachedImages")) {
    if (b.attachedImages !== null && !Array.isArray(b.attachedImages)) {
      return res.status(400).json({ error: "attachedImages は URL の配列で指定してください（全部外すときは []）" });
    }
    const prev: string[] = Array.isArray(row.images) ? row.images.filter((u: unknown) => typeof u === "string") : [];
    const asked = [...new Set(((b.attachedImages ?? []) as unknown[]).filter((u): u is string => typeof u === "string").map(u => u.trim()))];
    const kept = asked.filter(u => prev.includes(u));
    if (kept.length < asked.length) {
      warnings.push(`attachedImages の新しいURL ${asked.length - kept.length}件は追加していません（APIから画像は追加できません。外す・並べ替えるだけです）`);
    }
    if (kept.join("\u0000") !== prev.join("\u0000")) {
      patch.images = kept;
      changes.push(kept.length === prev.length ? "本文の下の画像を並べ替えました" : `本文の下の画像 ${prev.length}枚 → ${kept.length}枚`);
    }
  }

  // ── 実績工数（子は時間、親は合計と工程ごとの内訳） ──
  const readHours = (v: unknown): number | null => {
    const h = parseHours(v);
    return h === null || h < 0 ? null : Math.round(h * 10) / 10;
  };
  let actualPatch: Record<string, unknown> = {};
  if (has("actualHoursBreakdown") && isChild) {
    warnings.push("actualHoursBreakdown は親チケットだけのため無視しました（子チケットは actualHours だけです）");
  }
  if (isChild && has("actualHours")) {
    // 空（null）にすると、画面は着手〜完了の時刻からの自動計測に戻る（画面の子の実績工数の「空欄で保存」と同じ）
    if (b.actualHours === null || b.actualHours === "") actualPatch.actual_work_hours = null;
    else {
      const h = readHours(b.actualHours);
      if (h === null) warnings.push(`実績工数「${String(b.actualHours)}」を0以上の数値として読めないため変えていません`);
      else actualPatch.actual_work_hours = h;
    }
  } else if (!isChild && (has("actualHours") || has("actualHoursBreakdown"))) {
    let total: number | null = null;
    if (has("actualHoursBreakdown")) {
      const list = Array.isArray(b.actualHoursBreakdown) ? b.actualHoursBreakdown : null;
      const parsed = list ? list.map(readHours) : [];
      if (!list || list.length !== ACTUAL_BREAKDOWN_SEGMENTS || parsed.some(v => v === null)) {
        warnings.push(`actualHoursBreakdown は0以上の数値${ACTUAL_BREAKDOWN_SEGMENTS}つの配列（着手→レビュー依頼／レビュー依頼→承認／承認→STG／STG→UAT／UAT→リリース）で送ってください。変えていません`);
      } else {
        actualPatch.actual_work_hours_breakdown = (parsed as number[]).map(v => String(v));
        total = Math.round((parsed as number[]).reduce((a, v) => a + v, 0) * 10) / 10;
      }
    }
    if (has("actualHours")) {
      const h = b.actualHours === null || b.actualHours === "" ? null : readHours(b.actualHours);
      if (h === null) warnings.push(`実績工数「${String(b.actualHours)}」を0以上の数値として読めないため変えていません（親チケットの実績工数は空にできません）`);
      else if (total !== null && Math.abs(total - h) > 0.05) warnings.push(`actualHours（${h}）が内訳の合計（${total}）と違うため、合計に合わせました`);
      else if (total === null) total = h;
    }
    if (total !== null) actualPatch.actual_work_hours = total;
  }
  const actualChanged = ("actual_work_hours" in actualPatch && actualPatch.actual_work_hours !== (row.actual_work_hours ?? null))
    || ("actual_work_hours_breakdown" in actualPatch
      && JSON.stringify(actualPatch.actual_work_hours_breakdown) !== JSON.stringify(row.actual_work_hours_breakdown ?? null));
  if (!actualChanged) actualPatch = {};

  // ── ステータス ──
  let statusOp: UpdateStatusOp | null = null;
  if (has("status")) {
    statusOp = typeof b.status === "string" ? UPDATE_STATUS_BY_LABEL[normalizeValue(b.status)] ?? null : null;
    if (!statusOp) {
      return res.status(400).json({ error: `status「${String(b.status)}」は指定できません。指定できるのは ${UPDATE_STATUS_LIST_TEXT} です` });
    }
  }
  if (has("reviewer") && !(statusOp?.kind === "set" && statusOp.target === "in-review")) {
    warnings.push("reviewer は status を「レビュー中」にするときだけ使います。無視しました");
  }

  const now = new Date().toISOString();
  const statusPatch: Record<string, unknown> = {};
  /** 履歴の先頭に置くステータスの変化の文 */
  let statusText: string | null = null;
  let nextStatus = current;
  /** レビュー依頼を送るとき（画面の handleReviewRequest と同じ通知をする） */
  let reviewRequest: { reviewer: string; round: number } | null = null;
  /** 未着手に戻すとき、一緒に戻す子チケット */
  let resetChildIds: string[] = [];
  let startParent = false;

  const labelOf = (s: string) => statusLabelFor(s, isChild);
  const isTerminal = isChild ? current === "closed" : current === "released";

  if (statusOp?.kind === "hold") {
    if (current !== "on-hold") {
      if (isTerminal && current !== "withdrawn") return res.status(409).json({ error: `「${row.wbs}」は${labelOf(current)}のため、保留にできません` });
      // 進捗率は残す（保留解除のときに元のステータスへ戻すため。画面と同じ）
      statusPatch.status = "on-hold";
      nextStatus = "on-hold";
      statusText = HOLD_START_MARKER;
    }
  } else if (statusOp?.kind === "withdraw") {
    if (current !== "withdrawn") {
      if (isTerminal && current !== "on-hold") return res.status(409).json({ error: `「${row.wbs}」は${labelOf(current)}のため、取下にできません` });
      statusPatch.status = "withdrawn";
      nextStatus = "withdrawn";
      statusText = "チケットを取下げました";
    }
  } else if (statusOp?.kind === "unhold" || statusOp?.kind === "unwithdraw") {
    const from = statusOp.kind === "unhold" ? "on-hold" : "withdrawn";
    if (current !== from) {
      return res.status(409).json({ error: `「${row.wbs}」は${labelOf(current)}です。${statusOp.kind === "unhold" ? "保留解除" : "取下解除"}は${labelOf(from)}のときだけできます` });
    }
    const restored = statusFromProgress(Number(row.progress) || 0);
    statusPatch.status = restored;
    statusPatch.progress = STATUS_PROGRESS[restored] ?? 0;
    if (!isChild) Object.assign(statusPatch, milestonePatchFor(row, restored, now));
    nextStatus = restored;
    statusText = statusOp.kind === "unhold"
      ? `${HOLD_END_MARKER}（ステータスを「${labelOf(restored)}」に戻しました）`
      : `取下げを解除し、ステータスを「${labelOf(restored)}」に戻しました`;
  } else if (statusOp?.kind === "reset") {
    if (current !== "todo") {
      const resettable = isChild
        ? current === "in-progress"
        : ["in-progress", "in-review", "review-done", "stg-test", "uat", "waiting-release"].includes(current);
      if (!resettable) {
        return res.status(409).json({
          error: `「${row.wbs}」は${labelOf(current)}のため、未着手に戻せません（未着手に戻せるのは ${isChild ? "進行中" : "進行中〜リリース待ち"} のときだけです）`,
        });
      }
      if (!isChild) {
        const { data: childRows, error: childError } = await sb
          .from("sprint_tickets").select("id, wbs, status").eq("parent_id", row.id)
          .order("wbs", { ascending: true }).order("id", { ascending: true });
        if (childError) return res.status(500).json({ error: childError.message });
        const children = ((childRows ?? []) as any[]).sort((x, y) => compareWbs(x.wbs, y.wbs));
        const blocked = children.filter(c => ["closed", "done", "released", "on-hold", "withdrawn"].includes(c.status));
        if (blocked.length > 0) {
          const why = (s: string) => (s === "on-hold" ? "保留中" : s === "withdrawn" ? "取下" : "対応完了");
          return res.status(409).json({
            error: `子チケット ${blocked.map(c => `${c.wbs}（${why(c.status)}）`).join("・")} があるため、未着手に戻せません`,
          });
        }
        resetChildIds = children.map(c => c.id as string);
      }
      // 着手してから記録された実績を消す（画面の executeResetToTodo と同じ。closed_at は本番DBに無いので書かない）
      Object.assign(statusPatch, {
        status: "todo", progress: 0,
        started_at: null, review_requested_at: null, review_approved_at: null,
        stg_completed_at: null, uat_completed_at: null, released_at: null,
        actual_work_hours: null, actual_work_hours_breakdown: null, is_operation_verified: false,
      });
      if (Object.keys(actualPatch).length > 0) {
        warnings.push("未着手に戻すと実績がクリアされるため、actualHours・actualHoursBreakdown は反映していません");
        actualPatch = {};
      }
      nextStatus = "todo";
      statusText = "未着手に戻しました（実績をクリアしました）";
    }
  } else if (statusOp?.kind === "set") {
    let target = statusOp.target;
    if (current === "on-hold" || current === "withdrawn") {
      return res.status(409).json({
        error: `「${row.wbs}」は${labelOf(current)}のため、ステータスを変えられません。先に「${current === "on-hold" ? "保留解除" : "取下解除"}」を送ってください`,
      });
    }
    if (isChild && target !== "in-progress" && target !== "closed") {
      return res.status(400).json({ error: `「${row.wbs}」は子チケットです。子チケットに指定できるのは 未着手 / 進行中 / 対応完了 / 保留 / 保留解除 / 取下 / 取下解除 です` });
    }
    if (!isChild && target === "closed") {
      return res.status(400).json({ error: `「${row.wbs}」は親チケットです。「対応完了」にできるのは子チケットだけです（親は「クローズ」を指定します）` });
    }
    // 本番反映の確認が gate のプロジェクトは、クローズの代わりにリリース待ちにとどめる（ticket-status と同じ）
    if (target === "released" && project?.deploy_check_mode === "gate") {
      target = "waiting-release";
      warnings.push("このプロジェクトは本番への反映を確認してからクローズにする設定のため、「リリース待ち」にしました。本番への反映を確認できたら自動でクローズになります");
    }

    const fromRank = STATUS_RANK[current] ?? 0;
    const toRank = STATUS_RANK[target] ?? 0;
    // レビュー完了〜UAT完了からレビュー中へは、画面の「再レビュー依頼」と同じく依頼し直す
    const reReview = !isChild && target === "in-review" && fromRank > toRank;

    if (target !== current || reReview) {
      if (isChild) {
        if (toRank < fromRank) {
          return res.status(409).json({ error: `「${row.wbs}」は${labelOf(current)}のため「${labelOf(target)}」に戻せません（子チケットを戻せるのは「未着手」だけです）` });
        }
        // 子は着手と完了の時刻だけを持つ（画面の startChildSelf / handleChildComplete と同じ）
        if (target === "in-progress") statusPatch.started_at = now;
        if (target === "closed") statusPatch.released_at = now;
        startParent = target === "in-progress";
      } else {
        // 子チケットが必要なところまで終わっているか（画面の validateParentStatusChange と同じ。取下の子は数えない）。
        // 前へ段を飛ばすときは、飛ばした段で一番厳しい条件を使う（画面は1段ずつしか進めないため）
        const minChildRank = toRank > fromRank ? requiredChildRank(target) : (PARENT_STATUS_MIN_CHILD_RANK[target] ?? 0);
        if (minChildRank > 0) {
          const { data: childRows, error: childError } = await sb
            .from("sprint_tickets").select("wbs, status").eq("parent_id", row.id);
          if (childError) return res.status(500).json({ error: childError.message });
          const blocking = ((childRows ?? []) as any[])
            .filter(c => c.status !== "withdrawn" && (STATUS_RANK[c.status] ?? 0) < minChildRank)
            .sort((x, y) => compareWbs(x.wbs, y.wbs));
          if (blocking.length > 0) {
            return res.status(409).json({
              error: `子チケット ${blocking.length}件（${blocking.map(c => c.wbs).join(" / ")}）が対応完了していないため「${labelOf(target)}」にできません`,
            });
          }
        }
        // レビュー中からの戻し（修正依頼・レビューの取り下げ）は、画面と同じくマイルストーンに触らない
        const isReviewWithdraw = current === "in-review" && target === "in-progress";
        if (!isReviewWithdraw) Object.assign(statusPatch, milestonePatchFor(row, target, now));
      }

      // レビュー中にするときは、画面のレビュー依頼と同じくレビュアー・回数を書き、レビュアーへ知らせる
      if (target === "in-review") {
        let reviewer: string | null = null;
        if (has("reviewer") && given(b.reviewer)) {
          // 画面で選べる人（プロジェクトのメンバーのうち、管理者・オーナー・PM・レビュー権限のある人。担当者自身も選べる）
          const { data: profileRows } = await sb.from("profiles").select("name, role, permissions")
            .or(key.organization_id ? `organization_id.eq.${key.organization_id},role.eq.owner` : "role.eq.owner");
          const eligible = ((profileRows ?? []) as any[])
            .filter(p => p.role === "admin" || p.role === "owner" || p.role === "project-manager" || p.permissions?.canReview === true)
            .map(p => String(p.name))
            .filter(n => members.length === 0 || members.includes(n));
          const candidates = [...new Set([...(key.created_by ? [key.created_by] : []), ...eligible])];
          reviewer = matchByName(String(b.reviewer), candidates);
          if (!reviewer) {
            return res.status(400).json({
              error: `レビュアー「${String(b.reviewer)}」は指定できません。指定できるのは ${candidates.length ? candidates.join(" / ") : "（候補なし）"} です`,
            });
          }
        } else if (row.reviewer_name) {
          reviewer = String(row.reviewer_name);
        }
        if (reviewer) {
          const round = (Number(row.review_round) || 0) + 1;
          statusPatch.reviewer_name = reviewer;
          statusPatch.review_round = round;
          reviewRequest = { reviewer, round };
        } else {
          warnings.push("レビュアーが指定されていないため、レビュー依頼の通知はしていません（reviewer で指定すると、画面のレビュー依頼と同じく通知します）");
        }
      }

      statusPatch.status = target;
      statusPatch.progress = STATUS_PROGRESS[target] ?? 0;
      nextStatus = target;
      statusText = `ステータス ${labelOf(current)} → ${labelOf(target)}`;
    } else if (target === "in-review" && has("reviewer")) {
      warnings.push(`すでに「${labelOf(current)}」のため、レビュー依頼は送っていません`);
    }
  }

  // ── リリース予定日・未定（リリース待ちのときだけ。ステータスを変えたあとの値で判定する） ──
  if (has("releaseDate") || has("releaseDateUndecided")) {
    if (nextStatus !== "waiting-release") {
      warnings.push("releaseDate・releaseDateUndecided は、リリース待ちのときだけ変えられます。無視しました");
    } else if (b.releaseDateUndecided === true) {
      if (has("releaseDate") && given(b.releaseDate)) {
        return res.status(400).json({ error: "releaseDate と releaseDateUndecided: true は一緒に送れません（どちらか一方にしてください）" });
      }
      if (!row.is_release_date_undecided || row.release_date) {
        patch.release_date = null;
        patch.is_release_date_undecided = true;
        changes.push(`リリース予定日 ${row.is_release_date_undecided ? "未定" : historyDate(row.release_date)} → 未定`);
      }
    } else if (has("releaseDate")) {
      const d = given(b.releaseDate) && typeof b.releaseDate === "string" ? parseDate(b.releaseDate) : null;
      if (!d || !isRealDate(d)) warnings.push(`リリース予定日「${String(b.releaseDate)}」を日付として読めないため変えていません`);
      else if (d !== row.release_date || row.is_release_date_undecided) {
        patch.release_date = d;
        patch.is_release_date_undecided = false;
        changes.push(`リリース予定日 ${row.is_release_date_undecided ? "未定" : historyDate(row.release_date)} → ${historyDate(d)}`);
      }
    } else if (b.releaseDateUndecided === false && row.is_release_date_undecided) {
      patch.is_release_date_undecided = false;
      changes.push("リリース予定日 未定 → 未設定");
    } else if (typeof b.releaseDateUndecided !== "boolean") {
      warnings.push(`releaseDateUndecided「${String(b.releaseDateUndecided)}」は true / false ではないため変えていません`);
    }
  }

  // ── 動作確認済み（親がリリース済みのときだけ） ──
  if (has("operationVerified")) {
    if (isChild || nextStatus !== "released") {
      warnings.push("operationVerified は、親チケットがクローズ（リリース済み）のときだけ切り替えられます。無視しました");
    } else if (typeof b.operationVerified !== "boolean") {
      warnings.push(`operationVerified「${String(b.operationVerified)}」は true / false ではないため変えていません`);
    } else if (b.operationVerified !== (row.is_operation_verified === true) && !("is_operation_verified" in statusPatch)) {
      patch.is_operation_verified = b.operationVerified;
      changes.push(`動作確認 ${row.is_operation_verified ? "済み" : "未"} → ${b.operationVerified ? "済み" : "未"}`);
    }
  }

  if (Object.keys(actualPatch).length > 0) {
    Object.assign(patch, actualPatch);
    if ("actual_work_hours" in actualPatch && actualPatch.actual_work_hours !== (row.actual_work_hours ?? null)) {
      changes.push(`実績工数 ${row.actual_work_hours ?? "未入力"}${row.actual_work_hours != null ? "h" : ""} → ${actualPatch.actual_work_hours ?? "自動計測"}${actualPatch.actual_work_hours != null ? "h" : ""}`);
    } else {
      changes.push("実績工数の内訳を更新");
    }
  }

  // ステータスの変更は項目の変更より後に重ねる（未着手に戻すときの実績のクリアを優先するため）
  Object.assign(patch, statusPatch);

  if (Object.keys(patch).length === 0) {
    return res.status(200).json({
      ok: true, changed: false, wbs: row.wbs, status: labelOf(current), changes: [],
      updatedAt: row.updated_at ?? null, message: "変わる項目が無いため、何も変えていません", warnings,
    });
  }

  // 条件に updatedAt を入れておく。上の確認から書くまでの間に画面で直されたら、上書きせずに 409 にする
  const { data: updatedRows, error: updateError } = await sb
    .from("sprint_tickets").update(patch).eq("id", row.id).eq("updated_at", updatedAt).select("id, updated_at");
  if (updateError) return res.status(500).json({ error: `チケットの更新に失敗しました: ${updateError.message}` });
  if (!updatedRows || updatedRows.length === 0) return conflict();
  const newUpdatedAt = (updatedRows[0] as any).updated_at ?? null;

  const actor = key.created_by || "API連携";
  const via = `API連携（${esc(key.name)}）`;
  const comments: Record<string, unknown>[] = [];

  // ── 未着手に戻したとき：子チケットも戻す（親を先に書いたので、子の失敗は warnings に出す） ──
  if (resetChildIds.length > 0) {
    const childPatch = { ...statusPatch };
    const { error: childResetError } = await sb.from("sprint_tickets").update(childPatch).in("id", resetChildIds);
    if (childResetError) {
      warnings.push(`子チケットを未着手に戻せませんでした: ${childResetError.message}。画面の「未着手に戻す」でやり直してください`);
    } else {
      for (const cid of resetChildIds) {
        comments.push({
          id: newCommentId(), ticket_id: cid, user_name: actor,
          content: `<p>未着手に戻しました（実績をクリアしました）（${via}）</p>`,
          ticket_status: "todo", comment_type: "status_change", images: [],
        });
      }
    }
  }
  if (statusOp?.kind === "reset" && statusText) {
    // 担当ごとの実績の修正値も消す（テーブル・列が無い環境では何もしない）
    const { error: asgError } = await sb.from("ticket_assignments")
      .update({ hours_override: null }).in("ticket_id", [row.id, ...resetChildIds]);
    if (asgError) console.warn("[api/v1] ticket-update reset ticket_assignments:", asgError.message);
  }

  // ── 子に着手したとき親が未着手なら、親も進行中にする（ticket-status と同じ） ──
  let parentStarted: string | null = null;
  if (startParent) {
    const { data: parent } = await sb
      .from("sprint_tickets").select("id, wbs, status, started_at").eq("id", row.parent_id).maybeSingle();
    if (parent && parent.status === "todo") {
      const parentPatch: Record<string, unknown> = { status: "in-progress", progress: STATUS_PROGRESS["in-progress"] };
      if (!parent.started_at) parentPatch.started_at = now;
      const { data: parentUpdated, error: parentError } = await sb
        .from("sprint_tickets").update(parentPatch).eq("id", parent.id).eq("status", "todo").select("id");
      if (parentError) warnings.push(`親チケット「${parent.wbs}」を進行中にできませんでした: ${parentError.message}`);
      else if (parentUpdated && parentUpdated.length > 0) {
        parentStarted = parent.wbs as string;
        comments.push({
          id: newCommentId(), ticket_id: parent.id, user_name: actor,
          content: `<p>子チケット着手に伴い、ステータスを「進行中」に変更しました（${via}）</p>`,
          ticket_status: "in-progress", comment_type: "status_change", images: [],
        });
      }
    }
  }

  // ── コメント欄の履歴（1件）。レビュー依頼のときは画面と同じ review_request として残す ──
  const parts = [...(statusText ? [statusText] : []), ...changes].map(esc);
  const historyBody = `<p>${via}：${parts.join("、")}</p>`;
  comments.unshift({
    id: newCommentId(), ticket_id: row.id, user_name: actor,
    content: reviewRequest
      ? `<p><strong>@${esc(reviewRequest.reviewer)}</strong> にレビュー依頼を送信しました（第${reviewRequest.round}回）</p>${historyBody}`
      : historyBody,
    ticket_status: nextStatus,
    comment_type: reviewRequest ? "review_request" : "status_change",
    images: [],
  });
  const { error: commentError } = await sb.from("ticket_comments").insert(comments);
  if (commentError) warnings.push(`コメント欄への履歴の記録に失敗しました: ${commentError.message}`);

  // ── レビュアーへの通知（画面の handleReviewRequest と同じ。ベルと Slack） ──
  if (reviewRequest) {
    const slug = String(project?.slug ?? "");
    const title = String(patch.title ?? row.title);
    const notifyTitle = `${actor}さんからレビュー依頼が届きました`;
    const notifyBody = `${row.wbs}: ${title}（第${reviewRequest.round}回）`;
    const { error: notifyError } = await sb.from("notifications").insert({
      user_name: reviewRequest.reviewer, type: "review_request",
      title: notifyTitle, body: notifyBody,
      ticket_id: row.id, ticket_wbs: row.wbs, ticket_title: title,
      project_slug: slug || null, is_read: false,
    });
    if (notifyError) warnings.push(`レビュアーへの通知に失敗しました: ${notifyError.message}`);
    if (project?.slack_notifications_enabled && project?.slack_channel && project?.slack_access_token) {
      try {
        const { data: profile } = await sb
          .from("profiles").select("slack_member_id").eq("name", reviewRequest.reviewer).maybeSingle();
        const mention = profile?.slack_member_id ? `<@${profile.slack_member_id}>` : reviewRequest.reviewer;
        const origin = appPublicOrigin();
        const url = origin && slug ? `${origin}/${encodeURIComponent(slug)}/${encodeURIComponent(row.wbs)}` : null;
        const label = escapeSlackText(notifyBody);
        const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${project.slack_access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: project.slack_channel,
            text: `*${escapeSlackText(notifyTitle)}*\n${mention} ${url ? `<${url}|${label}>` : label}`,
          }),
        });
        const json = await slackRes.json() as { ok: boolean; error?: string };
        if (!json.ok) warnings.push(`Slack への通知に失敗しました: ${json.error ?? "unknown"}`);
      } catch (e) {
        warnings.push(`Slack への通知に失敗しました: ${(e as Error)?.message ?? String(e)}`);
      }
    }
  }

  return res.status(200).json({
    ok: true, changed: true, wbs: row.wbs,
    status: labelOf(nextStatus),
    changes: [...(statusText ? [statusText] : []), ...changes],
    reviewRequestedTo: reviewRequest?.reviewer ?? null,
    parentStarted,
    updatedAt: newUpdatedAt,
    warnings,
  });
}

// ── POST /api/v1/tickets ─────────────────────────────────────
async function handleCreateTickets(sb: SupabaseClient, key: ApiKeyRow, body: any, res: any) {
  const sprintId = typeof body?.sprintId === "string" ? body.sprintId.trim() : "";
  const sprintName = typeof body?.sprintName === "string" ? body.sprintName.trim() : "";

  const rawTickets = body?.tickets;
  if (!Array.isArray(rawTickets) || rawTickets.length === 0) {
    return res.status(400).json({ error: "tickets は1件以上の配列で指定してください" });
  }
  if (rawTickets.length > MAX_PARENTS_PER_REQUEST) {
    return res.status(400).json({ error: `1回のリクエストで作れるのは${MAX_PARENTS_PER_REQUEST}件までです` });
  }

  // ── 文脈（スプリント一覧・メンバー・分類）と入力の正規化 ──
  const [{ data: sprintRows, error: sprintError }, { data: project }, { data: categoryRows }] = await Promise.all([
    sb.from("sprints").select("id, name, identifier").eq("project_id", key.project_id),
    sb.from("projects")
      .select("slug, members, organization_id, slack_access_token, slack_channel, slack_notifications_enabled")
      .eq("id", key.project_id).maybeSingle(),
    sb.from("ticket_categories").select("id, name").eq("project_id", key.project_id),
  ]);
  if (sprintError) return res.status(500).json({ error: sprintError.message });
  const sprints = sprintRows ?? [];

  const ctx: NormalizeCtx = {
    members: Array.isArray(project?.members) ? (project!.members as string[]) : [],
    categories: (categoryRows ?? []) as { id: string; name: string }[],
    warnings: [],
  };

  // リクエスト直下の prLinkWaived は、子チケットも含めてこのリクエストで登録するものすべての既定値。
  // 1件ずつの指定があればそちらを優先する（toRow で適用）。
  let defaultPrLinkWaived = false;
  if (typeof body?.prLinkWaived === "boolean") defaultPrLinkWaived = body.prLinkWaived;
  else if (body?.prLinkWaived !== undefined && body?.prLinkWaived !== null) {
    ctx.warnings.push(`prLinkWaived「${String(body.prLinkWaived)}」は true / false ではないため無視しました`);
  }

  const tickets: NormalizedTicket[] = [];
  for (const raw of rawTickets) {
    const normalized = normalizeTicket((raw ?? {}) as TicketInput, ctx, false);
    if ("error" in normalized) return res.status(400).json({ error: normalized.error });
    tickets.push(normalized);
  }

  // 「既に登録されているチケットの配下に足すもの」と「新しく親から作るもの」に分ける。
  // 1回のリクエストに両方が混ざっていてよい。
  const toExisting = tickets.filter(t => t.parentWbs || t.parentId);
  const newRoots = tickets.filter(t => !t.parentWbs && !t.parentId);

  // ── 新しく親を作るぶんの登録先スプリント（キーのプロジェクト内に限定する＝テナント境界） ──
  // すべてが既存チケットの子なら、登録先は親のスプリントに従うので sprintId は要らない。
  let sprint: { id: string; name: string; identifier?: string | null } | null = null;
  if (newRoots.length > 0) {
    if (!sprintId && !sprintName) {
      return res.status(400).json({ error: "sprintId（または sprintName）は必須です。GET /api/v1/context で確認できます" });
    }
    sprint = (sprintId
      ? sprints.find((s: any) => s.id === sprintId)
      : sprints.find((s: any) => s.name === sprintName)
        ?? sprints.find((s: any) => normalizeValue(s.name) === normalizeValue(sprintName))) ?? null;

    if (!sprint) {
      return res.status(404).json({
        error: sprintId
          ? "指定されたスプリントが、このAPIキーのプロジェクトに見つかりません"
          : `スプリント「${sprintName}」が見つかりません`,
        availableSprints: sprints.map((s: any) => ({ id: s.id, name: s.name })),
      });
    }
  } else if (sprintId || sprintName) {
    ctx.warnings.push("すべて既存チケットの子として登録するため、sprintId は使いません（親と同じスプリントに入ります）");
  }

  // ── 親チケットの解決 ──
  // 引くのは「このAPIキーのプロジェクトに属するスプリント」の中だけ。
  // service_role 接続で RLS が効かないため、ここを絞らないと他テナントのチケットに子を足せてしまう。
  const parentOf = new Map<NormalizedTicket, ParentRow>();
  if (toExisting.length > 0) {
    const sprintIds = sprints.map((s: any) => s.id);
    if (sprintIds.length === 0) {
      return res.status(404).json({ error: "このプロジェクトにはスプリントがありません" });
    }

    const cols = "id, wbs, title, sprint_id, parent_id";
    const wantWbs = [...new Set(toExisting.filter(t => !t.parentId).map(t => t.parentWbs as string))];
    const wantIds = [...new Set(toExisting.filter(t => t.parentId).map(t => t.parentId as string))];
    const found: ParentRow[] = [];

    if (wantWbs.length > 0) {
      const { data, error } = await sb.from("sprint_tickets").select(cols).in("sprint_id", sprintIds).in("wbs", wantWbs);
      if (error) return res.status(500).json({ error: error.message });
      found.push(...((data ?? []) as ParentRow[]));
    }
    if (wantIds.length > 0) {
      const { data, error } = await sb.from("sprint_tickets").select(cols).in("sprint_id", sprintIds).in("id", wantIds);
      if (error) return res.status(500).json({ error: error.message });
      found.push(...((data ?? []) as ParentRow[]));
    }

    const byRef = new Map<string, ParentRow>();
    for (const row of found) { byRef.set(row.wbs, row); byRef.set(row.id, row); }

    for (const t of toExisting) {
      const ref = (t.parentId ?? t.parentWbs) as string;
      const row = byRef.get(ref);
      if (!row) {
        return res.status(404).json({
          error: `親チケット「${ref}」がこのAPIキーのプロジェクトに見つかりません。GET /api/v1/tickets で探せます`,
        });
      }
      if (row.parent_id) {
        return res.status(400).json({
          error: `「${row.wbs}」は子チケットです。その下にさらに子は作れません（階層は1段までです）`,
        });
      }
      if (t.parentId && t.parentWbs && t.parentWbs !== row.wbs) {
        ctx.warnings.push(`「${t.title}」: parentId と parentWbs が食い違うため parentId（${row.wbs}）を採用しました`);
      }
      parentOf.set(t, row);
    }
  }

  // ── 既存の子の枝番を見て、その続きから振る ──
  const nextBranch = new Map<string, number>();
  if (parentOf.size > 0) {
    const parentById = new Map<string, ParentRow>();
    for (const p of parentOf.values()) { parentById.set(p.id, p); nextBranch.set(p.id, 1); }

    const { data: childRows, error: childError } = await sb
      .from("sprint_tickets").select("parent_id, wbs").in("parent_id", [...parentById.keys()]);
    if (childError) return res.status(500).json({ error: childError.message });

    for (const row of childRows ?? []) {
      const parent = parentById.get(row.parent_id as string);
      if (!parent) continue;
      // 枝番はゼロ埋めしていないため、文字列ソートでは "…-9" > "…-10" になり10で頭打ちになる。
      // 数値に直して最大値を取る（画面側 NewTicketDialog の BRU4-058 と同じ理由）。
      const n = parseInt(String(row.wbs).slice(parent.wbs.length + 1), 10);
      if (!Number.isNaN(n)) nextBranch.set(parent.id, Math.max(nextBranch.get(parent.id) ?? 1, n + 1));
    }

    // 1リクエストで同じ親に足せる数の上限
    const perParent = new Map<string, number>();
    for (const t of toExisting) {
      const p = parentOf.get(t) as ParentRow;
      const c = (perParent.get(p.id) ?? 0) + 1;
      if (c > MAX_CHILDREN_PER_PARENT) {
        return res.status(400).json({
          error: `「${p.wbs}」に足す子チケットが多すぎます（1回のリクエストで${MAX_CHILDREN_PER_PARENT}件まで）`,
        });
      }
      perParent.set(p.id, c);
    }
  }

  // ── プラン上限（画面側と同じ判定をサーバーでも行う） ──
  // 既存チケットへの追加は親のスプリントに入るため、登録先はスプリントごとに分かれうる。
  const totalBySprint = new Map<string, number>();
  const addTo = (sid: string, n: number) => totalBySprint.set(sid, (totalBySprint.get(sid) ?? 0) + n);
  for (const t of newRoots) addTo((sprint as { id: string }).id, 1 + t.children.length);
  for (const t of toExisting) addTo((parentOf.get(t) as ParentRow).sprint_id, 1);

  const limits = await fetchPlanLimits(sb, key.organization_id ?? (project?.organization_id as string | null) ?? null);
  if (!limits.featureBulkCreate) {
    return res.status(403).json({ error: "現在のプランではAPIからのチケット作成をご利用いただけません" });
  }
  if (limits.maxTicketsPerSprint != null) {
    for (const [sid, count] of totalBySprint) {
      const { count: existing } = await sb
        .from("sprint_tickets").select("id", { count: "exact", head: true }).eq("sprint_id", sid);
      const remaining = Math.max(0, limits.maxTicketsPerSprint - (existing ?? 0));
      if (count > remaining) {
        return res.status(403).json({
          error: `プランの上限数（${limits.maxTicketsPerSprint}件）を超えるため作成できません。残り作成可能件数: ${remaining}件（今回: ${count}件）`,
        });
      }
    }
  }

  // ── WBS採番（DB側で直列化。並列に叩かれても番号が重複しない） ──
  // 採るのは新しく作る親のぶんだけ。既存チケットの子は親の枝番を使うので消費しない。
  let prefix = "T";
  let n = 0;
  if (newRoots.length > 0) {
    prefix = (sprint as any).identifier || "T";
    const { data: startNo, error: seqError } = await sb.rpc("reserve_ticket_wbs", {
      p_project_id: key.project_id,
      p_prefix: prefix,
      p_count: newRoots.length,
    });
    if (seqError || typeof startNo !== "number") {
      return res.status(500).json({
        error: `WBSの採番に失敗しました: ${seqError?.message ?? "unknown"}。supabase/add_api_keys.sql が適用されているか確認してください`,
      });
    }
    n = startNo;
  }

  // ── 行の組み立て（親子を1回の insert にまとめる） ──
  const rows: Record<string, unknown>[] = [];
  const created: { wbs: string; title: string; id: string; parentWbs: string | null }[] = [];
  const notifySource: { assignee: string; id: string; wbs: string; title: string }[] = [];

  const toRow = (t: NormalizedTicket, wbs: string, id: string, parentId: string | null, targetSprintId: string) => ({
    id, sprint_id: targetSprintId, wbs,
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
    // 列は not null default false。指定なしは既定値と同じ false を書く（行ごとに列をそろえるため省略しない）
    pr_link_waived: t.prLinkWaived ?? defaultPrLinkWaived,
    // 実績（BRU22-005）は指定があるときだけ列を含める。どの行にも指定が無ければ、送る列は改修前と同じになる。
    // 行ごとに列が違うときは、supabase-js が全行の列の和で送り、指定の無い行は null（＝未設定。既定値と同じ）になる
    ...(t.actualHours !== null ? { actual_work_hours: t.actualHours } : {}),
    ...(t.startedAt ? { started_at: jstStartOfDay(t.startedAt) } : {}),
    ...(t.completedAt ? { released_at: jstStartOfDay(t.completedAt) } : {}),
  });

  // created は入力順（tickets の並び）で返す
  for (const t of tickets) {
    const existingParent = parentOf.get(t);
    if (existingParent) {
      const branch = nextBranch.get(existingParent.id) ?? 1;
      nextBranch.set(existingParent.id, branch + 1);
      const wbs = `${existingParent.wbs}-${branch}`;
      const id = newTicketId();
      rows.push(toRow(t, wbs, id, existingParent.id, existingParent.sprint_id));
      created.push({ wbs, title: t.title, id, parentWbs: existingParent.wbs });
      if (t.assignee) notifySource.push({ assignee: t.assignee, id, wbs, title: t.title });
      continue;
    }

    const targetSprintId = (sprint as { id: string }).id;
    const parentWbs = `${prefix}-${String(n++).padStart(3, "0")}`;
    const parentId = newTicketId();
    rows.push(toRow(t, parentWbs, parentId, null, targetSprintId));
    created.push({ wbs: parentWbs, title: t.title, id: parentId, parentWbs: null });
    if (t.assignee) notifySource.push({ assignee: t.assignee, id: parentId, wbs: parentWbs, title: t.title });

    // 新規作成した親なので既存の子は存在しない。枝番は1から振れる（既存仕様と同形式）
    let childNum = 1;
    for (const child of t.children) {
      const childWbs = `${parentWbs}-${childNum++}`;
      const childId = newTicketId();
      rows.push(toRow(child, childWbs, childId, parentId, targetSprintId));
      created.push({ wbs: childWbs, title: child.title, id: childId, parentWbs });
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
    // 登録自体は済んでいるので、Slack の失敗でレスポンスを落とさない
    await notifyAssignSlack(sb, project, notifySource).catch(e =>
      console.error("[api/v1] slack:", (e as Error)?.message));
  }

  return res.status(201).json({
    ok: true,
    count: created.length,
    sprint: sprint ? { id: sprint.id, name: sprint.name } : null,
    created: created.map(c => ({ wbs: c.wbs, title: c.title, parentWbs: c.parentWbs })),
    warnings: ctx.warnings,
  });
}

// ── バックログ（BRU24-002） ───────────────────────────────────
//
// 外部システム・AIからバックログへ項目を登録する。チケット登録と同じキー・同じ件数上限。
// 本文の Markdown 変換・担当者・分類の照合は normalizeTicket をそのまま使う
// （ステータス・日付・実績などチケット固有の項目は渡さない）。
// 番号は reserve_backlog_ids() で採るので、画面や別のリクエストと同時でも重ならない。

const BACKLOG_STATUS_LABEL_BY_VALUE: Record<string, string> = {
  open: "未対応", "in-progress": "対応中", converted: "チケット化済", archived: "アーカイブ",
};
const BACKLOG_STATUS_BY_LABEL: Record<string, string> = {
  "未対応": "open", "対応中": "in-progress", "チケット化済": "converted", "アーカイブ": "archived",
  open: "open", inprogress: "in-progress", converted: "converted", archived: "archived",
};

/** バックログに使う項目だけを取り出す（チケット固有の項目は捨てる） */
function pickBacklogInput(raw: any): TicketInput {
  const v = (raw ?? {}) as Record<string, unknown>;
  return {
    title: v.title, description: v.description, priority: v.priority,
    assignee: v.assignee, estimatedHours: v.estimatedHours, category: v.category,
  };
}

function backlogItemUrl(slug: string | null | undefined, id: string): string | null {
  const origin = appPublicOrigin();
  return origin && slug ? `${origin}/${encodeURIComponent(slug)}/backlog/${encodeURIComponent(id)}` : null;
}

// ── GET /api/v1/backlog ──────────────────────────────────────
async function handleListBacklog(sb: SupabaseClient, key: ApiKeyRow, query: any, res: any) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : Array.isArray(v) ? String(v[0] ?? "").trim() : "");
  const keywordQ = str(query?.q);
  const statusQ = str(query?.status);
  const folderIdQ = str(query?.folderId);

  const rawLimit = Number(str(query?.limit));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), LIST_MAX_LIMIT)
    : LIST_DEFAULT_LIMIT;

  let status: string | null = null;
  if (statusQ) {
    status = BACKLOG_STATUS_BY_LABEL[statusQ] ?? BACKLOG_STATUS_BY_LABEL[normalizeValue(statusQ)] ?? null;
    if (!status) {
      return res.status(400).json({ error: `status「${statusQ}」は使えません（未対応 / 対応中 / チケット化済 / アーカイブ）` });
    }
  }

  // BUG-01: rank + id で安定ソート。必ずキーのプロジェクトで絞る（テナント境界）
  let q = sb
    .from("backlog_items")
    .select("id, title, status, priority, assignee, parent_id, parent_item_id, converted_ticket_wbs")
    .eq("project_id", key.project_id)
    .eq("is_folder", false)
    .order("rank", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1);
  if (status) q = q.eq("status", status);
  if (folderIdQ) q = q.eq("parent_id", folderIdQ);
  if (keywordQ) {
    // or(...) は文字列のまま PostgREST へ渡るので、区切り記号は落としてから使う
    const k = keywordQ.replace(/[,()%*\\]/g, " ").trim();
    if (k) q = q.or(`title.ilike.%${k}%,description.ilike.%${k}%`);
  }

  const [{ data: rows, error }, { data: project }, { data: folders }] = await Promise.all([
    q,
    sb.from("projects").select("slug").eq("id", key.project_id).maybeSingle(),
    sb.from("backlog_items").select("id, title").eq("project_id", key.project_id).eq("is_folder", true),
  ]);
  if (error) return res.status(500).json({ error: error.message });

  const all = rows ?? [];
  const hasMore = all.length > limit;
  const page = hasMore ? all.slice(0, limit) : all;
  const folderName = new Map((folders ?? []).map((f: any) => [f.id as string, (f.title as string) || "無題のフォルダ"]));

  return res.status(200).json({
    count: page.length,
    hasMore,
    items: page.map((b: any) => ({
      id: b.id,
      title: b.title,
      status: BACKLOG_STATUS_LABEL_BY_VALUE[b.status] ?? b.status,
      priority: PRIORITY_LABEL_BY_VALUE[b.priority] ?? b.priority,
      assignee: b.assignee || null,
      parentId: b.parent_item_id ?? null,
      folderId: b.parent_id ?? null,
      folderName: b.parent_id ? (folderName.get(b.parent_id) ?? null) : null,
      ticketWbs: b.converted_ticket_wbs ?? null,
      url: backlogItemUrl(project?.slug as string | undefined, b.id),
    })),
  });
}

// ── POST /api/v1/backlog ─────────────────────────────────────
async function handleCreateBacklog(sb: SupabaseClient, key: ApiKeyRow, body: any, res: any) {
  const rawItems = body?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return res.status(400).json({ error: "items は1件以上の配列で指定してください" });
  }
  if (rawItems.length > MAX_PARENTS_PER_REQUEST) {
    return res.status(400).json({ error: `1回のリクエストで登録できるのは${MAX_PARENTS_PER_REQUEST}件までです` });
  }
  const folderId = typeof body?.folderId === "string" ? body.folderId.trim() : "";

  const [{ data: project }, { data: categoryRows }] = await Promise.all([
    sb.from("projects").select("slug, members, organization_id").eq("id", key.project_id).maybeSingle(),
    sb.from("ticket_categories").select("id, name").eq("project_id", key.project_id),
  ]);
  if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

  // 登録先フォルダ。キーのプロジェクトのフォルダに限る（他プロジェクトのフォルダIDは見つからない扱い）
  let folder: { id: string; name: string } | null = null;
  if (folderId) {
    const { data: folderRow, error: folderError } = await sb
      .from("backlog_items").select("id, title")
      .eq("project_id", key.project_id).eq("id", folderId).eq("is_folder", true).maybeSingle();
    if (folderError) return res.status(500).json({ error: folderError.message });
    if (!folderRow) {
      const { data: folders } = await sb.from("backlog_items").select("id, title")
        .eq("project_id", key.project_id).eq("is_folder", true)
        .order("rank", { ascending: true }).order("id", { ascending: true });
      return res.status(404).json({
        error: `フォルダ「${folderId}」がこのAPIキーのプロジェクトに見つかりません。GET /api/v1/context の backlogFolders で確認できます`,
        availableFolders: (folders ?? []).map((f: any) => ({ id: f.id, name: f.title || "無題のフォルダ" })),
      });
    }
    folder = { id: folderRow.id as string, name: (folderRow.title as string) || "無題のフォルダ" };
  }

  const ctx: NormalizeCtx = {
    members: Array.isArray(project.members) ? (project.members as string[]) : [],
    categories: (categoryRows ?? []) as { id: string; name: string }[],
    warnings: [],
  };

  const items: { item: NormalizedTicket; children: NormalizedTicket[] }[] = [];
  for (const raw of rawItems) {
    const normalized = normalizeTicket(pickBacklogInput(raw), ctx, false);
    if ("error" in normalized) return res.status(400).json({ error: normalized.error });
    const rawChildren = (raw as any)?.children;
    const children: NormalizedTicket[] = [];
    if (rawChildren !== undefined && rawChildren !== null && !Array.isArray(rawChildren)) {
      return res.status(400).json({ error: `「${normalized.title}」: children は配列で指定してください` });
    }
    if (Array.isArray(rawChildren)) {
      if (rawChildren.length > MAX_CHILDREN_PER_PARENT) {
        return res.status(400).json({ error: `「${normalized.title}」: 子の項目が多すぎます（1件あたり${MAX_CHILDREN_PER_PARENT}件まで）` });
      }
      for (const c of rawChildren) {
        const child = normalizeTicket(pickBacklogInput(c), ctx, true);
        if ("error" in child) return res.status(400).json({ error: child.error });
        if (Array.isArray((c as any)?.children) && (c as any).children.length > 0) {
          ctx.warnings.push(`「${child.title}」: 子の項目の階層は1段までのため、その下の children は無視しました`);
        }
        children.push(child);
      }
    }
    items.push({ item: normalized, children });
  }

  const limits = await fetchPlanLimits(sb, key.organization_id ?? (project.organization_id as string | null) ?? null);
  if (!limits.featureBulkCreate) {
    return res.status(403).json({ error: "現在のプランではAPIからのバックログ登録をご利用いただけません" });
  }

  // ── 番号の予約（DB側で直列化。並列に叩かれても重複しない） ──
  const total = items.reduce((n, i) => n + 1 + i.children.length, 0);
  const { data: startNo, error: seqError } = await sb.rpc("reserve_backlog_ids", {
    p_project_id: key.project_id,
    p_count: total,
  });
  if (seqError || typeof startNo !== "number") {
    return res.status(500).json({
      error: `バックログ番号の採番に失敗しました: ${seqError?.message ?? "unknown"}。supabase/add_backlog_parent_attachments_BRU24-001.sql が適用されているか確認してください`,
    });
  }
  let n = startNo;
  const nextId = () => `B-${String(n++).padStart(3, "0")}`;

  // ── 行の組み立て（親子を1回の insert にまとめる。子のフォルダは親と同じ） ──
  const rankBase = Date.now();
  const rows: Record<string, unknown>[] = [];
  const created: { id: string; title: string; parentId: string | null }[] = [];
  const toRow = (t: NormalizedTicket, id: string, parentItemId: string | null) => ({
    id, project_id: key.project_id,
    parent_id: folder?.id ?? null,
    parent_item_id: parentItemId,
    is_folder: false,
    title: t.title,
    // backlog_items.description は not null default ''
    description: t.descriptionHtml ?? "",
    status: "open",
    priority: t.priority,
    assignee: t.assignee,
    estimated_hours: t.estimatedHours,
    category_id: t.categoryId,
    images: [],
    rank: rankBase + rows.length,
    created_by: key.created_by || "",
  });

  for (const { item, children } of items) {
    const parentId = nextId();
    rows.push(toRow(item, parentId, null));
    created.push({ id: parentId, title: item.title, parentId: null });
    for (const child of children) {
      const childId = nextId();
      rows.push(toRow(child, childId, parentId));
      created.push({ id: childId, title: child.title, parentId });
    }
  }

  const { error: insertError } = await sb.from("backlog_items").insert(rows);
  if (insertError) {
    return res.status(500).json({ error: `バックログ項目の登録に失敗しました: ${insertError.message}` });
  }

  return res.status(201).json({
    ok: true,
    count: created.length,
    folder,
    created: created.map(c => ({ ...c, url: backlogItemUrl(project.slug as string | undefined, c.id) })),
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
  if (resource !== "tickets" && resource !== "context" && resource !== "ticket" && resource !== "ticket-status"
    && resource !== "ticket-update" && resource !== "ticket-pull" && resource !== "ticket-comment" && resource !== "backlog") {
    return res.status(404).json({
      error: `不明なエンドポイントです: /api/v1/${resource}（tickets / context / ticket / ticket-status / ticket-update / ticket-pull / ticket-comment / backlog のいずれか）`,
    });
  }

  let sb: SupabaseClient;
  try { sb = admin(); } catch { return res.status(500).json({ error: "Supabase not configured" }); }

  const auth = await authenticateApiKey(sb, req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  if (resource === "context") {
    if (req.method !== "GET") return res.status(405).json({ error: "GET を使ってください" });
    return handleContext(sb, auth.key, res);
  }

  const scope = auth.key.scope;
  /** 権限が足りないときの 403。どの権限のキーが要るのかまで伝える（AIが利用者へそのまま報告できるように） */
  const denied = (what: string, needs: string) => res.status(403).json({
    error: `このAPIキー（権限: ${SCOPE_LABEL[scope]}）では${what}できません。${needs}のキーを発行して使ってください`,
  });

  if (resource === "ticket") {
    if (req.method !== "GET") return res.status(405).json({ error: "GET を使ってください" });
    if (scope === "write") return denied("チケットの中身を読み取り", "権限が「読み取りのみ」または「すべて」");
    try {
      return await handleTicketDetail(sb, auth.key, req.query ?? {}, res);
    } catch (e: any) {
      return res.status(500).json({ error: `処理中にエラーが発生しました: ${e?.message ?? String(e)}` });
    }
  }

  if (resource === "ticket-status") {
    if (req.method !== "POST") return res.status(405).json({ error: "POST を使ってください" });
    if (scope !== "full") return denied("ステータスを更新", "権限が「すべて」");
    let statusBody: any;
    try {
      statusBody = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    } catch {
      return res.status(400).json({ error: "リクエストボディが JSON として読めません" });
    }
    try {
      return await handleUpdateStatus(sb, auth.key, statusBody, res);
    } catch (e: any) {
      return res.status(500).json({ error: `処理中にエラーが発生しました: ${e?.message ?? String(e)}` });
    }
  }

  if (resource === "ticket-update") {
    if (req.method !== "POST") return res.status(405).json({ error: "POST を使ってください" });
    if (scope !== "full") return denied("チケットを修正", "権限が「すべて」");
    let updateBody: any;
    try {
      updateBody = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    } catch {
      return res.status(400).json({ error: "リクエストボディが JSON として読めません" });
    }
    try {
      return await handleUpdateTicket(sb, auth.key, updateBody, res);
    } catch (e: any) {
      return res.status(500).json({ error: `処理中にエラーが発生しました: ${e?.message ?? String(e)}` });
    }
  }

  if (resource === "ticket-pull") {
    if (req.method !== "POST") return res.status(405).json({ error: "POST を使ってください" });
    if (scope !== "full") return denied("PRを紐づけ", "権限が「すべて」");
    let pullBody: any;
    try {
      pullBody = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    } catch {
      return res.status(400).json({ error: "リクエストボディが JSON として読めません" });
    }
    try {
      return await handleLinkPull(sb, auth.key, pullBody, res);
    } catch (e: any) {
      return res.status(500).json({ error: `処理中にエラーが発生しました: ${e?.message ?? String(e)}` });
    }
  }

  if (resource === "ticket-comment") {
    if (req.method !== "POST") return res.status(405).json({ error: "POST を使ってください" });
    if (scope !== "full") return denied("コメントを登録", "権限が「すべて」");
    let commentBody: any;
    try {
      commentBody = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    } catch {
      return res.status(400).json({ error: "リクエストボディが JSON として読めません" });
    }
    try {
      return await handleCreateComment(sb, auth.key, commentBody, res);
    } catch (e: any) {
      return res.status(500).json({ error: `処理中にエラーが発生しました: ${e?.message ?? String(e)}` });
    }
  }

  if (resource === "backlog") {
    if (req.method === "GET") {
      if (scope === "write") return denied("バックログの一覧を読み取り", "権限が「読み取りのみ」または「すべて」");
      try {
        return await handleListBacklog(sb, auth.key, req.query ?? {}, res);
      } catch (e: any) {
        return res.status(500).json({ error: `処理中にエラーが発生しました: ${e?.message ?? String(e)}` });
      }
    }
    if (req.method !== "POST") return res.status(405).json({ error: "一覧は GET、登録は POST を使ってください" });
    if (scope === "read") return denied("バックログへ登録", "権限が「登録のみ」または「すべて」");
    let backlogBody: any;
    try {
      backlogBody = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    } catch {
      return res.status(400).json({ error: "リクエストボディが JSON として読めません" });
    }
    try {
      return await handleCreateBacklog(sb, auth.key, backlogBody, res);
    } catch (e: any) {
      return res.status(500).json({ error: `処理中にエラーが発生しました: ${e?.message ?? String(e)}` });
    }
  }

  // resource === "tickets"
  // GET は一覧（子チケットを足す親を探すため）、POST は登録。
  if (req.method === "GET") {
    try {
      return await handleListTickets(sb, auth.key, req.query ?? {}, res);
    } catch (e: any) {
      return res.status(500).json({ error: `処理中にエラーが発生しました: ${e?.message ?? String(e)}` });
    }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "一覧は GET、登録は POST を使ってください" });
  if (scope === "read") return denied("チケットを登録", "権限が「登録のみ」または「すべて」");

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
