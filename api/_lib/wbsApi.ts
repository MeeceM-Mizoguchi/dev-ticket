// KAIZEN2611-013 WBS：APIキーを使って、AI や別のシステムが WBS を読み、更新する API の本体。
//
//   GET  /api/v1/wbs-sheets          … プロジェクトの WBS の一覧（キーの発行者が見られるものだけ）
//   GET  /api/v1/wbs?sheetId=…       … 1つの WBS の中身（行・ステータス・メンバー・版の番号）。並びは画面と同じ
//   POST /api/v1/wbs-update          … {sheetId, expectedVersion, operations} 行の追加・変更・並べ替え・チケットの紐づけ
//   POST /api/v1/wbs-proposal        … wbs-update と同じ形。すぐには反映せず「更新の案」として預ける（KAIZEN2611-015）
//   GET  /api/v1/wbs-proposal?id=…   … 案の状態（反映待ち・反映済み・取り消し）
//   案の反映・取り消しは、WBS 画面から（api/wbs/[action].ts の proposal-apply / proposal-reject）。
//
// 振り分けと APIキーの認証・権限（scope）の判定は api/v1/[resource].ts が行い、ここは中身だけを持つ。
//   読む API … 権限「読み取りのみ」「すべて」 / 書く API … 権限「すべて」だけ
//
// 見られるか・編集できるかは、キーの発行者（api_keys.created_by は profiles.name）を profiles.id に直して、
// DB の関数 wbs_user_can_view / wbs_user_can_edit（supabase/add_wbs_snapshots.sql）で確かめる。
// 画面からの WBS の操作（api/wbs/[action].ts）は APIキーを受けない作りなので、そちらには混ぜない。
//
// 更新は2段で行う。
//   1) ここで送られた操作を、今の中身に当てはめて確かめる。存在しない行の id・行の削除など、
//      反映できない操作が1つでもあれば 400 にして何も変えない。担当者・ステータスの名前違い、
//      段の数を超える追加などは、その項目だけを変えずに warnings に入れる。
//   2) DB の関数 wbs_api_apply（supabase/add_wbs_api_KAIZEN2611-013.sql）に、確かめた操作を渡す。
//      権限・ロック・版の番号の確認、反映前のバックアップ、行の反映を1回の処理で行い、途中で止まらない。
// 1) で読んだ中身と 2) の時点の中身が同じであることは、版の番号で保証する
// （最初に版の番号を読み、それが expectedVersion と同じときだけ進む。2) で DB がもう一度比べる）。
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import type { ApiKeyRow } from "./apiKeyAuth.js";

/** 1回のリクエストで送れる操作の数 */
const MAX_OPERATIONS = 200;
const MAX_NAME_LENGTH = 500;
const MAX_NOTE_LENGTH = 10_000;
/** 並び順の間隔（src/app/lib/wbsService.ts の WBS_SORT_GAP と同じ） */
const SORT_GAP = 1024;
/** 一度に読む行数（Supabase は既定で 1000 行までしか返さないので、分けて全部読む） */
const PAGE_SIZE = 1000;
const LEVEL_LABELS = ["大項目", "中項目", "小項目"];

const MISSING_FUNCTION_ERROR =
  "WBS を API で更新する仕組み（supabase/add_wbs_api_KAIZEN2611-013.sql）が、まだデータベースに作られていません。管理者に SQL の適用を依頼してください";

const PROPOSAL_MISSING_ERROR =
  "WBS の更新の案を預ける仕組み（supabase/add_wbs_proposals_KAIZEN2611-015.sql）が、まだデータベースに作られていません。管理者に SQL の適用を依頼してください";

// ── 共通 ─────────────────────────────────────────────────────

type Fail = { ok: false; status: number; body: Record<string, unknown> };
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Fail =>
  ({ ok: false, status, body: { error, ...extra } });

/** DB の関数が返した「できなかった理由」を、画面（api/wbs/[action].ts の failure）と同じ文とステータスに直す */
function reasonFailure(result: any): Fail {
  const reason = String(result?.reason ?? "");
  switch (reason) {
    case "not_found": return fail(404, "WBSが見つかりません", { code: reason });
    case "forbidden": return fail(403, "このWBSを編集する権限がありません", { code: reason });
    case "locked": return fail(409, "このWBSはロックされているため反映できません。反映する場合はロックを解除してください", { code: reason });
    case "archived": return fail(409, "このWBSはアーカイブ済みです", { code: reason });
    case "conflict": return fail(409, "ほかの人が編集しました", {
      code: reason, editedByName: result?.editedByName ?? "", editedAt: result?.editedAt ?? null,
      hint: "GET /api/v1/wbs で今の中身と版の番号（version）を読み直してから、送り直してください",
    });
    case "invalid": return fail(400, `反映できない操作がありました（${String(result?.detail ?? "")}）。WBS は何も変えていません`, { code: reason });
    default: return fail(500, "処理に失敗しました", { code: reason || "unknown" });
  }
}

function isMissingFunction(error: { code?: string; message?: string } | null | undefined, fn: string): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || (new RegExp(fn).test(error.message ?? "") && /Could not find|does not exist/i.test(error.message ?? ""));
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : Array.isArray(v) ? String(v[0] ?? "").trim() : "");

/** YYYY-MM-DD の実在する日付か */
function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 変更の一覧に出す日付。「12/5」。空は「未設定」 */
function dateText(s: string | null): string {
  if (!s) return "未設定";
  const [, m, d] = s.split("-");
  return `${Number(m)}/${Number(d)}`;
}
const quoted = (s: string) => (s ? `「${s}」` : "未設定");

