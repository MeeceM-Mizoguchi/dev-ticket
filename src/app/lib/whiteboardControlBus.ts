// 開いているホワイトボードキャンバスへ「今すぐ保存して」を届けるローカルバス。
//
// doc_state の保存は useWhiteboardSync 内で 1.5 秒デバウンスしている。
// プライベートモードに切り替えるとチャンネル名が変わりキャンバスが張り直る（＝DBから読み直す）ため、
// デバウンス待ちの編集が残っていると、その分が消える。切替の直前にここから吐き出させる。
//
// ページ側（WhiteboardPage）が useWhiteboardSync を直接 import すると Yjs / Excalidraw が
// メインチャンクに載ってしまう（キャンバスは lazy 読み込みで分離している）ため、
// 依存を持たないこのファイルを噛ませる。
export interface WhiteboardControl {
  /** 保存デバウンスを打ち切り、今の doc_state を即保存する */
  flushSave: () => Promise<void>;
  /** 同じボードを開いている他メンバーへ退去を通知する（既に張ってあるチャンネルから送る） */
  broadcastEvict: () => void;
}

const controls = new Map<string, WhiteboardControl>();

/** キャンバス側の登録。戻り値で解除。 */
export function registerWbControl(boardId: string, control: WhiteboardControl): () => void {
  controls.set(boardId, control);
  return () => { if (controls.get(boardId) === control) controls.delete(boardId); };
}

/** そのボードが今開かれていれば制御を返す（開いていなければ null）。 */
export function getWbControl(boardId: string): WhiteboardControl | null {
  return controls.get(boardId) ?? null;
}
