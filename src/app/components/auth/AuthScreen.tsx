import type { ReactNode } from 'react';
import { Ticket, Users, GitBranch, GitMerge, Rocket, CheckCircle2, AlertCircle, type LucideIcon } from 'lucide-react';

/**
 * ログイン・パスワード設定など、認証まわりの画面の外枠。
 *
 * LPのメインビジュアル（LandingPage の Hero）と同じ言語で組む。旧デザインは濃いティールの
 * 板を左に敷いていたが、LP側が「白→ミント→ライムの地に、光・ドット・バーンダウンの波」へ
 * 変わったので、そこから来たユーザーが同じ製品の画面だと分かるように合わせる。
 *   ・地       … LPヒーローと同じグラデーション＋ゆっくり明滅する光＋ドット
 *   ・左       … ブランドと「起票→リリース」のレール（LPの製品ビジュアルと同じ並び）
 *   ・右       … LPの端末と同じ「ガラスの縁」で囲んだカード。この中にフォームを置く
 *
 * 波は下端に寄せ、高さを clamp で抑えている。LPで起きたように、絵の始まりが上のカードより
 * 高くなると、白いカードに切られて「途中で途切れた線」に見えるため。
 */

/** LPの製品ビジュアルと同じ6段階。ここでは進行を表さない意匠なので全部灯したままにする */
const AUTH_FLOW: { icon: LucideIcon; label: string }[] = [
  { icon: Ticket,       label: '起票' },
  { icon: Users,        label: 'アサイン' },
  { icon: GitBranch,    label: 'コミット' },
  { icon: GitMerge,     label: 'マージ' },
  { icon: Rocket,       label: 'デプロイ' },
  { icon: CheckCircle2, label: 'リリース' },
];

const BRAND_MARK = 'linear-gradient(145deg, #34D399, #059669)';
const BRAND_LINE = 'linear-gradient(135deg,#2dd4bf,#059669)';

/** 見出しの中で強調する語。LPと同じく、下線の帯＋グラデーションの文字にする */
export function AuthHeroWord({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-block">
      <span
        aria-hidden
        className="absolute left-0 right-0 bottom-[0.1em] h-[0.26em] rounded-full"
        style={{ background: 'linear-gradient(90deg, rgba(45,212,191,0.42), rgba(163,230,53,0.42))' }}
      />
      <span
        className="relative z-[1] text-transparent bg-clip-text"
        style={{ backgroundImage: 'linear-gradient(105deg,#0d9488 0%,#059669 55%,#4d7c0f 100%)' }}
      >
        {children}
      </span>
    </span>
  );
}

function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <div
      className="rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, background: BRAND_MARK, boxShadow: '0 4px 12px rgba(5,150,105,0.35)' }}
    >
      <Ticket className="text-white" style={{ width: size * 0.55, height: size * 0.55 }} />
    </div>
  );
}

