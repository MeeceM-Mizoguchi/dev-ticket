# ホワイトボード オブジェクトリンク機能 設計書

> 対象: ホワイトボード上のフレーム/図形へのディープリンク発行・着地・埋め込みプレビュー
> ステータス: 実装済み（2026-08-01・build緑・未検証/未コミット）

---

## 1. ゴール（要件の分解）

| # | 要件 | 実現方法（結論） |
|---|------|------------------|
| ① | 右クリック →「リンクを取得」でオブジェクトへのリンクを生成 | Excalidraw 0.18.1 の**ネイティブ機能** `copyElementLink`（コンテキストメニューに標準搭載）＋ `generateLinkForSelection` プロップでURLを自前生成。加えて右上に自前の「リンクをコピー」ボタン（閲覧専用ユーザー／ネイティブアプリ対策） |
| ② | ブラウザのアドレスバーに貼って Enter → そのオブジェクトを表示 | 既存ルート `/:projectSlug/whiteboard/:boardId` に `?element=<id>` を付与。着地時にキャンバスをその位置へスクロール＋選択＋ハイライト。**未ログイン時の遷移先保持**も併せて実装（現状は欠落） |
| ③ | チケット/コメント/アクションメモ/wiki/議事録に貼って**クリック → 右半分にホワイトボードを表示（操作可）＋つまみ/ボタンで完全遷移** | 既存の `PreviewPanelContext` + `LinkPreviewPanel`（バックログ/wiki/議事録/ファイルのプレビュー基盤）に `whiteboard` タイプを追加し、専用パネル `WhiteboardLinkPreview` を分岐描画（`file` タイプと同じ構造）。パネル内に本物の `WhiteboardCanvas` をマウントして編集可能にする |

---

## 2. 調査で判明した前提（設計の土台）

### 2-1. Excalidraw 0.18.1 は「要素リンク」を標準で持っている
`node_modules/@excalidraw/excalidraw` を実機確認した結果:

- 要素のコンテキストメニューに `copyElementLink` アクションが**既に含まれている**（`actions.copyElementLink`）。
- リンク生成は `props.generateLinkForSelection(id, type)` があればそれを使い、無ければ既定実装
  （`window.location.href` に `?element=<id>` を付ける）にフォールバックする。
- URLパラメータ名は **`element` 固定**。単体要素も「グループ」も同じ `element` パラメータに入る
  （`getLinkIdAndTypeFromSelection` は 1個選択 → `{id, type:"element"}`、複数かつ同一グループ → `{id: groupId, type:"group"}`）。
- 公開APIとして `isElementLink(url)` がエクスポートされている（`parseElementLinkFromURL` は非公開 → 自前実装する）。
- **注意点1**: 既定実装は `window.location.href` を使う。タブモード（Mac/iPad は MemoryRouter）やネイティブアプリ
  （オリジンが `capacitor://localhost`）では**壊れたURLになる** → `generateLinkForSelection` の指定は必須。
- **注意点2**: 閲覧モード（`viewModeEnabled=true`）のコンテキストメニューは項目が4つに絞られ、
  `copyElementLink` は**出ない**。閲覧専用ユーザーはネイティブ経路ではリンクを取得できない。
- **注意点3**: ja-JP ロケールに `labels.copyElementLink` / `toast.elementLinkCopied` の**翻訳が無く英語表示**になる
  （`Copy link to object`）。
- **注意点4**: ネイティブ実装のコピーは Excalidraw 内部の clipboard 実装を使うため、
  WKWebView(Mac/iPadアプリ)では失敗し得る。アプリ側は `@/lib/clipboard` の `copyText()`（Capacitor対応）を使うべき。

→ **結論**: ネイティブ機能を土台に使いつつ、`generateLinkForSelection` の指定と、
　自前の「リンクをコピー」ボタン（閲覧モード／ネイティブ対策の確実な経路）を併設する。

