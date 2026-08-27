import { useState, useEffect, useLayoutEffect, useRef, Fragment } from 'react';
import { useNavigate, Link, useLocation } from 'react-router';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { CheckCircle2, LayoutDashboard, Ticket, Users, FolderKanban, BarChart3, Shield, Clock, ArrowRight, CheckCheck, Building2, MessageSquare, Search, Bell, Download, Lock, GitPullRequest, SlidersHorizontal, ListPlus, GitMerge, Tag, Activity, Timer, Link2, Layers, BookOpen, ClipboardList, Rocket, Zap, CalendarRange, UserCog, BellRing, Paperclip, ArrowRightLeft, ChevronLeft, ChevronRight, Bot, Play, Pause, GitBranch, Menu, X, Fingerprint, AppWindow, Monitor, Tablet, Smartphone, Sparkles, Brain, Target, Scale, TrendingUp, RotateCcw, RotateCw, UserRound, Moon, Github, AlertTriangle, RefreshCw, ShieldCheck, CircleDot, GitCommitHorizontal, type LucideIcon } from 'lucide-react';
import { MockDashboard } from '@/app/components/lp/mocks/MockDashboard';
import { MockSprintList } from '@/app/components/lp/mocks/MockSprintList';
import { MockSprintBoard } from '@/app/components/lp/mocks/MockSprintBoard';
import { MockSprintGantt } from '@/app/components/lp/mocks/MockSprintGantt';
import { MockProjects } from '@/app/components/lp/mocks/MockProjects';
import { MockMembers } from '@/app/components/lp/mocks/MockMembers';
import { DemoVideoPage } from '@/app/pages/lp/DemoVideoPage';
import { DemoInteractivePage } from '@/app/pages/lp/DemoInteractivePage';
import { FeaturePreviewModal } from '@/app/components/lp/FeaturePreviewModal';
import { NEWS, NewsCategoryBadge } from '@/app/pages/lp/news/newsRegistry';

// ─── Storyboard: browser/app chrome wrappers ───────────────────────────────
function StoryBrowser({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm text-left">
      <div className="bg-slate-800 px-3 py-1.5 flex items-center gap-2">
        <div className="flex gap-1">
          <div className="w-2 h-2 rounded-full bg-red-400"/><div className="w-2 h-2 rounded-full bg-yellow-400"/><div className="w-2 h-2 rounded-full bg-green-400"/>
        </div>
        <div className="bg-slate-700 rounded px-2 py-0.5 flex-1 min-w-0">
          <span className="text-slate-400 text-[9px] truncate block">{url}</span>
        </div>
      </div>
      <div className="bg-white">{children}</div>
    </div>
  );
}
// ─── AI section: 循環（サイクル）図の各ステップノード ──────────────────────────
function CycleNode({ Icon, tone, title, sub }: { Icon: LucideIcon; tone: 'teal' | 'emerald'; title: string; sub: string }) {
  const ring = tone === 'teal' ? '#5eead4' : '#6ee7b7';
  const color = tone === 'teal' ? '#0d9488' : '#059669';
  return (
    <div className="flex flex-col items-center text-center" style={{ width: 78 }}>
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-1 bg-white shadow-sm" style={{ border: `2px solid ${ring}` }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <p className="text-[11px] font-black text-slate-800 leading-tight whitespace-nowrap">{title}</p>
      <p className="text-[9.5px] text-slate-400 leading-tight whitespace-nowrap">{sub}</p>
    </div>
  );
}

// ─── Native app section: MacBook / iPad device frames ──────────────────────
// 固定px設計(1180幅)のダッシュボードを transform:scale で枠幅に縮小し、
// 実スクショを縮小したような見た目にする（直接埋め込むと文字が巨大化して崩れる）。
function ScaledDashboard() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const DW = 1180, DH = Math.round((DW * 9) / 16); // 設計解像度（16:9）
  const scale = w / DW;
  return (
    <div ref={ref} style={{ width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', background: '#F4F5F6' }}>
      <div style={{ width: DW, height: DH, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <MockDashboard fillHeight />
      </div>
    </div>
  );
}
function MacBookFrame() {
  return (
    <div style={{ width: '100%' }}>
      {/* 画面（液晶パネル + ベゼル） */}
      <div style={{ position: 'relative', background: 'linear-gradient(180deg,#2b2c30,#141416)', borderRadius: '14px 14px 4px 4px', padding: '12px 12px 13px', boxShadow: '0 30px 64px rgba(0,0,0,0.5)' }}>
        {/* インカメラ */}
        <div style={{ position: 'absolute', top: 5, left: '50%', transform: 'translateX(-50%)', width: 5, height: 5, borderRadius: '50%', background: '#0b0b0d', border: '1px solid #2c2c2e' }} />
        <div style={{ borderRadius: 4, overflow: 'hidden' }}>
          <ScaledDashboard />
        </div>
      </div>
      {/* ヒンジ・底面（画面より少し広い） */}
      <div style={{ position: 'relative', width: '112%', marginLeft: '-6%', height: 15, background: 'linear-gradient(180deg,#dadde2,#a6aab1)', borderRadius: '0 0 11px 11px', boxShadow: '0 20px 28px rgba(0,0,0,0.4)' }}>
        {/* ノッチ（開閉用くぼみ） */}
        <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '22%', height: 7, background: 'linear-gradient(180deg,#8d9198,#c2c6cc)', borderRadius: '0 0 8px 8px' }} />
      </div>
    </div>
  );
}
function IPadFrame() {
  return (
    <div style={{ width: '100%', position: 'relative', background: 'linear-gradient(150deg,#3a3b3f,#141416)', borderRadius: 20, padding: 10, boxShadow: '0 28px 56px rgba(0,0,0,0.55)' }}>
      {/* インカメラ（横向き時：上辺中央） */}
      <div style={{ position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: '#0b0b0d' }} />
      <div style={{ borderRadius: 10, overflow: 'hidden' }}>
        <ScaledDashboard />
      </div>
    </div>
  );
}
function DtBar({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 border-b border-slate-800">
      <div className="w-5 h-5 rounded-md bg-teal-500 flex items-center justify-center flex-shrink-0">
        <Ticket className="w-3 h-3 text-white" />
      </div>
      <span className="text-white text-[10px] font-bold">Dev Ticket</span>
      <ChevronRight className="w-3 h-3 text-slate-500 flex-shrink-0" />
      <span className="text-slate-400 text-[9px] truncate">{path}</span>
    </div>
  );
}
function AgentBar() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-orange-950 border-b border-orange-900">
      <div className="w-5 h-5 rounded-md bg-orange-400 flex items-center justify-center flex-shrink-0">
        <Bot className="w-3 h-3 text-white" />
      </div>
      <span className="text-orange-100 text-[10px] font-bold">エージェント管理システム</span>
      <span className="ml-auto bg-orange-400 text-orange-950 text-[7px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">devticket連携</span>
    </div>
  );
}

// ─── Storyboard: slide screen components ───────────────────────────────────
function ScrRouteSelect({ active }: { active: number }) {
  const routes = [
    { label: 'グループ企業内',  cls: active===0 ? 'border-teal-500 bg-teal-50 text-teal-700 font-bold'     : 'border-slate-200 text-slate-400' },
    { label: '会員エンジニア',  cls: active===1 ? 'border-blue-500 bg-blue-50 text-blue-700 font-bold'     : 'border-slate-200 text-slate-400' },
    { label: 'パートナー企業',  cls: active===2 ? 'border-violet-500 bg-violet-50 text-violet-700 font-bold': 'border-slate-200 text-slate-400' },
    { label: 'エージェント連携',cls: active===3 ? 'border-orange-500 bg-orange-50 text-orange-700 font-bold': 'border-slate-200 text-slate-400' },
  ];
  return (
    <StoryBrowser url="dev-ticket.jp/sprint/DT-289">
      <DtBar path="チケット詳細 #DT-289" />
      <div className="p-3">
        <div className="flex items-start justify-between mb-2">
          <div><p className="text-[8px] text-slate-400 font-mono">#DT-289</p><p className="text-xs font-bold text-slate-800">ログイン機能改修</p></div>
          <span className="px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-600 text-[8px] rounded font-semibold">未対応</span>
        </div>
        <div className="flex gap-1 flex-wrap mb-2.5">
          <span className="bg-blue-50 border border-blue-100 text-blue-600 px-1.5 py-0.5 rounded text-[8px]">React</span>
          <span className="bg-blue-50 border border-blue-100 text-blue-600 px-1.5 py-0.5 rounded text-[8px]">TypeScript</span>
          <span className="bg-red-50 border border-red-100 text-red-500 px-1.5 py-0.5 rounded text-[8px]">高優先度</span>
        </div>
        <button className="w-full bg-teal-500 text-white text-[10px] font-bold py-1.5 rounded-lg mb-2.5">担当を探す ▾</button>
        <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
          <p className="text-[8px] text-slate-500 mb-1.5 font-semibold">調達ルートを選択</p>
          <div className="grid grid-cols-2 gap-1">
            {routes.map((r,i) => <div key={i} className={`px-1.5 py-1 rounded border text-[9px] text-center ${r.cls}`}>{r.label}</div>)}
          </div>
        </div>
      </div>
    </StoryBrowser>
  );
}
function ScrGroupAdminList() {
  return (
    <StoryBrowser url="dev-ticket.jp/group/requests">
      <DtBar path="グループ企業内 › 案件一覧" />
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-slate-800">グループ内案件</p>
          <span className="bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">新着 1</span>
        </div>
        <div className="border border-teal-200 rounded-xl bg-teal-50 p-2.5">
          <div className="flex items-start gap-2 mb-2">
            <span className="bg-teal-500 text-white text-[7px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 flex-shrink-0">NEW</span>
            <div className="flex-1 min-w-0">
              <p className="text-[8px] text-teal-600 font-mono">#DT-289 / A社</p>
              <p className="text-xs font-bold text-slate-800">ログイン機能改修</p>
              <div className="flex gap-1 mt-0.5">
                <span className="bg-white border border-blue-200 text-blue-600 text-[7px] px-1 py-0.5 rounded">React</span>
                <span className="bg-white border border-blue-200 text-blue-600 text-[7px] px-1 py-0.5 rounded">TypeScript</span>
              </div>
            </div>
          </div>
          <button className="w-full bg-teal-500 text-white text-[9px] font-bold py-1 rounded-lg">担当者を割り当てる →</button>
        </div>
      </div>
    </StoryBrowser>
  );
}
function ScrGroupAssign() {
  return (
    <StoryBrowser url="dev-ticket.jp/group/requests/DT-289/assign">
      <DtBar path="#DT-289 › 担当者を割り当て" />
      <div className="p-3">
        <p className="text-[9px] text-slate-500 mb-2">社内メンバーを選択してアサイン</p>
        {([{n:'田中 太郎',sk:['React','TS'],sel:true},{n:'佐藤 花子',sk:['TS','Node'],sel:false}] as const).map((m,i)=>(
          <div key={i} className="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
            <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
              <span className="text-[9px] font-bold text-teal-700">{m.n[0]}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-slate-800">{m.n}</p>
              <div className="flex gap-1">{m.sk.map(s=><span key={s} className="text-[7px] bg-teal-50 text-teal-600 px-1 py-0.5 rounded">{s}</span>)}</div>
            </div>
            <button className={`text-[8px] font-bold px-2 py-1 rounded-lg flex-shrink-0 ${m.sel?'bg-teal-500 text-white':'bg-slate-100 text-slate-500'}`}>{m.sel?'アサイン ✓':'アサイン'}</button>
          </div>
        ))}
      </div>
    </StoryBrowser>
  );
}
function ScrFLRecruitList() {
  return (
    <StoryBrowser url="dev-ticket.jp/recruit">
      <DtBar path="案件一覧（会員エンジニア向け）" />
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[8px] font-semibold text-slate-500">スキルマッチ案件</span>
          <span className="bg-blue-500 text-white text-[7px] font-bold px-1.5 py-0.5 rounded-full">1件</span>
        </div>
        <div className="border border-blue-200 rounded-xl bg-blue-50 p-2.5">
          <div className="flex items-start justify-between mb-1.5">
            <div><p className="text-[8px] text-blue-600 font-mono">#DT-289</p><p className="text-xs font-bold text-slate-800">ログイン機能改修</p></div>
            <span className="bg-blue-500 text-white text-[7px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">マッチ◎</span>
          </div>
          <div className="flex gap-1 mb-2">
            <span className="bg-white border border-blue-200 text-blue-600 text-[7px] px-1 py-0.5 rounded">React</span>
            <span className="bg-white border border-blue-200 text-blue-600 text-[7px] px-1 py-0.5 rounded">TypeScript</span>
          </div>
          <div className="flex items-center justify-between text-[8px] text-slate-500">
            <span>📅 〆切: 2025/07/01</span><span>報酬: 要相談</span>
          </div>
        </div>
      </div>
    </StoryBrowser>
  );
}
function ScrFLApply() {
  return (
    <StoryBrowser url="dev-ticket.jp/recruit/DT-289">
      <DtBar path="案件詳細 #DT-289" />
      <div className="p-3">
        <p className="text-[8px] text-slate-400 font-mono mb-1">#DT-289</p>
        <p className="text-xs font-bold text-slate-800 mb-2">ログイン機能改修</p>
        <div className="flex gap-1 mb-2.5">
          <span className="bg-blue-50 border border-blue-200 text-blue-600 text-[8px] px-1.5 py-0.5 rounded">React</span>
          <span className="bg-blue-50 border border-blue-200 text-blue-600 text-[8px] px-1.5 py-0.5 rounded">TypeScript</span>
          <span className="bg-red-50 border border-red-200 text-red-500 text-[8px] px-1.5 py-0.5 rounded">高優先</span>
        </div>
        <p className="text-[9px] text-slate-600 mb-3 leading-relaxed">MFAを含むログイン機能の改修。セキュリティ強化と既存テストの更新を含む。</p>
        <button className="w-full bg-blue-500 text-white text-[11px] font-bold py-2 rounded-xl">この案件に応募する →</button>
      </div>
    </StoryBrowser>
  );
}
function ScrApproval() {
  return (
    <StoryBrowser url="dev-ticket.jp/sprint/DT-289/applicants">
      <DtBar path="#DT-289 › 応募者一覧" />
      <div className="p-3">
        <p className="text-[9px] text-slate-500 mb-2">応募者 <span className="font-bold text-slate-800">1名</span></p>
        <div className="border border-slate-200 rounded-xl p-2.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[10px] font-bold">山</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-800">山田 太朗</p>
              <div className="flex gap-2">
                <span className="text-[7px] text-slate-500">React ★★★★☆</span>
                <span className="text-[7px] text-slate-500">TS ★★★★☆</span>
              </div>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button className="flex-1 bg-slate-100 text-slate-500 text-[8px] font-semibold py-1 rounded-lg">プロフィール</button>
            <button className="flex-1 bg-teal-500 text-white text-[8px] font-bold py-1 rounded-lg">承認・アサイン ✓</button>
          </div>
        </div>
      </div>
    </StoryBrowser>
  );
}
function ScrPartnerNotify() {
  return (
    <StoryBrowser url="dev-ticket.jp/notifications">
      <DtBar path="通知センター" />
      <div className="p-3">
        <div className="border border-violet-200 rounded-xl bg-violet-50 p-2.5">
          <div className="flex items-start gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bell className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[8px] font-bold text-violet-700">パートナー案件 — 新着</span>
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"/>
              </div>
              <p className="text-[9px] font-bold text-slate-800">A社より「ログイン機能改修」</p>
              <p className="text-[8px] text-slate-500 mt-0.5">#DT-289 · React · TypeScript</p>
            </div>
          </div>
          <button className="w-full mt-2 bg-violet-500 text-white text-[9px] font-bold py-1 rounded-lg">案件を確認して担当者を割り当てる →</button>
        </div>
      </div>
    </StoryBrowser>
  );
}
function ScrPartnerAssign() {
  return (
    <StoryBrowser url="dev-ticket.jp/partner/requests/DT-289/assign">
      <DtBar path="受注案件 #DT-289 › 担当者を選ぶ" />
      <div className="p-3">
        <p className="text-[9px] text-slate-500 mb-2">自社メンバーをアサイン</p>
        {([{n:'鈴木 一郎',sk:['React','TS'],sel:true},{n:'高橋 美奈',sk:['Node','TS'],sel:false}] as const).map((m,i)=>(
          <div key={i} className="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
            <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
              <span className="text-[9px] font-bold text-violet-700">{m.n[0]}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-slate-800">{m.n}</p>
              <div className="flex gap-1">{m.sk.map(s=><span key={s} className="text-[7px] bg-violet-50 text-violet-600 px-1 py-0.5 rounded">{s}</span>)}</div>
            </div>
            <button className={`text-[8px] font-bold px-2 py-1 rounded-lg flex-shrink-0 ${m.sel?'bg-violet-500 text-white':'bg-slate-100 text-slate-500'}`}>{m.sel?'アサイン ✓':'アサイン'}</button>
          </div>
        ))}
      </div>
    </StoryBrowser>
  );
}
function ScrAgentSystem() {
  return (
    <StoryBrowser url="agent-system.co.jp/dashboard">
      <AgentBar />
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[9px] font-semibold text-slate-700">新着案件（API受信）</span>
          <span className="bg-orange-500 text-white text-[7px] font-bold px-1.5 py-0.5 rounded-full">1件</span>
        </div>
        <div className="border border-orange-200 rounded-xl bg-orange-50 p-2.5">
          <div className="flex items-start justify-between mb-1.5">
            <div><p className="text-[7px] text-orange-600 font-mono">devticket #DT-289</p><p className="text-xs font-bold text-slate-800">ログイン機能改修</p></div>
            <span className="bg-orange-500 text-white text-[7px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">新着</span>
          </div>
          <div className="flex gap-1 mb-1.5">
            <span className="bg-white border border-orange-200 text-orange-600 text-[7px] px-1 py-0.5 rounded">React</span>
            <span className="bg-white border border-orange-200 text-orange-600 text-[7px] px-1 py-0.5 rounded">TypeScript</span>
          </div>
          <p className="text-[7px] text-slate-500">📅 〆切: 2025/07/01</p>
        </div>
      </div>
    </StoryBrowser>
  );
}
function ScrAgentApply() {
  return (
    <StoryBrowser url="agent-system.co.jp/requests/dt-289">
      <AgentBar />
      <div className="p-3">
        <p className="text-[8px] text-slate-500 mb-2">案件への対応方法を選択</p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2">
            <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
              <Users className="w-3 h-3 text-orange-600" />
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-800">フリーランスが自己申請</p>
              <p className="text-[7px] text-slate-500">登録者に公開して応募を受け付ける</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-orange-500 rounded-lg p-2">
            <div className="w-6 h-6 rounded-full bg-orange-400 flex items-center justify-center flex-shrink-0">
              <ArrowRight className="w-3 h-3 text-white" />
            </div>
            <div>
              <p className="text-[9px] font-bold text-white">担当者を直接指名</p>
              <p className="text-[7px] text-orange-100">最適なFLをエージェントが選んでアサイン</p>
            </div>
          </div>
        </div>
      </div>
    </StoryBrowser>
  );
}
function ScrCodeSubmit() {
  return (
    <StoryBrowser url="dev-ticket.jp/sprint/DT-289/submit">
      <DtBar path="#DT-289 › 成果物の提出" />
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2.5">
          <CheckCircle2 className="w-4 h-4 text-teal-500 flex-shrink-0" />
          <p className="text-xs font-bold text-slate-800">実装が完了しました</p>
        </div>
        <div className="bg-slate-900 rounded-lg p-2.5 mb-2 font-mono">
          <p className="text-[8px] text-green-400">{'// ログイン機能改修完了'}</p>
          <p className="text-[8px] text-blue-300">{'const handleLogin = async () => {'}</p>
          <p className="text-[8px] text-slate-400">{'  // MFA実装済み...'}</p>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="h-px bg-slate-100 flex-1"/><span className="text-[8px] text-slate-400">または</span><div className="h-px bg-slate-100 flex-1"/>
        </div>
        <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg mb-2.5">
          <GitPullRequest className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
          <span className="text-[9px] text-slate-700 truncate">github.com/org/repo/pull/42</span>
        </div>
        <button className="w-full bg-teal-500 text-white text-[9px] font-bold py-1.5 rounded-lg">レビュー依頼を送る →</button>
      </div>
    </StoryBrowser>
  );
}
function ScrReviewDone() {
  return (
    <StoryBrowser url="dev-ticket.jp/sprint/DT-289/review">
      <DtBar path="#DT-289 › レビュー" />
      <div className="p-3">
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 mb-2.5">
          <p className="text-[8px] text-slate-500 mb-1.5">田中 太郎 の成果物を確認</p>
          <div className="bg-slate-900 rounded p-1.5 font-mono">
            <p className="text-[7px] text-green-400">{'+ const handleLogin = async () => {'}</p>
            <p className="text-[7px] text-green-400">{'+ // MFA対応実装済み ✓'}</p>
          </div>
        </div>
        <button className="w-full bg-green-500 text-white text-[10px] font-bold py-1.5 rounded-lg mb-2">✓ 承認してチケットを完了</button>
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-2">
          <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
          <div>
            <p className="text-[9px] font-bold text-green-700">チケット完了 🎉</p>
            <p className="text-[8px] text-green-600">#DT-289 ステータス: 完了</p>
          </div>
        </div>
      </div>
    </StoryBrowser>
  );
}

