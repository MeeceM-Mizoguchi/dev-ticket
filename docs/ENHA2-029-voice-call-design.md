# ENHA2-029 オンライン音声会話 — 設計書

## 0. 概要 / 結論

軽く話したい時に使えるブラウザ内音声通話機能。**有料の音声サービスは一切使わず**、ブラウザ標準の **WebRTC**（音声メディア）と、既存の **Supabase Realtime Broadcast**（シグナリング）だけで実装する。

- **1対1通話**: WebRTC P2P（直接接続）
- **グループ通話（最大4〜5人）**: 音声のみの **P2Pフルメッシュ**。音声は1ストリーム約40kbpsと軽量なため、5人（各自4本接続）でも端末負荷・帯域とも実用範囲。SFU等のメディアサーバは不要。
- **NAT越え**: 開始時は Google 無料 STUN のみ。TURN は将来 coturn を自前ホストして差し込める構成にしておく（設定配列に足すだけ）。
- **範囲**: 同一プロジェクトにアサインされたメンバー間のみ発信可能。
- **起点**: Topbar（共通ヘッダー）の通話アイコン → プロジェクト選択 → PJメンバーをプルダウン選択 → Call → 相手のWEB画面に着信。

### なぜこの構成で無料になるか
既存ホワイトボード（`SupabaseYjsProvider`）が、Broadcast 上で `y-update` / `y-sync-req` / `y-awareness` を送り合ってP2P同期している。これは WebRTC の `offer` / `answer` / `ice-candidate` を送り合うシグナリングと構造がほぼ同一。**既存パターンをそのまま転用**できる。メディア（音声）はブラウザ↔ブラウザで直接流れ、サーバを経由しない。

---

## 1. 全体アーキテクチャ

```
┌─────────────┐   ①INVITE（着信）        ┌─────────────┐
│  発信者 A    │ ───────────────────────▶ │  着信者 B    │
│             │   Supabase Broadcast     │             │
│  RTCPeer    │   call-user:{B}          │  RTCPeer    │
│  Connection │                          │  Connection │
│             │   ②offer/answer/ICE      │             │
│             │ ◀──────────────────────▶ │             │
│             │   Supabase Broadcast      │             │
│             │   call:{sessionId}        │             │
│             │                          │             │
│  🎤 マイク   │ ══════ ③音声メディア ═════▶│  🔊 スピーカー│
│             │   WebRTC P2P（直接・STUN） │             │
└─────────────┘                          └─────────────┘
        （音声データはSupabaseを通らない＝サーバ負荷ゼロ）
```

シグナリング（=接続の交渉メッセージ）だけ Supabase Broadcast を通り、確立後の音声そのものはピア間を直接流れる。

### チャンネル2層構造

| チャンネル | 命名 | 購読タイミング | 用途 |
|---|---|---|---|
| **個人着信チャンネル** | `call-user:{userId}` | ログイン後、常時購読（アプリ起動中ずっと） | 着信(INVITE)・キャンセルの受信。いわば「呼び鈴」 |
| **通話セッションチャンネル** | `call:{sessionId}` | 通話開始/参加時のみ購読、終了で解除 | offer/answer/ICE候補、ミュート状態、参加/退出の交換 |

- `sessionId` は発信時に発信者が採番（`crypto.randomUUID()`）。
- 個人着信チャンネルは全ログインユーザーが1本ずつ張る。ここで着信を待ち受ける。

---

## 2. 発信〜着信〜通話のフロー（1対1）

```
A（発信者）                                        B（着信者）
  │                                                 │ ← 常時 call-user:{B} を購読
  │ 1. 通話アイコン→PJ選択→Bを選択→Call             │
  │ 2. sessionId採番, call:{sessionId} を購読        │
  │ 3. getUserMedia()でマイク取得（許可ダイアログ）    │
  │ 4. INVITE送信 ─────────────────────────────────▶│ 5. 着信モーダル表示（発信者名/PJ名）
  │    {type:'invite', sessionId, from, projectId,   │    ＋着信音
  │     members:[A,B]}  → call-user:{B} 宛           │
  │                                                  │
  │ (呼び出し中UI表示・タイムアウト30s)                │ 6a. 「応答」→ call:{sessionId}購読,
  │                                                  │      getUserMedia()でマイク取得
  │                                                  │ 6b. 「拒否」→ DECLINE送信して終了
  │                                                  │
  │ 7. B購読を検知(presence) → RTCPeerConnection生成  │ 7. 同上
  │    （userIdが小さい方がofferを作る＝glare回避）    │
  │ 8. offer ──────── call:{sessionId} ────────────▶ │
  │ 9. ◀──────────── answer ─────────────────────── │
  │ 10.⇄  ICE candidate 相互交換 ⇄                   │
  │ 11. 接続確立 → 🎤═══ 音声 ═══🔊 双方向            │
  │                                                  │
  │ 12. どちらかが「切る」→ BYE送信, PC/チャンネル破棄 │
```

