# BRU5-061 ホワイトボード 図形コネクト部分の改善 — 設計書

> 分類: 改善 / 実装は本設計の承認後に別途着手する。

## 0. 前提となる現行アーキテクチャ（重要）

ホワイトボードのコネクト（線・矢印と図形の接続）は **Excalidraw ネイティブの binding を使っていない**。
自前方式に一本化されている。

- 接続情報は線・矢印の `customData.triStart` / `customData.triEnd` に
  **接続先図形の bbox 相対アンカー `{ id, fx, fy }`（fx,fy ∈ [0,1]）** として記録する。
- 接続端点のネイティブ `startBinding` / `endBinding` は `null` にして競合を無効化する。
- 毎フレーム `followTriangleConnections()` がアンカーから端点座標を再計算し、
  図形の移動・リサイズ・回転に追従させる（ステートレス強制）。

関連ファイル:

| ファイル | 役割 |
|---|---|
| `src/app/lib/whiteboardAutoConnect.ts` | 接続の付与(`autoConnectLines`)・追従/解除(`followTriangleConnections`)・ヒット判定 |
| `src/app/lib/whiteboardFrames.ts` | フレームのグループ化(`wbParent`)・移動追従(`followFrameMoves`)・リサイズ所属(`captureFrameChildren`) |
| `src/app/lib/whiteboardSnap.ts` | 幾何ユーティリティ(`elementBBox`, `nearestPointOnPolyline` 等) |
| `src/app/components/whiteboard/TriangleBindHint.tsx` | 接続可能ハイライト（ドラッグ中に近接図形の枠を出す） |
| `src/app/components/whiteboard/WhiteboardCanvas.tsx` | `onChange` オーケストレーション、Excalidraw 標準UIのCSS隠し |
| `src/app/components/whiteboard/HelpButton.tsx` | Excalidraw 標準 HelpDialog を開くだけ |

共有パラメータ: `TOL = 22`（接続ヒット距離, scene単位）。`autoConnect` と `TriangleBindHint` で二重定義されている。

---

## 1. 【本題】密集した図形へ綿密にコネクトできない（添付1・2枚目）

### 症状
テーブル状に積み重なった図形（セル）の中で、狙った1つ（例: `+1(361)459-7998` のセル）へ端点を
接続しようとしても、意図しない別の図形に繋がる／繋がらない。

### 根本原因
`autoConnectLines()` の接続先選定が **最初にヒットした図形を採用**しているため。

```ts
// whiteboardAutoConnect.ts:179
const nearShape = (pt: Pt) => shapes.find((s) => nearBox(pt, s));
```

- `shapes` は fractional-index 昇順＝**z-order の下から**並ぶ。`find()` は**最背面の重なり図形**を返す。
  ユーザーが見て狙うのは最前面のセルなので、感覚とズレる。
- `nearBox` は bbox を `TOL=22` 外側まで広げた矩形判定。密集時は複数セルが同時にヒットし、
  距離やz順を考慮せず先頭が勝つ。
- `TriangleBindHint` は近接する**全図形**を薄グレーでハイライトするだけで、
  「実際にどれに繋がるか」を示さない → 事前フィードバックが無い。

### 設計方針: 接続先選定を「最良ターゲット選択」に統一する

`whiteboardAutoConnect.ts` に単一の純関数を新設し、接続を判定する全箇所で使う。

```ts
// 端点 pt に対する最良の接続先を1つ返す（無ければ null）
export function pickConnectTarget(pt: Pt, shapes: any[]): any | null
```

スコアリング規則（密集セルでも「置いた場所のセル」が確実に勝つ）:

1. **候補抽出**: `distToBox(pt, connectBBox(s)) <= TOL` を満たす図形。
2. **内包優先**: `pt` が `connectBBox` の内側にある図形群があれば、それらだけを対象にする
   （端点をセルの中に落としたら、そのセルに繋がる）。
3. **内包群の並べ替え**: `connectBBox` の面積が小さい順（＝入れ子/積層で最小セルを選ぶ）、
   同点は z-order が前面（配列 index が大きい）を優先。
