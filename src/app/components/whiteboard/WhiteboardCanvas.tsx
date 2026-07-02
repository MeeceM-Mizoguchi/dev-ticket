// Excalidraw キャンバス本体（遅延ロードされる重量コンポーネント）。
// useWhiteboardSync でリアルタイム同期し、フロー接続・カーソルチャット・エクスポートの
// 各オーバーレイを重ねる。画像は Storage にアップロードして fileId→URL を Yjs で共有する。
import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useWhiteboardSync, type WbUser } from "@/app/hooks/useWhiteboardSync";
import { uploadWhiteboardImage } from "@/app/lib/whiteboardService";
import { CursorChatLayer } from "./CursorChatLayer";
import { FlowConnectOverlay } from "./FlowConnectOverlay";
import { WhiteboardExportMenu } from "./WhiteboardExportMenu";
import { WhiteboardToolbar } from "./WhiteboardToolbar";
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
`;

// FigJam/Miro風のクリーンな既定スタイル（手描き効果オフ・通常フォント・細線・ソフトな黒）
const SOFT_BLACK = "#343a40"; // 真っ黒(#1e1e1e)より柔らかいダークグレー
const CLEAN_DEFAULTS = {
  appState: {
    currentItemRoughness: 0,     // 0 = クリーンな直線（手描きのいびつさを排除）
    currentItemFontFamily: 2,    // 2 = Helvetica（通常フォント）。5=Excalifont(手書き)を避ける
    currentItemStrokeWidth: 1,   // 1 = 細（矢じりも線幅に比例して小さくなる）
    currentItemStrokeColor: SOFT_BLACK,
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
  const lastCursor = useRef(0);
  const uploadedFiles = useRef<Set<string>>(new Set());
  const addedRemoteFiles = useRef<Set<string>>(new Set());

  const { bridgeRef, docRef, registerApi, collaborators, remoteChats, setCursor, setChat } = useWhiteboardSync(boardId, user);

  // 他メンバーのカーソルをシーンへ流し込む
  useEffect(() => {
    if (api) api.updateScene({ collaborators });
  }, [api, collaborators]);

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

  const onChange = useCallback((elements: readonly any[]) => {
    if (!canEdit) return;
    bridgeRef.current?.syncFromExcalidraw(elements);
    void syncLocalImages();
  }, [canEdit, bridgeRef, syncLocalImages]);

  const onPointerUpdate = useCallback((payload: any) => {
    const now = Date.now();
    if (now - lastCursor.current < CURSOR_THROTTLE_MS) return;
    lastCursor.current = now;
    if (payload?.pointer) setCursor(payload.pointer.x, payload.pointer.y);
  }, [setCursor]);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      <style>{HIDE_EXCALIDRAW_CHROME}</style>
      <Excalidraw
        excalidrawAPI={(a: any) => { setApi(a); registerApi(a); }}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        viewModeEnabled={!canEdit}
        langCode="ja-JP"
        initialData={CLEAN_DEFAULTS}
        UIOptions={{ canvasActions: { toggleTheme: false } }}
        renderTopRightUI={() => (api ? (
          // Excalidraw公式の右上スロットに載せる（自前ボタンが標準UIと重ならない）: ヘルプ · エクスポート · 全画面
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <HelpButton api={api} />
            <WhiteboardExportMenu api={api} title={title} />
            <FullscreenButton targetRef={containerRef} />
          </div>
        ) : null)}
      />
      {api && (
        <>
          {canEdit && <WhiteboardToolbar api={api} />}
          <FlowConnectOverlay api={api} containerRef={containerRef} canEdit={canEdit} />
          <CursorChatLayer api={api} containerRef={containerRef} remoteChats={remoteChats} setChat={setChat} canEdit={canEdit} />
        </>
      )}
    </div>
  );
}
