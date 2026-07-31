// 同一ユーザー・同一ブラウザの複数タブ間で通話状態を調整する。
// 症状: 別タブでも個人着信チャンネルを購読しているため、同じユーザーが複数タブを開くと
// すべてのタブが着信で鳴り、片方で応答しても他タブが鳴りっぱなし(着信受けっぱなし)になる。
//
// 対応:
//  - claimed: あるタブが着信に応答/拒否したら、同一セッションを鳴らしている他タブを止める。
//  - busy   : どこかのタブが通話中の間は、他タブに来た新規着信を鳴らさず自動拒否する。
//             タブを閉じる/通話終了で busy を解除する。異常終了で busy が残った誤検知は、
//             着信時に verifyBusySibling() で生存確認して回避する。
//
// タブ間通信は同一オリジンの BroadcastChannel を使う(DB/ネットワーク不要)。
// 非対応環境(古い WKWebView 等)では黙って無効化し、従来どおり各タブ独立で動く。
type CoordMessage =
  | { type: "busy"; tabId: string; busy: boolean }
  | { type: "claimed"; tabId: string; sessionId: string }
  | { type: "query"; tabId: string };

export interface TabCoordinationHandlers {
  // 別タブが sessionId の着信を処理(応答/拒否)した。自タブが同じ着信を鳴らしていれば止める。
  onClaimed: (sessionId: string) => void;
}

export class CallTabCoordination {
  private bc: BroadcastChannel | null = null;
  private readonly tabId: string;
  private busySiblings = new Set<string>(); // 通話中の別タブ
  private selfBusy = false;

  constructor(userId: string, tabId: string, handlers: TabCoordinationHandlers) {
    this.tabId = tabId;
    if (typeof BroadcastChannel === "undefined") return;
    this.bc = new BroadcastChannel(`dev-ticket-call:${userId}`);
    this.bc.onmessage = (e: MessageEvent<CoordMessage>) => {
      const m = e.data;
      if (!m || m.tabId === this.tabId) return;
      if (m.type === "busy") {
        if (m.busy) this.busySiblings.add(m.tabId);
        else this.busySiblings.delete(m.tabId);
      } else if (m.type === "claimed") {
        handlers.onClaimed(m.sessionId);
      } else if (m.type === "query") {
        // 新規タブ/再確認からの問い合わせ。自分が通話中なら現状を返す。
        if (this.selfBusy) this.post({ type: "busy", tabId: this.tabId, busy: true });
      }
    };
    // 起動時に既存タブの通話状態を同期しておく。
    this.post({ type: "query", tabId: this.tabId });
  }

  private post(m: CoordMessage) { this.bc?.postMessage(m); }

  // 自タブの通話中フラグを更新(変化時のみブロードキャスト)。
  setBusy(busy: boolean) {
    if (this.selfBusy === busy) return;
    this.selfBusy = busy;
    this.post({ type: "busy", tabId: this.tabId, busy });
  }

  // 着信に応答/拒否したことを他タブへ通知し、同一セッションの呼び出しを止めさせる。
  claim(sessionId: string) {
    this.post({ type: "claimed", tabId: this.tabId, sessionId });
  }

  // いずれかの別タブが通話中か(受信済みスナップショットによる即時判定)。
  hasBusySibling() { return this.busySiblings.size > 0; }

  // 別タブが本当に通話中かを問い合わせ、timeoutMs 待って再判定する。
  // (異常終了で busy が残ったタブの誤検知＝正常時の着信取りこぼしを防ぐ)。
  async verifyBusySibling(timeoutMs: number): Promise<boolean> {
    if (!this.bc) return false;
    this.busySiblings.clear();
    this.post({ type: "query", tabId: this.tabId });
    await new Promise((r) => setTimeout(r, timeoutMs));
    return this.busySiblings.size > 0;
  }

  destroy() {
    this.setBusy(false);
    this.bc?.close();
    this.bc = null;
  }
}
