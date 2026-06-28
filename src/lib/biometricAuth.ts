// 生体認証ログイン 共通サービス層
// プラットフォーム(Web / Mac・iPadネイティブ)を吸収し、UIからは同一APIで使う。
// チケット: ENHA2-013
import { Capacitor } from "@capacitor/core";
import { webProvider } from "./biometric/web";
import { nativeProvider } from "./biometric/native";

export interface BiometricResult {
  ok: boolean;
  error?: string;
}

export interface BiometricProvider {
  /** この端末/ブラウザで生体認証が利用可能か */
  isSupported(): Promise<boolean>;
  /** この端末で既に生体認証を登録済みか（メニュー出し分け・自動プロンプト判定に使用） */
  isRegisteredOnThisDevice(): Promise<boolean>;
  /** 生体認証を登録する（要ログイン状態） */
  register(): Promise<BiometricResult>;
  /** 生体認証でログインする（Supabaseセッションを確立） */
  loginWithBiometric(): Promise<BiometricResult>;
  /** この端末の生体データ（登録）を削除する */
  removeCredential(): Promise<BiometricResult>;
}

function provider(): BiometricProvider {
  return Capacitor.isNativePlatform() ? nativeProvider : webProvider;
}

export const biometricAuth = {
  isNative: () => Capacitor.isNativePlatform(),
  isSupported: () => provider().isSupported(),
  isRegisteredOnThisDevice: () => provider().isRegisteredOnThisDevice(),
  register: () => provider().register(),
  loginWithBiometric: () => provider().loginWithBiometric(),
  removeCredential: () => provider().removeCredential(),
};
