// 「他システムに組み込む」ときのサンプルコード。
//
// 画面（ApiIntegrationDialog の「組み込み」タブ）にそのまま貼れる形で返す。
// AI に渡す手順書（apiKeyPrompt.ts / apiImplementPrompt.ts）とは読者が違う。あちらは AI 向けの仕様書、
// こちらは人間が自分のコードへ写すためのもの。
//
// サンプルは6種類（登録・読み取り・ステータス更新・PR紐づけ・PR作成・マージ）。読み取り以降は、
// AI を通さずに外部のシステムからも同じ API を使えることを見せるためのもの。
// PR作成・マージ（BRU21-001）は api/github/[resource].ts にあり、PRとマージコミットが Dev Ticket の bot 名義になる。
//
// ⚠️ ここのサンプルは api/v1/[resource].ts・api/github/[resource].ts（ticket-pull-create / ticket-merge）の
//    実装と一致していなければならない。
//    エンドポイント・ヘッダー・上限値・受けるステータス・エラーの条件を変えたら、こちらも直すこと。

/** サンプルを出せる言語 */
export type SampleLang = "curl" | "js" | "python";

export const SAMPLE_LANGS: { id: SampleLang; label: string }[] = [
  { id: "curl", label: "curl" },
  { id: "js", label: "JavaScript" },
  { id: "python", label: "Python" },
];

/** サンプルの種類（どの API を叩くか） */
export type SampleKind = "create" | "read" | "status" | "pull" | "pull-create" | "merge";

/**
 * 種類ごとの説明。画面ではサンプルの上に「必要な権限」と注意を出す。
 * 権限は api/v1/[resource].ts の scope の判定と揃えること。
 */
export const SAMPLE_KINDS: { id: SampleKind; label: string; endpoint: string; permission: string; notes: string[] }[] = [
  {
    id: "create", label: "登録", endpoint: "POST /api/v1/tickets",
    permission: "登録のみ／すべて",
    notes: [],
  },
  {
    id: "read", label: "読み取り", endpoint: "GET /api/v1/ticket",
    permission: "読み取りのみ／すべて",
    notes: [
      "チケット1件の本文・画像・添付・コメントを返します。親を指定すると子チケット全部、子を指定すると親も一緒に返ります",
      "画像と添付の URL は認証なしで取得できます",
    ],
  },
  {
    id: "status", label: "ステータス更新", endpoint: "POST /api/v1/ticket-status",
    permission: "すべて",
    notes: [
      "変更できる先は「進行中」「レビュー中（親チケットのみ）」「対応完了（子チケットのみ）」の3つだけです",
      "前にしか進みません。すでに同じか先のステータスなら何もせず、changed: false が返ります",
      "保留中・取下のチケットと、子チケットが対応完了していない親をレビュー中にしようとしたときは 409 になります",
      "APIでレビュー中にしても、レビュアーの指定・レビュー依頼の通知は行われません。レビューは画面からレビュアーを指定して依頼してください",
    ],
  },
  {
    id: "pull", label: "PR紐づけ", endpoint: "POST /api/v1/ticket-pull",
    permission: "すべて",
    notes: [
      "url はプロジェクトに登録した GitHub リポジトリのプルリクエストで、number と url の番号が一致している必要があります（違うと 400）",
      "すでに紐づいていれば changed: false が返ります。画面から手動で紐づけたPRは上書きしません",
    ],
  },
  {
    id: "pull-create", label: "PR作成", endpoint: "POST /api/github/ticket-pull-create",
    permission: "すべて",
    notes: [
      "PRは Dev Ticket の bot 名義で作られ、指定したチケットへそのまま紐づきます",
      "ブランチ（head）は先に push しておきます。ブランチ名にチケット番号が入っていないと 400 になります",
      "キーを発行した人に GitHub のPR作成権限が無いと 403 になります",
    ],
  },
  {
    id: "merge", label: "マージ", endpoint: "POST /api/github/ticket-merge",
    permission: "すべて",
    notes: [
      "そのチケットに紐づいたPRだけを、bot 名義で Squash マージします。紐づいていないPRの番号は 400 になります",
      "コンフリクト・CIの失敗・必須のチェックやレビュー承認の不足・理由の入力が必要なときは、マージせずに 409 で理由を返します",
      "キーを発行した人に GitHub のマージ権限が無いと 403 になります",
    ],
  },
];

