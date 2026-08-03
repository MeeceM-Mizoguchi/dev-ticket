# BRU10-054-2 ホワイトボード 表のセル入力時のバグ — 設計

分類: バグ
対象: ホワイトボードの表（BRU5-042） / セルのテキスト編集中の高さ
関連: [whiteboardTable.ts](../src/app/lib/whiteboardTable.ts) / [whiteboardShapeFit.ts](../src/app/lib/whiteboardShapeFit.ts) / `patches/@excalidraw__excalidraw@0.18.1.patch`

---

## 1. 現象

セルをダブルクリックして文字を編集し始めた瞬間、**そのセルの矩形だけ**が「文字にぴったりの高さ」まで縮む（添付2枚目）。
同じ行の他のセル・下の行は元の位置のまま動かないので、行の中に空白の帯ができ、文字も行の上端に寄って見える。
編集を終えてフォーカスを外すと元の高さに戻る（添付3枚目）。

重要な観察点は「**行が縮んだのではなく、編集中のセル1枚だけが縮んでいる**」こと。
自前の再レイアウト（`reflowTables`）が行高を計算し直したのであれば、同じ行の全セルが縮み、下の行が繰り上がるはずで、
そうなっていない＝**再レイアウトの外側で、Excalidraw 本体がそのセルの高さを直接書き換えている**。

---

## 2. 原因

### 2-1. 犯人は Excalidraw の「編集中オートシュリンク」

Excalidraw のテキストエディタ `textWysiwyg` は、エディタを開いている間 `updateWysiwygStyle()` を通じて
コンテナ（＝セルの矩形）の高さを自分で調整している。`node_modules/@excalidraw/excalidraw/dist/dev/index.js:24076-24101`:

```js
if (!isArrowElement(container) && height > maxHeight) {          // ← 伸ばす分岐
  mutateElement(container, { height: computeContainerDimensionForBoundText(height, container.type) });
  return;
} else if (
  // autoshrink container height until original container height
  // is reached when text is removed
  !isArrowElement(container) && container.height > originalContainerData.height && height < maxHeight
) {                                                               // ← 縮める分岐（これ）
  mutateElement(container, { height: computeContainerDimensionForBoundText(height, container.type) });
}
```

- `height` … バインドテキスト要素の高さ（文字にフィットする高さ）
- `maxHeight` … `container.height - 10`（`getBoundTextMaxHeight`）
- `originalContainerData.height` … **`originalContainerCache` に記録された「そのコンテナの元の高さ」**

つまり *「コンテナが記録された元の高さより大きく、かつ文字が余っている ⇒ 文字を消したのだろう ⇒ 文字ぴったりまで縮める」* という挙動。
本来は「文字で伸びた図形を、文字を消したら元に戻す」ためのものだが、**表のセル高は文字ではなく行高（rowH）で決まる**ため、この前提が成立しない。

### 2-2. `originalContainerCache` が古くなる

`originalContainerCache`（`dist/dev/chunk-4FTI6OG3.js:14544-14557`）は要素 id をキーにしたモジュール変数で、

| いつ書かれるか | いつ消えるか |
|---|---|
| そのセルを**初めて編集した瞬間**（その時点の `container.height` を記録） | `handleBindTextResize`（＝Excalidraw のリサイズつまみ操作）と「テキストのバインド解除」のみ |

一度書かれた値は、**ページを再読み込みするまで基本的に更新されない**。
一方で表のセル高は編集後にいくらでも変わる:

- 行の境界をドラッグして行高を手動指定（`applyTableSizes` で `rh` を書く → `reflowTables` が高さを反映）
- 同じ行の**別のセル**が複数行になって行高が伸びた
- 表を作り直す/行列を挿入して行高を引き継いだ

これらはいずれも**自前の `updateScene` で高さを書いている**ので、Excalidraw のキャッシュはリセットされない。

### 2-3. したがって再現条件は

> 同一セッション中に **①そのセルを一度編集** → **②その行が①の時より高くなる** → **③もう一度そのセルを編集**

