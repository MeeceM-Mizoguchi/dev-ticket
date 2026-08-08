# ENHA2-032 タスク管理機能 設計書

作成日: 2026-08-08
分類: 新機能開発

---

## 0. 決定事項（ヒアリング結果）

| 論点 | 決定 |
|---|---|
| 共有範囲 | **両方**。プロジェクト紐付けは任意（`project_id` nullable の単一テーブル） |
| 既存「アクション」との関係 | **別立てで新規**。`action_memos` には一切触れない |
| 項目 | 担当者・期限・優先度・詳細メモ・チケット紐付け（＋共有） |
| ビュー | **リスト / かんばん / ガント** の3種 |

> 「最小構成（追加なし）」も選択されていたが、他3つと併記されていたためフル構成として設計する。
> ただし実装は §12 のとおり **リスト＋最小項目で1度動かしてから** 項目・ビューを足す順序にする。

---

## 1. ゴール

チケット管理とは別に、「未着手 / 進行中 / 完了」を管理できる軽量なタスクの箱をつくる。

- 個人の作業も、プロジェクトのチーム作業も、同じ画面・同じ操作で扱える
- タスク単位で他のメンバーに共有できる（プロジェクトに属さないタスクでも共有できる）
- リスト / かんばん / ガントで見方を切り替えられる
- チケットに紐付けて「このチケットに付随する作業」を表現できる

### 1-1. チケットとの違い（なぜ別機能なのか）

チケットは「スプリント → WBS番号 → レビュー → STG → UAT → リリース」という**開発フローの器**で、
10種のステータス・レビュー往復・工数実績・スキルレコメンドまで背負っている。
軽い作業をここに載せると、WBS採番もスプリント所属も強制されて重すぎる。

タスクは**3ステータスのみ・採番なし・スプリント不要**。この軽さが本機能の唯一の存在理由なので、
将来「タスクにもレビュー機能を」といった要望が来ても、原則として断るかチケット化で応じる。

### 1-2. 既存「アクション」（`action_memos`）との棲み分け

| | アクション（既存） | タスク（本機能） |
|---|---|---|
| 性格 | **受動的**。通知・議事録から拾って消化する短命メモ | **能動的**。自分で立てて計画・進捗管理する |
| 状態 | `is_done` の2値 | 未着手 / 進行中 / 完了 の3値 |
| 共有 | 不可（`user_name` で自分の分だけ） | 個人 / 指名共有 / プロジェクト全体 |
| 消え方 | チケットが closed 等になると**自動削除** | 手動削除のみ（完了しても残る） |
| 入口 | サイドバー「アクション」/ 議事録 | サイドバー「タスク」/ プロジェクトサブナビ |

`action_memos` は議事録のアクション項目・Topbar からの追加・記事エクスポートにまで
配線が伸びている（`MinutesPage` / `Topbar` / `articleExport`）。統合はその全部を壊すリスクがあるため、
**新テーブルで完全に独立させる**。既存コードの変更は §11 のとおり配線のみに留める。

---

## 2. スコープ外（明示的にやらないこと）

- タスクのレビュー依頼・承認フロー（チケットの役目）
- 工数見積 / 実績・スキルレコメンド連携（チケットの役目）
- サブタスクの多段ネスト。子チケットと同じく **1階層のみ**（子は子を持てない）
- コメントスレッド。詳細メモ（本文）1枚で足りる
- リアルタイム同期。本アプリは全機能が「マウント時 fetch ＋ ヘッダーの更新ボタン」で統一されており
  （`postgres_changes` の購読はコードベースに1つも無い）、ここだけ例外にしない
- タスク → チケット化。バックログが既にその役目を持つ（要望が出たら §14）

---

## 3. データモデル

### 3-1. 方針

**テーブル2つだけ。`organization_id` は持たない。**

組織スコープは `owner_id`（＝`auth.uid()`）と `project_id` から一意に決まるので、列を増やす必要がない。
むしろ `organizations.id` / `profiles.organization_id` は**環境によって uuid / text が揺れる**既知の問題があり
（`add_app_version.sql` が `::text` キャストで回避している）、新テーブルでその地雷を踏まないためにも持たせない。

### 3-2. `tasks`

