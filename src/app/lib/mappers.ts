import type { Project, Client, Sprint, SprintTicket, TicketCategory, Member, TicketComment, TicketSourceFile, ProjectFile, AppNotification, ActionMemo, BacklogItem, WikiPage, MeetingMinute, BugReport, Skill, MemberSkill, SkillUpdateRun, MemberSkillChange, MlBatchRun, MlBatchMemberRun, KnowledgeDocument, KnowledgeChunk, KnowledgeSearchHit, KnowledgeFolder, Task, TaskShare } from "@/app/types";
import { compareWbs } from "@/app/lib/helpers";

// ── ENHA2-032 タスク ──
// shares は一覧では引かない（詳細を開いたときだけ埋める）ので既定は空配列。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapTask(r: any): Task {
  return {
    id: r.id, ownerId: r.owner_id || "", createdBy: r.created_by || "",
    projectId: r.project_id ?? null, parentId: r.parent_id ?? null,
    title: r.title || "", description: r.description || "",
    // 分類は text[]。旧 category（単一）しか無い行も読めるようにしておく
    // （supabase/add_task_categories.sql を流す前でも一覧が壊れないため）
    categories: Array.isArray(r.categories)
      ? r.categories.filter(Boolean)
      : (r.category ? [r.category] : []),
    status: r.status || "todo", priority: r.priority || "medium",
    // 進捗率。列を足す前の行（supabase/add_task_progress.sql 未実行）でも 0% として読める
    progress: Number(r.progress ?? 0),
    assignee: r.assignee || "",
    startDate: r.start_date || "", dueDate: r.due_date || "",
    ticketId: r.ticket_id ?? null, ticketWbs: r.ticket_wbs || "",
    sortOrder: Number(r.sort_order ?? 0),
    completedAt: r.completed_at ?? null,
    createdAt: r.created_at || "", updatedAt: r.updated_at || "",
    shares: Array.isArray(r.task_shares) ? r.task_shares.map(mapTaskShare) : [],
  };
}

// profiles を埋め込み select した場合は r.profiles に名前が入る
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapTaskShare(r: any): TaskShare {
  return { profileId: r.profile_id, name: r.profiles?.name || r.name || "", canEdit: r.can_edit !== false };
}

