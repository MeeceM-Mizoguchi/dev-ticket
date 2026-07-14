// ENHA2-034 スキル関連のデータアクセス
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapSkill, mapMemberSkill } from "@/app/lib/mappers";
import type { Skill, MemberSkill, SkillLayer, SkillLevel, AssigneeRecommendation, DevScale, Priority } from "@/app/types";

/** 組織のスキルマスタ */
export async function fetchSkills(orgId: string): Promise<Skill[]> {
  if (!isSupabaseEnabled || !orgId) return [];
  const { data } = await supabase!
    .from("skills").select("*").eq("organization_id", orgId)
    .order("layer").order("sort_order").order("name");
  return (data ?? []).map(mapSkill);
}

/** メンバーのスキル。profileIds を省略すると全件。 */
export async function fetchMemberSkills(profileIds?: string[]): Promise<MemberSkill[]> {
  if (!isSupabaseEnabled) return [];
  let q = supabase!.from("member_skills").select("*");
  if (profileIds && profileIds.length > 0) q = q.in("profile_id", profileIds);
  const { data } = await q;
  return (data ?? []).map(mapMemberSkill);
}

/**
 * メンバーのスキルを保存する。
 * 人が編集した行は source='manual' にする → 以降、①スキル分析（自動判定）は上書きしない。
 */
export async function saveMemberSkills(
  profileId: string,
  rows: { skillId: string; level: SkillLevel }[],
  removedSkillIds: string[],
): Promise<void> {
  if (!isSupabaseEnabled) return;
  if (removedSkillIds.length > 0) {
    await supabase!.from("member_skills").delete()
      .eq("profile_id", profileId).in("skill_id", removedSkillIds);
  }
  if (rows.length > 0) {
    await supabase!.from("member_skills").upsert(
      rows.map(r => ({
        profile_id: profileId, skill_id: r.skillId, level: r.level,
        source: "manual", updated_at: new Date().toISOString(),
      })),
      { onConflict: "profile_id,skill_id" },
    );
  }
}

/** 「スキル自動更新」トグル。OFFにすると①スキル分析がこのメンバーに触らなくなる。 */
export async function setSkillAutoUpdate(profileId: string, on: boolean): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!.from("profiles").update({ skill_auto_update: on }).eq("id", profileId);
}

/** スキルマスタにスキルを追加 */
export async function createSkill(
  orgId: string, layer: SkillLayer, name: string, keywords: string[],
): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!.from("skills").insert({
    organization_id: orgId, layer, name, keywords, sort_order: 999,
  });
}

export async function deleteSkill(skillId: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!.from("skills").delete().eq("id", skillId);
}

/** 組織の学習セットアップ状態 */
export interface OrgMlState {
  mlSetupDone: boolean;
  mlSkillsReviewed: boolean;
  mlLastAnalyzedAt: string | null;
}

export async function fetchOrgMlState(orgId: string): Promise<OrgMlState | null> {
  if (!isSupabaseEnabled || !orgId) return null;
  const { data } = await supabase!
    .from("organizations")
    .select("ml_setup_done, ml_skills_reviewed, ml_last_analyzed_at")
    .eq("id", orgId).maybeSingle();
  if (!data) return null;
  return {
    mlSetupDone: data.ml_setup_done ?? false,
    mlSkillsReviewed: data.ml_skills_reviewed ?? false,
    mlLastAnalyzedAt: data.ml_last_analyzed_at ?? null,
  };
}

export async function markSkillsReviewed(orgId: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!.from("organizations").update({ ml_skills_reviewed: true }).eq("id", orgId);
}

/** 「次回以降このお知らせを表示しない」 */
export async function dismissMlNotice(profileId: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!.from("profiles").update({ ml_notice_dismissed: true }).eq("id", profileId);
}

/**
 * ①スキル自動分析を実行する。
 * 初回セットアップ（AM3時を待たずに即実行）と、管理者の「今すぐ再分析」から呼ぶ。
 */
export async function runSkillAnalysis(orgId: string, force = false): Promise<{ skillsWritten: number }> {
  const res = await fetch("/api/ml/analyze-skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: orgId, force }),
  });
  if (!res.ok) throw new Error(`分析に失敗しました (${res.status})`);
  const json = await res.json();
  const written = (json.results ?? []).reduce((a: number, r: { skillsWritten?: number }) => a + (r.skillsWritten ?? 0), 0);
  return { skillsWritten: written };
}

/** ②担当者レコメンド。学習済みモデルがあればそれを、無ければルールベースで返す。 */
export async function fetchRecommendations(params: {
  organizationId: string;
  requiredSkillIds: { skillId: string; importance: number }[];
  devScale: DevScale | null;
  estimatedHours: number;
  priority: Priority;
  candidateNames?: string[];
  limit?: number;
}): Promise<{ candidates: AssigneeRecommendation[]; source: "model" | "baseline" }> {
  const res = await fetch("/api/ml/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`レコメンドの取得に失敗しました (${res.status})`);
  return res.json();
}
