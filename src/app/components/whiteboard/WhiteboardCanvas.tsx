// Excalidraw キャンバス本体（遅延ロードされる重量コンポーネント）。
// useWhiteboardSync でリアルタイム同期し、フロー接続・カーソルチャット・エクスポートの
// 各オーバーレイを重ねる。画像は Storage にアップロードして fileId→URL を Yjs で共有する。
import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useWhiteboardSync, type WbUser } from "@/app/hooks/useWhiteboardSync";
import { uploadWhiteboardImage } from "@/app/lib/whiteboardService";
import { autoConnectLines, foldSelectedConnectors, followTriangleConnections, healBrokenElbowArrows, isConnectableShape, reconnectDraggedConnectors, remapDuplicatedCustomRefs, remapDuplicatedShapeAnchors, repairOpenTriangles, shapeSig, suppressTrianglePointEditing, unfoldSelectedConnectors, type DupPlan } from "@/app/lib/whiteboardAutoConnect";
import { captureFrameChildren, followFrameMoves, reparentDraggedElements } from "@/app/lib/whiteboardFrames";
import { syncTextBoxBgRects } from "@/app/lib/whiteboardTextBoxBg";
import { syncFrameDecorRects } from "@/app/lib/whiteboardFrameBg";
import { healEscapedBoundText } from "@/app/lib/whiteboardBoundText";
import { pinBoundTextColor } from "@/app/lib/whiteboardTextColor";
import { isConnectSuppressed } from "@/app/lib/whiteboardNoConnect";
import { isHistoryGestureActive } from "@/app/lib/whiteboardHistory";
import { reflowTables, freezeSelectedTable } from "@/app/lib/whiteboardTable";
import { getEditingTextEl, setEditingTextEl } from "@/app/lib/whiteboardText";
import { reflowBoundTextShapes, freezeSelectedShapeHeights } from "@/app/lib/whiteboardShapeFit";
import { copySelectionAsImage } from "@/app/lib/whiteboardCopySelection";
import { handleIndentKey } from "@/app/lib/whiteboardIndent";
import { CursorChatLayer } from "./CursorChatLayer";
import { FlowConnectOverlay } from "./FlowConnectOverlay";
import { WhiteboardExportMenu } from "./WhiteboardExportMenu";
import { WhiteboardToolbar } from "./WhiteboardToolbar";
import { TriangleToolButton } from "./TriangleToolButton";
import { MermaidToolButton } from "./MermaidToolButton";
import { TableToolButton } from "./TableToolButton";
import { TableResizeOverlay } from "./TableResizeOverlay";
import { TableRowColControls } from "./TableRowColControls";
import { SnapGuideLayer } from "./SnapGuideLayer";
import { TriangleBindHint } from "./TriangleBindHint";
import { FrameHighlightLayer } from "./FrameHighlightLayer";
import { FrameFormatPanel } from "./FrameFormatPanel";
import { TextBoxFormatPanel } from "./TextBoxFormatPanel";
import { TextColorPanel } from "./TextColorPanel";
import { ConnectorFormatPanel } from "./ConnectorFormatPanel";
import { ConnectorViaOverlay } from "./ConnectorViaOverlay";
import { HelpButton } from "./HelpButton";
import { FullscreenButton } from "./FullscreenButton";

// Excalidraw標準のハンバーガーメニュー/ヘルプ(?)/コラボボタンを非表示にする
// （メニューは自前、ヘルプは右上アイコンに一本化、コラボは独自Yjs同期を使うため不要）
const HIDE_EXCALIDRAW_CHROME = `
.excalidraw .main-menu-trigger,
.excalidraw .dropdown-menu-button,
.excalidraw .collab-button,
.excalidraw .default-sidebar-trigger,
.excalidraw .help-icon { display: none !important; }
/* HelpDialog(キーボードショートカット一覧)ヘッダーの外部リンク
   （ドキュメント/公式ブログ/不具合報告(GitHub)/YouTube）を非表示にする（BRU5-061）。
   ショートカット一覧本体は残す。 */
.excalidraw .HelpDialog__header { display: none !important; }
/* Excalidraw標準UI(layer-ui, 既定z-index:4)を、フレーム枠線canvas(z-index:4)や
   ハイライト(5)より前面へ。標準プロパティパネル等が枠線の裏に隠れるのを防ぐ(BRU4-054)。 */
.excalidraw .layer-ui__wrapper { z-index: 6 !important; }
/* 標準の「Arrow type」欄は丸ごと隠す（BRU5-085）。
   線の形（直線/折れ線）は自前パネル(ConnectorFormatPanel)で選ぶ。棒(line)にも効き、
   角丸/角ありも選べるため、矢印にしか出ない標準の Arrow type は役目を終えた。 */
.excalidraw .App-menu__left fieldset:has(input[data-testid="elbow-arrow"]) { display: none !important; }
/* 標準の左パネル(island)を上部ツールバーの下へ下げる（BRU5-084）。
   Excalidraw はツールバーを中央寄せ・左パネルを左上に置くため、ホワイトボードの表示幅が狭いと
   中央のツールバーが左パネルの上に被さる。左パネルの上端をツールバーの高さ分だけ下げて重なりを解消する。 */
.excalidraw .App-menu__left { margin-top: 52px !important; }
`;

// FigJam/Miro風のクリーンな既定スタイル（手描き効果オフ・通常フォント・細線・ソフトな黒）
const SOFT_BLACK = "#343a40"; // 真っ黒(#1e1e1e)より柔らかいダークグレー
const CLEAN_DEFAULTS = {
  appState: {
    currentItemRoughness: 0,     // 0 = クリーンな直線（手描きのいびつさを排除）
    // 既定の角を「角丸」ではなく「角あり(sharp)」に。Excalidrawの既定は round のため上書きする。
    currentItemRoundness: "sharp",   // 四角/ひし形/楕円/線 → 角あり。線を曲げた時も丸めず角ばる
    currentItemArrowType: "sharp",   // 矢印 → 曲げた時に曲線化(round)せず角ばる。elbowは別途選択可
    currentItemFontFamily: 2,    // 2 = Helvetica（通常フォント）。5=Excalifont(手書き)を避ける
    currentItemStrokeWidth: 1,   // 1 = 細（矢じりも線幅に比例して小さくなる）
    currentItemStrokeColor: SOFT_BLACK,
    // 図形の既定背景色は白（透明だと重なった図形が透けるため、既定で不透明の白に）
    currentItemBackgroundColor: "#ffffff",
    // 既定の矢じりを小さめの塗り三角に（"arrow"=固定25に対し "triangle"=15でコンパクト・BRU4-051）
    currentItemEndArrowhead: "triangle",
    // 図形ガイド（ENHA2-022）: 他図形に近づくと整列ガイド線を表示し、
    // 多少の手ブレを吸収してエッジ/中心にスナップさせる。上下左右で発動。
    // updateScene は elements/collaborators のみ渡すため、このフラグはリモート更新で消えない。
    objectsSnapModeEnabled: true,
    // 背景は白（不透明）。フレーム書式の背景/枠線は実要素(rectangle)で描くようになったため
    // （BRU5-063・syncFrameDecorRects）、以前のように透明にして下層canvasで描く必要がなくなった。
    // 白にすることで exportToBlob/Svg・標準の右クリックPNGコピーも白背景で書き出される。
    viewBackgroundColor: "#ffffff",
    // Excalidraw標準のフレーム枠線(グレー)は非表示にする。枠線/背景は装飾矩形で描くため、
    // 標準枠を出すと二重枠になる（BRU5-063）。名前ラベルは残す。ネイティブclipは未使用(frameIdは
    // 使わずwbParentで所属管理)なのでclipも無効にしておく。
    frameRendering: { enabled: true, name: true, outline: false, clip: false },
  },
};

