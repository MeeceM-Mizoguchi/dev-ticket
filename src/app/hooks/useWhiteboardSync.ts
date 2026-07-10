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
// プレゼンスバー（追従対象の選択）用。接続中メンバー1人ぶんの識別情報。
export interface RosterMember { clientId: string; id: string; name: string; color: string; self: boolean }

const SAVE_DEBOUNCE_MS = 1500;

export function useWhiteboardSync(boardId: string | null, user: WbUser) {
  const bridgeRef = useRef<ExcalidrawYjsBridge | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const apiRef = useRef<any>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const [synced, setSynced] = useState(false);
  // 永続stateのロード完了フラグ。true になってから Excalidraw をマウントし、初期要素を
  // initialData.elements として渡す（マウント直後の updateScene が Excalidraw の initialData
  // コミットで上書きされ“初回だけ空表示”になるレースを避けるため・BRU5-045）。
  const [docLoaded, setDocLoaded] = useState(false);
  const [remoteChats, setRemoteChats] = useState<RemoteChat[]>([]);
  // カーソル(collaborators)は命令的にupdateSceneへ流す（Reactの再レンダーを起こさない＝ドラッグ/複製を妨げない）
  const localPointerDownRef = useRef(false);
  const pendingCollabRef = useRef<Map<string, any> | null>(null);

  // 追従機能（ENHA2-031）
  const [roster, setRoster] = useState<RosterMember[]>([]);   // 接続中メンバー（プレゼンスバー用）
  const [selfClientId, setSelfClientId] = useState("");       // 自分の Yjs clientId
  const [followingClientId, setFollowingClientId] = useState<string | null>(null); // 追従中の相手（UI表示用）
  const followingRef = useRef<string | null>(null);           // 同上（onAwarenessクロージャから参照）
  const applyingFollowRef = useRef(false);                    // 追従由来の updateScene 実行中フラグ（エコー防止）
  const appliedVpSigRef = useRef("");                         // 直近に適用したビューポート署名（再適用の抑制）
  const onAwarenessRef = useRef<() => void>(() => {});        // 追従開始時の即時スナップ用

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
    bridge.deferCheck = () => localPointerDownRef.current; // ローカル操作中は外部反映を保留
    bridgeRef.current = bridge;
    awarenessRef.current = awareness;
    docRef.current = doc;
    setSelfClientId(String(doc.clientID));

    (async () => {
      // 1) 永続stateを復元（プロバイダ接続前 = ブロードキャストされない）
      const b64 = await loadDocState(boardId);
      if (disposed) { doc.destroy(); return; }
      if (b64) Y.applyUpdate(doc, base64ToBytes(b64));
      // ロード完了 → Excalidraw をマウントさせる（初期要素は initialData で渡す）
      setDocLoaded(true);

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
      let prevRosterSig = "";
      const onAwareness = () => {
        const states = awareness.getStates();
        const collab = new Map<string, any>();
        const chats: RemoteChat[] = [];
        const members: RosterMember[] = [];
        states.forEach((st: any, clientId: number) => {
          const u = st.user;
          if (!u) return;
          members.push({ clientId: String(clientId), id: u.id, name: u.name, color: u.color, self: clientId === doc.clientID });
          if (clientId === doc.clientID) return; // 以降（カーソル/チャット）は自分を除外
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
        // カーソルは命令的に反映（再レンダーなし）。ローカルでドラッグ中は保留し、離してから反映。
        const collabSig = JSON.stringify(Array.from(collab.entries()).map(([k, v]) => [k, v.pointer?.x, v.pointer?.y, v.username]));
        if (collabSig !== prevCollabSig) {
          prevCollabSig = collabSig;
          if (localPointerDownRef.current) pendingCollabRef.current = collab;
          else apiRef.current?.updateScene({ collaborators: collab });
        }
        // チャットバブルはReact描画が必要（頻度は低い）。内容が変わった時だけ更新。
        const chatSig = JSON.stringify(chats);
        if (chatSig !== prevChatSig) { prevChatSig = chatSig; setRemoteChats(chats); }
        // 参加者ロスター（プレゼンスバー用）。メンバーの増減/改名時のみ更新。
        const rosterSig = members.map((m) => m.clientId + ":" + m.name).join("|");
        if (rosterSig !== prevRosterSig) { prevRosterSig = rosterSig; setRoster(members); }
        // 追従（ENHA2-031）: 対象のビューポートへ自分の表示を合わせる。
        applyFollow(states);
      };
      awareness.on("change", onAwareness);
      onAwarenessRef.current = onAwareness;

      // 追従対象の viewport(中心のシーン座標+ズーム) を読み、自分の scroll/zoom を合わせる。
      // 画面中心どうしを一致させるため、画面サイズが違っても見え方が破綻しない。
      function applyFollow(states: Map<number, any>) {
        const fc = followingRef.current;
        if (!fc) return;
        const st = states.get(Number(fc));
        if (!st) { // 対象が退出 → 追従解除
          followingRef.current = null;
          appliedVpSigRef.current = "";
          setFollowingClientId(null);
          return;
        }
        const vp = st.viewport;
        const api = apiRef.current;
        if (!vp || !api?.getAppState) return;
        const sig = fc + ":" + vp.cx + ":" + vp.cy + ":" + vp.zoom;
        if (sig === appliedVpSigRef.current) return; // 変化なしなら再適用しない（updateScene乱発防止）
        appliedVpSigRef.current = sig;
        const app = api.getAppState();
        const zoom = vp.zoom || 1;
        const width = app.width ?? 0;
        const height = app.height ?? 0;
        const scrollX = width / 2 / zoom - vp.cx;
        const scrollY = height / 2 / zoom - vp.cy;
        applyingFollowRef.current = true;
        // scroll/zoom のみ差し替え（objectsSnapMode等の他フラグを失わないよう現appStateを土台にする）
        api.updateScene({ appState: { ...app, scrollX, scrollY, zoom: { value: zoom } } });
        requestAnimationFrame(() => { applyingFollowRef.current = false; });
      }

      // ローカルのドラッグ検知（押下中はカーソル反映を保留し、離した時にまとめて反映）
      const onDown = () => { localPointerDownRef.current = true; };
      const onUp = () => {
        localPointerDownRef.current = false;
        // Excalidrawのpointerup処理（複製確定など）が完全に終わってから反映する（割り込み防止）
        setTimeout(() => {
          bridgeRef.current?.flushPending();
          if (pendingCollabRef.current) { apiRef.current?.updateScene({ collaborators: pendingCollabRef.current }); pendingCollabRef.current = null; }
        }, 0);
      };
      // ウィンドウ外でpointerupすると up が届かず、フラグが true のまま残って
      // 以後リモート反映が止まる/割り込む。blur・タブ非表示でも「操作終了」とみなして復帰させる。
      const onLeave = () => { if (localPointerDownRef.current) onUp(); };
      window.addEventListener("pointerdown", onDown); // バブル段階
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("blur", onLeave);
      document.addEventListener("visibilitychange", onLeave);

      dispose = () => {
        awareness.off("change", onAwareness);
        doc.off("update", onDocUpdate);
        window.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onLeave);
        document.removeEventListener("visibilitychange", onLeave);
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
      pendingCollabRef.current = null;
      localPointerDownRef.current = false;
      setSynced(false);
      setDocLoaded(false);
      setRemoteChats([]);
      setRoster([]);
      setSelfClientId("");
      setFollowingClientId(null);
      followingRef.current = null;
      appliedVpSigRef.current = "";
      onAwarenessRef.current = () => {};
    };
  }, [boardId]);

  const setCursor = useCallback((x: number, y: number) => {
    awarenessRef.current?.setLocalStateField("cursor", { x, y });
  }, []);

  const setChat = useCallback((text: string, active: boolean) => {
    awarenessRef.current?.setLocalStateField("chat", { text, active });
  }, []);

  // 自分のビューポート中心(cx,cy)とズームを配信（追従される側）。追従中は自分の視点を送らない。
  const setViewport = useCallback((cx: number, cy: number, zoom: number) => {
    if (followingRef.current) return;
    awarenessRef.current?.setLocalStateField("viewport", { cx, cy, zoom });
  }, []);

  const follow = useCallback((clientId: string) => {
    followingRef.current = clientId;
    appliedVpSigRef.current = "";
    setFollowingClientId(clientId);
    onAwarenessRef.current(); // 相手が次に動くのを待たず即スナップ
  }, []);

  const unfollow = useCallback(() => {
    followingRef.current = null;
    appliedVpSigRef.current = "";
    setFollowingClientId(null);
  }, []);

  // 追従由来の updateScene 実行中か（onChange側で重い自動処理/再配信をスキップするため）
  const isApplyingFollow = useCallback(() => applyingFollowRef.current, []);

  // Excalidraw の imperative API を登録（子のcallback refは親effectより先に発火するため ref 経由で確実に接続）
  const registerApi = useCallback((api: { updateScene: (d: any) => void }) => {
    apiRef.current = api;
    const b = bridgeRef.current;
    if (b) { b.setApi(api); b.applyInitial(); }
  }, []);

  return {
    bridgeRef, docRef, registerApi, synced, docLoaded, remoteChats, setCursor, setChat,
    setViewport, roster, selfClientId, followingClientId, follow, unfollow, isApplyingFollow,
  };
}
