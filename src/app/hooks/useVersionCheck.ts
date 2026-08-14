import { useEffect, useRef } from "react";
import { useToast } from "@/app/contexts/ToastContext";
import { APP_BUILD_TIME, APP_VERSION } from "@/lib/version";

const CHECK_INTERVAL = 2 * 60 * 1000;

// 通知を出してから実際にリロードするまでの待ち時間。
// 「気づかないうちに画面が飛んだ」を防ぐため、トーストが確実に読める長さにする。
const NOTIFY_DELAY = 2200;

// 同じ版へのリロードを何回まで試すか（＝リロードループ防止）。
// 以前は「1回試したら二度と試さない」だったため、CDN の伝播待ちなどで
// リロードしても古いバンドルが返ってきた瞬間に、そのタブは永久に更新されなくなっていた。
// 回数制限＋クールダウンにして、失敗しても次の機会に必ずやり直す。
const MAX_ATTEMPTS = 3;
const RETRY_COOLDOWN = 90 * 1000;

// キャッシュ掃除が何らかの理由で終わらなくても、更新自体は必ず進める。
const PURGE_TIMEOUT = 1500;

const ATTEMPT_KEY = "versionCheck.attempt";     // {to,count,at} 同一版へのリロード試行状況
const UPDATED_TO_KEY = "versionCheck.updatedTo"; // 直前のリロードで目指した版
const BUST_PARAM = "_v";                         // リロード時のキャッシュバスター

interface Attempt { to: string; count: number; at: number; }

function readAttempt(): Attempt | null {
  try {
    const raw = sessionStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.to === "string" ? v as Attempt : null;
  } catch { return null; }
}

function writeAttempt(a: Attempt): void {
  try { sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(a)); } catch { /* ignore */ }
}

function clearAttempt(): void {
  try { sessionStorage.removeItem(ATTEMPT_KEY); } catch { /* ignore */ }
}

// 更新後の初回描画で「APIを叩き直す」ことを RefreshProvider へ伝えるフラグ。
// リロードでモジュールごと作り直されるので、状態が残り続けることはない。
let postUpdateRefreshPending = false;

/** 直前に自動更新でリロードしてきた直後かどうか。1回だけ true を返す。 */
export function consumePostUpdateRefresh(): boolean {
  if (!postUpdateRefreshPending) return false;
  postUpdateRefreshPending = false;
  return true;
}

// キャッシュバスター(?_v=...)を付けたままだと画面のURLが汚れるので、
// React(BrowserRouter)が現在地を読むより前＝モジュール読み込み時に消しておく。
(function stripBustParam() {
  try {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(BUST_PARAM)) return;
    url.searchParams.delete(BUST_PARAM);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch { /* ignore */ }
})();

