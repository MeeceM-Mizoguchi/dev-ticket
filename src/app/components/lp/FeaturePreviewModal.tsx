import { useEffect, useState } from 'react';
import { X, LayoutDashboard, FolderKanban, Ticket, BarChart3, Users, Building2, GitPullRequest, MessageSquare, Search, Bell, Download, Lock, SlidersHorizontal, ListPlus } from 'lucide-react';
import { MockDashboard } from './mocks/MockDashboard';
import { MockProjects } from './mocks/MockProjects';
import { MockMembers } from './mocks/MockMembers';
import { MockSprintList } from './mocks/MockSprintList';
import { MockSprintBoard } from './mocks/MockSprintBoard';
import { MockSprintGantt } from './mocks/MockSprintGantt';
import { MockClients } from './mocks/MockClients';
import { MockReviewFlow } from './mocks/MockReviewFlow';
import { MockComments } from './mocks/MockComments';
import { MockGlobalSearch } from './mocks/MockGlobalSearch';
import { MockSlack } from './mocks/MockSlack';
import { MockCSVExport } from './mocks/MockCSVExport';
import { MockPermissions } from './mocks/MockPermissions';
import { MockMyFilter } from './mocks/MockMyFilter';
import { MockBulkCreate } from './mocks/MockBulkCreate';

type FeatureId =
  | 'dashboard' | 'projects' | 'sprint' | 'views' | 'members' | 'clients'
  | 'review' | 'comments' | 'search' | 'slack' | 'csv' | 'permissions' | 'filter' | 'bulk';

interface FeatureConfig {
  title: string;
  description: string;
  gradFrom: string;
  gradTo: string;
  Icon: typeof LayoutDashboard;
  tabs?: Array<{ id: string; label: string }>;
}

const FEATURES: Record<FeatureId, FeatureConfig> = {
  dashboard:   { title: 'ダッシュボード',       description: 'プロジェクト全体の進捗状況をリアルタイムで把握',               gradFrom: '#14b8a6', gradTo: '#0d9488', Icon: LayoutDashboard },
  projects:    { title: 'プロジェクト管理',      description: '複数のプロジェクトをクライアント・期間・メンバーごとに一元管理', gradFrom: '#10b981', gradTo: '#059669', Icon: FolderKanban },
  sprint:      { title: 'スプリント管理',        description: 'アジャイル開発に対応したスプリント・チケット管理',               gradFrom: '#3b82f6', gradTo: '#2563eb', Icon: Ticket },
  views:       { title: '3つのビュー表示',       description: 'リスト・ボード・ガントチャートの3つのビューを自由に切り替え',     gradFrom: '#a855f7', gradTo: '#9333ea', Icon: BarChart3,
    tabs: [{ id: 'list', label: 'リストビュー' }, { id: 'board', label: 'ボードビュー' }, { id: 'gantt', label: 'ガントチャート' }] },
  members:     { title: 'メンバー管理',          description: 'チームメンバーの招待・権限設定・グループ管理をシンプルに',       gradFrom: '#f97316', gradTo: '#ea580c', Icon: Users },
  clients:     { title: 'クライアント管理',      description: 'クライアント企業情報とプロジェクトを紐付けて一元管理',           gradFrom: '#ec4899', gradTo: '#db2777', Icon: Building2 },
  review:      { title: 'レビューフロー',        description: 'チケット単位のレビュー依頼・承認・差し戻しをシステム化',         gradFrom: '#6366f1', gradTo: '#4f46e5', Icon: GitPullRequest },
  comments:    { title: 'コメント・メンション',  description: 'チケット内でコメント・返信・@メンションで情報共有を促進',       gradFrom: '#06b6d4', gradTo: '#0891b2', Icon: MessageSquare },
  search:      { title: 'グローバル検索',        description: 'チケット・プロジェクト・メンバー・コメントを横断検索',           gradFrom: '#f43f5e', gradTo: '#e11d48', Icon: Search },
  slack:       { title: 'Slack通知連携',         description: 'チケット更新・レビュー依頼・コメントをSlackへリアルタイム通知', gradFrom: '#f59e0b', gradTo: '#d97706', Icon: Bell },
  csv:         { title: 'CSVエクスポート',       description: 'スプリント・プロジェクトのデータをCSVで出力・外部連携',         gradFrom: '#84cc16', gradTo: '#65a30d', Icon: Download },
  permissions: { title: '権限グループ管理',      description: 'ロール・グループごとに細かく操作権限を設定・管理',               gradFrom: '#8b5cf6', gradTo: '#7c3aed', Icon: Lock },
  filter:      { title: 'Myフィルタ',            description: 'よく使うフィルタ条件を保存してワンクリックで呼び出し',           gradFrom: '#0ea5e9', gradTo: '#0284c7', Icon: SlidersHorizontal },
  bulk:        { title: 'チケット一括作成',      description: 'スプリント開始時に複数チケットをまとめて素早く登録',             gradFrom: '#22c55e', gradTo: '#16a34a', Icon: ListPlus },
};

