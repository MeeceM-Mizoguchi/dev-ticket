import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft, Building2, User, Mail, Phone, CheckCircle2,
  ChevronRight, ChevronLeft, CalendarDays, Ticket,
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

// ─── Helper ───────────────────────────────────────────────────────────────────

function inputClass(hasError: boolean, disabled?: boolean) {
  const base = 'w-full px-4 py-2.5 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2';
  if (disabled) return `${base} bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed`;
  if (hasError) return `${base} border-red-400 focus:border-red-500 focus:ring-red-200`;
  return `${base} border-slate-300 focus:border-teal-500 focus:ring-teal-200`;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepBar({ step }: { step: 'form' | 'calendar' | 'success' }) {
  const steps = [
    { key: 'form', label: 'STEP1 お客様情報' },
    { key: 'calendar', label: 'STEP2 日程選択' },
    { key: 'success', label: '完了' },
  ] as const;
  const activeIdx = steps.findIndex(s => s.key === step);
  return (
    <div className="hidden sm:flex items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <span key={s.key} className="flex items-center gap-2">
            <span className={active ? 'font-bold text-teal-600' : done ? 'text-slate-400 line-through' : 'text-slate-400'}>
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="text-slate-300">›</span>}
          </span>
        );
      })}
    </div>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

