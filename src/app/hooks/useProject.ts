import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { Project, ProjectStatus } from "@/app/types";

export type MilestoneKey = "startedAt" | "reviewRequestedAt" | "reviewApprovedAt" | "stgCompletedAt" | "uatCompletedAt" | "releasedAt";

const MILESTONE_COLUMN: Record<MilestoneKey, string> = {
  startedAt: "started_at",
  reviewRequestedAt: "review_requested_at",
  reviewApprovedAt: "review_approved_at",
  stgCompletedAt: "stg_completed_at",
  uatCompletedAt: "uat_completed_at",
  releasedAt: "released_at",
};

export async function updateProjectStatus(
  projectId: string,
  newStatus: ProjectStatus,
  currentProject: Project
): Promise<Partial<Project>> {
  const updates: Record<string, unknown> = { status: newStatus };

  if (newStatus === "in-progress" && !currentProject.startedAt) {
    updates.started_at = new Date().toISOString();
  }
  if (newStatus === "completed" && !currentProject.releasedAt) {
    updates.released_at = new Date().toISOString();
  }

  if (isSupabaseEnabled) {
    await supabase!.from("projects").update(updates).eq("id", projectId);
  }

  const result: Partial<Project> = { status: newStatus };
  if (updates.started_at) result.startedAt = updates.started_at as string;
  if (updates.released_at) result.releasedAt = updates.released_at as string;
  return result;
}

export async function recordMilestone(
  projectId: string,
  key: MilestoneKey,
  date: string | null
): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!.from("projects").update({ [MILESTONE_COLUMN[key]]: date }).eq("id", projectId);
}
