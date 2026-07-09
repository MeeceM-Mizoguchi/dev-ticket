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
  Mic, MicOff, PhoneOff, ScreenShare, Minus, MousePointer2, Type, ExternalLink,
  Phone, Check, Users, X, Bug, Bell,
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

/* ============================================================
 * ④ オンライン音声通話（CallWidget.tsx をトレース）
 *    右下に常駐するフローティング通話ウィジェットを、作業画面の上に重ねて表現。
 * ========================================================== */
export function VoiceCallScreen() {
  const parts = [
    { name: '佐藤 健太', tag: '（あなた）', initial: 'S', hue: 160, status: '接続済み', speaking: false, muted: false },
    { name: '川口 さくら', tag: '', initial: 'K', hue: 280, status: '発話中', speaking: true, muted: false },
    { name: '山本 拓也', tag: '', initial: 'Y', hue: 30, status: '接続済み', speaking: false, muted: true },
  ];
  return (
    <div className="relative h-[320px] bg-[#F5F6F8] overflow-hidden text-left">
      {/* 背後の作業画面（薄いスケルトン） */}
      <div className="absolute inset-0 flex opacity-70">
        <div className="w-[116px] border-r border-slate-200/70 bg-white/70 p-3 space-y-2.5">
          <div className="h-5 w-full rounded-md bg-emerald-100" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-2.5 rounded bg-slate-200" style={{ width: `${80 - i * 8}%` }} />
          ))}
        </div>
        <div className="flex-1 p-4 space-y-3">
          <div className="h-3.5 w-40 rounded bg-slate-300" />
          <div className="grid grid-cols-3 gap-2.5">
            {[...Array(3)].map((_, i) => <div key={i} className="h-14 rounded-lg bg-white border border-slate-200/70" />)}
          </div>
          {[...Array(4)].map((_, i) => <div key={i} className="h-2.5 rounded bg-slate-200" style={{ width: `${90 - i * 12}%` }} />)}
        </div>
      </div>

      {/* 通話ウィジェット（右下に常駐） */}
      <div className="absolute right-4 bottom-4 w-[250px] rounded-2xl bg-white border border-black/5 shadow-2xl shadow-slate-900/25 overflow-hidden">
        {/* ヘッダー */}
        <div className="px-4 pt-3 pb-2.5 border-b border-emerald-600/10 flex items-start gap-2" style={{ background: 'linear-gradient(145deg,#ECFDF5,#F0FDF8)' }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-extrabold text-emerald-700">通話中</span>
              <span className="text-xs font-bold text-emerald-600 tabular-nums">0:04:12</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 truncate">ECサイト リニューアル</div>
          </div>
          <span className="w-6 h-6 rounded-lg bg-emerald-600/10 text-emerald-700 flex items-center justify-center shrink-0">
            <Minus className="w-3.5 h-3.5" />
          </span>
        </div>

        {/* 参加者リスト */}
        <div className="px-3 py-1.5">
          {parts.map((p) => (
            <div key={p.name} className="flex items-center gap-2.5 py-1.5">
              <div className="relative shrink-0">
                <div className="rounded-full p-0.5" style={{ background: p.speaking ? '#059669' : 'transparent' }}>
                  <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: `hsl(${p.hue},60%,45%)` }}>{p.initial}</span>
                </div>
                {p.muted && (
                  <span className="absolute -right-0.5 -bottom-0.5 w-4 h-4 rounded-full bg-red-500 border-2 border-white flex items-center justify-center">
                    <MicOff className="w-2 h-2 text-white" />
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-slate-800 truncate">
                  {p.name}{p.tag && <span className="text-slate-400 font-medium">{p.tag}</span>}
                </div>
                <div className="text-[10.5px] text-emerald-600">{p.status}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 操作ボタン */}
        <div className="flex gap-2.5 px-3.5 pb-3.5 pt-1">
          <span className="flex-1 h-[38px] rounded-xl bg-slate-100 text-slate-700 font-bold text-[12px] flex items-center justify-center gap-1.5">
            <Mic className="w-4 h-4" />ミュート
          </span>
          <span className="w-[46px] h-[38px] rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
            <ScreenShare className="w-4 h-4" />
          </span>
          <span className="w-[46px] h-[38px] rounded-xl bg-red-600 text-white flex items-center justify-center">
            <PhoneOff className="w-4 h-4" />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ④-a 発信の入口（Topbar.tsx / CallButton.tsx をトレース）
 *    画面右上ヘッダーの通話ボタン位置を、目印付きで示す。
 * ========================================================== */
export function CallEntryScreen() {
  return (
    <div className="h-[300px] bg-[#F5F6F8] overflow-hidden text-left">
      {/* ヘッダー（Topbar） */}
      <div className="relative h-[52px] bg-white border-b border-[rgba(20,26,22,0.08)] flex items-center px-4 gap-2.5">
        {/* 左: グローバル検索 */}
        <div className="flex items-center gap-2 w-[220px] h-8 rounded-lg bg-slate-100 px-2.5">
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-[11.5px] text-slate-400">プロジェクトやチケットを検索…</span>
        </div>

        {/* 右: アクションアイコン群 */}
        <div className="ml-auto flex items-center gap-1">
          {/* 通話ボタン（強調） */}
          <div className="relative">
            <span className="absolute -inset-1 rounded-xl border-2 border-emerald-500 animate-none" />
            <span className="absolute -inset-[7px] rounded-xl border-2 border-emerald-400/40" />
            <span className="relative flex items-center justify-center w-[34px] h-[34px] rounded-[9px] bg-emerald-50">
              <Phone className="w-[15px] h-[15px] text-emerald-600" />
            </span>
            {/* 吹き出し（下向き） */}
            <div className="absolute top-[46px] left-1/2 -translate-x-1/2 whitespace-nowrap z-10">
              <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-emerald-600" />
              <span className="relative block px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-bold shadow-lg">
                通話ボタン
              </span>
            </div>
          </div>
          {/* バグ報告 */}
          <span className="flex items-center justify-center w-[34px] h-[34px] rounded-[9px]"><Bug className="w-[15px] h-[15px] text-slate-400" /></span>
          {/* 通知ベル */}
          <span className="relative flex items-center justify-center w-[34px] h-[34px] rounded-[9px]">
            <Bell className="w-[15px] h-[15px] text-slate-400" />
            <span className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-emerald-600 border-[1.5px] border-white text-[8px] font-bold text-white flex items-center justify-center">2</span>
          </span>
          {/* 区切り */}
          <span className="w-px h-[18px] bg-black/[0.08] mx-1" />
          {/* ユーザー */}
          <span className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-slate-100">
            <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ background: 'hsl(160,60%,45%)' }}>S</span>
            <span className="text-[11.5px] font-semibold text-slate-600">佐藤 健太</span>
          </span>
        </div>
      </div>

      {/* 背後の作業画面（薄いスケルトン） */}
      <div className="flex opacity-60" style={{ height: 'calc(100% - 52px)' }}>
        <div className="w-[128px] border-r border-slate-200/70 bg-white/70 p-3 space-y-2.5">
          <div className="h-5 w-full rounded-md bg-emerald-100" />
          {[...Array(6)].map((_, i) => <div key={i} className="h-2.5 rounded bg-slate-200" style={{ width: `${82 - i * 7}%` }} />)}
        </div>
        <div className="flex-1 p-5 space-y-3">
          <div className="h-4 w-48 rounded bg-slate-300" />
          <div className="grid grid-cols-4 gap-2.5">
            {[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-white border border-slate-200/70" />)}
          </div>
          {[...Array(4)].map((_, i) => <div key={i} className="h-2.5 rounded bg-slate-200" style={{ width: `${92 - i * 10}%` }} />)}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ④-b 発信ダイアログ（StartCallDialog.tsx をトレース）
 *    Topbar の通話ボタンから開き、プロジェクトとメンバーを選んで発信する。
 * ========================================================== */
export function StartCallScreen() {
  const members = [
    { name: '川口 さくら', initial: 'K', hue: 280, online: true, selected: true },
    { name: '山本 拓也', initial: 'Y', hue: 30, online: true, selected: true },
    { name: '田中 みなみ', initial: 'T', hue: 210, online: false, selected: false },
  ];
  return (
    <div className="h-[320px] bg-[#EEF0F1] flex items-center justify-center p-4 text-left">
      {/* ダイアログ本体 */}
      <div className="w-[360px] max-h-full bg-white rounded-2xl shadow-2xl shadow-slate-900/25 border border-black/5 overflow-hidden flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/[0.06]">
          <div className="flex items-center gap-2.5">
            <span className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center" style={{ background: 'linear-gradient(145deg,#34D399,#059669)' }}>
              <Phone className="w-3.5 h-3.5 text-white" />
            </span>
            <span className="text-[14px] font-extrabold text-slate-900">音声通話を発信</span>
          </div>
          <X className="w-4 h-4 text-slate-400" />
        </div>

        {/* プロジェクト選択 */}
        <div className="px-4 pt-3">
          <div className="text-[11px] font-bold text-slate-500 mb-1.5">プロジェクト</div>
          <div className="h-9 rounded-[10px] border border-black/[0.14] px-3 flex items-center justify-between text-[12.5px] text-slate-800">
            ECサイト リニューアル <span className="text-slate-400">▾</span>
          </div>
        </div>

        {/* メンバー選択 */}
        <div className="px-4 pt-3 flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5"><Users className="w-3 h-3" />メンバー（複数選択可・最大4人）</span>
          <span className="text-[11px] font-bold text-emerald-600">2人選択中</span>
        </div>
        <div className="px-4 pt-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300" />
            <div className="h-9 rounded-[9px] border border-black/[0.12] pl-8 pr-3 flex items-center text-[12px] text-slate-400">名前で絞り込み</div>
          </div>
        </div>

        {/* メンバー一覧 */}
        <div className="px-2.5 py-1.5">
          {members.map((m) => (
            <div key={m.name} className={`flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] ${m.selected ? 'bg-emerald-50/70' : ''}`}>
              <div className="relative shrink-0">
                <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: `hsl(${m.hue},60%,45%)` }}>{m.initial}</span>
                <span className="absolute -right-0.5 -bottom-0.5 w-[11px] h-[11px] rounded-full border-2 border-white" style={{ background: m.online ? '#22C55E' : '#C9C4BB' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-slate-800">{m.name}</div>
                <div className="text-[10.5px]" style={{ color: m.online ? '#059669' : '#B0A9A4' }}>{m.online ? 'オンライン' : 'オフライン'}</div>
              </div>
              <span className={`w-5 h-5 rounded-md flex items-center justify-center ${m.selected ? 'bg-emerald-600' : 'border-[1.5px] border-black/[0.18]'}`}>
                {m.selected && <Check className="w-3 h-3 text-white" />}
              </span>
            </div>
          ))}
        </div>

        {/* 発信ボタン */}
        <div className="px-4 py-3 border-t border-black/[0.06]">
          <div className="h-11 rounded-[13px] text-white font-extrabold text-[14px] flex items-center justify-center gap-2" style={{ background: 'linear-gradient(145deg,#34D399,#059669)' }}>
            <Phone className="w-4 h-4" />発信（2人）
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ④-c 着信モーダル（IncomingCallModal.tsx をトレース）
 *    呼び出された側に表示。応答／拒否を選ぶ。
 * ========================================================== */
export function IncomingCallScreen() {
  return (
    <div className="h-[300px] bg-[#20261680] flex items-center justify-center p-4 text-left" style={{ background: 'rgba(20,26,22,0.45)' }}>
      <div className="w-[320px] bg-white rounded-[20px] px-6 pt-7 pb-5 shadow-2xl shadow-slate-900/30 text-center">
        {/* 呼び出しアイコン（パルスリング） */}
        <div className="mx-auto mb-4 relative w-[76px] h-[76px]">
          <span className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(145deg,#34D399,#059669)' }} />
          <span className="absolute -inset-2 rounded-full border-2 border-emerald-500/25" />
          <span className="absolute inset-0 flex items-center justify-center"><Phone className="w-7 h-7 text-white" /></span>
        </div>
        <div className="text-[12px] font-bold text-emerald-600 mb-1">音声通話の着信</div>
        <div className="text-[20px] font-extrabold text-slate-900">川口 さくら</div>
        <div className="text-[12px] text-slate-400 mt-1 flex items-center justify-center gap-1.5">
          <span>ECサイト リニューアル</span><span>・</span><span>1対1</span>
        </div>
        <div className="flex gap-3 mt-6">
          <span className="flex-1 h-12 rounded-[14px] bg-red-50 text-red-600 font-bold text-[14px] flex items-center justify-center gap-2">
            <PhoneOff className="w-[18px] h-[18px]" />拒否
          </span>
          <span className="flex-1 h-12 rounded-[14px] text-white font-bold text-[14px] flex items-center justify-center gap-2" style={{ background: 'linear-gradient(145deg,#34D399,#059669)' }}>
            <Phone className="w-[18px] h-[18px]" />応答
          </span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ⑤-a 画面共有の入口（CallWidget.tsx の共有ボタンをトレース）
 *    通話中ウィジェットの「画面共有ボタン」位置を、目印付きで示す。
 * ========================================================== */
export function ShareEntryScreen() {
  const parts = [
    { name: '佐藤 健太', tag: '（あなた）', initial: 'S', hue: 160 },
    { name: '川口 さくら', tag: '', initial: 'K', hue: 280 },
  ];
  return (
    <div className="h-[360px] bg-[#F5F6F8] flex items-start justify-center pt-6 p-4 text-left">
      {/* 通話ウィジェット */}
      <div className="w-[250px] rounded-2xl bg-white border border-black/5 shadow-2xl shadow-slate-900/25 overflow-visible">
        {/* ヘッダー */}
        <div className="px-4 pt-3 pb-2.5 rounded-t-2xl border-b border-emerald-600/10 flex items-start gap-2" style={{ background: 'linear-gradient(145deg,#ECFDF5,#F0FDF8)' }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-extrabold text-emerald-700">通話中</span>
              <span className="text-xs font-bold text-emerald-600 tabular-nums">0:04:12</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 truncate">ECサイト リニューアル</div>
          </div>
          <span className="w-6 h-6 rounded-lg bg-emerald-600/10 text-emerald-700 flex items-center justify-center shrink-0"><Minus className="w-3.5 h-3.5" /></span>
        </div>

        {/* 参加者 */}
        <div className="px-3 py-1.5">
          {parts.map((p) => (
            <div key={p.name} className="flex items-center gap-2.5 py-1.5">
              <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: `hsl(${p.hue},60%,45%)` }}>{p.initial}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-slate-800 truncate">{p.name}{p.tag && <span className="text-slate-400 font-medium">{p.tag}</span>}</div>
                <div className="text-[10.5px] text-emerald-600">接続済み</div>
              </div>
            </div>
          ))}
        </div>

        {/* 操作ボタン（画面共有を強調） */}
        <div className="flex gap-2.5 px-3.5 pb-3.5 pt-1">
          <span className="flex-1 h-[38px] rounded-xl bg-slate-100 text-slate-700 font-bold text-[12px] flex items-center justify-center gap-1.5"><Mic className="w-4 h-4" />ミュート</span>
          {/* 画面共有ボタン（目印） */}
          <div className="relative">
            <span className="absolute -inset-1 rounded-[14px] border-2 border-blue-500" />
            <span className="absolute -inset-[7px] rounded-[16px] border-2 border-blue-400/40" />
            <span className="relative w-[46px] h-[38px] rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><ScreenShare className="w-4 h-4" /></span>
            {/* 吹き出し（下向き） */}
            <div className="absolute top-[46px] left-1/2 -translate-x-1/2 whitespace-nowrap z-10">
              <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-blue-600" />
              <span className="relative block px-2.5 py-1 rounded-md bg-blue-600 text-white text-[11px] font-bold shadow-lg">画面共有ボタン</span>
            </div>
          </div>
          <span className="w-[46px] h-[38px] rounded-xl bg-red-600 text-white flex items-center justify-center"><PhoneOff className="w-4 h-4" /></span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ⑤-b 画面共有ステージ（ScreenShareStage.tsx をトレース）
 *    共有映像の上にポインター（共有者）とアノテーション（視聴者）を重ねた暗色ステージ。
 * ========================================================== */
export function ScreenShareScreen() {
  const COLORS = ['#EF4444', '#2563EB', '#059669', '#F59E0B', '#7C3AED', '#111827'];
  return (
    <div className="relative h-[320px] bg-[#0B0F17] text-left overflow-hidden flex flex-col">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2 text-[12.5px] font-bold text-slate-200">
          <ScreenShare className="w-4 h-4 text-blue-400" />川口 さくらさんの画面
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <ExternalLink className="w-4 h-4" />
          <Minus className="w-4 h-4" />
        </div>
      </div>

      {/* 映像領域（レターボックス＋共有画面） */}
      <div className="relative flex-1 bg-black">
        {/* 共有されている画面（ダッシュボードのモック） */}
        <div className="absolute inset-x-7 inset-y-4 rounded-md bg-white overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
          <div className="h-6 bg-slate-100 border-b border-slate-200 flex items-center gap-1.5 px-2.5">
            <span className="w-2 h-2 rounded-full bg-slate-300" />
            <span className="w-2 h-2 rounded-full bg-slate-300" />
            <span className="ml-1 text-[8px] font-semibold text-slate-400">スプリントレポート</span>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[['完了', '24'], ['進行中', '8'], ['完了率', '75%']].map(([l, v]) => (
                <div key={l} className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5">
                  <div className="text-[7px] font-semibold text-slate-400">{l}</div>
                  <div className="text-[13px] font-extrabold text-slate-800 leading-none mt-0.5">{v}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              {[68, 44, 82, 30].map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-8 h-1.5 rounded bg-slate-200" />
                  <span className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <span className="block h-full rounded-full bg-emerald-400" style={{ width: `${w}%` }} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 視聴者の手書き（赤・5秒で消える線） */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
          <polyline points="150,58 168,50 176,66 196,54 206,70" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* 視聴者のテキスト注記 */}
        <div className="absolute left-[214px] top-[92px] px-1.5 py-0.5 rounded bg-white/90 text-[11px] font-bold shadow" style={{ color: '#2563EB' }}>
          ここ確認！
        </div>

        {/* 共有者のポインター（赤丸＋名前ラベル） */}
        <div className="absolute" style={{ left: 120, top: 150 }}>
          <span className="absolute -left-2 -top-2 w-5 h-5 rounded-full border-2 border-red-400/70" />
          <span className="absolute -left-[3px] -top-[3px] w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
          <span className="absolute top-2.5 left-2 px-1.5 py-px rounded text-[10px] font-bold text-white whitespace-nowrap" style={{ background: 'rgba(239,68,68,0.9)' }}>川口 さくら</span>
        </div>
      </div>

      {/* ツールバー（視聴者：ペン・テキスト・カラー） */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-white/[0.06]" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <span className="w-[34px] h-[30px] rounded-[9px] bg-blue-600 text-white flex items-center justify-center"><Pencil className="w-3.5 h-3.5" /></span>
        <span className="w-[34px] h-[30px] rounded-[9px] bg-white/10 text-slate-300 flex items-center justify-center"><Type className="w-3.5 h-3.5" /></span>
        <span className="flex items-center gap-1.5 ml-1">
          {COLORS.map((c, i) => (
            <span key={c} className="w-[18px] h-[18px] rounded-full" style={{ background: c, border: i === 0 ? '2px solid #fff' : '2px solid transparent', boxShadow: i === 0 ? '0 0 0 1px rgba(0,0,0,0.4)' : 'none' }} />
          ))}
        </span>
        <span className="ml-auto text-[10.5px] text-slate-400 flex items-center gap-1.5">
          <MousePointer2 className="w-3 h-3" />描いた線・文字は5秒で消えます
        </span>
      </div>
    </div>
  );
}
