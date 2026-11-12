// ENHA2-055-3 高度検索：利用者の CLI の AI（Claude Code・Gemini CLI など）に貼るプロンプトを組み立てる。
//
// Dev Ticket からは AI を呼ばない。利用者がこのプロンプトを AI に貼ると、AI が Dev Ticket の API で
// 議事録・Wiki・チケット・コメント・バックログを調べ、結果を research-result で送り返す。画面はその記録を見て結果を出す。
//
// ⚠️ 下の API と食い違うと AI が失敗する。変えたら合わせて確認すること:
//   ・api/_lib/research.ts        （research-start / research-result / research-fail。sources の形・大きさの上限）
//   ・api/_lib/researchSearch.ts  （search / minutes / wiki / backlog-item）
//   ・api/v1/[resource].ts        （ticket。チケット1件の本文・コメント）

const FENCE = "```";
const c = (s: string) => "`" + s + "`";

export interface ResearchPromptContext {
  baseUrl: string;
  projectName: string;
  /** プロンプトへ埋め込むキーの平文 */
  plainKey: string;
  jobId: string;
  question: string;
}

export function buildResearchPrompt(ctx: ResearchPromptContext): string {
  const base = ctx.baseUrl.replace(/\/+$/, "");
  const api = `${base}/api/v1`;
  const lines: string[] = [];
  const add = (...l: string[]) => lines.push(...l);

  add(
    "# Dev Ticket の資料を横断して調べ、調査レポートを送り返す",
    "",
    "あなたはこれから、Dev Ticket（プロジェクト管理ツール）の API で、プロジェクトの議事録・Wiki・チケット・コメント・バックログ・ファイルボックスのファイル（Excel・Word・PDF・PowerPoint・Googleのファイル）を調べ、",
    "下の「質問」に答える調査レポートを作って Dev Ticket へ送ります。結果は Dev Ticket の画面に表示されます。",
    "",
    "## 質問",
    "",
    ...ctx.question.split(/\r?\n/).map(l => `> ${l}`),
    "",
    "## 対象",
    "",
    "| 項目 | 値 |",
    "|---|---|",
    `| プロジェクト | ${ctx.projectName} |`,
    `| 調査のID（jobId） | ${c(ctx.jobId)} |`,
    `| API | ${c(api)} |`,
    "",
    "## APIキー",
    "",
    FENCE,
    ctx.plainKey,
    FENCE,
    "",
    "- すべてのリクエストで " + c("Authorization: Bearer <上のAPIキー>") + " を付ける。",
    "- **キーはパスワードと同じもの。出力・ログ・ファイルに書き出さないこと。**",
    "- 1分あたり60回までしか呼べない。全件を読みに行かず、検索で絞ってから必要な本文だけを読む。",
    "",
    "## 手順",
    "",
    "### 1. 最初に research-start を呼ぶ",
    "",
    FENCE,
    `POST ${api}/research-start`,
    `{ "jobId": "${ctx.jobId}" }`,
    FENCE,
    "",
    "- 画面に「処理中」が出る。応答の " + c("question") + " が質問の文。",
    "- 409（完了・失敗・キャンセル済み）が返ったら、それ以上何もせずに止まり、利用者にそのまま伝える。",
    "",
    "### 2. search で絞り込む",
    "",
    FENCE,
    `GET ${api}/search?q=<語>&kinds=<種類>&limit=<件数>`,
    FENCE,
    "",
    "- " + c("q") + " は空白で区切ると、すべての語を含むものだけが返る。言い換え・別の言い方でも何回か検索する。",
    "- " + c("kinds") + " は " + c("ticket,comment,wiki,minutes,backlog,file") + " をカンマ区切りで（省略するとすべて）。" + c("limit") + " は既定20・最大50。",
    "- 結果には本文は入らず、当たった語の前後（" + c("excerpt") + "）・日付・画面の URL（" + c("url") + "）だけが入る。",
    "- " + c("excludedKinds") + " に入っている種類は、キーを発行した人が見られないもの。読みに行かない。",
    "",
    "### 3. 必要なものだけ本文を読む",
    "",
    "| 種類 | 読み方 |",
    "|---|---|",
    `| 議事録 | ${c(`GET ${api}/minutes?id=<id>`)}（一覧は ${c(`GET ${api}/minutes`)}） |`,
    `| Wiki | ${c(`GET ${api}/wiki?id=<id>`)}（一覧は ${c(`GET ${api}/wiki`)}） |`,
    `| チケット・コメント | ${c(`GET ${api}/ticket?wbs=<WBS>`)}（本文とコメントが返る） |`,
    `| バックログ | ${c(`GET ${api}/backlog-item?id=<id>`)} |`,
    `| ファイル | ${c(`GET ${api}/file-text?id=<id>`)}（ファイルから取り出した文字。${c("error")} に取り出せなかった理由が入る） |`,
    "",
    "- 本文は " + c("text") + " に入っている。" + c("truncated: true") + " なら途中で切れている。",
    "- **全件を読みに行かない。**検索の抜粋で関係がありそうなものだけを読む。",
    "",
    "### 4. 結果を2つの形で書く",
    "",
    "**レポート型（markdown）** — 次の4つの見出しをこの順に書く。",
    "",
    FENCE + "markdown",
    "## 結論",
    "（質問への答えを2〜4文で。根拠の出典を [1] の形で付ける）",
    "",
    "## 経緯（時系列）",
    "- 2026-10-01　できごと [1]",
    "- 2026-10-15　できごと [2]",
    "",
    "## 未決事項",
    "- まだ決まっていないこと [3]",
    "（無ければ「見つかりませんでした」と書く）",
    "",
    "## 出典",
    "1. 議事録「定例 10/1」（2026-10-01）",
    "2. チケット BRU1-002 のコメント（2026-10-15）",
    FENCE,
    "",
    "**短い回答型（short）** — 質問への答えを2〜3文で。出典を [1] の形で付ける（見出しは付けない）。",
    "",
    "- 本文の中の出典は、必ず " + c("[1]") + " の形の番号で示す。番号は下の " + c("sources") + " の " + c("no") + " と対応させる。",
    "- 経緯は1行ずつ「日付（YYYY-MM-DD）・できごと」の形で、古い順に並べる。",
    "- 資料に書かれていないことを推測で書かない。見つからなければ、そう書く。",
    "- 日本語で書く。",
    "",
    "### 5. research-result で送る",
    "",
    FENCE + "json",
    `POST ${api}/research-result`,
    "{",
    `  "jobId": "${ctx.jobId}",`,
    '  "markdown": "## 結論\\n…",',
    '  "short": "…",',
    '  "sources": [',
    '    { "no": 1, "kind": "minutes", "id": "<議事録のid>", "title": "定例 10/1", "date": "2026-10-01",',
    '      "url": "<search や本文の応答の url>", "quote": "<資料からそのまま書き写した根拠の文>" }',
    "  ]",
    "}",
    FENCE,
    "",
    "- " + c("markdown") + " と " + c("short") + " はどちらも必須。",
    "- " + c("sources") + " の各項目:",
    "  - " + c("no") + " … 本文の [1] [2] と同じ番号",
    "  - " + c("kind") + " … " + c("minutes") + " / " + c("wiki") + " / " + c("ticket") + " / " + c("comment") + " / " + c("backlog") + " / " + c("file"),
    "  - " + c("id") + " … 資料のID（議事録・Wiki・バックログ・ファイルはその ID、チケット・コメントはチケットの WBS）",
    "  - " + c("title") + "・" + c("date") + "（議事録は会議日）・" + c("url") + " … search や本文の応答の値をそのまま使う",
    "  - " + c("quote") + " … **根拠になった文を、資料の本文から1〜2文そのまま書き写す**（言い換えない・要約しない）。画面で出典を押すと、この文が黄色で目立つ",
    "- markdown・short・sources を合わせて20万文字まで。",
    "- 日本語を含む JSON は、ファイルに UTF-8 で書いてから送る（例: " + c("curl --data-binary @result.json -H \"Content-Type: application/json; charset=utf-8\" …") + "）。コマンドラインに直接書くと、環境によっては文字化けする。",
    "",
    "### 調べられなかったとき",
    "",
    FENCE,
    `POST ${api}/research-fail`,
    `{ "jobId": "${ctx.jobId}", "reason": "<調べられなかった理由>" }`,
    FENCE,
    "",
    "- API のエラーが続く・キーが使えない など、レポートを送れないときに呼ぶ。資料が見つからなかっただけなら、そう書いたレポートを research-result で送る。",
    "",
    "## 最後に",
    "",
    "- 送り終えたら、利用者に「Dev Ticket の画面に結果が出ました」と、結論を1〜2文で伝える。",
    "- 401（キーが無効）・403（権限が無い）・404（見つからない）が返ったら、内容を変えて何度も送り直さず、エラー文を利用者にそのまま伝える。",
    "- **キーを出力に書かない。**",
  );
  return lines.join("\n");
}
