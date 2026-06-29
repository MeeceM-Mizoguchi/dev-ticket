// 外部リンクを開く共通ヘルパー
// ネイティブ(Mac/iPad の Capacitor/WKWebView)には「別タブ」が無いため、
//   @capacitor/browser でアプリ内ブラウザ(SFSafariViewController)として開く。
//   こうするとアプリは背面に残り、閉じればすぐ元の作業画面に戻れる。
// Web(ブラウザ)は従来どおり別タブ(target="_blank" 相当)で開く。
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return;

  // ネイティブ: アプリ内ブラウザで開く
  if (Capacitor.isNativePlatform()) {
    try {
      await Browser.open({ url });
      return;
    } catch {
      // 失敗時は通常遷移にフォールバック
    }
  }

  // Web: 別タブで開く（noopener,noreferrer 付き）
  window.open(url, "_blank", "noopener,noreferrer");
}
