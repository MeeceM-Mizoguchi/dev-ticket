// 音声のみP2Pフルメッシュの RTCPeerConnection 群を管理する。
// roster(現在の参加者)を受け取り、増えた相手には接続を張り、消えた相手は(猶予後に)閉じる。
//
// ── BRU5-066: Perfect Negotiation への移行 ──────────────────────────────
// 旧実装は「userId が小さい方だけが offer を作る」固定ルールだった。この設計では
// 交渉を主導できるのが片側だけなので、応答側(userId が大きい方)の PeerConnection が
// 壊れても自力で復旧できない。相手側は自分の PC が connected のまま健全に見えるため
// 再交渉もしてくれず、応答側は「接続中…」のまま永久に固まる。
// presence の一時的な欠落で PC が片側だけ閉じられると、まさにこれが起きていた(3人目が繋がらない)。
//
// そこで WebRTC 標準の Perfect Negotiation に置き換える:
//  - userId 比較は「どちらが offer するか」ではなく polite / impolite の役割決めにのみ使う
//  - どちら側からでも offer / ICE restart を開始できる
//  - 同時 offer(glare)は impolite が相手の offer を無視し、polite が rollback して収束させる
// これで「片側だけが復旧手段を持つ」という構造そのものを無くす。
import { rtcConfig, ICE_BATCH_MS, PEER_REMOVE_GRACE_MS } from "./callConstants";

// 接続が確立しない/切れたときに自己修復を試みる間隔と上限。
const WATCHDOG_MS = 8_000;
// polite 側はわずかに遅らせて再交渉する(両側が同時に張り直して衝突し続けるのを避ける)。
const WATCHDOG_POLITE_EXTRA_MS = 2_000;
// "failed" は経路断が確定した状態なので、猶予を置かず素早く張り直す。
const WATCHDOG_FAILED_MS = 1_000;
// これを出し切っても繋がらなければ、その相手は接続失敗として通知する(通話自体は落とさない)。
const WATCHDOG_TRIES = 4;
// 接続失敗が確定した後も、この間隔でだけ経路の復活を試し続ける。
// VPN切替やUDPの一時遮断から戻ってきたときに、通話を切らずに復帰できるようにするため。
// 頻度を落としてあるので、到達不能な相手が居てもシグナリングを撒き散らさない。
const WATCHDOG_SLOW_MS = 30_000;

export interface MeshCallbacks {
  // 相手の音声ストリームを受信したとき(再生用)
  onRemoteStream: (userId: string, stream: MediaStream) => void;
  // 接続状態が変化したとき(UI表示用)
  onPeerStateChange: (userId: string, state: RTCPeerConnectionState) => void;
  // 自己修復を試し切っても接続できなかったとき。呼び出し側はこの相手を「接続失敗」として扱う。
  onPeerFailed: (userId: string) => void;
  // peer 集合が変化したとき(参加者リストの再計算用)。猶予後の削除でも呼ばれる。
  onPeersChanged: () => void;
  // シグナリング送信(セッションチャンネルへ broadcast)。ice は candidate の配列を渡す。
  sendSignal: (event: "offer" | "answer" | "ice", to: string, data: unknown) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  // Perfect Negotiation の役割。polite 側は衝突時に自分の offer を巻き戻して相手を優先する。
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  answerPending: boolean; // setRemoteDescription(answer) の実行中
  gaveUp: boolean; // 自己修復を試し切って接続失敗が確定した(これ以上は張り直さない)
  remoteSet: boolean; // remoteDescription 済みか(ICEの適用可否)
  pendingCandidates: RTCIceCandidateInit[]; // remote未設定中に来たICEの待避
  outbox: RTCIceCandidateInit[]; // 送信待ちICE(バッチ送信用)
  iceTimer: ReturnType<typeof setTimeout> | null;
}

export class MeshConnection {
  private peers = new Map<string, PeerEntry>();
  private closed = false;
  private watchdogs = new Map<string, ReturnType<typeof setTimeout>>();
  private tries = new Map<string, number>(); // 相手ごとの自己修復試行回数
  private removeTimers = new Map<string, ReturnType<typeof setTimeout>>(); // roster欠落による削除の猶予

