// Excalidraw の要素配列と Yjs の Y.Map を双方向でつなぐブリッジ。
// 最大の難所は「エコー抑制」: updateScene 由来の onChange を Yjs に書き戻して
// 無限ループさせないこと。要素の version / versionNonce 比較で遮断する。
import * as Y from "yjs";
import { REMOTE_ORIGIN } from "@/app/lib/SupabaseYjsProvider";
import { orderFramesBehindChildren } from "@/app/lib/whiteboardFrames";

// Excalidraw の型は版で import パスが揺れるため緩く扱う。
type El = any; // ExcalidrawElement（version, versionNonce, isDeleted, index を持つ）
type ExcalidrawAPI = { updateScene: (data: { elements?: readonly El[] }) => void };

const LOCAL_ORIGIN = "excalidraw-local";

// Excalidraw要素は points / boundElements / binding など入れ子の配列・オブジェクトを持つ。
// 浅いコピーだと配列が共有参照のままになり、Excalidraw内部のミューテーションとYjs保存が
// 相互汚染して矢印等が壊れる（透明化する）。保存・適用の両方で独立したディープコピーにする。
function clone<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v));
  }
}

// Excalidrawは座標/寸法が 1e7 を超える要素があるとAlt複製を中断する（"invalid dimensions"）。
// 壊れた要素（過去の不正生成の残骸など）を検出して除外/削除するための妥当性チェック。
function okNum(n: any): boolean {
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7;
}
function isValidEl(el: any): boolean {
  if (!el || !okNum(el.x) || !okNum(el.y) || !okNum(el.width) || !okNum(el.height)) {
    // 診断: mermaid由来要素が「不正な寸法」でYjsから落とされる（＝消える）ケースを可視化する。
    if (el?.customData?.wbMermaid) console.warn("[WB診断] mermaid要素の寸法が不正→除外:", el?.id, el?.type, { x: el?.x, y: el?.y, width: el?.width, height: el?.height });
    return false;
  }
  if (Array.isArray(el.points)) {
    for (const p of el.points) {
      if (!Array.isArray(p) || !okNum(p[0]) || !okNum(p[1])) {
        if (el?.customData?.wbMermaid) console.warn("[WB診断] mermaid要素の点が不正→除外:", el?.id, el?.type, el?.points);
        return false;
      }
    }
  }
  return true;
}

export class ExcalidrawYjsBridge {
  private readonly doc: Y.Doc;
  private readonly yElements: Y.Map<El>;
  private api: ExcalidrawAPI | null = null;
  private applyingRemote = false;
  private pendingApply = false;
  /** trueを返す間は外部からの反映を保留（ローカル編集中の割り込みを防ぐ） */
  deferCheck: (() => boolean) | null = null;

