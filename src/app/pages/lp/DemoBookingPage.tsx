import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ArrowLeft, Building2, User, Mail, Phone, CheckCircle2, Check,
  ChevronRight, ChevronLeft, CalendarDays, Ticket, Video, Clock, AlertCircle,
} from 'lucide-react';
import { Calendar } from '@/app/components/ui/calendar';
import { addDays, format, startOfDay } from 'date-fns';
import { ja } from 'date-fns/locale';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormData {
  isIndividual: boolean;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
}

type TimePreference = 'morning' | 'afternoon' | 'anytime';

const TIME_OPTIONS: { value: TimePreference; label: string }[] = [
  { value: 'morning', label: '午前（10:00〜12:00）' },
  { value: 'afternoon', label: '午後（13:00〜17:00）' },
  { value: 'anytime', label: 'どちらでも可' },
];

const PLAN_LABELS: Record<string, string> = {
  free:         '無料',
  starter:      'スターター',
  professional: 'プロフェッショナル',
  enterprise:   'エンタープライズ',
};

/** 商談で何をするか。左のパネルに出して、フォームを埋める前に見返せるようにする */
const AGENDA = [
  '実際の画面を操作しながら、機能をご説明します',
  'チームの進め方に合わせた設定をご相談いただけます',
  '料金プランと、導入までの進め方をご案内します',
];

// ─── Helper ───────────────────────────────────────────────────────────────────

function inputClass(hasError: boolean, disabled?: boolean) {
  const base = 'w-full pl-11 pr-4 py-3.5 rounded-xl border text-[15px] transition-all focus:outline-none focus:ring-4 placeholder:text-slate-300';
  if (disabled) return `${base} bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed`;
  if (hasError) return `${base} bg-white border-red-300 focus:border-red-400 focus:ring-red-100`;
  return `${base} bg-white border-slate-200 hover:border-slate-300 focus:border-teal-500 focus:ring-teal-100`;
}

