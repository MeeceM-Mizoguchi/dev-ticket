// AI（Claude Code 等）にそのまま渡せる「Dev Ticket へのチケット登録手順」を組み立てる。
//
// MDファイルからの取り込み（mdTickets/template.ts）と目的は同じだが、出力先が
// 「.mdファイル」ではなく「APIへの JSON」になる。本文（description）の項目構成や
// 分類ごとの書き分けといった、実運用で効いた指示はそのまま引き継いでいる。
//
// ⚠️ ここに書く仕様は api/v1/[resource].ts の実装と一致していなければならない。
//    片方だけ変えるとAIが作った JSON が 400 で弾かれる。
import { MD_STATUS_LABELS, MD_PRIORITY_LABELS } from "@/app/lib/mdTickets/parse";

export interface ApiSetupContext {
  /** 例: "https://devticket.example.com"。末尾のスラッシュは含めない */
  baseUrl: string;
  projectName: string;
  sprintId: string;
  sprintName: string;
  memberNames: string[];
  categoryNames: string[];
  /** "2026/08/11" */
  today: string;
  /**
   * 発行直後のモーダルからコピーする場合のみ平文キーを渡す。
   * 一覧からのコピーでは平文が復元できないため undefined になり、
   * 手順には「AI側に設定済みのキーを使う」旨のプレースホルダが入る。
   */
  plainKey?: string;
  /**
   * チケット詳細から開いたときの親チケット。
   * 渡すと「すべてこの親の子として登録する」文面になり、sprintId と children の説明は載せない。
   */
  parentTicket?: { wbs: string; title: string };
  /**
   * 「登録するチケットをすべて PR不要にする」にチェックを入れてコピーしたとき true。
   * true のときだけ JSON 例・項目表・指示に prLinkWaived が入る（外したままなら一切出さない）。
   */
  prLinkWaived?: boolean;
}

const KEY_PLACEHOLDER = "<ここに Dev Ticket のAPIキーを貼る>";

/** 本文（description）の書き方。MD取り込みのプロンプトと同じ項目構成を使う。 */
const DESCRIPTION_SPEC = `## 本文（description）の書き方

description は **Markdown 文字列**で渡す。決まった項目構成で書くこと。
ラベルは \`**概要**\` のように**太字で単独行**に置き、**その直後で改行して**内容を書く。
ラベルと内容を同じ行に続けない。項目と項目の間には空行を1行入れる。

| 順 | ラベル | 要否 | 書く内容 |
|---|---|---|---|
| 1 | 概要 | 必須 | このチケットで何をするのかを2〜3行で。最初に読む要約 |
| 2 | 対象画面 | 必須 | 画面名・URL・該当箇所。画面に依らない作業は「画面なし（バッチ / API / ドキュメント 等）」と書く |
| 3 | 対象機能 | 必須 | 機能名・関数名・ファイルパスなど、触る対象を特定できる情報 |
| 4 | 事象（ASIS） | 必須 | いま何がどうなっていて、何が問題なのか。確認できた事実だけを書く |
| 5 | 期待値（TOBE） | 必須 | 対応後にどうなっていればよいか |
| 6 | フロントエンド修正内容 | 該当時 | 画面・コンポーネント・状態管理の変更点 |
| 7 | バックエンド修正内容 | 該当時 | API・サーバー処理の変更点 |
| 8 | DB・マイグレーション | 該当時 | テーブル・カラム・権限・関数の変更点と投入順序 |
| 9 | インフラ・サーバー設定修正内容 | 該当時 | 環境変数・デプロイ設定・権限・外部サービス設定 |
| 10 | 影響範囲 | 該当時 | 他の画面・機能・既存データへの波及 |
| 11 | 受入条件 | 必須 | 完了と判断する条件を箇条書きで。1行1条件、検証できる書き方にする |
| 12 | 注意点 | 該当時 | 実装時の落とし穴、既知の制約、作業順序の依存 |
| 13 | その他 | 該当時 | 参考リンク、関連チケット、決定事項の補足 |

- 「該当時」の項目は、該当が無ければ**項目ごと省略**する（ラベルだけ置いて「なし」と書かない）。
- 「必須」の6項目は必ず書く。書けないときは推測せず「（要確認）」と明記する。
- ラベルを見出し（\`#\` \`##\`）で書かない。太字の単独行にすること。
- 使えるのは段落・箇条書き・番号付きリスト・引用・コードブロック・太字・リンク。表や入れ子リストは使わない。

## 分類ごとの書き分け

項目構成は共通のまま、**分類の値に応じてどこを厚く書くかを変える**。
分類名が下記と完全に一致しなくても、意味が近いものとして扱う。

**バグ・不具合**
- 事象（ASIS）に、再現手順（番号付き）／発生条件／エラーメッセージ／発生頻度／確認した環境を必ず含める
- 原因の推定は事象に書かず「注意点」に回す。事象には確認できた事実だけを書く
- 受入条件の先頭に「記載の再現手順で再現しないこと」を入れる

**機能追加・新規開発**
- 概要に、なぜ必要か（背景・目的）を書く
- 期待値（TOBE）に仕様を漏れなく書く。画面項目・入力制限・エラー時の挙動まで含める
- 受入条件は期待値の各項目と1対1で対応させる
- フロントエンド／バックエンド／DB・マイグレーションのうち、触るものは必ず書く

**改修・改善・リファクタリング**
- 事象（ASIS）に現状の課題を数値で書く（処理時間・件数・エラー率など）
- 期待値（TOBE）には目標値を書く
- **影響範囲を必ず書く。**利用者から見た挙動が変わらないことを担保する範囲を明示する

**仕様確認・調査・検討**
- 事象（ASIS）に「何が分かっていないか」「なぜ判断できないか」を書く
- 期待値（TOBE）に「何が決まれば完了か」を書く
- 受入条件は「決定内容が記録されていること」など、成果物で判定できる形にする
- 修正内容の項目（フロントエンド／バックエンド／DB／インフラ）は省略してよい

**運用・保守・作業**
- 手順と実施順序を「注意点」に書く
- 影響範囲と、失敗したときの切り戻し手順を必ず書く

上のどれにも当てはまらない分類のときは、共通の構成のまま書く。`;

