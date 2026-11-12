// BRU25-015-1 高度検索：ブラウザの AI（Gemini・ChatGPT・Claude）に添付する資料ファイル（.md）を作る本体。
//
//   POST /api/research/materials {projectId, ai, part?, summary?}
//     … その人が見られるプロジェクトの資料をすべて、出典の番号つきの文字にまとめる。
//       量（トークンの目安）・種類ごとの件数・AI ごとの分け方と、part 番目のファイルの中身を返す。
//
// 振り分けとログイン中の人の認証は api/research/[action].ts が行い、ここは中身だけを持つ。
//
// ★ 見られる範囲の判定 ★
//   高度検索の API（api/_lib/researchSearch.ts）と同じ関数を使い、判定を書き写さない。
//   ・プロジェクトの権限で「権限なし」の種類（Wiki・議事録・バックログ）は入れない … accessForOwner
//   ・議事録の公開範囲（can_view_meeting_minute と同じ） … loadMinuteVisibility
//   ・限定公開のファイル（fileAccess.ts の決まり）と、各ファイルの最新の版だけ … loadVisibleFiles
//   ・フォルダの行は入れない。チケットのコメントのうち、ステータス変更の自動記録（status_change）は入れない
//   ・本文は HTML のタグを除いた文字にする（htmlToText。api/v1 と同じ変換）
//   ・BUG-01: 並びは毎回同じにする（種類ごとに日付の古い順、同じ日付は ID 順）
//
// ★ 分け方 ★
//   トークン数は正確に数えられないので、文字数からの目安（英数字 0.3・それ以外 1.0）で数える。
//   AI ごとの一度に読める量から、プロンプトと答えの分の余裕を引いた量を1ファイルの上限にして、資料の区切り
//   （1件ごと。チケットはコメントと一緒）で分ける。同じ条件なら毎回同じ分け方になるので、part を変えて
//   何回呼んでも、つなげると1つの資料になる。
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KeyOwner } from "./research.js";
import {
  accessForOwner, loadMinuteVisibility, loadVisibleFiles, fetchAllRows, folderPath, fileFolderPath,
  BACKLOG_STATUS_LABEL, PRIORITY_LABEL,
} from "./researchSearch.js";
import { htmlToText } from "./htmlText.js";

export const BROWSER_AIS = ["gemini", "chatgpt", "claude"] as const;
export type BrowserAi = typeof BROWSER_AIS[number];

/**
 * AI ごとの一度に読める量（トークン）。
 *   ・Gemini … Google Workspace（Business Standard）の Gemini アプリは 100万（Workspace 管理者向けの表。チケットの記載）
 *   ・Claude … claude.ai の有料プランは 20万（Anthropic のヘルプ「How large is the context window on paid Claude plans?」。
 *              一部のモデルはもっと大きいが、どのモデルでも入るよう 20万 にする）
 *   ・ChatGPT … プラン・モデルで違い、公式の値を確かめきれていない（要確認）。有料プランの大きめの値として 12.8万 にする
 * 変えるときは、画面の「入ります／分けます」の表示も同じ値で決まる（この表を API が返す）。
 */
export const BROWSER_AI_LIMITS: Record<BrowserAi, { label: string; contextTokens: number }> = {
  gemini: { label: "Gemini", contextTokens: 1_000_000 },
  chatgpt: { label: "ChatGPT", contextTokens: 128_000 },
  claude: { label: "Claude", contextTokens: 200_000 },
};
/** 読める量のうち資料に使う割合（目安の誤差の分の余裕） */
const SAFETY_RATIO = 0.75;
/** プロンプトと答えの分として、さらに引く量 */
const PROMPT_AND_ANSWER_TOKENS = 20_000;

export function perFileTokens(ai: BrowserAi): number {
  return Math.floor(BROWSER_AI_LIMITS[ai].contextTokens * SAFETY_RATIO) - PROMPT_AND_ANSWER_TOKENS;
}

