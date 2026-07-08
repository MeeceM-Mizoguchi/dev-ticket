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
import { monitorSpeaking } from "@/app/lib/audioLevel";
import { startRingtone, stopRingtone, playHangupTone } from "@/app/lib/ringtone";
import { useToast } from "@/app/contexts/ToastContext";
import {
  SIGNAL, audioConstraints, displayMediaConstraints, isScreenShareSupported,
  userCallChannel, ONLINE_PRESENCE_CHANNEL,
  RING_TIMEOUT_MS, RECONNECT_GRACE_MS, ICE_RESTART_ATTEMPTS, MAX_PARTICIPANTS, ANNOTATION_TTL_MS, POINTER_THROTTLE_MS,
  type CallMember, type InvitePayload, type Participant, type CallStatus,
  type ScreenShareState, type Annotation, type AnnotationInput,
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
  screenShare: ScreenShareState | null;
  screenShareSupported: boolean;
  startCall: (project: { id: string; name: string }, targets: CallMember[]) => Promise<void>;
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
  startCall: async () => {}, acceptIncoming: async () => {}, declineIncoming: () => {},
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
  const endingRef = useRef(false); // 終了処理の二重発火ガード(bye/roster/connState が同時に来ても1回だけ)
  const connLossTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map()); // 接続断フォールバックのデバウンス
  const iceRestartAttemptsRef = useRef<Map<string, number>>(new Map()); // 相手ごとのICE restart試行回数
  const rosterEmptyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // roster一時空(Realtime再接続)での誤終了デバウンス
  const toastRef = useRef(toast); // toast は毎レンダー再生成されるため ref 経由で参照(useCallback を安定させる)
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
    for (const t of connLossTimersRef.current.values()) clearTimeout(t);
    connLossTimersRef.current.clear();
    iceRestartAttemptsRef.current.clear();
    if (rosterEmptyTimerRef.current) { clearTimeout(rosterEmptyTimerRef.current); rosterEmptyTimerRef.current = null; }
    disposeScreenRefs();
    everActiveRef.current = false;
    pendingInviteRef.current.clear();
    inviteTargetsRef.current = [];
  }, [disposeScreenRefs]);

  // 自分から通話を切る
  const hangup = useCallback(() => {
    const cur = callRef.current;
    if (!cur) return;
    if (endingRef.current) return;
    endingRef.current = true;
    if (cur.role === "caller" && cur.status === "outgoing") {
      // 応答前の発信を切る場合は招待先の呼び鈴を止める
      for (const t of inviteTargetsRef.current) {
        void sendToUser(t.id, SIGNAL.cancel, { sessionId: cur.sessionId, from: selfRef.current.id });
      }
    } else {
      // 通話確立後の切断: 残りの参加者へ即時に切断を通知する(presence untrack の取りこぼし対策)
      for (const p of cur.participants) {
        if (p.connState === "self") continue;
        void sendToUser(p.id, SIGNAL.bye, { sessionId: cur.sessionId, from: selfRef.current.id });
      }
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

  // ── roster(presence)更新 → 参加者リスト再計算 & mesh接続 ──
  const handleRoster = useCallback((members: RosterMember[]) => {
    const self = selfRef.current;
    const others = members.filter((m) => m.id !== self.id);

    // roster が一瞬空になるのは Realtime のソケット再接続時によく起きる(再購読直後は
    // 自分だけ先に track され、相手の presence が返ってくるまで others が空に見える)。
    // このとき相手とのP2P音声はまだ生きている(connState==="connected")ことが多いので、
    // 即 setRoster([]) で PC を閉じたり endCallAsRemote すると健全な通話を数分ごとに落として
    // しまう。生きた相手がいる間は roster空を無視し、数秒デバウンスして再確認する。
    const hasLivePeer = () => {
      for (const [id, st] of connStateRef.current) {
        if (id !== self.id && st === "connected") return true;
      }
      return false;
    };
    if (everActiveRef.current && others.length === 0 && callRef.current) {
      if (hasLivePeer()) {
        // 一時的な空振り: PC も participants もそのままに保ち、猶予後に再確認する。
        if (!rosterEmptyTimerRef.current) {
          rosterEmptyTimerRef.current = setTimeout(() => {
            rosterEmptyTimerRef.current = null;
            if (!callRef.current) return;
            if (hasLivePeer()) return; // 相手が生きている→通話継続
            endCallAsRemote();          // 本当に全員退出していたら相手切断として終了
          }, RECONNECT_GRACE_MS);
        }
        return;
      }
      // 生きた相手もいない=本当に全員退出。従来どおり即終了する。
      meshRef.current?.setRoster([]);
      endCallAsRemote();
      return;
    }
    // 他者が居る(または未 active の)通常ケース。保留中の空roster判定は解除する。
    if (rosterEmptyTimerRef.current) { clearTimeout(rosterEmptyTimerRef.current); rosterEmptyTimerRef.current = null; }

    meshRef.current?.setRoster(others.map((m) => m.id));
    // 画面共有中に視聴者が増減したら配信先を追従(共有者のみ)
    if (screenShareRef.current?.isSelf) screenPeersRef.current?.setViewers(others.map((m) => m.id));
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
  }, [endCallAsRemote]);

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
      const cur = callRef.current;
      if (!cur) return;
      const remaining = cur.participants.filter((x) => x.connState !== "self" && x.id !== from);
      if (remaining.length === 0) endCallAsRemote();
    }
  }, [addAnnotation, endCallAsRemote]);

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
        // フォールバック: bye も presence も届かないネットワーク断の検知。
        // 短時間の揺れは即終了せず、ICE restart で経路を張り直して自己修復を試みる。
        // 数回張り直しても復帰しなければ相手切断として終了する。
        const timers = connLossTimersRef.current;
        if (state === "connected") {
          const t = timers.get(id);
          if (t) { clearTimeout(t); timers.delete(id); }
          iceRestartAttemptsRef.current.delete(id); // 復旧成功: 試行回数をリセット
          // 音声が実際に繋がったら呼び出し音を止める(presence roster の遅延/取りこぼし対策)。
          // roster より確実な「接続された」信号。発信/着信どちらの呼び出し音もここで確実に消える。
          everActiveRef.current = true;
          stopRingtone();
          if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
          setCall((prev) => prev && (prev.status === "outgoing" || prev.status === "connecting")
            ? { ...prev, status: "active" } : prev);
        } else if (state === "disconnected" || state === "failed" || state === "closed") {
          // "failed" は経路断確定: すぐ張り直す。"disconnected" は自己回復も多いので猶予後に張り直す。
          if (state === "failed") meshRef.current?.restartIce(id);
          if (!timers.has(id)) {
            const attempt = () => {
              timers.delete(id);
              if (connStateRef.current.get(id) === "connected") { iceRestartAttemptsRef.current.delete(id); return; }
              const cur = callRef.current;
              if (!cur) return;
              const tries = iceRestartAttemptsRef.current.get(id) ?? 0;
              if (tries < ICE_RESTART_ATTEMPTS) {
                iceRestartAttemptsRef.current.set(id, tries + 1);
                meshRef.current?.restartIce(id); // 経路を張り直してもう一度待つ
                timers.set(id, setTimeout(attempt, RECONNECT_GRACE_MS));
                return;
              }
              // 復旧を試し切った: 他に生存中(connected)の相手がいなければ相手切断として終了
              iceRestartAttemptsRef.current.delete(id);
              const aliveOther = cur.participants.some((p) => p.connState !== "self" && p.id !== id && p.connState === "connected");
              if (!aliveOther) endCallAsRemote();
            };
            timers.set(id, setTimeout(attempt, RECONNECT_GRACE_MS));
          }
        }
      },
      sendSignal: (ev, to, data) => {
        if (ev === "ice") signaling.send(SIGNAL.ice, { to, candidate: data });
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
  }, [handleRoster, handleSignal, startSpeakingMonitor, endCallAsRemote]);

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
    endingRef.current = false;
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
    // 応答した瞬間に着信音を止める(マイク許可ダイアログ待ちの間も鳴り続けないように await 前で停止)。
    stopRingtone();
    if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
    const stream = await acquireMic();
    if (!stream) return;
    endingRef.current = false;
    localStreamRef.current = stream;
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
    ch.on("broadcast", { event: SIGNAL.bye }, ({ payload }) => {
      const p = payload as { sessionId: string; from: string };
      const cur = callRef.current;
      if (!cur || cur.sessionId !== p.sessionId) return;
      // 切断した相手を除いて他に残っていなければ通話終了(アクション通知+切断音)。
      // 複数人残っている場合は presence roster がその相手だけを外す。
      const remaining = cur.participants.filter((x) => x.connState !== "self" && x.id !== p.from);
      if (remaining.length === 0) endCallAsRemote();
    });
    ch.subscribe();
    return () => { void supabase!.removeChannel(ch); };
  }, [userId, sendToUser, hangup, endCallAsRemote]);

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

  // タブを閉じた/離脱したら即座に相手へ切断通知(購読済みセッションチャンネルへ bye をブロードキャスト)。
  // presence の離脱検知や接続断フォールバック(数秒)を待たずに、相手側でほぼ即時に通話が終わる。
  useEffect(() => {
    const onLeave = () => {
      const cur = callRef.current;
      if (!cur) return;
      try { signalingRef.current?.send(SIGNAL.bye, { sessionId: cur.sessionId }); } catch { /* noop */ }
    };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, []);

  // アンマウント時に通話を破棄
  useEffect(() => () => teardown(), [teardown]);

  return (
    <CallContext.Provider value={{
      incoming, call, online, error, screenShare, screenShareSupported: isScreenShareSupported(),
      startCall, acceptIncoming, declineIncoming, hangup, toggleMute, clearError,
      startScreenShare, stopScreenShare, sendPointer, sendAnnotation,
    }}>
      {children}
    </CallContext.Provider>
  );
}
