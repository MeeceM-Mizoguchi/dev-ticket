import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

// ENHA2-035: ファイルボックスのファイル(%メンション)も同じ仕組みでプレビューする
// whiteboard: 貼り付けたオブジェクトリンクをクリックすると右半分にボードを開く
export type PreviewType = "backlog" | "wiki" | "minute" | "file" | "whiteboard";
export interface PreviewTarget {
  type: PreviewType;
  id: string;
  /** whiteboard 用: 飛び先のオブジェクト(要素ID/グループID)。null ならボードを開くだけ */
  elementId?: string | null;
  /** whiteboard 用: 飛び先のコメント／返信（ENHA2-039） */
  commentId?: string | null;
  replyId?: string | null;
  /** whiteboard 用: 判明していれば渡す（未指定ならパネル側で boardId から逆引きする） */
  projectSlug?: string;
}
export interface PreviewOptions { elementId?: string | null; commentId?: string | null; replyId?: string | null; projectSlug?: string }

const Ctx = createContext<{
  target: PreviewTarget | null;
  open: (type: PreviewType, id: string, opts?: PreviewOptions) => void;
  close: () => void;
}>({ target: null, open: () => {}, close: () => {} });

export function PreviewPanelProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<PreviewTarget | null>(null);
  const open = useCallback((type: PreviewType, id: string, opts?: PreviewOptions) => {
    setTarget({
      type, id,
      elementId: opts?.elementId ?? null,
      commentId: opts?.commentId ?? null,
      replyId: opts?.replyId ?? null,
      projectSlug: opts?.projectSlug,
    });
  }, []);
  const close = useCallback(() => setTarget(null), []);
  return (
    <Ctx.Provider value={{ target, open, close }}>
      {children}
    </Ctx.Provider>
  );
}

export const usePreviewPanel = () => useContext(Ctx);
