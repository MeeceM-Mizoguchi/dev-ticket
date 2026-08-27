import { useState, useEffect, useCallback, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { Capacitor } from "@capacitor/core";
import { Mail, Lock, ArrowRight, Fingerprint } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { biometricAuth } from "@/lib/biometricAuth";
import { AuthScreen, AuthHeroWord, AuthField, AuthSubmitButton, AuthError } from "@/app/components/auth/AuthScreen";
import { peekRedirect } from "@/app/lib/authRedirect";

const RECENT_USERS_KEY = "dt_recent_users";

export function LoginPage() {
  const { login, loginWithBiometric } = useAuth();
  const navigate = useNavigate();
  // 未ログインで共有URLを開いた場合の戻り先（無ければダッシュボード）。
  // 消すのは着地側(ProtectedShell)。ここで消すとレンダー中の副作用になり、
  // 再レンダーで戻り先を見失う可能性があるため読むだけにする。
  const afterLogin = () => peekRedirect() ?? "/dashboard";

  // ログイン成功後の着地（BRU11-045）。
  // SPA遷移だと画面を開きっぱなしにしていた間にデプロイされた新しいUIが載らないため、
  // Web版はフルロードで着地させ「リロードした直後」と同じ状態から始める。
  // ネイティブ(Mac/iPad)アプリはアセットが同梱でリロードしても内容が変わらず、
  // 起動シーケンスをやり直すだけ損なので従来どおりSPA遷移。
  const goAfterLogin = () => {
    const to = afterLogin();
    if (Capacitor.isNativePlatform()) { navigate(to, { replace: true }); return; }
    window.location.assign(to);
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recentUsers] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_USERS_KEY) || "[]"); }
    catch { return []; }
  });

  // 生体認証ログイン（この端末で登録済みの場合のみ表示）
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);

  const runBioLogin = useCallback(async () => {
    setBioLoading(true); setError("");
    try {
      const err = await loginWithBiometric();
      if (err) setError(err);
      else goAfterLogin();
    } catch (e: any) {
      setError(e?.message || "生体認証ログインに失敗しました。");
    } finally {
      setBioLoading(false);
    }
  }, [loginWithBiometric, navigate]);

  useEffect(() => {
    if (sessionStorage.getItem("isLoggedIn") === "true") return;
    let cancelled = false;
    (async () => {
      const [supported, registered] = await Promise.all([
        biometricAuth.isSupported(),
        biometricAuth.isRegisteredOnThisDevice(),
      ]);
      if (cancelled) return;
      const available = supported && registered;
      setBioAvailable(available);
      // Mac/iPadアプリ: 登録済み端末ならログイン画面到達時に自動でプロンプト表示。
      // 未登録端末では出さない（初回端末でいきなり求めない）。
      if (available && biometricAuth.isNative()) void runBioLogin();
    })();
    return () => { cancelled = true; };
  }, [runBioLogin]);

  if (sessionStorage.getItem("isLoggedIn") === "true") return <Navigate to={afterLogin()} replace />;

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const toJapaneseError = (msg: string) => {
    if (msg.includes("Invalid login credentials") || msg.includes("invalid_credentials"))
      return "メールアドレスまたはパスワードが正しくありません。";
    if (msg.includes("Email not confirmed"))
      return "メールアドレスが確認されていません。招待メールをご確認ください。";
    if (msg.includes("Too many requests"))
      return "ログイン試行回数が多すぎます。しばらくしてから再度お試しください。";
    return "ログインに失敗しました。再度お試しください。";
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    let hasError = false;
    if (!email.trim()) {
      setEmailError("メールアドレスを入力してください"); hasError = true;
    } else if (!isValidEmail(email)) {
      setEmailError("正しいメールアドレスを入力してください"); hasError = true;
    } else { setEmailError(""); }
    if (!password) {
      setPasswordError("パスワードを入力してください"); hasError = true;
    } else { setPasswordError(""); }
    if (hasError) return;

    setLoading(true); setError("");
    const err = await login(email, password);
    if (err) {
      setError(toJapaneseError(err)); setLoading(false);
    } else {
      const prev: string[] = (() => { try { return JSON.parse(localStorage.getItem(RECENT_USERS_KEY) || "[]"); } catch { return []; } })();
      const updated = [email, ...prev.filter(u => u !== email)].slice(0, 5);
      localStorage.setItem(RECENT_USERS_KEY, JSON.stringify(updated));
      goAfterLogin();
    }
  };

  return (
    <AuthScreen
      heroTitle={<>プロジェクトを、<br /><AuthHeroWord>スマート</AuthHeroWord>に。</>}
      heroLead="チケット・スプリント・ガント・メンバーの稼働、そして GitHub の PR まで。起票からリリースまでを、ひとつの画面で。"
      title="ログイン"
      description="アカウントにアクセスしてください"
      below={recentUsers.length > 0 ? (
        <div
          className="rounded-2xl bg-white/85 backdrop-blur px-4 py-3.5"
          style={{ border: '1px solid rgba(13,148,136,0.18)', boxShadow: '0 12px 28px -24px rgba(15,23,42,0.6)' }}
        >
          <p className="text-[10px] font-black tracking-[0.16em] text-slate-400 mb-2.5">最近のログイン</p>
          <div className="flex flex-wrap gap-1.5">
            {recentUsers.map(userEmail => (
              <button key={userEmail} type="button"
                onClick={() => { setEmail(userEmail); setEmailError(""); }}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-teal-50 hover:border-teal-300 hover:text-teal-700 transition-colors">
                {userEmail}
              </button>
            ))}
          </div>
        </div>
      ) : undefined}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <AuthError message={error} />}
        <AuthField
          icon={Mail} label="メールアドレス" type="text" placeholder="you@company.com"
          value={email} onChange={v => { setEmail(v); if (emailError) setEmailError(""); }}
          autoComplete="email" error={emailError}
        />
        <AuthField
          icon={Lock} label="パスワード" type="password" placeholder="••••••••"
          value={password} onChange={v => { setPassword(v); if (passwordError) setPasswordError(""); }}
          autoComplete="current-password" error={passwordError}
        />
        <div className="pt-1">
          <AuthSubmitButton loading={loading}>
            ログイン <ArrowRight className="w-4 h-4" />
          </AuthSubmitButton>
        </div>
      </form>

      {bioAvailable && (
        <>
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-[11px] font-bold text-slate-400">または</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
          <button type="button" onClick={runBioLogin} disabled={bioLoading || loading}
            className="w-full rounded-xl py-3 text-[14px] font-bold flex items-center justify-center gap-2 bg-white text-teal-700 border border-teal-200 hover:bg-teal-50 hover:border-teal-300 transition-colors disabled:opacity-60">
            {bioLoading
              ? <><span className="w-4 h-4 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />認証中...</>
              : <><Fingerprint className="w-4 h-4" />生体認証でログイン</>}
          </button>
        </>
      )}
    </AuthScreen>
  );
}
