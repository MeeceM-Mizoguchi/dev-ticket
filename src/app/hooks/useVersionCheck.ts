import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useToast } from "@/app/contexts/ToastContext";

const CHECK_INTERVAL = 2 * 60 * 1000;

async function fetchAppHash(): Promise<string | null> {
  try {
    const res = await fetch(`/?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const html = await res.text();
    // Vite production builds embed hashed filenames like /assets/index-XYZ.js
    const m = html.match(/\/assets\/index-([A-Za-z0-9_-]+)\.js/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function useVersionCheck() {
  const { toast } = useToast();
  const location = useLocation();
  const baseHash = useRef<string | null>(null);
  const initialized = useRef(false);
  const reloading = useRef(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const check = useRef(async () => {
    if (reloading.current) return;
    const hash = await fetchAppHash();
    if (!hash) return; // dev mode or fetch failed — skip
    if (!initialized.current) {
      baseHash.current = hash;
      initialized.current = true;
      return;
    }
    if (hash !== baseHash.current) {
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
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Trigger on each navigation
  useEffect(() => {
    if (initialized.current) check.current();
  }, [location.pathname]);
}