```sql
create table if not exists tasks (
  id           uuid        primary key default gen_random_uuid(),

  -- 所有者。RLS の基点。profiles.id = auth.users.id
  owner_id     uuid        not null references profiles(id) on delete cascade,
  -- 表示用の作成者名（既存テーブルと同じく profiles.name を非正規化して持つ）
  created_by   text        not null default '',

  -- null = 個人タスク / 値あり = プロジェクトタスク（PJメンバー全員が見える）
  project_id   text        references projects(id) on delete cascade,

  -- サブタスクの親。null = 親タスク。1階層のみ。親を消したら子も消える
  parent_id    uuid        references tasks(id) on delete cascade,

  title        text        not null,
  description  text        not null default '',      -- RichEditor の HTML

  -- 分類。ticket_categories とは切り離した自由入力（個人タスクにも付けたいため）。
  -- 入力欄では既に使われている分類が候補(datalist)に出る
  category     text        not null default '',

  status       text        not null default 'todo'
                 check (status in ('todo','in-progress','done')),
  priority     text        not null default 'medium'
                 check (priority in ('high','medium','low')),

  -- 担当者は profiles.name。既存（sprint_tickets.assignee / action_memos.user_name）に合わせる
  assignee     text        not null default '',

  start_date   date,
  due_date     date,

  -- チケット紐付け。チケットが消えても タスクは残す（表示用に wbs を非正規化）
  ticket_id    text        references sprint_tickets(id) on delete set null,
  ticket_wbs   text        not null default '',

  -- かんばん列内・リストの並び。gap 方式（§6-4）
  sort_order   double precision not null default 0,

  completed_at timestamptz,                          -- done へ移った時刻
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_tasks_owner   on tasks(owner_id, status);
create index if not exists idx_tasks_project on tasks(project_id) where project_id is not null;
create index if not exists idx_tasks_ticket  on tasks(ticket_id)  where ticket_id  is not null;
create index if not exists idx_tasks_order   on tasks(status, sort_order);
```

**ステータス値は `'in-progress'`（ハイフン）**。`TicketStatus` / `BacklogStatus` が同じ綴りで、
`STATUS_META` 系のマップやフィルタ実装をそのまま流用できる。

### 3-3. `task_shares`

```sql
create table if not exists task_shares (
  task_id    uuid not null references tasks(id)    on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  can_edit   boolean not null default true,   -- false = 閲覧のみ共有
  created_at timestamptz not null default now(),
  primary key (task_id, profile_id)
);

create index if not exists idx_task_shares_profile on task_shares(profile_id);
```

担当者に指名した相手には、アプリ側で**自動的に共有行を1件入れる**（§5-2）。
これで「見えるかどうか」の判定経路が `owner / shares / project` の3つに固定され、増えない。

### 3-4. RLS（※ 再帰に注意）

`tasks` のポリシーが `task_shares` を見て、`task_shares` のポリシーが `tasks` を見ると
**RLS が循環して 500 になる**（ENHA2-029 グループ通話で実際に踏んだ）。
両方向とも `security definer` 関数を挟んで RLS を迂回する。

```sql
-- 自分に共有されているか（task_shares の RLS を経由しない）
create or replace function is_task_shared_with_me(p_task_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.task_shares s
    where s.task_id = p_task_id and s.profile_id = auth.uid()
  )
$$;

-- 自分が所有者か（tasks の RLS を経由しない）
create or replace function is_task_owner(p_task_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and t.owner_id = auth.uid()
  )
$$;

alter table tasks       enable row level security;
alter table task_shares enable row level security;

-- 参照: 所有者 / 共有された人 / プロジェクトメンバー
drop policy if exists "tasks_select" on tasks;
create policy "tasks_select" on tasks for select using (
  owner_id = auth.uid()
  or is_task_shared_with_me(id)
  or (project_id is not null and can_access_project(project_id))
);

-- 作成: 自分名義でのみ。PJタスクはそのPJにアクセスできる人だけ
drop policy if exists "tasks_insert" on tasks;
create policy "tasks_insert" on tasks for insert with check (
  owner_id = auth.uid()
  and (project_id is null or can_access_project(project_id))
);

-- 更新: 所有者 / 編集可で共有された人 / PJメンバー
drop policy if exists "tasks_update" on tasks;
create policy "tasks_update" on tasks for update using (
  owner_id = auth.uid()
  or exists (select 1 from task_shares s
             where s.task_id = tasks.id and s.profile_id = auth.uid() and s.can_edit)
  or (project_id is not null and can_access_project(project_id))
);

-- 削除: 所有者のみ（共有された人・PJメンバーは消せない）
drop policy if exists "tasks_delete" on tasks;
create policy "tasks_delete" on tasks for delete using (owner_id = auth.uid());

-- 共有行: 自分宛の行は読める。付け外しはタスク所有者のみ
drop policy if exists "task_shares_select" on task_shares;
create policy "task_shares_select" on task_shares for select using (
  profile_id = auth.uid() or is_task_owner(task_id)
);
drop policy if exists "task_shares_write" on task_shares;
create policy "task_shares_write" on task_shares for all
  using (is_task_owner(task_id)) with check (is_task_owner(task_id));
```

