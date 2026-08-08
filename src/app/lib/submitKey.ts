import type { KeyboardEventHandler } from "react";

/**
 * テキストエリア(および書式エディタ)の「確定」ショートカット。
 *   Mac      … ⌘ + Enter
 *   Windows  … Ctrl + Enter
 *
 * Enter 単体はこれまでどおり改行のままにして、明示的な確定だけを拾う。
 * IME変換中の Enter（日本語入力の確定）を誤って拾うと文章の途中で送信されてしまうので、
 * isComposing を必ず見ること。keydown の isComposing は変換確定の Enter でも true になる。
 *
 * 「はい／いいえ」だけの確認ダイアログ(ConfirmDialog 等)は入力欄が無いので対象外。
 */
export function isSubmitShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  isComposing?: boolean;
}): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing;
}

/**
 * 素の <textarea> / <input> 用。
 *   <textarea onKeyDown={submitOnModEnter(handleSave)} />
 * onSubmit が undefined のときは何もしないので、任意プロップをそのまま渡してよい。
 *
 * 既に onKeyDown を持っている入力欄では、既存処理を先に走らせてから
 * `submitOnModEnter(fn)(e)` を呼ぶ形で合成する（候補ポップアップ等を壊さないため）。
 */
export function submitOnModEnter<T extends HTMLElement>(
  onSubmit?: (() => void) | null,
  opts?: { enabled?: boolean },
): KeyboardEventHandler<T> {
  return (e) => {
    if (!onSubmit || opts?.enabled === false) return;
    if (!isSubmitShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, isComposing: e.nativeEvent.isComposing })) return;
    e.preventDefault();
    // ダイアログ側やキャンバス側の keydown まで届くと二重動作になるため止める
    e.stopPropagation();
    onSubmit();
  };
}
