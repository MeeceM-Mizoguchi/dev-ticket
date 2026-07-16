// Excalidraw キャンバス本体（遅延ロードされる重量コンポーネント）。
// useWhiteboardSync でリアルタイム同期し、フロー接続・カーソルチャット・エクスポートの
// 各オーバーレイを重ねる。画像は Storage にアップロードして fileId→URL を Yjs で共有する。
import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useWhiteboardSync, type WbUser } from "@/app/hooks/useWhiteboardSync";
import { uploadWhiteboardImage } from "@/app/lib/whiteboardService";
import { autoConnectLines, foldSelectedConnectors, followTriangleConnections, healBrokenElbowArrows, isConnectableShape, reconnectDraggedConnectors, remapDuplicatedShapeAnchors, repairOpenTriangles, shapeSig, suppressTrianglePointEditing, unfoldSelectedConnectors } from "@/app/lib/whiteboardAutoConnect";
import { captureFrameChildren, followFrameMoves, reparentDraggedElements } from "@/app/lib/whiteboardFrames";
import { syncTextBoxBgRects } from "@/app/lib/whiteboardTextBoxBg";
import { syncFrameDecorRects } from "@/app/lib/whiteboardFrameBg";
import { healEscapedBoundText } from "@/app/lib/whiteboardBoundText";
import { reflowTables, freezeSelectedTable, setEditingTextEl } from "@/app/lib/whiteboardTable";
import { copySelectionAsImage } from "@/app/lib/whiteboardCopySelection";
import { CursorChatLayer } from "./CursorChatLayer";
import { FlowConnectOverlay } from "./FlowConnectOverlay";
import { WhiteboardExportMenu } from "./WhiteboardExportMenu";
import { WhiteboardToolbar } from "./WhiteboardToolbar";
import { TriangleToolButton } from "./TriangleToolButton";
import { MermaidToolButton } from "./MermaidToolButton";
import { TableToolButton } from "./TableToolButton";
import { TableResizeOverlay } from "./TableResizeOverlay";
import { SnapGuideLayer } from "./SnapGuideLayer";
import { TriangleBindHint } from "./TriangleBindHint";
import { FrameHighlightLayer } from "./FrameHighlightLayer";
import { FrameFormatPanel } from "./FrameFormatPanel";
import { TextBoxFormatPanel } from "./TextBoxFormatPanel";
import { ConnectorFormatPanel } from "./ConnectorFormatPanel";
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
 */