// ─── Storyboard route + slide data ─────────────────────────────────────────
const STORY_ROUTES = [
  {
    id: 'group', label: 'グループ企業内', labelShort: 'グループ',
    icon: Building2, hex: '#0d9488', hexBg: '#f0fdfa', hexText: '#0f766e',
    slides: [
      { step:1, title:'チケットで担当を探す', actor:'PM / チームリーダー', actorLabel:'チケット作成側', screen:<ScrRouteSelect active={0}/>,
        desc:'スプリントのチケット詳細画面で「担当を探す」をクリック。調達ルートの一覧から「グループ企業内」を選択します。' },
      { step:2, title:'グループ専用ページに案件掲載', actor:'システム（自動）', actorLabel:'Dev Ticket', screen:<ScrGroupAdminList/>,
        desc:'グループ会社の管理者・PMだけが閲覧できる専用ページにチケット情報が自動掲載されます。社外には一切公開されません。' },
      { step:3, title:'管理者が担当者をアサイン', actor:'グループ会社の管理者 / PM', actorLabel:'グループ会社側', screen:<ScrGroupAssign/>,
        desc:'グループ会社の管理者やPMが社内メンバーを確認し、最適な担当者を選んでチケットにアサインします。' },
      { step:4, title:'実装完了・成果物を提出', actor:'担当エンジニア', actorLabel:'グループ会社側', screen:<ScrCodeSubmit/>,
        desc:'アサインされたエンジニアが実装完了後、コードを貼り付けるか GitHub PR のリンクを共有してレビュー依頼を送ります。' },
      { step:5, title:'レビュー承認 → チケット完了', actor:'PM / チームリーダー', actorLabel:'チケット作成側', screen:<ScrReviewDone/>,
        desc:'コードをレビューして問題がなければ「承認」。チケットが完了ステータスになりフローが終了します。' },
    ],
  },
  {
    id: 'freelance', label: '会員エンジニア', labelShort: '会員FL',
    icon: Users, hex: '#3b82f6', hexBg: '#eff6ff', hexText: '#1d4ed8',
    slides: [
      { step:1, title:'チケットで担当を探す', actor:'PM / チームリーダー', actorLabel:'チケット作成側', screen:<ScrRouteSelect active={1}/>,
        desc:'「担当を探す」から「会員エンジニア」を選択。スキルタグでマッチする登録エンジニアへの募集を開始します。' },
      { step:2, title:'スキルマッチした会員に案件公開', actor:'システム（自動）', actorLabel:'Dev Ticket', screen:<ScrFLRecruitList/>,
        desc:'チケットのスキルタグに合致する Dev Ticket 登録エンジニアだけに、募集案件として自動表示されます。' },
      { step:3, title:'エンジニアが案件に応募', actor:'登録エンジニア（フリーランス）', actorLabel:'エンジニア側', screen:<ScrFLApply/>,
        desc:'案件一覧でチケットを発見したエンジニアが詳細を確認し、「応募する」ボタンで申請します。' },
      { step:4, title:'企業が応募者を承認・アサイン', actor:'PM / チームリーダー', actorLabel:'チケット作成側', screen:<ScrApproval/>,
        desc:'応募者のスキルやプロフィールを確認したうえで担当させたいエンジニアを「承認」。チケットに正式アサインされます。' },
      { step:5, title:'実装完了・成果物を提出', actor:'担当エンジニア', actorLabel:'エンジニア側', screen:<ScrCodeSubmit/>,
        desc:'アサインされたエンジニアが実装完了後、コードまたは GitHub PR リンクを提出してレビューを依頼します。' },
      { step:6, title:'レビュー承認 → チケット完了', actor:'PM / チームリーダー', actorLabel:'チケット作成側', screen:<ScrReviewDone/>,
        desc:'レビューして承認するとチケットが完了。外部エンジニアとの業務委託フローがクローズします。' },
    ],
  },
  {
    id: 'partner', label: 'パートナー企業', labelShort: 'パートナー',
    icon: Building2, hex: '#7c3aed', hexBg: '#f5f3ff', hexText: '#5b21b6',
    slides: [
      { step:1, title:'チケットで担当を探す', actor:'PM / チームリーダー', actorLabel:'チケット作成側', screen:<ScrRouteSelect active={2}/>,
        desc:'「担当を探す」から「パートナー企業」を選択。連携設定済みのパートナー会社へのチケット公開を開始します。' },
      { step:2, title:'パートナー企業の管理者に通知', actor:'システム（自動）', actorLabel:'Dev Ticket', screen:<ScrPartnerNotify/>,
        desc:'連携設定済みのパートナー企業（他の Dev Ticket 利用企業）の管理者・PMに、新規チケット案件の通知が届きます。' },
      { step:3, title:'パートナー企業が担当者をアサイン', actor:'パートナー企業の管理者 / PM', actorLabel:'パートナー企業側', screen:<ScrPartnerAssign/>,
        desc:'通知を受けたパートナー企業の管理者が自社エンジニアを確認し、適切な担当者を選んでアサインします。' },
      { step:4, title:'実装完了・成果物を提出', actor:'パートナー企業のエンジニア', actorLabel:'パートナー企業側', screen:<ScrCodeSubmit/>,
        desc:'アサインされたエンジニアが実装完了後、コードまたは GitHub PR リンクを提出してレビューを依頼します。' },
      { step:5, title:'レビュー承認 → チケット完了', actor:'PM / チームリーダー', actorLabel:'チケット作成側', screen:<ScrReviewDone/>,
        desc:'チケット作成側がレビューして承認すると、企業間リソースシェアフローが完了します。' },
    ],
  },
  {
    id: 'agent', label: 'エージェント連携', labelShort: 'エージェント',
    icon: Bot, hex: '#f97316', hexBg: '#fff7ed', hexText: '#c2410c',
    slides: [
      { step:1, title:'チケットで担当を探す', actor:'PM / チームリーダー', actorLabel:'チケット作成側', screen:<ScrRouteSelect active={3}/>,
        desc:'「担当を探す」から「エージェント連携」を選択。連携契約を結んでいるエージェント会社へのチケット公開を開始します。' },
      { step:2, title:'エージェント社内システムに案件連携', actor:'システム（自動 / API連携）', actorLabel:'Dev Ticket', screen:<ScrAgentSystem/>,
        desc:'Dev TicketからAPI経由でチケット情報が送信され、エージェント会社の独立した管理システムに案件として掲載されます。' },
      { step:3, title:'フリーランスが応募 / エージェントが指名', actor:'エージェント会社 / 登録フリーランス', actorLabel:'エージェント側', screen:<ScrAgentApply/>,
        desc:'エージェント会社の登録フリーランスが自ら応募するか、エージェント担当者が最適な人材を選んで指名します。' },
      { step:4, title:'企業が最終承認・アサイン', actor:'PM / チームリーダー', actorLabel:'チケット作成側', screen:<ScrApproval/>,
        desc:'エージェント経由での応募・指名を Dev Ticket 上で確認。問題なければ承認してチケットに正式アサインします。' },
      { step:5, title:'実装完了・成果物を提出', actor:'エージェント登録フリーランス', actorLabel:'エージェント側', screen:<ScrCodeSubmit/>,
        desc:'アサインされたフリーランスが実装完了後、コードを提出または GitHub PR を作成してレビュー依頼を送ります。' },
      { step:6, title:'レビュー承認 → チケット完了', actor:'PM / チームリーダー', actorLabel:'チケット作成側', screen:<ScrReviewDone/>,
        desc:'チケット作成側がレビュー後に承認するとチケットが完了。エージェント連携によるリソース調達フローが終了します。' },
    ],
  },
];


type DemoMode = 'none' | 'video' | 'interactive';
type FeatureId = 'dashboard' | 'projects' | 'sprint' | 'views' | 'members' | 'clients' | 'review' | 'comments' | 'search' | 'slack' | 'csv' | 'permissions' | 'filter' | 'bulk';

// ─── GitHub連携セクション ──────────────────────────────────────────────────
// GitHub の色に寄せた暗色パネル。GitHub 由来の要素だけ GitHub の配色を使い、
// Dev Ticket 側の要素はプロダクトのエメラルドで出す（本体アプリと同じ使い分け）。
const GH = {
  bg: '#0d1117', panel: '#161b22', head: '#1c2128', border: '#30363d',
  text: '#e6edf3', muted: '#8b949e', green: '#3fb950', btn: '#238636',
  red: '#f85149', purple: '#a371f7', yellow: '#d29922', blue: '#58a6ff',
};

const GH_STEPS = [
  {
    icon: GitBranch,
    label: 'ブランチを検知',
    title: 'push しただけで、\nPR未作成のブランチが並ぶ',
    desc: 'ブランチ名に含まれるチケット番号を手がかりに、「まだプルリクエストが作られていないブランチ」だけを拾い上げます。GitHub を開いて探す必要はありません。',
  },
  {
    icon: GitPullRequest,
    label: 'PRを作成',
    title: 'タイトルも本文も、\n下書きまで済んでいる',
    desc: 'チケットの件名と内容を読み込んで、プルリクエストの下書きを自動生成。そのまま Dev Ticket の画面から作成でき、作成した PR はチケットへ自動で紐付きます。',
  },
  {
    icon: AlertTriangle,
    label: 'コンフリクト検知',
    title: 'マージできない理由を、\n押す前に日本語で',
    desc: 'コンフリクト・必須チェック未通過・レビュー不足・ベースブランチより古い。理由を先に出すので、GitHub 側で弾かれてから戻ってくることがありません。',
  },
  {
    icon: GitMerge,
    label: 'マージ＆自動反映',
    title: 'まとめてマージ、\nチケットは自動でリリース済みへ',
    desc: '複数の PR を選んで一括マージ。マージ方法も選べます。既定ブランチに入った PR に紐付くチケットは、自動で「リリース済み」まで進みます。',
  },
];

/** モックパネル内の小さなタブ（プルリクエスト／Issue／コミット／ブランチ） */
function GhTab({ label, active }: { label: string; active?: boolean }) {
  return (
    <span
      className="px-2 sm:px-2.5 py-1 rounded-md text-[10px] sm:text-[11px] font-bold whitespace-nowrap"
      style={{ color: active ? GH.text : GH.muted, background: active ? 'rgba(110,118,129,0.22)' : 'transparent' }}
    >
      {label}
    </span>
  );
}

/** 状態バッジ（CI通過・コンフリクト など） */
function GhChip({ icon: Icon, label, color }: { icon: LucideIcon; label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color, background: `${color}1f`, border: `1px solid ${color}59` }}>
      <Icon className="w-3 h-3" />{label}
    </span>
  );
}

