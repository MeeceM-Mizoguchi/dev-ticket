# Dev Ticket — 実装ガイド

チームのプロジェクト／スプリント／チケット管理ツール。
React 18 + TypeScript + Vite / Supabase / Vercel サーバーレス。

このファイルは**バグを未然に防ぐための決まりごと**を集めたもの。実装前に必ず読むこと。

---

## 1. 検証は `npm run build`（最重要）

```
npm run build
```

**`npx vite build` 単体で済ませない。** build スクリプトは3段構成で、

```
node scripts/check-ime-enter.mjs && vite build && node scripts/publish-version.mjs
```

**1段目が落ちると `vite build` が一度も走らず、Vercel のデプロイが失敗する。**
`npx vite build` はこの1段目を飛ばすので、手元では緑に見えて本番が止まる。

> 2026-09-01、これが原因で main のビルドが約1時間デプロイ不能になり、
> PR 3件（#419 / #420 / #421）の変更がすべて本番へ出ていなかった。

`push` 時には `.githooks/pre-push` が同じ検査を自動で走らせる（0.1秒）。
クローン直後に1回だけ有効化すること:

```
git config core.hooksPath .githooks
```

### repo 全体の `tsc` は元から通らない

`npx tsc --noEmit -p tsconfig.json` は大量にエラーを出すが**壊れているわけではない**。
`tsconfig.json` に `baseUrl`/`paths` が無く `@/*` は Vite の alias でのみ解決されるため、
tsc からは全ての `@/...` import が未解決になる。型チェックの結果を見て
「自分の変更が壊した」と誤認しないこと。

---

## 2. 1行入力欄の Enter は必ず `submitKey.ts` を経由する

**禁止:**

```tsx
onKeyDown={e => { if (e.key === "Enter") save(); }}
```

日本語入力の**変換確定Enter**まで拾ってしまい、打ちかけの内容で確定される。
`scripts/check-ime-enter.mjs` がこれを検出してビルドを止める。

**正しい書き方** — [`src/app/lib/submitKey.ts`](src/app/lib/submitKey.ts):

```tsx
// 1行 <input>：Enter で確定
onKeyDown={submitOnEnter(handleSave, { enabled: canSave })}

// 複数行 <textarea>：Enter は改行なので ⌘/Ctrl+Enter で確定
onKeyDown={submitOnModEnter(handleSave)}

// 自前で判定する場合は必ず IME を見る
if (isPlainEnter(e)) { ... }   // または !isImeComposing(e)
```

意図的に生の Enter を使う場合のみ、同じ行か直前行に `ime-ok:理由` と書けば除外される。

> **新規ファイルで漏れやすい。** 既存ファイルは周りが手本になるが、
> ゼロから書くときは意識しないと `submitKey.ts` に手が伸びない。実際 2026-09-01 の
> 事故は新規作成した `CreateBranchDialog.tsx` で起きた。

---

## 3. 既知の再発バグ — 該当する実装をしたら必ず確認

### BUG-01 一覧の順番がリロードのたびに変わる
Supabase クエリに `.order()` が無いとDBが毎回違う順序で返す。

```ts
.order("created_at", { ascending: true }).order("id", { ascending: true })
```

2つ重ねて安定ソートにする。ネストクエリは `{ referencedTable: "sprint_tickets" }` も指定。
**`.select("*")` を新規に書いたら必ず `.order()` があるか確認。**

### BUG-02／03 定期更新で画面がチカチカする
`loading` が `true` になるとコンテンツがスピナーに丸ごと差し替わるのが原因。

```ts
const initializedRef = useRef(false);
// 表示条件
{loading && !initializedRef.current ? <Spinner/> : <Content/>}
```

**一度でもデータを読んだら、以後スピナーでコンテンツを隠さない。**
手動更新ボタンも `load(true)` を呼ばない。

### BUG-04 子チケットの表示が親より遅れて出てくる
子チケット取得ロジックを触ったら遅延が再発していないか確認する。

### BUG-05 送信ボタン連打で二重登録
`await` を含む送信ハンドラは**必ず ref でガードする**。

```ts
if (postingRef.current) return;
postingRef.current = true;
try { ... } finally { postingRef.current = false; }
```

`useState` だけだと同じレンダーのハンドラが2回走ると両方すり抜ける。
state はボタンの `disabled` とラベル用。同じ処理のボタンが複数箇所にあるなら
先に1つのハンドラへ寄せてからガードを付ける。

### BUG-06 TipTapの表でDOM直接操作した見た目が即座に戻る
`<tr>`/`<td>` は contentDOM(tbody) の内側なので ProseMirror が描き直す。
ドラッグ中のプレビューは `Decoration.node` で当て、確定時に一度だけ
`setNodeMarkup` で属性へ書く。行は DOM 参照ではなく doc 上の pos で追う。

---

## 4. 構成

| 場所 | 中身 |
|---|---|
| `src/app/pages/` | 画面 |
| `src/app/components/` | UI コンポーネント（`shared/` に共通部品） |
| `src/app/lib/` | API 呼び出し・ヘルパー（`submitKey.ts` はここ） |
| `src/app/types.ts` | 型定義 |
| `src/styles/interactive.css` | 全画面共通のホバー／フォーカス演出 |
| `api/` | Vercel サーバーレス関数 |
| `api/github/[resource].ts` | GitHub連携の全機能（PR一覧・マージ・本番反映の確認） |
| `supabase/*.sql` | スキーマとマイグレーション（追記式・75本以上） |

---

## 5. GitHub連携の3層の関門

`api/github/[resource].ts` にコメント付きで実装されている。設定はプロジェクト設定画面から。

| 層 | 設定 | 役割 |
|---|---|---|
| 層A | `require_checks_mode` | マージ前。CI が赤いPRを止める（`off`/`warn`/`reason`/`block`） |
| 層B | `deploy_check_mode` | マージ後。本番に実際に反映されたかを観測（`off`/`warn`/`gate`） |
| 層C | 層Bの `gate` | 本番へ届いていないものを「リリース済み」にしない |

**層Bは `deploy_check_url` が返す値に「コミットSHA」が含まれていないと機能しない。**
SHA でない値（バージョン文字列など）は `SHA_RE` に弾かれて `state=unknown` になり、
確認が完全に無効化される。`build-info.json` の `commit` キーがそれを担っている
（`vite.config.ts` の `genCommitSha()`）。**このキーを消さないこと。**

---

## 6. 迷ったら

- **DBスキーマを変える** → `supabase/` に新しい `.sql` を追加（既存ファイルは書き換えない）
- **UIに手を入れる** → ホバー等は `src/styles/interactive.css` で全画面に効いているので個別実装しない
- **コミット前** → `npm run build` を1回通す
