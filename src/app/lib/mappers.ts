import type { Project, Client, Sprint, SprintTicket, Member } from "@/app/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapProject(r: any): Project {
  return { id:r.id, name:r.name, client:r.client, status:r.status, startDate:r.start_date, endDate:r.end_date, members:r.members||[], done:r.done||0, inProgress:r.in_progress||0, todo:r.todo||0, description:r.description||"" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapClient(r: any): Client {
  return { id:r.id, name:r.name, industry:r.industry||"", email:r.email||"", phone:r.phone||"", status:r.status };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSprintTicket(r: any): SprintTicket {
  return { id:r.id, wbs:r.wbs||"", title:r.title, status:r.status, priority:r.priority, assignee:r.assignee||"", startDate:r.start_date, dueDate:r.due_date, estimatedHours:r.estimated_hours||0, progress:r.progress||0 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSprint(r: any): Sprint {
  return { id:r.id, projectId:r.project_id, name:r.name, goal:r.goal||"", status:r.status, startDate:r.start_date, endDate:r.end_date, tickets:(r.sprint_tickets||[]).map(mapSprintTicket) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMember(r: any): Member {
  return { id:r.id, name:r.name, email:r.email, role:r.role, group:r.group_name||"", status:r.status||"active", projects:r.project_count||0, tickets:r.ticket_count||0, permission_group_id:r.permission_group_id||null };
}