/** ステップごとの画面モック（実画面の要素をそのまま縮めたもの） */
function GhMock({ step }: { step: number }) {
  const rowBase = 'flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3';

  if (step === 0) {
    const branches = [
      { name: 'DEMO-104/list-filter', wbs: 'DEMO-104', at: '4分前', hot: true },
      { name: 'DEMO-103/file-rename', wbs: 'DEMO-103', at: '1時間前' },
      { name: 'DEMO-102/input-fix', wbs: 'DEMO-102', at: '昨日' },
    ];
    return (
      <div>
        <div className="px-3 sm:px-4 py-2 text-[11px] font-bold flex items-center gap-2" style={{ color: GH.muted, borderBottom: `1px solid ${GH.border}` }}>
          <GitBranch className="w-3.5 h-3.5" style={{ color: GH.yellow }} />
          まだプルリクエストが作られていないブランチ
          <span className="ml-auto" style={{ color: GH.text }}>3件</span>
        </div>
        {branches.map(b => (
          <div key={b.name} className={rowBase} style={{ borderBottom: `1px solid ${GH.border}`, background: b.hot ? 'rgba(63,185,80,0.06)' : 'transparent' }}>
            <GitBranch className="w-4 h-4 flex-shrink-0" style={{ color: GH.muted }} />
            <div className="min-w-0">
              <p className="text-[11px] sm:text-xs font-mono truncate" style={{ color: GH.text }}>{b.name}</p>
              <p className="text-[10px] mt-0.5" style={{ color: GH.muted }}>
                <span style={{ color: '#6EE7B7' }}>{b.wbs}</span> のチケットに一致 ・ {b.at}
              </p>
            </div>
            <span
              className="ml-auto flex-shrink-0 rounded-md px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] font-bold"
              style={b.hot
                ? { background: GH.btn, color: '#fff', boxShadow: '0 0 0 3px rgba(63,185,80,0.18)' }
                : { color: GH.text, background: 'rgba(110,118,129,0.15)', border: `1px solid ${GH.border}` }}
            >
              PRを作成
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="rounded-md px-2 py-1 text-[10px] sm:text-[11px] font-mono" style={{ background: 'rgba(110,118,129,0.18)', color: GH.text, border: `1px solid ${GH.border}` }}>DEMO-104/list-filter</span>
          <ArrowRight className="w-3.5 h-3.5" style={{ color: GH.muted }} />
          <span className="rounded-md px-2 py-1 text-[10px] sm:text-[11px] font-mono" style={{ background: 'rgba(110,118,129,0.18)', color: GH.text, border: `1px solid ${GH.border}` }}>main</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: '#6EE7B7' }}>
            <Sparkles className="w-3 h-3" />チケットから自動入力
          </span>
        </div>
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: GH.muted }}>タイトル</p>
          <div className="rounded-md px-2.5 py-2 text-[11px] sm:text-xs" style={{ background: GH.bg, border: `1px solid ${GH.blue}`, color: GH.text, boxShadow: `0 0 0 3px ${GH.blue}26` }}>
            DEMO-104 一覧に絞り込みを追加
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: GH.muted }}>本文</p>
          <div className="rounded-md px-2.5 py-2 text-[11px] leading-relaxed space-y-1" style={{ background: GH.bg, border: `1px solid ${GH.border}`, color: GH.muted }}>
            <p style={{ color: GH.text }}>## 概要</p>
            <p>一覧に絞り込み条件を追加し、状態を保持できるようにする。</p>
            <p className="font-mono" style={{ color: GH.blue }}>Ticket: DEMO-104</p>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="rounded-md px-2.5 py-1.5 text-[11px] font-bold" style={{ color: GH.text, background: 'rgba(110,118,129,0.15)', border: `1px solid ${GH.border}` }}>Draft で作成</span>
          <span className="rounded-md px-3 py-1.5 text-[11px] font-bold" style={{ background: GH.btn, color: '#fff', boxShadow: '0 0 0 3px rgba(63,185,80,0.18)' }}>プルリクエストを作成</span>
        </div>
      </div>
    );
  }

  const pulls = [
    { n: 12, title: 'DEMO-104 一覧に絞り込みを追加', chip: { icon: CheckCircle2, label: 'マージ可能', color: GH.green }, note: 'CI 通過 ・ レビュー 1件' },
    { n: 11, title: 'DEMO-103 ファイルの名称変更に対応', chip: { icon: AlertTriangle, label: 'コンフリクトがあります', color: GH.red }, note: 'main の変更と競合しています' },
    { n: 10, title: 'DEMO-102 入力欄の確定操作を修正', chip: { icon: Clock, label: '必須チェックが未完了', color: GH.yellow }, note: 'build / test を待っています' },
  ];

  if (step === 2) {
    return (
      <div>
        {pulls.map(p => (
          <div key={p.n} className={rowBase} style={{ borderBottom: `1px solid ${GH.border}`, background: p.chip.color === GH.red ? 'rgba(248,81,73,0.07)' : 'transparent' }}>
            <GitPullRequest className="w-4 h-4 flex-shrink-0" style={{ color: GH.green }} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] sm:text-xs truncate" style={{ color: GH.text }}>
                <span style={{ color: GH.muted }}>#{p.n}</span> {p.title}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <GhChip icon={p.chip.icon} label={p.chip.label} color={p.chip.color} />
                <span className="text-[10px]" style={{ color: GH.muted }}>{p.note}</span>
              </div>
            </div>
            <span
              className="hidden sm:inline-block ml-auto flex-shrink-0 rounded-md px-2.5 py-1 text-[11px] font-bold"
              style={p.chip.color === GH.green
                ? { background: GH.btn, color: '#fff' }
                : { color: 'rgba(230,237,243,0.35)', background: 'rgba(110,118,129,0.1)', border: `1px solid ${GH.border}` }}
            >
              マージ
            </span>
          </div>
        ))}
        <div className="px-3 sm:px-4 py-2.5 text-[10px] sm:text-[11px] flex items-start gap-2" style={{ color: GH.muted }}>
          <Shield className="w-3.5 h-3.5 flex-shrink-0 mt-px" style={{ color: GH.yellow }} />
          マージできない PR はボタン自体が押せません。理由が分かるので、GitHub を開き直す必要がありません。
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="px-3 sm:px-4 py-2 text-[11px] font-bold flex items-center gap-2" style={{ color: GH.muted, borderBottom: `1px solid ${GH.border}` }}>
        <GitMerge className="w-3.5 h-3.5" style={{ color: GH.purple }} />
        まとめてマージ
        <span className="ml-auto" style={{ color: GH.text }}>スカッシュしてマージ</span>
      </div>
      {[
        { n: 12, title: 'DEMO-104 一覧に絞り込みを追加', done: true },
        { n: 10, title: 'DEMO-102 入力欄の確定操作を修正', done: true },
      ].map(p => (
        <div key={p.n} className={rowBase} style={{ borderBottom: `1px solid ${GH.border}` }}>
          <GitMerge className="w-4 h-4 flex-shrink-0" style={{ color: GH.purple }} />
          <p className="text-[11px] sm:text-xs truncate min-w-0 flex-1" style={{ color: GH.text }}>
            <span style={{ color: GH.muted }}>#{p.n}</span> {p.title}
          </p>
          <GhChip icon={CheckCircle2} label="マージ完了" color={GH.purple} />
        </div>
      ))}
      <div className="p-3 sm:p-4">
        <div className="rounded-xl p-3" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.32)' }}>
          <p className="text-[10px] font-bold mb-2 flex items-center gap-1.5" style={{ color: '#6EE7B7' }}>
            <RefreshCw className="w-3 h-3" />Dev Ticket 側のチケットが自動で進む
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded-md px-2 py-1 text-[10px] sm:text-[11px] font-bold" style={{ background: 'rgba(110,118,129,0.18)', color: GH.muted, textDecoration: 'line-through' }}>リリース待ち</span>
            <ArrowRight className="w-3.5 h-3.5" style={{ color: '#34D399' }} />
            <span className="rounded-md px-2 py-1 text-[10px] sm:text-[11px] font-bold" style={{ background: 'rgba(52,211,153,0.2)', color: '#6EE7B7', border: '1px solid rgba(52,211,153,0.5)' }}>リリース済み</span>
            <span className="text-[10px] ml-auto" style={{ color: GH.muted }}>DEMO-104 ／ DEMO-102</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const GH_FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Users, title: 'メンバーにGitHubアカウントは不要', body: 'GitHub 側の操作は、管理者が App を1回インストールするときだけ。以降 PR を見る・作る・マージするメンバーには GitHub アカウントが要りません。見えるかどうかは Dev Ticket の権限だけで決まります。' },
  { icon: Link2, title: 'チケットとPRが勝手に繋がる', body: 'ブランチ名やタイトルのチケット番号から自動で紐付け。連携した直後には、過去のプルリクエストまで遡って紐付けます。' },
  { icon: AlertTriangle, title: '紐付け漏れを取り逃さない', body: '「リリース待ちまで進んだのに PR が1件も無い」チケットは一覧で赤く表示。PR が発生しない作業は「PR不要」で畳めます。' },
  { icon: GitMerge, title: '複数のPRをまとめてマージ', body: '選んだ PR を順番にマージし、成功と失敗を1件ずつ結果表示。スカッシュ／リベース／マージコミットから選べます。' },
  { icon: RefreshCw, title: 'リリース済みへ自動反映', body: '既定ブランチへ入った PR を毎日検知して、チケットを「リリース済み」へ。すぐ反映したいときは手動同期ボタンで。' },
  { icon: ShieldCheck, title: '誰が操作したか残る', body: 'マージコミットに実行者名を書き込み、Dev Ticket 側にも操作ログを保存。アプリ名義でのマージでも、追跡できなくなりません。' },
];

