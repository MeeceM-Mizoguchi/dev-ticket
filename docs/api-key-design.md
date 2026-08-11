# API連携（APIキーでのチケット登録） 設計書

> 対象: 外部のAI（Claude Code 等）やCIから、Dev Ticket に**直接チケットを登録**できるようにする。
> あわせて、スプリント帯の「一括作成」ボタンを廃止し、**チケットの作り方を「新規チケット」メニューへ集約**する。
> ステータス: **実装済み**（`npx vite build` 緑。Markdown→HTML変換は実データで15項目を検証済み）

---

## 1. ゴールと決定事項

| # | 要件 | 決定 |
|---|---|---|
| ① | AIが書いたMDを人が取り込む手作業をなくす | Dev Ticket 独自のAPIキーを発行し、`POST /api/v1/tickets` で直接登録させる |
| ② | 生SQLを外部に実行させるか | **させない**。service_role 相当の権限を外部に渡すことになり、RLSも上限判定も素通りするため。APIを1本用意すれば同じ効果が得られる |
| ③ | キーの保管方法 | **平文は保存しない**（SHA-256のみ）。発行直後の1回だけ表示する。GitHub PAT / Stripe と同じ方式 |
| ④ | 追加のランニングコスト | **ゼロ**。新サービスを足さない。レート制限も Redis を使わず Postgres 内で完結させる |
| ⑤ | 導線の置き場所 | スプリント帯の「新規チケット」メニュー。サイドバーに管理画面は作らない（モーダル内のタブで完結） |
| ⑥ | ボタンの集約 | 「一括作成」ボタンを廃止し、「新規チケット」の4項目メニューへ集約（ボタン7個→6個） |

**非対象**: チケットの更新・削除API、複数プロジェクトを跨ぐキー、Webhook、MCPサーバー。

---

## 2. アーキテクチャ

```
 AI / CI
   │  Authorization: Bearer dvt_live_xxxxx
   ▼
 POST /api/v1/tickets                    ← api/v1/[resource].ts（Vercel serverless）
   │  ① SHA-256 → api_keys を引く（失効・期限を確認）
   │  ② consume_api_key_rate()      … レート制限＋last_used_at更新
   │  ③ key.project_id でスプリントを絞る ← ★唯一のテナント境界
   │  ④ 入力の正規化（ステータス/優先度/担当者/分類/日付/工数）
   │  ⑤ プラン上限の判定
   │  ⑥ reserve_ticket_wbs()        … WBS採番（DB側で直列化）
   │  ⑦ Markdown → TipTap HTML
   ▼
 sprint_tickets へ1回の insert（親子まとめて）＋ notifications
```

キーの**発行と復号だけはサーバー経由**（暗号鍵がサーバーにしか無いため）。**一覧と失効はブラウザから直接** RLS 越しに読み書きする（管理者以外は select すら通らない）。

```
 管理画面（ApiIntegrationDialog）
   │  Authorization: Bearer <supabase access_token>
   ▼
 POST /api/api-keys/create   … 乱数生成 → SHA-256 → AES-256-GCM で暗号化 → insert → 平文を返す
 POST /api/api-keys/reveal   … 管理者と組織を確認 → 復号 → 平文を返す（プロンプトへ埋め込む）
```

### 2-1. 新規ファイル

| ファイル | 役割 |
|---|---|
| `supabase/add_api_keys.sql` | `api_keys` / RLS / `reserve_ticket_wbs()` / `consume_api_key_rate()` |
| `api/v1/[resource].ts` | 公開API。`tickets`（POST）と `context`（GET）。**APIキーで認証** |
| `api/api-keys/[action].ts` | 管理用API。`create` と `reveal`。**ログイン中ユーザーのJWTで認証** |
| `src/app/lib/apiKeys.ts` | キーの生成・ハッシュ・一覧・失効・表示ヘルパー |
| `src/app/lib/apiKeyPrompt.ts` | AIに渡すセットアップ手順の組み立て |
| `src/app/components/tickets/ApiIntegrationDialog.tsx` | API連携モーダル（使い方タブ／APIキータブ） |
| `src/app/components/sprints/CreateTicketMenu.tsx` | 「新規チケット」の4項目メニュー（`BulkCreateMenu.tsx` を置き換え） |