`can_access_project(text)` は **`add_knowledge_ai.sql` で作成済みの既存関数**をそのまま使う
（owner はフリーパス、それ以外は同一組織かつ `projects.members` に名前がある / admin・PM）。
新規に作らない。

> `tasks_update` の中の `task_shares` 参照だけは `exists` で直接書いている。ここは `tasks` の
> ポリシー内から `task_shares` を読む向きだが、`task_shares_select` が `tasks` を関数経由でしか
> 見ないため循環しない。読みやすさを優先してこの形にする。

### 3-5. マイグレーション運用

本リポジトリの慣例どおり `supabase/add_tasks.sql` の1ファイルにまとめ、**冪等**（`if not exists` /
`drop policy if exists`）に書く。Supabase Dashboard → SQL Editor で手動実行。

---

## 4. 型定義（`src/app/types.ts` に追記）

```ts
export type TaskStatus = "todo" | "in-progress" | "done";

export interface TaskShare {
  profileId: string;
  name: string;        // 表示用（profiles.name を join して埋める）
  canEdit: boolean;
}

export interface Task {
  id: string;
  ownerId: string;
  createdBy: string;
  projectId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;          // 既存の "high" | "medium" | "low" を再利用
  assignee: string;
  startDate: string;           // "" = 未設定
  dueDate: string;
  ticketId: string | null;
  ticketWbs: string;
  sortOrder: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  shares: TaskShare[];         // 一覧では空配列、詳細で埋める
}

export type TaskView = "list" | "board" | "gantt";
export type TaskScope = "all" | "mine" | "shared" | "project";
```

`mappers.ts` に `mapTask` / `mapTaskShare` を追加（既存 mapper と同じ素朴な形）。

---

## 5. 可視性・権限

### 5-1. タスクの3つの状態

| 状態 | 条件 | 見える人 |
|---|---|---|
| 個人 | `project_id = null`、共有なし | 自分だけ |
| 指名共有 | `project_id = null`、`task_shares` あり | 自分＋指名された人 |
| プロジェクト | `project_id` あり | そのPJにアクセスできる人全員 |

UI では詳細パネルの「共有」欄でこの3状態を行き来する。プロジェクトを選ぶと
「このプロジェクトのメンバー全員に公開されます」と明示する。

### 5-2. 担当者を付けたら自動で共有する

担当者（`assignee`）に他人の名前を入れた瞬間、その人の `profile_id` で `task_shares` に
`can_edit = true` の行を upsert する。**個人タスクを他人に振ったのに相手から見えない**、という
一番起きやすい事故をここで潰す。プロジェクトタスクでは既に見えているので upsert は不要だが、
判定を分けるより常に upsert する方が単純なので常に入れる（重複は主キーで弾かれる）。

担当を外したときは共有行を消さない（意図的に共有を残したい場合があるため）。
共有解除は「共有」欄からの明示操作のみ。

### 5-2-2. サブタスクは親から可視性を継承する

サブタスクは**作った人が所有者**になる。ここで何もしないと、
「共有されたタスクにサブタスクを足したら、親の持ち主から見えない」が起きる。
そこで `createSubtask()` は作成直後に次を行う:

- `project_id` を親と同じにする（PJタスクの子は同じPJのメンバーに見える）
- 親の `task_shares` をそのまま子にもコピーする
- 自分が親の所有者でなければ、**親の所有者にも**共有を張る

親を消すと子も消える（`on delete cascade`）。子だけ残っても意味を成さないため。