/** 文字数からトークンの目安を出す（英数字はおよそ 3〜4 文字で1トークン、日本語はおよそ 1 文字で1トークン） */
export function estimateTokens(s: string): number {
  let ascii = 0, other = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xdc00 && c <= 0xdfff) continue; // サロゲートペアの後ろ半分は数えない
    if (c < 0x80) ascii++; else other++;
  }
  return Math.ceil(ascii * 0.3 + other);
}

/** 画面（helpers.ts の TICKET_STATUSES）と同じ表示名。子チケットの closed は「対応完了」 */
const TICKET_STATUS_LABEL: Record<string, string> = {
  todo: "未着手", "in-progress": "進行中", "in-review": "レビュー中", "review-done": "レビュー完了",
  "stg-test": "STG完了", uat: "UAT完了", done: "対応完了", closed: "クローズ",
  "waiting-release": "リリース待ち", released: "クローズ", "on-hold": "保留中", withdrawn: "取下",
};

const KIND_ORDER = ["minutes", "wiki", "ticket", "backlog", "file"] as const;
type MaterialKind = typeof KIND_ORDER[number] | "comment";
export const MATERIAL_KIND_LABEL: Record<MaterialKind, string> = {
  minutes: "議事録", wiki: "Wiki", ticket: "チケット", comment: "コメント", backlog: "バックログ", file: "ファイル",
};

