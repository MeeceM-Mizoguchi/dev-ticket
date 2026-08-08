import type { ReactNode } from "react";
import {
  BookOpen, LogIn, UserPlus, LayoutDashboard, Columns, PlayCircle, Pencil,
  MessageSquare, GitBranch, GitPullRequest, ClipboardCheck, ClipboardList, CalendarCheck, Undo2, FilePlus2,
  type LucideIcon,
} from "lucide-react";
import { REQ, type Requirement } from "./manualPermissions";
import { ScreenFrame } from "./components/ScreenFrame";
import { Spotlight, type Rect } from "./components/Spotlight";
// マニュアル専用モック
import { ScreenLogin } from "./screens/ScreenLogin";
import { ScreenInvite } from "./screens/ScreenInvite";
import { ScreenTicketDialog } from "./screens/ScreenTicketDialog";
import { ScreenTicketDetail } from "./screens/ScreenTicketDetail";
import { ScreenComments } from "./screens/ScreenComments";
import { ScreenCompletionOverlay } from "./screens/ScreenCompletionOverlay";
import { ScreenSprintViews } from "./screens/ScreenSprintViews";
// 既存LP資産の流用
import { MockDashboard } from "@/app/components/lp/mocks/MockDashboard";

// ── 台帳の型 ──
export interface ManualStepDef {
  title: string;
  description: string;
  requirement?: Requirement; // 未指定＝全ユーザー
  screen?: () => ReactNode;
}
export interface ManualChapterDef {
  slug: string;
  title: string;
  icon: LucideIcon;
  intro?: string;
  steps: ManualStepDef[];
}
export interface ManualCategoryDef {
  id: string;
  emoji: string;
  title: string;
  chapters: ManualChapterDef[];
}

// ── 画面＋強調のヘルパー ──
// spot は target（data-spot セレクタ・推奨）か rect（% 指定・LPモック流用時のみ）で指定。
interface SpotDef {
  target?: string;
  rect?: Rect;
  label?: string;
  labelPos?: "top" | "bottom" | "left" | "right";
  shape?: "rect" | "circle";
  dim?: boolean;
}
function frame(node: ReactNode, spots: SpotDef[] = [], aspect = "16 / 9", maxWidth?: number) {
  // 全画面を 16:9 の横長・同一幅に統一。
  const mw = maxWidth ?? 1040;
  return (
    <ScreenFrame aspectRatio={aspect} maxWidth={mw}>
      {node}
      {spots.map((sp, i) => (
        <Spotlight key={i} target={sp.target} rect={sp.rect} label={sp.label} labelPos={sp.labelPos} shape={sp.shape} dim={sp.dim} />
      ))}
    </ScreenFrame>
  );
}
/** data-spot セレクタの短縮 */
const spot = (name: string) => `[data-spot='${name}']`;

