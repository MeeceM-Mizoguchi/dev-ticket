import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { useToast } from "@/app/contexts/ToastContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { APP_BUILD_TIME, APP_DEPLOY_ENV, APP_VERSION } from "@/lib/version";

// ── デプロイ検知と自動更新（BRU3-070 / BRU11-045） ─────────────────────────
//
// 判定の基準は「今動いているバンドル自身のビルド時刻(APP_BUILD_TIME)」。
// 以前は “マウント時にサーバーから取得した値” を基準にしていたため、
// ログアウト→ログインなどでシェルが再マウントされると基準が最新版に付け替わり、
// 古いバンドルのまま二度と更新されない状態になっていた。
// 焼き込み値を基準にすれば、マウントのタイミングに一切依存しない。
//
// デプロイを知る手段は2つある。
//   ① DB(app_version) … 本番ビルドの最後に記録される＝「デプロイが始まった」。
//      この時点ではまだ本番は古い版を返すので、リロードしても更新されない。
//      （「最新版を確認して再読み込み」を押しても変わらなかった原因）
//   ② /build-info.json … 本番が実際に切り替わった＝「公開が終わった」。
// ①を見つけたら②に切り替わるまでプログレスを出して待ち、②になったらリロードする。
//
// 流れ（すべて AppUpdateOverlay に進捗として出る）:
//   検知 → 公開待ち(①のときだけ) → キャッシュ掃除 → キャッシュバスター付きリロード
//   → 新しいバンドルで起動 → データ取り直しが落ち着くまで待つ → 完了表示 → 閉じる
// リロードをまたぐ間は index.html の起動用オーバーレイが同じ見た目で穴を埋めるので、
// 最初から最後までプログレスが途切れない。
//
// ※ネイティブ(Mac/iPad)アプリは build-info.json も同梱物なので常に一致し、何も起きない。
// ※dev サーバーは build-info.json が無い(404)ためスキップされる。

const CHECK_INTERVAL = 60 * 1000;
// 画面遷移のたびに確認する（DB も見る）。連続した遷移で叩きすぎないよう、ごく短い間隔だけまとめる。
const NAV_DEDUPE = 3 * 1000;
// ボタン・リンクのクリックでも確認する（DB も見る）。クリックは頻繁なので最短この間隔。
const CLICK_THROTTLE = 10 * 1000;
// DB(RPC)への問い合わせは定期確認では最短この間隔。利用者の操作・手動確認では毎回問い合わせる。
const PENDING_POLL = 30 * 1000;
// 公開待ちの間、build-info.json を確かめる間隔。
const LIVE_POLL = 4 * 1000;
// DB に記録されてからこの時間が過ぎても本番が切り替わらない版は、デプロイ失敗とみなして待たない。
// （待ち続けて画面を塞がないための上限。通常は記録から1〜2分で切り替わる）
const MAX_PENDING_AGE_SEC = 10 * 60;
// 公開待ちの間に、さらに新しい版のデプロイが始まった(マージが連続した等)とき、
// 途中の版がすでに本番に出ていれば、後の版をこの時間だけ待ってから途中の版で妥協する。
const CHAIN_WAIT = 3 * 60 * 1000;

// 同じ版へのリロードを何回まで試すか（＝リロードループ防止）。
// 以前は「1回試したら二度と試さない」だったため、CDN の伝播待ちなどで
// リロードしても古いバンドルが返ってきた瞬間に、そのタブは永久に更新されなくなっていた。
// 回数制限＋クールダウンにして、失敗しても次の機会に必ずやり直す。
const MAX_ATTEMPTS = 3;
const RETRY_COOLDOWN = 90 * 1000;
// リロードしても古いバンドルだったときに、もう一度読み込むまでの待ち（試行回数に比例）。
const LANDING_RETRY_DELAY = 2500;

// キャッシュ掃除が何らかの理由で終わらなくても、更新自体は必ず進める。
const PURGE_TIMEOUT = 1500;
// 一瞬で終わっても工程が読めるよう、キャッシュ整理は最低この時間見せる。
const MIN_PREPARE = 1200;

// 新しいバンドルで起動してから「落ち着いた」と判断する条件。
// 通信(リソース取得)が SETTLE_QUIET の間途切れたら完了。最短 SETTLE_MIN・最長 SETTLE_MAX。
const SETTLE_MIN = 1200;
const SETTLE_QUIET = 800;
const SETTLE_MAX = 10 * 1000;
// 完了表示を見せてから閉じるまで。
const DONE_HOLD = 1100;
// リロード直前に残した進捗を、この時間内の起動でのみ引き継ぐ。
const OVERLAY_TTL = 3 * 60 * 1000;