なお、**サブタスクの完了と親の完了は連動させない**。子チケットのような
「子が終わるまで親を進められない」検証は入れない — 軽さがこの機能の存在理由なので、
親行に `2/3` の進捗を出すところまでに留める。

### 5-3. 権限（`UserPermissions`）との関係

タスクは**新しい権限フラグを増やさない**。理由:

- 個人タスクは誰でも作れて当然のもの
- プロジェクトタスクの可視性は `can_access_project` ＝既存のプロジェクトメンバーシップで足りる
- 権限を増やすと `RolesPage` / `PermissionsPage` / 全ロールのシード更新まで波及する

プランによるゲート（`plans.feature_*`）も**初期リリースでは入れない**。
必要になった時に `feature_tasks` を足す場所だけ §11 に記す。

---

## 6. 画面設計

### 6-1. 入口は2つ、中身は1つ

```
サイドバー「タスク」        → /tasks              … 横断ビュー（scope: all | mine | shared）
プロジェクトサブナビ「タスク」 → /:projectSlug/tasks … そのPJのタスクのみ（scope: project）
```

どちらも同じ `<TaskWorkspace scope={...} projectId={...} />` を描画する。
ページコンポーネント（`TasksPage` / `ProjectTasksPage`）は**取得条件を決めて渡すだけ**の薄い層にする。

`/:projectSlug/tasks` は静的セグメントなので、`AppRoutes` では
`/:projectSlug/:segment`（スプリント詳細）より**前に**置く（`/files` `/knowledge` と同じ扱い）。

### 6-2. 共通ヘッダー

```
[ タスク ]                                      [ + タスクを追加 ]
[ リスト | かんばん | ガント ]   [ 自分 / 共有された / すべて ]  [ PJ ▾ ] [ 担当 ▾ ] [ 完了を隠す ☐ ]  [ 🔍 ]
```

- ビュー切り替えはタブ。選択は `localStorage`（`dt.taskView.{scope}`）に保存
- **完了しても一覧から消さない。** 消すと「どれだけ片付いたか」が分からなくなる。
  完了行は**行まるごとグレーアウト**（`opacity` ＋ `grayscale`）してその場に残す。
  文字だけ打ち消し線にすると行の左右で密度がちぐはぐに見えるので、セル全部に同じ減光をかけ、
  操作できる部分（チェックボックスと「取り消す」）だけ素の色で残して押せることを示す。
  かんばんのカード・詳細パネルのサブタスク行も同じ扱いに揃える。
  溜まって邪魔になった人だけが「完了を隠す」を能動的に選ぶ（既定はOFF＝表示）
- 見出し脇に `完了 3/12` を出す（消さない方針と合わせて、消化量がひと目で分かるように）
- フィルタはすべてクライアント側。タスクは1人あたり数十〜数百件想定でサーバ絞り込みは要らない

### 6-3. 3つのビュー

**リスト**（既定・最軽量）

列見出しを持つ表。`タイトル / 分類 / プロジェクト / 優先度 / 担当者 / 開始日 / 期限 / ステータス`。
見出し・データ行・追加行は `TASK_COLS`（`TaskListView.tsx`）の**同じ幅定数**を使うので縦が揃う。
列幅を変えるときはここ1箇所を直せば3者すべてに効く。

サブタスクは親行の下にぶら下げる。親行の `▸` で開閉し、開いた中に「サブタスクを追加」の
入力行が生えている。**サブタスクが0件でも `▸` は押せる**（子持ちだけにすると最初の1件を
足す入口が無くなるため）。親行にはサブタスクの `2/3` 進捗を出す。
絞り込みで親が消えた子は最上位に出るが、`↳` を付けてサブタスクだと分かるようにする。

1行 = `[☑] ▸ タイトル  #WBS  担当  期限  [ステータス ▾]`。
チェックボックスは `todo ⇄ done` のトグル。ステータスは3値のプルダウン。
行クリックで右側の詳細パネルを開く。期限超過は日付を赤字＋淡赤背景。

**追加は表の最終行に直接入力する**（モーダルは使わない）。タスクは「思いついた瞬間に1行足す」
ものなので、開く・入力する・閉じるの往復を挟まない。最終行は常に入力可能な状態で置いてあり、
`Enter` で確定 → タイトルだけ空になってフォーカスが残るので、続けて何行でも打てる。
プロジェクト・担当者・優先度・期限・ステータスも同じ行のセルで指定できる。
ヘッダーの「タスクを追加」ボタンは、この追加行へフォーカスを飛ばすだけのショートカット
（ガント表示中に押されたらリストへ切り替える）。

