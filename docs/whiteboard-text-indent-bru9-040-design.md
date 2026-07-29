# BRU9-040 ホワイトボード テキスト／図形ラベルのインデント — 設計書

> 分類: 機能追加 / 実装は本設計の承認後に別途着手する。

## 0. 要望

テキストボックスや図形にテキストを入力したとき、**行頭に余白（インデント）を入れられる**ようにしたい。

- 添付画像のように、枠の左端から少し離して文字を置けると読みやすい。
- **細かい単位**でインデント量を刻めるとさらに便利。
- **改行したときも、そのインデントに合わせて**次の行が始まってほしい。

---

## 1. 現状調査 — Excalidraw 標準に何があり、何が足りないか

`@excalidraw/excalidraw@0.18.1` のテキストエディタ（`.excalidraw-wysiwyg` = 生の `<textarea>`）を実装レベルで確認した。

| 項目 | 現状 | 出典（dist/dev） |
|---|---|---|
| Tab / Shift+Tab でインデント・アウトデント | **既にある** | `index.js:24262-24320`（`indent()` / `outdent()`） |
| Ctrl/Cmd + `]` / `[` でも同じ | **既にある** | 同上 |
| インデント幅 | **半角スペース4個で固定**（`TAB_SIZE = 4`） | `index.js:24274` |
| インデント用のUI（ボタン等） | **無い**（キーボードのみ・完全に非発見的） | — |
| 改行時にインデントを継ぐ | **無い**（Enter は素の改行のみ。Ctrl+Enter と Esc だけが確定キー） | `index.js:24251-24261` |
| タブ文字 `\t` | 入力されても `normalizeText` が**半角スペース8個へ置換** | `chunk-4FTI6OG3.js:1859` |
| 確定時のテキスト | `nextOriginalText: editable.value` = **trim されない**（行頭空白はそのまま `originalText` へ残る） | `index.js:24389` |
| 折り返し `wrapText` | 幅に収まる行は**そのまま push**（行頭空白は保持）。溢れた行のみ分割し、分割時は `trimEnd()` のみ＝**行頭は削らない** | `chunk-4FTI6OG3.js:2200-2250` |
| SVG エクスポート | `<text style="white-space: pre">` を明示指定 | `chunk-4FTI6OG3.js:17771` |

### 結論

**「行頭の半角スペース」は Excalidraw のあらゆる経路（描画・折り返し・確定・Yjs同期・PNG/SVGエクスポート）を無傷で通る。**
つまりインデントの土台は既に存在していて、足りないのは次の3点だけ。

1. **刻みが粗い** — 4スペース固定。要望の「細かい単位」に応えられない。
2. **UIが無い** — Tab が効くことを誰も知らない（本要望自体がその証左）。
3. **改行でインデントが継がれない** — 要望の中核が未実装。

→ 新方式を発明するのではなく、**この3点を埋める**のが本設計。

---

## 2. 設計方針 — インデントの実体は「テキスト自身の行頭スペース」

### 2.1 真実の値をどこに置くか

**`customData` に段数を持たず、`originalText` の行頭スペースそのものを唯一の真実とする。**

| | 採用案: テキストに焼き込む | 代替案: `customData.wbIndent` に段数を持ち onChange で空白を再生成 |
|---|---|---|
| 描画・折返し | Excalidraw ネイティブ任せ | 同左 |
| エクスポート / Yjs同期 | **自動で正しい**（ただの文字列） | 同左 |
| onChange ヘルパー追加 | **不要（0本）** | 必要（生成・追従・自己修復） |
| 既存ヘルパーとの綱引き | **構造的に起きない** | 編集中に「消しては書き戻す」→ちらつき懸念 |
| 行ごとに違うインデント | **できる** | 段数が要素単位なので不可（全行一律） |
| あとから刻み幅を変えて再計算 | できない（既存の空白は空白のまま） | できる |

