// ENHA2-029 オンライン音声会話 — 状態オーケストレーション。
// 個人着信チャンネル(呼び鈴)・オンラインpresence・通話セッション(mesh)を統合し、
// 発信/着信/応答/拒否/退出/ミュートのアクションをアプリ全体に供給する。
import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { MeshConnection } from "@/app/lib/MeshConnection";
import { CallSignaling, type RosterMember } from "@/app/lib/CallSignaling";
import { ScreenSharePeers } from "@/app/lib/ScreenSharePeers";
import { CallTabCoordination } from "@/app/lib/callTabCoordination";
import { monitorSpeaking } from "@/app/lib/audioLevel";
import { startRingtone, stopRingtone, playHangupTone } from "@/app/lib/ringtone";
import { useToast } from "@/app/contexts/ToastContext";
import {
  SIGNAL, audioConstraints, displayMediaConstraints, isScreenShareSupported,
  userCallChannel, ONLINE_PRESENCE_CHANNEL,
  RING_TIMEOUT_MS, MAX_PARTICIPANTS, ANNOTATION_TTL_MS, POINTER_THROTTLE_MS, TAB_BUSY_QUERY_MS,
  PEER_RECONCILE_MS, JOIN_TIMEOUT_MS,
  type CallMember, type InvitePayload, type Participant, type CallStatus,
  type ScreenShareState, type Annotation, type AnnotationInput,
} from "@/app/lib/callConstants";
import {
  recordCallStart, recordParticipantsInvited, recordParticipantOutcome, recordParticipantLeft, recordCallEnded,
} from "@/app/lib/callService";

export interface CallState {
  sessionId: string;
  projectId: string;
  projectName: string;
  role: "caller" | "callee";
  status: CallStatus;
  muted: boolean;
  participants: Participant[];
  pending: CallMember[]; // 招待済みでまだ応答していない相手(呼び出し中)。通話中の追加招待も含む。
  startedAt?: number; // 通話が接続(active)した時刻。通話時間計測の起点(BRU5-057-4)。
}

interface CallCtxType {
  incoming: InvitePayload | null;
  call: CallState | null;
  online: Set<string>;
  error: string | null;
  screenShare: ScreenShareState | null;
  screenShareSupported: boolean;
  accepting: boolean;                 // 着信応答処理中(マイク取得待ち)。モーダルの二度押し/レース防止に使う。
  audioBlocked: boolean;              // ブラウザの自動再生ポリシーで相手音声がブロックされている(要ユーザー操作)。
  audioUnlockNonce: number;           // これが増えると全 RemoteAudio が play() を再試行する。
  reportAudioBlocked: () => void;     // RemoteAudio が play() 失敗を報告する。
  unlockAudio: () => void;            // バナークリック(ユーザー操作)で音声再生を解禁する。
  startCall: (project: { id: string; name: string }, targets: CallMember[]) => Promise<void>;
  inviteToCall: (targets: CallMember[]) => void; // 通話中に参加者を追加で呼ぶ(BRU5-066)
  acceptIncoming: () => Promise<void>;
  declineIncoming: () => void;
  hangup: () => void;
  toggleMute: () => void;
  clearError: () => void;
  // ── ENHA2-030 画面共有 ──
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  sendPointer: (nx: number, ny: number, visible: boolean) => void;
  sendAnnotation: (ann: AnnotationInput) => void;
}

const CallContext = createContext<CallCtxType>({
  incoming: null, call: null, online: new Set(), error: null,
  screenShare: null, screenShareSupported: false,
  accepting: false, audioBlocked: false, audioUnlockNonce: 0,
  reportAudioBlocked: () => {}, unlockAudio: () => {},
  startCall: async () => {}, inviteToCall: () => {}, acceptIncoming: async () => {}, declineIncoming: () => {},
  hangup: () => {}, toggleMute: () => {}, clearError: () => {},
  startScreenShare: async () => {}, stopScreenShare: () => {}, sendPointer: () => {}, sendAnnotation: () => {},
});

export function useCall() { return useContext(CallContext); }

