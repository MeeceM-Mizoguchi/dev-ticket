# BRU9-042 子チケットの保留・取下げ機能追加 — 設計書

## 0. 結論（サマリ）

親チケットと**同じ `progress` フラグ方式**（`-1` = 保留 / `-2` = 取下）を子チケットにもそのまま適用する。
**DBマイグレーション・型変更は不要。**

調査の結果、一覧・ボード・スプリント詳細・Myアクションなどの**表示側はすでに子チケットの `progress = -1 / -2` に対応済み**だった（`getTicketStatusMeta(status, progress)` を親子共通で通しているため）。
したがって実質的な改修は次の4点に絞られる。

| # | 改修 | 規模 |
|---|------|------|
| A | 詳細パネルの保留／取下ボタンを子チケットにも開放（`!ticket.parentId` ガード解除） | 小 |
| B | 親ステータス変更バリデーションから「取下済みの子」を除外 | 小 |
| C | 子の実績工数計算から保留期間を差し引く（BRU5-028 の計測ロジック） | 中 |
| D | 解除時のマイルストーン記録を子チケットではスキップ（データ破壊防止） | 小 |

加えて、親でも発生している既存不具合（CSV出力が保留/取下を反映しない）を同時に潰す。

---

## 1. 現状整理

### 1.1 保留・取下の表現方法

```
progress === -1  → 保留中（status は元の値、例 "in-progress" を保持したまま）
progress === -2  → 取下   （同上）
progress >=  0   → 通常
```

DBの `status` チェック制約を触らずに済ませるため `progress` に負値を入れる方式
（`TicketDetailPanel.tsx:876` のコメント参照）。解除時は `STATUS_PROGRESS[status]` で
本来の進捗値を復元する。

### 1.2 すでに子チケットで動く箇所（改修不要）