/** in() に一度に渡す ID の数（URL が長くなりすぎないように） */
const ID_CHUNK = 150;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 「2026-11-12」の形（JST）。日付だけの値（会議日）はそのまま */
function jstDate(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = new Date(s).getTime();
  if (isNaN(t)) return s.slice(0, 10);
  return new Date(t + JST_OFFSET_MS).toISOString().slice(0, 10);
}
/** 「2026-11-12 09:30」の形（JST） */
function jstDateTime(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const t = new Date(s).getTime();
  if (isNaN(t)) return s.slice(0, 16);
  return new Date(t + JST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

/** 1件分の資料。番号は全体を並べたあとで振る */
interface Entry {
  kind: MaterialKind;
  id: string;
  title: string;
  date: string | null;
  url: string | null;
  /** 番号・種類・タイトルの行の下に並べる情報（「ステータス: 進行中」など） */
  meta: string[];
  body: string;
}
/** 分けるときの区切り。チケットはコメントと一緒にする */
interface Block { sortDate: string; sortId: string; entries: Entry[] }

export interface MaterialsResult {
  project: { name: string; slug: string };
  totalTokens: number;
  counts: Record<MaterialKind, number>;
  /** 入れなかった種類と理由（権限なし・SQL 未適用など） */
  excluded: { kind: MaterialKind; reason: string }[];
  plans: Record<BrowserAi, { label: string; contextTokens: number; perFileTokens: number; files: number }>;
}

export interface MaterialsFile { name: string; index: number; total: number; tokens: number; content: string }

const byDateThenId = (a: Block, b: Block) =>
  a.sortDate !== b.sortDate ? (a.sortDate < b.sortDate ? -1 : 1) : a.sortId < b.sortId ? -1 : a.sortId > b.sortId ? 1 : 0;

/** 資料を集める。並びは毎回同じ */
async function collect(
  sb: SupabaseClient, projectId: string, owner: KeyOwner, origin: string,
): Promise<{ ok: true; projectName: string; slug: string; blocks: Map<string, Block[]>; excluded: MaterialsResult["excluded"] } | { ok: false; status: number; error: string }> {
  const access = await accessForOwner(sb, projectId, owner);
  const slug = access.slug;
  const { data: project } = await sb.from("projects").select("name").eq("id", projectId).maybeSingle();
  const projectName = String(project?.name ?? slug);
  const text = (html: unknown) => htmlToText(String(html ?? "")).text;
  const url = (path: string) => (slug ? `${origin}/${encodeURIComponent(slug)}${path}` : null);
  const excluded: MaterialsResult["excluded"] = [];
  const blocks = new Map<string, Block[]>(KIND_ORDER.map(k => [k, []]));
  const fail = (e: string) => ({ ok: false as const, status: 500, error: `資料を集められませんでした: ${e}` });
  const noPerm = (kind: MaterialKind) => excluded.push({ kind, reason: `あなたには${MATERIAL_KIND_LABEL[kind]}の権限が無いため、入れていません` });

  // ── 議事録 ──
  if (access.perms.minutes === "none") noPerm("minutes");
  else {
    const vis = await loadMinuteVisibility(sb, projectId, owner);
    if (vis.error) return fail(vis.error);
    const ids = [...vis.byId.values()].filter(m => !m.is_folder && !vis.hidden.has(String(m.id))).map(m => String(m.id)).sort();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const { data, error } = await sb.from("meeting_minutes")
        .select("id, title, meeting_date, attendees, content, parent_id, created_at")
        .eq("project_id", projectId).in("id", ids.slice(i, i + ID_CHUNK)).order("id", { ascending: true });
      if (error) return fail(error.message);
      for (const m of (data ?? []) as any[]) {
        const date = jstDate(m.meeting_date) ?? jstDate(m.created_at);
        const attendees = Array.isArray(m.attendees)
          ? m.attendees.map((a: any) => (typeof a === "string" ? a : String(a?.name ?? ""))).filter(Boolean) : [];
        const folder = folderPath(vis.byId, m.parent_id);
        blocks.get("minutes")!.push({
          sortDate: date ?? "", sortId: String(m.id),
          entries: [{
            kind: "minutes", id: String(m.id), title: m.title || "無題の議事録", date,
            url: url(`/minutes/${encodeURIComponent(String(m.id))}`),
            meta: [
              `会議日: ${date ?? "（未設定）"}`,
              ...(attendees.length ? [`参加者: ${attendees.join("、")}`] : []),
              ...(folder ? [`フォルダ: ${folder}`] : []),
            ],
            body: text(m.content),
          }],
        });
      }
    }
  }

  // ── Wiki ──
  if (access.perms.wiki === "none") noPerm("wiki");
  else {
    const all = await fetchAllRows<any>((from, to) => sb.from("wiki_pages")
      .select("id, title, content, parent_id, is_folder, updated_at, created_at")
      .eq("project_id", projectId).order("id", { ascending: true }).range(from, to));
    if (all.error) return fail(all.error);
    const byId = new Map(all.rows.map(r => [String(r.id), r]));
    for (const w of all.rows) {
      if (w.is_folder) continue;
      const date = jstDate(w.updated_at) ?? jstDate(w.created_at);
      const path = folderPath(byId, w.parent_id);
      blocks.get("wiki")!.push({
        sortDate: date ?? "", sortId: String(w.id),
        entries: [{
          kind: "wiki", id: String(w.id), title: w.title || "無題のページ", date,
          url: url(`/wiki/pages/${encodeURIComponent(String(w.id))}`),
          meta: [`更新日: ${date ?? "（不明）"}`, ...(path ? [`親ページ: ${path}`] : [])],
          body: text(w.content),
        }],
      });
    }
  }

  // ── チケットとコメント ──
  {
    const { data: sprints, error: sErr } = await sb.from("sprints").select("id").eq("project_id", projectId).order("id", { ascending: true });
    if (sErr) return fail(sErr.message);
    const sprintIds = (sprints ?? []).map((s: any) => String(s.id));
    if (sprintIds.length > 0) {
      const tickets = await fetchAllRows<any>((from, to) => sb.from("sprint_tickets")
        .select("id, wbs, title, status, priority, assignee, parent_id, description, created_at")
        .in("sprint_id", sprintIds).order("id", { ascending: true }).range(from, to));
      if (tickets.error) return fail(tickets.error);
      const ids = tickets.rows.map(t => String(t.id));
      const commentsByTicket = new Map<string, any[]>();
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK);
        const cs = await fetchAllRows<any>((from, to) => sb.from("ticket_comments")
          .select("id, ticket_id, user_name, content, created_at")
          .in("ticket_id", chunk).neq("comment_type", "status_change")
          .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to));
        if (cs.error) return fail(cs.error);
        for (const c of cs.rows) {
          const k = String(c.ticket_id);
          const list = commentsByTicket.get(k);
          if (list) list.push(c); else commentsByTicket.set(k, [c]);
        }
      }
      const wbsById = new Map(tickets.rows.map(t => [String(t.id), String(t.wbs)]));
      for (const t of tickets.rows) {
        const wbs = String(t.wbs);
        const date = jstDate(t.created_at);
        const status = t.parent_id && t.status === "closed" ? "対応完了" : (TICKET_STATUS_LABEL[t.status] ?? String(t.status ?? ""));
        const parentWbs = t.parent_id ? wbsById.get(String(t.parent_id)) ?? null : null;
        const entries: Entry[] = [{
          kind: "ticket", id: wbs, title: `${wbs} ${t.title ?? ""}`.trim(), date,
          url: url(`/${encodeURIComponent(wbs)}`),
          meta: [
            `ステータス: ${status}`,
            ...(t.priority ? [`優先度: ${PRIORITY_LABEL[t.priority] ?? t.priority}`] : []),
            ...(t.assignee ? [`担当: ${t.assignee}`] : []),
            ...(parentWbs ? [`親チケット: ${parentWbs}`] : []),
            `作成日: ${date ?? "（不明）"}`,
          ],
          body: text(t.description),
        }];
        // コメントは書いた日時の古い順（取得の並びのまま）
        for (const c of commentsByTicket.get(String(t.id)) ?? []) {
          const body = text(c.content);
          if (!body) continue;
          entries.push({
            kind: "comment", id: wbs, title: `${wbs} のコメント`, date: jstDate(c.created_at),
            url: url(`/${encodeURIComponent(wbs)}`),
            meta: [`書いた人: ${c.user_name || "（不明）"}`, `日時: ${jstDateTime(c.created_at) ?? "（不明）"}`],
            body,
          });
        }
        blocks.get("ticket")!.push({ sortDate: date ?? "", sortId: wbs, entries });
      }
    }
  }

  // ── バックログ ──
  if (access.perms.backlog === "none") noPerm("backlog");
  else {
    const all = await fetchAllRows<any>((from, to) => sb.from("backlog_items")
      .select("id, title, description, status, priority, assignee, parent_id, is_folder, converted_ticket_wbs, created_at")
      .eq("project_id", projectId).order("id", { ascending: true }).range(from, to));
    if (all.error) return fail(all.error);
    const byId = new Map(all.rows.map(r => [String(r.id), r]));
    for (const b of all.rows) {
      if (b.is_folder) continue;
      const date = jstDate(b.created_at);
      const folder = folderPath(byId, b.parent_id);
      blocks.get("backlog")!.push({
        sortDate: date ?? "", sortId: String(b.id),
        entries: [{
          kind: "backlog", id: String(b.id), title: b.title || "無題の項目", date,
          url: url(`/backlog/${encodeURIComponent(String(b.id))}`),
          meta: [
            `ステータス: ${BACKLOG_STATUS_LABEL[b.status] ?? b.status ?? ""}`,
            ...(b.priority ? [`優先度: ${PRIORITY_LABEL[b.priority] ?? b.priority}`] : []),
            ...(b.assignee ? [`担当: ${b.assignee}`] : []),
            ...(b.converted_ticket_wbs ? [`チケット化: ${b.converted_ticket_wbs}`] : []),
            ...(folder ? [`フォルダ: ${folder}`] : []),
            `作成日: ${date ?? "（不明）"}`,
          ],
          body: text(b.description),
        }],
      });
    }
  }

  // ── ファイルボックスのファイル（各ファイルの最新の版の、中の文字） ──
  {
    const files = await loadVisibleFiles(sb, projectId, owner);
    if (files.error) return fail(files.error);
    const latest = [...files.latest].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
    const textById = new Map<string, { text: string; error: string | null }>();
    let missing = false;
    for (let i = 0; i < latest.length && !missing; i += ID_CHUNK) {
      const { data, error } = await sb.from("project_file_texts").select("file_id, text, error")
        .in("file_id", latest.slice(i, i + ID_CHUNK).map(f => String(f.id))).order("file_id", { ascending: true });
      if (error) { missing = true; break; }
      for (const r of (data ?? []) as any[]) textById.set(String(r.file_id), { text: String(r.text ?? ""), error: r.error ?? null });
    }
    if (missing) {
      excluded.push({ kind: "file", reason: "ファイルの文字を保存するテーブル（supabase/add_project_file_texts.sql）がまだ無いため、ファイルを入れていません" });
    } else {
      for (const f of latest) {
        const date = jstDate(f.created_at);
        const t = textById.get(String(f.id));
        const folder = fileFolderPath(files.byId, f.parent_id);
        const body = t?.text?.trim()
          ? t.text
          : `（このファイルの中の文字は取り出せていません${t?.error ? `：${t.error}` : "。ファイルボックスで開くか、管理者が「既存ファイルの文字を取り出す」を押すと入ります"}）`;
        blocks.get("file")!.push({
          sortDate: date ?? "", sortId: String(f.id),
          entries: [{
            kind: "file", id: String(f.id), title: f.file_name, date,
            url: url(`/files?file=${encodeURIComponent(String(f.id))}`),
            meta: [...(folder ? [`フォルダ: ${folder}`] : []), `更新日: ${date ?? "（不明）"}`, ...(f.version ? [`版: ${f.version}`] : [])],
            body,
          }],
        });
      }
    }
  }

  for (const list of blocks.values()) list.sort(byDateThenId);
  return { ok: true, projectName, slug, blocks, excluded };
}

