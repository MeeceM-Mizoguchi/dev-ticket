// ENHA2-055-2 高度検索：AI が議事録・Wiki・チケット・コメント・バックログをまとめて検索し、
// 必要なものだけ本文を読むための API の本体。
//
//   GET /api/v1/search?q=…&kinds=…&limit=…  … 横断検索。本文は返さず、当たった語の前後（抜粋）と画面のURLだけを返す
//   GET /api/v1/minutes                      … 議事録の一覧（ID・タイトル・会議日・フォルダ）
//   GET /api/v1/minutes?id=…                 … 議事録1件の本文（テキスト）・会議日・参加者
//   GET /api/v1/wiki                         … Wiki の一覧（ID・タイトル・親・更新日）
//   GET /api/v1/wiki?id=…                    … Wiki 1ページの本文（テキスト）
//   GET /api/v1/backlog-item?id=…            … バックログ1件の本文（テキスト）とステータス・優先度
//   GET /api/v1/file-text?id=…               … ファイルボックスの1ファイルから取り出した文字（ENHA2-056）
//
// ENHA2-056 search の kinds に file を足した。ファイルの中の文字は project_file_texts（api/_lib/fileText.ts が保存）。
//   ・各ファイルの最新の版だけを見る（古い版の文字では当たらない）。ファイル名に全部の語が入っているものも当てる。
//   ・限定公開（acl_id）のファイルは、キーを発行した人が見てよいもの（api/_lib/fileAccess.ts の決まり）だけを返す。
//   ・project_file_texts が無い環境（SQL 未適用）では、ファイルを検索の対象から外して excludedKinds に理由を書く。
//
// 振り分けと APIキーの認証は api/v1/[resource].ts が行い、ここは中身だけを持つ（read / full のキーだけ）。
// 本文のテキスト化（htmlToText）と画面のオリジンは [resource].ts のものを受け取って使う（同じ変換にそろえる）。
//
// ★ 見られる範囲の判定 ★
//   API は service_role で読むので RLS が効かない。画面と同じ決まりを、キーを発行した人（api_keys.created_by）で判定する。
//   ・議事録の公開範囲（supabase/add_minutes_client_notes_visibility.sql の can_view_meeting_minute と同じ）:
//     その行と上のフォルダすべてが「全員」か、作成者（owner_id）・公開先（meeting_minute_members）・オーナーのときだけ見られる。
//     visibility 列が無い環境（SQL 未適用）では、全員に公開として扱う（画面と同じ）。
//   ・プロジェクトの権限（MinutesPage などの effective*Perm と同じ）:
//     owner・admin はすべて見られる。それ以外は project_member_permissions の wiki / minutes / backlog の権限で、
//     書かれていなければ「権限なし」。権限なしの種類は、検索・一覧・本文のどれにも出さない。
//   ・フォルダの行（is_folder）は検索の対象から外す。
//   ・BUG-01: 並びは必ず .order() を2つ重ねて固定する。
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiKeyRow } from "./apiKeyAuth.js";
import { resolveKeyOwner, type KeyOwner } from "./research.js";
import { seesFileRow, sharedAclIds } from "./fileAccess.js";
import { latestVersions } from "./fileVersions.js";

export interface DocApiDeps {
  htmlToText: (html: string) => { text: string };
  /** 画面のオリジン（https://dv-ticket.com など）。空なら URL は null にする */
  appOrigin: () => string;
}

export const SEARCH_KINDS = ["ticket", "comment", "wiki", "minutes", "backlog", "file"] as const;
export type SearchKind = typeof SEARCH_KINDS[number];
const KIND_LABEL: Record<SearchKind, string> = {
  ticket: "チケット", comment: "コメント", wiki: "Wiki", minutes: "議事録", backlog: "バックログ", file: "ファイル",
};

const FILE_TEXTS_MISSING = "ファイルの文字を保存するテーブル（supabase/add_project_file_texts.sql）がまだ無いため、ファイルを検索の対象から外しました";

interface FileMeta {
  id: string; parent_id: string | null; file_name: string; version: number | null; is_folder: boolean;
  owner_id: string | null; acl_id: string | null; created_at: string | null; external_provider: string | null;
}

/**
 * プロジェクトのファイルのうち、キーを発行した人が見てよい「最新の版」だけを返す。
 * フォルダの行は名前をたどるために byId に入れる。
 */
