// 「すでに開いているボードの、このオブジェクトへ飛べ」をキャンバスへ直接届けるローカルバス。
//
// 同じボードを2枚マウントすると Yjs Doc / awareness / doc_state 保存が二重化し、
// 自分のアバターが2人に見える・保存が競合する、といった不具合になる。
// そこでリンクを踏んだ時、そのボードが既に「見えている状態で」開かれていれば
// プレビューパネルを出さず、開いているキャンバスにフォーカス要求だけを送る。
//
// ハンドラは「自分が処理したか」を返す。タブモード(Mac/iPad)では非アクティブタブも
// マウントされたまま(visibility:hidden + inert)なので、見えていないキャンバスは false を返し、
// 呼び出し側はプレビューパネルを開くほうへフォールバックする。
export interface WhiteboardFocusTarget {
  /** 図形/グループ（?element=） */
  elementId: string | null;
  /** コメントのピン（?comment=・ENHA2-039） */
  commentId?: string | null;
  /** 返信（?reply=）。着地時に返信一覧を開く */
  replyId?: string | null;
}

type FocusHandler = (target: WhiteboardFocusTarget) => boolean;

const handlers = new Map<string, Set<FocusHandler>>();

/** キャンバス側の購読。戻り値で解除。 */
export function onWhiteboardFocusRequest(boardId: string, handler: FocusHandler): () => void {
  let set = handlers.get(boardId);
  if (!set) { set = new Set(); handlers.set(boardId, set); }
  set.add(handler);
  return () => {
    const s = handlers.get(boardId);
    if (!s) return;
    s.delete(handler);
    if (s.size === 0) handlers.delete(boardId);
  };
}

/** 開いているキャンバスへフォーカス要求を送る。どれかが処理したら true。 */
export function requestWhiteboardFocus(boardId: string, target: WhiteboardFocusTarget): boolean {
  const set = handlers.get(boardId);
  if (!set || set.size === 0) return false;
  let handled = false;
  set.forEach((h) => {
    try { handled = h(target) || handled; } catch { /* noop */ }
  });
  return handled;
}
