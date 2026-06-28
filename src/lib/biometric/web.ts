// 生体認証(Web / WebAuthn・Passkey)実装
// チケット: ENHA2-013
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from "@simplewebauthn/browser";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { BiometricProvider, BiometricResult } from "../biometricAuth";

// この端末で登録済みかの判定に使うローカルフラグ（値は credentialId）。
// セキュリティ境界ではなくUXヒント（メニュー出し分け等）。
const CRED_FLAG_KEY = "dt_biometric_cred";

async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function readError(res: Response): Promise<string> {
  try { const j = await res.json(); return j?.error || "通信に失敗しました"; }
  catch { return "通信に失敗しました"; }
}

// WebAuthnのキャンセル/失敗を日本語化
function toMessage(e: any): string {
  const name = e?.name || "";
  if (name === "NotAllowedError") return "生体認証がキャンセルされました。";
  if (name === "InvalidStateError") return "この端末は既に登録されています。";
  return e?.message || "生体認証に失敗しました。";
}

export const webProvider: BiometricProvider = {
  async isSupported(): Promise<boolean> {
    if (!browserSupportsWebAuthn()) return false;
    try { return await platformAuthenticatorIsAvailable(); }
    catch { return false; }
  },

  async isRegisteredOnThisDevice(): Promise<boolean> {
    return !!localStorage.getItem(CRED_FLAG_KEY);
  },

  async register(): Promise<BiometricResult> {
    if (!isSupabaseEnabled || !supabase) return { ok: false, error: "この環境では利用できません。" };
    const token = await accessToken();
    if (!token) return { ok: false, error: "ログインが必要です。" };

    const optRes = await fetch("/api/webauthn/register-options", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!optRes.ok) return { ok: false, error: await readError(optRes) };
    const optionsJSON = await optRes.json();

    let attResp;
    try { attResp = await startRegistration({ optionsJSON }); }
    catch (e: any) { return { ok: false, error: toMessage(e) }; }

    const verRes = await fetch("/api/webauthn/register-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ response: attResp, deviceLabel: navigator.userAgent.slice(0, 120) }),
    });
    if (!verRes.ok) return { ok: false, error: await readError(verRes) };
    const data = await verRes.json();
    if (data?.credentialId) localStorage.setItem(CRED_FLAG_KEY, data.credentialId);
    return { ok: true };
  },

  async loginWithBiometric(): Promise<BiometricResult> {
    if (!isSupabaseEnabled || !supabase) return { ok: false, error: "この環境では利用できません。" };

    const optRes = await fetch("/api/webauthn/login-options", { method: "POST" });
    if (!optRes.ok) return { ok: false, error: await readError(optRes) };
    const optionsJSON = await optRes.json();

    let asseResp;
    try { asseResp = await startAuthentication({ optionsJSON }); }
    catch (e: any) { return { ok: false, error: toMessage(e) }; }

    const verRes = await fetch("/api/webauthn/login-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: asseResp }),
    });
    if (!verRes.ok) return { ok: false, error: await readError(verRes) };
    const { tokenHash } = await verRes.json();

    const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (error) return { ok: false, error: error.message };

    // 端末登録フラグを補完（別途クリアされていてもログイン成功なら登録済みとみなす）
    if (asseResp?.id) localStorage.setItem(CRED_FLAG_KEY, asseResp.id);
    return { ok: true };
  },

  async removeCredential(): Promise<BiometricResult> {
    const token = await accessToken();
    const credentialId = localStorage.getItem(CRED_FLAG_KEY);
    if (token) {
      await fetch("/api/webauthn/delete-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ credentialId }),
      }).catch(() => { /* ローカルフラグ削除は続行 */ });
    }
    localStorage.removeItem(CRED_FLAG_KEY);
    return { ok: true };
  },
};