export async function loadVisibleFiles(sb: SupabaseClient, projectId: string, owner: KeyOwner): Promise<{ latest: FileMeta[]; byId: Map<string, FileMeta>; error: string | null }> {
  const res = await fetchAllRows<FileMeta>((from, to) => sb.from("project_files")
    .select("id, parent_id, file_name, version, is_folder, owner_id, acl_id, created_at, external_provider")
    .eq("project_id", projectId).order("id", { ascending: true }).range(from, to));
  if (res.error) return { latest: [], byId: new Map(), error: res.error };
  const byId = new Map(res.rows.map(r => [String(r.id), r]));
  const actor = { id: owner.id, role: owner.role };
  const shared = await sharedAclIds(sb, actor);
  const latest = latestVersions(res.rows.filter(r => !r.is_folder)).filter(r => seesFileRow(actor, r, shared));
  return { latest, byId, error: null };
}

/** フォルダの名前を「親 / 子」の形でつなぐ（ファイルボックスは file_name がフォルダ名） */
export function fileFolderPath(byId: Map<string, FileMeta>, parentId: string | null): string | null {
  const names: string[] = [];
  let cur = parentId ? byId.get(String(parentId)) : undefined;
  for (let depth = 0; cur && depth < 50; depth++) {
    names.unshift(cur.file_name || "無題のフォルダ");
    cur = cur.parent_id ? byId.get(String(cur.parent_id)) : undefined;
  }
  return names.length ? names.join(" / ") : null;
}

const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;
/** 抜粋の長さ（当たった語の前後を合わせて、だいたいこの文字数） */
const EXCERPT_CHARS = 200;
/** 一覧で返す件数の上限 */
const LIST_MAX = 500;
/** 本文で返す文字数の上限（超えたら truncated: true） */
const MAX_BODY_CHARS = 100_000;
/** 検索語の数の上限 */
const MAX_TERMS = 5;
/** コメントを引くとき、in() に一度に渡すチケットIDの数（URL が長くなりすぎないように） */
const TICKET_ID_CHUNK = 150;
/** PostgREST が1回に返す行の上限（既定 1000）に合わせて、ページを分けて引く */
const PAGE = 1000;

export const BACKLOG_STATUS_LABEL: Record<string, string> = {
  open: "未対応", "in-progress": "対応中", converted: "チケット化済", archived: "アーカイブ",
};
export const PRIORITY_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : Array.isArray(v) ? String(v[0] ?? "").trim() : "");

// ── 見られる範囲 ──────────────────────────────────────────────
type Level = "none" | "view" | "edit";
export interface Access {
  owner: KeyOwner;
  slug: string;
  perms: { wiki: Level; minutes: Level; backlog: Level };
}

async function resolveAccess(sb: SupabaseClient, key: ApiKeyRow): Promise<{ ok: true; access: Access } | { ok: false; status: number; error: string }> {
  const ownerRes = await resolveKeyOwner(sb, key);
  if (!ownerRes.ok) return ownerRes;
  return { ok: true, access: await accessForOwner(sb, key.project_id, ownerRes.owner) };
}

/**
 * その人がプロジェクトで見られる種類（Wiki・議事録・バックログ）を決める。
 * APIキーの発行者（resolveAccess）と、画面からログイン中の人（BRU25-015 の資料ファイル）で同じ判定を使う。
 */
export async function accessForOwner(sb: SupabaseClient, projectId: string, owner: KeyOwner): Promise<Access> {
  const { data: project } = await sb.from("projects").select("slug").eq("id", projectId).maybeSingle();
  const slug = String(project?.slug ?? "");
  if (owner.role === "owner" || owner.role === "admin") {
    return { owner, slug, perms: { wiki: "edit", minutes: "edit", backlog: "edit" } };
  }
  const { data: perm } = await sb.from("project_member_permissions").select("permissions")
    .eq("project_id", projectId).eq("member_id", owner.id).maybeSingle();
  const p = (perm?.permissions ?? {}) as Record<string, unknown>;
  const lv = (v: unknown): Level => (v === "view" || v === "edit" ? v : "none");
  return { owner, slug, perms: { wiki: lv(p.wikiPermission), minutes: lv(p.minutesPermission), backlog: lv(p.backlogPermission) } };
}

interface MinuteMeta { id: string; parent_id: string | null; is_folder: boolean; title: string; visibility?: string; owner_id?: string | null }

/** 全行をページに分けて引く（PostgREST の1回あたりの上限を超えても取りこぼさない） */
export async function fetchAllRows<T>(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>, max = 20_000): Promise<{ rows: T[]; error: string | null }> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return { rows: out, error: error.message ?? String(error) };
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { rows: out, error: null };
}

