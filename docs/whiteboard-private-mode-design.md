# ホワイトボード プライベートモード 設計書

> 対象: ボード単位で「作成者だけが見られる」モードを追加する
>       ＋ そこから選んだPJメンバーにだけ見せる「限定公開」（§9・2026-08-30 追加）
> ステータス: **実装済み（vite build 緑・未検証）**
> 残作業: `supabase/add_whiteboard_private.sql` と `supabase/add_whiteboard_shares.sql` の適用（ユーザー作業）

---

## 1. 要件の分解と結論

| # | 要件 | 実現方法（結論） |
|---|------|------------------|
| ① | ボード一覧の各行に3点リーダーを追加し、メニューを「名前変更 / ボード削除 / プライベートモード」にする | 既存の鉛筆・ゴミ箱アイコンを廃止し、shadcn `DropdownMenu` に集約（WikiPage のツリーと同じ実装パターン） |
| ② | プライベート化後は同じ項目が「プライベートモード解除」に変わる | `whiteboards.visibility` を見てラベルとアイコンを切り替えるだけ |
| ③ | 解除すると元どおり PJ メンバーも見られる | `visibility='project'` に戻す。RLS が自動的に開放する |
| ④ | プライベート中はボード内にバッジを出す | Excalidraw の `renderTopRightUI` スロットの先頭に「🔒 プライベート」バッジ。疑似全画面でも消えない |
| ⑤ | ボード一覧側にも印を付ける | 行頭アイコンを `PenTool` → `Lock`（紫）に差し替え＋タイトル右に小さな「自分のみ」ラベル |

### 事前確認で確定した仕様（ユーザー回答）

| 論点 | 決定 |
|------|------|
| 組織 owner/admin はプライベートボードを見られるか | **見られない。作成者のみ**（DB レベルでも遮断） |
| プライベート化できるのは誰か | **作成者（`created_by`）のみ** |
| プライベート中のコメントのメンション通知（ベル/Slack） | **送らない**（抑止）。解除後の新規コメントからは通常どおり |

---

## 2. 現状調査（設計の土台）

### 2-1. ホワイトボードの DB アクセスは 1 ファイルに集約されている
`whiteboards` テーブルを触るコードは [whiteboardService.ts](../src/app/lib/whiteboardService.ts) だけ。
`api/`・`ml/`・`scripts/` からの参照はゼロ（grep 済み）。
→ **サーバ側・バッチ側の改修は不要**。フロントは実質この 1 ファイル＋ UI 2 箇所で閉じる。