**かんばん**

`未着手 | 進行中 | 完了` の3列。`react-dnd` + `HTML5Backend`。
`SprintBoardView.tsx` の `DropColumn` / `DragCard` の構造をほぼそのまま写す。
各列の末尾にも追加欄を置き、その列のステータスで1件足せるようにする（リストの追加行と同じ思想）。

> **注意**: `SprintBoardView` / `ProjectBoard` は各自が `<DndProvider>` を持っている。
> `TaskBoardView` も自前で持つ。HTML5Backend は入れ子にすると例外を投げるので、
> 「タスクのボードを他のボードの中に描かない」ことだけ守れば良い（現状そうなる導線は無い）。

**ガント**

`start_date 〜 due_date` の横棒。`SprintGanttView` は `Sprint` / `SprintTicket` 型に密結合しているため
**コンポーネントは新規作成**し、日付計算だけ既存の `daysBetween` / `formatDate`（`app/lib/helpers.ts`）を使う。
`DAY_W = 20`、左ペイン固定＋右スクロール、ヘッダー横スクロール同期という**レイアウトの作りは踏襲**する。

- 期間が未設定のタスクは「日付未設定」グループにまとめて先頭に出す（棒は描かない）
- グルーピングは「プロジェクトごと」。個人タスクは「プロジェクトなし」に入れる
- スプリント側のコードには**一切触れない**（回帰リスクを負わない）

### 6-4. 並び順（`sort_order`）

- 新規作成時: その列の最小値 − 1024（先頭に積む）
- D&D 時: 落とした位置の前後の `sort_order` の**中点**を採る。前後が無ければ ±1024
- 中点が縮退（差が 1e-6 未満）したらその列だけ 1024 刻みで採番し直す

`double precision` にしているのは、この中点方式で `update` 1行だけで済ませるため。
`sprint_orders` のような別テーブルは要らない。

### 6-5. 詳細パネル

既存の右スライドパネル（`TicketDetailPanel` の枠組み）を**そのまま真似た軽量版**を新規に作る。
`TicketDetailPanel` は 3000行級でチケット固有の処理だらけなので、流用ではなく参照に留める。

```
タイトル（インライン編集）
ステータス / 優先度 / 担当者
開始日 / 期限            … DatePicker（既存 shared）
プロジェクト             … 「なし」＋参加PJ一覧
関連チケット             … #WBS サジェスト（useLinkSuggestions）
サブタスク               … 一覧＋チェック＋追加（子を開いているときは代わりに「親タスク」を出す）
共有                     … メンバー追加（アバターチップ）／閲覧のみトグル
詳細メモ                 … RichEditor（既存 shared）
削除                     … 所有者のみ
```

---

## 7. データ取得と更新

### 7-1. 取得

マウント時に1回 fetch。`RefreshContext` の `refreshNonce` でページが再マウントされるため、
ヘッダーの更新ボタンにも自動で追随する（追加実装ゼロ）。

```ts
// 横断ビュー: RLS が見える範囲に絞ってくれるので、条件は「完了の出し分け」だけ
supabase.from("tasks").select("*").order("sort_order");

// プロジェクトビュー
supabase.from("tasks").select("*").eq("project_id", projectId).order("sort_order");
```

「自分 / 共有された」の切り分けは `owner_id === myProfileId` でクライアント判定する
（RLS が既に絞った結果に対する仕分けなので、追加クエリは不要）。

共有相手の名前は、詳細パネルを開いたときだけ
`task_shares` を `profiles(name)` 付きで引く（一覧では引かない）。

### 7-2. 更新

全操作を**楽観更新**にする。`setState` を先に当ててから `update` を投げ、失敗したら
`toast(..., "error")` を出して再 fetch で戻す。かんばんの D&D と
チェックボックスは即応性が体験を決めるので、ここは妥協しない。

`status` が `done` になったら `completed_at = now()`、`done` から戻したら `null` に戻す。
`updated_at` は毎回明示的に送る（既存コードと同じくトリガに頼らない）。

---

## 8. 通知