export interface SampleContext {
  /** 例: "https://dv-ticket.com"。末尾のスラッシュは含めない */
  baseUrl: string;
  sprintId: string;
  /** 発行直後・復号できた場合のみ平文キー。無ければプレースホルダを出す */
  plainKey?: string;
  /** 読み取り・ステータス更新・PR紐づけの例に使う WBS。チケット詳細から開いたときはそのチケット */
  wbs?: string;
}

const KEY_PLACEHOLDER = "dvt_live_ここにAPIキー";

/** 1リクエストで送れる上限（api/v1/[resource].ts と揃えること） */
export const API_LIMITS = {
  parentsPerRequest: 200,
  childrenPerParent: 50,
  requestsPerMinute: 60,
  listDefaultLimit: 100,
  listMaxLimit: 500,
} as const;

/**
 * キーの置き場所。
 * ソースに直接書くとGitに入って漏れるため、サンプルは環境変数から読む形で統一する。
 * curl だけは手元で1回叩く用途なので、そのまま実行できる形にしている。
 */
export function buildKeySetupSnippet(key: string): string {
  return `# macOS / Linux
export DEV_TICKET_API_KEY="${key}"

# Windows (PowerShell)
$env:DEV_TICKET_API_KEY="${key}"

# .env に書く場合
DEV_TICKET_API_KEY=${key}`;
}

function curlSample(c: SampleContext, key: string): string {
  return `# ① まず疎通確認。登録先スプリントや担当者名の候補が返る
curl ${c.baseUrl}/api/v1/context \\
  -H "Authorization: Bearer ${key}"

# ② チケットを登録する
#    tickets は配列。1回のリクエストで複数件まとめて送れる
curl -X POST ${c.baseUrl}/api/v1/tickets \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sprintId": "${c.sprintId}",
    "tickets": [
      {
        "title": "ログイン画面のバリデーション追加",
        "status": "未着手",
        "priority": "高",
        "description": "**概要**\\nメールアドレス欄に入力チェックが無い。"
      }
    ]
  }'

# ③ 既に登録されているチケットに子チケットを足す
#    まず親を探す（q はタイトルの部分一致。wbs / sprintId でも絞れる）
curl "${c.baseUrl}/api/v1/tickets?q=認証&limit=20" \\
  -H "Authorization: Bearer ${key}"

#    返ってきた wbs を parentWbs に渡す。枝番（T-012-3 など）は既存の子の続きから自動で振られる。
#    登録先スプリントは親と同じになるので sprintId は要らない
curl -X POST ${c.baseUrl}/api/v1/tickets \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tickets": [
      { "title": "申請画面の作成", "priority": "高", "parentWbs": "T-012" },
      { "title": "リセットメール送信APIの作成", "priority": "高", "parentWbs": "T-012" }
    ]
  }'`;
}