// =====================================================================
// Part 1. はじめに
// =====================================================================
const INTRO: ManualCategoryDef = {
  id: "intro",
  emoji: "📗",
  title: "はじめに",
  chapters: [
    {
      slug: "getting-started",
      title: "Dev Ticketとは／できること",
      icon: BookOpen,
      intro: "Dev Ticket は、プロジェクト・スプリント・チケットを一元管理する開発チーム向けのツールです。まずは全体像をつかみましょう。",
      steps: [
        {
          title: "全体像を知る",
          description: "左のサイドバーから各機能へ移動し、中央に画面が表示されます。上部バーには検索・通知・ヘルプ・ユーザーメニューがあります。",
          screen: () => frame(<MockDashboard fillHeight />, [], "16 / 9"),
        },
      ],
    },
    {
      slug: "login",
      title: "ログインする",
      icon: LogIn,
      steps: [
        {
          title: "メールアドレスとパスワードを入力する",
          description: "ログイン画面で、登録済みのメールアドレスとパスワードを入力します。",
          screen: () => frame(<ScreenLogin />, [{ target: spot("credentials"), label: "ここに入力" }]),
        },
        {
          title: "ログインボタンを押す",
          description: "入力後、ログインボタンを押すとダッシュボードが表示されます。",
          screen: () => frame(<ScreenLogin />, [{ target: spot("login"), label: "クリック", labelPos: "right" }]),
        },
        {
          title: "生体認証でログインする（Mac / iPad）",
          description: "対応端末では、事前に登録しておけば生体認証だけでログインできます（登録方法は「生体認証を登録する」参照）。",
          screen: () => frame(<ScreenLogin />, [{ target: spot("biometric"), label: "生体認証" }]),
        },
      ],
    },
    {
      slug: "accept-invite",
      title: "招待を受けてアカウントを有効化する",
      icon: UserPlus,
      intro: "招待メールが届いたら、パスワードを設定してアカウントを有効化します。",
      steps: [
        {
          title: "パスワードを設定する",
          description: "招待メール内のURLを開き、8文字以上のパスワードを設定します。確認用にもう一度入力します。",
          screen: () => frame(<ScreenInvite />, [{ target: spot("pass"), label: "パスワードを設定" }]),
        },
        {
          title: "有効化する",
          description: "「設定して有効化する」を押すと、そのままログイン状態になります。",
          screen: () => frame(<ScreenInvite />, [{ target: spot("activate"), label: "クリック" }]),
        },
      ],
    },
    {
      slug: "screen-overview",
      title: "画面の全体構成を知る",
      icon: LayoutDashboard,
      steps: [
        {
          title: "左サイドバー（機能ナビ）",
          description: "各機能への入口です。アイコンにマウスを乗せると名称が表示されます。",
          screen: () => frame(<MockDashboard fillHeight />, [{ rect: { top: "3%", left: "1.5%", width: "8.5%", height: "93%" }, label: "機能ナビ", labelPos: "right" }], "16 / 9"),
        },
        {
          title: "上部バー",
          description: "検索・通知・お知らせ・ヘルプ・ユーザーメニューが並びます。",
          screen: () => frame(<MockDashboard fillHeight />, [{ rect: { top: "2.5%", left: "10%", width: "87%", height: "8.5%" }, label: "検索・通知・ユーザー" }], "16 / 9"),
        },
        {
          title: "メイン表示エリア",
          description: "選んだ機能の画面が表示されます。",
          screen: () => frame(<MockDashboard fillHeight />, [{ rect: { top: "14%", left: "10%", width: "87%", height: "81%" } }], "16 / 9"),
        },
      ],
    },
  ],
};

