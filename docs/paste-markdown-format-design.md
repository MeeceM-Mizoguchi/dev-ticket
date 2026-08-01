# 書式つき貼り付け（Markdown → リッチ）設計書

> 対象: 外部（Claude 等）でコピーした「表・見出し・箇条書き入りテキスト」を、wiki / 議事録 / チケット説明 / コメント / ホワイトボードに貼ったときに**書式のまま**入るようにする
> ステータス: **Phase 1・2 実装済み**（2026-08-01・`pnpm build` 緑・未検証/未コミット）。Phase 3 は未着手

---

## 1. 現状の何が起きているか（原因の切り分け）

貼り付け元がクリップボードに載せる形式は 2 通りある。

| コピー元 | クリップボードの中身 | 現状の結果 |
|---|---|---|
| ブラウザ上で**選択して Cmd+C**（Claude の画面など） | `text/html` ＋ `text/plain` | HTML があるので ProseMirror が解釈し、**ほぼ書式は残る**（表・見出し・箇条書きとも） |
| Claude の**コピーボタン**、Claude Code の**ターミナル**、チャットアプリ等 | `text/plain` のみ（中身は Markdown） | **ここが問題**。`# 見出し` `| A | B |` `- 項目` が**そのままの文字列**として貼られる |
| ホワイトボードへの貼り付け | 上記いずれでも | Excalidraw は `text/plain` を**1個のテキスト要素**にするだけ。HTML は見ない |

つまり「書式が引き継がれない」の実体は **`text/plain` の Markdown が解釈されていない**こと。
（付随して、ホワイトボードは HTML すら見ていないので**どちらの経路でも**書式が落ちる。）

現状のコードでの位置づけ:

