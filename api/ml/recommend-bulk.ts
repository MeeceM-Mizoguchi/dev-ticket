// BRU6-002-2 一括アサイン ─ バッチ推奨エンドポイント
//
// 複数チケットをまとめて受け取り、各チケットの推奨担当者(Top1)を返す。
// 単一版 /api/ml/recommend との違いと工夫:
//   ① 組織全体の特徴量(buildMemberFeatures)を「1回だけ」構築し、全チケットで共有する。
//      単一版をN回叩くと重い集計がN回走るが、ここでは1回で済む。
//   ② 公平分散(貪欲逐次): 1件を割り当てるたび、その担当者の稼働中件数を仮想的に+1し、
//      期間も稼働レンジに積む。これにより「最も空いている人」へ全件集中するのを防ぐ。
//
// ロジック本体(ゲート/相対キャップ/空き順ソート/スコアリング)は recommend.ts から
// import して再利用する（api/ 配下は同梱されるので相対 import 可能）。

import { createClient } from "@supabase/supabase-js";
import {
  buildMemberFeatures, buildFeatures, scoreWithModel, baselineScore, buildReasons,
  type MemberFeatureInput, type TicketFeatureInput, type LgbModel, type SkillLayer, type DevScale, type Priority,
} from "./recommend.js";
// ⚠️ 拡張子 ".js" は必須。本番(Vercel/Node ESM, package.json "type":"module")では
//    相対 import に拡張子が無いと ERR_MODULE_NOT_FOUND でモジュール読込時にクラッシュし、
//    ハンドラの try/catch に入る前に落ちる＝Vercel が JSON ではなく HTML の 500 を返す。
//    これが「一括レコメンドの取得に失敗しました (500)」の実原因だった（単一 recommend は
//    自己完結でクロスファイル import が無いため影響を受けていなかった）。
//    tsconfig は moduleResolution:"bundler" なので ".js" 指定子は .ts に解決され型チェックも通る。

interface BulkTicketInput {
  ticketId: string;
  requiredSkillIds?: (string | { skillId: string; importance?: number })[];
  devScale?: DevScale | null;
  estimatedHours?: number;
  priority?: Priority;
  startDate?: string | null;
  dueDate?: string | null;
}