function GithubSection() {
  const [step, setStep] = useState(0);
  const [restart, setRestart] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setStep(s => (s + 1) % GH_STEPS.length), 5200);
    return () => clearInterval(t);
  }, [restart]);

  const current = GH_STEPS[step];

  return (
    <section id="github" className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden" style={{ background: 'linear-gradient(165deg, #010409 0%, #0d1117 45%, #0b1f1a 100%)' }}>
      <style>{`
        @keyframes ghFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .gh-fade { animation: ghFade .45s ease-out both; }
        @keyframes ghBar { from { width: 0%; } to { width: 100%; } }
        .gh-bar { animation: ghBar 5.2s linear both; }
        @keyframes ghPulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }
        .gh-pulse { animation: ghPulse 2s ease-in-out infinite; }
      `}</style>
      {/* 背景デコ */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-24 w-[28rem] h-[28rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(163,113,247,0.18) 0%, transparent 65%)' }} />
        <div className="absolute -bottom-32 -right-20 w-[30rem] h-[30rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(52,211,153,0.16) 0%, transparent 65%)' }} />
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
        {/* 見出し */}
        <div className="text-center mb-10 sm:mb-14">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold mb-5" style={{ background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.42)', color: '#6EE7B7' }}>
            <Sparkles className="w-3.5 h-3.5" />
            NEW — GitHub連携
          </div>
          <h2 className="font-black leading-tight text-3xl sm:text-5xl mb-5" style={{ color: '#fff' }}>
            PRを作る。マージする。<br className="sm:hidden" />
            <span style={{ background: 'linear-gradient(90deg,#34D399,#58a6ff)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>GitHubを開かずに。</span>
          </h2>
          <p className="text-sm sm:text-lg leading-relaxed max-w-3xl mx-auto" style={{ color: 'rgba(230,237,243,0.72)' }}>
            プルリクエストの作成からコンフリクトの検知、マージ、チケットのリリース済み反映まで。
            開発の一連の流れが、Dev Ticket の画面の中で完結します。
          </p>
          <div className="flex items-center justify-center gap-2 sm:gap-3 mt-6 flex-wrap">
            {[
              { icon: Github, label: 'GitHub App 連携' },
              { icon: Lock, label: 'Private リポジトリ対応' },
              { icon: Users, label: '使うメンバーはアカウント不要' },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] sm:text-xs font-bold" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(230,237,243,0.9)' }}>
                <Icon className="w-3.5 h-3.5" style={{ color: '#34D399' }} />{label}
              </span>
            ))}
          </div>
        </div>

        {/* 本体：左＝4ステップ／右＝画面モック */}
        <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-8 lg:gap-12 items-start">
          {/* 左 */}
          <div>
            <div className="space-y-2 mb-6">
              {GH_STEPS.map((s, i) => {
                const Icon = s.icon;
                const active = i === step;
                return (
                  <button
                    key={s.label}
                    onClick={() => { setStep(i); setRestart(r => r + 1); }}
                    className="w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-all"
                    style={{
                      background: active ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${active ? 'rgba(52,211,153,0.45)' : 'rgba(255,255,255,0.08)'}`,
                    }}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: active ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.06)' }}>
                      <Icon className="w-4 h-4" style={{ color: active ? '#34D399' : 'rgba(230,237,243,0.5)' }} />
                    </div>
                    <span className="text-xs sm:text-sm font-bold" style={{ color: active ? '#fff' : 'rgba(230,237,243,0.6)' }}>
                      <span className="mr-2" style={{ color: active ? '#6EE7B7' : 'rgba(230,237,243,0.35)' }}>{String(i + 1).padStart(2, '0')}</span>
                      {s.label}
                    </span>
                    {active && (
                      <span className="ml-auto flex-shrink-0 w-1.5 h-1.5 rounded-full gh-pulse" style={{ background: '#34D399' }} />
                    )}
                  </button>
                );
              })}
            </div>
            <div key={step} className="gh-fade">
              <h3 className="font-black text-xl sm:text-2xl leading-snug mb-3 whitespace-pre-line" style={{ color: '#fff' }}>{current.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(230,237,243,0.7)' }}>{current.desc}</p>
            </div>
          </div>

          {/* 右：GitHub風ウィンドウ */}
          <div className="rounded-2xl overflow-hidden" style={{ background: GH.panel, border: `1px solid ${GH.border}`, boxShadow: '0 24px 60px rgba(0,0,0,0.55)' }}>
            {/* ウィンドウのヘッダ */}
            <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5" style={{ background: GH.head, borderBottom: `1px solid ${GH.border}` }}>
              <div className="flex gap-1.5 flex-shrink-0">
                {['#ff5f57', '#febc2e', '#28c840'].map(c => <span key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />)}
              </div>
              <div className="mx-auto flex items-center gap-1.5 rounded-md px-2.5 py-1 min-w-0" style={{ background: GH.bg, border: `1px solid ${GH.border}` }}>
                <Ticket className="w-3 h-3 flex-shrink-0" style={{ color: '#34D399' }} />
                <span className="text-[10px] font-mono truncate" style={{ color: GH.muted }}>dv-ticket.com/projects/dev-ticket/github</span>
              </div>
            </div>
            {/* リポジトリ行 ＋ サブタブ */}
            <div className="px-3 sm:px-4 pt-3 pb-2" style={{ borderBottom: `1px solid ${GH.border}` }}>
              <div className="flex items-center gap-2 mb-2.5">
                <Github className="w-4 h-4 flex-shrink-0" style={{ color: GH.text }} />
                <span className="text-[11px] sm:text-xs font-mono truncate" style={{ color: GH.text }}>meece-inc / dev-ticket</span>
                <span className="ml-auto flex-shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: GH.muted, border: `1px solid ${GH.border}` }}>
                  <Lock className="w-2.5 h-2.5" />Private
                </span>
              </div>
              <div className="flex items-center gap-1 overflow-x-auto">
                <GhTab label="プルリクエスト" active />
                <GhTab label="Issue" />
                <GhTab label="コミット" />
                <GhTab label="ブランチ" />
              </div>
            </div>
            {/* 中身 */}
            <div key={step} className="gh-fade" style={{ minHeight: 268 }}>
              <GhMock step={step} />
            </div>
            {/* 進行バー */}
            <div className="h-0.5 w-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div key={`${step}-${restart}`} className="h-full gh-bar" style={{ background: 'linear-gradient(90deg,#34D399,#58a6ff)' }} />
            </div>
          </div>
        </div>

        {/* 機能カード */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-12 sm:mt-16">
          {GH_FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: 'rgba(52,211,153,0.14)' }}>
                <Icon className="w-[18px] h-[18px]" style={{ color: '#34D399' }} />
              </div>
              <p className="font-bold text-sm mb-1.5" style={{ color: '#fff' }}>{title}</p>
              <p className="text-xs leading-relaxed" style={{ color: 'rgba(230,237,243,0.62)' }}>{body}</p>
            </div>
          ))}
        </div>

        {/* 下段：閲覧できるもの ＋ 導入は3ステップ */}
        <div className="grid md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 mt-4">
          <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <p className="text-xs font-black mb-3.5 flex items-center gap-1.5" style={{ color: '#6EE7B7' }}>
              <CheckCheck className="w-3.5 h-3.5" />アプリの中で見られるもの
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { icon: GitPullRequest, label: 'プルリクエスト' },
                { icon: CircleDot, label: 'Issue' },
                { icon: GitCommitHorizontal, label: 'コミット' },
                { icon: GitBranch, label: 'ブランチ' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.26)' }}>
                  <Icon className="w-4 h-4 flex-shrink-0" style={{ color: '#34D399' }} />
                  <span className="text-[11px] font-bold truncate" style={{ color: '#fff' }}>{label}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] mt-3.5 leading-relaxed" style={{ color: 'rgba(230,237,243,0.55)' }}>
              チケット詳細の「関連PR」からも、その場で PR の作成・マージ・リンクのコピーができます。
            </p>
          </div>
          <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <p className="text-xs font-black mb-3.5 flex items-center gap-1.5" style={{ color: '#6EE7B7' }}>
              <Zap className="w-3.5 h-3.5" />導入は3ステップ
            </p>
            <div className="space-y-2.5">
              {[
                { t: 'GitHub App を組織に1回だけインストール', where: 'GitHub', note: '組織の管理者権限が必要です', gh: true },
                { t: 'プロジェクトとリポジトリを紐付け', where: 'Dev Ticket' },
                { t: 'メンバーへ「閲覧」「マージ可」を付与', where: 'Dev Ticket' },
              ].map((s, i) => (
                <div key={s.t} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 text-[10px] font-black" style={{ background: 'rgba(52,211,153,0.18)', color: '#6EE7B7' }}>{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-[11px] leading-snug" style={{ color: 'rgba(230,237,243,0.82)' }}>
                      {s.t}
                      <span
                        className="ml-1.5 inline-block align-middle rounded px-1.5 py-px text-[9px] font-bold whitespace-nowrap"
                        style={s.gh
                          ? { background: 'rgba(230,237,243,0.12)', color: 'rgba(230,237,243,0.75)', border: '1px solid rgba(230,237,243,0.2)' }
                          : { background: 'rgba(52,211,153,0.16)', color: '#6EE7B7', border: '1px solid rgba(52,211,153,0.35)' }}
                      >
                        {s.where}
                      </span>
                    </p>
                    {s.note && <p className="text-[10px] mt-0.5" style={{ color: 'rgba(230,237,243,0.45)' }}>{s.note}</p>}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] mt-3.5 pt-3.5 leading-relaxed" style={{ color: 'rgba(230,237,243,0.55)', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              GitHub 側の操作は①だけ、組織につき1回きり。②③と日々の運用は Dev Ticket の中で完結します。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * ヒーローの製品ビジュアル：起票からリリースまでの一連の流れ。
 *
 * 紙芝居にすると「切り替わる絵」になってしまうので、場面は最初から全部置いておき、
 * 進行に合わせて要素が増える／灯る形にしている（前の段階の結果が残り続ける）。
 * 動きは React の状態で駆動し、見た目は CSS の transition に任せる。
 * prefers-reduced-motion では最後の状態で止める。
 */
const FLOW_STEPS = [
  { icon: Ticket,       label: '起票',     caption: 'チケットを起票する',             sub: 'WBS番号・見積り・スプリントを決める' },
  { icon: Users,        label: 'アサイン', caption: '担当者を決める',                 sub: '実績をもとにアサインAIが候補を出す' },
  { icon: GitBranch,    label: 'コミット', caption: 'ブランチを切って実装する',       sub: 'ブランチ名の番号でチケットと繋がる' },
  { icon: GitMerge,     label: 'マージ',   caption: 'PRを作ってマージする',           sub: 'Dev Ticket の画面から完結できる' },
  { icon: Rocket,       label: 'デプロイ', caption: '本番環境へ反映する',             sub: '既定ブランチに入った変更が公開される' },
  { icon: CheckCircle2, label: 'リリース', caption: 'チケットが自動でリリース済みに', sub: 'マージを検知してステータスが進む' },
];

const FLOW_STATUS = [
  { t: '未着手',       bg: '#f1f5f9', fg: '#64748b', bd: '#e2e8f0' },
  { t: '進行中',       bg: '#eff6ff', fg: '#1d4ed8', bd: '#bfdbfe' },
  { t: '進行中',       bg: '#eff6ff', fg: '#1d4ed8', bd: '#bfdbfe' },
  { t: 'レビュー中',   bg: '#faf5ff', fg: '#7e22ce', bd: '#e9d5ff' },
  { t: 'リリース待ち', bg: '#fffbeb', fg: '#b45309', bd: '#fde68a' },
  { t: 'リリース済み', bg: '#ecfdf5', fg: '#047857', bd: '#a7f3d0' },
];

const FLOW_ASSIGNEES = [
  { n: '田', c: 'linear-gradient(135deg,#14b8a6,#059669)' },
  { n: '鈴', c: 'linear-gradient(135deg,#38bdf8,#0284c7)' },
  { n: '佐', c: 'linear-gradient(135deg,#a78bfa,#7c3aed)' },
];

const FLOW_MS = 2600;

function HeroFlow() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setStep(FLOW_STEPS.length - 1);
      return;
    }
    const t = setInterval(() => setStep(s => (s + 1) % FLOW_STEPS.length), FLOW_MS);
    return () => clearInterval(t);
  }, []);

  const cur = FLOW_STEPS[step];
  const st = FLOW_STATUS[step];
  const last = FLOW_STEPS.length - 1;

  return (
    <div className="relative w-full aspect-[16/10] bg-white flex flex-col overflow-hidden">
      <style>{`
        @keyframes flowCap { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes flowPing { 0% { transform: scale(.7); opacity: .55; } 70%,100% { transform: scale(1.9); opacity: 0; } }
        .flow-cap { animation: flowCap .45s ease-out both; }
        .flow-ping { animation: flowPing 2s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) { .flow-cap, .flow-ping { animation: none !important; } }
      `}</style>

      {/* ── レール ───────────────────────────────── */}
      <div className="px-5 sm:px-7 lg:px-8 pt-5 sm:pt-6 flex-shrink-0">
        <div className="relative">
          <div className="absolute left-4 right-4 top-[17px] h-[3px] rounded-full bg-slate-100" />
          <div
            className="absolute left-4 top-[17px] h-[3px] rounded-full"
            style={{
              width: `calc((100% - 2rem) * ${step / last})`,
              background: 'linear-gradient(90deg,#2dd4bf,#059669)',
              transition: 'width .8s cubic-bezier(.4,0,.2,1)',
            }}
          />
          <div className="relative flex justify-between">
            {FLOW_STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = i < step;
              const active = i === step;
              return (
                <div key={s.label} className="flex flex-col items-center gap-1.5" style={{ width: 64 }}>
                  <span className="relative flex items-center justify-center flex-shrink-0">
                    {active && <span className="absolute inset-0 rounded-full flow-ping" style={{ background: 'rgba(5,150,105,0.45)' }} />}
                    <span
                      className="relative w-[34px] h-[34px] rounded-full flex items-center justify-center"
                      style={{
                        background: done || active ? 'linear-gradient(135deg,#2dd4bf,#059669)' : '#ffffff',
                        border: done || active ? '1px solid transparent' : '2px solid #e2e8f0',
                        boxShadow: active ? '0 0 0 4px rgba(5,150,105,0.14), 0 8px 16px -8px rgba(5,150,105,0.7)' : 'none',
                        transition: 'all .5s ease',
                      }}
                    >
                      <Icon className="w-[15px] h-[15px]" style={{ color: done || active ? '#fff' : '#94a3b8', transition: 'color .5s ease' }} />
                    </span>
                  </span>
                  <span
                    className="text-[10px] font-black whitespace-nowrap"
                    style={{ color: active ? '#0f172a' : done ? '#059669' : '#94a3b8', transition: 'color .5s ease' }}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── 場面 ─────────────────────────────────── */}
      <div className="flex-1 min-h-0 px-5 sm:px-7 lg:px-8 py-3 sm:py-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,0.85fr)] gap-3 lg:gap-4 items-center">

        {/* 左：チケット */}
        <div
          className="rounded-2xl bg-white p-3.5"
          style={{ border: '1px solid #e8edf2', boxShadow: '0 14px 30px -22px rgba(15,23,42,0.55)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-black tracking-wider text-teal-700">DEMO-104</span>
            <span
              className="text-[10px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap"
              style={{ background: st.bg, color: st.fg, border: `1px solid ${st.bd}`, transition: 'all .5s ease' }}
            >
              {st.t}
            </span>
          </div>
          <p className="text-[13px] font-black text-slate-900 mt-1.5 leading-snug">サンプルチケット：一覧に絞り込みを追加</p>
          <p className="text-[10px] text-slate-400 mt-1">スプリント3 ・ 見積り 5h</p>

          <div className="mt-3 pt-2.5 flex items-center gap-1.5" style={{ borderTop: '1px solid #f1f5f9' }}>
            <span className="text-[9px] font-bold text-slate-400 mr-0.5">担当</span>
            {FLOW_ASSIGNEES.map((a, i) => (
              <span
                key={a.n}
                className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black text-white flex-shrink-0"
                style={{
                  background: a.c,
                  opacity: step >= 1 ? 1 : 0,
                  transform: step >= 1 ? 'none' : 'translateY(-12px) scale(.8)',
                  transition: `opacity .45s ${i * 0.13}s ease, transform .45s ${i * 0.13}s cubic-bezier(.34,1.4,.64,1)`,
                }}
              >
                {a.n}
              </span>
            ))}
            <span
              className="ml-auto text-[9px] font-black text-emerald-600 whitespace-nowrap"
              style={{ opacity: step >= 1 ? 1 : 0, transition: 'opacity .5s .5s ease' }}
            >
              AI 推奨
            </span>
          </div>
        </div>

        {/* 中：ブランチとマージ */}
        <div className="relative">
          <svg viewBox="0 0 300 130" className="w-full" aria-hidden="true">
            <defs>
              <linearGradient id="flowBranch" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#2dd4bf" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>
            </defs>
            {/* 既定ブランチ（main） */}
            <path d="M4 104H296" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" fill="none" />
            <text x="4" y="122" fill="#94a3b8" style={{ fontSize: 10, fontWeight: 800 }}>main</text>
            {/* 作業ブランチ */}
            <path
              d="M34 104C62 104 66 44 96 44H206C238 44 242 104 272 104"
              stroke="url(#flowBranch)" strokeWidth="3.5" strokeLinecap="round" fill="none"
              strokeDasharray="420"
              style={{ strokeDashoffset: step >= 2 ? 0 : 420, transition: 'stroke-dashoffset 1.4s cubic-bezier(.4,0,.2,1)' }}
            />
            {/* コミット */}
            {[112, 151, 190].map((x, i) => (
              <circle
                key={x} cx={x} cy="44" r="6" fill="#fff" stroke="#059669" strokeWidth="3"
                style={{
                  opacity: step >= 2 ? 1 : 0,
                  transformOrigin: `${x}px 44px`,
                  transform: step >= 2 ? 'scale(1)' : 'scale(.3)',
                  transition: `opacity .4s ${0.5 + i * 0.22}s ease, transform .4s ${0.5 + i * 0.22}s cubic-bezier(.34,1.5,.64,1)`,
                }}
              />
            ))}
            {/* マージ点 */}
            <circle
              cx="272" cy="104" r="9" fill="#a371f7"
              style={{
                opacity: step >= 3 ? 1 : 0,
                transformOrigin: '272px 104px',
                transform: step >= 3 ? 'scale(1)' : 'scale(.3)',
                transition: 'opacity .45s ease, transform .45s cubic-bezier(.34,1.5,.64,1)',
              }}
            />
            <path
              d="M268 104h8M272 100v8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"
              style={{ opacity: step >= 3 ? 1 : 0, transition: 'opacity .45s .1s ease' }}
            />
          </svg>

          {/* PRカード */}
          <div
            className="absolute left-1/2 -translate-x-1/2 top-0 rounded-xl px-3 py-2 bg-white flex items-center gap-2 whitespace-nowrap"
            style={{
              border: `1px solid ${step >= 3 ? 'rgba(163,113,247,0.45)' : '#e8edf2'}`,
              boxShadow: '0 14px 28px -18px rgba(15,23,42,0.5)',
              opacity: step >= 3 ? 1 : 0,
              transform: step >= 3 ? 'translate(-50%, 0)' : 'translate(-50%, 8px)',
              transition: 'all .5s ease',
            }}
          >
            <span className="w-5 h-5 rounded-md bg-slate-900 flex items-center justify-center flex-shrink-0">
              <Github className="w-3 h-3 text-white" />
            </span>
            <span className="text-[11px] font-black text-slate-800">#12 merged</span>
            <span className="text-[9px] font-bold rounded-full px-1.5 py-0.5" style={{ background: '#faf5ff', color: '#7e22ce', border: '1px solid #e9d5ff' }}>CI 通過</span>
          </div>
        </div>

        {/* 右：デプロイとユーザー */}
        <div className="flex flex-col gap-2.5">
          <div
            className="rounded-2xl p-3"
            style={{
              border: `1px solid ${step >= 4 ? '#a7f3d0' : '#e8edf2'}`,
              background: step >= 4 ? '#f4fdf8' : '#ffffff',
              boxShadow: '0 14px 30px -24px rgba(15,23,42,0.5)',
              transition: 'all .5s ease',
            }}
          >
            <p className="text-[9px] font-black tracking-[0.16em] text-slate-400 flex items-center gap-1">
              <Rocket className="w-3 h-3" style={{ color: step >= 4 ? '#059669' : '#94a3b8', transition: 'color .5s' }} />DEPLOY
            </p>
            <p className="text-[11px] font-black text-slate-800 mt-1 leading-tight">本番環境へ反映</p>
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: '#eef2f6' }}>
              <div
                className="h-full rounded-full"
                style={{ width: step >= 4 ? '100%' : '0%', background: 'linear-gradient(90deg,#2dd4bf,#059669)', transition: 'width 1.4s cubic-bezier(.4,0,.2,1)' }}
              />
            </div>
          </div>

          <div
            className="rounded-2xl p-3"
            style={{
              border: `1px solid ${step >= last ? '#a7f3d0' : '#e8edf2'}`,
              background: step >= last ? '#f4fdf8' : '#ffffff',
              boxShadow: '0 14px 30px -24px rgba(15,23,42,0.5)',
              transition: 'all .5s ease',
            }}
          >
            <p className="text-[9px] font-black tracking-[0.16em] text-slate-400">USERS</p>
            <div className="flex items-center mt-2 -space-x-1.5">
              {[0, 1, 2, 3].map(i => (
                <span
                  key={i}
                  className="w-6 h-6 rounded-full border-2 border-white flex items-center justify-center flex-shrink-0"
                  style={{
                    background: step >= last ? 'linear-gradient(135deg,#34d399,#059669)' : '#e2e8f0',
                    transition: `background .5s ${i * 0.1}s ease`,
                  }}
                >
                  <UserRound className="w-3 h-3" style={{ color: step >= last ? '#fff' : '#94a3b8', transition: `color .5s ${i * 0.1}s ease` }} />
                </span>
              ))}
            </div>
            <p
              className="text-[10px] font-bold mt-2 leading-snug"
              style={{ color: step >= last ? '#047857' : '#94a3b8', transition: 'color .5s ease' }}
            >
              {step >= last ? '新しい機能が届きました' : '反映を待っています'}
            </p>
          </div>
        </div>
      </div>

      {/* ── いま何をしているか ───────────────────── */}
      <div className="px-5 sm:px-7 lg:px-8 pb-5 sm:pb-6 flex-shrink-0" style={{ borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
        <div key={step} className="flow-cap">
          <p className="text-[13px] sm:text-sm font-black text-slate-900 flex items-center gap-2">
            <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg,#2dd4bf,#059669)' }}>
              {step + 1}
            </span>
            {cur.caption}
          </p>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-1 ml-7">{cur.sub}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * ヒーロー上段（コピー＋製品ビジュアル）の寸法を、画面の実寸から決める。
 *
 * ビジュアルの上限幅は `calc(100svh - 定数)` で当てていたが、差し引くべき下段ストリップは
 * 画面幅によって1段にも2段にもなるため、定数では実際の空きとずれる。結果としてビジュアルが
 * 空きより大きくなり、% で高さを決めていた背景の波と重なって、波が図の下で途切れて見えていた。
 * ここでは次の2つを画面サイズの変化に追従させる。
 *   ・ビジュアルの上限幅 … ナビ・下段ストリップ・上下の余白を引いた残りから、16:10 で逆算する
 *   ・波の高さ           … 「ビジュアル下端から上段の下端まで」の実測の空きに、波の絵が
 *                          ちょうど収まる高さ（svg の透明な上半分だけが図の裏へ回る）
 *
 * 波は絶対配置なので、高さを変えても観測している要素のレイアウトには影響しない（測り直しの
 * 無限ループにならない）。上限幅は window の高さとストリップからしか決まらないので、同じ値に
 * 落ち着く。
 */
const HERO_NAV_H = 64;            // 固定ナビ（h-16）ぶん。section の pt-16 と対応
const HERO_VISUAL_RATIO = 0.625;  // 中身は aspect-[16/10]
const HERO_VISUAL_FRAME = 14;     // ガラスの縁 p-1.5 ×2 と枠線ぶん
const HERO_VISUAL_CLEARANCE = 72; // ビジュアルの上下にあけておく最小の余白（波の置き場）
// 波の絵（面と線）は viewBox 0..420 のうち y=212 から下にしか無い。つまり svg の上半分は
// 透明なので、この割合ぶんはビジュアルの裏に潜り込ませてよい。
const HERO_WAVE_INK = 212 / 420;
const HERO_WAVE_MIN = 120;
const HERO_WAVE_MAX = 420;

function useHeroMetrics() {
  const stageRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<{ visualMaxWidth?: number; waveHeight?: number }>({});

  useLayoutEffect(() => {
    const measure = () => {
      const stripH = stripRef.current?.offsetHeight ?? 0;
      // 上段に割り当てられる高さ。ビジュアルは上下に余白を残してここへ収める
      const stageH = Math.max(320, window.innerHeight - HERO_NAV_H - stripH);
      // 1画面に収める必要があるのは、コピーと横並びになる lg 以上だけ。
      // それ未満は縦に積まれてどのみちスクロールするので、幅は列に任せる
      const sideBySide = window.matchMedia('(min-width: 1024px)').matches;
      const visualMaxWidth = sideBySide
        ? Math.round((stageH - HERO_VISUAL_CLEARANCE * 2 - HERO_VISUAL_FRAME) / HERO_VISUAL_RATIO)
        : undefined;

      const stage = stageRef.current?.getBoundingClientRect();
      const visual = visualRef.current?.getBoundingClientRect();
      // ビジュアルを出していない幅（md未満）では波の高さは CSS の % 指定に任せる
      const gap = stage && visual && visual.height > 0 ? stage.bottom - visual.bottom : undefined;
      // 絵が始まる位置がちょうど空きの中に来る高さ。透明な上半分だけが図に隠れる
      const waveHeight = gap === undefined
        ? undefined
        : Math.round(Math.min(
            HERO_WAVE_MAX,
            (stage?.height ?? HERO_WAVE_MAX) * 0.46,
            Math.max(HERO_WAVE_MIN, (gap - 8) / (1 - HERO_WAVE_INK)),
          ));

      setMetrics(prev => (
        prev.visualMaxWidth === visualMaxWidth && prev.waveHeight === waveHeight
          ? prev
          : { visualMaxWidth, waveHeight }
      ));
    };

    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [stageRef.current, visualRef.current, stripRef.current]) {
      if (el) ro.observe(el);
    }
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  return { stageRef, visualRef, stripRef, ...metrics };
}

export function LandingPage() {
  const navigate = useNavigate();
  const { pathname, hash } = useLocation();
  const [demoMode, setDemoMode] = useState<DemoMode>('none');
  const [activeFeature, setActiveFeature] = useState<FeatureId | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // storyboard state
  const [storyRoute, setStoryRoute] = useState(0);
  const [storySlide, setStorySlide] = useState(0);
  const [storyAuto, setStoryAuto] = useState(true);
  const [storyTimerKey, setStoryTimerKey] = useState(0);
  // ヒーロー：製品ビジュアルの上限幅と、背景の波の高さを画面の実寸から決める
  const hero = useHeroMetrics();

  useEffect(() => {
    if (!storyAuto) return;
    const slides = STORY_ROUTES[storyRoute].slides;
    const t = setInterval(() => { setStorySlide(s => (s + 1) % slides.length); }, 8000);
    return () => clearInterval(t);
  }, [storyAuto, storyRoute, storyTimerKey]);

  // ページ遷移時に最上部へスクロールする処理
  useEffect(() => {
    if (hash) {
      // ハッシュ（#features等）がある場合は、その要素までスクロール
      const id = hash.replace('#', '');
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }
    // ハッシュがない、または要素が見つからない場合は最上部へ
    const timer = setTimeout(() => window.scrollTo(0, 0), 100);
    return () => clearTimeout(timer);
  }, [pathname, hash]);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    element?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 overflow-x-hidden">
          
          {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(145deg, #34D399, #059669)', boxShadow: '0 4px 12px rgba(5,150,105,0.35)' }}>
                <Ticket className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-slate-900">Dev Ticket</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <button onClick={() => scrollToSection('news')} className="text-slate-600 hover:text-teal-600 transition-colors">お知らせ</button>
              <button onClick={() => scrollToSection('features')} className="text-slate-600 hover:text-teal-600 transition-colors">機能</button>
              <button onClick={() => scrollToSection('ai')} className="flex items-center gap-1.5 text-slate-600 hover:text-teal-600 transition-colors">
                AI
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#d1fae5', color: '#059669' }}>搭載</span>
              </button>
              <button onClick={() => scrollToSection('github')} className="flex items-center gap-1.5 text-slate-600 hover:text-teal-600 transition-colors">
                GitHub連携
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#15803d' }}>NEW</span>
              </button>
              <button onClick={() => scrollToSection('resources')} className="flex items-center gap-1.5 text-slate-600 hover:text-teal-600 transition-colors">
                リソース調達
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#ffedd5', color: '#ea580c' }}>準備中</span>
              </button>
              <button onClick={() => scrollToSection('screenshots')} className="text-slate-600 hover:text-teal-600 transition-colors">製品紹介</button>
              <button onClick={() => scrollToSection('benefits')} className="text-slate-600 hover:text-teal-600 transition-colors">特徴</button>
              <button onClick={() => scrollToSection('pricing')} className="text-slate-600 hover:text-teal-600 transition-colors">料金</button>
              <Button onClick={() => navigate('/book-demo')} className="bg-teal-600 hover:bg-teal-700 text-white">
                商談のご予約
              </Button>
              <Button onClick={() => navigate("/login")} variant="outline" className="border-slate-300 hover:border-teal-600 hover:text-teal-600">
                ログイン
              </Button>
            </div>
            <button
              className="md:hidden p-2 rounded-md text-slate-600 hover:text-teal-600 hover:bg-slate-50 transition-colors"
              onClick={() => setMobileMenuOpen(o => !o)}
              aria-label="メニュー"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-slate-100 py-3 flex flex-col gap-1">
              <button onClick={() => { scrollToSection('news'); setMobileMenuOpen(false); }} className="text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">お知らせ</button>
              <button onClick={() => { scrollToSection('features'); setMobileMenuOpen(false); }} className="text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">機能</button>
              <button onClick={() => { scrollToSection('ai'); setMobileMenuOpen(false); }} className="flex items-center gap-2 text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">
                AI
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#d1fae5', color: '#059669' }}>搭載</span>
              </button>
              <button onClick={() => { scrollToSection('github'); setMobileMenuOpen(false); }} className="flex items-center gap-2 text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">
                GitHub連携
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#15803d' }}>NEW</span>
              </button>
              <button onClick={() => { scrollToSection('resources'); setMobileMenuOpen(false); }} className="flex items-center gap-2 text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">
                リソース調達
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#ffedd5', color: '#ea580c' }}>準備中</span>
              </button>
              <button onClick={() => { scrollToSection('screenshots'); setMobileMenuOpen(false); }} className="text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">製品紹介</button>
              <button onClick={() => { scrollToSection('benefits'); setMobileMenuOpen(false); }} className="text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">特徴</button>
              <button onClick={() => { scrollToSection('pricing'); setMobileMenuOpen(false); }} className="text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">料金</button>
              <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-slate-100">
                <Button onClick={() => { navigate('/book-demo'); setMobileMenuOpen(false); }} className="bg-teal-600 hover:bg-teal-700 text-white w-full">商談のご予約</Button>
                <Button onClick={() => { navigate('/login'); setMobileMenuOpen(false); }} variant="outline" className="w-full border-slate-300 hover:border-teal-600 hover:text-teal-600">ログイン</Button>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section（メインビジュアル：ビューポート高さにフィットさせワンビュー表示）
          背景は装飾ではなく「進捗そのもの」。バーンダウンの面と、右肩上がりのベロシティ線を敷く。
          背景レイヤーは上段（コピー＋画面）の中だけに置く。下段のストリップまで敷くと、
          半透明の帯ごしに波が透けて「アニメーションが途中で隠れている」ように見えるため。 */}
      <section className="relative isolate min-h-[100svh] flex flex-col pt-16 border-b border-slate-200">
        <style>{`
          @keyframes heroRise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
          @keyframes heroFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
          @keyframes heroDash { to { stroke-dashoffset: -560; } }
          @keyframes heroGlow { 0%, 100% { opacity: .55; } 50% { opacity: .9; } }
          .hero-rise { animation: heroRise .7s cubic-bezier(.22,.9,.3,1) both; }
          .hero-float { animation: heroFloat 6s ease-in-out infinite; }
          .hero-glow { animation: heroGlow 7s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) {
            .hero-rise, .hero-float, .hero-glow { animation: none !important; }
          }
        `}</style>

        {/* ── 上段（背景つき） ─────────────────────────────── */}
        <div ref={hero.stageRef} className="relative flex-1 flex items-center overflow-hidden">
          {/* 背景 */}
          <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none" style={{ background: 'linear-gradient(168deg, #ffffff 0%, #fbfffe 22%, #f3fdfb 48%, #eefcf4 74%, #f8fef0 100%)' }}>
            <div className="hero-glow absolute -top-40 -left-28 w-[38rem] h-[38rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(45,212,191,0.24) 0%, transparent 66%)', filter: 'blur(20px)' }} />
            <div className="hero-glow absolute -top-24 right-[-10rem] w-[42rem] h-[42rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.22) 0%, transparent 66%)', filter: 'blur(20px)', animationDelay: '2s' }} />
            <div className="hero-glow absolute bottom-[-16rem] left-1/4 w-[40rem] h-[40rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(163,230,53,0.20) 0%, transparent 66%)', filter: 'blur(20px)', animationDelay: '4s' }} />
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(13,148,136,0.15) 1px, transparent 0)',
                backgroundSize: '24px 24px',
                maskImage: 'radial-gradient(90% 70% at 55% 35%, #000 0%, transparent 78%)',
                WebkitMaskImage: 'radial-gradient(90% 70% at 55% 35%, #000 0%, transparent 78%)',
              }}
            />
            {/* 文字が乗る面に白の膜を掛ける。本文が黒なので、下地に緑が残っていると
                読みづらくなる。モバイルは上から、PCは左（コピー側）からだけ白を足し、
                右の図の側には色を残す */}
            <div
              className="absolute inset-0 lg:hidden"
              style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0.66) 32%, rgba(255,255,255,0.22) 58%, rgba(255,255,255,0) 76%)' }}
            />
            <div
              className="absolute inset-0 hidden lg:block"
              style={{ background: 'linear-gradient(100deg, rgba(255,255,255,0.74) 0%, rgba(255,255,255,0.42) 28%, rgba(255,255,255,0) 56%)' }}
            />
            {/* 波の帯。高さは % ではなく、製品ビジュアルの下にできた実測の空きから決める。
                % のままだと絵の始まりが図の下端より上に来てしまい、波が図に切られて見える。
                class の % は JS が測る前／md未満（図なし）のための既定値 */}
            <svg
              className="absolute bottom-0 left-0 w-full h-[38%] sm:h-[44%]"
              style={hero.waveHeight ? { height: hero.waveHeight } : undefined}
              viewBox="0 0 1440 420" preserveAspectRatio="none" aria-hidden="true"
            >
              <defs>
                <linearGradient id="heroArea1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5eead4" stopOpacity="0.34" />
                  <stop offset="100%" stopColor="#5eead4" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="heroArea2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a3e635" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="#a3e635" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="heroLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#14b8a6" />
                  <stop offset="55%" stopColor="#059669" />
                  <stop offset="100%" stopColor="#84cc16" />
                </linearGradient>
              </defs>
              <path d="M0 420V300c180-14 240 44 400 30s250-96 420-104 300 44 420 22.5c110-20 200-60 200-60V420z" fill="url(#heroArea2)" />
              <path d="M0 420V336c200 12 280-52 460-64s280 62 460 40 340-84 520-96V420z" fill="url(#heroArea1)" />
              <path
                d="M0 336c200 12 280-52 460-64s280 62 460 40 340-84 520-96"
                fill="none" stroke="url(#heroLine)" strokeWidth="3" strokeLinecap="round"
                strokeDasharray="10 14" style={{ animation: 'heroDash 22s linear infinite' }} opacity="0.75"
              />
            </svg>
          </div>

          {/* 本体 */}
          <div className="relative max-w-[1520px] mx-auto w-full px-4 sm:px-6 lg:px-10 py-8 sm:py-10">
            <div className="w-full grid lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.58fr)] gap-10 lg:gap-8 xl:gap-10 items-center">

              {/* 左：コピー */}
              <div className="hero-rise flex flex-col justify-center">
                {/* キッカー。塗りつぶしのピルを重ねると、狭い画面で文字の背後に
                    濃い色の板が入り込んで読みにくくなるので、線と点だけで区切る */}
                <div className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 w-fit rounded-2xl sm:rounded-full px-3.5 py-2 mb-5 sm:mb-6 bg-white/85 backdrop-blur" style={{ border: '1px solid rgba(13,148,136,0.26)', boxShadow: '0 6px 20px rgba(13,148,136,0.12)' }}>
                  <span className="flex items-center gap-1.5 text-[11px] sm:text-xs font-black text-teal-700">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'linear-gradient(135deg,#2dd4bf,#059669)' }} />
                    プロジェクト管理 SaaS
                  </span>
                  <span className="hidden sm:block w-px h-3 bg-slate-200" />
                  <span className="text-[11px] sm:text-xs font-bold text-slate-500">チケット・スプリント・GitHub を1本で</span>
                </div>

                <h1 className="font-black text-slate-900 leading-[1.18] sm:leading-[1.14] tracking-tight text-[2.1rem] sm:text-[2.9rem] xl:text-[3.35rem] mb-5 sm:mb-6">
                  起票から<br />
                  <span className="relative inline-block">
                    <span aria-hidden className="absolute left-0 right-0 bottom-[0.1em] h-[0.26em] rounded-full" style={{ background: 'linear-gradient(90deg, rgba(45,212,191,0.42), rgba(163,230,53,0.42))' }} />
                    <span className="relative z-[1] text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(105deg,#0d9488 0%,#059669 55%,#4d7c0f 100%)' }}>リリース</span>
                  </span>
                  まで、<br />
                  ひとつの画面で。
                </h1>

                <p className="text-[15px] sm:text-xl text-slate-600 leading-relaxed mb-7 sm:mb-8 max-w-xl">
                  チケット・スプリント・ガント・メンバーの稼働、そして GitHub の PR まで。
                  ツールを行き来せずに、<span className="font-bold text-slate-800">チームの現在地と次の一手</span>が分かります。
                </p>

                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                  <Button
                    size="lg"
                    onClick={() => navigate('/book-demo')}
                    className="text-base sm:text-lg font-bold px-8 sm:px-9 py-5 sm:py-6 text-white border-0 transition-transform hover:-translate-y-0.5"
                    style={{ background: 'linear-gradient(135deg,#0d9488 0%,#059669 100%)', boxShadow: '0 14px 30px -10px rgba(5,150,105,0.65)' }}
                  >
                    今すぐ無料で始める
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => setDemoMode('video')}
                    className="text-base sm:text-lg font-bold px-8 sm:px-9 py-5 sm:py-6 bg-white/80 backdrop-blur border-slate-300 hover:border-teal-600 hover:text-teal-700 transition-transform hover:-translate-y-0.5"
                  >
                    <Play className="mr-2 w-4 h-4" />
                    デモを見る
                  </Button>
                </div>

                <div className="mt-6 sm:mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm sm:text-base text-slate-600">
                  {['商談予約可能', 'すぐに利用開始'].map(t => (
                    <span key={t} className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-teal-600" />{t}
                    </span>
                  ))}
                </div>
              </div>

              {/* 右：製品ビジュアル
                  ・中身は起票→リリースまでの一連の流れ（HeroFlow）。薄いガラスの縁だけを回す。
                  ・幅の上限は useHeroMetrics が画面の実寸から出す。ナビ・下段ストリップ・
                    背景の波の帯を引いた残りに必ず収まるので、背の低いディスプレイでも
                    1画面から溢れず、波とも重ならない。
                  ・上限が効いて列より細くなったときは、コピーとの間隔が片側だけ開かないよう
                    列の中央に置く。 */}
              <div
                ref={hero.visualRef}
                className="hero-rise relative hidden md:block w-full mx-auto"
                style={{
                  animationDelay: '.12s',
                  // JS が測る前（初回描画・計測不能時）のための保険
                  maxWidth: hero.visualMaxWidth ?? 'calc((100svh - 268px) * 1.6)',
                }}
              >
                {/* 背後の光 */}
                <div className="absolute -inset-10 -z-10 rounded-[3rem]" style={{ background: 'radial-gradient(58% 56% at 52% 44%, rgba(20,184,166,0.34) 0%, transparent 72%)', filter: 'blur(28px)' }} />

                {/* 薄いガラスの縁だけを回して、中身（流れの図）に寄せる */}
                <div
                  className="rounded-[22px] p-1.5"
                  style={{
                    background: 'linear-gradient(155deg, rgba(255,255,255,0.95) 0%, rgba(209,250,229,0.72) 55%, rgba(255,255,255,0.9) 100%)',
                    border: '1px solid rgba(255,255,255,0.9)',
                    boxShadow: '0 56px 96px -38px rgba(6,78,59,0.42), 0 20px 44px -26px rgba(15,23,42,0.20)',
                  }}
                >
                  <div className="rounded-[16px] overflow-hidden bg-white" style={{ border: '1px solid rgba(15,23,42,0.07)' }}>
                    <HeroFlow />
                  </div>
                </div>

                {/* 接地影 */}
                <div className="absolute left-[6%] right-[6%] -bottom-4 h-7 -z-10 pointer-events-none" style={{ background: 'radial-gradient(closest-side, rgba(6,78,59,0.26) 0%, transparent 100%)', filter: 'blur(16px)' }} />

              </div>
            </div>
          </div>
        </div>

        {/* ── 下段：何が入っているかを1行で ───────────────────
            画面幅で 2列×2段 にも 4列×1段 にもなる。上段に残る高さが変わるので、
            ここの高さは実測して useHeroMetrics に渡す */}
        <div ref={hero.stripRef} className="relative bg-white border-t border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* 罫線は divide-* だと2列×2段のときに余計な線が出るので、位置から明示的に引く */}
            <div className="grid grid-cols-2 lg:grid-cols-4">
              {[
                { icon: LayoutDashboard, title: 'チケット・スプリント', sub: 'リスト／ボード／ガントで進捗を管理', to: 'features' },
                { icon: Github, title: 'GitHub連携', sub: 'PR作成・マージ・コンフリクト検知', to: 'github', badge: 'NEW' },
                { icon: Brain, title: 'アサインAI', sub: '実績から担当者をレコメンド', to: 'ai', badge: '搭載' },
                { icon: Monitor, title: 'Mac / iPad アプリ', sub: 'ネイティブアプリを開発中', to: 'native' },
              ].map(({ icon: Icon, title, sub, to, badge }, i) => (
                <button
                  key={title}
                  onClick={() => scrollToSection(to)}
                  className={`group flex items-start gap-2.5 sm:gap-3 px-3 sm:px-5 py-4 sm:py-5 text-left transition-colors hover:bg-teal-50/50 border-slate-200 ${i % 2 === 1 ? 'border-l' : ''} ${i >= 2 ? 'border-t' : ''} lg:border-t-0 ${i > 0 ? 'lg:border-l' : 'lg:border-l-0'}`}
                >
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105" style={{ background: 'linear-gradient(135deg,rgba(20,184,166,0.16),rgba(5,150,105,0.16))' }}>
                    <Icon className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-teal-700" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-black text-slate-800 flex items-center gap-1.5 flex-wrap leading-snug">
                      {title}
                      {badge && (
                        <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#15803d' }}>{badge}</span>
                      )}
                    </p>
                    <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 leading-snug">{sub}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* News Section（メインビジュアル直下：最新のお知らせ3件） */}
      <section id="news" className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 overflow-hidden bg-gradient-to-b from-white to-slate-50 border-b border-slate-200">
        {/* 背景装飾（淡いグラデーションのぼかし） */}
        <div className="pointer-events-none absolute -top-24 -right-24 w-[28rem] h-[28rem] rounded-full bg-teal-100/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 w-[28rem] h-[28rem] rounded-full bg-emerald-100/40 blur-3xl" />

        <div className="relative max-w-6xl mx-auto">
          {/* ヘッダー */}
          <div className="mb-10 sm:mb-14">
            <Badge className="mb-4 bg-teal-100 text-teal-700 hover:bg-teal-100">NEWS</Badge>
            <div className="flex items-center gap-3">
              <span className="w-1.5 h-8 sm:h-9 rounded-full bg-gradient-to-b from-teal-500 to-emerald-600" />
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">お知らせ</h2>
            </div>
            <p className="mt-3 text-base sm:text-lg text-slate-500">最新のリリース情報・お知らせをお届けします。</p>
          </div>

          {/* カードグリッド：台帳(newsRegistry)の先頭から最新3件を自動表示 */}
          <div className="grid md:grid-cols-3 gap-5 sm:gap-6">
            {NEWS.slice(0, 3).map((n) => (
              <Link key={n.slug} to={`/news/${n.slug}`} className="group">
                <Card className="h-full border-slate-200 bg-white/80 backdrop-blur-sm transition-all hover:border-teal-400 hover:shadow-xl hover:shadow-teal-500/10 hover:-translate-y-1">
                  <CardContent className="p-6 flex flex-col h-full">
                    <div className="flex items-center justify-between mb-4">
                      <NewsCategoryBadge category={n.category} />
                      <span className="text-xs text-slate-400 font-mono">{n.date}</span>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 leading-snug mb-3 line-clamp-2 group-hover:text-teal-600 transition-colors">
                      {n.title}
                    </h3>
                    <p className="text-sm text-slate-500 leading-relaxed line-clamp-3 flex-1">
                      {n.excerpt}
                    </p>
                    <div className="mt-5 pt-4 border-t border-slate-100 flex items-center text-sm font-semibold text-slate-400 group-hover:text-teal-600 transition-colors">
                      詳しく見る
                      <ArrowRight className="w-4 h-4 ml-1.5 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* 右下：すべてのニュース（ticket準拠） */}
          <div className="mt-10 flex justify-end">
            <Link
              to="/news"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-slate-300 bg-white text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-teal-600 hover:border-teal-600 hover:text-white hover:shadow-md hover:shadow-teal-500/20"
            >
              すべてのニュース
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-8 sm:mb-16">
            <Badge className="mb-4 bg-teal-100 text-teal-700 hover:bg-teal-100">
              主要機能
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              開発チームに必要な<br />すべての機能を一つに
            </h2>
            <p className="text-base sm:text-xl text-slate-600">
              プロジェクト管理からタスク追跡まで、チームワークを加速させる機能が揃っています
            </p>
          </div>

          {/* Main interactive feature cards */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="border-slate-200 hover:border-teal-400 transition-all hover:shadow-lg cursor-pointer group" onClick={() => setActiveFeature('dashboard')}>
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <LayoutDashboard className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">ダッシュボード</h3>
                <p className="text-slate-600">
                  プロジェクト全体の進捗状況を一目で把握。チケット状況やチーム進捗をリアルタイムで確認できます。
                </p>
                <p className="text-teal-600 text-sm font-semibold mt-3 opacity-0 group-hover:opacity-100 transition-opacity">画面を見る →</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 hover:border-teal-400 transition-all hover:shadow-lg cursor-pointer group" onClick={() => setActiveFeature('projects')}>
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <FolderKanban className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">プロジェクト管理</h3>
                <p className="text-slate-600">
                  複数のプロジェクトを効率的に管理。クライアント情報、期間、メンバーを一元管理できます。
                </p>
                <p className="text-teal-600 text-sm font-semibold mt-3 opacity-0 group-hover:opacity-100 transition-opacity">画面を見る →</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 hover:border-teal-400 transition-all hover:shadow-lg cursor-pointer group" onClick={() => setActiveFeature('sprint')}>
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Ticket className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">スプリント管理</h3>
                <p className="text-slate-600">
                  アジャイル開発に対応。スプリントごとにチケットを管理し、チームの開発速度を向上させます。
                </p>
                <p className="text-teal-600 text-sm font-semibold mt-3 opacity-0 group-hover:opacity-100 transition-opacity">画面を見る →</p>
              </CardContent>
            </Card>
          </div>

          {/* Additional features — info only */}
          <div className="mt-10">
            <div className="flex items-center gap-4 mb-6">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs font-semibold tracking-widest text-slate-400 uppercase">その他の機能</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <BarChart3 className="w-4 h-4 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">3つのビュー表示</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">リスト・ボード・ガントチャートを切り替え</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Users className="w-4 h-4 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">メンバー管理</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">招待・権限設定・グループ管理を一元化</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-pink-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Building2 className="w-4 h-4 text-pink-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">クライアント管理</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">顧客企業情報とプロジェクトを紐付け管理</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <GitPullRequest className="w-4 h-4 text-indigo-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">レビューフロー</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">依頼・承認・差し戻しをシステム化</p>
                </div>
              </div>

              <button
                onClick={() => scrollToSection('github')}
                className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4 text-left hover:border-teal-300 hover:shadow-md transition-all"
              >
                <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Github className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                    GitHub連携
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#15803d' }}>NEW</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">PR作成・マージ・コンフリクト検知をアプリ内で</p>
                </div>
              </button>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <MessageSquare className="w-4 h-4 text-cyan-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">コメント・メンション</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">@メンション・返信・ファイル添付に対応</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Search className="w-4 h-4 text-rose-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">グローバル検索</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">チケット・プロジェクト・コメントを横断検索</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bell className="w-4 h-4 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Slack通知連携</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">更新・レビュー依頼をリアルタイム通知</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-lime-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Download className="w-4 h-4 text-lime-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">CSVエクスポート</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">データを外部ツールへ簡単に出力</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Lock className="w-4 h-4 text-violet-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">権限グループ管理</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">プロジェクト単位で細かく権限設定</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <SlidersHorizontal className="w-4 h-4 text-sky-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Myフィルタ</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">よく使うフィルタをワンクリックで呼び出し</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <ListPlus className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">チケット一括作成</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">スプリント開始時に複数チケットをまとめて登録</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-fuchsia-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <GitMerge className="w-4 h-4 text-fuchsia-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">子チケット</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">チケットを細かい作業単位に分割して管理</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Tag className="w-4 h-4 text-teal-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">チケット分類</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">プロジェクトごとにカテゴリを作成・設定</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Activity className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">実績モニタ</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">6工程のマイルストーン通過時刻を自動記録</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Timer className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">実績時間</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">マイルストーン差分から実績工数を自動集計</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Link2 className="w-4 h-4 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">短URLリダイレクト</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">WBS番号でチケット詳細に直接アクセス</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-yellow-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Layers className="w-4 h-4 text-yellow-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">バックログ</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">未着手チケットをスプリント外で一元管理</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-stone-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <BookOpen className="w-4 h-4 text-stone-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Wiki</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">プロジェクトのドキュメントをチームで共有</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <ClipboardList className="w-4 h-4 text-red-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">議事録</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">会議内容をプロジェクトに紐づけて記録・共有</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Rocket className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">リリースノート</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">リリース内容をバージョン管理しチームに共有</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Zap className="w-4 h-4 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">マイアクション</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">担当・レビュー・アクションメモをプロジェクト横断で一元管理</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CalendarRange className="w-4 h-4 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">アサイン計画</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">グループにメンバーを追加し、D&Dでプロジェクトへ素早くアサイン</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <UserCog className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">ロール設定</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">管理機能へのアクセス権限をロール単位でカスタマイズ</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <BellRing className="w-4 h-4 text-rose-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">アプリ内通知</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">メンション・レビュー依頼・ステータス変更をベルで即通知</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-zinc-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Paperclip className="w-4 h-4 text-zinc-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">ファイル添付</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">チケットにソースファイル・画像を添付して情報を一元化</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-4">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <ArrowRightLeft className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">チケット移動</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">チケットを別スプリントへシームレスに移動</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* GitHub Section（GitHub連携：PR作成・マージ・コンフリクト検知） */}
      <GithubSection />

      {/* AI Section（アサインAI／分析AI 搭載）— 幅・縦幅とも Mac/iPad セクションに合わせた2カラム構成 */}
      <section id="ai" className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden" style={{ background: 'linear-gradient(180deg, #ffffff 0%, #f2fdf9 45%, #e3fbf1 100%)' }}>
        {/* 背景デコ */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-32 -right-24 w-[520px] h-[520px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(13,148,136,0.14) 0%, transparent 65%)' }} />
          <div className="absolute -bottom-32 -left-24 w-[460px] h-[460px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 65%)' }} />
        </div>

        <div className="max-w-7xl mx-auto relative z-10">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            {/* 左: コピー + 2つのAI + 信頼バッジ */}
            <div>
              <div className="inline-flex items-center gap-2 text-white rounded-full px-4 py-1.5 text-xs font-bold mb-5" style={{ background: 'linear-gradient(135deg, #0d9488, #10b981)', boxShadow: '0 6px 20px rgba(16,185,129,0.35)' }}>
                <Sparkles className="w-3.5 h-3.5" />
                AI搭載 ― 担当決めを自動化
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-[2.6rem] font-black leading-[1.15] mb-5 text-slate-900">
                担当決めは、<br />
                <span className="text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(120deg, #0d9488, #10b981, #059669)' }}>AIにおまかせ。</span>
              </h2>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed mb-7 max-w-lg">
                外部のAIサービスは使わず、<b className="text-slate-800">あなたのチケット実績だけ</b>で動く独自AI。「誰が適任か」「今、誰が空いているか」をAIが提案します。
              </p>

              <div className="space-y-4 mb-8">
                {/* アサインAI */}
                <div className="flex items-start gap-3.5 bg-white/70 backdrop-blur rounded-2xl border border-emerald-100 p-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-500/30">
                    <Target className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0 py-0.5">
                    <p className="text-sm font-black text-slate-900 flex items-center gap-2 flex-wrap">
                      アサインAI
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">ワンクリック提案</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">必要スキル×開発規模×<b className="text-slate-700">空き状況</b>から適任者をおすすめ。特定の人に偏らせず公平に分散します。</p>
                  </div>
                </div>
                {/* 分析AI */}
                <div className="flex items-start gap-3.5 bg-white/70 backdrop-blur rounded-2xl border border-teal-100 p-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center flex-shrink-0 shadow-lg shadow-teal-500/30">
                    <Brain className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0 py-0.5">
                    <p className="text-sm font-black text-slate-900 flex items-center gap-2 flex-wrap">
                      分析AI
                      <span className="text-[10px] font-bold text-teal-700 bg-teal-100 px-1.5 py-0.5 rounded">機械学習</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">過去の実績を毎晩学習し、メンバーの得意分野とレベル（1〜4）を<b className="text-slate-700">自動登録・最新化</b>します。</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {[
                  { icon: Lock, t: '外部AI不使用' },
                  { icon: Scale, t: '公平分散' },
                  { icon: TrendingUp, t: '使うほど高精度' },
                ].map(({ icon: Icon, t }) => (
                  <span key={t} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
                    <Icon className="w-3.5 h-3.5 text-emerald-600" />
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* 右: 学習→活用の循環（サイクル図）— 4ステップが時計回りに回り続けることを可視化 */}
            <div className="relative">
              <div className="absolute -inset-6 rounded-[2.5rem] blur-2xl opacity-70 pointer-events-none" style={{ background: 'radial-gradient(60% 60% at 50% 45%, rgba(16,185,129,0.20), transparent 70%)' }} />
              <div className="relative bg-white rounded-3xl border border-slate-200/80 shadow-xl p-6 sm:p-8">
                {/* 上部ピル */}
                <div className="flex justify-center mb-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <Lock className="w-3 h-3 flex-shrink-0" />
                    外部AI不使用・自社実績だけで学習
                  </span>
                </div>

                {/* サイクル本体（学習→活用のループ） */}
                <div className="relative mx-auto w-full max-w-[180px] aspect-square mt-14 mb-11 sm:mt-14 sm:mb-11">
                  {/* 回転リング＋時計回りの進行矢印（SVG） */}
                  <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true">
                    <circle cx="50" cy="50" r="30" fill="none" stroke="#5eead4" strokeWidth="1.4" strokeDasharray="2.5 3.5" />
                    <g fill="#0d9488">
                      <path d="M-3.2,-3.2 L3.2,0 L-3.2,3.2 Z" transform="translate(71.21 28.79) rotate(45)" />
                      <path d="M-3.2,-3.2 L3.2,0 L-3.2,3.2 Z" transform="translate(71.21 71.21) rotate(135)" />
                      <path d="M-3.2,-3.2 L3.2,0 L-3.2,3.2 Z" transform="translate(28.79 71.21) rotate(225)" />
                      <path d="M-3.2,-3.2 L3.2,0 L-3.2,3.2 Z" transform="translate(28.79 28.79) rotate(315)" />
                    </g>
                  </svg>

                  {/* 中心ハブ */}
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[40%] aspect-square rounded-full flex flex-col items-center justify-center text-center text-white shadow-lg shadow-emerald-500/30" style={{ background: 'linear-gradient(135deg, #0d9488, #10b981)' }}>
                    <RotateCw className="w-5 h-5 mb-1" />
                    <p className="text-[10px] font-black leading-tight">回すほど<br />賢くなる</p>
                  </div>

                  {/* 4ノード（時計回り: 実績→スキル分析→レコメンド→担当を決定） */}
                  <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2"><CycleNode Icon={Ticket} tone="teal" title="実績" sub="チケット蓄積" /></div>
                  <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2"><CycleNode Icon={Sparkles} tone="teal" title="スキル分析" sub="レベル登録" /></div>
                  <div className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2"><CycleNode Icon={UserRound} tone="emerald" title="レコメンド" sub="スキル×空き" /></div>
                  <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"><CycleNode Icon={CheckCircle2} tone="emerald" title="担当を決定" sub="採用ログ" /></div>
                </div>

                {/* ▼ 深夜3:00 の夜間バッチ 詳細図解（全画面で表示） */}
                <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50/70 to-white p-4 sm:p-5">
                  <div className="flex items-center justify-center gap-2 mb-4">
                    <span className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-black text-teal-800">
                      <Moon className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
                      毎晩 AM3:00 の自動処理
                    </span>
                    <span className="text-[9px] font-bold text-teal-700 bg-teal-100 rounded-full px-2 py-0.5">操作不要</span>
                  </div>
                  <div className="flex items-stretch justify-between gap-1.5 sm:gap-2">
                    {[
                      { no: '1', Icon: Ticket, t: '実績を集計', s: '完了チケット' },
                      { no: '2', Icon: Sparkles, t: 'スキル再判定', s: '分析AI' },
                      { no: '3', Icon: Brain, t: 'モデル再学習', s: 'アサインAI' },
                    ].map((st, i) => (
                      <Fragment key={st.no}>
                        {i > 0 && <ChevronRight className="w-4 h-4 text-teal-400 self-center flex-shrink-0" />}
                        <div className="flex-1 rounded-xl bg-white border border-slate-100 shadow-sm px-1 py-3.5 text-center relative">
                          <span className="absolute top-1 left-1 w-3.5 h-3.5 rounded-full bg-teal-600 text-white text-[8px] font-black flex items-center justify-center">{st.no}</span>
                          <div className="w-7 h-7 mx-auto rounded-lg bg-teal-50 flex items-center justify-center mb-1.5">
                            <st.Icon className="w-3.5 h-3.5 text-teal-600" />
                          </div>
                          <p className="text-[9.5px] font-black text-slate-800 leading-tight whitespace-nowrap">{st.t}</p>
                          <p className="text-[8px] text-slate-400 leading-tight mt-0.5 whitespace-nowrap">{st.s}</p>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  <p className="text-center text-[10px] sm:text-[11px] text-slate-500 mt-3.5 flex items-center justify-center gap-1 flex-wrap">
                    <ArrowRight className="w-3 h-3 text-teal-500 flex-shrink-0" />
                    翌朝には<span className="font-black text-teal-700">より賢いおすすめ</span>に。学習中もアプリは止まりません
                  </p>
                </div>

                {/* 凡例（サイクルの色分け） */}
                <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-center gap-4">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600"><span className="w-2.5 h-2.5 rounded-full bg-teal-500" />分析AI（学習）</span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />アサインAI（活用）</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Native App Section（Mac/iPadアプリ 開発中） */}
      <section id="native" className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden" style={{ background: 'linear-gradient(160deg, #0f172a 0%, #134e4a 55%, #115e59 100%)' }}>
        {/* 背景デコ */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full" style={{ background: 'radial-gradient(circle, rgba(52,211,153,0.16) 0%, transparent 65%)' }} />
          <div className="absolute bottom-0 left-1/3 w-80 h-80 rounded-full" style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.12) 0%, transparent 65%)' }} />
        </div>
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-12 items-center">
            {/* 左: 説明 + 実装済み機能 */}
            <div>
              <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold mb-5 w-fit" style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.4)', color: '#FCD34D' }}>
                <Rocket className="w-3.5 h-3.5" />
                開発中 — まもなく登場
              </div>
              <h2 className="text-white font-black leading-tight mb-4 text-3xl sm:text-4xl">
                Dev Ticketを<br /><span style={{ color: '#34D399' }}>Mac・iPad</span>アプリで
              </h2>
              <p className="text-sm sm:text-base leading-relaxed mb-6" style={{ color: 'rgba(255,255,255,0.72)' }}>
                Capacitorで構築するネイティブアプリを開発中。ブラウザを開かずに起動でき、デスクトップ／タブレットに最適化したUIを提供します。
              </p>
              {/* 実装済み機能 */}
              <div className="rounded-2xl p-5 mb-5 max-w-md" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <p className="text-xs font-black mb-3.5 flex items-center gap-1.5" style={{ color: '#6EE7B7' }}>
                  <CheckCheck className="w-3.5 h-3.5" />実装済みの機能
                </p>
                <div className="space-y-3">
                  {[
                    { icon: Fingerprint, t: 'Face ID / Touch ID ログイン' },
                    { icon: BellRing, t: 'プッシュ通知（APNs）' },
                    { icon: AppWindow, t: 'マルチタブUI（⌘T / ⌘W / ⌘1〜9）' },
                    { icon: Rocket, t: 'アプリアイコン・起動画面' },
                  ].map(({ icon: Icon, t }) => (
                    <div key={t} className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(52,211,153,0.15)' }}>
                        <Icon className="w-4 h-4" style={{ color: '#34D399' }} />
                      </div>
                      <span className="text-sm font-medium leading-tight" style={{ color: 'rgba(255,255,255,0.9)' }}>{t}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 flex items-center gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                  <Clock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#FCD34D' }} />
                  <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }}>開発中：実機検証・App Store配信準備を進行中</span>
                </div>
              </div>
              {/* 対応プラットフォーム */}
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { icon: Monitor, label: 'macOS', ok: true },
                  { icon: Tablet, label: 'iPadOS', ok: true },
                  { icon: Smartphone, label: 'iPhone 対象外', ok: false },
                ].map(({ icon: Icon, label, ok }) => (
                  <div key={label} className="flex items-center gap-1.5 rounded-lg px-3 py-2" style={{ background: ok ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.05)', border: `1px solid ${ok ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.1)'}` }}>
                    <Icon className="w-4 h-4" style={{ color: ok ? '#34D399' : 'rgba(255,255,255,0.4)' }} />
                    <span className="text-xs font-bold" style={{ color: ok ? '#fff' : 'rgba(255,255,255,0.5)' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* 右: MacBook + iPad 実機イラスト */}
            <div className="flex items-center justify-center lg:justify-end">
              <div style={{ position: 'relative', width: '100%', maxWidth: 520 }}>
                <MacBookFrame />
                {/* iPad を手前右下にオーバーラップ */}
                <div className="hidden sm:block" style={{ position: 'absolute', right: '-9%', bottom: '-6%', width: '50%' }}>
                  <IPadFrame />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Resource Section */}
      <section id="resources" className="pt-0 pb-0 px-4 sm:px-6 lg:px-8 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 50%, #f0fdfa 100%)' }}>

        <style>{`
          @keyframes progressFill {
            from { width: 0%; }
            to   { width: 100%; }
          }
          @keyframes bannerSlide {
            from { opacity: 0; transform: translateY(-8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>

        {/* 次期開発予定 告知バナー */}
        <div
          className="-mx-4 sm:-mx-6 lg:-mx-8 flex items-center justify-center gap-3 px-4 py-3 text-sm font-bold"
          style={{
            background: 'linear-gradient(90deg, #c2410c 0%, #ea580c 40%, #f97316 60%, #ea580c 80%, #c2410c 100%)',
            animation: 'bannerSlide 0.4s ease-out',
            color: '#fff',
          }}
        >
          <span className="text-base">🚧</span>
          <span>リソース調達機能は<span className="font-black underline underline-offset-2">2次開発</span>にてリリース予定です</span>
        </div>

        {/* Decorative blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(52,211,153,0.15) 0%, transparent 65%)' }} />
          <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.09) 0%, transparent 65%)' }} />
        </div>

        <div className="max-w-7xl mx-auto relative pt-10">

          {/* Section header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-4 flex-wrap">
              <div className="inline-flex items-center gap-2 text-white rounded-full px-5 py-2 text-sm font-bold" style={{ background: 'linear-gradient(135deg, #0d9488, #10b981)', boxShadow: '0 4px 20px rgba(16,185,129,0.4)' }}>
                <Zap className="w-3.5 h-3.5" />
                リソース調達の新しいカタチ
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold border" style={{ background: 'linear-gradient(135deg, #fff7ed, #ffedd5)', borderColor: '#fb923c', color: '#ea580c' }}>
                <span>🚧</span>
                次期開発予定
              </div>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-tight mb-3">
              <span className="text-slate-900">リソース調達を</span>
              <span className="ml-2 text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(135deg, #0d9488, #10b981, #059669)' }}>
                シームレスに行う
              </span>
            </h2>
            <p className="text-slate-500 text-sm sm:text-lg max-w-2xl mx-auto">
              チケット単位で対応エンジニアを募集・アサイン。4つのルートから即戦力を確保し、完了後はチケットをクローズ。
            </p>
          </div>


        </div>

        {/* Storyboard — 4ルート紙芝居 */}
        <div className="-mx-4 sm:-mx-6 lg:-mx-8 bg-white border-t border-slate-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-full px-4 py-1.5 text-xs font-bold text-slate-500 mb-3 shadow-sm">
                <Activity className="w-3.5 h-3.5 text-teal-500" />
                調達フロー
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-slate-900 mb-2">
                チケットを起点に、<span className="text-transparent bg-clip-text" style={{backgroundImage:'linear-gradient(135deg,#0d9488,#10b981)'}}>担当が決まる</span>
              </h3>
              <p className="text-slate-500 text-sm max-w-xl mx-auto">4つのルートから最適なエンジニアを確保するまでの流れを、実際の画面でご覧ください</p>
            </div>

            {(() => {
              const route = STORY_ROUTES[storyRoute];
              const slide = route.slides[storySlide];
              return (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">

                  {/* Tab bar */}
                  <div className="flex border-b border-slate-200 bg-slate-50">
                    {STORY_ROUTES.map((r, i) => {
                      const Icon = r.icon;
                      const isActive = storyRoute === i;
                      return (
                        <button key={r.id} onClick={() => { setStoryRoute(i); setStorySlide(0); setStoryTimerKey(k => k + 1); }}
                          className="flex-1 flex items-center justify-center gap-1.5 py-3 px-2 text-xs font-semibold transition-all border-b-2"
                          style={isActive ? { borderBottomColor:r.hex, backgroundColor:r.hexBg, color:r.hexText } : { borderBottomColor:'transparent', color:'#64748b' }}>
                          <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="hidden sm:inline truncate">{r.label}</span>
                          <span className="sm:hidden truncate">{r.labelShort}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Content: mockup top/left, description bottom/right */}
                  <div className="flex flex-col md:flex-row md:min-h-[380px]">

                    <div className="w-full md:w-[54%] p-4 md:p-6 flex items-center justify-center bg-slate-50 border-b md:border-b-0 md:border-r border-slate-100">
                      <div className="w-full max-w-[280px] md:max-w-xs">{slide.screen}</div>
                    </div>

                    <div className="flex-1 p-4 md:p-6 flex flex-col">
                      <div className="flex-1">
                        <div className="flex items-baseline gap-1.5 mb-3" style={{ color:route.hex }}>
                          <span className="text-[10px] font-black tracking-widest uppercase">STEP</span>
                          <span className="text-3xl font-black">{slide.step}</span>
                          <span className="text-[10px] font-semibold text-slate-400">/ {route.slides.length}</span>
                        </div>
                        <h4 className="text-xl font-black text-slate-900 mb-3 leading-tight">{slide.title}</h4>
                        <p className="text-sm text-slate-600 leading-relaxed">{slide.desc}</p>
                      </div>
                      <div className="mt-auto pt-4 border-t border-slate-100">
                        <p className="text-[10px] text-slate-400 font-semibold mb-1">{slide.actorLabel}</p>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                            <Users className="w-3.5 h-3.5 text-slate-400" />
                          </div>
                          <p className="text-sm font-bold text-slate-800">{slide.actor}</p>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* Controls */}
                  <div className="border-t border-slate-100 px-6 py-3 flex items-center justify-between bg-white">
                    <div className="flex items-center gap-1.5">
                      {route.slides.map((_, i) => (
                        <button key={i} onClick={() => { setStorySlide(i); setStoryTimerKey(k => k + 1); }}
                          style={{ width:i===storySlide?'20px':'8px', height:'8px', borderRadius:'4px', background:i===storySlide?route.hex:'#e2e8f0', transition:'all 0.2s ease', flexShrink:0 }} />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { const n=route.slides.length; setStorySlide(s=>(s-1+n)%n); setStoryTimerKey(k=>k+1); }}
                        className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors">
                        <ChevronLeft className="w-4 h-4 text-slate-600" />
                      </button>
                      <span className="text-xs text-slate-400 font-medium tabular-nums">{storySlide+1} / {route.slides.length}</span>
                      <button onClick={() => { const n=route.slides.length; setStorySlide(s=>(s+1)%n); setStoryTimerKey(k=>k+1); }}
                        className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors">
                        <ChevronRight className="w-4 h-4 text-slate-600" />
                      </button>
                    </div>
                    <button onClick={() => setStoryAuto(a => !a)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border"
                      style={storyAuto ? { background:route.hexBg, borderColor:route.hex, color:route.hexText } : { background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b' }}>
                      {storyAuto ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      <span>{storyAuto ? '再生中' : '自動再生'}</span>
                    </button>
                  </div>

                  {/* Progress bar */}
                  <div className="h-1 bg-slate-100">
                    <div key={`pb-${storyRoute}-${storySlide}-${storyTimerKey}`}
                      style={{ height:'100%', animation:storyAuto?'progressFill 8s linear forwards':'none', background:route.hex }} />
                  </div>

                </div>
              );
            })()}

          </div>
        </div>

        {/* ─── Detailed Flow Diagram ─── */}
        <div className="-mx-4 sm:-mx-6 lg:-mx-8 border-t border-slate-100" style={{background:'linear-gradient(180deg,#f8fafc 0%,#f1f5f9 100%)'}}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">

            {/* Header */}
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-1.5 text-xs font-bold text-slate-500 mb-3 shadow-sm">
                <GitBranch className="w-3.5 h-3.5 text-teal-500" />
                詳細フロー
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-slate-900 mb-2">
                ルート別の<span className="text-transparent bg-clip-text" style={{backgroundImage:'linear-gradient(135deg,#0d9488,#10b981)'}}>実施フロー</span>
              </h3>
              <p className="text-slate-500 text-sm max-w-xl mx-auto">選んだルートに応じて担当が決まるまでのプロセスが異なります。すべてチケットを起点に動きます。</p>
            </div>

            {/* ── Common start nodes ── */}
            <div className="flex flex-col items-center">
              <div className="bg-white border-2 border-teal-100 rounded-2xl px-5 py-3 shadow-md flex items-center gap-3 w-full max-w-md" style={{boxShadow:'0 4px 20px rgba(13,148,136,0.1)'}}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'linear-gradient(135deg,#14b8a6,#0d9488)'}}>
                  <Ticket className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-black text-teal-500 tracking-widest uppercase mb-0.5">START</p>
                  <p className="text-sm font-black text-slate-800">DevTicketでチケットを作成</p>
                </div>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1 flex-shrink-0 hidden sm:inline">PM / チームリーダー</span>
              </div>

              <div className="w-0.5 h-5 bg-slate-300" />

              <div className="rounded-2xl px-5 py-3 shadow-lg flex items-center gap-3 w-full max-w-md" style={{background:'linear-gradient(135deg,#0d9488,#059669)', boxShadow:'0 8px 24px rgba(13,148,136,0.35)'}}>
                <div className="w-9 h-9 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center flex-shrink-0">
                  <Search className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-black text-teal-200 tracking-widest uppercase mb-0.5">STEP 01</p>
                  <p className="text-sm font-black text-white">「担当を探す」をクリック・ルートを選択</p>
                </div>
                <span className="text-[10px] font-bold text-teal-100 bg-white/15 border border-white/20 rounded-full px-2.5 py-1 flex-shrink-0 hidden sm:inline">PM / チームリーダー</span>
              </div>

            </div>

            <div className="flex justify-center">
              <div className="w-0.5 h-6 bg-slate-300" />
            </div>

            {/* ── Branch + Grid + Merge: single overflow container for exact alignment ── */}
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="min-w-[720px]">

              {/* Branch: horizontal bar → 4 colored stubs */}
              {/* calc() offsets account for gap-3 (12px): col1=−4.5px, col2=−1.5px, col3=+1.5px, col4=+4.5px */}
              <div className="relative" style={{height:'24px'}}>
                <div className="absolute top-0 h-0.5 bg-slate-200" style={{left:'calc(12.5% - 4.5px)', right:'calc(12.5% - 4.5px)'}} />
                <div className="absolute top-0 bottom-0 w-0.5 bg-teal-400" style={{left:'calc(12.5% - 4.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-0 bottom-0 w-0.5 bg-blue-400" style={{left:'calc(37.5% - 1.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-0 bottom-0 w-0.5 bg-violet-500" style={{left:'calc(62.5% + 1.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-0 bottom-0 w-0.5 bg-orange-400" style={{left:'calc(87.5% + 4.5px)', transform:'translateX(-50%)'}} />
              </div>

              <div className="grid grid-cols-4 gap-3">
                {([
                  {
                    label: 'グループ企業内', Icon: Building2,
                    color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4', text: '#0f766e',
                    grad: 'linear-gradient(135deg,#0d9488,#0f766e)',
                    steps: [
                      {title:'グループ専用ページに案件掲載', actor:'Dev Ticket', note:'社外非公開'},
                      {title:'管理者が担当者をアサイン', actor:'グループ会社 管理者'},
                      {title:'実装完了・成果物を提出', actor:'担当エンジニア', note:'コード貼付 or GitHub PR'},
                    ],
                  },
                  {
                    label: '会員エンジニア', Icon: Users,
                    color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8',
                    grad: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
                    steps: [
                      {title:'スキルマッチした会員に案件公開', actor:'Dev Ticket', note:'自動マッチング'},
                      {title:'エンジニアが案件に応募', actor:'登録エンジニア'},
                      {title:'企業が応募者を承認・アサイン', actor:'PM / チームリーダー'},
                      {title:'実装完了・成果物を提出', actor:'担当エンジニア', note:'コード貼付 or GitHub PR'},
                    ],
                  },
                  {
                    label: 'パートナー企業', Icon: Building2,
                    color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', text: '#5b21b6',
                    grad: 'linear-gradient(135deg,#7c3aed,#5b21b6)',
                    steps: [
                      {title:'パートナー企業の管理者に通知', actor:'Dev Ticket'},
                      {title:'パートナー企業が担当者をアサイン', actor:'パートナー企業 管理者'},
                      {title:'実装完了・成果物を提出', actor:'パートナーエンジニア', note:'コード貼付 or GitHub PR'},
                    ],
                  },
                  {
                    label: 'エージェント連携', Icon: Bot,
                    color: '#f97316', bg: '#fff7ed', border: '#fed7aa', text: '#c2410c',
                    grad: 'linear-gradient(135deg,#f97316,#ea580c)',
                    steps: [
                      {title:'エージェントシステムに案件連携', actor:'Dev Ticket', note:'API連携'},
                      {title:'FLが応募 / エージェントが指名', actor:'エージェント / FL'},
                      {title:'企業が最終承認・アサイン', actor:'PM / チームリーダー'},
                      {title:'実装完了・成果物を提出', actor:'担当エンジニア', note:'コード貼付 or GitHub PR'},
                    ],
                  },
                ] as const).map((route) => (
                  <div key={route.label} className="flex flex-col">
                    {/* Column header */}
                    <div className="rounded-t-2xl px-3 py-3.5 text-center" style={{background: route.grad, boxShadow:`0 4px 14px ${route.color}44`}}>
                      <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/25 flex items-center justify-center mx-auto mb-2">
                        <route.Icon className="w-4 h-4 text-white" />
                      </div>
                      <p className="text-white text-xs font-black leading-tight">{route.label}</p>
                    </div>

                    {/* Steps */}
                    {route.steps.map((step, i) => (
                      <div key={i} className="flex flex-col items-center">
                        <div className="flex flex-col items-center">
                          <div className="w-0.5 h-3 flex-shrink-0" style={{background: route.color + '55'}} />
                          <div className="w-0 h-0 flex-shrink-0" style={{borderLeft:'4px solid transparent', borderRight:'4px solid transparent', borderTop:`5px solid ${route.color}88`}} />
                        </div>
                        <div className="w-full bg-white border rounded-xl p-3 shadow-sm" style={{borderColor: route.border}}>
                          <div className="inline-flex items-center rounded-full px-2 py-0.5 mb-2 max-w-full" style={{background: route.bg, border: `1px solid ${route.border}`}}>
                            <span className="text-[9px] font-black truncate" style={{color: route.text}}>{step.actor}</span>
                          </div>
                          <p className="text-[11px] font-bold text-slate-800 leading-snug">{step.title}</p>
                          {'note' in step && step.note && (
                            <p className="text-[9px] text-slate-400 mt-1 font-medium">{step.note}</p>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Bottom stub to merge line */}
                    <div className="flex-1 flex flex-col items-center justify-end" style={{minHeight:'16px'}}>
                      <div className="w-0.5 flex-1 min-h-3" style={{background: route.color + '44'}} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Merge: 4 colored stubs → horizontal bar */}
              <div className="relative" style={{height:'24px'}}>
                <div className="absolute top-0 bottom-0 w-0.5 bg-teal-400" style={{left:'calc(12.5% - 4.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-0 bottom-0 w-0.5 bg-blue-400" style={{left:'calc(37.5% - 1.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-0 bottom-0 w-0.5 bg-violet-500" style={{left:'calc(62.5% + 1.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-0 bottom-0 w-0.5 bg-orange-400" style={{left:'calc(87.5% + 4.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute bottom-0 h-0.5 bg-slate-200" style={{left:'calc(12.5% - 4.5px)', right:'calc(12.5% - 4.5px)'}} />
              </div>

              </div>
            </div>

            <div className="flex justify-center">
              <div className="w-0.5 h-6 bg-slate-300" />
            </div>

            {/* ── Common end nodes ── */}
            <div className="flex flex-col items-center">
              <div className="bg-white border-2 border-slate-200 rounded-2xl px-5 py-3 shadow-md flex items-center gap-3 w-full max-w-md">
                <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <GitPullRequest className="w-4 h-4 text-slate-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-black text-slate-400 tracking-widest uppercase mb-0.5">REVIEW</p>
                  <p className="text-sm font-black text-slate-800">コードレビュー・承認</p>
                </div>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1 flex-shrink-0 hidden sm:inline">PM / チームリーダー</span>
              </div>

              <div className="w-0.5 h-5 bg-teal-300" />

              <div className="rounded-2xl px-6 py-4 shadow-xl flex items-center gap-3 w-full max-w-md" style={{background:'linear-gradient(135deg,#0d9488,#059669)', boxShadow:'0 12px 32px rgba(13,148,136,0.4)'}}>
                <div className="w-10 h-10 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-[9px] font-black text-teal-200 tracking-widest uppercase mb-0.5">COMPLETE</p>
                  <p className="text-base font-black text-white">チケット完了・クローズ</p>
                </div>
              </div>
            </div>

          </div>
        </div>

      </section>

      {/* Screenshots Section */}
      <section id="screenshots" className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-8 sm:mb-16">
            <Badge className="mb-4 bg-teal-100 text-teal-700 hover:bg-teal-100">
              製品紹介
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              直感的で使いやすいインターフェース
            </h2>
            <p className="text-base sm:text-xl text-slate-600">
              実際の画面をご覧ください
            </p>
          </div>

          <div className="space-y-8 sm:space-y-12">
            {/* Dashboard */}
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div className="order-2 lg:order-1">
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">ダッシュボード</h3>
                <p className="text-sm sm:text-lg text-slate-600 mb-6">
                  プロジェクト全体の状況を一目で確認。進行中のタスク、完了率、チームの進捗状況をビジュアルで表示します。グラフやチャートで、データドリブンな意思決定をサポートします。
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">プロジェクト別のチケット状態を視覚化</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">アクティブチケットの一覧表示</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">リアルタイムの進捗率表示</span>
                  </li>
                </ul>
              </div>
              <div className="order-1 lg:order-2">
                <div className="rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                  <div className="relative md:hidden" style={{ paddingBottom: '56.25%' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '154%', height: '154%', transform: 'scale(0.65)', transformOrigin: 'top left' }}>
                      <MockDashboard fillHeight />
                    </div>
                  </div>
                  <div className="hidden md:block"><MockDashboard /></div>
                </div>
              </div>
            </div>

            {/* Sprint List */}
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div>
                <div className="rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                  <div className="relative md:hidden" style={{ paddingBottom: '56.25%' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '154%', transform: 'scale(0.65)', transformOrigin: 'top left' }}>
                      <MockSprintList />
                    </div>
                  </div>
                  <div className="hidden md:block"><MockSprintList /></div>
                </div>
              </div>
              <div>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">スプリント管理 - リストビュー</h3>
                <p className="text-sm sm:text-lg text-slate-600 mb-6">
                  チケットを表形式で管理。WBS番号、優先度、担当者、期限などを一覧で確認できます。フィルターやソート機能で、必要な情報に素早くアクセスできます。
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">詳細なフィルタリング機能</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">カラムごとのソート対応</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">ドラッグ&ドロップでステータス変更</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Sprint Board */}
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div className="order-2 lg:order-1">
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">スプリント管理 - ボードビュー</h3>
                <p className="text-sm sm:text-lg text-slate-600 mb-6">
                  カンバン形式でチケットを管理。ステータスごとにカラム分けされており、ドラッグ&ドロップで直感的にステータス変更が可能です。
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">カンバンスタイルのビジュアル管理</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">ステータスごとのチケット件数表示</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">優先度やレビューステータスの可視化</span>
                  </li>
                </ul>
              </div>
              <div className="order-1 lg:order-2">
                <div className="rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                  <div className="relative md:hidden" style={{ paddingBottom: '56.25%' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '154%', transform: 'scale(0.65)', transformOrigin: 'top left' }}>
                      <MockSprintBoard />
                    </div>
                  </div>
                  <div className="hidden md:block"><MockSprintBoard /></div>
                </div>
              </div>
            </div>

            {/* Sprint Gantt */}
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div>
                <div className="rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                  <div className="relative md:hidden" style={{ paddingBottom: '56.25%' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '154%', transform: 'scale(0.65)', transformOrigin: 'top left' }}>
                      <MockSprintGantt />
                    </div>
                  </div>
                  <div className="hidden md:block"><MockSprintGantt /></div>
                </div>
              </div>
              <div>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">スプリント管理 - ガントチャート</h3>
                <p className="text-sm sm:text-lg text-slate-600 mb-6">
                  タイムライン形式でチケットの予定と進捗を可視化。期間の重複や依存関係を把握しやすく、スケジュール管理に最適です。
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">日付ベースのビジュアル表示</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">チケット間の依存関係を把握</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">期間の重複を視覚的に確認</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Projects */}
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div className="order-2 lg:order-1">
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">プロジェクト一覧</h3>
                <p className="text-sm sm:text-lg text-slate-600 mb-6">
                  すべてのプロジェクトをカード形式で表示。クライアント情報、ステータス、メンバー、進捗状況を一目で確認できます。
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">プロジェクトごとのチケット進捗バー</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">メンバーアバターの表示</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">ステータスフィルタリング機能</span>
                  </li>
                </ul>
              </div>
              <div className="order-1 lg:order-2">
                <div className="rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                  <div className="relative md:hidden" style={{ paddingBottom: '56.25%' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '154%', transform: 'scale(0.65)', transformOrigin: 'top left' }}>
                      <MockProjects />
                    </div>
                  </div>
                  <div className="hidden md:block"><MockProjects /></div>
                </div>
              </div>
            </div>

            {/* Members */}
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div>
                <div className="rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                  <div className="relative md:hidden" style={{ paddingBottom: '56.25%' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '154%', transform: 'scale(0.65)', transformOrigin: 'top left' }}>
                      <MockMembers />
                    </div>
                  </div>
                  <div className="hidden md:block"><MockMembers /></div>
                </div>
              </div>
              <div>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">メンバー管理</h3>
                <p className="text-sm sm:text-lg text-slate-600 mb-6">
                  チームメンバーの招待、編集、権限管理を一箇所で実施。ロールやチームごとにメンバーをフィルタリングできます。
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">招待メールによる簡単なメンバー追加</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">ロールベースのアクセス制御</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">チームごとのメンバー割り当て</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section id="benefits" className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-8 sm:mb-16">
            <Badge className="mb-4 bg-teal-100 text-teal-700 hover:bg-teal-100">
              Dev Ticketの特徴
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              チームの生産性を最大化する理由
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <Card className="border-slate-200 bg-white">
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center mb-4">
                  <Clock className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">すぐに使い始められる</h3>
                <p className="text-slate-600">
                  複雑な設定は不要。サインアップ後すぐにプロジェクト管理を開始できます。直感的なUIで学習コストを最小限に抑えます。
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-4">
                  <Shield className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">きめ細かい権限管理</h3>
                <p className="text-slate-600">
                  ロールベースのアクセス制御とグループ管理で、プロジェクトごとに適切な権限を設定できます。セキュリティも万全です。
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mb-4">
                  <Bell className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">Slack連携でスピーディな対応</h3>
                <p className="text-slate-600">
                  チケット更新・レビュー依頼・コメントをSlackへ即通知。チームメンバーが素早く状況を把握し、スムーズなコラボレーションを実現します。
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-8 sm:mb-16">
            <Badge className="mb-4 bg-teal-100 text-teal-700 hover:bg-teal-100">
              料金プラン
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              シンプルで分かりやすい料金体系
            </h2>
            <p className="text-base sm:text-xl text-slate-600">
              チームの規模に合わせて最適なプランをお選びください
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
            <Card className="border-slate-200 hover:border-slate-300 transition-all">
              <CardContent className="pt-6">
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">無料</h3>
                  <div className="text-4xl font-bold text-slate-900 mb-2">¥0</div>
                  <div className="text-slate-600">/ 月</div>
                </div>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">1プロジェクトまで</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">3メンバーまで</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">基本機能のみ</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">メールサポート</span>
                  </li>
                </ul>
                <Button variant="outline" onClick={() => navigate('/book-demo?plan=free')} className="w-full">
                  無料で始める
                </Button>
              </CardContent>
            </Card>

            <Card className="border-slate-200 hover:border-slate-300 transition-all">
              <CardContent className="pt-6">
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">スターター</h3>
                  <div className="text-4xl font-bold text-slate-900 mb-2">¥5,000</div>
                  <div className="text-slate-600">/ 月</div>
                </div>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">3プロジェクトまで</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">5メンバーまで</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">基本機能</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">メールサポート</span>
                  </li>
                </ul>
                <Button variant="outline" onClick={() => navigate('/book-demo?plan=starter')} className="w-full">
                  今すぐ始める
                </Button>
              </CardContent>
            </Card>

            <Card className="border-teal-500 border-2 relative hover:shadow-xl transition-all">
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                <Badge className="bg-teal-600 text-white hover:bg-teal-600">人気</Badge>
              </div>
              <CardContent className="pt-6">
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">プロフェッショナル</h3>
                  <div className="text-4xl font-bold text-slate-900 mb-2">¥9,800</div>
                  <div className="text-slate-600">/ 月</div>
                </div>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">30プロジェクトまで</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">20メンバーまで</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">全機能利用可能</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">優先サポート</span>
                  </li>
                </ul>
                <Button onClick={() => navigate('/book-demo?plan=professional')} className="w-full bg-teal-600 hover:bg-teal-700 text-white">
                  今すぐ始める
                </Button>
              </CardContent>
            </Card>

            <Card className="border-slate-200 hover:border-slate-300 transition-all">
              <CardContent className="pt-6">
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">エンタープライズ</h3>
                  <div className="text-4xl font-bold text-slate-900 mb-2">お問い合わせ</div>
                  <div className="text-slate-600">&nbsp;</div>
                </div>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">無制限プロジェクト</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">無制限メンバー</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">専用サーバー</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">カスタマイズ対応</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCheck className="w-5 h-5 text-teal-600 mt-1 flex-shrink-0" />
                    <span className="text-slate-700">専任サポート</span>
                  </li>
                </ul>
                <Button variant="outline" onClick={() => navigate('/book-demo?plan=enterprise')} className="w-full">
                  お問い合わせ
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-teal-600 to-emerald-600">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-6">
            今すぐDev Ticketを始めましょう
          </h2>
          <p className="text-base sm:text-xl text-teal-50 mb-8">
            数分でチーム全体の生産性を向上させます。
          </p>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
            <Button size="lg" onClick={() => navigate('/book-demo')} className="bg-white text-teal-600 hover:bg-slate-100 text-base sm:text-lg px-6 sm:px-8 py-4 sm:py-6">
              無料で始める
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/book-demo')} className="text-base sm:text-lg px-6 sm:px-8 py-4 sm:py-6 text-white border-white bg-transparent hover:bg-white/10 hover:text-white">
              デモを予約
            </Button>
          </div>
        </div>
      </section>

      {demoMode === 'video' && (
        <DemoVideoPage
          onClose={() => setDemoMode('none')}
          onInteractive={() => {
            setDemoMode('none');
            navigate('/book-demo');
          }}
        />
      )}
      {demoMode === 'interactive' && (
        <DemoInteractivePage onClose={() => setDemoMode('none')} />
      )}

      <FeaturePreviewModal
        featureId={activeFeature}
        onClose={() => setActiveFeature(null)}
      />

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(145deg, #34D399, #059669)', boxShadow: '0 3px 8px rgba(5,150,105,0.35)' }}>
                  <Ticket className="w-5 h-5 text-white" />
                </div>
                <span className="text-lg font-bold text-white">Dev Ticket</span>
              </div>
              <p className="text-sm">
                チームの生産性を最大化する<br />プロジェクト管理ツール
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">製品</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-teal-400 transition-colors">機能</a></li>
                <li><a href="#pricing" className="hover:text-teal-400 transition-colors">料金</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">会社情報</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="https://meece-jp.com/" target="_blank" rel="noopener noreferrer" className="hover:text-teal-400 transition-colors">運営会社</a></li>
                <li>
                  <Link to="/privacy" className="hover:text-teal-400 transition-colors">プライバシーポリシー</Link>
                </li>
                <li>
                  <Link to="/terms" className="hover:text-teal-400 transition-colors">利用規約</Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 text-center text-sm">
            <p>&copy; 2026 Dev Ticket. All rights reserved.</p>
          </div>
        </div>
      </footer>
        </div>
  );
}