/** select の結果を、PAGE_SIZE ずつ分けて全部読む（並びは呼び出し側の order で決める） */
async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

// ── キーの発行者 ─────────────────────────────────────────────

interface KeyOwner { id: string; name: string }

/**
 * キーを発行した人を profiles から引く（api/_lib/research.ts の resolveKeyOwner と同じ決め方）。
 * 1人に決まらないときは、誰の権限で WBS を見るか決められないので通さない。
 */
async function resolveOwner(sb: SupabaseClient, key: ApiKeyRow): Promise<{ ok: true; owner: KeyOwner } | Fail> {
  const name = String(key.created_by ?? "").trim();
  if (!name) return fail(403, "このAPIキーには発行した人の記録が無いため、WBS には使えません。APIキーを発行し直してください");
  const { data, error } = await sb
    .from("profiles").select("id, name, role, organization_id").eq("name", name)
    .order("id", { ascending: true });
  if (error) return fail(500, error.message);
  const rows = (data ?? []) as any[];
  const inOrg = rows.filter(p => String(p.organization_id ?? "") === String(key.organization_id ?? ""));
  const candidates = inOrg.length ? inOrg : rows.filter(p => p.role === "owner");
  if (candidates.length !== 1) {
    return fail(403, candidates.length
      ? `APIキーを発行した「${name}」と同じ名前のメンバーが複数いるため、WBS の権限を判定できません`
      : `APIキーを発行した「${name}」がメンバーに見つかりません。APIキーを発行し直してください`);
  }
  return { ok: true, owner: { id: String(candidates[0].id), name: String(candidates[0].name ?? name) } };
}

async function rpcBool(sb: SupabaseClient, fn: "wbs_user_can_view" | "wbs_user_can_edit", userId: string, sheetId: string): Promise<boolean> {
  const { data, error } = await sb.rpc(fn, { p_user_id: userId, p_sheet_id: sheetId });
  if (error) throw new Error(`権限の判定に失敗しました: ${error.message}。supabase/add_wbs_snapshots.sql が適用されているか確認してください`);
  return data === true;
}

// ── WBS の中身 ───────────────────────────────────────────────

interface SheetRow {
  id: string; project_id: string; name: string; levels: number; sort_order: number;
  edit_version?: number; is_locked?: boolean; archived_at?: string | null;
}

interface ItemState {
  id: string; parentId: string | null; level: number; name: string; assignee: string;
  startDate: string | null; endDate: string | null; progress: number; statusId: string | null; note: string; sortOrder: number;
}

interface StatusRow { id: string; name: string; color: string }

const isLocked = (s: SheetRow) => s.is_locked === true;
const sheetLevels = (s: SheetRow) => (s.levels === 1 || s.levels === 2 ? s.levels : 3);

/**
 * キーのプロジェクトの WBS を1つ読み、発行者が見られるかを確かめる。
 * 見られない WBS も「見つからない」と返す（存在を探れないようにする。api/wbs と同じ）。
 * 列は * で読む（edit_version・is_locked は後から足した列。名指しすると SQL 未適用の環境で読めなくなる）
 */
async function loadSheet(sb: SupabaseClient, key: ApiKeyRow, owner: KeyOwner, sheetId: string): Promise<{ ok: true; sheet: SheetRow } | Fail> {
  if (!sheetId) return fail(400, "sheetId は必須です。GET /api/v1/wbs-sheets で WBS の id を確かめてください");
  if (!/^[0-9a-f-]{36}$/i.test(sheetId)) return fail(400, `sheetId の形式が正しくありません: ${sheetId}`);
  const { data, error } = await sb.from("wbs_sheets").select("*").eq("id", sheetId).eq("project_id", key.project_id).maybeSingle();
  if (error) return fail(500, error.message);
  if (!data || !(await rpcBool(sb, "wbs_user_can_view", owner.id, sheetId))) return fail(404, "WBSが見つかりません", { code: "not_found" });
  const sheet = data as SheetRow;
  if (!("edit_version" in sheet)) {
    return fail(503, "WBS の版の番号（supabase/add_wbs_snapshots.sql）が、まだデータベースに作られていません。管理者に SQL の適用を依頼してください");
  }
  return { ok: true, sheet };
}

async function loadItems(sb: SupabaseClient, sheetId: string): Promise<ItemState[]> {
  const rows = await fetchAll<any>((from, to) => sb.from("wbs_items").select("*").eq("wbs_sheet_id", sheetId)
    .order("sort_order", { ascending: true }).order("id", { ascending: true }).range(from, to));
  return rows.map(r => ({
    id: String(r.id), parentId: r.parent_id ?? null, level: Number(r.level ?? 1),
    name: r.name ?? "", assignee: r.assignee ?? "", startDate: r.start_date ?? null, endDate: r.end_date ?? null,
    progress: Number(r.progress ?? 0), statusId: r.status_id ?? null, note: r.note ?? "", sortOrder: Number(r.sort_order ?? 0),
  }));
}

async function loadStatuses(sb: SupabaseClient, sheetId: string): Promise<StatusRow[]> {
  const { data, error } = await sb.from("wbs_statuses").select("id, name, color").eq("wbs_sheet_id", sheetId)
    .order("sort_order", { ascending: true }).order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StatusRow[];
}