/** 1件を Markdown にする */
function renderEntry(no: number, e: Entry): string {
  const lines = [
    `### [${no}] ${MATERIAL_KIND_LABEL[e.kind]}「${e.title}」`,
    "",
    `- 番号: [${no}] ／ 種類: ${e.kind}（${MATERIAL_KIND_LABEL[e.kind]}） ／ ID: ${e.id}`,
    `- 日付: ${e.date ?? "（不明）"}`,
    `- URL: ${e.url ?? "（なし）"}`,
    ...e.meta.map(m => `- ${m}`),
    "",
    e.body.trim() || "（本文なし）",
    "",
  ];
  return lines.join("\n");
}

/** 区切りごとの Markdown と量。番号は全体で通しにする（分けても番号が変わらない） */
function renderBlocks(blocks: Map<string, Block[]>): { kind: string; text: string; tokens: number }[] {
  const out: { kind: string; text: string; tokens: number }[] = [];
  let no = 0;
  for (const kind of KIND_ORDER) {
    for (const b of blocks.get(kind) ?? []) {
      const text = b.entries.map(e => renderEntry(++no, e)).join("\n");
      out.push({ kind, text, tokens: estimateTokens(text) });
    }
  }
  return out;
}

/** 1ファイルの上限で、区切りごとに分ける（1件で上限を超えるものは、そのまま1ファイルにする） */
function splitIntoParts(rendered: { tokens: number }[], limit: number): number[][] {
  const parts: number[][] = [];
  let cur: number[] = [];
  let curTokens = 0;
  rendered.forEach((r, i) => {
    if (cur.length > 0 && curTokens + r.tokens > limit) { parts.push(cur); cur = []; curTokens = 0; }
    cur.push(i);
    curTokens += r.tokens;
  });
  if (cur.length > 0 || parts.length === 0) parts.push(cur);
  return parts;
}

