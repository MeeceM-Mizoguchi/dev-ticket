import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Ticket, AlertTriangle, ArrowRight } from "lucide-react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { FieldInput } from "@/app/components/shared/FieldInput";

type Phase = "loading" | "verify" | "form" | "error";

function linkErrorMessage(code: string | null): string {
  if (code === "otp_expired") {
    return "この招待リンクは既に使用済みか、有効期限が切れています。お手数ですが、招待した管理者に再送を依頼してください。";
  }
  return "招待リンクの確認に失敗しました。リンクが無効か期限切れの可能性があります。管理者に再送を依頼してください。";
}

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [linkError, setLinkError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [token, setToken] = useState<{ hash: string; type: EmailOtpType } | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled) { setPhase("form"); return; }

    // 1) Supabase がエラーを URL ハッシュに載せて返すケース（期限切れ・消費済みの旧リンク等）。
    //    以前はここを読まず onAuthStateChange を待ち続けて無限ローディングになっていた。
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hashParams.get("error")) {
      setLinkError(linkErrorMessage(hashParams.get("error_code")));
      setPhase("error");
      return;
    }

    // 2) 新方式: メールから token_hash を受け取り、ユーザーのボタン操作を待って verifyOtp する。
    //    リンクスキャナが自動アクセスしてもトークンは消費されない（＝ otp_expired を防ぐ）。
    const q = new URLSearchParams(window.location.search);
    const th = q.get("token_hash");
    const ty = q.get("type") as EmailOtpType | null;
    if (th && ty) {
      setToken({ hash: th, type: ty });
      setPhase("verify");
      return;
    }

    // 3) 既存セッション経由（旧 action_link がハッシュにセッションを載せて戻すケース含む）。
    let done = false;
    supabase!.auth.getSession().then(({ data: { session } }) => {
      if (session) { done = true; setPhase("form"); return; }
      const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
        if (session) { done = true; setPhase("form"); subscription.unsubscribe(); }
      });
    });
    // セッションが一定時間来なければエラー表示（無限ローディング防止）。
    const timer = setTimeout(() => {
      if (!done) { setLinkError(linkErrorMessage(null)); setPhase("error"); }
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  const handleVerify = async () => {
    if (!token) return;
    setVerifying(true); setLinkError("");
    const { error } = await supabase!.auth.verifyOtp({ token_hash: token.hash, type: token.type });
    if (error) {
      setLinkError(linkErrorMessage("otp_expired"));
      setPhase("error");
    } else {
      setPhase("form");
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError("パスワードは8文字以上にしてください"); return; }
    if (password !== confirm) { setError("パスワードが一致しません"); return; }
    setLoading(true); setError("");
    if (!isSupabaseEnabled) { navigate("/dashboard"); return; }
    const { data, error } = await supabase!.auth.updateUser({ password });
    if (error) { setError(error.message); setLoading(false); }
    else {
      if (data.user) {
        await supabase!.from("profiles").update({ status: "active" }).eq("id", data.user.id);
      }
      sessionStorage.setItem("isLoggedIn", "true"); navigate("/dashboard");
    }
  };

  if (phase === "loading") return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#F5F6F8" }}>
      <div style={{ textAlign:"center" as const }}>
        <div style={{ width:38, height:38, borderRadius:11, background:"linear-gradient(145deg,#34D399,#059669)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px", boxShadow:"0 4px 12px rgba(5,150,105,0.35)" }}>
          <Ticket style={{ width:17, height:17, color:"#fff" }} />
        </div>
        <p style={{ fontSize:12, color:"#A09790" }}>招待を確認中...</p>
      </div>
    </div>
  );

  if (phase === "error") return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#F5F6F8", padding:24 }}>
      <div style={{ maxWidth:380, width:"100%", background:"#fff", border:"1px solid #E7E5E4", borderRadius:16, padding:32, textAlign:"center" as const, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ width:44, height:44, borderRadius:12, background:"#FEF2F2", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}>
          <AlertTriangle style={{ width:22, height:22, color:"#DC2626" }} />
        </div>
        <h1 style={{ fontSize:18, fontWeight:700, color:"#1C1917", margin:"0 0 8px" }}>リンクを開けませんでした</h1>
        <p style={{ fontSize:13, color:"#78716C", lineHeight:1.7, margin:0 }}>{linkError}</p>
      </div>
    </div>
  );

  if (phase === "verify") return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#F5F6F8", padding:24 }}>
      <div style={{ maxWidth:380, width:"100%", background:"#fff", border:"1px solid #E7E5E4", borderRadius:16, padding:32, textAlign:"center" as const, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ width:44, height:44, borderRadius:12, background:"linear-gradient(145deg,#34D399,#059669)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px", boxShadow:"0 4px 12px rgba(5,150,105,0.35)" }}>
          <Ticket style={{ width:20, height:20, color:"#fff" }} />
        </div>
        <h1 style={{ fontSize:18, fontWeight:700, color:"#1C1917", margin:"0 0 8px" }}>チームへの招待</h1>
        <p style={{ fontSize:13, color:"#78716C", lineHeight:1.7, margin:"0 0 20px" }}>下のボタンを押して招待を受け、パスワードを設定してください。</p>
        <button type="button" onClick={handleVerify} disabled={verifying}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-sm shadow-emerald-200">
          {verifying
            ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />確認中...</>
            : <>招待を受けて続ける <ArrowRight className="w-4 h-4" /></>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex w-[42%] bg-teal-700 flex-col justify-between p-12 relative overflow-hidden"
        style={{ backgroundImage: "radial-gradient(circle at 70% 30%, rgba(255,255,255,0.07) 0%, transparent 60%)" }}>
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="relative">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-md">
              <Ticket className="text-teal-700" style={{ width: 18, height: 18 }} />
            </div>
            <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--font-heading)" }}>Dev Ticket</span>
          </div>
          <h2 className="text-4xl font-bold text-white leading-tight mb-5" style={{ fontFamily: "var(--font-heading)" }}>チームへ<br />ようこそ。</h2>
          <p className="text-teal-100 text-sm leading-relaxed max-w-xs">パスワードを設定してアカウントを有効化してください。チームのプロジェクトやチケット管理にすぐ参加できます。</p>
        </div>
        <p className="relative text-xs text-teal-400">© 2026 Dev Ticket. All rights reserved.</p>
      </div>
      <div className="flex-1 flex items-center justify-center p-8 bg-[#F5F6F8]">
        <div className="w-full max-w-[360px]">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-stone-900 mb-1" style={{ fontFamily: "var(--font-heading)" }}>パスワード設定</h1>
            <p className="text-sm text-stone-500">新しいパスワードを入力してアカウントを有効化してください</p>
          </div>
          <div className="bg-white rounded-2xl border border-stone-200 p-7 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />{error}
                </div>
              )}
              <FieldInput label="新しいパスワード" type="password" placeholder="8文字以上" value={password} onChange={setPassword} />
              <FieldInput label="パスワード（確認）" type="password" placeholder="もう一度入力" value={confirm} onChange={setConfirm} />
              <button type="submit" disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-sm shadow-emerald-200 mt-1">
                {loading
                  ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />設定中...</>
                  : <>パスワードを設定 <ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