③の瞬間に `container.height（例:113） > cache（例:32）` かつ `文字高(25) < maxHeight(103)` が成立し、
セルが `25 + 10 = 35px` へ叩き落とされる。添付画像の状態と完全に一致する。

（逆に、そのセルをセッション中に一度も編集していなければキャッシュは現在の高さで初期化されるため起きない。
「たまに起きる／必ずではない」のはこのため。表全体の四隅リサイズは Excalidraw のリサイズ経路を通るのでキャッシュがリセットされ、これも発症しない。）

### 2-4. なぜ「一瞬」なのか — 綱引きになっている

`textWysiwyg` は `app.scene.onUpdate(() => updateWysiwygStyle())` を購読している（`dist/dev/index.js:24451`）。
一方こちらは編集中も rAF で `reflowTables` を回している（[WhiteboardCanvas.tsx:805-821](../src/app/components/whiteboard/WhiteboardCanvas.tsx#L805-L821)）。

```
reflowTables が height=rowH(113) を updateScene
        → scene.onUpdate → updateWysiwygStyle → autoshrink が height=35 に mutate
        → scene.onUpdate → …（次フレームで reflow が113へ戻す）
```

毎フレーム 113 ⇄ 35 を書き合う状態になり、これが「高さが一瞬変わる」ちらつきの正体。
副作用として、**編集している間ずっとセル要素の version が上がり続け、Yjs 経由で他メンバーへ無駄な更新が流れ続ける**。

### 2-5. 既存コメントの認識違い

[whiteboardShapeFit.ts:5-6](../src/app/lib/whiteboardShapeFit.ts#L5-L6) に
「縮小して戻す `originalContainerCache` は "バインド解除" 操作でしか使われない」とあるが、
実際には上記のとおり **編集中の `updateWysiwygStyle` でも使われている**。この思い違いのため、
`reflowTables` の編集中セル分岐（[whiteboardTable.ts:588-596](../src/app/lib/whiteboardTable.ts#L588-L596)）は
「1行に収まる text なら Excalidraw も高さを受け入れるので取り合いにならない」と書かれているが、
行高が文字フィット高より大きいケースではこの前提が崩れる。本チケットはその抜けを塞ぐもの。

---

## 3. アプリ側だけで直せないことの確認

`originalContainerCache` / `resetOriginalContainerCache` / `updateOriginalContainerCache` は
`@excalidraw/excalidraw` の公開 API に**出ていない**（バンドル内部のみ）。そのうえで検討した案:

| 案 | 判定 |
|---|---|
| A. キャッシュを現在の行高で上書きする | 関数が非公開。到達不能 |
| B. 「等値なら発火しない」原則（`whiteboardShapeFit` の手法）で条件を外す | 縮小条件は `container.height > cache`。cache は不明かつ行高より小さいので、条件を外すには**セルを縮めるしかない＝バグそのまま**。不可 |
| C. バインドテキスト要素の高さを `セル高-10` へ膨らませて `height < maxHeight` を偽にする | 条件は消せるが、textarea がセル全面に広がり文字が上端に張り付く（縦中央が崩れる）。UX 劣化のため不可 |
| D. 編集開始時にフォントサイズを僅かに変えてキャッシュを再シードさせる（`textPropertiesUpdated` の副作用を突く） | 動くが、要素を汚す／undo・同期ノイズ／プロパティパネルに露出。却下 |
| E. 綱引きに勝つ（reflow を後勝ちさせる） | 双方が毎フレーム書くので構造的に勝てない。ちらつきは消えない |
| F. 行の背景板（BRU5-062 の影矩形方式）で見た目だけ保つ | 罫線は保てるが文字が上端へ寄る問題は残る。却下 |

→ **本体側の1条件を無効化する以外に筋の良い手が無い**。本リポジトリは既に `pnpm patch` の運用実績がある
（`patches/@excalidraw__excalidraw@0.18.1.patch` / `pnpm-workspace.yaml` の `patchedDependencies`）ので、そこへ相乗りする。

---

## 4. 採用案 — 表セルに限って autoshrink を無効化する

### 4-1. 方針

**「表セルの高さの所有者は `reflowTables` ただ一つ」** という不変条件を、本体側にも明示する。
`updateWysiwygStyle` の縮小分岐に「表セル（`customData.wbTable` を持つ矩形）は対象外」というガードを1つ足すだけ。

- 伸ばす分岐（`height > maxHeight`）は**触らない**。行高＝`max(手動rh, 文字フィット高)` なので、
  伸びが必要な時は Excalidraw の計算値と `reflowTables` の計算値が一致し（どちらも `文字高+10`）、綱引きにならない。
- 縮む方は `reflowTables` が生テキスト（編集中は textarea の生値）から毎フレーム正しい行高を出しているので、
  本体の縮小は**機能として不要**。無効化しても「改行を減らしたら行が縮む」挙動は今までどおり効く。

### 4-2. 具体的な差分

対象は2ファイル。`exports` 条件により **開発サーバ＝`dist/dev/index.js`、本番ビルド＝`dist/prod/index.js`** と
読み込まれるファイルが違うため、**両方に当てないと本番だけ直らない**。

**(1) `dist/dev/index.js:24090-24094`**

```diff
   } else if (
     // autoshrink container height until original container height
     // is reached when text is removed
-    !isArrowElement(container) && container.height > originalContainerData.height && height < maxHeight
+    // dev-ticket(BRU10-054-2): 表のセルは高さの所有者が reflowTables なので本体の自動縮小から除外する。
+    !isArrowElement(container) && !container.customData?.wbTable && container.height > originalContainerData.height && height < maxHeight
   ) {
```

**(2) `dist/prod/index.js`（minify 済み・該当箇所は1箇所のみ）**

```diff
-else if(!Ne(be)&&be.height>qi.height&&wo<Pn){let lr=ui(wo,be.type);P(be,{height:lr})}
+else if(!Ne(be)&&!be.customData?.wbTable&&be.height>qi.height&&wo<Pn){let lr=ui(wo,be.type);P(be,{height:lr})}
```

（`be`=コンテナ, `qi`=キャッシュ, `wo`=文字高, `Pn`=maxHeight。文字列 `be.height>qi.height&&wo<Pn` はバンドル内で一意。）

`customData` は Excalidraw の要素標準フィールドで minify の影響を受けないため、プロパティ名でのガードは安全。
判定に `wbTable` を使うのは [whiteboardTable.ts:36-41](../src/app/lib/whiteboardTable.ts#L36-L41) の `isTableCell` と同じ根拠。

### 4-3. 手順

```bash
pnpm patch @excalidraw/excalidraw@0.18.1      # 展開先が表示される（既存パッチ適用済みの状態で展開される）
# 展開先の dist/dev/index.js と dist/prod/index.js を上記のとおり編集
pnpm patch-commit <展開先パス>                 # patches/*.patch が更新される
pnpm install                                   # 反映
```

既存パッチ（UserList の React key 警告）は残したまま、同じパッチファイルにハンクが追加される。

**このリポジトリ固有の落とし穴（重要・実装時に踏んだ）**

リポジトリのパスに日本語（`システム開発`）が含まれるため、`pnpm patch-commit` が内部で使う git が
新側のパスを**クオート＋8進エスケープ**して書き出し、パッチのヘッダが壊れて `pnpm install` が
`ERR_PNPM_INVALID_PATCH: Bad diff line` で落ちる。

```
diff --git a/dist/dev/index.js "b/Users/.../\343\202\267\343\202\271...index.js"   ← 壊れたヘッダ
+++ "b/Users/.../\343\202\267\343\202\271.../dist/dev/index.js"
```

生成後に、以下の2種類の行を素のパスへ直せばよい（差分本文はそのままで通る）。

```
diff --git a/dist/dev/index.js b/dist/dev/index.js
+++ b/dist/dev/index.js
```

さらに pnpm 11 は `node_modules/.pnpm-workspace-state-v1.json` を見て「Already up to date」と即返すため、
パッチファイルを直した後は **そのファイルを消してから `pnpm install`**（`--force` でも再適用されない）。

### 4-4. 注意点

- **パッチファイルが大きくなる**。`dist/prod/index.js` は1行が約 68,000 文字あり、diff がその行を丸ごと2回抱えるため
  パッチが 13KB → **224KB** に増える（レビューでは差分本文ではなく本設計書の 4-2 を見てもらう前提）。
  これを避けたい場合の代替は「`scripts/` に冪等な置換スクリプトを置いて postinstall で走らせる」だが、
  同じパッケージに2系統の仕組みが並ぶ保守コストと、`pnpm install` 時にアンカー消失を検知できる pnpm patch の利点を取り、**pnpm patch を推奨**。
- **Excalidraw を上げる時**は、アンカー文字列が変わるとパッチ適用が失敗して `pnpm install` が落ちる（＝黙って壊れない）。
  そのタイミングで本体の該当ロジックが変わっていないか、本書 2-1 を参照して当て直す。

---

## 5. 影響範囲

| 対象 | 影響 |
|---|---|
| 表のセル（`customData.wbTable`） | 編集中の自動縮小が止まる＝**本件の修正**。高さは従来どおり `reflowTables` が決める |
| 素の図形のラベル（BRU6-011 / `whiteboardShapeFit`） | **変更なし**（ガードは表セル限定）。なお素の図形は「高さ＝文字フィット高と等値」に保たれるため `height < maxHeight` が成立せず、構造的にこの分岐に入りにくい |
| 矢印ラベル・フレーム・通常の図形 | 変更なし |
| アプリ側コード | **変更なし**（`whiteboardTable.ts` / `WhiteboardCanvas.tsx` は無改修） |

副次効果として、編集中に毎フレーム発生していたセルの version 更新（Yjs への無駄配信）が止まる。

コメントだけは、誤解の元になっている
[whiteboardShapeFit.ts:5-6](../src/app/lib/whiteboardShapeFit.ts#L5-L6) と
[whiteboardTable.ts:588-591](../src/app/lib/whiteboardTable.ts#L588-L591) に
「編集中は `updateWysiwygStyle` の autoshrink も使う。表セルはパッチで除外済み（BRU10-054-2）」の一文を足す（挙動変更なし）。

---

## 6. 検証手順

**再現（パッチ前に必ずこの手順で現象を出してから当てる）**

1. ホワイトボードで表を作成し、あるセルに1行だけ文字を入れて確定する（＝キャッシュがその時の低い高さで記録される）
2. その行の下境界をドラッグして行を明らかに高くする（または同じ行の別セルに3行ほど入れて行高を伸ばす）
3. 1で入力したセルをもう一度ダブルクリックする → **セルだけが文字ぴったりの高さに縮む**（添付2枚目の状態）
4. フォーカスを外すと元に戻る

**パッチ後の確認**

- 上記3でセルの高さが変わらないこと（罫線・文字の縦中央位置が編集前後で不動）
- 編集中に改行を増やす → 行が伸びる／改行を減らす → 行が縮む（手動行高 `rh` が下限として効く）が従来どおり動くこと
- 手動行高を設定していない表で、文字量に応じた自動フィットが従来どおり効くこと
- 複数人で同じボードを開き、片方が編集中にもう片方の画面で高さがちらつかないこと
- 素の図形（矩形＋ラベル）の伸縮（BRU6-011）が変わっていないこと
- `pnpm build` が通ること（本リポジトリは `tsc` を使わず vite build が唯一のゲート）
- **本番ビルドでも直っていること**（dev だけ当てて満足しない。4-2(2) が入っているか確認）

---

## 7. 見積り

| 作業 | 目安 |
|---|---|
| パッチ作成（dev/prod 2箇所）＋ `pnpm patch-commit` | 0.5h |
| コメント追記 | 0.2h |
| 動作確認（再現→修正確認、共同編集含む） | 0.5h |

ファイル追加なし・アプリ側ロジック改修なし。