export function AuthScreen({ heroTitle, heroLead, title, description, children, below }: {
  /** 左パネルの見出し。強調したい語は <AuthHeroWord> で囲む */
  heroTitle: ReactNode;
  /** 見出しの下の説明。改行したい位置には <br /> を入れる */
  heroLead: ReactNode;
  /** 右のカードの見出しと補足 */
  title: string;
  description: string;
  /** カードの中身（フォーム） */
  children: ReactNode;
  /** カードの下に置くもの（最近のログインなど） */
  below?: ReactNode;
}) {
  return (
    <div
      className="relative min-h-screen flex flex-col overflow-hidden"
      style={{ paddingTop: 'var(--app-safe-top, env(safe-area-inset-top))' }}
    >
      <style>{`
        @keyframes authRise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
        @keyframes authGlow { 0%, 100% { opacity: .55; } 50% { opacity: .9; } }
        @keyframes authDash { to { stroke-dashoffset: -560; } }
        .auth-rise { animation: authRise .7s cubic-bezier(.22,.9,.3,1) both; }
        .auth-glow { animation: authGlow 7s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .auth-rise, .auth-glow, .auth-dash { animation: none !important; }
        }

        /* 寸法はすべて画面サイズから引く。ブレークポイントで段階的に切り替えるのではなく
           clamp(下限, ビューポート連動, 上限) にして、幅・高さの変化に連続して追従させる。

           左右2枚は「ひと組」として中央に置き、左は文章の幅ぴったりで止める。
           grid の minmax(0, auto) 列だと、justify-content: center を指定しても
           Chrome は余った幅をこの列に吸わせてしまい（実測で 213px 伸びていた）、
           文章の右端と列の右端の差がそのまま左右の間の穴になっていた。
           flex なら flex-grow: 0 の項目は決して伸びないので、組の幅＝中身の幅になり、
           左右の間隔は gap のぶんだけで済む。 */
        .auth-grid {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: clamp(2rem, 3vw, 3.25rem);
          width: 100%;
          margin-inline: auto;
        }
        @media (min-width: 1024px) {
          .auth-grid {
            flex-direction: row;
            align-items: center;
            justify-content: center;
            gap: clamp(2rem, 2.6vw, 3.5rem);
            /* 極端に広い画面で間延びしないための上限。通常はここまで届かない */
            max-width: min(1400px, 92vw);
          }
          /* 伸びない・中身の幅ちょうど。狭いときだけ縮んで折り返す */
          .auth-hero { flex: 0 1 auto; min-width: 0; }
          .auth-card { flex: 0 0 clamp(360px, 26vw, 460px); }
        }
        /* 文字と丸の大きさは幅だけでなく高さからも引く（min(◯vw, ◯vh)）。
           横に広く縦の狭いノートPCでも、見出しが伸びすぎて画面に収まらなくなるのを防ぐ */
        .auth-hero {
          --hero-title: clamp(2.2rem, min(3.7vw, 6.6vh), 4.6rem);
          --hero-lead: clamp(1rem, min(1.2vw, 2.2vh), 1.4rem);
          --rail-dot: clamp(34px, min(2.4vw, 4.6vh), 46px);
        }
        .auth-card {
          --card-pad-x: clamp(1.25rem, 1.7vw, 2.25rem);
          --card-pad-y: clamp(1.5rem, 1.8vw, 2.25rem);
          --card-title: clamp(1.35rem, 1.5vw, 1.85rem);
        }
      `}</style>

      {/* ── 地 ─────────────────────────────────────────────── */}
      <div
        className="absolute inset-0 -z-10 overflow-hidden pointer-events-none"
        style={{ background: 'linear-gradient(168deg, #ffffff 0%, #fbfffe 22%, #f3fdfb 48%, #eefcf4 74%, #f8fef0 100%)' }}
      >
        <div className="auth-glow absolute -top-40 -left-28 w-[38rem] h-[38rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(45,212,191,0.24) 0%, transparent 66%)', filter: 'blur(20px)' }} />
        <div className="auth-glow absolute -top-24 right-[-10rem] w-[42rem] h-[42rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.22) 0%, transparent 66%)', filter: 'blur(20px)', animationDelay: '2s' }} />
        <div className="auth-glow absolute bottom-[-16rem] left-1/4 w-[40rem] h-[40rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(163,230,53,0.20) 0%, transparent 66%)', filter: 'blur(20px)', animationDelay: '4s' }} />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(13,148,136,0.15) 1px, transparent 0)',
            backgroundSize: '24px 24px',
            maskImage: 'radial-gradient(88% 70% at 45% 35%, #000 0%, transparent 78%)',
            WebkitMaskImage: 'radial-gradient(88% 70% at 45% 35%, #000 0%, transparent 78%)',
          }}
        />
        {/* バーンダウンの面と、右肩上がりのベロシティ線。カードに切られないよう下端に薄く敷く */}
        <svg
          className="absolute bottom-0 left-0 w-full"
          style={{ height: 'clamp(110px, 18vh, 210px)' }}
          viewBox="0 0 1440 420" preserveAspectRatio="none" aria-hidden="true"
        >
          <defs>
            <linearGradient id="authArea1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5eead4" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#5eead4" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="authArea2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a3e635" stopOpacity="0.30" />
              <stop offset="100%" stopColor="#a3e635" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="authLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#14b8a6" />
              <stop offset="55%" stopColor="#059669" />
              <stop offset="100%" stopColor="#84cc16" />
            </linearGradient>
          </defs>
          <path d="M0 420V300c180-14 240 44 400 30s250-96 420-104 300 44 420 22.5c110-20 200-60 200-60V420z" fill="url(#authArea2)" />
          <path d="M0 420V336c200 12 280-52 460-64s280 62 460 40 340-84 520-96V420z" fill="url(#authArea1)" />
          <path
            className="auth-dash"
            d="M0 336c200 12 280-52 460-64s280 62 460 40 340-84 520-96"
            fill="none" stroke="url(#authLine)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray="10 14" style={{ animation: 'authDash 22s linear infinite' }} opacity="0.75"
          />
        </svg>
      </div>

      {/* ── 本体 ───────────────────────────────────────────── */}
      <div className="relative flex-1 flex items-center justify-center px-5 sm:px-8 lg:px-10 py-8 sm:py-12">
        <div className="auth-grid">

          {/* 左：ブランドと、起票からリリースまでの流れ。
              上から下まで途切れない一続きの塊として組む（間を空けて散らさない） */}
          <div className="auth-rise auth-hero hidden lg:block">
            <div className="flex items-center gap-2.5 mb-8">
              <BrandMark size={44} />
              <span className="text-[1.35rem] font-bold text-slate-900">Dev Ticket</span>
            </div>

            <div
              className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 w-fit rounded-full px-4 py-2 mb-6 bg-white/85 backdrop-blur"
              style={{ border: '1px solid rgba(13,148,136,0.26)', boxShadow: '0 6px 20px rgba(13,148,136,0.12)' }}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-black text-teal-700">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: BRAND_LINE }} />
                プロジェクト管理 SaaS
              </span>
              <span className="w-px h-3 bg-slate-200" />
              <span className="text-[13px] font-bold text-slate-500">チケット・スプリント・GitHub を1本で</span>
            </div>

            <h2
              className="font-black text-slate-900 leading-[1.16] tracking-tight mb-6"
              style={{ fontSize: 'var(--hero-title)' }}
            >
              {heroTitle}
            </h2>
            <p
              className="text-slate-600 leading-relaxed"
              style={{ fontSize: 'var(--hero-lead)', maxWidth: '100%' }}
            >
              {heroLead}
            </p>

            {/* 起票→リリースのレール。LPの製品ビジュアル上部と同じ意匠。
                列いっぱいまで引き伸ばすと丸の間隔が間延びするので、幅に上限を掛ける */}
            <div className="relative" style={{ marginTop: 'clamp(2rem, 4.5vh, 3.25rem)', maxWidth: 'min(100%, 640px)' }}>
              <div
                className="absolute h-[3px] rounded-full"
                style={{
                  left: 'calc(var(--rail-dot) / 2 - 6px)',
                  right: 'calc(var(--rail-dot) / 2 - 6px)',
                  top: 'calc(var(--rail-dot) / 2 - 1.5px)',
                  background: 'linear-gradient(90deg,#5eead4,#059669 55%,#84cc16)',
                }}
              />
              <div className="relative flex justify-between">
                {AUTH_FLOW.map(({ icon: Icon, label }) => (
                  <div key={label} className="flex flex-col items-center gap-2">
                    <span
                      className="rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        width: 'var(--rail-dot)', height: 'var(--rail-dot)',
                        background: BRAND_LINE, boxShadow: '0 10px 20px -12px rgba(5,150,105,0.9)',
                      }}
                    >
                      <Icon style={{ width: 'calc(var(--rail-dot) * 0.42)', height: 'calc(var(--rail-dot) * 0.42)' }} className="text-white" />
                    </span>
                    <span className="text-[12px] font-black text-slate-500 whitespace-nowrap">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 右：フォーム。lg未満は1列になるので、カードが間延びしないよう幅を抑える */}
          <div className="auth-rise auth-card w-full max-w-[460px] mx-auto lg:max-w-none lg:mx-0" style={{ animationDelay: '.12s' }}>
            <div className="w-full">
              {/* 狭い画面では左パネルを出さないので、ブランドだけここに出す */}
              <div className="lg:hidden flex items-center gap-2.5 mb-6">
                <BrandMark size={36} />
                <span className="text-lg font-bold text-slate-900">Dev Ticket</span>
              </div>

              {/* LPの端末と同じガラスの縁。
                  LPでは色の付いた地の上に置くので白混じりの縁で成立していたが、この画面は
                  地がほぼ白なので、白から始まるグラデーションだと左上だけ縁が消えて、
                  右下にしか枠が無いように見える。全周ティール寄りにして輪郭を出す */}
              <div
                className="rounded-[22px] p-1.5"
                style={{
                  background: 'linear-gradient(155deg, rgba(153,246,228,0.62) 0%, rgba(167,243,208,0.55) 55%, rgba(217,249,157,0.48) 100%)',
                  border: '1px solid rgba(13,148,136,0.22)',
                  boxShadow: '0 56px 96px -38px rgba(6,78,59,0.42), 0 20px 44px -26px rgba(15,23,42,0.20)',
                }}
              >
                <div
                  className="rounded-[16px] bg-white"
                  style={{
                    border: '1px solid rgba(13,148,136,0.14)',
                    padding: 'var(--card-pad-y) var(--card-pad-x)',
                  }}
                >
                  <h1 className="font-black text-slate-900 leading-tight" style={{ fontSize: 'var(--card-title)' }}>{title}</h1>
                  <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">{description}</p>
                  <div className="mt-6">{children}</div>
                </div>
              </div>

              {below && <div className="mt-4">{below}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ラベル・アイコン・エラーをひとまとめにした入力欄 */
export function AuthField({ icon: Icon, label, type = 'text', placeholder, value, onChange, autoComplete, error, required }: {
  icon: LucideIcon;
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[13px] font-black text-slate-600 mb-1.5">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      <div className="relative">
        <Icon className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${error ? 'text-rose-400' : 'text-slate-400'}`} />
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          autoComplete={autoComplete}
          onChange={e => onChange(e.target.value)}
          className={`w-full pl-11 pr-4 py-3.5 rounded-xl border text-[15px] text-slate-900 bg-white transition-all outline-none focus:ring-4 placeholder:text-slate-300 ${
            error
              ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
              : 'border-slate-200 hover:border-slate-300 focus:border-teal-500 focus:ring-teal-100'
          }`}
        />
      </div>
      {error && (
        <p className="flex items-center gap-1 text-[11px] font-medium text-rose-500 mt-1.5">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />{error}
        </p>
      )}
    </div>
  );
}

/** 送信ボタン。LPの主ボタンと同じグラデーションと影 */
export function AuthSubmitButton({ loading, loadingLabel = '認証中...', disabled, children }: {
  loading?: boolean; loadingLabel?: string; disabled?: boolean; children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="w-full rounded-xl py-3.5 text-white text-[15px] font-bold flex items-center justify-center gap-2 border-0 transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
      style={{ background: 'linear-gradient(135deg,#0d9488 0%,#059669 100%)', boxShadow: '0 14px 30px -10px rgba(5,150,105,0.65)' }}
    >
      {loading
        ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />{loadingLabel}</>
        : children}
    </button>
  );
}

/** 失敗の知らせ */
export function AuthError({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2.5 p-3.5 rounded-xl text-[13px] leading-relaxed"
      style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#be123c' }}
    >
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />{message}
    </div>
  );
}