このコードベースは `onChange` 内の自作ヘルパー同士の綱引きで繰り返し不具合を出しており
（`whiteboardBoundText.ts` 冒頭・`whiteboardShapeFit.ts` 冒頭のコメント、BRU5-063 / BRU6-011 / BRU7-043 参照）、
**新しい onChange 副作用を一本も増やさない**採用案の価値が、「刻み幅の遡及変更」より明確に大きい。
また「行ごとに違うインデント」が可能なのは、要望の「改行時にインデントを継ぐ」＝行単位の概念と自然に噛み合う。

→ **採用案（テキストに焼き込む）**。

### 2.2 インデントの単位と刻み

- **最小単位 = 半角スペース1個（U+0020）**。`fontSize:20` で約 5〜6px ＝ **全角1文字の約 1/4**。
- **1段 = N スペース**。N はユーザーが選べる: **細かい(1) / 標準(2) / 広い(4)**。**既定は 2**（標準の半分＝要望どおり細かくなる）。
- N は**ボードのデータではなく編集者ごとの好み**なので `localStorage`（キー `wb.indentStep`）に保持し、**Yjs には流さない**。

> **これより細かくできない理由**: U+2009(THIN SPACE) 等の可変幅スペースを使えば理屈上は 1/2 スペースも刻めるが、
> Excalidraw の既定フォント（Excalifont / Virgil / Nunito / Comic Shanns）にグリフが無く、
> **フォールバック先のフォント幅に依存して端末ごとに幅が変わる**。共同編集ボードで見た目が人により変わるのは不可。
> → 半角スペース1個を最小単位とする（これでも十分細かい）。

---

## 3. 機能仕様

### 3.1 キーボード（テキスト編集中）

| キー | 動作 |
|---|---|
| `Tab` | カーソル行（選択があれば選択にかかる全行）の行頭に **1段（N スペース）追加** |
| `Shift + Tab` | 同じ行から **インデント側のスペースを最大 N 個削除** |
| `Ctrl/Cmd + ]` / `[` | 上と同じ（Excalidraw 標準の別名を踏襲） |
| `Enter` | 改行し、**直前の行のインデントを引き継いで**次行を開始（＝自動インデント） |

- **中央揃え（`textAlign: "center"`）の要素では上記キーはすべて何もしない**（§3.4）。
  Excalidraw 標準の4スペース挿入も走らないよう、`preventDefault` だけして黙って無視する。
- いずれも **IME変換中（`isComposing` または `keyCode === 229`）は何もしない**。
  日本語変換の確定 Enter でインデントが入るのを防ぐ（既存の `WhiteboardCanvas.tsx:301-313` と同じ考え方）。
- Enter の引き継ぎ量は「インデント側のスペースのうち**キャレット位置まで**」とする
  （行頭の空白の途中で改行した場合に、余分な空白を継がない一般的なエディタ挙動。右揃えでは行末側で同じ判定）。

### 3.2 パネルUI（発見性）

既存の書式パネルに **「インデント」セクション**を追加する。

```
┌ インデント ─────────────────┐
│  [ ⇤ ]  [ ⇥ ]     刻み: (細)(標準)(広) │
│  Tab / Shift+Tab でも変更できます      │
└────────────────────────────┘
```

- `⇥` = 1段増やす / `⇤` = 1段減らす。
- 「刻み」= §2.2 の N（1 / 2 / 4）。ボタンにもキーボードにも同じ N が効く。
- **編集中**（`.excalidraw-wysiwyg` が開いている）は Tab と完全に同じ動作＝**カーソル行だけ**に効く。
- **非編集中**（要素を選択しているだけ）は **その要素の全行**に効く（添付画像のような1行テキストではこれが自然）。
- ボタンは `onMouseDown={e => e.preventDefault()}` でフォーカスを奪わない（このコードベースの既存流儀）。
- **中央揃えの要素では ⇤ / ⇥ を非活性**にし、`title` で理由を出す（「中央揃えではインデントできません」）。
  セクション自体は出したままにする（消えると「機能が無い」と誤解されるため）。

### 3.3 対象要素