function jsSample(c: SampleContext): string {
  return `// Node.js 18+ / ブラウザ どちらでも動く（CORS は開放済み）
// キーはソースに書かず環境変数から読む（Gitに入れないため）
const API_KEY = process.env.DEV_TICKET_API_KEY;

async function postTickets(body) {
  const res = await fetch("${c.baseUrl}/api/v1/tickets", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    // 401:キーが無効 403:プラン上限 429:リクエスト過多
    throw new Error(\`\${res.status}: \${json.error}\`);
  }

  // 担当者名や分類名が解決できなかった場合はここに理由が入る（登録自体は成功）
  if (json.warnings?.length) console.warn(json.warnings);

  return json.created; // [{ wbs: "T-054", title: "…", parentWbs: null }]
}

// 新しくチケットを作る
const createTickets = tickets => postTickets({ sprintId: "${c.sprintId}", tickets });

// 既に登録されているチケットに子チケットを足す。
// 枝番（T-012-3 など）は既存の子の続きから自動で振られ、登録先スプリントは親と同じになる。
const addChildTickets = (parentWbs, children) =>
  postTickets({ tickets: children.map(c => ({ ...c, parentWbs })) });

// 子を足す親を探す（q はタイトルの部分一致。wbs / sprintId でも絞れる）
async function findTickets(query) {
  const res = await fetch(\`${c.baseUrl}/api/v1/tickets?\${new URLSearchParams(query)}\`, {
    headers: { "Authorization": \`Bearer \${API_KEY}\` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(\`\${res.status}: \${json.error}\`);
  return json.tickets; // parentWbs が null のものだけが親になれる
}

// ── ここから下が「自分のシステムのデータ」を渡す部分 ──
// 例: 自社の問い合わせ管理から、未対応の不具合をチケット化する
const issues = await db.query("SELECT * FROM issues WHERE ticket_wbs IS NULL");

const created = await createTickets(
  issues.map(issue => ({
    title: issue.subject,                    // 必須。これだけでも登録できる
    status: "未着手",
    priority: issue.urgent ? "高" : "中",
    description: \`**概要**\\n\${issue.body}\`,   // Markdown で書く
    // 該当が無い項目はキーごと省略する（空文字を入れない）
  })),
);

console.log(created); // [{ wbs: "T-054", title: "…" }, …]

// 例: 既に登録されている親チケットに、作業単位の子チケットをぶら下げる
const [parent] = await findTickets({ q: "ユーザー認証", limit: "20" });
await addChildTickets(parent.wbs, [
  { title: "申請画面の作成", priority: "高" },
  { title: "リセットメール送信APIの作成", priority: "高" },
]);`;
}

function pythonSample(c: SampleContext): string {
  return `import os
import requests

# キーはソースに書かず環境変数から読む（Gitに入れないため）
API_KEY = os.environ["DEV_TICKET_API_KEY"]
BASE_URL = "${c.baseUrl}"


def post_tickets(payload):
    res = requests.post(
        f"{BASE_URL}/api/v1/tickets",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )

    body = res.json()
    if not res.ok:
        # 401:キーが無効 403:プラン上限 429:リクエスト過多
        raise RuntimeError(f"{res.status_code}: {body.get('error')}")

    # 担当者名や分類名が解決できなかった場合はここに理由が入る（登録自体は成功）
    for w in body.get("warnings", []):
        print("警告:", w)

    return body["created"]  # [{"wbs": "T-054", "title": "…", "parentWbs": None}]


def create_tickets(tickets):
    """新しくチケットを作る"""
    return post_tickets({"sprintId": "${c.sprintId}", "tickets": tickets})


def add_child_tickets(parent_wbs, children):
    """既に登録されているチケットに子チケットを足す。

    枝番（T-012-3 など）は既存の子の続きから自動で振られ、登録先スプリントは親と同じになる。
    """
    return post_tickets({"tickets": [{**c, "parentWbs": parent_wbs} for c in children]})


def find_tickets(**query):
    """子を足す親を探す（q はタイトルの部分一致。wbs / sprintId でも絞れる）"""
    res = requests.get(
        f"{BASE_URL}/api/v1/tickets",
        headers={"Authorization": f"Bearer {API_KEY}"},
        params=query,
        timeout=30,
    )
    body = res.json()
    if not res.ok:
        raise RuntimeError(f"{res.status_code}: {body.get('error')}")
    return body["tickets"]  # parentWbs が None のものだけが親になれる


# ── ここから下が「自分のシステムのデータ」を渡す部分 ──
# 例: 監視ツールで拾ったエラーをチケット化する
created = create_tickets([
    {
        "title": alert.summary,                       # 必須。これだけでも登録できる
        "status": "未着手",
        "priority": "高" if alert.severity == "critical" else "中",
        "description": f"**概要**\\n{alert.detail}",   # Markdown で書く
        # 該当が無い項目はキーごと省略する（空文字を入れない）
    }
    for alert in alerts
])

print(created)  # [{"wbs": "T-054", "title": "…"}, …]

# 例: 既に登録されている親チケットに、作業単位の子チケットをぶら下げる
parent = find_tickets(q="ユーザー認証", limit=20)[0]
add_child_tickets(parent["wbs"], [
    {"title": "申請画面の作成", "priority": "高"},
    {"title": "リセットメール送信APIの作成", "priority": "高"},
])`;
}

// ── 読み取り（GET /api/v1/ticket） ──────────────────────────────

