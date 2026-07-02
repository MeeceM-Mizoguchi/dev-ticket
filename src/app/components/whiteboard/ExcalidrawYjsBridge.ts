// Excalidraw の要素配列と Yjs の Y.Map を双方向でつなぐブリッジ。
// 最大の難所は「エコー抑制」: updateScene 由来の onChange を Yjs に書き戻して
// 無限ループさせないこと。要素の version / versionNonce 比較で遮断する。
import * as Y from "yjs";
import { REMOTE_ORIGIN } from "@/app/lib/SupabaseYjsProvider";

// Excalidraw の型は版で import パスが揺れるため緩く扱う。
type El = any; // ExcalidrawElement（version, versionNonce, isDeleted, index を持つ）
type ExcalidrawAPI = { updateScene: (data: { elements?: readonly El[] }) => void };

const LOCAL_ORIGIN = "excalidraw-local";

export class ExcalidrawYjsBridge {
  private readonly doc: Y.Doc;
  private readonly yElements: Y.Map<El>;
  private api: ExcalidrawAPI | null = null;
  private applyingRemote = false;

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

  /** Excalidraw.onChange → Yjs（ローカル編集の伝播） */
  syncFromExcalidraw(elements: readonly El[]) {
    if (this.applyingRemote) return; // updateScene由来のonChangeは書き戻さない
    this.doc.transact(() => {
      for (const el of elements) {
        const prev = this.yElements.get(el.id) as El | undefined;
        if (
          !prev ||
          el.version > prev.version ||
          (el.version === prev.version && el.versionNonce > prev.versionNonce)
        ) {
          this.yElements.set(el.id, { ...el });
        }
      }
    }, LOCAL_ORIGIN);
  }

  /** Y.Map の全要素を配列化（Excalidraw は index で自動ソート） */
  currentElements(): El[] {
    return Array.from(this.yElements.values());
  }

  /** 永続stateロード後の初回反映 */
  applyInitial() { this.applyToExcalidraw(); }

  private applyToExcalidraw() {
    if (!this.api) return;
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