const ATTEMPT_KEY = "versionCheck.attempt";         // {to,count,at} 同一版へのリロード試行状況
const OVERLAY_KEY = "versionCheck.overlay";         // {to,version,progress,at} リロードをまたぐ進捗（index.html も読む）
const SKIP_PENDING_KEY = "versionCheck.skipPending"; // 公開を待ちきれなかった版（二度と待たない）
const LEGACY_UPDATED_TO_KEY = "versionCheck.updatedTo"; // 旧版のバンドルがリロード前に残すキー
const BUST_PARAM = "_v";                             // リロード時のキャッシュバスター

// ── sessionStorage ───────────────────────────────────────────────────────────

interface Attempt { to: string; count: number; at: number; }
interface OverlayMemo { to: string; version: string | null; progress: number; at: number; }

function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}
function writeJson(key: string, v: unknown): void {
  try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}
function removeKey(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}

function readAttempt(): Attempt | null {
  const v = readJson<Attempt>(ATTEMPT_KEY);
  return typeof v?.to === "string" ? v : null;
}
const writeAttempt = (a: Attempt) => writeJson(ATTEMPT_KEY, a);
const clearAttempt = () => removeKey(ATTEMPT_KEY);

// ── 更新オーバーレイの状態（React の外に持ち、AppUpdateOverlay が購読する） ──────

export type UpdatePhase =
  | "idle"
  | "waiting"    // デプロイを検知し、本番への公開が終わるのを待っている
  | "preparing"  // 古いキャッシュを片付けている
  | "reloading"  // 新しい画面を読み込んでいる
  | "finishing"  // 新しい画面で、データの取り直しが落ち着くのを待っている
  | "done"       // 完了表示（少し見せてから閉じる）
  | "failed";    // 規定回数リロードしても新しい画面に乗り換えられなかった

export interface UpdateState {
  phase: UpdatePhase;
  progress: number;       // 0〜100。工程が進む間は減らない
  version: string | null; // 更新先の版
  note: string | null;    // 補足（再試行中など）
}

const IDLE: UpdateState = { phase: "idle", progress: 0, version: null, note: null };

// リロード直後の起動かどうかは、React より前＝モジュール読み込み時に確定させる。
// 最初の描画からオーバーレイを出して、index.html の起動用オーバーレイと継ぎ目なく入れ替えるため。
const bootMemo: OverlayMemo | null = (() => {
  if (typeof window === "undefined") return null;
  const m = readJson<OverlayMemo>(OVERLAY_KEY);
  removeKey(OVERLAY_KEY);
  if (!m || typeof m.to !== "string" || !(Date.now() - m.at < OVERLAY_TTL)) return null;
  return m;
})();
// 目指した版のバンドルで起動できたか
const bootLanded = !!bootMemo && bootMemo.to === APP_BUILD_TIME;

// 旧版のバンドル(オーバーレイ導入前)から自動更新で入ってきた場合
const legacyLanded = (() => {
  if (typeof window === "undefined") return false;
  let to: string | null = null;
  try { to = sessionStorage.getItem(LEGACY_UPDATED_TO_KEY); } catch { /* ignore */ }
  if (!to) return false;
  removeKey(LEGACY_UPDATED_TO_KEY);
  return to === APP_BUILD_TIME;
})();

let state: UpdateState = bootMemo
  ? { phase: "finishing", progress: Math.max(bootMemo.progress, 86), version: bootMemo.version ?? APP_VERSION, note: null }
  : IDLE;
const listeners = new Set<() => void>();

