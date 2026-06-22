import { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { CheckCircle2, LayoutDashboard, Ticket, Users, FolderKanban, BarChart3, Shield, Clock, ArrowRight, CheckCheck, Building2, MessageSquare, Search, Bell, Download, Lock, GitPullRequest, SlidersHorizontal, ListPlus, GitMerge, Tag, Activity, Timer, Link2, Layers, BookOpen, ClipboardList, Rocket, Zap, CalendarRange, UserCog, BellRing, Paperclip, ArrowRightLeft, ChevronLeft, ChevronRight, Bot, Play, Pause, GitBranch, Menu, X } from 'lucide-react';
import { MockDashboard } from '@/app/components/lp/mocks/MockDashboard';
import { MockSprintList } from '@/app/components/lp/mocks/MockSprintList';
import { MockSprintBoard } from '@/app/components/lp/mocks/MockSprintBoard';
import { MockSprintGantt } from '@/app/components/lp/mocks/MockSprintGantt';
import { MockProjects } from '@/app/components/lp/mocks/MockProjects';
import { MockMembers } from '@/app/components/lp/mocks/MockMembers';
import { DemoVideoPage } from '@/app/pages/lp/DemoVideoPage';
import { DemoInteractivePage } from '@/app/pages/lp/DemoInteractivePage';
import { FeaturePreviewModal } from '@/app/components/lp/FeaturePreviewModal';

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
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
          
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
              <button onClick={() => scrollToSection('features')} className="text-slate-600 hover:text-teal-600 transition-colors">機能</button>
              <button onClick={() => scrollToSection('resources')} className="text-slate-600 hover:text-teal-600 transition-colors">リソース調達</button>
              <button onClick={() => scrollToSection('screenshots')} className="text-slate-600 hover:text-teal-600 transition-colors">製品紹介</button>
              <button onClick={() => scrollToSection('benefits')} className="text-slate-600 hover:text-teal-600 transition-colors">特徴</button>
              <button onClick={() => scrollToSection('pricing')} className="text-slate-600 hover:text-teal-600 transition-colors">料金</button>
              <Button onClick={() => navigate('/book-demo')} className="bg-teal-600 hover:bg-teal-700 text-white">
                デモのご予約
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
              <button onClick={() => { scrollToSection('features'); setMobileMenuOpen(false); }} className="text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">機能</button>
              <button onClick={() => { scrollToSection('resources'); setMobileMenuOpen(false); }} className="text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">リソース調達</button>
              <button onClick={() => { scrollToSection('screenshots'); setMobileMenuOpen(false); }} className="text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">製品紹介</button>
              <button onClick={() => { scrollToSection('benefits'); setMobileMenuOpen(false); }} className="text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">特徴</button>
              <button onClick={() => { scrollToSection('pricing'); setMobileMenuOpen(false); }} className="text-left px-2 py-2.5 text-slate-700 hover:text-teal-600 font-medium transition-colors rounded-md hover:bg-slate-50">料金</button>
              <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-slate-100">
                <Button onClick={() => { navigate('/book-demo'); setMobileMenuOpen(false); }} className="bg-teal-600 hover:bg-teal-700 text-white w-full">デモのご予約</Button>
                <Button onClick={() => { navigate('/login'); setMobileMenuOpen(false); }} variant="outline" className="w-full border-slate-300 hover:border-teal-600 hover:text-teal-600">ログイン</Button>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="min-h-screen lg:h-screen flex flex-col pt-16 overflow-hidden px-4 sm:px-6 lg:px-8">
        <div className="flex-1 max-w-7xl mx-auto w-full flex items-center lg:items-stretch py-10 lg:py-8">
          <div className="w-full grid lg:grid-cols-[2fr_3fr] gap-8 lg:gap-12 items-center lg:items-stretch">
            <div className="flex flex-col justify-center">
              <Badge className="mb-4 bg-teal-100 text-teal-700 hover:bg-teal-100 w-fit">
                チームの生産性を最大化
              </Badge>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-slate-900 mb-6 leading-tight">
                プロジェクトを、<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-emerald-600">
                  スマートに。
                </span>
              </h1>
              <p className="text-xl text-slate-600 mb-8 leading-relaxed">
                チケット・スプリント・メンバーを一元管理。<br />
                チームの生産性を最大化するツール。
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" onClick={() => navigate('/book-demo')} className="bg-teal-600 hover:bg-teal-700 text-white text-lg px-8 py-6">
                  今すぐ無料で始める
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
                <Button size="lg" variant="outline" onClick={() => setDemoMode('video')} className="text-lg px-8 py-6 border-slate-300 hover:border-teal-600 hover:text-teal-600">
                  デモを見る
                </Button>
              </div>
              <div className="mt-8 flex items-center gap-6 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-teal-600" />
                  <span>デモ予約可能</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-teal-600" />
                  <span>すぐに利用開始</span>
                </div>
              </div>
            </div>
            <div className="relative lg:h-full">
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 aspect-video lg:aspect-auto lg:h-full" style={{ boxShadow: '0 8px 48px rgba(0,0,0,0.07)' }}>
                <MockDashboard fillHeight />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-teal-100 text-teal-700 hover:bg-teal-100">
              主要機能
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              開発チームに必要な<br />すべての機能を一つに
            </h2>
            <p className="text-xl text-slate-600">
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

      {/* Resource Section */}
      <section id="resources" className="pt-10 pb-0 px-4 sm:px-6 lg:px-8 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 50%, #f0fdfa 100%)' }}>

        <style>{`
          @keyframes progressFill {
            from { width: 0%; }
            to   { width: 100%; }
          }
        `}</style>

        {/* Decorative blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(52,211,153,0.15) 0%, transparent 65%)' }} />
          <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.09) 0%, transparent 65%)' }} />
        </div>

        <div className="max-w-7xl mx-auto relative">

          {/* Section header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 text-white rounded-full px-5 py-2 text-sm font-bold mb-4" style={{ background: 'linear-gradient(135deg, #0d9488, #10b981)', boxShadow: '0 4px 20px rgba(16,185,129,0.4)' }}>
              <Zap className="w-3.5 h-3.5" />
              リソース調達の新しいカタチ
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-tight mb-3">
              <span className="text-slate-900">リソース調達を</span>
              <span className="ml-2 text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(135deg, #0d9488, #10b981, #059669)' }}>
                シームレスに行う
              </span>
            </h2>
            <p className="text-slate-500 text-lg max-w-2xl mx-auto">
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

            {/* ── Branch + Grid + Merge: single overflow container for exact alignment ── */}
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="min-w-[720px]">

              {/* Branch: center down → horizontal bar → 4 colored stubs */}
              {/* calc() offsets account for gap-3 (12px): col1=−4.5px, col2=−1.5px, col3=+1.5px, col4=+4.5px */}
              <div className="relative" style={{height:'48px'}}>
                <div className="absolute left-1/2 top-0 h-6 w-0.5 bg-slate-300 -translate-x-1/2" />
                <div className="absolute top-6 h-0.5 bg-slate-200" style={{left:'calc(12.5% - 4.5px)', right:'calc(12.5% - 4.5px)'}} />
                <div className="absolute top-6 bottom-0 w-0.5 bg-teal-400" style={{left:'calc(12.5% - 4.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-6 bottom-0 w-0.5 bg-blue-400" style={{left:'calc(37.5% - 1.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-6 bottom-0 w-0.5 bg-violet-500" style={{left:'calc(62.5% + 1.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-6 bottom-0 w-0.5 bg-orange-400" style={{left:'calc(87.5% + 4.5px)', transform:'translateX(-50%)'}} />
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

              {/* Merge: 4 colored stubs → horizontal bar → center down */}
              <div className="relative" style={{height:'48px'}}>
                <div className="absolute top-0 h-6 w-0.5 bg-teal-400" style={{left:'calc(12.5% - 4.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-0 h-6 w-0.5 bg-blue-400" style={{left:'calc(37.5% - 1.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-0 h-6 w-0.5 bg-violet-500" style={{left:'calc(62.5% + 1.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-0 h-6 w-0.5 bg-orange-400" style={{left:'calc(87.5% + 4.5px)', transform:'translateX(-50%)'}} />
                <div className="absolute top-6 h-0.5 bg-slate-200" style={{left:'calc(12.5% - 4.5px)', right:'calc(12.5% - 4.5px)'}} />
                <div className="absolute left-1/2 top-6 bottom-0 w-0.5 bg-slate-300 -translate-x-1/2" />
              </div>

              </div>
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
      <section id="screenshots" className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-teal-100 text-teal-700 hover:bg-teal-100">
              製品紹介
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              直感的で使いやすいインターフェース
            </h2>
            <p className="text-xl text-slate-600">
              実際の画面をご覧ください
            </p>
          </div>

          <div className="space-y-12">
            {/* Dashboard */}
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div className="order-2 lg:order-1">
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">ダッシュボード</h3>
                <p className="text-lg text-slate-600 mb-6">
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
                  <MockDashboard />
                </div>
              </div>
            </div>

            {/* Sprint List */}
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div>
                <div className="rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                  <MockSprintList />
                </div>
              </div>
              <div>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">スプリント管理 - リストビュー</h3>
                <p className="text-lg text-slate-600 mb-6">
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
                <p className="text-lg text-slate-600 mb-6">
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
                  <MockSprintBoard />
                </div>
              </div>
            </div>

            {/* Sprint Gantt */}
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div>
                <div className="rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                  <MockSprintGantt />
                </div>
              </div>
              <div>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">スプリント管理 - ガントチャート</h3>
                <p className="text-lg text-slate-600 mb-6">
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
                <p className="text-lg text-slate-600 mb-6">
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
                  <MockProjects />
                </div>
              </div>
            </div>

            {/* Members */}
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div>
                <div className="rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                  <MockMembers />
                </div>
              </div>
              <div>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">メンバー管理</h3>
                <p className="text-lg text-slate-600 mb-6">
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
      <section id="benefits" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
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
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-teal-100 text-teal-700 hover:bg-teal-100">
              料金プラン
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              シンプルで分かりやすい料金体系
            </h2>
            <p className="text-xl text-slate-600">
              チームの規模に合わせて最適なプランをお選びください
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
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
                    <span className="text-slate-700">1プロジェクトまで</span>
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
                <Button variant="outline" onClick={() => navigate('/book-demo')} className="w-full">
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
                <Button onClick={() => navigate('/book-demo')} className="w-full bg-teal-600 hover:bg-teal-700 text-white">
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
                <Button variant="outline" className="w-full">
                  お問い合わせ
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-teal-600 to-emerald-600">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-6">
            今すぐDev Ticketを始めましょう
          </h2>
          <p className="text-xl text-teal-50 mb-8">
            数分でチーム全体の生産性を向上させます。
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" onClick={() => navigate('/book-demo')} className="bg-white text-teal-600 hover:bg-slate-100 text-lg px-8 py-6">
              無料で始める
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/book-demo')} className="text-lg px-8 py-6 text-white border-white bg-transparent hover:bg-white/10 hover:text-white">
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
