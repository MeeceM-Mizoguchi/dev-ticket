// Supabase Realtime Broadcast を transport にした自作 Yjs プロバイダ。
// y-websocket サーバを立てず、Yjs の差分updateと awareness(カーソル/チャット) を
// チャンネル `wb:{boardId}` 上で交換する。DBは経由しないため低レイテンシ。
import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { bytesToBase64, base64ToBytes } from "./whiteboardService";

// リモート由来の適用に使う origin。これで自分のエコー送信を抑止する。
export const REMOTE_ORIGIN = "supabase-yjs-remote";

export class SupabaseYjsProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private channel: RealtimeChannel;
  private ready = false;
  onSynced?: () => void;
  private syncedFired = false;

  constructor(client: SupabaseClient, channelName: string, doc: Y.Doc, awareness: Awareness) {
    this.doc = doc;
    this.awareness = awareness;
    this.channel = client.channel(channelName, { config: { broadcast: { self: false, ack: false } } });

    this._onDocUpdate = this._onDocUpdate.bind(this);
    this._onAwarenessUpdate = this._onAwarenessUpdate.bind(this);
    doc.on("update", this._onDocUpdate);
    awareness.on("update", this._onAwarenessUpdate);

    this.channel
      .on("broadcast", { event: "y-update" }, ({ payload }) => {
        Y.applyUpdate(this.doc, base64ToBytes((payload as any).u), REMOTE_ORIGIN);
      })
      .on("broadcast", { event: "y-sync-req" }, ({ payload }) => {
        // 相手のstate vectorに対する差分を返す（後入り参加者の復元）
        const diff = Y.encodeStateAsUpdate(this.doc, base64ToBytes((payload as any).sv));
        this._broadcast("y-update", { u: bytesToBase64(diff) });
        this._sendFullAwareness();
      })
      .on("broadcast", { event: "y-awareness" }, ({ payload }) => {
        applyAwarenessUpdate(this.awareness, base64ToBytes((payload as any).a), REMOTE_ORIGIN);
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        this.ready = true;
        // 自分の全状態を配布 + 相手の差分を要求 → 全員が収束
        this._broadcast("y-update", { u: bytesToBase64(Y.encodeStateAsUpdate(this.doc)) });
        this._broadcast("y-sync-req", { sv: bytesToBase64(Y.encodeStateVector(this.doc)) });
        this._sendFullAwareness();
        if (!this.syncedFired) { this.syncedFired = true; this.onSynced?.(); }
      });
  }

  private _broadcast(event: string, payload: Record<string, unknown>) {
    if (!this.ready) return;
    void this.channel.send({ type: "broadcast", event, payload });
  }

  private _onDocUpdate(update: Uint8Array, origin: unknown) {
    if (origin === REMOTE_ORIGIN) return; // リモート適用のエコーは送らない
    this._broadcast("y-update", { u: bytesToBase64(update) });
  }

  private _onAwarenessUpdate(
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) {
    if (origin === REMOTE_ORIGIN) return;
    const changed = added.concat(updated).concat(removed);
    this._broadcast("y-awareness", { a: bytesToBase64(encodeAwarenessUpdate(this.awareness, changed)) });
  }

  private _sendFullAwareness() {
    const ids = Array.from(this.awareness.getStates().keys());
    if (ids.length === 0) return;
    this._broadcast("y-awareness", { a: bytesToBase64(encodeAwarenessUpdate(this.awareness, ids)) });
  }

  destroy() {
    this.doc.off("update", this._onDocUpdate);
    this.awareness.off("update", this._onAwarenessUpdate);
    removeAwarenessStates(this.awareness, [this.doc.clientID], "destroy");
    void this.channel.unsubscribe();
  }
}
