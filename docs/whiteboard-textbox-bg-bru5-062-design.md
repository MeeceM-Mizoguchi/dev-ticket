# BRU5-062 ホワイトボード テキストボックス背景バグ — 設計書

> 分類: バグ / 実装は本設計の承認後に別途着手する。

## 0. 症状

テキストボックスに背景色を付けた状態で **画像の上に重ねると、背景色が消えて（透明になり）後ろの画像が透けて見える**。
テキスト文字自体は画像の上に表示されるが、背景の塗りだけが画像に隠れる。

---

## 1. 根本原因

テキストボックスの背景色は **Excalidraw の要素ではなく、DOM の別 canvas に自前描画**している。

`TextBoxDecorLayer.tsx` の構成（`FrameDecorLayer` と同方式）:

- Excalidraw の `text` 要素は文字色(`strokeColor`)しか持たず、塗り／枠線を描けない。
- そこで書式は `text.customData.wbTextBox = { bg?, border?, borderColor? }` に保持し、描画はオーバーレイ canvas で行う。
- **背景**は文字の背面に置くため下層 canvas（`z-index: -1`）へ描く。
- **枠線**は上層 canvas（`z-index: 4`）へ描く。
- ボード全体は `viewBackgroundColor: "transparent"`、コンテナ `background:#fff`。

これで **奥→手前** の重なり順は次のようになる:

| 層 | 内容 | z |
|---|---|---|
| 1 | コンテナ背景（白ボード） | 最背面 |
| 2 | **背景オーバーレイ canvas（テキスト背景色・フレーム背景色）** | `-1` |
| 3 | **Excalidraw 本体 canvas（画像・図形・文字グリフ 全部ここ）** | `0`(auto) |
| 4 | 枠線オーバーレイ canvas | `4` |
| 5 | Excalidraw 標準UI | `6` |

- 背景オーバーレイ（層2）は **Excalidraw 本体（層3）より必ず後ろ**。
- 何も無いボード上では層3が透明なので、層2の背景色が透けて見える → 正常に見える。
- しかし **画像は層3の Excalidraw 要素**。不透明な画像が層2の背景色を覆い隠す。
  文字グリフも層3で画像の上に描かれるので文字だけ残る → **「背景が透明になった」ように見える**。

> オーバーレイ方式は「画像より前・文字より後ろ」という **1枚の本体 canvas の内部** に割り込めないため、
> 下に要素が来た瞬間に破綻する。これは実装のバグではなく **方式そのものの限界**。
> （同じ原理でフレーム背景色も画像に隠れるが、本チケットはテキストボックスが対象。§6参照）

### 副次的欠陥（同一原因・要修正）

エクスポート（`WhiteboardExportMenu`）は `exportToBlob`/`exportToSvg` に **Excalidraw の要素しか渡さない**。
オーバーレイ canvas は含まれないため、**PNG/SVG/クリップボードには背景色も枠線も一切出力されていない**。
画面では（画像が無ければ）見えるのに、書き出すと消える。本バグと同じ「背景が要素でない」ことが原因。

---

## 2. 設計方針: 背景／枠線を **実 Excalidraw 要素（rectangle）** で描く

オーバーレイ canvas をやめ、テキストの直下に **ロックした矩形要素（＝影の背景板）** を 1 枚敷く。

Excalidraw が本体 canvas 内で「矩形 → その上に文字」の順に描くため、

- 矩形（背景・枠線）は **画像より前**（zオーダーで画像の後に置く）、
- 文字グリフは **矩形より前** に自然に描かれる。

→ **画像の上でも背景が正しく塗られ、文字も見える。**
→ エクスポートも要素なので **背景・枠線がそのまま出力される**（副次欠陥も解消）。

### 2.1 データモデル

| 保持先 | 役割 | 備考 |
|---|---|---|
| `text.customData.wbTextBox = { bg?, border?, borderColor? }` | **書式の真実の値（変更なし）** | 書式パネルの入出力・後方互換のため据え置き |
| `text.customData.wbBgRectId = <rectId>` | 対の背景矩形へのリンク | 新規 |
| 背景 `rectangle` 要素 | 実際の塗り／枠線を描画 | `locked:true`・`customData.wbBgFor=<textId>` |

背景矩形の各プロパティ（`wbTextBox` から導出）:

```
type: "rectangle", locked: true, roughness: 0, roundness: { type: 3 }（小さめ角丸）
backgroundColor: fmt.bg ?? "transparent",  fillStyle: "solid"
strokeColor:  fmt.border ? (fmt.borderColor ?? "#343a40") : "transparent"
strokeWidth:  2（枠線ありの時）
x: t.x - PAD,  y: t.y - PAD,  width: t.width + 2*PAD,  height: t.height + 2*PAD,  angle: t.angle
frameId: t.frameId,  customData.wbParent: t.customData?.wbParent   // フレーム所属を継承
```

`PAD = TEXT_BORDER_PAD(=6, scene単位)`。現行の枠線位置・接続 bbox(`connectBBox`) と一致させ、
**線・矢印の吸着位置が今と変わらない**ようにする（§4）。

### 2.2 ライフサイクル（`WhiteboardCanvas.onChange` に集約）

既存の自作機構（`followFrameMoves` / `autoConnectLines` 等）と同じく、**onChange 内の副作用 + 自己修復**で管理する。
新規ユーティリティ `syncTextBoxBgRects(api, elements, appState, remote)` を `whiteboard*` に追加し、`onChange` から呼ぶ。

処理（remote 反映由来・ドラッグ/リサイズ中の扱いは既存機構に倣いガード）:

1. **生成**: `wbTextBox` に bg か border があり `wbBgRectId` が無い（または指す矩形が消えている）テキスト
   → 背景矩形を作り、`text` の **直前** に挿入、双方向リンクを張る。
2. **幾何追従**: 各テキストの x/y/width/height/angle/frameId から対の矩形を毎回同期（+PAD）。
   z順も「常にテキストの直下」に保つ。
3. **書式反映**: `fmt.bg` / `border` / `borderColor` 変更 → 矩形の `backgroundColor`/`strokeColor` 更新。
4. **書式解除**: bg も border も無くなった → 矩形を削除し `wbBgRectId` を消す。
5. **テキスト削除**: `text.isDeleted` → 対の矩形も `isDeleted`。
6. **自己修復（重要）**: 「`wbBgFor` が指すテキストが無い／既に別矩形に所有されている／書式が消えた」孤児矩形は削除。
   1テキスト＝1矩形になるよう **所有権で正規化**（重複は先勝ちで残し他を削除）。
   → コピペ・複製・複数人同時編集での重複を自己修復する（コードベースの既存流儀と同じ）。

### 2.3 ロックの意図

- 矩形は `locked:true` にして **単独で選択・移動・リサイズできない影**にする。
  ユーザーはこれまで通り **テキストを選択**して操作し、矩形は onChange が追従させる。
- 書式パネル（`TextBoxFormatPanel`）は **従来どおり text 要素を対象**にするため変更不要
  （`isPlainTextBox` は `containerId` なし text のまま。矩形は別要素）。

---

## 3. 変更ファイル一覧（予定）

| ファイル | 変更 |
|---|---|
| `src/app/lib/whiteboardTextBoxBg.ts`（新規） | `syncTextBoxBgRects()`：生成・追従・書式反映・削除・自己修復 |
| `src/app/components/whiteboard/WhiteboardCanvas.tsx` | `onChange` に `syncTextBoxBgRects` を配線。`TextBoxDecorLayer` の背景描画を撤去 |
| `src/app/components/whiteboard/TextBoxDecorLayer.tsx` | **背景 canvas を廃止**。枠線も矩形へ移すなら本ファイル全廃（§5で判断） |
| `src/app/lib/whiteboardAutoConnect.ts` | 影矩形を **接続対象から除外**（`isConnectableShape` で `wbBgFor` を弾く）。§4 |
| `src/app/lib/whiteboardFrames.ts` | 影矩形を所属再判定・グループ選択の**対象外**にする（テキストに追従するため） |

`TextBoxFormatPanel.tsx`・エクスポート・同期(`useWhiteboardSync`)は変更不要（矩形は普通の要素として自動同期・自動エクスポート）。

---

## 4. 既存機構との整合（デグレ防止の要点）

- **自動接続 / 追従**: 影矩形を `isConnectableShape` から除外しないと、線が影矩形に吸着してしまう。
  `customData.wbBgFor` を持つ要素は接続対象・ヒット判定から除外する。
  テキスト自身への接続 bbox は現行どおり（`connectBBox` が枠線ありで +PAD 広げる）を維持し、
  影矩形の外周と一致するので **吸着位置は不変**。