function readCurlSample(c: SampleContext, key: string, wbs: string): string {
  return `# 権限: 読み取りのみ／すべて（「登録のみ」のキーでは 403）
#
# チケット1件の本文・画像・添付・コメントを返す。
# 親を指定すると子チケット全部（children）、子を指定すると親（parent）も一緒に返る
curl "${c.baseUrl}/api/v1/ticket?wbs=${wbs}" \\
  -H "Authorization: Bearer ${key}"

# 応答の例
# {
#   "project": { "name": "…", "slug": "…" },
#   "ticket": {
#     "wbs": "${wbs}", "title": "…", "status": "進行中", "priority": "高", "assignee": "…",
#     "url": "…（Dev Ticket 上のチケットのURL）",
#     "description": "本文（Markdown 風のテキスト）",
#     "images": ["https://…"], "attachments": [], "comments": []
#   },
#   "parent": null,
#   "children": [ { "wbs": "${wbs}-1", "…": "ticket と同じ形" } ]
# }
# 404: チケットがこのキーのプロジェクトに無い`;
}

function readJsSample(c: SampleContext, wbs: string): string {
  return `// 権限: 読み取りのみ／すべて（「登録のみ」のキーでは 403）
// キーはソースに書かず環境変数から読む（Gitに入れないため）
const API_KEY = process.env.DEV_TICKET_API_KEY;

async function getTicket(wbs) {
  const res = await fetch(\`${c.baseUrl}/api/v1/ticket?\${new URLSearchParams({ wbs })}\`, {
    headers: { "Authorization": \`Bearer \${API_KEY}\` },
  });

  const json = await res.json();
  if (!res.ok) {
    // 401:キーが無効 403:キーの権限不足 404:チケットが無い 429:リクエスト過多
    throw new Error(\`\${res.status}: \${json.error}\`);
  }
  // ticket … 指定したチケット / parent … 子を指定したときの親 / children … 親を指定したときの子（WBS 順）
  return json;
}

// ── ここから下が「自分のシステム」で使う部分 ──
// 例: 自社の進捗ボードに、チケットと子チケットの進み具合を出す
const { ticket, children } = await getTicket("${wbs}");

console.log(\`\${ticket.wbs} \${ticket.status} \${ticket.title}\`);
for (const child of children) {
  console.log(\`  \${child.wbs} \${child.status} \${child.title}\`);
}`;
}

function readPythonSample(c: SampleContext, wbs: string): string {
  return `# 権限: 読み取りのみ／すべて（「登録のみ」のキーでは 403）
import os
import requests

# キーはソースに書かず環境変数から読む（Gitに入れないため）
API_KEY = os.environ["DEV_TICKET_API_KEY"]
BASE_URL = "${c.baseUrl}"


def get_ticket(wbs):
    res = requests.get(
        f"{BASE_URL}/api/v1/ticket",
        headers={"Authorization": f"Bearer {API_KEY}"},
        params={"wbs": wbs},
        timeout=30,
    )

    body = res.json()
    if not res.ok:
        # 401:キーが無効 403:キーの権限不足 404:チケットが無い 429:リクエスト過多
        raise RuntimeError(f"{res.status_code}: {body.get('error')}")

    # ticket … 指定したチケット / parent … 子を指定したときの親 / children … 親を指定したときの子（WBS 順）
    return body


# ── ここから下が「自分のシステム」で使う部分 ──
# 例: 自社の進捗ボードに、チケットと子チケットの進み具合を出す
data = get_ticket("${wbs}")
ticket = data["ticket"]

print(ticket["wbs"], ticket["status"], ticket["title"])
for child in data["children"]:
    print("  ", child["wbs"], child["status"], child["title"])`;
}

// ── ステータス更新（POST /api/v1/ticket-status） ──────────────────

const STATUS_RULES = [
  "変更できる先: 進行中（親・子）／レビュー中（親チケットのみ）／対応完了（子チケットのみ）",
  "・前にしか進まない。すでに同じか先のステータスなら何もせず changed: false が返る",
  "・409: 保留中・取下のチケット／子チケットが対応完了していない親をレビュー中にしようとしたとき",
  "       （読んでから書くまでに、画面でステータスが変えられたときも 409）",
  "・APIでレビュー中にしても、レビュアーの指定・レビュー依頼の通知は行われない（レビューは画面から依頼する）",
  "・子を進行中にしたとき、親が未着手なら親も進行中になる（応答の parentStarted に親の WBS が入る）",
];

