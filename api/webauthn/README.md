# 生体認証ログイン (ENHA2-013)

WEBアプリは WebAuthn(パスキー)、Mac/iPadアプリは Capacitor の生体認証＋Keychain を使い、
どちらも最終的に Supabase の magiclink でセッションを確立する。

## 構成

| レイヤー | ファイル |
| --- | --- |
| DB | `supabase/add_webauthn.sql` |
| サーバ(API) | `api/webauthn/*.ts` |
| 共通サービス層 | `src/lib/biometricAuth.ts`（`Capacitor.isNativePlatform()` で分岐） |
| Web実装 | `src/lib/biometric/web.ts`（`@simplewebauthn/browser`） |
| ネイティブ実装 | `src/lib/biometric/native.ts`（`@aparajita/capacitor-biometric-auth` + `@aparajita/capacitor-secure-storage`） |
| UI | `Topbar.tsx`（登録/削除メニュー）, `LoginPage.tsx`（生体ログイン導線・ネイティブ自動プロンプト）, `AuthContext.tsx`（`loginWithBiometric`） |

## デプロイ前に必要な作業

### 1. DBマイグレーション
Supabase Dashboard → SQL Editor で `supabase/add_webauthn.sql` を実行する。
作成テーブル: `webauthn_credentials` / `webauthn_challenges` / `native_biometric_devices`

### 2. 環境変数（Vercel / ローカル）
| 変数 | 用途 | 必須 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | 既存 | ✓ |
| `SUPABASE_SERVICE_ROLE_KEY` | 既存（API用） | ✓ |
| `WEBAUTHN_RP_ID` | WebAuthnのrpID。未設定ならリクエストのオリジンのホスト名を使用。カスタムドメイン運用時のみ明示設定 | 任意 |

> WebAuthn は HTTPS 必須（localhost は可）。rpID は本番ドメインに紐づくため、
> 一度登録したパスキーは別ドメインでは使えない。

### 3. ネイティブ(Mac/iPad)
- `npx cap sync ios` 実行済み（プラグインは Package.swift に登録済み）。
- `ios/App/App/Info.plist` に `NSFaceIDUsageDescription` を追加済み。
- Xcode で実機/シミュレータビルドして Face ID / Touch ID 動作を確認すること。

## 動作確認の流れ
1. 通常ログインする。
2. 右上アイコン → 「生体認証を登録」→ 生体認証で登録。
3. ログアウト → ログイン画面で「生体認証でログイン」（ネイティブは自動プロンプト）。
4. 右上アイコン → 「生体データを削除」で解除できることを確認。

## 補足
- 登録有無の判定は端末側（Web=localStorage `dt_biometric_cred` / ネイティブ=Keychain `dt_biometric_secret`）で行う。
  これによりログイン画面の自動プロンプトは「過去にその端末で登録した場合のみ」表示される。
- 既存の Email/Password ログインには変更を加えていない（追加のみ）。
