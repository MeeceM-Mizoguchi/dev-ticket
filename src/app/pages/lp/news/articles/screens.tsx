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
 * ・ファイルボックス … src/app/pages/FileBoxPage.tsx / components/files/*
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
  FileText, Lock, Hand, Square, Diamond, Circle, MoveRight, Image as ImageIcon, Maximize2,
  Eye, Table as TableIcon, Sparkles, UserRound, RotateCcw,
  FolderOpen, FileSpreadsheet, FileImage, Upload, Link2, MonitorCog, Save, ShieldCheck,
  Layers, ClipboardList, BookOpen,
  Bold, Italic, Undo2, Redo2, PaintBucket, AlignLeft,
  Folder, ChevronRight, ChevronDown, TextSearch, Brain,
  ListChecks, Kanban, ChartGantt, MoreVertical, CornerDownRight,
  GitBranch, GitPullRequest, GitMerge, Github, GitCommitHorizontal,
  KeyRound, Server, Bot, Workflow, FileInput,
  Filter, ArrowUpDown, CalendarRange, Copy, LockKeyhole,
  ScanSearch, ArrowDownToLine, CircleAlert,
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

/* ============================================================
 * ⑦ Mermaid図（テキストから図を生成）
 *    実機能をトレース:
 *      ・RichEditor.tsx のツールバー「Mermaid」ボタン + btnStyle
 *      ・MermaidEditModal.tsx / MermaidToolButton.tsx（共通の入力モーダル。
 *        左「Mermaid定義」テキスト＋右「プレビュー」／緑の実行ボタン）
 *      ・MermaidNode.tsx（本文はコードを見せず図だけ表示・ホバーで操作ボタン）
 *      ・Excalidraw ツールバー末尾に注入される Mermaid ボタン（実SVGアイコン）
 *    配色は実装のまま（テキスト #1A1714 / 補助 #6B6458 / 緑 #059669 /
 *    枠 rgba(26,23,20,0.12) / 入力欄 #FAFAF8）。図は mermaid 既定テーマ
 *    （ノード塗り #ECECFF・枠 #9370DB・文字 #333）を再現。
 * ========================================================== */

/** MermaidEditModal / MermaidToolButton の初期テンプレートの描画結果を、mermaid 既定テーマで再現した図。 */
function MermaidRenderedFlow({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 262" className={`w-full ${className}`} role="img" aria-label="フローチャート図">
      <defs>
        <marker id="mm-arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill="#333333" />
        </marker>
      </defs>
      {/* エッジ */}
      <g stroke="#333333" strokeWidth="1.4" fill="none" markerEnd="url(#mm-arw)">
        <line x1="150" y1="38" x2="150" y2="49" />
        <line x1="121" y1="90" x2="70" y2="156" />
        <line x1="179" y1="90" x2="230" y2="156" />
        <line x1="66" y1="186" x2="126" y2="226" />
        <line x1="234" y1="186" x2="174" y2="226" />
      </g>
      {/* エッジラベル（白背景の小片） */}
      <g fontSize="10" fill="#333333" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, sans-serif">
        <rect x="80" y="112" width="24" height="14" fill="#ffffff" />
        <text x="92" y="122">はい</text>
        <rect x="192" y="112" width="34" height="14" fill="#ffffff" />
        <text x="209" y="122">いいえ</text>
      </g>
      {/* ノード（mermaid 既定テーマ配色） */}
      <g fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="12" fill="#333333" textAnchor="middle">
        <rect x="120" y="10" width="60" height="28" rx="2" fill="#ECECFF" stroke="#9370DB" strokeWidth="1" />
        <text x="150" y="28">開始</text>

        <polygon points="150,49 187,78 150,107 113,78" fill="#ECECFF" stroke="#9370DB" strokeWidth="1" />
        <text x="150" y="82">条件?</text>

        <rect x="32" y="158" width="68" height="28" rx="2" fill="#ECECFF" stroke="#9370DB" strokeWidth="1" />
        <text x="66" y="176">処理1</text>

        <rect x="200" y="158" width="68" height="28" rx="2" fill="#ECECFF" stroke="#9370DB" strokeWidth="1" />
        <text x="234" y="176">処理2</text>

        <rect x="120" y="226" width="60" height="28" rx="2" fill="#ECECFF" stroke="#9370DB" strokeWidth="1" />
        <text x="150" y="244">完了</text>
      </g>
    </svg>
  );
}