/** 行の id → 紐づいたチケット（id と WBS 番号）。並びは紐づけた順（画面と同じ） */
async function loadLinks(sb: SupabaseClient, sheetId: string): Promise<Map<string, { ticketId: string; wbs: string }[]>> {
  const rows = await fetchAll<any>((from, to) => sb.from("wbs_item_tickets")
    .select("wbs_item_id, ticket_id, created_at, wbs_items!inner(wbs_sheet_id), sprint_tickets(wbs)")
    .eq("wbs_items.wbs_sheet_id", sheetId)
    .order("created_at", { ascending: true }).order("ticket_id", { ascending: true }).order("wbs_item_id", { ascending: true })
    .range(from, to));
  const map = new Map<string, { ticketId: string; wbs: string }[]>();
  for (const r of rows) {
    const entry = { ticketId: String(r.ticket_id), wbs: String(r.sprint_tickets?.wbs ?? "") };
    const list = map.get(r.wbs_item_id);
    if (list) list.push(entry); else map.set(r.wbs_item_id, [entry]);
  }
  return map;
}

async function loadMembers(sb: SupabaseClient, projectId: string): Promise<string[]> {
  const { data, error } = await sb.from("projects").select("members").eq("id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  const list = Array.isArray(data?.members) ? (data!.members as unknown[]) : [];
  return list.map(m => String(m ?? "").trim()).filter(Boolean);
}

/** 同じ親の下の行（並び順）。src/app/lib/wbsCalc.ts の siblingsOf と同じ */
function siblingsOf(items: Iterable<ItemState>, parentId: string | null): ItemState[] {
  return [...items]
    .filter(i => (i.parentId ?? null) === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/**
 * 画面と同じ並び（親の下に子を続ける）で行を並べ、上の段の進捗（一番右の段の行の平均）を出す。
 * src/app/lib/wbsCalc.ts の buildWbsRows と同じ決め方。親が見つからない行は大項目の並びに置く
 */
function orderRows(items: ItemState[], levels: number): { item: ItemState; no: number; progress: number | null; leaf: boolean }[] {
  const ids = new Set(items.map(i => i.id));
  const byParent = new Map<string | null, ItemState[]>();
  for (const it of items) {
    const k = it.parentId && ids.has(it.parentId) ? it.parentId : null;
    const list = byParent.get(k);
    if (list) list.push(it); else byParent.set(k, [it]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const out: { item: ItemState; no: number; progress: number | null; leaf: boolean }[] = [];
  const walk = (it: ItemState): number[] => {
    const leaf = it.level >= levels;
    const row = { item: it, no: out.length + 1, progress: null as number | null, leaf };
    out.push(row);
    const leaves: number[] = leaf ? [it.progress] : [];
    for (const child of byParent.get(it.id) ?? []) {
      const r = walk(child);
      if (!leaf) leaves.push(...r);
    }
    row.progress = leaves.length ? Math.round(leaves.reduce((a, b) => a + b, 0) / leaves.length) : null;
    return leaves;
  };
  for (const top of byParent.get(null) ?? []) walk(top);
  return out;
}

// ── ハンドラ ─────────────────────────────────────────────────

export function createWbsHandlers(opts: { appOrigin: () => string }) {
  const sheetUrl = (slug: string | null | undefined, sheetId: string) =>
    (slug ? `${opts.appOrigin()}/${slug}/wbs/${sheetId}` : null);

  async function projectSlug(sb: SupabaseClient, projectId: string): Promise<{ name: string; slug: string | null }> {
    const { data } = await sb.from("projects").select("name, slug").eq("id", projectId).maybeSingle();
    return { name: String(data?.name ?? ""), slug: (data?.slug as string | null) ?? null };
  }

  // ── GET /api/v1/wbs-sheets ──
  async function handleWbsSheets(sb: SupabaseClient, key: ApiKeyRow, _query: any, res: any) {
    const ownerRes = await resolveOwner(sb, key);
    if (!ownerRes.ok) return res.status(ownerRes.status).json(ownerRes.body);
    const owner = ownerRes.owner;

    const { data, error } = await sb.from("wbs_sheets").select("*").eq("project_id", key.project_id)
      .order("sort_order", { ascending: true }).order("id", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    const sheets = (data ?? []) as SheetRow[];
    const visible = await Promise.all(sheets.map(async s => {
      if (!(await rpcBool(sb, "wbs_user_can_view", owner.id, s.id))) return null;
      return { s, canEdit: await rpcBool(sb, "wbs_user_can_edit", owner.id, s.id) };
    }));
    const project = await projectSlug(sb, key.project_id);
    return res.status(200).json({
      project,
      keyOwner: owner.name,
      sheets: visible.filter((v): v is { s: SheetRow; canEdit: boolean } => !!v).map(({ s, canEdit }) => ({
        id: s.id,
        name: s.name ?? "",
        levels: sheetLevels(s),
        locked: isLocked(s),
        archived: !!s.archived_at,
        version: Number(s.edit_version ?? 0),
        canEdit,
        url: sheetUrl(project.slug, s.id),
      })),
    });
  }

  // ── GET /api/v1/wbs?sheetId=… ──
  async function handleWbsDetail(sb: SupabaseClient, key: ApiKeyRow, query: any, res: any) {
    const ownerRes = await resolveOwner(sb, key);
    if (!ownerRes.ok) return res.status(ownerRes.status).json(ownerRes.body);
    const sheetRes = await loadSheet(sb, key, ownerRes.owner, str(query?.sheetId));
    if (!sheetRes.ok) return res.status(sheetRes.status).json(sheetRes.body);
    const sheet = sheetRes.sheet;
    if (sheet.archived_at) return res.status(409).json({ error: "このWBSはアーカイブ済みです", code: "archived" });

    const levels = sheetLevels(sheet);
    const [items, statuses, links, members, canEdit, project] = await Promise.all([
      loadItems(sb, sheet.id), loadStatuses(sb, sheet.id), loadLinks(sb, sheet.id), loadMembers(sb, key.project_id),
      rpcBool(sb, "wbs_user_can_edit", ownerRes.owner.id, sheet.id), projectSlug(sb, key.project_id),
    ]);
    const statusName = new Map(statuses.map(s => [s.id, s.name]));
    // ステータスが付いていない行は、画面と同じく先頭のステータスとして扱う
    const fallback = statuses[0]?.name ?? "";
    const version = Number(sheet.edit_version ?? 0);

    return res.status(200).json({
      sheet: {
        id: sheet.id, name: sheet.name ?? "", levels, levelLabels: LEVEL_LABELS.slice(0, levels),
        locked: isLocked(sheet), archived: false, canEdit, version, url: sheetUrl(project.slug, sheet.id),
      },
      version,
      statuses: statuses.map(s => ({ name: s.name, color: s.color })),
      members,
      rows: orderRows(items, levels).map(({ item, no, progress, leaf }) => ({
        no,
        id: item.id,
        parentId: item.parentId,
        level: item.level,
        levelLabel: LEVEL_LABELS[Math.min(Math.max(item.level, 1), 3) - 1],
        name: item.name,
        assignee: item.assignee,
        startDate: item.startDate,
        endDate: item.endDate,
        // 上の段の行は、一番右の段の行の平均（画面と同じ。下に行が無ければ null）
        progress,
        progressEditable: leaf,
        status: (item.statusId && statusName.get(item.statusId)) || fallback,
        note: item.note,
        tickets: (links.get(item.id) ?? []).map(l => l.wbs).filter(Boolean),
      })),
    });
  }

  /**
   * wbs-update と wbs-proposal（KAIZEN2611-015）で共通の確かめ。
   * 送られた操作を今の中身に当てはめ、wbs_api_apply に渡す形（sqlOps）と、errors・warnings・変更の一覧を作る。
   * 確かめの処理はここ1か所にまとめる（どちらの入口からでも同じ結果になるように）
   */
  async function prepareWbsUpdate(sb: SupabaseClient, key: ApiKeyRow, owner: KeyOwner, body: any): Promise<Fail | {
    ok: true; sheet: SheetRow; expectedVersion: number;
    errors: string[]; warnings: string[]; changes: string[];
    created: { ref: string | null; id: string; name: string; level: number }[];
    sqlOps: Record<string, unknown>[];
  }> {
    const expectedVersion = Number(body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return fail(400, "expectedVersion は 0 以上の整数で指定してください（GET /api/v1/wbs の version）");
    }
    const operations = body?.operations;
    if (!Array.isArray(operations) || operations.length === 0) return fail(400, "operations は1件以上の配列で指定してください");
    if (operations.length > MAX_OPERATIONS) return fail(400, `operations は1回に ${MAX_OPERATIONS} 件までです`);

    // 版の番号を最初に読む。このあとに読む中身は、版の番号が expectedVersion のときのもの
    // （途中で編集されれば DB の確認で 409 になる）
    const sheetRes = await loadSheet(sb, key, owner, str(body?.sheetId));
    if (!sheetRes.ok) return sheetRes;
    const sheet = sheetRes.sheet;
    if (!(await rpcBool(sb, "wbs_user_can_edit", owner.id, sheet.id))) return reasonFailure({ reason: "forbidden" });
    if (sheet.archived_at) return reasonFailure({ reason: "archived" });
    if (isLocked(sheet)) return reasonFailure({ reason: "locked" });
    if (Number(sheet.edit_version ?? 0) !== expectedVersion) {
      const f = reasonFailure({ reason: "conflict", editedByName: (sheet as any).last_edited_by_name ?? "", editedAt: (sheet as any).last_edited_at ?? null });
      return { ...f, body: { ...f.body, version: Number(sheet.edit_version ?? 0) } };
    }

    const levels = sheetLevels(sheet);
    const [items, statuses, links, members] = await Promise.all([
      loadItems(sb, sheet.id), loadStatuses(sb, sheet.id), loadLinks(sb, sheet.id), loadMembers(sb, key.project_id),
    ]);
    const state = new Map(items.map(i => [i.id, { ...i }]));
    const linkState = new Map([...links].map(([k, v]) => [k, new Set(v.map(l => l.ticketId))]));
    const statusIdByName = new Map(statuses.map(s => [s.name, s.id]));
    const statusNameById = new Map(statuses.map(s => [s.id, s.name]));
    const statusLabel = (id: string | null) => (id && statusNameById.get(id)) || statuses[0]?.name || "未設定";
    const memberSet = new Set(members);

    // チケットの WBS 番号 → id（このプロジェクトのもの）。先に全部まとめて引く
    const ticketNumbers = new Set<string>();
    for (const op of operations) {
      for (const t of Array.isArray(op?.tickets) ? op.tickets : []) {
        if (typeof t === "string" && t.trim()) ticketNumbers.add(t.trim());
      }
    }
    const ticketByNumber = new Map<string, { id: string; wbs: string }[]>();
    if (ticketNumbers.size > 0) {
      const { data: sprintRows, error: spErr } = await sb.from("sprints").select("id").eq("project_id", key.project_id);
      if (spErr) return fail(500, spErr.message);
      const sprintIds = (sprintRows ?? []).map((s: any) => s.id);
      const wanted = [...new Set([...ticketNumbers].flatMap(n => [n, n.toUpperCase()]))];
      if (sprintIds.length > 0) {
        const { data: tRows, error: tErr } = await sb.from("sprint_tickets").select("id, wbs")
          .in("sprint_id", sprintIds).in("wbs", wanted).order("id", { ascending: true });
        if (tErr) return fail(500, tErr.message);
        for (const t of (tRows ?? []) as any[]) {
          const list = ticketByNumber.get(String(t.wbs).toUpperCase());
          if (list) list.push({ id: String(t.id), wbs: String(t.wbs) }); else ticketByNumber.set(String(t.wbs).toUpperCase(), [{ id: String(t.id), wbs: String(t.wbs) }]);
        }
      }
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const changes: string[] = [];
    const created: { ref: string | null; id: string; name: string; level: number }[] = [];
    const sqlOps: Record<string, unknown>[] = [];
    // add の ref → 作る行の id。段の数を超えて足さなかった add の ref は skippedRefs に入れる
    const refs = new Map<string, string>();
    const skippedRefs = new Set<string>();

    const labelOf = (it: ItemState) => `「${it.name || "(名前なし)"}」`;
    /** 行の id か、前の add の ref を、行の id に直す。見つからなければ null */
    const resolve = (v: unknown): string | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      const s = String(v).trim();
      if (refs.has(s)) return refs.get(s)!;
      return s;
    };
    const refSkipped = (...vals: unknown[]) => vals.some(v => typeof v === "string" && skippedRefs.has(v.trim()));

    /** 位置（beforeId / afterId）から並び順を決める。兄弟に無い行を指したら null */
    const orderAt = (parentId: string | null, selfId: string | null, beforeId: string | null | undefined, afterId: string | null | undefined): number | null => {
      const sibs = siblingsOf(state.values(), parentId).filter(i => i.id !== selfId);
      if (afterId) {
        const idx = sibs.findIndex(i => i.id === afterId);
        if (idx < 0) return null;
        const next = sibs[idx + 1];
        return next ? (sibs[idx].sortOrder + next.sortOrder) / 2 : sibs[idx].sortOrder + SORT_GAP;
      }
      if (beforeId) {
        const idx = sibs.findIndex(i => i.id === beforeId);
        if (idx < 0) return null;
        const prev = sibs[idx - 1];
        return prev ? (prev.sortOrder + sibs[idx].sortOrder) / 2 : sibs[idx].sortOrder - SORT_GAP;
      }
      return sibs.length ? sibs[sibs.length - 1].sortOrder + SORT_GAP : 0;
    };

    /**
     * 項目の値を確かめて、反映する値に直す。受けられない値は warnings に出して undefined を返す（その項目は変えない）
     */
    const readFields = (where: string, f: any, it: { level: number }) => {
      const out: Partial<Pick<ItemState, "name" | "assignee" | "startDate" | "endDate" | "progress" | "statusId" | "note">> = {};
      if (f.name !== undefined) {
        const v = typeof f.name === "string" ? f.name.trim() : null;
        if (v === null) warnings.push(`${where}：name は文字で指定してください（変えていません）`);
        else if (v.length > MAX_NAME_LENGTH) warnings.push(`${where}：name が長すぎます（${MAX_NAME_LENGTH}文字まで。変えていません）`);
        else out.name = v;
      }
      if (f.assignee !== undefined) {
        const v = f.assignee === null ? "" : typeof f.assignee === "string" ? f.assignee.trim() : null;
        if (v === null) warnings.push(`${where}：assignee は文字で指定してください（変えていません）`);
        else if (v && !memberSet.has(v)) warnings.push(`${where}：担当者「${v}」はプロジェクトのメンバーにいません（変えていません。members のいずれかで指定してください）`);
        else out.assignee = v;
      }
      for (const [k, label] of [["startDate", "開始日"], ["endDate", "終了日"]] as const) {
        if (f[k] === undefined) continue;
        const v = f[k] === null ? "" : typeof f[k] === "string" ? f[k].trim() : null;
        if (v === null || (v && !isRealDate(v))) warnings.push(`${where}：${label}「${String(f[k])}」は YYYY-MM-DD の日付ではありません（変えていません）`);
        else out[k] = v || null;
      }
      if (f.progress !== undefined) {
        const v = Number(f.progress);
        if (it.level < levels) warnings.push(`${where}：進捗は一番右の段（${LEVEL_LABELS[levels - 1]}）の行だけ変えられます（上の段は下の行の平均です。変えていません）`);
        else if (!Number.isInteger(v) || v < 0 || v > 100) warnings.push(`${where}：進捗「${String(f.progress)}」は 0〜100 の整数で指定してください（変えていません）`);
        else out.progress = v;
      }
      if (f.status !== undefined) {
        const v = typeof f.status === "string" ? f.status.trim() : "";
        const id = statusIdByName.get(v);
        if (!id) warnings.push(`${where}：ステータス「${String(f.status)}」はこのWBSにありません（変えていません。statuses のいずれかで指定してください）`);
        else out.statusId = id;
      }
      if (f.note !== undefined) {
        const v = f.note === null ? "" : typeof f.note === "string" ? f.note : null;
        if (v === null) warnings.push(`${where}：note は文字で指定してください（変えていません）`);
        else if (v.length > MAX_NOTE_LENGTH) warnings.push(`${where}：note が長すぎます（${MAX_NOTE_LENGTH}文字まで。変えていません）`);
        else out.note = v;
      }
      return out;
    };

    /** チケットの紐づけ（link / unlink、add の tickets） */
    const applyLinks = (where: string, it: ItemState, numbers: unknown, mode: "link" | "unlink") => {
      if (!Array.isArray(numbers) || numbers.length === 0) { errors.push(`${where}：tickets にチケットの WBS 番号を1件以上入れてください`); return; }
      const set = linkState.get(it.id) ?? new Set<string>();
      linkState.set(it.id, set);
      for (const raw of numbers) {
        const n = typeof raw === "string" ? raw.trim() : "";
        const hits = n ? (ticketByNumber.get(n.toUpperCase()) ?? []) : [];
        const exact = hits.filter(h => h.wbs === n);
        const hit = exact.length ? exact : hits;
        if (hit.length === 0) { warnings.push(`${where}：チケット「${String(raw)}」がこのプロジェクトに見つかりません（${mode === "link" ? "紐づけていません" : "外していません"}）`); continue; }
        if (hit.length > 1) { warnings.push(`${where}：WBS 番号「${n}」のチケットが複数あるため、どれか決められません（変えていません）`); continue; }
        const t = hit[0];
        if (mode === "link") {
          if (set.has(t.id)) continue;
          set.add(t.id);
          // ticket_wbs は比べる画面（KAIZEN2611-015）で番号を出すため。DB の関数は読まない
          sqlOps.push({ t: "link", item_id: it.id, ticket_id: t.id, ticket_wbs: t.wbs });
          changes.push(`${labelOf(it)}：チケット ${t.wbs} を紐づけ`);
        } else {
          if (!set.has(t.id)) { warnings.push(`${where}：チケット ${t.wbs} は紐づいていません（何もしていません）`); continue; }
          set.delete(t.id);
          sqlOps.push({ t: "unlink", item_id: it.id, ticket_id: t.id, ticket_wbs: t.wbs });
          changes.push(`${labelOf(it)}：チケット ${t.wbs} の紐づけを外す`);
        }
      }
    };

    const UPDATE_KEYS = new Set(["op", "id", "name", "assignee", "startDate", "endDate", "progress", "status", "note"]);

    operations.forEach((op: any, idx: number) => {
      const where = `operations[${idx}]`;
      if (!op || typeof op !== "object" || Array.isArray(op)) { errors.push(`${where}：操作はオブジェクトで指定してください`); return; }
      const kind = typeof op.op === "string" ? op.op.trim().toLowerCase() : "";
      if (kind === "delete" || kind === "remove") {
        errors.push(`${where}：行の削除は API ではできません。削除は WBS の画面で行ってください`);
        return;
      }

      if (kind === "add") {
        const ref = typeof op.ref === "string" && op.ref.trim() ? op.ref.trim() : null;
        if (ref && (refs.has(ref) || skippedRefs.has(ref))) { errors.push(`${where}：ref「${ref}」が重なっています`); return; }
        if (refSkipped(op.parentId)) {
          warnings.push(`${where}：親の行（ref「${String(op.parentId).trim()}」）を足していないので、この行も足していません`);
          if (ref) skippedRefs.add(ref);
          return;
        }
        const parentId = resolve(op.parentId) ?? null;
        const parent = parentId ? state.get(parentId) : null;
        if (parentId && !parent) { errors.push(`${where}：親の行「${parentId}」がこのWBSに見つかりません`); return; }
        const level = parent ? parent.level + 1 : 1;
        const name = typeof op.name === "string" ? op.name.trim() : "";
        if (!name) { errors.push(`${where}：追加する行の name は必須です`); return; }
        if (level > levels) {
          warnings.push(`${where}：「${name}」は${parent ? `「${parent.name}」の下の` : ""}${level}段目になり、このWBSの段の数（${levels}段）を超えるため足していません`);
          if (ref) skippedRefs.add(ref);
          return;
        }
        const beforeId = resolve(op.beforeId);
        const afterId = resolve(op.afterId);
        const sortOrder = orderAt(parentId, null, beforeId, afterId);
        if (sortOrder === null) { errors.push(`${where}：beforeId / afterId の行が、同じ親の下に見つかりません`); return; }
        const f = readFields(`${where}（「${name}」）`, { ...op, name }, { level });
        const it: ItemState = {
          id: crypto.randomUUID(), parentId, level, name: f.name ?? name,
          assignee: f.assignee ?? "", startDate: f.startDate ?? null, endDate: f.endDate ?? null,
          progress: f.progress ?? 0,
          // 画面と同じく、指定が無ければ先頭のステータス（既定では「未着手」）
          statusId: f.statusId ?? statuses[0]?.id ?? null,
          note: f.note ?? "", sortOrder,
        };
        state.set(it.id, it);
        if (ref) refs.set(ref, it.id);
        sqlOps.push({
          t: "insert", id: it.id, parent_id: it.parentId, level: it.level, name: it.name, assignee: it.assignee,
          start_date: it.startDate, end_date: it.endDate, progress: it.progress, status_id: it.statusId, note: it.note, sort_order: it.sortOrder,
        });
        created.push({ ref, id: it.id, name: it.name, level: it.level });
        const extra = [
          it.assignee && `担当者「${it.assignee}」`,
          (it.startDate || it.endDate) && `${dateText(it.startDate)}〜${dateText(it.endDate)}`,
        ].filter(Boolean).join("・");
        changes.push(`追加：「${it.name}」（${LEVEL_LABELS[level - 1]}${parent ? `・親「${parent.name}」` : ""}${extra ? `・${extra}` : ""}）`);
        if (op.tickets !== undefined) applyLinks(`${where}（「${name}」）`, it, op.tickets, "link");
        return;
      }

      if (kind === "update" || kind === "move" || kind === "link" || kind === "unlink") {
        if (refSkipped(op.id)) { warnings.push(`${where}：行（ref「${String(op.id).trim()}」）を足していないので、この操作もしていません`); return; }
        const id = resolve(op.id);
        const it = id ? state.get(id) : undefined;
        if (!it) { errors.push(`${where}：行「${String(op.id ?? "")}」がこのWBSに見つかりません`); return; }

        if (kind === "update") {
          const unknown = Object.keys(op).filter(k => !UPDATE_KEYS.has(k));
          if (unknown.length) warnings.push(`${where}：${unknown.join("・")} は update では変えられません（無視しました。段や位置は move で変えます）`);
          const f = readFields(`${where}（${labelOf(it)}）`, op, it);
          const set: Record<string, unknown> = {};
          const parts: string[] = [];
          if (f.name !== undefined && f.name !== it.name) { parts.push(`項目名 ${quoted(it.name)} → ${quoted(f.name)}`); set.name = f.name; }
          if (f.assignee !== undefined && f.assignee !== it.assignee) { parts.push(`担当者 ${quoted(it.assignee)} → ${quoted(f.assignee)}`); set.assignee = f.assignee; }
          if (f.startDate !== undefined && f.startDate !== it.startDate) { parts.push(`開始日 ${dateText(it.startDate)} → ${dateText(f.startDate)}`); set.start_date = f.startDate; }
          if (f.endDate !== undefined && f.endDate !== it.endDate) { parts.push(`終了日 ${dateText(it.endDate)} → ${dateText(f.endDate)}`); set.end_date = f.endDate; }
          if (f.progress !== undefined && f.progress !== it.progress) { parts.push(`進捗 ${it.progress}% → ${f.progress}%`); set.progress = f.progress; }
          if (f.statusId !== undefined && f.statusId !== it.statusId) { parts.push(`ステータス ${statusLabel(it.statusId)} → ${statusLabel(f.statusId)}`); set.status_id = f.statusId; }
          if (f.note !== undefined && f.note !== it.note) { parts.push("備考を変更"); set.note = f.note; }
          if (parts.length === 0) return;
          const label = labelOf(it);
          Object.assign(it, f);
          sqlOps.push({ t: "update", id: it.id, set });
          changes.push(`${label}：${parts.join("、")}`);
          return;
        }

        if (kind === "move") {
          if (refSkipped(op.parentId, op.beforeId, op.afterId)) { warnings.push(`${where}：移す先の行を足していないので、${labelOf(it)} は移していません`); return; }
          const parentGiven = op.parentId !== undefined;
          const parentId = parentGiven ? (resolve(op.parentId) ?? null) : it.parentId;
          const beforeId = resolve(op.beforeId);
          const afterId = resolve(op.afterId);
          if (!parentGiven && !beforeId && !afterId) { errors.push(`${where}：move には parentId・beforeId・afterId のどれかを指定してください`); return; }
          if (parentId !== null) {
            const parent = state.get(parentId);
            if (!parent) { errors.push(`${where}：移す先の親の行「${parentId}」がこのWBSに見つかりません`); return; }
            if (parent.level !== it.level - 1) {
              errors.push(`${where}：${labelOf(it)}（${LEVEL_LABELS[it.level - 1]}）は、${LEVEL_LABELS[it.level - 2] ?? "親の無い位置"}の行の下にしか移せません（段は変えられません）`);
              return;
            }
          } else if (it.level !== 1) {
            errors.push(`${where}：${labelOf(it)}（${LEVEL_LABELS[it.level - 1]}）は、親の無い位置（大項目の並び）へは移せません`);
            return;
          }
          const sortOrder = orderAt(parentId, it.id, beforeId, afterId);
          if (sortOrder === null) { errors.push(`${where}：beforeId / afterId の行が、移す先の同じ親の下に見つかりません`); return; }
          const set: Record<string, unknown> = { sort_order: sortOrder };
          const parentChanged = parentId !== it.parentId;
          if (parentChanged) set.parent_id = parentId;
          const nameOf = (pid: string | null) => (pid ? quoted(state.get(pid)?.name || "(名前なし)") : "なし");
          changes.push(`並べ替え：${labelOf(it)}${parentChanged ? `（親 ${nameOf(it.parentId)} → ${nameOf(parentId)}）` : ""}`);
          it.parentId = parentId;
          it.sortOrder = sortOrder;
          sqlOps.push({ t: "update", id: it.id, set });
          return;
        }

        applyLinks(`${where}（${labelOf(it)}）`, it, op.tickets, kind);
        return;
      }

      errors.push(`${where}：op「${String(op.op ?? "")}」は使えません（add / update / move / link / unlink のいずれか）`);
    });

    return { ok: true, sheet, expectedVersion, errors, warnings, changes, created, sqlOps };
  }

  // ── POST /api/v1/wbs-update ──
  async function handleWbsUpdate(sb: SupabaseClient, key: ApiKeyRow, body: any, res: any) {
    const ownerRes = await resolveOwner(sb, key);
    if (!ownerRes.ok) return res.status(ownerRes.status).json(ownerRes.body);
    const owner = ownerRes.owner;

    const prep = await prepareWbsUpdate(sb, key, owner, body);
    if (!prep.ok) return res.status(prep.status).json(prep.body);
    const { sheet, expectedVersion, errors, warnings, changes, created, sqlOps } = prep;

    if (errors.length > 0) {
      return res.status(400).json({ error: "反映できない操作があるため、WBS は何も変えていません", errors, warnings });
    }
    if (sqlOps.length === 0) {
      return res.status(200).json({ ok: true, version: expectedVersion, changes: [], created: [], warnings, applied: false });
    }

    const { data: result, error } = await sb.rpc("wbs_api_apply", {
      p_user_id: owner.id, p_sheet_id: sheet.id, p_expected_version: expectedVersion, p_ops: sqlOps,
    });
    if (error) {
      if (isMissingFunction(error, "wbs_api_apply")) return res.status(503).json({ error: MISSING_FUNCTION_ERROR });
      return res.status(500).json({ error: `反映に失敗しました: ${error.message}` });
    }
    if (!result?.ok) { const f = reasonFailure(result); return res.status(f.status).json(f.body); }
    return res.status(200).json({ ok: true, version: Number(result.version ?? 0), changes, created, warnings, applied: true });
  }

  // ── POST /api/v1/wbs-proposal（KAIZEN2611-015） ──
  // wbs-update と同じ確かめをして、WBS は変えずに「更新の案」として預ける。
  // 利用者が WBS 画面で新旧を見比べ、「この内容で反映」を押したときだけ反映する（api/wbs の proposal-apply）
  async function handleWbsProposalCreate(sb: SupabaseClient, key: ApiKeyRow, body: any, res: any) {
    const ownerRes = await resolveOwner(sb, key);
    if (!ownerRes.ok) return res.status(ownerRes.status).json(ownerRes.body);
    const owner = ownerRes.owner;

    const prep = await prepareWbsUpdate(sb, key, owner, body);
    if (!prep.ok) return res.status(prep.status).json(prep.body);
    const { sheet, expectedVersion, errors, warnings, changes, created, sqlOps } = prep;

    if (errors.length > 0) {
      return res.status(400).json({ error: "反映できない操作があるため、案を作っていません", errors, warnings });
    }
    if (sqlOps.length === 0) {
      return res.status(400).json({ error: "変わるところが1つも無いため、案を作っていません", errors: [], warnings });
    }

    const { data: row, error } = await sb.from("wbs_proposals").insert({
      wbs_sheet_id: sheet.id, project_id: sheet.project_id, ops: sqlOps, changes, warnings,
      base_version: expectedVersion, created_by: owner.id, created_by_name: owner.name,
      api_key_id: key.id, api_key_name: key.name ?? "",
    }).select("id, created_at").single();
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205" || /wbs_proposals/.test(error.message ?? "")) {
        return res.status(503).json({ error: PROPOSAL_MISSING_ERROR });
      }
      return res.status(500).json({ error: `案を保存できませんでした: ${error.message}` });
    }

    const project = await projectSlug(sb, key.project_id);
    const base = sheetUrl(project.slug, sheet.id);
    const updatedRows = new Set(sqlOps.filter(o => o.t !== "insert").map(o => String(o.id ?? o.item_id))).size;
    return res.status(200).json({
      ok: true,
      proposalId: row.id,
      status: "pending",
      url: base ? `${base}?proposal=${row.id}` : null,
      version: expectedVersion,
      counts: { changedRows: updatedRows, addedRows: created.length, warnings: warnings.length },
      changes, created, warnings,
    });
  }

  // ── GET /api/v1/wbs-proposal?id=…（KAIZEN2611-015） ──
  async function handleWbsProposalGet(sb: SupabaseClient, key: ApiKeyRow, query: any, res: any) {
    const ownerRes = await resolveOwner(sb, key);
    if (!ownerRes.ok) return res.status(ownerRes.status).json(ownerRes.body);
    const id = str(query?.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "id（案の id）を指定してください" });
    const { data, error } = await sb.from("wbs_proposals")
      .select("id, wbs_sheet_id, project_id, status, changes, warnings, created_at, decided_by_name, decided_at")
      .eq("id", id).eq("project_id", key.project_id).maybeSingle();
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return res.status(503).json({ error: PROPOSAL_MISSING_ERROR });
      return res.status(500).json({ error: error.message });
    }
    if (!data || !(await rpcBool(sb, "wbs_user_can_view", ownerRes.owner.id, String(data.wbs_sheet_id)))) {
      return res.status(404).json({ error: "案が見つかりません" });
    }
    const project = await projectSlug(sb, key.project_id);
    const base = sheetUrl(project.slug, String(data.wbs_sheet_id));
    return res.status(200).json({
      id: data.id,
      sheetId: data.wbs_sheet_id,
      // pending＝反映待ち / applied＝反映済み / rejected＝取り消し
      status: data.status,
      statusLabel: data.status === "applied" ? "反映済み" : data.status === "rejected" ? "取り消し" : "反映待ち",
      url: base ? `${base}?proposal=${data.id}` : null,
      createdAt: data.created_at,
      decidedByName: data.decided_by_name || null,
      decidedAt: data.decided_at ?? null,
      changes: data.changes ?? [],
      warnings: data.warnings ?? [],
    });
  }

  return { handleWbsSheets, handleWbsDetail, handleWbsUpdate, handleWbsProposalCreate, handleWbsProposalGet };
}
