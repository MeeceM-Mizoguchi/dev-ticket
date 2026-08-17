// ファイルボックスのコメント機能（BRU12-025）。ホワイトボードのコメント（ENHA2-039）と
// 同じ操作感を、自前ファイルビューア（FileViewerModal）の上に載せる。
//
//   コメントモード（ヘッダーの「コメント」ボタン / 「c」キー）
//     → カーソルがピンになり、書類をクリックするとその場所に入力欄が出る
//     → 保存するとピンが立ち、投稿した内容がそのまま吹き出しで開く
//       （コメントモードは抜ける。別の場所をクリックするか Esc で吹き出しが閉じる）
//   ピンにマウスオーバー → 吹き出し（投稿者・日時・本文・返信・解決・⋯メニュー）
//     → 「返信を表示」を押すと返信一覧が下に開き、以後マウスを外しても閉じない（固定表示）
//   本文中の「@メンバー名」はメンションとして通知＋Slack通知を飛ばす
//   「解決」にしたコメントはピンが消え、コメント一覧ポップアップから見返せる
//   ピンをドラッグ → その場所へ動かす
//
// 【権限】ファイルボックスはプロジェクトメンバーなら全員が読み書きできる（add_project_files.sql）。
// 自分の投稿の編集・削除だけが本人限定。解決の切り替えは誰でもできる（ホワイトボードと同じ）。
//
// 【座標系】ピンの位置は「ビューアの内容ボックスに対する 0..1 の割合」で持つ。
// ホワイトボードは無限キャンバスの scene 座標をそのまま持てたが、ファイルの表示倍率は
// 画面幅で決まる（画像は maxWidth:100% で縮む・docx は折り返す）ので px では持てない。
// 割合にしておけば、別のPCや別のウィンドウ幅でもだいたい同じ場所を指す。
//
// 【描画方式】ホワイトボードと同じで、React は「どのピンが在るか」だけを描き、
// 位置は data-x/data-y に持たせて rAF ループが transform だけを書き換える。
// スクロールのたびに再レンダーすると全ピンが作り直されて重い＆ちらつくため。
//
// 【スクロール追従】ビューア内のスクロール要素（ExcelViewer / WordViewer / テキスト / 画像の
// overflow:auto な箱）を自動で見つけて、その scrollLeft/Top を毎フレーム差し引く＝
// ピンが書類と一緒に動く。ただし PDF はブラウザ内蔵ビューア（iframe）が描いていて
// スクロール位置を JS から読めないため、PDF のピンだけは「表示領域に対する位置」になる。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare, CornerDownRight, ChevronDown, ChevronUp, CheckCircle2, RotateCcw,
} from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { appOrigin } from "@/app/lib/appOrigin";
import { escStack } from "@/app/lib/escStack";
import { buildFileCommentLink } from "@/app/lib/fileCommentLink";
import { wbUserColor } from "@/app/lib/whiteboardService";
import { formatCommentTime, initialOf } from "@/app/lib/whiteboardComments";
import {
  buildFileComment, buildFileCommentReply, deleteFileComment, listFileComments,
  loadFileCommentContext, moveFileComment, saveFileComment, saveFileCommentReply,
  setFileCommentResolved, subscribeFileComments, updateFileCommentText,
  type FileComment, type FileCommentReply, type FileCommentTarget,
} from "@/app/lib/fileComments";
import { notifyFileCommentMentions, notifyFileCommentReply } from "@/app/lib/fileCommentNotify";
import { Avatar, Composer, ItemMenu, PIN_CURSOR, commentCardStyle } from "../comments/CommentKit";
import { CommentListPanel } from "../whiteboard/CommentListPanel";
import { MentionText } from "../whiteboard/MentionText";
import type { ProjectFile } from "@/app/types";

const TIP_W = 300;             // 吹き出しの幅
const TIP_GAP = 12;            // ピンと吹き出しの隙間
const REPLY_LIST_MAX_H = 176;  // 返信リストの最大高さ（約2件ぶん。以降はスクロール）
const HOVER_CLOSE_MS = 220;    // ピン⇔吹き出し間をマウスが渡る猶予
const PIN_SIZE = 26;           // ピンの一辺(px・画面)。位置は左下＝コメント座標
const DRAG_SLOP = 3;           // これ未満の動きはクリック（＝吹き出しを開く）として扱う
const HOST_SCAN_MS = 500;      // スクロール要素の再探索間隔（中身は非同期に描かれる）
const FOCUS_RETRY_MS = 200;    // リンク着地: 対象が現れるまでの再探索間隔
const FOCUS_RETRY_MAX = 25;    // 同 最大回数（≒5秒。初回読み込みを待つ）

