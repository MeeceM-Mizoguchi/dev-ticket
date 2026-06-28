// 生体認証(ネイティブ / Mac・iPad)実装
// 生体認証はローカルゲートとして使い、端末固有シークレットをKeychainに保存。
// サーバ照合に成功したら magiclink でセッション確立する（Webと同じ経路）。
// チケット: ENHA2-013
import { BiometricAuth, BiometryErrorType, type BiometryError } from "@aparajita/capacitor-biometric-auth";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { BiometricProvider, BiometricResult } from "../biometricAuth";

const SECRET_KEY = "dt_biometric_secret";

async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function readError(res: Response): Promise<string> {
  try { const j = await res.json(); return j?.error || "通信に失敗しました"; }
  catch { return "通信に失敗しました"; }
}

async function readSecret(): Promise<string | null> {
  try { return await SecureStorage.getItem(SECRET_KEY); }
  catch { return null; }
}

// 生体認証プロンプトを表示。成功なら null、失敗/キャンセルならメッセージを返す。
async function promptBiometry(reason: string): Promise<string | null> {
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: "キャンセル",
      iosFallbackTitle: "パスコードを使用",
      allowDeviceCredential: true,
    });
    return null;
  } catch (e) {
    const err = e as BiometryError;
    if (err?.code === BiometryErrorType.userCancel || err?.code === BiometryErrorType.appCancel || err?.code === BiometryErrorType.systemCancel) {
      return "生体認証がキャンセルされました。";
    }
    if (err?.code === BiometryErrorType.biometryNotEnrolled) return "端末に生体認証が登録されていません。";
    if (err?.code === BiometryErrorType.biometryLockout) return "試行回数の超過によりロックされました。端末のロック解除後に再度お試しください。";
    return err?.message || "生体認証に失敗しました。";
  }
}

export const nativeProvider: BiometricProvider = {
  async isSupported(): Promise<boolean> {
    try { const r = await BiometricAuth.checkBiometry(); return r.isAvailable; }
    catch { return false; }
  },

  async isRegisteredOnThisDevice(): Promise<boolean> {
    return !!(await readSecret());
  },

  async register(): Promise<BiometricResult> {
    if (!isSupabaseEnabled || !supabase) return { ok: false, error: "この環境では利用できません。" };
    const token = await accessToken();
    if (!token) return { ok: false, error: "ログインが必要です。" };

    const bioErr = await promptBiometry("生体認証を登録します");
    if (bioErr) return { ok: false, error: bioErr };

    const res = await fetch("/api/webauthn/native-register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceLabel: navigator.userAgent.slice(0, 120) }),
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    const { secret } = await res.json();
    if (!secret) return { ok: false, error: "登録に失敗しました。" };

    try { await SecureStorage.setItem(SECRET_KEY, secret); }
    catch { return { ok: false, error: "端末への保存に失敗しました。" }; }
    return { ok: true };
  },

  async loginWithBiometric(): Promise<BiometricResult> {
    if (!isSupabaseEnabled || !supabase) return { ok: false, error: "この環境では利用できません。" };

    const secret = await readSecret();
    if (!secret) return { ok: false, error: "この端末は生体認証が未登録です。" };

    const bioErr = await promptBiometry("生体認証でログインします");
    if (bioErr) return { ok: false, error: bioErr };

    const res = await fetch("/api/webauthn/native-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    if (!res.ok) {
      // 端末がサーバ側で失効している場合はローカルのシークレットも掃除
      if (res.status === 404) { try { await SecureStorage.remove(SECRET_KEY); } catch { /* noop */ } }
      return { ok: false, error: await readError(res) };
    }
    const { tokenHash } = await res.json();

    const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  async removeCredential(): Promise<BiometricResult> {
    const token = await accessToken();
    const secret = await readSecret();
    if (token && secret) {
      await fetch("/api/webauthn/delete-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nativeSecret: secret }),
      }).catch(() => { /* ローカル削除は続行 */ });
    }
    try { await SecureStorage.remove(SECRET_KEY); } catch { /* noop */ }
    return { ok: true };
  },
};