/**
 * 議事録の行（フォルダを含む）と、キーを発行した人が見られない行の ID を返す。
 * 判定は can_view_meeting_minute と同じ（その行と上のフォルダすべてが見られるときだけ見られる）。
 */
export async function loadMinuteVisibility(sb: SupabaseClient, projectId: string, owner: KeyOwner): Promise<{ byId: Map<string, MinuteMeta>; hidden: Set<string>; error: string | null }> {
  const base = "id, parent_id, is_folder, title";
  let res = await fetchAllRows<MinuteMeta>((from, to) => sb.from("meeting_minutes").select(`${base}, visibility, owner_id`)
    .eq("project_id", projectId).order("id", { ascending: true }).range(from, to));
  let hasVisibility = true;
  if (res.error) {
    // 公開範囲の列が無い（add_minutes_client_notes_visibility.sql 未適用）環境は、全員に公開として扱う
    hasVisibility = false;
    res = await fetchAllRows<MinuteMeta>((from, to) => sb.from("meeting_minutes").select(base)
      .eq("project_id", projectId).order("id", { ascending: true }).range(from, to));
    if (res.error) return { byId: new Map(), hidden: new Set(), error: res.error };
  }
  const byId = new Map(res.rows.map(r => [String(r.id), r]));
  const hidden = new Set<string>();
  if (!hasVisibility || owner.role === "owner") return { byId, hidden, error: null };

  const restricted = res.rows.filter(r => r.visibility === "members" && String(r.owner_id ?? "") !== owner.id).map(r => String(r.id));
  let memberOf = new Set<string>();
  if (restricted.length > 0) {
    const { data: mm, error } = await sb.from("meeting_minute_members").select("meeting_minute_id")
      .eq("profile_id", owner.id).order("meeting_minute_id", { ascending: true });
    if (error) return { byId, hidden, error: error.message };
    memberOf = new Set((mm ?? []).map((m: any) => String(m.meeting_minute_id)));
  }
  const blocked = new Set(restricted.filter(id => !memberOf.has(id)));
  if (blocked.size === 0) return { byId, hidden, error: null };
  for (const r of res.rows) {
    let cur: MinuteMeta | undefined = r;
    for (let depth = 0; cur && depth < 50; depth++) {
      if (blocked.has(String(cur.id))) { hidden.add(String(r.id)); break; }
      cur = cur.parent_id ? byId.get(String(cur.parent_id)) : undefined;
    }
  }
  return { byId, hidden, error: null };
}

/** 上のフォルダの名前を「親 / 子」の形でつなぐ */
export function folderPath<T extends { parent_id: string | null; title: string }>(byId: Map<string, T>, parentId: string | null): string | null {
  const names: string[] = [];
  let cur = parentId ? byId.get(String(parentId)) : undefined;
  for (let depth = 0; cur && depth < 50; depth++) {
    names.unshift(cur.title || "無題のフォルダ");
    cur = cur.parent_id ? byId.get(String(cur.parent_id)) : undefined;
  }
  return names.length ? names.join(" / ") : null;
}

// ── 検索語 ────────────────────────────────────────────────────
/**
 * 空白（全角も）で区切った語。or(...) は文字列のまま PostgREST へ渡るので、
 * 区切り記号は落としてから使う（GET /api/v1/backlog と同じ扱い）。
 */