export function CallProvider({ children }: { children: ReactNode }) {
  const { userId, userName } = useAuth();
  const { toast } = useToast();
  const [incoming, setIncoming] = useState<InvitePayload | null>(null);
  const [call, setCall] = useState<CallState | null>(null);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [screenShare, setScreenShare] = useState<ScreenShareState | null>(null); // ENHA2-030
  const [accepting, setAccepting] = useState(false); // 着信応答処理中(マイク取得待ち)
  const [audioBlocked, setAudioBlocked] = useState(false); // 相手音声が自動再生ブロックされている
  const [audioUnlockNonce, setAudioUnlockNonce] = useState(0); // 増やすと RemoteAudio が再生を再試行する

  // ライフサイクルを跨ぐ参照
  const meshRef = useRef<MeshConnection | null>(null);
  const signalingRef = useRef<CallSignaling | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const streamMapRef = useRef<Map<string, MediaStream>>(new Map()); // userId -> remote stream
  const connStateRef = useRef<Map<string, RTCPeerConnectionState>>(new Map());
  const speakingStopRef = useRef<Map<string, () => void>>(new Map());
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 応答したのに誰も居ないセッションだった場合の保険
  const failedPeersRef = useRef<Set<string>>(new Set()); // 自己修復を試し切って接続失敗が確定した相手
  const everActiveRef = useRef(false);
  const pendingInviteRef = useRef<Map<string, CallMember>>(new Map()); // まだ参加/拒否していない招待先
  const inviteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map()); // 招待ごとの応答待ちタイムアウト
  const presenceRef = useRef<Map<string, RosterMember>>(new Map()); // 最新の presence roster(自分を除く)
  const peerNamesRef = useRef<Map<string, string>>(new Map()); // userId -> 表示名(presence が欠けても名前を出せるように)
  const callRef = useRef<CallState | null>(null);
  const incomingRef = useRef<InvitePayload | null>(null);
  const acceptingRef = useRef(false); // 応答処理の二重発火/レースガード(await 中の状態変化を検知する)
  const selfRef = useRef({ id: userId, name: userName });
  const endingRef = useRef(false); // 終了処理の二重発火ガード(bye/roster/connState が同時に来ても1回だけ)
  const toastRef = useRef(toast); // toast は毎レンダー再生成されるため ref 経由で参照(useCallback を安定させる)
  // ── 複数タブ調整(同一ユーザー・同一ブラウザ) ──
  const tabCoordRef = useRef<CallTabCoordination | null>(null);
  const tabIdRef = useRef<string>("");
  if (!tabIdRef.current) tabIdRef.current = crypto.randomUUID();
  // ── ENHA2-030 画面共有 ──
  const screenPeersRef = useRef<ScreenSharePeers | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null); // 共有者の getDisplayMedia ストリーム
  const screenShareRef = useRef<ScreenShareState | null>(null);
  const annotationTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map()); // アノテーションの5秒TTL
  const pointerThrottleRef = useRef(0);

  useEffect(() => { callRef.current = call; }, [call]);
  useEffect(() => { incomingRef.current = incoming; }, [incoming]);
  useEffect(() => { screenShareRef.current = screenShare; }, [screenShare]);
  useEffect(() => { selfRef.current = { id: userId, name: userName || "匿名" }; }, [userId, userName]);
  useEffect(() => { toastRef.current = toast; });

  const clearError = useCallback(() => setError(null), []);

  // ── リモート音声の自動再生ブロック対策 ──
  // RemoteAudio の play() が拒否されたら報告し、バナーを出す。
  const reportAudioBlocked = useCallback(() => setAudioBlocked(true), []);
  // バナークリック(ユーザー操作)で全 RemoteAudio の play() を再試行し、ブロックを解除する。
  const unlockAudio = useCallback(() => {
    setAudioBlocked(false);
    setAudioUnlockNonce((n) => n + 1);
  }, []);

  // ── ENHA2-030 画面共有: 参照のみの後始末(setState はしない=teardownから安全に呼べる) ──
  const disposeScreenRefs = useCallback(() => {
    screenPeersRef.current?.destroy();
    screenPeersRef.current = null;
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    for (const t of annotationTimersRef.current.values()) clearTimeout(t);
    annotationTimersRef.current.clear();
    pointerThrottleRef.current = 0;
  }, []);

  // アノテーションを受信/追加し、確定から5秒後に自動消滅させる(共有者の描画は無効=視聴者のみ)。
  const addAnnotation = useCallback((ann: Annotation) => {
    setScreenShare((prev) => {
      if (!prev || prev.presenterId === ann.from) return prev;
      const rest = prev.annotations.filter((a) => a.id !== ann.id);
      return { ...prev, annotations: [...rest, ann] };
    });
    const timers = annotationTimersRef.current;
    const existing = timers.get(ann.id);
    if (existing) clearTimeout(existing);
    timers.set(ann.id, setTimeout(() => {
      timers.delete(ann.id);
      setScreenShare((prev) => prev ? { ...prev, annotations: prev.annotations.filter((a) => a.id !== ann.id) } : prev);
    }, ANNOTATION_TTL_MS));
  }, []);

  // ── 個人着信チャンネル宛にワンショット送信(相手の呼び鈴を鳴らす) ──
  const sendToUser = useCallback(async (targetId: string, event: string, payload: Record<string, unknown>) => {
    if (!isSupabaseEnabled) return;
    const ch = supabase!.channel(userCallChannel(targetId), { config: { broadcast: { self: false, ack: true } } });
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      ch.subscribe((status) => { if (status === "SUBSCRIBED") finish(); });
      setTimeout(finish, 3000);
    });
    try { await ch.send({ type: "broadcast", event, payload }); } catch { /* noop */ }
    setTimeout(() => { void supabase!.removeChannel(ch); }, 500);
  }, []);

  // ── 通話のティアダウン ──
  const teardown = useCallback(() => {
    if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
    if (joinTimerRef.current) { clearTimeout(joinTimerRef.current); joinTimerRef.current = null; }
    failedPeersRef.current.clear();
    stopRingtone();
    signalingRef.current?.destroy();
    signalingRef.current = null;
    meshRef.current?.destroy();
    meshRef.current = null;
    for (const stop of speakingStopRef.current.values()) stop();
    speakingStopRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    streamMapRef.current.clear();
    connStateRef.current.clear();
    presenceRef.current.clear();
    peerNamesRef.current.clear();
    for (const t of inviteTimersRef.current.values()) clearTimeout(t);
    inviteTimersRef.current.clear();
    disposeScreenRefs();
    everActiveRef.current = false;
    pendingInviteRef.current.clear();
    acceptingRef.current = false;
    setAccepting(false);
    setAudioBlocked(false);
  }, [disposeScreenRefs]);

  // 自分から通話を切る
  const hangup = useCallback(() => {
    const cur = callRef.current;
    if (!cur) return;
    if (endingRef.current) return;
    endingRef.current = true;
    // 通話確立後の切断: 残りの参加者へ即時に切断を通知する(presence untrack の取りこぼし対策)
    for (const p of cur.participants) {
      if (p.connState === "self") continue;
      void sendToUser(p.id, SIGNAL.bye, { sessionId: cur.sessionId, from: selfRef.current.id });
    }
    // 自分が呼び出した相手の呼び鈴は必ず止める。呼んだ本人が抜けるのに鳴らし続けると、
    // 相手が応答したときに「もう誰も居ない通話」に入ってしまう。
    // (他の参加者が残っている場合は、その人が改めて呼び直せばよい)
    for (const t of pendingInviteRef.current.values()) {
      void sendToUser(t.id, SIGNAL.cancel, { sessionId: cur.sessionId, from: selfRef.current.id });
    }
    // 自分が画面共有中なら、退出前に視聴者へ停止を通知(セッションチャンネルはteardownで閉じる)
    if (screenShareRef.current?.isSelf) signalingRef.current?.send(SIGNAL.screenStop, {});
    void recordParticipantLeft(cur.sessionId, selfRef.current.id);
    if (cur.role === "caller") void recordCallEnded(cur.sessionId, !everActiveRef.current);
    stopRingtone();
    playHangupTone();
    teardown();
    setCall(null);
    setScreenShare(null);
  }, [sendToUser, teardown]);

  // 相手起点で通話が終了したとき(bye受信 / roster全員退出 / 接続断)の共通処理。
  // 自分は通知を送らず、アクション通知と切断音を鳴らして後片付けする。
  const endCallAsRemote = useCallback(() => {
    const cur = callRef.current;
    if (!cur) return;
    if (endingRef.current) return;
    endingRef.current = true;
    void recordParticipantLeft(cur.sessionId, selfRef.current.id);
    if (cur.role === "caller") void recordCallEnded(cur.sessionId, !everActiveRef.current);
    stopRingtone();
    playHangupTone();
    teardown();
    setCall(null);
    setScreenShare(null);
    toastRef.current("通話が終了しました", "info");
  }, [teardown]);

  // 相手の発話監視を開始
  const startSpeakingMonitor = useCallback((id: string, stream: MediaStream) => {
    speakingStopRef.current.get(id)?.();
    const stop = monitorSpeaking(stream, (speaking) => {
      setCall((prev) => prev ? {
        ...prev,
        participants: prev.participants.map((p) => p.id === id ? { ...p, speaking } : p),
      } : prev);
    });
    speakingStopRef.current.set(id, stop);
  }, []);

  // ── 参加者リストの再計算(BRU5-066) ────────────────────────────
  // 「今この通話に誰がいるか」を presence だけで決めない。
  // Supabase の presence は突き合わせの途中で一時的に一部メンバーが欠けた state を返しうるため、
  // presence を唯一の真実にすると、健全に繋がっている相手が一瞬消えて PC ごと壊れてしまう。
  // そこで presence と「実際に PeerConnection を保持している相手(mesh.peerIds)」の和集合を参加者とする。
  // mesh 側の削除は猶予付きなので、presence の揺れではリストも接続も落ちない。
  const syncParticipants = useCallback(() => {
    const self = selfRef.current;
    const ids = new Set<string>([...presenceRef.current.keys(), ...(meshRef.current?.peerIds() ?? [])]);
    ids.delete(self.id);
    const others = [...ids];

    // 参加が確認できた相手は「呼び出し中」から外す
    for (const id of others) {
      if (pendingInviteRef.current.delete(id)) {
        const t = inviteTimersRef.current.get(id);
        if (t) { clearTimeout(t); inviteTimersRef.current.delete(id); }
      }
    }

    // 抜けた相手の接続状態/ストリーム/失敗マークを捨てる。残しておくと、同じ人が呼び直されて
    // 再参加したときに古い "closed"/"failed" を引き継いでしまう
    // (失敗マークが残ると、まだ繋がる見込みのある相手を「望みなし」と誤判定して通話を落とす)。
    for (const id of [...connStateRef.current.keys()]) {
      if (!ids.has(id)) connStateRef.current.delete(id);
    }
    for (const id of [...failedPeersRef.current]) {
      if (!ids.has(id)) failedPeersRef.current.delete(id);
    }
    for (const id of [...streamMapRef.current.keys()]) {
      if (!ids.has(id)) {
        streamMapRef.current.delete(id);
        speakingStopRef.current.get(id)?.();
        speakingStopRef.current.delete(id);
      }
    }

    // 画面共有中に視聴者が増減したら配信先を追従(共有者のみ)
    if (screenShareRef.current?.isSelf) screenPeersRef.current?.setViewers(others);

    if (others.length > 0) {
      everActiveRef.current = true;
      // 相手が応答して通話が繋がったら発信/着信の呼び出し音を止める
      stopRingtone();
      if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
      // 誰かが居ることが確認できたので「空のセッションだった」保険は解除する
      if (joinTimerRef.current) { clearTimeout(joinTimerRef.current); joinTimerRef.current = null; }
    }

    setCall((prev) => {
      if (!prev) return prev;
      const participants: Participant[] = [
        { id: self.id, name: self.name, muted: prev.muted, speaking: false, connState: "self" },
        ...others.map((id) => {
          const existing = prev.participants.find((p) => p.id === id);
          const pres = presenceRef.current.get(id);
          return {
            id,
            name: pres?.name ?? peerNamesRef.current.get(id) ?? existing?.name ?? "参加者",
            muted: pres?.muted ?? existing?.muted ?? false,
            speaking: existing?.speaking ?? false,
            connState: connStateRef.current.get(id) ?? existing?.connState ?? "connecting",
            stream: streamMapRef.current.get(id) ?? existing?.stream,
          } as Participant;
        }),
      ];
      let status = prev.status;
      if (others.length > 0 && (status === "outgoing" || status === "connecting")) status = "active";
      return { ...prev, participants, status, pending: [...pendingInviteRef.current.values()] };
    });
  }, []);

  // 全員が退出したら通話を終了する。
  // 参加者は presence ∪ mesh peers なので、ここが空になるのは
  // 「bye を受けた」か「猶予(8秒)を過ぎても presence に戻ってこなかった」場合だけ。
  // presence の一瞬の揺れで健全な通話を落とすことはない。
  const maybeEndIfEmpty = useCallback(() => {
    if (!everActiveRef.current || !callRef.current) return;
    if (presenceRef.current.size > 0) return;
    if ((meshRef.current?.peerIds().length ?? 0) > 0) return;
    if (pendingInviteRef.current.size > 0) return; // まだ呼び出し中の相手がいる
    endCallAsRemote();
  }, [endCallAsRemote]);

  // ── roster(presence)更新 → mesh接続 & 参加者リスト再計算 ──
  const handleRoster = useCallback((members: RosterMember[]) => {
    const self = selfRef.current;
    const others = members.filter((m) => m.id !== self.id);
    presenceRef.current = new Map(others.map((m) => [m.id, m]));
    for (const m of others) peerNamesRef.current.set(m.id, m.name);
    // 追加は即時、削除は猶予付き(MeshConnection 側で吸収する)
    meshRef.current?.setRoster(others.map((m) => m.id));
    syncParticipants();
    maybeEndIfEmpty();
  }, [syncParticipants, maybeEndIfEmpty]);

  // ── セッションチャンネルからのシグナル受信 → mesh へ ──
  const handleSignal = useCallback((event: string, payload: Record<string, unknown>) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const from = payload.from as string;
    if (!from || from === selfRef.current.id) return;
    if (event === SIGNAL.offer) void mesh.onOffer(from, payload.sdp as RTCSessionDescriptionInit);
    else if (event === SIGNAL.answer) void mesh.onAnswer(from, payload.sdp as RTCSessionDescriptionInit);
    else if (event === SIGNAL.ice) {
      // ICE は配列(バッチ)で届く。単体で送ってくる旧クライアントも受け付ける。
      const c = (payload.candidates ?? payload.candidate) as RTCIceCandidateInit | RTCIceCandidateInit[];
      if (c) void mesh.onIce(from, c);
    }
    // ── 参加ハンドシェイク(BRU5-066) ──
    // presence sync が欠けても、この往復だけで双方が相手を認識して接続を張れる。
    else if (event === SIGNAL.hello) {
      const name = payload.name as string | undefined;
      if (name) peerNamesRef.current.set(from, name);
      mesh.ensurePeer(from);
      signalingRef.current?.sendHelloAck(from); // 新規参加者へ「自分もここに居る」と返す
      syncParticipants();
    }
    else if (event === SIGNAL.helloAck) {
      const name = payload.name as string | undefined;
      if (name) peerNamesRef.current.set(from, name);
      mesh.ensurePeer(from);
      syncParticipants();
    }
    else if (event === SIGNAL.mute) {
      const muted = !!payload.muted;
      setCall((prev) => prev ? {
        ...prev, participants: prev.participants.map((p) => p.id === from ? { ...p, muted } : p),
      } : prev);
    }
    // ── ENHA2-030 画面共有 ──
    else if (event === SIGNAL.screenStart) {
      const name = (payload.fromName as string)
        || callRef.current?.participants.find((p) => p.id === from)?.name || "参加者";
      setScreenShare((prev) => {
        // 既に別の共有者がいる場合は先勝ちで無視
        if (prev && prev.presenterId !== from) return prev;
        return { presenterId: from, presenterName: name, isSelf: false, stream: prev?.stream, pointer: null, annotations: [] };
      });
    }
    else if (event === SIGNAL.screenStop) {
      if (screenShareRef.current?.presenterId === from) {
        screenPeersRef.current?.stop();
        for (const t of annotationTimersRef.current.values()) clearTimeout(t);
        annotationTimersRef.current.clear();
        setScreenShare(null);
      }
    }
    else if (event === SIGNAL.screenOffer) void screenPeersRef.current?.onOffer(from, payload.sdp as RTCSessionDescriptionInit);
    else if (event === SIGNAL.screenAnswer) void screenPeersRef.current?.onAnswer(from, payload.sdp as RTCSessionDescriptionInit);
    else if (event === SIGNAL.screenIce) void screenPeersRef.current?.onIce(from, payload.candidate as RTCIceCandidateInit);
    else if (event === SIGNAL.pointer) {
      const nx = payload.nx as number, ny = payload.ny as number, visible = !!payload.visible;
      setScreenShare((prev) => prev && prev.presenterId === from
        ? { ...prev, pointer: visible ? { nx, ny, name: prev.presenterName } : null }
        : prev);
    }
    else if (event === SIGNAL.annotate) {
      addAnnotation(payload.annotation as Annotation);
    }
    // セッションチャンネル経由の即時切断(タブを閉じた等)。個人チャンネルより確実・低遅延。
    else if (event === SIGNAL.bye) {
      if (!callRef.current) return;
      // 明示的な退出なので猶予を挟まず即座に外す。残った相手とは通話を続ける。
      presenceRef.current.delete(from);
      pendingInviteRef.current.delete(from);
      mesh.removePeerNow(from);
      syncParticipants();
      maybeEndIfEmpty();
    }
  }, [addAnnotation, syncParticipants, maybeEndIfEmpty]);

  // ── mesh を構築(共通) ──
  const buildMesh = useCallback((sessionId: string, stream: MediaStream) => {
    const self = selfRef.current;
    const signaling = new CallSignaling(supabase!, sessionId, self, {
      onRoster: handleRoster,
      onSignal: handleSignal,
    });
    const mesh = new MeshConnection(self.id, stream, {
      onRemoteStream: (id, remoteStream) => {
        streamMapRef.current.set(id, remoteStream);
        startSpeakingMonitor(id, remoteStream);
        // 相手の音声が実際に届いた＝繋がった。呼び出し音を確実に止める(最も早く確実な信号)。
        everActiveRef.current = true;
        stopRingtone();
        if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
        setCall((prev) => prev ? {
          ...prev,
          status: (prev.status === "outgoing" || prev.status === "connecting") ? "active" : prev.status,
          participants: prev.participants.map((p) => p.id === id ? { ...p, stream: remoteStream } : p),
        } : prev);
      },
      onPeerStateChange: (id, state) => {
        connStateRef.current.set(id, state);
        setCall((prev) => prev ? {
          ...prev, participants: prev.participants.map((p) => p.id === id ? { ...p, connState: state } : p),
        } : prev);
        if (state === "connected") {
          // 音声が実際に繋がったら呼び出し音を止める(presence roster の遅延/取りこぼし対策)。
          // roster より確実な「接続された」信号。発信/着信どちらの呼び出し音もここで確実に消える。
          everActiveRef.current = true;
          failedPeersRef.current.delete(id); // 相手側からの張り直しで復帰した
          stopRingtone();
          if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
          if (joinTimerRef.current) { clearTimeout(joinTimerRef.current); joinTimerRef.current = null; }
          setCall((prev) => prev && (prev.status === "outgoing" || prev.status === "connecting")
            ? { ...prev, status: "active" } : prev);
        }
        // 切断・再接続の自己修復(ICE restart / offer 再送)は MeshConnection が両側から主導する。
        // ここでは状態を映すだけにして、復旧ロジックを二重に持たない。
      },
      // 手を尽くしても繋がらなかった相手(BRU5-066)。
      // 通話全体を落とさず、その人だけを「接続失敗」として扱う。
      // 誰とも繋がっていない場合に限り、通話を終了する。
      onPeerFailed: (id) => {
        const cur = callRef.current;
        if (!cur) return;
        if (failedPeersRef.current.has(id)) return; // 同じ相手で二重に通知しない
        failedPeersRef.current.add(id);
        const name = cur.participants.find((p) => p.id === id)?.name
          ?? peerNamesRef.current.get(id) ?? "相手";
        // 「まだ望みのある相手」= 接続失敗が確定していない他の参加者。
        // PeerConnection の一時状態(connecting/new)で判定すると、ICE restart 直後は
        // 必ず connecting に戻るため「誰とも繋がらないのに永久に待ち続ける」ことになる。
        const anyHope = cur.participants.some((p) =>
          p.connState !== "self" && p.id !== id && !failedPeersRef.current.has(p.id));
        if (anyHope || pendingInviteRef.current.size > 0) {
          toastRef.current(`${name}さんと接続できませんでした`, "error");
          return;
        }
        // 誰とも繋がらなかった。原因はほぼネットワーク(TURN未経由のNAT越え失敗)。
        setError("相手と接続できませんでした。ネットワーク環境（企業ファイアウォール等）が原因の可能性があります。");
        endCallAsRemote();
      },
      // peer 集合が変わった(猶予後の削除を含む)。参加者リストを引き直す。
      onPeersChanged: () => {
        syncParticipants();
        maybeEndIfEmpty();
      },
      sendSignal: (ev, to, data) => {
        if (ev === "ice") signaling.send(SIGNAL.ice, { to, candidates: data });
        else signaling.send(ev === "offer" ? SIGNAL.offer : SIGNAL.answer, { to, sdp: data });
      },
    });
    // ── ENHA2-030 画面共有: 音声とは別建ての一方向映像PC群 ──
    const screenPeers = new ScreenSharePeers(self.id, {
      onRemoteVideo: (presenterId, remoteStream) => {
        setScreenShare((prev) => {
          if (prev && prev.presenterId !== presenterId) return prev; // 別共有者がいれば無視
          if (prev && prev.presenterId === presenterId) return { ...prev, stream: remoteStream };
          // screenStart 未受信の late-join 等でも映像到達で開く
          const name = callRef.current?.participants.find((p) => p.id === presenterId)?.name || "参加者";
          return { presenterId, presenterName: name, isSelf: false, stream: remoteStream, pointer: null, annotations: [] };
        });
      },
      onPeerStateChange: (id, state) => {
        // 視聴中に共有者との映像接続が切れたらステージを閉じる(共有者離脱の保険)
        if ((state === "failed" || state === "closed") && screenShareRef.current?.presenterId === id && !screenShareRef.current.isSelf) {
          screenPeersRef.current?.stop();
          setScreenShare(null);
        }
      },
      sendSignal: (ev, to, data) => {
        if (ev === "ice") signaling.send(SIGNAL.screenIce, { to, candidate: data });
        else signaling.send(ev === "offer" ? SIGNAL.screenOffer : SIGNAL.screenAnswer, { to, sdp: data });
      },
    });
    signalingRef.current = signaling;
    meshRef.current = mesh;
    screenPeersRef.current = screenPeers;
  }, [handleRoster, handleSignal, startSpeakingMonitor, endCallAsRemote, syncParticipants, maybeEndIfEmpty]);

  const acquireMic = useCallback(async (): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia(audioConstraints);
    } catch (e) {
      console.error("[call] getUserMedia failed", e);
      setError("マイクにアクセスできませんでした。ブラウザ/OSのマイク権限をご確認ください。");
      return null;
    }
  }, []);

  // ── 招待を1件送り、「呼び出し中」として登録する ──
  // 応答が無いまま RING_TIMEOUT_MS を過ぎたら、その相手だけを呼び出し中から外す。
  const sendInvite = useCallback((invite: InvitePayload, target: CallMember) => {
    peerNamesRef.current.set(target.id, target.name);
    pendingInviteRef.current.set(target.id, target);
    void sendToUser(target.id, SIGNAL.invite, invite as unknown as Record<string, unknown>);
    const prev = inviteTimersRef.current.get(target.id);
    if (prev) clearTimeout(prev);
    inviteTimersRef.current.set(target.id, setTimeout(() => {
      inviteTimersRef.current.delete(target.id);
      if (!pendingInviteRef.current.delete(target.id)) return;
      // 通話が既に成立している場合(通話中の追加招待)は、通話は続けたまま表示だけ整理する。
      // 誰も応答しなかった初回発信の終了は、発信側の ringTimerRef が受け持つ。
      if (everActiveRef.current && callRef.current) {
        toastRef.current(`${target.name}さんは応答しませんでした`, "info");
        syncParticipants();
        // 他の参加者も既に抜けていて、この人が最後の望みだった場合は通話を閉じる
        // (1人だけ通話に取り残されないように)
        maybeEndIfEmpty();
      }
    }, RING_TIMEOUT_MS));
  }, [sendToUser, syncParticipants, maybeEndIfEmpty]);

  // ── 発信 ──
  const startCall = useCallback(async (project: { id: string; name: string }, targets: CallMember[]) => {
    if (!isSupabaseEnabled || callRef.current || targets.length === 0) return;
    if (targets.length + 1 > MAX_PARTICIPANTS) {
      setError(`グループ通話は最大${MAX_PARTICIPANTS}人までです。`);
      return;
    }
    const stream = await acquireMic();
    if (!stream) return;
    endingRef.current = false;
    localStreamRef.current = stream;
    const self = selfRef.current;
    const sessionId = crypto.randomUUID();
    const members: CallMember[] = [{ id: self.id, name: self.name }, ...targets];

    buildMesh(sessionId, stream);

    setCall({
      sessionId, projectId: project.id, projectName: project.name,
      role: "caller", status: "outgoing", muted: false,
      participants: [{ id: self.id, name: self.name, muted: false, speaking: false, connState: "self" }],
      pending: targets,
    });
    startRingtone("outgoing");

    const invite: InvitePayload = {
      sessionId, from: self.id, fromName: self.name,
      projectId: project.id, projectName: project.name, members,
    };
    for (const t of targets) sendInvite(invite, t);
    void recordCallStart(sessionId, project.id, self.id, members);

    // 誰も応答しなければタイムアウトで終了
    ringTimerRef.current = setTimeout(() => {
      if (!everActiveRef.current) hangup();
    }, RING_TIMEOUT_MS);
  }, [acquireMic, buildMesh, sendInvite, hangup]);

  // ── 通話中に参加者を追加で呼ぶ(BRU5-066) ──
  // 既存セッションへの招待なので、新規発信とは違って sessionId を作り直さない。
  // 相手には通常の着信が鳴り、応答すれば同じセッションチャンネルに合流する。
  const inviteToCall = useCallback((targets: CallMember[]) => {
    const cur = callRef.current;
    if (!isSupabaseEnabled || !cur || targets.length === 0) return;
    const self = selfRef.current;
    const joined = new Set(cur.participants.map((p) => p.id));
    const list = targets.filter((t) =>
      t.id !== self.id && !joined.has(t.id) && !pendingInviteRef.current.has(t.id));
    if (list.length === 0) return;
    if (cur.participants.length + pendingInviteRef.current.size + list.length > MAX_PARTICIPANTS) {
      setError(`グループ通話は最大${MAX_PARTICIPANTS}人までです。`);
      return;
    }
    // members は着信側の表示用。今いる人 + 呼び出し中の人 + 今回追加する人。
    const members: CallMember[] = [
      ...cur.participants.map((p) => ({ id: p.id, name: p.name })),
      ...pendingInviteRef.current.values(),
      ...list,
    ];
    const invite: InvitePayload = {
      sessionId: cur.sessionId, from: self.id, fromName: self.name,
      projectId: cur.projectId, projectName: cur.projectName, members,
    };
    for (const t of list) sendInvite(invite, t);
    void recordParticipantsInvited(cur.sessionId, list);
    syncParticipants();
    toastRef.current(`${list.map((t) => t.name).join("、")}さんを呼び出しています`, "info");
  }, [sendInvite, syncParticipants]);

  // ── 着信に応答 ──
  const acceptIncoming = useCallback(async () => {
    const inv = incomingRef.current;
    // 二度押し/レースガード: 既に応答処理中(マイク取得待ち)や通話中なら無視する。
    if (!inv || callRef.current || acceptingRef.current) return;
    acceptingRef.current = true;
    setAccepting(true);
    // 別タブでも同じ着信が鳴っているので、この端末で応答したことを通知して鳴り止ませる。
    tabCoordRef.current?.claim(inv.sessionId);
    // 応答した瞬間に着信音を止める(マイク許可ダイアログ待ちの間も鳴り続けないように await 前で停止)。
    stopRingtone();
    if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
    const stream = await acquireMic();
    // マイク取得に失敗: 着信は閉じずに保持し、モーダルから再試行できるようにする(無反応にしない)。
    if (!stream) { acceptingRef.current = false; setAccepting(false); return; }
    // マイク取得中(許可ダイアログ表示中など)に拒否/キャンセル/別着信で状況が変わっていたら、
    // 取得済みストリームを破棄して参加しない(拒否したのに入ってしまうゴースト参加を防ぐ)。
    if (incomingRef.current?.sessionId !== inv.sessionId || callRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      acceptingRef.current = false;
      setAccepting(false);
      return;
    }
    endingRef.current = false;
    localStreamRef.current = stream;
    setIncoming(null);
    const self = selfRef.current;
    buildMesh(inv.sessionId, stream);
    // 招待に含まれていた他メンバーの名前を先に控えておく(presence が届く前でも名前を出せる)
    for (const m of inv.members) {
      if (m.id !== self.id) peerNamesRef.current.set(m.id, m.name);
    }
    setCall({
      sessionId: inv.sessionId, projectId: inv.projectId, projectName: inv.projectName,
      role: "callee", status: "connecting", muted: false,
      participants: [{ id: self.id, name: self.name, muted: false, speaking: false, connState: "self" }],
      pending: [],
    });
    void recordParticipantOutcome(inv.sessionId, self.id, "joined");
    acceptingRef.current = false;
    setAccepting(false);

    // 応答したのに誰も居ない = 呼ばれた通話がすでに解散していた(発信者が直前に切った等)。
    // 放置すると「自分ひとりだけの通話」に無期限で留まってしまうので、一定時間で畳む。
    // 誰かが現れれば syncParticipants / onPeerStateChange がこのタイマーを解除する。
    joinTimerRef.current = setTimeout(() => {
      joinTimerRef.current = null;
      if (!callRef.current || callRef.current.sessionId !== inv.sessionId) return;
      if (everActiveRef.current || endingRef.current) return;
      endingRef.current = true;
      void recordParticipantLeft(inv.sessionId, self.id);
      stopRingtone();
      playHangupTone();
      teardown();
      setCall(null);
      setScreenShare(null);
      toastRef.current("通話はすでに終了していました", "info");
    }, JOIN_TIMEOUT_MS);
  }, [acquireMic, buildMesh, teardown]);

  // ── 着信を拒否 ──
  const declineIncoming = useCallback(() => {
    const inv = incomingRef.current;
    // 応答処理中(マイク取得待ち)は応答を優先し、拒否は無視する(モーダルも拒否ボタンを隠す)。
    if (!inv || acceptingRef.current) return;
    // 別タブでも鳴っている同じ着信を止める(片方で拒否したら全タブで鳴り止む)。
    tabCoordRef.current?.claim(inv.sessionId);
    void sendToUser(inv.from, SIGNAL.decline, { sessionId: inv.sessionId, from: selfRef.current.id });
    void recordParticipantOutcome(inv.sessionId, selfRef.current.id, "declined");
    stopRingtone();
    setIncoming(null);
  }, [sendToUser]);

  // ── ミュート切替 ──
  const toggleMute = useCallback(() => {
    const cur = callRef.current;
    if (!cur) return;
    const muted = !cur.muted;
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    signalingRef.current?.setMuted(muted);
    setCall((prev) => prev ? {
      ...prev, muted,
      participants: prev.participants.map((p) => p.connState === "self" ? { ...p, muted } : p),
    } : prev);
  }, []);

  // ── ENHA2-030 画面共有を停止(共有者のみ) ──
  const stopScreenShare = useCallback(() => {
    const ss = screenShareRef.current;
    if (!ss || !ss.isSelf) return; // 他者の共有は止められない
    signalingRef.current?.send(SIGNAL.screenStop, {});
    screenPeersRef.current?.stop();
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    for (const t of annotationTimersRef.current.values()) clearTimeout(t);
    annotationTimersRef.current.clear();
    setScreenShare(null);
  }, []);

  // ── ENHA2-030 画面共有を開始 ──
  const startScreenShare = useCallback(async () => {
    const cur = callRef.current;
    if (!cur || !isScreenShareSupported()) return;
    if (screenShareRef.current) { setError("すでに画面共有が行われています。"); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(displayMediaConstraints);
    } catch {
      // ユーザーがピッカーをキャンセル/拒否した場合は静かに何もしない
      return;
    }
    // 取得〜許可の間に通話が終わっていたら破棄
    if (!callRef.current || screenShareRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
    screenStreamRef.current = stream;
    const self = selfRef.current;
    const viewers = cur.participants.filter((p) => p.connState !== "self").map((p) => p.id);
    screenPeersRef.current?.start(viewers, stream);
    setScreenShare({ presenterId: self.id, presenterName: self.name, isSelf: true, stream, pointer: null, annotations: [] });
    signalingRef.current?.send(SIGNAL.screenStart, { fromName: self.name });
    // ブラウザ標準の「共有を停止」バー押下にも追従
    const track = stream.getVideoTracks()[0];
    if (track) track.onended = () => stopScreenShare();
  }, [stopScreenShare]);

  // ── ポインター位置を送信(共有者のみ・スロットル) ──
  const sendPointer = useCallback((nx: number, ny: number, visible: boolean) => {
    const ss = screenShareRef.current;
    if (!ss || !ss.isSelf) return;
    const now = performance.now();
    if (visible && now - pointerThrottleRef.current < POINTER_THROTTLE_MS) return;
    pointerThrottleRef.current = now;
    const self = selfRef.current;
    setScreenShare((prev) => prev ? { ...prev, pointer: visible ? { nx, ny, name: self.name } : null } : prev);
    signalingRef.current?.send(SIGNAL.pointer, { nx, ny, visible });
  }, []);

  // ── アノテーションを送信(視聴者のみ・自端末にも即反映) ──
  const sendAnnotation = useCallback((input: AnnotationInput) => {
    const ss = screenShareRef.current;
    if (!ss || ss.isSelf) return; // 視聴者のみ
    const self = selfRef.current;
    const full = { ...input, from: self.id, fromName: self.name, at: Date.now() } as Annotation;
    addAnnotation(full);
    signalingRef.current?.send(SIGNAL.annotate, { annotation: full });
  }, [addAnnotation]);

  // ── 複数タブ調整: 別タブで応答したら鳴り止ませる / 別タブ通話中は鳴らさない ──
  useEffect(() => {
    if (!userId) return;
    const coord = new CallTabCoordination(userId, tabIdRef.current, {
      onClaimed: (sessionId) => {
        // 別タブが同じ着信を応答/拒否した。自タブが鳴らしていれば止める。
        if (incomingRef.current?.sessionId === sessionId) {
          stopRingtone();
          if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
          setIncoming(null);
        }
      },
    });
    tabCoordRef.current = coord;
    return () => { coord.destroy(); tabCoordRef.current = null; };
  }, [userId]);

  // 通話状態(発信/着信応答/通話中)を別タブへ共有し、他タブの新規着信を抑止する。
  useEffect(() => { tabCoordRef.current?.setBusy(!!call); }, [call]);

  // ── 個人着信チャンネル(呼び鈴)の常時購読 ──
  useEffect(() => {
    if (!isSupabaseEnabled || !userId) return;
    const ch: RealtimeChannel = supabase!.channel(userCallChannel(userId), {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: SIGNAL.invite }, async ({ payload }) => {
      const inv = payload as InvitePayload;
      // 通話中/着信中は取り込まない(自動拒否)
      if (callRef.current || incomingRef.current) {
        void sendToUser(inv.from, SIGNAL.decline, { sessionId: inv.sessionId, from: userId });
        return;
      }
      // 別タブで通話中なら、この端末では鳴らさず自動拒否する(単一通話・取りこぼし防止)。
      // busy が残った誤検知を避けるため、疑いがあるときだけ生存確認してから確定する。
      const coord = tabCoordRef.current;
      if (coord?.hasBusySibling() && await coord.verifyBusySibling(TAB_BUSY_QUERY_MS)) {
        if (callRef.current || incomingRef.current) return; // 待機中に状況が変わっていたら何もしない
        void sendToUser(inv.from, SIGNAL.decline, { sessionId: inv.sessionId, from: userId });
        return;
      }
      // 生存確認の待機中に自タブが通話開始/別着信を受けていたら中断する。
      if (callRef.current || incomingRef.current) return;
      setIncoming(inv);
      startRingtone("incoming");
      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
      ringTimerRef.current = setTimeout(() => {
        if (incomingRef.current?.sessionId === inv.sessionId) {
          void recordParticipantOutcome(inv.sessionId, userId, "missed");
          stopRingtone();
          setIncoming(null);
        }
      }, RING_TIMEOUT_MS);
    });
    ch.on("broadcast", { event: SIGNAL.cancel }, ({ payload }) => {
      const p = payload as { sessionId: string };
      if (incomingRef.current?.sessionId === p.sessionId) {
        stopRingtone();
        setIncoming(null);
      }
    });
    ch.on("broadcast", { event: SIGNAL.decline }, ({ payload }) => {
      const p = payload as { sessionId: string; from: string };
      const cur = callRef.current;
      // 通話中の追加招待は発信者以外も送れるので、role は問わずセッションだけで判定する。
      if (!cur || cur.sessionId !== p.sessionId) return;
      const target = pendingInviteRef.current.get(p.from);
      if (!target) return;
      pendingInviteRef.current.delete(p.from);
      const t = inviteTimersRef.current.get(p.from);
      if (t) { clearTimeout(t); inviteTimersRef.current.delete(p.from); }
      if (everActiveRef.current) {
        // 通話は続いている(追加で呼んだ相手に断られただけ)
        toastRef.current(`${target.name}さんが応答を辞退しました`, "info");
        syncParticipants();
        maybeEndIfEmpty(); // 他に誰も残っていなければ通話を閉じる(1人取り残し防止)
        return;
      }
      // まだ誰も参加しておらず、全員が拒否したら発信を終了
      if (pendingInviteRef.current.size === 0) hangup();
      else syncParticipants();
    });
    ch.on("broadcast", { event: SIGNAL.bye }, ({ payload }) => {
      const p = payload as { sessionId: string; from: string };
      const cur = callRef.current;
      if (!cur || cur.sessionId !== p.sessionId) return;
      // 切断した相手だけを即座に外し、残った相手とは通話を続ける。
      // 全員居なくなった場合だけ通話終了(アクション通知+切断音)。
      presenceRef.current.delete(p.from);
      pendingInviteRef.current.delete(p.from);
      meshRef.current?.removePeerNow(p.from);
      syncParticipants();
      maybeEndIfEmpty();
    });
    ch.subscribe();
    return () => { void supabase!.removeChannel(ch); };
  }, [userId, sendToUser, hangup, syncParticipants, maybeEndIfEmpty]);

  // ── オンライン在席presence ──
  useEffect(() => {
    if (!isSupabaseEnabled || !userId) return;
    const ch = supabase!.channel(ONLINE_PRESENCE_CHANNEL, { config: { presence: { key: userId } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState();
      setOnline(new Set(Object.keys(state)));
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") void ch.track({ id: userId, at: Date.now() });
    });
    return () => { void supabase!.removeChannel(ch); };
  }, [userId]);

  // 呼び出し音の保険: 通話が active か、いずれかの相手が connected になったら必ず止める。
  // 個別の停止経路(roster/connected/onRemoteStream/accept)を取りこぼしても、状態変化のたびに確実に消す。
  useEffect(() => {
    if (!call) return;
    if (call.status === "active" || call.participants.some((p) => p.connState === "connected")) {
      stopRingtone();
    }
  }, [call]);

  // presence sync を取りこぼしても接続が張られるように、roster と実 peer 群を定期照合する(BRU5-066)。
  // 追加方向のみ(欠けている相手への接続を張り直す)。削除は roster 更新と bye に任せるので、
  // presence が一時的に空になってもここで接続を落とすことはない。
  const activeSessionId = call?.sessionId;
  useEffect(() => {
    if (!activeSessionId) return;
    const timer = setInterval(() => {
      const mesh = meshRef.current;
      if (!mesh || !callRef.current) return;
      for (const id of presenceRef.current.keys()) mesh.ensurePeer(id);
      syncParticipants();
    }, PEER_RECONCILE_MS);
    return () => clearInterval(timer);
  }, [activeSessionId, syncParticipants]);

  // 通話が接続(active)した時刻を一度だけ記録する(通話時間計測の起点 BRU5-057-4)。
  useEffect(() => {
    if (call?.status === "active" && !call.startedAt) {
      setCall((prev) => (prev && prev.status === "active" && !prev.startedAt ? { ...prev, startedAt: Date.now() } : prev));
    }
  }, [call?.status, call?.startedAt]);

  // タブを閉じた/離脱したら即座に相手へ切断通知(購読済みセッションチャンネルへ bye をブロードキャスト)。
  // presence の離脱検知や接続断フォールバック(数秒)を待たずに、相手側でほぼ即時に通話が終わる。
  // bye は「実際に離脱が確定した」pagehide でのみ送る。beforeunload では送らない
  // (beforeunload で送るとリロード確認をキャンセルした場合に相手を巻き込んで切ってしまうため)。
  useEffect(() => {
    const onPageHide = () => {
      const cur = callRef.current;
      if (!cur) return;
      try { signalingRef.current?.send(SIGNAL.bye, { sessionId: cur.sessionId }); } catch { /* noop */ }
    };
    // 通話中にリロード/離脱しようとしたら、ブラウザ標準の確認ダイアログを出して誤操作を防ぐ。
    // (リロードすると WebRTC 通話は必ず切断される。維持したい場合はヘッダーの「更新」ボタンを使う。)
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!callRef.current) return;
      e.preventDefault();
      e.returnValue = ""; // Chrome は returnValue の設定でダイアログを表示する
      return "";
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  // アンマウント時に通話を破棄
  useEffect(() => () => teardown(), [teardown]);

  return (
    <CallContext.Provider value={{
      incoming, call, online, error, screenShare, screenShareSupported: isScreenShareSupported(),
      accepting, audioBlocked, audioUnlockNonce, reportAudioBlocked, unlockAudio,
      startCall, inviteToCall, acceptIncoming, declineIncoming, hangup, toggleMute, clearError,
      startScreenShare, stopScreenShare, sendPointer, sendAnnotation,
    }}>
      {children}
    </CallContext.Provider>
  );
}