### 2-2. 「右半分プレビュー」の基盤は既にある
- [PreviewPanelContext.tsx](../src/app/contexts/PreviewPanelContext.tsx): `{ type, id }` を持つだけの軽量コンテキスト。`App.tsx` 直下で全ルートを包む。
- [LinkPreviewPanel.tsx](../src/app/components/shared/LinkPreviewPanel.tsx): 右スライドパネル（幅500px）。
  - `type === "file"` のときだけ**早期returnで別コンポーネント**（`FileLinkPreview`）に委譲する構造になっている（[LinkPreviewPanel.tsx:269](../src/app/components/shared/LinkPreviewPanel.tsx#L269)）。→ ホワイトボードも同じ形で足せる。
  - 「このページを開く」ボタンが `navigateInActiveTab(url) || navigate(url)` でタブモード/Web 両対応（[LinkPreviewPanel.tsx:329-339](../src/app/components/shared/LinkPreviewPanel.tsx#L329-L339)）。→ 完全遷移ボタンはこれを踏襲。

### 2-3. リンクのクリック経路は RichEditor 1箇所に集約されている
- チケット説明・**コメント・返信**・wiki・議事録・バックログ・アクションメモ、すべて `RichEditor` で描画。
- TipTap Link は `openOnClick: false, autolink: true`（[RichEditor.tsx:694-699](../src/app/components/shared/RichEditor.tsx#L694-L699)）
  → **URLを貼り付けるだけで自動的に `<a>` になる**。クリックは `handleLinkClick`（[RichEditor.tsx:1154-1164](../src/app/components/shared/RichEditor.tsx#L1154-L1164)）に一元化され、現状は `openExternalUrl(href)`。
- → **`handleLinkClick` に分岐を1つ足すだけで、貼り付け先すべて（コメント含む）に一斉対応できる**。

### 2-4. 既存のディープリンク前例
- [FileBoxPage.tsx:199](../src/app/pages/FileBoxPage.tsx#L199) が `${origin}/${slug}/files?file=<id>` を生成し、
  着地側は `searchParams.get("file")` → 開く → **`searchParams.delete("file")` して `replace` で消す**。
  この「消費して消す」パターンを `?element=` でも踏襲する。

### 2-5. 未ログイン時のディープリンクが**現状は失われる**（要件②の穴）
- `ProtectedShell` は `sessionStorage.isLoggedIn !== "true"` で無条件に `/login` へ（[AppShell.tsx:75](../src/app/components/layout/AppShell.tsx#L75)）。
- `LoginPage` はログイン成功時・セッション復元時ともに `/dashboard` 固定（元URLを保持していない）。
- `isLoggedIn` は **sessionStorage（タブ単位）** なので、**リンクを新規タブで開くと必ずこの経路を通る**。
- → 要件②を成立させるには「遷移先の保持と復帰」が必須。**この機能はチケットURL共有など既存機能の改善にもなる**。

### 2-6. 公開オリジンが未定義
- 絶対URL生成は現状すべて `window.location.origin`（TicketDetailPanel など多数）。
- `capacitor.config.json` に `server.url` が無いため、**Mac/iPadアプリでは `capacitor://localhost` になり、共有できないURLになる**（既存の潜在バグ）。
- → `VITE_PUBLIC_APP_ORIGIN` を導入し、`appOrigin()` ヘルパー経由に統一する（本機能では必須。既存箇所の置換は任意）。

---

## 3. URL 仕様

```
https://<app-origin>/<PROJECT_SLUG>/whiteboard/<boardId>?element=<elementId | groupId>
```

- Excalidraw ネイティブの要素リンク形式と**完全互換**（パラメータ名 `element`）。
- `?element=` 無しのボードURLも「ボードだけを開くリンク」として受理する。
- 内部リンク判定では、絶対URL（公開オリジン or 現在のオリジン）と**相対パス**の両方を受け付ける。
- ボードURLはルーティング済み（`/:projectSlug/whiteboard/:boardId`）。`vercel.json` は全パスを `index.html` に rewrite 済みなので、アドレスバー直打ちで到達できる。

**IDの安定性**: Excalidraw の要素IDは Yjs 同期後も不変。移動・リサイズ・書式変更では変わらない。
複製すると別IDになる（＝コピー先には飛ばない、正しい挙動）。**削除されるとリンクは失効**（後述のトースト処理）。

---

## 4. 全体フロー

```
[生成]
  右クリック → "オブジェクトへのリンクをコピー"(ネイティブ)   ┐
  もしくは 右上「リンクをコピー」ボタン(自前・閲覧可)          ├→ buildWhiteboardLink()
                                                              ┘   → clipboard

[着地 A: アドレスバー]
  URL → (未ログインなら postLoginRedirect に退避 → ログイン後に復帰)
      → WhiteboardPage: ?element= を読む
      → WhiteboardCanvas(focusElementId)
      → docLoaded 後にリトライ探索 → scroll+zoom+選択+パルス → URLから ?element= を除去

[着地 B: アプリ内リンククリック]
  RichEditor.handleLinkClick
      → parseWhiteboardLink(href) 成功
      → 現在のページが同じボード？
           YES → 面倒なパネルは出さず、その場でフォーカス（インスタンス間バス）
           NO  → openPreview("whiteboard", boardId, { elementId, projectSlug })
      → LinkPreviewPanel が WhiteboardLinkPreview へ委譲
      → 右半分パネルに WhiteboardCanvas をマウント（編集可）
      → 左端のつまみでリサイズ / 「ボードを開く」で完全遷移
```

---

## 5. 実装単位

### A. リンク生成

**新規 `src/app/lib/appOrigin.ts`**
```ts
// 共有可能な公開オリジン。ネイティブ(capacitor://)・タブモードでも正しいURLを作るため
// window.location.origin をそのまま使わない。
export function appOrigin(): string {
  const env = import.meta.env.VITE_PUBLIC_APP_ORIGIN as string | undefined;
  if (env) return env.replace(/\/$/, "");
  const o = typeof window !== "undefined" ? window.location.origin : "";
  return /^https?:/.test(o) ? o : "";   // capacitor:// 等は使わない
}
```
※ `VITE_PUBLIC_APP_ORIGIN` は `.env` と Vercel の環境変数に本番ドメインを設定（**要: ドメイン確認**）。
未設定時は Web では従来どおり動き、ネイティブでのみ空になる（その場合はコピー時に警告トーストを出す）。

**新規 `src/app/lib/whiteboardLink.ts`**
```ts
export interface WhiteboardLink { projectSlug: string; boardId: string; elementId: string | null }

export function buildWhiteboardLink(projectSlug: string, boardId: string, elementId?: string): string
// → `${appOrigin()}/${slug}/whiteboard/${boardId}${elementId ? `?element=${elementId}` : ""}`

export function parseWhiteboardLink(href: string): WbLink | null
// 受理: 絶対(公開オリジン or 現オリジン) / 相対 "/SLUG/whiteboard/<uuid>"
// パス正規表現: ^/([^/]+)/whiteboard/([0-9a-fA-F-]{36})$
// elementId は searchParams.get("element")
```

**`WhiteboardCanvas.tsx` の変更**
```tsx
<Excalidraw
  ...
  generateLinkForSelection={(id) => buildWhiteboardLink(projectSlug, boardId, id)}
  onLinkOpen={handleLinkOpen}   // ← Phase 3（図形に貼った内部リンクの横取り）
/>
```
- `projectSlug` は新規プロップ。`WhiteboardPage` は `useParams` の値を、プレビューパネルは解決済みslugを渡す。

**新規 `src/app/components/whiteboard/CopyObjectLinkButton.tsx`**
- 右上クラスタ（`renderTopRightUI` 内、Help/Export/Fullscreen と並べる）に配置。
- 有効条件: `getLinkIdAndTypeFromSelection` 相当の自前判定
  （1要素選択 → その id ／ 複数選択かつ同一 `selectedGroupIds` → groupId ／ それ以外は無効・ツールチップで案内）。
- コピーは `copyText()`（`@/lib/clipboard`・Capacitor対応）。成功/失敗を既存の `copyToast` パターンで表示。
- **閲覧モードでも表示する**（`canEdit` に依存させない）。

**ja 翻訳 → 実装ではパッチではなく DOM 差し替えを採用**
当初はロケールを pnpm patch で足す想定だったが、パッチ対象が
`dist/{dev,prod}/locales/ja-JP-<ハッシュ>.js` というビルド生成物で壊れやすいため、
`ContextMenuLabels.tsx`（MutationObserver でメニューが開くたびにラベル文字列を置換）にした。
置換対象（`Copy link to object` / `Link to object`）が見つからなければ何もしないので、
Excalidraw 側の文言が変わっても壊れず英語表示に戻るだけで済む。

---

### B. 着地（フォーカス）

**新規 `src/app/lib/whiteboardFocus.ts`**
```ts
// 1) 対象解決
//    a. id 完全一致（フレーム含む）→ [el]
//    b. groupIds に id を含む要素群 → その配列（グループリンク）
//    c. どちらも無ければ null（＝削除済み or 別ボード）
// 2) 待機: docLoaded 後、200ms 間隔で最大 30 回（6秒）リトライ。
//    理由: docLoaded は「DBスナップショット適用済み」であって、Broadcast 経由の
//          後追い差分がまだ来ている可能性があるため。
// 3) ビュー移動: getCommonBounds(targets)（@excalidraw/excalidraw からエクスポート済み）
//    zoom = clamp( min(vw / (bw * 1.8), vh / (bh * 1.8)), 0.2, 1.2 )
//      ・小さい図形で 10倍ズームに暴走しないよう上限 1.2 でクランプするのが肝
//    scrollX = vw / 2 / zoom - (bx + bw / 2)  （scrollY も同様）
//    api.scrollToContent(targets, { fitToViewport: true, viewportZoomFactor: 0.55, animate: true, duration: 400 })
//    を使ってアニメーションさせ、直後に上記クランプで補正する。
// 4) 選択: updateScene({ appState: { ...st, selectedElementIds, selectedGroupIds },
//                        captureUpdate: CaptureUpdateAction.NEVER })
//    ※ NEVER 必須。履歴に載せると「リンクで飛んだだけ」が undo 対象になる（guardApi の既定方針と一致）。
```

**新規 `src/app/components/whiteboard/FocusPulseLayer.tsx`**
- 着地した対象の外接矩形を 2秒間・3回パルスで縁取る（`FrameHighlightLayer` と同じ
  「containerRef 配下の canvas ＋ rAF ＋ scene→viewport 変換」方式）。
- スクロール/ズームに追従するので、着地アニメーション中も枠がズレない。

**`WhiteboardPage.tsx` の変更**
```tsx
const [sp, setSp] = useSearchParams();
const focusElementId = sp.get("element");
// canvas から onFocused(ok:boolean) を受けたら
//   sp.delete("element"); setSp(sp, { replace: true });     ← FileBoxPage と同じ「消費して消す」
//   ok=false なら toast「リンク先のオブジェクトが見つかりませんでした（削除された可能性があります）」
<WhiteboardCanvas ... projectSlug={projectSlug} focusElementId={focusElementId} onFocused={...} />
```
- `boardId` が無いのに `?element=` だけある場合は無視。

**未ログイン復帰（`AppShell.tsx` / `LoginPage.tsx`）**
```tsx
// ProtectedShell
const loc = useLocation();
if (sessionStorage.getItem("isLoggedIn") !== "true") {
  const to = loc.pathname + loc.search;
  if (to !== "/" && !to.startsWith("/login") && !to.startsWith("/accept-invite"))
    sessionStorage.setItem("postLoginRedirect", to);
  return <Navigate to="/login" replace />;
}
// LoginPage: 既ログイン判定の早期 Navigate、パスワードログイン成功、生体認証成功の
// 3経路すべてで pop して使う（消費後は必ず removeItem）
const to = sessionStorage.getItem("postLoginRedirect"); sessionStorage.removeItem("postLoginRedirect");
navigate(to ?? "/dashboard", { replace: true });
```

---

### C. 右半分プレビューパネル

**`PreviewPanelContext.tsx` の変更（後方互換）**
```ts
export type PreviewType = "backlog" | "wiki" | "minute" | "file" | "whiteboard";
export interface PreviewTarget {
  type: PreviewType; id: string;
  elementId?: string;      // whiteboard 専用
  projectSlug?: string;    // 判明していれば渡す（未指定なら panel 側で解決）
}
open: (type: PreviewType, id: string, opts?: { elementId?: string; projectSlug?: string }) => void;
```

**`LinkPreviewPanel.tsx` の変更**
```tsx
// file と同型の早期分岐（オーバーレイ/500pxパネルには乗せない）
if (target?.type === "whiteboard")
  return <WhiteboardLinkPreview boardId={target.id} elementId={target.elementId ?? null}
                                projectSlug={target.projectSlug} onClose={close} />;
```

**新規 `src/app/components/whiteboard/WhiteboardLinkPreview.tsx`**

| 項目 | 仕様 |
|------|------|
| 位置 | `position: fixed; top/right/bottom: 0`。**背景オーバーレイなし**（左側のチケット本文を読みながら使うため） |
| 幅 | 既定 `50vw`。`localStorage("wb_preview_width_px")` に保存。min 420px / max 92vw |
| つまみ | 左端 8px のドラッグハンドル（`pointerdown` + `setPointerCapture`）。ダブルクリックで 50vw ⇄ 92vw トグル。ドラッグ中は `transition` を切り、幅更新は rAF スロットル（Excalidraw の ResizeObserver ジャンク対策・BRU9-046 と同じ理由） |
| ヘッダー | ボード名／プロジェクト名、[ボードを開く]（完全遷移）、[✕] |
| 完全遷移 | `onClose(); const url = /${slug}/whiteboard/${boardId}?element=${elementId}; navigateInActiveTab(url) \|\| navigate(url)`（LinkPreviewPanel と同じ） |
| 閉じる | **✕ ボタンのみ**（＋パネル外にフォーカスがある時の Esc）。編集中の誤操作で消えるのを防ぐため、**クリック外閉じ・無条件 Esc は採用しない**（キャンバス内の Esc は選択解除としてキャンバスが処理する） |
| 本体 | `lazy(() => import("WhiteboardCanvas"))` を `Suspense` で。`canEdit` は権限判定の結果、`focusElementId={elementId}`、`instanceKey="preview"` |
| 権限 | マウント前に `getBoardMeta` + `loadWhiteboardPerms` を実行。`none` → 「このボードを閲覧する権限がありません」表示（キャンバスはマウントしない） |
| 狭い画面 | ビューポート幅 < 900px では全画面表示に切替（ホワイトボード画面自体が `minWidth: 900` のため） |

**`whiteboardService.ts` に追加**
```ts
export async function getBoardMeta(boardId): Promise<{ id, title, projectId, projectSlug, projectName } | null>
// whiteboards → projects の2クエリ（既存 resolveProject と同じ素朴なやり方に合わせる）

export async function loadWhiteboardPerms(projectId, userId, isAdminRole): Promise<Perms>
// WhiteboardPage.load 内のロジックをそのまま切り出し、Page と Panel で共用する
```
> **RLS 注意**: `whiteboards` の select ポリシーは `auth.role()='authenticated'` で全開放
> （[supabase/add_whiteboard.sql](../supabase/add_whiteboard.sql)）。**権限判定はアプリ側が唯一の防壁**なので、
> パネルでも必ず Page と同じ判定を通す。組織またぎのリンクをどう扱うか（projects の org 判定を足すか）は
> **要確認事項**（§8-1）。

**`RichEditor.tsx` の変更**
```tsx
const { open: openPreview } = usePreviewPanel();  // 既定値が no-op なので LP/ニュース等でも安全

const handleLinkClick = (e) => {
  const anchor = ...; const href = ...;
  if (!readOnly && !(e.metaKey || e.ctrlKey)) return;   // 既存仕様を踏襲
  const wb = parseWhiteboardLink(href);
  if (wb) {
    e.preventDefault(); e.stopPropagation();
    focusOrOpenWhiteboard(wb, openPreview);   // 同一ボードなら in-place（§D）
    return;
  }
  e.preventDefault(); e.stopPropagation();
  void openExternalUrl(href);
};
```
→ チケット説明・**コメント/返信**・wiki・議事録・バックログ・アクションメモが**一括で対応**される。

---

### D. 多重マウント安全化（**最重要・ここが失敗しやすい**）

プレビューパネルは「別画面の上にもう1つ `WhiteboardCanvas` を出す」ので、
**同時に2つのキャンバスが存在し得る**（例: ボードAを開いた状態で、Topbarのアクションメモに貼ったボードBのリンクを踏む）。
現状のコードには **document 全体を見るグローバル前提**が複数あり、そのままでは相互干渉する。

**D-1. 同一ボードの二重マウントは禁止**
- 理由: Yjs Doc / awareness / `doc_state` の保存が二重化し、自分のアバターが2人に見え、保存が競合する。
- 対策: 新規 `src/app/lib/whiteboardFocusBus.ts`（タブ機能で使っているローカルバスと同型）
  ```ts
  requestFocus(boardId, elementId)  // 発火
  onFocusRequest(boardId, cb)       // WhiteboardCanvas が購読
  ```
  リンククリック時、**現在開いているボードと同じ** ならパネルを出さず `requestFocus` でその場でフォーカス。

**D-2. 別ボードの2枚同時は許可。ただし「アクティブなインスタンス」だけがグローバル操作に反応する**
- 新規 `src/app/lib/whiteboardInstance.ts`: `register(key)` / `setActive(key)` / `isActive(key)` （LIFOスタックで、パネルを閉じたらページ側に戻る）。
- `WhiteboardCanvas` の **window レベルのリスナーを全て `isActive(key)` でガード**する:
  - Esc処理（[WhiteboardCanvas.tsx:585](../src/app/components/whiteboard/WhiteboardCanvas.tsx#L585)）
  - Cmd/Ctrl+Shift+C 選択コピー（同 :523）※ 2枚が同時に反応するとクリップボードを奪い合う
  - undo/redo 検知（同 :482）
  - Shift 追跡（同 :369）、Elbowボタンのクリック横取り（同 :438）、pointerdown の署名スナップショット（同 :404）

**D-3. 「テキスト編集中か」のグローバル判定（`document.querySelector(".excalidraw-wysiwyg")`）**
危険なのは *読んだ内容で盤面を書き換える* 経路（`whiteboardTable.ts` の列幅計測、`whiteboardText.ts` の
実測テキスト取得）で、これらは全て onChange / rAF の自動処理から呼ばれる。
そこで **9ファイルのシグネチャを `root` 付きに変える代わりに、自動処理そのものを
アクティブな1枚に限定する**方針を採った（変更範囲が小さく、抜けが生じにくい）。

- `WhiteboardCanvas` の onChange 内の自動処理ブロック … `isActiveWbInstance()` で丸ごとガード
- テキスト編集中の rAF 再レイアウトループ … 同上（あわせて探索を `containerRef` 配下に限定）
- `WhiteboardCanvas` 自身の2箇所（Cmd+Shift+C / Esc の編集中判定）… `containerRef` 配下に限定
- 残りの lib 側（`whiteboardBoundText` / `whiteboardIndentWrap` / `whiteboardTextColor` など）は
  「編集中なら処理をスキップ」という安全側の判定なので、そのままでも盤面を壊さない

**D-4. `whiteboardText.ts` の編集中要素シングルトン**（`getEditingTextEl` / `setEditingTextEl`）
→ アクティブなインスタンスだけが書き込む（非アクティブ側が null で上書きするのを防ぐ）。

---

## 6. 変更ファイル一覧

**新規**
| ファイル | 役割 |
|---|---|
| `src/app/lib/appOrigin.ts` | 公開オリジン解決 |
| `src/app/lib/whiteboardLink.ts` | URL生成 / 解析 |
| `src/app/lib/whiteboardFocus.ts` | 対象解決・ズーム計算・選択 |
| `src/app/lib/whiteboardInstance.ts` | アクティブインスタンス管理 |
| `src/app/lib/whiteboardFocusBus.ts` | 同一ボードの in-place フォーカス通知 |
| `src/app/components/whiteboard/CopyObjectLinkButton.tsx` | 右上のリンクコピー（閲覧モード対応） |
| `src/app/components/whiteboard/FocusPulseLayer.tsx` | 着地ハイライト |
| `src/app/components/whiteboard/WhiteboardLinkPreview.tsx` | 右半分パネル |

**変更**
| ファイル | 変更点 |
|---|---|
| `components/whiteboard/WhiteboardCanvas.tsx` | props追加(projectSlug/focusElementId/onFocused/instanceKey)、`generateLinkForSelection`、フォーカス処理、リスナーのアクティブ判定、DOM探索のスコープ化 |
| `pages/WhiteboardPage.tsx` | `?element=` の読み取り→受け渡し→消費後strip、権限ロジックの切り出し |
| `contexts/PreviewPanelContext.tsx` | `whiteboard` タイプと任意オプション追加 |
| `components/shared/LinkPreviewPanel.tsx` | whiteboard 分岐（file と同型の早期return） |
| `components/shared/RichEditor.tsx` | `handleLinkClick` で内部WBリンクを横取り |
| `components/layout/AppShell.tsx` / `pages/LoginPage.tsx` | `postLoginRedirect` の保存と復帰 |
| `lib/whiteboardService.ts` | `getBoardMeta` / `loadWhiteboardPerms` 追加 |
| `lib/whiteboard*.ts`（7ファイル）・`CornerRotateOverlay` / `IndentField` | `.excalidraw-wysiwyg` 探索の root スコープ化 |
| `patches/@excalidraw__excalidraw@0.18.1.patch` | ja翻訳追加（任意・Phase 3） |
| `.env` / Vercel 環境変数 | `VITE_PUBLIC_APP_ORIGIN` |

---

## 7. リスクと対策（失敗ポイント表）

| # | リスク | 対策 |
|---|---|---|
| 1 | ネイティブ既定のリンク生成が `window.location.href` 依存 → タブモード/Macアプリで壊れたURL | `generateLinkForSelection` を必ず指定。`appOrigin()` 経由 |
| 2 | Mac/iPadアプリで Excalidraw 内部のコピーが失敗 | 自前ボタンで `copyText()`（Capacitor Clipboard）を使う |
| 3 | 閲覧専用ユーザーの右クリックに項目が出ない | 自前ボタンを `canEdit` 非依存で常時表示 |
| 4 | メニューが英語表示 | ロケールpatch（任意）。自前ボタンは日本語 |
| 5 | **2枚同時マウントでのグローバル汚染** | §D（同一ボード禁止＋アクティブ判定＋DOM探索スコープ化） |
| 6 | 小さい図形へのリンクでズームが暴走 | zoom を 0.2〜1.2 にクランプ |
| 7 | リンク先が削除済み | 6秒リトライ後にトースト。URLの `?element=` は除去して残さない |
| 8 | Yjs差分の到着待ちで「一瞬見つからない」 | 200ms×30回のリトライ探索 |
| 9 | `?element=` を消さないとボード切替やリロードで再フォーカスが暴発 | 消費後に `setSearchParams(..., {replace:true})`（FileBox前例） |
| 10 | パネル編集中に誤ってパネルが閉じる | クリック外閉じ・無条件Escを採用しない |
| 11 | パネル幅ドラッグで Excalidraw が毎フレーム再描画（ジャンク） | transition なし＋rAFスロットル |
| 12 | 未ログイン・新規タブでリンクが `/dashboard` に落ちる | `postLoginRedirect`（§B） |
| 13 | フォーカスの `updateScene` が undo 履歴に載る | `captureUpdate: NEVER` |
| 14 | 権限チェック漏れ（RLSは全開放） | `loadWhiteboardPerms` をページ/パネルで共用。`none` はマウントしない |
| 15 | 編集モードのリンククリックが効かないと言われる | 既存仕様（Cmd/Ctrl必須）を踏襲し、ツールチップで明示 |

---

## 8. 要確認事項

1. **組織またぎ**: 別組織のボードURLを踏んだ時の扱い。現状 `resolveProject` は org を見ていない。
   「プロジェクト取得可否＋org一致」で弾く方針にするか、既存の他機能（バックログ等のプレビュー）と同じ挙動に合わせるか。
2. **本番ドメイン**: `VITE_PUBLIC_APP_ORIGIN` に入れる値。
**決定済み**
- **パネルの占有方式**: 右半分**オーバーレイ**で確定（2026-08-01）。裏の画面のレイアウトには一切手を入れない。
- **貼り付けたリンクの見た目**: **生URLのまま**で確定（2026-08-01）。チップ化は将来の追加候補として保留。

---

## 9. 実装メモ（2026-08-01 実装完了時点）

- 設計どおり実装済み。`npx vite build` は成功（このリポジトリは `@types/react` を持たないため、
  型チェックはビルド経路に存在しない ＝ vite/esbuild のトランスパイルが唯一のゲート）。
- `VITE_PUBLIC_APP_ORIGIN` を `.env.example` に追加した（値は既存の `PUBLIC_URL` と同じ `https://dv-ticket.com`）。
  Web は未設定でも現在のオリジンで代用できるが、**Mac/iPadアプリでは未設定だと共有URLを作れない**
  （その場合はコピー時に警告を出す）。`.env` と Vercel の環境変数への追加が必要。
- 設計から変えた点は §A の ja 翻訳（パッチ→DOM差し替え）と §D-3（9ファイル改修→自動処理のガード）の2つ。

## 10. 段階リリース

| Phase | 内容 | 単体で成立するか |
|---|---|---|
| **1** | A（リンク生成）＋B（着地）＋ postLoginRedirect | ○ 「右クリックでコピー → アドレスバーに貼ってEnter → 飛べる」が完成 |
| **2** | D（多重マウント安全化）→ C（右半分プレビュー＋つまみ＋完全遷移） | ○ 貼り付け→クリックが完成 |
| **3** | ja翻訳patch / 貼り付けリンクのチップ化 / `onLinkOpen`（**ホワイトボード内の図形からチケット等へ飛ぶ逆方向**） | 磨き込み |

---

## 11. テスト観点

- [ ] 図形1つ・フレーム1つ・複数選択（グループ済）・複数選択（未グループ＝無効）でのリンク取得
- [ ] Web / Mac・iPadアプリ（タブモード）双方で、コピーされるURLが `https://<公開ドメイン>/...` になっている
- [ ] アドレスバー直打ち: ログイン済タブ / 新規タブ（未ログイン→ログイン→復帰）
- [ ] 着地: 画面中央に来る・選択される・パルスが出る・URLから `?element=` が消える
- [ ] 削除済みオブジェクトのリンク → トーストが出て、ボードは普通に開く
- [ ] グループIDリンク → グループ全体が収まる位置に着地
- [ ] コメント / 返信 / チケット説明 / wiki / 議事録 / バックログ / アクションメモ、各所での貼り付け→クリック
- [ ] パネル内で描画・移動・テキスト編集ができ、**別ブラウザにリアルタイム反映される**
- [ ] 「ボードを開く」で完全遷移し、同じオブジェクトにフォーカスされている
- [ ] ボードAを開いた状態でボードBのリンクを踏む → 双方のキャンバスが壊れない（表の再レイアウト・Esc・Cmd+Shift+C・undoが混線しない）
- [ ] ボードAを開いた状態でボードAのリンクを踏む → パネルは出ず、その場でフォーカス
- [ ] 閲覧のみ権限 / 権限なし の各ユーザーでの挙動
- [ ] パネル幅のドラッグとリロード後の復元
