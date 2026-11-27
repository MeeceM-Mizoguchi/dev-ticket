// KAIZEN2611-004 WBSのバックアップ・反映（その時点に戻す）・アーカイブの API。
//
//   GET  /api/wbs/cron-backup   … 定期実行（毎日 18:00 UTC＝3:00 日本時間。vercel.json の crons）。
//                                  変更があったWBSのバックアップを取り、1年たったバックアップを圧縮して Storage へ移す
//   POST /api/wbs/snapshot      {snapshotId}                 … バックアップの中身（Storage へ移したものは取り出して展開する）
//   POST /api/wbs/restore       {snapshotId, expectedVersion} … その時点に戻す（反映）
//   POST /api/wbs/archive       {sheetId}                    … WBSをアーカイブする（中身とバックアップを Storage へ移す）
//   POST /api/wbs/unarchive     {sheetId}                    … アーカイブから戻す
//   POST /api/wbs/purge         {projectId, sheetId}         … 削除したWBSの、Storage に残ったファイルを消す
//   POST /api/wbs/proposal-apply  {proposalId}               … AI からの更新の案を反映する（KAIZEN2611-015）
//   POST /api/wbs/proposal-reject {proposalId}               … AI からの更新の案を取り消す（KAIZEN2611-015）
//   POST /api/wbs/apply-ops {sheetId, expectedVersion, ops}  … インポートの「変わったところだけ反映する」（KAIZEN2611-016）
//
// 画面からの呼び出しの認証は、ログイン中の人の Supabase のアクセストークンだけ（APIキーは受けない）。
// service_role で動くので RLS は効かない。権限（見られるか・編集可か・ロック中でないか）は
// DB の関数（supabase/add_wbs_snapshots.sql の wbs_user_can_view / wbs_restore_snapshot など）に
// 呼んだ人の id を渡して、DB の側で確かめる。
// 定期実行の認証は、既存の定期実行（api/github/[resource].ts の sync-released）と同じく CRON_SECRET。
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { gunzipSync, gzipSync } from "zlib";
import { serviceClient, authenticateCaller, assertProjectAccess } from "../_lib/projectAuth.js";

/** アーカイブ用の置き場（非公開）。ファイルは {プロジェクトID}/{WBSのID}/ の下に置く */
const BUCKET = "wbs-archives";
/** この日数より前に取ったバックアップを Storage へ移す */
const MOVE_AFTER_DAYS = 365;
/** 定期実行で1回に扱う件数。関数の制限時間（60秒）に収まるよう、時間を見ながら繰り返す */
const DAILY_BATCH = 100;
const MOVE_BATCH = 100;
const CRON_TIME_BUDGET_MS = 45_000;

function sheetFolder(projectId: string, sheetId: string) { return `${projectId}/${sheetId}`; }

function stamp() { return new Date().toISOString().replace(/[-:.]/g, ""); }

/**
 * 定期実行からの呼び出しか（api/github/[resource].ts の isCronRequest と同じ判定）。
 * CRON_SECRET を設定してあれば Bearer で突き合わせる。未設定の環境では Vercel Cron が付けるヘッダで判定し、警告を残す。
 */
function isCronRequest(req: any): boolean {
  const secret = process.env.CRON_SECRET;
  const header: string = req.headers?.authorization || req.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (secret) {
    if (token.length !== secret.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  }
  const ua = String(req.headers?.["user-agent"] ?? "").toLowerCase();
  if (req.headers?.["x-vercel-cron"] != null || ua.startsWith("vercel-cron")) {
    console.warn("[wbs cron-backup] CRON_SECRET が未設定のため、ヘッダだけで定期実行と判定した");
    return true;
  }
  return false;
}

// ── Storage ─────────────────────────────────────────────────

async function uploadJson(sb: SupabaseClient, path: string, value: unknown): Promise<string | null> {
  const body = gzipSync(Buffer.from(JSON.stringify(value), "utf8"));
  const { error } = await sb.storage.from(BUCKET).upload(path, body, { contentType: "application/gzip", upsert: false });
  return error ? error.message : null;
}

async function downloadJson(sb: SupabaseClient, path: string): Promise<any> {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`保管しているファイルを読めませんでした（${error?.message ?? "not found"}）`);
  const buf = Buffer.from(await data.arrayBuffer());
  return JSON.parse(gunzipSync(buf).toString("utf8"));
}

