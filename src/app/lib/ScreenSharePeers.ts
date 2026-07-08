// ENHA2-030 画面共有 — 一方向の画面映像 RTCPeerConnection 群。
// 音声の MeshConnection とは別建て。共有者→各視聴者への sendonly 配信で、
// 共有者が常に offer 側になるため glare(同時offer衝突)が起きず、再ネゴシエーションの
// perfect-negotiation を実装せずに済む(＝稼働中の音声メッシュに一切触れない)。
// ICEの待避/flush など交渉の骨子は MeshConnection と同型。
import { rtcConfig } from "./callConstants";

export interface ScreenShareCallbacks {
  // 視聴者側: 共有者の画面映像ストリームを受信したとき
  onRemoteVideo: (presenterId: string, stream: MediaStream) => void;
  // 接続状態の変化(UI/掃除用)
  onPeerStateChange?: (id: string, state: RTCPeerConnectionState) => void;
  // シグナリング送信(セッションチャンネルへ broadcast)
  sendSignal: (event: "offer" | "answer" | "ice", to: string, data: unknown) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  remoteSet: boolean;
  pendingCandidates: RTCIceCandidateInit[];
}

export class ScreenSharePeers {
  private peers = new Map<string, PeerEntry>();
  private closed = false;
  private videoTrack: MediaStreamTrack | null = null;

  constructor(
    private readonly selfId: string,
    private readonly cb: ScreenShareCallbacks,
  ) {}

  // ── 共有者(presenter): 視聴者全員へ sendonly PC を張って配信開始 ──
  start(viewerIds: string[], stream: MediaStream) {
    if (this.closed) return;
    this.videoTrack = stream.getVideoTracks()[0] ?? null;
    if (!this.videoTrack) return;
    for (const id of viewerIds) {
      if (id !== this.selfId && !this.peers.has(id)) this.addPresenterPeer(id);
    }
  }

  // 共有中に視聴者が増減したら追従する(presenterのみ)。videoTrack があれば共有中とみなす。
  setViewers(viewerIds: string[]) {
    if (this.closed || !this.videoTrack) return;
    const set = new Set(viewerIds);
    for (const id of [...this.peers.keys()]) {
      if (!set.has(id)) this.removePeer(id);
    }
    for (const id of viewerIds) {
      if (id !== this.selfId && !this.peers.has(id)) this.addPresenterPeer(id);
    }
  }

  private addPresenterPeer(remoteId: string) {
    if (!this.videoTrack) return;
    const pc = new RTCPeerConnection(rtcConfig);
    const entry: PeerEntry = { pc, remoteSet: false, pendingCandidates: [] };
    this.peers.set(remoteId, entry);

    pc.addTransceiver(this.videoTrack, { direction: "sendonly" });
    pc.onicecandidate = (e) => {
      if (e.candidate) this.cb.sendSignal("ice", remoteId, e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => this.cb.onPeerStateChange?.(remoteId, pc.connectionState);

    void this.createOffer(remoteId, entry);
  }

  private async createOffer(remoteId: string, entry: PeerEntry) {
    try {
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      this.cb.sendSignal("offer", remoteId, entry.pc.localDescription);
    } catch (e) {
      console.error("[screen] createOffer failed", remoteId, e);
    }
  }

  // ── 視聴者(viewer): 共有者の offer を受けて recvonly で応答 ──
  async onOffer(from: string, sdp: RTCSessionDescriptionInit) {
    if (this.closed) return;
    let entry = this.peers.get(from);
    if (!entry) {
      const pc = new RTCPeerConnection(rtcConfig);
      entry = { pc, remoteSet: false, pendingCandidates: [] };
      this.peers.set(from, entry);
      pc.onicecandidate = (e) => {
        if (e.candidate) this.cb.sendSignal("ice", from, e.candidate.toJSON());
      };
      pc.onconnectionstatechange = () => this.cb.onPeerStateChange?.(from, pc.connectionState);
      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        this.cb.onRemoteVideo(from, stream);
      };
    }
    try {
      await entry.pc.setRemoteDescription(sdp);
      entry.remoteSet = true;
      await this.flushCandidates(from);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      this.cb.sendSignal("answer", from, entry.pc.localDescription);
    } catch (e) {
      console.error("[screen] onOffer failed", from, e);
    }
  }

  async onAnswer(from: string, sdp: RTCSessionDescriptionInit) {
    if (this.closed) return;
    const entry = this.peers.get(from);
    if (!entry) return;
    try {
      await entry.pc.setRemoteDescription(sdp);
      entry.remoteSet = true;
      await this.flushCandidates(from);
    } catch (e) {
      console.error("[screen] onAnswer failed", from, e);
    }
  }

  async onIce(from: string, candidate: RTCIceCandidateInit) {
    if (this.closed) return;
    const entry = this.peers.get(from);
    if (!entry) return;
    if (!entry.remoteSet) {
      entry.pendingCandidates.push(candidate);
      return;
    }
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch (e) {
      console.error("[screen] addIceCandidate failed", from, e);
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
        console.error("[screen] flush addIceCandidate failed", from, e);
      }
    }
  }

  private removePeer(remoteId: string) {
    const entry = this.peers.get(remoteId);
    if (!entry) return;
    this.peers.delete(remoteId);
    try {
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
    } catch { /* noop */ }
  }

  // 共有停止 / 視聴終了: 全PCを閉じる(トラック自体の停止は呼び出し側の責務)。
  stop() {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.videoTrack = null;
  }

  destroy() {
    this.closed = true;
    this.stop();
  }
}