interface Props {
  file: ProjectFile;
  /** ビューア本体を包む position:relative な箱。この中にピン層を敷く */
  hostRef: React.RefObject<HTMLDivElement | null>;
  /** コメントモード（ヘッダーのボタンと共有するのでモーダル側が持つ） */
  commentMode: boolean;
  setCommentMode: (v: boolean) => void;
  /** コメント一覧ポップアップの開閉（同上） */
  listOpen: boolean;
  setListOpen: (v: boolean) => void;
  /** リンク着地（?comment=&reply=）。見つかったらピンまでスクロールして固定表示する */
  focusCommentId?: string | null;
  focusReplyId?: string | null;
  /** ヘッダーのボタンに出す未解決件数 */
  onCountChange?: (openCount: number) => void;
}

/** ピンの位置計算に必要な、その瞬間のビューアの寸法。 */
interface Geom {
  /** ピン層を置く位置（hostRef の左上からの相対） */
  left: number; top: number; width: number; height: number;
  /** 内容全体の大きさ（スクロールしない場合は表示領域と同じ） */
  contentW: number; contentH: number;
  scrollLeft: number; scrollTop: number;
}

/**
 * ビューアの中で実際にスクロールしている箱を探す。
 * 各ビューア（ExcelViewer / WordViewer / TextViewer / 画像）はいずれも
 * 一番外側に overflow:auto の div を持っているので、文書順で最初に見つかったものを採る。
 * PDF は iframe なので見つからない＝null（表示領域そのものを座標系にする）。
 */
function findScrollHost(root: HTMLElement): HTMLElement | null {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("div, main, section, pre"))) {
    if (el.closest("[data-fbc-layer]")) continue; // 自分（ピン層）は対象外
    const s = getComputedStyle(el);
    if (!/^(auto|scroll)$/.test(s.overflowY) && !/^(auto|scroll)$/.test(s.overflowX)) continue;
    return el;
  }
  return null;
}

function readGeom(host: HTMLElement, sc: HTMLElement | null): Geom | null {
  const hostRect = host.getBoundingClientRect();
  const box = sc ?? host;
  const rect = box.getBoundingClientRect();
  // スクロールバーの幅を含めない client* を表示領域として使う（ピンがバーの下に隠れない）
  const width = box.clientWidth || rect.width;
  const height = box.clientHeight || rect.height;
  if (!width || !height) return null;
  return {
    left: rect.left - hostRect.left,
    top: rect.top - hostRect.top,
    width, height,
    contentW: sc ? Math.max(sc.scrollWidth, width) : width,
    contentH: sc ? Math.max(sc.scrollHeight, height) : height,
    scrollLeft: sc ? sc.scrollLeft : 0,
    scrollTop: sc ? sc.scrollTop : 0,
  };
}