/** そのWBSのフォルダにあるファイルをすべて消す（WBSの削除のあと） */
async function removeFolder(sb: SupabaseClient, folder: string): Promise<number> {
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await sb.storage.from(BUCKET).list(folder, { limit: 100 });
    if (error) throw new Error(error.message);
    const paths = (data ?? []).filter(f => f.name && f.id).map(f => `${folder}/${f.name}`);
    if (paths.length === 0) break;
    const { error: rmErr } = await sb.storage.from(BUCKET).remove(paths);
    if (rmErr) throw new Error(rmErr.message);
    removed += paths.length;
  }
  return removed;
}

// ── バックアップの中身 ───────────────────────────────────────

interface SnapshotRow {
  id: string;
  wbs_sheet_id: string;
  data: unknown;
  storage_path: string | null;
}

async function loadSnapshotRow(sb: SupabaseClient, snapshotId: string): Promise<SnapshotRow | null> {
  const { data, error } = await sb.from("wbs_snapshots")
    .select("id, wbs_sheet_id, data, storage_path").eq("id", snapshotId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SnapshotRow | null) ?? null;
}

/** バックアップの中身。Storage へ移したものは、まとめたファイルから取り出す */
async function snapshotData(sb: SupabaseClient, row: SnapshotRow): Promise<unknown> {
  if (row.data) return row.data;
  if (!row.storage_path) throw new Error("バックアップの中身が見つかりません");
  const file = await downloadJson(sb, row.storage_path);
  const hit = (Array.isArray(file?.snapshots) ? file.snapshots : []).find((s: any) => s?.id === row.id);
  if (!hit?.data) throw new Error("保管しているファイルに、このバックアップが見つかりません");
  return hit.data;
}

async function canView(sb: SupabaseClient, userId: string, sheetId: string): Promise<boolean> {
  const { data, error } = await sb.rpc("wbs_user_can_view", { p_user_id: userId, p_sheet_id: sheetId });
  if (error) throw new Error(`権限の判定に失敗しました: ${error.message}。supabase/add_wbs_snapshots.sql が適用されているか確認してください`);
  return data === true;
}

/** DB の関数が返した「できなかった理由」を、画面に出す文とステータスに直す */
function failure(result: any): { status: number; body: Record<string, unknown> } {
  const reason = String(result?.reason ?? "");
  switch (reason) {
    case "not_found": return { status: 404, body: { error: "WBSが見つかりません", code: reason } };
    case "forbidden": return { status: 403, body: { error: "このWBSを編集する権限がありません", code: reason } };
    case "locked": return { status: 409, body: { error: "このWBSはロックされているため反映できません。反映する場合はロックを解除してください", code: reason } };
    case "archived": return { status: 409, body: { error: "このWBSはアーカイブ済みです", code: reason } };
    case "not_archived": return { status: 409, body: { error: "このWBSはアーカイブされていません", code: reason } };
    case "conflict": return {
      status: 409,
      body: { error: "ほかの人が編集しました", code: reason, editedByName: result?.editedByName ?? "", editedAt: result?.editedAt ?? null },
    };
    case "invalid": return { status: 422, body: { error: "バックアップの中身を読み取れませんでした", code: reason } };
    default: return { status: 500, body: { error: "処理に失敗しました", code: reason || "unknown" } };
  }
}