### 2-2. 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `SprintListView.tsx` | 「一括作成」ボタン削除／「新規チケット」をメニュー化／`onApiIntegration` 追加 |
| `SprintBoardView.tsx` | 同上（あわせてチケット数上限の判定を追加。従来は判定が無かった） |
| `SprintGanttView.tsx` | 同上（＋アイコンが2つあったのを1つに統合） |
| `SprintDetailPage.tsx` | 同上（ボタン名を「チケット作成」→「新規チケット」に変更）＋モーダル描画 |
| `SprintPage.tsx` | `onApiIntegration` の配線＋`ApiIntegrationDialog` の描画 |
| `BulkCreateMenu.tsx` | **削除**（`CreateTicketMenu.tsx` へ移行） |

---

## 3. データモデル

### 3-1. `api_keys`

| 列 | 内容 |
|---|---|
| `key_hash` | 提示されたキーの SHA-256(hex)。API側の照合に使う |
| `key_cipher` | 平文を **AES-256-GCM で暗号化**したもの。復号鍵はDBに無い（§3-3） |
| `key_prefix` | 一覧表示用の先頭16文字（`dvt_live_a1b2c3d4`） |
| `name` | 用途名。「Claude Code用」など、**複数キーを見分けるためのラベル** |
| `project_id` | 操作できる範囲。**1キー＝1プロジェクト** |
| `organization_id` | RLS の突き合わせ用 |
| `expires_at` / `revoked_at` / `last_used_at` | 期限・失効・棚卸し用 |
| `rate_window_start` / `rate_count` | レート制限のカウンタ |

**キーの形式**: `dvt_live_` ＋ 32バイト乱数の base64url。`dvt` は Dev Ticket の意味で、漏れたキーを見つけたときに出所が分かる（`sk_live_`=Stripe、`ghp_`=GitHub と同じ発想）。

### 3-2. RLS

`admin` / `owner` のみ。`organization_id IS NOT DISTINCT FROM get_my_org_id()` で突き合わせる。`IS NOT DISTINCT FROM` にしているのは、マルチテナント導入前のデータ（`organization_id` が NULL）でも NULL 同士を一致とみなすため。

なお発行時は `project.organization_id ?? 発行者の organization_id` を入れる。プロジェクト側が NULL のまま入れると、組織を持つ管理者が発行できなくなるため。

### 3-3. 平文の暗号化

`key_cipher` は `v1.<iv>.<tag>.<本体>`（すべて base64url）の形式で、AES-256-GCM で暗号化する。

**暗号鍵はDBに保存しない。** `API_KEY_ENC_SECRET`（未設定なら `SUPABASE_SERVICE_ROLE_KEY`）から SHA-256 で導出する。Vercel の環境変数側にしか存在しないため、**DBのバックアップやダンプだけが漏れてもキーは復元できない**。service_role キーから導出するのは、Vercel に新しい環境変数を追加させないため（`api/project-files/[action].ts` の `DAV_TOKEN_SECRET` と同じ考え方）。

GCM の認証タグにより改ざんも検知する。復号に失敗した場合は例外を投げず `null` を返し、呼び出し側が「再発行してください」と案内する。

> ⚠️ 暗号鍵の導出元（`SUPABASE_SERVICE_ROLE_KEY`）を変更すると、**既存のキーは復号できなくなる**（APIの認証自体は `key_hash` で行うので動き続けるが、画面からプロンプトへ埋め込めなくなる）。その場合は再発行が必要。

---

## 4. WBS採番の直列化（重要）

