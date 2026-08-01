// 貼り付けたホワイトボードのオブジェクトリンクをクリックした時に、
// 画面の右半分にそのボードを開くパネル（そのまま編集もできる）。
//
// ・左端の「つまみ」をドラッグして幅を変えられる（ダブルクリックで 50% ⇄ ほぼ全画面）
// ・ヘッダーの「ボードを開く」でホワイトボード画面へ完全遷移する
// ・裏の画面を覆う暗幕は出さない（左のチケット本文を読みながら使うため）。
//   編集中に誤って閉じないよう、クリック外や無条件の Esc では閉じない。
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { X, ExternalLink, PenTool } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { navigateInActiveTab } from "@/app/contexts/TabContext";
import { ErrorBoundary } from "@/app/components/ErrorBoundary";
import { escStack } from "@/app/lib/escStack";
import { getBoardMeta, loadWhiteboardPerms, wbUserColor, type BoardMeta } from "@/app/lib/whiteboardService";
import { buildWhiteboardPath } from "@/app/lib/whiteboardLink";
import type { AccessLevel } from "@/app/types";

const WhiteboardCanvas = lazy(() => import("@/app/components/whiteboard/WhiteboardCanvas"));

const WIDTH_LS_KEY = "wb_preview_width_px";
// Excalidraw はキャンバス幅が 730px 以下になるとモバイル用レイアウトに切り替わり、
// 左の書式パネルが消えて上部ツールバーが折り返す（＝メニューが崩れて見える）。
// ホワイトボード画面と同じ見た目を保つため、パネルは常にこの幅を下回らないようにする。
const MIN_WIDTH = 900;
const NARROW_SCREEN = 1000;  // これ未満の画面幅では半分に割れないので全面表示にする

const maxWidth = () => Math.round(window.innerWidth * 0.92);
const clampWidth = (w: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, w));
const defaultWidth = () => clampWidth(Math.round(window.innerWidth * 0.5));

interface Props {
  boardId: string;
  elementId: string | null;
  projectSlug?: string;
  onClose: () => void;
}

