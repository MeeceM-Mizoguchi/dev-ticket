// メンバー管理API（api/invite.ts / api/delete-member.ts）の呼び出し元を確かめる共通処理。
//
// ── なぜ必要か ──────────────────────────────────────────────
// 2本とも service_role で Supabase に繋ぐ（RLS が効かない）のに、呼び出し元を
// 一切確かめていなかった。画面でボタンを隠していても、API を直接叩けば
// ログインしていない人でも任意のロール（owner 含む）で招待でき、任意のユーザーを削除できた。
//
// ── 誰がメンバー管理できるか ────────────────────────────────
// オーナー（DevTicket運営）と各組織の管理者だけ。ロール設定の権限では広げない。
// 画面側の判定（src/app/pages/MembersPage.tsx の canManageMembers）と揃えること。
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateCaller, type AuthFailure } from "./projectAuth.js";

export type MemberManager = {
  id: string;
  role: "owner" | "admin";
  organizationId: string | null;
};

/**
 * 呼び出し元がメンバー管理できる人（オーナー／管理者）かを確かめる。
 * APIキー（dvt_live_）は受け付けない。メンバー管理は画面からの操作に限る。
 */
export async function requireMemberManager(
  sb: SupabaseClient,
  req: any,
): Promise<{ ok: true; manager: MemberManager } | AuthFailure> {
  const auth = await authenticateCaller(sb, req);
  if (!auth.ok) return auth;
  if (auth.caller.kind !== "user") {
    return { ok: false, status: 403, error: "メンバー管理はAPIキーでは実行できません" };
  }

  const { data: profile } = await sb.from("profiles")
    .select("id, role, organization_id").eq("id", auth.caller.userId).maybeSingle();
  if (!profile || (profile.role !== "owner" && profile.role !== "admin")) {
    return { ok: false, status: 403, error: "メンバー管理はオーナーと管理者のみ実行できます" };
  }
  return {
    ok: true,
    manager: {
      id: String(profile.id),
      role: profile.role,
      organizationId: profile.organization_id ? String(profile.organization_id) : null,
    },
  };
}