const MAX_RETURN = 30;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase not configured" });

  const { organizationId, tickets = [], candidateNames } = req.body ?? {};
  if (!organizationId) return res.status(400).json({ error: "organizationId is required" });
  const ticketList = tickets as BulkTicketInput[];
  if (!Array.isArray(ticketList) || ticketList.length === 0) return res.json({ results: [], source: "baseline" });

  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    // ── ① 特徴量は1回だけ構築 ──
    const { members, skillLayer, skillName, avail } = await buildMemberFeatures(sb, organizationId);
    if (members.length === 0) {
      return res.json({ results: ticketList.map(t => ({ ticketId: t.ticketId, chosen: null, candidates: [], source: "baseline" })), source: "baseline" });
    }

    // 学習済みモデルも1回だけロード
    const { data: modelRow } = await sb
      .from("recommendation_models")
      .select("model_json, version")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const model = modelRow?.model_json as LgbModel | undefined;
    const source: "model" | "baseline" = model ? "model" : "baseline";

    // プロジェクトメンバーに絞り込む（指定があれば）
    const basePool = Array.isArray(candidateNames) && candidateNames.length > 0
      ? members.filter(m => candidateNames.includes(m.name))
      : members;

    // ── ② 公平分散用の可変稼働状況 ──
    //   activeCount は割り当てるたびに +1、期間も稼働レンジへ積む（このバッチ内での擬似更新）。
    const liveActive: Record<string, number> = {};
    const liveRanges: Record<string, { start: string | null; due: string | null }[]> = {};
    // このバッチで既に割り当てた件数。公平分散(ラウンドロビン)の主軸キー。
    const batchCount: Record<string, number> = {};
    for (const m of members) {
      liveActive[m.profileId] = avail[m.profileId]?.activeCount ?? 0;
      liveRanges[m.profileId] = (avail[m.profileId]?.ranges ?? []).slice();
      batchCount[m.profileId] = 0;
    }
    const lastMsOf = (m: MemberFeatureInput): number => {
      const s = avail[m.profileId]?.lastAssignedAt;
      return s ? new Date(s).getTime() : 0;
    };

    const results = ticketList.map((tk) => {
     try {
      const required = ((tk.requiredSkillIds ?? []) as (string | { skillId: string; importance?: number })[])
        .map(r => {
          const skillId = typeof r === "string" ? r : r.skillId;
          const importance = typeof r === "string" ? 3 : (r.importance ?? 3);
          return { skillId, importance, layer: skillLayer[skillId] ?? ("other" as SkillLayer) };
        })
        .filter(r => r.skillId);

      const ticket: TicketFeatureInput = {
        requiredSkills: required,
        devScale: tk.devScale ?? null,
        estimatedHours: tk.estimatedHours ?? 0,
        priority: tk.priority ?? "medium",
      };

      if (basePool.length === 0) return { ticketId: tk.ticketId, chosen: null, candidates: [], source };

      // 必須スキル（importance>=3）。足切りには使わず、タイブレークにのみ使う。
      const mustSkills = required.filter(r => r.importance >= 3);

      // ── スキル適合（0〜1）── 未保有でも0にはならず候補として残す（足切りしない）。品質タイブレーク用。
      const fitOf = (m: MemberFeatureInput): number =>
        model ? scoreWithModel(model, buildFeatures(ticket, m)) : baselineScore(ticket, m);

      // ── 既存の稼働負荷 ── liveActive/liveRanges（バッチ内で仮想更新される負荷）を使う。
      //   期日があればその期間に重なる稼働中件数、無ければ現在の稼働中件数を負荷とみなす。
      const activeOf = (m: MemberFeatureInput) => liveActive[m.profileId] ?? 0;
      const hasDates = typeof tk.startDate === "string" && tk.startDate !== "" && typeof tk.dueDate === "string" && tk.dueDate !== "";
      const overlapOf = (m: MemberFeatureInput): number => {
        if (!hasDates) return 0;
        let n = 0;
        for (const r of liveRanges[m.profileId] ?? []) {
          if (r.start && r.due && r.start <= (tk.dueDate as string) && (tk.startDate as string) <= r.due) n++;
        }
        return n;
      };
      const loadOf = (m: MemberFeatureInput) => hasDates ? overlapOf(m) : activeOf(m);

      const skillSum = (m: MemberFeatureInput) => mustSkills.reduce((a, r) => a + (m.skillLevels[r.skillId] ?? 0), 0);

      // ── 一括アサインの並び順（公平分散＝ラウンドロビンを主軸に据える）──
      //   旧実装は合成スコア(0.5*fit + 0.5*free)。free項は最大寄与0.5・負荷で減衰するため、
      //   fit差や「既存稼働負荷の偏り」がこれを超えると一部メンバーへ全件集中した
      //   （実測: 空いている2名だけに11件、稼働負荷の高い2名は0件）。
      //   そこで「このバッチで既に割り当てた件数 batchCount」を最優先キーにしてラウンドロビンし、
      //   全員へ1件ずつ→2件目… と回す。同ラウンド内は 既存負荷が軽い順 → スキル適合が高い順 →
      //   最終アサインが古い順、で決定（空き・品質・ローテーションはタイブレークとして尊重）。
      const ranked = basePool.slice().sort((a, b) =>
        ((batchCount[a.profileId] ?? 0) - (batchCount[b.profileId] ?? 0)) ||  // ①このバッチでの割当が少ない順（公平分散の主軸）
        (loadOf(a) - loadOf(b)) ||                // ②既存の稼働負荷が軽い順
        (fitOf(b) - fitOf(a)) ||                  // ③スキル適合が高い順（品質タイブレーク）
        (lastMsOf(a) - lastMsOf(b)) ||            // ④最終アサインが古い順（ローテーション）
        (skillSum(b) - skillSum(a)),              // ⑤スキルレベル合計が高い順
      );

      if (ranked.length === 0) return { ticketId: tk.ticketId, chosen: null, candidates: [], source };

      const candidates = ranked.slice(0, MAX_RETURN).map(m => {
        const active = activeOf(m);
        return {
          profileId: m.profileId,
          name: m.name,
          score: Math.round((model ? scoreWithModel(model, buildFeatures(ticket, m)) : baselineScore(ticket, m)) * 1000) / 1000,
          reasons: buildReasons(ticket, m, skillName, active),
          skillMatch: Math.round(buildFeatures(ticket, m)[0] * 1000) / 1000,
          workload: m.workload,
          activeCount: active,
          source,
        };
      });

      const chosen = candidates[0] ?? null;

      // ── 公平分散: 選ばれた人のバッチ割当数と稼働を仮想的に増やす ──
      //   batchCount を増やすことで次チケットはまだ割当の少ない人へ回る（ラウンドロビン）。
      if (chosen) {
        batchCount[chosen.profileId] = (batchCount[chosen.profileId] ?? 0) + 1;
        liveActive[chosen.profileId] = (liveActive[chosen.profileId] ?? 0) + 1;
        if (hasDates) (liveRanges[chosen.profileId] ??= []).push({ start: tk.startDate ?? null, due: tk.dueDate ?? null });
      }

      return { ticketId: tk.ticketId, chosen, candidates, source };
     } catch (perTicketErr) {
      // 1件のチケットの異常データでバッチ全体を 500 に巻き込まないよう、そのチケットだけ
      // 「割り当てなし」に縮退して続行する。
      console.error("[recommend-bulk] ticket failed", tk.ticketId, perTicketErr);
      return { ticketId: tk.ticketId, chosen: null, candidates: [], source };
     }
    });

    res.json({ results, source, modelVersion: modelRow?.version ?? null });
  } catch (e) {
    console.error("[recommend-bulk] failed", e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
