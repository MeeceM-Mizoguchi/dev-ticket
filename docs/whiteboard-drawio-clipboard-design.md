# ホワイトボード → draw.io 貼り付け 設計書

> 対象: ホワイトボードでコピーした内容を、draw.io（app.diagrams.net）へ
>       **画像ではなく draw.io の図形として**貼り付けられるようにする
> ステータス: **実装済み（`npm run build` 緑 ／ 変換の自動検証を通過）**
> 実機で 2 度失敗し、いずれも原因を特定して修正済み（§3-4 クリップボード形式 ／ §10 ⑥ 回転した線形図形の位置）。**修正後の実機確認は未実施**
> 実装範囲: Phase 1〜3 すべて。逆方向（draw.io → ホワイトボード）は §10 ⑨ のとおり要件外で未着手
> 残作業: 実機確認（§9 検証手順）

---

## 1. 結論

**実現可能。** しかも「draw.io に貼れるようにすると、自分のボードに貼り戻せなくなる」という
一番の懸念は起きない。クリップボードに **2 種類の形式を同時に載せる**ことで両立できる。

| 載せる形式 | 中身 | 読む側 |
|---|---|---|
| `text/plain` | 今までどおり Excalidraw の `excalidraw/clipboard` JSON | 自ボード・他の Excalidraw |
| `text/html` | draw.io の `<mxGraphModel>` XML をテキストとして包んだ HTML | draw.io |

- draw.io は `text/html` を先に見て、その `textContent` が `<mxGraphModel>…</mxGraphModel>` なら
  **図形として取り込む**（§3 でソース確認）
- Excalidraw は `text/html` を読むが、**画像タグを含まない＝全部テキスト**の HTML だった場合は
  それを捨てて `text/plain` へフォールバックする（§4 でソース確認）

つまり同じ 1 回のコピーが、draw.io では図形に、自ボードでは今までどおりの図形になる。
ユーザーの操作は変わらない（`Ctrl/Cmd+C` → draw.io で `Ctrl/Cmd+V`）。

「図としてではなく draw.io の図形として置きなおす」という要件も、
mxCell（＝draw.io のネイティブ図形）を生成するので**そのまま満たす**。
貼り付け後は draw.io 側で色替え・リサイズ・接続の付け替えが普通にできる。

**ただし 1:1 の完全再現ではない。** 図形の語彙が両者で違うため、§7 の対応表のとおり
「ほぼそのまま移るもの」「近似になるもの」「移らないもの」がある。ここは仕様として割り切る前提。

---

## 2. 現状調査 — なぜテキストで貼られるのか

添付画像で draw.io に貼られていたのは、Excalidraw のクリップボード JSON そのもの。

```
{"type":"excalidraw/clipboard","elements":[{"id":"WlAqYVgC-24jNiL5jvM_Z","type":"frame",...
```

### 2-1. 書き込み側

コピー時にクリップボードへ載っているのは **`text/plain` の JSON 1 種類だけ**。

