import type { Project, Client, Sprint, SprintTicket, TicketCategory, Member, TicketComment, TicketSourceFile } from "@/app/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapProject(r: any): Project {
  return { id:r.id, name:r.name, client:r.client, status:r.status, startDate:r.start_date, endDate:r.end_date, members:r.members||[], groupIds:r.group_ids||[], done:r.done||0, inProgress:r.in_progress||0, todo:r.todo||0, description:r.description||"" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapClient(r: any): Client {
  return { id:r.id, name:r.name, industry:r.industry||"", email:r.email||"", phone:r.phone||"", status:r.status };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSprintTicket(r: any): SprintTicket {
  const assignees: string[] = Array.isArray(r.assignees) && r.assignees.length > 0
    ? r.assignees : (r.assignee ? [r.assignee] : []);
  return { id:r.id, wbs:r.wbs||"", title:r.title, status:r.status, priority:r.priority, assignee:assignees[0]||"", assignees, startDate:r.start_date||"", dueDate:r.due_date||"", estimatedHours:r.estimated_hours||0, progress:r.progress||0, description:r.description||"", reviewerName:r.reviewer_name||"", reviewRound:r.review_round||0, generatedPrompt:r.generated_prompt||"", images:Array.isArray(r.images)?r.images:[], categoryId:r.category_id??null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapTicketCategory(r: any): TicketCategory {
  return { id: r.id, projectId: r.project_id, name: r.name };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSprint(r: any): Sprint {
  return { id:r.id, projectId:r.project_id, name:r.name, goal:r.goal||"", status:r.status, startDate:r.start_date, endDate:r.end_date, tickets:(r.sprint_tickets||[]).map(mapSprintTicket) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapComment(r: any): TicketComment {
  return { id:r.id, ticketId:r.ticket_id, userName:r.user_name, content:r.content, ticketStatus:r.ticket_status, images:(r.images||[]) as string[], createdAt:r.created_at||"", commentType:(r.comment_type||"comment") as import("@/app/types").CommentType };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSourceFile(r: any): TicketSourceFile {
  return { id:r.id, ticketId:r.ticket_id, fileName:r.file_name, fileSize:r.file_size||0, fileType:r.file_type||"", uploadedBy:r.uploaded_by, reviewRound:r.review_round||1, fileUrl:r.file_url||"", createdAt:r.created_at||"" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMember(r: any): Member {
  return { id:r.id, name:r.name, email:r.email, role:r.role, group:r.group_name||"", status:r.status||"active", projects:r.project_count||0, tickets:r.ticket_count||0, permission_group_id:r.permission_group_id||null };
}