export function parseTerms(q: string): string[] {
  const terms = q.replace(/[,()%*\\"]/g, " ").split(/[\s　]+/).map(t => t.trim()).filter(Boolean);
  return Array.from(new Set(terms)).slice(0, MAX_TERMS);
}

/** すべての語を含むものだけに絞る（語ごとに「どれかの列に含む」を AND で重ねる） */
function applyTerms<Q extends { or: (f: string) => Q }>(q: Q, columns: string[], terms: string[]): Q {
  let out = q;
  for (const t of terms) out = out.or(columns.map(c => `${c}.ilike.%${t}%`).join(","));
  return out;
}

/** 当たった語の前後を EXCERPT_CHARS 文字くらい切り出す。本文に無ければ（タイトルだけ当たった）先頭から */
export function makeExcerpt(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return flat.length > EXCERPT_CHARS ? flat.slice(0, EXCERPT_CHARS) + "…" : flat;
  const start = Math.max(0, at - Math.floor(EXCERPT_CHARS * 0.4));
  const end = Math.min(flat.length, start + EXCERPT_CHARS);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

function parseKinds(raw: string): { ok: true; kinds: SearchKind[] } | { ok: false; error: string } {
  if (!raw) return { ok: true, kinds: [...SEARCH_KINDS] };
  const out: SearchKind[] = [];
  for (const k of raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)) {
    if (!(SEARCH_KINDS as readonly string[]).includes(k)) {
      return { ok: false, error: `kinds「${k}」は使えません（${SEARCH_KINDS.join(" / ")} をカンマ区切りで指定）` };
    }
    if (!out.includes(k as SearchKind)) out.push(k as SearchKind);
  }
  return out.length ? { ok: true, kinds: out } : { ok: true, kinds: [...SEARCH_KINDS] };
}

interface Hit {
  kind: SearchKind; kindLabel: string; id: string; wbs?: string; commentId?: string;
  title: string; date: string | null; excerpt: string; url: string | null;
  /** ファイルのときだけ。置き場所のフォルダ（「親 / 子」） */
  folder?: string | null;
}

/** 日付の新しい順。同じ日付は種類・ID で並べて、順番を固定する */
function compareHits(a: Hit, b: Hit): number {
  const ad = a.date ?? "", bd = b.date ?? "";
  if (ad !== bd) return ad < bd ? 1 : -1;
  if (a.kind !== b.kind) return SEARCH_KINDS.indexOf(a.kind) - SEARCH_KINDS.indexOf(b.kind);
  const ai = a.commentId ?? a.id, bi = b.commentId ?? b.id;
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

export function createDocHandlers(deps: DocApiDeps) {
  const text = (html: unknown) => deps.htmlToText(String(html ?? "")).text;
  const url = (slug: string, path: string) => {
    const origin = deps.appOrigin();
    return origin && slug ? `${origin}/${encodeURIComponent(slug)}${path}` : null;
  };
  const ticketUrl = (slug: string, wbs: string) => url(slug, `/${encodeURIComponent(wbs)}`);
  const noPerm = (res: any, what: string) => res.status(403).json({
    error: `このAPIキーを発行した人には、このプロジェクトの${what}を見る権限がありません（プロジェクトの権限設定で「権限なし」）`,
  });

  // ── GET /api/v1/search ──
  async function handleSearch(sb: SupabaseClient, key: ApiKeyRow, query: any, res: any) {
    const terms = parseTerms(str(query?.q));
    if (terms.length === 0) return res.status(400).json({ error: "q（検索する語）は必須です。空白で区切ると、すべての語を含むものだけを返します" });
    const kindsRes = parseKinds(str(query?.kinds));
    if (!kindsRes.ok) return res.status(400).json({ error: kindsRes.error });
    const rawLimit = Number(str(query?.limit));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), SEARCH_MAX_LIMIT) : SEARCH_DEFAULT_LIMIT;

    const accessRes = await resolveAccess(sb, key);
    if (!accessRes.ok) return res.status(accessRes.status).json({ error: accessRes.error });
    const { owner, slug, perms } = accessRes.access;

    const excluded: { kind: SearchKind; reason: string }[] = [];
    const kinds = kindsRes.kinds.filter(k => {
      const lv = k === "wiki" ? perms.wiki : k === "minutes" ? perms.minutes : k === "backlog" ? perms.backlog : "view";
      if (lv === "none") excluded.push({ kind: k, reason: `キーを発行した人に${KIND_LABEL[k]}の権限が無いため、検索の対象から外しました` });
      return lv !== "none";
    });

    const hits: Hit[] = [];
    // 1種類あたり limit 件まで引き、まとめて並べ直してから limit 件に切る
    const take = limit + 1;

    const tasks: Promise<string | null>[] = [];

    if (kinds.includes("ticket") || kinds.includes("comment")) {
      tasks.push((async () => {
        const { data: sprints, error: sErr } = await sb.from("sprints").select("id").eq("project_id", key.project_id)
          .order("id", { ascending: true });
        if (sErr) return sErr.message;
        const sprintIds = (sprints ?? []).map((s: any) => String(s.id));
        if (sprintIds.length === 0) return null;

        if (kinds.includes("ticket")) {
          const { data, error } = await applyTerms(
            sb.from("sprint_tickets").select("id, wbs, title, description, updated_at, created_at").in("sprint_id", sprintIds),
            ["title", "description"], terms,
          ).order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(take);
          if (error) return error.message;
          for (const t of (data ?? []) as any[]) {
            hits.push({
              kind: "ticket", kindLabel: KIND_LABEL.ticket, id: String(t.wbs), wbs: String(t.wbs),
              title: `${t.wbs} ${t.title ?? ""}`.trim(), date: (t.updated_at ?? t.created_at ?? null),
              excerpt: makeExcerpt(text(t.description), terms), url: ticketUrl(slug, String(t.wbs)),
            });
          }
        }

        if (kinds.includes("comment")) {
          const all = await fetchAllRows<any>((from, to) => sb.from("sprint_tickets").select("id, wbs, title")
            .in("sprint_id", sprintIds).order("id", { ascending: true }).range(from, to));
          if (all.error) return all.error;
          const ticketById = new Map(all.rows.map(t => [String(t.id), t]));
          const ids = all.rows.map(t => String(t.id));
          const chunks: string[][] = [];
          for (let i = 0; i < ids.length; i += TICKET_ID_CHUNK) chunks.push(ids.slice(i, i + TICKET_ID_CHUNK));
          const results = await Promise.all(chunks.map(chunk => applyTerms(
            sb.from("ticket_comments").select("id, ticket_id, content, created_at").in("ticket_id", chunk)
              .neq("comment_type", "status_change"),
            ["content"], terms,
          ).order("created_at", { ascending: false }).order("id", { ascending: true }).limit(take)));
          for (const r of results) {
            if (r.error) return r.error.message;
            for (const c of (r.data ?? []) as any[]) {
              const t = ticketById.get(String(c.ticket_id));
              if (!t) continue;
              hits.push({
                kind: "comment", kindLabel: KIND_LABEL.comment, id: String(t.wbs), wbs: String(t.wbs), commentId: String(c.id),
                title: `${t.wbs} ${t.title ?? ""}`.trim(), date: c.created_at ?? null,
                excerpt: makeExcerpt(text(c.content), terms), url: ticketUrl(slug, String(t.wbs)),
              });
            }
          }
        }
        return null;
      })());
    }

    if (kinds.includes("wiki")) {
      tasks.push((async () => {
        const { data, error } = await applyTerms(
          sb.from("wiki_pages").select("id, title, content, updated_at").eq("project_id", key.project_id).eq("is_folder", false),
          ["title", "content"], terms,
        ).order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(take);
        if (error) return error.message;
        for (const w of (data ?? []) as any[]) {
          hits.push({
            kind: "wiki", kindLabel: KIND_LABEL.wiki, id: String(w.id), title: w.title || "無題のページ",
            date: w.updated_at ?? null, excerpt: makeExcerpt(text(w.content), terms), url: url(slug, `/wiki/pages/${encodeURIComponent(String(w.id))}`),
          });
        }
        return null;
      })());
    }

    if (kinds.includes("minutes")) {
      tasks.push((async () => {
        const vis = await loadMinuteVisibility(sb, key.project_id, owner);
        if (vis.error) return vis.error;
        const hidden = [...vis.hidden];
        // 見られない行は DB の段階で外す（limit の前に外さないと、見られる行が取りこぼされる）。
        // 数が多いときは URL が長くなりすぎるので、多めに引いてから外す
        const exclude = hidden.length > 0 && hidden.length <= 300;
        let q = applyTerms(
          sb.from("meeting_minutes").select("id, title, content, meeting_date, updated_at").eq("project_id", key.project_id).eq("is_folder", false),
          ["title", "content"], terms,
        );
        if (exclude) q = q.not("id", "in", `(${hidden.join(",")})`);
        const { data, error } = await q.order("meeting_date", { ascending: false }).order("id", { ascending: true })
          .limit(exclude || hidden.length === 0 ? take : take * 10);
        if (error) return error.message;
        for (const m of (data ?? []) as any[]) {
          if (vis.hidden.has(String(m.id))) continue;
          hits.push({
            kind: "minutes", kindLabel: KIND_LABEL.minutes, id: String(m.id), title: m.title || "無題の議事録",
            date: m.meeting_date ?? m.updated_at ?? null, excerpt: makeExcerpt(text(m.content), terms),
            url: url(slug, `/minutes/${encodeURIComponent(String(m.id))}`),
          });
        }
        return null;
      })());
    }

    if (kinds.includes("backlog")) {
      tasks.push((async () => {
        const { data, error } = await applyTerms(
          sb.from("backlog_items").select("id, title, description, updated_at").eq("project_id", key.project_id).eq("is_folder", false),
          ["title", "description"], terms,
        ).order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(take);
        if (error) return error.message;
        for (const b of (data ?? []) as any[]) {
          hits.push({
            kind: "backlog", kindLabel: KIND_LABEL.backlog, id: String(b.id), title: b.title || "無題の項目",
            date: b.updated_at ?? null, excerpt: makeExcerpt(text(b.description), terms),
            url: url(slug, `/backlog/${encodeURIComponent(String(b.id))}`),
          });
        }
        return null;
      })());
    }

    // ENHA2-056 ファイルボックスのファイル（中の文字・ファイル名）
    if (kinds.includes("file")) {
      tasks.push((async () => {
        const files = await loadVisibleFiles(sb, key.project_id, owner);
        if (files.error) return files.error;
        if (files.latest.length === 0) return null;
        const byId = new Map(files.latest.map(f => [String(f.id), f]));
        const ids = [...byId.keys()];
        const textById = new Map<string, string>();
        const matched = new Set<string>();
        for (let i = 0; i < ids.length; i += TICKET_ID_CHUNK) {
          const { data, error } = await applyTerms(
            sb.from("project_file_texts").select("file_id, text").in("file_id", ids.slice(i, i + TICKET_ID_CHUNK)),
            ["text"], terms,
          ).order("file_id", { ascending: true }).limit(take);
          if (error) {
            // テーブルが無い（SQL 未適用）ときは、ファイルだけを外して他の種類の結果は返す
            excluded.push({ kind: "file", reason: FILE_TEXTS_MISSING });
            return null;
          }
          for (const r of (data ?? []) as any[]) {
            matched.add(String(r.file_id));
            textById.set(String(r.file_id), String(r.text ?? ""));
          }
        }
        // ファイル名にすべての語が入っているものも当てる（文字を取り出せない形式のファイルも探せるように）
        const lowerTerms = terms.map(t => t.toLowerCase());
        for (const f of files.latest) {
          const name = f.file_name.toLowerCase();
          if (lowerTerms.every(t => name.includes(t))) matched.add(String(f.id));
        }
        for (const id of matched) {
          const f = byId.get(id);
          if (!f) continue;
          hits.push({
            kind: "file", kindLabel: KIND_LABEL.file, id, title: f.file_name,
            folder: fileFolderPath(files.byId, f.parent_id), date: f.created_at ?? null,
            excerpt: makeExcerpt(textById.get(id) ?? "", terms),
            url: url(slug, `/files?file=${encodeURIComponent(id)}`),
          });
        }
        return null;
      })());
    }

    const errors = (await Promise.all(tasks)).filter((e): e is string => !!e);
    if (errors.length) return res.status(500).json({ error: `検索に失敗しました: ${errors[0]}` });

    // 日付は「2026-11-12」の形に寄せてから並べる（会議日は日付だけ、ほかは時刻つきのため）
    for (const h of hits) h.date = h.date ? String(h.date).slice(0, 10) : null;
    hits.sort(compareHits);
    const page = hits.slice(0, limit);
    return res.status(200).json({
      count: page.length,
      hasMore: hits.length > limit,
      terms,
      kinds,
      excludedKinds: excluded,
      results: page,
    });
  }

  // ── GET /api/v1/minutes ──
  async function handleMinutes(sb: SupabaseClient, key: ApiKeyRow, query: any, res: any) {
    const accessRes = await resolveAccess(sb, key);
    if (!accessRes.ok) return res.status(accessRes.status).json({ error: accessRes.error });
    const { owner, slug, perms } = accessRes.access;
    if (perms.minutes === "none") return noPerm(res, "議事録");
    const vis = await loadMinuteVisibility(sb, key.project_id, owner);
    if (vis.error) return res.status(500).json({ error: vis.error });

    const id = str(query?.id);
    if (id) {
      const meta = vis.byId.get(id);
      // 見られない行・フォルダ・ほかのプロジェクトの行は、有るか無いかも明かさない
      if (!meta || meta.is_folder || vis.hidden.has(id)) {
        return res.status(404).json({ error: `議事録「${id}」がこのAPIキーのプロジェクトに見つかりません。GET /api/v1/minutes で一覧を取れます` });
      }
      const { data: m, error } = await sb.from("meeting_minutes").select("id, title, meeting_date, attendees, content, updated_at")
        .eq("id", id).eq("project_id", key.project_id).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!m) return res.status(404).json({ error: `議事録「${id}」が見つかりません` });
      const body = text(m.content);
      return res.status(200).json({
        id: m.id, title: m.title || "無題の議事録", meetingDate: m.meeting_date ?? null,
        attendees: Array.isArray(m.attendees) ? m.attendees.map((a: any) => (typeof a === "string" ? a : String(a?.name ?? ""))).filter(Boolean) : [],
        folder: folderPath(vis.byId, meta.parent_id), updatedAt: m.updated_at ?? null,
        url: url(slug, `/minutes/${encodeURIComponent(String(m.id))}`),
        text: body.slice(0, MAX_BODY_CHARS), truncated: body.length > MAX_BODY_CHARS,
      });
    }

    const visibleIds = [...vis.byId.values()].filter(m => !m.is_folder && !vis.hidden.has(String(m.id))).map(m => String(m.id));
    const rows: any[] = [];
    // 本文を含めずに会議日だけ引く。見られる行だけに絞るため ID で引く（長い URL にならないよう分ける）
    for (let i = 0; i < visibleIds.length; i += TICKET_ID_CHUNK) {
      const { data, error } = await sb.from("meeting_minutes").select("id, title, meeting_date, parent_id, updated_at")
        .in("id", visibleIds.slice(i, i + TICKET_ID_CHUNK)).order("id", { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      rows.push(...(data ?? []));
    }
    rows.sort((a, b) => (a.meeting_date === b.meeting_date ? (a.id < b.id ? -1 : 1) : (String(a.meeting_date ?? "") < String(b.meeting_date ?? "") ? 1 : -1)));
    const page = rows.slice(0, LIST_MAX);
    return res.status(200).json({
      count: page.length,
      hasMore: rows.length > LIST_MAX,
      minutes: page.map(m => ({
        id: m.id, title: m.title || "無題の議事録", meetingDate: m.meeting_date ?? null,
        folder: folderPath(vis.byId, m.parent_id), updatedAt: m.updated_at ?? null,
        url: url(slug, `/minutes/${encodeURIComponent(String(m.id))}`),
      })),
    });
  }

  // ── GET /api/v1/wiki ──
  async function handleWiki(sb: SupabaseClient, key: ApiKeyRow, query: any, res: any) {
    const accessRes = await resolveAccess(sb, key);
    if (!accessRes.ok) return res.status(accessRes.status).json({ error: accessRes.error });
    const { slug, perms } = accessRes.access;
    if (perms.wiki === "none") return noPerm(res, "Wiki");

    const all = await fetchAllRows<any>((from, to) => sb.from("wiki_pages").select("id, title, parent_id, is_folder, updated_at")
      .eq("project_id", key.project_id).order("sort_order", { ascending: true }).order("id", { ascending: true }).range(from, to));
    if (all.error) return res.status(500).json({ error: all.error });
    const byId = new Map(all.rows.map(r => [String(r.id), r]));

    const id = str(query?.id);
    if (id) {
      const meta = byId.get(id);
      if (!meta || meta.is_folder) {
        return res.status(404).json({ error: `Wiki のページ「${id}」がこのAPIキーのプロジェクトに見つかりません。GET /api/v1/wiki で一覧を取れます` });
      }
      const { data: w, error } = await sb.from("wiki_pages").select("id, title, content, parent_id, updated_at")
        .eq("id", id).eq("project_id", key.project_id).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!w) return res.status(404).json({ error: `Wiki のページ「${id}」が見つかりません` });
      const body = text(w.content);
      return res.status(200).json({
        id: w.id, title: w.title || "無題のページ", parentId: w.parent_id ?? null, path: folderPath(byId, w.parent_id),
        updatedAt: w.updated_at ?? null, url: url(slug, `/wiki/pages/${encodeURIComponent(String(w.id))}`),
        text: body.slice(0, MAX_BODY_CHARS), truncated: body.length > MAX_BODY_CHARS,
      });
    }

    const pages = all.rows.filter(r => !r.is_folder)
      .sort((a, b) => (a.updated_at === b.updated_at ? (a.id < b.id ? -1 : 1) : (String(a.updated_at ?? "") < String(b.updated_at ?? "") ? 1 : -1)));
    const page = pages.slice(0, LIST_MAX);
    return res.status(200).json({
      count: page.length,
      hasMore: pages.length > LIST_MAX,
      pages: page.map(w => ({
        id: w.id, title: w.title || "無題のページ", parentId: w.parent_id ?? null,
        parentTitle: w.parent_id ? (byId.get(String(w.parent_id))?.title || null) : null,
        path: folderPath(byId, w.parent_id), updatedAt: w.updated_at ?? null,
        url: url(slug, `/wiki/pages/${encodeURIComponent(String(w.id))}`),
      })),
    });
  }

  // ── GET /api/v1/backlog-item ──
  async function handleBacklogItem(sb: SupabaseClient, key: ApiKeyRow, query: any, res: any) {
    const id = str(query?.id);
    if (!id) return res.status(400).json({ error: "id（バックログ項目のID。例: B-001）は必須です。GET /api/v1/backlog で一覧を取れます" });
    const accessRes = await resolveAccess(sb, key);
    if (!accessRes.ok) return res.status(accessRes.status).json({ error: accessRes.error });
    const { slug, perms } = accessRes.access;
    if (perms.backlog === "none") return noPerm(res, "バックログ");

    const { data: b, error } = await sb.from("backlog_items")
      .select("id, title, description, status, priority, assignee, parent_id, is_folder, converted_ticket_wbs, updated_at")
      .eq("id", id).eq("project_id", key.project_id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!b || b.is_folder) return res.status(404).json({ error: `バックログ項目「${id}」がこのAPIキーのプロジェクトに見つかりません` });
    let folder: string | null = null;
    if (b.parent_id) {
      const { data: f } = await sb.from("backlog_items").select("title").eq("id", b.parent_id).eq("project_id", key.project_id).maybeSingle();
      folder = f ? (f.title || "無題のフォルダ") : null;
    }
    const body = text(b.description);
    return res.status(200).json({
      id: b.id, title: b.title || "無題の項目",
      status: BACKLOG_STATUS_LABEL[b.status] ?? b.status, priority: PRIORITY_LABEL[b.priority] ?? b.priority,
      assignee: b.assignee || null, folder, ticketWbs: b.converted_ticket_wbs ?? null,
      updatedAt: b.updated_at ?? null, url: url(slug, `/backlog/${encodeURIComponent(String(b.id))}`),
      text: body.slice(0, MAX_BODY_CHARS), truncated: body.length > MAX_BODY_CHARS,
    });
  }

  // ── GET /api/v1/file-text（ENHA2-056） ──
  // 古い版の ID が渡されても、同じファイルの最新の版の文字を返す（ファイルボックスの共有リンクと同じ読み替え）
  async function handleFileText(sb: SupabaseClient, key: ApiKeyRow, query: any, res: any) {
    const id = str(query?.id);
    if (!id) return res.status(400).json({ error: "id（ファイルのID）は必須です。GET /api/v1/search?kinds=file で探せます" });
    const accessRes = await resolveAccess(sb, key);
    if (!accessRes.ok) return res.status(accessRes.status).json({ error: accessRes.error });
    const { owner, slug } = accessRes.access;

    const notFound = () => res.status(404).json({ error: `ファイル「${id}」がこのAPIキーのプロジェクトに見つかりません` });
    const { data: base } = await sb.from("project_files").select("id, parent_id, file_name, is_folder, project_id")
      .eq("id", id).eq("project_id", key.project_id).maybeSingle();
    if (!base || base.is_folder) return notFound();
    const files = await loadVisibleFiles(sb, key.project_id, owner);
    if (files.error) return res.status(500).json({ error: files.error });
    // 見てよくない限定公開のファイルは、有るか無いかも明かさない
    const latest = files.latest.find(f => f.file_name === base.file_name && (f.parent_id ?? null) === (base.parent_id ?? null));
    if (!latest) return notFound();

    const { data: t, error } = await sb.from("project_file_texts").select("text, error, extracted_at, extracted_version, source")
      .eq("file_id", latest.id).maybeSingle();
    if (error) return res.status(503).json({ error: FILE_TEXTS_MISSING });
    const body = String(t?.text ?? "");
    return res.status(200).json({
      id: latest.id, fileName: latest.file_name, folder: fileFolderPath(files.byId, latest.parent_id),
      version: latest.version ?? null, updatedAt: latest.created_at ?? null,
      google: latest.external_provider === "google",
      url: url(slug, `/files?file=${encodeURIComponent(String(latest.id))}`),
      extracted: !!t, extractedAt: t?.extracted_at ?? null,
      // 取り出せなかった理由（対象外の形式・画像だけのPDF・まだ取り出していない など）
      error: t ? (t.error ?? null) : (latest.external_provider === "google"
        ? "まだ文字を取り出していません（Googleのファイルは、ファイルボックスで誰かが開いたときに取り出します）"
        : "まだ文字を取り出していません"),
      text: body.slice(0, MAX_BODY_CHARS), truncated: body.length > MAX_BODY_CHARS,
    });
  }

  return { handleSearch, handleMinutes, handleWiki, handleBacklogItem, handleFileText };
}

