// KAIZEN2611-013 「AIで更新」の手順書。WBS 画面の「AIで更新」（WbsAiUpdateDialog）からコピーする。
//
// 会議の文字起こしなどと一緒に AI へ渡すと、AI が API（GET /api/v1/wbs・POST /api/v1/wbs-proposal）で
// WBS を読み、文字起こしで決まったことだけを「更新の案」として Dev Ticket に送る。
// KAIZEN2611-015 案はすぐには反映されない。利用者が WBS 画面で新旧を見比べ、「この内容で反映」を押したときだけ反映する。
// API の本体は api/_lib/wbsApi.ts。ここと食い違うと AI が失敗するので、項目・エラーを変えたら両方を直すこと。
//
// 決まっていること（チケット KAIZEN2611-013 の「決まったこと」）:
//   ・AI は、変更を案として送り、返った URL を利用者に渡す（KAIZEN2611-015。反映は利用者が画面で行う）
//   ・行の削除は API ではできない（削除は画面でだけ行う）
//   ・文字起こしのファイルは Dev Ticket に保存しない（AI の側で読む）
//   ・書き込めるのは、権限が「すべて」のキーだけ

const KEY_PLACEHOLDER = "<ここに Dev Ticket のAPIキーを貼る>";
const FENCE = "```";
const c = (s: string) => "`" + s + "`";

const LEVEL_LABELS = ["大項目", "中項目", "小項目"];

export interface WbsPromptContext {
  /** 画面のオリジン（例 https://dv-ticket.com）。API の接続先にもなる */
  baseUrl: string;
  projectName: string;
  sheetId: string;
  sheetName: string;
  /** 項目の段数（1〜3） */
  levels: number;
  /** 埋め込むキーの平文。無ければプレースホルダを入れる */
  plainKey?: string;
}