// ── ナレッジノート ──
// 一覧では content を引かないため、無い場合は空文字にフォールバックする
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapKnowledgeDocument(r: any): KnowledgeDocument {
  return { id: r.id, projectId: r.project_id, folderId: r.folder_id ?? null, title: r.title || "", fileName: r.file_name || "", content: r.content ?? "", contentHash: r.content_hash || "", byteSize: r.byte_size ?? 0, tags: Array.isArray(r.tags) ? r.tags : [], chunkCount: r.chunk_count ?? 0, indexedAt: r.indexed_at ?? null, embeddingModel: r.embedding_model || "", uploadedBy: r.uploaded_by || "", createdAt: r.created_at || "", updatedAt: r.updated_at || "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapKnowledgeFolder(r: any): KnowledgeFolder {
  return { id: r.id, projectId: r.project_id, name: r.name || "", sortOrder: r.sort_order ?? 0, createdBy: r.created_by || "", createdAt: r.created_at || "", updatedAt: r.updated_at || "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapKnowledgeChunk(r: any): KnowledgeChunk {
  return { id: r.id, documentId: r.document_id, projectId: r.project_id, seq: r.seq ?? 0, headingPath: r.heading_path || "", content: r.content || "", charStart: r.char_start ?? 0, charEnd: r.char_end ?? 0 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapKnowledgeHit(r: any): KnowledgeSearchHit {
  return { chunkId: r.chunk_id, documentId: r.document_id, title: r.title || "", headingPath: r.heading_path || "", content: r.content || "", charStart: r.char_start ?? 0, charEnd: r.char_end ?? 0, score: Number(r.score ?? 0), vecScore: Number(r.vec_score ?? 0), kwScore: Number(r.kw_score ?? 0) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapProject(r: any): Project {
  return { id: r.id, slug: r.slug || "", wbsPrefix: r.wbs_prefix || "T", name: r.name, client: r.client, status: r.status, startDate: r.start_date, endDate: r.end_date, members: r.members || [], groupIds: r.group_ids || [], tags: Array.isArray(r.tags) ? r.tags : [], done: r.done || 0, inProgress: r.in_progress || 0, todo: r.todo || 0, description: r.description || "", envMemos: Array.isArray(r.env_memos) ? r.env_memos : [], startedAt: r.started_at || null, reviewRequestedAt: r.review_requested_at || null, reviewApprovedAt: r.review_approved_at || null, stgCompletedAt: r.stg_completed_at || null, uatCompletedAt: r.uat_completed_at || null, releasedAt: r.released_at || null, organizationId: r.organization_id ?? null, isManualStatus: r.is_manual_status ?? false, githubRepoFullName: r.github_repo_full_name ?? null, githubDefaultBranch: r.github_default_branch ?? null, githubEnabled: r.github_enabled ?? false, deployCheckUrl: r.deploy_check_url ?? null, deployCheckKey: r.deploy_check_key ?? null, deployCheckMode: r.deploy_check_mode ?? "off", requireChecksMode: r.require_checks_mode ?? "warn" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapClient(r: any): Client {
  return { id: r.id, name: r.name, industry: r.industry || "", email: r.email || "", phone: r.phone || "", status: r.status, organizationId: r.organization_id ?? null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSprintTicket(r: any): SprintTicket {
  const assignee: string = Array.isArray(r.assignees) && r.assignees.length > 0
    ? r.assignees[0] : (r.assignee || "");
  // 🌟 追加: 末尾に closedAt: r.closed_at ?? null を追加してDBデータを紐づけ
  return { id: r.id, wbs: r.wbs || "", title: r.title, status: r.status, priority: r.priority, assignee, startDate: r.start_date || "", dueDate: r.due_date || "", estimatedHours: r.estimated_hours || 0, progress: r.progress || 0, description: r.description || "", reviewerName: r.reviewer_name || "", reviewRound: r.review_round || 0, images: Array.isArray(r.images) ? r.images : [], categoryId: r.category_id ?? null, createdBy: r.created_by || "", createdAt: r.created_at || "", parentId: r.parent_id ?? null, startedAt: r.started_at ?? null, reviewRequestedAt: r.review_requested_at ?? null, reviewApprovedAt: r.review_approved_at ?? null, stgCompletedAt: r.stg_completed_at ?? null, uatCompletedAt: r.uat_completed_at ?? null, releasedAt: r.released_at ?? null, closedAt: r.closed_at ?? null, releaseDate: r.release_date ?? null, isReleaseDateUndecided: r.is_release_date_undecided ?? false, actualWorkHours: r.actual_work_hours ?? null, isOperationVerified: r.is_operation_verified ?? false, prLinkWaived: r.pr_link_waived ?? false, prefixes: Array.isArray(r.prefixes) ? r.prefixes : [], devScale: r.dev_scale ?? null } as SprintTicket;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapTicketCategory(r: any): TicketCategory {
  return { id: r.id, projectId: r.project_id, name: r.name };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSprint(r: any): Sprint {
  // 並び順は WBS（No）の自然順。
  // 一括作成したチケットは created_at が全件同一（1回の insert ＝ now() が同じ）になり、
  // 作成日時では順序が決まらずランダムな id 順に落ちてしまうため、WBS を第1キーにする。
  const tickets = (r.sprint_tickets || []).map(mapSprintTicket)
    .sort((a: SprintTicket, b: SprintTicket) => {
      const d = compareWbs(a.wbs, b.wbs);
      if (d !== 0) return d;
      const c = (a.createdAt || "").localeCompare(b.createdAt || "");
      return c !== 0 ? c : a.id.localeCompare(b.id);
    });
  return { id: r.id, projectId: r.project_id, name: r.name, goal: r.goal || "", status: r.status, startDate: r.start_date, endDate: r.end_date, identifier: r.identifier || "", tickets, isManualStatus: r.is_manual_status ?? false };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapComment(r: any): TicketComment {
  return { id: r.id, ticketId: r.ticket_id, userName: r.user_name, content: r.content, ticketStatus: r.ticket_status, images: (r.images || []) as string[], createdAt: r.created_at || "", commentType: (r.comment_type || "comment") as import("@/app/types").CommentType, replyTo: r.reply_to ?? null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSourceFile(r: any): TicketSourceFile {
  return { id: r.id, ticketId: r.ticket_id, fileName: r.file_name, fileSize: r.file_size || 0, fileType: r.file_type || "", uploadedBy: r.uploaded_by, reviewRound: r.review_round || 1, fileUrl: r.file_url || "", createdAt: r.created_at || "" };
}

// ── ENHA2-035 ファイルボックス ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapProjectFile(r: any): ProjectFile {
  return { id: r.id, projectId: r.project_id, folderPath: r.folder_path || "", fileName: r.file_name, fileSize: r.file_size || 0, fileType: r.file_type || "", filePath: r.file_path || "", version: r.version || 1, uploadedBy: r.uploaded_by || "", createdAt: r.created_at || "", parentId: r.parent_id ?? null, isFolder: r.is_folder ?? false };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMember(r: any): Member {
  return { id: r.id, name: r.name, email: r.email, role: r.role, group: r.group_name || "", status: r.status || "active", projects: r.project_count || 0, tickets: r.ticket_count || 0, permission_group_id: r.permission_group_id || null, organizationId: r.organization_id ?? null, skillAutoUpdate: r.skill_auto_update ?? true, mlNoticeDismissed: r.ml_notice_dismissed ?? false };
}

// ── ENHA2-034 スキル ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSkill(r: any): Skill {
  return { id: r.id, organizationId: r.organization_id, layer: r.layer, name: r.name, keywords: Array.isArray(r.keywords) ? r.keywords : [], sortOrder: r.sort_order ?? 0 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMemberSkill(r: any): MemberSkill {
  return { profileId: r.profile_id, skillId: r.skill_id, level: r.level, source: r.source || "auto", evidence: r.evidence ?? {}, updatedAt: r.updated_at || "" };
}

// ── BRU9-041 スキル更新の履歴 ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSkillUpdateRun(r: any): SkillUpdateRun {
  return { id: r.id, organizationId: r.organization_id, kind: r.kind, actorProfileId: r.actor_profile_id ?? null, targetProfileId: r.target_profile_id ?? null, restoredFromAt: r.restored_from_at ?? null, summary: r.summary ?? {}, createdAt: r.created_at || "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMemberSkillChange(r: any): MemberSkillChange {
  return { id: r.id, runId: r.run_id, organizationId: r.organization_id, profileId: r.profile_id, skillId: r.skill_id, changeType: r.change_type, oldLevel: r.old_level ?? null, newLevel: r.new_level ?? null, oldSource: r.old_source ?? null, newSource: r.new_source ?? null, evidence: r.evidence ?? {}, changedAt: r.changed_at || "" };
}

// ── 夜間バッチの学習ログ ──
// finished_at が無い＝終了記録が残らないまま落ちた。緑で流さず「問題あり」として扱う。
// ただし実行中はまだ finished_at が無いのが正常なので、ワークフローの
// timeout-minutes と同じ30分は「実行中」として見逃す（開いた瞬間に赤くしない）。
const BATCH_TIMEOUT_MS = 30 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMlBatchRun(r: any): MlBatchRun {
  const startedMs = r.started_at ? new Date(r.started_at).getTime() : 0;
  const unfinished = !r.finished_at && Date.now() - startedMs > BATCH_TIMEOUT_MS;
  return {
    id: r.id,
    organizationId: r.organization_id,
    batchId: r.batch_id || "",
    trigger: r.trigger || "daily",
    startedAt: r.started_at || "",
    finishedAt: r.finished_at ?? null,
    result: unfinished ? "failed" : (r.result || "not_run"),
    summary: unfinished
      ? (r.summary || "途中で異常終了しました（タイムアウトの可能性があります）")
      : (r.summary || (r.finished_at ? "" : "実行中です")),
    detail: r.detail ?? {},
    skillRunId: r.skill_run_id ?? null,
    member: null,
  };
}

/** BRU10-062 メンバー個別の実行ログ（ml_batch_member_runs の1行） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMlBatchMemberRun(r: any): MlBatchMemberRun {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const changes = (r.detail?.changes ?? []) as any[];
  return {
    status: r.status || "unchanged",
    changedCount: r.changed_count ?? 0,
    evaluatedSkills: r.evaluated_skills ?? 0,
    matchedTickets: r.matched_tickets ?? 0,
    protectedSkills: r.protected_skills ?? 0,
    reason: r.reason ?? null,
    changes: changes.map(c => ({
      skill: c.skill || "（削除済み）",
      changeType: c.changeType || "added",
      oldLevel: c.oldLevel ?? null,
      newLevel: c.newLevel ?? null,
    })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapNotification(r: any): AppNotification {
  return { id: r.id, userName: r.user_name, type: r.type, title: r.title, body: r.body || "", ticketId: r.ticket_id ?? null, ticketWbs: r.ticket_wbs || "", ticketTitle: r.ticket_title || "", projectSlug: r.project_slug || "", mentionContext: r.mention_context || "", isRead: r.is_read ?? false, createdAt: r.created_at || "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapActionMemo(r: any): ActionMemo {
  return { id: r.id, userName: r.user_name, title: r.title || "", content: r.content || "", category: r.category || "memo", sourceNotificationId: r.source_notification_id ?? null, ticketId: r.ticket_id ?? null, ticketWbs: r.ticket_wbs || "", ticketTitle: r.ticket_title || "", projectSlug: r.project_slug || "", projectId: r.project_id || "", sprintId: r.sprint_id || "", isDone: r.is_done ?? false, createdAt: r.created_at || "", updatedAt: r.updated_at || "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapBacklogItem(r: any): BacklogItem {
  return { id: r.id, projectId: r.project_id, title: r.title, description: r.description || "", parentId: r.parent_id ?? null, isFolder: r.is_folder ?? false, status: r.status || "open", priority: r.priority || "medium", rank: r.rank ?? 0, assignee: r.assignee || "", estimatedHours: r.estimated_hours || 0, convertedTicketId: r.converted_ticket_id ?? null, convertedTicketWbs: r.converted_ticket_wbs ?? null, categoryId: r.category_id ?? null, images: Array.isArray(r.images) ? r.images : [], isUserInquiry: r.is_user_inquiry ?? false, bugReportId: r.bug_report_id ?? null, createdBy: r.created_by || "", createdAt: r.created_at || "", updatedAt: r.updated_at || "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapBugReport(r: any): BugReport {
  return { id: r.id, userId: r.user_id ?? null, userName: r.user_name || "", userEmail: r.user_email || "", category: r.category || "other", severity: r.severity || "minor", title: r.title || "", steps: r.steps || "", actual: r.actual || "", expected: r.expected || "", url: r.url || "", images: Array.isArray(r.images) ? r.images : [], status: r.status || "open", backlogItemId: r.backlog_item_id ?? null, createdAt: r.created_at || "", updatedAt: r.updated_at || "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapWikiPage(r: any): WikiPage {
  return { id: r.id, projectId: r.project_id, parentId: r.parent_id ?? null, title: r.title || "", content: r.content || "", sortOrder: r.sort_order ?? 0, isFolder: r.is_folder ?? false, images: Array.isArray(r.images) ? r.images : [], createdBy: r.created_by || "", updatedBy: r.updated_by || "", createdAt: r.created_at || "", updatedAt: r.updated_at || "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMeetingMinute(r: any): MeetingMinute {
  return { id: r.id, projectId: r.project_id, title: r.title || "", meetingDate: r.meeting_date || "", parentId: r.parent_id ?? null, isFolder: r.is_folder ?? false, sortOrder: r.sort_order ?? 0, attendees: Array.isArray(r.attendees) ? r.attendees : [], content: r.content || "", images: Array.isArray(r.images) ? r.images : [], createdBy: r.created_by || "", createdAt: r.created_at || "", updatedAt: r.updated_at || "" };
}