  constructor(
    private readonly selfId: string,
    private readonly localStream: MediaStream,
    private readonly cb: MeshCallbacks,
  ) {}

  // 現在 PeerConnection を保持している相手の一覧。
  // presence が一時的に欠けても猶予中は残るので、参加者リストの算出はこちらを併用する。
  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  // 現在のリモート参加者一覧を渡すと差分接続する。
  // 追加は即時。削除は猶予付き(presence の一時的な欠落で健全な接続を壊さないため)。
  setRoster(remoteIds: string[]) {
    if (this.closed) return;
    const set = new Set(remoteIds);
    for (const id of [...this.peers.keys()]) {
      if (set.has(id)) this.cancelRemoval(id);
      else this.scheduleRemoval(id);
    }
    for (const id of remoteIds) this.ensurePeer(id);
  }

  // 相手との接続を(無ければ)張る。roster を待たず hello/offer 受信からも呼べる。
  ensurePeer(remoteId: string) {
    if (this.closed || !remoteId || remoteId === this.selfId) return;
    this.cancelRemoval(remoteId);
    if (!this.peers.has(remoteId)) this.addPeer(remoteId);
  }

  // 相手が明示的に退出した(bye)。猶予を挟まず即座に閉じる。
  removePeerNow(remoteId: string) {
    this.cancelRemoval(remoteId);
    this.removePeer(remoteId);
  }

  private addPeer(remoteId: string): PeerEntry {
    const pc = new RTCPeerConnection(rtcConfig);
    const entry: PeerEntry = {
      pc,
      // 役割は両側で一意に決まればよい。ID が大きい方を polite(譲る側)とする。
      polite: this.selfId > remoteId,
      makingOffer: false,
      ignoreOffer: false,
      answerPending: false,
      gaveUp: false,
      remoteSet: false,
      pendingCandidates: [],
      outbox: [],
      iceTimer: null,
    };
    this.peers.set(remoteId, entry);

    for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);

