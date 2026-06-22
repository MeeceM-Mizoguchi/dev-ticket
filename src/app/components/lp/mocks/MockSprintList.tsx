import { BarChart2, ChevronDown, ExternalLink, FolderOpen, LayoutGrid, List, Pencil, Plus, Trash2 } from 'lucide-react';
import { MockAppShell } from './MockAppShell';

const AVATAR_COLORS = ['#059669', '#D97706', '#059669', '#0284C7', '#7C3AED', '#DB2777'];
const avatarColor = (name: string) => AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];

const statusMeta = {
  '進行中':   { bg: '#FFF7ED', color: '#D97706' },
  '未着手':   { bg: '#F4F5F6', color: '#9E9690' },
  'クローズ': { bg: '#F3F4F6', color: '#6B7280' },
  'レビュー中': { bg: '#F5F3FF', color: '#7C3AED' },
} as const;

const priorityMeta = {
  '高': { color: '#DC2626' },
  '中': { color: '#D97706' },
  '低': { color: '#0284C7' },
} as const;

const tickets = [
  { id: 'EC-0001', title: 'トップページのビジュアルデザイン実装', detail: 'トップページのUIをブランドガイドラインに沿って刷新する',          category: 'フロントエンド', status: '進行中',   priority: '高', assignee: '田中太郎', start: '06/01', due: '06/05' },
  { id: 'EC-0002', title: 'カート機能のフロントエンド実装',       detail: 'カート追加・削除・数量変更UIとAPIの連携を実装する',             category: 'フロントエンド', status: '進行中',   priority: '高', assignee: '鈴木花子', start: '06/01', due: '06/08' },
  { id: 'EC-0003', title: '商品一覧ページのページネーション',      detail: '商品一覧にページネーション機能を追加しUXを改善する',           category: 'フロントエンド', status: 'クローズ', priority: '中', assignee: '田中太郎', start: '06/03', due: '06/06' },
  { id: 'EC-0004', title: '検索機能のAPIとの接続',                detail: '検索バーをバックエンドAPIに接続しリアルタイム検索を実現する',   category: 'バックエンド',   status: 'クローズ', priority: '中', assignee: '佐藤健',   start: '06/04', due: '06/09' },
  { id: 'EC-0005', title: 'ユーザー認証フローの実装',             detail: 'ログイン・新規登録・パスワードリセットのフローを実装する',      category: 'バックエンド',   status: '未着手',   priority: '高', assignee: '山田一郎', start: '06/02', due: '06/07' },
  { id: 'EC-0006', title: '注文確認メール送信機能',               detail: '注文完了時にSendGridで確認メールを自動送信する仕組みを作る', category: 'バックエンド',   status: '未着手',   priority: '低', assignee: '伊藤美咲', start: '06/05', due: '06/10' },
  { id: 'EC-0007', title: '決済APIとのインテグレーション',         detail: 'Stripeの決済フローをフロントエンドに組み込み完結させる',       category: 'バックエンド',   status: '未着手',   priority: '高', assignee: '田中太郎', start: '06/06', due: '06/12' },
  { id: 'EC-0008', title: 'レスポンシブデザインの調整',           detail: 'モバイル・タブレット表示のレイアウト崩れを全画面修正する',     category: 'デザイン',       status: '未着手',   priority: '中', assignee: '鈴木花子', start: '06/08', due: '06/11' },
];

const totalTickets = tickets.length;
const completedCount = tickets.filter(t => t.status === 'クローズ').length;
const progressPct = Math.round(completedCount / totalTickets * 100);

