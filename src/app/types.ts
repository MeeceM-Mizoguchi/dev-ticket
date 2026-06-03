export type Page = "login" | "dashboard" | "projects" | "clients" | "members" | "settings" | "sprint" | "permissions" | "roles";
export type PermissionType = "none" | "view" | "edit" | "admin";
export type Role = string;
export interface RoleDefinition {
  id: number;
  name: string;
  label: string;
  base_permissions: UserPermissions;
}
export type ProjectStatus = "planning" | "in-progress" | "completed" | "on-hold";
export type TicketStatus = "todo" | "in-progress" | "in-review" | "review-done" | "stg-test" | "uat" | "done" | "closed";
export type Priority = "low" | "medium" | "high";
export type MemberStatus = "active" | "inactive" | "invited";
export type NotifKey = "email" | "assign" | "status" | "comment" | "reminder";
export type NotificationType = "mention" | "assign" | "review_request" | "revision_request" | "review_approved" | "status" | "comment";

export interface AppNotification {
  id: string;
  userName: string;
  type: NotificationType;
  title: string;
  body: string;
  ticketId: string | null;
  ticketWbs: string;
  ticketTitle: string;
  projectSlug: string;
  mentionContext: string;
  isRead: boolean;
  createdAt: string;
}
export type SprintStatus = "planning" | "active" | "completed" | "delayed";
export type SprintView = "list" | "board" | "gantt";
export type SortCol = "wbs" | "title" | "description" | "status" | "priority" | "assignee" | "startDate" | "dueDate" | "estimatedHours" | "progress";

export interface TicketCategory {
  id: string;
  projectId: string;
  name: string;
}

export interface SprintTicket {
  id: string; wbs: string; title: string; status: TicketStatus;
  priority: Priority; assignee: string; startDate: string; dueDate: string;
  estimatedHours: number; progress: number;
  description?: string; reviewerName?: string; reviewRound?: number; generatedPrompt?: string;
  images?: string[]; categoryId?: string | null;
  createdBy?: string; createdAt?: string;
  // 子チケットの親ID。null = 親チケット、文字列 = 子チケット。現在は1階層のみ。将来的に孫チケット対応を実装予定。
  parentId?: string | null;
}

export type CommentType = "comment" | "review_request" | "revision_request" | "review_approved" | "status_change";

export interface TicketComment {
  id: string; ticketId: string; userName: string; content: string;
  ticketStatus: TicketStatus; images: string[]; createdAt: string;
  commentType: CommentType;
}

export interface TicketSourceFile {
  id: string; ticketId: string; fileName: string; fileSize: number;
  fileType: string; uploadedBy: string; reviewRound: number;
  fileUrl?: string; createdAt: string;
}
export interface Sprint {
  id: string; projectId: string; name: string; goal: string;
  status: SprintStatus; startDate: string; endDate: string;
  tickets: SprintTicket[]; identifier: string;
}
export interface Project {
  id: string; slug: string; wbsPrefix: string;
  name: string; client: string; status: ProjectStatus;
  startDate: string; endDate: string; members: string[]; groupIds: number[];
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
  permissions?: UserPermissions | null;
}
export interface GroupProjectPermission {
  group_id: number; project_id: string; permission_type: PermissionType;
}
export interface TicketItem {
  id: string; title: string; project: string; status: TicketStatus;
  priority: Priority; assignee: string; dueDate: string;
}
export interface UserPermissions {
  canCreateTicket: boolean;
  canCreateSprint: boolean;
  canEditDelete: boolean;
  canReview: boolean;
  canSkipReview: boolean;
  canGeneratePrompt: boolean;
  canAccessMembers: boolean;
  canAccessRoles: boolean;
  canAccessGroups: boolean;
}
