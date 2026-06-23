export type Page = "login" | "dashboard" | "projects" | "clients" | "members" | "sprint" | "permissions" | "roles" | "admin-settings" | "my-actions" | "release-notes" | "organization";

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
  representativeName?: string;
  contactName?: string;
  phone?: string;
  websiteUrl?: string;
  address?: string;
  industry?: string;
  description?: string;
}
export type ActionMemoCategory = "todo" | "review" | "test" | "memo";
export interface ActionMemo {
  id: string;
  userName: string;
  title: string;
  content: string;
  category: ActionMemoCategory;
  sourceNotificationId: string | null;
  ticketId: string | null;
  ticketWbs: string;
  ticketTitle: string;
  projectSlug: string;
  projectId: string;
  sprintId: string;
  isDone: boolean;
  createdAt: string;
  updatedAt: string;
}
export type PermissionType = "none" | "view" | "edit" | "admin";
export type Role = string;
export interface RoleDefinition {
  id: number;
  name: string;
  label: string;
  base_permissions: UserPermissions;
}
export type ProjectStatus = "planning" | "in-progress" | "completed" | "on-hold";
export type TicketStatus = "todo" | "in-progress" | "in-review" | "review-done" | "stg-test" | "uat" | "done" | "closed" | "waiting-release" | "released";
export type Priority = "low" | "medium" | "high";
export type MemberStatus = "active" | "inactive" | "invited";
export type NotificationType = "mention" | "assign" | "review_request" | "review_withdrawn" | "revision_request" | "review_approved" | "status" | "comment";

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
export type SortCol = "wbs" | "title" | "description" | "status" | "priority" | "assignee" | "startDate" | "dueDate" | "estimatedHours" | "progress" | "category";

export interface TicketCategory {
  id: string;
  projectId: string;
  name: string;
}

export interface SprintTicket {
  id: string; wbs: string; title: string; status: TicketStatus;
  priority: Priority; assignee: string; startDate: string; dueDate: string;
  estimatedHours: number; progress: number;
  description?: string; reviewerName?: string; reviewRound?: number;
  images?: string[]; categoryId?: string | null;
  createdBy?: string; createdAt?: string;
  // 子チケットの親ID。null = 親チケット、文字列 = 子チケット。現在は1階層のみ。将来的に孫チケット対応を実装予定。
  parentId?: string | null;
  // 実績モニタ用マイルストーンタイムスタンプ
  startedAt?: string | null;
  reviewRequestedAt?: string | null;
  reviewApprovedAt?: string | null;
  stgCompletedAt?: string | null;
  uatCompletedAt?: string | null;
  releasedAt?: string | null;
  // リリースノート用フィールド
  releaseDate?: string | null;
  isReleaseDateUndecided?: boolean;
  // 対応完了時の手動工数入力
  actualWorkHours?: number | null;
  // 動作確認チェック
  isOperationVerified?: boolean;
}

export type CommentType = "comment" | "review_request" | "review_withdrawn" | "revision_request" | "review_approved" | "status_change";

export interface TicketComment {
  id: string; ticketId: string; userName: string; content: string;
  ticketStatus: TicketStatus; images: string[]; createdAt: string;
  commentType: CommentType; replyTo?: string | null;
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
  startedAt?: string | null;
  reviewRequestedAt?: string | null;
  reviewApprovedAt?: string | null;
  stgCompletedAt?: string | null;
  uatCompletedAt?: string | null;
  releasedAt?: string | null;
  organizationId?: string | null;
}
export interface Client {
  id: string; name: string; industry: string; email: string;
  phone: string; status: "active" | "inactive";
  organizationId?: string | null;
}
export interface Member {
  id: string; name: string; email: string; role: Role;
  group: string; status: MemberStatus; projects: number; tickets: number;
  permission_group_id?: number | null;
  organizationId?: string | null;
}
export interface PermissionGroup {
  id: number; name: string; description: string;
  permissions?: UserPermissions | null;
}
export interface GroupProjectPermission {
  group_id: number; project_id: string; permission_type: PermissionType;
}
export type BacklogStatus = "open" | "in-progress" | "converted" | "archived";
export interface BacklogItem {
  id: string; projectId: string; title: string; description: string;
  status: BacklogStatus; priority: Priority; rank: number;
  assignee: string; estimatedHours: number; convertedTicketId: string | null;
  convertedTicketWbs: string | null;
  categoryId: string | null;
  images: string[];
  isUserInquiry: boolean;
  bugReportId: string | null;
  createdBy: string; createdAt: string; updatedAt: string;
}
export type BugCategory = "login" | "ticket" | "sprint" | "member" | "ui" | "other";
export type BugSeverity = "critical" | "major" | "minor";
export type BugReportStatus = "open" | "resolved";
export interface BugReport {
  id: string;
  userId: string | null;
  userName: string;
  userEmail: string;
  category: BugCategory;
  severity: BugSeverity;
  title: string;
  steps: string;
  actual: string;
  expected: string;
  url: string;
  images: string[];
  status: BugReportStatus;
  backlogItemId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface WikiPage {
  id: string; projectId: string; parentId: string | null; title: string;
  content: string; sortOrder: number;
  isFolder: boolean;
  images: string[];
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string;
}
export interface MeetingMinute {
  id: string; projectId: string; title: string; meetingDate: string;
  attendees: string[]; content: string;
  images: string[];
  createdBy: string; createdAt: string; updatedAt: string;
}
export interface TicketItem {
  id: string; title: string; project: string; status: TicketStatus;
  priority: Priority; assignee: string; dueDate: string;
}
export type AccessLevel = "none" | "view" | "edit";

export interface UserPermissions {
  canCreateTicket: boolean;
  canCreateSprint: boolean;
  canEditDelete: boolean;
  canReview: boolean;
  canSkipReview: boolean;
  canAccessMembers: boolean;
  canAccessRoles: boolean;
  canAccessGroups: boolean;
  canAccessAdminSettings: boolean;
  canAccessWiki: boolean;
  canAccessBacklog: boolean;
  canAccessMinutes: boolean;
  canAccessOrganization: boolean;
  wikiPermission: AccessLevel;
  backlogPermission: AccessLevel;
  minutesPermission: AccessLevel;
}