/**
 * 要素の“取りこぼし”防止ガード（BRU5-067）。
 *
 * api.updateScene({elements}) は「渡した配列でシーンを丸ごと置き換える」API。
 * そのため呼び出し側が少しでも古い配列を掴んでいると、その後に生まれた要素——
 * Option/Altドラッグで複製した図形、引き終えたばかりの矢印——が黙って消える。
 * 実際「複製した／矢印を引いた直後、離すと消える」という事故が起きていた。
 *
 * ここで全ての updateScene を包み、「現在のシーンには在るのに渡された配列に無い要素」を
 * 検出して末尾へ復元する。どこか一箇所が古い配列を渡しても、要素が失われることは無くなる。
 * 併せてどの呼び出しが落としかけたかを警告として出す（原因箇所の特定用）。
 * ※本当に削除された要素は getSceneElements() に現れないので、復活してしまうことは無い。
 *
 * ── undo が正しく戻らない問題の根本対策（BRU7-058）───────────────────────────
 * Excalidraw の updateScene は captureUpdate を省略すると CaptureUpdateAction.EVENTUALLY
 * （＝履歴のスナップショットを進めない）になる。履歴の増分は commit 時に
 * 「前回スナップショット ↔ 現在のシーン」を丸ごと差分して作られるため、captureUpdate を
 * 指定しない更新は **次にユーザーが行った操作の履歴エントリへ丸ごと混入する**。
 *
 *   capture(操作A1) → ヘルパー書き込みH1 → capture(操作A2) → …
 *   履歴エントリ(A2) = H1 + A2
 *
 * つまり Ctrl+Z 一回が「直前の操作」だけでなく「その1つ前の操作で走った自動コネクト処理」まで
 * 巻き戻していた。矢印を引いた直後の接続確定（triStart/triEnd の記録・端点の吸着・折れ線の
 * 点列）は必ず描画の capture 後に走るので、次の操作を undo した瞬間にコネクト情報ごと消え、
 * forceAnchor（記録どおりに復元するモード）にも復元材料が無くなる＝接続が永久に失われる。
 *
 * → 自動導出（追従・自動接続・再レイアウト・リモート反映）の更新は履歴に載せてはいけない。
 *   captureUpdate 未指定の更新は NEVER を既定にし、スナップショットだけを進める。
 *   ユーザー操作そのもの（書式パネル・図形追加・折れ点ドラッグの確定など）は
 *   呼び出し側で明示的に IMMEDIATELY を渡し、1操作＝1undo ステップにする。
 *
 * ※ NEVER でもドラッグ中の要素が undo 不能になることはない。Excalidraw 側の
 *   filterUncomittedElements が「ローカルで未コミットの変更を持つ要素」をスナップショット更新
 *   から自動的に除外するため、ユーザーが操作中の要素は元の値のまま保たれる。
 */
function guardApi(api: any): any {
  if (!api || api.__wbGuarded) return api;
  const orig = api.updateScene.bind(api);

  // 「現在のシーンには在るのに渡された配列に無い要素」を末尾へ復元してから適用する（BRU5-067）。
  //
  // 【BRU7-058】削除済み要素（tombstone）も復元対象に含める。
  // 多くのヘルパーはシーンを api.getSceneElements() から組み立てるが、この API は
  // **削除済み要素を含まない**。その配列をそのまま updateScene へ渡すと、削除済み要素が
  // シーンから丸ごと消える＝Excalidraw の履歴スナップショットからも落ちる。
  // すると「図形を削除 → 折れ線化などヘルパーが走る操作 → Ctrl+Z を戻していく」と、
  // 削除した図形が二度と復活しなくなる（復元元の tombstone が失われるため）。
  // ここで拾い直せば全ての呼び出し元をまとめて安全にできる。
  // ※ヘルパー側の削除は必ず isDeleted:true を立てて配列に残す実装なので、
  //   ここで戻しても「消したはずのものが復活する」ことはない。
  const applyGuarded = (data: any) => {
    if (data?.elements) {
      const incoming = new Set<string>(data.elements.map((e: any) => e.id));
      const current = (api.getSceneElementsIncludingDeleted?.() ?? api.getSceneElements()) as any[];
      const missing = current.filter((e) => !incoming.has(e.id));
      if (missing.length) {
        const live = missing.filter((m) => !m.isDeleted);
        if (live.length) {
          console.warn("[WB-LOST] updateScene が要素を落としかけたので復元:", live.map((m) => `${m.type}:${m.id.slice(0, 6)}`).join(", "));
        }
        data = { ...data, elements: [...data.elements, ...missing] };
      }
    }
    return orig(data);
  };

  // ── React #185(Maximum update depth exceeded)対策（BRU7-043）─────────────────
  // Excalidraw は componentDidUpdate の中（＝commitフェーズ）から onChange を同期的に呼ぶ。
  // その onChange 内でヘルパーが api.updateScene を呼ぶと setState→componentDidUpdate→onChange
  // →updateScene… と“同期の入れ子更新”になり、収束に必要な tick 数だけネストが深くなる。
  // 複数図形の Alt 複製では要素数×ヘルパー数ぶん tick が要り、容易に 50 段を超えて React が
  // #185 を投げ、（ErrorBoundary が無いため）画面が真っ白になっていた。
  //
  // → onChange 実行中(__wbSetDefer(true))の updateScene は同期適用せず rAF に集約し、commit の
  //   外で1回だけ適用する。各更新は毎回トップレベルから始まるため React の入れ子にならず、
  //   #185 は原理的に起こらない。収束は同じ tick 数を「ネスト」ではなく「フレーム跨ぎ」で行う。
  //   ※各ヘルパーは1 tickにつき高々1回しか updateScene しない設計（busyゲート）なので、
  //     last-write-wins の集約で更新が失われることはない（未反映分は次tickで再評価される）。
  let deferring = false;
  let pending: any = null;
  let rafId = 0;
  let flushStreak = 0;                 // 自己駆動 flush の連続回数（暴走の保険）
  const MAX_FLUSH_STREAK = 300;

  const flush = () => {
    rafId = 0;
    const data = pending; pending = null;
    if (!data) return;
    if (flushStreak++ > MAX_FLUSH_STREAK) {
      console.warn("[WB-GUARD] onChange 由来の updateScene が収束しないため保留分を破棄しました");
      return; // 保留を捨てて自己駆動ループを止める（次のユーザー/リモート操作で復帰）
    }
    applyGuarded(data);   // ← commitフェーズ外(rAF)で実行。入れ子更新にならず #185 を防ぐ
  };

  api.updateScene = (raw: any) => {
    // captureUpdate 未指定＝自動導出の更新とみなし、履歴には載せない（BRU7-058・上の説明を参照）。
    // ただし自前オーバーレイのドラッグ中だけは EVENTUALLY にする。NEVER でスナップショットを
    // 進めてしまうと、離した時の IMMEDIATELY が差分ゼロになり“そのドラッグが undo できない”。
    // 保留へ積む前に正規化しておく（集約で他の呼び出しの captureUpdate を引き継がないようにする）。
    const data = raw && raw.captureUpdate === undefined
      ? { ...raw, captureUpdate: isHistoryGestureActive() ? CaptureUpdateAction.EVENTUALLY : CaptureUpdateAction.NEVER }
      : raw;
    if (deferring) {
      // onChange(commitフェーズ)内の更新は rAF へ集約（elements/appState を last-write-wins）
      pending = pending ? { ...pending, ...data } : data;
      if (!rafId) rafId = requestAnimationFrame(flush);
      return;
    }
    flushStreak = 0;      // 同期(ユーザー/リモート/オーバーレイ)更新が来たら収束カウンタをリセット
    return applyGuarded(data);
  };

  api.__wbSetDefer = (v: boolean) => { deferring = v; };
  api.__wbGuarded = true;
  return api;
}