| 対象 | 可否 | 備考 |
|---|---|---|
| 素のテキストボックス（`isPlainTextBox`） | ○ | 添付画像のケース |
| 図形のラベル（rectangle / ellipse / diamond のバインドテキスト） | ○ | 要望の「図形にテキストを入力した際」 |
| 表のセル（`isTableCell` のバインドテキスト） | ○ | 同じ textarea なので自動で効く |
| 矢印・線のラベル | ○（副次的に効く） | 積極的に検証はしない |
| フレーム名の入力欄 | **×** | `.excalidraw-wysiwyg` ではないので対象外（横取りしない） |
| カーソルチャット入力 | **×** | 同上 |

### 3.4 `textAlign` の扱い（**決定済み**）

**対応するのは左揃え・右揃えのみ。中央揃えは非対応。**（`textAlign` を勝手に書き換えることはしない）

インデントは「揃えている辺から文字を離す」操作なので、**空白を入れる側は揃えの向きで反転する**。

| `textAlign` | 空白を入れる位置 | 見え方 | 対応 |
|---|---|---|---|
| `left`（左揃え） | **行頭**（先頭スペース） | 文字が右へ寄る＝**左インデント**（添付画像） | ○ |
| `right`（右揃え） | **行末**（末尾スペース） | 文字が左へ寄る＝**右インデント** | ○ |
| `center`（中央揃え） | — | 行全体が中央に置かれるため、どちら側に空白を入れても**入れた量の半分しか動かず**、反対側にも同じだけ余白が生まれる | **×（何もしない）** |

**右揃えで「行頭」ではなく「行末」に入れる理由**: 右揃えの行は右端を基準に描かれるので、
行頭に空白を入れても**文字は1ミリも動かない**（空白は左側の余白に飲まれるだけ）。
行末に入れて初めて、右端から文字が離れる＝ユーザーが期待するインデントになる。

**中央揃えのときの挙動**（要素選択時／編集中とも）:

- パネルの ⇤ / ⇥ は非活性（§3.2）。
- `Tab` / `Shift+Tab` / `Ctrl+[` `]` は **`preventDefault` して何もしない**。
  素通しすると Excalidraw 標準の「4スペース挿入」が走り、**中央揃えのまま半端に文字がずれる**（＝今回避けたい挙動）ため、
  ここは意図的に握り潰す。
- `Enter` は**素通し**（Excalidraw 標準の改行のまま）。継ぐインデントが存在しないので自前処理に入る意味がない。

> 図形のラベルは Excalidraw 既定が `center` なので、初期状態ではインデントできない。
> ユーザーは標準の整列ボタンで左揃え（または右揃え）に変えてから使う。
> パネルの非活性ツールチップがその導線になる。

---

## 4. 実装設計

### 4.1 新規 `src/app/lib/whiteboardIndent.ts`

インデントの計算・適用を1か所に集約する。**onChange 副作用は持たない**（呼ばれた時だけ動く純粋なユーティリティ）。

```ts
export const INDENT_STEPS = [1, 2, 4] as const;      // 細 / 標準 / 広
export function readIndentStep(): number;             // localStorage "wb.indentStep"（既定 2）
export function writeIndentStep(n: number): void;

// インデントを入れる側。textAlign から決まる（§3.4）。center は null＝インデント不可。
export type IndentSide = "start" | "end";
export function indentSideOf(el: any): IndentSide | null;
//   textAlign === "right" → "end" ／ "center" → null ／ それ以外(left・未設定) → "start"

// ── 文字列レベル（テスト可能な純関数） ──
export function padCount(line: string, side: IndentSide): number;   // 行頭/行末の連続スペース数
export function shiftLines(
  text: string, delta: number, step: number, side: IndentSide, from?: number, to?: number,
): string;
//   delta: +1 / -1（段）。from/to は文字オフセット範囲（省略時は全行）。

// ── textarea レベル（編集中） ──
export function indentEditor(ta: HTMLTextAreaElement, delta: number, step: number, side: IndentSide): void;
export function newlineWithIndent(ta: HTMLTextAreaElement, side: IndentSide): void;

// ── 要素レベル（非編集中） ──
export function indentElements(api: any, ids: string[], delta: number, step: number): void;
//   要素ごとに indentSideOf() を引き、null（中央揃え）の要素は黙って読み飛ばす
```