4. **内包が無い場合**: 図形外周までの距離 `distToOutline(pt, s)` が小さい順、同点は前面優先。
5. 先頭を返す。

適用箇所（全て `pickConnectTarget` に置換して挙動を一致させる）:

- `autoConnectLines()`: `nearShape` を `pickConnectTarget` に置換。start/end それぞれ独立に選定。
- `followTriangleConnections()` の再アンカー分岐（`connectTo(gp[0]/gp[L], shape)`）: 端点が現在アンカー図形から
  ズレて近接図形が別にある場合、`pickConnectTarget` で対象を取り直す（積層セル間の乗り換えを正確に）。
- `TriangleBindHint`: `hits = shapes.filter(...)` を **単一の `pickConnectTarget` 結果のみハイライト**に変更。
  さらに接続予定の外周射影点（`nearestPointOnPolyline`）に小さなドットを描き、**どこに繋がるかを明示**する。

### 追加のUX調整
- `TriangleBindHint` の当たり判定は現在 `elementBBox`（素の矩形）を使っており、`autoConnect` が使う
  `connectBBox`（枠線付きテキストは外側に拡張）と**不一致**。`connectBBox` に統一する。
- `TOL=22` は `autoConnect` と `TriangleBindHint` に重複定義。共通 export（`CONNECT_TOL`）に集約する。
- `TOL` は据え置き（磁力は残す）。精度は「最初の一致」→「最良ターゲット」で担保するため、
  半径を狭める必要はない。狭めると逆に細い線・小図形へ繋ぎにくくなる。

### 影響・リスク
- 選定が距離/面積/z順ベースになるだけで、接続データ構造（`triStart/triEnd`）は不変 → Yjs 互換性・既存ボード影響なし。
- 純関数追加＋呼び出し置換なので副作用は局所的。

---

## 2. 【ついで】棒・テキストボックスにコネクトできない（添付3・4枚目）

### 現状確認（重要）
テキストへの接続は **commit `f6037a2`（BRU5-054）で既に実装済み**。
`isConnectableShape` は `type === "text" && !containerId` を含み、枠線付きテキストは `connectBBox` を
`TEXT_BORDER_PAD` ぶん外側へ拡張して枠線ちょうどに吸着する仕組みがある。

➡ **まず現行ブランチで再現確認する。** 本チケット起票が BRU5-054 より前なら、この項目は
すでに解消している可能性がある。

### なお残る失敗ケースと原因
再現する場合、原因は §1 と同一の「最初の一致」問題:

- テキストは薄く、周囲の四角（例: 「絶対リーチSMS」ボックス）と重なりがち。
  `find()` が z-order 下位の四角を先に拾い、テキストに繋がらない。
- `TriangleBindHint` が `connectBBox` ではなく素の bbox を使うため、枠線付きテキストの
  ヒット領域とハイライトがズレ、「枠に近づけたのに反応しない」体感になる。

### 設計方針
§1 の `pickConnectTarget` 導入＋`connectBBox` 統一で **同時に解決**する。追加実装は不要。
テキストは面積が小さいため、内包/最小面積優先ルールで四角より優先されやすくなり、狙って繋げられる。

- 検証観点: 枠線なしのプレーンテキスト／枠線付きテキストボックスの両方で、
  線（棒）・矢印の端点が四辺どこにでも吸着することを確認する。

---

## 3. 図形＋矢印を一緒にドラッグ→離すとコネクト部分がズレる

### 症状
接続済みの図形と、その矢印/棒を**まとめて選択してドラッグ**し離すと、離した後に接続端点がズレる。

### 根本原因
`followTriangleConnections()` は**選択中の線・矢印を追従対象から除外**する（操作の邪魔をしないため）。

```ts
// whiteboardAutoConnect.ts:270
if (selected[el.id] || el.id === editId || el.id === newId) return el;
```