// ── POST /api/wbs/snapshot ──────────────────────────────────
async function handleSnapshot(sb: SupabaseClient, userId: string, body: any, res: any) {
  const snapshotId = typeof body?.snapshotId === "string" ? body.snapshotId.trim() : "";
  if (!snapshotId) return res.status(400).json({ error: "snapshotId は必須です" });
  const row = await loadSnapshotRow(sb, snapshotId);
  // 見られないWBSのものも「見つからない」と返す（存在を探れないようにする）
  if (!row || !(await canView(sb, userId, row.wbs_sheet_id))) return res.status(404).json({ error: "バックアップが見つかりません" });
  return res.status(200).json({ ok: true, data: await snapshotData(sb, row) });
}

// ── POST /api/wbs/restore ───────────────────────────────────
async function handleRestore(sb: SupabaseClient, userId: string, body: any, res: any) {
  const snapshotId = typeof body?.snapshotId === "string" ? body.snapshotId.trim() : "";
  const expectedVersion = Number(body?.expectedVersion);
  if (!snapshotId) return res.status(400).json({ error: "snapshotId は必須です" });
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return res.status(400).json({ error: "expectedVersion は 0 以上の整数で指定してください" });
  const row = await loadSnapshotRow(sb, snapshotId);
  if (!row || !(await canView(sb, userId, row.wbs_sheet_id))) return res.status(404).json({ error: "バックアップが見つかりません" });

  const data = await snapshotData(sb, row);
  const { data: result, error } = await sb.rpc("wbs_restore_snapshot", {
    p_user_id: userId, p_sheet_id: row.wbs_sheet_id, p_expected_version: expectedVersion, p_data: data,
  });
  if (error) return res.status(500).json({ error: `反映に失敗しました: ${error.message}` });
  if (!result?.ok) { const f = failure(result); return res.status(f.status).json(f.body); }
  return res.status(200).json({ ok: true, version: result.version });
}

// ── POST /api/wbs/archive ───────────────────────────────────
async function handleArchive(sb: SupabaseClient, userId: string, body: any, res: any) {
  const sheetId = typeof body?.sheetId === "string" ? body.sheetId.trim() : "";
  if (!sheetId) return res.status(400).json({ error: "sheetId は必須です" });

  const { data: prep, error } = await sb.rpc("wbs_archive_payload", { p_user_id: userId, p_sheet_id: sheetId });
  if (error) return res.status(500).json({ error: `アーカイブに失敗しました: ${error.message}` });
  if (!prep?.ok) { const f = failure(prep); return res.status(f.status).json(f.body); }

  const path = `${sheetFolder(String(prep.projectId), sheetId)}/archive-${stamp()}.json.gz`;
  const upErr = await uploadJson(sb, path, prep.payload);
  if (upErr) return res.status(500).json({ error: `アーカイブのファイルを保存できませんでした: ${upErr}` });

  const { data: done, error: finErr } = await sb.rpc("wbs_archive_finish", {
    p_user_id: userId, p_sheet_id: sheetId, p_expected_version: prep.version, p_snapshot_count: prep.snapshotCount, p_path: path,
  });
  if (finErr || !done?.ok) {
    // DB 側を変えられなかったので、置いたファイルは片付ける（WBSは元のまま）
    await sb.storage.from(BUCKET).remove([path]);
    if (finErr) return res.status(500).json({ error: `アーカイブに失敗しました: ${finErr.message}` });
    if (done?.reason === "conflict") {
      return res.status(409).json({ error: "アーカイブの途中で、このWBSが編集されました。もう一度お試しください", code: "conflict" });
    }
    const f = failure(done);
    return res.status(f.status).json(f.body);
  }
  return res.status(200).json({ ok: true });
}

