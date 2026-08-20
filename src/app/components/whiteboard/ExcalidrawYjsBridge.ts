// Excalidraw の要素配列と Yjs の Y.Map を双方向でつなぐブリッジ。
// 最大の難所は「エコー抑制」: updateScene 由来の onChange を Yjs に書き戻して
// 無限ループさせないこと。要素の version / versionNonce 比較で遮断する。
import * as Y from "yjs";
import { REMOTE_ORIGIN } from "@/app/lib/SupabaseYjsProvider";
import { orderFramesBehindChildren } from "@/app/lib/whiteboardFrames";
import { NO_HISTORY } from "@/app/lib/whiteboardHistory";
import { tileTables } from "@/app/lib/whiteboardTable";
import { getEditingTextEl } from "@/app/lib/whiteboardText";

// Excalidraw の型は版で import パスが揺れるため緩く扱う。
type El = any; // ExcalidrawElement（version, versionNonce, isDeleted, index を持つ）
type ExcalidrawAPI = {
  updateScene: (data: { elements?: readonly El[]; captureUpdate?: string }) => void;
  getSceneElements?: () => readonly El[];
  getSceneElementsIncludingDeleted?: () => readonly El[];
};

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
  private applyRaf = 0;
  /** trueを返す間は外部からの反映を保留（ローカル編集中の割り込みを防ぐ） */
  deferCheck: (() => boolean) | null = null;

  /** リモート反映で要素が置き換わった時に呼ばれる（オーバーレイ再計算用） */
  onRemoteElements?: (elements: El[]) => void;

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.yElements = doc.getMap("elements");
    this.yElements.observe((_event, tr) => {
      if (tr.origin === LOCAL_ORIGIN) return; // 自分の書き込みは反映不要
      this.scheduleApply();
    });
  }

  setApi(api: ExcalidrawAPI) { this.api = api; }

  /** 反映は1フレームに1回へ束ねる（BRU11-051）。
   *  リモートの1操作は「相手の onChange 1回＝ブロードキャスト1通」なので、相手がドラッグしている間は
   *  1フレームに何通も届く。届くたびに applyToExcalidraw を回すと、全要素のディープコピー＋整列＋
   *  表のタイル＋シーン全置換を1フレームに何度もやることになり、重い盤面ではコマ落ち＝ちらつきになる。
   *  Y.Doc は既に最新なので、束ねても失われる更新は無い（最後に1回、最新状態を反映するだけ）。 */
  private scheduleApply() {
    if (this.applyRaf) return;
    if (typeof requestAnimationFrame !== "function") { this.applyToExcalidraw(); return; }
    this.applyRaf = requestAnimationFrame(() => { this.applyRaf = 0; this.applyToExcalidraw(); });
  }

  /** 購読解除時に保留中の反映を捨てる（アンマウント後のシーン更新を防ぐ）。 */
  destroy() {
    if (this.applyRaf) { cancelAnimationFrame(this.applyRaf); this.applyRaf = 0; }
    this.api = null;
  }

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

  /**
   * 描きかけのまま消えた新規要素を Yjs から取り消す（BRU12-031）。
   *
   * 図形ツールでクリックしただけ／描いている途中に Esc を押した場合、Excalidraw はその要素を
   * **tombstone を残さずシーンから丸ごと取り除く**。ところが描いている間の onChange は既に
   * Y.Map へ書き込まれているため、Yjs 側にはその要素が残る。単独作業なら反映が走らないので
   * 表に出ないが、共同編集では相手の操作が届くたびにシーンを Y.Map で置き換えるため、
   * 「消したはずの豆粒サイズの図形が勝手に生えてくる」ことになる。
   *
   * 「描画中だった要素が、確定もされず tombstone も無く消えた」時だけ取り消す。
   * 削除は tombstone(isDeleted) として残るので、この経路で消えることはない。
   */
  dropIfAbsent(id: string) {
    if (!id || !this.yElements.has(id)) return;
    const local = (this.api?.getSceneElementsIncludingDeleted?.() ?? this.api?.getSceneElements?.()) as El[] | undefined;
    if (!local) return;                                  // 判定材料が無い時は触らない
    if (local.some((e) => e.id === id)) return;          // 確定済み／削除済みとして在る
    this.doc.transact(() => { this.yElements.delete(id); }, LOCAL_ORIGIN);
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
        if (ai !== bi) return ai < bi ? -1 : 1;
        // index が同値になることがある（2人が同時に要素を作ると、Excalidraw の採番は決定的なので
        // 別々の要素へ同じ index 文字列が振られる）。Y.Map の反復順は受信順＝人によって違うため、
        // ここで畳むと重なり順が人ごとにズレ、双方が index を振り直して押し合う（＝ちらつく）。
        // Excalidraw 本家の orderByFractionalIndex と同じく id で決着させ、全員同じ順にする。
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
    // 【BRU11-051】最後に表のタイル（列幅・行高・セル位置・折り返し）を**適用してから**返す。
    // 表のレイアウトは内容から導出する派生値で Yjs へは流れない（reflowTables は版を上げないため
    // version 比較のブリッジを通らない）。つまり Y.Map のセル座標はタイル前の生の座標で、これを
    // そのまま反映すると「崩れた表が一瞬見えてから onChange 駆動の reflow が整え直す」＝相手が
    // 操作するたびにチカチカする。特に列/行を追加した直後は、新しいセルがテンプレセルの座標に
    // 重なったまま同期されるため崩れが大きい（追加した列が既存の列を覆って見えなくなる）。
    // ここで先に整えておけば崩れた状態は一度も描画されず、派生値をローカルで作る設計も保てる。
    return tileTables(orderFramesBehindChildren(sorted), this.api);
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

  /**
   * 文字を入力している最中の要素（テキストとそのコンテナ）だけ、ローカルの実体を残す（BRU11-051）。
   *
   * Excalidraw はテキスト編集中 onChange を出さない＝入力内容も、それに追従して伸びた図形の高さも、
   * 確定するまで Yjs へ流れない。一方リモート反映はシーンを丸ごと置き換えるため、相手が何か操作する
   * たびに「入力中の図形が入力前の高さ・文字へ一瞬戻る」＝入力しながら箱がガタつく（表のセルは
   * tileTables が textarea の生値から組み直すので無事だが、素の図形のラベルはこれが必要）。
   * 反映のたびにローカルを残せば、Excalidraw のエディタと取り合いにならない。
   * ※相手がその要素を削除した場合は素直に削除を受け入れる（残して復活させない）。
   */
  private keepLocalEditing(elements: El[]): El[] {
    const ta = document.querySelector(".excalidraw-wysiwyg") as HTMLElement | null;
    if (!ta || ta.offsetParent === null) return elements;
    const editEl: any = getEditingTextEl() ?? (this.api as any)?.getAppState?.()?.editingTextElement;
    const textId: string | undefined = editEl?.id;
    if (!textId) return elements;
    const local = (this.api?.getSceneElementsIncludingDeleted?.() ?? this.api?.getSceneElements?.() ?? []) as El[];
    const byId = new Map<string, El>(local.map((e) => [e.id, e]));
    const text = byId.get(textId);
    if (!text) return elements;
    const keep = new Set<string>([textId]);
    if (text.containerId) keep.add(text.containerId);
    return elements.map((e) => (keep.has(e.id) && !e.isDeleted ? (byId.get(e.id) ?? e) : e));
  }

  private applyToExcalidraw() {
    if (!this.api) return;
    // ローカル編集中は反映を保留（編集中の要素が外部更新で壊れる/透明化するのを防ぐ）
    if (this.deferCheck?.()) { this.pendingApply = true; return; }

    // 反映は「Y.Map の中身でシーンを丸ごと置き換える」ので、まだ Y.Map に無いローカル要素は消滅する。
    // ローカル操作中(pointerdown)は反映が保留され、pointerup 直後に flushPending でここへ来るため、
    // 「Alt/Optionドラッグで複製した図形」「引いたばかりの矢印」など“操作中に生まれた要素”が、
    // その onChange が applyingRemote のスキップ窓に重なって未同期だと、離した瞬間に消えてしまう。
    // → 置き換える前に、現在のシーンを必ず Y.Map へ取り込んでから反映する（BRU5-067）。
    //   syncFromExcalidraw は version/versionNonce 比較なので、リモートの新しい更新を巻き戻すことはない。
    // 削除済み要素も含めて取り込む（BRU7-058）。getSceneElements() は tombstone を含まないため、
    // 保留中に消した要素の「削除」が Y.Map へ伝わらず、直後の置き換えで復活してしまう。
    const local = (this.api.getSceneElementsIncludingDeleted?.() ?? this.api.getSceneElements?.());
    if (local?.length) this.syncFromExcalidraw(local);

    const elements = this.keepLocalEditing(this.currentElements());
    this.applyingRemote = true;
    try {
      // 【BRU7-058】リモート反映は絶対に履歴へ載せない（captureUpdate: NEVER）。
      // 既定は EVENTUALLY で、これは「次にローカルで行った操作の履歴エントリへ混入する」動作。
      // つまり他メンバーの編集が自分の undo スタックに紛れ込み、**自分の Ctrl+Z が
      // 他人の編集を巻き戻してしまう**。初回反映（sanitize / frameId→wbParent 移行）も同様に、
      // 履歴へ載せてはいけない下地の更新なのでここで一括して NEVER にする。
      this.api.updateScene({ elements, captureUpdate: NO_HISTORY.captureUpdate });
      this.onRemoteElements?.(elements);
    } finally {
      // updateScene直後のonChange1回分をスキップ（エコー抑制）
      requestAnimationFrame(() => { this.applyingRemote = false; });
    }
  }
}