グループドラッグ中、矢印は Excalidraw により figure と同じデルタで平行移動する。
- 一緒に動かした図形側の端点 → 同デルタなのでアンカー上に残る（ズレない）。
- **もう一方の端点が「ドラッグに含めていない静止図形」に接続していた場合** → 矢印全体が平行移動する
  ぶんだけ静止図形から離れる。矢印は離した後も選択状態のままなので `followTriangleConnections` が
  スキップし続け、**端点が静止図形から浮いたまま固定**される（＝コネクトずれ）。

### 設計方針: ドラッグ確定時のコネクト再整合（one-shot）
`WhiteboardCanvas.onChange` には既にドラッグ終了を検知する仕組み（`wasDragging` ref、
`reparentDraggedElements` の起動契機）がある。これに相乗りして、ドラッグ確定フレームで
新関数を1回だけ呼ぶ。

```ts
// whiteboardAutoConnect.ts に追加
export function reconnectDraggedConnectors(api, appState): boolean
```

処理:

- 対象 = **ドラッグ選択に含まれていた線・矢印**（`selectedElementIds` かつ本体平行移動）。
  端点編集（`editingLinearElement`）由来のものは除外 → 端点を意図的に動かした操作を壊さない。
- 対象コネクタの `triStart` / `triEnd` について、アンカー図形が実在するなら
  端点を `anchorToPoint(anchor, shape)`（＝図形の現在外周上の記録位置）へ**貼り直す**。
- これにより「一緒に動いた側」も「静止側」も両端がアンカー図形へ再接着され、ズレが解消する。

呼び出し位置（`onChange` 内、`reparentDraggedElements` と同じドラッグ確定ブロック）:

```ts
const dragEnded = !remote && wasDragging.current && !dragging;
const reparented = dragEnded ? reparentDraggedElements(api, appState) : false;
const reconnected = dragEnded ? reconnectDraggedConnectors(api, appState) : false;
```

### エッジケース
- 矢印だけを単独ドラッグして繋ぎ直す/外す操作は、選択解除後に既存の follow ロジック
  （距離>TOL で解除、近ければ再アンカー）が担う。本関数は「**アンカー図形と一緒に運ばれたコネクタ**」に
  限定するため干渉しない。
- リモート反映中(`remote`)は起動しない（二重適用防止の既存規約に従う）。

---

## 4. フレーム内グループ図形が、フレームのサイズ変更で勝手に移動する

### 症状
フレームでグループ化した図形が、**フレームをリサイズ**すると勝手に平行移動してしまう。

### 根本原因
`followFrameMoves()` は「フレームの `x,y` が前回と変われば移動」とみなし、子を同デルタで平行移動する。

```ts
// whiteboardFrames.ts:242
if (prev && (prev.x !== f.x || prev.y !== f.y)) {
  moved.set(f.id, { dx: f.x - prev.x, dy: f.y - prev.y });
}
```

**左辺・上辺ハンドルでのリサイズは `x,y` が変化する**（幅/高さが増える方向）。
`appState.resizingElement` によるガードはあるが（`whiteboardFrames.ts:232`）、リサイズ確定の
最終フレームやフラグの取りこぼしで、この `x,y` 変化が「移動」と誤検知され、子が平行移動する。
`w,h` の変化を一切見ていない点が本質的な穴。

### 設計方針: 「移動」判定に幅・高さ不変の条件を追加
フラグ（`resizingElement`）に依存せず、**幾何で移動とリサイズを判別**する。

`followFrameMoves` の移動検知に、前回矩形と `width/height` が一致することを必須条件にする:

```ts
const prev = prevPos.get(f.id);           // ← prevPos は現状 {x,y} のみ保持
if (prev && (prev.x !== f.x || prev.y !== f.y)
    && prev.w === f.width && prev.h === f.height) {   // 純移動のみ
  moved.set(f.id, { dx: f.x - prev.x, dy: f.y - prev.y });
}
```

- そのために `prevPos` のスナップショットを `{x,y}` → `{x,y,w,h}` に拡張する
  （`curPos`/`afterPos`/`commitPos` も合わせて `w,h` を保持）。