/** 新しい親と children の作り分け。親チケットが決まっている文面では載せない。 */
const PARENT_CHILD_SPEC = `## 親チケットと子チケット

- 1つの作業で完結するものは親チケットだけで書く（これが基本）。
- 複数の作業に分かれるもの（機能単位・改修一式など）だけ \`children\` に子チケットを入れる。
- 階層は**1段まで**。子の中にさらに \`children\` を入れない。
- **子チケットにも親と同じ項目と本文を書く**。子だからといって省略しない。
- 迷ったら子を作らない。
- **既に登録されているチケットに子を足す**場合は \`children\` ではなく \`parentWbs\` を使う（後述）。`;

/** 「## APIキー」の項目。スプリント指定・親チケット指定のどちらの文面でも同じものを使う。 */
function buildKeySection(plainKey?: string): string {
  return `## APIキー

\`\`\`
${plainKey ?? KEY_PLACEHOLDER}
\`\`\`

${plainKey
  ? `- 上の1行が **Dev Ticket のAPIキー**（\`dvt_live_\` で始まる文字列）。
- **この手順書にキーはもう含まれている。**利用者に「APIキーを教えてください」と聞き直さないこと。
- すべてのリクエストで \`Authorization: Bearer <上のAPIキー>\` として送る。`
  : `- 上の行はプレースホルダ。控えてある実際のキー（\`dvt_live_\` で始まる文字列）に置き換えること。
- 既に環境変数や設定ファイルへ登録済みであれば、そちらを使ってよい。
- すべてのリクエストで \`Authorization: Bearer <上のAPIキー>\` として送る。`}
- キーはパスワードと同じもの。**ソースコードに直接書かず、ログや出力にも書き出さないこと。**`;
}

/** PR不要で登録するときに JSON 例のリクエスト直下へ入れる1行（オフのときは空） */
function prLinkWaivedJsonLine(ctx: ApiSetupContext): string {
  return ctx.prLinkWaived ? `\n  "prLinkWaived": true,` : "";
}

/** PR不要で登録するときの項目表の行（オフのときは空） */
function prLinkWaivedTableRow(ctx: ApiSetupContext): string {
  return ctx.prLinkWaived
    ? `\n| prLinkWaived | ✅ | **必ず \`true\`**（リクエスト直下に書く。子チケットも含めて、登録するものすべてが「PR不要」になる） | — |`
    : "";
}