async function fetchBuildTime(): Promise<string | null> {
  try {
    const res = await fetch(`/build-info.json?_=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
    });
    if (!res.ok) return null; // 404 in dev mode — skip
    const data = await res.json();
    return data?.buildTime ?? null;
  } catch {
    return null;
  }
}

// 新しいUIを確実に映すため、リロード前に「古い資産を返しうる層」を落としておく。
// Service Worker / Cache Storage が無い環境では何も起きない。
async function purgeStaleCaches(): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  try {
    if ("serviceWorker" in navigator) {
      jobs.push(
        navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister())))
      );
    }
  } catch { /* ignore */ }
  try {
    if (typeof caches !== "undefined") {
      jobs.push(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
    }
  } catch { /* ignore */ }
  if (jobs.length === 0) return;
  await Promise.race([
    Promise.all(jobs).catch(() => undefined),
    new Promise(resolve => setTimeout(resolve, PURGE_TIMEOUT)),
  ]);
}

// index.html / 各アセットを必ずサーバーから取り直させるリロード。
// location.reload() は環境によってキャッシュから復元されることがあるため、
// URL自体を変える(=別リクエストにする)ことで確実に新しいバンドルを取りに行かせる。
function hardReload(buildTime: string): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(BUST_PARAM, buildTime);
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

// デプロイされた新しいバージョンを検知して自動リロードする（BRU3-070 / BRU11-045）。
//
// 判定の基準は「今動いているバンドル自身のビルド時刻(APP_BUILD_TIME)」。
// 以前は “マウント時にサーバーから取得した値” を基準にしていたため、
// ログアウト→ログインなどでシェルが再マウントされると基準が最新版に付け替わり、
// 古いバンドルのまま二度と更新されない状態になっていた。
// 焼き込み値を基準にすれば、マウントのタイミングに一切依存しない。
//
// 流れ: 検知 → トーストで通知 → キャッシュ掃除 → キャッシュバスター付きリロード
//       → 更新後の初回描画で「更新しました」通知＋全ページのAPI再取得。
//
// ※ネイティブ(Mac/iPad)アプリは build-info.json も同梱物なので常に一致し、何も起きない。
// ※dev サーバーは build-info.json が無い(404)ためスキップされる。
export function useVersionCheck() {
  const { toast } = useToast();
  const reloading = useRef(false);
  const manualNotified = useRef(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const check = useRef(async () => {
    if (reloading.current) return;
    if (!APP_BUILD_TIME) return; // ビルド時刻が焼き込まれていない環境ではスキップ
    const serverBuildTime = await fetchBuildTime();
    if (!serverBuildTime) return; // dev mode or fetch failed — skip
    if (serverBuildTime === APP_BUILD_TIME) { clearAttempt(); return; } // 最新版で稼働中

    const prev = readAttempt();
    const sameTarget = prev?.to === serverBuildTime;

    // 規定回数リロードしても新しいバンドルに乗り換えられない異常時。
    // 黙って諦めず、手動更新をお願いする(同一版につき1回だけ)。
    if (sameTarget && prev!.count >= MAX_ATTEMPTS) {
      if (!manualNotified.current) {
        manualNotified.current = true;
        toastRef.current("新しいバージョンがあります。お手数ですが画面を手動で再読み込みしてください。", "error");
      }
      return;
    }
    // 直前の試行から間もない場合は待つ(デプロイ伝播中の連続リロードを防ぐ)。
    if (sameTarget && Date.now() - prev!.at < RETRY_COOLDOWN) return;

    reloading.current = true;
    writeAttempt({ to: serverBuildTime, count: sameTarget ? prev!.count + 1 : 1, at: Date.now() });
    try { sessionStorage.setItem(UPDATED_TO_KEY, serverBuildTime); } catch { /* ignore */ }

    toastRef.current("新しいバージョンが公開されました。画面を更新します…", "info");
    setTimeout(() => {
      void purgeStaleCaches().then(() => hardReload(serverBuildTime));
    }, NOTIFY_DELAY);
  });

  useEffect(() => {
    // 自動更新でリロードしてきた直後なら、着地できたかを判定する。
    let updatedTo: string | null = null;
    try { updatedTo = sessionStorage.getItem(UPDATED_TO_KEY); } catch { /* ignore */ }
    if (updatedTo) {
      try { sessionStorage.removeItem(UPDATED_TO_KEY); } catch { /* ignore */ }
      if (updatedTo === APP_BUILD_TIME) {
        // 新しいバンドルに乗り換え成功。試行状況を消して、データも取り直す。
        clearAttempt();
        postUpdateRefreshPending = true;
        toastRef.current(`最新バージョン ${APP_VERSION} に更新しました`);
      }
      // 着地できなかった場合は試行状況を残したままにして、次回リトライさせる。
    }

    check.current();
    const id = setInterval(() => check.current(), CHECK_INTERVAL);

    const onFocus = () => check.current();
    const onVisible = () => { if (!document.hidden) check.current(); };
    // bfcache から復元された場合も検知
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) check.current(); };
    // スリープ復帰直後はまだ回線が復旧しておらず fetch が失敗しがち。
    // オンライン復帰時にもう一度確かめる。
    const onOnline = () => check.current();

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);

    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
    };
  }, []);
}
