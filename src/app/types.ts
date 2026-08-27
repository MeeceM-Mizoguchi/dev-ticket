export type Page = "login" | "dashboard" | "projects" | "clients" | "members" | "sprint" | "permissions" | "roles" | "admin-settings" | "my-actions" | "tasks" | "release-notes" | "organization" | "announcement-settings" | "reports";

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
  organization_id?: string | null;
  organizationId?: string | null;
}
export type ProjectStatus = "planning" | "in-progress" | "completed" | "on-hold";
export type TicketStatus = "todo" | "in-progress" | "in-review" | "review-done" | "stg-test" | "uat" | "done" | "closed" | "waiting-release" | "released" | "on-hold" | "withdrawn";
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
  // クローズ日時。mapSprintTicket が closed_at から詰めている（完了とみなす日時は closedAt || releasedAt）
  closedAt?: string | null;
  // リリースノート用フィールド
  releaseDate?: string | null;
  isReleaseDateUndecided?: boolean;
  // 対応完了時の手動工数入力
  actualWorkHours?: number | null;
  // 動作確認チェック
  isOperationVerified?: boolean;
  // PR未紐付けアラートを出さない（PR不要と人が確定したチケット）。
  // アラート自体は「リリース待ち以降 かつ 関連PR0件」から導出するので、この値は抑止だけを担う
  prLinkWaived?: boolean;
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

// ── BRU9-041 スキル更新の履歴・復元 ──
// 差分ログ方式。変更があった行だけを1件1行で残し、任意時点の状態を再構成できるようにする。
//   seed    = 履歴機能の導入時点（再構成の床）
//   auto    = 夜間バッチ ①スキル分析
//   manual  = 人がスキル編集モーダルで保存した
//   restore = 過去の時点へ戻した
export type SkillUpdateKind = "seed" | "auto" | "manual" | "restore";
export type SkillChangeType = "added" | "level_changed" | "removed" | "source_changed";

export interface SkillUpdateRunSummary {
  added?: number; updated?: number; removed?: number; changed?: number;
  members?: number; skillDeleted?: string; note?: string;
}

export interface SkillUpdateRun {
  id: string;
  organizationId: string;
  kind: SkillUpdateKind;
  actorProfileId: string | null;   // manual/restore は操作者。auto/seed は null
  targetProfileId: string | null;  // 特定メンバーだけを対象にした run
  restoredFromAt: string | null;   // restore のとき、どの時点に戻したか
  summary: SkillUpdateRunSummary;
  createdAt: string;
}

export interface MemberSkillChange {
  id: number;
  runId: string;
  organizationId: string;
  profileId: string;
  skillId: string;
  changeType: SkillChangeType;
  oldLevel: number | null;
  newLevel: number | null;
  oldSource: string | null;
  newSource: string | null;
  evidence: SkillEvidence;
  changedAt: string;
}

/**
 * 夜間バッチ1回分の実行ログ（メンバー画面の「学習ログ」タブ）。
 *
 *   completed … ①スキル分析も②モデル学習も走りきった
 *   failed    … どちらかが落ちた（summary にエラー内容）
 *   not_run   … 学習条件を満たさず②が実行されなかった（summary に理由）
 *   missing   … その日の記録自体が無い＝バッチが起動しなかった。
 *               DBには行が無いので画面側で日付の穴を検出して合成する。
 */
export type MlBatchResult = "completed" | "failed" | "not_run" | "missing";
export type MlBatchTrigger = "daily" | "deploy" | "manual";

/**
 * BRU10-062 メンバー個別の実行結果。
 *   updated   … このメンバーのスキルが変わった
 *   unchanged … 対象だったが判定結果が前回と同じ（＝変更履歴には残らない）
 *   excluded  … 対象外（スキル自動更新OFF など）
 */
export type MlBatchMemberStatus = "updated" | "unchanged" | "excluded";

export interface MlBatchMemberChange {
  skill: string;
  changeType: SkillChangeType;
  oldLevel: number | null;
  newLevel: number | null;
}

export interface MlBatchMemberRun {
  status: MlBatchMemberStatus;
  changedCount: number;
  evaluatedSkills: number;
  matchedTickets: number;
  protectedSkills: number;
  reason: string | null;
  changes: MlBatchMemberChange[];
}

export interface MlBatchRun {
  id: string;
  organizationId: string;
  batchId: string;
  trigger: MlBatchTrigger;
  startedAt: string;
  finishedAt: string | null;
  result: MlBatchResult;
  summary: string;
  detail: Record<string, unknown>;
  skillRunId: string | null;
  /**
   * そのメンバーがこの実行でどう扱われたか。
   * メンバー個別に開いたときだけ入る（組織全体の一覧では null）。
   * 記録が始まる前の日や、組織ごとスキップした晩も null になる。
   */
  member?: MlBatchMemberRun | null;
}

