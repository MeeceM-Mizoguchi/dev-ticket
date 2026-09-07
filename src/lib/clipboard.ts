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

/**
 * テキストと HTML を **同じクリップボードへ同時に**書き込む。成功なら true。
 *
 * ホワイトボードのコピーが text/plain（Excalidraw JSON）と text/html（draw.io の mxGraphModel）を
 * 両方載せるために使う。navigator.clipboard.writeText は**クリップボード全体を置き換える**ので、
 * 2 種類を残すには ClipboardItem で 1 回に書く必要がある。
 * ネイティブ(Capacitor)は複数 MIME を扱えないため、テキストだけ書いて false を返す
 * （＝draw.io 形式は載らない。呼び出し側は「従来どおり」として続行してよい）。
 */
export async function copyTextAndHtml(text: string, html: string): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    await copyText(text);
    return false;
  }
  try {
    if (navigator.clipboard && "write" in navigator.clipboard && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return true;
    }
  } catch {
    /* text/html 非対応ブラウザ等。テキストだけでも確実に載せる */
  }
  await copyText(text);
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
