// 通話履歴の記録(ベストエフォート)。通話の成立はBroadcast/WebRTCで完結するため、
// DB書き込みが失敗しても通話は継続させる(ここでは例外を握りつぶす)。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { CallMember } from "./callConstants";

// 発信時: セッション行 + 招待参加者行を作成。
export async function recordCallStart(
  sessionId: string,
  projectId: string,
  initiatorId: string,
  members: CallMember[],
): Promise<void> {
  if (!isSupabaseEnabled) return;
  try {
    await supabase!.from("call_sessions").insert({
      id: sessionId,
      project_id: projectId,
      initiator_id: initiatorId,
      status: "ringing",
    });
    const rows = members.map((m) => ({
      session_id: sessionId,
      user_id: m.id,
      outcome: m.id === initiatorId ? "joined" : "invited",
      joined_at: m.id === initiatorId ? new Date().toISOString() : null,
    }));
    await supabase!.from("call_participants").insert(rows);
  } catch (e) {
    console.error("[callService] recordCallStart failed", e);
  }
}

export async function recordParticipantOutcome(
  sessionId: string,
  userId: string,
  outcome: "joined" | "declined" | "missed",
): Promise<void> {
  if (!isSupabaseEnabled) return;
  try {
    const patch: Record<string, unknown> = { outcome };
    if (outcome === "joined") patch.joined_at = new Date().toISOString();
    await supabase!.from("call_participants").update(patch)
      .eq("session_id", sessionId).eq("user_id", userId);
    if (outcome === "joined") {
      await supabase!.from("call_sessions").update({ status: "active" }).eq("id", sessionId);
    }
  } catch (e) {
    console.error("[callService] recordParticipantOutcome failed", e);
  }
}

export async function recordParticipantLeft(sessionId: string, userId: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  try {
    await supabase!.from("call_participants").update({ left_at: new Date().toISOString() })
      .eq("session_id", sessionId).eq("user_id", userId);
  } catch (e) {
    console.error("[callService] recordParticipantLeft failed", e);
  }
}

export async function recordCallEnded(sessionId: string, missed: boolean): Promise<void> {
  if (!isSupabaseEnabled) return;
  try {
    await supabase!.from("call_sessions")
      .update({ status: missed ? "missed" : "ended", ended_at: new Date().toISOString() })
      .eq("id", sessionId);
  } catch (e) {
    console.error("[callService] recordCallEnded failed", e);
  }
}

// 発信ダイアログ用: プロジェクトIDからメンバー(名前配列)を取得し、
// profiles(id,name) と突き合わせて呼び出し可能な {id,name} 一覧を返す。
// projects.members は「名前文字列 or {name} オブジェクト」の配列という既存仕様に対応。
export async function fetchProjectCallMembers(
  projectId: string,
  selfId: string,
): Promise<CallMember[]> {
  if (!isSupabaseEnabled) return [];
  try {
    const { data: proj } = await supabase!.from("projects").select("members").eq("id", projectId).maybeSingle();
    const rawMembers: unknown[] = Array.isArray(proj?.members) ? proj!.members : [];
    const memberNames = new Set(
      rawMembers
        .map((m) => (typeof m === "object" && m !== null ? (m as { name?: string }).name : (m as string)))
        .filter((n): n is string => Boolean(n)),
    );
    if (memberNames.size === 0) return [];

    const { data: profiles } = await supabase!.from("profiles").select("id, name");
    const list: CallMember[] = (profiles ?? [])
      .filter((p: { id: string; name: string }) => p.id !== selfId && memberNames.has(p.name))
      .map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }));
    list.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    return list;
  } catch (e) {
    console.error("[callService] fetchProjectCallMembers failed", e);
    return [];
  }
}
