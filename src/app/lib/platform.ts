import { Capacitor } from "@capacitor/core";

// Mac/iPad のネイティブアプリ(Capacitor)かどうかを判定する。
// タブ機能は Mac/iPad 版のみが対象で、Web版・iPhone版は対象外。
//  - Web(ブラウザ)はそもそもブラウザのタブが使えるため対象外。
//  - iPhone は画面が小さくタブUIが現実的でないため対象外(チケット対象端末も Mac/iPad のみ)。
// 判定は main.tsx の viewport 補正と同じく userAgent の iPhone 除外で行う。
export function isNativeTabletApp(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  if (/iPhone/.test(navigator.userAgent)) return false;
  return true;
}