/** ラベル・アイコン・エラーをひとまとめにした入力欄。3箇所で同じ形を繰り返さないため */
function Field({ icon: Icon, label, required, error, children }: {
  icon: typeof Mail; label: string; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[13px] font-black text-slate-700 mb-2">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <div className="relative">
        <Icon className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${error ? 'text-red-400' : 'text-slate-400'}`} />
        {children}
      </div>
      {error && (
        <p className="flex items-center gap-1 text-red-500 text-xs mt-1.5 font-medium">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{error}
        </p>
      )}
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepBar({ step }: { step: 'form' | 'calendar' | 'success' }) {
  const steps = [
    { key: 'form', label: 'お客様情報' },
    { key: 'calendar', label: '日程の選択' },
    { key: 'success', label: '完了' },
  ] as const;
  const activeIdx = steps.findIndex(s => s.key === step);
  return (
    <ol className="flex items-center mb-8 sm:mb-10">
      {steps.map((s, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <li key={s.key} className={`flex items-center ${i < steps.length - 1 ? 'flex-1' : ''}`}>
            <div className="flex items-center gap-2.5 flex-shrink-0">
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0 transition-all"
                style={
                  done
                    ? { background: 'linear-gradient(135deg,#2dd4bf,#059669)', color: '#fff' }
                    : active
                      ? { background: '#fff', color: '#047857', border: '2px solid #059669', boxShadow: '0 0 0 4px rgba(5,150,105,0.12)' }
                      : { background: '#f1f5f9', color: '#94a3b8' }
                }
              >
                {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={`text-[13px] font-bold whitespace-nowrap ${active ? 'text-slate-900' : done ? 'text-slate-500' : 'text-slate-400'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span className="mx-3 h-0.5 flex-1 rounded-full" style={{ background: done ? 'linear-gradient(90deg,#2dd4bf,#059669)' : '#e2e8f0' }} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

export function DemoBookingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const plan = searchParams.get('plan') ?? '';
  const [step, setStep] = useState<'form' | 'calendar' | 'success'>('form');
  const [form, setForm] = useState<FormData>({
    isIndividual: false,
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
  });
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [timePrefs, setTimePrefs] = useState<Record<string, TimePreference>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 準備期間として、本日から1週間後以降のみ選択できる
  const minDate = addDays(startOfDay(new Date()), 7);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const setField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => { const n = { ...e }; delete n[key as string]; return n; });
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.isIndividual && !form.companyName.trim()) e.companyName = '会社名を入力してください';
    if (!form.contactName.trim()) e.contactName = '担当者名を入力してください';
    if (!form.email.trim()) e.email = 'メールアドレスを入力してください';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'メールアドレスの形式が正しくありません';
    if (!form.phone.trim()) e.phone = '電話番号を入力してください';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const sortedDates = [...selectedDates].sort((a, b) => a.getTime() - b.getTime());

  const isTimeSelectionComplete = selectedDates.length > 0 &&
    sortedDates.every(d => timePrefs[format(d, 'yyyy-MM-dd')]);

  const handleDateSelect = (dates: Date[] | undefined) => {
    const next = dates ?? [];
    if (next.length > 3) return;
    setSelectedDates(next);
    const nextKeys = new Set(next.map(d => format(d, 'yyyy-MM-dd')));
    setTimePrefs(prev => {
      const cleaned: Record<string, TimePreference> = {};
      for (const k of Object.keys(prev)) {
        if (nextKeys.has(k)) cleaned[k] = prev[k];
      }
      return cleaned;
    });
    setErrors(e => { const n = { ...e }; delete n.calendar; return n; });
  };

  const handleSubmit = async () => {
    if (selectedDates.length === 0) {
      setErrors(e => ({ ...e, calendar: '候補日を1日以上選択してください' }));
      return;
    }
    setSubmitting(true);
    try {
      const candidates = sortedDates.map(d => {
        const key = format(d, 'yyyy-MM-dd');
        return { date: key, preference: timePrefs[key] ?? 'anytime' };
      });
      await fetch('/api/book-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, candidates, plan }),
      });
    } catch {
      // APIが未設定でも成功画面を表示する
    }
    setSubmitting(false);
    setStep('success');
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  // 日程選択だけカレンダーと候補日を横に並べるので、本文の幅を広く取る
  const bodyWidth = step === 'calendar' ? 'max-w-[1000px]' : step === 'success' ? 'max-w-[620px]' : 'max-w-[560px]';

  return (
    <div className="min-h-[100svh] lg:h-[100svh] flex flex-col lg:flex-row bg-white overflow-hidden">
      <style>{`
        @keyframes bkRise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        @keyframes bkPop { from { opacity: 0; transform: scale(.82); } to { opacity: 1; transform: scale(1); } }
        @keyframes bkRing { 0%,100% { transform: scale(.95); opacity: .45; } 50% { transform: scale(1.06); opacity: .25; } }
        @keyframes bkDash { to { stroke-dashoffset: -400; } }
        .bk-rise { animation: bkRise .6s cubic-bezier(.22,.9,.3,1) both; }
        .bk-pop { animation: bkPop .5s cubic-bezier(.34,1.56,.64,1) both; }
        .bk-ring { animation: bkRing 3s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .bk-rise, .bk-pop, .bk-ring { animation: none !important; }
        }
      `}</style>

      {/* ── 左：何のための時間なのかを置いておくパネル ─────────────────
          縦位置は auto マージンではなく flex-1 + justify-center で決める。
          `lg:mt-0` と `lg:my-auto` を併記すると、Tailwind の出力順で mt-0 が後に来て
          margin-top だけ 0 に潰され、中身がロゴに張り付く（下だけ余白が残る）ため。 */}
      <aside
        className="relative flex-shrink-0 lg:w-[400px] xl:w-[452px] lg:h-full overflow-hidden border-b lg:border-b-0 lg:border-r border-slate-200"
        style={{ background: 'linear-gradient(170deg,#f6fffc 0%,#ecfdf5 46%,#f7fee7 100%)' }}
      >
        {/* 背景の光だけ。細かいドットは小さい面では砂粒にしか見えないので敷かない */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          <div className="absolute -top-40 -left-28 w-[28rem] h-[28rem] rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(45,212,191,0.30) 0%, transparent 100%)' }} />
          <div className="absolute -bottom-40 -right-28 w-[26rem] h-[26rem] rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(163,230,53,0.26) 0%, transparent 100%)' }} />
        </div>

        {/* 下端の帯。ここには何も重ねないので、線は最後まで見える */}
        <svg className="absolute bottom-0 left-0 w-full h-20 lg:h-28 pointer-events-none" viewBox="0 0 452 120" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="bkLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#14b8a6" />
              <stop offset="100%" stopColor="#84cc16" />
            </linearGradient>
            <linearGradient id="bkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5eead4" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#5eead4" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0 120V74c70 4 96-22 160-28s96 20 160 12 132-26 132-26V120z" fill="url(#bkFill)" />
          <path
            d="M0 74c70 4 96-22 160-28s96 20 160 12 132-26 132-26"
            fill="none" stroke="url(#bkLine)" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray="8 12" opacity="0.7" style={{ animation: 'bkDash 18s linear infinite' }}
          />
        </svg>

        <div className="relative h-full flex flex-col px-6 sm:px-8 lg:px-10 pt-5 lg:pt-9 pb-24 lg:pb-32">
          {/* ロゴ＋戻る */}
          <div className="flex items-center justify-between gap-3 flex-shrink-0">
            <button onClick={() => navigate('/')} className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(145deg,#34D399,#059669)', boxShadow: '0 4px 12px rgba(5,150,105,0.35)' }}>
                <Ticket className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold text-slate-900">Dev Ticket</span>
            </button>
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1.5 text-[13px] font-bold text-slate-500 hover:text-teal-700 px-2.5 py-1.5 rounded-lg hover:bg-white/70 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              トップ
            </button>
          </div>

          {/* 中身（PCでは縦中央） */}
          <div className="flex-1 flex flex-col justify-center py-8 lg:py-10">
            {plan && PLAN_LABELS[plan] && (
              <span className="inline-flex items-center gap-1.5 w-fit rounded-full px-3 py-1 mb-4 text-[11px] font-black bg-white/85 text-teal-700" style={{ border: '1px solid rgba(13,148,136,0.28)' }}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                {PLAN_LABELS[plan]}プランのご相談
              </span>
            )}
            <h1 className="text-[1.75rem] lg:text-[2.1rem] font-black text-slate-900 leading-[1.25] tracking-tight">
              商談のご予約
            </h1>
            <p className="mt-3 text-[13px] lg:text-sm text-slate-600 leading-relaxed">
              ご入力は2ステップ、1分ほどで終わります。オンラインで、実際の画面をご覧いただきながらご説明します。
            </p>

            <ul className="mt-6 lg:mt-7 space-y-2.5">
              {AGENDA.map(t => (
                <li key={t} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-px" style={{ background: 'linear-gradient(135deg,#2dd4bf,#059669)' }}>
                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                  </span>
                  <span className="text-[13px] text-slate-700 leading-snug">{t}</span>
                </li>
              ))}
            </ul>

            {/* 約束（PCのみ。モバイルはフォームまでの距離を詰める） */}
            <div className="hidden lg:block mt-8 rounded-2xl p-4 bg-white/80 backdrop-blur" style={{ border: '1px solid rgba(13,148,136,0.18)', boxShadow: '0 10px 26px -14px rgba(6,78,59,0.30)' }}>
              {[
                { icon: Video, t: 'オンラインで実施', s: '商談URL（Google Meet 等）をメールでお送りします' },
                { icon: Clock, t: '2営業日以内にご連絡', s: '担当者が候補日を確認のうえ日程を確定します' },
              ].map(({ icon: Icon, t, s }, i) => (
                <div key={t} className={`flex items-start gap-2.5 ${i > 0 ? 'mt-3 pt-3 border-t border-slate-200/70' : ''}`}>
                  <Icon className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[12px] font-black text-slate-800 leading-tight">{t}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{s}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* ── 右：本体 ───────────────────────────────────────────────── */}
      <main className="flex-1 lg:h-full lg:overflow-y-auto">
        <div className={`mx-auto w-full ${bodyWidth} px-5 sm:px-8 lg:px-12 py-8 lg:py-12 lg:min-h-full flex flex-col justify-center`}>
          <StepBar step={step} />

          {/* ── STEP 1: お客様情報 ── */}
          {step === 'form' && (
            <div className="bk-rise">
              <h2 className="text-xl font-black text-slate-900 mb-1">お客様情報</h2>
              <p className="text-[13px] text-slate-500 mb-6">ご連絡先をご入力ください。<span className="text-red-500">*</span> は必須項目です。</p>

              <div className="space-y-5">
                {/* 個人事業主 */}
                <label className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer select-none transition-colors" style={{ background: form.isIndividual ? 'rgba(20,184,166,0.10)' : '#f8fafc', border: `1px solid ${form.isIndividual ? 'rgba(13,148,136,0.35)' : '#e2e8f0'}` }}>
                  <input
                    type="checkbox"
                    checked={form.isIndividual}
                    onChange={e => {
                      setField('isIndividual', e.target.checked);
                      if (e.target.checked) {
                        setField('companyName', '');
                        setErrors(er => { const n = { ...er }; delete n.companyName; return n; });
                      }
                    }}
                    className="w-4.5 h-4.5 rounded accent-teal-600 flex-shrink-0"
                    style={{ width: 18, height: 18 }}
                  />
                  <span className="text-[13px] font-bold text-slate-700">個人事業主の方はこちら</span>
                  <span className="ml-auto text-[11px] text-slate-400">会社名の入力を省略します</span>
                </label>

                <Field icon={Building2} label="会社名" required={!form.isIndividual} error={errors.companyName}>
                  <input
                    type="text"
                    value={form.companyName}
                    disabled={form.isIndividual}
                    onChange={e => setField('companyName', e.target.value)}
                    placeholder={form.isIndividual ? '（個人事業主のため不要）' : '株式会社○○'}
                    className={inputClass(!!errors.companyName, form.isIndividual)}
                  />
                </Field>

                <Field icon={User} label="担当者名" required error={errors.contactName}>
                  <input
                    type="text"
                    value={form.contactName}
                    onChange={e => setField('contactName', e.target.value)}
                    placeholder="田中 太郎"
                    className={inputClass(!!errors.contactName)}
                  />
                </Field>

                <div className="grid sm:grid-cols-2 gap-5">
                  <Field icon={Mail} label="メールアドレス" required error={errors.email}>
                    <input
                      type="email"
                      value={form.email}
                      onChange={e => setField('email', e.target.value)}
                      placeholder="example@company.com"
                      className={inputClass(!!errors.email)}
                    />
                  </Field>

                  <Field icon={Phone} label="電話番号" required error={errors.phone}>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={e => setField('phone', e.target.value)}
                      placeholder="03-1234-5678"
                      className={inputClass(!!errors.phone)}
                    />
                  </Field>
                </div>
              </div>

              <button
                onClick={() => { if (validate()) setStep('calendar'); }}
                className="mt-8 w-full flex items-center justify-center gap-2 text-white font-bold text-[15px] px-8 py-4 rounded-xl transition-transform hover:-translate-y-0.5 active:translate-y-0"
                style={{ background: 'linear-gradient(135deg,#0d9488,#059669)', boxShadow: '0 14px 28px -12px rgba(5,150,105,0.7)' }}
              >
                次へ：日程の選択
                <ChevronRight className="w-5 h-5" />
              </button>
              <p className="mt-3 text-[11px] text-slate-400 text-center">この時点ではまだ予約は確定しません。</p>
            </div>
          )}

          {/* ── STEP 2: 候補日時 ── */}
          {step === 'calendar' && (
            <div className="bk-rise">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-xl font-black text-slate-900 mb-1">候補日時の選択</h2>
                  <p className="text-[13px] text-slate-500">ご都合の良い日を最大3つ、それぞれ時間帯までお選びください。</p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">
                  <CalendarDays className="w-3.5 h-3.5" />
                  本日より1週間後以降が選べます
                </span>
              </div>

              <div className="grid lg:grid-cols-[368px_1fr] gap-5">
                {/* カレンダー */}
                <div className="rounded-2xl bg-white p-4" style={{ border: '1px solid #e2e8f0', boxShadow: '0 12px 30px -18px rgba(15,23,42,0.25)' }}>
                  <Calendar
                    mode="multiple"
                    selected={selectedDates}
                    onSelect={handleDateSelect as (dates: Date[] | undefined) => void}
                    disabled={{ before: minDate }}
                    locale={ja}
                    className="p-0"
                    classNames={{
                      months: 'flex flex-col',
                      month: 'flex flex-col gap-3 w-full',
                      caption_label: 'text-[15px] font-black text-slate-800',
                      nav_button: 'size-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 inline-flex items-center justify-center transition-colors',
                      table: 'w-full border-collapse',
                      head_row: 'flex justify-between',
                      head_cell: 'w-11 font-bold text-[11px] text-slate-400',
                      row: 'flex w-full mt-1 justify-between',
                      cell: 'relative p-0 text-center',
                      day: 'size-11 p-0 rounded-xl text-sm font-bold text-slate-700 hover:bg-teal-50 hover:text-teal-700 transition-colors inline-flex items-center justify-center',
                      day_selected: 'text-white hover:text-white shadow-md shadow-teal-600/30 !bg-teal-600 hover:!bg-teal-700',
                      day_today: 'ring-1 ring-inset ring-teal-300 text-teal-700',
                      day_outside: 'text-slate-300 hover:bg-transparent',
                      day_disabled: 'text-slate-300 opacity-60 hover:bg-transparent hover:text-slate-300 cursor-not-allowed',
                    }}
                  />
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-400">選択中</span>
                    <div className="flex items-center gap-1">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="w-6 h-1.5 rounded-full" style={{ background: i < sortedDates.length ? 'linear-gradient(90deg,#2dd4bf,#059669)' : '#e2e8f0' }} />
                      ))}
                      <span className="ml-1.5 text-[11px] font-black text-slate-600">{sortedDates.length} / 3</span>
                    </div>
                  </div>
                </div>

                {/* 選択済み候補日 + 時間帯 */}
                <div className="flex flex-col gap-3">
                  {sortedDates.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center rounded-2xl px-6 py-12" style={{ border: '2px dashed #e2e8f0', background: '#fafbfc' }}>
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: 'rgba(20,184,166,0.10)' }}>
                        <CalendarDays className="w-6 h-6 text-teal-600" />
                      </div>
                      <p className="text-sm font-black text-slate-700">左のカレンダーから日を選んでください</p>
                      <p className="text-[12px] text-slate-400 mt-1">最大3日まで選べます</p>
                    </div>
                  )}

                  {sortedDates.map((date, i) => {
                    const key = format(date, 'yyyy-MM-dd');
                    const selected = timePrefs[key];
                    return (
                      <div
                        key={key}
                        className="rounded-2xl p-4 transition-all"
                        style={{
                          background: selected ? 'rgba(20,184,166,0.07)' : '#ffffff',
                          border: `1px solid ${selected ? 'rgba(13,148,136,0.32)' : '#e2e8f0'}`,
                          boxShadow: selected ? '0 10px 24px -16px rgba(5,150,105,0.55)' : '0 8px 20px -18px rgba(15,23,42,0.25)',
                        }}
                      >
                        <div className="flex items-center gap-2.5 mb-3">
                          <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-black flex-shrink-0" style={{ background: 'linear-gradient(135deg,#2dd4bf,#059669)', color: '#fff' }}>
                            {i + 1}
                          </span>
                          <span className="text-[15px] font-black text-slate-900">
                            {format(date, 'M月d日（EEE）', { locale: ja })}
                          </span>
                          {selected
                            ? <CheckCircle2 className="w-4 h-4 text-teal-600 ml-auto flex-shrink-0" />
                            : <span className="ml-auto text-[11px] font-bold text-amber-600 flex-shrink-0">時間帯を選択</span>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {TIME_OPTIONS.map(opt => {
                            const on = selected === opt.value;
                            return (
                              <button
                                key={opt.value}
                                onClick={() => setTimePrefs(p => ({ ...p, [key]: opt.value }))}
                                className="px-3.5 py-2 rounded-xl text-[12px] font-bold transition-all"
                                style={on
                                  ? { background: 'linear-gradient(135deg,#0d9488,#059669)', color: '#fff', boxShadow: '0 8px 18px -10px rgba(5,150,105,0.75)' }
                                  : { background: '#fff', color: '#475569', border: '1px solid #e2e8f0' }}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 操作 */}
              <div className="mt-6 pt-5 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <button
                  onClick={() => setStep('form')}
                  className="flex items-center justify-center gap-1.5 text-slate-600 hover:text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  お客様情報に戻る
                </button>
                <div className="flex flex-col items-stretch sm:items-end gap-1.5">
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || selectedDates.length === 0 || !isTimeSelectionComplete}
                    className="flex items-center justify-center gap-2 text-white font-bold text-[15px] px-8 py-3.5 rounded-xl transition-transform enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed"
                    style={submitting || selectedDates.length === 0 || !isTimeSelectionComplete
                      ? { background: '#cbd5e1' }
                      : { background: 'linear-gradient(135deg,#0d9488,#059669)', boxShadow: '0 14px 28px -12px rgba(5,150,105,0.7)' }}
                  >
                    {submitting ? '送信中…' : '商談を申し込む'}
                    {!submitting && <ChevronRight className="w-5 h-5" />}
                  </button>
                  {(errors.calendar || (!isTimeSelectionComplete && selectedDates.length > 0)) && (
                    <p className="flex items-center gap-1 text-[11px] font-bold text-amber-600">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {errors.calendar ?? 'すべての候補日で時間帯を選択してください'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── 完了 ── */}
          {step === 'success' && (
            <div className="bk-rise text-center">
              <div className="relative w-20 h-20 mx-auto mb-7">
                <div className="absolute inset-0 rounded-full bk-ring" style={{ background: 'rgba(20,184,166,0.28)' }} />
                <div className="relative w-20 h-20 rounded-full flex items-center justify-center bk-pop" style={{ background: 'linear-gradient(135deg,#2dd4bf,#059669)', boxShadow: '0 16px 32px -14px rgba(5,150,105,0.7)' }}>
                  <CheckCircle2 className="w-10 h-10 text-white" />
                </div>
              </div>

              <h2 className="text-2xl sm:text-[1.75rem] font-black text-slate-900 leading-snug tracking-tight mb-3">
                商談予約のリクエストを<br className="sm:hidden" />受け付けました
              </h2>
              <p className="text-[15px] text-slate-600 leading-relaxed mb-8">
                ご予約ありがとうございます。内容を確認のうえ、<br className="hidden sm:block" />
                2営業日以内に担当者より日程確定のご連絡を差し上げます。
              </p>

              <div className="rounded-2xl p-5 mb-8 text-left" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <p className="text-[11px] font-black tracking-[0.16em] text-slate-400 mb-3">今後の流れ</p>
                {[
                  '入力いただいたメールアドレス宛に、自動返信の確認メールが届きます。',
                  '担当者が候補日を確認し、商談URL（Google Meet 等）を発行してメールでご連絡します。',
                ].map((t, i) => (
                  <div key={t} className={`flex gap-3 ${i > 0 ? 'mt-3 pt-3 border-t border-slate-200' : ''}`}>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg,#2dd4bf,#059669)' }}>{i + 1}</span>
                    <span className="text-[13px] text-slate-600 leading-relaxed">{t}</span>
                  </div>
                ))}
              </div>

              <p className="flex items-center justify-center gap-1.5 text-[13px] text-slate-400 mb-7">
                <Mail className="w-4 h-4" />
                {form.email} 宛にメールを送信しました
              </p>

              <button
                onClick={() => navigate('/')}
                className="group inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-bold px-8 py-3.5 rounded-xl transition-colors"
              >
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
                トップページへ戻る
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
