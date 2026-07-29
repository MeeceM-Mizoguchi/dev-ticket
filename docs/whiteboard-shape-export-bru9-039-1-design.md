# BRU9-039-1 図形をコピーして Excel / PowerPoint に貼り付け — 設計書

対象: ホワイトボード
関連: BRU5-062 / BRU5-063（装飾矩形）、ENHA2-035 / BRU7-054（xlsx 描画レイヤー）

---

## 0. 要求

現状のコピー（`Cmd/Ctrl+Shift+C`、エクスポートメニューの「画像をクリップボードにコピー」）は
**PNG ラスタ画像**を渡すため、Excel / PowerPoint に貼っても「画像」でしかない。

> オブジェクトとしてコピーして Excel・PowerPoint に貼り付け、**さらに図形として編集できる**ようにしたい。

「図形として編集できる」の定義（受け入れ基準の土台）:

- 図形を選択して**移動・リサイズ・回転**できる
- **塗りつぶし色・線色・線幅**を Office 側で変更できる
- 図形内の**文字をダブルクリックで編集**できる
- 図形が**個別のオブジェクト**として分離している（1枚の絵ではない）

---

## 1. 技術的制約 — ここが設計の分岐点

**結論: ブラウザから「Office が図形として受け取るクリップボード形式」を書き込む手段は存在しない。**

| | 内容 |
|---|---|
| Office が図形として貼り付けを受ける形式 | `Art::GVML ClipFormat`（Office Drawing の zip パッケージ）／`CF_ENHMETAFILE`（EMF、貼付後に2回グループ解除で図形化）／OLE の `Embed Source` + `Object Descriptor` |
| ブラウザ（Async Clipboard API）が書ける形式 | `text/plain`、`text/html`、`image/png`（Chromium 系は追加で `image/svg+xml` と `web ` 接頭辞のカスタム形式）。それ以外の MIME は `NotAllowedError` で拒否される |
| `web ` カスタム形式 | Windows クリップボードには載るが、名前が変換されるため **Office からは一切見えない**（Web→Web 専用） |
| Capacitor(iOS) | `UIPasteboard` に GVML/EMF を作れない。同様に不可 |

したがって **「ボードで Ctrl+C → Excel で Ctrl+V したら図形」は Web アプリでは原理的に実現できない**。
実現手段は「**ファイルを経由して Office に渡す**」の一択になる。

> 補足: 自アプリ内・Excalidraw 間の貼り付けは、Excalidraw が既に `text/plain` に
> 独自 JSON を載せて実現している。今回の要求はその外側（Office 相手）なので別問題。

---

## 2. 採用方針

### 「Excel / PowerPoint 用に図形として書き出す（.xlsx）」を追加する

ボードの選択範囲（または全体）を、**DrawingML のネイティブ図形**（`xdr:sp` / `xdr:cxnSp` / `xdr:pic`）を
`absoluteAnchor` で並べた **1 シートの .xlsx** として生成・ダウンロードする。

利用フロー:

```
ボードで対象を選択
  → エクスポートメニュー「Excel/PowerPoint用に図形として書き出す」
  → xxx_図形.xlsx がダウンロードされる
  → Excel で開く（図形はネイティブ図形。そのまま移動・色変更・文字編集が可能）
  → 図形を選択して Ctrl+C
  → PowerPoint / Word / 別の Excel ブックに貼り付け → 図形として編集可能
```

**Office 間のコピー＆ペーストは GVML が効く**ため、xlsx を1つ作れば
「Excel で編集したい」「PowerPoint に貼りたい」の両方を満たせる。

### なぜ xlsx を先に作るのか（pptx ではなく）

- チケットの主対象が Excel
- **既存資産がそのまま使える**: `src/app/lib/xlsxDrawingWrite.ts` の `buildAnchorXml()` は
  `DrawingObject → <xdr:absoluteAnchor>` の変換器としてすでに完成している（ExcelEditor の図形書き戻しで実戦投入済み）
- `xlsxDrawing.ts` のパーサがあるので、**生成物を自アプリの ExcelEditor で開いて検証**できる
- pptx への直接出力はフェーズ2（§9）。上記フローで PowerPoint 要件は満たせるため P1 では不要

---

## 3. UI / UX

### 3.1 エクスポートメニュー（`WhiteboardExportMenu.tsx`）

```
PNG形式で保存
SVG形式で保存
画像をクリップボードにコピー
─────────────────────────────
図形として書き出す（Excel/PowerPoint）   ← 追加
```

