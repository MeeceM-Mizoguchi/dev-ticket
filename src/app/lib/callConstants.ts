// ENHA2-029 オンライン音声会話 — 共通定数・型。
// WebRTC(音声のみ) + Supabase Realtime Broadcast をシグナリングに使う。
// 有料のメディアサーバは使わず、1対1はP2P、グループ(最大5人)はP2Pフルメッシュ。

// ── WebRTC 設定 ──────────────────────────────────────────────
// まずは Google の無料 STUN のみ。将来 coturn を自前ホストしたら
// iceServers に turn: エントリを1つ足すだけで厳しいNATにも対応できる。
export const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    // { urls: "turn:turn.example.com:3478", username: "...", credential: "..." },
  ],
};

// マイク取得時の制約。エコー/ノイズ/自動ゲインを有効にしてハウリングを抑える。
export const audioConstraints: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
};

// メッシュの上限人数(自分を含む)。6人以上は音声メッシュの品質が落ちるため発信を禁止する。
export const MAX_PARTICIPANTS = 5;

// 着信の自動タイムアウト(ミリ秒)。着信側モーダルと発信側の呼び出しの両方で使う。
export const RING_TIMEOUT_MS = 45_000;

// ── チャンネル名 ─────────────────────────────────────────────
// 個人着信チャンネル: 全ログインユーザーが常時1本購読する「呼び鈴」。
export const userCallChannel = (userId: string) => `call-user:${userId}`;
// 通話セッションチャンネル: 参加者のみが購読。offer/answer/ICE と presence(roster)。
export const sessionChannel = (sessionId: string) => `call:${sessionId}`;
// オンライン在席用の共有プレゼンスチャンネル。
export const ONLINE_PRESENCE_CHANNEL = "presence:online";

// ── シグナリングのイベント名 ─────────────────────────────────
export const SIGNAL = {
  // 個人着信チャンネル宛
  invite: "signal-invite", // 着信
  cancel: "signal-cancel", // 発信者が応答前にキャンセル
  decline: "signal-decline", // 着信拒否(発信者へ通知)
  // セッションチャンネル宛(WebRTC交渉)
  offer: "signal-offer",
  answer: "signal-answer",
  ice: "signal-ice",
  mute: "signal-mute", // ミュート状態のUI同期
} as const;

// ── 型 ───────────────────────────────────────────────────────
export interface CallMember {
  id: string; // profiles.id (= auth user id)
  name: string;
}

// 着信ペイロード(invite)
export interface InvitePayload {
  sessionId: string;
  from: string; // 発信者 userId
  fromName: string;
  projectId: string;
  projectName: string;
  members: CallMember[]; // 発信者を含む全招待メンバー
}

// 通話中の各参加者のUI状態
export interface Participant {
  id: string;
  name: string;
  muted: boolean;
  speaking: boolean;
  connState: RTCPeerConnectionState | "self";
  stream?: MediaStream;
}

export type CallStatus = "outgoing" | "incoming" | "connecting" | "active";