- 出ていく方向は既に Markdown 化されている: [RichEditor.tsx:861-950](../src/app/components/shared/RichEditor.tsx#L861-L950) の `clipboardTextSerializer` が、表・見出し・リスト・コードを Markdown で書き出す。[helpers.ts:198](../src/app/lib/helpers.ts#L198) の `htmlToMarkdown` も同じ写像。
- **入ってくる方向の変換だけが無い**（＝逆写像が未実装）。
- 画像 / Excel 表の貼り付けは既に手当て済み: [RichEditor.tsx:824-850](../src/app/components/shared/RichEditor.tsx#L824-L850)（BRU9-044、`clipboardHasTable` / `tsvToTableHtml`）。今回はこれと衝突しないよう別のフックに載せる。

→ **結論: 「Markdown テキスト → リッチ」の変換を 1 つ作り、RichEditor とホワイトボードの 2 経路に配線する。**

---

## 2. ゴール

| # | 要件 | 実現方法（結論） |
|---|---|---|
| ① | Claude が出した**表**を wiki / 議事録 / チケット / コメントに貼ると**表**になる | 共通コア `parseMarkdown()` → TipTap の `table` ノードへ |
| ② | 見出し・箇条書き・番号付き・太字・コード・引用・リンクも同様に維持 | 同上（TipTap スキーマの対応ノードへ） |
| ③ | 同じものを**ホワイトボード**に貼ると、表は WB の表、見出しは大きい文字…と**図として**入る | 共通コアの IR → Excalidraw 要素ジェネレータ |
| ④ | 「素の文字として貼りたい」も選べる | **Cmd/Ctrl+Shift+V** で変換を行わない（ProseMirror 標準の plain paste フラグをそのまま利用） |
| ⑤ | 誤変換しない（コードやログを貼ったときに勝手に整形しない） | `looksLikeMarkdown()` の強シグナル判定＋コードブロック内は無変換 |

**非対象**: 素の `<textarea>` / `<input>`（プロジェクト説明、スプリントゴール、バグ報告、カーソルチャット等）。値が単なる文字列なので保持する書式が存在しない。ここは現状のままで正しい。

---

## 3. アーキテクチャ

既存の記事エクスポート（HTML → IR → 3 レンダラー、[articleExport/htmlToDoc.ts](../src/app/lib/articleExport/htmlToDoc.ts)）と**同じ形**にする。入口が Markdown、出口が 2 つ。

```
text/plain (Markdown)
        │
        ▼
 looksLikeMarkdown()   ← 変換すべきか判定（誤変換の防波堤）
        │ yes
        ▼
   parseMarkdown()  →  MdBlock[]（中間表現 IR）
        │                    │
        ├── mdToHtml()       └── mdToExcalidraw()
        │        │                    │
        │        ▼                    ▼
        │   HTML文字列            Excalidraw要素[]
        │        │                    │
        │        ▼                    ▼
        │  ProseMirror DOMParser   api.updateScene()
        │   → Slice → 挿入          （表/図/テキスト）
        ▼
   RichEditor（wiki・議事録・チケット・コメント・返信・バックログ・アクションメモ）
```

### 3-1. 新規ファイル

| ファイル | 役割 |
|---|---|
| `src/app/lib/markdown/parse.ts` | `looksLikeMarkdown(text)` / `parseMarkdown(text): MdBlock[]` |
| `src/app/lib/markdown/toHtml.ts` | `mdBlocksToHtml(blocks): string`（TipTap スキーマ準拠の HTML） |
| `src/app/lib/markdown/types.ts` | IR 型定義 |
| `src/app/lib/whiteboardPasteMarkdown.ts` | IR → Excalidraw 要素、貼り付けハンドラ本体 |
| `src/app/lib/whiteboardTableCreate.ts` | 表生成の共通化（`TableToolButton` から切り出し） |

### 3-2. 中間表現（IR）

```ts
type MdInline =
  | { t: "text"; v: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean }
  | { t: "link"; href: string; children: MdInline[] };

type MdBlock =
  | { t: "heading"; level: 1|2|3|4|5|6; children: MdInline[] }
  | { t: "para";    children: MdInline[] }
  | { t: "list";    ordered: boolean; items: MdListItem[] }   // items は入れ子可
  | { t: "quote";   blocks: MdBlock[] }
  | { t: "code";    lang: string; code: string }
  | { t: "mermaid"; code: string }                            // ```mermaid の特別扱い
  | { t: "table";   header: MdInline[][]; rows: MdInline[][][] }
  | { t: "hr" };
```

### 3-3. パーサは自前で書く（marked を入れない）

理由:

1. **同期でなければならない**。ProseMirror の `clipboardTextParser` は `Slice` を**同期で返す**必要があり、遅延 import した外部ライブラリは使えない（貼り付けの瞬間に await できない）。事前ロードで誤魔化すと「初回だけ変換されない」不安定さが残る。
2. 必要なのは **TipTap スキーマが受け取れる範囲だけ**。marked が出す `<h4>`〜`<h6>` 以外の細かい記法や HTML パススルーは、どのみち ProseMirror のスキーマで落ちる。
3. 既に **逆方向（`htmlToMarkdown` / `clipboardTextSerializer`）を自前で持っている**。同じ範囲の逆写像として書けば、dev-ticket ↔ dev-ticket のコピペが**可逆**になる（これは外部ライブラリでは保証できない）。
4. 依存追加ゼロ。

規模は 250〜300 行程度（ブロック行走査 ＋ インライン正規表現の入れ子展開）。

---

## 4. 対応する記法（1 枚表）

| Markdown | IR | RichEditor（TipTap） | ホワイトボード |
|---|---|---|---|
| `# 〜 ######` | heading | `heading level=1..6` | テキスト要素（h1:28 / h2:24 / h3:20 / h4-6:18px、太めの色 `#1e1e1e`） |
| 段落 | para | `paragraph` | テキスト要素（16px・折返し幅 640px） |
| `- ` `* ` `+ ` / `1. `（入れ子・2 スペース単位） | list | `bulletList` / `orderedList`（入れ子維持） | 1 個のテキスト要素に `• 項目` / `1. 項目`＋インデント（既存 [whiteboardIndent.ts](../src/app/lib/whiteboardIndent.ts) の全角/半角規約に合わせる） |
| `- [ ]` / `- [x]` | list（checked） | `bulletList` ＋ 先頭に `☐ `/`☑ `（TaskList 拡張は未導入。導入は将来の別課題） | 同左 |
| `> ` | quote | `blockquote` | テキスト要素＋左に縦線 `line` 要素 |
| ` ```lang ` | code | `codeBlock language=lang` | monospace テキスト（fontFamily=3）＋薄グレー矩形の背景板（Phase2） |
| ` ```mermaid ` | mermaid | `MermaidNode`（`<div data-type="mermaid" data-code="…">`） | **既存の mermaid-to-excalidraw 経路を再利用**（[MermaidToolButton.tsx](../src/app/components/whiteboard/MermaidToolButton.tsx) と共有）→ 図として展開 |
| GFM 表 `\| a \| b \|` ＋ `\|---\|` | table | `table` / `tableRow` / `tableHeader` / `tableCell`（列幅は既存 `NormalizeTableWidths` と `clampTableWidths` に任せる） | **WB の表**（矩形セル＋`groupId`＋`customData.wbTable`）＋各セルにバウンドテキスト |
| `**` `__` / `*` `_` / `~~` / `` ` `` | inline marks | `bold` / `italic` / `strike` / `code` | Excalidraw に文字装飾が無いため**記号を除去した素の文字**にする（`**` を残さない＝見た目が壊れない方を優先） |
| `[text](url)` / 生 URL | link | `link` マーク（既存 `autolink` と併存） | テキスト要素＋Excalidraw の要素リンク（`element.link`）に URL を設定 |
| `---` / `***` | hr | `horizontalRule` | 横線 `line` 要素 |
| `\|` のエスケープ `\\\|`、`\*` 等 | — | 解除して文字に | 同左 |

**上限（暴走防止）**: 表は 20 列 × 200 行、リストは入れ子 6 段、全体 20 万文字までで打ち切り（超過分は素のテキストとして残す）。

---

## 5. RichEditor 側の配線

### 5-1. フックは `clipboardTextParser` を使う（`handlePaste` ではない）

ProseMirror の `parseFromClipboard`（[prosemirror-view/dist/index.js:2819](../node_modules/.pnpm/prosemirror-view@1.41.8/node_modules/prosemirror-view/dist/index.js#L2819)）を実機確認した結果、この 1 箇所だけで要件 ④⑤ がほぼ無料で満たせる:

```js
let asText = !!text && (plainText || inCode || !html);
if (asText) {
  if (inCode) { /* コードブロック内はここで短絡 = 変換されない */ }
  let parsed = view.someProp("clipboardTextParser", f => f(text, $context, plainText, view));
```

- `!html` — **text/html が無いときだけ**呼ばれる。つまり「ブラウザ選択コピー（HTML あり）」は今まで通り HTML 経路のままで、こちらは触らない。二重変換の心配がない。
- `plainText` — **Cmd/Ctrl+Shift+V のとき true**。ここで変換をスキップすれば要件 ④ が標準の作法どおりに実現できる（自前のキー監視は不要）。
- `inCode` — **コードブロック内に貼ったときは呼ばれない**。コードを貼って勝手に整形される事故が構造的に起きない。

実装イメージ（[RichEditor.tsx:823](../src/app/components/shared/RichEditor.tsx#L823) の `editorProps` に追加）:

```ts
clipboardTextParser: (text, $context, plain, view) => {
  if (plain) return undefined as any;            // Cmd+Shift+V = 素のまま（PM 既定へ）
  const tsv = tsvToTableHtml(text);              // 既存 BRU9-044 の TSV 経路もここへ集約
  const html = tsv ?? (looksLikeMarkdown(text) ? mdBlocksToHtml(parseMarkdown(text)) : null);
  if (!html) return undefined as any;            // 変換対象外 → PM 既定（改行で段落分割）
  return ProseMirrorDOMParser.fromSchema(view.state.schema)
    .parseSlice(htmlToDom(html), { preserveWhitespace: true });
},
```

- 既存の `handlePaste`（画像アップロード）は**先に走って `false` を返す**ので競合しない。`clipboardHasTable()` で画像を捨てる判定もそのまま生きる。
- 副次効果: 今は「画像が同梱されているときだけ」効いていた TSV → 表変換が、**テキストだけの貼り付けでも効く**ようになる。

### 5-2. HTML 経路の取りこぼし補強（小）

`transformPastedHTML` を足し、Claude / Notion / Word 由来の `<span style>`・`<font>`・空 `<div>` を除去する。現状でも表は入るが、余計なインラインスタイルが残って表示が崩れるケースへの保険。**Phase 2 扱い**。

### 5-3. 効く画面

`RichEditor` は 1 箇所に集約されているので、配線 1 回で以下すべてに効く:
チケット説明 / コメント / 返信（[TicketDetailPanel.tsx](../src/app/components/tickets/TicketDetailPanel.tsx)）、新規チケット（[NewTicketDialog.tsx](../src/app/components/tickets/NewTicketDialog.tsx)）、wiki（[WikiPage.tsx](../src/app/pages/WikiPage.tsx)）、議事録（[MinutesPage.tsx](../src/app/pages/MinutesPage.tsx)）、バックログ（[BacklogPage.tsx](../src/app/pages/BacklogPage.tsx)）、アクションメモ（[MyActionsPage.tsx](../src/app/pages/MyActionsPage.tsx)）。

---

## 6. ホワイトボード側の配線

### 6-0. 入力は 2 経路（text/html を先に見る）

**当初 text/plain(Markdown) だけを見ていたが、これは穴だった。** ブラウザ上で選択して Cmd+C した場合、
書式は **text/html 側にしかない**（text/plain は素の文字＝表はタブ区切りに潰れている）。
リッチエディタは ProseMirror が text/html を解釈するので気づかないが、ホワイトボードは
text/html を一切見ないため「見出しも表もただの文字」になる。そこで解釈の順序を:

1. `text/html` があれば `htmlToBlocks()`（[markdown/fromHtml.ts](../src/app/lib/markdown/fromHtml.ts)）で IR へ
2. 無い / ただの段落だけだった場合は `text/plain` を Markdown として解釈

とし、どちらも同じ IR → Excalidraw レンダラーへ合流させる。`hasRichBlocks()`（段落以外のブロックを
含むか）が false なら横取りせず Excalidraw の既定に任せる ＝ 単なる文章や画像単体の貼り付けは従来どおり。

### 6-1. 横取りの方法

Excalidraw は `document` に `paste` を張って自前処理する（テキスト→テキスト要素、TSV→グラフ化ダイアログ、画像→画像要素）。これより**先**に処理するため、キャンバスのラッパー要素に**キャプチャ段階**で `paste` を張り、変換したときだけ `preventDefault()` ＋ `stopImmediatePropagation()` する。既存の [WhiteboardCanvas.tsx:414](../src/app/components/whiteboard/WhiteboardCanvas.tsx#L414) 等の keydown キャプチャと同じ流儀。

**素通しする条件**（この場合 Excalidraw 既定の挙動をそのまま使う）:

- 閲覧モード / 読み取り専用
- **テキスト要素の編集中**（`document.activeElement` が Excalidraw の wysiwyg textarea）… 1 要素に複数書式は持てないため。ただし Markdown 記号だけ落とした「素の整形テキスト」にする案は Phase 3 で検討
- `looksLikeMarkdown(text)` が false
- **Shift を押しながらの貼り付け**（直近 keydown を見て判定。RichEditor 側の Cmd+Shift+V と体験を揃える）
- クリップボードに画像 / Excalidraw のネイティブ JSON がある

### 6-2. ブロック → 要素の生成

- 生成位置: 直近のポインタ座標（シーン座標）。取れなければ既存 `viewportCenter()` と同じ計算でビューポート中央。
- 縦にスタック。ブロック間 24px、折返し幅 640px（文字幅計測は既存 [whiteboardText.ts](../src/app/lib/whiteboardText.ts) の `lineW` / `wrapText` を流用）。
- 生成は `convertToExcalidrawElements()` → `api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY })`。**貼り付け全体で undo 1 ステップ**。
- 生成直後に**貼り付けた要素だけを選択状態**にする（選択自体は履歴に残さない＝`NEVER`）。
- Yjs への同期は既存の `onChange` 経路に乗るので追加作業なし。

### 6-3. 表の生成は `TableToolButton` から共通化

[TableToolButton.tsx:33-80](../src/app/components/whiteboard/TableToolButton.tsx#L33-L80) の `insertTable()` を `whiteboardTableCreate.ts` へ切り出し、
`createTableElements({ x, y, rows, cols, cells })` にする（`cells` は各セルの文字列。既存ボタンは `cells` 無しで呼ぶ＝**挙動不変**）。

- セル = `rectangle`＋`customData.wbTable = { tid, r, c }`＋同一 `groupId`（既存仕様どおり）
- ヘッダー行は既存と同じ薄グレー `#f1f3f5`
- 各セルに**バウンドテキスト**を持たせる（`containerId`）。列幅は文字幅計測から初期値を決め、最終的な整形は既存 `reflowTables()` に任せる
- **既存の表機能（列幅ドラッグ、行列挿入/削除、`reflowTables`）がそのまま使える**のが要点

### 6-3b. リンク

Excalidraw には**インラインのリンク（文中の一部だけをリンクにする）が無く**、持てるのは
「要素1つにつき URL 1本」（`element.link`。クリックで開ける・リンクアイコンが出る）だけ。
そこで:

- **表のセル**: セル内のリンクが**ちょうど1本**なら、そのセル矩形の `element.link` にする
- **見出し / 段落 / リスト / 引用**: そのブロック内のリンクが**ちょうど1本**なら、テキスト要素の `element.link` にする
- どちらも「文字全体がそのリンク」のときは**文字色を青(#1971c2)** にして、wiki と同じく“リンクである”ことを見せる
  （色の"正"は `customData.wbTextColor` に書く。書かないと `pinBoundTextColor` が線色から決め直して青が消える）
- 相対URL(`/PROJxxx/wiki/...`)は `new URL(href, location.href)` で絶対URLに直す。`javascript:` 等は捨てる
- リンクが2本以上あるブロック（例: 1つの段落に複数リンク）は、要素リンクを付けない（どれを選ぶべきか決まらないため）

### 6-4. mermaid

` ```mermaid ` フェンスは、[MermaidToolButton.tsx](../src/app/components/whiteboard/MermaidToolButton.tsx) が使っている `@excalidraw/mermaid-to-excalidraw` の呼び出しを共通関数に切り出して再利用し、**図として**展開する。ここだけ非同期になるため、`preventDefault()` した後に `await` して挿入する（他ブロックの挿入とまとめて 1 トランザクションにするか、mermaid だけ後追い挿入にするかは実装時に決定。前者を優先）。

---

## 7. 誤変換を防ぐ判定（`looksLikeMarkdown`）

**強シグナルが 1 つ以上**あるときだけ true。

- ` ``` ` で始まるフェンスが 1 組以上
- 行頭 `#{1,6}␣` が 1 行以上
- GFM 表（`|` を含む行が 2 行以上、かつ `|---|` 形式の区切り行が存在）
- 行頭のリストマーカー（`- ` `* ` `+ ` `1. `）が **2 行以上**
- `**太字**` または `` `code` `` が **2 箇所以上**
- `[文字](URL)` が 1 つ以上

**除外**（強シグナルがあっても変換しない）:

- 先頭が `{` `[` `<` で全体が JSON / XML / HTML っぽい
- 行の 6 割以上が `;` `)` `}` で終わる（＝コード片）
- 全体が 1 行かつ強シグナルが「リンク 1 個」だけ（URL 単体貼り付けは既存 `autolink` に任せる）

判定を外した場合の逃げ道は 3 つあるので、多少の誤検知は致命傷にならない: **Cmd+Shift+V**、**Cmd+Z（1 ステップで戻る）**、**コードブロック内は構造的に無変換**。

---

## 8. 段階実装

| Phase | 内容 | 完了条件 |
|---|---|---|
| **1** | `markdown/` コア（parse / toHtml / 判定）＋ RichEditor の `clipboardTextParser` 配線 | Claude のコピーボタンで取った「見出し＋表＋箇条書き」を wiki / 議事録 / チケット / コメントに貼って、そのままの書式で入る。Cmd+Shift+V で素の文字。 |
| **2** | ホワイトボード貼り付け（表・見出し・段落・リスト・mermaid・区切り線） | 同じクリップボードを WB に貼ると、表は WB の表、mermaid は図、見出しは大きい文字で入る。undo 1 回で全消え。 |
| **3**（任意・未着手） | ターミナル由来の**罫線表**（`│ ─ ├`）の検出、`#WBS` / `@名前` の**メンション復元**、`transformPastedHTML` の掃除、WB テキスト編集中の記号除去、TaskList 拡張の導入 | 個別に判断 |

Phase 1 だけで体感課題（表と見出しが崩れる）はほぼ解消する。Phase 2 は独立して後追い可能。

---

## 9. 影響ファイル

**新規**（実装済み）
- `src/app/lib/markdown/types.ts` / `parse.ts` / `toHtml.ts` / `fromHtml.ts` / `index.ts`
- `src/app/lib/whiteboardPasteMarkdown.ts`
- `src/app/lib/whiteboardTableCreate.ts`
- `src/app/lib/whiteboardMermaid.ts`（mermaid 変換を MermaidToolButton から切り出し）

**変更**（実装済み）
- [RichEditor.tsx](../src/app/components/shared/RichEditor.tsx) — `editorProps` に `clipboardTextParser`（＋Phase2 で `transformPastedHTML`）。既存 `handlePaste` は無変更
- [WhiteboardCanvas.tsx](../src/app/components/whiteboard/WhiteboardCanvas.tsx) — キャプチャ段階の `paste` リスナー登録（1 つの `useEffect`）
- [TableToolButton.tsx](../src/app/components/whiteboard/TableToolButton.tsx) — `insertTable` を共通関数へ委譲（**挙動不変**のリファクタ）
- [MermaidToolButton.tsx](../src/app/components/whiteboard/MermaidToolButton.tsx) — mermaid 展開部を共通関数へ委譲（同上）
- [whiteboardAutoConnect.ts](../src/app/lib/whiteboardAutoConnect.ts) — 貼り付けで作る飾りの線（`customData.wbDecor`＝水平線・引用の縦線）を自動接続の対象外に（1行）

DB 変更・環境変数・依存追加は**なし**。

---

## 10. 検証（本リポジトリは `tsc` が通らないため `pnpm build` が唯一のゲート）

1. **Claude のコピーボタン**で「見出し＋段落＋GFM 表＋入れ子箇条書き＋コードブロック」を含む回答をコピー → wiki / 議事録 / チケット説明 / コメント / 返信 / アクションメモにそれぞれ貼る
2. 同じものを **Cmd+Shift+V** → 素の Markdown 文字列のまま入る
3. **コードブロックの中**に貼る → 変換されない
4. **Excel の表**を貼る（BRU9-044 の回帰）→ 画像化されず表になる
5. **画像**を貼る → 従来どおりアップロードされる
6. **ブラウザ選択コピー（HTML あり）**で貼る → 従来どおり（デグレなし）
7. 貼った直後に **Cmd+Z** → 1 回で貼り付け前に戻る
8. ホワイトボードに貼る → 表は WB 表（列幅ドラッグ・行列追加が効く）、mermaid は図、undo 1 回で全消え、他メンバーの画面にも同期
9. ホワイトボードで**テキスト編集中**に貼る → 従来どおり素のテキスト
10. `pnpm build` が緑

---

## 11. 既知の割り切り

- Excalidraw のテキストは**部分的な太字/斜体を持てない**。WB では装飾記号を落とした素の文字にする（記号を残す方が情報は多いが、見た目の破綻が大きいため）。
- 素の `<textarea>`（プロジェクト説明・スプリントゴール等）は対象外。書式を持てる器ではない。
- 表のセル内の**改行・入れ子リスト**は 1 行に潰す（GFM 表の制約に合わせる）。
- `#WBS` / `@名前` のメンション復元は Phase 3。Phase 1〜2 では**ただの文字**として貼られる（現状と同じ）。