// =====================================================================
// チケットを作成する（作成・詳細編集・コメント・子チケット）
// =====================================================================
const CREATE: ManualCategoryDef = {
  id: "ticket-create",
  emoji: "📘",
  title: "チケットを作成する",
  chapters: [
    {
      slug: "create-ticket",
      title: "チケットを作成する",
      icon: FilePlus2,
      intro: "スプリントの「新規チケット」からチケットを作成します（複数まとめて作るなら「一括作成」）。",
      steps: [
        {
          title: "スプリントで「新規チケット」を押す",
          description: "スプリント一覧の各スプリント行にある「新規チケット」を押すと、作成フォームが開きます。",
          requirement: REQ.flag("canCreateTicket"),
          screen: () => frame(<ScreenSprintViews view="list" />, [{ target: spot("new-ticket"), label: "クリック", labelPos: "left" }]),
        },
        {
          title: "必要事項を入力して作成する",
          description: "チケット名（必須）・ステータス・優先度・分類・担当者・期間・詳細・ラベルを入力し、「作成する」を押します。詳細では @メンションや画像添付もできます。",
          requirement: REQ.flag("canCreateTicket"),
          screen: () => frame(<ScreenTicketDialog />, [{ target: spot("create"), label: "クリック" }]),
        },
      ],
    },
    {
      slug: "edit-detail",
      title: "チケットの詳細を編集する",
      icon: Pencil,
      intro: "作成したチケットを開くと右側に詳細パネルが表示されます。ここで内容を編集します。",
      steps: [
        {
          title: "各項目を編集する",
          description: "担当者・優先度・分類・期間・見積・進捗・詳細・ラベルを編集できます。期間を入れると見積工数が自動計算されます。",
          requirement: REQ.flag("canEditDelete"),
          screen: () => frame(<ScreenTicketDetail phase="edit" />, [{ target: spot("fields"), label: "各項目を編集" }]),
        },
      ],
    },
    {
      slug: "comments",
      title: "コメント・メンションでやり取りする",
      icon: MessageSquare,
      steps: [
        {
          title: "コメントを送信する",
          description: "詳細パネル下部のコメント欄から送信できます。画像添付も可能です。",
          screen: () => frame(<ScreenComments />, [{ target: spot("commentinput"), label: "コメント入力" }]),
        },
        {
          title: "@でメンバーをメンションする",
          description: "「@」を入力するとメンバー候補が表示され、選ぶと相手に通知が届きます。",
          screen: () => frame(<ScreenComments />, [{ target: spot("mention"), label: "@メンション候補", labelPos: "right" }]),
        },
      ],
    },
    {
      slug: "sub-ticket",
      title: "子チケットで作業を分解する",
      icon: GitBranch,
      steps: [
        {
          title: "「子チケット作成」を押す",
          description: "大きな作業は子チケットに分解できます。親チケットは子の最大ステータスまでしか進められません。",
          requirement: REQ.flag("canCreateTicket"),
          screen: () => frame(<ScreenTicketDetail phase="subticket" />, [{ target: spot("subticket"), label: "子チケット作成", labelPos: "left" }]),
        },
      ],
    },
  ],
};