/** 説明の行をコメントにする（# か //） */
const commentLines = (prefix: string, lines: string[]) => lines.map(l => `${prefix} ${l}`).join("\n");

function statusCurlSample(c: SampleContext, key: string, wbs: string): string {
  return `# 権限: すべて（「登録のみ」「読み取りのみ」のキーでは 403）
#
${commentLines("#", STATUS_RULES)}
curl -X POST ${c.baseUrl}/api/v1/ticket-status \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{ "wbs": "${wbs}", "status": "進行中" }'

# 応答の例
# { "ok": true, "changed": true, "wbs": "${wbs}", "from": "未着手", "status": "進行中", "parentStarted": null, "warnings": [] }
# すでに同じか先のステータスのとき
# { "ok": true, "changed": false, "wbs": "${wbs}", "status": "進行中", "parentStarted": null, "message": "すでに「進行中」のため変更していません" }
#
# Windows で日本語の status が化けて 400 になるときは、本文を UTF-8 のファイルに保存して
# -d の代わりに --data-binary @body.json で送る`;
}

function statusJsSample(c: SampleContext, wbs: string): string {
  return `// 権限: すべて（「登録のみ」「読み取りのみ」のキーでは 403）
//
${commentLines("//", STATUS_RULES)}
const API_KEY = process.env.DEV_TICKET_API_KEY;

async function updateStatus(wbs, status) {
  const res = await fetch("${c.baseUrl}/api/v1/ticket-status", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ wbs, status }),
  });

  const json = await res.json();
  if (res.status === 409) {
    // 保留中・取下／子が終わっていない親をレビュー中にしようとした／直前に画面で変更された。
    // 送り直しても通らないので、理由を残して人に任せる
    console.warn(json.error);
    return null;
  }
  if (!res.ok) {
    // 400:指定できないステータス 401:キーが無効 403:キーの権限不足 404:チケットが無い 429:リクエスト過多
    throw new Error(\`\${res.status}: \${json.error}\`);
  }

  // changed: false … すでに同じか先のステータスだったので、何もしていない（正常）
  if (json.warnings?.length) console.warn(json.warnings);
  return json; // { ok, changed, wbs, from, status, parentStarted, warnings }
}

// ── ここから下が「自分のシステム」で使う部分 ──
// 例: 自社の作業管理で着手・完了を記録したら、Dev Ticket の子チケットも進める
await updateStatus("${wbs}-1", "進行中");
await updateStatus("${wbs}-1", "対応完了");

// 子がすべて対応完了したら、親をレビュー中にする（レビュアーの指定と通知は画面から）
await updateStatus("${wbs}", "レビュー中");`;
}

function statusPythonSample(c: SampleContext, wbs: string): string {
  return `# 権限: すべて（「登録のみ」「読み取りのみ」のキーでは 403）
#
${commentLines("#", STATUS_RULES)}
import os
import requests

API_KEY = os.environ["DEV_TICKET_API_KEY"]
BASE_URL = "${c.baseUrl}"


def update_status(wbs, status):
    res = requests.post(
        f"{BASE_URL}/api/v1/ticket-status",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json={"wbs": wbs, "status": status},
        timeout=30,
    )

    body = res.json()
    if res.status_code == 409:
        # 保留中・取下／子が終わっていない親をレビュー中にしようとした／直前に画面で変更された。
        # 送り直しても通らないので、理由を残して人に任せる
        print("変更できません:", body.get("error"))
        return None
    if not res.ok:
        # 400:指定できないステータス 401:キーが無効 403:キーの権限不足 404:チケットが無い 429:リクエスト過多
        raise RuntimeError(f"{res.status_code}: {body.get('error')}")

    # changed が False … すでに同じか先のステータスだったので、何もしていない（正常）
    for w in body.get("warnings", []):
        print("警告:", w)
    return body  # {"ok", "changed", "wbs", "from", "status", "parentStarted", "warnings"}


# ── ここから下が「自分のシステム」で使う部分 ──
# 例: 自社の作業管理で着手・完了を記録したら、Dev Ticket の子チケットも進める
update_status("${wbs}-1", "進行中")
update_status("${wbs}-1", "対応完了")

# 子がすべて対応完了したら、親をレビュー中にする（レビュアーの指定と通知は画面から）
update_status("${wbs}", "レビュー中")`;
}

