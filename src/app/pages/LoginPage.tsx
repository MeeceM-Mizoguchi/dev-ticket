import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { Ticket, AlertTriangle, ArrowRight } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { FieldInput } from "@/app/components/shared/FieldInput";

const RECENT_USERS_KEY = "dt_recent_users";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
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

  if (sessionStorage.getItem("isLoggedIn") === "true") return <Navigate to="/dashboard" replace />;

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
      navigate("/dashboard");
    }
  };

  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex w-[42%] bg-teal-700 flex-col justify-between p-12 relative overflow-hidden"
        style={{ backgroundImage: "radial-gradient(circle at 70% 30%, rgba(255,255,255,0.07) 0%, transparent 60%), radial-gradient(circle at 20% 80%, rgba(0,0,0,0.1) 0%, transparent 50%)" }}>
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="relative">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-md">
              <Ticket className="text-teal-700" style={{ width: 18, height: 18 }} />
            </div>
            <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--font-heading)" }}>Dev Ticket</span>
          </div>
          <h2 className="text-4xl font-bold text-white leading-tight mb-5" style={{ fontFamily: "var(--font-heading)" }}>プロジェクトを、<br />スマートに。</h2>
          <p className="text-teal-100 text-sm leading-relaxed max-w-xs">チケット・スプリント・メンバーを一元管理。<br />チームの生産性を最大化するツール。</p>
        </div>
        <div className="relative">
          <div className="flex gap-8 mb-6">
            {[{ n: "4件", l: "進行中PJ" }, { n: "5名", l: "メンバー" }, { n: "87%", l: "完了率" }].map(({ n, l }) => (
              <div key={l}><p className="text-2xl font-bold text-white" style={{ fontFamily: "var(--font-heading)" }}>{n}</p><p className="text-xs text-teal-300 mt-0.5">{l}</p></div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-5 sm:p-8 bg-[#F5F6F8]">
        <div className="w-full max-w-[360px]">
          <div className="mb-6 sm:mb-8">
            <h1 className="text-2xl font-bold text-stone-900 mb-1" style={{ fontFamily: "var(--font-heading)" }}>ログイン</h1>
            <p className="text-sm text-stone-500">アカウントにアクセスしてください</p>
          </div>
          <div className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-7 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {error && (
                <div className="flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />{error}
                </div>
              )}
              <FieldInput label="メールアドレス" type="text" placeholder="you@company.com" value={email} onChange={v => { setEmail(v); if (emailError) setEmailError(""); }} autoComplete="email" error={emailError} />
              <FieldInput label="パスワード" type="password" placeholder="••••••••" value={password} onChange={v => { setPassword(v); if (passwordError) setPasswordError(""); }} autoComplete="current-password" error={passwordError} />
              <button type="submit" disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-sm shadow-emerald-200 mt-1">
                {loading
                  ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />認証中...</>
                  : <>ログイン <ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>
          </div>
          {recentUsers.length > 0 && (
            <div className="mt-4 p-4 bg-white rounded-xl border border-stone-200">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">最近のログイン</p>
              <div className="flex flex-wrap gap-1.5">
                {recentUsers.map(userEmail => (
                  <button key={userEmail} type="button"
                    onClick={() => { setEmail(userEmail); setEmailError(""); }}
                    className="text-xs px-2.5 py-1.5 bg-stone-50 hover:bg-emerald-50 border border-stone-200 hover:border-emerald-300 rounded-lg text-stone-500 hover:text-emerald-700 transition-all font-medium">
                    {userEmail}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