**`side` による違いは「スペースを付け外しする位置」だけ**で、行の切り出し・段数計算・undo の扱いは共通。
`side: "end"` のときのキャレット挙動は次のとおり:

- `Tab`（増やす）… 行末にスペースを追加する。**キャレットは動かさない**
  （`side:"start"` では追加分だけ右へずらすが、行末追加では文字位置が変わらないため）。
- `Enter`… キャレットのある行の**行末スペース数**を数え、改行後にその数だけスペースを入れ、
  **キャレットは挿入したスペースの手前**へ置く（次に打った文字が行末スペースの内側に入るようにする）。

#### `indentEditor` / `newlineWithIndent`（undo を壊さない）

`textarea.value` を直接書き換えると **textarea 自身の undo スタックが消える**
（Excalidraw 標準の `indent()` はこれをやっており、Tab の直後に Ctrl+Z が効かない既知の粗さがある）。

- **キャレットのみ（選択なし）の Tab / Enter** — `document.execCommand("insertText", false, str)` で挿入する。
  ネイティブ undo が保たれ、`input` イベントも自動で発火する（Excalidraw の textarea 自動リサイズがそのまま動く）。
- **Shift+Tab（削除）／複数行選択** — 対象範囲を `setSelectionRange` で選び `execCommand("insertText", false, 置換後文字列)` で一括置換する。
  これも1操作として undo できる。
- `execCommand` が `false` を返した環境では、`value` 直書き＋`ta.dispatchEvent(new Event("input"))` にフォールバック
  （＝現行 Excalidraw と同等の挙動まで劣化するだけで、機能は失われない）。

#### `indentElements`（非編集中）

対象テキスト要素の `originalText` を `shiftLines` で書き換え、**寸法を再計算**して `updateScene(..., COMMIT)`（1 undo ステップ）。

寸法計算は **Excalidraw の `refreshTextDimensions` が非公開**なため、コードベースに既にある自前計測を再利用する
（`whiteboardText.ts` の `fontString` / `lineW` / `wrapText`。`whiteboardShapeFit.ts` の `maxTextWidth` と同じ式）:

- **素のテキストボックス（`autoResize` 既定）**: `text = originalText`、`width = max(lineW)`、`height = 行数 × fontSize × lineHeight`。
  空白込みで幅が伸び、`x` は動かない。
  - 左揃え → 枠は右へ伸び、**文字だけ右へずれる**（添付画像どおり）。
  - 右揃え → 枠が右へ伸び、**文字は元の位置に留まる**＝枠の右端との間に余白ができる（右インデント）。
- **幅固定のテキストボックス（`autoResize:false`）／バインドテキスト**: `wrapText(originalText, font, maxW)` で `text` を作り、
  `width`/`height` を更新。**コンテナの高さ調整と再センタリングは既存の `fitBoundTextShapes` / `reflowTables` /
  `healEscapedBoundText` が次の onChange で自動収束させる**ため、こちらでは触らない（二重制御を避ける）。

### 4.2 エディタキー横取りの配線（`WhiteboardCanvas.tsx`）

`.excalidraw-wysiwyg` は `excalidraw-textEditorContainer` 配下（＝`containerRef` の内側）に生成され
（`index.js:24481`）、Excalidraw のキー処理は **textarea 自身の `onkeydown` プロパティ**に付いている（`index.js:24416`）。
→ **`containerRef` に capture 段階のリスナを1本足せば、Excalidraw のハンドラより先に握れる。**