  /** リモート反映で要素が置き換わった時に呼ばれる（オーバーレイ再計算用） */
  onRemoteElements?: (elements: El[]) => void;

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.yElements = doc.getMap("elements");
    this.yElements.observe((_event, tr) => {
      if (tr.origin === LOCAL_ORIGIN) return; // 自分の書き込みは反映不要
      this.applyToExcalidraw();
    });
  }

  setApi(api: ExcalidrawAPI) { this.api = api; }

  /** リモート反映（updateScene）由来のonChange中かどうか。自動接続/追従の二重適用を防ぐのに使う。 */
  isApplyingRemote(): boolean { return this.applyingRemote; }

  /** Excalidraw.onChange → Yjs（ローカル編集の伝播） */
  syncFromExcalidraw(elements: readonly El[]) {
    // updateScene由来のonChangeは書き戻さない。適用時にExcalidrawがindex正規化等でversionを
    // 上げることがあり、version比較だけでは弾けず“書き戻し→再配信”の無限ループになるため必須。
    if (this.applyingRemote) return;
    this.doc.transact(() => {
      for (const el of elements) {
        if (!isValidEl(el)) continue; // 壊れた要素は保存しない（汚染の伝播防止）
        const prev = this.yElements.get(el.id) as El | undefined;
        if (
          !prev ||
          el.version > prev.version ||
          (el.version === prev.version && el.versionNonce > prev.versionNonce)
        ) {
          this.yElements.set(el.id, clone(el)); // 独立スナップショットとして保存
        }
      }
    }, LOCAL_ORIGIN);
  }

  /** Y.Map の全要素を配列化（壊れた要素は除外）。適用時も独立コピーを渡す。
   *
   *  重要: Y.Map の反復順は「そのキーを最初に受信した順」で、CRDT のためクライアント毎・
   *  同期タイミング毎に変わり得る。一方 Excalidraw は渡された配列の順＝重なり順(z-order)と解釈し、
   *  順が index と食い違うと index を配列順に上書きする(replaceAllElements→syncInvalidIndices)。
   *  そのまま渡すと各人で重なり順が乖離し、白図形が背面化して“透明化”、余計な version 更新で
   *  同期が荒れる。→ fractional index(文字列)で必ず整列し、決定論的な z-order に揃える。
   *
   *  さらに所属は wbParent(customData) で管理し frameId には依存しないため、フレームが自分の
   *  子孫より背面に来る並び順も orderFramesBehindChildren で保証する（全クライアントで決定的）。 */
  currentElements(): El[] {
    const sorted = Array.from(this.yElements.values())
      .filter(isValidEl)
      .map((el) => clone(el))
      .sort((a, b) => {
        const ai = a.index ?? "", bi = b.index ?? "";
        return ai < bi ? -1 : ai > bi ? 1 : 0;
      });
    return orderFramesBehindChildren(sorted);
  }

  /** 壊れた要素（不正な座標/寸法）をY.Mapから削除。既存の汚染をクリーンにする。 */
  sanitize() {
    const bad: string[] = [];
    this.yElements.forEach((el, id) => { if (!isValidEl(el)) bad.push(id); });
    if (bad.length) {
      this.doc.transact(() => bad.forEach((id) => this.yElements.delete(id)), LOCAL_ORIGIN);
    }
  }

  /** 旧データの移行: ネイティブ frameId を customData.wbParent へ移し、frameId を外す（BRU5-040）。
   *  以後の所属は wbParent 一本に統一し、z-order 再整列で所属が剥がれる不具合を根絶する。
   *  冪等（frameId が無ければ何もしない）なので applyInitial から何度呼んでも安全。 */
  private migrateNativeFrames() {
    const ids: string[] = [];
    this.yElements.forEach((el, id) => { if (el && el.frameId) ids.push(id); });
    if (!ids.length) return;
    this.doc.transact(() => {
      for (const id of ids) {
        const cur = this.yElements.get(id) as El | undefined;
        if (!cur || !cur.frameId) continue;
        const wbParent = cur.customData?.wbParent ?? cur.frameId;
        this.yElements.set(id, {
          ...cur,
          frameId: null,
          customData: { ...(cur.customData ?? {}), wbParent },
          version: (cur.version ?? 1) + 1,
          versionNonce: Math.floor(Math.random() * 0x7fffffff),
        });
      }
    }, LOCAL_ORIGIN);
  }

  /** 永続stateロード後の初回反映（先に汚染を除去し、旧frameIdをwbParentへ移行） */
  applyInitial() { this.sanitize(); this.migrateNativeFrames(); this.applyToExcalidraw(); }

  /** ローカル操作終了時に呼ぶ：保留していた反映を実行 */
  flushPending() {
    if (this.pendingApply) { this.pendingApply = false; this.applyToExcalidraw(); }
  }

  private applyToExcalidraw() {
    if (!this.api) return;
    // ローカル編集中は反映を保留（編集中の要素が外部更新で壊れる/透明化するのを防ぐ）
    if (this.deferCheck?.()) { this.pendingApply = true; return; }
    const elements = this.currentElements();
    this.applyingRemote = true;
    try {
      this.api.updateScene({ elements });
      this.onRemoteElements?.(elements);
    } finally {
      // updateScene直後のonChange1回分をスキップ（エコー抑制）
      requestAnimationFrame(() => { this.applyingRemote = false; });
    }
  }
}