/** PR不要で登録するときの指示（オフのときは空） */
function prLinkWaivedNote(ctx: ApiSetupContext): string {
  return ctx.prLinkWaived
    ? `\n- **リクエスト直下に \`"prLinkWaived": true\` を必ず付けること。**利用者が「プルリクエストを作らない作業（仕様の確認・資料作成など）」として登録を求めている。`
    : "";
}

/**
 * 実績（BRU22-005）の項目表の行。親向け・子向けの2つの表で同じものを使う。
 * 完了済みの作業を後から登録したとき、実績が 0h のままにならないようにするためのもの
 */
const ACTUAL_TABLE_ROWS = `
| actualHours | | 実績工数（時間数・小数第1位まで。例: \`3.5\`） | 空欄（画面は着手〜完了の時刻から計算） |
| startedAt | | 着手日 \`YYYY/MM/DD\` | 空欄 |
| completedAt | | 完了日 \`YYYY/MM/DD\`。**status がクローズのときだけ**登録される | 空欄 |`;

/** 実績の書き方の指示。親向け・子向けの2つの手順書で同じものを使う */
const ACTUAL_NOTE = `
- **完了済みの作業を後から登録するときは、\`status\` を「クローズ」にし、分かる範囲で \`actualHours\`・\`startedAt\`・\`completedAt\` を入れる。**根拠が無ければ省略する（推測で埋めない）。
- \`completedAt\` は \`startedAt\` より前にしない。クローズ以外のステータスで \`completedAt\` を送っても登録されない（\`warnings\` に出る）。`;

function memberCandidates(ctx: ApiSetupContext): string {
  return ctx.memberNames.length > 0
    ? ctx.memberNames.join(" / ")
    : "（メンバー未設定。assignee は指定しないこと）";
}

function categoryCandidates(ctx: ApiSetupContext): string {
  return ctx.categoryNames.length > 0
    ? ctx.categoryNames.join(" / ")
    : "（分類未設定。category は指定しないこと）";
}

/**
 * AIに渡す手順書を組み立てる。
 * これ1つをAIのチャットに貼れば、追加の説明なしにチケットを登録できる状態にする。
 * parentTicket を渡したときは、その親の子チケットだけを登録する文面になる。
 */
