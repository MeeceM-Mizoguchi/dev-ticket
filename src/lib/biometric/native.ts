// 生体認証(ネイティブ / Mac・iPad)実装
// 生体認証はローカルゲートとして使い、端末固有シークレットをKeychainに保存。
// サーバ照合に成功したら magiclink でセッション確立する（Webと同じ経路）。
// チケット: ENHA2-013
//
// 注意: ネイティブは capacitor://localhost で動くため、相対 fetch("/api/..") は
// サーバに届かない（SPAのindex.htmlが返り固まる）。そのため API 呼び出しは
// CapacitorHttp（ネイティブHTTP＝CORS回避）＋絶対URLで行う。
import { CapacitorHttp } from "@capacitor/core";
import { BiometricAuth, BiometryErrorType, type BiometryError } from "@aparajita/capacitor-biometric-auth";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { BiometricProvider, BiometricResult } from "../biometricAuth";

const SECRET_KEY = "dt_biometric_secret";

// ネイティブアプリの API 向き先（本番）。必要なら VITE_API_BASE_URL で上書き。
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "https://dv-ticket.com";

type ApiResult = { ok: boolean; status: number; data: any; error?: string };

// CapacitorHttp 経由の POST。例外は投げず必ず ApiResult を返す（UIが固まらないように）。
async function apiPost(path: string, opts: { token?: string; body?: any }): Promise<ApiResult> {
  try {
    const res = await CapacitorHttp.post({
      url: `${API_BASE}${path}`,
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      data: opts.body ?? {},
    });
    let data = res.data;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch { /* 文字列のまま */ } }
    const ok = res.status >= 200 && res.status < 300;
    return { ok, status: res.status, data, error: ok ? undefined : (data?.error || `通信に失敗しました (${res.status})`) };
  } catch (e: any) {
    return { ok: false, status: 0, data: null, error: e?.message || "サーバに接続できませんでした。" };
  }
}

async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
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

    const r = await apiPost("/api/webauthn/native-register", {
      token,
      body: { deviceLabel: navigator.userAgent.slice(0, 120) },
    });
    if (!r.ok) return { ok: false, error: r.error };
    const secret = r.data?.secret;
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

    const r = await apiPost("/api/webauthn/native-login", { body: { secret } });
    if (!r.ok) {
      // 端末がサーバ側で失効している場合はローカルのシークレットも掃除
      if (r.status === 404) { try { await SecureStorage.remove(SECRET_KEY); } catch { /* noop */ } }
      return { ok: false, error: r.error };
    }
    const tokenHash = r.data?.tokenHash;
    if (!tokenHash) return { ok: false, error: "ログインに失敗しました。" };

    const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  async removeCredential(): Promise<BiometricResult> {
    const token = await accessToken();
    const secret = await readSecret();
    if (token && secret) {
      // 失敗してもローカル削除は続行
      await apiPost("/api/webauthn/delete-credential", { token, body: { nativeSecret: secret } });
    }
    try { await SecureStorage.remove(SECRET_KEY); } catch { /* noop */ }
    return { ok: true };
  },
};