// ── POST /api/wbs/unarchive ─────────────────────────────────
async function handleUnarchive(sb: SupabaseClient, userId: string, body: any, res: any) {
  const sheetId = typeof body?.sheetId === "string" ? body.sheetId.trim() : "";
  if (!sheetId) return res.status(400).json({ error: "sheetId は必須です" });
  if (!(await canView(sb, userId, sheetId))) return res.status(404).json({ error: "WBSが見つかりません" });

  const { data: sheet, error } = await sb.from("wbs_sheets").select("id, archived_at, archive_path").eq("id", sheetId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!sheet) return res.status(404).json({ error: "WBSが見つかりません" });
  if (!sheet.archived_at) return res.status(409).json({ error: "このWBSはアーカイブされていません", code: "not_archived" });
  if (!sheet.archive_path) return res.status(500).json({ error: "アーカイブのファイルの場所が記録されていません" });

  const payload = await downloadJson(sb, String(sheet.archive_path));
  const { data: result, error: rpcErr } = await sb.rpc("wbs_unarchive", { p_user_id: userId, p_sheet_id: sheetId, p_payload: payload });
  if (rpcErr) return res.status(500).json({ error: `アーカイブから戻せませんでした: ${rpcErr.message}` });
  if (!result?.ok) { const f = failure(result); return res.status(f.status).json(f.body); }

  // 戻し終えたので、アーカイブのファイルは消す（消せなくても WBS は戻っている）
  const { error: rmErr } = await sb.storage.from(BUCKET).remove([String(sheet.archive_path)]);
  if (rmErr) console.warn("[wbs unarchive] アーカイブのファイルを消せませんでした:", rmErr.message);
  return res.status(200).json({ ok: true });
}

// ── POST /api/wbs/purge ─────────────────────────────────────
// WBSの削除は今までどおり画面から行い（DB のバックアップは on delete cascade で消える）、
// そのあとで Storage に残ったファイル（1年たったバックアップ・アーカイブ）をここで消す。
async function handlePurge(sb: SupabaseClient, userId: string, body: any, res: any) {
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  const sheetId = typeof body?.sheetId === "string" ? body.sheetId.trim() : "";
  if (!projectId || !sheetId) return res.status(400).json({ error: "projectId と sheetId は必須です" });
  const denied = await assertProjectAccess(sb, { kind: "user", userId }, projectId);
  if (denied) return res.status(denied.status).json({ error: denied.error });
  // まだ残っているWBSのファイルは消さない
  const { data: still, error } = await sb.from("wbs_sheets").select("id").eq("id", sheetId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (still) return res.status(409).json({ error: "このWBSはまだ削除されていません" });
  const removed = await removeFolder(sb, sheetFolder(projectId, sheetId));
  return res.status(200).json({ ok: true, removed });
}

// ── POST /api/wbs/proposal-apply・proposal-reject（KAIZEN2611-015） ──
// AI が預けた更新の案（wbs_proposals）を、押した人の権限で反映する／取り消す。
// 反映は DB の関数 wbs_proposal_decide が wbs_api_apply を呼び、版の番号の比較・反映前のバックアップ・反映を1回で行う
async function handleProposalDecide(sb: SupabaseClient, userId: string, body: any, res: any, action: "apply" | "reject") {
  const proposalId = typeof body?.proposalId === "string" ? body.proposalId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(proposalId)) return res.status(400).json({ error: "proposalId は必須です" });
  const { data: result, error } = await sb.rpc("wbs_proposal_decide", { p_user_id: userId, p_proposal_id: proposalId, p_action: action });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883" || /wbs_proposal_decide/.test(error.message ?? "")) {
      return res.status(503).json({ error: "更新の案の仕組み（supabase/add_wbs_proposals_KAIZEN2611-015.sql）が、まだデータベースに作られていません。管理者に SQL の適用を依頼してください" });
    }
    return res.status(500).json({ error: `${action === "apply" ? "反映" : "取り消し"}に失敗しました: ${error.message}` });
  }
  if (!result?.ok) {
    const reason = String(result?.reason ?? "");
    if (reason === "not_found") return res.status(404).json({ error: "案が見つかりません", code: reason });
    if (reason === "decided") {
      return res.status(409).json({ error: result?.status === "applied" ? "この案はすでに反映されています" : "この案はすでに取り消されています", code: reason });
    }
    if (reason === "conflict") {
      return res.status(409).json({
        error: "案のあとに WBS が変わったため反映できません", code: reason,
        editedByName: result?.editedByName ?? "", editedAt: result?.editedAt ?? null,
      });
    }
    if (reason === "invalid") return res.status(422).json({ error: `案の中に反映できない操作がありました（${String(result?.detail ?? "")}）。WBS は何も変えていません`, code: reason });
    const f = failure(result);
    return res.status(f.status).json(f.body);
  }
  return res.status(200).json({ ok: true, version: result.version ?? null });
}