```ts
// 既存の IME用 onKeyDownCapture（WhiteboardCanvas.tsx:301-313）と同じ場所・同じ流儀で追加する
useEffect(() => {
  const el = containerRef.current;
  if (!el || !canEdit) return;
  const onKey = (e: KeyboardEvent) => {
    const ta = e.target as HTMLTextAreaElement | null;
    if (!ta?.classList?.contains("excalidraw-wysiwyg")) return;   // フレーム名・チャット等は対象外
    if (e.isComposing || (e as any).keyCode === 229) return;      // IME変換中は一切触らない

    const isTab = e.key === "Tab"
      || (isCtrlOrCmd(e) && (e.code === "BracketLeft" || e.code === "BracketRight"));
    const isPlainEnter = e.key === "Enter" && !e.shiftKey && !isCtrlOrCmd(e) && !e.altKey;
    if (!isTab && !isPlainEnter) return;

    // 編集中要素の揃え方向を見る（getEditingTextEl は whiteboardText.ts の既存API）。
    const side = indentSideOf(getEditingTextEl() ?? api.getAppState()?.editingTextElement);
    if (!side) {
      // 中央揃え（§3.4）: Tab は標準の4スペース挿入ごと握り潰す。Enter は素通し。
      if (isTab) { e.preventDefault(); e.stopPropagation(); }
      return;
    }

    e.preventDefault(); e.stopPropagation();                      // Excalidraw の 4スペース版／素の改行を置き換える
    if (isTab) indentEditor(ta, e.shiftKey || e.code === "BracketLeft" ? -1 : +1, readIndentStep(), side);
    else newlineWithIndent(ta, side);
  };
  el.addEventListener("keydown", onKey, true);
  return () => el.removeEventListener("keydown", onKey, true);
}, [api, canEdit]);
```

**注意点（実装時に必ず守る）**

- 既存の IME用ハンドラも同じ `containerRef` の capture に付いている。`stopPropagation()` は
  **同一ノード上の他リスナは止めない**ので、上のハンドラは自前で `isComposing` を判定する必要がある（上記のとおり）。
  逆に `stopImmediatePropagation()` は**使わない**（既存のIME対策を壊すため）。
- `Ctrl/Cmd + Enter`・`Escape`（＝確定）と `Shift + Enter` は**素通し**する。Excalidraw 標準の確定動作を変えない。
- `canEdit === false`（閲覧専用）では配線しない。

### 4.3 パネルUI の置き場所

**新しい portal パネルは作らない。** `.App-menu__left .panelColumn` への差し込み位置は
`TextBoxFormatPanel` と `TextColorPanel` が既に取り合っており（両ファイル冒頭のコメント参照）、
3本目を足すと DOM 位置の奪い合いが起きる。

→ **共通の `<IndentField>` コンポーネント（`ColorSwatch.tsx` と同じ「部品」レイヤ）を作り、
既存の2パネルがそれぞれ自分の `fieldset` 群の末尾に描画する。**

| パネル | 表示条件（既存の判定をそのまま使う） | 追加内容 |
|---|---|---|
| `TextBoxFormatPanel` | 素のテキストボックス単体選択（`isPlainTextBox`） | 「枠線」の下に `<IndentField>` |
| `TextColorPanel` | ラベルを持ち得る図形／編集中のテキスト（`canHaveLabel`） | 「文字色」の下に `<IndentField>` |

`<IndentField>` の責務:

1. 「編集中の textarea があるか」を自分で見て、`indentEditor`（カーソル行）か `indentElements`（全行）かを切り替える。
2. 対象の `indentSideOf()` を引き、`null`（中央揃え）なら ⇤ / ⇥ を非活性にして `title` で理由を出す（§3.2）。
   図形が選択されている場合は**そのバインドテキストの `textAlign`** を見る（図形自身は `textAlign` を持たない）。
   まだラベルが無い図形では Excalidraw 既定の `center` 扱い＝非活性。
3. 揃えを変えた瞬間に活性/非活性が切り替わるよう、`textAlign` を既存パネルの署名（`sigRef`）に含める。

### 4.4 undo の粒度

- **編集中**の Tab / Enter → textarea のネイティブ undo（§4.1）。確定時に Excalidraw が1ステップとして履歴に積む。既存どおり。
- **非編集中**のパネル操作 → `api.updateScene({ elements, ...COMMIT })`（`whiteboardHistory.ts`）で **1操作 = 1 undo**。
  `TextBoxFormatPanel.update()` と同じ流儀。