- **フレーム所属**: 影矩形はテキストと同じ `frameId`/`wbParent` を継承し、
  `captureFrameChildren`・`followFrameMoves`・`reparentDraggedElements` の **独立対象にはしない**
  （テキスト追従で動くので二重移動を防ぐ）。
- **回転**: 現行オーバーレイと同じく `angle` を矩形へ転写。中心も一致するので見た目不変。
- **複数人同時編集(Yjs)**: 影矩形は通常要素として同期。生成は編集者側のみ（remote ガード）、
  正規化(§2.2-6)で万一の重複を収束させる。

---

## 5. 枠線をどうするか（判断ポイント）

背景を矩形化すれば、**枠線も同じ矩形の `strokeColor` で描ける**ため、枠線オーバーレイ(`z-index:4`)も不要にできる。

- **推奨**: 枠線も矩形へ統合し、`TextBoxDecorLayer.tsx` を全廃してオーバーレイ方式を完全に撤去する。
  → 実装が 1 経路に集約され、エクスポートにも枠線が出る（副次欠陥②の解消）。枠線は画像より前という問題も無い
  （枠線は元々 `z-index:4` で最前面に出ていたが、矩形化すると「テキスト直下」になる。文字の外側に描くので見た目は実質同じ）。
- 代替: 背景だけ矩形化し枠線オーバーレイは残す。変更は小さいが方式が二重化し、エクスポートに枠線が出ない欠陥が残る。→ 非推奨。

---

## 6. スコープ外だが同根の既知事象（記録）

- **フレーム背景色も画像に隠れる**（`FrameDecorLayer` が同じ `z-index:-1` 方式）。本チケットの対象外だが、
  将来 BRU で同方式（影矩形化）を適用すれば解消できる。今回は **テキストボックスのみ**修正する。

---

## 7. 却下した代替案

| 案 | 内容 | 却下理由 |
|---|---|---|
| A. 背景オーバーレイを本体 canvas の**前面**へ | 画像は隠せるが**文字も隠れる** | 文字を自前再描画する必要があり、Excalidraw のフォント/改行/整形メトリクスを画素一致で再現するのは脆い |
| B. 前面オーバーレイ＋文字部分を `destination-out` でくり抜く | 塗りだけ残し文字を透かす | 同上。グリフ形状の完全一致が必要で font ロードタイミング等で破綻 |
| C. text を Excalidraw の**コンテナ束縛テキスト**化 | ネイティブに塗り＋枠線 | 作成UX・折返し挙動・選択対象・接続 bbox・既存データ移行が大きく変わり影響甚大 |

→ **影矩形方式（本文§2）** が、Excalidraw ネイティブ描画を使うため最も堅牢で、
エクスポート欠陥も同時に解消し、コードベースの「onChange 副作用＋自己修復」流儀に最も馴染む。

---

## 8. 移行（既存ボード）

- 影矩形は同期要素なので、**編集者がボードを開いた時点で `syncTextBoxBgRects` が生成**し、以後全員に共有される（恒久アップグレード）。
- 過渡期の懸念: まだ誰も編集者として開いていないボードを **閲覧専用ユーザー**が見ると、旧オーバーレイ撤去済みなら背景が出ない瞬間があり得る。
  対策候補（実装時に選択）: (a) 影矩形が無い書式付きテキストにだけ、閲覧時もローカル描画するフォールバックを一時的に残す / (b) 編集者初回オープンでの一括生成に任せる（大半のボードは即アップグレード）。

---

## 9. 受け入れ確認（実装後）

1. 画像の上にテキストボックスを重ね背景色を付ける → **背景色が画像を隠して表示**される。
2. 背景色付きテキストを画像の上へドラッグ移動・回転・リサイズ → 追従して破綻しない。
3. 枠線あり／なし・カスタム色の各パターンで表示が正しい。
4. **エクスポート（PNG/SVG/コピー）に背景色・枠線が出力**される。
5. 線・矢印の吸着位置が従来と変わらない（影矩形に吸着しない）。
6. 複数人同時編集で背景板が重複・ちらつきしない。
7. フレーム内のテキストボックスがフレーム移動・エクスポートに正しく追従する。
</content>
</invoke>
