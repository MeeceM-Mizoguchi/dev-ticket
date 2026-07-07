// ENHA2-029 オンライン音声会話 — 状態オーケストレーション。
// 個人着信チャンネル(呼び鈴)・オンラインpresence・通話セッション(mesh)を統合し、
// 発信/着信/応答/拒否/退出/ミュートのアクションをアプリ全体に供給する。
import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { MeshConnection } from "@/app/lib/MeshConnection";
import { CallSignaling, type RosterMember } from "@/app/lib/CallSignaling";
import { monitorSpeaking } from "@/app/lib/audioLevel";
import { startRingtone, stopRingtone } from "@/app/lib/ringtone";
import {
  SIGNAL, audioConstraints, userCallChannel, ONLINE_PRESENCE_CHANNEL,
  RING_TIMEOUT_MS, MAX_PARTICIPANTS,
  type CallMember, type InvitePayload, type Participant, type CallStatus,
} from "@/app/lib/callConstants";
import {
  recordCallStart, recordParticipantOutcome, recordParticipantLeft, recordCallEnded,
} from "@/app/lib/callService";

export interface CallState {
  sessionId: string;
  projectId: string;
  projectName: string;
  role: "caller" | "callee";
  status: CallStatus;
  muted: boolean;
  participants: Participant[];
}

interface CallCtxType {
  incoming: InvitePayload | null;
  call: CallState | null;
  online: Set<string>;
  error: string | null;
  startCall: (project: { id: string; name: string }, targets: CallMember[]) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  declineIncoming: () => void;
  hangup: () => void;
  toggleMute: () => void;
  clearError: () => void;
}

const CallContext = createContext<CallCtxType>({
  incoming: null, call: null, online: new Set(), error: null,
  startCall: async () => {}, acceptIncoming: async () => {}, declineIncoming: () => {},
  hangup: () => {}, toggleMute: () => {}, clearError: () => {},
});

export function useCall() { return useContext(CallContext); }

