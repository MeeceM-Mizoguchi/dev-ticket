import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { userId, memberName } = req.body ?? {};
  if (!userId || !memberName) return res.status(400).json({ error: "userId and memberName are required" });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase service key not configured" });

  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1. Clear assignee from sprint_tickets (don't delete the tickets themselves)
  await sb.from("sprint_tickets").update({ assignee: "" }).eq("assignee", memberName);

  // 2. Remove member name from projects.members arrays
  const { data: projectRows } = await sb.from("projects").select("id, members");
  for (const p of projectRows ?? []) {
    if ((p.members as string[] ?? []).includes(memberName)) {
      await sb.from("projects")
        .update({ members: (p.members as string[]).filter((m: string) => m !== memberName) })
        .eq("id", p.id);
    }
  }

  // 3. Delete from auth.users — cascades to profiles via FK
  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true });
}