- 選択要素があれば**選択範囲のみ**、無ければ**ボード全体**を書き出す（メニュー項目のサブラベルで明示）
- 「コピー」ではなく「**書き出す**」と表記する。クリップボードに載らない以上、
  「コピー」表記は期待値のズレ（押しても Excel に貼れない）を生むため避ける

### 3.2 完了トースト

ダウンロード後に手順を案内する（既存 `copyToast` の仕組みを流用）:

> 図形として書き出しました。Excel で開き、図形を選択してコピー → PowerPoint に貼り付けできます。

### 3.3 ショートカット

`Cmd/Ctrl+Shift+X` を割り当てる（`Shift+C` は既存の PNG コピー）。
既存の `Cmd/Ctrl+Shift+C` ハンドラ（`WhiteboardCanvas.tsx:482`）と同じガード
（テキスト編集中は無視 / capture 段階で握る）を踏襲する。

---

## 4. 変更・新規ファイル

| ファイル | 区分 | 役割 |
|---|---|---|
| `src/app/lib/whiteboardSelection.ts` | 新規 | `collectSelected()` を `whiteboardCopySelection.ts` から切り出して共有（連れ子収集ロジックの二重実装を防ぐ） |
| `src/app/lib/whiteboardToDrawing.ts` | 新規 | **Excalidraw 要素 → `DrawingObject[]`** の純粋変換。本件の中核。副作用なし＝単体で検証しやすい |
| `src/app/lib/xlsxShapeBook.ts` | 新規 | `DrawingObject[]` → 最小 xlsx バイト列（`fflate.zipSync`）。zip 骨格の組み立てのみ |
| `src/app/lib/xlsxDrawingWrite.ts` | 改修 | `buildAnchorXml` に custGeom / 破線 / 不透明度を追加（§5）。既存呼び出しの挙動は不変 |
| `src/app/lib/xlsxDrawing.ts` | 改修 | 型 `DrawingObject` にフィールド追加のみ（optional なので既存パーサに影響なし） |
| `src/app/components/whiteboard/WhiteboardExportMenu.tsx` | 改修 | メニュー項目追加 |
| `src/app/components/whiteboard/WhiteboardCanvas.tsx` | 改修 | ショートカット追加 |
| `src/app/lib/whiteboardCopySelection.ts` | 改修 | `collectSelected` を共有版に差し替え（挙動不変） |

---

## 5. データモデル: `DrawingObject` の拡張

既存 `DrawingObject`（`xlsxDrawing.ts:21`）は「prstGeom の図形」しか表現できない。
ホワイトボード側には自由線・多角形・破線・半透明があるため、**optional フィールドを追加**する。

```ts
export interface DrawingObject {
  // ...既存...
  /** geom==="custom" のとき: 図形ローカル座標(0..1)の折れ線／閉多角形 */
  path?: { pts: [number, number][]; closed: boolean };
  /** 線種。既定は実線 */
  dash?: "solid" | "dash" | "dot";
  /** 0..1。塗り・線に <a:alpha> として適用 */
  opacity?: number;
  /** 文字のフォント名（既定: Yu Gothic） */
  fontFace?: string;
}
```

`buildAnchorXml` 側の追加分岐:

- `geom === "custom"` → `<a:custGeom>` を出力（`a:pathLst` / `a:path w h` のローカル座標系に `path.pts` を写像）
- `dash` → `<a:ln>` 内に `<a:prstDash val="dash|sysDot"/>`
- `opacity < 1` → `<a:srgbClr>` の子に `<a:alpha val="…"/>`

いずれも **未指定なら現在と同じ XML を出す**ので、ExcelEditor の書き戻し経路は無影響。

---

## 6. 要素マッピング（Excalidraw → DrawingML）

### 6.1 図形