    // Perfect Negotiation の中核。addTrack / restartIce をきっかけに自動で発火し、
    // どちら側からでも offer を出せる。衝突は onOffer 側で解決する。
    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) this.cb.sendSignal("offer", remoteId, pc.localDescription);
      } catch (e) {
        console.error("[mesh] negotiation failed", remoteId, e);
      } finally {
        entry.makingOffer = false;
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) this.queueIce(remoteId, entry, e.candidate.toJSON());
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.cb.onRemoteStream(remoteId, stream);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        // 相手側からの張り直しで復帰することもあるので、諦めた印もここで解除する。
        entry.gaveUp = false;
        this.clearWatchdog(remoteId);
        this.tries.delete(remoteId);
      } else if (st !== "closed" && !entry.gaveUp) {
        // new / connecting / disconnected / failed — いずれも「まだ繋がっていない」。
        // 一定時間で自己修復を試みる(failed は素早く)。
        // ICE restart は必ず recover() を通す(試行回数を数えるため)。
        // ここで直接 restartIce すると、failed↔connecting を無限に往復して
        // offer と candidate をチャンネルへ撒き続けてしまう。
        this.scheduleWatchdog(remoteId, st === "failed" ? WATCHDOG_FAILED_MS : WATCHDOG_MS);
      }
      this.cb.onPeerStateChange(remoteId, st);
    };

    // 初期交渉は onnegotiationneeded(addTrack 由来)が両側で自動的に起こす。
    // ただし offer / answer / ICE が丸ごと落ちた場合に備えてウォッチドッグも張っておく。
    this.scheduleWatchdog(remoteId, WATCHDOG_MS);
    this.cb.onPeersChanged();
    return entry;
  }

  // ── 自己修復ウォッチドッグ(両側が主導できる) ──────────────────────
  private scheduleWatchdog(remoteId: string, delayMs: number) {
    if (this.closed || this.watchdogs.has(remoteId)) return;
    const entry = this.peers.get(remoteId);
    const delay = delayMs + (entry?.polite ? WATCHDOG_POLITE_EXTRA_MS : 0);
    this.watchdogs.set(remoteId, setTimeout(() => {
      this.watchdogs.delete(remoteId);
      this.recover(remoteId);
    }, delay));
  }

  private clearWatchdog(remoteId: string) {
    const t = this.watchdogs.get(remoteId);
    if (t) { clearTimeout(t); this.watchdogs.delete(remoteId); }
  }

  private recover(remoteId: string) {
    if (this.closed) return;
    const entry = this.peers.get(remoteId);
    if (!entry) return;
    const pc = entry.pc;
    if (pc.connectionState === "connected" || pc.connectionState === "closed") return;

    const tries = this.tries.get(remoteId) ?? 0;
    if (!entry.gaveUp && tries >= WATCHDOG_TRIES) {
      // 手を尽くしても繋がらない。相手ごとの失敗として1度だけ通知する(通話全体は落とさない)。
      // UI を確実に「接続できませんでした」にするため状態も落とす。
      // ただし完全には諦めず、以降は低頻度(WATCHDOG_SLOW_MS)で復帰だけを試し続ける。
      entry.gaveUp = true;
      this.cb.onPeerStateChange(remoteId, "failed");
      this.cb.onPeerFailed(remoteId);
      this.scheduleWatchdog(remoteId, WATCHDOG_SLOW_MS);
      return;
    }
    if (!entry.gaveUp) this.tries.set(remoteId, tries + 1);

    if (pc.signalingState === "have-local-offer" && pc.localDescription) {
      // 自分の offer を出したまま answer が返ってこない = offer か answer が届いていない。
      // 同じ offer をもう一度送り直す(相手が受け取れていれば answer が返る)。
      this.cb.sendSignal("offer", remoteId, pc.localDescription);
    } else if (pc.signalingState === "stable") {
      // 交渉は終わっているのに繋がらない/切れた = 経路の問題。ICE を張り直す。
      // restartIce() は onnegotiationneeded を経由して新しい offer を作るので、
      // polite / impolite どちらからでも復旧を開始できる(旧実装との決定的な違い)。
      try { pc.restartIce(); } catch { /* noop */ }
    }
    this.scheduleWatchdog(remoteId, entry.gaveUp ? WATCHDOG_SLOW_MS : WATCHDOG_MS);
  }

  // ── ICE candidate のバッチ送信 ────────────────────────────────
  private queueIce(remoteId: string, entry: PeerEntry, candidate: RTCIceCandidateInit) {
    entry.outbox.push(candidate);
    if (entry.iceTimer) return;
    entry.iceTimer = setTimeout(() => {
      entry.iceTimer = null;
      const batch = entry.outbox.splice(0);
      if (batch.length > 0) this.cb.sendSignal("ice", remoteId, batch);
    }, ICE_BATCH_MS);
  }

  // ── シグナル受信 ─────────────────────────────────────────────
  async onOffer(from: string, sdp: RTCSessionDescriptionInit) {
    if (this.closed) return;
    let entry = this.peers.get(from);
    if (!entry) entry = this.addPeer(from);
    const pc = entry.pc;
    try {
      // Perfect Negotiation の衝突判定。
      // 自分も offer を出している最中(stable でない)に相手の offer が来たら glare。
      // impolite 側は相手の offer を無視して自分の offer を通し、polite 側は
      // setRemoteDescription が暗黙に rollback して相手の offer を受け入れる。
      const readyForOffer = !entry.makingOffer && (pc.signalingState === "stable" || entry.answerPending);
      const collision = !readyForOffer;
      entry.ignoreOffer = !entry.polite && collision;
      if (entry.ignoreOffer) return;

      await pc.setRemoteDescription(sdp);
      entry.remoteSet = true;
      await this.flushCandidates(from);
      await pc.setLocalDescription();
      if (pc.localDescription) this.cb.sendSignal("answer", from, pc.localDescription);
    } catch (e) {
      console.error("[mesh] onOffer failed", from, e);
    }
  }

  async onAnswer(from: string, sdp: RTCSessionDescriptionInit) {
    if (this.closed) return;
    const entry = this.peers.get(from);
    if (!entry) return;
    // 自分が offer を出していない状態の answer は無視する(衝突で巻き戻した後の遅延到着など)。
    if (entry.pc.signalingState !== "have-local-offer") return;
    try {
      entry.answerPending = true;
      await entry.pc.setRemoteDescription(sdp);
      entry.remoteSet = true;
      await this.flushCandidates(from);
    } catch (e) {
      console.error("[mesh] onAnswer failed", from, e);
    } finally {
      entry.answerPending = false;
    }
  }

  // candidate は配列(バッチ)で来る。単体で来た場合(旧クライアント)も受け付ける。
  async onIce(from: string, candidates: RTCIceCandidateInit | RTCIceCandidateInit[]) {
    if (this.closed) return;
    const entry = this.peers.get(from);
    if (!entry) return;
    const list = Array.isArray(candidates) ? candidates : [candidates];
    for (const c of list) {
      if (!entry.remoteSet) {
        // remoteDescription 未設定の間に来たICEは待避してから適用する。
        entry.pendingCandidates.push(c);
        continue;
      }
      try {
        await entry.pc.addIceCandidate(c);
      } catch (e) {
        // 衝突で無視した offer に紐づく candidate は失敗して当然なので、そのときは黙る。
        if (!entry.ignoreOffer) console.error("[mesh] addIceCandidate failed", from, e);
      }
    }
  }

  private async flushCandidates(from: string) {
    const entry = this.peers.get(from);
    if (!entry) return;
    const pending = entry.pendingCandidates;
    entry.pendingCandidates = [];
    for (const c of pending) {
      try {
        await entry.pc.addIceCandidate(c);
      } catch (e) {
        console.error("[mesh] flush addIceCandidate failed", from, e);
      }
    }
  }

  // ── roster 欠落による削除は「猶予付き」かつ「接続状態を見て」判断する ─────────
  // presence から消えただけでは退出とみなさない。WebRTC のメディアは Realtime ソケットとは
  // 独立して生き続けるため、相手のソケット再接続(Wi-Fi切替/スリープ復帰/Supabase側のrejoin)で
  // presence が数秒〜数十秒欠けることがある。ここで connected な PC を閉じると、
  // 音声が正常に流れている健全な通話を一方的に切ってしまう。
  //
  // したがって:
  //  - まだ connected なら「相手は居る」と判断し、閉じずに監視を続ける
  //  - まだ交渉中(new/connecting)で諦めてもいないなら閉じない。
  //    hello で見つけただけで presence にまだ載っていない相手や、TURN 経由・低速回線で
  //    ICE 確立に時間がかかる相手を、交渉の途中で殺してしまわないため。
  //    見込みが無ければ recover() が最終的に gaveUp を立てるので、そこで閉じられる。
  //  - 本当に退出していれば PC はいずれ disconnected/failed に落ちるので、そこで閉じる
  // 明示的な退出(bye)だけは removePeerNow() で即座に閉じる。
  private scheduleRemoval(remoteId: string) {
    if (this.removeTimers.has(remoteId)) return;
    this.removeTimers.set(remoteId, setTimeout(() => {
      this.removeTimers.delete(remoteId);
      const entry = this.peers.get(remoteId);
      if (!entry) return;
      const st = entry.pc.connectionState;
      const negotiating = (st === "new" || st === "connecting") && !entry.gaveUp;
      if (st === "connected" || negotiating) {
        this.scheduleRemoval(remoteId); // 生きている/繋がる見込みがある → 閉じずに再確認する
        return;
      }
      this.removePeer(remoteId);
    }, PEER_REMOVE_GRACE_MS));
  }

  private cancelRemoval(remoteId: string) {
    const t = this.removeTimers.get(remoteId);
    if (t) { clearTimeout(t); this.removeTimers.delete(remoteId); }
  }

  private removePeer(remoteId: string) {
    this.clearWatchdog(remoteId);
    this.tries.delete(remoteId);
    const entry = this.peers.get(remoteId);
    if (!entry) return;
    this.peers.delete(remoteId);
    if (entry.iceTimer) clearTimeout(entry.iceTimer);
    try {
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.oniceconnectionstatechange = null;
      entry.pc.onnegotiationneeded = null;
      entry.pc.close();
    } catch { /* noop */ }
    this.cb.onPeersChanged();
  }

  destroy() {
    this.closed = true;
    for (const t of this.removeTimers.values()) clearTimeout(t);
    this.removeTimers.clear();
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }
}