- 通常の選択 → Excalidraw 標準の `onCopy` が `navigator.clipboard.writeText(JSON)` を呼ぶ
- フレームを含む選択 → 本アプリが横取りする
  [whiteboardFrameCopy.ts:108](../src/app/lib/whiteboardFrameCopy.ts#L108) `writeFrameAwareClipboard()`
  こちらも `clipboardData.setData("text/plain", json)` の 1 種類

横取りの入口は [WhiteboardCanvas.tsx:915-958](../src/app/components/whiteboard/WhiteboardCanvas.tsx#L915-L958) に
すでに 4 経路ぶん揃っている（`copy` / `cut` イベント、`Ctrl+X` キー、右クリックメニューのクリック）。
**この既存の仕組みがそのまま拡張ポイントになる。**

### 2-2. 読み込み側

draw.io は `excalidraw/clipboard` を知らない。draw.io のソースに `excalidraw` の文字列は
1 箇所も無い（Lucidchart・Miro・Visio のインポータはあるが Excalidraw は無い）。
JSON は図として解釈されず、ただの文字列としてテキスト図形になる。これが添付画像の状態。

→ **draw.io が読める形式を、こちらが作って渡すしかない。**

---

## 3. draw.io は何を受け付けるか（ソース確認済み）

`jgraph/drawio` の `src/main/webapp/js/diagramly/EditorUi.js`（dev ブランチ, 31,042 行）を読んで確認した。

### 3-1. 貼り付けの本体 `EditorUi.prototype.pasteCells`（L20563 付近）

```js
var data = (!override) ? cpData.getData('text/html') : null;

if (data != null && data.length > 0) {
    elt = this.parseHtmlData(data);
    asHtml = elt.getAttribute('data-type') != 'text/plain';
}
else if (plain != null && plain.length > 0) { /* text/plain を使う */ }
```

そのあと（L20620 付近）:

```js
if (elt.textContent.substring(0, 13) == '<mxGraphModel' &&
    elt.textContent.substring(elt.textContent.length - 15) == '</mxGraphModel>')
{
    xml = elt.textContent.replace(/ /g, ' ');   // &nbsp; を普通の空白へ
}
```

→ **`text/html` の `textContent` が `<mxGraphModel>` で始まり `</mxGraphModel>` で終わっていれば、
それを XML として取り出す。**

### 3-2. 判定と取り込み

- `EditorUi.prototype.isCompatibleString`（L1356）— XML をパースして `extractGraphModel` が通れば OK
- `EditorUi.prototype.pasteXml`（L20408）— `importXml(xml, dx, dy)` でセルを**追加**し、
  `graph.setSelectionCells(cells)` で選択状態にする（＝既存の図は消えない）

### 3-3. 押さえておくべき性質

XML の取り出し口は**2つある**。どちらを狙うかが実装の分かれ目になった。

| # | 取り出し口 | 判定 |
|---|---|---|
| (a) | 貼り付けた要素**全体**の `textContent` | `<mxGraphModel` で始まり `</mxGraphModel>` で終わるか（`substring` の完全一致） |
| (b) | **最初の `<span>`** の `textContent` | `decodeURIComponent` して `mxUtils.trim` した結果が `isCompatibleString` を通るか（EditorUi.js L20663 付近） |

**(a) は使えない。**（→ §3-4）採用したのは (b)。

| 性質 | 内容 |
|---|---|
| `text/plain` だけでも通る | `asHtml=false` 経路でも `innerText` → `isCompatibleString` で拾われる。**が、それだと自ボードに貼れなくなる**ので採らない |
| サニタイズされる | `parseHtmlData` が `Graph.sanitizeHtml`（DOMPurify）を通す。(b) は中身が URI エンコード済み＝英数字だけなので無傷 |
| (b) は外側に強い | span **自身**の `textContent` を見て `trim` もするので、外を何で包まれても影響を受けない |
| 貼り付け位置 | `Editor.pasteAtMousePointer` が有効ならマウス位置。無効なら少しずらして配置 |

### 3-4. 【実機で判明】(a) はクリップボードを往復すると成立しない

最初の実装は (a) を狙って `<div>` にエスケープした XML を入れたが、**draw.io にテキストとして貼られた。**

ブラウザは `text/html` を CF_HTML 形式で保持し、読み出すときに次のように包んで返す。

```
<html>

<body>

<!--StartFragment--><div>&lt;mxGraphModel …&gt;</div><!--EndFragment-->

</body>

</html>
```

`<html>`/`<body>` は `innerHTML` の解析で消えるが、**改行の空白テキストノードは残る**。
その結果 `elt.textContent` が `"

<mxGraphModel…"` になり、`substring(0, 13)` が一致しない。
一致しないと draw.io は `xml = elt.innerHTML`（＝エスケープされたままの文字列）へ落ち、
`isCompatibleString` も `'&'` 始まりで false になるため、**XML がそのままテキスト図形になる**。

こちらの生成物に空白を入れないだけでは防げない（付けるのはブラウザ）ので、
**(b) に切り替えた**。draw.io 自身の `copyCells` も
`mxUtils.setTextContent(elt, encodeURIComponent(xml))`（EditorUi.js L20359）と書いており、
(b) が本来の経路である。

---

## 4. Excalidraw 側と衝突しない根拠（ソース確認済み）

`@excalidraw/excalidraw@0.18.1` の `dist/prod/chunk-K2UTITRG.js` を読んで確認した。

### 4-1. HTML の走査（`Fp`）

```js
function Fp(e){
  let t=[];
  for(let n of e.childNodes)
    if(n.nodeType===3){ let r=n.textContent?.trim(); r && t.push({type:"text",value:r}) }
    else if(n instanceof HTMLImageElement){ ... t.push({type:"imageUrl",value:r}) }
    else t=t.concat(Fp(n));
  return t
}
```

**`<img>` 以外はすべて `type:"text"` になる。**

### 4-2. 判定（`j7` = parseClipboard の前段）

```js
j7 = async (e,t=!1) => {
  let n = !t && e && Q7(e);              // Q7 = text/html を DOMParser で解析
  return n
    ? n.value.every(o => o.type === "text")
        ? { type:"text", value: e.clipboardData?.getData(H.text) || ... }   // ← text/plain へ戻る
        : n                                                                  // ← 画像混在のときだけ HTML を採用
    : { type:"text", value: (e.clipboardData?.getData(H.text)||"").trim() }
}
```

→ **`text/html` がテキストのみ（`<img>` を含まない）なら、Excalidraw は `text/plain` を読みに戻る。**
そのあと `JSON.parse` → `type === "excalidraw/clipboard"` で通常どおり要素として貼り付く。

**したがって、`text/html` に mxGraphModel XML をエスケープして入れておいても、
自ボードへの貼り付けは 1 ミリも変わらない。** これが本設計の肝。

---

## 5. 方式

### 5-1. クリップボードに載せるもの

```
text/plain : {"type":"excalidraw/clipboard","elements":[...],"files":{...}}   ← 現状のまま
text/html  : <span>%3CmxGraphModel%20dx%3D%220%22…%3C%2FmxGraphModel%3E</span>  ← 追加
```

`text/html` 側は **`<span>` に `encodeURIComponent(XML)` を入れる**（draw.io 自身と同じ形。§3-4）。
URI エンコードすると `<` `&` `%` も日本語もすべて英数字になるので、

- HTML エスケープの取り違えが起きない
- draw.io 側の DOMPurify に触られない
- ラベルに「50%」のような文字があっても `decodeURIComponent` が例外を投げない

の 3 つを同時に満たせる。Excalidraw 側は「`<img>` を含まない HTML」を捨てて `text/plain` へ
戻る（§4）ので、`<div>` でも `<span>` でも従来どおり動く。

### 5-2. 書き込み経路

同期の `ClipboardEvent.setData` が最も確実なので、そちらを主経路にする。

```ts
// 主経路（copy / cut イベント）— 同期・2 種類同時に載る
e.clipboardData.setData("text/plain", excalidrawJson);
e.clipboardData.setData("text/html", drawioHtml);
e.preventDefault();
e.stopImmediatePropagation();
```

```ts
// 副経路（右クリックメニュー・Ctrl+X キー段階）— ClipboardEvent が無い
await navigator.clipboard.write([new ClipboardItem({
  "text/plain": new Blob([excalidrawJson], { type: "text/plain" }),
  "text/html":  new Blob([drawioHtml],     { type: "text/html"  }),
})]);
```

> **重要:** Excalidraw 標準の `onCopy` は `navigator.clipboard.writeText()` を使う
> （`hs` 関数で確認）。`writeText` は**クリップボード全体を置き換える**ため、
> こちらが `text/html` を足しても後から消される。
> → **標準ハンドラを走らせず、こちらが完全に横取りする必要がある。**

### 5-3. 横取り条件の変更

現在の横取りは `isFrameSelected(api)` が true のときだけ（フレーム以外は標準に任せている）。
これを **「選択が 1 つ以上あるとき」** に広げる。

```diff
- if (!onCanvas(e.target) || !isFrameSelected(api)) return;
+ if (!onCanvas(e.target) || !hasSelection(api)) return;
```

- コピー対象の収集は既存の `collectSelectionClosure()`（[whiteboardFrames.ts](../src/app/lib/whiteboardFrames.ts)）が
  バインドテキスト・フレームの中身・影矩形まで面倒を見るので**そのまま流用**
- 切り取りは `cutFrameSelection()` が閉包ごと削除する。フレーム以外の選択でも正しく動く
- テキスト編集中・入力欄内は既存の `onCanvas()` が弾く（＝普通の文字コピーは妨げない）

**リスク:** 横取り範囲が「フレーム選択時」から「全選択時」に広がるため、
これまで Excalidraw 標準に任せていた挙動を自前で背負うことになる。
ただし収集ロジックは既に本ボード専用の閉包に置き換わっており、
標準より広く正しく集める側なので、実質的な後退は想定しにくい。
段階リリース（§9）の Phase 1 でここを重点的に手動確認する。

---

## 6. 生成する mxGraphModel の形

```xml
<mxGraphModel dx="0" dy="0" grid="0" gridSize="10" guides="1" tooltips="1" connect="1"
              arrows="1" fold="1" page="1" pageScale="1" math="0" shadow="0"><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="n1" value="販売" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#343a40;"
        vertex="1" parent="1">
  <mxGeometry x="4465" y="422" width="60" height="23" as="geometry"/>
</mxCell>
<mxCell id="e1" style="edgeStyle=none;html=1;endArrow=blockThin;strokeColor=#343a40;"
        edge="1" parent="1" source="n1" target="n2">
  <mxGeometry relative="1" as="geometry">
    <Array as="points"><mxPoint x="4500" y="470"/></Array>
  </mxGeometry>
</mxCell>
</root></mxGraphModel>
```

- 座標系は Excalidraw のシーン座標をそのまま使える（どちらも px、原点左上・Y 下向き）
- `value` は XML エスケープ。`html=1` なので改行は `<br>` にする
- `id` は Excalidraw の要素 id をそのまま使ってよい（英数と `_`・`-` のみなので安全）

---

## 7. 変換対応表

### 7-1. そのまま移るもの

| ホワイトボード | draw.io スタイル |
|---|---|
| `rectangle` | `rounded=0;whiteSpace=wrap;html=1`（`roundness` あり → `rounded=1;arcSize=…`） |
| `ellipse` | `ellipse;whiteSpace=wrap;html=1` |
| `diamond` | `rhombus;whiteSpace=wrap;html=1` |
| `arrow` | `edge="1"` ＋ `endArrow=blockThin`。`startBinding`/`endBinding` の `elementId` → `source`/`target` |
| `line` | `edge="1"` ＋ `endArrow=none`。点列 → `<Array as="points">` |
| `text`（単独） | `text;html=1;strokeColor=none;fillColor=none;align=…;verticalAlign=top` |
| バインドテキスト（`containerId` 持ち） | 親図形の `value` に畳む |
| `angle`（ラジアン） | `rotation=<度>` |
| `opacity` | `opacity=<0..100>` |
| `strokeWidth` | `strokeWidth=<px>` |
| `strokeStyle: dashed/dotted` | `dashed=1;dashPattern=8 8` / `dashPattern=1 4` |
| `backgroundColor: "transparent"` | `fillColor=none` |
| `strokeColor` / `backgroundColor` | `strokeColor=` / `fillColor=` |
| `customData.wbTextColor` | `fontColor=` |
| `customData.wbVias`（経由点） | `<Array as="points">` |
| `groupIds` | 同一グループを `style="group"` の親セルにまとめる |
| `link` | `<UserObject label="…" link="…">` でラップ |
| `image` | `shape=image;imageAspect=0;image=<dataURL>`（`files` の dataURL をそのまま埋める） |

### 7-2. 近似になるもの

| ホワイトボード | draw.io | 備考 |
|---|---|---|
| 三角形（`line` ＋ `customData.wbTriangle`） | `triangle;direction=north` ＋ 外接矩形 | 自前図形なので専用マッピングが要る |
| 波括弧（`line` ＋ `customData.wbBrace`） | `shape=curlyBracket;rounded=1;direction=…` | トゲ位置 `tip` は draw.io に該当パラメータ無し。中央固定になる |
| フレーム | `rounded=0;container=1;collapsible=0` の矩形 ＋ 名前をラベルに | 装飾用のロック矩形（`wbFrameBg`/`wbDecor`/`wbBgFor`）は**出力しない**（フレーム自身の塗り・枠線に畳む） |
| 表（`customData.wbTable`） | セル矩形をそのまま並べる ＋ グループ化 | draw.io の表シェイプには寄せない。見た目は一致するが「表として編集」はできない |
| `freedraw`（手描き） | `edgeStyle=none;curved=1;endArrow=none` ＋ 点列 | 点数が多いと重い。間引き（Douglas-Peucker）を入れる |
| `roughness > 0`（手描き風） | `sketch=1;curveFitting=1;jiggle=2` | draw.io 15+ のスケッチスタイル |
| `fontFamily`（Excalifont 等） | `fontFamily=Helvetica` へ丸め | draw.io 側に同じフォントが無い |
| Mermaid 図（`customData.wbMermaid`） | 展開後の図形群として出力 | 元の Mermaid ソースは失われる |

### 7-3. 移らないもの（仕様として非対応）

| 項目 | 理由 |
|---|---|
| `fillStyle: hachure` / `cross-hatch`（斜線塗り） | draw.io にハッチ塗りが無い。**ベタ塗り**になる（不透明度を下げる案は draw.io の `opacity` が枠線にも効いてしまい、境界まで薄くなるので採らなかった） |
| コメント（`whiteboardComments`） | ボード外の別テーブル。draw.io の図形ではない |
| 折りたたみ（`wbFolded`）・インデント | 展開後の見た目のみ出力 |
| `embeddable` / `iframe` | draw.io 側に等価な貼り付け先が無い |
| 内部リンクチップ（`InternalLinkChip`） | URL として `<UserObject link>` にはできるが、遷移先はこのアプリ内 |

---

## 8. 実装箇所（実装済み）

### 8-1. 新規

**[whiteboardDrawioExport.ts](../src/app/lib/whiteboardDrawioExport.ts)**（約 560 行）

```ts
// 選択要素 → mxGraphModel XML（失敗したら null）
export function buildDrawioXml(elements, files): string | null

// draw.io が受け取れる text/html（XML をエスケープして 1 要素に包む）
export function buildDrawioClipboardHtml(xml: string): string

// ダウンロード用の .drawio 本文（<mxfile><diagram>…）
export function buildDrawioFile(elements, files, title): string | null
```

守った方針:
- **Excalidraw に依存しない純粋関数だけ**にした。`api` を受け取らず、要素配列と `files` で完結する。
  そのため `TEXT_BORDER_PAD` は whiteboardAutoConnect から import せず値だけ持っている
  （あちらは Excalidraw 本体を読み込むため、import すると node 単体で動かせなくなる）。
- 未知の要素型に当たったら**そのセルだけ捨てて続行**（`try/catch` をセル単位で持つ）。
- 生成に失敗したら `null`。呼び出し側は `text/html` を載せず従来どおり動く。

### 8-2. 改修

**[clipboard.ts](../src/lib/clipboard.ts)**

- `copyTextAndHtml(text, html)` を追加。`ClipboardItem` で 2 種類を 1 回に書く。
  `writeText` はクリップボード全体を置き換えるので、非同期経路ではこれが必須。
  ネイティブ(Capacitor)はテキストだけ書いて `false` を返す（§10 ①）。

**[whiteboardFrameCopy.ts](../src/app/lib/whiteboardFrameCopy.ts)**

- `hasSelection()` を追加。`isFrameSelected()` は複製（Alt+ドラッグ / Ctrl+D）の選択拡張専用に用途を絞った。
- `buildPayload()` を追加（`text` と `html` を一度に作る）。旧 `buildFrameAwareClipboardJson()` は
  呼び出し元が無くなったので削除。
- `writeFrameAwareClipboard()` — `setData("text/html", …)` を追加。
- `writeFrameAwareClipboardViaApi()` — `copyTextAndHtml` へ差し替え。

**[WhiteboardCanvas.tsx](../src/app/components/whiteboard/WhiteboardCanvas.tsx)**

- copy / cut / `Ctrl+X` / 右クリックメニュー の 4 経路の条件を `isFrameSelected` → `hasSelection` に変更。
- `onCanvas()` に「画面の文字を範囲選択しているときは横取りしない」を追加。
  横取り範囲が全選択に広がったため、コメント本文などの文字コピーを奪わないようにする。
- Esc 処理のローカル変数 `hasSelection` は import と紛らわしいので `selecting` に改名。

**[WhiteboardExportMenu.tsx](../src/app/components/whiteboard/WhiteboardExportMenu.tsx)**

- 「draw.io形式で保存」を追加（`<mxfile>` をダウンロード → draw.io の「ファイル > 開く」）。
  変換できなかったときはボタンのラベルを一時的に「変換できませんでした」に変える。

### 8-3. アプリ内の貼り付けに影響が無いことの確認

WhiteboardCanvas の `onPaste`（Markdown / リッチテキスト貼り付け）は `text/html` を見るが、
その前に `text/plain` が `"type":"excalidraw` を含むかで抜けている
（[WhiteboardCanvas.tsx](../src/app/components/whiteboard/WhiteboardCanvas.tsx#L867)）。
text/plain は従来どおりなので、**この経路には影響しない**。

---

## 9. リリース範囲と検証

| Phase | 範囲 | 状態 |
|---|---|---|
| **1** | 二枚同時クリップボードの土台 ＋ 矩形・楕円・菱形・テキスト・矢印・線・色/線種/回転/不透明度/グループ | 実装済み |
| **2** | 画像・フレーム・表・三角形・波括弧・freedraw・リンク・スケッチスタイル | 実装済み |
| **3** | `.drawio` ファイルエクスポート | 実装済み |
| — | （任意）draw.io → ホワイトボードの逆方向貼り付け | **未着手**（§10 ⑨ のとおり今回の要件外） |

### 済んだ検証

- `npm run build` 緑（CLAUDE.md §1 のとおり `npx vite build` 単体では済ませていない）。
- 変換の自動検証。フレーム＋装飾影矩形／グループ／ラベル付き矩形／楕円／接続付き矢印／回転した三角形／
  背景板つきリンク付きテキスト／画像／手描き／大括弧を含む合成シーンを変換し、次を機械的に確認した。
  - XML としてパースでき `parsererror` が無い、先頭 `<mxGraphModel` ・末尾 `</mxGraphModel>`
  - すべての `parent` が**自分より前に**出ている（draw.io は親が先に現れる並びを前提にしている）
  - `source` / `target` が実在するセルを指している
  - `style` の項目がすべて `k=v` かシェイプ名（＝ `;` 混入で壊れていない）
  - 影矩形・図形内テキストがセルとして出ず、持ち主へ畳まれている
  - ラベルの二重エスケープ（改行は `<br>`、ユーザーの `<b>` は文字のまま）
  - 画像の dataURL が `data:image/png,…`（`;base64` が落ちている）
  - **回転した三角形・大括弧**（`repairOpenTriangles` / `rebuiltBrace` と同じ点列の持ち方を再現し、
    angle = 0 / 90° / 180° のそれぞれ）で geometry が「回転前の外接矩形」と厳密に一致する（§10 ⑥ の回帰テスト）
  - 大括弧の向き 4 種が `direction` / `flipH` の正しい組み合わせになっている（§10 ⑦）
  - `buildDrawioClipboardHtml()` を**クリップボード往復（CF_HTML の `<html>
<body>
<!--StartFragment-->…` 包み）に通したうえで**、
    draw.io と同じ手順（最初の span の `textContent` → `decodeURIComponent` → `trim`）で XML が完全に復元できる
  - 同時に「要素全体の `textContent` の完全一致」は往復すると**成立しない**ことも確認（§3-4 の前提が変わったら気づけるように）

### 残っている手動確認

1. **マッピング単体** — 生成 XML を draw.io の `その他 > 図の編集`（Extras > Edit Diagram）へ直接貼り、
   形・色・接続を目視する。クリップボードを介さないので原因の切り分けが速い。
2. **往復** — ホワイトボードでコピー → 自ボードに貼る（**壊れていないこと**）→ draw.io に貼る（図形になること）。
3. **経路 4 つ** — `Ctrl+C` / `Ctrl+X` / 右クリック「コピー」/ 右クリック「切り取り」。
4. **奪っていないこと** — コメント本文の文字を範囲選択して `Ctrl+C`（図形ではなく文字がコピーされる）。
5. **他アプリ** — Word・Slack・メモ帳へ貼って落ちないこと（テキストが出るのは従来と同じ）。
6. **エクスポート** — 「draw.io形式で保存」→ draw.io の「ファイル > 開く」で読める。

---

## 10. 既知の制約・注意点

| # | 内容 |
|---|---|
| ① | **iOS アプリ（Capacitor）では draw.io 形式が載らない。** `@capacitor/clipboard` は文字列か画像しか扱えず、複数 MIME を同時に書けない。ネイティブでは従来どおり `text/plain` のみ（＝機能は Web 限定）。[clipboard.ts](../src/lib/clipboard.ts) の分岐にコメントを残すこと |
| ② | **Firefox の非同期経路。** `navigator.clipboard.write` の `text/html` サポートはブラウザ差がある。`ClipboardEvent.setData` の主経路（§5-2）は全ブラウザで動くので、副経路が落ちても `Ctrl+C` は必ず効く形にしておく |
| ③ | **`<span>` ＋ `encodeURIComponent` の形を崩さない。** draw.io の `pasteCells` は最初の span の `textContent` を `decodeURIComponent` して読む。`<div>` にエスケープした XML を入れる形は、クリップボード往復でブラウザが付ける改行のせいで**テキストとして貼られる**（§3-4・実機で確認済み） |
| ④ | **サイズと重さの上限（実装値）。** 画像 1 枚 1.5 MB 超は破線の枠だけにする（`MAX_IMAGE_BYTES`）／要素 5,000 個超・XML 10 MB 超は変換自体を諦めて `null`（＝従来どおりのコピー）／手描き線は RDP で間引いたうえ waypoint 120 点まで。変換は `copy` イベント内で同期に走るので、上限は「コピー操作の体感を落とさない」ためでもある |
| ⑤ | **draw.io 以外の mxGraph 系（Confluence の draw.io アドオン等）** も同じ `pasteCells` を通るので、同様に貼れる見込み（未検証） |
| ⑥ | **線形要素の外接矩形と回転中心は必ず points から求める（実機で踏んだ）。** この盤の三角形は `repairOpenTriangles` が `x = 外接矩形の中央` / `points = [[0,0],[w/2,h],[-w/2,h],[0,0]]`、大括弧は `rebuiltBrace` が `x = 外接矩形の左 + points[0].x`（`{` なら右端）で持つ。つまり **`x` は外接矩形の左上ではない**。Excalidraw が線形要素を回すのは「points から求めた外接矩形の中心」なので、`(x + width/2, y + height/2)` を回転中心にすると**回転した三角形は幅ぶん・大括弧は幅の2倍ぶん横へずれる**（`linearBBox` / `rotationCenter`）。Excalidraw も draw.io も「回転前の矩形＋その中心まわりの回転角」で図形を表すので、正しく求めさえすれば geometry は回転前の外接矩形をそのまま渡せばよい |
| ⑦ | **大括弧の向きは三角形と上下が逆。** draw.io の `curlyBracket` は基準形が `{`（トゲが左＝**西**向き）で、`triangle` は**東**向き。`mxShape.getShapeRotation()` は north→+270° / south→+90°（時計回り）なので、括弧はトゲを上にしたいとき `direction=south`、下にしたいとき `direction=north` になる |
| ⑧ | **グループを作る条件。** メンバーが 2 つ以上／エッジを含まない／所属フレームが揃っている、を満たすときだけ draw.io のグループにする。フレームをまたぐグループは親が決まらないので作らない。エッジは常にルート直下に置く（`source`/`target` は id 参照なので所属が違っても繋がる） |
| ⑨ | **逆方向（draw.io → ホワイトボード）は別設計。** 既存の `paste` ハンドラ（[WhiteboardCanvas.tsx:894](../src/app/components/whiteboard/WhiteboardCanvas.tsx#L894)）に mxGraphModel の解釈を足せば同じ枠組みで作れるが、今回の要件外 |

---

## 11. 却下した案

| 案 | 却下理由 |
|---|---|
| **SVG をクリップボードに載せる** | draw.io は SVG を**1 個の画像セル**として取り込む。「図としてではなく図形として」という要件を満たさない |
| **`text/plain` を mxGraphModel XML に差し替える** | draw.io には貼れるが、**自ボードや他の Excalidraw に貼り戻せなくなる**。明確な後退 |
| **draw.io に Excalidraw インポータを期待する** | draw.io のソースに Excalidraw の扱いは存在しない（Lucidchart・Miro・Visio のみ）。こちら側で作るしかない |
| **`.drawio` ファイル書き出しのみ** | 確実だが「コピペで済ませたい」という要件に対して手数が多い。Phase 3 の**保険**として併設する位置づけに留める |
