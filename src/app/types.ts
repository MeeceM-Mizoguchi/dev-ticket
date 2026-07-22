export type Page = "login" | "dashboard" | "projects" | "clients" | "members" | "sprint" | "permissions" | "roles" | "admin-settings" | "my-actions" | "release-notes" | "organization" | "announcement-settings" | "reports";

export interface AnnouncementItem {
  imageUrl: string;
  description: string;
}

export interface Announcement {
  id: string;
  orgId: string;
  title: string;
  items: AnnouncementItem[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  isSystemAdmin?: boolean;   // システム管理会社(Meece)フラグ
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
  // チケットプレフィックス（最大3つ）
  prefixes?: string[];
  // 開発規模。工数(時間)とは別軸の「難易度・広がり」。レコメンドの特徴量に使う。
  devScale?: DevScale | null;
}

// ── ENHA2-034 スキル＆担当者レコメンドAI ──
// スキルは「レイヤー(固定6種) → その配下にスキル名＋レベル1〜4」の2階層。
export type SkillLayer = "frontend" | "backend" | "infra" | "design" | "qa" | "other";
// レベルは所要時間・難易度ベースで定義する（既存チケットの工数と直結させ、実績から自動判定するため）。
//   1: 簡単なものであればできる（15分〜30分）
//   2: 少し難しいものならできる（1時間〜3時間）
//   3: 普通（バックエンドも考慮したI/Fまでできる）
//   4: リーダークラス（ほぼなんでもできる）
export type SkillLevel = 1 | 2 | 3 | 4;
export type DevScale = "S" | "M" | "L" | "XL";

export interface Skill {
  id: string;
  organizationId: string;
  layer: SkillLayer;
  name: string;
  keywords: string[];   // チケット文章からこのスキルを自動検出するための手がかり
  sortOrder: number;
}

// レベル判定の根拠。人が納得して確認・修正できるように保持する。
export interface SkillEvidence {
  doneCount?: number;       // そのスキルの完了チケット数
  avgHours?: number;        // 平均実績工数
  maxHours?: number;        // 安定してこなせた最大工数帯
  reviewCount?: number;     // 他人のチケットをレビュー・承認した回数（Lv4判定の決め手）
  onTimeRate?: number;      // 納期遵守率
}

export interface MemberSkill {
  profileId: string;
  skillId: string;
  level: SkillLevel;
  source: "auto" | "manual";  // auto=①スキル分析が判定 / manual=人が設定（①は上書きしない）
  evidence: SkillEvidence;
  updatedAt: string;
}

export interface TicketRequiredSkill {
  ticketId: string;
  skillId: string;
  importance: 1 | 2 | 3;  // 3=必須 / 2=推奨 / 1=あれば尚可
}

// 担当者レコメンドの1候補
export interface AssigneeRecommendation {
  profileId: string;
  name: string;
  score: number;          // 0〜1
  reasons: string[];      // 「この領域12件完了・平均2.1h」など、なぜ推されたかの説明
  skillMatch: number;     // 必要スキルの充足度 0〜1
  workload: number;       // 現在の進行中チケット数（モデル特徴量互換のため維持）
  activeCount: number;    // 稼働中の担当数（未着手〜作業途中。クローズ/完了/保留/取下は除く）。推奨判定と表示に使う
  source: "model" | "baseline";  // 学習済みモデル / ルールベース（モデル未成熟時のフォールバック）
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

// ── ENHA2-035 ファイルボックス ──
// 非公開バケット(project-files)に置くため公開URLは持たない。
// 表示・DLのたびに api/project-files/signed-url で短命の署名付きURLを発行する。
export interface ProjectFile {
  id: string; projectId: string; folderPath: string;
  fileName: string; fileSize: number; fileType: string;
  filePath: string; version: number;
  uploadedBy: string; createdAt: string;
}
export interface Sprint {
  id: string; projectId: string; name: string; goal: string;
  status: SprintStatus; startDate: string; endDate: string;
  tickets: SprintTicket[]; identifier: string;
}
export interface EnvMemo {
  name: string;
  url: string;
  memo?: string;
}
export interface Project {
  id: string; slug: string; wbsPrefix: string;
  name: string; client: string; status: ProjectStatus;
  startDate: string; endDate: string; members: string[]; groupIds: number[];
  done: number; inProgress: number; todo: number; description: string;
  envMemos: EnvMemo[];
  tags: string[];
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
  // ★ONのメンバーだけ①スキル分析が member_skills を自動更新する。
  //   OFFでも②レコメンドの対象からは外さない（手動スキル＋実績で推薦される）。
  skillAutoUpdate?: boolean;
  mlNoticeDismissed?: boolean;
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
export interface Whiteboard {
  id: string; projectId: string; title: string;
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string;
}
export interface TicketItem {
  id: string; title: string; project: string; status: TicketStatus;
  priority: Priority; assignee: string; dueDate: string;
}
export type AccessLevel = "none" | "view" | "edit";

export interface PlanSettings {
  id: string;
  name: string;
  isSystem: boolean;
  accountExpiresAt: string | null;
  maxMembers: number | null;
  maxProjects: number | null;
  maxSprintsPerProject: number | null;
  maxTicketsPerSprint: number | null;
  maxImagesPerItem: number | null;
  maxCommentsPerTicket: number | null;
  maxFiltersPerSprint: number | null;
  featureNotifications: boolean;
  featureCsvExport: boolean;
  featureActualMonitor: boolean;
  featureChildTickets: boolean;
  featureBulkCreate: boolean;
}

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
  canUpdateAnnouncement: boolean;
  canAccessReports: boolean;
  wikiPermission: AccessLevel;
  backlogPermission: AccessLevel;
  minutesPermission: AccessLevel;
  whiteboardPermission: AccessLevel;
}
