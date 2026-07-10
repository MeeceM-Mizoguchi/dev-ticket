// Excalidraw キャンバス本体（遅延ロードされる重量コンポーネント）。
// useWhiteboardSync でリアルタイム同期し、フロー接続・カーソルチャット・エクスポートの
// 各オーバーレイを重ねる。画像は Storage にアップロードして fileId→URL を Yjs で共有する。
import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useWhiteboardSync, type WbUser } from "@/app/hooks/useWhiteboardSync";
import { uploadWhiteboardImage } from "@/app/lib/whiteboardService";
import { autoConnectLines, followTriangleConnections, reconnectDraggedConnectors, repairOpenTriangles, suppressTrianglePointEditing } from "@/app/lib/whiteboardAutoConnect";
import { captureFrameChildren, followFrameMoves, reparentDraggedElements } from "@/app/lib/whiteboardFrames";
import { syncTextBoxBgRects } from "@/app/lib/whiteboardTextBoxBg";
import { CursorChatLayer } from "./CursorChatLayer";
import { FlowConnectOverlay } from "./FlowConnectOverlay";
import { WhiteboardExportMenu } from "./WhiteboardExportMenu";
import { WhiteboardToolbar } from "./WhiteboardToolbar";
import { TriangleToolButton } from "./TriangleToolButton";
import { MermaidToolButton } from "./MermaidToolButton";
import { SnapGuideLayer } from "./SnapGuideLayer";
import { TriangleBindHint } from "./TriangleBindHint";
import { FrameDecorLayer } from "./FrameDecorLayer";
import { FrameHighlightLayer } from "./FrameHighlightLayer";
import { FrameFormatPanel } from "./FrameFormatPanel";
import { TextBoxFormatPanel } from "./TextBoxFormatPanel";
import { HelpButton } from "./HelpButton";
import { FullscreenButton } from "./FullscreenButton";
import { PresenceBar } from "./PresenceBar";
import { FollowBanner } from "./FollowBanner";

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
`;

// FigJam/Miro風のクリーンな既定スタイル（手描き効果オフ・通常フォント・細線・ソフトな黒）
const SOFT_BLACK = "#343a40"; // 真っ黒(#1e1e1e)より柔らかいダークグレー
const CLEAN_DEFAULTS = {
  appState: {
    currentItemRoughness: 0,     // 0 = クリーンな直線（手描きのいびつさを排除）
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
    // フレーム書式の背景色を“内容の背面”に描くため、Excalidrawの背景は透明にする
    // （コンテナ側を白にして見た目は白ボードのまま。背景描画は FrameDecorLayer が下層canvasで行う）。
    viewBackgroundColor: "transparent",
  },
};

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
  const lastCursor = useRef(0);
  const lastViewport = useRef(0);
  const lastVpSig = useRef(""); // 直近に配信したビューポート署名（無変化時の配信抑制）
  const uploadedFiles = useRef<Set<string>>(new Set());
  const addedRemoteFiles = useRef<Set<string>>(new Set());

  const {
    bridgeRef, docRef, registerApi, remoteChats, setCursor, setChat, docLoaded,
    setViewport, roster, followingClientId, follow, unfollow, isApplyingFollow,
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

  const processedLines = useRef<Set<string>>(new Set());
  const prevTriSig = useRef<Map<string, string>>(new Map()); // 前フレームの図形geometry署名（追従/解除判定用）
  const prevFrameSig = useRef<Map<string, string>>(new Map()); // 前回のフレーム矩形署名（グループ化の新規/リサイズ判定用・BRU4-054）
  const prevFramePos = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map()); // 前回のフレーム位置＋サイズ（移動/リサイズ判別用・BRU5-040/BRU5-061）
  const wasDragging = useRef(false); // 前tickでドラッグ中だったか（ドラッグ確定=所属再判定の契機・BRU5-040）
  const onChange = useCallback((elements: readonly any[], appState?: any) => {
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
    if (!canEdit) return;
    // onChange内で例外を投げるとExcalidrawのドラッグ/複製処理が壊れるため必ずcatchする
    // リモート反映(updateScene)由来のonChange、および追従適用中は自動接続/追従を実行しない（二重適用防止）
    const remote = (bridgeRef.current?.isApplyingRemote?.() ?? false) || isApplyingFollow();
    try {
      if (api) {
        // 三角形は「図形」扱い：標準の点編集UIが付いたら外す（テッペン二股化の根本防止・BRU4-051）
        suppressTrianglePointEditing(api, elements, appState);
        // フレーム移動時に子（図形・入れ子フレーム）を同じデルタで追従させる（BRU5-040）。
        // remote/リサイズ/新規描画時は追従せず、位置スナップショットのみ更新する。
        const followed = followFrameMoves(api, elements, appState, prevFramePos.current, remote);
        // フレーム新規作成/リサイズ時に内包要素を wbParent で所属させる（BRU4-054 / BRU5-040）。
        const framed = (remote || followed) ? false : captureFrameChildren(api, elements, appState, prevFrameSig.current);
        // ドラッグ確定時に、動かした要素の所属を再判定（枠へ入れた/出した/入れ子にした・BRU5-040）。
        // 最新シーンから取り直すため、同tickで followed が updateScene 済みでも安全に上書きできる。
        const dragging = !!appState?.selectedElementsAreBeingDragged;
        const dragEnded = !remote && wasDragging.current && !dragging;
        const reparented = dragEnded ? reparentDraggedElements(api, appState) : false;
        // ドラッグ確定時に、一緒に運んだコネクタの端点をアンカー図形へ貼り直しズレを解消（BRU5-061）。
        const reconnected = dragEnded ? reconnectDraggedConnectors(api, appState) : false;
        wasDragging.current = dragging;
        const busy = followed || framed || reparented || reconnected;
        // 塗りが透明になるバグの保険的修復（BRU4-051）。万一ループが開いた三角形を閉じ直す。
        const repaired = remote || busy ? false : repairOpenTriangles(api, elements, appState);
        const connected = remote || busy || repaired ? false : autoConnectLines(api, elements, appState, processedLines.current);
        // 三角形コネクトの追従（ステートレス）。remote中やframe/autoConnect/修復反映直後はスキップ
        followTriangleConnections(api, elements, appState, prevTriSig.current, !remote && !busy && !connected && !repaired);
        // テキストボックスの背景/枠線を描く「影の背景板(rectangle)」を生成・追従・削除する（BRU5-062）。
        // 画像の上でも背景が透けないよう、DOMオーバーレイでなく実要素でネイティブに背面へ敷く。
        // 他ヘルパーが updateScene 済みの tick はスキップし（1tick遅れて追従・単一updateScene維持）、
        // 最新シーンを内部で取り直して安全に反映する。
        if (!remote && !busy && !connected && !repaired) syncTextBoxBgRects(api, appState, remote);
      }
    } catch { /* noop */ }
    try { bridgeRef.current?.syncFromExcalidraw(elements); } catch { /* noop */ }
    try { void syncLocalImages(); } catch { /* noop */ }
  }, [canEdit, api, bridgeRef, syncLocalImages, setViewport, isApplyingFollow]);

  const onPointerUpdate = useCallback((payload: any) => {
    const now = Date.now();
    if (now - lastCursor.current < CURSOR_THROTTLE_MS) return;
    lastCursor.current = now;
    if (payload?.pointer) setCursor(payload.pointer.x, payload.pointer.y);
  }, [setCursor]);

  // 追従中に自分がキャンバスを操作（ホイールズーム/パン/クリック）したら追従解除（Figma同挙動・ENHA2-031）。
  // プレゼンスバー等の操作UI（data-follow-ui）上のイベントは対象外。
  useEffect(() => {
    if (!followingClientId) return;
    const el = containerRef.current;
    if (!el) return;
    const onGesture = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-follow-ui]")) return;
      unfollow();
    };
    el.addEventListener("wheel", onGesture, { passive: true });
    el.addEventListener("pointerdown", onGesture);
    return () => {
      el.removeEventListener("wheel", onGesture);
      el.removeEventListener("pointerdown", onGesture);
    };
  }, [followingClientId, unfollow]);

  const followingMember = followingClientId ? roster.find((m) => m.clientId === followingClientId) : null;

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
        excalidrawAPI={(a: any) => { setApi(a); registerApi(a); }}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
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
          <FrameDecorLayer api={api} containerRef={containerRef} />
          {canEdit && <FrameHighlightLayer api={api} containerRef={containerRef} />}
          {canEdit && <FrameFormatPanel api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <TextBoxFormatPanel api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <SnapGuideLayer api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <TriangleBindHint api={api} containerRef={containerRef} canEdit={canEdit} />}
          {canEdit && <WhiteboardToolbar api={api} />}
          {canEdit && <TriangleToolButton api={api} containerRef={containerRef} />}
          {canEdit && <MermaidToolButton api={api} containerRef={containerRef} />}
          <FlowConnectOverlay api={api} containerRef={containerRef} canEdit={canEdit} />
          <CursorChatLayer api={api} containerRef={containerRef} remoteChats={remoteChats} setChat={setChat} canEdit={canEdit} />
        </>
      )}
      {/* 参加者アバター列＋追従バナー（ENHA2-031）。api非依存でロスターから描画する。 */}
      {docLoaded && (
        <PresenceBar
          roster={roster}
          followingClientId={followingClientId}
          onFollow={follow}
          onUnfollow={unfollow}
        />
      )}
      {followingMember && (
        <FollowBanner name={followingMember.name} color={followingMember.color} onUnfollow={unfollow} />
      )}
    </div>
  );
}
