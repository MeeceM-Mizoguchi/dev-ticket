// 音声のみP2Pフルメッシュの RTCPeerConnection 群を管理する。
// roster(現在の参加者)を受け取り、増えた相手には接続を張り、消えた相手は閉じる。
// glare(同時offer)回避: userIdが小さい方だけが offer を作る初期交渉ルール。
// 音声のみ・トラック固定なので再ネゴシエーションは発生しない前提。
import { rtcConfig } from "./callConstants";

export interface MeshCallbacks {
  // 相手の音声ストリームを受信したとき(再生用)
  onRemoteStream: (userId: string, stream: MediaStream) => void;
  // 接続状態が変化したとき(UI表示用)
  onPeerStateChange: (userId: string, state: RTCPeerConnectionState) => void;
  // シグナリング送信(セッションチャンネルへ broadcast)
  sendSignal: (event: "offer" | "answer" | "ice", to: string, data: unknown) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  remoteSet: boolean; // setRemoteDescription 済みか
  pendingCandidates: RTCIceCandidateInit[]; // remote未設定中に来たICEの待避
}

export class MeshConnection {
  private peers = new Map<string, PeerEntry>();
  private closed = false;

  constructor(
    private readonly selfId: string,
    private readonly localStream: MediaStream,
    private readonly cb: MeshCallbacks,
  ) {}

  // 現在のリモート参加者一覧を渡すと差分接続する。
  setRoster(remoteIds: string[]) {
    if (this.closed) return;
    const set = new Set(remoteIds);
    for (const id of [...this.peers.keys()]) {
      if (!set.has(id)) this.removePeer(id);
    }
    for (const id of remoteIds) {
      if (id !== this.selfId && !this.peers.has(id)) this.addPeer(id);
    }
  }

  // 経路が切れた相手との接続を張り直す(ICE restart)。
  // glare 回避のため初期交渉と同じく offer 側(selfId < remoteId)だけが再 offer を送る。
  // answer 側は相手からの再 offer を onOffer で受けて応答するだけでよい。
  restartIce(remoteId: string) {
    if (this.closed) return;
    const entry = this.peers.get(remoteId);
    if (!entry) return;
    if (this.selfId < remoteId) {
      // 再 offer の反映(onAnswer)までに来る新世代 ICE は待避してから適用する。
      entry.remoteSet = false;
      void this.createOffer(remoteId, entry, { iceRestart: true });
    }
  }

  private addPeer(remoteId: string): PeerEntry {
    const pc = new RTCPeerConnection(rtcConfig);
    const entry: PeerEntry = { pc, remoteSet: false, pendingCandidates: [] };
    this.peers.set(remoteId, entry);

    for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.cb.sendSignal("ice", remoteId, e.candidate.toJSON());
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.cb.onRemoteStream(remoteId, stream);
    };
    pc.onconnectionstatechange = () => {
      this.cb.onPeerStateChange(remoteId, pc.connectionState);
    };

    // 初期交渉のイニシエータは userId が小さい方に固定(両側で一意に決まる)。
    if (this.selfId < remoteId) {
      void this.createOffer(remoteId, entry);
    }
    return entry;
  }

  private async createOffer(remoteId: string, entry: PeerEntry, opts?: { iceRestart?: boolean }) {
    try {
      const offer = await entry.pc.createOffer(opts?.iceRestart ? { iceRestart: true } : undefined);
      await entry.pc.setLocalDescription(offer);
      this.cb.sendSignal("offer", remoteId, entry.pc.localDescription);
    } catch (e) {
      console.error("[mesh] createOffer failed", remoteId, e);
    }
  }

  async onOffer(from: string, sdp: RTCSessionDescriptionInit) {
    if (this.closed) return;
    let entry = this.peers.get(from);
    // offer を受けた側は必ず answerer。未生成なら生成(offerは作らない=selfId>from のはず)。
    if (!entry) entry = this.addPeer(from);
    try {
      await entry.pc.setRemoteDescription(sdp);
      entry.remoteSet = true;
      await this.flushCandidates(from);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      this.cb.sendSignal("answer", from, entry.pc.localDescription);
    } catch (e) {
      console.error("[mesh] onOffer failed", from, e);
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
      console.error("[mesh] onAnswer failed", from, e);
    }
  }

  async onIce(from: string, candidate: RTCIceCandidateInit) {
    if (this.closed) return;
    const entry = this.peers.get(from);
    if (!entry) return;
    if (!entry.remoteSet) {
      // remoteDescription 未設定の間に来たICEは待避してから適用する。
      entry.pendingCandidates.push(candidate);
      return;
    }
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch (e) {
      console.error("[mesh] addIceCandidate failed", from, e);
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

  destroy() {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }
}
