// 共有可能な「公開オリジン」を返す。
//
// 絶対URLを作るときに window.location.origin をそのまま使うと、
//   ・Mac/iPadアプリ(Capacitor) … capacitor://localhost → 他人に渡しても開けない
//   ・タブモード(MemoryRouter)   … 実URLがアプリの現在地と一致しない
// という問題が出る。共有用URLは必ずここを通す。
//
// VITE_PUBLIC_APP_ORIGIN（例: https://dev-ticket.example.com）を .env / Vercel に設定すると
// どの環境でもそれが使われる。未設定なら Web は現在のオリジンにフォールバックし、
// ネイティブ(http以外のスキーム)では空文字を返す（呼び出し側が警告を出す）。
export function appOrigin(): string {
  const env = (import.meta as any).env?.VITE_PUBLIC_APP_ORIGIN as string | undefined;
  if (env) return env.replace(/\/+$/, "");
  const o = typeof window !== "undefined" ? window.location.origin : "";
  return /^https?:/.test(o) ? o : "";
}

// 本番の公開ドメイン。VITE_PUBLIC_APP_ORIGIN が未設定の環境（ローカル開発・プレビュー配信・
// ネイティブアプリ）でも、本番URLを貼れば「自分のアプリのリンク」として認識できるようにするため、
// 判定側にだけ定数で持たせる。URL生成には使わない（生成は必ず appOrigin() を通す）。
const PRODUCTION_ORIGINS = ["https://dv-ticket.com", "https://www.dv-ticket.com"];

// 内部リンク判定に使う「自分のアプリとみなすオリジン」一覧。
export function knownAppOrigins(): string[] {
  const list: string[] = [];
  const env = appOrigin();
  if (env) list.push(env);
  if (typeof window !== "undefined" && window.location.origin) list.push(window.location.origin);
  list.push(...PRODUCTION_ORIGINS);
  return Array.from(new Set(list));
}