| 箇所 | 状態 |
|------|------|
| [helpers.ts:60-65](../src/app/lib/helpers.ts#L60-L65) `getTicketStatusMeta` | 親子共通。progress優先で「保留中／取下」バッジを解決済み |
| [SprintListView.tsx:1124-1137](../src/app/components/sprints/SprintListView.tsx#L1124-L1137) 子行 | 保留/取下でグレーアウト＋半透明＋バッジ表示済み |
| [SprintBoardView.tsx:37-41](../src/app/components/sprints/SprintBoardView.tsx#L37-L41) `effectiveStatus` | 子カードも「保留中／取下」列に振り分け済み。両列はドロップ禁止（:157） |
| [SprintDetailPage.tsx:737-747](../src/app/pages/SprintDetailPage.tsx#L737-L747) 子行 | 保留/取下の色・バー色を分岐済み |
| [TicketDetailPanel.tsx:2561](../src/app/components/tickets/TicketDetailPanel.tsx#L2561) 親詳細の子一覧 | `getTicketStatusMeta(child.status, child.progress)` でバッジ表示済み |
| [MyActionsPage.tsx:1289-1296](../src/app/pages/MyActionsPage.tsx#L1289-L1296) | `progress >= 0` フィルタで保留/取下チケットをアクションから除外済み |
| [helpers.ts:12-17](../src/app/lib/helpers.ts#L12-L17) `computeSprintStatus` | 保留/取下チケットを「稼働中」から除外済み（子も `sprint.tickets` に含まれる） |
| [helpers.ts:287](../src/app/lib/helpers.ts#L287) `sprintProgress` | 取下(-2)を完了扱いにカウント済み |
| [TicketDetailPanel.tsx:2048](../src/app/components/tickets/TicketDetailPanel.tsx#L2048) ヘッダバッジ | 親子共通コード。progress で分岐済み |
| [TicketDetailPanel.tsx:2237/2243](../src/app/components/tickets/TicketDetailPanel.tsx#L2237-L2248) 子の着手/完了ボタン | すでに `progress >= 0` ガード付き。保留・取下中は自動的に非表示になる |

> つまり「子の progress を -1 / -2 にできるようにする」だけで、一覧系の見た目は全部ついてくる。

### 1.3 子チケットで動かない／壊れる箇所（＝今回の改修対象）

| 箇所 | 問題 |
|------|------|
| [TicketDetailPanel.tsx:2054, 2068](../src/app/components/tickets/TicketDetailPanel.tsx#L2054-L2081) | `isAssignee && !ticket.parentId && status !== "released"` で**子には保留/取下ボタンが出ない**（今回の本丸） |
| [helpers.ts:319-326](../src/app/lib/helpers.ts#L319-L326) `validateParentStatusChange` | 子の `status` ランクだけを見るため、**取下げた子が親のステータス前進を永久にブロックする** |
| [TicketDetailPanel.tsx:1005-1028](../src/app/components/tickets/TicketDetailPanel.tsx#L1005-L1028) `handleChildComplete` | `started_at → now` の営業時間をそのまま実績工数にするため、**保留期間が工数に混入する** |
| [useProject.ts](../src/app/hooks/useProject.ts) `recordMilestoneFromTicketStatus` | 解除時に呼ばれる。子が `closed` の状態で呼ぶと `released_at` までの**全マイルストーンを一括スタンプしてしまう** |
| [csvExport.ts:57](../src/app/lib/csvExport.ts#L57) | `progress` を見ずに `status` のラベルを出力。**保留/取下が CSV に反映されない**（親でも発生中の既存不具合） |

---

## 2. 設計

### A. 詳細パネル：保留／取下ボタンの開放

`!ticket.parentId` ガードを外し、代わりに**終端状態の判定を親子で切り替える**。

- 親の終端は `released`（リリース済み）
- 子の終端は `closed`（対応完了）… 子は `released` にならない

```ts
// 判定を1か所に集約（レンダリング直前、isAssignee の近くに置く）
const isChild = !!ticket.parentId;
const isTerminalForHold = isChild ? status === "closed" : status === "released";
// 解除操作は終端でも常に可能にする（保留中/取下中は必ずボタンを出す）
const canToggleHold = isAssignee && (progress < 0 || !isTerminalForHold);
```

ボタンの表示条件を `isAssignee && !ticket.parentId && status !== "released"` →
`canToggleHold` に置き換える。ボタン自体の見た目・文言（保留する／保留解除／取下する／取下解除）は
親と完全に共通のまま流用する。

**「完了済み(closed)の子には保留・取下を出さない」理由**は D. で述べるマイルストーン破壊の回避。
完了した作業を保留にする業務的な必然性も薄いため、親（released除外）と同じ思想で揃える。

**排他制御**：既存コードで `progress` が負のときは着手開始／対応完了ボタンが消える（`progress >= 0` ガード）。
逆に保留中(-1)に取下ボタンを押せる／取下中(-2)に保留ボタンを押せる状態は親と同じく残る。
親の挙動と揃えるため、**ここは現状踏襲**（片方が有効なときもう片方を非表示にする追加制御はしない）。

### B. 親ステータス変更バリデーションの見直し

[helpers.ts:319](../src/app/lib/helpers.ts#L319) `validateParentStatusChange` を修正する。

```ts
export function validateParentStatusChange(targetStatus: TicketStatus, childTickets: SprintTicket[]): string | null {
  // 取下(-2)の子は「もう対応しない」ので、親の前進を阻害しない
  const effective = childTickets.filter(c => c.progress !== -2);
  if (effective.length === 0) return null;
  const minRank = PARENT_STATUS_MIN_CHILD_RANK[targetStatus];
  if (minRank === undefined) return null;
  const blocking = effective.filter(c => (STATUS_RANK[c.status] ?? 0) < minRank);
  if (blocking.length === 0) return null;
  // 保留(-1)は「一時停止しているだけで、まだ完了していない」ため引き続きブロックする。
  // ただし原因が保留であることをメッセージで示し、ユーザーが解除すべき子を特定できるようにする。
  const held = blocking.filter(c => c.progress === -1).length;
  return held > 0
    ? `子チケット ${blocking.length}件が対応完了していないため変更できません。（うち保留中 ${held}件）`
    : `子チケット ${blocking.length}件が対応完了していないため変更できません。`;
}
```

**判断の根拠**：

- 取下 = その子は今後やらない → 親の完了判定から**外す**のが自然。外さないと親が永久に完了できない。
- 保留 = 一時停止でいずれやる → **外さない**。外すと「保留にすれば親を完了できる」抜け道になる。
  ただし現行メッセージだと理由が分からず詰まるため、保留件数を併記する。

呼び出し元（[:860](../src/app/components/tickets/TicketDetailPanel.tsx#L860), [:1282](../src/app/components/tickets/TicketDetailPanel.tsx#L1282)）はシグネチャ据え置きのため変更不要。

### C. 子の実績工数から保留期間を除外（BRU5-028 の整合）

現状 `handleChildComplete` は `started_at → 現在` の営業時間をそのまま実績にする。
3日保留してから再開・完了すると、保留していた3日分が実績工数に乗ってしまう。

**方式**：親の実績モニターがすでに使っている「コメント履歴から保留区間を積算する」ロジックを流用する。
保留／解除時には必ず以下の定型コメントが `status_change` として記録されるため、追加のカラムは不要。

- `チケットを保留にしました`（保留開始）
- `保留を解除しました`（保留終了）

**共通化**：[ProjectMonitor.tsx:165-195](../src/app/components/projects/ProjectMonitor.tsx#L165-L195) の
`getHoldHoursForRange` を `src/app/lib/holdHours.ts` に純関数として切り出す。

```ts
// src/app/lib/holdHours.ts
/** status_change コメント列から、[startMs, endMs] 区間の保留累計時間（営業時間）を返す */
export function calcHoldHours(
  comments: Array<{ content: string; createdAt: string; commentType?: string }>,
  startMs: number,
  endMs: number,
  isCurrentlyHeld = false,
): number
```

- ProjectMonitor は同関数を呼ぶ形にリファクタ（判定文言の二重管理を防ぐ）
- `handleChildComplete` では：

```ts
const holdHours = calcHoldHours(await fetchComments(ticket.id), startedMs, Date.now());
patch.actual_work_hours = Math.max(0, Math.round((calcWorkingHours(startedMs, Date.now()) - holdHours) * 10) / 10);
```

既存の「着手から1分未満は計測しない」「手入力済みなら上書きしない」ガードはそのまま維持する。

> 保留中のまま「対応完了」されるケースは、A の排他により発生しない（保留中は完了ボタンが出ない）。

### D. 解除時のマイルストーン記録を子ではスキップ

`handleToggleHold` / `handleToggleWithdraw` の**解除側**は
`recordMilestoneFromTicketStatus(ticket.id, status)` を呼ぶ。
この関数は [useProject.ts](../src/app/hooks/useProject.ts) で
`closed → releasedAt` にマップされ、**`keyIdx` までの未記録マイルストーンを一括で現在時刻でスタンプする**。

子チケットに対してこれが走ると、レビューもSTGも通っていない子に
`review_requested_at` 〜 `released_at` が一斉に書き込まれ、実績データが壊れる。

**対応**：子チケットではマイルストーン記録を呼ばない。

```ts
if (!ticket.parentId) recordMilestoneFromTicketStatus(ticket.id, status as any);
```

子チケットは実績モニター自体が非表示（[:2176](../src/app/components/tickets/TicketDetailPanel.tsx#L2176) で `!ticket.parentId` ガード）で
マイルストーン列を使わず、必要なのは `started_at` のみ。`started_at` は `startChildSelf` が設定するため影響なし。
保留にする側（`"保留"` / `"取下"` を渡す呼び出し）は `STATUS_TO_MILESTONE` にキーが無く元々no-opなので、
そのままでも害はないが対称性のため同じガードを付ける。

### E. 親詳細の子チケット一覧の視認性

[TicketDetailPanel.tsx:2560-2580](../src/app/components/tickets/TicketDetailPanel.tsx#L2560-L2580)。
バッジは既に正しく出るが、行のグレーアウトが無いため、一覧画面と見た目が揃わない。

- 保留/取下の子行に `opacity: 0.65` ＋ 背景 `#F5F5F4`（SprintListView と同じ扱い）
- 見出しの件数を `(3件)` → `(3件 / 取下1)` のように内訳表示（取下が0件なら従来通り）

### F. CSV出力の保留・取下反映（親も含む既存不具合の同時修正）

[csvExport.ts:57](../src/app/lib/csvExport.ts#L57)：

```ts
// before
const statusLabel = TICKET_STATUSES.find(s => s.value === ticket.status)?.label ?? ticket.status;
// after
const statusLabel = getTicketStatusMeta(ticket.status, ticket.progress).label;
```

`buildRow` は親子共通で通るため、この1行で親・子の両方が「保留中／取下」と出力される。
（副次的に、子の `closed` が「未着手」と誤出力される問題も解消される）

---

## 3. DB／型への影響

**なし。**

- `sprint_tickets.progress` の既存運用をそのまま利用。マイグレーション不要
- `TicketStatus` 型に `pending` / `withdrawn` は追加しない（現行同様、UI表示専用の疑似ステータスとして `TICKET_STATUSES` にのみ存在）
- RLS・権限テーブルの変更なし

---

## 4. 権限

親と同じ `isAssignee`（[:1615](../src/app/components/tickets/TicketDetailPanel.tsx#L1615) `!assignee || assignee === userName`）を踏襲する。
子チケットの担当者は親と異なりうるが、「そのチケットの担当者が自分の作業を止める」という意味づけは同じため、
子の担当者判定をそのまま使う。親担当者やPMによる代理操作は今回スコープ外。

---

## 5. 改修ファイル一覧

| ファイル | 内容 |
|---|---|
| `src/app/components/tickets/TicketDetailPanel.tsx` | A（ボタン開放）、C（工数から保留減算）、D（マイルストーンガード）、E（子一覧の見た目） |
| `src/app/lib/helpers.ts` | B（`validateParentStatusChange` の取下除外・メッセージ改善） |
| `src/app/lib/holdHours.ts` **(新規)** | C（保留時間算出の共通関数） |
| `src/app/components/projects/ProjectMonitor.tsx` | C（共通関数へのリファクタ） |
| `src/app/lib/csvExport.ts` | F（progress を反映したステータス出力） |

新規SQL・新規コンポーネントなし。

---

## 6. テスト観点

**基本動作**
1. 子チケット詳細で「保留する」→ バッジが「保留中」、着手/完了ボタンが消える
2. 「保留解除」→ 元のステータス（未着手／対応中）と進捗値に正しく戻る
3. 「取下する」→ 確認モーダル → 「取下」バッジ、コメント履歴に記録
4. 「取下解除」→ 元に戻る
5. 完了済み(closed)の子には保留・取下ボタンが出ない

**表示連動**
6. スプリント一覧のアコーディオン子行がグレーアウト＋「保留中／取下」バッジ
7. カンバンボードで子カードが「保留中」「取下」列へ移動し、その列にはドロップできない
8. スプリント詳細の子行の色・進捗バーが切り替わる
9. 親詳細の子チケット一覧でバッジ＋グレーアウト
10. Myアクションから保留/取下した子が消える
11. CSVに「保留中」「取下」が出力される（親・子とも）

**親子の相互作用**
12. 子を1件取下 → 残りの子が全て完了なら親のステータスを前進できる
13. 子を1件保留 → 親のステータス前進はブロックされ、メッセージに「保留中 1件」が出る
14. 全ての子を取下 → 親を完了までブロックなしで進められる
15. 保留/取下の子を含むスプリントのステータス（完了判定・「保留あり」ラベル）が正しい

**実績工数（BRU5-028 回帰）**
16. 着手 → 保留 → 解除 → 対応完了 で、保留期間が実績工数に含まれない
17. 保留を挟まない従来フローの実績工数が変わらない
18. 実績工数が手入力済みの子は上書きされない
19. 取下解除した子のマイルストーン列（review_requested_at 等）が書き換わっていない

**既知の再発バグ確認（プロジェクト共通チェックリスト）**
20. 保留/取下の操作後に一覧のチケット並び順が変わらない
21. 操作直後に画面がチカチカ（再フェッチによる再描画）しない
22. 子チケットの状態反映に遅延がない

---

## 7. 確定した仕様判断

### ① 親→子のカスケード： **しない**

親と子は独立して保留・取下できる。親を取下げても子の状態は変わらない。

- 実装追加ゼロ。既存の親の挙動を一切変えないため回帰リスクが最小
- 「親を取下げたのに子が動いているように見える」ケースは残るが、スプリント完了判定・進捗集計は
  親子とも `progress` で除外されるため数字は壊れない

### ② 保留中の子を持つ親のステータス前進： **ブロックする**

保留＝一時停止でいずれやる作業なので、対応完了扱いにはしない（B. の設計どおり）。
ただし現行メッセージでは理由が分からず詰まるため、
`子チケット 2件が対応完了していないため変更できません。（うち保留中 1件）` と内訳を併記する。
取下(-2)の子のみ判定対象から除外する。

### ③ 子の実績工数から保留期間を差し引く： **今回対応に含める**

C. の設計どおり、`lib/holdHours.ts` に保留時間算出を共通関数として切り出し、
`handleChildComplete` と `ProjectMonitor` の両方から利用する。追加カラムなし。

---

## 8. 残る留意点（今回スコープ外・現状維持）

**親が保留中のときの子の着手可否**
現状、親が保留中でも子は着手できる（子は自分の `progress` しか見ていない）。
①でカスケードしない方針を採ったため、ここも現状維持とする。
将来的に揃えるなら、子の「着手開始」ボタンに親の `progress < 0` 判定を足す形で対応可能。