---

## 5. 変更ファイル一覧（予定）

| ファイル | 変更 |
|---|---|
| `src/app/lib/whiteboardIndent.ts`（新規） | 刻み設定・揃え方向の判定・スペース計算・textarea 操作・要素への適用 |
| `src/app/components/whiteboard/IndentField.tsx`（新規） | パネル用の「インデント」`fieldset`（⇤ / ⇥ / 刻み選択） |
| `src/app/components/whiteboard/WhiteboardCanvas.tsx` | capture の keydown を1本追加（Tab / Shift+Tab / Ctrl+`[`,`]` / Enter） |
| `src/app/components/whiteboard/TextBoxFormatPanel.tsx` | 末尾に `<IndentField>` を追加 |
| `src/app/components/whiteboard/TextColorPanel.tsx` | 「文字色」の下に `<IndentField>` を追加 |

**変更不要**: 同期（`useWhiteboardSync` / `ExcalidrawYjsBridge`）、エクスポート（`WhiteboardExportMenu`）、
`whiteboardShapeFit` / `whiteboardTable` / `whiteboardBoundText`（すべてテキスト内容の変化として既存経路で吸収される）。

---

## 6. 既存機構との整合（デグレ防止の要点）

- **onChange ヘルパーを一切増やさない**ため、BRU5-063 / BRU6-011 / BRU7-043 系の「綱引き・ちらつき・白画面」リスクは構造的に発生しない。
- **図形の高さ追従**: インデントで行が長くなると折り返しが増え、`fitBoundTextShapes` が図形を縦に伸ばす。
  これは改行を増やしたときと**まったく同じ経路**なので追加対応不要。減らせば同じ経路で縮む。
- **表セル**: `reflowTables` が同じく自動追従。`whiteboardText.wrapText` は**行頭スペースを保持する**実装
  （`whiteboardText.ts:22-35`。空白で折るときだけ捨てる）なので、自前計測と Excalidraw の描画がズレない。
- **右インデント（行末スペース）の折り返し時の扱い**: Excalidraw の `trimLine`（`chunk-4FTI6OG3.js:2282`）は
  **行がコンテナ幅を超えたときだけ、超過するぶんの行末スペースを削る**（収まる範囲は残す）。
  つまり右インデントは「はみ出さない範囲で最大限維持」される＝安全側に劣化するだけで破綻しない。
  幅無制限のテキストボックス（`autoResize`）では `wrapText` が即 return するため一切削られない。
- **共同編集(Yjs)**: `originalText` / `text` / `width` / `height` はいずれも既存の同期対象。追加のフィールドが無いので競合設計も不要。
- **エクスポート**: PNG は canvas の `fillText`、SVG は `white-space: pre` 指定済み（§1）。**行頭・行末の空白はそのまま出力される。**
- **既存ボード**: データ移行不要（新しい属性を持たないため）。既に Tab で 4スペース入れていた人のテキストもそのまま有効。

---

## 7. 制限（仕様として明示する）

1. **中央揃えではインデントできない**（§3.4・仕様として合意済み）。左揃え・右揃えのみ対応する。
2. **自動折り返しされた続き行にはインデントが付かない**（ぶら下げインデント無し）。
   Excalidraw の `wrapText` が分割行に行頭空白を継がないため。**明示的な改行（Enter）にのみ**インデントが継がれる。
3. **最小単位は半角スペース1個**（§2.2 の理由）。
4. インデントは**テキストの中身**なので、外部へコピー&ペーストすると空白ごと貼られる。
5. 右インデントは、行が幅を超えるぶんだけ行末スペースが削られる（§6）。はみ出さない範囲では維持される。

---

## 8. 却下した代替案

