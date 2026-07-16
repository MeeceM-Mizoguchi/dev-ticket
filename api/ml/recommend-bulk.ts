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
  CAP_MARGIN, GATE_LEVEL,
  type MemberFeatureInput, type TicketFeatureInput, type LgbModel, type SkillLayer, type DevScale, type Priority,
} from "./recommend";

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
    for (const m of members) {
      liveActive[m.profileId] = avail[m.profileId]?.activeCount ?? 0;
      liveRanges[m.profileId] = (avail[m.profileId]?.ranges ?? []).slice();
    }
    const lastMsOf = (m: MemberFeatureInput): number => {
      const s = avail[m.profileId]?.lastAssignedAt;
      return s ? new Date(s).getTime() : 0;
    };

    const results = ticketList.map((tk) => {
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

      // ── Step0: スキルゲート（規模で可変）──
      const mustSkills = required.filter(r => r.importance >= 3);
      const passesGate = (m: MemberFeatureInput, minLv: number) =>
        mustSkills.every(r => (m.skillLevels[r.skillId] ?? 0) >= minLv);
      let qualified = basePool;
      if (mustSkills.length > 0) {
        let lv = GATE_LEVEL[tk.devScale ?? "M"] ?? 1;
        qualified = basePool.filter(m => passesGate(m, lv));
        while (qualified.length === 0 && lv > 1) { lv -= 1; qualified = basePool.filter(m => passesGate(m, lv)); }
        if (qualified.length === 0) qualified = basePool;
      }

      // ── Step1: 相対キャップ（集中防止）── ※ liveActive を使う ──
      const activeOf = (m: MemberFeatureInput) => liveActive[m.profileId] ?? 0;
      let recommendable = qualified;
      if (qualified.length > 0) {
        const minActive = Math.min(...qualified.map(activeOf));
        const capped = qualified.filter(m => activeOf(m) <= minActive + CAP_MARGIN);
        recommendable = capped.length >= Math.min(1, qualified.length) ? capped : qualified;
      }

      // ── Step2: 空き順ソート（先頭=推奨）── ※ liveRanges / liveActive を使う ──
      const hasDates = typeof tk.startDate === "string" && tk.startDate !== "" && typeof tk.dueDate === "string" && tk.dueDate !== "";
      const overlapOf = (m: MemberFeatureInput): number => {
        if (!hasDates) return 0;
        let n = 0;
        for (const r of liveRanges[m.profileId] ?? []) {
          if (r.start && r.due && r.start <= (tk.dueDate as string) && (tk.startDate as string) <= r.due) n++;
        }
        return n;
      };
      const skillSum = (m: MemberFeatureInput) => mustSkills.reduce((a, r) => a + (m.skillLevels[r.skillId] ?? 0), 0);
      const ranked = recommendable.slice().sort((a, b) =>
        (overlapOf(a) - overlapOf(b)) ||
        (activeOf(a) - activeOf(b)) ||
        (lastMsOf(a) - lastMsOf(b)) ||
        (skillSum(b) - skillSum(a)),
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

      // ── 公平分散: 選ばれた人の稼働を仮想的に増やす ──
      if (chosen) {
        liveActive[chosen.profileId] = (liveActive[chosen.profileId] ?? 0) + 1;
        if (hasDates) (liveRanges[chosen.profileId] ??= []).push({ start: tk.startDate ?? null, due: tk.dueDate ?? null });
      }

      return { ticketId: tk.ticketId, chosen, candidates, source };
    });

    res.json({ results, source, modelVersion: modelRow?.version ?? null });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
