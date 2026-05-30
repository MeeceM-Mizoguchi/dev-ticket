import { useEffect, useRef } from "react";
import { useToast } from "@/app/contexts/ToastContext";

const CHECK_INTERVAL = 2 * 60 * 1000;

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

export function useVersionCheck() {
  const { toast } = useToast();
  const baseBuild = useRef<string | null>(null);
  const initialized = useRef(false);
  const reloading = useRef(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const check = useRef(async () => {
    if (reloading.current) return;
    const buildTime = await fetchBuildTime();
    if (!buildTime) return; // dev mode or fetch failed — skip
    if (!initialized.current) {
      baseBuild.current = buildTime;
      initialized.current = true;
      return;
    }
    if (buildTime !== baseBuild.current) {
      reloading.current = true;
      toastRef.current("新しいバージョンに更新します...");
      setTimeout(() => window.location.reload(), 1500);
    }
  });

  useEffect(() => {
    check.current();
    const id = setInterval(() => check.current(), CHECK_INTERVAL);

    const onFocus = () => check.current();
    const onVisible = () => { if (!document.hidden) check.current(); };
    // bfcache から復元された場合も検知
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) check.current(); };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
}
