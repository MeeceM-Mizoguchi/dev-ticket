# チケット詳細パネル 初回ロードのプログレス表示 — 設計書

> ブランチ/チケット番号が決まったらファイル名を `<TICKET>-ticket-detail-initial-load-progress-design.md` にリネームしてください。

## 0. 結論（サマリ）

**できます。** ただし単に「スピナーを出す」だけだと過去の再発バグ（BUG-02 チカチカ / BUG-03 更新ボタンで画面が隠れる）を踏むため、
**「初回ロード」と「再取得（ポーリング・他タブ同期）」を明確に分離する**のが設計の核心です。

| # | 対応 | 規模 |
|---|------|------|
| A | 初回ロードのクエリ群を1本のオーケストレータ `runInitialLoad()` に集約し、完了数/総数を進捗として持つ | 中 |
| B | パネル内に **プログレスオーバーレイ**（スピナー＋確定プログレスバー）を重ね、A の完了まで中身を隠す | 小 |
| C | 10秒ポーリング / `ticketSync` の再取得は **オーバーレイを絶対に出さない**（BUG-02/03 対策） | 小 |
| D | 表示ディレイ 120ms・最低表示 250ms でチカチカ防止、8秒フェイルセーフで固まらないようにする | 小 |
| E | データ確定後 1フレーム待って（double rAF）から隠し、「消えた瞬間にガタつく」のを防ぐ | 小 |

副作用として、**「子チケットが読み込まれる前にステータス変更ボタンを押せてしまい、親ステータス変更バリデーションが空配列で通ってしまう」既存の潜在バグも同時に塞がれます**（後述 3.6）。

---

## 1. 現状整理

### 1.1 チケットを開いたときに走るクエリ

すべて [TicketDetailPanel.tsx](../src/app/components/tickets/TicketDetailPanel.tsx) 内。
**互いに待ち合わせず、返ってきた順に state を更新**しています。

