import { createClient } from "@supabase/supabase-js";
import { requireMemberManager } from "./_lib/memberAuth";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { userId, memberName } = req.body ?? {};
  if (!userId || !memberName) return res.status(400).json({ error: "userId and memberName are required" });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase service key not configured" });

  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // メンバー管理はオーナーと管理者だけ（api/_lib/memberAuth.ts）
  const auth = await requireMemberManager(sb, req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const manager = auth.manager;

  if (userId === manager.id) return res.status(400).json({ error: "自分自身は削除できません" });

  const { data: target } = await sb.from("profiles")
    .select("name, role, organization_id").eq("id", userId).maybeSingle();
  if (!target) return res.status(404).json({ error: "メンバーが見つかりません" });
  // オーナーはオーナーしか触れない。管理者は自分の組織の人しか消せない
  if (target.role === "owner" && manager.role !== "owner") {
    return res.status(404).json({ error: "メンバーが見つかりません" });
  }
  if (manager.role !== "owner" && String(target.organization_id ?? "") !== String(manager.organizationId ?? "")) {
    return res.status(404).json({ error: "メンバーが見つかりません" });
  }

  // 名前で消し込むのは、そのメンバーの組織の中だけ。
  // 絞らないと、別の組織にいる同じ名前の人まで担当者・メンバーから外れる。
  const orgId = target.organization_id ? String(target.organization_id) : null;
  const name = String(target.name ?? memberName);

  const { data: projectRows } = orgId
    ? await sb.from("projects").select("id, members").eq("organization_id", orgId)
    : { data: [] as { id: string; members: string[] | null }[] };
  const projectIds = (projectRows ?? []).map(p => String(p.id));

  // 1. Clear assignee from sprint_tickets (don't delete the tickets themselves)
  if (projectIds.length > 0) {
    const { data: sprints } = await sb.from("sprints").select("id").in("project_id", projectIds);
    const sprintIds = (sprints ?? []).map(s => String(s.id));
    if (sprintIds.length > 0) {
      await sb.from("sprint_tickets").update({ assignee: "" }).eq("assignee", name).in("sprint_id", sprintIds);
    }
  }

  // 2. Remove member name from projects.members arrays
  for (const p of projectRows ?? []) {
    if ((p.members as string[] ?? []).includes(name)) {
      await sb.from("projects")
        .update({ members: (p.members as string[]).filter((m: string) => m !== name) })
        .eq("id", p.id);
    }
  }

  // 3. Delete from auth.users — cascades to profiles via FK
  // @vercel/node + pnpm では auth.admin の継承型が解決されないため型のみ緩める（実行時は有効）
  const { error } = await (sb.auth as any).admin.deleteUser(userId);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true });
}