### 着信を成立させる要点
- Bは通話に参加していなくても `call-user:{B}` を**常時購読**しているので、どの画面にいても着信モーダルを出せる（Topbar直下にグローバルなリスナーを常駐）。
- Bが**オフライン/未ログイン**なら購読が無い＝着信不可。プルダウンで**プレゼンス（オンライン表示）**を出し、オフラインの相手は「オフライン」とグレー表示して誤発信を防ぐ（§7）。

### シグナリングのメッセージ種別

Broadcast の event 名（既存 `y-*` に倣った命名）。ペイロードには送信元識別のため `from`（userId）を必ず含める。

| event | 送信先チャンネル | payload | 意味 |
|---|---|---|---|
| `signal-invite` | `call-user:{相手}` | `{sessionId, from, fromName, projectId, projectName, members[]}` | 着信 |
| `signal-cancel` | `call-user:{相手}` | `{sessionId, from}` | 応答前に発信者がキャンセル |
| `signal-decline` | `call-user:{発信者}` | `{sessionId, from}` | 着信拒否 |
| `signal-offer` | `call:{sessionId}` | `{from, to, sdp}` | WebRTC offer |
| `signal-answer` | `call:{sessionId}` | `{from, to, sdp}` | WebRTC answer |
| `signal-ice` | `call:{sessionId}` | `{from, to, candidate}` | ICE候補 |
| `signal-join` | `call:{sessionId}` | `{from, fromName}` | セッション参加通知（グループ用） |
| `signal-leave` | `call:{sessionId}` | `{from}` | 退出 |
| `signal-mute` | `call:{sessionId}` | `{from, muted}` | ミュート状態同期（UI表示用） |

`to` を入れることで、メッシュ内で「誰宛のoffer/ICEか」を判別する（自分宛以外は無視）。

---

## 3. グループ通話（フルメッシュ）

最大4〜5人。各参加者が他の全員と1本ずつ `RTCPeerConnection` を張る（5人なら各自4本）。

### 参加者の増減
- **セッション作成**: 発信者が複数メンバーを選んでCall → 各対象に `signal-invite` を一斉送信。
- **新規参加**: あるメンバーが `call:{sessionId}` を購読したら `signal-join` を送る。既存メンバー全員がそれを受けて、その新参者へ `RTCPeerConnection` を生成。
- **glare（同時offer）回避**: 2者間で「**userIdが小さい方が offer を作る**」と決めておく。これで両側同時に offer を投げる衝突を防ぐ（perfect negotiation の簡易版）。
- **退出**: `signal-leave` 受信 or presence 消失で、その相手への PC を close。残り1人になったら自動終了。

### メッシュの接続本数
| 人数 | 各自のPC本数 | セッション総接続数 |
|---|---|---|
| 2 | 1 | 1 |
| 3 | 2 | 3 |
| 4 | 3 | 6 |
| 5 | 4 | 10 |

音声のみなら5人（各自4本・上り約160kbps）でも問題ない。**6人以上はUIで発信不可**にしてメッシュ破綻を防ぐ（上限をコードで固定）。将来10人超が必要になったら SFU（mediasoup / LiveKit OSS を自前VPSにホスト）へ移行 ── その場合もシグナリング層とUIは流用可能。

---

## 4. モジュール / ファイル構成

既存のホワイトボード実装（`lib/` にコアクラス、`hooks/` に統合フック、`components/` にUI）の分け方に倣う。

```
src/app/
├─ lib/
│   ├─ CallSignaling.ts        # Broadcast購読・signal-*送受信の抽象（SupabaseYjsProvider相当）
│   └─ MeshConnection.ts       # RTCPeerConnection群の管理（offer/answer/ICE/glare/mute/mesh）
├─ hooks/
│   ├─ useIncomingCall.ts      # call-user:{me} を常時購読し着信状態を返す（アプリ全体で1つ）
│   └─ useCall.ts              # 通話セッションのライフサイクル統合（参加/退出/ミュート/参加者一覧）
├─ contexts/
│   └─ CallContext.tsx         # 現在の通話状態をアプリ全体に供給（発信中/着信中/通話中）
├─ components/call/
│   ├─ CallButton.tsx          # Topbarの通話アイコン（発信ダイアログ起動）
│   ├─ StartCallDialog.tsx     # PJ選択→メンバー取得→プルダウン→Call
│   ├─ IncomingCallModal.tsx   # 着信モーダル（応答/拒否）＋着信音
│   ├─ CallWidget.tsx          # 通話中フローティングUI（参加者・ミュート・退出）
│   └─ ringtone.ts             # 着信音（WebAudioでビープ生成 or 同梱mp3）
└─ lib/callService.ts          # DB CRUD（通話履歴の記録）
```

