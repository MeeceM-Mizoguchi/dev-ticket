export type Page = "login" | "dashboard" | "projects" | "clients" | "members" | "settings" | "sprint" | "permissions";
export type PermissionType = "none" | "view" | "edit" | "admin";
export type Role = "admin" | "project-manager" | "developer" | "designer";
export type ProjectStatus = "planning" | "in-progress" | "completed" | "on-hold";
export type TicketStatus = "todo" | "in-progress" | "done";
export type Priority = "low" | "medium" | "high";
export type MemberStatus = "active" | "inactive" | "invited";
export type NotifKey = "email" | "assign" | "status" | "comment" | "reminder";
export type SprintStatus = "planning" | "active" | "completed" | "cancelled";
export type SprintView = "list" | "board" | "gantt";
export type SortCol = "wbs" | "title" | "status" | "priority" | "startDate" | "dueDate" | "estimatedHours" | "progress";

export interface SprintTicket {
  id: string; wbs: string; title: string; status: TicketStatus;
  priority: Priority; assignee: string; startDate: string; dueDate: string;
  estimatedHours: number; progress: number;
}
export interface Sprint {
  id: string; projectId: string; name: string; goal: string;
  status: SprintStatus; startDate: string; endDate: string;
  tickets: SprintTicket[];
}
export interface Project {
  id: string; name: string; client: string; status: ProjectStatus;
  startDate: string; endDate: string; members: string[];
  done: number; inProgress: number; todo: number; description: string;
}
export interface Client {
  id: string; name: string; industry: string; email: string;
  phone: string; status: "active" | "inactive";
}
export interface Member {
  id: string; name: string; email: string; role: Role;
  group: string; status: MemberStatus; projects: number; tickets: number;
  permission_group_id?: number | null;
}
export interface PermissionGroup {
  id: number; name: string; description: string;
}
export interface GroupProjectPermission {
  group_id: number; project_id: string; permission_type: PermissionType;
}
export interface TicketItem {
  id: string; title: string; project: string; status: TicketStatus;
  priority: Priority; assignee: string; dueDate: string;
}
