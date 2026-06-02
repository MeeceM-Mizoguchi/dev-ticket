const PRIORITY_JA: Record<string, string> = { high: "高", medium: "中", low: "低" };
const STATUS_JA: Record<string, string> = {
  todo: "未着手", "in-progress": "作業中", "in-review": "レビュー中",
  "review-done": "レビュー完了", "stg-test": "STGテスト", uat: "UAT", done: "完了", closed: "クローズ",
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { title, description, priority, status, assignee, startDate, dueDate, estimatedHours } = req.body ?? {};
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
担当者: ${(assignee as string) || "未割り当て"}
開始日: ${startDate || "未設定"}
期限日: ${dueDate || "未設定"}
見積工数: ${estimatedHours || 0}時間

【詳細・要件】
${plainDescription || "詳細なし"}

【出力形式】
チケットの詳細・要件を読み込み、以下の「起承転結」の4セクション構成でClaudeCodeへの実装指示プロンプトを作成してください。
各セクションは見出し（## ）を付け、段落形式の文章で記述してください。箇条書きだけで終わらせず、文脈・背景・意図が伝わる説明文を必ず含めてください。
チケットの詳細に記載された具体的な情報・イメージ・注意点をすべて盛り込み、情報量の多い実践的なプロンプトにしてください。

## 背景と目的（起）
現状の仕様や課題を説明し、なぜこの機能改修が必要なのかを明確にする段落を書く。
現在の仕様の問題点・制約、それによって生じているユーザーの困りごとや運用上の課題を具体的に述べる。

## 実装内容（承）
何をどのように実装するかを具体的に説明する段落を書く。
機能の全体像と各要素の関係性・データの流れを文章で説明した後、以下の形式で具体的な実装要件を列挙する：
- 要件1
- 要件2
- ...

## 注意事項・技術的考慮点（転）
実装において特に注意すべき点を文章で説明する。既存仕様の廃止・変更による影響範囲、データ整合性、UI変更箇所、既存機能への影響など、見落としやすい考慮点を具体的に述べた後、箇条書きで列挙する：
- 考慮点1
- 考慮点2
- ...

## 完了条件（結）
この実装が完了したと判断するための基準を文章で説明する。どのような状態になれば本チケットの目的が達成されたといえるかを述べた後、具体的な受け入れ条件を箇条書きで列挙する：
- 受け入れ条件1
- 受け入れ条件2
- ...

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
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 2048,
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