既存の経路（`notifications` テーブル insert ＋ `/api/slack-notify`）に相乗りする。
`whiteboardCommentNotify.ts` と同じ形で `taskNotify.ts` を新規に作る。

| きっかけ | 種別 | 宛先 |
|---|---|---|
| 自分以外を担当者に指名 | `assign` | 担当者 |
| 自分以外にタスクを共有 | `assign` | 共有先 |

- `NotificationType` は既存の `"assign"` を使う（`notifications.type` の check 制約を触らない）
- 飛び先は `mention_context` に `task:{taskId}` を入れ、`Topbar` が解釈して
  `/tasks?task={id}` へ遷移する（ホワイトボードの `whiteboard:{boardId}:{commentId}` と同じ流儀）
- 自分自身への操作では飛ばさない

---

## 9. 既存資産の流用

| 使うもの | 用途 |
|---|---|
| `can_access_project(text)`（既存SQL関数） | PJタスクの RLS |
| `SprintBoardView.tsx` の DnD 構造 | かんばんの雛形（コピーして改変） |
| `SprintGanttView.tsx` のレイアウト | ガントの雛形（型は流用不可、作りだけ踏襲） |
| `helpers.ts` の `daysBetween` / `formatDate` | ガントの日付計算 |
| `shared/RichEditor` `DatePicker` `CustomSelect` `DialogShell` `ConfirmDialog` `BtnSecondary` | フォーム部品一式 |
| `useLinkSuggestions` | `#WBS` チケットサジェスト |
| `ProjectSubNav` / `Sidebar` / `AppRoutes` | 導線 |
| `RefreshContext` / `ToastContext` / `PreviewPanelContext` | 更新・トースト・プレビュー |
| `notifications` ＋ `/api/slack-notify` | 通知（新テーブル・新API不要） |

**新規に増やす基盤はゼロ**。SQL 1ファイルと画面だけで完結する。

---

## 10. 新規ファイル

| ファイル | 内容 |
|---|---|
| `supabase/add_tasks.sql` | `tasks` / `task_shares` / RLS関数 / ポリシー / インデックス |
| `src/app/lib/taskService.ts` | CRUD・共有の upsert・`sort_order` 計算をまとめた薄い層 |
| `src/app/lib/taskNotify.ts` | アサイン／共有の通知（`notifications` ＋ Slack） |
| `src/app/pages/TasksPage.tsx` | 横断ビュー（scope: all/mine/shared） |
| `src/app/pages/ProjectTasksPage.tsx` | PJ別ビュー（scope: project） |
| `src/app/components/tasks/TaskWorkspace.tsx` | ヘッダー＋ビュー切替＋フィルタ＋状態管理の本体 |
| `src/app/components/tasks/TaskListView.tsx` | リスト |
| `src/app/components/tasks/TaskQuickAddRow.tsx` | 表の最終行の追加欄（モーダルの代わり） |
| `src/app/components/tasks/TaskBoardView.tsx` | かんばん（react-dnd） |
| `src/app/components/tasks/TaskGanttView.tsx` | ガント |
| `src/app/components/tasks/TaskDetailPanel.tsx` | 詳細パネル |
| `src/app/components/tasks/TaskShareField.tsx` | 共有メンバーの追加・削除 |

## 11. 既存ファイルの変更（配線のみ）

| ファイル | 変更 |
|---|---|
| `src/app/types.ts` | `Task` / `TaskShare` / `TaskStatus` / `TaskView` / `TaskScope` 追加、`Page` に `"tasks"` 追加 |
| `src/app/lib/mappers.ts` | `mapTask` / `mapTaskShare` 追加 |
| `src/app/components/layout/AppRoutes.tsx` | `/tasks` と `/:projectSlug/tasks` を追加（後者は `/:projectSlug/:segment` より前） |
| `src/app/components/layout/Sidebar.tsx` | `NAV_ITEMS` に「タスク」（`CheckSquare`）、`getActivePage` に `/tasks` 判定を追加 |
| `src/app/components/layout/ProjectSubNav.tsx` | `ProjectSubPage` に `"tasks"`、`ITEMS` に「タスク」を追加（権限キー無し＝PJメンバー全員） |
| `src/app/components/layout/Topbar.tsx` | お知らせの `mention_context` が `task:` なら `/tasks?task=` へ飛ばす |
| 各PJ配下ページ（Backlog/Wiki/Minutes/Files/Knowledge/Whiteboard/SprintDetail） | `ProjectSubNav` の `active` 型が広がるだけ。実質変更なし |

