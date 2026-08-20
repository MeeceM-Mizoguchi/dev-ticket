// Supabase Realtime Broadcast を transport にした自作 Yjs プロバイダ。
// y-websocket サーバを立てず、Yjs の差分updateと awareness(カーソル/チャット) を
// チャンネル `wb:{boardId}` 上で交換する。DBは経由しないため低レイテンシ。
//
// ── Broadcast は「届かないことがある」前提で組む（BRU12-031）──────────────────
// Supabase Realtime の broadcast は ack 無しの at-most-once で、
//   ・クライアント/プロジェクトごとの秒間メッセージ上限を超えた分
//   ・1通あたりのペイロード上限（数百KB）を超えた大きな更新
// が **エラーにもならず黙って捨てられる**。Yjs の update は差分なので1通落ちると、
// それに続く update は受信側で「前提の構造が無い」ため pending のまま永久に適用されない。
// ＝相手の盤面だけが古いまま止まり、以後どれだけ操作しても直らない（要リロード）。
//
// 対策を3つ入れている。
//   1) まとめ送り  : 図形をドラッグしている間 onChange は毎フレーム出る＝毎フレーム1通になる。
//                    SEND_COALESCE_MS ぶん貯めて Y.mergeUpdates で1通に畳み、秒間本数を1/3以下にする。
//   2) 分割送り    : 大きな update は CHUNK_B64 ごとに切って送り、受信側で組み立て直す。
//                    上限超えで丸ごと消える事故を無くす。
//   3) 定期の突き合わせ: RESYNC_MS ごとに自分の state vector を配り、相手に「こちらに無い分」を
//                    送り返してもらう。1)2) をすり抜けて落ちた更新もここで必ず埋まる。
//                    差分が空の相手は返信しないので、静かな時の通信量はほぼゼロ。
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

const SEND_COALESCE_MS = 60;   // ローカル更新をまとめる時間。60ms＝最大でも秒17通に収まる
const RESYNC_MS = 12000;       // 定期の突き合わせ間隔
const CHUNK_B64 = 120_000;     // 1通に載せる base64 の最大長（Realtimeの上限に対して十分小さく取る）
const CHUNK_TTL_MS = 30000;    // 組み立て途中の分割メッセージを捨てるまでの時間

interface ChunkBuf { parts: (string | undefined)[]; got: number; at: number }