// ── PR紐づけ（POST /api/v1/ticket-pull） ─────────────────────────

const PULL_RULES = [
  "url はプロジェクトに登録した GitHub リポジトリのプルリクエストであること",
  "number と url の番号が一致していないと 400（リポジトリが違う・未登録のときも 400）",
  "すでに紐づいていれば changed: false。画面から手動で紐づけたPRは上書きしない",
];

const PULL_URL_EXAMPLE = "https://github.com/your-org/your-repo/pull/123";

function pullCurlSample(c: SampleContext, key: string, wbs: string): string {
  return `# 権限: すべて（「登録のみ」「読み取りのみ」のキーでは 403）
#
${commentLines("#", PULL_RULES)}
curl -X POST ${c.baseUrl}/api/v1/ticket-pull \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "wbs": "${wbs}",
    "number": 123,
    "url": "${PULL_URL_EXAMPLE}",
    "title": "${wbs} ログイン画面のバリデーション追加"
  }'

# 応答の例
# { "ok": true, "changed": true, "wbs": "${wbs}", "number": 123, "url": "${PULL_URL_EXAMPLE}" }`;
}

function pullJsSample(c: SampleContext, wbs: string): string {
  return `// 権限: すべて（「登録のみ」「読み取りのみ」のキーでは 403）
//
${commentLines("//", PULL_RULES)}
const API_KEY = process.env.DEV_TICKET_API_KEY;

async function linkPullRequest(wbs, pr) {
  const res = await fetch("${c.baseUrl}/api/v1/ticket-pull", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ wbs, number: pr.number, url: pr.url, title: pr.title }),
  });

  const json = await res.json();
  if (!res.ok) {
    // 400:リポジトリ・番号の不一致 401:キーが無効 403:キーの権限不足 404:チケットが無い
    throw new Error(\`\${res.status}: \${json.error}\`);
  }
  return json; // { ok, changed, wbs, number, url }
}

// ── ここから下が「自分のシステム」で使う部分 ──
// 例: 自社のリリースツールが作ったプルリクエストを、チケットに紐づける
await linkPullRequest("${wbs}", {
  number: 123,
  url: "${PULL_URL_EXAMPLE}",
  title: "${wbs} ログイン画面のバリデーション追加",
});`;
}

function pullPythonSample(c: SampleContext, wbs: string): string {
  return `# 権限: すべて（「登録のみ」「読み取りのみ」のキーでは 403）
#
${commentLines("#", PULL_RULES)}
import os
import requests

API_KEY = os.environ["DEV_TICKET_API_KEY"]
BASE_URL = "${c.baseUrl}"


def link_pull_request(wbs, number, url, title):
    res = requests.post(
        f"{BASE_URL}/api/v1/ticket-pull",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json={"wbs": wbs, "number": number, "url": url, "title": title},
        timeout=30,
    )

    body = res.json()
    if not res.ok:
        # 400:リポジトリ・番号の不一致 401:キーが無効 403:キーの権限不足 404:チケットが無い
        raise RuntimeError(f"{res.status_code}: {body.get('error')}")
    return body  # {"ok", "changed", "wbs", "number", "url"}


# ── ここから下が「自分のシステム」で使う部分 ──
# 例: 自社のリリースツールが作ったプルリクエストを、チケットに紐づける
link_pull_request(
    "${wbs}",
    number=123,
    url="${PULL_URL_EXAMPLE}",
    title="${wbs} ログイン画面のバリデーション追加",
)`;
}

// ── PR作成・マージ（POST /api/github/ticket-pull-create・ticket-merge） ─────

const PULL_CREATE_RULES = [
  "PRは Dev Ticket の bot 名義で作られ、wbs のチケットへそのまま紐づく",
  "head は push 済みのブランチ名。チケット番号が入っていないと 400",
  "base を省くと、プロジェクトの既定ブランチへのPRになる",
  "403: キーを発行した人に GitHub のPR作成権限が無い ／ 409: 同じブランチのPRが既にある・差分が無い",
];