export function MockSprintList() {
  return (
    <MockAppShell activePage="projects">
      <div style={{ padding: '16px 20px', height: '100%', display: 'flex', flexDirection: 'column', background: '#F9FAFB', boxSizing: 'border-box', overflow: 'hidden' }}>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, marginBottom: 10, flexShrink: 0 }}>
          <span style={{ color: '#059669', fontWeight: 600 }}>プロジェクト</span>
          <span style={{ color: '#C9C4BB' }}>/</span>
          <span style={{ color: '#6B6458' }}>ECサイトリニューアル</span>
          <span style={{ color: '#C9C4BB' }}>/</span>
          <span style={{ color: '#B0A9A4' }}>スプリント</span>
        </div>

        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 14, fontWeight: 800, color: '#1A1714', letterSpacing: '-0.02em', margin: 0 }}>スプリント管理</h1>
            <p style={{ fontSize: 9, color: '#A09790', margin: '2px 0 0' }}>ECサイトリニューアル・1スプリント</p>
          </div>
          <button style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: '#059669', color: '#fff', fontSize: 9, fontWeight: 600, borderRadius: 9, border: 'none', cursor: 'pointer', boxShadow: '0 2px 8px rgba(5,150,105,0.25)', flexShrink: 0 }}>
            <Plus style={{ width: 10, height: 10 }} />新規スプリント
          </button>
        </div>

        {/* View tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexShrink: 0 }}>
          {([
            { Icon: List,       label: 'リスト',       active: true },
            { Icon: LayoutGrid, label: 'ボード',        active: false },
            { Icon: BarChart2,  label: 'ガントチャート', active: false },
          ] as const).map(({ Icon, label, active }) => (
            <button key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, fontSize: 9, fontWeight: 600, border: 'none', cursor: 'pointer', background: active ? '#059669' : '#FFFFFF', color: active ? '#fff' : '#9E9690', boxShadow: active ? 'none' : '0 0 0 1px rgba(26,23,20,0.10)' }}>
              <Icon style={{ width: 10, height: 10 }} />{label}
            </button>
          ))}
        </div>

        {/* Sprint card */}
        <div style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid rgba(26,23,20,0.06)', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>

          {/* Sprint header */}
          <div style={{ background: '#F9F8F6', borderRadius: '12px 12px 0 0', padding: '13px 16px', borderBottom: '1px solid rgba(26,23,20,0.06)', flexShrink: 0 }}>
            {/* Row 1: name + stats + buttons */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
              {/* Left */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <ChevronDown style={{ width: 13, height: 13, color: '#B0A9A4', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#1A1714', whiteSpace: 'nowrap' }}>第1スプリント — フロントエンド基盤構築</span>
                <span style={{ fontSize: 8, fontWeight: 700, background: '#ECFDF5', color: '#059669', padding: '2px 7px', borderRadius: 20, flexShrink: 0 }}>進行中</span>
              </div>
              {/* Right: stats */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
                {([
                  { value: String(totalTickets),    label: 'チケット' },
                  { value: String(completedCount),  label: '完了' },
                  { value: '82h',                   label: '工数(h)' },
                  { value: `${progressPct}%`,        label: '進捗' },
                  { value: '12.5h',                  label: '実績(h)', green: true },
                ] as { value: string; label: string; green?: boolean }[]).map(({ value, label, green }) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: green ? '#059669' : '#1A1714', lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</span>
                    <span style={{ fontSize: 8, color: '#B0A9A4' }}>{label}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  <span style={{ fontSize: 9, fontWeight: 500, color: '#B0A9A4', lineHeight: 1, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>06/01 → 06/12</span>
                  <span style={{ fontSize: 8, color: '#C9C4BB' }}>期間</span>
                </div>
                {/* Action buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                  <button style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 8px', background: '#ECFDF5', color: '#059669', border: '1px solid rgba(5,150,105,0.20)', borderRadius: 7, fontSize: 9, fontWeight: 600, cursor: 'pointer' }}>
                    <ExternalLink style={{ width: 9, height: 9 }} />詳細
                  </button>
                  <button style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 8px', background: '#F5F3FF', color: '#7C3AED', border: '1px solid rgba(124,58,237,0.20)', borderRadius: 7, fontSize: 9, fontWeight: 600, cursor: 'pointer' }}>
                    <Plus style={{ width: 9, height: 9 }} />新規チケット
                  </button>
                  <button style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 8px', background: '#F0F9FF', color: '#0284C7', border: '1px solid rgba(2,132,199,0.20)', borderRadius: 7, fontSize: 9, fontWeight: 600, cursor: 'pointer' }}>
                    <Plus style={{ width: 9, height: 9 }} />一括作成
                  </button>
                  {[FolderOpen, Pencil, Trash2].map((Icon, i) => (
                    <button key={i} style={{ padding: '4px', background: 'transparent', border: 'none', borderRadius: 5, cursor: 'pointer', display: 'flex' }}>
                      <Icon style={{ width: 11, height: 11, color: '#C9C4BB' }} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {/* Progress bar */}
            <div style={{ marginLeft: 21, height: 4, background: '#EDE9E0', borderRadius: 9999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, background: '#059669', borderRadius: 9999 }} />
            </div>
          </div>

          {/* Table */}
          <div style={{ overflow: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr style={{ background: '#F4F5F6', borderBottom: '1px solid rgba(26,23,20,0.08)' }}>
                  {['NO','チケット名','チケット詳細','分類','ステータス','優先度','担当者','開始日','期限日'].map(h => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 9, fontWeight: 600, color: '#9E9690', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => {
                  const sm = statusMeta[t.status as keyof typeof statusMeta] ?? { bg: '#F4F5F6', color: '#9E9690' };
                  const pm = priorityMeta[t.priority as keyof typeof priorityMeta] ?? { color: '#D97706' };
                  return (
                    <tr key={t.id} style={{ borderTop: '1px solid rgba(26,23,20,0.05)', background: '#FFFFFF', cursor: 'pointer' }}>
                      <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#059669', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap' }}>{t.id}</td>
                      <td style={{ padding: '8px 10px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 500, color: '#1A1714' }}>{t.title}</span>
                      </td>
                      <td style={{ padding: '8px 10px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 9, color: '#9C9490' }}>{t.detail}</span>
                      </td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 9, color: '#4B4744' }}>{t.category}</span>
                      </td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 8, fontWeight: 600, background: sm.bg, color: sm.color, padding: '2px 6px', borderRadius: 20 }}>{t.status}</span>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: pm.color }}>{t.priority}</span>
                      </td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div style={{ width: 18, height: 18, borderRadius: '50%', background: avatarColor(t.assignee), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                            {t.assignee.slice(0, 2)}
                          </div>
                          <span style={{ fontSize: 9, color: '#6B6458' }}>{t.assignee}</span>
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 9, color: '#B0A9A4', textAlign: 'center' }}>{t.start}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 9, color: '#B0A9A4', textAlign: 'center' }}>{t.due}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </MockAppShell>
  );
}
