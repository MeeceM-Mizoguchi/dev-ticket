import { useEffect, useRef } from "react";

// 一覧画面のスクロール位置を覚えておき、戻ってきたとき・リロードしたときに元の場所へ復帰させる。
//
// スクロールしているのはシェルの <main>（AppShell / TabPane）なので、
// 返り値の ref をページのルート要素に付けてもらい、そこから closest("main") で辿る。
// 保存先は sessionStorage（タブ単位・リロードをまたぐ）。
//
// 一覧は読み込み完了後もPR情報や子行の展開で高さが伸びるため、
// 「一度だけ scrollTop を入れる」では届かない。高さが落ち着くまで数フレーム追いかける。

const STORAGE_PREFIX = "scrollPos:";
// 復元をあきらめるまでの猶予。これを過ぎたら追跡をやめる。
const RESTORE_WINDOW_MS = 2000;
// 目標位置に届いたあと、これだけ高さが変わらなければ復元完了とみなす。
const HEIGHT_STABLE_MS = 300;
// 保存を間引く間隔。スクロール中に毎フレーム書き込まない。
const SAVE_DEBOUNCE_MS = 200;
// 「ユーザーが自分でスクロールし始めた」と判断するキー操作。復元より本人の操作を優先する。
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

type Options = {
  /** 一覧データの読み込みが終わったか。false の間は記録も復元もしない */
  ready: boolean;
  /** 特定のチケットへスクロールする処理が別に走るときなど、復元だけ止めたいとき */
  disabled?: boolean;
};

/**
 * @param key 画面ごとの記憶キー（プロジェクト・スプリント・表示モード等で分ける）。null の間は何もしない。
 * @returns ページのルート要素に付ける ref
 */
export function useScrollRestore(key: string | null, { ready, disabled = false }: Options) {
  const rootRef = useRef<HTMLDivElement>(null);
  // 同じ画面で二度復元しない（一度復元したあとはユーザーの操作を奪わない）
  const restoredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!key || !ready) return;
    const scroller = rootRef.current?.closest("main") as HTMLElement | null;
    if (!scroller) return;

    // ---- 記録 ----
    let pending: { key: string; top: number } | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    // 復元中の自動スクロールは記録しない。途中経過(まだ行が足りず頭打ちの位置)で
    // 本来の保存値を上書きしてしまうため。
    let restoring = false;

    const write = () => {
      if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
      if (!pending) return;
      const { key: k, top } = pending;
      pending = null;
      try {
        if (top > 0) sessionStorage.setItem(STORAGE_PREFIX + k, String(Math.round(top)));
        else sessionStorage.removeItem(STORAGE_PREFIX + k);
      } catch { /* プライベートモード等で保存できなくても画面は止めない */ }
    };
    const capture = () => { pending = { key, top: scroller.scrollTop }; };
    const onScroll = () => {
      if (restoring) return;
      capture();
      if (saveTimer === null) saveTimer = setTimeout(write, SAVE_DEBOUNCE_MS);
    };
    // リロード/タブ離脱の直前。この時点ならDOMはまだ生きているので実測して保存する。
    const onLeave = () => { if (!restoring) capture(); write(); };
    const onVisibility = () => { if (document.visibilityState === "hidden") onLeave(); };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onVisibility);

    // ---- 復元 ----
    let raf = 0;
    let stopRestore: (() => void) | null = null;

    // この画面(キー)へ来て最初の1回だけ復元する。disabled で見送った場合も「判断済み」に
    // しておく。そうしないと、あとで disabled が外れた瞬間に遅れて復元が走り、
    // 特定チケットへ飛ばしたばかりの位置を奪ってしまう。
    const firstVisit = restoredKeyRef.current !== key;
    restoredKeyRef.current = key;

    if (firstVisit && !disabled) {
      let target = 0;
      try { target = Number(sessionStorage.getItem(STORAGE_PREFIX + key)) || 0; } catch { target = 0; }

      if (target > 0) {
        restoring = true;
        const abort = () => stopRestore?.();
        const onKey = (e: KeyboardEvent) => { if (SCROLL_KEYS.has(e.key)) abort(); };
        stopRestore = () => {
          restoring = false;
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
          stopRestore = null;
          scroller.removeEventListener("wheel", abort);
          scroller.removeEventListener("touchstart", abort);
          scroller.removeEventListener("mousedown", abort);
          window.removeEventListener("keydown", onKey);
        };
        // ホイール/指/スクロールバー掴み/キー操作 ＝ 本人が動かし始めた合図。追跡をやめる。
        scroller.addEventListener("wheel", abort, { passive: true });
        scroller.addEventListener("touchstart", abort, { passive: true });
        scroller.addEventListener("mousedown", abort);
        window.addEventListener("keydown", onKey);

        const start = performance.now();
        let lastHeight = -1;
        let stableSince = start;
        const step = (now: number) => {
          raf = 0;
          const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          const next = Math.min(target, max);
          if (Math.abs(scroller.scrollTop - next) > 1) scroller.scrollTop = next;
          if (scroller.scrollHeight !== lastHeight) { lastHeight = scroller.scrollHeight; stableSince = now; }
          const reached = next >= target - 1;
          if ((reached && now - stableSince >= HEIGHT_STABLE_MS) || now - start >= RESTORE_WINDOW_MS) {
            stopRestore?.();
            return;
          }
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      }
    }

    return () => {
      stopRestore?.();
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      // 他画面へ移る瞬間。unmount 時点の scrollTop は当てにならないので、
      // 直前のスクロールで捉えておいた位置をそのまま書き出す。
      write();
    };
  }, [key, ready, disabled]);

  return rootRef;
}
