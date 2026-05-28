const PRIORITY_JA: Record<string, string> = { high: "高", medium: "中", low: "低" };
const STATUS_JA: Record<string, string> = {
  todo: "未着手", "in-progress": "作業中", "in-review": "レビュー中",
  "review-done": "レビュー完了", "stg-test": "STGテスト", uat: "UAT", done: "完了", closed: "クローズ",
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { title, description, priority, status, assignees, startDate, dueDate, estimatedHours } = req.body ?? {};
  if (!title) return res.status(400).json({ error: "title is required" });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: "Groq API key not configured" });

  const plainDescription = (description || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

  const prompt = `あなたはソフトウェア開発プロジェクトのAIアシスタントです。
以下のチケット情報をもとに、ClaudeCode（AIコーディングアシスタント）に貼り付けるための実装指示プロンプトを日本語で作成してください。

【チケット情報】
タイトル: ${title}
優先度: ${PRIORITY_JA[priority] ?? priority}
ステータス: ${STATUS_JA[status] ?? status}
担当者: ${(assignees as string[] ?? []).join(", ") || "未割り当て"}
開始日: ${startDate || "未設定"}
期限日: ${dueDate || "未設定"}
見積工数: ${estimatedHours || 0}時間

【詳細・要件】
${plainDescription || "詳細なし"}

【出力形式】
ClaudeCodeへの指示として、以下を含む明確なプロンプトを作成してください:
1. 実装すべき機能の概要（1〜2文）
2. 具体的な実装要件・技術的な指示（箇条書き）
3. 受け入れ条件（完了の定義、箇条書き）

プロンプトのみを出力してください（説明文や前置きは不要です）。`;

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
          messages: [{ role: "user", content: prompt }],
          temperature: 0.4,
          max_tokens: 1024,
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