// ── POST /api/wbs/apply-ops（KAIZEN2611-016） ─────────────────
// インポートの「変わったところだけ反映する」で、比べる画面の「この内容で反映」から呼ぶ。
// 画面が作った操作（wbs_api_apply に渡す形）を、押した人の権限でまとめて反映する。
// 権限・ロック・アーカイブ・版の番号（ファイルを読んだときの edit_version）の確認、反映前のバックアップ、
// 操作の形の確認は wbs_api_apply が行う。すべて反映するか、何も反映しないか
const MAX_APPLY_OPS = 5000;
async function handleApplyOps(sb: SupabaseClient, userId: string, body: any, res: any) {
  const sheetId = typeof body?.sheetId === "string" ? body.sheetId.trim() : "";
  const expectedVersion = Number(body?.expectedVersion);
  const ops = body?.ops;
  if (!/^[0-9a-f-]{36}$/i.test(sheetId)) return res.status(400).json({ error: "sheetId は必須です" });
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return res.status(400).json({ error: "expectedVersion は 0 以上の整数で指定してください" });
  if (!Array.isArray(ops) || ops.length === 0) return res.status(400).json({ error: "反映する変更がありません" });
  if (ops.length > MAX_APPLY_OPS) return res.status(400).json({ error: `一度に反映できる変更は ${MAX_APPLY_OPS} 件までです` });

  const { data: result, error } = await sb.rpc("wbs_api_apply", {
    p_user_id: userId, p_sheet_id: sheetId, p_expected_version: expectedVersion, p_ops: ops,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return res.status(503).json({ error: "反映の仕組み（supabase/add_wbs_api_KAIZEN2611-013.sql）が、まだデータベースに作られていません。管理者に SQL の適用を依頼してください" });
    }
    return res.status(500).json({ error: `反映に失敗しました: ${error.message}` });
  }
  if (!result?.ok) {
    const reason = String(result?.reason ?? "");
    if (reason === "conflict") {
      return res.status(409).json({
        error: "ファイルを読んだあとに WBS が変わったため反映できません", code: reason,
        editedByName: result?.editedByName ?? "", editedAt: result?.editedAt ?? null,
      });
    }
    if (reason === "invalid") return res.status(422).json({ error: `反映できない変更がありました（${String(result?.detail ?? "")}）。WBS は何も変えていません`, code: reason });
    const f = failure(result);
    return res.status(f.status).json(f.body);
  }
  return res.status(200).json({ ok: true, version: result.version ?? null });
}