| # | 取得処理 | 場所 | 反映先（画面） | 初回ゲート対象 |
|---|---------|------|--------------|--------------|
| 1 | `reloadTicketFields()` → `sprint_tickets` 1件 | [L374-402](../src/app/components/tickets/TicketDetailPanel.tsx#L374-L402) | タイトル/ステータス/優先度/担当/説明/画像/工数… ほぼ全フィールド | ✅ |
| 2 | `loadCommentFiles()` → `ticket_comments` + `ticket_source_files` | [L358-366](../src/app/components/tickets/TicketDetailPanel.tsx#L358-L366) | **コメント欄・レビュー履歴・レビューステータス**・添付ファイル | ✅ |
| 3 | `loadChildTickets()` → `sprint_tickets`(parent_id) | [L339-356](../src/app/components/tickets/TicketDetailPanel.tsx#L339-L356) | **子チケット一覧**・件数バッジ・削除確認文言・親ステータス変更バリデーション | ✅ |
| 4 | `projects.name` | [L558](../src/app/components/tickets/TicketDetailPanel.tsx#L558) | パンくず（プロジェクト名） | ✅ |
| 5 | `sprints.name / identifier` | [L562](../src/app/components/tickets/TicketDetailPanel.tsx#L562) | パンくず（スプリント名） | ✅ |
| 6 | 親チケット `sprint_tickets`(parentId) | [L570](../src/app/components/tickets/TicketDetailPanel.tsx#L570) | 親パンくず・左の「親チケットに戻る」ストリップ・Esc の戻り先 | ✅（`parentId` あり時のみ） |
| 7 | `refreshCategories()` → `ticket_categories` | [L316-320](../src/app/components/tickets/TicketDetailPanel.tsx#L316-L320) / effect [L604](../src/app/components/tickets/TicketDetailPanel.tsx#L604-L607) | カテゴリーチップの表示名 | ✅（`categories` 未取得時のみ） |
| 8 | `profiles`（メンバー/レビュアー候補/admin） | [L620-638](../src/app/components/tickets/TicketDetailPanel.tsx#L620-L638) | 担当者・レビュアーのドロップダウン中身（開いたときだけ） | ❌ |
| 9 | `fetchSkills(userOrgId)` | [L1136-1139](../src/app/components/tickets/TicketDetailPanel.tsx#L1136-L1139) | 自動アサインモーダルの中身のみ | ❌ |
| 10 | `useLinkSuggestions(projectId)` | [L221-229](../src/app/components/tickets/TicketDetailPanel.tsx#L221-L229) | RichEditor のメンション候補（`$`/`#`/`%`/`@` 入力時のみ）。本文のメンションチップは保存済み HTML から描画されるので**レイアウトには影響しない** | ❌ |

> 8/9/10 をゲートに含めない理由: いずれも**初期表示のレイアウトを動かさない**（ユーザー操作で開くドロップダウン／モーダル／サジェストの中身）。特に 10 は多テーブルを叩く重いフェッチなので、含めると表示開始が無駄に遅くなります。

### 1.2 なぜ「後から反映される」ように見えるのか

1. リセット effect [L502-587](../src/app/components/tickets/TicketDetailPanel.tsx#L502-L587) が `setChildTickets([])` / `setComments([])` / `setSourceFiles([])` で**いったん空にする**
2. パネルは 0.28s のスライドインで即座に描画される
3. 1〜7 のクエリが 100〜800ms かけて**バラバラに**返り、そのたびに再レンダー

→ 「開く → 空のセクションが並ぶ → 子チケットが差し込まれて下がる → コメントが差し込まれてさらに下がる → レビュー履歴が展開されて下がる」
という**段階的なレイアウトシフト**が起きる。スクロール中や操作中だと位置が飛ぶので体験が悪い。

### 1.3 既に読み込み中を隠す仕組みは無い

- パネルには初回ロード用の `loading` state が**一切ない**（`isWithdrawLoading` / `isMoveLoading` は操作用）
- 共通スピナーは [PageLoader.tsx](../src/app/components/shared/PageLoader.tsx) に `PageLoader` / `BtnSpinner` がある。
  `pageloader-spin` の keyframes もここで定義済み → **これを流用する**（新規 CSS 追加不要）

---

## 2. 要件

| ID | 要件 |
|----|------|
| R1 | チケット詳細を開いた直後、必要データが揃うまでプログレスを表示し、中身のレイアウトシフトを見せない |
| R2 | 揃った時点で一括表示。以降の**定期ポーリング・他タブ同期ではプログレスを出さない**（BUG-02/BUG-03） |
| R3 | 十分に速いときは**プログレスを出さない**（一瞬の点滅は逆に体験が悪い） |
| R4 | クエリが失敗・極端に遅い場合でもパネルが永久に隠れない（フェイルセーフ） |
| R5 | プログレス表示中も **Esc とパネルを閉じる操作は効く**（ユーザーを閉じ込めない） |
| R6 | 子チケット ↔ 親チケット間のパネル遷移（`onSelectTicket` / 親に戻る）でも同じ挙動 |
| R7 | Supabase 無効（モックモード）では実質的に非同期が無いので**プログレスは出ない** |

---

## 3. 設計

### 3.1 全体像

```
ticket?.id 変更
  │
  ├─ [effect A] ローカル state リセット（既存 L502-551 のまま。deps を ticket?.id だけに絞る）
  │
  └─ [effect B] runInitialLoad(ticket)          ← 新規オーケストレータ
        │  jobs = [fields, commentFiles, children, projName, sprintName, (parent), (categories)]
        │  setLoadProgress({done: 0, total: jobs.length})
        │  runIdRef を ++（古い実行の結果は破棄）
        │
        ├─ 120ms 経過してもまだ終わってなければ  → オーバーレイ表示
        ├─ 各 job 完了ごとに done++            → プログレスバーが伸びる
        ├─ Promise.allSettled 完了
        ├─ double rAF（DOM が実際にペイントされるのを待つ）
        └─ 最低表示 250ms を満たしてから オーバーレイ解除
              （8秒経過したら中断してオーバーレイ解除＝フェイルセーフ）
```

### 3.2 新規 state / ref

```ts
// 初回ロード進捗。再取得（ポーリング/ticketSync）では絶対に触らない（BUG-02/03 対策）
const [loadDone, setLoadDone] = useState(0);
const [loadTotal, setLoadTotal] = useState(0);
const [showLoadOverlay, setShowLoadOverlay] = useState(false);
// 遅れて返ってきた古い実行が新しい表示を壊さないためのガード（useLinkSuggestions の runIdRef と同じ手法）
const loadRunIdRef = useRef(0);
const overlayShownAtRef = useRef(0);
const graceTimerRef = useRef<ReturnType<typeof setTimeout>>();
const failsafeTimerRef = useRef<ReturnType<typeof setTimeout>>();
```

定数（ファイル冒頭に置く）:

```ts
const INITIAL_LOAD_GRACE_MS   = 120;   // これ以内に終わればオーバーレイを出さない（R3）
const INITIAL_LOAD_MIN_MS     = 250;   // 出したら最低これだけ見せる（点滅防止）
const INITIAL_LOAD_TIMEOUT_MS = 8000;  // フェイルセーフ（R4）
```

### 3.3 オーケストレータ `runInitialLoad`

```ts
const runInitialLoad = useCallback(async (t: SprintTicket) => {
  const runId = ++loadRunIdRef.current;

  // 走らせる job を先に確定させてから total を決める（進捗が total 未確定で進むのを防ぐ）
  const jobs: Array<() => Promise<unknown>> = [];
  if (t.id && isSupabaseEnabled) {
    jobs.push(() => reloadTicketFields(t.id));      // ← Promise を返すよう修正が必要（3.4）
    jobs.push(() => loadCommentFiles(t.id));
    jobs.push(() => loadChildTickets(t.id));
    if (projectId) jobs.push(() => loadBreadcrumbProject(projectId));
    if (sprintId)  jobs.push(() => loadBreadcrumbSprint(sprintId));
    if (t.parentId) jobs.push(() => loadBreadcrumbParent(t.parentId!));
    if (projectId && categories.length === 0) jobs.push(() => refreshCategories());
  }

  if (jobs.length === 0) {  // モックモード / stub チケット（R7）
    finishInitialLoad(runId);
    return;
  }

  setLoadDone(0);
  setLoadTotal(jobs.length);

  clearTimeout(graceTimerRef.current);
  graceTimerRef.current = setTimeout(() => {
    if (runId !== loadRunIdRef.current) return;
    overlayShownAtRef.current = performance.now();
    setShowLoadOverlay(true);
  }, INITIAL_LOAD_GRACE_MS);

  clearTimeout(failsafeTimerRef.current);
  failsafeTimerRef.current = setTimeout(() => {
    if (runId !== loadRunIdRef.current) return;
    console.warn("[TicketDetailPanel] 初回ロードがタイムアウトしました");
    forceHideOverlay();                       // 届いたデータで表示を続行（R4）
  }, INITIAL_LOAD_TIMEOUT_MS);

  await Promise.allSettled(jobs.map(run => run().finally(() => {
    if (runId === loadRunIdRef.current) setLoadDone(d => d + 1);
  })));

  if (runId !== loadRunIdRef.current) return;   // 別チケットに切り替わっていたら破棄
  finishInitialLoad(runId);
}, [projectId, sprintId, categories.length, reloadTicketFields, loadCommentFiles, loadChildTickets, refreshCategories]);
```

`finishInitialLoad`（R5 の E: ペイント待ち＋最低表示時間）:

```ts
const finishInitialLoad = useCallback((runId: number) => {
  clearTimeout(graceTimerRef.current);
  clearTimeout(failsafeTimerRef.current);
  // state 反映後の実描画を1フレーム待つ。ここを待たないとオーバーレイが消えた直後に
  // 高さが確定してガタッと動く（レイアウトシフトが見えてしまう）。
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (runId !== loadRunIdRef.current) return;
    const shownFor = overlayShownAtRef.current ? performance.now() - overlayShownAtRef.current : Infinity;
    const wait = Math.max(0, INITIAL_LOAD_MIN_MS - shownFor);
    if (wait === 0) { setShowLoadOverlay(false); overlayShownAtRef.current = 0; return; }
    setTimeout(() => {
      if (runId !== loadRunIdRef.current) return;
      setShowLoadOverlay(false); overlayShownAtRef.current = 0;
    }, wait);
  }));
}, []);
```

> `performance.now()` を使うのは、`Date.now()` よりも単調増加で安全なため。既存コードは `Date.now()` を多用しているので合わせても構いません。

### 3.4 既存コードへの必要な修正

| 対象 | 修正内容 | 理由 |
|------|---------|------|
| [`reloadTicketFields` L374](../src/app/components/tickets/TicketDetailPanel.tsx#L374-L402) | `supabase!...then(...)` の前に `return` を付け、`Promise<void>` を返す | 完了を待てないと進捗が数えられない |
| [パンくず取得 L556-584](../src/app/components/tickets/TicketDetailPanel.tsx#L556-L584) | インライン記述を `loadBreadcrumbProject / loadBreadcrumbSprint / loadBreadcrumbParent` の `useCallback` に切り出す | job として `Promise` を返す必要がある。モック分岐（L573-584）は同期なのでそのまま各関数内に内包 |
| [リセット effect L502-587](../src/app/components/tickets/TicketDetailPanel.tsx#L502-L587) | **2つに分割**する。<br>① リセット専用（deps: `ticket?.id` のみ）<br>② `runInitialLoad(ticket)` 呼び出し（deps: `ticket?.id, projectId, sprintId`） | 現状 `projectId` が遅れて確定するページでは effect 全体が再実行され、**コメント/子チケットがもう一度空に戻る**（二重フラッシュ）。分割すればリセットは1回だけになる |
| [カテゴリー effect L604-607](../src/app/components/tickets/TicketDetailPanel.tsx#L604-L607) | 削除（`runInitialLoad` 内の job に統合） | 二重フェッチ防止。`projectId` 変化時は分割後の effect ② が再実行されるのでカバーできる |
| [`loadRelated` L368-370](../src/app/components/tickets/TicketDetailPanel.tsx#L368-L370) | 削除可（`runInitialLoad` が個別に job 登録するため） | 進捗を「コメント」「子チケット」で別々に数えたい |

**触ってはいけない箇所（重要）**

- 10秒ポーリング [L642-646](../src/app/components/tickets/TicketDetailPanel.tsx#L642-L646) → `loadCommentFiles` を直接呼ぶまま。オーケストレータを通さない
- `ticketSync` 購読 [L593-602](../src/app/components/tickets/TicketDetailPanel.tsx#L593-L602) → 同上
- `onUpdated` 起因のページ側リフレッシュ → 同上

この3つが `runInitialLoad` を呼ばないことが **BUG-02 / BUG-03 の再発防止**そのものです。

### 3.5 オーバーレイ UI

**配置**: パネル本体 div [L1846](../src/app/components/tickets/TicketDetailPanel.tsx#L1846)（`position: fixed` / `overflow: hidden`）の**直下の子**として `position: absolute; inset: 0`。
親が `overflow: hidden` なのでスライドインアニメーションに完全に追従します。

**ヘッダーごと覆う**（＝パネル内部の全面）ことを推奨します。理由:

- ヘッダーの `title` / `status` / prefix チップも `reloadTicketFields` で上書きされるため、覆わないと**ヘッダーだけ後から書き換わる**
- ヘッダーにあるステータス変更ボタンを**子チケット未読込のまま押せてしまう**問題（3.6）を同時に塞げる

ただし R5 のため、オーバーレイ自身に閉じるボタンを持たせ、Esc も従来どおり効かせます（`escStack` は [L462-465](../src/app/components/tickets/TicketDetailPanel.tsx#L462-L465) で mount 時に登録済みなので**追加実装不要**）。

```
┌───────────────────────────────────────────────┐
│                                          [✕]  │  ← stableEscHandler と同じ挙動
│                                               │
│                                               │
│                    ◠  (spinner)               │  ← PageLoader と同じ 34px リング
│                                               │
│               BRU9-042                        │  ← ticket.wbs（prop から即出せる）
│          子チケットの保留・取下げ機能追加        │  ← ticket.title
│                                               │
│              読み込み中... (4/6)               │
│          ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░               │  ← 幅 200px / 高さ 3px / 0.2s ease
│                                               │
└───────────────────────────────────────────────┘
  背景 #FAFAF8（パネル背景と同色・不透明）
```

- 背景は不透明 `#FAFAF8`（パネル本体と同色）。半透明にすると裏の空セクションが透けて意味が薄れる
- プログレスバーは **確定（determinate）**: `width: ${loadTotal ? (loadDone / loadTotal) * 100 : 0}%`、色は既存アクセントの `#059669`
- ラベルは `読み込み中... (4/6)` 形式。数字を出さない案でも良いが、「進んでいる」ことが伝わる方が体感待ち時間が短い
- スタイルは**インラインスタイル**（[feedback](../../.claude/projects/c--dev-Devticketmanagement/memory/feedback.md) の方針）。`pageloader-spin` keyframes は `PageLoader` 側に既にあるので再定義しない
- フェードアウト（`opacity` 0.18s）を付けると解除が滑らか。`showLoadOverlay` を即 false にするのではなく `opacity` トランジション後に unmount する形でも良いが、複雑になるので**初版は即 unmount で十分**

**コンポーネント化**: 3713行のファイルをこれ以上膨らませないため、
`src/app/components/tickets/TicketDetailLoadingOverlay.tsx` として切り出す（props: `wbs`, `title`, `done`, `total`, `onClose`）。

### 3.6 副次的に解消される既存の潜在バグ

[L869](../src/app/components/tickets/TicketDetailPanel.tsx#L869) / [L1310](../src/app/components/tickets/TicketDetailPanel.tsx#L1310) の
`validateParentStatusChange(next, childTickets)` は、**子チケットが読み込まれる前は `childTickets` が空配列**です。
つまり開いた直後の数百ミリ秒はバリデーションが常に通ってしまい、「子チケットが未完了なのに親を完了にできる」抜け道になっています。
オーバーレイでヘッダーごと覆えばこの窓が閉じます（＝ボタンが押せる時点で子チケットは必ずロード済み）。

---

## 4. 状態遷移

| 状況 | grace(120ms) 内に完了 | オーバーレイ | 備考 |
|------|--------------------|------------|------|
| モックモード（Supabase 無効） | job 0件 → 即完了 | **出ない** | R7 |
| 高速回線・キャッシュ温 | Yes | **出ない** | R3。無駄な点滅なし |
| 通常（200〜800ms） | No | 出る → 最低250ms → 消える | R1 |
| 一部クエリ失敗 | — | `allSettled` なので他の完了で消える | 失敗分は空表示のまま（現状と同じ） |
| 極端に遅い/ハング | — | 8秒で強制解除 | R4 |
| 別チケットへ即切替 | — | `runIdRef` で古い実行を破棄、オーバーレイは出しっぱなしのまま新実行に引き継ぎ | R6。連続クリックでも点滅しない |
| 閉じる（Esc / ✕） | — | パネルごと slideOut | R5 |
| 10秒ポーリング / 他タブ同期 | — | **絶対に出ない** | R2 / BUG-02・03 |

---

## 5. 検討した代替案と却下理由

| 案 | 内容 | 判断 |
|----|------|------|
| **スケルトン UI** | 子チケット・コメント各セクションに灰色プレースホルダを出す | ❌ 却下。3713行のファイル内の各セクションに条件分岐を撒く必要があり差分が大きい。ヘッダーのフィールド書き換えやステータスボタンの早期押下（3.6）も防げない。ただし「体感が最速」なのは事実なので、将来の改善案として残す |
| **React Suspense + use()** | データ取得を Suspense 境界に寄せる | ❌ 却下。全画面が `useEffect` + `useState` の取得パターンで統一されており、ここだけデータ取得基盤を変えるのは影響範囲が読めない |
| **ボディだけ覆う** | ヘッダーは見せて `overflowY: auto` のボディ [L2347](../src/app/components/tickets/TicketDetailPanel.tsx#L2347) だけ覆う | △ 保留（設計判断ポイント）。ヘッダーの WBS/タイトルが即見えるので体感は良いが、3.6 のボタン早期押下は塞げず、ヘッダー内フィールドの後追い書き換えも残る |
| **不確定バー（indeterminate）のみ** | 総数を数えず流れるバーだけ出す | △ 実装は最小だが、「プログレスを表示してほしい」という要望に対しては確定バーの方が意図に合う |
| **ページ側で先読みしてから開く** | 一覧ページ側で子チケット/コメントを先に取得してから panel を開く | ❌ 却下。パネルを使う6ページ（Dashboard / MyActions / Reports / ReleaseNotes / Sprint / SprintDetail）すべてに同じ実装が必要になり、重複が増える |

---

## 6. 実装ステップ（PR 分割案）

1. **リファクタのみ（挙動不変）**
   - `reloadTicketFields` を `Promise` 返却に
   - パンくず3クエリを `useCallback` に切り出し
   - リセット effect を「リセット」と「ロード」に分割、カテゴリー effect をロード側へ統合
   - この時点で `npx vite build` が通ることを確認（repo 全体の `tsc` は元から通らない ＝ [build-verification](../../.claude/projects/c--dev-Devticketmanagement/memory/build-verification.md)）
2. **オーケストレータ導入**
   - `runInitialLoad` / `finishInitialLoad` / 進捗 state / runId ガード / 各タイマー
   - まだ UI は出さず、`console.log` で進捗と所要時間を確認
3. **オーバーレイ UI**
   - `TicketDetailLoadingOverlay.tsx` 新規作成 → パネル本体 div 直下にマウント
4. **微調整**
   - grace / min / timeout の実測に基づくチューニング
   - 必要ならフェードアウト追加

---

## 7. 影響範囲

**変更ファイル**

- `src/app/components/tickets/TicketDetailPanel.tsx`（改修）
- `src/app/components/tickets/TicketDetailLoadingOverlay.tsx`（新規）

**呼び出し側の変更は不要**（props 追加なし）。パネルを使う以下6ページはそのまま:
[Dashboard.tsx:817](../src/app/pages/Dashboard.tsx#L817) /
[MyActionsPage.tsx:1587,1607](../src/app/pages/MyActionsPage.tsx#L1587) /
[ReportsPage.tsx:788](../src/app/pages/ReportsPage.tsx#L788) /
[ReleaseNotesPage.tsx:363](../src/app/pages/ReleaseNotesPage.tsx#L363) /
[SprintPage.tsx:407](../src/app/pages/SprintPage.tsx#L407) /
[SprintDetailPage.tsx:821](../src/app/pages/SprintDetailPage.tsx#L821)

**DB マイグレーション・型変更なし。**

---

## 8. 既知バグチェックリストとの照合

| ID | 内容 | 本設計での扱い |
|----|------|--------------|
| BUG-01 | 順番がコロコロ変わる | 新規クエリは追加しない。既存の `loadChildTickets` は `wbs` 枝番の数値ソート済み [L346-353](../src/app/components/tickets/TicketDetailPanel.tsx#L346-L353)、コメント/ファイルは `.order("created_at")` 済み。**変更なし** |
| BUG-02 | 定期リフレッシュでチカチカ | **最重要。** 10秒ポーリング・`ticketSync` はオーケストレータを通さない ＝ `showLoadOverlay` に触らない。`loadRunIdRef` は「初回ロードの世代」専用 |
| BUG-03 | 更新ボタンが画面を隠す | 手動更新系（`onUpdated`）もオーケストレータを通さないので同様に安全 |
| BUG-04 | 子チケット表示が遅れる | 本件そのもの。**待ってから一括表示**に変更して解消 |

---

## 9. 検証項目

- [ ] 一覧 → チケット詳細を開く: プログレスが出て、消えた瞬間に子チケット・コメント・レビュー履歴がすべて揃っている（あとから増えない）
- [ ] 子チケットを持つ親チケット / 子チケット / 子なしチケット の3パターン
- [ ] 子チケット → 親に戻る（peek strip・Esc）でもプログレスが正しく出る／二重に点滅しない
- [ ] チケットを連続で素早く切り替えて、古い結果が新しいパネルに混ざらない
- [ ] **10秒ポーリングでオーバーレイが出ない**（開いたまま30秒放置して確認）
- [ ] 別タブで同じチケットを更新 → `ticketSync` 反映時にオーバーレイが出ない
- [ ] コメント投稿・ステータス変更・保留/取下 の直後にオーバーレイが出ない
- [ ] 高速回線でプログレスが点滅しない（出ないか、出ても250ms以上留まる）
- [ ] DevTools の Network を Slow 3G にして 8秒フェイルセーフが働く
- [ ] プログレス表示中に Esc / ✕ で閉じられる
- [ ] ステータス変更ボタンがプログレス中は押せない（3.6）
- [ ] Supabase 無効（モック）モードでプログレスが出ない
- [ ] `npx vite build` が通る

---

## 10. 設計判断ポイント（実装前に確認したい）

1. **オーバーレイの範囲**: パネル全面（推奨・3.5）か、ヘッダーを残してボディのみか
2. **プログレスの表記**: `読み込み中... (4/6)` のように件数を出すか、文言だけにするか
3. **確定バー**か、不確定（流れる）バーか — 推奨は確定バー
