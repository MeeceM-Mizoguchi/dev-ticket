// 「他システムに組み込む」ときのサンプルコード。
//
// 画面（ApiIntegrationDialog の「組み込み」タブ）にそのまま貼れる形で返す。
// AI に渡す手順書（apiKeyPrompt.ts）とは読者が違う。あちらは AI 向けの仕様書、
// こちらは人間が自分のコードへ写すためのもの。
//
// ⚠️ ここのサンプルは api/v1/[resource].ts の実装と一致していなければならない。
//    エンドポイント・ヘッダー・上限値を変えたら、こちらも直すこと。

/** サンプルを出せる言語 */
export type SampleLang = "curl" | "js" | "python";

export const SAMPLE_LANGS: { id: SampleLang; label: string }[] = [
  { id: "curl", label: "curl" },
  { id: "js", label: "JavaScript" },
  { id: "python", label: "Python" },
];

export interface SampleContext {
  /** 例: "https://dv-ticket.com"。末尾のスラッシュは含めない */
  baseUrl: string;
  sprintId: string;
  /** 発行直後・復号できた場合のみ平文キー。無ければプレースホルダを出す */
  plainKey?: string;
}

const KEY_PLACEHOLDER = "dvt_live_ここにAPIキー";

/** 1リクエストで送れる上限（api/v1/[resource].ts と揃えること） */
export const API_LIMITS = {
  parentsPerRequest: 200,
  childrenPerParent: 50,
  requestsPerMinute: 60,
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
  }'`;
}

function jsSample(c: SampleContext): string {
  return `// Node.js 18+ / ブラウザ どちらでも動く（CORS は開放済み）
// キーはソースに書かず環境変数から読む（Gitに入れないため）
const API_KEY = process.env.DEV_TICKET_API_KEY;

async function createTickets(tickets) {
  const res = await fetch("${c.baseUrl}/api/v1/tickets", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sprintId: "${c.sprintId}", tickets }),
  });

  const json = await res.json();
  if (!res.ok) {
    // 401:キーが無効 403:プラン上限 429:リクエスト過多
    throw new Error(\`\${res.status}: \${json.error}\`);
  }

  // 担当者名や分類名が解決できなかった場合はここに理由が入る（登録自体は成功）
  if (json.warnings?.length) console.warn(json.warnings);

  return json.created; // [{ wbs: "T-054", title: "…" }]
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

console.log(created); // [{ wbs: "T-054", title: "…" }, …]`;
}

function pythonSample(c: SampleContext): string {
  return `import os
import requests

# キーはソースに書かず環境変数から読む（Gitに入れないため）
API_KEY = os.environ["DEV_TICKET_API_KEY"]
BASE_URL = "${c.baseUrl}"


def create_tickets(tickets):
    res = requests.post(
        f"{BASE_URL}/api/v1/tickets",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json={"sprintId": "${c.sprintId}", "tickets": tickets},
        timeout=30,
    )

    body = res.json()
    if not res.ok:
        # 401:キーが無効 403:プラン上限 429:リクエスト過多
        raise RuntimeError(f"{res.status_code}: {body.get('error')}")

    # 担当者名や分類名が解決できなかった場合はここに理由が入る（登録自体は成功）
    for w in body.get("warnings", []):
        print("警告:", w)

    return body["created"]  # [{"wbs": "T-054", "title": "…"}]


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

print(created)  # [{"wbs": "T-054", "title": "…"}, …]`;
}

export function buildApiSample(lang: SampleLang, ctx: SampleContext): string {
  const key = ctx.plainKey ?? KEY_PLACEHOLDER;
  if (lang === "js") return jsSample(ctx);
  if (lang === "python") return pythonSample(ctx);
  return curlSample(ctx, key);
}