### 2-2. 現在のアクセス制御は「アプリ側だけ」
[add_whiteboard.sql:23-26](../supabase/add_whiteboard.sql#L23-L26) のとおり RLS は `authenticated` 全許可で、
実際の遮断は [`loadWhiteboardPerms()`](../src/app/lib/whiteboardService.ts#L81) が返す `whiteboardPermission`（none/view/edit）だけが担っている。
コード中のコメントにも「ここがアクセス制御の実体」と明記されている（[WhiteboardPage.tsx:58](../src/app/pages/WhiteboardPage.tsx#L58)、[WhiteboardLinkPreview.tsx:58](../src/app/components/whiteboard/WhiteboardLinkPreview.tsx#L58)）。

→ **プライベートモードはこの方針に乗せない**。「自分だけ」は漏れた時の被害が質的に違うので、
　**RLS（DB）で遮断し、アプリ側は表示の都合だけを扱う**（＝二重防壁ではなく、DB を唯一の防壁にする）。
　既存の PJ 権限まで RLS 化するのは影響範囲が大きすぎるので、今回は触らない。

### 2-3. `userId` は `auth.uid()` と一致する
`AuthContext` は `session.user.id` をそのまま `userId` に入れている（[AuthContext.tsx:179](../src/app/contexts/AuthContext.tsx#L179), [:213](../src/app/contexts/AuthContext.tsx#L213)）。
生体認証ログインも Supabase セッションを張ってから同じ経路を通る。
モックログイン（[:249](../src/app/contexts/AuthContext.tsx#L249)）は `isSupabaseEnabled === false` の時だけで、その場合 whiteboardService は全関数が早期 return する。
→ **`created_by`（text）と `auth.uid()::text` を直接突き合わせて良い**。

### 2-4. リアルタイム同期はテーブル RLS の外側にある
図形・カーソル・コメントの実データは Yjs で、チャンネル名は **`wb:{boardId}` 固定**（[useWhiteboardSync.ts:64](../src/app/hooks/useWhiteboardSync.ts#L64)）。
Supabase Broadcast は Realtime Authorization を有効化していない限り、**認証済みなら誰でも任意トピックに join できる**。
しかも `SupabaseYjsProvider` は後入り参加者のために `sync-req` に対してドキュメント全体を返す。

→ **RLS だけではリアルタイム経路が塞がらない**。ボードは「最初は公開 → あとでプライベート化」という流れが前提なので、
　**過去にURLを知っていた人が `wb:{boardId}` に居座れば編集内容が見えてしまう**。これは実害のある穴なので同時に塞ぐ（§4-3）。

### 2-5. コメントは DB に無い
コメント本体は Yjs ドキュメント内（`docRef`）に載っており専用テーブルは無い。
外へ漏れるのは [whiteboardCommentNotify.ts](../src/app/lib/whiteboardCommentNotify.ts) の `notifications` insert と Slack POST のみ。
→ 通知の抑止は **この 1 ファイルの入口で弾く**だけで足りる。

---

## 3. データモデル

### 3-1. マイグレーション `supabase/add_whiteboard_private.sql`（新規）

```sql
-- ホワイトボード プライベートモード
alter table whiteboards
  add column if not exists visibility  text not null default 'project',
  add column if not exists private_by  text not null default '',   -- プライベート所有者 = auth.uid()::text
  add column if not exists private_key text not null default '';   -- Realtime チャンネルの秘密トークン

alter table whiteboards drop constraint if exists whiteboards_visibility_check;
alter table whiteboards add constraint whiteboards_visibility_check
  check (visibility in ('project','private'));

create index if not exists idx_whiteboards_private_by on whiteboards(private_by)
  where visibility = 'private';

-- ── RLS 差し替え（全許可 → プライベート行だけ所有者に限定） ──
drop policy if exists "auth_select_whiteboards" on whiteboards;
drop policy if exists "auth_insert_whiteboards" on whiteboards;
drop policy if exists "auth_update_whiteboards" on whiteboards;
drop policy if exists "auth_delete_whiteboards" on whiteboards;

-- 閲覧: 公開ボードは従来どおり全員 / プライベートは所有者のみ
create policy "wb_select" on whiteboards for select
  using (auth.role() = 'authenticated'
         and (visibility <> 'private' or private_by = auth.uid()::text));

-- 作成: 常に公開で作る（プライベートで作るなら自分名義に限る）
create policy "wb_insert" on whiteboards for insert
  with check (auth.role() = 'authenticated'
              and (visibility <> 'private'
                   or (private_by = auth.uid()::text and created_by = auth.uid()::text)));

-- 更新: 見えている行だけ。かつ「プライベート化できるのは作成者が自分名義でのみ」
create policy "wb_update" on whiteboards for update
  using (auth.role() = 'authenticated'
         and (visibility <> 'private' or private_by = auth.uid()::text))
  with check (visibility <> 'private'
              or (private_by = auth.uid()::text and created_by = auth.uid()::text));

-- 削除: 見えている行だけ（公開ボードの削除権は従来どおり）
create policy "wb_delete" on whiteboards for delete
  using (auth.role() = 'authenticated'
         and (visibility <> 'private' or private_by = auth.uid()::text));
```

**この `with check` が仕様③（作成者のみ切替）の実体**。他人の公開ボードを勝手にプライベート化して独占する、
という乗っ取りを DB 側で不可能にしている（UI 側のメニュー非表示は「見せない」だけの補助）。

### 3-2. 既知の制約
- `created_by` が空文字の行（機能初期に作られた可能性のあるボード）は**永久にプライベート化できない**。
  該当があれば運用 SQL で `created_by` を埋める。実装前に `select count(*) from whiteboards where created_by = ''` で確認する。
- 作成者が退職・削除された場合、そのプライベートボードは誰からも到達不能になる（＝仕様どおり）。
  救済は SQL 直接操作のみ。この点は仕様として記録しておく。

### 3-3. 型（[types.ts:397](../src/app/types.ts#L397)）

```ts
export interface Whiteboard {
  id: string; projectId: string; title: string;
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string;
  visibility: "project" | "private";   // 追加
  privateBy: string;                   // 追加（プライベート所有者のuserId・公開時は ""）
  privateKey: string;                  // 追加（Realtimeチャンネル用トークン・公開時は ""）
}
```

---

## 4. 実装方針

### 4-1. サービス層 `whiteboardService.ts`

| 変更 | 内容 |
|------|------|
| `WhiteboardRow` / `mapWhiteboard` | 3 カラムを追加してマッピング |
| `BoardMeta` / `getBoardMeta` | `visibility` を select に追加（プレビューのバッジ表示用） |
| **`setBoardVisibility(board, userId)`（新規）** | プライベート化/解除の唯一の入口。下記の順序を守る |

```
プライベート化:
  1. onFlushDocState()          // 保存デバウンス(1.5s)の取りこぼし防止。呼び出し側から渡す
  2. broadcastBoardEvicted(id)  // 旧チャンネル wb:{id} に退去イベントを流す（§4-3）
  3. update { visibility:'private', private_by:userId, private_key: crypto.randomUUID() }
  4. 失敗したら false を返す（RLS に弾かれた＝作成者でない）

解除:
  1. update { visibility:'project', private_by:'', private_key:'' }
```

`renameBoard` / `deleteBoard` / `saveDocState` は無改修。RLS に弾かれた場合は現状どおり黙って何も起きない
（プライベート化された瞬間に他人の画面で走る保存が静かに失敗する、という挙動になる。これは意図どおり）。

### 4-2. UI

#### (a) `BoardListSidebar.tsx` — 3点リーダーへの集約

- 鉛筆・ゴミ箱ボタンを削除し、`MoreVertical` トリガー + `DropdownMenu` に置換
  （[WikiPage.tsx:285-303](../src/app/pages/WikiPage.tsx#L285-L303) と同じ形。`onClick`/`onPointerDown` の `stopPropagation` を忘れない＝行の選択が暴発するため）。
- メニュー項目（ユーザー指定の並び順を厳守）:
  1. `Pencil` 名前変更 — 従来のインライン編集を起動
  2. `Trash2` ボード削除 — 従来どおり（確認ダイアログは現状も無い。今回は挙動を変えない）
  3. `Lock` / `LockOpen` **プライベートモード / プライベートモード解除**
     — `board.createdBy === userId` の時だけ表示。`visibility` でラベルとアイコンを切替
- 解除時のみ確認ダイアログを出す:「このボードをプロジェクトメンバー全員に公開します。よろしいですか？」
  （公開する側の方が取り返しがつかないため。プライベート化はトーストのみ）
- 行の見た目:
  - 行頭アイコン `PenTool` → プライベート時は `Lock`（`#7C3AED`）
  - タイトル右に極小バッジ「自分のみ」（`background:#F5F3FF` / `color:#6D28D9` / `fontSize:9`）
- `canEdit === false`（閲覧のみ）ではメニュー自体を出さない（現状の鉛筆/ゴミ箱と同じ扱い）。
  ※ 閲覧のみのメンバーは自分のボードを作れないので、プライベート項目が必要になる場面は無い。

#### (b) ボード内バッジ — `WhiteboardCanvas.tsx`

`renderTopRightUI` の**先頭**（`CopyObjectLinkButton` の左）にバッジを 1 個足す。

```
🔒 プライベート    // Lock 12px / 紫 #6D28D9 / 背景 #F5F3FF / 1px solid rgba(124,58,237,0.25) / borderRadius 20
```

- **左上ではなく右上スロットを選ぶ理由**: 左上（y<52）は `BoardListToggle` の floating ボタンが占めることがあり、
  折りたたみ状態によって重なる。右上は Excalidraw が自前でレイアウトするので衝突しない。
  さらに `renderTopRightUI` はキャンバス内部なので**疑似全画面（zIndex:3000）でもバッジが消えない**。
- `WhiteboardCanvas` に `isPrivate: boolean` プロップを 1 個追加するだけ。
- 加えて `WhiteboardPage` のヘッダー（「閲覧のみ」バッジの隣）にも同じバッジを出す。

#### (c) `WhiteboardPage.tsx`

- `handleToggleVisibility(id)` を追加 → `setBoardVisibility` → `setBoards` を差分更新 → トースト。
- `WhiteboardCanvas` の `key` を **`${boardId}:${visibility}`** にする。
  → 切替時に強制リマウントされ、新しいチャンネル名で張り直る（§4-3）。
- `<WhiteboardCanvas>` に `isPrivate` と `channelKey`（= `privateKey`）を渡す。

#### (d) `WhiteboardLinkPreview.tsx`

無改修で成立する。RLS により `getBoardMeta` が `null` を返し、既存の「ボードが見つかりませんでした」に落ちる。
表示文言だけ「このボードはプライベートモードのため表示できません」に分岐させたいが、
**RLS では「無い」と「見えない」が区別できない**ので文言は現状のままにする（区別できるようにすると存在が漏れる）。
所有者本人が開いた時は `meta.visibility === 'private'` でヘッダーに §4-2(b) と同じバッジを出す。

### 4-3. リアルタイム経路の遮断（§2-4 の穴）

**チャンネル名にトークンを混ぜる。**

```
公開:        wb:{boardId}
プライベート: wb:{boardId}:{private_key}
```

`private_key` はプライベート行と一緒に RLS で隠れるので、**所有者以外はチャンネル名を計算できない**。
- `useWhiteboardSync(boardId, user, channelKey)` にトークンを渡し、`wb:${boardId}${channelKey ? `:${channelKey}` : ""}` を組む。
- 解除時はトークンを空に戻すので、チャンネル名も元に戻る。

**居座り対策（退去イベント）**: プライベート化の瞬間に `wb-evict` を broadcast し、
受け取った側は「このボードはプライベートモードに変更されました」をトーストしてボード一覧へ戻る。

- 図形同期チャンネル（`wb:{id}`）には相乗りさせず、**ボードIDだけで決まる別トピック `wb:{id}:evict`** を使う。
  同期チャンネルはプライベート化した瞬間に名前が変わるので、「変更後に旧チャンネルへ送る」が成立しないため。
  → `SupabaseYjsProvider` は無改修。
- 所有者本人は payload の `by`（送信者のuserId）で自分発を弾く。
- 切替時に自分がそのボードを開いていれば、既に張ってある購読チャンネルからそのまま送る
  （同一ソケットで同じトピックへ二重 join しない）。開いていない時だけ単発チャンネルで送る。

**キャンバスのマウント条件**: ボード行が揃うまでキャンバスをマウントしない。
`private_key` はボード行に入っているので、先にマウントすると一瞬だけ公開チャンネル `wb:{id}` に繋がり、
そこへ自分のドキュメント全体をブロードキャストしてしまう（`SupabaseYjsProvider` は購読直後に全stateを配る）。

> **不採用**: Realtime Authorization（`realtime.messages` の RLS）。
> 有効化はプロジェクト全体に効くため、音声通話 `call:*` など既存の全チャンネルにポリシーを書かないと止まる。
> 今回の目的に対して影響範囲が大きすぎる。

### 4-4. 通知の抑止

[whiteboardCommentNotify.ts](../src/app/lib/whiteboardCommentNotify.ts) の `WbNotifyBase` に `isPrivate: boolean` を追加し、
`notifyWhiteboardMentions` / `notifyWhiteboardReply` の冒頭で `if (base.isPrivate) return;`。
呼び出し元は `CommentLayer`（`boardTitle` などと同じ経路でプロップを 1 個増やす）。

- 通知に限らず、プライベート中のボードでは**メンション候補（@）の表示自体は残す**。自分用のメモとして名前を書きたい場合があるため。
- プライベート化**前**に飛ばした通知は残る。踏むと「ボードが見つかりませんでした」になる（許容）。

---

## 5. 変更ファイル一覧

| ファイル | 種別 | 概要 |
|---|---|---|
| `supabase/add_whiteboard_private.sql` | 新規 | カラム3本＋RLS 4本の張り替え |
| `src/app/components/whiteboard/PrivateBadge.tsx` | 新規 | バッジ本体と紫の配色定数（3画面で共有） |
| `src/app/lib/whiteboardControlBus.ts` | 新規 | 開いているキャンバスへ「今すぐ保存」「退去を送れ」を届ける軽量バス |
| `src/app/types.ts` | 改修 | `Whiteboard` に `visibility` / `privateBy` / `privateKey` |
| `src/app/lib/whiteboardService.ts` | 改修 | Row/map/BoardMeta 拡張、`setBoardVisibility`、`wbChannelName`、退去の送受信 |
| `src/app/components/whiteboard/BoardListSidebar.tsx` | 改修 | 3点リーダー化＋錠アイコン＋「自分のみ」ラベル |
| `src/app/pages/WhiteboardPage.tsx` | 改修 | 切替ハンドラ、解除の確認ダイアログ、key、ヘッダーバッジ、マウント条件 |
| `src/app/components/whiteboard/WhiteboardCanvas.tsx` | 改修 | `isPrivate`/`channelKey`/`onEvicted` プロップ、右上バッジ |
| `src/app/hooks/useWhiteboardSync.ts` | 改修 | チャンネル名にトークン、退去の購読、保存フラッシュの公開 |
| `src/app/lib/whiteboardCommentNotify.ts` | 改修 | `isPrivate` で早期 return |
| `src/app/components/whiteboard/CommentLayer.tsx` | 改修 | `isPrivate` を通知基底に渡す |
| `src/app/components/whiteboard/WhiteboardLinkPreview.tsx` | 改修 | バッジ＋トークン受け渡し＋退去でパネルを閉じる |

**実質 300 行程度。** `SupabaseYjsProvider` は無改修。マイグレーション適用（Supabase SQL Editor 実行）はユーザー作業。

### 実装時に足した保険
- `getBoardMeta` は新カラムを select するが、**SQL 未適用のDBでは列が無くエラーになり、リンクプレビューが全滅する**。
  エラー時は旧カラムだけで引き直すフォールバックを入れた。
- ボード一覧の「名前変更」はドロップダウンから起動するため、`autoFocus` だけだと
  Radix がメニューを閉じる際のフォーカス戻しで即 blur → 何もせず確定してしまう。
  rAF でフォーカスを当て直し、「一度フォーカスが載るまで blur を無視する」ガードを入れた。

---

## 6. 動かすまでの手順

1. **`supabase/add_whiteboard_private.sql` を Supabase の SQL Editor で実行**（これが済むまで切替は失敗する）
2. 適用前に `select id, title, created_by from whiteboards where created_by = '';` を確認。
   該当行があると、そのボードは作成者を判定できず永久にプライベート化できない
3. アプリを再読み込みして §7 のチェックリストを流す

`pnpm build` は緑（このリポジトリでは `tsc` が通らないため **vite build が唯一のゲート**）。

---

## 7. 検証チェックリスト

| # | シナリオ | 期待 |
|---|---|---|
| 1 | A がボード作成 → B（PJメンバー・edit）の一覧に出る | 従来どおり |
| 2 | A が3点リーダー →「プライベートモード」 | 錠アイコン＋「自分のみ」ラベル、ボード内に紫バッジ |
| 3 | 2 の直後、B の一覧をリロード | そのボードが**消える** |
| 4 | 2 の時点で B が同じボードを開いていた | トースト＋ボード一覧へ自動退去。以降 A の編集が届かない |
| 5 | B が旧URL `/{slug}/whiteboard/{id}` を直打ち | 白紙のまま／一覧に無い（doc_state も RLS で読めない） |
| 6 | B がリンクプレビューでそのボードを開く | 「ボードが見つかりませんでした」 |
| 7 | 組織 owner/admin でログインして 3・5・6 | **同じく見えない**（仕様） |
| 8 | B が他人の公開ボードの3点リーダーを開く | 「プライベートモード」項目が出ない |
| 9 | 8 を DevTools から直接 update で突破しようとする | RLS `with check` で失敗 |
| 10 | A が「プライベートモード解除」→確認OK | B の一覧に再び出て、開けて編集できる |
| 11 | プライベート中にコメントで @B | ベル通知・Slack ともに飛ばない |
| 12 | 解除後にコメントで @B | 通常どおり飛ぶ |
| 13 | プライベートボードで疑似全画面 | バッジが出たまま |
| 14 | 既存の公開ボード全般（図形/表/コメント/エクスポート） | デグレなし |

---

## 8. 補足・非対象

- ~~**他人を個別に招待する共有（限定共有）は対象外**。今回は「PJ全体 or 自分だけ」の二値。~~
  → **§9 で実装した**（予告どおり `whiteboard_shares` テーブル＋RLS 1項の追加）。
- 一覧の並び順（`updated_at desc`）にプライベート/公開の区別は入れない。混在のまま錠アイコンで判別する。
- プライベートボードもプロジェクト削除時は従来どおり cascade で消える。


---

# 9. 限定公開（特定のメンバーにだけ見せる）— 2026-08-30 追加

> 対象: プライベートモードのボードを「自分＋選んだPJメンバー」にだけ見せられるようにする
> ステータス: **実装済み（vite build 緑・未検証）**
> 残作業: `supabase/add_whiteboard_shares.sql` の適用（ユーザー作業。適用まで共有先の設定は失敗する）

## 9-1. 要件と結論

| # | 要件 | 実現方法（結論） |
|---|------|------------------|
| ① | プライベートボードを、PJにアサインされている特定メンバー（複数可）にも見せたい | `whiteboard_shares`（ボードID × profiles.id）を足し、RLS に `or 共有されている` を 1 項加える |
| ② | 共有先を選ぶUI | 3点リーダーに「共有するメンバー」を追加 → `WhiteboardShareDialog`（PJメンバーのチェックリスト） |
| ③ | 共有中と分かる印 | バッジを「プライベート」→「限定公開 N人」に切替。一覧の行も「自分のみ」→「N人に共有」 |
| ④ | 共有を外したら見えなくなる | 行の削除＋**秘密トークンの作り直し**＋開いている本人を退去（§9-4） |

### 仕様判断

| 論点 | 決定 | 理由 |
|------|------|------|
| `visibility` に 'shared' を足すか | **足さない**。`'private'` + 共有行 = 限定公開 | RLS が「or 共有されている」1項の追加で済む。状態が増えないので既存の分岐を壊さない |
| 共有相手の権限（閲覧/編集） | **持たせない**。そのメンバーのプロジェクト権限（`whiteboardPermission`）にそのまま従う | ボード単位の権限とPJ単位の権限が二重に効くと、どちらで詰まっているのか誰にも分からなくなる |
| ホワイトボード権限が `none` の人 | **候補には出すが「権限なし」バッジを付ける** | 共有しても画面に辿り着けない。黙って選ばせるより、先に気づけた方がよい |
| プライベート解除時の共有設定 | **一緒に消す** | 残すと、次にプライベート化した時に前の共有先が黙って復活する（「自分だけのつもり」が崩れる） |
| 共有相手はボードを消せるか | **消せない**（RLS `wb_delete` は作成者のみ）。メニューにも出さない | 作成者の持ち物という位置づけを崩さない |
| 共有相手どうしは互いを見られるか | **見られる**（`wb_shares_select` の3項目） | コメントのメンション通知先を「ボードを見られる人」に絞るのに、共有先の一覧が要る |

## 9-2. データモデル `supabase/add_whiteboard_shares.sql`（新規）

```
whiteboard_shares(whiteboard_id uuid, profile_id uuid, created_by text, created_at)  -- PK: (whiteboard_id, profile_id)
```

- 相互参照する RLS（`whiteboards` ⇄ `whiteboard_shares`）は循環して 500 になるので、
  `is_whiteboard_shared_with_me()` / `is_whiteboard_creator()` の **security definer 関数**を挟む
  （`add_tasks.sql` の `task_shares` と同型。ENHA2-029 で実際に踏んだ罠）。
- `wb_select` / `wb_update` / `wb_delete` を張り替え、閲覧と更新に `or is_whiteboard_shared_with_me(id)` を足す。

### RLS の `with check` では守れないので**トリガー**を足した（重要）

共有相手も `doc_state` を保存できないと、書いた内容が黙って消える。
つまり `wb_update` は共有相手にも通さざるを得ない。
一方で「プライベート化／解除できるのは作成者だけ」は維持したい。
**RLS の `with check` は OLD 行を見られない**ため「所有権に関わる列だけ守る」ができない。

→ `whiteboards_guard_ownership()` を **BEFORE UPDATE トリガー**で足した。
`visibility` / `private_by` / `private_key` / `created_by` のどれかが変わる更新だけを見て、
作成者でなければ例外にする。内容の保存は素通し。
`auth.uid()` が無い（SQL Editor / service_role）場合は素通しする ＝ 退職者の救済など運用の直操作を塞がない。

## 9-3. 変更ファイル

| ファイル | 種別 | 概要 |
|---|---|---|
| `supabase/add_whiteboard_shares.sql` | 新規 | テーブル＋関数2本＋RLS 張り替え＋所有権ガードのトリガー |
| `src/app/components/whiteboard/WhiteboardShareDialog.tsx` | 新規 | 共有先の付け外し（現在の共有先／PJメンバーのチェックリスト） |
| `src/app/types.ts` | 改修 | `WhiteboardShareMember`、`Whiteboard.sharedWith` / `.createdByName` |
| `src/app/lib/whiteboardService.ts` | 改修 | `loadShareMap` / `addBoardShares` / `removeBoardShare` / `clearBoardShares` / `rotatePrivateKey` / `loadShareCandidates` / `reloadBoard`、退去通知の一般化 |
| `src/app/lib/whiteboardControlBus.ts` | 改修 | `broadcastEvict` → `broadcastAccess(payload)` |
| `src/app/hooks/useWhiteboardSync.ts` | 改修 | `onEvicted` → `onAccessEvent`（退去／張り直しの2種） |
| `src/app/components/whiteboard/PrivateBadge.tsx` | 改修 | 共有先ゼロ=「プライベート」/ ありは「限定公開 N人」 |
| `src/app/components/whiteboard/BoardListSidebar.tsx` | 改修 | 「共有するメンバー」項目、行バッジ、共有相手には削除を出さない |
| `src/app/pages/WhiteboardPage.tsx` | 改修 | 共有ダイアログ、付け外しハンドラ、キャンバスの key に `privateKey` |
| `src/app/components/whiteboard/WhiteboardCanvas.tsx` | 改修 | `sharedWith` / `isBoardOwner` / `boardOwnerName` / `onAccessEvent` |
| `src/app/components/whiteboard/WhiteboardLinkPreview.tsx` | 改修 | バッジ、鍵の作り直しで meta を引き直す |
| `src/app/lib/whiteboardCommentNotify.ts` / `CommentLayer.tsx` | 改修 | プライベート中は「ボードを見られる人」にだけ通知 |

## 9-4. 共有を外した時（ここが一番の勘所）

RLS はテーブルしか守らない。外された人は `wb:{boardId}:{private_key}` という**チャンネル名を覚えている**ので、
行を消すだけでは Broadcast に居座って同期内容を覗き続けられる（`SupabaseYjsProvider` は後入りに全stateを配る）。

そこで解除時は次の順に進める（`WhiteboardPage.handleRemoveShare`）:

1. `flushSave()` — 保存デバウンス(1.5s)の取りこぼしを吐き出す（この後キャンバスが張り直るため）
2. 共有行を削除
3. **`rotatePrivateKey()` — 秘密トークンを作り直す**
4. アクセス変更を broadcast（**鍵を替えた後**に送る。先に送ると受け手が古い行を読み直す）
5. ローカルのボード行を差し替え → キャンバスの `key` に `privateKey` を入れてあるので自動でリマウント

broadcast のペイロードは `{ by, targets, reason }`。受け手は次のように解釈する（`classifyAccessEvent`）:

| `targets` | 意味 | 受け手の動き |
|---|---|---|
| `null` | 送信者以外の全員 | **退去**（プライベート化の瞬間。まだ共有先が無いのでこれで足りる） |
| 自分が入っている | 名指し | **退去**（共有を外された本人） |
| 入っていない | 名指し外 | **張り直し**（鍵が変わったのでボード行を読み直す） |

プライベート**解除**時も `targets: []`（＝全員 refresh）を、**更新の後に**送る。
チャンネル名からトークンが消えるので、送らないと他メンバーが旧チャンネルに残って同期が静かに止まる。

## 9-5. コメント通知

プライベート中は「通知を一切飛ばさない」→「**ボードを見られる人にだけ飛ばす**」に変えた。
宛先は `privateAllowedNames = [作成者名, ...共有先の名前]`（`WhiteboardCanvas` で組み立て、`CommentLayer` 経由で
`whiteboardCommentNotify` に渡す）。共有先ゼロなら空配列＝誰にも飛ばない＝従来どおり。
作成者名を引くために `listBoards` / `getBoardMeta` がプライベートボードの `created_by` を `profiles` で解決している。

## 9-6. 検証チェックリスト（§7 に追加）

| # | シナリオ | 期待 |
|---|---|---|
| 15 | A がボードをプライベート化 →「共有するメンバー」で B を選ぶ | バッジが「限定公開 1人」、一覧の行が「1人に共有」 |
| 16 | B の一覧をリロード | そのボードが出る。開けて編集できる（Bの権限が view なら閲覧のみ） |
| 17 | C（PJメンバー・非共有）の一覧 | 出ない。URL 直打ちでも開けない |
| 18 | 組織 owner/admin（非共有） | **見えない**（仕様どおり） |
| 19 | A と B が同時に開いて図形を描く | 双方に同期する（＝チャンネル名の鍵を B も読めている） |
| 20 | B が開いたまま A が B の共有を外す | B は退去。A の画面は張り直り、以後 B に同期が届かない |
| 21 | A・B・D に共有 → B だけ外す | D は張り直しだけ（退去しない）。以後も編集が同期する |
| 22 | B が DevTools から `whiteboards` を直接 update して private_by を自分に | トリガーが例外を投げて失敗する |
| 23 | B が共有ボードを削除しようとする | メニューに「ボード削除」が出ない（RLS でも弾かれる） |
| 24 | 限定公開中に B が A を @メンション | ベル/Slack が飛ぶ |
| 25 | 限定公開中に C（非共有）を @メンション | 飛ばない（開けないリンクを配らない） |
| 26 | A が「プライベートモード解除」 | 共有設定も消える。PJ全員に見える。開いていた B は張り直って同期が続く |
| 27 | ホワイトボード権限が none のメンバー | 候補一覧に「権限なし」バッジが出る |
