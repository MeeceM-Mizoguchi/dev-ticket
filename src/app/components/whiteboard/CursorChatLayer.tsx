// 「/」カーソルチャット（Figma仕様）。/ 押下でカーソル右下に横長入力が出現し、
// マウスに追従。入力は awareness 経由でライブ配信し、他メンバーのカーソル横にも
// バブルとして表示する。Esc / 5秒無操作で消える。
import { useEffect, useRef, useState } from "react";
import type { RemoteChat } from "@/app/hooks/useWhiteboardSync";

interface Props {
  api: any; // ExcalidrawImperativeAPI
  containerRef: React.RefObject<HTMLDivElement | null>;
  remoteChats: RemoteChat[];
  setChat: (text: string, active: boolean) => void;
  canEdit: boolean;
}

const HOLD_MS = 4000; // 操作後この時間はくっきり表示
const FADE_MS = 3000; // その後この時間かけてフェードアウト
const MAX_LEN = 52;

// scene座標 → コンテナ内ローカルpx
function sceneToLocal(api: any, containerRef: React.RefObject<HTMLDivElement | null>, sx: number, sy: number) {
  const st = api.getAppState();
  const rect = containerRef.current?.getBoundingClientRect();
  const zoom = st.zoom?.value ?? 1;
  // Excalidraw: viewportX(page) = sceneX*zoom + scrollX*zoom + offsetLeft
  const pageX = sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0);
  const pageY = sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0);
  return { x: pageX - (rect?.left ?? 0), y: pageY - (rect?.top ?? 0) };
}

export function CursorChatLayer({ api, containerRef, remoteChats, setChat, canEdit }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [fading, setFading] = useState(false); // 無操作時に5秒かけてフェードアウト
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // 4秒経過→フェード開始
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // 7秒経過→クローズ
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(false);
  openRef.current = open;
  const mouseRef = useRef({ x: 0, y: 0 }); // 常時マウス座標を保持（/押下時に即座にそこへ出す）

  // マウス座標を常時追跡（開いている間は追従、閉じていても最新位置を記録）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      mouseRef.current = p;
      if (openRef.current) setPos(p);
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, [containerRef]);

  // 「/」で起動（テキスト編集中は無視）。押下時のカーソル位置に即表示。
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !open && !typing) {
        e.preventDefault();
        setPos(mouseRef.current); // 現在のカーソル位置へ即セット
        setOpen(true);
        setText("");
        scheduleFade(); // 4秒くっきり表示 → 3秒かけてフェード
        requestAnimationFrame(() => inputRef.current?.focus());
      } else if (e.key === "Escape" && open) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, canEdit]);

  const clearTimers = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  // 操作のたびに呼ぶ: 全表示に戻し → 4秒後にフェード開始（3秒）→ 7秒後にクローズ
  const scheduleFade = () => {
    clearTimers();
    setFading(false); // くっきり表示
    holdTimer.current = setTimeout(() => setFading(true), HOLD_MS);
    closeTimer.current = setTimeout(() => close(), HOLD_MS + FADE_MS);
  };

  const close = () => {
    setOpen(false);
    setFading(false);
    setText("");
    setChat("", false);
    clearTimers();
  };

  const onInput = (v: string) => {
    const clipped = v.slice(0, MAX_LEN);
    setText(clipped);
    setChat(clipped, true);
    scheduleFade(); // タイプのたびにタイマーをリセット（打っている間はくっきり）
  };

  useEffect(() => () => clearTimers(), []);

  return (
    <>
      {/* 自分の入力ボックス（操作後4秒くっきり→3秒かけてフェードアウト） */}
      {open && (
        <div style={{ position: "absolute", left: pos.x + 14, top: pos.y + 14, zIndex: 30, pointerEvents: "auto",
          opacity: fading ? 0 : 1, transition: fading ? "opacity 3s linear" : "opacity 0.1s ease" }}>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") close(); }}
            onBlur={close}
            placeholder="メッセージを入力…"
            style={{
              width: 220, padding: "6px 12px", fontSize: 13, color: "#fff",
              background: "rgba(30,30,35,0.92)", border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: 999, outline: "none", boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
            }}
          />
        </div>
      )}

      {/* 他メンバーのバブル（Excalidrawの名前ラベルに被らないよう下へオフセット） */}
      {remoteChats.map((c) => {
        const p = sceneToLocal(api, containerRef, c.x, c.y);
        return (
          <div key={c.userId} style={{ position: "absolute", left: p.x + 16, top: p.y + 38, zIndex: 29, pointerEvents: "none" }}>
            <div style={{
              maxWidth: 240, padding: "5px 11px", fontSize: 13, color: "#fff", whiteSpace: "pre-wrap",
              background: c.color, borderRadius: 999, boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            }}>{c.text || "…"}</div>
          </div>
        );
      })}
    </>
  );
}