| 案 | 内容 | 却下理由 |
|---|---|---|
| A. `customData.wbIndent` に段数を持ち onChange で空白を再生成 | 段数が意味として残り、刻み幅の遡及変更もできる | onChange ヘルパーが1本増え、編集中に「消して書き戻す」綱引き＝ちらつきの温床。得られる利点が薄い（§2.1） |
| B. テキスト要素の `x` を右へずらして見かけ上インデント | 文字を汚さない | バインドテキストは Excalidraw が毎回コンテナ中央へ再配置し、さらに自前の `healEscapedBoundText` も戻しに来る。三つ巴で必ず破綻する |
| C. コンテナ側に左パディング属性を持たせて描画を差し替え | 本来あるべき姿 | Excalidraw のテキスト描画・折返し・エディタ配置をすべて自前に置き換える必要があり、影響が甚大 |
| D. U+2002 / U+2009 等の可変幅スペースで細かく刻む | 半角スペース未満の刻みが可能 | 既定フォントにグリフが無く、フォールバック幅が端末依存。共同編集で見た目が人により変わる（§2.2） |
| E. Excalidraw 標準の Tab（4スペース）をそのまま案内するだけ | 実装ゼロ | 「細かい単位」「改行時の継承」「発見性」という要望の3点すべてに応えられない |
| F. インデント実行時に `textAlign` を自動で `left` へ変更する | 中央揃えのままでも押せば効く | **ユーザー判断により却下**。揃えは書式であり、インデント操作が勝手に書き換えるべきではない。中央揃えは非対応とする（§3.4） |
| G. 右揃えでも「行頭」に空白を入れる | side の分岐が不要で実装が単純 | 右揃えの行は右端基準で描かれるため、行頭に空白を入れても**文字が1ミリも動かない**（機能しない） |

---

## 9. 受け入れ確認（実装後）

### 左揃え（主経路）

1. テキストボックス（既定＝左揃え）を作り `Tab` → 行頭に既定2スペース分の余白が入る。`Shift+Tab` で戻る。
2. 「刻み」を **細(1)** にして `Tab` → 半角スペース1個ぶんだけ動く（**細かい単位**の確認）。
3. インデントした行の末尾で `Enter` → **次の行が同じ位置から始まる**（要望の中核）。さらに `Enter` で継続する。
4. 図形（四角・楕円・ひし形）にラベルを入れ、**左揃えに変えてから** パネルの `⇥` → **添付画像と同じ見た目**になる。
5. 表のセルでも 1〜3 が同じように動く。

### 右揃え

6. 右揃えのテキストで `⇥` / `Tab` → **右端から文字が離れる**（文字が左へ寄る）。`Shift+Tab` で戻る。
7. 右揃えでインデントした行末で `Enter` → 次の行も**同じだけ右端から離れた位置**から始まる。
8. 右揃えの図形ラベルで、行が図形幅いっぱいになるまで文字を足す → **はみ出さず**、余った行末余白だけが詰まる（§6）。

### 中央揃え（非対応の確認）

9. 中央揃えのテキスト／ラベルでは パネルの ⇤ / ⇥ が**非活性**で、理由がツールチップに出る。
10. 中央揃えで `Tab` を押しても **何も起きない**（Excalidraw 標準の4スペースも入らない）。`Enter` は普通に改行できる。
11. 中央揃え → 左揃えへ切り替えた瞬間に、パネルのボタンが**その場で活性化**する。

### 共通

12. **日本語入力**: 変換中の `Enter`（確定）でインデントが入らない／編集が終わらない。`Tab` で変換候補選択を邪魔しない。
13. インデント後に **PNG / SVG / 画像コピー**で書き出す → 余白がそのまま出力される（左右とも）。
14. インデント直後に `Ctrl+Z` → 編集中はその一手だけ戻る／非編集中はインデント前の状態へ1回で戻る。
15. 2ブラウザで同じボードを開き、片方でインデント → **もう片方に正しく反映**され、ちらつかない。
16. インデントで行が伸びて折り返しが増えたとき、図形・表セルの高さが伸び、**減らすと元に戻る**（BRU6-011 の退行が無い）。
17. 閲覧専用ユーザーでは `Tab` / パネルのインデント操作が効かない。
18. フレーム名の編集中、カーソルチャット入力中に `Tab` / `Enter` が従来どおり動く（横取りしていない）。