export class SupabaseYjsProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private channel: RealtimeChannel;
  private ready = false;
  onSynced?: () => void;
  private syncedFired = false;
  // このプロバイダ固有の送信者ID。self:false が効かない環境でも自分のエコーを確実に無視する。
  private readonly senderId = Math.random().toString(36).slice(2) + Date.now().toString(36);

  private outbox: Uint8Array[] = [];        // まとめ送り待ちのローカル更新
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private chunks = new Map<string, ChunkBuf>(); // 分割メッセージの組み立て中バッファ
  private seq = 0;
  private destroyed = false;

  constructor(client: SupabaseClient, channelName: string, doc: Y.Doc, awareness: Awareness) {
    this.doc = doc;
    this.awareness = awareness;
    this.channel = client.channel(channelName, { config: { broadcast: { self: false, ack: false } } });

    this._onDocUpdate = this._onDocUpdate.bind(this);
    this._onAwarenessUpdate = this._onAwarenessUpdate.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    doc.on("update", this._onDocUpdate);
    awareness.on("update", this._onAwarenessUpdate);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this._onVisibility);

    this.channel
      .on("broadcast", { event: "y-update" }, ({ payload }) => {
        const p = payload as any;
        if (p.s === this.senderId) return; // 自分のエコーは無視
        this._applyUpdate(p.u);
      })
      // 分割された update（大きすぎて1通に載らないもの）。イベント名を分けているのは、
      // この対応が入る前のタブが同じボードを開いていても、断片を丸ごとの update として
      // 適用しようとして壊れないようにするため（知らないイベントは素通りする）。
      .on("broadcast", { event: "y-update-part" }, ({ payload }) => {
        const p = payload as any;
        if (p.s === this.senderId) return;
        const u = this._reassemble(p);
        if (u == null) return;             // 分割の途中（全部揃ってから適用する）
        this._applyUpdate(u);
      })
      .on("broadcast", { event: "y-sync-req" }, ({ payload }) => {
        const p = payload as any;
        if (p.s === this.senderId) return;
        // 相手の state vector に対する差分を返す（後入り参加者の復元・取りこぼしの穴埋め）。
        // 相手が既に最新なら差分は数バイトの空更新になるので、その時は何も送らない
        // （全員が定期的に投げ合うため、これが無いと静かな時でも通信が絶えない）。
        const diff = Y.encodeStateAsUpdate(this.doc, base64ToBytes(p.sv));
        if (diff.length > 2) this._sendUpdate(diff);
        // ask 付き＝相手は「自分に足りない分」を求めている。こちらに足りない分も貰えるよう、
        // 一度だけ折り返しで自分の state vector を送る（ask 無しにして往復を打ち切る）。
        if (p.ask) {
          this._broadcast("y-sync-req", { sv: bytesToBase64(Y.encodeStateVector(this.doc)) });
          this._sendFullAwareness();
        }
      })
      .on("broadcast", { event: "y-awareness" }, ({ payload }) => {
        if ((payload as any).s === this.senderId) return;
        // 壊れた1通でハンドラごと落ちると、以後この画面だけ同期が止まる。必ず飲み込む。
        try { applyAwarenessUpdate(this.awareness, base64ToBytes((payload as any).a), REMOTE_ORIGIN); }
        catch { /* noop */ }
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED" || this.destroyed) return;
        this.ready = true;
        // 参加（および切断からの再参加）時は state vector を配って差分を貰う。
        // 以前はここで自分の全状態を1通で配っていたが、盤面が育つと上限超えで丸ごと落ちるうえ、
        // 相手が既に持っている分まで毎回流していた。要求ベースなら必要な分しか流れない。
        this._broadcast("y-sync-req", { sv: bytesToBase64(Y.encodeStateVector(this.doc)), ask: 1 });
        this._sendFullAwareness();
        if (!this.syncedFired) { this.syncedFired = true; this.onSynced?.(); }
      });

    this.resyncTimer = setInterval(() => this._resync(), RESYNC_MS);
  }

  private _broadcast(event: string, payload: Record<string, unknown>) {
    if (!this.ready || this.destroyed) return;
    void this.channel.send({ type: "broadcast", event, payload: { ...payload, s: this.senderId } });
  }

  /** 受け取った update を適用する。1通の不正で同期が止まらないよう必ず飲み込む。 */
  private _applyUpdate(b64: string) {
    if (typeof b64 !== "string" || !b64) return;
    try { Y.applyUpdate(this.doc, base64ToBytes(b64), REMOTE_ORIGIN); }
    catch { /* 次の定期突き合わせ(_resync)で正しい差分を貰い直す */ }
  }

  /** update を1通で送る。大きい場合は分割して送り、受信側で組み立て直す。 */
  private _sendUpdate(update: Uint8Array) {
    const b64 = bytesToBase64(update);
    if (b64.length <= CHUNK_B64) { this._broadcast("y-update", { u: b64 }); return; }
    const n = Math.ceil(b64.length / CHUNK_B64);
    const id = `${this.senderId}:${this.seq++}`;
    for (let i = 0; i < n; i++) {
      this._broadcast("y-update-part", { u: b64.slice(i * CHUNK_B64, (i + 1) * CHUNK_B64), k: id, i, n });
    }
  }

  /** 分割メッセージを組み立てる。まだ揃っていなければ null。 */
  private _reassemble(p: any): string | null {
    if (!p.k || typeof p.n !== "number" || typeof p.i !== "number") return null;
    const now = Date.now();
    for (const [key, buf] of this.chunks) if (now - buf.at > CHUNK_TTL_MS) this.chunks.delete(key);
    let buf = this.chunks.get(p.k);
    if (!buf) { buf = { parts: new Array(p.n), got: 0, at: now }; this.chunks.set(p.k, buf); }
    if (buf.parts[p.i] === undefined) { buf.parts[p.i] = p.u; buf.got++; }
    if (buf.got < p.n) return null;
    this.chunks.delete(p.k);
    return buf.parts.join("");
  }

  /** 貯めたローカル更新を1通に畳んで送る。 */
  private _flush() {
    if (this.sendTimer) { clearTimeout(this.sendTimer); this.sendTimer = null; }
    if (!this.outbox.length) return;
    const merged = this.outbox.length === 1 ? this.outbox[0] : Y.mergeUpdates(this.outbox);
    this.outbox = [];
    this._sendUpdate(merged);
  }

  /** 定期の突き合わせ。落ちた更新をここで埋める。 */
  private _resync() {
    if (!this.ready || this.destroyed) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return; // 裏のタブでは投げない
    this._broadcast("y-sync-req", { sv: bytesToBase64(Y.encodeStateVector(this.doc)) });
  }

  // タブへ戻った瞬間は、裏にいる間に取りこぼした可能性が高いので即座に突き合わせる。
  private _onVisibility() {
    if (typeof document !== "undefined" && document.visibilityState === "visible") this._resync();
  }

  private _onDocUpdate(update: Uint8Array, origin: unknown) {
    if (origin === REMOTE_ORIGIN) return; // リモート適用のエコーは送らない
    this.outbox.push(update);
    if (!this.sendTimer) this.sendTimer = setTimeout(() => this._flush(), SEND_COALESCE_MS);
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
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this._onVisibility);
    if (this.resyncTimer) { clearInterval(this.resyncTimer); this.resyncTimer = null; }
    this._flush(); // 貯めたままの更新を捨てない（離脱直前の編集が相手へ届かなくなる）
    this.destroyed = true;
    this.chunks.clear();
    // 自分の離脱を「即時」に周知する。これを送らずに購読解除すると、相手側では
    // awareness の30秒タイムアウトまで自分のアバター(ゴースト)が残り続ける。
    // ハンドラを先に外し、ここで削除更新を1回だけ手動送信 → 送信完了を待ってから購読解除する
    // （送信を待たずに unsubscribe すると通知が飛ばずゴーストが残る）。
    const clientId = this.doc.clientID;
    removeAwarenessStates(this.awareness, [clientId], "destroy"); // ローカル状態を削除（metaのclockは進む）
    const finish = () => { void this.channel.unsubscribe(); };
    if (this.ready) {
      const payload = { a: bytesToBase64(encodeAwarenessUpdate(this.awareness, [clientId])), s: this.senderId };
      Promise.resolve(this.channel.send({ type: "broadcast", event: "y-awareness", payload }))
        .catch(() => {})
        .finally(finish);
    } else {
      finish();
    }
  }
}