export function buildApiSetupPrompt(ctx: ApiSetupContext): string {
  if (ctx.parentTicket) return buildParentChildPrompt(ctx, ctx.parentTicket);

  const members = memberCandidates(ctx);
  const categories = categoryCandidates(ctx);

  return `# Dev Ticket へのチケット登録

あなたはこれから、Dev Ticket（プロジェクト管理ツール）の API を呼んでチケットを登録します。
以下の仕様に厳密に従ってください。

${buildKeySection(ctx.plainKey)}

## 接続情報

| 項目 | 値 |
|---|---|
| チケットを登録する | \`POST ${ctx.baseUrl}/api/v1/tickets\` |
| 既存チケットを一覧する | \`GET ${ctx.baseUrl}/api/v1/tickets\` |
| 候補値（スプリント・担当者・分類）を取る | \`GET ${ctx.baseUrl}/api/v1/context\` |
| 認証ヘッダー | \`Authorization: Bearer <上のAPIキー>\` |
| Content-Type | \`application/json\` |
| 対象プロジェクト | ${ctx.projectName}（APIキーに紐づいているので指定不要） |
| **登録先スプリント** | **${ctx.sprintName || "(名称未設定)"}** |
| **sprintId** | **\`${ctx.sprintId}\`** |

⚠️ \`sprintId\` は上の値を**そのまま使う**こと。この手順は利用者が「${ctx.sprintName || "このスプリント"}」の画面から
　 コピーしたものであり、登録先はここで確定している。**自分で別のスプリントを選び直さないこと。**
　 利用者が会話の中で別のスプリントを明示的に指定した場合のみ、そちらに変更する。

## リクエストの形

\`\`\`json
{
  "sprintId": "${ctx.sprintId}",${prLinkWaivedJsonLine(ctx)}
  "tickets": [
    {
      "title": "ログイン画面のバリデーション追加",
      "status": "未着手",
      "priority": "高",
      "category": "バグ",
      "assignee": "山田太郎",
      "startDate": "${ctx.today}",
      "dueDate": "${ctx.today}",
      "estimatedHours": 4,
      "description": "**概要**\\nメールアドレス欄に入力チェックが無く…\\n\\n**対象画面**\\nログイン画面（/login）\\n",
      "children": []
    }
  ]
}
\`\`\`

## 項目の仕様

| キー | 必須 | 値 | 未指定のとき |
|---|---|---|---|
| title | ✅ | チケットのタイトル（500文字まで） | — |
| status | | ${MD_STATUS_LABELS.join(" / ")} | 未着手 |
| priority | | ${MD_PRIORITY_LABELS.join(" / ")} | 中 |
| category | | ${categories} | 分類なし |
| assignee | | ${members} | 空欄 |
| startDate | | \`YYYY/MM/DD\` | 空欄 |
| dueDate | | \`YYYY/MM/DD\` | 空欄 |
| estimatedHours | | 時間数（整数） | 0 |${ACTUAL_TABLE_ROWS}
| description | | 本文（Markdown 文字列） | 空欄 |
| children | | 子チケットの配列（同じ形・1階層まで） | なし |
| parentWbs | | **既に登録されているチケット**のWBS（例: \`T-012\`）。指定するとその子として登録される | 新しい親チケットとして登録 |${prLinkWaivedTableRow(ctx)}

- 上の項目は**できる限りすべて埋める**。ただし**根拠なく推測しない**。判断材料が無い項目は**キーごと省略**する（空文字や「未定」とは書かない）。
- 表に無いキーは送らない（送っても無視される）。
- assignee / category は上に挙げた名前のいずれかを書く。該当が無ければキーごと省略する。${ACTUAL_NOTE}
- 1回のリクエストで送れる \`tickets\` は 200 件まで、親1件あたりの子は 50 件まで。${prLinkWaivedNote(ctx)}

## 既に登録されているチケットに子チケットを足す

新しく親を作るのではなく既存チケットの下に足したいときは、\`tickets\` の各要素に \`parentWbs\` を書く。

\`\`\`json
{
  "tickets": [
    { "title": "申請画面の作成", "priority": "高", "parentWbs": "T-012", "description": "**概要**\\n…" },
    { "title": "リセットメール送信APIの作成", "priority": "高", "parentWbs": "T-012", "description": "**概要**\\n…" }
  ]
}
\`\`\`

- 枝番（\`T-012-3\` など）は**既存の子の続きから自動で振られる**。自分で採番しない。
- 登録先スプリントは**親チケットと同じ**になる。この形だけを送るときは \`sprintId\` を書かない。
- \`parentWbs\` を書いた要素に \`children\` は書けない（階層は1段まで）。子チケットの下にさらに子も作れない。
- WBS の代わりにチケットIDで指定する場合は \`parentId\` を使う。両方書いた場合は \`parentId\` が優先される。
- 新しく作るチケットと \`parentWbs\` 付きのチケットを**同じリクエストに混ぜてよい**。その場合は \`sprintId\` が必要。
- **親のWBSを推測で書かない。**分からなければ後述の \`GET /api/v1/tickets\` で探すか、利用者に確認する。

${DESCRIPTION_SPEC}

${PARENT_CHILD_SPEC}

## 応答

成功すると \`201\` と以下が返る。

\`\`\`json
{
  "ok": true,
  "count": 3,
  "created": [{ "wbs": "T-054", "title": "…", "parentWbs": null }],
  "warnings": ["「…」: 担当者「佐藤」はプロジェクトのメンバーに見つからないため空欄にしました"]
}
\`\`\`

\`created[].parentWbs\` は、既存チケットの子として登録されたものだけ親のWBSが入る（新しい親は \`null\`）。

- \`warnings\` が空でなければ、**必ず利用者に読み上げて報告する**。登録自体は成功しているが、担当者や分類が空欄になっている可能性がある。
- \`401\` はキーが無効・失効・期限切れ。\`403\` はプランの上限超過。\`429\` はリクエスト過多（1分あたり60回まで）。
- **エラーが返ったときに、内容を変えて何度も再送しないこと。** 同じ内容で2回送るとチケットが二重に登録される。エラー内容を利用者に伝えて指示を仰ぐ。

## 補足: 最新の候補値を取りたいとき

\`GET ${ctx.baseUrl}/api/v1/context\`（同じ Authorization ヘッダー）で、
このプロジェクトのスプリント一覧・メンバー名・分類名・使えるステータスを取得できる。

**スプリント一覧が取れても、登録先を \`${ctx.sprintId}\` から変えてはならない。**
この呼び出しは担当者名や分類名の最新の候補を確かめるためのものである。

## 補足: 子チケットを足す親を探したいとき

\`GET ${ctx.baseUrl}/api/v1/tickets\`（同じ Authorization ヘッダー）で既存チケットを一覧できる。
ここで返る \`wbs\` を、そのまま \`parentWbs\` に使う。

| クエリ | 意味 |
|---|---|
| \`sprintId\` / \`sprintName\` | スプリントで絞る（省略時はプロジェクト全体） |
| \`q\` | タイトルの部分一致で絞る |
| \`wbs\` | そのチケットと、その子チケットだけを返す |
| \`limit\` | 返す件数（既定100・最大500） |

\`\`\`json
{
  "count": 2,
  "hasMore": false,
  "tickets": [
    { "id": "TKT-…", "wbs": "T-012", "title": "ユーザー認証機能のリニューアル", "status": "進行中", "priority": "高", "assignee": "山田太郎", "parentWbs": null, "sprintId": "…", "sprintName": "…" },
    { "id": "TKT-…", "wbs": "T-012-1", "title": "申請画面の作成", "status": "未着手", "priority": "高", "assignee": null, "parentWbs": "T-012", "sprintId": "…", "sprintName": "…" }
  ]
}
\`\`\`

- \`parentWbs\` が \`null\` のものだけが親になれる。子チケット（\`T-012-1\` など）の下にさらに子は作れない。
- **どの親に足すか確信が持てないときは、候補を利用者に示して確認する。**勝手に決めない。

## 今日の日付

${ctx.today}
`;
}

