# BRU10-044 グループ化後の図形の回転 — 設計

分類: バグ（BRU9-054「四隅からの回転」の未対応ケース）
対象: ホワイトボード / `src/app/components/whiteboard/CornerRotateOverlay.tsx`

---

## 1. 現象と原因

四隅の回転ゾーンを出すか決めているのは `CornerRotateOverlay` の `readTarget()`
（[CornerRotateOverlay.tsx:72-84](../src/app/components/whiteboard/CornerRotateOverlay.tsx#L72-L84)）。ここに2つのガードがある。

| ガード | 該当する画面 | 症状 |
|---|---|---|
| `if (... st.editingGroupId) return null` | 添付画像1（グループの中へ入って1つだけ選択した状態） | 単体を選べているのに ↻ が出ない |
| `if (ids.length !== 1) return null`（「複数選択は本体の回転つまみに任せる」） | 添付画像2（グループをクリックして全体が選択された状態） | グループ全体の四隅に ↻ が出ない |

Excalidraw 本体は複数選択に対して「枠の上に離れて出る丸いつまみ1つ」しか出さない。
ゾーンを出さない実装は BRU9-054 当時の意図的な割り切りで、バグではなく**未対応**。

したがって修正は2本立てになる。

- **A. 単体モードの解禁**（画像1）… ガードを緩めるだけ
- **B. グループモードの新設**（画像2）… 選択全体を一括で回す処理を新規に書く

---

## 2. 方針

`CornerRotateOverlay` に「単体モード」「グループモード」の2モードを持たせる。
ファイル追加はせず、この1ファイルの内部で完結させる（+120行程度）。

| | 単体モード（既存を拡張） | グループモード（新規） |
|---|---|---|
| 発動条件 | 回転可能な要素が1つだけ選択 | 回転可能な要素が2つ以上選択（＝グループ選択を含む） |
| 枠 | その要素の外接矩形（**要素と一緒に回る**） | 選択全体の共通外接矩形（**回らない・軸平行**） |
| 回転中心 | その要素の中心 | 共通外接矩形の中心（**pointerdown 時点で凍結**） |
| 回す量 | 要素の angle を絶対角へ | 全要素へ「差分角 delta」を加算 |

グループモードの意味論は Excalidraw 本体の `rotateMultipleElements`
（`node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js:23707`）に合わせる。
本体も回転中心は `pointerDownState.resize.center` で**ドラッグ開始時に凍結**している
（回転すると共通bboxの中心自体が動くため、毎フレーム取り直すと図形が流れていく）。

---

## 3. A. 単体モードの解禁（画像1）

`readTarget()` のガードから `st.editingGroupId` を外すだけ。

- `editingTextElement` / `editingLinearElement` は引き続きガードする（文字入力中・点編集中に出すと操作を奪う）。
- `editingGroupId` は「グループの中に入っている」という状態でしかなく、回転を妨げる理由がない。
- 回転した結果グループの共通bboxが広がるのは本体が再計算するので、こちら側の後処理は不要。
- ついでに `st.isRotating`（本体の丸いつまみでの回転中）もガードへ足す。今は入っておらず、
  本体の回転つまみを掴んでいる間もゾーンが出てしまっている。

---

## 4. B. グループモードの新設（画像2）

### 4.1 ゾーンの位置

- 枠 = `getCommonBounds(selectedElements)`（`@excalidraw/excalidraw` から export 済み。
  [whiteboardFocus.ts:53](../src/app/lib/whiteboardFocus.ts#L53) で使用実績あり）。
  各要素の回転を織り込んだ軸平行bboxが返るので、本体が描く選択枠と完全に一致する。
- 選択枠は回らないので、ゾーンの配置は `angle = 0` で計算する（四隅から斜め外側へ `OUT`=27px）。
  単体モードのように `sin/cos` を掛けない、という点だけが違う。
- `MIN_BOX`（24px）未満は非表示。既存と同じ。
- ドラッグ中は共通bboxが毎フレーム変わるためゾーンも動く。本体の四隅つまみと同じ挙動なので違和感はない。

### 4.2 回転の計算

**pointerdown で凍結するもの**

```
center C          = 共通bboxの中心（以後 再計算しない）
startPointer      = atan2(pointer - C)
originals: Map<id, { x, y, angle, points?, cx, cy }>   // cx,cy は各要素の中心
```

**pointermove**

```
delta = atan2(pointer - C) - startPointer
Shift 時: delta = round(delta / 15°) * 15°        // 相対角を刻む（要素同士の相対角度が崩れない）
```

各要素へ（原本 → 現在を毎回計算するので誤差が蓄積しない）:

```
(ncx, ncy) = rotate(orig.cx, orig.cy, C, delta)
x     = orig.x + (ncx - orig.cx)
y     = orig.y + (ncy - orig.cy)
angle = normalize(orig.angle + delta)              // [0, 2π)
```

図形ラベル（`containerId` を持つ text）は容器と同じ移動量・同じ angle を与える（本体と同じ）。

### 4.3 この盤面固有の要素種別ごとの扱い

素朴に「全要素の angle を回す」と、この盤面の自前ヘルパー群と綱引きになって壊れる。
種別ごとに扱いを分ける。**ここが本チケットの実質的な設計判断**。

| 種別 | 判定 | 扱い | 理由 |
|---|---|---|---|
| 図形・画像・テキスト・三角形・大括弧 | — | angle 回転 | 通常ケース。三角形/大括弧は `isPolyShape` で「図形」扱い（既存の単体回転と同じ） |
| コネクタ（line/arrow、非三角・非括弧・非elbow） | `isConnector` 相当 | **angle ではなく points を回す** | 下記 4.4 |
| 折れ矢印（elbow） | `el.elbowed` | 触らない | 本体も `getArrowLocalFixedPoints` で点を引き直すだけで回さない。接続済みなら図形の移動に合わせて自動で再ルートされる |
| 影矩形（テキスト背景・フレーム装飾） | `isTextBgRect` / `isFrameDecorRect` | 対象から除外 | `locked:true` なので通常は選択に入らないが保険。angle は `syncTextBoxBgRects` / `syncFrameDecorRects` が親から転写する |
| 表のセル | `isTableCell` | **選択に1つでも含まれたらゾーンごと非表示** | `reflowTables` が毎tick 軸平行に敷き直すため、回しても戻される／崩れる。表は `groupIds=[tid]` で**それ自体がグループ**なので、素通しにすると「表を選ぶと回転アイコンが出て、回すと壊れる」事故になる |
| フレーム | `frame` / `magicframe` | **含まれたらゾーンごと非表示** | 本体はフレームをスキップして中身だけ回すが、この盤面ではフレーム装飾矩形が軸平行前提で追従するため見た目が破綻する。既存の「フレームは回転不可」方針を踏襲 |

### 4.4 コネクタを points で回す理由（重要）

自動接続まわり（`autoConnectLines` / `followTriangleConnections` / `reconnectDraggedConnectors`）は
**コネクタの angle は 0 である**という前提で書かれている。
`anchorToPoint()` は接続先**図形**の angle は見るが、コネクタ自身の angle は一切見ずに
scene 座標をそのまま `x, y, points` へ書き戻す（[whiteboardAutoConnect.ts:407-415](../src/app/lib/whiteboardAutoConnect.ts#L407-L415)）。

ここでコネクタに angle を付けると「angle による回転 × 追従が書いた scene 座標」で**二重回転**になり、
グループを回した瞬間に矢印だけ明後日の方向へ飛ぶ。

そこで、コネクタは各点を scene 座標へ展開 → `C` まわりに `delta` 回転 → 先頭点を新しい `x,y` にして
相対化し、`width/height` を取り直す。angle は 0 のまま据え置く。
図形側は angle で回り、コネクタの端点はアンカーから再導出されるので**両者の結果が一致し**、
追従パスと綱引きにならない（＝ジッタしない）。

- `angle !== 0` のコネクタ（通常発生しない）は保険として angle 回転へフォールバックする。
- `normalizeBraces` は「変形中」を本体の appState フラグで判定しており、自前オーバーレイのドラッグ中は
  変形中と見なされない。ただし括弧は angle だけが変わり bbox も points も変わらないため、
  `rebuiltBrace` の結果は同一 → `updateScene` は走らない。安全。

### 4.5 ゾーンを出さない条件（グループモード）

既存の単体モードの条件に加えて:

- 回転可能な要素が2つ未満
- `isTableCell` / `frame` / `magicframe` を1つでも含む
- （既存）`newElement` / `isResizing` / `isRotating` / `selectedElementsAreBeingDragged` /
  `editingTextElement` / `editingLinearElement` / `activeTool !== "selection"` / wysiwyg 表示中
- 共通bboxが `MIN_BOX` 未満

---

## 5. 履歴・共同編集

既存の作法をそのまま踏襲する（BRU7-058）。

- pointerdown で `beginHistoryGesture()` → ドラッグ中の `updateScene` は EVENTUALLY に溜まる
- pointerup で `commitSceneToHistory(api)` を1回 → **1ドラッグ＝1 undo ステップ**
- Yjs へは `onChange` 経由で従来どおり配信。中間フレームも流れるので相手側にもリアルタイムに見える

グループは要素数が多いので、`pointermove` ごとの `updateScene` が重い場合は rAF へ集約する
（既存の `TableResizeOverlay` と同じ形）。まずは pointermove 直結で実装し、実測で重ければ足す。

---

## 6. 変更ファイル

`src/app/components/whiteboard/CornerRotateOverlay.tsx` のみ。

- `readTarget()` → `readTargets()`：`{ mode: "single" | "group", els, bbox, center }` を返す
- `applyAngle(id, angle)` → `applyRotation(delta)`：原本 Map から毎回計算
- `position()`：mode によって bbox の求め方（`elementBBox` / `getCommonBounds`）と
  ゾーンに掛ける回転（`el.angle` / `0`）を切り替える
- `dragRef`：`{ mode, center, startPointer, originals: Map }`

---

## 7. テスト観点

1. 図形2つをグループ化 → クリックで全体選択 → 四隅に ↻。ドラッグで全体が中心まわりに回る。Shift で15°刻み
2. グループをダブルクリックで中へ入り単体選択 → 四隅に ↻。**その1つだけ**が回る（画像1のケース）
3. 矢印で繋いだ2図形をグループ化して回転 → 矢印が付いたまま追従し、離しても外れない・飛ばない
4. 折れ矢印（elbow）を含むグループを回転 → 図形は回り、折れ矢印は接続を保ったまま引き直される
5. 表を選択 → ↻ は出ない。表は崩れない
6. フレームを含む選択 → ↻ は出ない
7. 背景色つきテキストボックスを含むグループを回転 → 背景板が文字とぴったり重なったまま回る
8. 三角形＋矩形（添付画像の構成）で回転 → コネクト先が入れ替わらない
9. Ctrl+Z 1回で回転前に戻る（何十ステップにも割れない）
10. 2ブラウザで同じボードを開いて回転 → 相手側にも反映される
11. ズーム大/小、`MIN_BOX` 付近のサイズ
12. 回転後にグループのまま移動・リサイズしても崩れない
13. 回転後の PNG/SVG エクスポートが画面と一致する

---

## 8. 既知の制限（意図的に残すもの）

- 折れ矢印そのものは回らない（Excalidraw 本体と同じ）。未接続の折れ矢印はグループ回転で取り残される
- 表・フレームを含む選択はグループ回転できない（本体の回転つまみでも同様に壊れるため、
  むしろゾーンを出さないことで事故を防いでいる）
- グループの選択枠自体は回らず軸平行のまま（本体仕様。Figma と同じにするには本体改修が必要）
