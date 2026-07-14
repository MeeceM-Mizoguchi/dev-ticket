// 通話セッションチャンネル `call:{sessionId}` のラッパ。
// - Presence: 参加者roster(誰が今この通話にいるか)を自動追跡する
// - Broadcast: WebRTC の offer/answer/ICE とミュート状態を交換する
// ホワイトボードの SupabaseYjsProvider と同じく、DBを経由しない低レイテンシ交換。
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { sessionChannel, SIGNAL } from "./callConstants";

export interface RosterMember {
  id: string;
  name: string;
  muted: boolean;
}

export interface SignalHandlers {
  onSignal: (event: string, payload: Record<string, unknown>) => void;
  onRoster: (members: RosterMember[]) => void;
}

export class CallSignaling {
  private channel: RealtimeChannel;
  private selfId: string;
  private selfName: string;
  private muted = false;
  // SUBSCRIBED 前の send はサーバーに届かない(realtime-js は REST へフォールバックするが
  // 警告が出るうえセッション次第で失敗する)。購読が完了するまで積んでおき、後でまとめて流す。
  private subscribed = false;
  private queue: { event: string; payload: Record<string, unknown> }[] = [];

  constructor(
    client: SupabaseClient,
    sessionId: string,
    self: { id: string; name: string },
    handlers: SignalHandlers,
  ) {
    this.selfId = self.id;
    this.selfName = self.name;
    this.channel = client.channel(sessionChannel(sessionId), {
      config: { broadcast: { self: false }, presence: { key: self.id } },
    });

    // roster: presence の sync で全参加者を再計算(userId で重複排除)
    this.channel.on("presence", { event: "sync" }, () => {
      const state = this.channel.presenceState<RosterMember>();
      const byId = new Map<string, RosterMember>();
      for (const arr of Object.values(state)) {
        for (const m of arr as unknown as RosterMember[]) {
          if (m && m.id) byId.set(m.id, { id: m.id, name: m.name, muted: !!m.muted });
        }
      }
      handlers.onRoster([...byId.values()]);
    });

    // WebRTC 交渉 & ミュート & 参加ハンドシェイク & 画面共有(ENHA2-030)。to 指定つきは自分宛のみ、
    // to 無し(hello/screenStart/Stop/pointer/annotate)は全員に配られ onSignal へ流れる。
    for (const ev of [
      SIGNAL.offer, SIGNAL.answer, SIGNAL.ice, SIGNAL.mute, SIGNAL.bye,
      SIGNAL.hello, SIGNAL.helloAck,
      SIGNAL.screenStart, SIGNAL.screenStop, SIGNAL.screenOffer, SIGNAL.screenAnswer, SIGNAL.screenIce,
      SIGNAL.pointer, SIGNAL.annotate,
    ]) {
      this.channel.on("broadcast", { event: ev }, ({ payload }) => {
        const p = payload as Record<string, unknown>;
        // 宛先指定がある場合、自分宛以外は無視
        if (p.to && p.to !== this.selfId) return;
        handlers.onSignal(ev, p);
      });
    }

    this.channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        this.subscribed = true;
        void this.channel.track({ id: this.selfId, name: this.selfName, muted: this.muted });
        // 購読前に積まれたシグナルを流してから、参加の挨拶を全員へ送る。
        const queued = this.queue.splice(0);
        for (const q of queued) this.push(q.event, q.payload);
        // presence sync が欠けても相手に気付いてもらえるよう、自分の参加を明示的に告知する(BRU5-066)。
        this.push(SIGNAL.hello, { name: this.selfName });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        this.subscribed = false;
      }
    });
  }

  // offer/answer/ice/mute などを送信(from は常に自分)。購読前はキューに積む。
  send(event: string, payload: Record<string, unknown>) {
    if (!this.subscribed) {
      this.queue.push({ event, payload });
      return;
    }
    this.push(event, payload);
  }

  private push(event: string, payload: Record<string, unknown>) {
    void this.channel.send({ type: "broadcast", event, payload: { ...payload, from: this.selfId } });
  }

  // 参加の挨拶(hello)への返信。相手にだけ届けばよいので to を付ける。
  sendHelloAck(to: string) {
    this.send(SIGNAL.helloAck, { to, name: this.selfName });
  }

  // ミュート状態を presence と broadcast の両方で反映
  setMuted(muted: boolean) {
    this.muted = muted;
    void this.channel.track({ id: this.selfId, name: this.selfName, muted });
    this.send(SIGNAL.mute, { muted });
  }

  destroy() {
    this.subscribed = false;
    this.queue = [];
    void this.channel.untrack();
    void this.channel.unsubscribe();
  }
}
