import { createClient } from "@supabase/supabase-js";

function calcTicketActualHours(t: {
  started_at: string | null;
  review_requested_at: string | null;
  review_approved_at: string | null;
  stg_completed_at: string | null;
  uat_completed_at: string | null;
  released_at: string | null;
}): number {
  const ts = [t.started_at, t.review_requested_at, t.review_approved_at, t.stg_completed_at, t.uat_completed_at, t.released_at];
  let total = 0;
  for (let i = 1; i < ts.length; i++) {
    const prev = ts[i - 1];
    const cur = ts[i];
    if (!prev || !cur) continue;
    if (i === 2 && prev === cur) continue;
    total += (new Date(cur).getTime() - new Date(prev).getTime()) / (1000 * 60 * 60);
  }
  return total;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const { projectId } = req.query;
  if (!projectId || typeof projectId !== "string") return res.status(400).json({ error: "projectId is required" });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase not configured" });

  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // N+1を避けるため、スプリントとチケットを1回のJOINクエリで取得
  const { data: sprints, error } = await sb
    .from("sprints")
    .select("id, sprint_tickets(started_at, review_requested_at, review_approved_at, stg_completed_at, uat_completed_at, released_at)")
    .eq("project_id", projectId);

  if (error) return res.status(500).json({ error: error.message });

  let actualHours = 0;
  for (const sprint of sprints ?? []) {
    const tickets = (sprint.sprint_tickets as any[]) ?? [];
    for (const t of tickets) {
      actualHours += calcTicketActualHours(t);
    }
  }
  const rounded = Math.round(actualHours * 10) / 10;

  res.json({ projectId, actualHours: rounded });
}