- 左上リサイズで `x,y` が動いても `w,h` が変わるので `moved` に入らず、子は動かない。
- 既存の `appState.resizingElement` ガードは**残す**（多重防御）。
- 純移動（`x,y` 変化かつ `w,h` 不変）は従来どおり子が追従する。

> 補足: 別項「フレーム内でグルーピングした図形がフレームサイズ変更で移動」はこの1点で塞げる。
> リサイズ時の所属再判定は `captureFrameChildren` が別途担っており、そちらは位置を動かさない（`wbParent` 付替のみ）。

### 検証観点
- 4隅・4辺すべてのハンドルでリサイズしても子が動かないこと。
- フレーム本体の平行移動では従来どおり子が付いてくること。
- 入れ子フレーム、undo/redo（BRU5-060 の二重移動対策）が引き続き壊れないこと。

---

## 5. ヘルプの「ドキュメント/公式ブログ/不具合報告/YouTube」ボタンを削除

### 現状
これらは自前UIではなく **Excalidraw 標準 HelpDialog のヘッダーリンク**。
DOM 構造（library バンドル）:

```html
<div class="HelpDialog__header">
  <a class="HelpDialog__btn" href="https://docs.excalidraw.com">…ドキュメント</a>
  <a class="HelpDialog__btn" href="…blog…">…公式ブログ</a>
  <a class="HelpDialog__btn" href="…github…">…不具合報告</a>
  <a class="HelpDialog__btn" href="…youtube…">…YouTube</a>
</div>
```

### 設計方針: CSS で1行追加
既存の `HIDE_EXCALIDRAW_CHROME`（`WhiteboardCanvas.tsx:28`）に追記する。
`.HelpDialog__header` を隠せば4リンクが一括で消え、下のショートカット一覧は残る。

```css
.excalidraw .HelpDialog__header { display: none !important; }
```

- コードでの分岐やライブラリ改変は不要。最小・低リスク。
- `HelpButton` が開く「キーボードショートカット一覧」自体は維持する。

---

## 6. 実装順序と検証（実装は別指示で着手）

推奨順（独立性が高い順）:

1. **§5 ヘルプボタン削除** — CSS 1行。即完了・低リスク。
2. **§4 フレームリサイズ移動** — `whiteboardFrames.ts` 局所修正（`prevPos` に w,h 追加＋移動条件）。
3. **§1/§2 最良ターゲット選択** — `pickConnectTarget` 新設＋`connectBBox`/`CONNECT_TOL` 統一、
   `autoConnect`・`followTriangle`・`TriangleBindHint` の3箇所を置換。§2 は §1 に含まれる。
4. **§3 グループドラッグ再整合** — `reconnectDraggedConnectors` 新設＋`onChange` のドラッグ確定ブロックに配線。

各項目の受け入れ確認（`verify` で実画面駆動）:

- 積層テーブルの狙ったセルへ、線/矢印/棒の端点が確実に接続し、ハイライトが接続先1つだけを示す。
- プレーン/枠線付きテキストの四辺に接続できる。
- 図形＋矢印（片端が静止図形）をまとめて移動→離しても両端の接続が保たれる。
- フレームを全ハンドルでリサイズしても子図形が動かない／平行移動では追従する。
- HelpDialog に4リンクが表示されない。
- リモート2クライアントで上記が同期し、`followTriangleConnections`/`followFrameMoves` の
  ループ・二重適用が発生しない。

## 7. 留意点
- すべて既存の自前コネクト方式（`customData` アンカー）・グループ方式（`wbParent`）の枠内での修正で、
  データ構造変更・マイグレーション不要。既存ボードとの互換を保つ。
- `onChange` は Yjs 同期のホットパスなので、`pickConnectTarget` は候補数が小さい前提の単純ループで十分だが、
  図形数が多いボードに備え「TOL 事前フィルタ→内包判定→ソート」の順で早期に候補を絞る。
