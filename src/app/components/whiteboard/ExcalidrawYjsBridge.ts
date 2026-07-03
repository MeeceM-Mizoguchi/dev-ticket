// Excalidraw の要素配列と Yjs の Y.Map を双方向でつなぐブリッジ。
// 最大の難所は「エコー抑制」: updateScene 由来の onChange を Yjs に書き戻して
// 無限ループさせないこと。要素の version / versionNonce 比較で遮断する。
import * as Y from "yjs";
import { REMOTE_ORIGIN } from "@/app/lib/SupabaseYjsProvider";

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
  if (!el || !okNum(el.x) || !okNum(el.y) || !okNum(el.width) || !okNum(el.height)) return false;
  if (Array.isArray(el.points)) {
    for (const p of el.points) {
      if (!Array.isArray(p) || !okNum(p[0]) || !okNum(p[1])) return false;
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
    if (this.applyingRemote) return; // updateScene由来のonChangeは書き戻さない
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

  /** Y.Map の全要素を配列化（壊れた要素は除外）。適用時も独立コピーを渡す。 */
  currentElements(): El[] {
    return Array.from(this.yElements.values()).filter(isValidEl).map((el) => clone(el));
  }

  /** 壊れた要素（不正な座標/寸法）をY.Mapから削除。既存の汚染をクリーンにする。 */
  sanitize() {
    const bad: string[] = [];
    this.yElements.forEach((el, id) => { if (!isValidEl(el)) bad.push(id); });
    if (bad.length) {
      this.doc.transact(() => bad.forEach((id) => this.yElements.delete(id)), LOCAL_ORIGIN);
    }
  }

  /** 永続stateロード後の初回反映（先に汚染を除去） */
  applyInitial() { this.sanitize(); this.applyToExcalidraw(); }

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
      // updateScene直後のonChange1回分をスキップ
      requestAnimationFrame(() => { this.applyingRemote = false; });
    }
  }
}