> プラン制御を入れる場合の唯一の追加点: `plans.feature_tasks` を足し、`PlanSettings` に
> `featureTasks` を追加して `Sidebar` と `ProjectSubNav` のフィルタに1行ずつ足す。
> 初期リリースでは入れない。

---

## 12. 実装順序

各ステップの終わりで `pnpm build`（＝`vite build`）が通ることを確認する。
**このリポジトリでは `tsc` 単体が通らないため、ビルドが唯一の型ゲート**である点に注意。

| # | 内容 | 完了の目安 |
|---|---|---|
| 1 | `add_tasks.sql` を書いて Supabase で実行。SQL Editor で 3パターン（個人/共有/PJ）の可視性を手検証 | 別ユーザーで `select` して見え方が期待どおり |
| 2 | `types.ts` / `mappers.ts` / `taskService.ts`（CRUD のみ） | ビルド通過 |
| 3 | `TaskWorkspace` ＋ `TaskListView` ＋ 新規作成 ＋ ステータス変更。`/tasks` だけ配線 | サイドバーからタスクを作って3状態を動かせる |
| 4 | `TaskDetailPanel`（担当・期限・優先度・メモ）＋ `TaskShareField`（共有・自動共有） | 他ユーザーで共有タスクが見える |
| 5 | `/:projectSlug/tasks` ＋ `ProjectSubNav` 配線 ＋ PJフィルタ | PJタスクがPJメンバーに見える |
| 6 | `TaskBoardView`（かんばん＋D&D＋`sort_order`） | 列間D&Dでステータスが変わり、順序が保存される |
| 7 | `TaskGanttView` | 期間ありタスクが棒で出る／未設定が先頭に出る |
| 8 | チケット紐付け（`#WBS` サジェスト）＋ `taskNotify` ＋ Topbar 着地 | 通知から該当タスクが開く |

ステップ3で一度**動くものを触れる状態**にしてから残りを積む。
かんばん・ガントは体験の要だが、無くても機能としては成立するので後段に置く。

---

## 13. リスクと注意点

| リスク | 対処 |
|---|---|
| **RLS の循環で 500**（ENHA2-029 で実際に発生） | `tasks ⇄ task_shares` を `security definer` 関数で切る（§3-4）。マイグレーション直後に必ず別ユーザーで select して確認する |
| `organizations.id` の uuid/text 型ゆれ | `tasks` に `organization_id` を持たせない設計で回避（§3-1） |
| 個人タスクを他人に振ったのに見えない | 担当者指名で `task_shares` を自動 upsert（§5-2） |
| `ProjectSubNav` の型変更が7ページに波及 | 型が広がるだけで既存分岐は不変。ステップ5でまとめてビルド確認 |
| `/:projectSlug/tasks` が スプリント詳細に食われる | `AppRoutes` の配列順で `/:projectSlug/:segment` より前に置く（`/files` と同じ） |
| `DndProvider` の入れ子で例外 | タスクのボードを他ボード内に描かない。導線上そうならないことをレビューで確認 |
| 完了タスクが溜まって一覧が重い | 既定で完了を隠す。1万件規模になったら `status != 'done'` をサーバ側条件に落とす（後日で足りる） |
| チケット削除時のリンク切れ | `on delete set null` ＋ `ticket_wbs` を非正規化保持。表示は「(削除済) TKT-012」 |

---

## 14. 残論点（実装前に決めたいもの）

1. **完了タスクの自動アーカイブ** — 完了から30日で自動的に隠す（削除はしない）を入れるか。
   入れるなら `completed_at` があるのでクライアント判定だけで済む。**推奨: 初期は入れない**
2. **ダッシュボードへの表示** — 「自分の未完了タスク」ウィジェットを `Dashboard` に出すか。
   出すなら本設計に加えて `Dashboard.tsx` の変更が1箇所増える。**推奨: 別チケットに切る**
3. **繰り返しタスク** — 「毎週月曜」のような定期タスク。テンプレート＋生成バッチが必要で
   規模が跳ねる。**推奨: 明確にスコープ外**
4. **タスク → チケット化** — バックログと役割が重なる。要望が出るまで実装しない
