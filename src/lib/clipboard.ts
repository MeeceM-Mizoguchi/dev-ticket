// クリップボード共通ヘルパー
// ネイティブ(Capacitor/WKWebView)では navigator.clipboard が効かないことがあるため、
// ネイティブは @capacitor/clipboard を使い、Web は navigator.clipboard（失敗時は execCommand）にフォールバックする。
import { Capacitor } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";

// 画像(Blob)をクリップボードへコピー。成功なら true。
// ネイティブは @capacitor/clipboard の image(base64 dataURL)、Web は ClipboardItem を使う。
export async function copyImage(blob: Blob): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
      await Clipboard.write({ image: dataUrl });
      return true;
    } catch {
      return false;
    }
  }
  try {
    if (navigator.clipboard && "write" in navigator.clipboard && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      return true;
    }
  } catch {
    /* noop */
  }
  return false;
}

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