/**
 * チケット詳細から開いたときの手順書。親が決まっているので、
 * sprintId・children の説明と、親を一覧から探す手順は載せない（AIが親を選び直す余地を残さない）。
 */
function buildParentChildPrompt(ctx: ApiSetupContext, parent: { wbs: string; title: string }): string {
  const members = memberCandidates(ctx);
  const categories = categoryCandidates(ctx);

  return `# Dev Ticket へのチケット登録（${parent.wbs} の子チケット）

あなたはこれから、Dev Ticket（プロジェクト管理ツール）の API を呼んで、
既に登録されているチケット **${parent.wbs}** の子チケットを登録します。
以下の仕様に厳密に従ってください。

${buildKeySection(ctx.plainKey)}

## 接続情報

| 項目 | 値 |
|---|---|
| チケットを登録する | \`POST ${ctx.baseUrl}/api/v1/tickets\` |
| 候補値（担当者・分類）を取る | \`GET ${ctx.baseUrl}/api/v1/context\` |
| 認証ヘッダー | \`Authorization: Bearer <上のAPIキー>\` |
| Content-Type | \`application/json\` |
| 対象プロジェクト | ${ctx.projectName}（APIキーに紐づいているので指定不要） |
| **親チケット** | **${parent.wbs} ${parent.title}** |
| **parentWbs** | **\`${parent.wbs}\`** |

⚠️ これから作るチケットは、**すべてこのチケット（${parent.wbs}）の子として登録する。**
　 \`parentWbs\` は上の値を**そのまま使い、変えてはならない。**
　 この手順は利用者が「${parent.wbs}」の詳細画面からコピーしたものであり、親はここで確定している。
　 **自分で別の親を探したり、新しい親チケットを作ったりしないこと。**

## リクエストの形

\`\`\`json
{${prLinkWaivedJsonLine(ctx)}
  "tickets": [
    {
      "title": "ログイン画面のバリデーション追加",
      "parentWbs": "${parent.wbs}",
      "status": "未着手",
      "priority": "高",
      "category": "バグ",
      "assignee": "山田太郎",
      "startDate": "${ctx.today}",
      "dueDate": "${ctx.today}",
      "estimatedHours": 4,
      "description": "**概要**\\nメールアドレス欄に入力チェックが無く…\\n\\n**対象画面**\\nログイン画面（/login）\\n"
    }
  ]
}
\`\`\`

- 子チケットを複数作るときは、\`tickets\` に並べる。**どの要素にも \`"parentWbs": "${parent.wbs}"\` を書く。**
- 枝番（\`${parent.wbs}-3\` など）は**既存の子の続きから自動で振られる**。自分で採番しない。
- 登録先スプリントは**親チケットと同じ**になる。\`sprintId\` は書かない。
- 子チケットの下にさらに子は作れない（階層は1段まで）。\`children\` は書かない。

## 項目の仕様

| キー | 必須 | 値 | 未指定のとき |
|---|---|---|---|
| title | ✅ | チケットのタイトル（500文字まで） | — |
| parentWbs | ✅ | **必ず \`${parent.wbs}\`** | — |
| status | | ${MD_STATUS_LABELS.join(" / ")} | 未着手 |
| priority | | ${MD_PRIORITY_LABELS.join(" / ")} | 中 |
| category | | ${categories} | 分類なし |
| assignee | | ${members} | 空欄 |
| startDate | | \`YYYY/MM/DD\` | 空欄 |
| dueDate | | \`YYYY/MM/DD\` | 空欄 |
| estimatedHours | | 時間数（整数） | 0 |${ACTUAL_TABLE_ROWS}
| description | | 本文（Markdown 文字列） | 空欄 |${prLinkWaivedTableRow(ctx)}

- 上の項目は**できる限りすべて埋める**。ただし**根拠なく推測しない**。判断材料が無い項目は**キーごと省略**する（空文字や「未定」とは書かない）。
- 表に無いキーは送らない（送っても無視される）。
- assignee / category は上に挙げた名前のいずれかを書く。該当が無ければキーごと省略する。${ACTUAL_NOTE}
- 1回のリクエストで足せる子チケットは 50 件まで。超えるときはリクエストを分ける。${prLinkWaivedNote(ctx)}

${DESCRIPTION_SPEC}

## 子チケットの書き方

- **子チケットにも上の項目と本文を省略せずに書く**。子だからといって省略しない。

## 応答

成功すると \`201\` と以下が返る。

\`\`\`json
{
  "ok": true,
  "count": 2,
  "created": [{ "wbs": "${parent.wbs}-3", "title": "…", "parentWbs": "${parent.wbs}" }],
  "warnings": ["「…」: 担当者「佐藤」はプロジェクトのメンバーに見つからないため空欄にしました"]
}
\`\`\`

\`created[].parentWbs\` が \`${parent.wbs}\` になっていることを確かめる。

- \`warnings\` が空でなければ、**必ず利用者に読み上げて報告する**。登録自体は成功しているが、担当者や分類が空欄になっている可能性がある。
- \`401\` はキーが無効・失効・期限切れ。\`403\` はプランの上限超過。\`429\` はリクエスト過多（1分あたり60回まで）。
- **エラーが返ったときに、内容を変えて何度も再送しないこと。** 同じ内容で2回送るとチケットが二重に登録される。エラー内容を利用者に伝えて指示を仰ぐ。

## 補足: 最新の候補値を取りたいとき

\`GET ${ctx.baseUrl}/api/v1/context\`（同じ Authorization ヘッダー）で、
このプロジェクトのメンバー名・分類名・使えるステータスを取得できる。

**ここで返るスプリント一覧は使わない。親を \`${parent.wbs}\` から変えてはならない。**
この呼び出しは担当者名や分類名の最新の候補を確かめるためのものである。

## 今日の日付

${ctx.today}
`;
}

/** 発行直後のモーダルで「手順の中身を表示」に出す、短い要約 */
export function buildApiQuickReference(baseUrl: string): string {
  return `POST ${baseUrl}/api/v1/tickets
Authorization: Bearer dvt_live_...
Content-Type: application/json

{ "sprintId": "...", "tickets": [ { "title": "...", ... } ] }

// 既存チケットに子チケットを足す（親は GET /api/v1/tickets で探せる）
{ "tickets": [ { "title": "...", "parentWbs": "T-012" } ] }`;
}