| Excalidraw | 出力 | 備考 |
|---|---|---|
| `rectangle`（角丸なし） | `sp` / `prst="rect"` | |
| `rectangle`（`roundness` あり） | `sp` / `prst="roundRect"` | |
| `ellipse` | `sp` / `prst="ellipse"` | |
| `diamond` | `sp` / `prst="diamond"` | |
| 三角形（`line` + `customData.triStart/triEnd`、4点閉） | `sp` / `prst="triangle"` | 正立二等辺なら prst、崩れていれば custGeom |
| `line`（2点） | `cxnSp` / `straightConnector1` | 向きは `flipH/flipV` で表現 |
| `line`（多点・閉） | `sp` / custGeom（closed） | 塗りを保持できる |
| `line`（多点・開） | `sp` / custGeom（open） | |
| `arrow`（2点） | `cxnSp` / `straightConnector1` + `tailEnd` | `startArrowhead`→`headEnd`、`endArrowhead`→`tailEnd` |
| `arrow`（経由点 / `customData.wbVias` あり） | `sp` / custGeom（open）+ 矢尻 | 折れ線をそのまま点列に |
| `freedraw` | `sp` / custGeom（open） | 点数を間引く（§7） |
| `text`（独立） | `sp` / `prst="rect"` + `noFill` + `noLine` + `txBody` | |
| `text`（`containerId` あり） | 親図形の `txBody` に統合 | **「文字をダブルクリックで編集できる」の肝** |
| `image` | `pic` + `xl/media/*` | P2 |
| `frame` / `magicframe` | `sp` / `rect`（`noFill`＋枠線）+ フレーム名を `txBody` に | |
| フレーム装飾矩形（`customData.wbFrameBg`） | `sp` / `rect` | 実要素なのでそのまま通る |
| テキストボックス背景（`customData.wbBgFor`） | `sp` / `rect` | 同上 |
| 表（`customData.wbTable`） | セルごとに `sp` / `rect` | 元々セル=矩形の格子なので追加処理不要 |
| `embeddable` / `iframe` | 出力しない（枠のみ矩形化を検討） | §7 に明記 |

### 6.2 スタイル

| Excalidraw | DrawingML |
|---|---|
| `strokeColor` | `<a:ln><a:solidFill><a:srgbClr>` |
| `strokeWidth`(1/2/4) | `a:ln/@w`（px × 9525 EMU） |
| `strokeStyle` dashed/dotted | `a:prstDash` dash / sysDot |
| `backgroundColor` = `transparent` | `<a:noFill/>` |
| `backgroundColor` + `fillStyle` solid | `<a:solidFill>` |
| `fillStyle` hachure / cross-hatch | **単色近似**（§7） |
| `opacity`(0..100) | `<a:alpha>`（塗り・線の両方に） |
| `angle`(rad) | `a:xfrm/@rot`（度 × 60000）。回転中心が両者とも図形中心なので素直に一致 |
| `fontSize` | `a:rPr/@sz`（pt × 100） |
| `textAlign` | `a:pPr/@algn` |
| `verticalAlign` | `a:bodyPr/@anchor` |
| `fontFamily`(手書き風など) | Office 側フォントへ置換（既定 Yu Gothic）。§7 |

### 6.3 座標系

- 選択要素群の**バウンディングボックス左上を原点**にし、余白 20px を足してシート左上に配置
- 1 Excalidraw px = 1 CSS px = **9525 EMU**（既存 `xlsxDrawingWrite.ts` と同じ換算）
- **Z 順序** = `getSceneElements()` の配列順 = `absoluteAnchor` の出現順（DrawingML も後勝ちで前面）。並べ替え不要
- 回転要素のバウンディングボックスは、回転前の矩形 + `rot` で表現する（Office 側も同じ持ち方）

---

## 7. 既知の限界（仕様として明記し、チケットに残す）

| 項目 | 挙動 |
|---|---|
| 手描き風（`roughness`） | 再現しない。Office 上では**きれいな幾何図形**になる（編集可能にする以上これは必然であり、むしろ望ましい） |
| hachure / cross-hatch 塗り | 単色＋不透明度で近似 |
| フォント | Excalidraw の手書き系フォントは Office に無いため置換。**文字幅が変わり折返し位置がずれることがある** |
| 自由線・曲線 | 折れ線 custGeom で近似（点数上限 ~500／間引きあり）。ベジェの曲率は再現しない |
| 画像 | P1 では出力しない（P2 で `pic` + media 対応） |
| 埋め込み（`embeddable`） | 出力しない |
| リンク・コメント・バインド情報 | 落ちる（Office 側の接続子バインドは張らない＝線は座標固定） |
| 双方向性 | 一方向。Excel 側の編集はボードに戻らない |
| Excel Online | 図形の編集は不可（デスクトップ版が必要）。トーストで案内 |

---

## 8. 却下した代替案

| 案 | 却下理由 |
|---|---|
| **A. クリップボードに SVG / `text/html` を載せる** | Office は貼り付け時に画像化する。HTML 内 VML は Office 365 で実質非対応。§1 の通り「図形として貼る」には至らない |
| **B. SVG 保存 → Office で挿入 → 「図形に変換」** | 追加実装ほぼゼロ（SVG 保存は既存）だが、**文字がパス化して編集不可**、M365 限定、手数が多い。→ 代替手段としてヘルプに記載するのみ |
| **C. Vercel 関数で EMF を生成** | 生成できてもクリップボードに載せられないので §1 の制約は解けない。ダウンロードするなら xlsx の方が上位互換 |
| **D. pptxgenjs 導入** | 依存追加（~1MB）。xlsx 経由で PowerPoint 要件を満たせるため P1 では不要。P2 で再評価 |
| **E. Excalidraw のクリップボード JSON** | 自アプリ／Excalidraw 間のみ。Office には無意味 |