function renderMock(featureId: FeatureId, tab: string) {
  if (featureId === 'views') {
    if (tab === 'board') return <MockSprintBoard />;
    if (tab === 'gantt') return <MockSprintGantt />;
    return <MockSprintList />;
  }
  switch (featureId) {
    case 'dashboard':   return <MockDashboard />;
    case 'projects':    return <MockProjects />;
    case 'sprint':      return <MockSprintList />;
    case 'members':     return <MockMembers />;
    case 'clients':     return <MockClients />;
    case 'review':      return <MockReviewFlow />;
    case 'comments':    return <MockComments />;
    case 'search':      return <MockGlobalSearch />;
    case 'slack':       return <MockSlack />;
    case 'csv':         return <MockCSVExport />;
    case 'permissions': return <MockPermissions />;
    case 'filter':      return <MockMyFilter />;
    case 'bulk':        return <MockBulkCreate />;
  }
}

interface Props {
  featureId: FeatureId | null;
  onClose: () => void;
}

export function FeaturePreviewModal({ featureId, onClose }: Props) {
  const [activeTab, setActiveTab] = useState('list');

  useEffect(() => {
    if (!featureId) return;
    setActiveTab('list');
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [featureId, onClose]);

  if (!featureId) return null;

  const config = FEATURES[featureId];
  const { title, description, gradFrom, gradTo, Icon, tabs } = config;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', background: 'rgba(10,15,20,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', maxWidth: 1280, maxHeight: '92vh', background: '#FFFFFF', borderRadius: 20, boxShadow: '0 32px 80px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ background: `linear-gradient(135deg, ${gradFrom}, ${gradTo})`, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon style={{ width: 22, height: 22, color: '#fff' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0, lineHeight: 1.2 }}>{title}</h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', margin: '3px 0 0', fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif" }}>{description}</p>
          </div>

          {/* Tabs */}
          {tabs && (
            <div style={{ display: 'flex', gap: 6, background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 4 }}>
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  style={{ padding: '5px 14px', borderRadius: 7, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', background: activeTab === t.id ? '#fff' : 'transparent', color: activeTab === t.id ? '#059669' : 'rgba(255,255,255,0.75)', transition: 'all 0.15s' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={onClose}
            style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.2)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.35)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
          >
            <X style={{ width: 18, height: 18, color: '#fff' }} />
          </button>
        </div>

        {/* Mock content */}
        <div style={{ flex: 1, overflow: 'hidden', background: '#F4F5F6', position: 'relative' }}>
          <div style={{ width: '100%', aspectRatio: '16 / 9', maxHeight: '100%' }}>
            {renderMock(featureId, activeTab)}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 24px', borderTop: '1px solid rgba(26,23,20,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F9FAFB', flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: '#B0A9A4', fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif" }}>
            実際の画面イメージです · <kbd style={{ background: '#E5E7EB', borderRadius: 4, padding: '1px 5px', fontSize: 10, color: '#6B7280', fontFamily: 'monospace' }}>ESC</kbd> または背景クリックで閉じる
          </span>
          <button
            onClick={onClose}
            style={{ padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#1A1714', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