/** 復元プレビュー（restore_member_skills の dry run）の1行 */
export interface SkillRestoreChange {
  skillId: string;
  changeType: SkillChangeType;
  oldLevel: number | null;
  newLevel: number | null;
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
  parentId?: string | null;
  isFolder?: boolean;
}
export interface Sprint {
  id: string; projectId: string; name: string; goal: string;
  status: SprintStatus; startDate: string; endDate: string;
  tickets: SprintTicket[]; identifier: string;
  isManualStatus?: boolean;
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
  isManualStatus?: boolean;
  // GitHub連携（docs/github-integration-design.md）。インストールは組織単位のため
  // ここにはリポジトリの割り当てだけを持つ。
  githubRepoFullName?: string | null;
  githubDefaultBranch?: string | null;
  githubEnabled?: boolean;
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
  organizationId?: string | null;
}
export interface GroupProjectPermission {
  group_id: number; project_id: string; permission_type: PermissionType;
}
export type BacklogStatus = "open" | "in-progress" | "converted" | "archived";
export interface BacklogItem {
  id: string; projectId: string; title: string; description: string;
  /** 階層フォルダ（Wikiと同仕様）。NULL = ルート直下 */
  parentId: string | null;
  /** true のときはフォルダ行。description/priority などの列は使わない */
  isFolder: boolean;
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
// ── ENHA2-032 タスク管理 ──
// チケット(sprint_tickets)とは別の軽量タスク。未着手/進行中/完了の3状態だけを扱う。
// projectId が null なら個人タスク、値があればプロジェクト共有タスク。
// 個人タスクでも shares に載せた相手には見える（担当者に指名すると自動で入る）。
export type TaskStatus = "todo" | "in-progress" | "done";
/** 一覧の絞り込み。project は「そのPJのタスクだけ」を出す専用ページで使う */
export type TaskScope = "all" | "mine" | "shared" | "project";
export type TaskView = "list" | "board" | "gantt";

export interface TaskShare {
  profileId: string;
  /** 表示用。profiles を引けなかった場合は空文字 */
  name: string;
  canEdit: boolean;
}

export interface Task {
  id: string;
  ownerId: string;
  createdBy: string;
  projectId: string | null;
  /** サブタスクの親。null = 親タスク。子チケットと同じく現在は1階層のみ */
  parentId: string | null;
  title: string;
  description: string;
  /**
   * 分類。チケットの TicketCategory とは別の自由入力（個人タスクにも付けられるように）。
   * 複数付けられる。過去に使った値が入力中の候補に出る
   */
  categories: string[];
  status: TaskStatus;
  priority: Priority;
  /**
   * 進捗率（0〜100）。手入力で、ステータスとは連動しない
   * （チケットの progress はステータスから自動で決まるが、こちらは自分で書き込む）
   */
  progress: number;
  assignee: string;
  startDate: string;          // "" = 未設定
  dueDate: string;
  ticketId: string | null;
  ticketWbs: string;
  sortOrder: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 一覧では空配列。詳細を開いたときだけ埋める */
  shares: TaskShare[];
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
  /** 階層フォルダ（Wikiと同仕様）。NULL = ルート直下 */
  parentId: string | null;
  /** true のときはフォルダ行。content/attendees などの列は使わない */
  isFolder: boolean;
  sortOrder: number;
  attendees: string[]; content: string;
  images: string[];
  createdBy: string; createdAt: string; updatedAt: string;
}
export interface Whiteboard {
  id: string; projectId: string; title: string;
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string;
  /** 'project'=PJメンバーが見られる（既定） / 'private'=作成者だけが見られる */
  visibility: "project" | "private";
  /** プライベート所有者のuserId。公開時は "" */
  privateBy: string;
  /** Realtimeチャンネル名に混ぜる秘密トークン（RLSで所有者以外には見えない）。公開時は "" */
  privateKey: string;
}
// ── ナレッジノート（プロジェクト単位の資料の保管・閲覧・検索） ──
// 表示名は「ナレッジノート」。内部識別子は knowledge_ に統一する。
// 回答生成はしない。見出しを辿って読む／該当箇所を探すまでが責務。
/** 資料を種類で仕分けるフォルダ。階層は1段のみ */
export interface KnowledgeFolder {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  projectId: string;
  /** null = 未分類 */
  folderId: string | null;
  title: string;
  fileName: string;
  content: string;          // 原文。表示とハイライトに使う
  contentHash: string;
  byteSize: number;
  tags: string[];
  chunkCount: number;
  indexedAt: string | null; // null = ベクトル未生成（キーワード検索のみ効く）
  embeddingModel: string;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 検索の実体。原文の断片。content は原文の [charStart, charEnd) と完全に一致する */
export interface KnowledgeChunk {
  id: string;
  documentId: string;
  projectId: string;
  seq: number;
  headingPath: string;      // 「3. インフラ > 3-3. セッション共有」
  content: string;
  charStart: number;
  charEnd: number;
}

export interface KnowledgeSearchHit {
  chunkId: string;
  documentId: string;
  title: string;
  headingPath: string;
  content: string;
  charStart: number;
  charEnd: number;
  score: number;
  vecScore: number;   // 意味の近さ 0〜1
  kwScore: number;    // 語句の一致度 0〜1
}

/** 取り込み処理の進捗。UI のプログレス表示に使う */
export type KnowledgeImportPhase =
  | "reading" | "chunking" | "saving" | "modelLoading" | "embedding" | "done" | "error";

export interface KnowledgeImportProgress {
  phase: KnowledgeImportPhase;
  fileName: string;
  done: number;
  total: number;
  message?: string;
}

export interface TicketItem {
  id: string; title: string; project: string; status: TicketStatus;
  priority: Priority; assignee: string; dueDate: string;
}
export type AccessLevel = "none" | "view" | "edit";

// GitHub連携の権限（docs/github-integration-design.md 5-1）。
// 「閲覧」と「マージ」をboolean2つに分けると「マージ可・閲覧不可」という
// 矛盾した組み合わせが作れてしまうため、単一の3段階で持つ。
export type GithubAccessLevel = "none" | "view" | "merge";

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
  featureKnowledgeAi: boolean;
  featureGithub: boolean;
  maxKnowledgeDocsPerProject: number | null;
}

export interface UserPermissions {
  canCreateTicket: boolean;
  canCreateSprint: boolean;
  canCreateProject: boolean;
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
  githubPermission: GithubAccessLevel;
}

// ── GitHub連携 ───────────────────────────────────────────────────────────────

export interface GithubUnclaimedInstallation {
  id: string;
  accountLogin: string;
  accountType: string;
  repoSelection: string;
}

/** インストールに足りていない GitHub App の権限（1件） */
export interface GithubMissingPermission {
  /** GitHub API 上のキー（contents / pull_requests など） */
  key: string;
  /** GitHub の設定画面に出ている表示名 */
  label: string;
  /** 必要なレベル（"Read" / "Read & write"） */
  need: string;
  /** 今付いているレベル。付いていなければ "なし" */
  current: string;
  /** 何に使う権限か */
  why: string;
}

/**
 * 権限不足で操作が止まっている状態。
 *
 * 「App の設定そのものが足りない（scope=app）」と
 * 「設定は足りていて承認がまだ（scope=install）」は直しに行く画面が違う。
 * どちらかを断定せずに案内すると、案内どおりに操作しても直らないため必ず分ける。
 */
export interface GithubPermissionBlock {
  /** "repo" は権限ではなくリポジトリ側（ブランチ保護など）で拒否された場合 */
  scope: "app" | "install" | "repo";
  operation: "merge" | "create-pull" | "review";
  missing: GithubMissingPermission[];
  /** 直しに行くGitHubの画面。分からなければ null */
  fixUrl: string | null;
  /** そのまま画面に出せる日本語 */
  message: string;
}

/** GET /api/github/status の戻り。画面のセットアップ状態の判定に使う。 */
export interface GithubStatus {
  /** サーバーに GitHub App の環境変数が入っているか */
  appConfigured: boolean;
  /** GITHUB_APP_VISIBILITY。説明文の出し分けにだけ使う */
  visibility: "private" | "public";
  /** App ID と秘密鍵の組み合わせが GitHub に通るか（接続前の自己診断） */
  appAuthOk: boolean;
  appAuthError: string | null;
  /** 鍵が読めないときの切り分け用（値そのものは含まない） */
  appKeyShape: string | null;
  appSlugMismatch: string | null;
  /** GitHub側にインストール済みだが、どの組織にも記録されていないもの（復旧用の候補） */
  unclaimedInstallations: GithubUnclaimedInstallation[];
  /**
   * インストールに足りていない App の権限。
   * 空でなければ、その権限を使う操作（マージなど）は実行しても必ず失敗する。
   */
  missingPermissions: GithubMissingPermission[];
  /**
   * 不足がどちら側にあるか。null なら不足なし。
   *   "app"     … App の設定そのもの。インストール画面で承認しても直らない
   *   "install" … 宣言は足りていて、承認がまだ
   */
  permissionScope: "app" | "install" | null;
  /** App の権限設定ページ（App の所有者だけが開ける） */
  appPermissionsUrl: string | null;
  /** 組織にインストール済みか */
  installed: boolean;
  /** GitHub側でアンインストールされている等、トークンが使えない状態 */
  revoked: boolean;
  accountLogin: string | null;
  accountType: string | null;
  repoSelection: string | null;
  connectedAt: string | null;
  connectedByName: string | null;
  repoCount: number | null;
  /** GitHub の設定画面（リポジトリの追加・変更用） */
  manageUrl: string | null;
}

export interface GithubRepo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

export interface GithubUserRef {
  login: string;
  avatarUrl: string;
}

export type GithubCheckState = "success" | "failure" | "pending" | "none";
export type GithubReviewState = "approved" | "changes_requested" | "pending";

export interface GithubPull {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  user: GithubUserRef;
  base: string;
  head: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  /** 一覧では取れないため詳細取得後にだけ入る */
  mergeable?: boolean | null;
  mergeableState?: string | null;
  checkState: GithubCheckState;
  checkSummary: string;
  reviewState: GithubReviewState;
  reviewSummary: string;
  body?: string;
  changedFiles?: number;
  additions?: number;
  deletions?: number;
  checks?: { name: string; state: GithubCheckState }[];
  /** ブランチ名・タイトルから拾ったWBS番号（大文字に正規化済み） */
  detectedWbs: string[];
  /** 正規化したWBS番号 → 実際に書かれていた綴り。大文字小文字の食い違いの表示に使う */
  detectedSpellings?: Record<string, string>;
  /** 自動検出の根拠（ブランチ名 / タイトル） */
  autoReason?: string | null;
}

export interface GithubIssue {
  number: number;
  title: string;
  url: string;
  state: string;
  user: GithubUserRef;
  createdAt: string;
  labels: string[];
  comments: number;
}

export interface GithubCommit {
  sha: string;
  message: string;
  url: string;
  authorName: string;
  authorLogin: string | null;
  avatarUrl: string | null;
  date: string;
}

export interface GithubBranch {
  name: string;
  protected: boolean;
  isDefault: boolean;
  lastCommitSha: string;
}

/** まだプルリクエストが作られていないブランチ */
export interface GithubPendingBranch {
  name: string;
  sha: string;
  /** 最終コミットの1行目。GraphQL が使えない環境では空 */
  message: string;
  /** 最終コミットの日時。取得できない環境では null */
  committedDate: string | null;
  authorName: string;
  /** ブランチ名から拾った WBS 番号 */
  wbs: string | null;
  ticketTitle: string | null;
}

export interface TicketGithubLink {
  id: number;
  projectId: string;
  ticketId: string;
  kind: "pull" | "issue";
  number: number;
  title: string | null;
  state: string | null;
  url: string | null;
  autoLinked: boolean;
  /** 自動検出の根拠（ブランチ名 / タイトル）。人が誤検出を判断できるようにする */
  autoReason?: string | null;
  /** 表示用。内部IDではなくWBS番号を出すためにサーバーで引き直したもの */
  ticketWbs?: string | null;
  ticketTitle?: string | null;
}

/**
 * 大文字小文字だけが違う綴りが混ざっていて、自動では紐付けなかったPR。
 * どれが正しいかは人にしか決められないので、チケット詳細で選ばせる。
 */
export interface TicketGithubLinkCandidate {
  id: number;
  ticketId: string;
  /** 突き合わせに使ったWBS番号（大文字に正規化済み） */
  wbsKey: string;
  kind: "pull" | "issue";
  number: number;
  /** このPRのブランチ名／タイトルに実際に書かれていた綴り */
  spelling: string | null;
  title: string | null;
  state: string | null;
  url: string | null;
  autoReason: string | null;
}

export type GithubMergeMethod = "merge" | "squash" | "rebase";

/** まとめてマージの結果。1件ごとに成否を返す */
export interface GithubBulkMergeResult {
  ok: true;
  merged: number;
  failed: number;
  /** 失敗を受けて途中で打ち切ったかどうか */
  aborted?: boolean;
  results: { number: number; ok: boolean; title: string; sha?: string | null; error?: string; skipped?: boolean }[];
  /** 権限で止まったときだけ入る。直しに行く画面を結果画面から出すために使う */
  permission?: GithubPermissionBlock;
}

/** マージ前のコンフリクトチェックの結果（1件ごと） */
export interface GithubMergePrecheckRow {
  number: number;
  title: string;
  ok: boolean;
  /** コンフリクトが理由かどうか。CI・レビュー待ちと区別して案内するために持つ */
  conflict: boolean;
  reason?: string;
}

/**
 * マージ前のコンフリクトチェックの結果。
 * ok が false なら1件もマージしない（BRU13-038）
 */
export interface GithubMergePrecheckResult {
  ok: boolean;
  conflicts: number;
  blocked: number;
  results: GithubMergePrecheckRow[];
}

/** リリース待ち → リリース済み の自動反映の結果 */
export interface GithubReleaseSyncResult {
  ok: true;
  /** リリース済みにしたチケットの総数 */
  released: number;
  details: {
    projectId: string;
    projectName: string;
    released: { wbs: string; title: string; pulls: number[] }[];
    error?: string;
  }[];
}