---

## 9. フェーズ分け

**P1（本チケット）**
矩形・角丸矩形・楕円・菱形・三角形・直線・矢印・折れ線・独立テキスト・図形内テキスト・表・フレーム・装飾矩形
＋ 塗り／線色／線幅／破線／不透明度／回転／文字（サイズ・太字・斜体・色・揃え）
→ 選択範囲 or 全体を .xlsx 出力、メニュー項目とショートカット

**P2（別チケット候補）**
- 画像（`pic` + `xl/media` + drawing rels）
- freedraw / 曲線矢印の custGeom 精度向上
- Excalidraw の `groupIds` → `grpSp`（Office 側でもグループのまま）
- .pptx の直接生成（PowerPoint 利用者の手数を 2 手減らせる）

---

## 10. 実装前に確認が必要な前提（PoC）

設計の根幹に外部（Office）の挙動依存があるため、**実装着手前に小さな PoC で潰す**。

1. **PoC-1: 最小 xlsx が警告なく開くか**
   手書き zip（`[Content_Types].xml` / `_rels/.rels` / `xl/workbook.xml` / `xl/_rels/workbook.xml.rels` /
   `xl/worksheets/sheet1.xml` / `xl/worksheets/_rels/sheet1.xml.rels` / `xl/drawings/drawing1.xml` / `xl/styles.xml`）
   を Excel（Windows / Mac）で開き、「修復しました」が出ないこと。
   → 出る場合は **exceljs で空ブックを生成 → drawing パートだけ後付け**に切り替える（保険案）。
2. **PoC-2: Excel の図形 → PowerPoint 貼り付け**が図形のまま行えるか（Office のバージョン差を確認）。
   ここが崩れると §2 の「xlsx 一本で pptx 要件も満たす」前提が崩れ、P2 の pptx 直接生成が P1 に繰り上がる。
3. **PoC-3: custGeom の座標系**（`a:path/@w,@h` に対する相対座標）で折れ線・閉多角形が意図通り描かれるか。
4. **PoC-4: `cNvPr/@id` 重複ガード**。`xlsxDrawingWrite.ts:118` の `IdAllocator` を必ず通す。
   **重複すると Excel は描画パートを丸ごと破棄する（＝図形が全部消える）** という既知の地雷（BRU7-054）。

---

## 11. 実装上の注意（デグレ防止）

- `collectSelected()` の共有化では、**連れ子収集の不動点ループ**（バインドテキスト・フレーム内包・
  `wbBgFor` / `wbFrameBg`）をそのまま維持する。ここを削ると「文字が消える」「枠色が消える」既知バグが再発する
- `buildAnchorXml` の改修は **既存フィールド未指定時に出力 XML が 1 バイトも変わらない**ことを確認する
  （ExcelEditor の図形書き戻しが同じ関数を使っているため）
- 生成直後に自前で `unzipSync` → `DOMParser` で検証し、`parsererror` / `cNvPr` 重複があれば
  ダウンロードせずエラートーストを出す（`ExcelEditor.tsx:56` の verify と同じ考え方）
- 空選択・要素0件は「書き出す要素を選択してください」で早期リターン（PNG コピーの `"empty"` と同じ扱い）
- ネイティブ（Capacitor）では `a.click()` ダウンロードが効かない場合がある。既存の
  ファイル保存導線（FileBox / share）に合わせるか、Web 限定でメニューを出すかを実装時に決める

---

## 12. 受け入れ確認

- [ ] 矩形・楕円・菱形・三角形・矢印・直線・テキスト・表・フレームを含むボードを書き出し、Excel で警告なく開ける
- [ ] 各図形が**個別のオブジェクト**として選択・移動・リサイズできる
- [ ] 塗り色・線色・線幅・破線・不透明度・回転が見た目どおりに再現されている
- [ ] 図形内の文字をダブルクリックして編集できる（サイズ・色・揃えが保持されている）
- [ ] 重なり順がボードと一致している
- [ ] Excel で図形を選択 → コピー → PowerPoint に貼り付け、図形として編集できる
- [ ] 選択なしで実行するとボード全体が出る／選択ありだと選択範囲のみ出る
- [ ] 既存の PNG / SVG 保存、画像クリップボードコピー、ExcelEditor の図形編集・保存に影響がない