export function FileCommentLayer({
  file, hostRef, commentMode, setCommentMode, listOpen, setListOpen,
  focusCommentId, focusReplyId, onCountChange,
}: Props) {
  const { userId, userName } = useAuth();
  const { toast } = useToast();

  const [comments, setComments] = useState<FileComment[]>([]);
  const [replies, setReplies] = useState<Record<string, FileCommentReply[]>>({});
  const [members, setMembers] = useState<string[]>([]);
  const [projectSlug, setProjectSlug] = useState("");
  // 新規コメントの下書き（クリックした位置に仮ピンを出す）
  const [draft, setDraft] = useState<{ x: number; y: number; text: string } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [stickyId, setStickyId] = useState<string | null>(null); // 固定表示（マウスを外しても消えない）
  const [showReplies, setShowReplies] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [editing, setEditing] = useState<{ kind: "comment" | "reply"; id: string } | null>(null);
  const [editText, setEditText] = useState("");

  const layerRef = useRef<HTMLDivElement>(null);
  const scrollHostRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeId = stickyId ?? hoverId;
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const draftRef = useRef<typeof draft>(null);
  draftRef.current = draft;
  const listOpenRef = useRef(false);
  listOpenRef.current = listOpen;
  const commentsRef = useRef<FileComment[]>([]);
  commentsRef.current = comments;
  const commentModeRef = useRef(false);
  commentModeRef.current = commentMode;

  // ドラッグ関連（すべて ref。毎フレームの再レンダーを起こさないため）
  const pinDrag = useRef<{ pointerId: number; id: string; cx: number; cy: number; x: number; y: number; moved: boolean } | null>(null);
  const dragPos = useRef<{ id: string; x: number; y: number } | null>(null);
  const suppressClick = useRef(false); // 動かした直後の click で吹き出しを開かない

  // コメントは版をまたいで引く（同名ファイル＝同じファイルの版なので、
  // エディタ保存で file.id が変わってもコメントは同じものを見せ続ける）
  const target = useMemo<FileCommentTarget>(
    () => ({ projectId: file.projectId, fileName: file.fileName, fileId: file.id }),
    [file.projectId, file.fileName, file.id],
  );
  const author = useMemo(() => ({ id: userId, name: userName }), [userId, userName]);

  // ── 読み込み ───────────────────────────────────────────
  // 読み直しでは loading state を持たない（一度出したピンをスピナーで隠すと
  // 相手の書き込みが届くたびに画面が消える＝BUG-02 と同じ見え方になる）。
  const broadcastRef = useRef<() => void>(() => {});
  // 読み直しの識別は projectId + fileName だけで足りる（file.id は書き込み時にしか使わない）。
  // ここに target をそのまま入れると、エディタ保存で版が上がるたびに購読を張り直してしまう。
  const readKey = useMemo(
    () => ({ projectId: file.projectId, fileName: file.fileName, fileId: "" }),
    [file.projectId, file.fileName],
  );
  const reload = useCallback(async () => {
    const { comments: cs, replies: rs } = await listFileComments(readKey);
    setComments(cs);
    setReplies(rs);
  }, [readKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { comments: cs, replies: rs } = await listFileComments(readKey);
      if (cancelled) return;
      setComments(cs);
      setReplies(rs);
    })();
    return () => { cancelled = true; };
  }, [readKey]);

  // 同じファイルを開いている他の人の書き込みを受け取る
  useEffect(() => {
    const sub = subscribeFileComments(readKey, userId, () => { void reload(); });
    broadcastRef.current = sub.broadcast;
    return () => { broadcastRef.current = () => {}; sub.dispose(); };
  }, [readKey, userId, reload]);

  // メンション候補（プロジェクト参加メンバー）と共有リンク用の slug
  useEffect(() => {
    let cancelled = false;
    void loadFileCommentContext(file.projectId).then((ctx) => {
      if (cancelled) return;
      setMembers(ctx.members);
      setProjectSlug(ctx.slug);
    });
    return () => { cancelled = true; };
  }, [file.projectId]);

  useEffect(() => {
    onCountChange?.(comments.filter((c) => !c.resolved).length);
  }, [comments, onCountChange]);

  /** 画面を先に更新してから DB に流し、最後に他の人へ「読み直して」と伝える。 */
  const commit = useCallback((work: Promise<unknown>) => {
    void work.then(() => broadcastRef.current());
  }, []);

  // ── スクロール要素の特定 ───────────────────────────────
  // ビューアの中身は非同期に描かれるので、見つかるまで（そして差し替わったら）探し直す。
  useEffect(() => {
    scrollHostRef.current = null;
    const detect = () => {
      const host = hostRef.current;
      if (!host) return;
      const cur = scrollHostRef.current;
      if (cur && host.contains(cur)) return;
      scrollHostRef.current = findScrollHost(host);
    };
    detect();
    const t = setInterval(detect, HOST_SCAN_MS);
    return () => clearInterval(t);
  }, [hostRef, file.fileName]);

  const geom = useCallback((): Geom | null => {
    const host = hostRef.current;
    return host ? readGeom(host, scrollHostRef.current) : null;
  }, [hostRef]);

  /** 画面(client)座標 → 内容ボックスに対する 0..1 の割合。 */
  const toNorm = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const host = hostRef.current;
    if (!host) return null;
    const sc = scrollHostRef.current;
    const rect = (sc ?? host).getBoundingClientRect();
    const g = readGeom(host, sc);
    if (!g) return null;
    return {
      x: (clientX - rect.left + g.scrollLeft) / g.contentW,
      y: (clientY - rect.top + g.scrollTop) / g.contentH,
    };
  }, [hostRef]);

  // ── 吹き出しの開閉 ─────────────────────────────────────
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHoverId(null), HOVER_CLOSE_MS);
  }, [cancelClose]);

  const closeTooltip = useCallback(() => {
    cancelClose();
    setHoverId(null);
    setStickyId(null);
    setShowReplies(false);
    setReplyOpen(false);
    setReplyText("");
    setEditing(null);
  }, [cancelClose]);

  // 固定表示にする（ピンのクリック / 返信 / 返信を表示 / 保存直後 / リンク着地）
  const pinOpen = useCallback((id: string) => {
    cancelClose();
    setHoverId(id);
    setStickyId(id);
  }, [cancelClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  // 別のコメントへホバーが移ったら、その都度サブ状態を畳む。
  // 「返信リンクから開いた」時だけは返信一覧を開いた状態で見せたいので、
  // 開く側が pendingReplies に意図を置いてから開く（この effect は開いた後に走るため）。
  const pendingReplies = useRef(false);
  const prevActive = useRef<string | null>(null);
  useEffect(() => {
    if (prevActive.current === activeId) return;
    prevActive.current = activeId;
    setShowReplies(pendingReplies.current);
    pendingReplies.current = false;
    setReplyOpen(false);
    setReplyText("");
    setEditing(null);
  }, [activeId]);

  // ── 位置の追従（毎フレーム transform だけ書き換える） ──────
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const layer = layerRef.current;
      const g = geom();
      if (!layer || !g) return;

      // ピン層をスクロール箱にぴったり重ねる（overflow:hidden なので外に出たピンは消える）
      layer.style.left = `${g.left}px`;
      layer.style.top = `${g.top}px`;
      layer.style.width = `${g.width}px`;
      layer.style.height = `${g.height}px`;

      layer.querySelectorAll<HTMLElement>("[data-fbc-anchor]").forEach((node) => {
        const nx = Number(node.dataset.x);
        const ny = Number(node.dataset.y);
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
        const px = nx * g.contentW - g.scrollLeft;
        const py = ny * g.contentH - g.scrollTop;
        node.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0)`;
      });

      // 吹き出し/入力欄は、はみ出す側と反対へ寄せる（ピンが端にあっても読める）
      layer.querySelectorAll<HTMLElement>("[data-fbc-panel]").forEach((panel) => {
        const anchor = panel.parentElement;
        if (!anchor) return;
        const ax = Number(anchor.dataset.x) * g.contentW - g.scrollLeft;
        const ay = Number(anchor.dataset.y) * g.contentH - g.scrollTop;
        const w = panel.offsetWidth || TIP_W;
        const h = panel.offsetHeight || 0;
        const flipX = ax + TIP_GAP + PIN_SIZE + w > g.width - 8;
        panel.style.left = flipX ? `${-(w + TIP_GAP)}px` : `${PIN_SIZE + TIP_GAP}px`;
        // 既定はピンの上端から下へ伸ばす。下に入りきらない時だけ上へ伸ばす。
        const flipY = ay + h > g.height - 8 && ay - h > 8;
        panel.style.top = flipY ? `${-h - 4}px` : "-30px";
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [geom]);

  // ── ピンのドラッグ ─────────────────────────────────────
  const onPinPointerDown = (e: React.PointerEvent, c: FileComment) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    suppressClick.current = false; // 前回のドラッグの取りこぼしを引きずらない
    pinDrag.current = { pointerId: e.pointerId, id: c.id, cx: e.clientX, cy: e.clientY, x: c.x, y: c.y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const paint = (id: string, x: number, y: number) => {
      const layer = layerRef.current;
      if (!layer) return;
      // 同じIDの錨はピンと吹き出しに1つずつ在りうる（吹き出しを開いたまま動かす場合）
      layer.querySelectorAll<HTMLElement>(`[data-fbc-anchor][data-id="${CSS.escape(id)}"]`).forEach((node) => {
        node.dataset.x = String(x);
        node.dataset.y = String(y);
      });
    };

    const onMove = (e: PointerEvent) => {
      const d = pinDrag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < DRAG_SLOP) return;
        d.moved = true;
        closeTooltip(); // 動かしている間は吹き出しが邪魔になる
      }
      const g = geom();
      if (!g) return;
      const x = Math.min(1, Math.max(0, d.x + (e.clientX - d.cx) / g.contentW));
      const y = Math.min(1, Math.max(0, d.y + (e.clientY - d.cy) / g.contentH));
      dragPos.current = { id: d.id, x, y };
      paint(d.id, x, y);
    };

    const onUp = (e: PointerEvent) => {
      const d = pinDrag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      pinDrag.current = null;
      const pos = dragPos.current;
      dragPos.current = null;
      if (!d.moved || !pos) return;
      suppressClick.current = true;
      // 画面はすでにドラッグ中の位置。state と DB を追いつかせる（1回だけ書く）
      setComments((prev) => prev.map((c) => (c.id === pos.id ? { ...c, x: pos.x, y: pos.y } : c)));
      commit(moveFileComment(pos.id, pos.x, pos.y));
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [closeTooltip, commit, geom]);

  // ── コメントモード: キー・クリック ─────────────────────
  // 「c」でコメントモードに入る/出る。入力中は無視する。
  // 注: PDF をクリックした直後はフォーカスが iframe の中にあり、キーイベントが
  // こちらへ届かない（＝この時だけヘッダーのボタンで入る）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "c" && e.key !== "C") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      setCommentMode(!commentModeRef.current);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setCommentMode]);

  // 別の場所をクリックしたら固定表示を閉じる（吹き出し/ピン/一覧の中は除く）。
  // 一覧（CommentListPanel）はホワイトボードと共用なので data-wbc-ui も「中」として扱う。
  useEffect(() => {
    if (!stickyId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-fbc-ui],[data-wbc-ui]")) return;
      closeTooltip();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [stickyId, closeTooltip]);

  // Esc: 入力中なら入力を、開いていれば吹き出しを、次に一覧を、最後にコメントモードを閉じる。
  // 何も開いていない間は積まない＝Esc はビューアを閉じる（モーダル側のハンドラ）ままにする。
  useEffect(() => {
    if (!draft && !activeId && !commentMode && !listOpen) return;
    const onEsc = () => {
      if (draftRef.current) { setDraft(null); return; }
      if (activeIdRef.current) { closeTooltip(); return; }
      if (listOpenRef.current) { setListOpen(false); return; }
      setCommentMode(false);
    };
    escStack.push(onEsc);
    return () => escStack.pop(onEsc);
  }, [draft, activeId, commentMode, listOpen, closeTooltip, setCommentMode, setListOpen]);

  // ── コメントへ移動して開く（リンク着地・一覧からのジャンプ共通） ──
  const focusComment = useCallback((commentId: string, replyId?: string | null): boolean => {
    const c = commentsRef.current.find((x) => x.id === commentId);
    if (!c) return false;
    const sc = scrollHostRef.current;
    const g = geom();
    if (sc && g) {
      sc.scrollTo({
        left: Math.max(0, c.x * g.contentW - g.width / 2),
        top: Math.max(0, c.y * g.contentH - g.height / 2),
        behavior: "smooth",
      });
    }
    pendingReplies.current = !!replyId; // 返信のリンクなら返信一覧を開いた状態で着地する
    pinOpen(commentId);
    return true;
  }, [geom, pinOpen]);

  // 初回読み込みが終わるまで対象が居ないことがあるので、見つかるまで再探索する
  const focusTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (focusTimer.current) { clearInterval(focusTimer.current); focusTimer.current = null; }
    if (!focusCommentId) return;
    if (focusComment(focusCommentId, focusReplyId)) return;
    let tries = 0;
    focusTimer.current = setInterval(() => {
      tries++;
      if (focusComment(focusCommentId, focusReplyId) || tries >= FOCUS_RETRY_MAX) {
        clearInterval(focusTimer.current!);
        focusTimer.current = null;
      }
    }, FOCUS_RETRY_MS);
    return () => { if (focusTimer.current) { clearInterval(focusTimer.current); focusTimer.current = null; } };
  }, [focusCommentId, focusReplyId, focusComment]);

  // ── 保存系 ─────────────────────────────────────────────
  const notifyBase = useCallback((commentId: string, replyId?: string | null) => ({
    projectSlug, fileId: file.id, fileName: file.fileName, commentId, replyId, fromUserName: userName,
  }), [projectSlug, file.id, file.fileName, userName]);

  const saveDraft = () => {
    const text = draft?.text.trim();
    if (!draft || !text) return;
    const c = buildFileComment(draft.x, draft.y, text, author);
    setComments((prev) => [...prev, c]);
    setDraft(null);
    // 投稿したコメントをそのまま見せ、コメントモードは抜ける
    // （続けて置きたい時はもう一度ボタン/「c」。誤ってピンが増えるのを防ぐ）
    setCommentMode(false);
    pinOpen(c.id);
    commit(saveFileComment(target, c));
    void notifyFileCommentMentions(notifyBase(c.id), text, members);
  };

  const saveReply = (comment: FileComment) => {
    const text = replyText.trim();
    if (!text) return;
    const r = buildFileCommentReply(comment.id, text, author);
    setReplies((prev) => ({ ...prev, [comment.id]: [...(prev[comment.id] ?? []), r] }));
    setReplyText("");
    setReplyOpen(false);   // 「返信」を押したら入力欄は閉じる（仕様）
    setShowReplies(true);  // 書いた返信がそのまま見えるように一覧は開く
    commit(saveFileCommentReply(target, r));
    void notifyFileCommentMentions(notifyBase(comment.id, r.id), text, members);
    void notifyFileCommentReply(notifyBase(comment.id, r.id), text, comment.userName);
  };

  const saveEdit = (comment: FileComment) => {
    const text = editText.trim();
    if (!editing || !text) return;
    const now = Date.now();
    if (editing.kind === "comment") {
      const prev = comment.text;
      setComments((cs) => cs.map((c) => (c.id === editing.id ? { ...c, text, updatedAt: now } : c)));
      commit(updateFileCommentText(editing.id, text));
      void notifyFileCommentMentions(notifyBase(comment.id), text, members, prev);
    } else {
      const prev = (replies[comment.id] ?? []).find((r) => r.id === editing.id)?.text;
      setReplies((rs) => ({
        ...rs,
        [comment.id]: (rs[comment.id] ?? []).map((r) => (r.id === editing.id ? { ...r, text, updatedAt: now } : r)),
      }));
      commit(updateFileCommentText(editing.id, text));
      void notifyFileCommentMentions(notifyBase(comment.id, editing.id), text, members, prev);
    }
    setEditing(null);
  };

  const removeComment = (id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
    setReplies((prev) => { const next = { ...prev }; delete next[id]; return next; }); // 返信はDB側もCASCADE
    closeTooltip();
    commit(deleteFileComment(id));
  };

  const removeReply = (commentId: string, replyId: string) => {
    setReplies((prev) => ({ ...prev, [commentId]: (prev[commentId] ?? []).filter((r) => r.id !== replyId) }));
    commit(deleteFileComment(replyId));
  };

  const toggleResolved = (c: FileComment) => {
    const resolved = !c.resolved;
    setComments((prev) => prev.map((x) => (x.id === c.id
      ? { ...x, resolved, resolvedAt: resolved ? Date.now() : undefined, resolvedByName: resolved ? userName : undefined }
      : x)));
    // 解決にしたら書類からピンが消えるので、吹き出しも畳んでおく
    if (resolved) closeTooltip();
    commit(setFileCommentResolved(c.id, resolved, userName));
  };

  const copyLink = async (commentId: string, replyId?: string) => {
    const url = projectSlug ? buildFileCommentLink(projectSlug, file.id, commentId, replyId) : null;
    if (!url) {
      toast(appOrigin()
        ? "プロジェクトの情報を取得できないためリンクを作れません"
        : "共有URLの設定(VITE_PUBLIC_APP_ORIGIN)がないためリンクを作れません", "error");
      return;
    }
    if (await copyText(url)) toast("コメントへのリンクをコピーしました");
    else toast("コピーに失敗しました", "error");
  };

  // ── 描画 ───────────────────────────────────────────────
  const renderTooltip = (c: FileComment) => {
    const list = replies[c.id] ?? [];
    const editingThis = editing?.kind === "comment" && editing.id === c.id;
    return (
      <div
        data-fbc-ui data-fbc-panel
        onMouseEnter={cancelClose}
        onMouseLeave={() => { if (!stickyId) scheduleClose(); }}
        onWheel={(e) => e.stopPropagation()}
        style={{
          ...commentCardStyle,
          position: "absolute", left: PIN_SIZE + TIP_GAP, top: -30, width: TIP_W, zIndex: 2,
          pointerEvents: "auto", cursor: "default",
        }}
      >
        {c.resolved && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", background: "#ECFDF5", borderRadius: 6, fontSize: 10, fontWeight: 700, color: "#059669" }}>
            <CheckCircle2 style={{ width: 12, height: 12 }} />
            解決済み{c.resolvedByName ? `（${c.resolvedByName}）` : ""}
          </div>
        )}

        {/* 投稿者・日時・⋯ */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Avatar userId={c.userId} name={c.userName} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.userName}</div>
            <div style={{ fontSize: 10, color: "#A09790" }}>
              {formatCommentTime(c.createdAt)}{c.updatedAt ? "（編集済み）" : ""}
            </div>
          </div>
          {/* 解決の切り替えは誰でもできる（ホワイトボードと同じ） */}
          <button
            onClick={() => toggleResolved(c)}
            title={c.resolved ? "未解決に戻す" : "解決済みにする（ピンは書類から消え、コメント一覧に残ります）"}
            style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: c.resolved ? "#059669" : "#B9B3AC", display: "flex" }}
          >
            {c.resolved ? <RotateCcw style={{ width: 13, height: 13 }} /> : <CheckCircle2 style={{ width: 14, height: 14 }} />}
          </button>
          <ItemMenu
            own={c.userId === userId}
            onCopyLink={() => void copyLink(c.id)}
            onEdit={() => { pinOpen(c.id); setEditing({ kind: "comment", id: c.id }); setEditText(c.text); }}
            onDelete={() => removeComment(c.id)}
          />
        </div>

        {/* 本文（編集中は入力欄に差し替え） */}
        {editingThis ? (
          <Composer
            value={editText} onChange={setEditText} onSubmit={() => saveEdit(c)} onCancel={() => setEditing(null)}
            placeholder="コメントを入力…" submitLabel="保存" autoFocus members={members} selfName={userName}
          />
        ) : (
          <div style={{ fontSize: 12, lineHeight: 1.7, color: "#1A1714", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            <MentionText text={c.text} members={members} selfName={userName} />
          </div>
        )}

        {/* 返信アイコン ／ 返信を表示 */}
        {!editingThis && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => { pinOpen(c.id); setReplyOpen(true); }}
              title="このコメントに返信"
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 7px", fontSize: 11, fontWeight: 600, color: "#0284C7", background: "transparent", border: "1px solid rgba(2,132,199,0.25)", borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}
            >
              <CornerDownRight style={{ width: 12, height: 12 }} />返信
            </button>
            {list.length > 0 && (
              <button
                onClick={() => { pinOpen(c.id); setShowReplies((v) => !v); }}
                style={{ display: "flex", alignItems: "center", gap: 3, padding: 0, fontSize: 11, fontWeight: 600, color: "#6B6458", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
              >
                {showReplies ? <ChevronUp style={{ width: 12, height: 12 }} /> : <ChevronDown style={{ width: 12, height: 12 }} />}
                {showReplies ? "返信を隠す" : `返信を表示（${list.length}）`}
              </button>
            )}
          </div>
        )}

        {/* 返信一覧（2件ぶんくらいで頭打ちにして、以降はスクロール） */}
        {showReplies && list.length > 0 && (
          <div style={{ maxHeight: REPLY_LIST_MAX_H, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 8 }}>
            {list.map((r) => {
              const editingReply = editing?.kind === "reply" && editing.id === r.id;
              return (
                <div key={r.id} style={{ display: "flex", gap: 7 }}>
                  <Avatar userId={r.userId} name={r.userName} size={18} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.userName}</span>
                      <span style={{ fontSize: 10, color: "#A09790", flexShrink: 0 }}>
                        {formatCommentTime(r.createdAt)}{r.updatedAt ? "（編集済み）" : ""}
                      </span>
                      <div style={{ marginLeft: "auto" }}>
                        <ItemMenu
                          own={r.userId === userId}
                          onCopyLink={() => void copyLink(c.id, r.id)}
                          onEdit={() => { pinOpen(c.id); setEditing({ kind: "reply", id: r.id }); setEditText(r.text); }}
                          onDelete={() => removeReply(c.id, r.id)}
                        />
                      </div>
                    </div>
                    {editingReply ? (
                      <Composer
                        value={editText} onChange={setEditText} onSubmit={() => saveEdit(c)} onCancel={() => setEditing(null)}
                        placeholder="返信を入力…" submitLabel="保存" autoFocus minRows={2} members={members} selfName={userName}
                      />
                    ) : (
                      <div style={{ fontSize: 12, lineHeight: 1.7, color: "#1A1714", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        <MentionText text={r.text} members={members} selfName={userName} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 返信の入力欄 */}
        {replyOpen && !editingThis && (
          <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 8 }}>
            <Composer
              value={replyText} onChange={setReplyText}
              onSubmit={() => saveReply(c)}
              onCancel={() => { setReplyOpen(false); setReplyText(""); }}
              placeholder="返信を入力…（Enterで改行 / @でメンション）" submitLabel="返信" autoFocus members={members} selfName={userName}
            />
          </div>
        )}
      </div>
    );
  };

  const activeComment = activeId ? comments.find((c) => c.id === activeId) ?? null : null;

  return (
    // 位置と大きさは rAF がスクロール箱に合わせて毎フレーム書く（初期値は全面）
    <div
      ref={layerRef}
      data-fbc-layer
      style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", zIndex: 3, pointerEvents: "none", overflow: "hidden" }}
    >
      {/* コメントモード中だけ書類全体を覆って、クリックをピンの設置に使う。
          PDF は iframe（＝中のクリックは親に届かない）なので、覆うのが唯一の方法。
          その代わりホイールは自前でスクロール箱へ流す（覆っている間も書類を送れるように）。 */}
      {commentMode && (
        <div
          data-fbc-ui
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const p = toNorm(e.clientX, e.clientY);
            if (!p) return;
            // 入力途中でも位置だけ差し替える（書いた文字は捨てない）
            setDraft((d) => ({ x: p.x, y: p.y, text: d?.text ?? "" }));
            closeTooltip();
          }}
          onWheel={(e) => {
            const sc = scrollHostRef.current;
            if (!sc) return;
            sc.scrollTop += e.deltaY;
            sc.scrollLeft += e.deltaX;
          }}
          style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "auto", cursor: PIN_CURSOR }}
        />
      )}

      {/* ピン */}
      {comments.map((c) => {
        const list = replies[c.id] ?? [];
        const active = activeId === c.id;
        // 解決済みのピンは書類から消す。ただし一覧やリンクから開いている間だけは出す。
        if (c.resolved && !active) return null;
        return (
          <div key={c.id} data-fbc-anchor data-id={c.id} data-x={c.x} data-y={c.y}
            style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, zIndex: 2 }}>
            <button
              data-fbc-ui
              onMouseEnter={() => { if (pinDrag.current) return; cancelClose(); setHoverId(c.id); }}
              onMouseLeave={() => { if (!stickyId && !pinDrag.current) scheduleClose(); }}
              onPointerDown={(e) => onPinPointerDown(e, c)}
              onClick={(e) => {
                e.stopPropagation();
                // 動かした直後は吹き出しを開かない
                if (suppressClick.current) { suppressClick.current = false; return; }
                pinOpen(c.id);
              }}
              title={`${c.userName} のコメント（ドラッグで移動）`}
              style={{
                position: "absolute", left: 0, top: 0, transform: "translateY(-100%)",
                width: PIN_SIZE, height: PIN_SIZE, padding: 0, pointerEvents: "auto",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: c.resolved ? "#9CA3AF" : wbUserColor(c.userId || "anon"), color: "#fff",
                border: "2px solid #fff", borderRadius: "13px 13px 13px 3px",
                boxShadow: active ? "0 0 0 3px rgba(2,132,199,0.35), 0 4px 12px rgba(0,0,0,0.25)" : "0 3px 10px rgba(0,0,0,0.22)",
                cursor: "grab", fontSize: 11, fontWeight: 700, fontFamily: "inherit", lineHeight: 1,
                touchAction: "none", // タッチでもドラッグできるように（スクロールに奪わせない）
              }}
            >
              {initialOf(c.userName)}
              {list.length > 0 && (
                <span style={{
                  position: "absolute", right: -5, top: -5, minWidth: 14, height: 14, padding: "0 3px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "#F59E0B", color: "#fff", border: "1.5px solid #fff", borderRadius: 7,
                  fontSize: 9, fontWeight: 700, boxSizing: "border-box",
                }}>{list.length}</span>
              )}
            </button>
          </div>
        );
      })}

      {/* 開いている吹き出し。ピンと同じ錨（data-id）を持たせて、動かす時も追従させる */}
      {activeComment && (
        <div data-fbc-anchor data-id={activeComment.id} data-x={activeComment.x} data-y={activeComment.y}
          style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, zIndex: 4 }}>
          {renderTooltip(activeComment)}
        </div>
      )}

      {/* 新規コメントの下書き（仮ピン＋入力欄） */}
      {draft && (
        <div data-fbc-anchor data-x={draft.x} data-y={draft.y}
          style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, zIndex: 4 }}>
          <div style={{
            position: "absolute", left: 0, top: 0, transform: "translateY(-100%)",
            width: PIN_SIZE, height: PIN_SIZE, display: "flex", alignItems: "center", justifyContent: "center",
            background: wbUserColor(userId || "anon"), color: "#fff", border: "2px dashed #fff",
            borderRadius: "13px 13px 13px 3px", boxShadow: "0 3px 10px rgba(0,0,0,0.22)",
          }}>
            <MessageSquare style={{ width: 13, height: 13 }} />
          </div>
          <div
            data-fbc-ui data-fbc-panel
            onWheel={(e) => e.stopPropagation()}
            style={{
              ...commentCardStyle,
              position: "absolute", left: PIN_SIZE + TIP_GAP, top: -30, width: TIP_W, zIndex: 2,
              pointerEvents: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Avatar userId={userId} name={userName} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>{userName}</span>
            </div>
            <Composer
              value={draft.text}
              onChange={(v) => setDraft((d) => (d ? { ...d, text: v } : d))}
              onSubmit={saveDraft}
              onCancel={() => setDraft(null)}
              placeholder="コメントを入力…（Enterで改行 / @でメンション）"
              submitLabel="保存"
              autoFocus
              minRows={3}
              members={members}
              selfName={userName}
            />
          </div>
        </div>
      )}

      {/* コメント一覧ポップアップ（未解決/解決済み）。ホワイトボードと同じ部品。
          一覧に出ている＝すでに手元にあるので、飛ぶ時に再探索は要らない。
          出す位置はヘッダー右上の一覧ボタンの真下（ホワイトボードは下部ツールバーを避けて右下）。 */}
      {listOpen && (
        <CommentListPanel
          placement="top"
          comments={comments}
          replies={replies}
          activeId={activeId}
          members={members}
          selfName={userName}
          onJump={(id) => { focusComment(id); }}
          onClose={() => setListOpen(false)}
        />
      )}
    </div>
  );
}