export function CallProvider({ children }: { children: ReactNode }) {
  const { userId, userName } = useAuth();
  const [incoming, setIncoming] = useState<InvitePayload | null>(null);
  const [call, setCall] = useState<CallState | null>(null);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // ライフサイクルを跨ぐ参照
  const meshRef = useRef<MeshConnection | null>(null);
  const signalingRef = useRef<CallSignaling | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const streamMapRef = useRef<Map<string, MediaStream>>(new Map()); // userId -> remote stream
  const connStateRef = useRef<Map<string, RTCPeerConnectionState>>(new Map());
  const speakingStopRef = useRef<Map<string, () => void>>(new Map());
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const everActiveRef = useRef(false);
  const pendingInviteRef = useRef<Set<string>>(new Set()); // まだ参加/拒否していない招待先
  const inviteTargetsRef = useRef<CallMember[]>([]);
  const callRef = useRef<CallState | null>(null);
  const incomingRef = useRef<InvitePayload | null>(null);
  const selfRef = useRef({ id: userId, name: userName });

  useEffect(() => { callRef.current = call; }, [call]);
  useEffect(() => { incomingRef.current = incoming; }, [incoming]);
  useEffect(() => { selfRef.current = { id: userId, name: userName || "匿名" }; }, [userId, userName]);

  const clearError = useCallback(() => setError(null), []);

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
    everActiveRef.current = false;
    pendingInviteRef.current.clear();
    inviteTargetsRef.current = [];
  }, []);

  const hangup = useCallback(() => {
    const cur = callRef.current;
    if (!cur) return;
    // 応答前の発信を切る場合は招待先の呼び鈴を止める
    if (cur.role === "caller" && cur.status === "outgoing") {
      for (const t of inviteTargetsRef.current) {
        void sendToUser(t.id, SIGNAL.cancel, { sessionId: cur.sessionId, from: selfRef.current.id });
      }
    }
    void recordParticipantLeft(cur.sessionId, selfRef.current.id);
    if (cur.role === "caller") void recordCallEnded(cur.sessionId, !everActiveRef.current);
    teardown();
    setCall(null);
  }, [sendToUser, teardown]);

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

  // ── roster(presence)更新 → 参加者リスト再計算 & mesh接続 ──
  const handleRoster = useCallback((members: RosterMember[]) => {
    const self = selfRef.current;
    const others = members.filter((m) => m.id !== self.id);
    meshRef.current?.setRoster(others.map((m) => m.id));
    if (others.length > 0) {
      everActiveRef.current = true;
      // 相手が応答して通話が繋がったら発信/着信の呼び出し音を止める
      stopRingtone();
      if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
      for (const m of others) pendingInviteRef.current.delete(m.id);
    }

    setCall((prev) => {
      if (!prev) return prev;
      const participants: Participant[] = members.map((m) => {
        if (m.id === self.id) {
          return { id: m.id, name: m.name, muted: prev.muted, speaking: false, connState: "self" };
        }
        const existing = prev.participants.find((p) => p.id === m.id);
        return {
          id: m.id,
          name: m.name,
          muted: m.muted,
          speaking: existing?.speaking ?? false,
          connState: connStateRef.current.get(m.id) ?? "connecting",
          stream: streamMapRef.current.get(m.id) ?? existing?.stream,
        };
      });
      let status = prev.status;
      if (others.length > 0 && (status === "outgoing" || status === "connecting")) status = "active";
      return { ...prev, participants, status };
    });

    // 全員が退出したら(一度でも繋がっていれば)通話終了
    if (everActiveRef.current && others.length === 0 && callRef.current) {
      hangup();
    }
  }, [hangup]);

  // ── セッションチャンネルからのシグナル受信 → mesh へ ──
  const handleSignal = useCallback((event: string, payload: Record<string, unknown>) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const from = payload.from as string;
    if (!from || from === selfRef.current.id) return;
    if (event === SIGNAL.offer) void mesh.onOffer(from, payload.sdp as RTCSessionDescriptionInit);
    else if (event === SIGNAL.answer) void mesh.onAnswer(from, payload.sdp as RTCSessionDescriptionInit);
    else if (event === SIGNAL.ice) void mesh.onIce(from, payload.candidate as RTCIceCandidateInit);
    else if (event === SIGNAL.mute) {
      const muted = !!payload.muted;
      setCall((prev) => prev ? {
        ...prev, participants: prev.participants.map((p) => p.id === from ? { ...p, muted } : p),
      } : prev);
    }
  }, []);

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
        setCall((prev) => prev ? {
          ...prev, participants: prev.participants.map((p) => p.id === id ? { ...p, stream: remoteStream } : p),
        } : prev);
      },
      onPeerStateChange: (id, state) => {
        connStateRef.current.set(id, state);
        setCall((prev) => prev ? {
          ...prev, participants: prev.participants.map((p) => p.id === id ? { ...p, connState: state } : p),
        } : prev);
      },
      sendSignal: (ev, to, data) => {
        if (ev === "ice") signaling.send(SIGNAL.ice, { to, candidate: data });
        else signaling.send(ev === "offer" ? SIGNAL.offer : SIGNAL.answer, { to, sdp: data });
      },
    });
    signalingRef.current = signaling;
    meshRef.current = mesh;
  }, [handleRoster, handleSignal, startSpeakingMonitor]);

  const acquireMic = useCallback(async (): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia(audioConstraints);
    } catch (e) {
      console.error("[call] getUserMedia failed", e);
      setError("マイクにアクセスできませんでした。ブラウザ/OSのマイク権限をご確認ください。");
      return null;
    }
  }, []);

  // ── 発信 ──
  const startCall = useCallback(async (project: { id: string; name: string }, targets: CallMember[]) => {
    if (!isSupabaseEnabled || callRef.current || targets.length === 0) return;
    if (targets.length + 1 > MAX_PARTICIPANTS) {
      setError(`グループ通話は最大${MAX_PARTICIPANTS}人までです。`);
      return;
    }
    const stream = await acquireMic();
    if (!stream) return;
    localStreamRef.current = stream;
    const self = selfRef.current;
    const sessionId = crypto.randomUUID();
    const members: CallMember[] = [{ id: self.id, name: self.name }, ...targets];

    inviteTargetsRef.current = targets;
    pendingInviteRef.current = new Set(targets.map((t) => t.id));
    buildMesh(sessionId, stream);

    setCall({
      sessionId, projectId: project.id, projectName: project.name,
      role: "caller", status: "outgoing", muted: false,
      participants: [{ id: self.id, name: self.name, muted: false, speaking: false, connState: "self" }],
    });
    startRingtone("outgoing");

    const invite: InvitePayload = {
      sessionId, from: self.id, fromName: self.name,
      projectId: project.id, projectName: project.name, members,
    };
    for (const t of targets) void sendToUser(t.id, SIGNAL.invite, invite as unknown as Record<string, unknown>);
    void recordCallStart(sessionId, project.id, self.id, members);

    // 誰も応答しなければタイムアウトで終了
    ringTimerRef.current = setTimeout(() => {
      if (!everActiveRef.current) hangup();
    }, RING_TIMEOUT_MS);
  }, [acquireMic, buildMesh, sendToUser, hangup]);

  // ── 着信に応答 ──
  const acceptIncoming = useCallback(async () => {
    const inv = incomingRef.current;
    if (!inv || callRef.current) return;
    const stream = await acquireMic();
    if (!stream) return;
    localStreamRef.current = stream;
    stopRingtone();
    setIncoming(null);
    const self = selfRef.current;
    buildMesh(inv.sessionId, stream);
    setCall({
      sessionId: inv.sessionId, projectId: inv.projectId, projectName: inv.projectName,
      role: "callee", status: "connecting", muted: false,
      participants: [{ id: self.id, name: self.name, muted: false, speaking: false, connState: "self" }],
    });
    void recordParticipantOutcome(inv.sessionId, self.id, "joined");
  }, [acquireMic, buildMesh]);

  // ── 着信を拒否 ──
  const declineIncoming = useCallback(() => {
    const inv = incomingRef.current;
    if (!inv) return;
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

  // ── 個人着信チャンネル(呼び鈴)の常時購読 ──
  useEffect(() => {
    if (!isSupabaseEnabled || !userId) return;
    const ch: RealtimeChannel = supabase!.channel(userCallChannel(userId), {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: SIGNAL.invite }, ({ payload }) => {
      const inv = payload as InvitePayload;
      // 通話中/着信中は取り込まない(自動拒否)
      if (callRef.current || incomingRef.current) {
        void sendToUser(inv.from, SIGNAL.decline, { sessionId: inv.sessionId, from: userId });
        return;
      }
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
      if (!cur || cur.sessionId !== p.sessionId || cur.role !== "caller") return;
      pendingInviteRef.current.delete(p.from);
      // まだ誰も参加しておらず、全員が拒否したら発信を終了
      if (!everActiveRef.current && pendingInviteRef.current.size === 0) hangup();
    });
    ch.subscribe();
    return () => { void supabase!.removeChannel(ch); };
  }, [userId, sendToUser, hangup]);

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

  // アンマウント時に通話を破棄
  useEffect(() => () => teardown(), [teardown]);

  return (
    <CallContext.Provider value={{ incoming, call, online, error, startCall, acceptIncoming, declineIncoming, hangup, toggleMute, clearError }}>
      {children}
    </CallContext.Provider>
  );
}