export function WhiteboardLinkPreview({ boardId, elementId, onClose }: Props) {
  const navigate = useNavigate();
  const { userId, userName, userRole } = useAuth();
  const isAdminRole = userRole === "owner" || userRole === "admin";

  const [meta, setMeta] = useState<BoardMeta | null>(null);
  const [perm, setPerm] = useState<AccessLevel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);      // リンク先オブジェクトが見つからない
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_SCREEN);
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(WIDTH_LS_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : defaultWidth();
  });
  const panelRef = useRef<HTMLDivElement>(null);

  // ── ボード情報と権限（whiteboards の RLS は全許可なので、ここが実質のアクセス制御）──
  useEffect(() => {
    let cancelled = false;
    setMeta(null); setPerm(null); setLoadError(null); setNotFound(false);
    (async () => {
      const m = await getBoardMeta(boardId);
      if (cancelled) return;
      if (!m) { setLoadError("ボードが見つかりませんでした"); return; }
      const perms = await loadWhiteboardPerms(m.projectId, userId, isAdminRole);
      if (cancelled) return;
      setMeta(m);
      setPerm(perms.whiteboard);
    })();
    return () => { cancelled = true; };
  }, [boardId, userId, isAdminRole]);

  // 画面幅の変化に追従（狭い端末では全面表示に切り替える）
  useEffect(() => {
    const onResize = () => {
      setNarrow(window.innerWidth < NARROW_SCREEN);
      setWidth((w) => clampWidth(w));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Esc は escStack の最上段として受ける。
  // これを積まないと、キャンバスで選択解除のつもりで押した Esc がそのまま下へ流れ、
  // 裏のチケット詳細モーダル（同じく escStack を使う）まで閉じてしまう。
  //   ・パネル内にフォーカスがある = キャンバスの Esc（選択解除/全画面解除）→ ここでは何もしない
  //   ・パネル外にフォーカスがある = パネルを閉じる意図とみなす
  useEffect(() => {
    const onEsc = () => {
      const active = document.activeElement;
      if (active && panelRef.current?.contains(active)) return;
      onClose();
    };
    escStack.push(onEsc);
    return () => escStack.pop(onEsc);
  }, [onClose]);

  // ── 幅ドラッグ（つまみ）──
  // transition を掛けず rAF で間引く。ドラッグ中に幅を毎フレーム変えると Excalidraw の
  // ResizeObserver が都度走って描画がジャンクするため（BRU9-046 と同じ理由）。
  const dragRaf = useRef(0);
  const widthRef = useRef(width);
  widthRef.current = width;
  const onGripDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (dragRaf.current) return;
      dragRaf.current = requestAnimationFrame(() => {
        dragRaf.current = 0;
        const next = clampWidth(window.innerWidth - ev.clientX);
        widthRef.current = next;
        setWidth(next);
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      try { localStorage.setItem(WIDTH_LS_KEY, String(widthRef.current)); } catch { /* noop */ }
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const toggleWide = useCallback(() => {
    setWidth((w) => {
      const next = w >= maxWidth() - 8 ? defaultWidth() : maxWidth();
      try { localStorage.setItem(WIDTH_LS_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const openFullPage = useCallback(() => {
    if (!meta) return;
    const path = buildWhiteboardPath(meta.projectSlug, boardId, elementId);
    onClose();
    if (!navigateInActiveTab(path)) navigate(path);
  }, [meta, boardId, elementId, onClose, navigate]);

  const user = useMemo(
    () => ({ id: userId, name: userName || "匿名", color: wbUserColor(userId || "anon") }),
    [userId, userName],
  );

  const handleFocusResult = useCallback((found: boolean) => setNotFound(!found), []);

  const panelWidth = narrow ? "100vw" : `${width}px`;
  const canEdit = perm === "edit";

  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: panelWidth, zIndex: 901,
        background: "#FFFFFF", boxShadow: "-8px 0 40px rgba(0,0,0,0.16)",
        display: "flex", flexDirection: "column",
      }}
    >
      {/* 左端のつまみ（ドラッグでリサイズ / ダブルクリックで最大化トグル） */}
      {!narrow && (
        <div
          onPointerDown={onGripDown}
          onDoubleClick={toggleWide}
          title="ドラッグで幅を変更（ダブルクリックで最大化）"
          style={{
            position: "absolute", top: 0, left: -4, bottom: 0, width: 10, cursor: "col-resize",
            display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none", zIndex: 2,
          }}
        >
          <div style={{ width: 4, height: 44, borderRadius: 3, background: "#D8D3CC" }} />
        </div>
      )}

      {/* ヘッダー */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(26,23,20,0.08)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "#EDE9FE", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <PenTool style={{ width: 16, height: 16, color: "#6D28D9" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#A09790", letterSpacing: "0.06em" }}>ホワイトボード</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {meta ? `${meta.title || "無題のボード"}` : "読み込み中…"}
            {meta && <span style={{ fontWeight: 500, color: "#A09790" }}>{` · ${meta.projectName}`}</span>}
          </div>
        </div>
        {perm === "view" && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", background: "#FEF3C7", color: "#92400E", borderRadius: 20, border: "1px solid rgba(217,119,6,0.25)", whiteSpace: "nowrap" }}>閲覧のみ</span>
        )}
        {meta && (
          <button
            onClick={openFullPage}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "#4B4540", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <ExternalLink style={{ width: 12, height: 12 }} />
            ボードを開く
          </button>
        )}
        <button onClick={onClose} title="閉じる" style={{ padding: 6, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X style={{ width: 16, height: 16 }} />
        </button>
      </div>

      {notFound && (
        <div style={{ padding: "8px 16px", background: "#FEF3C7", color: "#92400E", fontSize: 12, flexShrink: 0 }}>
          リンク先のオブジェクトが見つかりませんでした（削除された可能性があります）
        </div>
      )}

      {/* 本体 */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#fff" }}>
        {loadError ? (
          <Centered>{loadError}</Centered>
        ) : !meta || meta.id !== boardId || perm === null ? (
          // meta.id !== boardId は「別ボードのリンクに切り替わった直後の1フレーム」。
          // ここを通さないと、前のボードの権限(canEdit)で新しいボードを一瞬マウントしてしまう。
          <Centered>読み込み中…</Centered>
        ) : perm === "none" ? (
          <Centered>このボードを閲覧する権限がありません</Centered>
        ) : (
          <ErrorBoundary resetKeys={[boardId]}>
            <Suspense fallback={<Centered>ホワイトボードを読み込み中…</Centered>}>
              <WhiteboardCanvas
                key={boardId}
                boardId={boardId}
                title={meta.title || "whiteboard"}
                user={user}
                canEdit={canEdit}
                projectSlug={meta.projectSlug}
                focusElementId={elementId}
                onFocusResult={handleFocusResult}
                instanceKey="preview"
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#A09790", fontSize: 13, padding: 24, textAlign: "center" }}>
      {children}
    </div>
  );
}
