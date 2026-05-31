import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Ticket, AlertTriangle, ArrowRight } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { FieldInput } from "@/app/components/shared/FieldInput";

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    if (!isSupabaseEnabled) { setSessionReady(true); return; }
    supabase!.auth.getSession().then(({ data: { session } }) => {
      if (session) { setSessionReady(true); return; }
      const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
        if (session) { setSessionReady(true); subscription.unsubscribe(); }
      });
    });
  }, []);

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

  if (!sessionReady) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#F5F6F8" }}>
      <div style={{ textAlign:"center" as const }}>
        <div style={{ width:38, height:38, borderRadius:11, background:"linear-gradient(145deg,#34D399,#059669)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px", boxShadow:"0 4px 12px rgba(5,150,105,0.35)" }}>
          <Ticket style={{ width:17, height:17, color:"#fff" }} />
        </div>
        <p style={{ fontSize:12, color:"#A09790" }}>招待を確認中...</p>
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
