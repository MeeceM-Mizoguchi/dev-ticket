// ENHA2-034 夜間バッチの後始末（学習ログを必ず確定させる）
//
// ワークフローの最後に `if: always()` で呼ばれる。成功時も失敗時も必ず通る。
//
// ★これが無いと「静かな失敗」が復活する★
//   ①スキル分析が308で素通りしていた7/14〜7/31、ワークフローは緑のままで
//   誰も2週間気付けなかった。①が落ちるとワークフローはそこで止まり、
//   ②が走らないので学習ログの行は result 未確定のまま宙に浮く。
//   さらに①がAPIに到達すらしなかった場合は、行そのものが1件も作られない。
//   どちらのケースも、ここで「問題あり」として記録に残す。
//
// 呼び出し:
//   POST /api/ml/batch-finish
//   Authorization: Bearer <CRON_SECRET>
//   { "batchId": "...", "status": "success" | "failure" | "cancelled", "message": "..." }

import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase not configured" });

  const cronSecret = process.env.CRON_SECRET;
  const isCron = Boolean(cronSecret) && req.headers?.authorization === `Bearer ${cronSecret}`;
  if (!isCron) return res.status(401).json({ error: "unauthorized" });

  const batchId: string | undefined = req.body?.batchId;
  if (!batchId) return res.status(400).json({ error: "batchId is required" });

  const status: string = String(req.body?.status ?? "failure");
  const trigger: string = ["daily", "deploy", "manual"].includes(String(req.body?.trigger))
    ? String(req.body.trigger)
    : "daily";
  const message: string = String(req.body?.message ?? "").slice(0, 2000);

  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const now = new Date().toISOString();

  try {
    const { data: rows, error } = await sb
      .from("ml_batch_runs")
      .select("id, organization_id, result, detail")
      .eq("batch_id", batchId);
    if (error) return res.status(500).json({ error: error.message });

    // ── ケース1: 行が1件も無い ──
    // ①がAPIに到達しなかった（リダイレクト・認証失敗・ネットワーク断など）。
    // 何も残さないと画面上「バッチが起動しなかった」と区別できないので、全組織分を起票する。
    if (!rows || rows.length === 0) {
      const { data: orgs } = await sb.from("organizations").select("id");
      const summary = message
        || "スキル分析に到達できませんでした（リダイレクト/認証失敗の可能性）";
      const inserts = (orgs ?? []).map(o => ({
        organization_id: o.id,
        batch_id: batchId,
        trigger,
        started_at: now,
        finished_at: now,
        result: "failed",
        summary,
        detail: { analyze: { status: "failed", error: summary }, train: { status: "skipped", reason: "スキル分析が失敗したため実行されませんでした" } },
      }));
      if (inserts.length > 0) {
        await sb.from("ml_batch_runs").upsert(inserts, { onConflict: "organization_id,batch_id" });
      }
      return res.json({ ok: true, created: inserts.length, closed: 0 });
    }

    // ── ケース2: result 未確定の行が残っている ──
    // ②モデル学習まで到達しなかった（①で落ちた／タイムアウト／キャンセル）。
    const pending = rows.filter(r => !r.result);
    if (pending.length === 0) return res.json({ ok: true, created: 0, closed: 0 });

    const summary = status === "success"
      // ワークフローは緑なのに②の記録が無い＝想定外。緑で流さず問題ありとして残す。
      ? "モデル学習の結果が記録されませんでした"
      : (message || "バッチが途中で終了しました");

    for (const r of pending) {
      // ①の記録を消さないようにマージする
      const detail = { ...(r.detail ?? {}), train: { status: "failed", error: summary } };
      await sb.from("ml_batch_runs").update({
        finished_at: now,
        result: "failed",
        summary,
        detail,
      }).eq("id", r.id);
    }

    return res.json({ ok: true, created: 0, closed: pending.length });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