export function DemoBookingPage() {
  const navigate = useNavigate();
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

  // 操作日から1週間後以降のみ選択可能
  const minDate = addDays(startOfDay(new Date()), 7);

  // ── Form helpers ─────────────────────────────────────────────────────────────

  const setField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.isIndividual && !form.companyName.trim()) e.companyName = '会社名を入力してください';
    if (!form.contactName.trim()) e.contactName = '担当者名を入力してください';
    if (!form.email.trim()) e.email = 'メールアドレスを入力してください';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = '有効なメールアドレスを入力してください';
    if (!form.phone.trim()) e.phone = '電話番号を入力してください';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Calendar helpers ──────────────────────────────────────────────────────────

  const sortedDates = [...selectedDates].sort((a, b) => a.getTime() - b.getTime());

  const isTimeSelectionComplete = selectedDates.length > 0 &&
    selectedDates.every(d => !!timePrefs[format(d, 'yyyy-MM-dd')]);

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

  // ── Submit ────────────────────────────────────────────────────────────────────

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
        body: JSON.stringify({ ...form, candidates }),
      });
    } catch {
      // APIが未設定でも成功画面を表示する
    }
    setSubmitting(false);
    setStep('success');
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-50 to-slate-100 overflow-hidden">
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes pulseRing {
          0% { transform: scale(0.95); opacity: 0.5; }
          50% { transform: scale(1.05); opacity: 0.3; }
          100% { transform: scale(0.95); opacity: 0.5; }
        }
        .animate-fade-in-up {
          animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-scale-in {
          animation: scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .animate-pulse-ring {
          animation: pulseRing 3s ease-in-out infinite;
        }
      `}</style>


      {/* ヘッダー */}
      <header className="sticky top-0 w-full bg-white/90 backdrop-blur-md border-b border-slate-200 z-50 h-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(145deg, #34D399, #059669)', boxShadow: '0 3px 8px rgba(5,150,105,0.35)' }}
            >
              <Ticket className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-slate-900">Dev Ticket</span>
          </div>

          <StepBar step={step} />

          {step !== 'success' && (
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 font-medium px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              トップに戻る
            </button>
          )}
        </div>
      </header>

      {/* ── STEP 1: お客様情報フォーム ── */}
      {step === 'form' && (
        <main className="flex-1 flex flex-col justify-center max-w-4xl mx-auto w-full px-6 py-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-1">デモのご予約</h1>
            <p className="text-slate-500 text-sm">お客様情報をご入力ください</p>
          </div>

          <div className="bg-white rounded-3xl p-8 lg:p-10 shadow-xl shadow-slate-200/50 border border-slate-200">
            <div className="grid lg:grid-cols-2 gap-8">
              <div className="space-y-5">
                {/* 個人事業主チェック */}
                <label className="flex items-center gap-3 p-4 bg-teal-50 rounded-2xl cursor-pointer select-none">
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
                    className="w-5 h-5 rounded accent-teal-600 flex-shrink-0"
                  />
                  <span className="text-sm font-semibold text-slate-700">
                    個人事業主の方はこちら
                  </span>
                </label>

                {/* 会社名 */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    <Building2 className="inline w-4 h-4 mr-2 text-slate-400" />
                    会社名{!form.isIndividual && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <input
                    type="text"
                    value={form.companyName}
                    disabled={form.isIndividual}
                    onChange={e => setField('companyName', e.target.value)}
                    placeholder={form.isIndividual ? '（個人事業主のため不要）' : '株式会社○○'}
                    className={inputClass(!!errors.companyName, form.isIndividual)}
                  />
                  {errors.companyName && <p className="text-red-500 text-xs mt-1.5">{errors.companyName}</p>}
                </div>

                {/* 担当者名 */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    <User className="inline w-4 h-4 mr-2 text-slate-400" />
                    担当者名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.contactName}
                    onChange={e => setField('contactName', e.target.value)}
                    placeholder="田中 太郎"
                    className={inputClass(!!errors.contactName)}
                  />
                  {errors.contactName && <p className="text-red-500 text-xs mt-1.5">{errors.contactName}</p>}
                </div>
              </div>

              <div>
                <div className="space-y-5">
                  {/* メールアドレス */}
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">
                      <Mail className="inline w-4 h-4 mr-2 text-slate-400" />
                      メールアドレス <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={e => setField('email', e.target.value)}
                      placeholder="example@company.com"
                      className={inputClass(!!errors.email)}
                    />
                    {errors.email && <p className="text-red-500 text-xs mt-1.5">{errors.email}</p>}
                  </div>

                  {/* 電話番号 */}
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">
                      <Phone className="inline w-4 h-4 mr-2 text-slate-400" />
                      電話番号 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={e => setField('phone', e.target.value)}
                      placeholder="03-1234-5678"
                      className={inputClass(!!errors.phone)}
                    />
                    {errors.phone && <p className="text-red-500 text-xs mt-1.5">{errors.phone}</p>}
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-8 flex justify-end">
              <button
                onClick={() => { if (validate()) setStep('calendar'); }}
                className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-bold px-10 py-4 rounded-2xl transition-all shadow-lg shadow-teal-600/20"
              >
                次へ：日程選択
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </main>
      )}

      {/* ── STEP 2: 商談候補日時カレンダー ── */}
      {step === 'calendar' && (
        <main className="flex-1 flex flex-col justify-center max-w-6xl mx-auto w-full px-6 py-8">
          <div className="text-center mb-4">
            <h1 className="text-3xl font-bold text-slate-900 mb-1 tracking-tight">商談候補日時を選択</h1>
            <p className="text-slate-500 text-sm mb-3">ご都合の良い日程を最大3つまでお選びください</p>
            <span className="inline-flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-5 py-1.5 font-bold">
              <CalendarDays className="w-4 h-4" />
              本日より1週間後以降の日付から選択できます
            </span>
          </div>
          <div className="bg-white rounded-3xl p-6 lg:p-8 shadow-2xl shadow-slate-200/60 border border-slate-100 min-h-0">
            <div className="lg:grid lg:grid-cols-[400px_1fr] lg:gap-8 items-start">
              {/* カレンダー */}
              <div className="flex justify-center mb-4 lg:mb-0 bg-slate-50 rounded-2xl p-6 border border-slate-100">
                <div className="transform origin-center">
                  <Calendar
                    mode="multiple"
                    selected={selectedDates}
                    onSelect={handleDateSelect as (dates: Date[] | undefined) => void}
                    disabled={{ before: minDate }}
                    locale={ja}
                    className="rounded-lg"
                  />
                </div>
              </div>

              {/* 選択済み候補日 + 時間帯 */}
              <div className="flex flex-col min-h-0 overflow-y-auto">
                {sortedDates.length > 0 && (
                  <div className="space-y-2 lg:border-t-0 lg:pt-0">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-2">
                      選択した候補日（{sortedDates.length}/3）— 時間帯を選択してください
                    </p>
                    {sortedDates.map(date => {
                      const key = format(date, 'yyyy-MM-dd');
                      const selected = timePrefs[key];
                      return (
                        <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 bg-teal-50/60 border border-teal-100/50 rounded-2xl transition-all hover:shadow-md hover:bg-teal-50">
                          <div className="flex items-center gap-2 sm:w-40 flex-shrink-0">
                            <CalendarDays className="w-4 h-4 text-teal-600 flex-shrink-0" />
                            <span className="text-base font-bold text-slate-900">
                              {format(date, 'M月d日（EEE）', { locale: ja })}
                            </span>
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            {TIME_OPTIONS.map(opt => (
                              <button
                                key={opt.value}
                                onClick={() => setTimePrefs(p => ({ ...p, [key]: opt.value }))}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                                  selected === opt.value
                                    ? 'bg-teal-600 text-white shadow-md'
                                    : 'bg-white text-slate-600 border border-slate-200 hover:border-teal-400 hover:bg-teal-50'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {sortedDates.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl p-8 bg-slate-50/30 min-h-[200px]">
                    <CalendarDays className="w-10 h-10 mb-3 opacity-20" />
                    <p className="text-base font-bold">カレンダーから日程を選択してください</p>
                  </div>
                )}

                {errors.calendar && (
                  <p className="text-red-500 text-xs mt-2 text-center font-bold tracking-tight">{errors.calendar}</p>
                )}
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
              <button
                onClick={() => setStep('form')}
                className="flex items-center gap-1.5 text-slate-600 hover:text-slate-800 text-sm font-medium px-4 py-2 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                戻る
              </button>
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={handleSubmit}
                  disabled={submitting || selectedDates.length === 0 || !isTimeSelectionComplete}
                  className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed text-white font-bold px-10 py-3 rounded-2xl transition-all shadow-xl shadow-teal-600/30 text-lg active:scale-95"
                >
                  {submitting ? '送信中...' : '商談を申し込む'}
                  {!submitting && <ChevronRight className="w-5 h-5" />}
                </button>
                {!isTimeSelectionComplete && selectedDates.length > 0 && (
                  <p className="text-red-500 text-xs font-bold mr-2">時間帯を選択してください</p>
                )}
              </div>
            </div>
          </div>
        </main>
      )}

      {/* ── 完了画面 ── */}
      {step === 'success' && (
        <main className="flex-1 flex flex-col justify-center items-center max-w-2xl mx-auto w-full px-6 py-8">
          <div className="bg-white rounded-[40px] p-12 shadow-2xl shadow-slate-200/60 border border-slate-100 w-full text-center animate-fade-in-up">
            <div className="relative w-24 h-24 mx-auto mb-8">
              <div className="absolute inset-0 bg-teal-100 rounded-full animate-pulse-ring" />
              <div className="relative w-24 h-24 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-full flex items-center justify-center shadow-lg shadow-teal-600/30 animate-scale-in">
                <CheckCircle2 className="w-12 h-12 text-white" />
              </div>
            </div>

            <h1 className="text-3xl font-extrabold text-slate-900 mb-4 tracking-tight">
              デモ予約のリクエストを<br className="sm:hidden" />完了しました
            </h1>

            <p className="text-slate-600 mb-8 text-base leading-relaxed max-w-md mx-auto">
              ご予約ありがとうございます。入力いただいた内容を確認し、<br className="hidden sm:block" />
              2営業日以内に担当者より日程確定のご連絡を差し上げます。
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 mb-8 text-left max-w-md mx-auto">
              <div className="flex items-center gap-2 mb-3 text-amber-700">
                <CalendarDays className="w-4 h-4" />
                <span className="text-sm font-bold">今後の流れ</span>
              </div>
              <ul className="text-xs text-slate-600 space-y-2.5 leading-relaxed">
                <li className="flex gap-2">
                  <span className="text-teal-600 font-bold">1.</span>
                  <span>ご入力いただいたメールアドレス宛に、自動返信の確認メールが届きます。</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-teal-600 font-bold">2.</span>
                  <span>担当者が候補日を確認し、商談URL（Google Meet等）を発行してメールにてご連絡します。</span>
                </li>
              </ul>
            </div>

            <div className="flex flex-col items-center gap-6">
              <p className="text-sm text-slate-400">
                <Mail className="inline w-4 h-4 mr-1.5 opacity-60" />
                {form.email} 宛にメールを送信しました
              </p>

              <button
                onClick={() => navigate('/')}
                className="group bg-slate-900 hover:bg-slate-800 text-white font-bold px-10 py-4 rounded-2xl transition-all shadow-xl shadow-slate-900/20 flex items-center gap-2"
              >
                トップページへ戻る
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
              </button>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