既存のブラウザ側の採番（[bulkTicketInsert.ts:85-93](../src/app/lib/bulkTicketInsert.ts#L85-L93)）は「max を select して +1」で、**並列に叩かれると同じWBSが振られる**。人が手作業でやっている間は露見しないが、AIやCIから並列で叩かれると確実に踏む。

そこで `ticket_wbs_seq` テーブルと `reserve_ticket_wbs()` を用意した。

```sql
update ticket_wbs_seq
   set last_no = greatest(last_no, v_existing) + p_count
 where project_id = ... and prefix = ...
returning last_no - p_count + 1 into v_start;
```

- `UPDATE … RETURNING` が行ロックを取るので、同時に呼ばれても番号が重複しない
- `greatest(last_no, v_existing)` で**毎回 sprint_tickets の実際の最大番号を取り込む**ため、従来のブラウザ側採番と併存しても衝突しない

**ブラウザ側は従来のままにしてある。** 既存機能を壊すリスクを避けたため。移行するなら `insertBulkTickets` からも同じRPCを呼ぶだけでよい。

---

## 5. レート制限

1キーにつき **60秒あたり60リクエスト**。

外部サービス（Upstash / Vercel KV）を足すとそこで初めて課金が発生するため、`api_keys` にカウンタを持たせて Postgres 内で完結させた。`consume_api_key_rate()` は1文の UPDATE で判定するので、同時実行でも数え漏れしない。

```sql
set rate_window_start = case when 期限切れ then now() else rate_window_start end,
    rate_count        = case when 期限切れ then 1     else rate_count + 1 end,
    last_used_at      = now()
returning rate_count <= p_limit
```

UPDATE の SET 式はすべて更新**前**の行を読むため、CASE の中の `rate_window_start` は今回の更新より前の値を指す。

---

## 6. API仕様

### 6-1. `POST /api/v1/tickets`

```json
{
  "sprintId": "spr_xxx",
  "tickets": [{
    "title": "…", "status": "未着手", "priority": "高", "category": "バグ",
    "assignee": "山田太郎", "startDate": "2026/08/11", "dueDate": "2026/08/18",
    "estimatedHours": 4, "description": "（Markdown）", "children": []
  }]
}
```

- 上限: 親200件／リクエスト、子50件／親、タイトル500文字、本文100,000文字
- 未指定・解釈できない値は**空欄**にして `warnings` に積む（登録自体は止めない）。ただし `status`/`priority`/`estimatedHours` は型・DB制約上「空」を表現できないため既定値（未着手 / 中 / 0）
- 応答: `201` ＋ `{ ok, count, created: [{wbs, title}], warnings }`
- `401` キー無効・失効・期限切れ／`403` プラン上限・機能OFF／`404` スプリント不一致／`429` レート超過

### 6-2. `GET /api/v1/context`

スプリント一覧・メンバー名・分類名・使えるステータス／優先度を返す。AIが候補値を確認するため。

### 6-3. なぜ1ファイルに2エンドポイントか

`api/` から `src/` を import すると **デプロイ後に ERR_MODULE_NOT_FOUND でクラッシュする**（[api/ml/recommend.ts:11-19](../api/ml/recommend.ts#L11-L19) に検証済みの記録がある）。そのため共有コードは複製するのがこのリポジトリの方針。認証処理を2ファイルに複製したくないので、`[resource]` 動的セグメントで1ファイルに収めた（[api/project-files/[action].ts](../api/project-files/%5Baction%5D.ts) と同じ形）。

同じ理由で、Markdown→HTML変換・ステータスの写像・採番も**このファイル内に自己完結**させている。

> ⚠️ 変更時は以下も合わせて確認すること
> ・`src/app/lib/mdTickets/parse.ts`（ステータス／優先度の写像）
> ・`src/app/lib/bulkTicketInsert.ts`（登録するカラムと通知）
> ・`src/app/lib/apiKeyPrompt.ts`（AIに渡す仕様書。食い違うとAIの JSON が400で弾かれる）

---

## 7. Markdown → HTML

`description` は Markdown 文字列で受け、TipTap のスキーマに載る HTML に変換して `sprint_tickets.description` へ入れる。対応範囲は段落／太字／斜体／打消し／インラインコード／リンク／箇条書き／番号付きリスト／引用／コードブロック／水平線／見出し。表と入れ子リストは非対応（そのまま段落になる）。

AIに渡す仕様側で「本文は太字ラベル＋段落＋箇条書き」に寄せてあるため、この範囲で足りる。

セキュリティ上の扱い:
- すべてエスケープしてから装飾を適用する
- `javascript:` 等のスキームは `safeHref()` で落とす
- インラインコードは NUL 文字で退避してから復元する（`" 1 "` のような区切りだと「手順 1 を実行」のような普通の文章を壊すため）

---

## 8. UI

### 8-1. 「新規チケット」メニュー

```
[🗂 Myフィルタ] [⧉ 詳細] [⤓ CSVダウンロード] [＋ 新規チケット ▾]  ✏ 🗑
                                                    │
        ┌───────────────────────────────────────────┘
        │ 🎫 チケット作成       1件ずつ入力して登録する
        │ 📄 MDファイルから取り込み  AIが書いたMDを取り込んで一括登録
        │ ▦  一括作成          表に直接入力してまとめて登録
        │ 🔑 API連携           AIやCIから直接登録できるようにする
        └───────────────────────────────────────────
```

**無効化のルール**（`buildCreateTicketDisabled()` に集約。4ビューで共通）:

| 条件 | 対象 | 表示 |
|---|---|---|
| `maxTicketsPerSprint` 到達 | **ボタン全体** | グレー＋「現在のプランではこれ以上作成できません」 |
| `plan.featureBulkCreate` OFF | MD取り込み／一括作成／API連携 | 項目をグレー＋🔒＋理由 |
| `admin` / `owner` 以外 | API連携 | 項目をグレー＋「管理者のみ設定できます」 |

ボタン全体を無効化するのはチケット数上限のときだけ。4項目すべてが使えないので、これが唯一「ボタンをグレーにしてよい」条件になる。非表示ではなくグレーにしているのは、開発者にも手段の存在が伝わり管理者に依頼できるようにするため。

「一括作成」はサブメニューを廃止し、選ぶと**表のモーダルを直接開く**。

### 8-2. API連携モーダル

2タブ構成。

- **使い方** … プロンプトをコピーする（毎フェーズ使う）
- **APIキー** … 発行・失効・棚卸し（年に数回）

発行直後はタブを隠し、平文キーのコピーに集中させる。

### 8-3. プロンプトへのAPIキーの埋め込み

コピーするプロンプトには、**エンドポイント・JSON形式・メンバー名・分類名・本文の項目構成に加えて、APIキーそのものを埋め込む**。AIに貼るだけで登録できる状態にするため。

**「使用するキー」で選んだキーが、そのままプロンプトへ入る。** 利用者がキーを控えて貼り直す必要はない。

これを成立させるため、平文を **AES-256-GCM で暗号化して `key_cipher` に保存**している（§9）。画面でキーを選ぶと `POST /api/api-keys/reveal` を呼び、サーバーが復号した平文を返す。

- 選択中は「✅ 選択中のキーを埋め込んだ状態でコピーされます」と表示し、ボタンも「プロンプトコピー（APIキー込み）」になる
- 暗号化して保存する前に発行されたキー（`key_cipher` が空）は復号できず、409 と `code: "no_cipher"` を返す。画面は「新しく発行し直してください」と案内する

当初は「入力欄に利用者が貼る」設計にしたが、**選択欄と入力欄が並ぶのは操作として破綻していた**（選択欄が何の役にも立たない）ため、この形に変更した。

---

## 9. コスト

**追加のランニングコストはゼロ。** 新サービスを足していない。

| 費目 | 影響 | 理由 |
|---|---|---|
| Vercel 関数の本数 | なし | 既に21ルート稼働（Hobbyの上限12を超えている＝Pro）。1本増えても課金は増えない |
| Vercel 実行時間 | ほぼ誤差 | 1登録=1呼び出し・数百ms。月数百回規模 |
| Supabase DB | なし | 作られる行は人が手で作るのと同じ |
| Supabase Auth MAU | なし | APIキーは独自テーブル。Auth ユーザーを作らない |
| 外部サービス | なし | レート制限も Postgres 内で完結 |

**唯一のコストリスク**は、公開エンドポイントを無制限に叩かれること。これを潰すためレート制限を Phase 1 に含めてある。

---

## 10. 既知バグの再発防止チェック

`memory/bug_checklist.md` の該当項目:

- **順番が変わる**: `created` は親→子の順で返し、insert も同順。独自ソートを持ち込まない
- **チカチカ**: メニューの無効化理由は毎レンダー同じ内容を生成するだけで、state を持たない
- **子チケットの遅延**: 親子を**1回の insert** にまとめる（既存の `insertBulkTickets` と同じ方針）

---

## 11. 残課題

- ブラウザ側の採番（`insertBulkTickets`）も `reserve_ticket_wbs()` へ寄せる
- 冪等キー（`Idempotency-Key`）。現状はAIが同じ内容で2回送ると二重に登録される。手順書側で「エラー時に再送しないこと」を指示して回避している
- 読み取り系API（GET /tickets）と更新系API
- MCPサーバー化。これがあればMDファイルどころか手順のコピーも不要になる
