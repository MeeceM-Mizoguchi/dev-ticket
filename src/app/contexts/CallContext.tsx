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

  const reportAudioBlocked = useCallback(() => setAudioBlocked(true), []);
  const unlockAudio = useCallback(() => {
    setAudioBlocked(false);
    setAudioUnlockNonce((n) => n + 1);
  }, []);

  const disposeScreenRefs = useCallback(() => {
    screenPeersRef.current?.destroy();
    screenPeersRef.current = null;
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    for (const t of annotationTimersRef.current.values()) clearTimeout(t);
    annotationTimersRef.current.clear();
    pointerThrottleRef.current = 0;
  }, []);

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

  const hangup = useCallback(() => {
    const cur = callRef.current;
    if (!cur) return;
    if (endingRef.current) return;
    endingRef.current = true;
    for (const p of cur.participants) {
      if (p.connState === "self") continue;
      void sendToUser(p.id, SIGNAL.bye, { sessionId: cur.sessionId, from: selfRef.current.id });
    }
    for (const t of pendingInviteRef.current.values()) {
      void sendToUser(t.id, SIGNAL.cancel, { sessionId: cur.sessionId, from: selfRef.current.id });
    }
    if (screenShareRef.current?.isSelf) signalingRef.current?.send(SIGNAL.screenStop, {});
    void recordParticipantLeft(cur.sessionId, selfRef.current.id);
    if (cur.role === "caller") void recordCallEnded(cur.sessionId, !everActiveRef.current);
    stopRingtone();
    playHangupTone();
    teardown();
    setCall(null);
    setScreenShare(null);
  }, [sendToUser, teardown]);

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

  const syncParticipants = useCallback(() => {
    const self = selfRef.current;
    const ids = new Set<string>([...presenceRef.current.keys(), ...(meshRef.current?.peerIds() ?? [])]);
    ids.delete(self.id);
    const others = [...ids];

    for (const id of others) {
      if (pendingInviteRef.current.delete(id)) {
        const t = inviteTimersRef.current.get(id);
        if (t) { clearTimeout(t); inviteTimersRef.current.delete(id); }
      }
    }

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

    if (screenShareRef.current?.isSelf) screenPeersRef.current?.setViewers(others);

    if (others.length > 0) {
      everActiveRef.current = true;
      stopRingtone();
      if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
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

  const maybeEndIfEmpty = useCallback(() => {
    if (!everActiveRef.current || !callRef.current) return;
    if (presenceRef.current.size > 0) return;
    if ((meshRef.current?.peerIds().length ?? 0) > 0) return;
    if (pendingInviteRef.current.size > 0) return;
    endCallAsRemote();
  }, [endCallAsRemote]);

  const handleRoster = useCallback((members: RosterMember[]) => {
    const self = selfRef.current;
    const others = members.filter((m) => m.id !== self.id);
    presenceRef.current = new Map(others.map((m) => [m.id, m]));
    for (const m of others) peerNamesRef.current.set(m.id, m.name);
    meshRef.current?.setRoster(others.map((m) => m.id));
    syncParticipants();
    maybeEndIfEmpty();
  }, [syncParticipants, maybeEndIfEmpty]);

  const handleSignal = useCallback((event: string, payload: Record<string, unknown>) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const from = payload.from as string;
    if (!from || from === selfRef.current.id) return;
    if (event === SIGNAL.offer) void mesh.onOffer(from, payload.sdp as RTCSessionDescriptionInit);
    else if (event === SIGNAL.answer) void mesh.onAnswer(from, payload.sdp as RTCSessionDescriptionInit);
    else if (event === SIGNAL.ice) {
      const c = (payload.candidates ?? payload.candidate) as RTCIceCandidateInit | RTCIceCandidateInit[];
      if (c) void mesh.onIce(from, c);
    }
    else if (event === SIGNAL.hello) {
      const name = payload.name as string | undefined;
      if (name) peerNamesRef.current.set(from, name);
      mesh.ensurePeer(from);
      signalingRef.current?.sendHelloAck(from);
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
    else if (event === SIGNAL.screenStart) {
      const name = (payload.fromName as string)
        || callRef.current?.participants.find((p) => p.id === from)?.name || "参加者";
      setScreenShare((prev) => {
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
    else if (event === SIGNAL.bye) {
      if (!callRef.current) return;
      presenceRef.current.delete(from);
      pendingInviteRef.current.delete(from);
      mesh.removePeerNow(from);
      syncParticipants();
      maybeEndIfEmpty();
    }
  }, [addAnnotation, syncParticipants, maybeEndIfEmpty]);

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
          everActiveRef.current = true;
          failedPeersRef.current.delete(id);
          stopRingtone();
          if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
          if (joinTimerRef.current) { clearTimeout(joinTimerRef.current); joinTimerRef.current = null; }
          setCall((prev) => prev && (prev.status === "outgoing" || prev.status === "connecting")
            ? { ...prev, status: "active" } : prev);
        }
      },
      onPeerFailed: (id) => {
        const cur = callRef.current;
        if (!cur) return;
        if (failedPeersRef.current.has(id)) return;
        failedPeersRef.current.add(id);
        const name = cur.participants.find((p) => p.id === id)?.name
          ?? peerNamesRef.current.get(id) ?? "相手";
        const anyHope = cur.participants.some((p) =>
          p.connState !== "self" && p.id !== id && !failedPeersRef.current.has(p.id));
        if (anyHope || pendingInviteRef.current.size > 0) {
          toastRef.current(`${name}さんと接続できませんでした`, "error");
          return;
        }
        setError("相手と接続できませんでした。ネットワーク環境（企業ファイアウォール等）が原因の可能性があります。");
        endCallAsRemote();
      },
      onPeersChanged: () => {
        syncParticipants();
        maybeEndIfEmpty();
      },
      sendSignal: (ev, to, data) => {
        if (ev === "ice") signaling.send(SIGNAL.ice, { to, candidates: data });
        else signaling.send(ev === "offer" ? SIGNAL.offer : SIGNAL.answer, { to, sdp: data });
      },
    });
    const screenPeers = new ScreenSharePeers(self.id, {
      onRemoteVideo: (presenterId, remoteStream) => {
        setScreenShare((prev) => {
          if (prev && prev.presenterId !== presenterId) return prev;
          if (prev && prev.presenterId === presenterId) return { ...prev, stream: remoteStream };
          const name = callRef.current?.participants.find((p) => p.id === presenterId)?.name || "参加者";
          return { presenterId, presenterName: name, isSelf: false, stream: remoteStream, pointer: null, annotations: [] };
        });
      },
      onPeerStateChange: (id, state) => {
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

  // 🌟 改善1: マイク取得に10秒の安全タイムアウトを設定し、永久フリーズ（「ずっと接続中…」）を防ぐ
  const acquireMic = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("MIC_TIMEOUT")), 10000)
      );
      const streamPromise = navigator.mediaDevices.getUserMedia(audioConstraints);
      const result = await Promise.race([streamPromise, timeoutPromise]);
      return result;
    } catch (e: any) {
      console.error("[call] getUserMedia failed", e);
      if (e?.message === "MIC_TIMEOUT") {
        setError("マイクの応答が制限時間（10秒）を超えました。ブラウザの権限ダイアログをご確認ください。");
      } else {
        setError("マイクにアクセスできませんでした。ブラウザ/OSのマイク権限をご確認ください。");
      }
      return null;
    }
  }, []);

  const sendInvite = useCallback((invite: InvitePayload, target: CallMember) => {
    peerNamesRef.current.set(target.id, target.name);
    pendingInviteRef.current.set(target.id, target);
    void sendToUser(target.id, SIGNAL.invite, invite as unknown as Record<string, unknown>);
    const prev = inviteTimersRef.current.get(target.id);
    if (prev) clearTimeout(prev);
    inviteTimersRef.current.set(target.id, setTimeout(() => {
      inviteTimersRef.current.delete(target.id);
      if (!pendingInviteRef.current.delete(target.id)) return;
      if (everActiveRef.current && callRef.current) {
        toastRef.current(`${target.name}さんは応答しませんでした`, "info");
        syncParticipants();
        maybeEndIfEmpty();
      }
    }, RING_TIMEOUT_MS));
  }, [sendToUser, syncParticipants, maybeEndIfEmpty]);

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

    ringTimerRef.current = setTimeout(() => {
      if (!everActiveRef.current) hangup();
    }, RING_TIMEOUT_MS);
  }, [acquireMic, buildMesh, sendInvite, hangup]);

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

  // 🌟 改善2: try...finally の徹底により応答拒否/エラー時でも確実に accepting 状態を解放し、フリーズを遮断
  const acceptIncoming = useCallback(async () => {
    const inv = incomingRef.current;
    if (!inv || callRef.current || acceptingRef.current) return;
    acceptingRef.current = true;
    setAccepting(true);

    try {
      tabCoordRef.current?.claim(inv.sessionId);
      stopRingtone();
      if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
      
      const stream = await acquireMic();
      if (!stream) {
        // マイク取得失敗時は着信モーダルに戻す
        return;
      }

      if (incomingRef.current?.sessionId !== inv.sessionId || callRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      endingRef.current = false;
      localStreamRef.current = stream;
      setIncoming(null);
      const self = selfRef.current;
      buildMesh(inv.sessionId, stream);

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

      // 🌟 改善3: 応答から15秒以内に誰とも疎通が成立しない場合の自動退避タイマー
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
        toastRef.current("通話接続がタイムアウトしました", "info");
      }, JOIN_TIMEOUT_MS);
    } catch (e) {
      console.error("[call] acceptIncoming error", e);
      setError("通話の開始処理中にエラーが発生しました。");
    } finally {
      acceptingRef.current = false;
      setAccepting(false);
    }
  }, [acquireMic, buildMesh, teardown]);

  const declineIncoming = useCallback(() => {
    const inv = incomingRef.current;
    if (!inv || acceptingRef.current) return;
    tabCoordRef.current?.claim(inv.sessionId);
    void sendToUser(inv.from, SIGNAL.decline, { sessionId: inv.sessionId, from: selfRef.current.id });
    void recordParticipantOutcome(inv.sessionId, selfRef.current.id, "declined");
    stopRingtone();
    setIncoming(null);
  }, [sendToUser]);

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

  const stopScreenShare = useCallback(() => {
    const ss = screenShareRef.current;
    if (!ss || !ss.isSelf) return;
    signalingRef.current?.send(SIGNAL.screenStop, {});
    screenPeersRef.current?.stop();
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    for (const t of annotationTimersRef.current.values()) clearTimeout(t);
    annotationTimersRef.current.clear();
    setScreenShare(null);
  }, []);

  const startScreenShare = useCallback(async () => {
    const cur = callRef.current;
    if (!cur || !isScreenShareSupported()) return;
    if (screenShareRef.current) { setError("すでに画面共有が行われています。"); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(displayMediaConstraints);
    } catch {
      return;
    }
    if (!callRef.current || screenShareRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
    screenStreamRef.current = stream;
    const self = selfRef.current;
    const viewers = cur.participants.filter((p) => p.connState !== "self").map((p) => p.id);
    screenPeersRef.current?.start(viewers, stream);
    setScreenShare({ presenterId: self.id, presenterName: self.name, isSelf: true, stream, pointer: null, annotations: [] });
    signalingRef.current?.send(SIGNAL.screenStart, { fromName: self.name });
    const track = stream.getVideoTracks()[0];
    if (track) track.onended = () => stopScreenShare();
  }, [stopScreenShare]);

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

  const sendAnnotation = useCallback((input: AnnotationInput) => {
    const ss = screenShareRef.current;
    if (!ss || ss.isSelf) return;
    const self = selfRef.current;
    const full = { ...input, from: self.id, fromName: self.name, at: Date.now() } as Annotation;
    addAnnotation(full);
    signalingRef.current?.send(SIGNAL.annotate, { annotation: full });
  }, [addAnnotation]);

  useEffect(() => {
    if (!userId) return;
    const coord = new CallTabCoordination(userId, tabIdRef.current, {
      onClaimed: (sessionId) => {
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

  useEffect(() => { tabCoordRef.current?.setBusy(!!call); }, [call]);

  useEffect(() => {
    if (!isSupabaseEnabled || !userId) return;
    const ch: RealtimeChannel = supabase!.channel(userCallChannel(userId), {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: SIGNAL.invite }, async ({ payload }) => {
      const inv = payload as InvitePayload;
      if (callRef.current || incomingRef.current) {
        void sendToUser(inv.from, SIGNAL.decline, { sessionId: inv.sessionId, from: userId });
        return;
      }
      const coord = tabCoordRef.current;
      if (coord?.hasBusySibling() && await coord.verifyBusySibling(TAB_BUSY_QUERY_MS)) {
        if (callRef.current || incomingRef.current) return;
        void sendToUser(inv.from, SIGNAL.decline, { sessionId: inv.sessionId, from: userId });
        return;
      }
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
      if (!cur || cur.sessionId !== p.sessionId) return;
      const target = pendingInviteRef.current.get(p.from);
      if (!target) return;
      pendingInviteRef.current.delete(p.from);
      const t = inviteTimersRef.current.get(p.from);
      if (t) { clearTimeout(t); inviteTimersRef.current.delete(p.from); }
      if (everActiveRef.current) {
        toastRef.current(`${target.name}さんが応答を辞退しました`, "info");
        syncParticipants();
        maybeEndIfEmpty();
        return;
      }
      if (pendingInviteRef.current.size === 0) hangup();
      else syncParticipants();
    });
    ch.on("broadcast", { event: SIGNAL.bye }, ({ payload }) => {
      const p = payload as { sessionId: string; from: string };
      const cur = callRef.current;
      if (!cur || cur.sessionId !== p.sessionId) return;
      presenceRef.current.delete(p.from);
      pendingInviteRef.current.delete(p.from);
      meshRef.current?.removePeerNow(p.from);
      syncParticipants();
      maybeEndIfEmpty();
    });
    ch.subscribe();
    return () => { void supabase!.removeChannel(ch); };
  }, [userId, sendToUser, hangup, syncParticipants, maybeEndIfEmpty]);

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

  useEffect(() => {
    if (!call) return;
    if (call.status === "active" || call.participants.some((p) => p.connState === "connected")) {
      stopRingtone();
    }
  }, [call]);

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

  useEffect(() => {
    if (call?.status === "active" && !call.startedAt) {
      setCall((prev) => (prev && prev.status === "active" && !prev.startedAt ? { ...prev, startedAt: Date.now() } : prev));
    }
  }, [call?.status, call?.startedAt]);

  useEffect(() => {
    const onPageHide = () => {
      const cur = callRef.current;
      if (!cur) return;
      try { signalingRef.current?.send(SIGNAL.bye, { sessionId: cur.sessionId }); } catch { /* noop */ }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!callRef.current) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

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