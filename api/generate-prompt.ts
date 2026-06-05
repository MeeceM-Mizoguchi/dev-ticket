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

  const hasSourceFiles = sourceSection !== "なし";

  const systemPrompt = `あなたはシニアソフトウェアエンジニアです。
以下のチケット情報をもとに、ClaudeCode（AIコーディングアシスタント）に渡すための実装指示プロンプトを作成してください。
エンジニアがそのまま実装に着手できるよう、「何を・どこに・どのように」を具体的に記述してください。

【厳守ルール】
- チケット情報（タイトル・詳細・コメント）に明示されていない固有名詞（ファイルパス・関数名・カラム名・テーブル名・コンポーネント名）は、推論・想像・補完で生成しないこと。
- 不明・情報不足の箇所は「情報不足のため特定不可」と明記すること。断言せず「〜が考えられる」「要確認」等の表現を使うこと。
- チケット詳細の記述と矛盾する内容を生成しないこと。
${!hasSourceFiles ? "- 【重要】関連ソースファイルが指定されていないため、ファイルパス・ファイル名は一切記載しないこと。架空のパスを生成することを禁止する。" : "- ファイルパスは【関連ソースファイル】に記載されたもののみ使用すること。記載にないファイルパスを生成しないこと。"}

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
曖昧な表現は避け、チケット情報に記載のある範囲で具体的に記述してください。
チケット情報にない固有名詞は絶対に記述しないこと。

---

## 背景と目的
現状の課題と、この機能が必要な理由を2〜3文で説明する。ユーザーの具体的な困りごとと、実装後に解決される状態を明記する。

## 実装後のイメージ・動作例
チケット詳細に「例」「現状」「修正前」「修正後の期待値」「期待値」などの記載がある場合は、その内容をそのまま引用し、修正前と修正後を対比形式で示すこと。
記載がない場合は「チケットに具体的な動作例の記載なし」と明記し、推測で補わないこと。

記載がある場合の出力形式（該当するケースごとに繰り返す）：

### [ケース名（例：レビュー依頼通知）]

**修正前:**
```
（チケットの「例」に記載されたテキストをそのまま引用）
```

**修正後:**
```
（チケットの「修正後の期待値」に記載された内容を反映した具体的なテキストを記述）
```

**変更点:** （修正前と修正後の差分を1〜2文で簡潔に説明）

## 実装タスク分解

### DBスキーマ変更
追加・変更が必要なテーブル・カラム・インデックス・RLSポリシーを列挙する。チケット情報に記載がある場合のみ具体的に記述。不要または情報不足の場合は「なし」または「要確認」と記載。

### バックエンド / API変更
追加・変更が必要なAPIエンドポイント、サーバーサイドロジック、Supabase Edge Functions等を列挙する。チケット情報に記載がある場合のみ具体的に記述。不要または情報不足の場合は「なし」または「要確認」と記載。

### フロントエンド変更
${hasSourceFiles ? `
**新規作成ファイル（必要な場合）**
- ファイルパス — 役割の説明（【関連ソースファイル】に記載があるもののみ）

**既存ファイルの変更**
- ファイルパス — 変更内容を具体的に記述（【関連ソースファイル】に記載があるもののみ）
` : `
ファイルパスの指定がないため、ファイル名は記載しない。
変更が必要なコンポーネントや処理の「役割・機能」ベースで記述すること（例：「チケット一覧を表示するコンポーネント」など）。
`}
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
${hasSourceFiles ? `
| ファイルパス | 変更種別 | 主な変更内容 |
|---|---|---|
| （【関連ソースファイル】に記載のファイルのみ記述） | 新規 / 変更 / 削除 | 変更内容の要約 |
` : `
ファイルパスの指定がないため記載不可。実装時にエンジニアが特定すること。
`}

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
