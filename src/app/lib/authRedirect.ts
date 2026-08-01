// 未ログイン状態でディープリンクを開いたときに、ログイン後そのURLへ戻すための退避場所。
//
// ログイン状態フラグ(isLoggedIn)は sessionStorage＝タブ単位なので、
// 共有されたURLを「新しいタブ」で開くと必ずログイン画面を経由する。
// 従来はそこで元のURLが捨てられ、ログイン後は常に /dashboard に着地していた。
const KEY = "postLoginRedirect";

// ログイン導線そのものや公開ページは戻り先にしない
const IGNORE = ["/", "/login", "/accept-invite", "/book-demo", "/demo-preview", "/privacy", "/terms", "/news"];

export function rememberRedirect(pathWithSearch: string): void {
  if (!pathWithSearch) return;
  const path = pathWithSearch.split("?")[0];
  if (IGNORE.some((p) => path === p || (p !== "/" && path.startsWith(p + "/")))) return;
  try { sessionStorage.setItem(KEY, pathWithSearch); } catch { /* プライベートモード等 */ }
}

/** 読むだけ（レンダー中に呼んでも安全）。 */
export function peekRedirect(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

export function clearRedirect(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* noop */ }
}