interface Props {
  boardId: string;
  title: string;
  user: WbUser;
  canEdit: boolean;
}

const CURSOR_THROTTLE_MS = 30;
const UNDO_GRACE = 300;      // undo/redo 直後に「記録どおりのアンカーへ復元」する猶予(ms)
const UNDO_MAX_GRACE = 3000; // 収束しない時に猶予窓を開きっぱなしにしない絶対上限(ms)

export default function WhiteboardCanvas({ boardId, title, user, canEdit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<any>(null);
  const [pseudoFull, setPseudoFull] = useState(false); // iPad等でネイティブFS非対応時のCSS全画面
  const [copyToast, setCopyToast] = useState<string | null>(null); // 選択コピーの結果トースト
  const copyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [foldMode, setFoldMode] = useState(false); // 折れ矢印モード（トグル・BRU5-064）
  const foldModeRef = useRef(false);               // onChangeから参照する用（stale回避）
  const shiftRef = useRef(false);                  // Shift押下中か
  const foldReqIds = useRef<Set<string>>(new Set()); // 折れ矢印にする要求idの控え
  const lastPointerScene = useRef<{ x: number; y: number } | null>(null); // 直近カーソル(scene座標)
  const undoUntil = useRef(0);                     // undo/redo 直後の猶予期限(ms)。この間は接続を記録どおり復元する（BRU5-066）
  const undoHardUntil = useRef(0);                 // 猶予窓の絶対上限（窓が開きっぱなしになるのを防ぐ・BRU7-058）
  const preDragSig = useRef<Map<string, string>>(new Map()); // pointerdown時点の図形geometry署名（Alt複製の付け替え判定用・BRU5-068）
  const preDragIds = useRef<Set<string>>(new Set());         // pointerdown時点の全要素id（このドラッグで生まれた複製の判別用・BRU7-043）
  const onChangeDepth = useRef(0);                           // onChangeの同期再入深度（#185保険・BRU7-043）
  const pointerUpPending = useRef(false);          // 直前にポインタを離したか（端点ドラッグの繋ぎ直し評価用・BRU5-073）
  const pointerDownNow = useRef(false);            // ポインタを押している最中か（Ctrl抑止をポインタ操作にだけ効かせる・BRU7-056-4）
  const endpointDragId = useRef<string | null>(null); // 端点つまみをドラッグ中／直前にドラッグした線のid（BRU7-056-4）
  const lastCursor = useRef(0);
  const lastViewport = useRef(0);
  const lastVpSig = useRef(""); // 直近に配信したビューポート署名（無変化時の配信抑制）
  const uploadedFiles = useRef<Set<string>>(new Set());
  const addedRemoteFiles = useRef<Set<string>>(new Set());

  const {
    bridgeRef, docRef, registerApi, remoteChats, setCursor, setChat, docLoaded,
    setViewport, snapToFollowed, isApplyingFollow,
  } = useWhiteboardSync(boardId, user);
  // ※他メンバーのカーソル反映は useWhiteboardSync 内で命令的に updateScene するため、ここでは扱わない
  //   （Reactの再レンダーを避け、ドラッグ/複製やExcalidraw内部の動作を妨げないため）

  // 画像ファイルの共有（ローカル→Storage→Yjs files map）
  const syncLocalImages = useCallback(async () => {
    if (!api || !docRef.current) return;
    const files = api.getFiles() as Record<string, any>;
    const fmap = docRef.current.getMap("files");
    for (const id of Object.keys(files)) {
      if (uploadedFiles.current.has(id) || fmap.get(id)) { uploadedFiles.current.add(id); continue; }
      uploadedFiles.current.add(id);
      const f = files[id];
      const url = await uploadWhiteboardImage(boardId, f.dataURL);
      if (url) fmap.set(id, { id, url, mimeType: f.mimeType });
    }
  }, [api, boardId, docRef]);

  // リモートの画像を取得して Excalidraw に投入
  useEffect(() => {
    const doc = docRef.current;
    if (!api || !doc) return;
    const fmap = doc.getMap("files");
    const resolve = async () => {
      const local = api.getFiles() as Record<string, any>;
      fmap.forEach(async (v: any, id: string) => {
        if (local[id] || addedRemoteFiles.current.has(id)) return;
        addedRemoteFiles.current.add(id);
        try {
          const res = await fetch(v.url);
          const blob = await res.blob();
          const dataURL: string = await new Promise((ok, ng) => {
            const fr = new FileReader(); fr.onload = () => ok(fr.result as string); fr.onerror = ng; fr.readAsDataURL(blob);
          });
          api.addFiles([{ id, dataURL, mimeType: v.mimeType || blob.type, created: Date.now() }]);
        } catch { addedRemoteFiles.current.delete(id); }
      });
    };
    resolve();
    fmap.observe(resolve);
    return () => fmap.unobserve(resolve);
  }, [api, docRef]);

  // IME変換確定のEnterでフレーム名/テキスト編集が終わってしまう問題の対策。
  // Excalidrawのフレーム名エディタ等は Enter を commit として扱うが、日本語変換の確定Enterは
  // keydown の isComposing=true（環境により keyCode=229）で来る。編集中の入力欄に対する“確定Enter”は
  // キャプチャ段階で Excalidraw に届く前に止める（IMEの確定自体は composition イベントで行われるため影響なし）。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (!e.isComposing && (e as any).keyCode !== 229) return;
      const t = e.target as HTMLElement | null;
      const editable = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (editable) e.stopPropagation(); // Excalidrawの commit ハンドラへ渡さない
    };
    el.addEventListener("keydown", onKeyDownCapture, true); // キャプチャ段階
    return () => el.removeEventListener("keydown", onKeyDownCapture, true);
  }, []);

  // テキスト編集中のインデント操作（BRU9-040）。Tab/Shift+Tab/Ctrl+[ ] で行頭（右揃えなら行末）の
  // 半角スペースを増減し、Enter では直前の行のインデントを引き継ぐ。
  // Backspace/Delete は「インデントを消しに行った時だけ」握り潰す（文字消しで揃えが崩れないように）。
  // Excalidraw 標準にも Tab インデントはあるが「4スペース固定・UI無し・改行で継がない」ため差し替える。
  // エディタの textarea は containerRef の内側に生成され、Excalidraw のハンドラは textarea 自身の
  // onkeydown なので、ここ（祖先の capture）が必ず先に走る。
  // ※上のIME用ハンドラと同じノードに付くため stopPropagation では止まらない。handleIndentKey 側でも
  //   isComposing を自前判定している（stopImmediatePropagation は使わない＝IME対策を壊さない）。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !api || !canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.classList?.contains("excalidraw-wysiwyg")) return;
      // 通常の文字入力でシーンを走査しないよう、関係するキーだけ通す
      const bracket = (e.metaKey || e.ctrlKey) && (e.code === "BracketLeft" || e.code === "BracketRight");
      if (!bracket && e.key !== "Tab" && e.key !== "Enter" && e.key !== "Backspace" && e.key !== "Delete") return;
      try {
        // 揃えの判定は「今シーンにある要素」で行う（editingTextElement は揃えを変えた直後 stale になる）
        const ed = getEditingTextEl() ?? api.getAppState()?.editingTextElement;
        const live = ed?.id ? (api.getSceneElements() as any[]).find((x) => x.id === ed.id) : null;
        handleIndentKey(e, live ?? ed);
      } catch { /* noop */ }
    };
    el.addEventListener("keydown", onKey, true); // キャプチャ段階
    return () => el.removeEventListener("keydown", onKey, true);
  }, [api, canEdit]);

  // undo/redo の猶予窓（BRU5-066 / BRU7-058）。
  // 従来は固定 300ms の壁時計だったが、要素数の多い盤面では 300ms（≒18フレーム）以内に
  // 追従処理が収束しきらず、窓が切れた残りの tick が「図形は静止・端点がズレた」分岐に落ちて
  // 繋ぎ替え／接続解除が起きていた。→ 「シーンが静定するまで」延長する方式へ変更する。
  //   ・undo/redo を検知したら UNDO_GRACE だけ窓を開く
  //   ・その間に追従処理が何か直したら、都度 UNDO_GRACE ぶん窓を延長する
  //   ・ただし UNDO_MAX_GRACE を超えては延長しない（収束しない時に開きっぱなしにしない）
  const armUndoGrace = useCallback(() => {
    const now = performance.now();
    undoUntil.current = now + UNDO_GRACE;
    undoHardUntil.current = now + UNDO_MAX_GRACE;
  }, []);
  const extendUndoGrace = useCallback(() => {
    const next = performance.now() + UNDO_GRACE;
    undoUntil.current = Math.max(undoUntil.current, Math.min(next, undoHardUntil.current));
  }, []);

  // 折れ矢印(BRU5-064): Shift押下状態を追跡＋トグル状態をrefへミラー（onChangeから安全に参照する）。
  useEffect(() => { foldModeRef.current = foldMode; }, [foldMode]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Shift") shiftRef.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") shiftRef.current = false; };
    const blur = () => { shiftRef.current = false; };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", blur); };
  }, []);

  // 【一時診断】選択中の線・矢印の内部状態をコンソールから見られるようにする。
  // 「Elbowを押しても変わらない」の原因（elbowedが立っているか/点列が直交か/角丸設定）を実データで特定する用。
  useEffect(() => {
    if (!api) return;
    (window as any).__wbDump = () => {
      const st = api.getAppState();
      const sel = st.selectedElementIds || {};
      const els = (api.getSceneElements() as any[]).filter((e) => sel[e.id]);
      const rows = els.map((e) => ({
        id: e.id.slice(0, 6), type: e.type, elbowed: !!e.elbowed,
        roundness: e.roundness ? `type${e.roundness.type}` : "null(角あり)",
        points: e.points?.length, wbFolded: !!e.customData?.wbFolded,
        triStart: e.customData?.triStart?.id?.slice(0, 6) ?? "-",
        triEnd: e.customData?.triEnd?.id?.slice(0, 6) ?? "-",
        firstSeg: e.points?.length >= 2 ? `${Math.round(e.points[1][0] - e.points[0][0])},${Math.round(e.points[1][1] - e.points[0][1])}` : "-",
      }));
      console.table(rows);
      console.log("leftMenu見つかった =", !!containerRef.current?.querySelector(".App-menu__left"));
      return rows;
    };
  }, [api]);

  // Alt複製の付け替え用（BRU5-068）。ドラッグ開始（＝複製が生まれる前）の図形geometryを控える。
  // capture段階で拾い、Excalidraw が複製を作る前に必ずスナップショットを取る。
  useEffect(() => {
    if (!api) return;
    const onDown = () => {
      pointerDownNow.current = true;
      endpointDragId.current = null; // 新しいポインタ操作の開始（前回の取りこぼしを持ち越さない）
      copiedConnIds.current.clear(); // 前回のコピー操作の控えは持ち越さない（BRU7-056-7）
      const m = new Map<string, string>();
      const ids = new Set<string>();
      for (const el of api.getSceneElements() as any[]) {
        ids.add(el.id);
        if (isConnectableShape(el)) m.set(el.id, shapeSig(el));
      }
      preDragSig.current = m;
      preDragIds.current = ids; // このドラッグで新たに現れた要素＝複製、の判別に使う（BRU7-043）
    };
    // 端点ドラッグを離した合図（BRU5-073）。次の onChange 一回だけ、点編集中の要素も繋ぎ直し評価に通す。
    const onUp = () => { pointerUpPending.current = true; pointerDownNow.current = false; };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [api]);

  // Arrow type の「Elbow」を押したら、ネイティブelbowではなく自前の折れ矢印モードに入る（BRU5-078）。
  //
  // ネイティブelbowは「引いている間だけ角丸で描かれ、離すと自前の折れ矢印へ変換されて角ありになる」という
  // ちらつきを生む（＋角丸固定・移動/複製不可）。そこで Elbow を押した時点で
  //   ・矢印の種類は sharp のまま（＝引いている間もユーザーが選んだ角のまま描かれる）
  //   ・折れ矢印モード(foldMode)をON
  // にして、離した時に自前ルーターで折る。これで描画中と確定後の見た目が完全に一致する。
  useEffect(() => {
    if (!api) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const input = t?.closest?.("label")?.querySelector?.("input[data-testid]") as HTMLInputElement | null;
      const id = input?.getAttribute("data-testid");
      if (id === "elbow-arrow") {
        setFoldMode(true);
        setTimeout(() => {
          try {
            // Excalidraw が currentItemArrowType を elbow にした直後に sharp へ戻す（新規描画をネイティブelbowにしない）
            api.updateScene({ appState: { currentItemArrowType: "sharp" } });
            // 折れ線化は「選択中の線」だけに適用する（BRU5-083）。
            // 以前は foldMode（＝全接続線を一括で折る foldAll）に任せていたため、
            // Elbow を押しただけで盤面上の“関係ない矢印まで”一斉に折れ線化されて壊れていた。
            foldSelectedConnectors(api, api.getAppState());
          } catch { /* noop */ }
        }, 0);
      } else if (id === "sharp-arrow" || id === "round-arrow") {
        setFoldMode(false);
        // 折れ矢印は elbowed:false なので Excalidraw 側は「もうSharp」扱いになり、折れた点列が残る。
        // ＝「Sharpにしたのに折れたまま」。ここで明示的に直線へ戻す（BRU5-080）。
        setTimeout(() => {
          try { unfoldSelectedConnectors(api, api.getAppState(), id === "round-arrow"); } catch { /* noop */ }
        }, 0);
      }
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [api]);

  // undo/redo 検知（BRU5-066）。undo は線の点列だけを巻き戻すことがあり、図形は動いていないため
  // 追従ロジックが「ユーザーが線を動かした」と誤判定して接続を繋ぎ替え/解除してしまう。
  // 直後の数フレームだけ「記録どおりのアンカーへ強制復元」モードに入れる。
  // キーボードとフッターの undo/redo ボタン、両方の経路を拾う。
  //
  // 【BRU7-058】Excalidraw 本体のショートカット定義に合わせる。
  //   undo … Ctrl/Cmd + Z（Shiftなし）
  //   redo … Ctrl/Cmd + Shift + Z ／ Windows は Ctrl + Y も
  // 従来は e.code === "KeyZ" だけを見ていたため、**Windows の Ctrl+Y（redo）で猶予窓が開かず**、
  // redo 直後の追従が「ユーザーが線を動かした」と誤判定して接続を壊していた。
  // 本体は matchKey（英字レイアウトは event.key 優先・非ラテンのみ code へフォールバック）で
  // 判定するので、こちらも key を優先し code は保険として併用する。
  useEffect(() => {
    const isKey = (e: KeyboardEvent, k: "z" | "y") =>
      e.key?.toLowerCase() === k || e.code === (k === "z" ? "KeyZ" : "KeyY");
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // Ctrl/Cmd+Z（undo・Shift付きは redo）と、Windows の Ctrl+Y（redo）
      if (isKey(e, "z") || (!e.shiftKey && isKey(e, "y"))) armUndoGrace();
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-testid="button-undo"],[data-testid="button-redo"]')) armUndoGrace();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onClick, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("pointerdown", onClick, true); };
  }, [armUndoGrace]);

  // ロード後に一度だけフレーム装飾矩形を生成する（BRU5-063）。
  // この機能以前に作られた既存フレームは装飾矩形を持たない。初回onChangeはリモート適用中で
  // スキップされるため、無操作でも（右クリックPNGコピー等の前に）装飾が出るよう明示的に一度走らせる。
  useEffect(() => {
    if (!api || !docLoaded || !canEdit) return;
    let raf1 = 0, raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        try {
          if (!bridgeRef.current?.isApplyingRemote?.()) syncFrameDecorRects(api, api.getAppState(), false);
        } catch { /* noop */ }
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [api, docLoaded, canEdit, bridgeRef]);

  // Cmd/Ctrl+Shift+C … 選択中の要素を画像でクリップボードへコピー。
  // ブラウザのデベロッパーツール起動を抑止しつつ、選択範囲のみをPNG化してコピーする。
  // ※ブラウザによってはDevToolsショートカットがブラウザ側で先取りされ preventDefault が
  //   効かないことがある（Capacitorネイティブアプリでは競合しないため確実に動作する）。
  useEffect(() => {
    if (!api) return;
    const showToast = (msg: string) => {
      setCopyToast(msg);
      if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
      copyToastTimer.current = setTimeout(() => setCopyToast(null), 1800);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // Cmd(Mac) または Ctrl(Win/Linux) + Shift + C。Altは除外（Cmd+Opt+C等と区別）。
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey || e.code !== "KeyC") return;
      // テキスト編集中は通常のコピーを妨げない
      const t = e.target as HTMLElement | null;
      const editing = (!!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        || !!document.querySelector(".excalidraw-wysiwyg");
      if (editing) return;
      e.preventDefault();
      e.stopPropagation();
      void copySelectionAsImage(api).then((r) => {
        showToast(r === "copied" ? "画像をコピーしました" : r === "empty" ? "コピーする要素を選択してください" : "コピーに失敗しました");
      });
    };
    // キャプチャ段階かつ window で受けて、DevToolsショートカットより先に握る
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
    };
  }, [api]);

  // 全画面(ネイティブ)中は Esc をブラウザ既定の「即・全画面解除」ではなく自前で処理するため、
  // Keyboard Lock API で Esc を横取りする（BRU6-004-2）。これがないと図形にフォーカスがあっても
  // 1回目の Esc で全画面が抜けてしまい、「まずフォーカスを外す」処理を挟めない。
  // Chrome/Edge のみ対応。未対応環境(Safari等)ではネイティブ全画面のEscは既定挙動のまま。
  // ※iPad/Mac(WKWebView)や非対応環境は疑似全画面(pseudoFull)なので Keyboard Lock は不要。
  useEffect(() => {
    const kb = (navigator as any)?.keyboard;
    if (!kb?.lock) return;
    const onFsChange = () => {
      const full = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      if (full) { try { kb.lock(["Escape"]).catch(() => {}); } catch { /* noop */ } }
      else { try { kb.unlock?.(); } catch { /* noop */ } }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange as any);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange as any);
      try { kb.unlock?.(); } catch { /* noop */ }
    };
  }, []);

  // 全画面中の Esc 挙動（BRU6-004-2）:
  //   ・テキスト編集中／図形選択中／描画ツール選択中など「フォーカス」がある → まずフォーカスを外し、全画面は維持
  //   ・フォーカスが無い → 全画面を解除
  // あわせて「たまに Esc で選択が外れない」不具合の対策として、選択解除を自前でも確実に行う。
  //   （自前オーバーレイのボタン等にDOMフォーカスが移ると Excalidraw のキーボード処理が働かず、
  //     Esc を押しても選択が外れないことがあるため、window キャプチャで確実に拾って解除する。）
  useEffect(() => {
    if (!api) return;
    const isNativeFull = () =>
      !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
    const exitFull = () => {
      if (isNativeFull()) {
        const anyDoc = document as any;
        (document.exitFullscreen || anyDoc.webkitExitFullscreen)?.call(document);
      } else if (pseudoFull) {
        setPseudoFull(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inFull = isNativeFull() || pseudoFull;

      // テキスト編集中（wysiwygオーバーレイ／入力欄）は確定/キャンセルを Excalidraw に任せる。
      // 全画面は維持（ネイティブは Keyboard Lock、疑似は何もしないことで維持）。
      const t = e.target as HTMLElement | null;
      const editingText = !!document.querySelector(".excalidraw-wysiwyg")
        || (!!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable));
      if (editingText) return;

      const st = api.getAppState?.() || {};
      const sel = st.selectedElementIds || {};
      const hasSelection = Object.values(sel).some(Boolean)
        || !!st.editingGroupId || !!st.editingLinearElement || !!st.selectedLinearElement;
      const toolType = st.activeTool?.type;
      const toolActive = !!toolType && toolType !== "selection" && toolType !== "hand";

      if (hasSelection) {
        // 1回目のEsc = フォーカス(選択)を外すだけ。全画面は維持。
        // Excalidraw 本体にも Esc は流す（stopPropagationしない）が、取りこぼし対策で自前でも解除する。
        try {
          api.updateScene({
            appState: { selectedElementIds: {}, selectedGroupIds: {}, selectedLinearElement: null, editingGroupId: null, editingLinearElement: null },
            captureUpdate: CaptureUpdateAction.NEVER,
          });
        } catch { /* noop */ }
        return;
      }
      if (toolActive) {
        // 描画ツール選択中は Excalidraw に選択ツールへ戻させる。全画面は維持。
        return;
      }
      // フォーカスなし → 全画面を解除
      if (inFull) {
        e.preventDefault();
        e.stopPropagation();
        exitFull();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [api, pseudoFull, setPseudoFull]);

  // 表のセル編集中は Excalidraw の onChange が発火しない（＝シーンが確定まで凍結される）ため、
  // onChange 駆動の再レイアウトが編集中は一度も走らず、周囲セルが編集開始時の高さのまま固まって
  // 空白/はみ出しになる。そこで編集中(エディタ textarea が存在する間)だけ rAF で reflow を回し、
  // 周囲セルを編集中セルの実描画高に追従させる（BRU5-042）。編集していない間は onChange 側が担当。
  useEffect(() => {
    if (!api || !canEdit) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.querySelector(".excalidraw-wysiwyg")) {
        try { reflowTables(api, false); } catch { /* noop */ }
        // 素の図形のラベル編集中も、改行の増減にライブで高さを追従させる（BRU6-011）。
        try { reflowBoundTextShapes(api, false); } catch { /* noop */ }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [api, canEdit]);

  const processedLines = useRef<Set<string>>(new Set());
  const knownElementIds = useRef<Set<string>>(new Set());      // これまでに見た要素id（複製された一群の検出用・BRU7-056-5）
  const dupPlan = useRef<DupPlan | null>(null);                // 複製の対応表。反映されるまで毎tick適用し直す（BRU7-056-5）
  const copiedConnIds = useRef<Set<string>>(new Set());        // このポインタ操作でコピーに関わった線・矢印（接続状態を変えない・BRU7-056-7）
  const seededLines = useRef(false);                          // 起動時に盤面へ在った線を「評価済み」にしたか（BRU7-056-3）
  const touchedConnIds = useRef<Set<string>>(new Set());      // このポインタ操作で掴んだ線・矢印（離した時に接続を再判定・BRU7-056-3）
  const prevTriSig = useRef<Map<string, string>>(new Map()); // 前フレームの図形geometry署名（追従/解除判定用）
  const prevFrameSig = useRef<Map<string, string>>(new Map()); // 前回のフレーム矩形署名（グループ化の新規/リサイズ判定用・BRU4-054）
  const prevFramePos = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map()); // 前回のフレーム位置＋サイズ（移動/リサイズ判別用・BRU5-040/BRU5-061）
  const wasDragging = useRef(false); // 前tickでドラッグ中だったか（ドラッグ確定=所属再判定の契機・BRU5-040）
  const wasResizing = useRef(false); // 前tickでリサイズ中だったか（表の角リサイズ確定=サイズ焼き込みの契機・BRU5-042）
  const onChange = useCallback((elements: readonly any[], appState?: any) => {
    // #185保険(BRU7-043): Phase1(updateScene遅延)で通常 onChange は再入せず depth=1 だが、
    // 万一 updateScene が同期的に onChange を再入させても、深さで自動処理を打ち切って白画面を防ぐ。
    onChangeDepth.current++;
    const tooDeep = onChangeDepth.current > 8;
    try {
    // 編集中テキスト要素を表の再レイアウトへ渡す（api.getAppState()には入らないことがあるため、
    // editingTextElementが確実に入るこのappStateで捕捉）。編集開始で set・終了(null)でクリアされる。
    if (appState) setEditingTextEl(appState.editingTextElement ?? null);
    // 自分のビューポート中心(cx,cy)+ズームを配信（追従される側・ENHA2-031）。
    // canEditガードより前に置き、閲覧専用ユーザーの表示も追従対象にできるようにする。
    if (appState) {
      const now = Date.now();
      if (now - lastViewport.current >= CURSOR_THROTTLE_MS) {
        lastViewport.current = now;
        const zoom = appState.zoom?.value ?? 1;
        const w = appState.width ?? 0;
        const h = appState.height ?? 0;
        const cx = w / 2 / zoom - appState.scrollX;
        const cy = h / 2 / zoom - appState.scrollY;
        // onChangeは要素編集でも多発するため、実際にパン/ズームが変わった時だけ配信する
        const sig = Math.round(cx) + ":" + Math.round(cy) + ":" + zoom;
        if (sig !== lastVpSig.current) {
          lastVpSig.current = sig;
          setViewport(cx, cy, zoom);
        }
      }
    }
    // Arrow type のハイライトを実態に合わせる（BRU5-077）。自前の折れ矢印は内部的に elbowed:false
    // なので標準UIは Sharp を光らせてしまう。選択が変わったのと同じフレームで同期的にクラスを付け外し
    // する（rAFループだと1フレーム遅れ、「Sharpが一瞬光ってからElbowへ動く」ちらつきが見える）。
    try {
      const sel = appState?.selectedElementIds ?? {};
      const conns = elements.filter((e: any) => sel[e.id] && !e.isDeleted && (e.type === "line" || e.type === "arrow"));
      const folded = conns.length > 0
        ? conns.every((e: any) => e.customData?.wbFolded)
        : foldModeRef.current; // 何も選んでいない時は「これから引く矢印」の状態を示す
      containerRef.current?.classList.toggle("wb-folded-arrow", folded);
    } catch { /* noop */ }

    if (!canEdit) return;
    // 折れ矢印(BRU5-064): 矢印/線を「Shift押下」で描いている間、その要素idを控える（描画確定後に
    // autoConnectLines が両端接続時だけ直交ルートへ差し替える）。トグルON時は autoConnect 側で
    // foldAll として常時折るため、ここでの id 追跡には依存しない。新規/多点編集どちらも拾う。
    const drawing = appState?.newElement
      ?? (appState?.editingLinearElement ? elements.find((e) => e.id === appState.editingLinearElement.elementId) : null);
    if (shiftRef.current && drawing && (drawing.type === "arrow" || drawing.type === "line")) {
      foldReqIds.current.add(drawing.id);
    }
    // onChange内で例外を投げるとExcalidrawのドラッグ/複製処理が壊れるため必ずcatchする
    // リモート反映(updateScene)由来のonChange、および追従適用中は自動接続/追従を実行しない（二重適用防止）
    const remote = (bridgeRef.current?.isApplyingRemote?.() ?? false) || isApplyingFollow();
    // このブロック内の updateScene は commitフェーズ外(rAF)へ遅延させ、React の入れ子更新を断つ（BRU7-043）
    api?.__wbSetDefer?.(true);
    try {
      if (api && !tooDeep) {
        // 【BRU7-056-3】自動接続は「今ユーザーが引いた／触った線」だけに効かせる。
        // 起動時点で盤面に在った線・矢印は接続情報(customData)を既に持っているので評価済みとして扱い、
        // 後から無関係な操作をした拍子に近くの図形へ吸着して向きが変わるのを防ぐ。
        if (!seededLines.current && elements.length) {
          seededLines.current = true;
          for (const e of elements) {
            if (!e.isDeleted && (e.type === "line" || e.type === "arrow")) processedLines.current.add(e.id);
          }
        }
        // 三角形は「図形」扱い：標準の点編集UIが付いたら外す（テッペン二股化の根本防止・BRU4-051）
        suppressTrianglePointEditing(api, elements, appState);
        // 壊れた elbow arrow（点列が斜めのまま elbowed になった線）を救出する（BRU5-065）。
        // 放置すると Excalidraw 内部の invariant がドラッグ中に毎フレーム throw する。
        // 修復した tick は他ヘルパーを止め、単一 updateScene/tick を保つ（次tickで収束）。
        const elbowHealed = remote ? false : healBrokenElbowArrows(api, elements, appState);
        // 【BRU7-056-5】複製・コピペで生まれた要素の自前 id 参照（接続 triStart/triEnd・所属 wbParent 等）を
        // 複製された側へ貼り替える。Excalidraw は customData を丸ごとコピーするだけで id を貼り替えないため、
        // これが無いとコピーした瞬間に「複製の線がコピー元の図形へ伸びる」「複製の子がコピー元のフレームに
        // 付いていく」＝コピー元がぐちゃぐちゃになる。他のどの追従処理より先に直す必要があるので最初に置く。
        const dupRemapped = remapDuplicatedCustomRefs(api, elements, appState, knownElementIds.current, remote || elbowHealed, dupPlan, processedLines.current);
        // このポインタ操作でコピーに関わった線・矢印を控える（次の pointerdown で破棄）。
        // 対応表は反映が済むと破棄されるが、ポインタを離すのはその後なので別に持つ必要がある。
        if (dupPlan.current) {
          for (const id of dupPlan.current.carried) copiedConnIds.current.add(id);
          for (const id of dupPlan.current.dups) copiedConnIds.current.add(id);
        }
        // このドラッグ操作中に生まれた要素（Alt複製した複製など）。元フレームの移動へ巻き込んで
        // 動かすと二重移動＆署名が毎tick変わって収束しないため、追従対象から除外する（BRU7-043）。
        const draggingNow = !!appState?.selectedElementsAreBeingDragged;
        const bornIds = draggingNow
          ? new Set(elements.filter((e: any) => !e.isDeleted && !preDragIds.current.has(e.id)).map((e: any) => e.id))
          : undefined;
        // フレーム移動時に子（図形・入れ子フレーム）を同じデルタで追従させる（BRU5-040）。
        // remote/リサイズ/新規描画時は追従せず、位置スナップショットのみ更新する。
        const followed = (elbowHealed || dupRemapped) ? false : followFrameMoves(api, elements, appState, prevFramePos.current, remote, bornIds);
        // フレーム新規作成/リサイズ時に内包要素を wbParent で所属させる（BRU4-054 / BRU5-040）。
        const framed = (remote || elbowHealed || dupRemapped || followed) ? false : captureFrameChildren(api, elements, appState, prevFrameSig.current);
        // ドラッグ確定時に、動かした要素の所属を再判定（枠へ入れた/出した/入れ子にした・BRU5-040）。
        // 最新シーンから取り直すため、同tickで followed が updateScene 済みでも安全に上書きできる。
        const dragging = !!appState?.selectedElementsAreBeingDragged;
        const dragEnded = !remote && !elbowHealed && wasDragging.current && !dragging;
        // Alt複製: Excalidrawは「複製を元の位置に残し、元の要素を動かす」ため、そのままだと矢印が
        // コピー側に付いていく。元の位置に残った複製へアンカーを付け替える（BRU5-068）。
        // 複製の対応表が「外部の矢印」を担当している間は、そちらに任せる（BRU7-056-10）。
        // 旧BRU5-068は一度きりの書き換えで、同フレームの追従処理に上書きされると復帰できない。
        // 対応表が矢印を1本も掴んでいない場合（対応付けに失敗した等）は、旧処理を保険として動かす。
        const dupOwnsArrows = !!dupPlan.current && dupPlan.current.external.size > 0;
        const remapped = (!remote && !elbowHealed && !dupRemapped && !dupOwnsArrows && (dragging || dragEnded))
          ? remapDuplicatedShapeAnchors(api, appState, preDragSig.current) : false;
        const reparented = dragEnded && !remapped ? reparentDraggedElements(api, appState) : false;
        // ドラッグ確定時に、一緒に運んだコネクタの端点をアンカー図形へ貼り直しズレを解消（BRU5-061）。
        // コピーで運ばれた線は貼り直さない（離した瞬間に画面を横切って伸びるのを防ぐ・BRU7-056-8）
        const reconnected = dragEnded && !remapped ? reconnectDraggedConnectors(api, appState, copiedConnIds.current) : false;
        wasDragging.current = dragging;
        // 【BRU7-056-3】掴んで動かしている線・矢印を控え、ポインタを離したフレームで「未処理」へ戻す。
        // 自動接続は1要素1回きりになったため、これが無いと「一度どこにも繋がらなかった線を
        // あとから図形へ寄せてもコネクトできない」。逆にドラッグ中は評価しないので、
        // 掴んでいる途中で端点が勝手に辺の中点へ吸われることも無くなる。
        // 【BRU7-056-4】端点つまみのドラッグは「点編集モード(editingLinearElement)」だけで起きるのではない。
        // 線を1つ選んだだけの状態（selectedLinearElement）でも端点は掴んで動かせる——というより
        // 普段のコネクト操作はほぼこちらで、点編集モードには入っていない。従来はこの状態を一切見て
        // いなかったため、「矢印を選んで端点を図形へドラッグ」しても
        //   ・autoConnectLines は「評価済み」のままなので接続を作らない
        //   ・followTriangleConnections は選択中としてスキップし、繋ぎ替えもしない
        // となり、ハイライト（グレー枠と緑の接続予定点）は出るのに離すと何も繋がらなかった。
        // ＝報告された「どうしてもコネクトがスムーズにいかない」の正体。ここで拾って評価対象に戻す。
        const linEd = appState?.editingLinearElement ?? appState?.selectedLinearElement;
        const linDragId: string | undefined = linEd?.isDragging ? linEd.elementId : undefined;
        if (linDragId) endpointDragId.current = linDragId; // 離したフレームで繋ぎ直しを適用するため控える
        if (dragging || appState?.isResizing || appState?.editingLinearElement || linDragId) {
          const selIds = appState?.selectedElementIds ?? {};
          const editingId = appState?.editingLinearElement?.elementId;
          for (const e of elements) {
            if (e.isDeleted || (e.type !== "line" && e.type !== "arrow")) continue;
            if (e.customData?.wbFolded) continue; // 折れ線の経路は followTriangleConnections が管理するので触らない
            if (selIds[e.id] || e.id === editingId || e.id === linDragId) touchedConnIds.current.add(e.id);
          }
        }
        if (pointerUpPending.current && touchedConnIds.current.size) {
          for (const id of touchedConnIds.current) {
            // 【BRU7-056-7】コピー操作で運ばれただけの線は接続状態を変えない。
            // ここで未処理へ戻すと、離した瞬間に自動接続が走り、元々どこにも繋がっていなかった
            // 飾り線がコピー先の図形へ勝手に繋がって画面を横切る（複製側と同じ事故）。
            // 「線そのものを掴んで図形へ寄せた」操作は複製を伴わないのでこの除外に入らない。
            if (copiedConnIds.current.has(id)) continue;
            processedLines.current.delete(id);
          }
          touchedConnIds.current.clear();
        }
        const busy = elbowHealed || dupRemapped || remapped || followed || framed || reparented || reconnected;
        // 塗りが透明になるバグの保険的修復（BRU4-051）。万一ループが開いた三角形を閉じ直す。
        const repaired = remote || busy ? false : repairOpenTriangles(api, elements, appState);
        // 【BRU7-056-4】Ctrl/Cmd を押しながらの操作ではコネクトしない（ハイライトも TriangleBindHint 側で消す）。
        // 「今のポインタ操作」にだけ効かせる（ポインタを押している間＋離した直後の評価フレーム）。
        // こうしないと Ctrl+V / Ctrl+Z など無関係なキー操作の拍子に判定が抑止されてしまう。
        const noConnect = isConnectSuppressed() && (pointerDownNow.current || pointerUpPending.current);
        // 端点つまみを掴んで離した線だけは「今繋がっている図形」を優先せず接続先を選び直す（BRU7-056-4/-6）。
        // それ以外の線まで選び直すと、端点が矩形から少しはみ出しているだけで外枠に吸われて崩れる。
        const connected = remote || busy || repaired ? false : autoConnectLines(api, elements, appState, processedLines.current, foldReqIds.current, foldModeRef.current, lastPointerScene.current, noConnect, endpointDragId.current ?? undefined);
        // 三角形コネクトの追従（ステートレス）。remote中やframe/autoConnect/修復反映直後はスキップ。
        // 折れ矢印トグルON時は foldAll を渡し、接続済み直線をこの追従パスで確実に折る（描画タイミング非依存）。
        // undo/redo 直後は forceAnchor: 繋ぎ替え/解除をせず、記録どおりのアンカーへ端点を戻す（BRU5-066）。
        const undoing = !remote && performance.now() < undoUntil.current;
        // 端点ドラッグを離したフレームだけ、点編集中の要素も繋ぎ直し評価に通す（BRU5-073）。
        // これが無いと「端点を別の図形へドラッグしてもコネクトできない」。
        // 選択中の線の端点つまみを離した場合も同じ扱いにする（BRU7-056-4）。
        // 既に接続済みの矢印を別の図形／別の面へ繋ぎ替えるのはこの経路。
        const editApplyId = (!remote && pointerUpPending.current)
          ? (appState?.editingLinearElement?.elementId ?? endpointDragId.current ?? undefined)
          : undefined;
        if (pointerUpPending.current) { pointerUpPending.current = false; endpointDragId.current = null; }
        // 折れ矢印モードは「これから引く線」にだけ効かせる（autoConnectLines 側で処理）。
        // 追従処理に foldAll を渡すと、盤面上の“既存の接続済みの線すべて”が折れ線に作り替えられ、
        // 「Elbowを押しただけで関係ない矢印まで壊れる」事故になる（BRU5-083）。既存の線は
        // 選択して「線の形」から明示的に折る。
        const followedTri = followTriangleConnections(api, elements, appState, prevTriSig.current, !remote && !busy && !connected && !repaired, false, undoing, editApplyId, noConnect, dupPlan.current?.pinned);
        // undo/redo の巻き戻しがまだ収束していない間は猶予窓を延長する（BRU7-058）。
        // 盤面が大きいと 300ms では追従が終わらず、窓が切れた残りの tick で接続が繋ぎ替え／解除
        // されていた。「直したものがある＝まだ収束していない」を延長条件にし、静定したら自然に閉じる。
        if (undoing && (busy || repaired || connected || followedTri)) extendUndoGrace();
        // テキストボックスの背景/枠線を描く「影の背景板(rectangle)」を生成・追従・削除する（BRU5-062）。
        // 画像の上でも背景が透けないよう、DOMオーバーレイでなく実要素でネイティブに背面へ敷く。
        // 他ヘルパーが updateScene 済みの tick はスキップし（1tick遅れて追従・単一updateScene維持）、
        // 最新シーンを内部で取り直して安全に反映する。
        // 静穏フェーズ: フレーム装飾矩形の同期・テキストボックス影矩形の同期・はみ出したバインド
        // テキストの修復（BRU5-063）。単一 updateScene/tick を保つため、先に反映したものが
        // あれば残りは次tickへ回す（各関数は内部で最新シーンを取り直すため1tick遅れで収束する）。
        // 「線」の色変更に巻き込まれた図形ラベルの文字色を、記録した色へ戻す（BRU7-056-2）。
        if (!remote && !busy && !connected && !repaired) {
          const frameUpdated = syncFrameDecorRects(api, appState, remote);
          const bgUpdated = frameUpdated || syncTextBoxBgRects(api, appState, remote);
          const textPinned = frameUpdated || bgUpdated || pinBoundTextColor(api, remote, appState);
          if (!frameUpdated && !bgUpdated && !textPinned) healEscapedBoundText(api, remote, appState);
        }
        // 表（BRU5-042）の再レイアウト。移動/リサイズ/テキスト編集中とリモート反映中は避け、
        // 操作確定後に整える。編集や列幅変更が終わるたびに行高・列幅を内容へフィットさせ、隙間なく
        // タイルし直す（セルごとの独立成長で生じるズレ・空白・見切れを解消する）。
        // 角ハンドルでのグループリサイズは isResizing で判定（resizingElement はグループだと null）。
        const resizingNow = !!appState?.isResizing;
        const resizeEnded = !remote && wasResizing.current && !resizingNow;
        wasResizing.current = resizingNow;
        // 角リサイズ確定時、拡大縮小後の寸法を手動値へ焼き込む（reflow に戻されないようにする）。
        const frozen = resizeEnded ? freezeSelectedTable(api) : false;
        // 素の図形も角リサイズ確定時に現在高さを wbBaseH へ焼き込む（それより下へは縮めない・BRU6-011）。
        const shapeFrozen = resizeEnded ? freezeSelectedShapeHeights(api) : false;
        // 移動/リサイズ中とリモート/焼き込み直後はスキップ。テキスト編集中は reflow 内部でエディタ
        // textarea を検出して「ライブモード」で再レイアウトする（入力しながら列幅を可変に・BRU5-042）。
        const hardInteract = !!(appState?.selectedElementsAreBeingDragged || resizingNow || appState?.draggingElement);
        reflowTables(api, remote || hardInteract || frozen || elbowHealed || dupRemapped);
        // 素の図形のバインドテキスト高さフィット（BRU6-011）。改行を減らすと元の高さへ戻す。
        // 新規作成中(newElement)は触らない（作成中の要素を updateScene で壊さない）。
        reflowBoundTextShapes(api, remote || hardInteract || shapeFrozen || elbowHealed || dupRemapped || !!appState?.newElement);
      }
    } catch { /* noop */ }
    finally { api?.__wbSetDefer?.(false); } // 遅延スコープを閉じる（以後の updateScene は同期適用へ戻す）
    try { bridgeRef.current?.syncFromExcalidraw(elements); } catch { /* noop */ }
    try { void syncLocalImages(); } catch { /* noop */ }
    } finally { onChangeDepth.current--; }
  }, [canEdit, api, bridgeRef, syncLocalImages, setViewport, isApplyingFollow, extendUndoGrace]);

  const onPointerUpdate = useCallback((payload: any) => {
    // 折れ矢印(BRU5-064): 実カーソル位置(scene)を常に控える。Shiftの角度スナップで矢印端点が
    // 図形からズレても、離した位置(≒このカーソル)を接続先判定のヒントに使う。
    if (payload?.pointer) lastPointerScene.current = { x: payload.pointer.x, y: payload.pointer.y };
    const now = Date.now();
    if (now - lastCursor.current < CURSOR_THROTTLE_MS) return;
    lastCursor.current = now;
    if (payload?.pointer) setCursor(payload.pointer.x, payload.pointer.y);
  }, [setCursor]);

  return (
    <div
      ref={containerRef}
      style={pseudoFull
        ? { position: "fixed", inset: 0, zIndex: 3000, isolation: "isolate", background: "#fff", width: "100vw", height: "100vh", overscrollBehavior: "contain", touchAction: "none" }
        : { position: "relative", width: "100%", height: "100%", isolation: "isolate", background: "#fff", overscrollBehavior: "contain", touchAction: "none" }}
    >
      <style>{HIDE_EXCALIDRAW_CHROME}</style>
      {/* 永続stateのロード完了後にマウントし、初期要素を initialData で直接描画させる。
          マウント直後の updateScene が Excalidraw の initialData コミットで上書きされ、
          “初回だけ空表示・リロードで表示”になるレースを防ぐ（BRU5-045）。 */}
      {!docLoaded ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#A09790", fontSize: 13 }}>
          ホワイトボードを読み込み中…
        </div>
      ) : (
      <Excalidraw
        excalidrawAPI={(a: any) => { const g = guardApi(a); setApi(g); registerApi(g); }}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        // 右上コラボレーターアバターのクリックで追従開始/解除（ENHA2-031）。
        // 開始時は即スナップ。解除/自動解除は applyFollow が appState.userToFollow を見て自然に停止する。
        onUserFollow={(payload: any) => { if (payload?.action === "FOLLOW") snapToFollowed(); }}
        viewModeEnabled={!canEdit}
        langCode="ja-JP"
        initialData={{ ...CLEAN_DEFAULTS, elements: bridgeRef.current?.currentElements() ?? [] }}
        UIOptions={{ canvasActions: { toggleTheme: false } }}
        renderTopRightUI={() => (api ? (
          // Excalidraw公式の右上スロットに載せる（自前ボタンが標準UIと重ならない）: ヘルプ · エクスポート · 全画面
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", flexShrink: 0 }}>
            <HelpButton api={api} />
            <WhiteboardExportMenu api={api} title={title} containerRef={containerRef} />
            <FullscreenButton targetRef={containerRef} pseudoFull={pseudoFull} setPseudoFull={setPseudoFull} />
          </div>
        ) : null)}
      />
      )}
      {api && (
        <>
          {canEdit && <FrameHighlightLayer api={api} containerRef={containerRef} />}
          {canEdit && <FrameFormatPanel api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <TextBoxFormatPanel api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <TextColorPanel api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <ConnectorViaOverlay api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <ConnectorFormatPanel api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <SnapGuideLayer api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <TriangleBindHint api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <WhiteboardToolbar api={api} foldMode={foldMode} setFoldMode={setFoldMode} />}
          {canEdit && <TriangleToolButton api={api} containerRef={containerRef} />}
          {canEdit && <MermaidToolButton api={api} containerRef={containerRef} />}
          {canEdit && <TableToolButton api={api} containerRef={containerRef} />}
          {canEdit && <TableResizeOverlay api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <TableRowColControls api={api} containerRef={containerRef} canEdit={canEdit} />}
          <FlowConnectOverlay api={api} containerRef={containerRef} canEdit={canEdit} />
          <CursorChatLayer api={api} containerRef={containerRef} remoteChats={remoteChats} setChat={setChat} canEdit={canEdit} />
        </>
      )}
      {copyToast && (
        <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 3200,
          background: "rgba(52,58,64,0.94)", color: "#fff", fontSize: 13, fontWeight: 600, padding: "8px 16px",
          borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.22)", pointerEvents: "none", whiteSpace: "nowrap" }}>
          {copyToast}
        </div>
      )}
    </div>
  );
}
