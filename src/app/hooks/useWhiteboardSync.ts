// ホワイトボード同期の心臓部。Yjs Doc / awareness / Broadcastプロバイダ / 永続化 /
// Excalidrawブリッジを生成し、React側へ collaborators と リモートチャットを供給する。
import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { SupabaseYjsProvider, REMOTE_ORIGIN } from "@/app/lib/SupabaseYjsProvider";
import { ExcalidrawYjsBridge } from "@/app/components/whiteboard/ExcalidrawYjsBridge";
import { loadDocState, saveDocState, base64ToBytes, bytesToBase64 } from "@/app/lib/whiteboardService";

export interface WbUser { id: string; name: string; color: string }
export interface RemoteChat { userId: string; name: string; color: string; x: number; y: number; text: string }

const SAVE_DEBOUNCE_MS = 1500;

export function useWhiteboardSync(boardId: string | null, user: WbUser) {
  const bridgeRef = useRef<ExcalidrawYjsBridge | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const apiRef = useRef<{ updateScene: (d: any) => void } | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const [synced, setSynced] = useState(false);
  const [collaborators, setCollaborators] = useState<Map<string, any>>(new Map());
  const [remoteChats, setRemoteChats] = useState<RemoteChat[]>([]);

  // 最新の user を参照するための ref（依存配列に入れず再購読を避ける）
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    if (!boardId || !isSupabaseEnabled || !supabase) return;
    let disposed = false;
    let dispose: (() => void) | null = null;

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", userRef.current);
    const bridge = new ExcalidrawYjsBridge(doc);
    bridgeRef.current = bridge;
    awarenessRef.current = awareness;
    docRef.current = doc;

    (async () => {
      // 1) 永続stateを復元（プロバイダ接続前 = ブロードキャストされない）
      const b64 = await loadDocState(boardId);
      if (disposed) { doc.destroy(); return; }
      if (b64) Y.applyUpdate(doc, base64ToBytes(b64));

      // 2) Broadcastプロバイダ接続 → 後入りは sync-req で差分同期
      const provider = new SupabaseYjsProvider(supabase!, `wb:${boardId}`, doc, awareness);
      provider.onSynced = () => { if (!disposed) setSynced(true); };
      if (apiRef.current) bridge.setApi(apiRef.current);
      bridge.applyInitial();

      // 3) 永続化（ローカル変更のみ・デバウンス保存）
      let saveTimer: ReturnType<typeof setTimeout> | null = null;
      const onDocUpdate = (_u: Uint8Array, origin: unknown) => {
        if (origin === REMOTE_ORIGIN) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          void saveDocState(boardId, bytesToBase64(Y.encodeStateAsUpdate(doc)), userRef.current.id);
        }, SAVE_DEBOUNCE_MS);
      };
      doc.on("update", onDocUpdate);

      // 4) awareness → collaborators / チャット
      //   自分のカーソル更新でも "change" は発火するため、内容が実際に変わった時だけ
      //   setState する（＝updateScene の乱発を防ぎ、ドラッグ/複製操作の中断を回避）。
      let prevCollabSig = "";
      let prevChatSig = "";
      const onAwareness = () => {
        const states = awareness.getStates();
        const collab = new Map<string, any>();
        const chats: RemoteChat[] = [];
        states.forEach((st: any, clientId: number) => {
          if (clientId === doc.clientID) return; // 自分は除外
          const u = st.user;
          if (!u) return;
          if (st.cursor) {
            collab.set(String(clientId), {
              pointer: st.cursor,
              username: u.name,
              color: { background: u.color, stroke: u.color },
              id: u.id,
            });
          }
          if (st.chat?.active && st.cursor) {
            chats.push({ userId: u.id, name: u.name, color: u.color, x: st.cursor.x, y: st.cursor.y, text: st.chat.text ?? "" });
          }
        });
        const collabSig = JSON.stringify(Array.from(collab.entries()).map(([k, v]) => [k, v.pointer?.x, v.pointer?.y, v.username]));
        if (collabSig !== prevCollabSig) { prevCollabSig = collabSig; setCollaborators(collab); }
        const chatSig = JSON.stringify(chats);
        if (chatSig !== prevChatSig) { prevChatSig = chatSig; setRemoteChats(chats); }
      };
      awareness.on("change", onAwareness);

      dispose = () => {
        awareness.off("change", onAwareness);
        doc.off("update", onDocUpdate);
        if (saveTimer) clearTimeout(saveTimer);
        provider.destroy();
        doc.destroy();
      };
      if (disposed) dispose();
    })();

    return () => {
      disposed = true;
      dispose?.();
      bridgeRef.current = null;
      awarenessRef.current = null;
      docRef.current = null;
      setSynced(false);
      setCollaborators(new Map());
      setRemoteChats([]);
    };
  }, [boardId]);

  const setCursor = useCallback((x: number, y: number) => {
    awarenessRef.current?.setLocalStateField("cursor", { x, y });
  }, []);

  const setChat = useCallback((text: string, active: boolean) => {
    awarenessRef.current?.setLocalStateField("chat", { text, active });
  }, []);

  // Excalidraw の imperative API を登録（子のcallback refは親effectより先に発火するため ref 経由で確実に接続）
  const registerApi = useCallback((api: { updateScene: (d: any) => void }) => {
    apiRef.current = api;
    const b = bridgeRef.current;
    if (b) { b.setApi(api); b.applyInitial(); }
  }, []);

  return { bridgeRef, docRef, registerApi, synced, collaborators, remoteChats, setCursor, setChat };
}