/** RichEditor.tsx の btnStyle を再現したツールバーボタン。 */
function EditorBtn({ children, active = false, style }: { children: ReactNode; active?: boolean; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        padding: '3px 7px', fontSize: 11, fontWeight: 600, borderRadius: 5,
        border: `1px solid ${active ? '#059669' : 'rgba(26,23,20,0.12)'}`,
        background: active ? '#ECFDF5' : 'transparent',
        color: active ? '#059669' : '#6B6458', lineHeight: 1.4, whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** ① RichEditor の書式ツールバー。「Mermaid」ボタンを強調。 */
export function MermaidToolbarScreen() {
  return (
    <div className="bg-white p-4 text-left">
      <div className="flex flex-wrap gap-1 items-center" style={{ padding: '8px 10px', borderBottom: '1px solid rgba(26,23,20,0.08)', background: '#F9F8F6', borderRadius: 8 }}>
        <EditorBtn>B</EditorBtn>
        <EditorBtn style={{ fontStyle: 'italic' }}>I</EditorBtn>
        <EditorBtn>S̶</EditorBtn>
        <span style={{ width: 1, height: 18, background: 'rgba(26,23,20,0.10)', margin: '0 2px' }} />
        <EditorBtn>H1</EditorBtn>
        <EditorBtn>H2</EditorBtn>
        <span style={{ width: 1, height: 18, background: 'rgba(26,23,20,0.10)', margin: '0 2px' }} />
        <EditorBtn>• リスト</EditorBtn>
        <EditorBtn>1. リスト</EditorBtn>
        <span style={{ width: 1, height: 18, background: 'rgba(26,23,20,0.10)', margin: '0 2px' }} />
        <EditorBtn>{'<>'}</EditorBtn>
        <EditorBtn>コード</EditorBtn>
        {/* ここが Mermaid ボタン（押すと入力モーダルが開く） */}
        <span className="relative">
          <EditorBtn active>Mermaid</EditorBtn>
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full w-2 h-2 rotate-45" style={{ background: '#059669' }} />
        </span>
        <EditorBtn>&quot;引用</EditorBtn>
        <span style={{ width: 1, height: 18, background: 'rgba(26,23,20,0.10)', margin: '0 2px' }} />
        <EditorBtn>表</EditorBtn>
      </div>
    </div>
  );
}

/** ②③ 共通の入力モーダル（MermaidEditModal / MermaidToolButton）。左に定義、右にライブプレビュー。 */
export function MermaidModalScreen({
  title = 'Mermaid図を挿入', primaryLabel = '挿入',
}: { title?: string; primaryLabel?: string }) {
  return (
    <div className="text-left" style={{ background: 'rgba(0,0,0,0.06)', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 24px 80px rgba(0,0,0,0.20)', overflow: 'hidden', maxWidth: 620, margin: '0 auto' }}>
        {/* ヘッダー */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#1A1714' }}>{title}</span>
          <span style={{ fontSize: 20, lineHeight: 1, color: '#9A938C' }}>×</span>
        </div>
        {/* 本体：定義 / プレビュー */}
        <div className="flex flex-wrap" style={{ gap: 12, padding: 16 }}>
          {/* 左：定義 */}
          <div style={{ flex: '1 1 240px', minWidth: 220 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6B6458', marginBottom: 6 }}>Mermaid定義</div>
            <div style={{ minHeight: 150, padding: 10, borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', background: '#FAFAF8' }}>
              <pre style={{ margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, lineHeight: 1.6, color: '#1A1714', whiteSpace: 'pre-wrap' }}>{`flowchart TD
  A[開始] --> B{条件?}
  B -->|はい| C[処理1]
  B -->|いいえ| D[処理2]
  C --> E[完了]
  D --> E`}</pre>
            </div>
            <div style={{ fontSize: 11, color: '#B0A9A4', marginTop: 6 }}>
              例: <code>flowchart</code> / <code>sequenceDiagram</code> / <code>classDiagram</code> / <code>gantt</code> など
            </div>
          </div>
          {/* 右：プレビュー */}
          <div style={{ flex: '1 1 240px', minWidth: 220 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6B6458', marginBottom: 6 }}>プレビュー</div>
            <div style={{ minHeight: 150, padding: 12, borderRadius: 8, border: '1px solid rgba(0,0,0,0.10)', background: '#fff' }}>
              <MermaidRenderedFlow className="max-w-[200px] mx-auto" />
            </div>
          </div>
        </div>
        {/* フッター：キャンセル / 実行 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
          <span style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', background: '#fff', color: '#6B6458' }}>キャンセル</span>
          <span style={{ padding: '7px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, background: '#059669', color: '#fff' }}>{primaryLabel}</span>
        </div>
      </div>
    </div>
  );
}

/** ④ 挿入後：本文にはコードではなく図だけが表示され、ホバーで操作ボタンが出る（MermaidNode）。 */
export function MermaidInsertedScreen() {
  const ctrl = (bg: string) => ({ width: 26, height: 26, borderRadius: 6, background: bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties);
  return (
    <div className="bg-white p-4 sm:p-5 text-left" style={{ color: '#1A1714' }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>承認フロー</div>
      <p style={{ fontSize: 12.5, lineHeight: 1.8, color: '#3F3A34', margin: '0 0 10px' }}>
        申請から公開までの流れは次のとおりです。本文にはコードは表示されず、図だけが埋め込まれます。
      </p>
      {/* Mermaidノード（.mermaid-node-inner を再現） */}
      <div style={{ position: 'relative', border: '1px solid rgba(26,23,20,0.12)', borderRadius: 8, padding: 12, background: '#fff', margin: '8px 0' }}>
        <MermaidRenderedFlow className="max-w-[230px] mx-auto" />
        {/* ホバー時の操作ボタン（拡大 / 編集 / 削除） */}
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
          <span style={ctrl('#1A1714')}><Maximize2 style={{ width: 13, height: 13 }} /></span>
          <span style={ctrl('#059669')}><Pencil style={{ width: 13, height: 13 }} /></span>
          <span style={ctrl('#DC2626')}><Trash2 style={{ width: 13, height: 13 }} /></span>
        </div>
      </div>
      <p style={{ fontSize: 11, color: '#B0A9A4', margin: '4px 0 0' }}>図をクリックすると拡大表示できます。</p>
    </div>
  );
}

/** Excalidraw ツールバー末尾に注入される Mermaid ボタンの実アイコン。 */
function MermaidToolIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="16" width="7" height="5" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <path d="M6.5 8v3a2 2 0 0 0 2 2h9" />
      <path d="M17.5 8v5" />
    </svg>
  );
}

/** ⑤ ホワイトボード：上部ツールバー末尾の Mermaid ボタン → 生成された「編集できる図形」。 */
export function MermaidWhiteboardScreen() {
  const tool = (active = false) => ({
    width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: active ? '#fff' : '#1b1b1f', background: active ? '#6965db' : 'transparent',
  } as React.CSSProperties);
  return (
    <div className="relative h-[320px] bg-white bg-[radial-gradient(#e5e9ef_1px,transparent_1px)] [background-size:16px_16px] text-left overflow-hidden">
      {/* Excalidraw 上部ツールバー（末尾に Mermaid ボタンが注入される） */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 bg-white rounded-xl border border-slate-200/80 shadow-lg px-1.5 py-1">
        <span style={tool()}><Lock className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><Hand className="w-[15px] h-[15px]" /></span>
        <span style={tool(true)}><MousePointer2 className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><Square className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><Diamond className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><Circle className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><MoveRight className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><Pencil className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><Type className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><ImageIcon className="w-[15px] h-[15px]" /></span>
        <span className="w-px h-5 bg-slate-200 mx-0.5" />
        {/* 注入された Mermaid ボタン（ここを押すと入力モーダルが開く） */}
        <span className="relative" style={{ ...tool(), color: '#059669', background: 'rgba(5,150,105,0.10)' }}>
          <MermaidToolIcon size={16} />
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full whitespace-nowrap text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#059669', color: '#fff' }}>Mermaid</span>
        </span>
      </div>

      {/* 生成された図（ネイティブ図形として配置＝生成直後は選択状態） */}
      <div className="absolute left-1/2 top-[92px] -translate-x-1/2 w-[240px]">
        {/* 選択バウンディングボックス（Excalidraw 風） */}
        <div className="relative rounded-sm" style={{ outline: '1px solid #6965db', outlineOffset: 8 }}>
          <MermaidRenderedFlow />
          {/* 四隅ハンドル */}
          {[
            { t: -12, l: -12 }, { t: -12, r: -12 }, { b: -12, l: -12 }, { b: -12, r: -12 },
          ].map((p, i) => (
            <span key={i} className="absolute w-2 h-2 rounded-[2px] bg-white" style={{ border: '1px solid #6965db', top: p.t, bottom: p.b, left: p.l, right: p.r }} />
          ))}
        </div>
        <div className="mt-4 text-center text-[10px]" style={{ color: '#6965db', fontWeight: 600 }}>
          画像ではなく、編集できる図形として配置されます
        </div>
      </div>

      {/* 参加者アバター（共同編集にそのまま同期） */}
      <div className="absolute bottom-3 left-3 flex -space-x-1.5 z-10">
        <span className="w-5 h-5 rounded-full border-2 border-white text-[8px] font-bold text-white flex items-center justify-center" style={{ background: 'hsl(160,70%,45%)' }}>M</span>
        <span className="w-5 h-5 rounded-full border-2 border-white text-[8px] font-bold text-white flex items-center justify-center" style={{ background: 'hsl(280,70%,45%)' }}>K</span>
      </div>
    </div>
  );
}

/** ⑥ エクスポート：PDF / Word / Excel でも図として埋め込まれる様子。 */
export function MermaidExportScreen() {
  return (
    <div className="bg-slate-50 p-5 text-left flex flex-col items-center gap-3">
      {/* 出力ファイル（紙面プレビュー） */}
      <div className="w-full max-w-[300px] bg-white rounded-md shadow-lg border border-slate-200 p-4">
        <div className="text-[12px] font-bold text-slate-800 mb-1">承認フロー設計メモ</div>
        <div className="space-y-1 mb-2.5">
          <span className="block h-1.5 rounded bg-slate-200 w-[92%]" />
          <span className="block h-1.5 rounded bg-slate-200 w-[78%]" />
        </div>
        <div className="rounded border border-slate-100 bg-slate-50/60 p-2">
          <MermaidRenderedFlow className="max-w-[180px] mx-auto" />
        </div>
        <div className="mt-2 space-y-1">
          <span className="block h-1.5 rounded bg-slate-200 w-[85%]" />
          <span className="block h-1.5 rounded bg-slate-200 w-[60%]" />
        </div>
      </div>
      {/* 出力形式バッジ */}
      <div className="flex items-center gap-2 text-[11px] font-semibold">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-100"><FileText className="w-3 h-3" />PDF</span>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-50 text-sky-600 border border-sky-100"><FileText className="w-3 h-3" />Word</span>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100"><FileText className="w-3 h-3" />Excel</span>
      </div>
    </div>
  );
}

/* ============================================================
 * ⑧ ホワイトボード追従（ENHA2-031）
 *    実機能をトレース:
 *      ・Excalidraw ネイティブの右上コラボレーターアバター（＝追従の入口）
 *      ・アバターをクリックすると、その人の表示範囲(パン/ズーム)に自分の画面が追従
 *      ・追従中は Excalidraw が相手の色で画面の縁を縁取り＋相手の名前を表示
 *    追従相手の色は紫 hsl(280,70%,45%) で統一（WhiteboardScreen の K と揃える）。
 * ========================================================== */
const FOLLOW_HUE = 280;
const FOLLOW_COLOR = `hsl(${FOLLOW_HUE},70%,45%)`;

export function WhiteboardFollowScreen() {
  return (
    <div className="relative h-[320px] bg-white bg-[radial-gradient(#e5e9ef_1px,transparent_1px)] [background-size:15px_15px] text-left overflow-hidden">
      {/* 追従中の縁取り（相手の色で画面全体を囲う＝Excalidraw ネイティブ） */}
      <div className="absolute inset-0 z-20 pointer-events-none rounded-[2px]" style={{ border: `3px solid ${FOLLOW_COLOR}` }} />

      {/* 上部中央：追従中バナー */}
      <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-3 py-1 rounded-full text-white text-[11px] font-bold shadow-lg" style={{ background: FOLLOW_COLOR }}>
        <Eye className="w-3.5 h-3.5" />川口 さくら を追従中
      </div>

      {/* 右上：コラボレーターアバター（クリックで追従・追従相手を強調） */}
      <div className="absolute top-2.5 right-3 z-30 flex items-center">
        <div className="flex -space-x-1.5">
          {/* 追従中の相手（紫・リング＋目印バッジ） */}
          <span className="relative">
            <span className="w-6 h-6 rounded-full border-2 border-white text-[9px] font-bold text-white flex items-center justify-center ring-2" style={{ background: FOLLOW_COLOR, boxShadow: `0 0 0 2px ${FOLLOW_COLOR}` }}>K</span>
            <span className="absolute -right-1 -bottom-1 w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center shadow" style={{ color: FOLLOW_COLOR }}><Eye className="w-2.5 h-2.5" /></span>
          </span>
          <span className="w-6 h-6 rounded-full border-2 border-white text-[9px] font-bold text-white flex items-center justify-center" style={{ background: 'hsl(30,70%,45%)' }}>Y</span>
        </div>
        {/* 吹き出し（下向き）：クリックで追従 */}
        <div className="absolute top-[34px] right-1 whitespace-nowrap">
          <span className="absolute -top-1.5 right-3 w-3 h-3 rotate-45" style={{ background: FOLLOW_COLOR }} />
          <span className="relative block px-2.5 py-1 rounded-md text-white text-[10px] font-bold shadow-lg" style={{ background: FOLLOW_COLOR }}>アイコンをクリックで追従</span>
        </div>
      </div>

      {/* 相手が見ている内容（付箋・フロー図） */}
      <div className="absolute left-8 top-24 w-[74px] h-[74px] rounded-sm shadow-sm -rotate-2 p-1.5 text-[7px] leading-tight text-stone-700" style={{ background: NOTE_COLORS[3] }}>
        画面設計
      </div>
      <div className="absolute left-[128px] top-[112px] flex items-center gap-0">
        <span className="w-[70px] h-9 rounded border-[1.5px] border-slate-500 bg-white flex items-center justify-center text-[8px] text-slate-600">トップ</span>
        <svg width="26" height="12" className="text-slate-400"><line x1="0" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="1.5" /><path d="M20,2 L26,6 L20,10 Z" fill="currentColor" /></svg>
        <span className="w-[70px] h-9 rounded border-[1.5px] border-slate-500 bg-white flex items-center justify-center text-[8px] text-slate-600">一覧</span>
      </div>

      {/* 追従相手のカーソル（紫・名前ラベル付き） */}
      <div className="absolute left-[196px] top-[168px] z-10">
        <svg width="18" height="18" viewBox="0 0 16 16" style={{ color: FOLLOW_COLOR }}><path d="M1,1 L1,12 L4,9 L6,14 L8,13 L6,8 L11,8 Z" fill="currentColor" stroke="#fff" strokeWidth="1" /></svg>
        <span className="inline-block mt-0.5 ml-3 px-2 py-0.5 rounded text-[9px] font-bold text-white shadow" style={{ background: FOLLOW_COLOR }}>川口 さくら</span>
      </div>

      {/* 下部：説明キャプション */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-white/95 rounded-lg border border-slate-200 shadow text-[10px] text-slate-500">
        <MousePointer2 className="w-3 h-3 text-slate-400" />相手が動かすと、自分の画面も同じ範囲へ自動で移動します
      </div>
    </div>
  );
}

/* ============================================================
 * ⑨ ホワイトボード表機能（BRU5-042）
 *    実機能をトレース:
 *      ・Excalidraw 標準ツールバー末尾に注入される「表」ボタン（TableToolButton）
 *      ・クリックで開く Google ドキュメント風グリッドピッカー（ホバーで 列×行 を選ぶ）
 *      ・生成される表（セル=矩形・先頭行はヘッダーの薄グレー #f1f3f5・線 #343a40）
 *      ・選択中は境界にドラッグつまみ（TableResizeOverlay）で手動リサイズ
 * ========================================================== */

/** ①-a ツールバーの「表」ボタン → グリッドピッカー（4×3 を選択中）。 */
export function WhiteboardTablePickerScreen() {
  const PICK_COLS = 4, PICK_ROWS = 3; // ハイライト中の選択（列×行）
  const GRID = 6;                     // ピッカーに見せる格子サイズ
  const tool = (active = false) => ({
    width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: active ? '#fff' : '#1b1b1f', background: active ? '#6965db' : 'transparent',
  } as React.CSSProperties);
  return (
    <div className="relative h-[320px] bg-white bg-[radial-gradient(#e5e9ef_1px,transparent_1px)] [background-size:16px_16px] text-left overflow-hidden">
      {/* Excalidraw 上部ツールバー（末尾に「表」ボタンが注入される） */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 bg-white rounded-xl border border-slate-200/80 shadow-lg px-1.5 py-1">
        <span style={tool()}><Lock className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><Hand className="w-[15px] h-[15px]" /></span>
        <span style={tool(true)}><MousePointer2 className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><Square className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><Diamond className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><Circle className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><MoveRight className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><Pencil className="w-[15px] h-[15px]" /></span>
        <span style={tool()}><Type className="w-[15px] h-[15px]" /></span>
        <span className="w-px h-5 bg-slate-200 mx-0.5" />
        {/* 注入された「表」ボタン（押すとグリッドピッカーが開く） */}
        <span className="relative" style={{ ...tool(), color: '#059669', background: 'rgba(5,150,105,0.10)' }}>
          <TableIcon className="w-[16px] h-[16px]" />
        </span>
      </div>

      {/* グリッドピッカー（表ボタンの直下に開く） */}
      <div className="absolute top-[58px] left-1/2 translate-x-[70px] z-30 bg-white rounded-xl border border-slate-200 shadow-xl p-3">
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${GRID}, 16px)` }}>
          {Array.from({ length: GRID * GRID }).map((_, i) => {
            const r = Math.floor(i / GRID), c = i % GRID;
            const on = r < PICK_ROWS && c < PICK_COLS;
            return (
              <span
                key={i}
                className="w-4 h-4 rounded-[3px] border"
                style={{ background: on ? '#059669' : '#F1F3F5', borderColor: on ? '#047857' : 'rgba(0,0,0,0.08)' }}
              />
            );
          })}
        </div>
        <div className="mt-2 text-center text-[11px] font-bold text-slate-600">{PICK_COLS} × {PICK_ROWS} の表</div>
      </div>
    </div>
  );
}

/** ①-b 生成された表（選択中・境界のリサイズつまみ付き）。 */
export function WhiteboardTableScreen() {
  const HEADER = ['担当', 'タスク', '状態'];
  const ROWS = [
    ['佐藤', 'ログイン設計', '完了'],
    ['川口', 'API 実装', '進行中'],
    ['山本', 'レビュー', '未着手'],
  ];
  const COL_W = [64, 118, 74];
  const totalW = COL_W.reduce((a, b) => a + b, 0);
  return (
    <div className="relative h-[320px] bg-white bg-[radial-gradient(#e5e9ef_1px,transparent_1px)] [background-size:16px_16px] text-left overflow-hidden flex items-center justify-center">
      <div className="relative">
        {/* 選択バウンディングボックス（Excalidraw 風・紫アウトライン） */}
        <div className="relative" style={{ outline: '1.5px solid #6965db', outlineOffset: 6 }}>
          {/* 表本体（セル＝矩形・先頭行はヘッダー） */}
          <div className="border-l border-t" style={{ borderColor: '#343a40' }}>
            {/* ヘッダー行 */}
            <div className="flex">
              {HEADER.map((h, c) => (
                <div key={c} className="border-r border-b flex items-center px-2 text-[11px] font-bold text-slate-700" style={{ width: COL_W[c], height: 32, borderColor: '#343a40', background: '#f1f3f5' }}>{h}</div>
              ))}
            </div>
            {/* データ行 */}
            {ROWS.map((row, r) => (
              <div key={r} className="flex">
                {row.map((cell, c) => (
                  <div key={c} className="border-r border-b flex items-center px-2 text-[11px] text-slate-600" style={{ width: COL_W[c], height: 32, borderColor: '#343a40', background: '#ffffff' }}>{cell}</div>
                ))}
              </div>
            ))}
          </div>

          {/* 四隅ハンドル（グループ全体リサイズ） */}
          {[
            { t: -9, l: -9 }, { t: -9, r: -9 }, { b: -9, l: -9 }, { b: -9, r: -9 },
          ].map((p, i) => (
            <span key={i} className="absolute w-2 h-2 rounded-[2px] bg-white" style={{ border: '1px solid #6965db', top: p.t, bottom: p.b, left: p.l, right: p.r }} />
          ))}

          {/* 列境界のドラッグつまみ（手動リサイズ・1本目の境界を強調） */}
          <div className="absolute -top-1 bottom-0 z-10 flex flex-col items-center" style={{ left: COL_W[0] - 4 }}>
            <span className="w-1.5 h-1.5 rounded-full bg-white" style={{ border: '1.5px solid #6965db' }} />
            <span className="flex-1 w-px" style={{ background: '#6965db' }} />
          </div>
          {/* つまみの吹き出し */}
          <div className="absolute z-20 whitespace-nowrap" style={{ left: COL_W[0] - 4, top: -30 }}>
            <span className="relative block -translate-x-1/2 px-2 py-0.5 rounded text-white text-[9px] font-bold shadow" style={{ background: '#6965db' }}>← ドラッグで幅を調整 →</span>
          </div>
        </div>

        {/* 補足キャプション */}
        <div className="mt-5 text-center text-[10px]" style={{ color: '#6965db', fontWeight: 600, width: totalW }}>
          セルはダブルクリックで入力。内容に合わせて自動で整います
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ⑫ 担当者レコメンド（TicketSkillFields.tsx / AssigneeRecommendModal をトレース）
 * ========================================================== */
export function AssigneeRecommendScreen() {
  const candidates = [
    { rank: 1, name: '田中 太郎', active: 0, match: 100, reasons: '必須スキルを全て保有 · 対象期間に空きあり', recommended: true },
    { rank: 2, name: '佐藤 花子', active: 2, match: 92, reasons: '必須スキルを保有 · 稼働はやや多め', recommended: false },
    { rank: 3, name: '鈴木 一郎', active: 3, match: 85, reasons: '推奨スキルを一部保有', recommended: false },
  ];
  return (
    <div className="p-4 sm:p-5 text-left bg-white">
      {/* モーダル見出し */}
      <div className="flex items-center gap-2.5 mb-3.5">
        <div className="w-8 h-8 rounded-[10px] bg-emerald-600 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-slate-900 leading-tight">担当者をおすすめ</div>
          <div className="text-[10px] text-slate-400 truncate">必要スキルと開発規模から、空いている適任者を提案します</div>
        </div>
      </div>

      {/* 必要スキル＋開発規模（レコメンドの入力） */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <span className="text-[10px] font-semibold text-slate-400 mr-0.5">必要スキル</span>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-100">React <span className="text-[8px] font-bold text-red-500">必須</span></span>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">Node.js <span className="text-[8px] font-bold text-amber-600">推奨</span></span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-slate-50 text-slate-500 border border-slate-200">規模 <span className="font-extrabold text-slate-700">M</span></span>
      </div>

      {/* 結果ヘッダー */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-bold text-emerald-700">おすすめ担当者（空き順）</span>
        <span className="text-[9.5px] text-emerald-600/80">学習済みモデル</span>
      </div>

      {/* 候補リスト */}
      <div className="space-y-1.5">
        {candidates.map((c) => (
          <div key={c.rank}
            className={`flex items-start gap-2.5 px-3 py-2.5 rounded-[10px] ${c.recommended ? 'bg-emerald-50 border-2 border-emerald-600' : 'bg-green-50/60 border border-emerald-600/20'}`}>
            <span className="text-[13px] font-extrabold text-emerald-600 w-4 shrink-0">{c.rank}.</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-bold text-slate-900">{c.name}</span>
                {c.recommended && (
                  <span className="inline-flex items-center gap-0.5 text-[9.5px] font-extrabold text-white bg-emerald-600 px-1.5 py-0.5 rounded-full">
                    <Sparkles className="w-2.5 h-2.5" />推奨
                  </span>
                )}
                <span className={`text-[10px] font-bold ${c.active === 0 ? 'text-emerald-600' : 'text-slate-500'}`}>稼働中{c.active}件</span>
                <span className="text-[10px] font-semibold text-slate-400">適合 {c.match}%</span>
              </div>
              <p className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">{c.reasons}</p>
            </div>
            <span className="self-center shrink-0 text-[10.5px] font-bold text-emerald-600">この人に決定 →</span>
          </div>
        ))}
      </div>

      {/* もっと見る */}
      <div className="mt-2 w-full text-center text-[11px] font-semibold text-slate-500 border border-dashed border-slate-300 rounded-lg py-1.5">
        もっと見る（他4人の有資格者）
      </div>
    </div>
  );
}

/* ============================================================
 * ⑬ スキル自動分析・登録（MemberSkillDialog.tsx / skills.ts をトレース）
 * ========================================================== */
export function MemberSkillScreen() {
  // レイヤーごとに「スキル名＋レベル(1〜4)」。実画面の配色に合わせる。
  const layers = [
    { name: 'フロントエンド', color: '#0284C7', bg: '#F0F9FF', skills: [{ n: 'React', lv: 3 }, { n: 'TypeScript', lv: 4 }] },
    { name: 'バックエンド', color: '#059669', bg: '#ECFDF5', skills: [{ n: 'Node.js', lv: 2 }, { n: 'PostgreSQL', lv: 3 }] },
    { name: 'インフラ', color: '#D97706', bg: '#FFFBEB', skills: [{ n: 'Docker', lv: 2 }] },
  ];
  return (
    <div className="p-4 sm:p-5 text-left bg-white">
      {/* メンバーヘッダー＋自動更新トグル */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
          <UserRound className="w-4 h-4 text-emerald-700" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-slate-900 leading-tight">田中 太郎</div>
          <div className="text-[10px] text-slate-400">実績からスキルを自動登録しました</div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-semibold text-emerald-700">スキル自動更新</span>
          <span className="relative w-8 h-[18px] rounded-full bg-emerald-500">
            <span className="absolute top-0.5 right-0.5 w-[14px] h-[14px] rounded-full bg-white" />
          </span>
        </span>
      </div>

      {/* レイヤーごとのスキル＋レベル */}
      <div className="space-y-2.5">
        {layers.map((layer) => (
          <div key={layer.name} className="rounded-[11px] border border-slate-100 p-2.5">
            <div className="text-[10px] font-bold mb-2" style={{ color: layer.color }}>{layer.name}</div>
            <div className="space-y-1.5">
              {layer.skills.map((s) => (
                <div key={s.n} className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold px-2 py-1 rounded-md shrink-0" style={{ color: layer.color, background: layer.bg }}>{s.n}</span>
                  {/* レベル ①②③④（保有レベルまで塗り） */}
                  <span className="ml-auto flex items-center gap-1">
                    {[1, 2, 3, 4].map((lv) => (
                      <span key={lv}
                        className="w-4 h-4 rounded-[5px] flex items-center justify-center text-[9px] font-bold"
                        style={s.lv >= lv
                          ? { background: '#059669', color: '#fff', border: '1px solid #059669' }
                          : { background: '#fff', color: '#C9C4BB', border: '1px solid rgba(26,23,20,0.12)' }}>
                        {lv}
                      </span>
                    ))}
                    <span className="ml-1 text-[9.5px] font-bold text-slate-400">Lv{s.lv}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-400">
        <Sparkles className="w-3 h-3 text-emerald-500" />
        過去のチケット実績からAIが自動判定。手動での調整もできます
      </div>
    </div>
  );
}

/* ============================================================
 * ⑭ 学習 → 活用の全体像（構図図版・ブラウザ枠なし）
 *    実処理の関係をトレース:
 *      過去実績 →①スキル分析(自動登録) →②レコメンド →決定 →(採用ログを学習)→②へ
 * ========================================================== */

/** 記事内に「概念図」を差し込む共通図版（ScreenFrame を使わない・枠なし）。 */
export function ConceptFigure({ caption, children }: { caption?: string; children: ReactNode }) {
  return (
    <figure className="my-8 sm:my-10">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5 sm:p-6 shadow-sm">
        {children}
      </div>
      {caption && (
        <figcaption className="mt-3 text-center text-[13px] text-slate-400">{caption}</figcaption>
      )}
    </figure>
  );
}

/** 図版内の丸アイコン・ノード（アイコン＋2行ラベル）。 */
function CycleNode({
  Icon, ring, iconColor, title, sub,
}: { Icon: typeof Ticket; ring: string; iconColor: string; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 w-[74px] sm:w-[86px] shrink-0">
      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white flex items-center justify-center shadow-sm" style={{ border: `2px solid ${ring}` }}>
        <Icon className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: iconColor }} />
      </div>
      <div className="text-center leading-tight">
        <div className="text-[11px] sm:text-[11.5px] font-bold text-slate-800">{title}</div>
        <div className="text-[9px] text-slate-400 mt-0.5">{sub}</div>
      </div>
    </div>
  );
}

/** ノード間の小さな右向き矢印（丸アイコンの中心に合わせる）。 */
function MiniArrow() {
  return <ArrowRight className="w-4 h-4 text-slate-300 shrink-0 mt-4 sm:mt-5" />;
}

export function RecommendFlowDiagram() {
  return (
    <div className="text-left">
      {/* 外部AI不使用バッジ */}
      <div className="flex justify-center mb-5">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          <Lock className="w-3 h-3" />
          外部AIは不使用 ― すべて自社のチケット実績データだけで完結
        </span>
      </div>

      {/* 学習ゾーン → 活用ゾーン（横並び）＋下部に学習ループの弧 */}
      <div className="relative" style={{ paddingBottom: 62 }}>
        <div className="flex items-stretch gap-2 sm:gap-3">
          {/* ① 学習ゾーン */}
          <div className="flex-1 rounded-2xl border-2 border-sky-200 bg-sky-50/50 px-2 pt-2.5 pb-4">
            <div className="flex justify-center mb-2.5">
              <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-sky-600 text-white">分析AI ・ 学習（自動）</span>
            </div>
            <div className="flex items-start justify-center gap-1 sm:gap-2">
              <CycleNode Icon={Ticket} ring="#7DD3FC" iconColor="#0284C7" title="実績" sub="チケットの蓄積" />
              <MiniArrow />
              <CycleNode Icon={Sparkles} ring="#6EE7B7" iconColor="#059669" title="スキル分析" sub="レベルを自動登録" />
            </div>
          </div>

          {/* ゾーン間の矢印 */}
          <div className="flex items-center shrink-0 self-center">
            <ArrowRight className="w-5 h-5 text-emerald-500" />
          </div>

          {/* ② 活用ゾーン */}
          <div className="flex-1 rounded-2xl border-2 border-emerald-200 bg-emerald-50/50 px-2 pt-2.5 pb-4">
            <div className="flex justify-center mb-2.5">
              <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-emerald-600 text-white">アサインAI ・ 活用</span>
            </div>
            <div className="flex items-start justify-center gap-1 sm:gap-2">
              <CycleNode Icon={UserRound} ring="#6EE7B7" iconColor="#059669" title="レコメンド" sub="スキル×空き状況" />
              <MiniArrow />
              <CycleNode Icon={CheckCircle2} ring="#6EE7B7" iconColor="#059669" title="担当を決定" sub="採用ログに記録" />
            </div>
          </div>
        </div>

        {/* 学習ループの弧（活用の「決定」→ 学習へ戻る） */}
        <div style={{ position: 'absolute', left: '33%', right: '11%', bottom: 20, height: 34, borderBottom: '2px dashed #34D399', borderLeft: '2px dashed #34D399', borderRight: '2px dashed #34D399', borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }} />
        {/* 左端＝学習へ戻る上向き矢印 */}
        <span style={{ position: 'absolute', left: 'calc(33% - 5px)', bottom: 52, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '7px solid #34D399' }} />
        {/* 中央ラベル */}
        <span style={{ position: 'absolute', left: '61%', bottom: 6, transform: 'translateX(-50%)' }}
          className="inline-flex items-center gap-1 whitespace-nowrap bg-white text-emerald-700 text-[10px] font-bold px-2.5 py-1 rounded-full border border-emerald-200">
          <RotateCcw className="w-3 h-3" />
          決定結果が次の学習に
        </span>
      </div>

      {/* まとめ */}
      <p className="mt-1 text-center text-[11px] text-slate-500 leading-relaxed">
        「決めるたびに学習」が回るので、使うほどおすすめの精度が高まっていきます。
      </p>
    </div>
  );
}

/* ============================================================
 * ⑮ ファイルボックス（FileBoxPage.tsx をトレース）
 *    プロジェクト直下の /files。サブナビ・検索・D&Dアップロード・一覧。
 * ========================================================== */
export function FileBoxScreen() {
  // ProjectSubNav.tsx と同じ並び・同じ配色（アクティブは #059669 の塗り）
  const tabs = [
    { label: 'スプリント管理', Icon: Layers },
    { label: 'バックログ', Icon: ClipboardList },
    { label: 'Wiki', Icon: BookOpen },
    { label: '議事録', Icon: FileText },
    { label: 'ファイルボックス', Icon: FolderOpen },
    { label: 'ホワイトボード', Icon: PenTool },
  ];
  // KIND_COLOR（projectFiles.ts）に合わせた種別カラー
  const files = [
    { name: '要件定義書.xlsx', Icon: FileSpreadsheet, color: '#059669', meta: '412.8 KB · 田中 太郎 · 2026/07/22 14:20', ver: 3 },
    { name: '画面設計書.docx', Icon: FileText, color: '#2563EB', meta: '1.2 MB · 佐藤 花子 · 2026/07/22 11:05', ver: 2 },
    { name: 'API仕様書.pdf', Icon: FileText, color: '#DC2626', meta: '860.4 KB · 鈴木 一郎 · 2026/07/21 18:42', ver: 1 },
    { name: 'ロゴ案.png', Icon: FileImage, color: '#7C3AED', meta: '245.0 KB · 田中 太郎 · 2026/07/21 09:30', ver: 1 },
  ];
  return (
    <div className="p-4 sm:p-5 text-left bg-white">
      {/* 見出し＋サブナビ */}
      <div className="flex items-start justify-between gap-3 mb-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[10px] bg-cyan-600 flex items-center justify-center shrink-0">
              <FolderOpen className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-[13px] font-bold text-slate-900 leading-tight">ファイルボックス</div>
              <div className="text-[10px] text-slate-400">DevTicket 開発 · 4 件</div>
            </div>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1 shrink-0 rounded-[9px] border border-slate-900/[0.08] bg-white p-[3px]">
          {tabs.map((t) => {
            const active = t.label === 'ファイルボックス';
            return (
              <span key={t.label}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[9.5px] font-medium whitespace-nowrap ${
                  active ? 'bg-emerald-600 text-white' : 'text-stone-500'}`}>
                <t.Icon className="w-[11px] h-[11px]" />{t.label}
              </span>
            );
          })}
        </div>
      </div>

      <div className="rounded-[13px] border border-slate-100 p-3">
        {/* 検索 */}
        <div className="relative max-w-[280px] mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-300" />
          <div className="rounded-lg bg-slate-100 py-1.5 pl-7 pr-2 text-[11px] text-slate-400">ファイル名・アップロード者で検索...</div>
        </div>

        {/* アップロード枠（ドラッグ&ドロップ） */}
        <div className="flex items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-emerald-500/50 bg-emerald-50/40 py-4 mb-3">
          <Upload className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-[11px] text-emerald-700 font-medium">クリックしてファイルを追加、またはドラッグ&amp;ドロップ（1ファイル 50.0 MB まで）</span>
        </div>

        {/* 一覧 */}
        <div>
          {files.map((f) => (
            <div key={f.name} className="flex items-center gap-2.5 px-2 py-2.5 border-b border-slate-100 last:border-b-0">
              <span className="w-[30px] h-[30px] rounded-[7px] shrink-0 flex items-center justify-center" style={{ background: `${f.color}14` }}>
                <f.Icon className="w-3.5 h-3.5" style={{ color: f.color }} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-slate-900 truncate">{f.name}</span>
                  {f.ver > 1 && (
                    <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-indigo-50 text-indigo-600 shrink-0">v{f.ver}</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 truncate">{f.meta}</div>
              </div>
              <span className="flex items-center gap-1.5 shrink-0 text-slate-300">
                <Link2 className="w-3 h-3" />
                <Download className="w-3 h-3" />
                <Trash2 className="w-3 h-3" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ⑯ 自前ファイルビューア（FileViewerModal.tsx / ExcelViewer.tsx をトレース）
 *    署名付きURLからブラウザが直接取得し、描画も全てブラウザ内で完結する。
 * ========================================================== */
export function FileViewerScreen() {
  const cols = ['A', 'B', 'C', 'D', 'E'];
  const rows: string[][] = [
    ['機能', '担当', '規模', '状態', ''],
    ['ファイル一覧', '田中 太郎', 'M', '完了', ''],
    ['ブラウザ閲覧', '佐藤 花子', 'L', '完了', ''],
    ['バージョン管理', '鈴木 一郎', 'M', '進行中', ''],
    ['%メンション', '田中 太郎', 'S', '完了', ''],
    ['', '', '', '', ''],
  ];
  return (
    <div className="text-left bg-white">
      {/* ビューアのヘッダー */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-slate-100">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-slate-900 truncate">要件定義書.xlsx</div>
          <div className="text-[10px] text-slate-400">412.8 KB · 田中 太郎</div>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 border-[1.5px] border-blue-200 shrink-0">
          <MonitorCog className="w-3 h-3" />アプリで開く
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 border-[1.5px] border-emerald-200 shrink-0">
          <Download className="w-3 h-3" />ダウンロード
        </span>
        <X className="w-3.5 h-3.5 text-slate-500 shrink-0" />
      </div>

      {/* シート本体（列ヘッダー・行番号つきグリッド） */}
      <div className="relative bg-white p-3">
        <div className="overflow-hidden rounded-md border border-slate-200">
          {/* 列ヘッダー */}
          <div className="flex bg-slate-50 border-b border-slate-200">
            <span className="w-7 shrink-0 border-r border-slate-200" />
            {cols.map((c) => (
              <span key={c} className="flex-1 text-center text-[9px] font-semibold text-slate-400 py-1 border-r border-slate-200 last:border-r-0">{c}</span>
            ))}
          </div>
          {rows.map((r, ri) => (
            <div key={ri} className="flex border-b border-slate-100 last:border-b-0">
              <span className="w-7 shrink-0 text-center text-[9px] text-slate-400 py-1.5 bg-slate-50 border-r border-slate-200">{ri + 1}</span>
              {r.map((cell, ci) => (
                <span key={ci}
                  className={`flex-1 min-w-0 truncate px-1.5 py-1.5 text-[10px] border-r border-slate-100 last:border-r-0 ${
                    ri === 0 ? 'font-bold text-slate-700 bg-slate-50/70' : 'text-slate-600'}`}>
                  {cell}
                </span>
              ))}
            </div>
          ))}
        </div>

        {/* 描画レイヤー（シート上に浮いた図形もそのまま再現） */}
        <div className="absolute right-6 top-9 rotate-[-4deg]">
          <span className="inline-flex items-center gap-1 rounded-lg border-2 border-amber-400 bg-amber-50 px-2.5 py-1.5 text-[9.5px] font-bold text-amber-700 shadow-sm">
            <ImageIcon className="w-3 h-3" />シート上の図形・画像も表示
          </span>
        </div>

        {/* シートタブ */}
        <div className="flex items-center gap-1 mt-2.5">
          <span className="text-[9.5px] font-bold px-2 py-1 rounded-t-md bg-white border border-slate-200 border-b-white text-emerald-700">要件一覧</span>
          <span className="text-[9.5px] px-2 py-1 text-slate-400">スケジュール</span>
          <span className="text-[9.5px] px-2 py-1 text-slate-400">課題管理</span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ⑰ %ファイルメンション（RichEditor.tsx の FileMentionList をトレース）
 *    チケット・バックログ・Wiki・議事録の本文から、その場でファイルを開ける。
 * ========================================================== */
export function FileMentionScreen() {
  const items = [
    { name: '要件定義書.xlsx', sel: true },
    { name: '要件ヒアリングメモ.docx', sel: false },
    { name: '要件_API仕様書.pdf', sel: false },
  ];
  return (
    <div className="p-4 sm:p-5 text-left bg-white">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-[10px] bg-emerald-600 flex items-center justify-center shrink-0">
          <Ticket className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-slate-900 leading-tight">DEV-128 ファイル一覧の実装</div>
          <div className="text-[10px] text-slate-400">詳細</div>
        </div>
      </div>

      {/* 本文エディタ */}
      <div className="rounded-[10px] border border-slate-200 p-3">
        <p className="text-[11.5px] text-slate-600 leading-relaxed">
          仕様は <span className="rounded bg-cyan-50 px-1 py-px font-semibold text-cyan-700">%要件定義書.xlsx</span> の「要件一覧」シートを参照。
        </p>
        <p className="text-[11.5px] text-slate-600 leading-relaxed mt-1.5">
          レビュー観点は <span className="text-slate-900 font-semibold">%要件</span>
          <span className="inline-block w-px h-3 align-middle bg-slate-900 ml-px" />
        </p>

        {/* サジェストポップアップ */}
        <div className="mt-1.5 w-full max-w-[320px] rounded-[10px] border border-slate-200 bg-white shadow-lg overflow-hidden">
          {items.map((it) => (
            <div key={it.name}
              className={`flex items-center gap-2 px-3 py-[7px] ${it.sel ? 'bg-cyan-50' : 'bg-white'}`}>
              <span className="text-[9px] font-bold px-1.5 py-px rounded bg-cyan-100 text-cyan-700 shrink-0">ファイル</span>
              <span className="text-[10.5px] text-slate-500 truncate">{it.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-400">
        <Eye className="w-3 h-3 text-cyan-500" />
        クリックするとその場でプレビュー。閉じても画面は移動しないので、作業を中断せずに確認できます
      </div>
    </div>
  );
}

/* ============================================================
 * ⑱ 「アプリで開く → Ctrl+S → 新バージョン」の往復（構図図版）
 *    api/dav（WebDAV）と api/project-files の関係をトレース。
 * ========================================================== */
export function FileRoundTripDiagram() {
  return (
    <div className="text-left">
      {/* 外部ビューア不使用バッジ */}
      <div className="flex justify-center mb-5">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold px-3 py-1.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200">
          <ShieldCheck className="w-3 h-3" />
          外部のオンラインビューアは経由しません ― ファイルは社外に出ません
        </span>
      </div>

      <div className="flex items-start justify-center gap-1 sm:gap-2">
        <CycleNode Icon={FolderOpen} ring="#67E8F9" iconColor="#0891B2" title="ファイルボックス" sub="最新版を保管" />
        <MiniArrow />
        <CycleNode Icon={MonitorCog} ring="#93C5FD" iconColor="#2563EB" title="アプリで開く" sub="Excel / Word" />
        <MiniArrow />
        <CycleNode Icon={Save} ring="#6EE7B7" iconColor="#059669" title="Ctrl+S で保存" sub="いつもの操作" />
        <MiniArrow />
        <CycleNode Icon={CheckCircle2} ring="#6EE7B7" iconColor="#059669" title="v2 として反映" sub="そのまま最新版に" />
      </div>

      <p className="mt-4 text-center text-[11px] text-slate-500 leading-relaxed">
        ダウンロードして編集し、また上げ直す ―― その手間なく、いつもの保存操作だけで最新版が全員に共有されます。
      </p>
    </div>
  );
}

/* ============================================================
 * ⑲ ブラウザ上での Excel 編集（ExcelEditor.tsx / ExcelViewer.tsx をトレース）
 *    リボン風ツールバー＋グリッド。選択セルの枠と入力中のセルを再現。
 * ========================================================== */
export function ExcelEditScreen() {
  const cols = ['A', 'B', 'C', 'D', 'E'];
  const rows: string[][] = [
    ['機能', '担当', '規模', '状態', '備考'],
    ['ファイル一覧', '田中 太郎', 'M', '完了', ''],
    ['ブラウザ閲覧', '佐藤 花子', 'L', '完了', ''],
    ['ブラウザ編集', '鈴木 一郎', 'L', '進行中', ''],
    ['バージョン管理', '田中 太郎', 'M', '完了', ''],
  ];
  return (
    <div className="text-left bg-white">
      {/* ヘッダー */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-slate-100">
        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-slate-900 truncate">要件定義書.xlsx</div>
          <div className="text-[10px] text-slate-400">412.8 KB · 田中 太郎</div>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border-[1.5px] border-amber-200 shrink-0">
          <Pencil className="w-3 h-3" />編集中
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white shrink-0">
          <Save className="w-3 h-3" />保存
        </span>
        <X className="w-3.5 h-3.5 text-slate-500 shrink-0" />
      </div>

      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-slate-100 bg-slate-50">
        {[Undo2, Redo2].map((Icon, i) => (
          <span key={i} className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center">
            <Icon className="w-3 h-3 text-slate-500" />
          </span>
        ))}
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <span className="w-6 h-6 rounded-md bg-emerald-50 border border-emerald-200 flex items-center justify-center">
          <Bold className="w-3 h-3 text-emerald-700" />
        </span>
        {[Italic, Type, PaintBucket, AlignLeft, TableIcon].map((Icon, i) => (
          <span key={i} className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center">
            <Icon className="w-3 h-3 text-slate-500" />
          </span>
        ))}
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <span className="text-[9.5px] font-semibold text-slate-500 px-2 py-1 rounded-md bg-white border border-slate-200">セルを結合</span>
        <span className="text-[9.5px] font-semibold text-slate-500 px-2 py-1 rounded-md bg-white border border-slate-200">列幅を内容に合わせる</span>
      </div>

      {/* グリッド */}
      <div className="p-3">
        <div className="overflow-hidden rounded-md border border-slate-200">
          <div className="flex bg-slate-50 border-b border-slate-200">
            <span className="w-7 shrink-0 border-r border-slate-200" />
            {cols.map((c) => (
              <span key={c} className="flex-1 text-center text-[9px] font-semibold text-slate-400 py-1 border-r border-slate-200 last:border-r-0">{c}</span>
            ))}
          </div>
          {rows.map((r, ri) => (
            <div key={ri} className="flex border-b border-slate-100 last:border-b-0">
              <span className="w-7 shrink-0 text-center text-[9px] text-slate-400 py-1.5 bg-slate-50 border-r border-slate-200">{ri + 1}</span>
              {r.map((cell, ci) => {
                const editing = ri === 3 && ci === 3;
                return (
                  <span key={ci}
                    className={`relative flex-1 min-w-0 truncate px-1.5 py-1.5 text-[10px] border-r border-slate-100 last:border-r-0 ${
                      ri === 0 ? 'font-bold text-slate-700 bg-slate-50/70' : 'text-slate-600'}`}>
                    {editing ? (
                      <span className="absolute inset-0 flex items-center gap-px bg-white px-1.5 rounded-[3px]" style={{ outline: '2px solid #059669' }}>
                        <span className="text-[10px] text-slate-900">進行中</span>
                        <span className="inline-block w-px h-3 bg-slate-900" />
                      </span>
                    ) : cell}
                  </span>
                );
              })}
            </div>
          ))}
        </div>

        {/* シートタブ */}
        <div className="flex items-center gap-1 mt-2">
          <span className="text-[9.5px] font-bold px-2 py-1 rounded-t-md bg-white border border-b-0 border-slate-200 text-emerald-700">要件一覧</span>
          <span className="text-[9.5px] px-2 py-1 rounded-t-md text-slate-400">スケジュール</span>
          <span className="text-[9.5px] px-2 py-1 rounded-t-md text-slate-400">課題管理</span>
          <span className="w-4 h-4 rounded-md bg-slate-100 flex items-center justify-center ml-1">
            <Plus className="w-2.5 h-2.5 text-slate-400" />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ⑳ ブラウザ上での Word 編集（WordEditor.tsx / WordToolbar.tsx をトレース）
 * ========================================================== */
export function WordEditScreen() {
  return (
    <div className="text-left bg-white">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-slate-100">
        <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-slate-900 truncate">画面設計書.docx</div>
          <div className="text-[10px] text-slate-400">1.2 MB · 佐藤 花子</div>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white shrink-0">
          <Save className="w-3 h-3" />保存
        </span>
      </div>

      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-slate-100 bg-slate-50">
        <span className="text-[9.5px] font-semibold text-slate-600 px-2 py-1 rounded-md bg-white border border-slate-200">見出し2</span>
        <span className="text-[9.5px] font-semibold text-slate-600 px-2 py-1 rounded-md bg-white border border-slate-200">游ゴシック</span>
        <span className="text-[9.5px] font-semibold text-slate-600 px-2 py-1 rounded-md bg-white border border-slate-200">10.5</span>
        <span className="w-px h-4 bg-slate-200 mx-1" />
        {[Bold, Italic, Type, PaintBucket, AlignLeft, ClipboardList, TableIcon, Link2].map((Icon, i) => (
          <span key={i} className={`w-6 h-6 rounded-md flex items-center justify-center border ${
            i === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
            <Icon className={`w-3 h-3 ${i === 0 ? 'text-emerald-700' : 'text-slate-500'}`} />
          </span>
        ))}
      </div>

      {/* 紙面 */}
      <div className="bg-slate-100 p-4">
        <div className="mx-auto max-w-[440px] rounded-sm bg-white px-6 py-5 shadow-sm">
          <div className="text-[13px] font-extrabold text-slate-900">3. 画面一覧</div>
          <div className="mt-2 text-[10.5px] leading-relaxed text-slate-600">
            本章では、対象となる画面の一覧と、それぞれの遷移条件を示す。
            <span className="bg-amber-100 px-0.5">利用者の権限によって表示される項目が変わる</span>点に注意すること。
          </div>
          <div className="mt-3 overflow-hidden rounded border border-slate-200">
            {[['画面ID', '画面名', '権限'], ['SC-001', 'ファイル一覧', '閲覧'], ['SC-002', 'ファイル編集', '編集']].map((r, ri) => (
              <div key={ri} className="flex border-b border-slate-100 last:border-b-0">
                {r.map((c, ci) => (
                  <span key={ci} className={`flex-1 px-2 py-1.5 text-[9.5px] border-r border-slate-100 last:border-r-0 ${
                    ri === 0 ? 'bg-slate-50 font-bold text-slate-600' : 'text-slate-600'}`}>{c}</span>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-3 text-[10.5px] leading-relaxed text-slate-600">
            なお、編集内容は
            <span className="inline-block w-px h-3 align-middle bg-slate-900 mx-px" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ㉑ ナレッジノート（KnowledgePage.tsx をトレース）
 *    3ペイン: ① 資料（フォルダ／チェック） ② 目次 ③ 本文
 * ========================================================== */
export function KnowledgeScreen() {
  const outline = [
    { text: '1. システム構成', lv: 0, on: false },
    { text: '1.1 全体構成図', lv: 1, on: false },
    { text: '2. データ設計', lv: 0, on: true },
    { text: '2.1 テーブル定義', lv: 1, on: true },
    { text: '2.2 索引の方針', lv: 1, on: false },
    { text: '3. 画面設計', lv: 0, on: false },
  ];
  return (
    <div className="p-4 sm:p-5 text-left bg-white">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-[10px] bg-emerald-600 flex items-center justify-center shrink-0">
          <BookOpen className="w-4 h-4 text-white" />
        </div>
        <div>
          <div className="text-[13px] font-bold text-slate-900 leading-tight">ナレッジノート</div>
          <div className="text-[10px] text-slate-400">DevTicket 開発 · 資料 8 件</div>
        </div>
      </div>

      <div className="flex gap-2 items-stretch">
        {/* ① 資料 */}
        <div className="w-[150px] shrink-0 rounded-[11px] border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-2.5 py-2 border-b border-slate-100">
            <span className="text-[11px] font-bold text-slate-800">資料</span>
            <span className="flex items-center gap-1 text-slate-300">
              <Plus className="w-3 h-3" /><Upload className="w-3 h-3" />
            </span>
          </div>
          <div className="p-1.5">
            <div className="flex items-center gap-1.5 px-1.5 py-1">
              <span className="w-2.5 h-2.5 rounded-[3px] bg-emerald-600 flex items-center justify-center shrink-0">
                <Check className="w-2 h-2 text-white" />
              </span>
              <FolderOpen className="w-3 h-3 text-amber-500 shrink-0" />
              <span className="text-[10.5px] font-bold text-slate-800 truncate">設計書</span>
              <span className="text-[9px] text-slate-300">3</span>
            </div>
            {['DB設計書.md', 'API設計書.md', '画面設計.md'].map((n, i) => (
              <div key={n} className={`flex items-center gap-1.5 pl-4 pr-1.5 py-1 rounded-md ${i === 0 ? 'bg-emerald-50' : ''}`}>
                <span className="w-2.5 h-2.5 rounded-[3px] bg-emerald-600 flex items-center justify-center shrink-0">
                  <Check className="w-2 h-2 text-white" />
                </span>
                <FileText className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                <span className={`text-[10px] truncate ${i === 0 ? 'font-bold text-emerald-700' : 'text-slate-500'}`}>{n}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 px-1.5 py-1 mt-1">
              <span className="w-2.5 h-2.5 rounded-[3px] border border-slate-300 shrink-0" />
              <Folder className="w-3 h-3 text-amber-500 shrink-0" />
              <span className="text-[10.5px] font-bold text-slate-800 truncate">調査メモ</span>
              <span className="text-[9px] text-slate-300">5</span>
            </div>
            <div className="mt-1.5 rounded-[8px] border-[1.5px] border-dashed border-emerald-500/40 bg-emerald-50/30 py-2 text-center">
              <span className="text-[9px] text-emerald-700">.md をドラッグ&amp;ドロップ</span>
            </div>
          </div>
          <div className="px-2.5 py-1.5 border-t border-slate-100 text-[9px] text-slate-400">チェック = 検索の対象（3 件）</div>
        </div>

        {/* ② 目次 */}
        <div className="w-[132px] shrink-0 rounded-[11px] border border-slate-200 overflow-hidden">
          <div className="px-2.5 py-2 border-b border-slate-100 text-[11px] font-bold text-slate-800 truncate">DB設計書.md</div>
          <div className="p-1.5">
            {outline.map((o) => (
              <div key={o.text} className="flex items-center gap-1 py-[3px] rounded-md" style={{ paddingLeft: 6 + o.lv * 10, paddingRight: 4 }}>
                {o.on && <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />}
                <span className={`text-[9.5px] truncate ${o.lv === 0 ? 'font-bold text-slate-700' : 'text-slate-500'}`}>{o.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ③ 本文 */}
        <div className="flex-1 min-w-0 rounded-[11px] border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-slate-100">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-slate-300" />
              <div className="rounded-md bg-slate-50 border border-slate-200 py-1 pl-6 pr-2 text-[9.5px] text-slate-700">データベース</div>
            </div>
            <span className="text-[9.5px] font-semibold text-white bg-emerald-600 px-2.5 py-1 rounded-md shrink-0">検索</span>
          </div>
          <div className="p-2.5">
            <div className="text-[11px] font-extrabold text-slate-900">2. データ設計</div>
            <div className="mt-1.5 rounded-md bg-amber-50 border-l-[3px] border-amber-300 px-2 py-1.5">
              <div className="text-[10px] font-bold text-slate-800">2.1 テーブル定義</div>
              <div className="mt-1 text-[9.5px] leading-relaxed text-slate-500">
                資料の保管には documents テーブルを用いる。1レコードが1ファイルに対応し、本文は…
              </div>
            </div>
            <div className="mt-2 overflow-hidden rounded border border-slate-200">
              {[['列名', '型', '説明'], ['id', 'uuid', '主キー'], ['title', 'text', '資料名']].map((r, ri) => (
                <div key={ri} className="flex border-b border-slate-100 last:border-b-0">
                  {r.map((c, ci) => (
                    <span key={ci} className={`flex-1 px-1.5 py-1 text-[9px] border-r border-slate-100 last:border-r-0 ${
                      ri === 0 ? 'bg-slate-50 font-bold text-slate-600' : 'text-slate-500'}`}>{c}</span>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1 text-[9px] text-amber-600">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              「データベース」と書かれていなくても、内容が近い節に帯が付きます
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ㉒ ナレッジノートの検索結果（意味で探す／語句で探す のタブ）
 * ========================================================== */
export function KnowledgeSearchScreen() {
  const hits = [
    { doc: 'DB設計書.md', head: '2.1 テーブル定義', score: 82, text: '資料の保管には documents テーブルを用いる。1レコードが1ファイルに対応し…' },
    { doc: 'API設計書.md', head: '4.3 永続化の方針', score: 74, text: '書き込みは Supabase 経由で行い、RLS によって所属プロジェクトの行だけに限定する…' },
    { doc: '画面設計.md', head: '6. 一覧の取得', score: 68, text: '一覧は作成日時の昇順で取得する。並びが毎回変わらないよう、第二キーに id を置く…' },
  ];
  return (
    <div className="p-4 sm:p-5 text-left bg-white">
      <div className="flex items-center gap-1.5 mb-3">
        <div className="relative flex-1 max-w-[360px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-300" />
          <div className="rounded-lg bg-slate-50 border border-slate-200 py-1.5 pl-7 pr-2 text-[11px] text-slate-700">データベース</div>
        </div>
        <span className="text-[10px] font-semibold text-white bg-emerald-600 px-3 py-1.5 rounded-lg shrink-0">検索</span>
      </div>

      {/* タブ */}
      <div className="inline-flex gap-1 bg-slate-100 rounded-[9px] p-[3px] mb-2.5">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-[7px] bg-white text-[10.5px] font-bold text-emerald-700 shadow-sm">
          <Brain className="w-3 h-3" />意味で探す<span className="text-[9px] text-emerald-600">3</span>
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-[7px] text-[10.5px] font-semibold text-slate-400">
          <TextSearch className="w-3 h-3" />語句で探す<span className="text-[9px] text-slate-300">1</span>
        </span>
      </div>

      <div className="text-[9.5px] text-slate-400 mb-2">
        <span className="font-bold text-slate-500">入力した語が出てこなくても、内容が近い箇所</span>を関連度の高い順に出しています。関連度 82〜68。
      </div>

      {hits.map((h) => (
        <div key={h.head} className="rounded-[10px] border border-slate-200 px-2.5 py-2 mb-1.5">
          <div className="flex items-center gap-1.5">
            <FileText className="w-2.5 h-2.5 text-slate-400 shrink-0" />
            <span className="text-[9.5px] text-slate-400 truncate">{h.doc}</span>
            <ChevronRight className="w-2.5 h-2.5 text-slate-300 shrink-0" />
            <span className="text-[10.5px] font-bold text-slate-800 truncate">{h.head}</span>
            <span className="ml-auto text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-50 text-emerald-700 shrink-0">関連度 {h.score}</span>
          </div>
          <div className="mt-1 text-[9.5px] leading-relaxed text-slate-500">{h.text}</div>
        </div>
      ))}

      <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-slate-400">
        <ShieldCheck className="w-3 h-3 text-emerald-500" />
        資料も検索用の索引もすべて自社の保管領域の中だけで扱い、外部のAIサービスへは一切送信しません
      </div>
    </div>
  );
}

/* ============================================================
 * ㉓ タスク管理・リストビュー（TaskListView.tsx / TaskQuickAddRow.tsx をトレース）
 *    見出し・データ行・最終行の追加欄が同じ列幅で縦に揃う。完了行はグレーアウトして残る。
 * ========================================================== */
export function TaskListScreen() {
  const tasks = [
    { title: '請求書のフォーマットを確認する', cat: '事務', pj: '個人タスク', pri: '中', who: '自分', due: '08/12', st: '進行中', done: false, sub: false },
    { title: 'ログイン画面の文言を直す', cat: 'UI', pj: 'DevTicket 開発', pri: '高', who: '佐藤 花子', due: '08/13', st: '未着手', done: false, sub: false },
    { title: 'エラー文言の一覧を作る', cat: 'UI', pj: 'DevTicket 開発', pri: '中', who: '佐藤 花子', due: '08/13', st: '未着手', done: false, sub: true },
    { title: '定例の議事メモを共有する', cat: '事務', pj: '個人タスク', pri: '低', who: '自分', due: '08/09', st: '完了', done: true, sub: false },
  ];
  const priColor: Record<string, string> = { 高: '#DC2626', 中: '#D97706', 低: '#0284C7' };
  const stMeta: Record<string, { c: string; bg: string }> = {
    未着手: { c: '#6B7280', bg: '#F3F4F6' },
    進行中: { c: '#D97706', bg: '#FFF7ED' },
    完了: { c: '#059669', bg: '#ECFDF5' },
  };
  return (
    <div className="p-4 sm:p-5 text-left bg-white">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-[10px] bg-emerald-600 flex items-center justify-center shrink-0">
            <ListChecks className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-slate-900 leading-tight">タスク</div>
            <div className="text-[10px] text-slate-400 truncate">未着手・進行中・完了だけを管理する軽いタスク</div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 rounded-[9px] border border-slate-900/[0.08] bg-white p-[3px]">
          {[
            { l: 'リスト', I: ListChecks, on: true },
            { l: 'かんばん', I: Kanban, on: false },
            { l: 'ガント', I: ChartGantt, on: false },
          ].map((v) => (
            <span key={v.l} className={`flex items-center gap-1 rounded-md px-2 py-1 text-[9.5px] font-medium whitespace-nowrap ${
              v.on ? 'bg-emerald-600 text-white' : 'text-stone-500'}`}>
              <v.I className="w-[11px] h-[11px]" />{v.l}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-[13px] border border-slate-100 p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-bold text-slate-500">完了 1/4</span>
          <span className="text-[9.5px] text-slate-400 px-2 py-1 rounded-md bg-slate-50">すべてのPJ</span>
          <span className="text-[9.5px] text-slate-400 px-2 py-1 rounded-md bg-slate-50">担当: すべて</span>
        </div>

        {/* 見出し行 */}
        <div className="flex items-center gap-2 px-1.5 pb-1.5 border-b border-slate-200 text-[9px] font-bold text-slate-400">
          <span className="w-3 shrink-0" />
          <span className="flex-1 min-w-0">タイトル</span>
          <span className="w-[54px] shrink-0">分類</span>
          <span className="w-[74px] shrink-0">プロジェクト</span>
          <span className="w-[22px] shrink-0 text-center">優先</span>
          <span className="w-[58px] shrink-0">担当者</span>
          <span className="w-[36px] shrink-0">期限</span>
          <span className="w-[46px] shrink-0 text-center">ステータス</span>
        </div>

        {/* データ行 */}
        {tasks.map((t) => (
          <div key={t.title}
            className={`flex items-center gap-2 px-1.5 py-[7px] border-b border-slate-100 ${t.done ? 'opacity-45 grayscale' : ''}`}>
            <span className={`w-3 h-3 rounded-[3px] shrink-0 flex items-center justify-center ${
              t.done ? 'bg-emerald-600' : 'border border-slate-300'}`}>
              {t.done && <Check className="w-2 h-2 text-white" />}
            </span>
            <span className="flex-1 min-w-0 flex items-center gap-1">
              {t.sub && <CornerDownRight className="w-2.5 h-2.5 text-slate-300 shrink-0" />}
              <span className={`text-[10.5px] truncate ${t.done ? 'line-through text-slate-500' : 'text-slate-800'}`}>{t.title}</span>
            </span>
            <span className="w-[54px] shrink-0 text-[9.5px] text-slate-500 truncate">{t.cat}</span>
            <span className="w-[74px] shrink-0 text-[9.5px] text-slate-500 truncate">{t.pj}</span>
            <span className="w-[22px] shrink-0 text-center text-[9.5px] font-bold" style={{ color: priColor[t.pri] }}>{t.pri}</span>
            <span className="w-[58px] shrink-0 text-[9.5px] text-slate-500 truncate">{t.who}</span>
            <span className="w-[36px] shrink-0 text-[9.5px] text-slate-400">{t.due}</span>
            <span className="w-[46px] shrink-0 flex justify-center">
              <span className="text-[8.5px] font-bold px-1.5 py-px rounded-full whitespace-nowrap"
                style={{ color: stMeta[t.st].c, background: stMeta[t.st].bg }}>{t.st}</span>
            </span>
          </div>
        ))}

        {/* 追加行 */}
        <div className="flex items-center gap-2 px-1.5 py-[7px] rounded-b-lg bg-emerald-50/40">
          <span className="w-3 h-3 rounded-[3px] border border-emerald-300 shrink-0" />
          <span className="flex-1 min-w-0 flex items-center">
            <span className="text-[10.5px] text-slate-800">通知メールの文面を確認</span>
            <span className="inline-block w-px h-3 bg-slate-900 ml-px" />
          </span>
          <span className="w-[54px] shrink-0 text-[9.5px] text-slate-300">分類</span>
          <span className="w-[74px] shrink-0 text-[9.5px] text-slate-300">プロジェクト</span>
          <span className="w-[22px] shrink-0 text-center text-[9.5px] text-amber-600 font-bold">中</span>
          <span className="w-[58px] shrink-0 text-[9.5px] text-slate-300">担当者</span>
          <span className="w-[36px] shrink-0 text-[9.5px] text-slate-300">期限</span>
          <span className="w-[46px] shrink-0 flex justify-center">
            <span className="text-[8.5px] font-bold px-1.5 py-px rounded-full bg-slate-100 text-slate-500">未着手</span>
          </span>
        </div>
        <div className="mt-1.5 text-[9.5px] text-slate-400">
          最終行にそのまま入力して Enter。確定してもフォーカスは残るので、続けて何行でも足せます
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ㉔ タスクのかんばん（TaskBoardView.tsx をトレース）
 *    未着手 / 進行中 / 完了 の3列。カードのドラッグで状態が変わる。
 * ========================================================== */
export function TaskBoardScreen() {
  const cols = [
    {
      name: '未着手', c: '#6B7280', bg: '#F3F4F6', cards: [
        { t: 'ログイン画面の文言を直す', pj: 'DevTicket 開発', pri: '高' },
        { t: 'エラー文言の一覧を作る', pj: 'DevTicket 開発', pri: '中', sub: 'ログイン画面の文言を直す' },
      ],
    },
    {
      name: '進行中', c: '#D97706', bg: '#FFF7ED', cards: [
        { t: '請求書のフォーマットを確認する', pj: '個人タスク', pri: '中' },
      ],
    },
    {
      name: '完了', c: '#059669', bg: '#ECFDF5', cards: [
        { t: '定例の議事メモを共有する', pj: '個人タスク', pri: '低' },
      ],
    },
  ];
  const priColor: Record<string, string> = { 高: '#DC2626', 中: '#D97706', 低: '#0284C7' };
  return (
    <div className="p-4 sm:p-5 text-left bg-white">
      <div className="flex gap-2">
        {cols.map((col, ci) => (
          <div key={col.name} className="flex-1 min-w-0 rounded-[11px] border border-slate-200 bg-slate-50/60 p-2">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[9.5px] font-bold px-2 py-px rounded-full" style={{ color: col.c, background: col.bg }}>{col.name}</span>
              <span className="text-[9px] text-slate-400">{col.cards.length}</span>
            </div>
            {col.cards.map((c) => (
              <div key={c.t} className="rounded-[9px] border border-slate-200 bg-white px-2 py-1.5 mb-1.5 shadow-sm">
                {c.sub && (
                  <div className="flex items-center gap-1 text-[8.5px] text-slate-400 mb-0.5">
                    <CornerDownRight className="w-2 h-2 shrink-0" />{c.sub}
                  </div>
                )}
                <div className="text-[10px] font-semibold text-slate-800 leading-snug">{c.t}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full shrink-0" style={{ background: priColor[c.pri] }} />
                  <span className="text-[8.5px] text-slate-400 truncate">{c.pj}</span>
                </div>
              </div>
            ))}
            {ci === 1 && (
              <div className="rounded-[9px] border-[1.5px] border-dashed border-emerald-400 bg-emerald-50/50 py-3 text-center">
                <span className="text-[9px] font-semibold text-emerald-700">ここに落とすと進行中へ</span>
              </div>
            )}
            <div className="flex items-center gap-1 px-1 pt-1 text-[9px] text-slate-300">
              <Plus className="w-2.5 h-2.5" />この列に追加
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-slate-400">
        <MousePointer2 className="w-3 h-3 text-emerald-500" />
        カードを別の列へドラッグするだけで状態が変わります。落とした位置の並び順もそのまま保存されます
      </div>
    </div>
  );
}

/* ============================================================
 * ㉕ ホワイトボードのプライベートモード
 *    BoardListSidebar.tsx（3点リーダーのメニュー・錠前アイコン）と
 *    PrivateBadge.tsx（キャンバス右上のバッジ・#6D28D9）をトレース。
 * ========================================================== */
export function WhiteboardPrivateScreen() {
  const boards = [
    { name: 'スプリント計画', priv: false },
    { name: '個人メモ（検討中）', priv: true, menu: true },
    { name: 'アーキ検討', priv: false },
  ];
  return (
    <div className="flex text-left bg-white" style={{ minHeight: 260 }}>
      {/* ボード一覧 */}
      <div className="w-[176px] shrink-0 border-r border-slate-100 p-2">
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-[11px] font-bold text-slate-800">ボード</span>
          <Plus className="w-3 h-3 text-slate-300" />
        </div>
        {boards.map((b) => (
          <div key={b.name} className="relative">
            <div className={`flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg ${b.priv ? 'bg-violet-50' : ''}`}>
              {b.priv
                ? <Lock className="w-3 h-3 shrink-0" style={{ color: '#6D28D9' }} />
                : <Frame className="w-3 h-3 text-slate-400 shrink-0" />}
              <span className={`text-[10px] truncate ${b.priv ? 'font-bold text-violet-800' : 'text-slate-600'}`}>{b.name}</span>
              {b.priv && (
                <span className="text-[8px] font-bold px-1 py-px rounded shrink-0"
                  style={{ color: '#6D28D9', background: '#F5F3FF', border: '1px solid rgba(124,58,237,0.28)' }}>自分のみ</span>
              )}
              <MoreVertical className="w-3 h-3 text-slate-300 shrink-0 ml-auto" />
            </div>
            {b.menu && (
              <div className="absolute right-0 top-7 z-10 w-[146px] rounded-[10px] border border-slate-200 bg-white shadow-lg overflow-hidden">
                {[
                  { l: '名前変更', I: Pencil },
                  { l: 'ボード削除', I: Trash2 },
                  { l: 'プライベートモード解除', I: Lock, on: true },
                ].map((m) => (
                  <div key={m.l} className={`flex items-center gap-1.5 px-2.5 py-[7px] ${m.on ? 'bg-violet-50' : ''}`}>
                    <m.I className="w-2.5 h-2.5 shrink-0" style={{ color: m.on ? '#6D28D9' : '#94A3B8' }} />
                    <span className="text-[9.5px] font-semibold" style={{ color: m.on ? '#6D28D9' : '#475569' }}>{m.l}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="mt-2 px-1 text-[9px] text-slate-400 leading-relaxed">
          プライベート中のボードは、ほかのメンバーの一覧には並びません
        </div>
      </div>

      {/* キャンバス */}
      <div className="relative flex-1 min-w-0" style={{ backgroundImage: 'radial-gradient(#E2E8F0 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
        <div className="absolute right-2.5 top-2.5">
          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold px-2 py-1 rounded-lg"
            style={{ color: '#6D28D9', background: '#F5F3FF', border: '1px solid rgba(124,58,237,0.28)' }}>
            <Lock className="w-2.5 h-2.5" />プライベート
          </span>
        </div>
        <div className="absolute left-6 top-10 -rotate-2 rounded-[3px] bg-amber-200/80 px-3 py-2.5 shadow-sm">
          <span className="text-[9.5px] font-semibold text-amber-900">通知の設計案<br />（まだ相談前）</span>
        </div>
        <div className="absolute left-[128px] top-[92px] rotate-1 rounded-[3px] bg-sky-200/70 px-3 py-2.5 shadow-sm">
          <span className="text-[9.5px] font-semibold text-sky-900">要検討：<br />既存への影響</span>
        </div>
        <div className="absolute left-8 bottom-6 rounded-lg border-2 border-violet-300 border-dashed px-3 py-2">
          <span className="text-[9px] text-violet-700 font-semibold">下書きは自分だけの場所で</span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ㉖ MDファイルからの一括作成（MdBulkCreateDialog.tsx / MdTaskImportDialog.tsx をトレース）
 *    取り込み → 確認画面の2段構成。拾えた項目をバッジで見せる。
 * ========================================================== */
export function MdImportScreen() {
  const items = [
    { t: '一覧画面の実装', child: false, badges: ['未着手', '高', 'フロント', '田中 太郎', '3h'] },
    { t: '一覧APIの実装', child: true, badges: ['未着手', '中', 'バック', '鈴木 一郎', '5h'] },
    { t: '検索条件の保存', child: true, badges: ['未着手', '中', 'フロント', '佐藤 花子', '2h'] },
    { t: 'CSV出力の追加', child: false, badges: ['未着手', '低', 'フロント', '未割当', '2h'] },
  ];
  return (
    <div className="p-3.5 sm:p-4 text-left bg-white">
      <div className="flex items-center gap-2 mb-3">
        <FileInput className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="text-[12.5px] font-bold text-slate-900">MDファイルから一括作成</span>
        <span className="ml-auto flex items-center gap-1">
          <span className="text-[9px] font-semibold px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-500">テンプレート</span>
          <span className="text-[9px] font-semibold px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700">AI用プロンプト</span>
        </span>
      </div>

      {/* 取り込み枠 */}
      <div className="flex items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-emerald-500/50 bg-emerald-50/40 py-3 mb-2.5">
        <Upload className="w-3.5 h-3.5 text-emerald-600" />
        <span className="text-[10.5px] font-medium text-emerald-700">クリック、またはドラッグ&amp;ドロップ（複数まとめて可）</span>
      </div>

      {/* 読み込んだファイル */}
      <div className="flex items-center gap-1.5 mb-2">
        {['設計_一覧画面.md', '設計_出力機能.md'].map((f) => (
          <span key={f} className="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-1 rounded-md bg-slate-100 text-slate-600">
            <FileText className="w-2.5 h-2.5" />{f}<X className="w-2 h-2 text-slate-400" />
          </span>
        ))}
        <span className="ml-auto text-[9px] font-semibold px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-500">階層: 親子で作成</span>
      </div>

      {/* 確認一覧 */}
      <div className="rounded-[11px] border border-slate-200 overflow-hidden">
        {items.map((it) => (
          <div key={it.t} className="flex items-start gap-2 px-2.5 py-2 border-b border-slate-100 last:border-b-0">
            <span className="w-3 h-3 rounded-[3px] bg-emerald-600 flex items-center justify-center shrink-0 mt-px">
              <Check className="w-2 h-2 text-white" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                {it.child && <CornerDownRight className="w-2.5 h-2.5 text-slate-300 shrink-0" />}
                <span className="text-[10.5px] font-semibold text-slate-800 truncate">{it.t}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {it.badges.map((b) => (
                  <span key={b} className={`text-[8.5px] font-semibold px-1.5 py-px rounded ${
                    b === '未割当' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{b}</span>
                ))}
                <span className="text-[8.5px] font-semibold px-1.5 py-px rounded bg-emerald-50 text-emerald-700">詳細あり</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 mt-2 text-[9.5px] text-amber-700 bg-amber-50 rounded-md px-2 py-1.5">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        「CSV出力の追加」の担当者が見つかりませんでした（未割当で登録します）
      </div>

      <div className="flex items-center justify-end gap-1.5 mt-3">
        <span className="text-[10px] font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500">閉じる</span>
        <span className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-emerald-600 text-white">4件を登録する</span>
      </div>
    </div>
  );
}

/* ============================================================
 * ㉗ AI → MD → チケット／タスク の流れ（構図図版）
 * ========================================================== */
export function MdBulkFlowDiagram() {
  return (
    <div className="text-left">
      <div className="flex justify-center mb-5">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          <Sparkles className="w-3 h-3" />
          お使いのAIに書かせた Markdown を、そのまま取り込むだけ
        </span>
      </div>

      <div className="flex items-start justify-center gap-1 sm:gap-2">
        <CycleNode Icon={ClipboardList} ring="#A5B4FC" iconColor="#4F46E5" title="プロンプトをコピー" sub="メンバー名・分類つき" />
        <MiniArrow />
        <CycleNode Icon={Bot} ring="#93C5FD" iconColor="#2563EB" title="AIがMDを作成" sub="お使いのAIで" />
        <MiniArrow />
        <CycleNode Icon={Upload} ring="#6EE7B7" iconColor="#059669" title="取り込む" sub="D&amp;D・複数可" />
        <MiniArrow />
        <CycleNode Icon={CheckCircle2} ring="#6EE7B7" iconColor="#059669" title="まとめて登録" sub="チケット／タスク" />
      </div>

      <p className="mt-4 text-center text-[11px] text-slate-500 leading-relaxed">
        1件ずつ手で打ち込む時間がなくなり、フェーズの立ち上げが「貼って取り込むだけ」で終わります。
      </p>
    </div>
  );
}

/* ============================================================
 * ㉘ API連携（ApiIntegrationDialog.tsx / CreateTicketMenu.tsx をトレース）
 * ========================================================== */
export function ApiIntegrationScreen() {
  return (
    <div className="p-3.5 sm:p-4 text-left bg-white">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="text-[12.5px] font-bold text-slate-900">API連携</span>
        <span className="ml-auto inline-flex gap-1 bg-slate-100 rounded-lg p-[3px]">
          <span className="text-[9.5px] font-bold px-2.5 py-1 rounded-md bg-white text-emerald-700 shadow-sm">使い方</span>
          <span className="text-[9.5px] font-semibold px-2.5 py-1 rounded-md text-slate-400">APIキー</span>
        </span>
      </div>

      {/* 発行されたキー */}
      <div className="rounded-[11px] border border-emerald-200 bg-emerald-50/50 px-2.5 py-2 mb-2.5">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3 h-3 text-emerald-600 shrink-0" />
          <span className="text-[9.5px] font-bold text-emerald-800">キーはパスワードと同じものです</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-1 rounded-md bg-white border border-emerald-200 text-emerald-700">
            <Copy className="w-2.5 h-2.5" />コピー
          </span>
        </div>
        <div className="mt-1.5 rounded-md bg-slate-900 px-2 py-1.5 font-mono text-[9.5px] text-emerald-300 truncate">
          dvt_live_8f2b··················································
        </div>
      </div>

      {/* 組み込みの流れ */}
      <div className="text-[10px] font-bold text-slate-700 mb-1.5">組み込みの流れ</div>
      {[
        { n: '1', t: 'APIキーを発行する', d: '発行は最初の1回だけです' },
        { n: '2', t: 'キーを自分のシステムに設定する', d: '環境変数に入れます' },
        { n: '3', t: '自分のデータを tickets の形に変換する', d: '送れる項目を見て対応づけます' },
        { n: '4', t: 'POST する', d: '登録されると wbs（チケット番号）が返ります' },
      ].map((s) => (
        <div key={s.n} className="flex items-start gap-2 py-1">
          <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[8.5px] font-bold flex items-center justify-center shrink-0 mt-px">{s.n}</span>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold text-slate-800">{s.t}</div>
            <div className="text-[9px] text-slate-400">{s.d}</div>
          </div>
        </div>
      ))}

      {/* エンドポイント */}
      <div className="mt-2 rounded-[10px] bg-slate-900 px-2.5 py-2 font-mono text-[9px] leading-relaxed">
        <div><span className="text-emerald-400 font-bold">POST</span> <span className="text-slate-300">/api/v1/tickets</span> <span className="text-slate-500">— チケットを登録する</span></div>
        <div className="mt-0.5"><span className="text-sky-400 font-bold">GET</span> <span className="text-slate-300">/api/v1/context</span> <span className="text-slate-500">— スプリント・担当者・分類の候補</span></div>
        <div className="mt-1.5 text-slate-500">Authorization: Bearer <span className="text-amber-300">dvt_live_ここにAPIキー</span></div>
      </div>
    </div>
  );
}

/* ============================================================
 * ㉙ 外部AI／CI → API → Dev Ticket の流れ（構図図版）
 * ========================================================== */
export function ApiFlowDiagram() {
  return (
    <div className="text-left">
      <div className="flex justify-center mb-5">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          <Lock className="w-3 h-3" />
          キーはプロジェクト単位。届く先はそのプロジェクトの中だけです
        </span>
      </div>

      <div className="flex items-start justify-center gap-1 sm:gap-2">
        <CycleNode Icon={Bot} ring="#93C5FD" iconColor="#2563EB" title="外部のAI・CI" sub="お使いの仕組み" />
        <MiniArrow />
        <CycleNode Icon={KeyRound} ring="#FCD34D" iconColor="#D97706" title="APIキーで認証" sub="失効はその場で反映" />
        <MiniArrow />
        <CycleNode Icon={Server} ring="#6EE7B7" iconColor="#059669" title="POST /v1/tickets" sub="親子まとめて" />
        <MiniArrow />
        <CycleNode Icon={Ticket} ring="#6EE7B7" iconColor="#059669" title="チケットになる" sub="番号が返ります" />
      </div>

      <p className="mt-4 text-center text-[11px] text-slate-500 leading-relaxed">
        人が画面を開いて取り込む工程そのものが不要になり、設計が固まった時点でチケットが並びます。
      </p>
    </div>
  );
}

/* ============================================================
 * ㉚ チケット一覧検索（TicketSearchPage.tsx / TicketSearchFilters.tsx /
 *    TicketSearchResults.tsx をトレース）。上部が条件エリア、下が結果の表。
 * ========================================================== */
export function TicketSearchScreen() {
  const rows = [
    { no: 'BRU14-003', sp: '品質改善(8/30〜9/5)', t: 'ブランチ作成機能の追加', cat: '新機能開発', st: 'クローズ', pri: '中', who: '田中 太郎', due: '09/01' },
    { no: 'BRU14-006', sp: '品質改善(8/30〜9/5)', t: '既存の付与済み権限が消える', cat: 'バグ修正', st: 'リリース待ち', pri: '高', who: '佐藤 花子', due: '09/02' },
    { no: 'ENHA2-048', sp: 'エンハンス開発（第二弾）', t: 'チケット一覧検索画面を追加', cat: '新機能開発', st: 'クローズ', pri: '中', who: '田中 太郎', due: '08/29' },
    { no: 'ENHA2-051', sp: 'エンハンス開発（第二弾）', t: '通知テンプレートの整理', cat: '改善', st: '進行中', pri: '低', who: '鈴木 一郎', due: '09/05' },
  ];
  const priColor: Record<string, string> = { 高: '#DC2626', 中: '#D97706', 低: '#0284C7' };
  const stMeta: Record<string, { c: string; bg: string }> = {
    クローズ: { c: '#6B7280', bg: '#F3F4F6' },
    'リリース待ち': { c: '#7C3AED', bg: '#F5F3FF' },
    進行中: { c: '#D97706', bg: '#FFF7ED' },
  };
  return (
    <div className="p-4 sm:p-5 text-left bg-white">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-[10px] bg-emerald-600 flex items-center justify-center shrink-0">
          <ScanSearch className="w-4 h-4 text-white" />
        </div>
        <div>
          <div className="text-[13px] font-bold text-slate-900 leading-tight">一覧検索</div>
          <div className="text-[10px] text-slate-400">DevTicket 開発 · 12 スプリント / 318 チケット</div>
        </div>
      </div>

      {/* 条件エリア */}
      <div className="rounded-[12px] border border-slate-200 bg-slate-50/60 p-2.5 mb-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold text-slate-500 px-2 py-1.5 rounded-lg bg-white border border-slate-200">
            <Search className="w-2.5 h-2.5 text-slate-300" />チケットNo・チケット名・詳細・担当者
          </span>
          <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold text-slate-600 px-2 py-1.5 rounded-lg bg-white border border-slate-200">
            <CalendarRange className="w-2.5 h-2.5 text-slate-400" />2026/08/01 〜 2026/09/05
          </span>
          {[
            { l: 'ステータス', v: '3件選択' },
            { l: '優先度', v: 'すべて' },
            { l: '担当者', v: '2件選択' },
            { l: '分類', v: 'すべて' },
            { l: 'スプリント', v: '2件選択' },
          ].map((f) => (
            <span key={f.l} className={`inline-flex items-center gap-1 text-[9.5px] font-semibold px-2 py-1.5 rounded-lg border ${
              f.v === 'すべて' ? 'bg-white border-slate-200 text-slate-400' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
              {f.l}<ChevronDown className="w-2.5 h-2.5" />
            </span>
          ))}
          <span className="ml-auto text-[9.5px] font-bold text-slate-500">4 / 318 件</span>
        </div>
      </div>

      {/* 結果の表 */}
      <div className="rounded-[12px] border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-2 px-2.5 py-2 bg-slate-50 border-b border-slate-200 text-[9px] font-bold text-slate-500">
          <span className="w-[58px] shrink-0 flex items-center gap-0.5">No<ArrowUpDown className="w-2 h-2 text-slate-300" /></span>
          <span className="w-[86px] shrink-0 flex items-center gap-0.5">スプリント<Filter className="w-2 h-2 text-emerald-500" /></span>
          <span className="flex-1 min-w-0">チケット名</span>
          <span className="w-[52px] shrink-0">分類</span>
          <span className="w-[56px] shrink-0 text-center">ステータス</span>
          <span className="w-[22px] shrink-0 text-center">優先</span>
          <span className="w-[56px] shrink-0">担当者</span>
          <span className="w-[34px] shrink-0">期限</span>
        </div>
        <div className="px-2.5 py-1 bg-emerald-50/70 border-b border-emerald-100 text-[8.5px] font-semibold text-emerald-700 flex items-center gap-1">
          <ArrowDownToLine className="w-2.5 h-2.5 shrink-0" />見出し行は画面の上端で止まり、スクロールしても項目名が見えたままになります
        </div>
        {rows.map((r) => (
          <div key={r.no} className="flex items-center gap-2 px-2.5 py-[7px] border-b border-slate-100 last:border-b-0">
            <span className="w-[58px] shrink-0 text-[9.5px] font-bold text-emerald-700 truncate">{r.no}</span>
            <span className="w-[86px] shrink-0 text-[9px] text-slate-400 truncate">{r.sp}</span>
            <span className="flex-1 min-w-0 text-[10.5px] text-slate-800 truncate">{r.t}</span>
            <span className="w-[52px] shrink-0 text-[9px] text-slate-500 truncate">{r.cat}</span>
            <span className="w-[56px] shrink-0 flex justify-center">
              <span className="text-[8.5px] font-bold px-1.5 py-px rounded-full whitespace-nowrap"
                style={{ color: stMeta[r.st].c, background: stMeta[r.st].bg }}>{r.st}</span>
            </span>
            <span className="w-[22px] shrink-0 text-center text-[9.5px] font-bold" style={{ color: priColor[r.pri] }}>{r.pri}</span>
            <span className="w-[56px] shrink-0 text-[9px] text-slate-500 truncate">{r.who}</span>
            <span className="w-[34px] shrink-0 text-[9px] text-slate-400">{r.due}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * ㉛ GitHub連携タブ（GithubPage.tsx / PullRequestList.tsx をトレース）
 *    PR / Issue / コミット / ブランチ の4タブ。CI・レビュー・マージが1画面に。
 * ========================================================== */
export function GithubPrScreen() {
  const prs = [
    { n: 421, t: 'BRU14-006 GitHub権限の3分割で既存の権限が消える', wbs: 'BRU14-006', ci: 'ok', rev: 'ok', mergeable: true },
    { n: 419, t: 'BRU14-003 ブランチ作成機能の追加と権限の操作別分割', wbs: 'BRU14-003', ci: 'ok', rev: 'wait', mergeable: true },
    { n: 411, t: 'ENHA2-048 チケット一覧検索画面を追加', wbs: 'ENHA2-048', ci: 'ng', rev: 'ok', mergeable: false },
  ];
  return (
    <div className="p-4 sm:p-5 text-left bg-white">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-[10px] bg-slate-900 flex items-center justify-center shrink-0">
            <Github className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-slate-900 leading-tight">GitHub</div>
            <div className="text-[10px] text-slate-400 truncate">MeeceM-Mizoguchi / dev-ticket</div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-[9.5px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white shrink-0">
          <Plus className="w-2.5 h-2.5" />プルリクエストを作成
        </span>
      </div>

      {/* タブ */}
      <div className="flex items-center gap-1 mb-2.5 border-b border-slate-100">
        {[
          { l: 'プルリクエスト', I: GitPullRequest, on: true },
          { l: 'Issue', I: CircleAlert, on: false },
          { l: 'コミット', I: GitCommitHorizontal, on: false },
          { l: 'ブランチ', I: GitBranch, on: false },
        ].map((t) => (
          <span key={t.l} className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold border-b-2 ${
            t.on ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-400'}`}>
            <t.I className="w-3 h-3" />{t.l}
          </span>
        ))}
      </div>

      {/* 一覧 */}
      <div className="rounded-[12px] border border-slate-200 overflow-hidden">
        {prs.map((p) => (
          <div key={p.n} className="flex items-center gap-2 px-2.5 py-2 border-b border-slate-100 last:border-b-0">
            <GitPullRequest className="w-3 h-3 text-emerald-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold text-slate-400 shrink-0">#{p.n}</span>
                <span className="text-[10.5px] text-slate-800 truncate">{p.t}</span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="inline-flex items-center gap-0.5 text-[8.5px] font-bold px-1.5 py-px rounded bg-emerald-50 text-emerald-700">
                  <Ticket className="w-2 h-2" />{p.wbs}
                </span>
                <span className={`inline-flex items-center gap-0.5 text-[8.5px] font-semibold px-1.5 py-px rounded ${
                  p.ci === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  チェック {p.ci === 'ok' ? '✔' : '✕'}
                </span>
                <span className={`inline-flex items-center gap-0.5 text-[8.5px] font-semibold px-1.5 py-px rounded ${
                  p.rev === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  レビュー {p.rev === 'ok' ? '✔' : '…'}
                </span>
              </div>
            </div>
            <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-lg shrink-0 ${
              p.mergeable ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
              <GitMerge className="w-2.5 h-2.5" />{p.mergeable ? 'マージ' : 'マージ不可'}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-slate-400">
        <LockKeyhole className="w-3 h-3 text-emerald-500" />
        閲覧するメンバーに GitHub のアカウントは不要。誰に何を許すかは Dev Ticket 側の権限で決まります
      </div>
    </div>
  );
}

/* ============================================================
 * ㉜ チケット詳細の「関連PR」（TicketPrSection.tsx をトレース）
 *    ブランチ作成 → PR作成 → マージ までをチケットの中で完結させる。
 * ========================================================== */
export function TicketPrScreen() {
  return (
    <div className="p-4 sm:p-5 text-left bg-white">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-[10px] bg-emerald-600 flex items-center justify-center shrink-0">
          <Ticket className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-slate-900 leading-tight truncate">BRU14-003 ブランチ作成機能の追加</div>
          <div className="text-[10px] text-slate-400">リリース待ち · 田中 太郎</div>
        </div>
      </div>

      <div className="rounded-[12px] border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-slate-100">
          <GitPullRequest className="w-3 h-3 text-slate-500 shrink-0" />
          <span className="text-[11px] font-bold text-slate-800">関連PR</span>
          <span className="ml-auto flex items-center gap-1">
            <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-600">
              <GitBranch className="w-2.5 h-2.5" />ブランチを作成
            </span>
            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-md bg-emerald-600 text-white">
              <Plus className="w-2.5 h-2.5" />PRを作成
            </span>
          </span>
        </div>

        {/* このチケットのブランチ */}
        <div className="px-2.5 py-2 border-b border-slate-100 bg-slate-50/60">
          <div className="text-[9px] font-bold text-slate-400 mb-1">このチケットのブランチ</div>
          <div className="flex items-center gap-1.5">
            <GitBranch className="w-2.5 h-2.5 text-slate-400 shrink-0" />
            <span className="font-mono text-[9.5px] text-slate-700 truncate">feature/branch-create</span>
            <span className="text-[8.5px] text-slate-400 shrink-0">← main</span>
            <span className="inline-flex items-center gap-0.5 text-[8.5px] font-semibold px-1.5 py-px rounded bg-white border border-slate-200 text-slate-500 shrink-0">
              <Copy className="w-2 h-2" />コピー
            </span>
          </div>
          <div className="mt-1 text-[8.5px] text-emerald-700">
            名前にチケット番号が無くても、このチケットへの紐付けは Dev Ticket 側に記録されています
          </div>
        </div>

        {/* 紐付いたPR */}
        <div className="flex items-center gap-2 px-2.5 py-2">
          <GitPullRequest className="w-3 h-3 text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10.5px] text-slate-800 truncate">#419 ブランチ作成機能の追加と権限の操作別分割</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[8.5px] font-semibold px-1.5 py-px rounded bg-emerald-50 text-emerald-700">オープン</span>
              <span className="text-[8.5px] font-semibold px-1.5 py-px rounded bg-emerald-50 text-emerald-700">チェック ✔</span>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-lg bg-violet-600 text-white shrink-0">
            <GitMerge className="w-2.5 h-2.5" />マージする
          </span>
        </div>
      </div>

      {/* 未紐付けアラート */}
      <div className="mt-2.5 rounded-[10px] border border-red-200 bg-red-50/70 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
          <span className="text-[9.5px] font-bold text-red-700">PR未紐付け</span>
          <span className="text-[9px] text-red-600">リリース待ち以降なのにPRが紐付いていないチケットは、一覧でも赤く表示されます</span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ㉝ ブランチ作成 → PR作成 → マージ → 本番反映（構図図版）
 * ========================================================== */
export function GithubFlowDiagram() {
  return (
    <div className="text-left">
      <div className="flex justify-center mb-5">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
          <Github className="w-3 h-3" />
          GitHub の画面を開かずに、Dev Ticket の中だけで完結します
        </span>
      </div>

      <div className="flex items-start justify-center gap-1 sm:gap-2">
        <CycleNode Icon={Ticket} ring="#6EE7B7" iconColor="#059669" title="チケット" sub="着手する" />
        <MiniArrow />
        <CycleNode Icon={GitBranch} ring="#93C5FD" iconColor="#2563EB" title="ブランチ作成" sub="名前は自由" />
        <MiniArrow />
        <CycleNode Icon={GitPullRequest} ring="#93C5FD" iconColor="#2563EB" title="PR作成" sub="自動で紐付く" />
        <MiniArrow />
        <CycleNode Icon={GitMerge} ring="#C4B5FD" iconColor="#7C3AED" title="マージ" sub="CI・レビュー確認" />
        <MiniArrow />
        <CycleNode Icon={Workflow} ring="#6EE7B7" iconColor="#059669" title="本番反映を確認" sub="届いたかを観測" />
      </div>

      <p className="mt-4 text-center text-[11px] text-slate-500 leading-relaxed">
        操作ごとに権限を分けられるので、「ブランチは切らせたいが main へのマージはさせない」も表現できます。
      </p>
    </div>
  );
}
