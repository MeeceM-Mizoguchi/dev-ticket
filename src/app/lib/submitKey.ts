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

/**
 * IME変換中か。日本語入力の「変換確定Enter」を確定操作として拾わないための唯一の判定。
 *
 * keydown は変換確定の Enter でも発火し、isComposing が true で来る。
 * Safari など一部環境では isComposing が落ちて keyCode だけ 229 になるので両方見る。
 * React の合成イベント(e.nativeEvent)・素の KeyboardEvent のどちらでも渡せる。
 */
export function isImeComposing(e: {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}): boolean {
  const n = e.nativeEvent ?? e;
  return !!n.isComposing || n.keyCode === 229;
}

/**
 * 「Enter単体で確定」してよいキー入力か（1行入力欄・候補ポップアップ用）。
 * Shift+Enter と修飾キー付きは確定扱いにしない。
 */
export function isPlainEnter(e: {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}): boolean {
  return e.key === "Enter" && !e.shiftKey && !isImeComposing(e);
}

/**
 * 1行の <input> 用。Enter で確定、Escape で取り消し。
 *   <input onKeyDown={submitOnEnter(save, { onCancel: close })} />
 *
 * 複数行の <textarea> は Enter が改行なので、こちらではなく submitOnModEnter を使うこと。
 * ★1行入力欄で `if (e.key === "Enter") save()` と直に書かない。
 *   日本語変換の確定Enterまで拾って、打ちかけの名前で保存されてしまう。
 */
export function submitOnEnter<T extends HTMLElement>(
  onSubmit?: (() => void) | null,
  opts?: { enabled?: boolean; onCancel?: (() => void) | null },
): KeyboardEventHandler<T> {
  return (e) => {
    if (e.key === "Escape" && opts?.onCancel) {
      e.preventDefault();
      e.stopPropagation();
      opts.onCancel();
      return;
    }
    if (!onSubmit || opts?.enabled === false) return;
    if (!isPlainEnter(e)) return;
    e.preventDefault();
    // ダイアログ側やキャンバス側の keydown まで届くと二重動作になるため止める
    e.stopPropagation();
    onSubmit();
  };
}
