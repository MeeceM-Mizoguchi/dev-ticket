import { useEffect, useRef } from "react";
import { useToast } from "@/app/contexts/ToastContext";
import { APP_BUILD_TIME } from "@/lib/version";

const CHECK_INTERVAL = 2 * 60 * 1000;

// 同じ版へ向けて2回以上リロードしない（＝リロードループ防止）。
// 通常はリロードすれば新しい index.html が降ってきて解消するが、
// 何らかの理由で古い index.html が返り続けた場合に無限リロードになるのを防ぐ。
const RELOADED_TO_KEY = "versionCheck.reloadedTo";

function readReloadedTo(): string | null {
  try { return sessionStorage.getItem(RELOADED_TO_KEY); } catch { return null; }
}

function writeReloadedTo(buildTime: string): void {
  try { sessionStorage.setItem(RELOADED_TO_KEY, buildTime); } catch { /* ignore */ }
}

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

// デプロイされた新しいバージョンを検知して自動リロードする（BRU3-070 / BRU11-045）。
//
// 判定の基準は「今動いているバンドル自身のビルド時刻(APP_BUILD_TIME)」。
// 以前は “マウント時にサーバーから取得した値” を基準にしていたため、
// ログアウト→ログインなどでシェルが再マウントされると基準が最新版に付け替わり、
// 古いバンドルのまま二度と更新されない状態になっていた。
// 焼き込み値を基準にすれば、マウントのタイミングに一切依存しない。
//
// ※ネイティブ(Mac/iPad)アプリは build-info.json も同梱物なので常に一致し、何も起きない。
// ※dev サーバーは build-info.json が無い(404)ためスキップされる。
export function useVersionCheck() {
  const { toast } = useToast();
  const reloading = useRef(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const check = useRef(async () => {
    if (reloading.current) return;
    if (!APP_BUILD_TIME) return; // ビルド時刻が焼き込まれていない環境ではスキップ
    const serverBuildTime = await fetchBuildTime();
    if (!serverBuildTime) return; // dev mode or fetch failed — skip
    if (serverBuildTime === APP_BUILD_TIME) return; // 最新版で稼働中
    if (readReloadedTo() === serverBuildTime) return; // この版へは既にリロード済み（ループ防止）

    reloading.current = true;
    writeReloadedTo(serverBuildTime);
    toastRef.current("新しいバージョンに更新します...");
    setTimeout(() => window.location.reload(), 1500);
  });

  useEffect(() => {
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