// =====================================================================
// チケットを進める ― チケットの一生（工程を順に進める）
// =====================================================================
const LIFECYCLE: ManualCategoryDef = {
  id: "ticket-lifecycle",
  emoji: "📕",
  title: "チケットを進める（チケットの一生）",
  chapters: [
    {
      slug: "views",
      title: "3つのビューを使い分ける",
      icon: Columns,
      intro: "スプリントは「リスト」「ボード」「ガントチャート」の3つのビューで表示できます。画面右上のビュー切替ボタンで、目的に応じて切り替えましょう。",
      steps: [
        {
          title: "「リスト」ボタンをクリックする",
          description: "画面右上のビュー切替から「リスト」ボタンをクリックします。",
          screen: () => frame(<ScreenSprintViews view="list" />, [{ target: spot("tab-list"), label: "クリック" }]),
        },
        {
          title: "リストビューに切り替わる",
          description: "一覧（表）で表示されます。列フィルタやCSV出力ができ、チケットを細かく管理したいときに便利です。",
          screen: () => frame(<ScreenSprintViews view="list" />, []),
        },
        {
          title: "「ボード」ボタンをクリックする",
          description: "スプリント一覧の画面で、右上のビュー切替から「ボード」ボタンをクリックします。",
          screen: () => frame(<ScreenSprintViews view="list" />, [{ target: spot("tab-board"), label: "クリック" }]),
        },
        {
          title: "ボードビューに切り替わる",
          description: "ステータスごとの列（カンバン）で表示されます。カードをドラッグしてステータスを変更でき、進捗がひと目で分かります。",
          screen: () => frame(<ScreenSprintViews view="board" />, []),
        },
        {
          title: "「ガントチャート」ボタンをクリックする",
          description: "スプリント一覧の画面で、右上のビュー切替から「ガントチャート」ボタンをクリックします。",
          screen: () => frame(<ScreenSprintViews view="list" />, [{ target: spot("tab-gantt"), label: "クリック" }]),
        },
        {
          title: "ガントチャートビューに切り替わる",
          description: "開始日・終了日がタイムラインで表示され、期間や期限を把握しやすくなります。",
          screen: () => frame(<ScreenSprintViews view="gantt" />, []),
        },
      ],
    },
    {
      slug: "start",
      title: "チケットに着手する",
      icon: PlayCircle,
      intro: "「未着手」のチケットを「進行中」にして作業を始めます。",
      steps: [
        {
          title: "ボードでカードをドラッグする",
          description: "「未着手」のカードを「進行中」の列へドラッグすると着手状態になります。",
          requirement: REQ.flag("canEditDelete"),
          screen: () => frame(<ScreenSprintViews view="board" dragHint />, []),
        },
        {
          title: "または「着手開始」ボタンを押す",
          description: "チケット詳細を開き、「着手開始 →」ボタンを押すと進行中になります。ボタンは今のステータスに応じて1つだけ表示されます。",
          requirement: REQ.flag("canEditDelete"),
          screen: () => frame(<ScreenTicketDetail phase="start" />, [{ target: spot("action"), label: "クリック" }]),
        },
      ],
    },
    {
      slug: "review",
      title: "レビューを依頼する／承認・差し戻し",
      icon: GitPullRequest,
      intro: "実装が終わったら、チケット詳細の「レビュー」欄からレビューを依頼します。レビュアーが承認または差し戻し（修正依頼）を行う、というフローです。",
      steps: [
        {
          title: "レビュアーを選んで依頼を送る",
          description: "チケット詳細のレビュー欄でレビュアーを選び、確認してほしい内容を書いて「レビュー依頼を送信」を押します（画像・ファイル添付も可）。ステータスが「レビュー中」になります。",
          screen: () => frame(<ScreenTicketDetail phase="review" />, [{ target: spot("review"), label: "レビュー欄" }]),
        },
        {
          title: "レビュアーが承認／差し戻しする",
          description: "レビュアーは内容を確認し、問題なければ承認（→レビュー完了）、修正が必要なら差し戻し（修正依頼）します。差し戻された場合は担当者が直して再依頼します。",
          requirement: REQ.flag("canReview"),
          screen: () => frame(<ScreenTicketDetail phase="approve" />, [{ target: spot("review"), label: "承認 / 差し戻し" }]),
        },
        {
          title: "レビューをスキップする（権限がある場合）",
          description: "スキップ権限があれば、進行中のチケット詳細に「レビュースキップ →」が表示され、レビューを飛ばして次のステータスへ進めます。",
          requirement: REQ.flag("canSkipReview"),
          screen: () => frame(<ScreenTicketDetail phase="skip" />, [{ target: spot("skip"), label: "クリック" }]),
        },
      ],
    },
    {
      slug: "stg-uat",
      title: "STG・UATを完了する",
      icon: ClipboardCheck,
      intro: "レビューが完了したら、STG検証・UAT検証を経てステータスを進めます。ボタンは今のステータスに応じて順番に現れます。",
      steps: [
        {
          title: "「STG完了」を押す",
          description: "レビュー完了の状態では、チケット詳細に「STG完了 →」ボタンが表示されます。STG検証が終わったら押します。",
          requirement: REQ.flag("canEditDelete"),
          screen: () => frame(<ScreenTicketDetail phase="stg" />, [{ target: spot("action"), label: "クリック" }]),
        },
        {
          title: "続けて「UAT完了」を押す",
          description: "STG完了の次は「UAT完了 →」ボタンが現れます。UAT検証が終わったら押すと、リリース準備に進めます。",
          requirement: REQ.flag("canEditDelete"),
          screen: () => frame(<ScreenTicketDetail phase="uat" />, [{ target: spot("action"), label: "クリック" }]),
        },
      ],
    },
    {
      slug: "release",
      title: "リリースノートに追加する",
      icon: CalendarCheck,
      intro: "UAT完了になると、チケット詳細からリリース日を指定してリリースノートに追加できます。",
      steps: [
        {
          title: "リリース日を選んで「リリースノートに追加」を押す",
          description: "UAT完了のチケット詳細に、リリース日の選択欄と「対応完了してリリースノートに追加 →」ボタンが表示されます。リリース日を選んで押すと、次に実績工数の入力画面が開きます。",
          requirement: REQ.flag("canEditDelete"),
          screen: () => frame(<ScreenTicketDetail phase="release" />, [{ target: spot("release"), label: "リリース日を選んで追加" }]),
        },
      ],
    },
    {
      slug: "actual-hours",
      title: "実績工数を入力して完了する",
      icon: ClipboardList,
      intro: "リリースノートに追加すると、対応工数を記録する画面が開きます。",
      steps: [
        {
          title: "各工程の時間を入力して「完了する」",
          description: "「レビュー承認→STG完了」「STG完了→UAT完了」「UAT完了→対応完了」の各工程にかかった時間（h）を入力します。合計が人日に換算され、「完了する」を押すとリリース済みになります。",
          requirement: REQ.flag("canEditDelete"),
          screen: () => frame(<ScreenCompletionOverlay />, [{ target: spot("hours"), label: "工程ごとの時間を入力" }]),
        },
      ],
    },
    {
      slug: "hold",
      title: "保留・取下・復帰の使い方",
      icon: Undo2,
      intro: "作業を一時的に止めたいときは「保留」、不要になったら「取下」。どちらも同じボタンから解除（＝復帰）できます。ここでは押した後にチケットがどう変わるかも見ていきます。",
      steps: [
        {
          title: "「保留する」を押す（一時的に止める）",
          description: "チケット詳細の上部にある「保留する」を押すと、作業をいったん止められます。これまでの実績は残ります。",
          requirement: REQ.flag("canEditDelete"),
          screen: () => frame(<ScreenTicketDetail phase="hold" />, [{ target: spot("hold"), label: "保留する" }]),
        },
        {
          title: "保留中になる（詳細の見た目＋復帰）",
          description: "ステータスが「保留中」（赤）になり、ボタンは「保留解除」に変わります。作業を再開するときは「保留解除」を押すと元のステータスに戻ります（＝復帰）。",
          requirement: REQ.flag("canEditDelete"),
          screen: () => frame(<ScreenTicketDetail phase="held" />, [{ target: spot("hold"), label: "保留中／保留解除" }]),
        },
        {
          title: "「取下する」を押す（不要になったとき）",
          description: "不要になったチケットは「取下する」で退避します。集計から外れますが、これまでの実績は残ります。",
          requirement: REQ.flag("canEditDelete"),
          screen: () => frame(<ScreenTicketDetail phase="hold" />, [{ target: spot("hold"), label: "取下する" }]),
        },
        {
          title: "取下になる（詳細の見た目＋復帰）",
          description: "ステータスが「取下」（グレー）になり、ボタンは「取下解除」に変わります。戻したいときは「取下解除」を押すと元のステータスに復帰します。",
          requirement: REQ.flag("canEditDelete"),
          screen: () => frame(<ScreenTicketDetail phase="withdrawn" />, [{ target: spot("hold"), label: "取下／取下解除" }]),
        },
        {
          title: "リストでの見え方",
          description: "リストビューでは、保留中のチケットは「保留中」（赤）、取り下げたチケットは「取下」（グレー）のステータスで表示されます。",
          requirement: REQ.flag("canEditDelete"),
          screen: () => frame(<ScreenSprintViews view="list" holdDemo />, [{ target: spot("hold-list"), label: "保留中 / 取下", dim: false }]),
        },
      ],
    },
  ],
};

export const MANUAL: ManualCategoryDef[] = [INTRO, CREATE, LIFECYCLE];

/** slug から章を検索（/manual/:slug 用） */
export function getChapter(slug: string | undefined): { cat: ManualCategoryDef; chapter: ManualChapterDef } | undefined {
  for (const cat of MANUAL) {
    const chapter = cat.chapters.find((c) => c.slug === slug);
    if (chapter) return { cat, chapter };
  }
  return undefined;
}