function todayJst(): string {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, "");
}

function safeSlugForFile(slug: string): string {
  return slug.replace(/[\\/:*?"<>|\s]+/g, "_") || "project";
}

export function materialsFileName(slug: string, index: number, total: number): string {
  const base = `資料_${safeSlugForFile(slug)}_${todayJst()}`;
  return total > 1 ? `${base}_${index}of${total}.md` : `${base}.md`;
}

function sectionTitle(kind: string): string {
  return `## ${MATERIAL_KIND_LABEL[kind as MaterialKind]}${kind === "ticket" ? "（コメントを含む）" : ""}`;
}

export async function buildMaterials(
  sb: SupabaseClient, projectId: string, owner: KeyOwner, origin: string,
  opts: { ai: BrowserAi; part: number | null },
): Promise<{ ok: true; summary: MaterialsResult; file: MaterialsFile | null } | { ok: false; status: number; error: string }> {
  const c = await collect(sb, projectId, owner, origin);
  if (!c.ok) return c;
  const rendered = renderBlocks(c.blocks);
  const totalTokens = rendered.reduce((s, r) => s + r.tokens, 0);
  const counts: Record<MaterialKind, number> = { minutes: 0, wiki: 0, ticket: 0, comment: 0, backlog: 0, file: 0 };
  for (const list of c.blocks.values()) for (const b of list) for (const e of b.entries) counts[e.kind]++;

  const plans = {} as MaterialsResult["plans"];
  const partsByAi = {} as Record<BrowserAi, number[][]>;
  for (const ai of BROWSER_AIS) {
    const limit = perFileTokens(ai);
    partsByAi[ai] = splitIntoParts(rendered, limit);
    plans[ai] = { ...BROWSER_AI_LIMITS[ai], perFileTokens: limit, files: partsByAi[ai].length };
  }
  const summary: MaterialsResult = { project: { name: c.projectName, slug: c.slug }, totalTokens, counts, excluded: c.excluded, plans };
  if (opts.part === null) return { ok: true, summary, file: null };

  const parts = partsByAi[opts.ai];
  const total = parts.length;
  if (opts.part < 1 || opts.part > total) {
    return { ok: false, status: 400, error: `part は 1〜${total} で指定してください（${BROWSER_AI_LIMITS[opts.ai].label} では ${total} ファイルに分けます）` };
  }
  const idx = parts[opts.part - 1];
  const head: string[] = [
    `# Dev Ticket の資料：${c.projectName}${total > 1 ? `（${opts.part}/${total}）` : ""}`,
    "",
    total > 1
      ? `このファイルは、全${total}ファイルのうちの${opts.part}番目です。全部を受け取ってから答えてください。`
      : "このファイルに、プロジェクトの資料がすべて入っています。",
    "各資料の見出しの [番号] を、答えの出典の番号（sources の no）に使ってください。",
    "",
  ];
  if (opts.part === 1) {
    head.push(
      `- プロジェクト: ${c.projectName}（${c.slug}）`,
      `- 作成日: ${todayJst().replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")}`,
      `- 量の目安: 約${Math.round(totalTokens / 1000).toLocaleString()}千トークン`,
      `- 件数: 議事録 ${counts.minutes}件・Wiki ${counts.wiki}ページ・チケット ${counts.ticket}件（コメント ${counts.comment}件）・バックログ ${counts.backlog}件・ファイル ${counts.file}件`,
      ...c.excluded.map(e => `- 入れていない資料: ${e.reason}`),
      "",
    );
  }
  const body: string[] = [];
  let lastKind = "";
  for (const i of idx) {
    const r = rendered[i];
    if (r.kind !== lastKind) { body.push(sectionTitle(r.kind) + "\n"); lastKind = r.kind; }
    body.push(r.text);
  }
  if (idx.length === 0) body.push("（このプロジェクトには、あなたが見られる資料がありません）\n");
  if (total > 1 && opts.part < total) body.push(`（${opts.part}/${total} はここまで。続きは次のファイルにあります）\n`);
  const content = head.join("\n") + "\n" + body.join("\n");
  return {
    ok: true, summary,
    file: { name: materialsFileName(c.slug, opts.part, total), index: opts.part, total, tokens: estimateTokens(content), content },
  };
}
