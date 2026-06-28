// 生体認証ログイン: 単一の動的関数で全アクションを振り分ける。
// /api/webauthn/<action> の <action> が req.query.action に入る。
// Vercel の Serverless Functions 数を抑えるため7エンドポイントをこの1関数に集約。
// チケット: ENHA2-013
import {
  registerOptions, registerVerify, loginOptions, loginVerify,
  nativeRegister, nativeLogin, deleteCredential,
} from "./_handlers";

const routes: Record<string, (req: any, res: any) => Promise<any>> = {
  "register-options": registerOptions,
  "register-verify": registerVerify,
  "login-options": loginOptions,
  "login-verify": loginVerify,
  "native-register": nativeRegister,
  "native-login": nativeLogin,
  "delete-credential": deleteCredential,
};

export default async function handler(req: any, res: any) {
  const raw = req.query?.action;
  const action = Array.isArray(raw) ? raw[0] : raw;
  const fn = action ? routes[action] : undefined;
  if (!fn) return res.status(404).json({ error: "Not Found" });
  return fn(req, res);
}