const MERGE_RULES = [
  "wbs のチケットに紐づいたPRだけを、bot 名義で Squash マージする（紐づいていないPRは 400）",
  "409: コンフリクト・CIの失敗・必須のチェックやレビュー承認の不足・理由の入力が必要（人が画面からマージする）",
  "403: キーを発行した人に GitHub のマージ権限が無い",
];

function pullCreateCurlSample(c: SampleContext, key: string, wbs: string): string {
  return `# 権限: すべて（「登録のみ」「読み取りのみ」のキーでは 403）
#
${commentLines("#", PULL_CREATE_RULES)}
curl -X POST ${c.baseUrl}/api/github/ticket-pull-create \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "wbs": "${wbs}",
    "head": "feature/${wbs}",
    "title": "${wbs} ログイン画面のバリデーション追加",
    "body": "## 概要\\nメールアドレス欄に入力チェックを追加"
  }'

# 応答の例
# { "ok": true, "number": 123, "url": "${PULL_URL_EXAMPLE}", "title": "…", "wbs": "${wbs}", "linked": true }`;
}

function pullCreateJsSample(c: SampleContext, wbs: string): string {
  return `// 権限: すべて（「登録のみ」「読み取りのみ」のキーでは 403）
//
${commentLines("//", PULL_CREATE_RULES)}
const API_KEY = process.env.DEV_TICKET_API_KEY;

async function createPullRequest(wbs, { head, title, body, base }) {
  const res = await fetch("${c.baseUrl}/api/github/ticket-pull-create", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ wbs, head, title, body, base }),
  });

  const json = await res.json();
  if (!res.ok) {
    // 400:ブランチ名にチケット番号が無い 401:キーが無効 403:権限不足 404:チケットが無い 409:PRが既にある・差分が無い
    throw new Error(\`\${res.status}: \${json.error}\`);
  }
  // linked が false なら、PRは作れたがチケットへの紐づけに失敗している（理由は linkError）
  if (!json.linked) console.warn(json.linkError);
  return json; // { ok, number, url, title, wbs, linked }
}

// ── ここから下が「自分のシステム」で使う部分 ──
// 例: 自社のリリースツールが push したブランチから、PRを bot 名義で作る
const pr = await createPullRequest("${wbs}", {
  head: "feature/${wbs}",
  title: "${wbs} ログイン画面のバリデーション追加",
  body: "## 概要\\nメールアドレス欄に入力チェックを追加",
});
console.log(pr.url);`;
}

function pullCreatePythonSample(c: SampleContext, wbs: string): string {
  return `# 権限: すべて（「登録のみ」「読み取りのみ」のキーでは 403）
#
${commentLines("#", PULL_CREATE_RULES)}
import os
import requests

API_KEY = os.environ["DEV_TICKET_API_KEY"]
BASE_URL = "${c.baseUrl}"


def create_pull_request(wbs, head, title, body="", base=None):
    payload = {"wbs": wbs, "head": head, "title": title, "body": body}
    if base:
        payload["base"] = base
    res = requests.post(
        f"{BASE_URL}/api/github/ticket-pull-create",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=60,
    )

    data = res.json()
    if not res.ok:
        # 400:ブランチ名にチケット番号が無い 401:キーが無効 403:権限不足 404:チケットが無い 409:PRが既にある・差分が無い
        raise RuntimeError(f"{res.status_code}: {data.get('error')}")
    # linked が False なら、PRは作れたがチケットへの紐づけに失敗している（理由は linkError）
    if not data.get("linked"):
        print("警告:", data.get("linkError"))
    return data  # {"ok", "number", "url", "title", "wbs", "linked"}


# ── ここから下が「自分のシステム」で使う部分 ──
# 例: 自社のリリースツールが push したブランチから、PRを bot 名義で作る
pr = create_pull_request(
    "${wbs}",
    head="feature/${wbs}",
    title="${wbs} ログイン画面のバリデーション追加",
    body="## 概要\\nメールアドレス欄に入力チェックを追加",
)
print(pr["url"])`;
}

