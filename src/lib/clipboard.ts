// クリップボード共通ヘルパー
// ネイティブ(Capacitor/WKWebView)では navigator.clipboard が効かないことがあるため、
// ネイティブは @capacitor/clipboard を使い、Web は navigator.clipboard（失敗時は execCommand）にフォールバックする。
import { Capacitor } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";

// テキストをコピー。成功なら true。
export async function copyText(text: string): Promise<boolean> {
  // ネイティブ: Capacitor プラグイン経由（OSのクリップボードへ確実に書き込む）
  if (Capacitor.isNativePlatform()) {
    try {
      await Clipboard.write({ string: text });
      return true;
    } catch {
      return false;
    }
  }

  // Web: 標準 API
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* execCommand へフォールバック */
  }

  // 旧ブラウザ/非セキュアコンテキスト向けフォールバック
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
