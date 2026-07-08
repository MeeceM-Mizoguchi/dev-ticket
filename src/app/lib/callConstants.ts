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

// ENHA2-030 画面共有: getDisplayMedia の制約。ブラウザ純正ピッカーが「画面全体/ウィンドウ/タブ」の
// 選択を担う。フレームレートは上り帯域を抑えるため控えめに。音声は取得しない(音声は既存メッシュで流す)。
export const displayMediaConstraints = {
  video: { frameRate: { ideal: 15, max: 30 } },
  audio: false,
};

// 画面共有が使える環境か(getDisplayMedia の有無で判定)。iPad等の WKWebView は非対応。
export const isScreenShareSupported = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

// アノテーション(視聴者の手書き/テキスト)は確定から5秒で消滅する。
export const ANNOTATION_TTL_MS = 5_000;
// ポインター送信のスロットル(ミリ秒)。共有者のマウス追従を間引いて Broadcast 負荷を抑える。
export const POINTER_THROTTLE_MS = 40;

// メッシュの上限人数(自分を含む)。6人以上は音声メッシュの品質が落ちるため発信を禁止する。
export const MAX_PARTICIPANTS = 5;

// 着信の自動タイムアウト(ミリ秒)。着信側モーダルと発信側の呼び出しの両方で使う。
export const RING_TIMEOUT_MS = 45_000;

// 通話中の一時的な切断(ICEの揺れ / Realtime ソケット再接続による roster の一瞬の空振り)を
// 本当の相手切断と誤判定しないための猶予(ミリ秒)。この間に復帰すれば通話は継続する。
export const RECONNECT_GRACE_MS = 6_000;

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
  bye: "signal-bye", // 通話確立後の切断(相手へ即時通知)
  // セッションチャンネル宛(WebRTC交渉)
  offer: "signal-offer",
  answer: "signal-answer",
  ice: "signal-ice",
  mute: "signal-mute", // ミュート状態のUI同期
  // ── ENHA2-030 画面共有(セッションチャンネル宛) ──
  screenStart: "signal-screen-start", // 共有開始の告知(映像PC確立前にステージを開く)
  screenStop: "signal-screen-stop", // 共有停止
  screenOffer: "signal-screen-offer", // 画面映像PCの offer(to 指定・共有者→視聴者)
  screenAnswer: "signal-screen-answer", // 画面映像PCの answer(to 指定)
  screenIce: "signal-screen-ice", // 画面映像PCの ICE(to 指定)
  pointer: "signal-pointer", // ポインター位置(共有者のみ送信)
  annotate: "signal-annotate", // アノテーション(視聴者のみ送信)
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

// ── ENHA2-030 画面共有の型 ───────────────────────────────────
// ポインター(共有者のみ)。座標は共有映像フレーム基準の正規化値[0,1]。
export interface PointerState {
  nx: number;
  ny: number;
  name: string; // 共有者名(ラベル表示用)
}

// アノテーション(視聴者のみ)。座標はすべて正規化値[0,1]。
export interface StrokeAnnotation {
  id: string;
  from: string;
  fromName: string;
  kind: "stroke";
  color: string;
  points: { nx: number; ny: number }[];
  at: number; // 最終更新時刻(TTL起点)
}
export interface TextAnnotation {
  id: string;
  from: string;
  fromName: string;
  kind: "text";
  color: string;
  nx: number;
  ny: number;
  text: string;
  at: number;
}
export type Annotation = StrokeAnnotation | TextAnnotation;
// UI から送るときの入力(from/fromName/at はコンテキスト側で付与)。
export type AnnotationInput =
  | Pick<StrokeAnnotation, "id" | "kind" | "color" | "points">
  | Pick<TextAnnotation, "id" | "kind" | "color" | "nx" | "ny" | "text">;

// 画面共有の状態。共有中のみ非null。共有者/視聴者どちらの端末でも同じ形。
export interface ScreenShareState {
  presenterId: string;
  presenterName: string;
  isSelf: boolean; // 自分が共有者か
  stream?: MediaStream; // 自己プレビュー(共有者) or 受信映像(視聴者)
  pointer: PointerState | null;
  annotations: Annotation[];
}