- `CallContext` を `ProtectedShell`（または `AppShell`）直下に置き、その配下で `useIncomingCall` を1回だけ起動 → どのページでも着信を受けられる。
- `CallWidget` は `AppShell` のルート直下に `position: fixed` でオーバーレイ（ページ遷移しても通話継続）。ホワイトボードの overlay レイヤーと同じ考え方。

### CallSignaling.ts（骨子）
```ts
// SupabaseYjsProvider と同じく channel を1本開き、event毎にハンドラを張る
class CallSignaling {
  constructor(client, sessionId, selfId) {
    this.channel = client.channel(`call:${sessionId}`,
      { config: { broadcast: { self: false, ack: false } } });
  }
  on(event, handler) { this.channel.on('broadcast', { event }, ({payload}) => {
    if (payload.to && payload.to !== this.selfId) return;   // 自分宛以外は無視
    handler(payload);
  }); }
  send(event, payload) { this.channel.send({ type:'broadcast', event,
    payload: { ...payload, from: this.selfId } }); }
  destroy() { this.channel.unsubscribe(); }
}
```

### WebRTC 設定（STUNのみ・TURN差し込み口）
```ts
const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    // 将来 coturn を立てたらここに追記するだけ:
    // { urls:'turn:turn.example.com:3478', username:'...', credential:'...' },
  ],
};
```

---

## 5. UI 仕様

### 5-1. 発信（StartCallDialog）
1. Topbarの通話アイコン(`CallButton`)クリックでダイアログを開く。
2. **プロジェクト選択**: 自分がアサインされているPJの一覧をプルダウン表示（`useAuth().userId` で絞り込み）。
3. **メンバー取得**: 選択したPJの `members` を取得し、自分を除いた一覧をプルダウン（複数選択可）に反映。各メンバーに**オンライン状態のドット**（緑=オンライン/灰=オフライン）を表示。
4. **Call ボタン**: 選択メンバーへ `signal-invite` を一斉送信、発信中UIへ。

### 5-2. 着信（IncomingCallModal）
- 画面中央にモーダル: 「〇〇さんから着信（PJ名）」＋「応答」「拒否」。
- 着信音（`ringtone.ts`）ループ再生。30秒無応答で自動的にmissedとして閉じる。
- 通話中に別の着信 → 「通話中」表示で自動拒否 or 保留（初期は自動拒否でシンプルに）。

### 5-3. 通話中（CallWidget、フローティング）
- 画面隅に固定の小ウィジェット。表示: 参加者アバター一覧＋各人の発話中インジケータ（音量検知）／ミュートアイコン。
- 操作: 🎤ミュート切替、退出（赤い受話器）。
- ページ遷移しても継続（`CallContext` がグローバル保持）。

---

## 6. DB スキーマ（通話履歴）

通話の成立自体はBroadcast＋WebRTCで完結しDB不要だが、「誰といつ話したか」の履歴・着信ログ用に最小テーブルを1つ用意する。既存 `add_*.sql` の作法に合わせる。

```sql
-- supabase/add_voice_calls.sql
create table call_sessions (
  id           uuid primary key default gen_random_uuid(),
  project_id   text not null references projects(id) on delete cascade,
  initiator_id text not null,                 -- 発信者 profiles.id
  status       text not null default 'ringing', -- ringing | active | ended | missed
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);

create table call_participants (
  session_id uuid not null references call_sessions(id) on delete cascade,
  user_id    text not null,                   -- profiles.id
  joined_at  timestamptz,
  left_at    timestamptz,
  outcome    text default 'invited',          -- invited | joined | declined | missed
  primary key (session_id, user_id)
);

create index on call_sessions(project_id);
create index on call_participants(user_id);
```

- 発信時に `call_sessions`(ringing) と `call_participants`(invited) を作成。
- 応答/拒否/退出/終了でステータス更新（`callService.ts`）。
- 履歴UI（着信履歴・不在着信）は将来拡張。まずは記録だけでも入れておくと運用で効く。

---

## 7. 権限・プレゼンス

### 権限
- **発信可否**: 選択したPJに発信者・着信者が**両方アサインされている**こと（`projects.members` 照合）。サーバ側でも RPC or RLS で検証し、UIだけの制御にしない。
- 専用権限フラグ（`canUseVoiceCall` 等）を `roles.base_permissions` / `project_member_permissions` に足すかは要判断。初期は「PJメンバーなら誰でも可」でシンプルに開始し、必要なら後付け。

