import { assertProjectAccess, authenticateCaller, serviceClient } from "../../_lib/projectAuth";

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

  const { sprintId } = req.query;
  if (!sprintId || typeof sprintId !== "string") return res.status(400).json({ error: "sprintId is required" });

  const sb = serviceClient();
  if (!sb) return res.status(500).json({ error: "Supabase not configured" });

  // 認証を先に済ませる。スプリントを引いてから認証すると、未認証の呼び出しに対して
  // 「存在しない=404 / 存在する=401」と返り分けてしまい、IDの総当たりで存在を探れる。
  const auth = await authenticateCaller(sb, req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // スプリント単体ではプロジェクトが判らないので、親を引いてから権限を見る。
  // 「無い」と「見せられない」は、どちらも同じ 404 に寄せる。
  const notFound = { error: "スプリントが見つかりません" };
  const { data: sprint } = await sb
    .from("sprints")
    .select("project_id")
    .eq("id", sprintId)
    .maybeSingle();
  if (!sprint) return res.status(404).json(notFound);

  const denied = await assertProjectAccess(sb, auth.caller, sprint.project_id as string);
  if (denied) return res.status(denied.status).json(denied.status === 404 ? notFound : { error: denied.error });

  const { data, error } = await sb
    .from("sprint_tickets")
    .select("started_at, review_requested_at, review_approved_at, stg_completed_at, uat_completed_at, released_at")
    .eq("sprint_id", sprintId);

  if (error) return res.status(500).json({ error: error.message });

  const actualHours = (data ?? []).reduce((sum: number, t: any) => sum + calcTicketActualHours(t), 0);
  const rounded = Math.round(actualHours * 10) / 10;

  res.json({ sprintId, actualHours: rounded });
}
