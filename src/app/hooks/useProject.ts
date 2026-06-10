import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { Project, ProjectStatus, TicketStatus } from "@/app/types";

export type MilestoneKey = "startedAt" | "reviewRequestedAt" | "reviewApprovedAt" | "stgCompletedAt" | "uatCompletedAt" | "releasedAt";

export interface MilestoneRow {
  startedAt: string | null;
  reviewRequestedAt: string | null;
  reviewApprovedAt: string | null;
  stgCompletedAt: string | null;
  uatCompletedAt: string | null;
  releasedAt: string | null;
}

const MILESTONE_COLUMN: Record<MilestoneKey, string> = {
  startedAt: "started_at",
  reviewRequestedAt: "review_requested_at",
  reviewApprovedAt: "review_approved_at",
  stgCompletedAt: "stg_completed_at",
  uatCompletedAt: "uat_completed_at",
  releasedAt: "released_at",
};

const STATUS_TO_MILESTONE: Partial<Record<TicketStatus, MilestoneKey>> = {
  "in-progress": "startedAt",
  "in-review": "reviewRequestedAt",
  "review-done": "reviewApprovedAt",
  "stg-test": "stgCompletedAt",
  "uat": "uatCompletedAt",
  "done": "releasedAt",
  "closed": "releasedAt",
};

const MILESTONE_ORDER: MilestoneKey[] = [
  "startedAt", "reviewRequestedAt", "reviewApprovedAt",
  "stgCompletedAt", "uatCompletedAt", "releasedAt",
];

// チケット単位でマイルストーンを記録（sprint_ticketsテーブル）
export async function recordMilestoneFromTicketStatus(
  ticketId: string,
  ticketStatus: TicketStatus
): Promise<void> {
  if (!isSupabaseEnabled || !ticketId) return;

  // 「未着手 (todo)」に戻された場合は、無条件ですべての実績を完全にリセットする
  if (ticketStatus === "todo") {
    const resetUpdates: Record<string, null> = {};
    for (const k of MILESTONE_ORDER) {
      resetUpdates[MILESTONE_COLUMN[k]] = null;
    }
    await supabase!.from("sprint_tickets").update(resetUpdates).eq("id", ticketId);
    return;
  }

  const key = STATUS_TO_MILESTONE[ticketStatus];
  if (!key) return; // todo以外でマイルストーンキーがない場合はスキップ

  const keyIdx = MILESTONE_ORDER.indexOf(key);
  // 同一の now を使うことで、カスケード補完された複数マイルストーンが完全一致タイムスタンプになる（スキップ検出に使用）
  const now = new Date().toISOString();

  const { data } = await supabase!
    .from("sprint_tickets")
    .select("started_at, review_requested_at, review_approved_at, stg_completed_at, uat_completed_at, released_at")
    .eq("id", ticketId)
    .single();
  if (!data) return;

  const currentByCol: Record<string, string | null> = {
    started_at: data.started_at,
    review_requested_at: data.review_requested_at,
    review_approved_at: data.review_approved_at,
    stg_completed_at: data.stg_completed_at,
    uat_completed_at: data.uat_completed_at,
    released_at: data.released_at,
  };

  const updates: Record<string, string | null> = {};

  // 後戻り（Backward）の判定
  let movedBackward = false;
  for (let i = keyIdx + 1; i < MILESTONE_ORDER.length; i++) {
    if (currentByCol[MILESTONE_COLUMN[MILESTONE_ORDER[i]]]) {
      movedBackward = true;
      break;
    }
  }

  if (movedBackward) {
    // 🌟 修正: 戻った先の工程（ターゲット工程）のタイムスタンプは、過去の記録をそのまま保持するため上書きしない
    // ターゲット工程より「後ろ」の工程の実績のみを未記録（null）にリセットする
    for (let i = keyIdx + 1; i < MILESTONE_ORDER.length; i++) {
      updates[MILESTONE_COLUMN[MILESTONE_ORDER[i]]] = null;
    }
  } else {
    // 通常の順行処理（Forward）
    for (let i = 0; i <= keyIdx; i++) {
      const col = MILESTONE_COLUMN[MILESTONE_ORDER[i]];
      if (!currentByCol[col]) updates[col] = now;
    }
  }

  if (Object.keys(updates).length > 0) {
    await supabase!.from("sprint_tickets").update(updates).eq("id", ticketId);
  }
}

// チケット単位でマイルストーンを取得（sprint_ticketsテーブル）
export async function fetchMilestones(ticketId: string): Promise<MilestoneRow | null> {
  if (!isSupabaseEnabled || !ticketId) return null;
  const { data } = await supabase!
    .from("sprint_tickets")
    .select("started_at, review_requested_at, review_approved_at, stg_completed_at, uat_completed_at, released_at")
    .eq("id", ticketId)
    .single();
  if (!data) return null;

  const cols = ["started_at", "review_requested_at", "review_approved_at", "stg_completed_at", "uat_completed_at", "released_at"] as const;
  const vals: (string | null)[] = cols.map(c => data[c] || null);

  // バックフィル: null を後続の記録済みタイムスタンプで補完（スキップ時のカスケード処理）
  const backfill: Record<string, string> = {};
  for (let i = 0; i < vals.length; i++) {
    if (!vals[i]) {
      for (let j = i + 1; j < vals.length; j++) {
        if (vals[j]) { vals[i] = vals[j]; backfill[cols[i]] = vals[j]!; break; }
      }
    }
  }
  if (Object.keys(backfill).length > 0) {
    supabase!.from("sprint_tickets").update(backfill).eq("id", ticketId).then(() => { });
  }

  return {
    startedAt: vals[0],
    reviewRequestedAt: vals[1],
    reviewApprovedAt: vals[2],
    stgCompletedAt: vals[3],
    uatCompletedAt: vals[4],
    releasedAt: vals[5],
  };
}

// プロジェクトボードでのステータス変更時に使用（既存機能）
export async function updateProjectStatus(
  projectId: string,
  newStatus: ProjectStatus,
  currentProject: Project
): Promise<Partial<Project>> {
  const updates: Record<string, unknown> = { status: newStatus };

  if (isSupabaseEnabled) {
    await supabase!.from("projects").update(updates).eq("id", projectId);
  }

  return { status: newStatus };
}