function guardApi(api: any): any {
  if (!api || api.__wbGuarded) return api;
  const orig = api.updateScene.bind(api);
  api.updateScene = (data: any) => {
    if (data?.elements) {
      const incoming = new Set<string>(data.elements.map((e: any) => e.id));
      const missing = (api.getSceneElements() as any[]).filter((e) => !incoming.has(e.id));
      if (missing.length) {
        console.warn("[WB-LOST] updateScene が要素を落としかけたので復元:", missing.map((m) => `${m.type}:${m.id.slice(0, 6)}`).join(", "));
        data = { ...data, elements: [...data.elements, ...missing] };
      }
    }
    return orig(data);
  };
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
  const preDragSig = useRef<Map<string, string>>(new Map()); // pointerdown時点の図形geometry署名（Alt複製の付け替え判定用・BRU5-068）
  const pointerUpPending = useRef(false);          // 直前にポインタを離したか（端点ドラッグの繋ぎ直し評価用・BRU5-073）
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
      const m = new Map<string, string>();
      for (const el of api.getSceneElements() as any[]) if (isConnectableShape(el)) m.set(el.id, shapeSig(el));
      preDragSig.current = m;
    };
    // 端点ドラッグを離した合図（BRU5-073）。次の onChange 一回だけ、点編集中の要素も繋ぎ直し評価に通す。
    const onUp = () => { pointerUpPending.current = true; };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
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
  // キーボード(Cmd/Ctrl+Z)とフッターの undo/redo ボタン、両方の経路を拾う。
  useEffect(() => {
    const GRACE = 300; // ms
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") undoUntil.current = performance.now() + GRACE;
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-testid="button-undo"],[data-testid="button-redo"]')) undoUntil.current = performance.now() + GRACE;
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onClick, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("pointerdown", onClick, true); };
  }, []);

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
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [api, canEdit]);

  const processedLines = useRef<Set<string>>(new Set());
  const prevTriSig = useRef<Map<string, string>>(new Map()); // 前フレームの図形geometry署名（追従/解除判定用）
  const prevFrameSig = useRef<Map<string, string>>(new Map()); // 前回のフレーム矩形署名（グループ化の新規/リサイズ判定用・BRU4-054）
  const prevFramePos = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map()); // 前回のフレーム位置＋サイズ（移動/リサイズ判別用・BRU5-040/BRU5-061）
  const wasDragging = useRef(false); // 前tickでドラッグ中だったか（ドラッグ確定=所属再判定の契機・BRU5-040）
  const wasResizing = useRef(false); // 前tickでリサイズ中だったか（表の角リサイズ確定=サイズ焼き込みの契機・BRU5-042）
  const onChange = useCallback((elements: readonly any[], appState?: any) => {
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
    try {
      if (api) {
        // 三角形は「図形」扱い：標準の点編集UIが付いたら外す（テッペン二股化の根本防止・BRU4-051）
        suppressTrianglePointEditing(api, elements, appState);
        // 壊れた elbow arrow（点列が斜めのまま elbowed になった線）を救出する（BRU5-065）。
        // 放置すると Excalidraw 内部の invariant がドラッグ中に毎フレーム throw する。
        // 修復した tick は他ヘルパーを止め、単一 updateScene/tick を保つ（次tickで収束）。
        const elbowHealed = remote ? false : healBrokenElbowArrows(api, elements, appState);
        // フレーム移動時に子（図形・入れ子フレーム）を同じデルタで追従させる（BRU5-040）。
        // remote/リサイズ/新規描画時は追従せず、位置スナップショットのみ更新する。
        const followed = elbowHealed ? false : followFrameMoves(api, elements, appState, prevFramePos.current, remote);
        // フレーム新規作成/リサイズ時に内包要素を wbParent で所属させる（BRU4-054 / BRU5-040）。
        const framed = (remote || elbowHealed || followed) ? false : captureFrameChildren(api, elements, appState, prevFrameSig.current);
        // ドラッグ確定時に、動かした要素の所属を再判定（枠へ入れた/出した/入れ子にした・BRU5-040）。
        // 最新シーンから取り直すため、同tickで followed が updateScene 済みでも安全に上書きできる。
        const dragging = !!appState?.selectedElementsAreBeingDragged;
        const dragEnded = !remote && !elbowHealed && wasDragging.current && !dragging;
        // Alt複製: Excalidrawは「複製を元の位置に残し、元の要素を動かす」ため、そのままだと矢印が
        // コピー側に付いていく。元の位置に残った複製へアンカーを付け替える（BRU5-068）。
        const remapped = (!remote && !elbowHealed && (dragging || dragEnded))
          ? remapDuplicatedShapeAnchors(api, appState, preDragSig.current) : false;
        const reparented = dragEnded && !remapped ? reparentDraggedElements(api, appState) : false;
        // ドラッグ確定時に、一緒に運んだコネクタの端点をアンカー図形へ貼り直しズレを解消（BRU5-061）。
        const reconnected = dragEnded && !remapped ? reconnectDraggedConnectors(api, appState) : false;
        wasDragging.current = dragging;
        const busy = elbowHealed || remapped || followed || framed || reparented || reconnected;
        // 塗りが透明になるバグの保険的修復（BRU4-051）。万一ループが開いた三角形を閉じ直す。
        const repaired = remote || busy ? false : repairOpenTriangles(api, elements, appState);
        const connected = remote || busy || repaired ? false : autoConnectLines(api, elements, appState, processedLines.current, foldReqIds.current, foldModeRef.current, lastPointerScene.current);
        // 三角形コネクトの追従（ステートレス）。remote中やframe/autoConnect/修復反映直後はスキップ。
        // 折れ矢印トグルON時は foldAll を渡し、接続済み直線をこの追従パスで確実に折る（描画タイミング非依存）。
        // undo/redo 直後は forceAnchor: 繋ぎ替え/解除をせず、記録どおりのアンカーへ端点を戻す（BRU5-066）。
        const undoing = !remote && performance.now() < undoUntil.current;
        // 端点ドラッグを離したフレームだけ、点編集中の要素も繋ぎ直し評価に通す（BRU5-073）。
        // これが無いと「端点を別の図形へドラッグしてもコネクトできない」。
        const editApplyId = (!remote && pointerUpPending.current) ? appState?.editingLinearElement?.elementId : undefined;
        if (pointerUpPending.current) pointerUpPending.current = false;
        // 折れ矢印モードは「これから引く線」にだけ効かせる（autoConnectLines 側で処理）。
        // 追従処理に foldAll を渡すと、盤面上の“既存の接続済みの線すべて”が折れ線に作り替えられ、
        // 「Elbowを押しただけで関係ない矢印まで壊れる」事故になる（BRU5-083）。既存の線は
        // 選択して「線の形」から明示的に折る。
        followTriangleConnections(api, elements, appState, prevTriSig.current, !remote && !busy && !connected && !repaired, false, undoing, editApplyId);
        // テキストボックスの背景/枠線を描く「影の背景板(rectangle)」を生成・追従・削除する（BRU5-062）。
        // 画像の上でも背景が透けないよう、DOMオーバーレイでなく実要素でネイティブに背面へ敷く。
        // 他ヘルパーが updateScene 済みの tick はスキップし（1tick遅れて追従・単一updateScene維持）、
        // 最新シーンを内部で取り直して安全に反映する。
        // 静穏フェーズ: フレーム装飾矩形の同期・テキストボックス影矩形の同期・はみ出したバインド
        // テキストの修復（BRU5-063）。単一 updateScene/tick を保つため、先に反映したものが
        // あれば残りは次tickへ回す（各関数は内部で最新シーンを取り直すため1tick遅れで収束する）。
        if (!remote && !busy && !connected && !repaired) {
          const frameUpdated = syncFrameDecorRects(api, appState, remote);
          const bgUpdated = frameUpdated || syncTextBoxBgRects(api, appState, remote);
          if (!frameUpdated && !bgUpdated) healEscapedBoundText(api, remote, appState);
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
        // 移動/リサイズ中とリモート/焼き込み直後はスキップ。テキスト編集中は reflow 内部でエディタ
        // textarea を検出して「ライブモード」で再レイアウトする（入力しながら列幅を可変に・BRU5-042）。
        const hardInteract = !!(appState?.selectedElementsAreBeingDragged || resizingNow || appState?.draggingElement);
        reflowTables(api, remote || hardInteract || frozen || elbowHealed);
      }
    } catch { /* noop */ }
    try { bridgeRef.current?.syncFromExcalidraw(elements); } catch { /* noop */ }
    try { void syncLocalImages(); } catch { /* noop */ }
  }, [canEdit, api, bridgeRef, syncLocalImages, setViewport, isApplyingFollow]);

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
          {canEdit && <ConnectorFormatPanel api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <SnapGuideLayer api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <TriangleBindHint api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <WhiteboardToolbar api={api} foldMode={foldMode} setFoldMode={setFoldMode} />}
          {canEdit && <TriangleToolButton api={api} containerRef={containerRef} />}
          {canEdit && <MermaidToolButton api={api} containerRef={containerRef} />}
          {canEdit && <TableToolButton api={api} containerRef={containerRef} />}
          {canEdit && <TableResizeOverlay api={api} containerRef={containerRef} canEdit={canEdit} />}
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