export function buildWbsUpdatePrompt(ctx: WbsPromptContext): string {
  const key = ctx.plainKey ?? KEY_PLACEHOLDER;
  const levels = Math.min(Math.max(ctx.levels, 1), 3);
  const levelText = LEVEL_LABELS.slice(0, levels).join("・");
  const leafLabel = LEVEL_LABELS[levels - 1];
  const readUrl = `${ctx.baseUrl}/api/v1/wbs?sheetId=${ctx.sheetId}`;
  const updateUrl = `${ctx.baseUrl}/api/v1/wbs-proposal`;

  const out: string[] = [];
  const add = (...lines: string[]) => out.push(...lines);

  add(
    `# Dev Ticket の WBS「${ctx.sheetName}」を、会議の文字起こしから更新する`,
    "",
    "あなたはこれから、利用者が渡す会議の文字起こし（議事録・メモなど）を読み、そこで**決まったこと**を、",
    "Dev Ticket（プロジェクト管理ツール）の WBS（作業分解表）に API で反映します。",
    "WBS の今の中身は、利用者は貼り付けません。**必ず API から自分で読んでください。**",
    "",
    "## 対象",
    "",
    "| 項目 | 値 |",
    "|---|---|",
    `| プロジェクト | ${ctx.projectName || "(名称未設定)"} |`,
    `| WBS | **${ctx.sheetName}** |`,
    `| sheetId | ${c(ctx.sheetId)} |`,
    `| 項目の段数 | ${levels}段（${levelText}） |`,
    "",
    "## 守ること",
    "",
    "- **文字起こしの中で決まったことだけを反映する。**「〜かもしれない」「検討する」「次回決める」など、決まっていないことは反映しない。",
    "- **日付・担当者・進捗を推測で埋めない。**文字起こしに書かれていない値は送らない（空のままにする・今の値のままにする）。",
    "  - 「来週の金曜」のような言い方は、会議の日付が文字起こしから分かるときだけ日付に直す。分からなければ利用者に聞く。",
    "  - 担当者は、GET で返る `members` の名前と同じものだけを使う。呼び方が違う（名字だけ・あだ名など）ときは、どのメンバーかを利用者に確かめる。",
    "- **WBS をすぐには変えない。**変更は「更新の案」として送る。WBS は、利用者が画面で新旧を見比べて「この内容で反映」を押したときだけ変わる。",
    "- 案を送ったら、**応答の `url` を必ず利用者に渡す。**利用者はその URL を開いて、変わる行を確かめてから反映する。",
    "- **行の削除はできない。**消すべき行があれば、その旨を利用者に伝え、画面で消してもらう（API で名前を空にするなどの代わりの操作もしない）。",
    "- 文字起こしの内容を、Dev Ticket のコメント・備考などに丸ごと書き写さない（必要な要点だけを備考に入れるのはよい）。",
    ...(levels > 1 ? [
      `- **${LEVEL_LABELS.slice(0, levels - 1).join("・")}の行で変えられるのは名前だけ。**日付・担当者・進捗・ステータス・備考・チケットは、一番右の段（${leafLabel}）の行に入れる（上の段の行に送っても保存されず、\`warnings\` に出る）。`,
      `  - 「調査フェーズは12/11まで」のような${LEVEL_LABELS.slice(0, levels - 1).join("・")}についての話は、その下の${leafLabel}の行に当てはめる。どの行に当てはめるか決められないときは、案に入れずに「確認が必要」として利用者に聞く。`,
    ] : []),
    "",
  );

  add(
    "## APIキー",
    "",
    FENCE,
    key,
    FENCE,
    "",
    ctx.plainKey
      ? "- 上の1行が **Dev Ticket のAPIキー**（" + c("dvt_live_") + " で始まる文字列）。**この手順書にキーはもう含まれている。**利用者に聞き直さないこと。"
      : "- 上の行はプレースホルダ。管理者から受け取った、権限が「すべて」のキー（" + c("dvt_live_") + " で始まる文字列）に置き換えること。",
    "- すべてのリクエストで " + c("Authorization: Bearer <上のAPIキー>") + " として送る。",
    "- キーはパスワードと同じもの。**利用者への報告・ファイル・ログに書き出さないこと。**",
    "- 読み書きは、キーを発行した人の権限で行われる（その人が見られない・編集できない WBS は 404・403 になる）。",
    "",
  );

  add("## 手順", "");
  let n = 0;
  const step = (title: string, ...lines: string[]) => add(`### ${++n}. ${title}`, "", ...lines, "");

  step("文字起こしを受け取る",
    "- 利用者から、会議の文字起こし（テキスト・ファイル）を受け取る。まだ受け取っていなければ、貼り付けてもらう。",
    "- 会議の日付が分かれば控えておく（「来週」などを日付に直すのに使う）。",
  );

  step("WBS の今の中身と版の番号を読む",
    FENCE,
    `GET ${readUrl}`,
    "Authorization: Bearer <APIキー>",
    FENCE,
    "",
    "応答の形:",
    "",
    FENCE + "json",
    "{",
    `  "sheet": { "id": "…", "name": "${ctx.sheetName}", "levels": ${levels}, "levelLabels": [${LEVEL_LABELS.slice(0, levels).map(l => `"${l}"`).join(", ")}], "locked": false, "canEdit": true, "version": 42 },`,
    "  \"version\": 42,",
    "  \"statuses\": [{ \"name\": \"未着手\", \"color\": \"#EDECF4\" }, { \"name\": \"進行中\", \"color\": \"…\" }],",
    "  \"members\": [\"山田 太郎\", \"佐藤 花子\"],",
    "  \"rows\": [",
    ...(levels > 1 ? [
      "    { \"no\": 1, \"id\": \"<行のid>\", \"parentId\": null, \"level\": 1, \"levelLabel\": \"大項目\", \"name\": \"設計\",",
      "      \"assignee\": null, \"startDate\": null, \"endDate\": null,",
      "      \"progress\": 40, \"progressEditable\": false, \"status\": null, \"note\": null, \"tickets\": [], \"editableFields\": [\"name\"] },",
    ] : []),
    `    { "no": ${levels > 1 ? 2 : 1}, "id": "<行のid>", "parentId": ${levels > 1 ? '"<親の行のid>"' : "null"}, "level": ${levels}, "levelLabel": "${leafLabel}", "name": "画面設計",`,
    "      \"assignee\": \"山田 太郎\", \"startDate\": \"2026-12-01\", \"endDate\": \"2026-12-05\",",
    "      \"progress\": 40, \"progressEditable\": true, \"status\": \"進行中\", \"note\": \"\", \"tickets\": [\"T-012\"],",
    "      \"editableFields\": [\"name\", \"assignee\", \"startDate\", \"endDate\", \"progress\", \"status\", \"note\", \"tickets\"] }",
    "  ]",
    "}",
    FENCE,
    "",
    "- `rows` は画面と同じ並び（親の行のすぐ下に子の行）。`parentId` で親子が分かる。",
    `- \`progress\` は、一番右の段（${leafLabel}）の行だけが入力値。それより上の段の行は、下の行の平均（変えられない。\`progressEditable: false\`）。`,
    "- `editableFields` は、その行で変えられる項目。上の段の行は `[\"name\"]` だけで、担当者・日付・ステータス・備考・チケットは空（`null`・`[]`）で返る。",
    "- `version`（版の番号）を控える。更新のときに `expectedVersion` として送る。",
    "- `sheet.locked` が true（ロック中）、または `sheet.canEdit` が false なら、更新できない。その旨を利用者に伝えて止まる。",
  );

  step("決まったことを拾い、変更の案を作る",
    "- 文字起こしから、WBS に関わる「決まったこと」を拾う：日程（開始日・終了日）の変更、担当者の変更、進捗・ステータスの変更、新しい作業（行の追加）、作業の並べ替え、チケットとの紐づけ。",
    "- それぞれを、今の WBS のどの行に当たるかに結びつける。当たる行がはっきりしないもの（同じような名前の行が複数ある など）は、案に「確認が必要」として残し、送らない。",
    "- 変更の案は、行ごとに「今の値 → 変える値」と、根拠にした文字起こしの一文を並べる。例:",
    "",
    FENCE,
    "1. 「設計」：終了日 12/5 → 12/12（根拠：「設計は1週間延ばして12日までにします」）",
    "2. 「設計」の下に中項目「画面設計」を追加（担当 佐藤 花子・12/8〜12/12）（根拠：「画面設計は佐藤さんにお願いします」）",
    "3. 確認が必要：「テスト」の担当（「鈴木さん」がメンバーに見つかりません）",
    FENCE,
    "",
    "- 決まっていないこと・推測が要ることは案に入れない。",
  );

  step("更新の案を送る（WBS はまだ変わらない）",
    FENCE,
    `POST ${updateUrl}`,
    "Authorization: Bearer <APIキー>",
    "Content-Type: application/json",
    "",
    "{",
    `  "sheetId": "${ctx.sheetId}",`,
    "  \"expectedVersion\": 42,",
    "  \"operations\": [",
    "    { \"op\": \"update\", \"id\": \"<行のid>\", \"endDate\": \"2026-12-12\" },",
    "    { \"op\": \"add\", \"ref\": \"new1\", \"parentId\": \"<親の行のid>\", \"name\": \"画面設計\", \"assignee\": \"佐藤 花子\", \"startDate\": \"2026-12-08\", \"endDate\": \"2026-12-12\" },",
    ...(levels >= 3 ? ["    { \"op\": \"add\", \"parentId\": \"new1\", \"name\": \"一覧画面\" },"] : []),
    "    { \"op\": \"move\", \"id\": \"<行のid>\", \"afterId\": \"<同じ親の下の行のid>\" },",
    "    { \"op\": \"link\", \"id\": \"<行のid>\", \"tickets\": [\"T-012\"] }",
    "  ]",
    "}",
    FENCE,
    "",
    "**operations に入れられる操作**（上から順に反映する。1回に200件まで）:",
    "",
    "| op | 内容 | 指定する項目 |",
    "|---|---|---|",
    "| `add` | 行を足す | `parentId`（親の行の id。大項目なら `null` か省略）・`name`（必須）。ほかに下の「行の項目」を入れられる。位置は `afterId` / `beforeId`（同じ親の下の行）、省略すると同じ親の下の最後。`ref` に名前を付けると、あとの操作の `id`・`parentId`・`afterId`・`beforeId` にその名前を書いて、足した行を指せる。`tickets` で紐づけもできる |",
    "| `update` | 行の項目を変える | `id`。変える項目だけを入れる（入れなかった項目は今のまま） |",
    "| `move` | 並べ替える・親を変える | `id`。`afterId` / `beforeId`（移す先の同じ親の下の行）、`parentId`（親を変えるとき。段は変えられないので、1つ上の段の行だけ） |",
    "| `link` / `unlink` | チケットを紐づける／外す | `id`・`tickets`（チケットの WBS 番号の配列。例 `[\"T-012\"]`） |",
    "",
    "**行の項目**:",
    "",
    "| 項目 | 形 | 決まり |",
    "|---|---|---|",
    "| `name` | 文字 | 項目名 |",
    "| `assignee` | 文字 | `members` の名前のどれか。`\"\"` で空にする |",
    "| `startDate` / `endDate` | `YYYY-MM-DD` | `\"\"` で空にする |",
    `| \`progress\` | 0〜100 の整数 | 一番右の段（${leafLabel}）の行だけ |`,
    "| `status` | 文字 | `statuses` の名前のどれか |",
    "| `note` | 文字 | 備考 |",
    "",
    ...(levels > 1 ? [`- 上の段（${LEVEL_LABELS.slice(0, levels - 1).join("・")}）の行で変えられるのは \`name\` だけ。ほかの項目・\`link\` は保存されず、\`warnings\` に出る（\`unlink\` はできる）。上の段に \`add\` するときも、名前だけの行になる。`] : []),
    "- **行の削除（`op: \"delete\"`）は送らない。**送ると 400 になり、何も変わらない。",
    `- このWBSは${levels}段なので、${leafLabel}の下には行を足せない（足そうとすると、その行は足されずに \`warnings\` に出る）。`,
    "- **operations は、すべて反映されるか、1つも反映されないかのどちらか。**存在しない行の id などがあると 400 になり、何も変わらない（`errors` に理由が並ぶ）。",
    "- メンバーにいない担当者・無いステータス・形の違う日付などは、その項目だけが変わらず、`warnings` に理由が出る（ほかの項目・操作は反映される）。",
    "",
    "成功したときの応答（案ができた。WBS はまだ変わっていない）:",
    "",
    FENCE + "json",
    `{ "ok": true, "proposalId": "<案のid>", "status": "pending", "url": "${ctx.baseUrl}/<プロジェクト>/wbs/${ctx.sheetId}?proposal=<案のid>", "counts": { "changedRows": 1, "addedRows": 1, "warnings": 0 }, "changes": ["「設計」：終了日 12/5 → 12/12", "追加：「画面設計」（中項目・親「設計」）"], "created": [{ "ref": "new1", "id": "…", "name": "画面設計", "level": 2 }], "warnings": [] }`,
    FENCE,
    "",
    "- 案の状態（反映待ち・反映済み・取り消し）は " + c(`GET ${updateUrl}?id=<案のid>`) + " で読める。",
    "- 利用者が画面で「この内容で反映」を押すと、案のとおりに WBS が変わる。反映の前の状態は、自動でバックアップに残る（「APIで更新する前に保存」を選んで反映すると元に戻せる）。",
    "- 案を送ったあとに WBS が画面で直されると、その案は反映できなくなる。利用者から頼まれたら、GET で読み直して案を作り直す。",
  );

  step("エラーのとき",
    "| status | 意味 | どうするか |",
    "|---|---|---|",
    "| 400 | 送った操作に反映できないものがある（存在しない行の id・行の削除 など）、または変わるところが1つも無い。案は作られていない | `errors` を読み、直せるものは直して送り直す。直し方が分からなければ利用者に伝えて止まる |",
    "| 401 | APIキーが無効 | 利用者に伝えて止まる |",
    "| 403 | キーの権限が「すべて」でない／キーを発行した人に、この WBS を編集する権限が無い | 利用者に伝えて止まる |",
    "| 404 | WBS が見つからない（キーを発行した人が見られない WBS も含む） | 利用者に伝えて止まる |",
    "| 409 | ほかの人が編集した（版の番号が古い）／ロック中／アーカイブ済み | 下を参照 |",
    "| 503 | サーバー側の準備（SQL の適用）がまだ | 利用者に伝えて止まる |",
    "",
    "- **409 で「ほかの人が編集しました」のときは、GET で読み直し、変更の案を今の中身に当てはめ直して、1回だけ送り直す。**",
    "  - 読み直した中身で、案の行が消えている・値がすでに変わっているなど、案が成り立たなくなったものは送らず、利用者に伝える。",
    "  - 送り直しても 409 なら、止まって利用者に伝える。",
    "- 409 で「ロックされている」「アーカイブ済み」のときは、送り直さずに利用者に伝えて止まる。",
  );

  step("報告する",
    "- **応答の `url` を利用者に渡し、「この URL を開いて、変わる行を確かめてから『この内容で反映』を押してください。押すまで WBS は変わりません」と伝える。**",
    "- 応答の `changes`（案に入れた変更の一覧）をそのまま利用者に伝える。",
    "- **`warnings` は1件も省かずに読み上げる。**変わらなかった項目とその理由が入っている。",
    "- 案のうち送らなかったもの（確認が必要なもの・承認されなかったもの・削除が必要なもの）も並べる。",
    "- WBS の画面を開いている人には、表の上に「AIからの更新の案があります」の帯が出る（開き直すと出る）。",
  );

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