function setState(patch: Partial<UpdateState>): void {
  const next = { ...state, ...patch };
  // 進捗は工程が続く間は戻さない（再試行で工程が1つ戻っても、輪は逆走させない）
  if (next.phase !== "idle" && next.progress < state.progress) next.progress = state.progress;
  state = next;
  listeners.forEach(l => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
const getState = () => state;

/** 更新オーバーレイの表示状態を購読する。 */
export function useAppUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** index.html の起動用オーバーレイから引き継いで表示を始めたか（出現アニメを省くため）。 */
export const STARTED_FROM_RELOAD = !!bootMemo;

// トーストは Provider の中でしか取れないので、フックから差し込んでもらう。
type Notify = (msg: string, kind?: "success" | "error" | "info") => void;
let notify: Notify = () => {};

// 更新後の初回描画で「APIを叩き直す」ことを RefreshProvider へ伝えるフラグ。
// リロードでモジュールごと作り直されるので、状態が残り続けることはない。
// RefreshProvider の初回 effect より先に立てたいので、モジュール読み込み時に確定させる。
let postUpdateRefreshPending = bootLanded || legacyLanded;
if (postUpdateRefreshPending) clearAttempt();

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

// ── サーバー側の版 ───────────────────────────────────────────────────────────

interface ServerBuild { buildTime: string; version: string | null; }
interface PendingRelease extends ServerBuild { deadline: number; }

async function fetchServerBuild(): Promise<ServerBuild | null> {
  try {
    const res = await fetch(`/build-info.json?_=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
    });
    if (!res.ok) return null; // 404 in dev mode — skip
    const data = await res.json();
    if (typeof data?.buildTime !== "string" || !data.buildTime) return null;
    return { buildTime: data.buildTime, version: typeof data.version === "string" ? data.version : null };
  } catch {
    return null;
  }
}

let rpcUnavailable = false; // RPC 未作成(SQL 未実行)なら、そのタブでは二度と叩かない
let lastPendingAt = 0;

// DB に記録済みで、本番にはまだ出ていない版（＝デプロイ中）を探す。
// 本番のバンドルでだけ見る（プレビューURLや手元ビルドの版は本番の記録と噛み合わない）。
async function fetchPendingRelease(force: boolean): Promise<PendingRelease | null> {
  if (APP_DEPLOY_ENV !== "production" || !isSupabaseEnabled || rpcUnavailable) return null;
  if (!force && Date.now() - lastPendingAt < PENDING_POLL) return null;
  lastPendingAt = Date.now();
  try {
    const { data, error } = await supabase!.rpc("get_latest_app_version");
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") rpcUnavailable = true;
      return null;
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;
    const theirs = Number(row.build_time);
    const mine = Number(APP_BUILD_TIME);
    const age = Number(row.age_seconds);
    if (!Number.isFinite(theirs) || !Number.isFinite(mine) || theirs <= mine) return null;
    if (!Number.isFinite(age) || age >= MAX_PENDING_AGE_SEC) return null;
    let skipped: string | null = null;
    try { skipped = sessionStorage.getItem(SKIP_PENDING_KEY); } catch { /* ignore */ }
    if (skipped === String(row.build_time)) return null;
    return {
      buildTime: String(row.build_time),
      version: typeof row.version === "string" ? row.version : null,
      deadline: Date.now() + (MAX_PENDING_AGE_SEC - age) * 1000,
    };
  } catch {
    return null;
  }
}

// ── 更新の各工程 ─────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ビルド時刻(epoch ms 文字列)で a が b より新しいか。数値にならない値は新しいとみなさない。
function isLater(a: string, b: string): boolean {
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && x > y;
}

// オーバーレイの裏で入力が続かないよう、フォーカスを外しておく。
function blurActive(): void {
  try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { /* ignore */ }
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
    sleep(PURGE_TIMEOUT),
  ]);
}

// index.html / 各アセットを必ずサーバーから取り直させるリロード。
// location.reload() は環境によってキャッシュから復元されることがあるため、
// URL自体を変える(=別リクエストにする)ことで確実に新しいバンドルを取りに行かせる。
// 再試行でも毎回別URLになるよう時刻を足す。
function hardReload(buildTime: string): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(BUST_PARAM, `${buildTime}.${Date.now()}`);
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

// 本番が新しい版を返すようになった → キャッシュを片付けてリロードする。
// ここから先はページが入れ替わるまでオーバーレイを閉じない。
async function startReload(server: ServerBuild, note: string | null = null): Promise<void> {
  blurActive();
  const prev = readAttempt();
  const same = prev?.to === server.buildTime;
  writeAttempt({ to: server.buildTime, count: same ? prev!.count + 1 : 1, at: Date.now() });

  const version = server.version ?? state.version;
  setState({ phase: "preparing", progress: 62, version, note });
  await Promise.all([purgeStaleCaches(), sleep(MIN_PREPARE)]);
  setState({ phase: "reloading", progress: 80 });

  // リロード後の起動用オーバーレイ(index.html)と AppUpdateOverlay に進捗を引き継ぐ
  writeJson(OVERLAY_KEY, { to: server.buildTime, version, progress: 85, at: Date.now() } satisfies OverlayMemo);
  await sleep(450); // 80% の描画を見せてから遷移する
  hardReload(server.buildTime);
}

// デプロイは始まっているが本番はまだ古い版 → 切り替わるまで待つ。
// マージが連続してデプロイが続けて走ったときは、最後の版が出るまで待ってから1回だけリロードする
// （途中の版で一度更新を終えると、次の画面遷移でもう一度全画面の更新が始まってしまう）。
async function startWaiting(pending: PendingRelease, note: string | null = null): Promise<void> {
  blurActive();
  const started = Date.now();
  let target = pending;
  let live: ServerBuild | null = null; // 本番に出ている、今より新しい版（target より古いこともある）
  let liveSince = 0;
  setState({ phase: "waiting", progress: 6, version: target.version, note });
  // 残り時間は分からないので、最初は速く・だんだんゆっくり 58% へ近づける
  const tick = setInterval(() => {
    setState({ progress: 8 + 50 * (1 - Math.exp(-(Date.now() - started) / 45000)) });
  }, 500);
  try {
    while (Date.now() < target.deadline) {
      await sleep(LIVE_POLL);
      // 待っている間に、さらに新しい版のデプロイが始まっていないか（PENDING_POLL 間隔で間引かれる）
      const newer = await fetchPendingRelease(false);
      if (newer && isLater(newer.buildTime, target.buildTime)) {
        target = newer;
        setState({ version: newer.version });
      }
      const server = await fetchServerBuild();
      if (server && server.buildTime !== APP_BUILD_TIME) {
        if (!isLater(target.buildTime, server.buildTime)) {
          clearInterval(tick);
          await startReload(server);
          return;
        }
        // 途中の版だけが出ている。後の版を待つが、待ちすぎたら途中の版で更新する
        if (live?.buildTime !== server.buildTime) { live = server; liveSince = Date.now(); }
        if (Date.now() - liveSince >= CHAIN_WAIT) break;
      }
    }
  } finally {
    clearInterval(tick);
  }
  if (live) {
    await startReload(live);
    return;
  }
  // 公開が終わらなかった（デプロイ失敗など）。今の版は動いているので画面を返す。
  try { sessionStorage.setItem(SKIP_PENDING_KEY, target.buildTime); } catch { /* ignore */ }
  setState(IDLE);
  notify("新しいバージョンの公開を確認できませんでした。現在のバージョンのままご利用いただけます。", "info");
}

// 新しいバンドルが起動したあと、データの取り直しなどが落ち着くまで待つ。
// 通信(Resource Timing)が一定時間途切れたら「落ち着いた」とみなす。上限あり。
function waitForSettled(): Promise<void> {
  return new Promise(resolve => {
    const start = Date.now();
    let last = start;
    let obs: PerformanceObserver | null = null;
    try {
      obs = new PerformanceObserver(() => { last = Date.now(); });
      obs.observe({ type: "resource" });
    } catch { /* 未対応ブラウザでは SETTLE_MIN だけ待つ */ }
    const tick = () => {
      const now = Date.now();
      const settled = document.readyState === "complete" && now - start >= SETTLE_MIN && now - last >= SETTLE_QUIET;
      if (settled || now - start >= SETTLE_MAX) {
        obs?.disconnect();
        resolve();
        return;
      }
      setTimeout(tick, 150);
    };
    tick();
  });
}

let manualNotified = false;

const CHAIN_NOTE = "続けて公開された新しいバージョンに更新します";

// 更新を終える直前に、さらに新しい版が出ている／公開中でないか確かめ、あれば更新を続ける。
async function chainToNewer(): Promise<boolean> {
  const server = await fetchServerBuild();
  if (server && isLater(server.buildTime, APP_BUILD_TIME)) {
    void startReload(server, CHAIN_NOTE);
    return true;
  }
  const pending = await fetchPendingRelease(true);
  if (pending) {
    void startWaiting(pending, CHAIN_NOTE);
    return true;
  }
  return false;
}

// 自動更新でリロードしてきた直後の仕上げ。
async function finishLanding(): Promise<void> {
  if (!bootLanded) {
    // 目指した版にならなかった（CDN の伝播待ちで古い index.html が返ってきた等）。
    const server = await fetchServerBuild();
    if (server && server.buildTime !== APP_BUILD_TIME) {
      const prev = readAttempt();
      const count = prev?.to === server.buildTime ? prev.count : 0;
      if (count >= MAX_ATTEMPTS) {
        manualNotified = true; // 失敗画面を出したので、以後の自動確認ではトーストだけにする
        setState({ phase: "failed", note: null });
        return;
      }
      setState({ note: "新しい画面の配信を待って、もう一度読み込みます" });
      await sleep(LANDING_RETRY_DELAY * Math.max(1, count));
      await startReload(server);
      return;
    }
    // サーバーもこの版を返している（＝これが最新）。確かめられなかった場合も今の画面で続ける。
    clearAttempt();
  }

  setState({ phase: "finishing", progress: 90, version: APP_VERSION, note: null });
  const started = Date.now();
  const tick = setInterval(() => {
    setState({ progress: 90 + 8 * (1 - Math.exp(-(Date.now() - started) / 2500)) });
  }, 200);
  await waitForSettled();
  clearInterval(tick);

  // 続けて次のデプロイが走っていた（マージが連続した等）なら、閉じずにそのまま次の版へ乗り継ぐ。
  // ここで閉じると、次の画面遷移や定期確認でもう一度全画面の更新が始まってしまう。
  if (await chainToNewer()) return;

  setState({ phase: "done", progress: 100 });
  await sleep(DONE_HOLD);
  setState(IDLE);
}

// ── 確認 ─────────────────────────────────────────────────────────────────────

export type UpdateCheckResult =
  | "updating" // 更新を始めた（またはすでに更新中）
  | "latest"   // 最新版で稼働中
  | "unknown"; // 確認できなかった（dev サーバー・オフライン等）

let inFlight: Promise<UpdateCheckResult> | null = null;
let inFlightFresh = false; // 走っている確認が DB まで見るものか

// 自動確認で、同じ版へのリロードを続けてよいか（リロードループ防止）。
function mayRetry(target: string): boolean {
  const prev = readAttempt();
  if (prev?.to !== target) return true;
  // 規定回数リロードしても新しいバンドルに乗り換えられない異常時。
  // 黙って諦めず、手動更新をお願いする(同一版につき1回だけ)。
  if (prev.count >= MAX_ATTEMPTS) {
    if (!manualNotified) {
      manualNotified = true;
      notify("新しいバージョンがあります。お手数ですが画面を手動で再読み込みしてください。", "error");
    }
    return false;
  }
  // 直前の試行から間もない場合は待つ(デプロイ伝播中の連続リロードを防ぐ)。
  return Date.now() - prev.at >= RETRY_COOLDOWN;
}

async function runCheck(manual: boolean, fresh: boolean): Promise<UpdateCheckResult> {
  const server = await fetchServerBuild();
  if (!server) return "unknown";
  if (state.phase !== "idle") return "updating";

  if (server.buildTime !== APP_BUILD_TIME) {
    // 手動（「最新版を確認して再読み込み」）は利用者の明示操作なので、試行回数をリセットしてやり直す
    if (manual) clearAttempt();
    else if (!mayRetry(server.buildTime)) return "unknown";
    void startReload(server);
    return "updating";
  }
  clearAttempt(); // 最新版で稼働中

  const pending = await fetchPendingRelease(fresh);
  if (pending && state.phase === "idle") {
    void startWaiting(pending);
    return "updating";
  }
  return "latest";
}

/**
 * 新しいバージョンがあるか確かめ、あれば更新オーバーレイを出して更新を始める。
 * 何度呼んでも同時に走るのは1本だけ。
 *
 * - manual: 「最新版を確認して再読み込み」。リロードの試行回数をリセットしてやり直す（DB も必ず見る）
 * - fresh:  DB の間引き(PENDING_POLL)を無視して、公開準備中の版も必ず確かめる（画面遷移・クリック・バージョン情報）
 */
export function checkForUpdate(opts: { manual?: boolean; fresh?: boolean } = {}): Promise<UpdateCheckResult> {
  if (state.phase !== "idle") return Promise.resolve("updating");
  if (!APP_BUILD_TIME) return Promise.resolve("unknown"); // ビルド時刻が焼き込まれていない環境
  const manual = !!opts.manual;
  const fresh = manual || !!opts.fresh;
  if (inFlight) {
    // 走っている確認が DB を見ない定期確認なら、DB まで見たい確認は終わってからもう一度確かめる。
    // （リンクのクリック＋画面遷移のように同時に来たものは、DB まで見ている方に相乗りする）
    // 手動確認は試行回数のリセットが要るので、相乗りせず必ず自分で確かめ直す。
    if (!fresh || (inFlightFresh && !manual)) return inFlight;
    return inFlight.then(r => (r === "updating" ? r : checkForUpdate(opts)));
  }
  inFlightFresh = fresh;
  inFlight = runCheck(manual, fresh).finally(() => { inFlight = null; });
  return inFlight;
}

// クリックで確認するのはボタン・リンク類だけ。入力欄・エディタの中は、打っている最中に
// プログレスで画面を塞がないよう対象外にする。
const CLICK_TARGET = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="option"], summary';
const TYPING_AREA = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

function isCheckableClick(e: MouseEvent): boolean {
  const el = e.target instanceof Element ? e.target : null;
  if (!el || !el.closest(CLICK_TARGET)) return false;
  return !el.closest(TYPING_AREA);
}

/** 失敗画面の「再読み込み」。キャッシュを片付けて取り直す。 */
export async function reloadNow(): Promise<void> {
  await purgeStaleCaches();
  hardReload(String(Date.now()));
}

/** 失敗画面を閉じて、今の画面で続ける。 */
export function dismissUpdate(): void {
  if (state.phase === "failed") setState(IDLE);
}

// ── 監視 ─────────────────────────────────────────────────────────────────────

let landingStarted = false;
let lastClickCheck = 0;

// トリガー: 起動(リロード含む)・定期確認・画面遷移・ボタン/リンクのクリック・フォーカス/タブ復帰・bfcache 復元・オンライン復帰。
// 画面遷移とクリックは利用者が画面を使っている瞬間なので、DB まで見て公開準備中の版も即座に拾う。
// （定期確認だけだと、バージョン情報の履歴には新しい版が出ているのにプログレスが最大1分出なかった）
// アプリ最上位(App.tsx の VersionWatcher)で常時1つだけ動かす。
export function useVersionCheck() {
  const { toast } = useToast();
  const { pathname } = useLocation();
  const navMountedRef = useRef(false);
  const lastNavCheckRef = useRef(0);

  useEffect(() => { notify = toast; }, [toast]);

  useEffect(() => {
    // StrictMode の effect 二重実行でも仕上げは1回だけ
    if (!landingStarted) {
      landingStarted = true;
      if (bootMemo) void finishLanding();
      else if (legacyLanded) notify(`最新バージョン ${APP_VERSION} に更新しました`);
    }

    void checkForUpdate();
    const id = setInterval(() => { void checkForUpdate(); }, CHECK_INTERVAL);

    const onFocus = () => { void checkForUpdate(); };
    const onVisible = () => { if (!document.hidden) void checkForUpdate(); };
    // bfcache から復元された場合も検知
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) void checkForUpdate(); };
    // スリープ復帰直後はまだ回線が復旧しておらず fetch が失敗しがち。
    // オンライン復帰時にもう一度確かめる。
    const onOnline = () => { void checkForUpdate(); };
    // 遅れて読み込むチャンク(lazy import)が取れなかったとき。
    // 起動後にデプロイが切り替わると、古いハッシュのチャンクがサーバーから消えていて
    // 画面が真っ白になる。起動時の事故(index.html のウォッチドッグ)と同じ原因なので、
    // ここでも版を確かめて、新しい版が出ていれば更新に乗せる。
    const onPreloadError = () => { void checkForUpdate(); };
    // ボタン・リンクのクリック。各ボタンには手を入れず、ここ1か所で拾う。
    // キャプチャ段階で見るので、stopPropagation しているボタンでも拾える（クリック自体の処理は妨げない）。
    const onClick = (e: MouseEvent) => {
      if (!isCheckableClick(e)) return;
      if (Date.now() - lastClickCheck < CLICK_THROTTLE) return;
      lastClickCheck = Date.now();
      void checkForUpdate({ fresh: true });
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    window.addEventListener("vite:preloadError", onPreloadError);
    document.addEventListener("click", onClick, { capture: true, passive: true });

    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("vite:preloadError", onPreloadError);
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, []);

  // 画面遷移したとき（初回描画は上の起動時確認に任せる）
  useEffect(() => {
    if (!navMountedRef.current) { navMountedRef.current = true; return; }
    if (Date.now() - lastNavCheckRef.current < NAV_DEDUPE) return;
    lastNavCheckRef.current = Date.now();
    void checkForUpdate({ fresh: true });
  }, [pathname]);
}