// ── GET /api/wbs/cron-backup ────────────────────────────────
async function runCronBackup(sb: SupabaseClient, res: any) {
  const started = Date.now();
  const timeLeft = () => Date.now() - started < CRON_TIME_BUDGET_MS;

  // 1) 変更があったWBSのバックアップを取る
  let taken = 0;
  while (timeLeft()) {
    const { data, error } = await sb.rpc("wbs_take_daily_snapshots", { p_limit: DAILY_BATCH });
    if (error) throw new Error(`バックアップに失敗しました: ${error.message}`);
    const n = Number(data ?? 0);
    taken += n;
    if (n < DAILY_BATCH) break;
  }

  // 2) 1年たったバックアップを、WBSごとに1つのファイルへまとめて Storage へ移す
  let moved = 0;
  const failed: string[] = [];
  const cutoff = new Date(Date.now() - MOVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  while (timeLeft()) {
    const { data, error } = await sb.from("wbs_snapshots")
      .select("id, wbs_sheet_id, taken_at, kind, sheet_version, data, created_by, created_by_name, wbs_sheets!inner(project_id)")
      .not("data", "is", null).lt("taken_at", cutoff)
      .order("taken_at", { ascending: true }).order("id", { ascending: true })
      .limit(MOVE_BATCH);
    if (error) throw new Error(`古いバックアップを読めませんでした: ${error.message}`);
    const rows = (data ?? []) as any[];
    if (rows.length === 0) break;

    const bySheet = new Map<string, any[]>();
    for (const r of rows) {
      const list = bySheet.get(r.wbs_sheet_id);
      if (list) list.push(r); else bySheet.set(r.wbs_sheet_id, [r]);
    }
    let progressed = 0;
    for (const [sheetId, list] of bySheet) {
      const projectId = String(list[0].wbs_sheets?.project_id ?? "");
      const path = `${sheetFolder(projectId, sheetId)}/snapshots-${stamp()}.json.gz`;
      const snapshots = list.map(r => ({
        id: r.id, taken_at: r.taken_at, kind: r.kind, sheet_version: r.sheet_version, data: r.data,
        created_by: r.created_by, created_by_name: r.created_by_name,
      }));
      const upErr = await uploadJson(sb, path, { format: 1, sheetId, snapshots });
      if (upErr) { failed.push(`${sheetId}: ${upErr}`); continue; }
      const { error: updErr } = await sb.from("wbs_snapshots")
        .update({ data: null, storage_path: path })
        .in("id", list.map(r => r.id)).not("data", "is", null);
      if (updErr) {
        await sb.storage.from(BUCKET).remove([path]);
        failed.push(`${sheetId}: ${updErr.message}`);
        continue;
      }
      progressed += list.length;
    }
    moved += progressed;
    // 1件も移せなかった（すべて失敗した）ときは、同じ行を何度も試さずに終える
    if (progressed === 0 || rows.length < MOVE_BATCH) break;
  }

  if (failed.length) console.error("[wbs cron-backup] Storage へ移せなかったバックアップ:", failed);
  return res.status(200).json({ ok: true, taken, moved, failed: failed.length });
}

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  const action = String(req.query?.action ?? "");
  const sb = serviceClient();
  if (!sb) return res.status(500).json({ error: "Supabase not configured" });

  if (action === "cron-backup") {
    if (!isCronRequest(req)) return res.status(401).json({ error: "Unauthorized" });
    try {
      return await runCronBackup(sb, res);
    } catch (e: any) {
      console.error("[wbs cron-backup]", e?.message);
      return res.status(500).json({ error: e?.message ?? "バックアップに失敗しました" });
    }
  }

  const handlers: Record<string, (sb: SupabaseClient, userId: string, body: any, res: any) => Promise<any>> = {
    snapshot: handleSnapshot, restore: handleRestore, archive: handleArchive, unarchive: handleUnarchive, purge: handlePurge,
    "proposal-apply": (s, u, b, r) => handleProposalDecide(s, u, b, r, "apply"),
    "proposal-reject": (s, u, b, r) => handleProposalDecide(s, u, b, r, "reject"),
    "apply-ops": handleApplyOps,
  };
  const run = handlers[action];
  if (!run) return res.status(404).json({ error: `不明なエンドポイントです: /api/wbs/${action}` });
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  let body: any;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  } catch {
    return res.status(400).json({ error: "リクエストボディが JSON として読めません" });
  }

  try {
    const auth = await authenticateCaller(sb, req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.caller.kind !== "user") {
      return res.status(401).json({ error: "この API は画面からだけ呼べます（APIキーでは呼べません）。ログインしてから操作してください" });
    }
    return await run(sb, auth.caller.userId, body, res);
  } catch (e: any) {
    console.error(`[wbs ${action}]`, e?.message);
    return res.status(500).json({ error: e?.message ?? "サーバーでエラーが起きました" });
  }
}
