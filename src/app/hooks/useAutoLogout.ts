import { useEffect, useRef } from "react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { shouldLogout, nextBoundaryMs, GRACE_MS } from "@/app/lib/autoLogout";

// 安全網チェックの間隔。3:00を過ぎた直後に確実にログアウトさせるためのバックアップ。
// (フォアグラウンド時の正確な予告/発火は下の setTimeout が担う)
const CHECK_INTERVAL = 30_000;

// 自動ログアウト(ENHA2-027)。ログイン中のみ稼働。
// - 予告つき経路: 次の3:00に向けて setTimeout をアーム。3:00の60秒前にトースト、
//   3:00にログアウト。フォアグラウンドで3時を迎えるケース。
// - 即時経路(安全網): interval + focus/visibilitychange/pageshow で復帰・経過を検知し、
//   既に3時境界を跨いでいれば予告なしで即ログアウト(閉/スリープからの復帰・起動直後)。
export function useAutoLogout() {
  const { logout, userId } = useAuth();
  const { toast } = useToast();
  const logoutRef = useRef(logout);
  logoutRef.current = logout;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!userId) return; // 未ログイン時は何もしない

    let firing = false;
    let warnTimer: ReturnType<typeof setTimeout> | null = null;
    let logoutTimer: ReturnType<typeof setTimeout> | null = null;

    const doLogout = async () => {
      if (firing) return;
      firing = true;
      await logoutRef.current();
      window.location.href = "/login";
    };

    const clearTimers = () => {
      if (warnTimer) { clearTimeout(warnTimer); warnTimer = null; }
      if (logoutTimer) { clearTimeout(logoutTimer); logoutTimer = null; }
    };

    // 次の3:00に向けて予告トースト・ログアウトのタイマーを張り直す。
    const arm = () => {
      clearTimers();
      const now = Date.now();
      const untilLogout = Math.max(0, nextBoundaryMs(now) - now);
      const untilWarn = untilLogout - GRACE_MS;
      if (untilWarn > 0) {
        warnTimer = setTimeout(() => {
          toastRef.current("まもなく自動ログアウトします（約1分後）", "info");
        }, untilWarn);
      } else {
        // 既に猶予window内なら即時に予告。
        toastRef.current("まもなく自動ログアウトします", "info");
      }
      logoutTimer = setTimeout(() => { void doLogout(); }, untilLogout);
    };

    // 既に3時境界を跨いでいれば即ログアウト。跨いでいなければタイマーを張り直す。
    // (スリープ/バックグラウンドで setTimeout はズレるため、復帰時に必ず再評価する)
    const reconcile = () => {
      if (firing) return;
      if (shouldLogout()) { void doLogout(); return; }
      arm();
    };

    reconcile();

    const interval = setInterval(() => {
      if (!firing && shouldLogout()) void doLogout();
    }, CHECK_INTERVAL);

    const onVisible = () => { if (!document.hidden) reconcile(); };
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) reconcile(); };

    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      clearInterval(interval);
      clearTimers();
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [userId]);
}
