// 自動ログアウト(ENHA2-027)の時刻計算ユーティリティ。
// 「毎日ローカル時刻3:00にログアウト」を “3時境界の通過” 判定で実現する。
// 単純な「3:00ちょうどに setTimeout」ではアプリ非起動時(スリープ/タブ閉)に
// 発火できないため、ログイン時刻を localStorage に保存し
// 「loginAt が直近に過ぎた3:00より前なら跨いだ=ログアウト」で判定する。

// ログイン時刻。アプリ再起動をまたいで跨ぎ検出するため sessionStorage 不可(localStorage)。
const LOGIN_AT_KEY = "autoLogout.loginAt";

// ログアウトの基準時刻(ローカル時刻の時)。夜中3時。
export const LOGOUT_HOUR = 3;

// ログアウト前の予告猶予(ms)。フォアグラウンドで3時を迎える場合のみ予告できる。
export const GRACE_MS = 60_000;

export function readLoginAt(): number | null {
  try {
    const raw = localStorage.getItem(LOGIN_AT_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ログイン成功時に呼ぶ。常に上書きしてその時刻を起点にする。
export function recordLoginAt(now: number = Date.now()): void {
  try {
    localStorage.setItem(LOGIN_AT_KEY, String(now));
  } catch {
    /* localStorage 使用不可でも致命ではない */
  }
}

// 未設定のときだけ now で初期化する。SIGNED_IN などログイン経路が複数ある場合に、
// 既に記録済みの loginAt(トークン更新等)を潰さないために使う。
export function recordLoginAtIfMissing(now: number = Date.now()): void {
  if (readLoginAt() === null) recordLoginAt(now);
}

export function clearLoginAt(): void {
  try {
    localStorage.removeItem(LOGIN_AT_KEY);
  } catch {
    /* ignore */
  }
}

// now 以前(またはちょうど)の直近ローカル3:00の epoch(ms)。
export function lastBoundaryMs(now: number = Date.now()): number {
  const d = new Date(now);
  const boundary = new Date(d.getFullYear(), d.getMonth(), d.getDate(), LOGOUT_HOUR, 0, 0, 0);
  // まだ本日3:00より前なら、直近の境界は前日の3:00。
  if (boundary.getTime() > now) boundary.setDate(boundary.getDate() - 1);
  return boundary.getTime();
}

// now 以降の次のローカル3:00の epoch(ms)。予告つき経路のタイマー設定に使う。
export function nextBoundaryMs(now: number = Date.now()): number {
  const d = new Date(now);
  const boundary = new Date(d.getFullYear(), d.getMonth(), d.getDate(), LOGOUT_HOUR, 0, 0, 0);
  // 既に本日3:00を過ぎていれば、次の境界は翌日の3:00。
  if (boundary.getTime() <= now) boundary.setDate(boundary.getDate() + 1);
  return boundary.getTime();
}

// ログイン後に3時境界を跨いだ(=ログアウトすべき)か。
// loginAt 未設定(機能リリース時点の既存セッション等)は now で初期化してフェイルオープン。
// = その回は false を返し、次の3:00まで生存させる。
export function shouldLogout(now: number = Date.now()): boolean {
  let loginAt = readLoginAt();
  if (loginAt === null) {
    recordLoginAt(now);
    loginAt = now;
  }
  return loginAt < lastBoundaryMs(now);
}