### プレゼンス（オンライン表示）
- 現状 Supabase Presence は未使用。今回**新規に採用**する。
- ログイン中の各ユーザーが `presence:org:{orgId}`（または `presence:project:{projectId}`）チャンネルに `track({ userId, name })` する。
- 発信ダイアログのメンバープルダウンで、この presence 情報からオンライン/オフラインを判定して表示。
- 実装コストが高ければ「個人着信チャンネル `call-user:{id}` の presence」で代替可能（着信を受けられる＝オンライン、という定義になり最も正確）。**こちらを推奨**。

---

## 8. Capacitor / iOS・macOS ネイティブ対応

Capacitor 8 の WKWebView 上で動かす際の注意点。

- **マイク権限**: `Info.plist` に `NSMicrophoneUsageDescription` を追加（未設定だと `getUserMedia` が即失敗）。
- **WebRTC の可用性**: WKWebView は WebRTC / `getUserMedia` をサポート済み（iOS 14.3+）。追加ネイティブプラグインは基本不要。ただし実機での許可ダイアログ挙動は要検証。
- **オーディオセッション**: 通話中に着信音や他アプリ音とバッティングしないよう、必要なら `AVAudioSession` のカテゴリ設定をネイティブ側で調整（`playAndRecord`）。
- **バックグラウンド**: アプリがバックグラウンドに回ると WebView が停止し通話が切れる可能性。初期は「フォアグラウンド前提」で割り切り、将来 CallKit 連携やバックグラウンド音声を検討（プッシュ着信 ENHA2-014 の設計と連動しうる）。
- **プッシュ着信**: アプリ未起動時の着信は Broadcast だけでは届かない。将来は APNs（ENHA2-014）で「着信プッシュ→起動→セッション参加」を繋ぐと完成度が上がる。初期スコープ外。

---

## 9. 実装フェーズ分割

| Phase | 内容 | 完了条件 |
|---|---|---|
| **1. シグナリング基盤** | `CallSignaling`、個人着信チャンネル `useIncomingCall`、`CallContext` | Aが送ったINVITEがBの画面にモーダルで出る |
| **2. 1対1通話** | `MeshConnection`(2者)、offer/answer/ICE、`CallWidget`、ミュート/退出 | 2人で音声が双方向に通る（同一/標準NAT） |
| **3. 発信UI** | `CallButton`＋`StartCallDialog`（PJ選択→メンバー取得→プルダウン→Call） | Topbarから実際に発信できる |
| **4. グループ通話** | メッシュ拡張、`signal-join/leave`、glare回避、上限5人 | 3〜5人で全員相互に聞こえる |
| **5. プレゼンス** | オンライン表示、オフライン誤発信防止 | プルダウンで在席が分かる |
| **6. 履歴＆権限** | `call_sessions`/`call_participants` 記録、PJメンバー検証(RLS/RPC) | 履歴が残る・部外者は発信不可 |
| **7. ネイティブ検証** | iOS/macOS実機でマイク許可・通話疎通 | Capacitorアプリで通話成立 |

Phase 1〜3で「1対1通話」がプロダクトとして成立する。ここを最初のマイルストーンにするのを推奨。

---

## 10. 既知の制約・リスク

- **STUNのみの限界**: 対称NAT/一部企業VPN環境では約1〜2割が接続失敗しうる。失敗時は「接続できませんでした」を明示し、将来 coturn 追加で解消（設定配列に足すだけの構造にしてある）。
- **メッシュ上限**: 6人以上は品質劣化。UIで5人に制限。超える要件が出たらSFU移行。
- **バックグラウンド切断**: モバイルでアプリを閉じると切れる（初期はフォアグラウンド前提）。
- **エコー/ハウリング**: `getUserMedia` の `echoCancellation: true, noiseSuppression: true, autoGainControl: true` を必ず有効化。
- **glare/再接続**: perfect negotiation の簡易版で対応。ネットワーク瞬断時の再ネゴシエーションは Phase 2 で `oniceconnectionstatechange` を監視して実装。
- **既存機能への影響**: ホワイトボードの `wb:` チャンネルとは別名前空間（`call:` / `call-user:`）なので干渉しない。

---

## 付録: 既存資産の転用対応表

| 音声通話で必要なもの | 転用元（既存実装） |
|---|---|
| Broadcastチャンネルのlifecycle | `SupabaseYjsProvider`（subscribe/unsubscribe/cleanup） |
| 送信元エコー抑止 | `senderId`判定（`payload.s === this.senderId`） |
| セッション統合フック | `useWhiteboardSync` の構成 |
| フローティングUIオーバーレイ | `WhiteboardCanvas` の overlay レイヤー群 |
| 認証・ユーザー識別 | `useAuth()`（userId/userName/組織/PJ権限） |
| PJメンバー取得 | `projects.members` / `project_member_permissions` |
| Topbar常駐アイコン | `Topbar.tsx`（通知ベルと同じ場所） |
| DBマイグレーション作法 | `supabase/add_*.sql` |
```
