const PRIORITY_JA: Record<string, string> = { high: "高", medium: "中", low: "低" };
const STATUS_JA: Record<string, string> = {
  todo: "未着手", "in-progress": "作業中", "in-review": "レビュー中",
  "review-done": "レビュー完了", "stg-test": "STGテスト", uat: "UAT", done: "完了", closed: "クローズ",
};

function stripHtml(html: string): string {
  return (html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const {
    title,
    description,
    priority,
    status,
    assignee,
    startDate,
    dueDate,
    estimatedHours,
    categoryName,
    comments,
    childTickets,
    sourceFiles,
  } = req.body ?? {};

  if (!title) return res.status(400).json({ error: "title is required" });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: "Groq API key not configured" });

  const plainDescription = stripHtml(description);

  // コメント履歴（最新10件、テキストのみ）
  const commentSection = Array.isArray(comments) && comments.length > 0
    ? comments
        .slice(-10)
        .map((c: { userName?: string; content?: string; commentType?: string }) =>
          `[${c.commentType ?? "comment"}] ${c.userName ?? "不明"}: ${stripHtml(c.content ?? "").slice(0, 300)}`
        )
        .join("\n")
    : "なし";

  // 子チケット一覧
  const childSection = Array.isArray(childTickets) && childTickets.length > 0
    ? childTickets.map((c: { title?: string; status?: string }) => `- ${c.title ?? ""}（${STATUS_JA[c.status ?? ""] ?? c.status ?? ""}）`).join("\n")
    : "なし";

  // 関連ソースファイル
  const sourceSection = Array.isArray(sourceFiles) && sourceFiles.length > 0
    ? sourceFiles.map((f: { name?: string; path?: string }) => `- ${f.name ?? f.path ?? ""}`).join("\n")
    : "なし";

  const systemPrompt = `あなたはシニアソフトウェアエンジニアです。
以下のチケット情報をもとに、ClaudeCode（AIコーディングアシスタント）に渡すための実装指示プロンプトを作成してください。
エンジニアがそのまま実装に着手できるよう、「何を・どこに・どのように」を具体的に記述してください。

【チケット情報】
タイトル: ${title}
カテゴリ: ${categoryName || "未設定"}
優先度: ${PRIORITY_JA[priority] ?? priority}
ステータス: ${STATUS_JA[status] ?? status}
担当者: ${(assignee as string) || "未割り当て"}
開始日: ${startDate || "未設定"}
期限日: ${dueDate || "未設定"}
見積工数: ${estimatedHours || 0}時間

【詳細・要件】
${plainDescription || "詳細なし"}

【コメント履歴（要件の補足として参照）】
${commentSection}

【子チケット】
${childSection}

【関連ソースファイル】
${sourceSection}

【出力形式】
以下のセクション構成で、エンジニアがすぐ実装着手できる詳細な実装指示プロンプトを作成してください。
チケットの詳細・要件・コメントに書かれた情報を必ずすべて反映してください。
曖昧な表現は避け、具体的なテーブル名・カラム名・コンポーネント名・関数名・ファイルパスのレベルで記述してください。

---

## 背景と目的
現状の課題と、この機能が必要な理由を2〜3文で説明する。ユーザーの具体的な困りごとと、実装後に解決される状態を明記する。

## 実装タスク分解

### DBスキーマ変更
追加・変更が必要なテーブル・カラム・インデックス・RLSポリシーを列挙する。不要な場合は「なし」と記載。

### バックエンド / API変更
追加・変更が必要なAPIエンドポイント、サーバーサイドロジック、Supabase Edge Functions等を列挙する。不要な場合は「なし」と記載。

### フロントエンド変更

**新規作成ファイル（必要な場合）**
- `ファイルパス` — 役割の説明

**既存ファイルの変更**
- `ファイルパス` — 変更内容を具体的に記述

各コンポーネント・関数の変更について、props・state・処理フロー・UIの変化を具体的に説明する。

## データフロー
主要なユーザー操作から始まり、フロントエンド → API → DB → フロントエンドの流れを箇条書きで説明する。
重複排除・エラー処理・副作用（通知・キャッシュ更新等）がある場合も含める。

## 注意事項・技術的考慮点
実装で見落としやすいポイントを列挙する：
- 既存機能への影響範囲
- パフォーマンス・N+1・ポーリングとの競合
- 権限・RLS・isSupabaseEnabled フラグの考慮
- UIの後方互換性（既存 propsをオプショナルにするなど）

## 変更ファイル一覧

| ファイルパス | 変更種別 | 主な変更内容 |
|---|---|---|
| path/to/file | 新規 / 変更 / 削除 | 変更内容の要約 |

## 完了条件（受け入れ基準）

以下のすべてをチェックリスト形式で列挙する。「〜できる」「〜される」という動作ベースで書く：
- [ ] 受け入れ条件1
- [ ] 受け入れ条件2

---

プロンプト本文のみを出力してください（説明文や前置きは不要です）。`;

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: systemPrompt }],
          temperature: 0.2,
          max_tokens: 4096,
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: "Groq API error: " + err });
    }

    const data = await response.json();
    const generated: string = data.choices?.[0]?.message?.content ?? "";
    if (!generated) return res.status(500).json({ error: "プロンプトの生成に失敗しました" });

    res.json({ prompt: generated });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Unknown error" });
  }
}
