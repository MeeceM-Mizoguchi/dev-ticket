/**
 * ============================================================
 * ニュース記事用・画面モックアップ集
 * ============================================================
 * 実際の機能ソースをトレースして再現した「画面イメージ」。
 * 記事本文（articles/*.tsx）から <ScreenFigure> で差し込む。
 *
 * ・レポート管理  … src/app/pages/ReportsPage.tsx
 * ・生体認証ログイン … src/app/pages/LoginPage.tsx
 * ・ホワイトボード … src/app/pages/WhiteboardPage.tsx ほか whiteboard/*
 *
 * 配色・ラベル・アイコンは実画面に合わせている（emerald/teal 系アクセント）。
 * div / span / svg のみで構成し、記事本文の共通タイポグラフィ(PROSE)の
 * 影響を受けないようにしている。
 * ============================================================
 */
import type { ReactNode } from 'react';
import {
  FileBarChart2, CheckCircle2, Clock, TrendingUp, AlertTriangle,
  Ticket, ArrowRight, Fingerprint,
  Search, Plus, PenTool, StickyNote, Frame, Pencil, Trash2, Maximize, HelpCircle, Download,
} from 'lucide-react';

/** ブラウザ／アプリのウィンドウ枠。中身を実画面らしく見せる共通シェル。 */
function ScreenFrame({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 overflow-hidden">
      {/* ウィンドウ chrome */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-slate-100 bg-slate-50">
        <span className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
        </span>
        {label && <span className="ml-2 text-[11px] font-medium text-slate-400">{label}</span>}
      </div>
      {children}
    </div>
  );
}

/** 記事内に画面イメージを差し込む共通図版。キャプション付き。 */
export function ScreenFigure({
  label, caption, children,
}: { label?: string; caption?: string; children: ReactNode }) {
  return (
    <figure className="my-8 sm:my-10">
      <ScreenFrame label={label}>{children}</ScreenFrame>
      {caption && (
        <figcaption className="mt-3 text-center text-[13px] text-slate-400">{caption}</figcaption>
      )}
    </figure>
  );
}

/* ============================================================
 * ① レポート管理（ReportsPage.tsx をトレース）
 * ========================================================== */
export function ReportScreen() {
  const kpis = [
    { Icon: CheckCircle2, color: 'text-emerald-600', label: '完了', value: '24', unit: '件' },
    { Icon: Clock, color: 'text-amber-600', label: '進行中', value: '8', unit: '件' },
    { Icon: TrendingUp, color: 'text-sky-600', label: '完了率', value: '75', unit: '%' },
    { Icon: AlertTriangle, color: 'text-red-500', label: '遅延', value: '2', unit: '件' },
  ];
  const bars = [
    { label: '未着手', w: 'w-[38%]', color: 'bg-slate-300' },
    { label: '進行中', w: 'w-[62%]', color: 'bg-amber-400' },
    { label: 'レビュー', w: 'w-[28%]', color: 'bg-sky-400' },
    { label: '完了', w: 'w-[86%]', color: 'bg-emerald-500' },
  ];
  return (
    <div className="p-4 sm:p-5 space-y-4 text-left bg-white">
      {/* ヘッダー */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-[10px] bg-emerald-600 flex items-center justify-center shrink-0">
          <FileBarChart2 className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-slate-900 leading-tight">レポート管理</div>
          <div className="text-[10px] text-slate-400 truncate">進捗・予定・チーム生産性を週次／月次でまとめて出力します</div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />順調
        </span>
      </div>

      {/* 期間フィルタ */}
      <div className="flex items-center gap-3">
        <div className="inline-flex gap-0.5 p-0.5 bg-slate-100 rounded-lg">
          <span className="px-3 py-1 rounded-md text-[11px] font-semibold bg-white text-emerald-600 shadow-sm">週次</span>
          <span className="px-3 py-1 rounded-md text-[11px] font-semibold text-slate-400">月次</span>
          <span className="px-3 py-1 rounded-md text-[11px] font-semibold text-slate-400">任意</span>
        </div>
        <span className="ml-auto text-[10px] text-slate-400 border border-slate-200 rounded-md px-2.5 py-1">組織全体 ▾</span>
      </div>

      {/* KPI カード */}
      <div className="grid grid-cols-4 gap-2">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-[11px] border border-slate-100 bg-slate-50 px-2.5 py-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <k.Icon className={`w-3 h-3 ${k.color}`} />
              <span className="text-[10px] font-semibold text-slate-500">{k.label}</span>
            </div>
            <div className="flex items-baseline gap-0.5">
              <span className="text-lg font-extrabold text-slate-900 tracking-tight leading-none">{k.value}</span>
              <span className="text-[10px] font-semibold text-slate-400">{k.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* グラフ2種 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* ステータス内訳（横棒） */}
        <div className="rounded-lg border border-slate-100 p-3">
          <div className="text-[10px] font-bold text-slate-500 mb-2.5">ステータス内訳</div>
          <div className="space-y-2">
            {bars.map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="w-10 text-[9px] text-slate-400 shrink-0">{b.label}</span>
                <span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <span className={`block h-full rounded-full ${b.color} ${b.w}`} />
                </span>
              </div>
            ))}
          </div>
        </div>
        {/* スループット推移（面グラフ） */}
        <div className="rounded-lg border border-slate-100 p-3">
          <div className="text-[10px] font-bold text-slate-500 mb-2.5">スループット推移（直近8週）</div>
          <svg viewBox="0 0 200 74" className="w-full h-[64px]" preserveAspectRatio="none">
            <defs>
              <linearGradient id="rep-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0,52 L28,44 L56,48 L84,32 L112,36 L140,20 L168,24 L200,12 L200,74 L0,74 Z" fill="url(#rep-area)" />
            <path d="M0,52 L28,44 L56,48 L84,32 L112,36 L140,20 L168,24 L200,12" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ② 生体認証ログイン（LoginPage.tsx をトレース）
 * ========================================================== */
export function BiometricLoginScreen() {
  return (
    <div className="flex text-left min-h-[300px]">
      {/* 左パネル（teal-700） */}
      <div
        className="hidden sm:flex w-[42%] bg-teal-700 flex-col justify-between p-6 relative overflow-hidden"
        style={{ backgroundImage: 'radial-gradient(circle at 70% 30%, rgba(255,255,255,0.08) 0%, transparent 60%), radial-gradient(circle at 20% 80%, rgba(0,0,0,0.12) 0%, transparent 50%)' }}
      >
        <div>
          <div className="flex items-center gap-2 mb-8">
            <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center">
              <Ticket className="w-4 h-4 text-teal-700" />
            </div>
            <span className="text-white font-bold text-sm">Dev Ticket</span>
          </div>
          <div className="text-white text-xl font-bold leading-snug tracking-tight">プロジェクトを、<br />スマートに。</div>
          <div className="text-teal-100 text-[11px] mt-3 leading-relaxed">チケット・スプリント・メンバー管理を、ひとつに。</div>
        </div>
        <div className="flex gap-6">
          {[['4', '案件'], ['5', 'メンバー'], ['87', '% 完了']].map(([n, l]) => (
            <div key={l}>
              <div className="text-white text-base font-bold leading-none">{n}</div>
              <div className="text-teal-200/80 text-[9px] mt-1">{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 右フォーム */}
      <div className="flex-1 bg-[#F5F6F8] flex items-center justify-center p-5">
        <div className="w-full max-w-[240px] space-y-3">
          <div>
            <div className="text-slate-900 font-bold text-base leading-tight">ログイン</div>
            <div className="text-slate-400 text-[11px] mt-0.5">アカウントにアクセスしてください</div>
          </div>
          {/* メール */}
          <div>
            <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-1">メールアドレス</div>
            <div className="bg-[#F7F8F9] border border-slate-200/70 rounded-xl px-3 py-2 text-[11px] text-slate-400">you@company.com</div>
          </div>
          {/* パスワード */}
          <div>
            <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-1">パスワード</div>
            <div className="bg-[#F7F8F9] border border-slate-200/70 rounded-xl px-3 py-2 text-[11px] text-slate-400 tracking-widest">••••••••</div>
          </div>
          {/* ログインボタン */}
          <div className="w-full bg-emerald-600 text-white font-semibold py-2 rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm shadow-emerald-200">
            ログイン <ArrowRight className="w-3 h-3" />
          </div>
          {/* 区切り */}
          <div className="flex items-center gap-2">
            <span className="flex-1 h-px bg-slate-200" />
            <span className="text-[9px] text-slate-400">または</span>
            <span className="flex-1 h-px bg-slate-200" />
          </div>
          {/* 生体認証ボタン */}
          <div className="w-full bg-white border border-emerald-200 text-emerald-700 font-semibold py-2 rounded-xl text-[11px] flex items-center justify-center gap-1.5">
            <Fingerprint className="w-3.5 h-3.5" />生体認証でログイン
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ③ ホワイトボード（WhiteboardPage / whiteboard/* をトレース）
 * ========================================================== */
const NOTE_COLORS = ['#FFE066', '#FFC9C9', '#B2F2BB', '#A5D8FF', '#FFD8A8'];

export function WhiteboardScreen() {
  const boards = [
    { title: '設計ミーティング', active: true },
    { title: '機能ブレスト', active: false },
    { title: 'リリース計画', active: false },
  ];
  return (
    <div className="flex text-left h-[300px] bg-white">
      {/* ボード一覧サイドバー */}
      <div className="w-[128px] border-r border-slate-100 p-2 flex flex-col gap-1.5 bg-white shrink-0">
        <div className="flex items-center gap-1.5 bg-slate-100 rounded-md px-2 py-1.5">
          <Search className="w-2.5 h-2.5 text-slate-400" />
          <span className="text-[9px] text-slate-400">検索...</span>
        </div>
        <div className="flex items-center justify-center gap-1 bg-emerald-600 text-white rounded-md py-1.5 text-[9px] font-semibold">
          <Plus className="w-2.5 h-2.5" />新規ボード
        </div>
        <div className="mt-0.5 space-y-0.5">
          {boards.map((b) => (
            <div
              key={b.title}
              className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md ${b.active ? 'bg-emerald-50 border border-emerald-200/60' : 'border border-transparent'}`}
            >
              <PenTool className={`w-2.5 h-2.5 shrink-0 ${b.active ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span className={`flex-1 text-[10px] truncate ${b.active ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>{b.title}</span>
              {b.active && (
                <span className="flex gap-0.5 text-slate-300">
                  <Pencil className="w-2.5 h-2.5" />
                  <Trash2 className="w-2.5 h-2.5" />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* キャンバス */}
      <div className="flex-1 relative overflow-hidden bg-white bg-[radial-gradient(#e5e9ef_1px,transparent_1px)] [background-size:15px_15px]">
        {/* 右上ツール */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10">
          <span className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-slate-200 shadow-sm"><HelpCircle className="w-3 h-3 text-slate-400" /></span>
          <span className="flex items-center gap-1 rounded-md bg-white border border-emerald-200 shadow-sm px-2 h-6 text-[9px] font-semibold text-emerald-700"><Download className="w-3 h-3" />エクスポート</span>
          <span className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-slate-200 shadow-sm"><Maximize className="w-3 h-3 text-slate-400" /></span>
        </div>

        {/* 参加者アバター */}
        <div className="absolute top-2.5 left-3 flex -space-x-1.5 z-10">
          <span className="w-5 h-5 rounded-full border-2 border-white text-[8px] font-bold text-white flex items-center justify-center" style={{ background: 'hsl(160,70%,45%)' }}>M</span>
          <span className="w-5 h-5 rounded-full border-2 border-white text-[8px] font-bold text-white flex items-center justify-center" style={{ background: 'hsl(280,70%,45%)' }}>K</span>
          <span className="w-5 h-5 rounded-full border-2 border-white text-[8px] font-bold text-white flex items-center justify-center" style={{ background: 'hsl(30,70%,45%)' }}>Y</span>
        </div>

        {/* 付箋 */}
        <div className="absolute left-4 top-12 w-[70px] h-[70px] rounded-sm shadow-sm -rotate-3 p-1.5 text-[7px] leading-tight text-stone-700" style={{ background: NOTE_COLORS[0] }}>
          アイデア<br />出し
        </div>
        <div className="absolute left-[92px] top-16 w-[70px] h-[70px] rounded-sm shadow-sm rotate-2 p-1.5 text-[7px] leading-tight text-stone-700" style={{ background: NOTE_COLORS[3] }}>
          UI改善案
        </div>

        {/* フロー図：四角 → 矢印 → ひし形 */}
        <div className="absolute right-6 top-14 flex items-center gap-0">
          <span className="w-[68px] h-9 rounded border-[1.5px] border-slate-500 bg-white flex items-center justify-center text-[8px] text-slate-600">要件定義</span>
          <svg width="26" height="12" className="text-slate-400"><line x1="0" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="1.5" /><path d="M20,2 L26,6 L20,10 Z" fill="currentColor" /></svg>
          <span className="relative w-11 h-11 shrink-0">
            <span className="absolute inset-0 border-[1.5px] border-slate-500 bg-white rotate-45" />
            <span className="absolute inset-0 flex items-center justify-center text-[7px] text-slate-600">レビュー</span>
          </span>
        </div>
        {/* 自動接続 + ボタン */}
        <div className="absolute right-[86px] top-[104px] w-5 h-5 rounded-full bg-emerald-600 border-2 border-white shadow flex items-center justify-center text-white text-[11px] leading-none">＋</div>

        {/* 他ユーザーのカーソル + チャットバブル */}
        <div className="absolute left-[150px] top-[150px]">
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ color: 'hsl(280,70%,45%)' }}><path d="M1,1 L1,12 L4,9 L6,14 L8,13 L6,8 L11,8 Z" fill="currentColor" stroke="#fff" strokeWidth="1" /></svg>
          <span className="inline-block mt-1 ml-3 px-2.5 py-1 rounded-full text-[9px] text-white shadow" style={{ background: 'hsl(280,70%,45%)' }}>いいですね！</span>
        </div>

        {/* 下部中央ツールバー */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white rounded-[10px] border border-slate-200 shadow-lg px-2.5 py-1.5">
          <span className="flex items-center gap-1 text-[9px] font-semibold px-1.5 py-1 rounded border border-amber-300/40 whitespace-nowrap" style={{ color: '#92700A', background: '#FFF9E6' }}>
            <StickyNote className="w-3 h-3 shrink-0" />付箋
          </span>
          <span className="flex gap-1">
            {NOTE_COLORS.map((c) => (
              <span key={c} className="w-3.5 h-3.5 rounded-[3px] border border-black/10 shrink-0" style={{ background: c }} />
            ))}
          </span>
          <span className="w-px h-4 bg-slate-200 shrink-0" />
          <span className="flex items-center gap-1 text-[9px] font-semibold text-slate-600 px-1.5 py-1 whitespace-nowrap">
            <Frame className="w-3 h-3 shrink-0" />フレーム
          </span>
        </div>
      </div>
    </div>
  );
}
