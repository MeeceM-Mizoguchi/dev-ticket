# BRU10-045 ホワイトボードの図形の色選択（自由パレット）設計

## 1. 課題

左プロパティパネルで、色を「自由に」選べるのは **文字色** だけになっている。

| セクション | 実装 | 自由な色指定 |
|---|---|---|
| 線（strokeColor） | Excalidraw 標準 | ✕（標準ポップオーバーを開いて Hexコードを手入力するしかない） |
| 背景（backgroundColor） | Excalidraw 標準 | ✕（同上） |
| 文字色 | 自前（[TextColorPanel.tsx](src/app/components/whiteboard/TextColorPanel.tsx)） | ○ 虹色スウォッチ＝`CustomColorSwatch` |
| テキストボックスの 背景／枠線 | 自前（[TextBoxFormatPanel.tsx](src/app/components/whiteboard/TextBoxFormatPanel.tsx)） | ○ |
| フレームの 背景／枠線 | 自前（[FrameFormatPanel.tsx](src/app/components/whiteboard/FrameFormatPanel.tsx)） | ○ |

つまり **不足しているのは「Excalidraw 標準が描いている 線／背景 の2セクションだけ」**。
自前パネル側にはすでに虹色スウォッチが入っている（[ColorSwatch.tsx:44](src/app/components/whiteboard/ColorSwatch.tsx#L44)）。

添付スクリーンショットの右側ポップオーバー（色／影／Hexコード）は Excalidraw 標準のもので、
Hex 入力はあるが「1クリックで OS のカラーピッカーを開く」導線が無い、というのが実感としての不便さ。

## 2. 方針

**標準の 線／背景 の行の末尾に、文字色と同じ `CustomColorSwatch`（虹色スウォッチ）を差し込む。**

- 標準セクションを自前パネルで置き換えない（標準の top-picks・影・Hex・ショートカットはそのまま活かす）
- 既存の `TextColorPanel` / `TextBoxFormatPanel` と同じ「実 DOM ノードを挿入 → React portal で中身を描く」方式に揃える
- 見た目・操作感を文字色のスウォッチと完全に同一にする（同じコンポーネントを使うので自動的に揃う）

差し込み後の行のイメージ:

```
線     [■][■][■][■][■] │ [現在色]  [🌈]   ← 🌈 が今回の追加分
背景   [□][□][□][□][□] │ [現在色]  [🌈]
文字色 [■][■][■][■][■][■][■]
       [□][🌈]                          ← 既存
```

## 3. 差し込み位置と DOM

Excalidraw の 1 セクションの構造（`node_modules/@excalidraw/excalidraw` で確認済み）:

```html
<fieldset>
  <legend>線</legend>
  <div class="color-picker-container">
    <div class="color-picker__top-picks">
      <button class="color-picker__button [active]" title="#1e1e1e" style="--swatch-color:#1e1e1e"> ×5
    </div>
    <div>…1px の区切り線…</div>
    <button class="color-picker__button active-color properties-trigger" style="--swatch-color:#e03131">
  </div>
</fieldset>
```

- 挿入先: **`.color-picker__top-picks` の末尾（`appendChild`）**。
  当初は `.color-picker-container` の末尾を想定したが、この要素は
  `display:grid; grid-template-columns:1fr 20px 1.625rem` の **3列固定グリッド**で、
  4つ目の子を足すと暗黙の2行目（左端）へ落ちてしまう。
  top-picks 側は `display:flex; justify-content:space-between` なので、
  定型色と同じ行に自然に並ぶ（文字色セクションと同じ見え方になる）。
  中身は色をキーにした React の可変リストだが、末尾に足した非 React ノードは
  参照ベースの再調整に巻き込まれない。
- スウォッチの寸法は標準の定型色ボタン（`width/height:1.35rem`, `--radius:.25rem`）に合わせる。
- **背景は常に虹色のまま**にする（`alwaysGradient`）。文字色セクション由来の
  「選択中は選んだ色で塗る」挙動をそのまま使うと、定型色に無い色（線の既定 `#343a40`、
  背景の `#ffffff` など）を使っている時にただの色見本と同じ見た目になり、
  カラーピッカーの入口だと気付けない。選択中かどうかは青い枠だけで示す。
- どのセクションが 線 / 背景 かの判定: `.App-menu__left .panelColumn` 内の
  `.color-picker-container` を **出現順** で 0=線 / 1=背景 とみなす。
  見出し文字はロケール依存、`color-picker-type-*` クラスはポップオーバーを開いた時しか出ないため、
  既存 [TextColorPanel.tsx:56 `anchorSection`](src/app/components/whiteboard/TextColorPanel.tsx#L56) と同じ「並び順で判定」の規約に合わせる。
  背景を持たない要素（矢印・線・テキスト）では 1 つしか出ず、その場合は 線 のみ。

### 現在色とハイライトの読み取り

自前で appState を解釈せず、**標準 UI が出している DOM をそのまま読む**（判定ロジックの二重管理を避ける）。

- 現在色 … `active-color` ボタンの `style.getPropertyValue("--swatch-color")`
  （取れない時は `appState.currentItemStrokeColor` / `currentItemBackgroundColor` にフォールバック）
- 虹色スウォッチを「選択中」にするか … `.color-picker__top-picks .color-picker__button.active` が
  **無ければ** 定型色以外＝カスタム色とみなして選択中表示にする（`CustomColorSwatch` の `active`）。
  透明（`transparent`）は top-picks の 1 つなので `active` が付き、非選択のまま＝正しい。

## 4. 色の適用

新規 `src/app/lib/whiteboardShapeColor.ts`:

```ts
setStrokeColor(api, color): void
setBackgroundColor(api, color): void
```

共通の振る舞い:

1. 選択中の要素（`appState.selectedElementIds`）の `strokeColor` / `backgroundColor` を更新し、
   `version` +1・`versionNonce` を振り直す（Yjs 同期のため。既存パネルと同じ流儀）
2. あわせて `currentItemStrokeColor` / `currentItemBackgroundColor` も更新する
   （＝これから描く図形の既定色。標準 UI と同じ挙動）
3. 何も選択していない時（ツール選択中）は appState だけ更新
4. `COMMIT`（[whiteboardHistory](src/app/lib/whiteboardHistory.ts)）を付けて **1 undo ステップ**にする（BRU7-058 の規約）

除外・注意:

- **バウンドテキスト（図形内ラベル）には塗らない。** 標準の `changeStrokeColor` は
  `includeBoundText` でラベルまで塗ってしまい、それを `pinBoundTextColor` が毎 tick 戻している
  （BRU7-056-2）。自前経路では最初から触らないほうが素直で、ちらつきも出ない。
  文字色は引き続き 文字色セクションが唯一の入口。
- 装飾用の実 rectangle（テキストボックスの影矩形 / フレーム装飾 `isFrameDecorRect`）は
  ロック済みで選択に入らないが、念のためフィルタで除外する（`syncFrameDecorRects` が再生成するため）。
- 背景色は矢印・線・テキストでは未使用フィールドなので、選択に混ざっていても
  そのまま書き込んで問題ない（標準も同じ）。表のセルは rectangle なので選択分だけ塗られる＝期待どおり。

## 5. 連続変更（ドラッグ）対策

`<input type="color">` は OS のピッカーをドラッグしている間 `input` イベントを連射する。
現状の `CustomColorSwatch` はそれをそのまま `onPick` に流しており、
図形に適用すると **undo スタックの汚染 ＋ Yjs ブロードキャストの過剰送信** になる。

そこで `ColorSwatch.tsx` の `CustomColorSwatch` の中で
**requestAnimationFrame による間引き（1フレーム1回・最後の値は必ず適用）**を行う。
呼び出し側の API は変えないので、既存3箇所も自動的に改善される。

当初案の「ドラッグ中は `COMMIT` なしのプレビュー → 確定時に 1 回 `COMMIT`」は採らなかった。
`captureUpdate` を伏せた更新を挟むと BRU10-044 の `filterUncomittedElements` の罠
（[whiteboardHistory.ts:52〜](src/app/lib/whiteboardHistory.ts#L52)）に入り、
`beginHistoryGesture` / `commitSceneToHistory` の 2 段階確定が必要になる。
ところが `<input type="color">` はブラウザ/OS のピッカーで、
ドラッグ終了を表す確実なイベントが取れず（Chrome は `input` と `change` を同時に連射する）、
`window` の `pointerup` 保険リスナーがジェスチャを勝手に解除してしまうため、
**「そのドラッグが丸ごと undo できない」** 側に倒れる危険がある。
間引きだけなら履歴機構に触らず、送信量の問題（本来の懸念）は解消できる。

## 6. 変更ファイル

| ファイル | 種別 | 内容 |
|---|---|---|
| [ShapeColorPalette.tsx](src/app/components/whiteboard/ShapeColorPalette.tsx) | 新規 | 標準 線／背景 の行へ虹色スウォッチを差し込む（rAF 監視＋portal） |
| [whiteboardShapeColor.ts](src/app/lib/whiteboardShapeColor.ts) | 新規 | `setShapeColor(api, kind, color)` |
| [ColorSwatch.tsx](src/app/components/whiteboard/ColorSwatch.tsx) | 修正 | `CustomColorSwatch` に rAF 間引きと `size` / `radius` を追加 |
| [WhiteboardCanvas.tsx](src/app/components/whiteboard/WhiteboardCanvas.tsx) | 修正 | `{canEdit && <ShapeColorPalette … />}` を既存パネル群の並びに追加 |

DB 変更・マイグレーションなし。既存要素への後方互換性の問題なし（native フィールドのみを触る）。

## 7. 想定される落とし穴

1. **Excalidraw の再描画で挿入ノードが消える** … 既存パネルと同様、rAF ループで毎 tick
   親子関係を確認し、外れていたら挿し直す（自己修復）。DOM を触るのは位置がズレている時だけ。
2. **標準「線」を隠している場面** … 素のテキスト選択・テキスト入力中は
   `HIDE_NATIVE_STROKE`（[TextColorPanel.tsx:34](src/app/components/whiteboard/TextColorPanel.tsx#L34)）が
   fieldset ごと `display:none` にするため、内側の虹色スウォッチも自動的に消える＝追加対応不要。
3. **複数選択で色が混在** … `active-color` が色を出さない（`is-transparent`）ため、
   虹色スウォッチは非選択表示。クリックすれば一括で揃う（文字色と同じ挙動）。
4. **iPad / Mac（Capacitor）** … `input type="color"` は iPadOS Safari / WKWebView でも
   ネイティブのカラーピッカーが開く。実機確認は必要。
5. **検証手段** … このリポジトリは `tsc` が通らず `vite build` が唯一のゲート（既知）。
   ビルド緑＋実操作での目視確認を完了条件とする。

## 8. スコープ外

- キャンバス全体の背景色（ハンバーガーメニュー内）。ここも標準ピッカーだが、
  図形の色選択という本チケットの主旨から外れるため今回は触らない（要望があれば同じ仕組みで追加可能）。
- 「影」（shade）の 5 段階は標準ポップオーバーにあるものをそのまま使う。
- 独自パレットの保存・組織共通色などの機能追加はしない。