function mergeCurlSample(c: SampleContext, key: string, wbs: string): string {
  return `# 権限: すべて（「登録のみ」「読み取りのみ」のキーでは 403）
#
${commentLines("#", MERGE_RULES)}
curl -X POST ${c.baseUrl}/api/github/ticket-merge \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{ "wbs": "${wbs}", "number": 123 }'

# 応答の例
# { "ok": true, "sha": "<マージコミットのSHA>", "wbs": "${wbs}", "number": 123 }`;
}

function mergeJsSample(c: SampleContext, wbs: string): string {
  return `// 権限: すべて（「登録のみ」「読み取りのみ」のキーでは 403）
//
${commentLines("//", MERGE_RULES)}
const API_KEY = process.env.DEV_TICKET_API_KEY;

async function mergePullRequest(wbs, number) {
  const res = await fetch("${c.baseUrl}/api/github/ticket-merge", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ wbs, number }),
  });

  const json = await res.json();
  if (res.status === 409) {
    // コンフリクト・CIの失敗・承認不足など。送り直しても通らないので、理由を残して人に任せる
    console.warn(json.error);
    return null;
  }
  if (!res.ok) {
    // 400:チケットに紐づいていないPR 401:キーが無効 403:権限不足 404:チケットが無い
    throw new Error(\`\${res.status}: \${json.error}\`);
  }
  return json; // { ok, sha, wbs, number }
}

// ── ここから下が「自分のシステム」で使う部分 ──
// 例: 自社のリリースツールで承認が済んだら、チケットのPRを bot 名義でマージする
await mergePullRequest("${wbs}", 123);`;
}

function mergePythonSample(c: SampleContext, wbs: string): string {
  return `# 権限: すべて（「登録のみ」「読み取りのみ」のキーでは 403）
#
${commentLines("#", MERGE_RULES)}
import os
import requests

API_KEY = os.environ["DEV_TICKET_API_KEY"]
BASE_URL = "${c.baseUrl}"


def merge_pull_request(wbs, number):
    res = requests.post(
        f"{BASE_URL}/api/github/ticket-merge",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json={"wbs": wbs, "number": number},
        timeout=60,
    )

    body = res.json()
    if res.status_code == 409:
        # コンフリクト・CIの失敗・承認不足など。送り直しても通らないので、理由を残して人に任せる
        print("マージできません:", body.get("error"))
        return None
    if not res.ok:
        # 400:チケットに紐づいていないPR 401:キーが無効 403:権限不足 404:チケットが無い
        raise RuntimeError(f"{res.status_code}: {body.get('error')}")
    return body  # {"ok", "sha", "wbs", "number"}


# ── ここから下が「自分のシステム」で使う部分 ──
# 例: 自社のリリースツールで承認が済んだら、チケットのPRを bot 名義でマージする
merge_pull_request("${wbs}", 123)`;
}

export function buildApiSample(lang: SampleLang, ctx: SampleContext, kind: SampleKind = "create"): string {
  const key = ctx.plainKey ?? KEY_PLACEHOLDER;
  const wbs = ctx.wbs ?? "T-012";
  if (kind === "read") {
    return lang === "js" ? readJsSample(ctx, wbs) : lang === "python" ? readPythonSample(ctx, wbs) : readCurlSample(ctx, key, wbs);
  }
  if (kind === "status") {
    return lang === "js" ? statusJsSample(ctx, wbs) : lang === "python" ? statusPythonSample(ctx, wbs) : statusCurlSample(ctx, key, wbs);
  }
  if (kind === "pull") {
    return lang === "js" ? pullJsSample(ctx, wbs) : lang === "python" ? pullPythonSample(ctx, wbs) : pullCurlSample(ctx, key, wbs);
  }
  if (kind === "pull-create") {
    return lang === "js" ? pullCreateJsSample(ctx, wbs) : lang === "python" ? pullCreatePythonSample(ctx, wbs) : pullCreateCurlSample(ctx, key, wbs);
  }
  if (kind === "merge") {
    return lang === "js" ? mergeJsSample(ctx, wbs) : lang === "python" ? mergePythonSample(ctx, wbs) : mergeCurlSample(ctx, key, wbs);
  }
  if (lang === "js") return jsSample(ctx);
  if (lang === "python") return pythonSample(ctx);
  return curlSample(ctx, key);
}
