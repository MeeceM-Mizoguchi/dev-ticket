import { useState, useCallback } from 'react';
import {
  LayoutDashboard, FolderKanban, Building2, Users, Settings, LogOut,
  CalendarRange, UserCog, BellRing, Search, Bell, Ticket,
  Plus, X, ChevronRight, ChevronDown,
  List, LayoutGrid, BarChart2,
  FolderOpen, Zap, Clock, TrendingUp,
  Calendar, MoreHorizontal,
  Pencil, Trash2, CheckCheck, AlertCircle, ExternalLink,
} from 'lucide-react';

// ─── helpers ──────────────────────────────────────────────────────────────────
const s = (o: React.CSSProperties): React.CSSProperties => o;

function avatarColor(name: string) {
  const colors = ['#059669','#0284C7','#7C3AED','#D97706','#F43F5E','#0891B2','#65A30D','#9333EA'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}
function getInitials(name: string) { return name.slice(0, 2); }

// ─── types ────────────────────────────────────────────────────────────────────
type AppPage = 'dashboard' | 'projects' | 'sprint' | 'clients' | 'members' | 'permissions' | 'roles' | 'admin-settings' | 'settings';
type SprintView = 'list' | 'board' | 'gantt';

interface Ticket {
  id: string; title: string; status: string; priority: string;
  assignee: string; initials: string; ac: string;
  start: string; due: string; hours: number; progress: number;
  description: string; category: string;
}
interface Toast { id: string; message: string; type: 'success' | 'info' | 'error' }

// ─── constants ────────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  '未着手': '#6B7280', '進行中': '#0284C7', 'レビュー中': '#7C3AED',
  'レビュー完了': '#059669', 'STG完了': '#D97706', 'UAT完了': '#F59E0B',
  '完了': '#10B981', 'クローズ': '#374151',
};
const PRIORITY_COLOR: Record<string, string> = { '高': '#DC2626', '中': '#D97706', '低': '#6B7280' };

const BOARD_COLS = [
  { label: '未着手',    color: '#6B7280' },
  { label: '進行中',    color: '#0284C7' },
  { label: 'レビュー中',  color: '#7C3AED' },
  { label: 'レビュー完了', color: '#059669' },
  { label: 'STG完了',   color: '#D97706' },
  { label: 'UAT完了',   color: '#F59E0B' },
  { label: '完了',      color: '#10B981' },
  { label: 'クローズ',  color: '#374151' },
];

// Exact data from MockSprintList
const INIT_TICKETS: Ticket[] = [
  { id: 'EC-0001', title: 'トップページのビジュアルデザイン実装', status: '進行中', priority: '高', assignee: '田中太郎', initials: '田', ac: '#059669', start: '06/01', due: '06/05', hours: 8,  progress: 60, description: 'ECサイトのトップページをデザイン仕様に合わせて実装します。', category: 'フロントエンド' },
  { id: 'EC-0002', title: 'カート機能のフロントエンド実装',       status: '進行中', priority: '高', assignee: '鈴木花子', initials: '鈴', ac: '#0284C7', start: '06/01', due: '06/08', hours: 16, progress: 40, description: 'ショッピングカートのUI・UXを実装します。', category: 'フロントエンド' },
  { id: 'EC-0003', title: '商品一覧ページのページネーション',      status: '未着手', priority: '中', assignee: '田中太郎', initials: '田', ac: '#059669', start: '06/03', due: '06/06', hours: 4,  progress: 0,  description: '商品一覧にページネーション機能を追加します。', category: 'フロントエンド' },
  { id: 'EC-0004', title: '検索機能のAPIとの接続',                status: '未着手', priority: '中', assignee: '佐藤健',   initials: '佐', ac: '#7C3AED', start: '06/04', due: '06/09', hours: 8,  progress: 0,  description: '全文検索APIと接続してリアルタイム検索を実装します。', category: 'バックエンド' },
  { id: 'EC-0005', title: 'ユーザー認証フローの実装',             status: '未着手', priority: '高', assignee: '山田一郎', initials: '山', ac: '#D97706', start: '06/02', due: '06/07', hours: 12, progress: 0,  description: 'ログイン・登録・パスワードリセットフローを実装します。', category: 'バックエンド' },
  { id: 'EC-0006', title: '注文確認メール送信機能',               status: '未着手', priority: '低', assignee: '伊藤美咲', initials: '伊', ac: '#F43F5E', start: '06/05', due: '06/10', hours: 6,  progress: 0,  description: '注文完了時にメール送信する機能を実装します。', category: 'バックエンド' },
  { id: 'EC-0007', title: '決済APIとのインテグレーション',         status: '未着手', priority: '高', assignee: '田中太郎', initials: '田', ac: '#059669', start: '06/06', due: '06/12', hours: 20, progress: 0,  description: '決済APIとの接続・テスト実装です。', category: 'バックエンド' },
  { id: 'EC-0008', title: 'レスポンシブデザインの調整',           status: '未着手', priority: '中', assignee: '鈴木花子', initials: '鈴', ac: '#0284C7', start: '06/08', due: '06/11', hours: 8,  progress: 0,  description: 'スマートフォン対応のレスポンシブCSSを実装します。', category: 'デザイン' },
];

// ─── Shell ────────────────────────────────────────────────────────────────────
// Copied exactly from MockAppShell with:
//  • width/height: 100% instead of aspectRatio 16/9
//  • nav items are <button> with onClick
//  • "LPに戻る" button added to topbar


const NAV_ITEMS: { id: string; icon: typeof LayoutDashboard; target: AppPage }[] = [
  { id: 'dashboard',      icon: LayoutDashboard, target: 'dashboard' },
  { id: 'projects',       icon: FolderKanban,    target: 'projects' },
  { id: 'clients',        icon: Building2,       target: 'clients' },
  { id: 'members',        icon: Users,           target: 'members' },
  { id: 'permissions',    icon: CalendarRange,   target: 'permissions' },
  { id: 'roles',          icon: UserCog,         target: 'roles' },
  { id: 'admin-settings', icon: BellRing,        target: 'admin-settings' },
];
const userName = '田中太郎';

function getActivePage(page: AppPage): string {
  if (page === 'sprint') return 'projects';
  if (page === 'settings') return '';
  return page;
}

interface ShellProps {
  page: AppPage; onNavigate: (p: AppPage) => void; onClose: () => void;
  children: React.ReactNode;
}
function InteractiveShell({ page, onNavigate, onClose, children }: ShellProps) {
  const activePage = getActivePage(page);
  return (
    <div style={s({ width: '100%', height: '100%', display: 'flex', background: '#F4F5F6', fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic UI', 'Segoe UI', sans-serif", overflow: 'hidden', fontSize: 12 })}>
      {/* Sidebar — exact copy of MockAppShell sidebar */}
      <aside style={s({ width: 64, background: '#FFFFFF', borderRight: '1px solid rgba(26,23,20,0.07)', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 })}>
        <div style={s({ padding: '16px 0 8px', display: 'flex', flexDirection: 'column', alignItems: 'center' })}>
          <div style={s({ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(145deg, #34D399, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(5,150,105,0.35)' })}>
            <Ticket style={{ width: 16, height: 16, color: '#fff' }} />
          </div>
        </div>
        <div style={s({ width: 28, height: 1, background: 'rgba(26,23,20,0.06)', margin: '4px 0' })} />
        <nav style={s({ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', paddingTop: 2 })}>
          {NAV_ITEMS.map(({ id, icon: Icon, target }) => {
            const active = activePage === id;
            return (
              <button
                key={id}
                onClick={() => onNavigate(target)}
                style={s({ position: 'relative', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer' })}
              >
                {active && <div style={s({ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: '0 99px 99px 0', background: '#059669' })} />}
                <div style={s({ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? '#ECFDF5' : 'transparent', border: active ? '1px solid rgba(5,150,105,0.18)' : '1px solid transparent' })}>
                  <Icon style={{ width: 15, height: 15, color: active ? '#059669' : '#9E9690' }} />
                </div>
              </button>
            );
          })}
        </nav>
        <div style={s({ width: '100%', paddingBottom: 12 })}>
          <div style={s({ width: 28, height: 1, background: 'rgba(26,23,20,0.06)', margin: '4px auto' })} />
          <button onClick={() => onNavigate('settings')} style={s({ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '7px 0', background: 'none', border: 'none', cursor: 'pointer' })}>
            <div style={s({ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: page === 'settings' ? '#ECFDF5' : 'transparent' })}>
              <Settings style={{ width: 14, height: 14, color: page === 'settings' ? '#059669' : '#C9C4BB' }} />
            </div>
          </button>
          <div style={s({ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '7px 0' })}>
            <div style={s({ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
              <LogOut style={{ width: 14, height: 14, color: '#C9C4BB' }} />
            </div>
          </div>
        </div>
      </aside>

      {/* Main area — exact copy of MockAppShell main */}
      <div style={s({ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 })}>
        <header style={s({ height: 46, background: '#FFFFFF', borderBottom: '1px solid rgba(20,26,22,0.08)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0 })}>
          <div style={s({ display: 'flex', alignItems: 'center', gap: 6, background: '#F4F5F6', borderRadius: 8, padding: '5px 10px', maxWidth: 280, flex: 1 })}>
            <Search style={{ width: 12, height: 12, color: '#B0A9A4' }} />
            <span style={s({ fontSize: 11, color: '#B0A9A4' })}>チケット・スプリント・プロジェクト・メンバーを検索...</span>
          </div>
          <div style={s({ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 })}>
            <div style={s({ position: 'relative', width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
              <Bell style={{ width: 13, height: 13, color: '#059669' }} />
              <span style={s({ position: 'absolute', top: 4, right: 4, width: 12, height: 12, borderRadius: 6, background: '#059669', border: '1.5px solid #fff', fontSize: 7, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 })}>2</span>
            </div>
            <div style={s({ width: 1, height: 16, background: 'rgba(26,23,20,0.08)', margin: '0 2px' })} />
            <div style={s({ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 4px', borderRadius: 9999, background: '#F4F5F6' })}>
              <div style={s({ width: 22, height: 22, borderRadius: 11, background: avatarColor(userName), color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>{getInitials(userName)}</div>
              <span style={s({ fontSize: 11, fontWeight: 600, color: '#3D3732' })}>{userName}</span>
            </div>
            <div style={s({ width: 1, height: 16, background: 'rgba(26,23,20,0.08)', margin: '0 4px' })} />
            <button onClick={onClose} style={s({ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#9E9690', fontSize: 10, fontWeight: 600, padding: '4px 8px', borderRadius: 6 })}>
              <ExternalLink style={{ width: 12, height: 12 }} />LPに戻る
            </button>
          </div>
        </header>
        <div style={s({ flex: 1, overflowY: 'auto' })}>{children}</div>
      </div>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function ToastArea({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 200, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div key={t.id} style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.12)', padding: '10px 14px', minWidth: 260 }}>
          {t.type === 'success' && <CheckCheck style={{ width: 14, height: 14, color: '#059669', flexShrink: 0 }} />}
          {t.type === 'error'   && <AlertCircle style={{ width: 14, height: 14, color: '#DC2626', flexShrink: 0 }} />}
          {t.type === 'info'    && <Bell style={{ width: 14, height: 14, color: '#0284C7', flexShrink: 0 }} />}
          <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', flex: 1 }}>{t.message}</span>
          <button onClick={() => onRemove(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B0A9A4', padding: 0, display: 'flex' }}>
            <X style={{ width: 12, height: 12 }} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── New Ticket Modal ─────────────────────────────────────────────────────────
const MEMBERS = ['田中太郎','鈴木花子','佐藤健','山田一郎','伊藤美咲'];
const STATUSES = ['未着手','進行中','レビュー中','レビュー完了','STG完了','UAT完了','完了','クローズ'];
const PRIORITIES = ['高','中','低'];
const CATEGORIES = ['フロントエンド', 'バックエンド', 'デザイン', 'インフラ', 'ドキュメント'];

const STATUS_META: Record<string, { color: string; bg: string }> = {
  '未着手':    { color: '#6B7280', bg: '#F4F5F6' },
  '進行中':    { color: '#0284C7', bg: '#EFF6FF' },
  'レビュー中': { color: '#7C3AED', bg: '#F5F3FF' },
  'レビュー完了': { color: '#059669', bg: '#ECFDF5' },
  'STG完了':   { color: '#D97706', bg: '#FFFBEB' },
  'UAT完了':   { color: '#F59E0B', bg: '#FFF7ED' },
  '完了':      { color: '#10B981', bg: '#ECFDF5' },
  'クローズ':  { color: '#374151', bg: '#F4F5F6' },
};
const PRIORITY_META: Record<string, { color: string; bg: string }> = {
  '高': { color: '#DC2626', bg: '#FEF2F2' },
  '中': { color: '#D97706', bg: '#FFFBEB' },
  '低': { color: '#0284C7', bg: '#F0F9FF' },
};
const PRIORITY_DOT: Record<string, string> = { '高': '#DC2626', '中': '#D97706', '低': '#6B7280' };
const STATUS_PROGRESS_DEMO: Record<string, number> = {
  '未着手': 0, '進行中': 10, 'レビュー中': 30, 'レビュー完了': 50,
  'STG完了': 70, 'UAT完了': 90, '完了': 100, 'クローズ': 100,
};
const ACTION_BTNS: Record<string, { label: string; next: string; color: string; bg: string }> = {
  '未着手':    { label: '着手開始',     next: '進行中',    color: '#0284C7', bg: '#EFF6FF' },
  '進行中':    { label: 'レビュー依頼', next: 'レビュー中', color: '#7C3AED', bg: '#F5F3FF' },
  'レビュー完了': { label: 'STG完了',  next: 'STG完了',   color: '#D97706', bg: '#FFFBEB' },
  'STG完了':   { label: 'UAT完了',    next: 'UAT完了',   color: '#F59E0B', bg: '#FFF7ED' },
  'UAT完了':   { label: 'リリース完了', next: '完了',      color: '#10B981', bg: '#ECFDF5' },
};

function NewTicketModal({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (t: Omit<Ticket, 'id' | 'progress' | 'initials' | 'ac'>) => void;
}) {
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState(false);
  const [status, setStatus] = useState('未着手');
  const [priority, setPriority] = useState('中');
  const [category, setCategory] = useState('');
  const [assignee, setAssignee] = useState('田中太郎');
  const [start, setStart] = useState('');
  const [due, setDue] = useState('');
  const [hours, setHours] = useState(0);
  const [description, setDescription] = useState('');

  const calcHours = (s: string, d: string) => {
    if (!s || !d) return 0;
    return Math.max(0, Math.round((new Date(d).getTime() - new Date(s).getTime()) / 86400000)) * 8;
  };
  const handleDateChange = (field: 'start' | 'due', v: string) => {
    const s2 = field === 'start' ? v : start;
    const d2 = field === 'due'   ? v : due;
    if (field === 'start') setStart(v); else setDue(v);
    setHours(calcHours(s2, d2));
  };

  const handleSubmit = () => {
    if (!title.trim()) { setTitleError(true); return; }
    onSubmit({ title, status, priority, assignee, start, due, hours, description, category });
    onClose();
  };

  const iStyle: React.CSSProperties = { width: '100%', border: '1px solid rgba(26,23,20,0.12)', borderRadius: 8, padding: '8px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit' };
  const lStyle: React.CSSProperties = { display: 'block', fontSize: 9, fontWeight: 700, color: '#9E9690', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,14,12,0.40)', backdropFilter: 'blur(3px)' }}>
      <div style={{ background: '#FAFAF8', borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.25)', width: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(26,23,20,0.08)', background: '#FFF', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus style={{ width: 14, height: 14, color: '#059669' }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#1A1714' }}>新規チケット作成</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B0A9A4', padding: 6, borderRadius: 8, display: 'flex' }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={lStyle}>タイトル <span style={{ color: '#DC2626' }}>*</span></label>
            <input value={title} onChange={e => { setTitle(e.target.value); if (e.target.value.trim()) setTitleError(false); }}
              placeholder="チケットのタイトルを入力" autoFocus
              style={{ ...iStyle, borderColor: titleError ? '#DC2626' : 'rgba(26,23,20,0.12)' }} />
            {titleError && <p style={{ fontSize: 10, color: '#DC2626', margin: '3px 0 0' }}>タイトルを入力してください</p>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lStyle}>ステータス</label>
              <select value={status} onChange={e => setStatus(e.target.value)} style={iStyle}>
                {STATUSES.map(st => <option key={st}>{st}</option>)}
              </select>
            </div>
            <div>
              <label style={lStyle}>優先度</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} style={iStyle}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={lStyle}>分類</label>
            <select value={category} onChange={e => setCategory(e.target.value)} style={iStyle}>
              <option value="">分類なし</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={lStyle}>担当者</label>
            <select value={assignee} onChange={e => setAssignee(e.target.value)} style={iStyle}>
              {MEMBERS.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lStyle}>開始日</label>
              <input type="date" value={start} onChange={e => handleDateChange('start', e.target.value)} style={iStyle} />
            </div>
            <div>
              <label style={lStyle}>期限日</label>
              <input type="date" value={due} onChange={e => handleDateChange('due', e.target.value)} style={iStyle} />
            </div>
          </div>
          <div>
            <label style={lStyle}>見積工数（開始・終了日から自動計算）</label>
            <div style={{ background: '#F4F5F6', borderRadius: 10, padding: '10px 14px' }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#1A1714' }}>{hours}</span>
              <span style={{ fontSize: 13, color: '#6B6458', marginLeft: 2 }}> h</span>
              {hours === 0 && <span style={{ fontSize: 11, color: '#C9C4BB', marginLeft: 8 }}>（開始日・終了日を入力すると自動計算されます）</span>}
            </div>
          </div>
          <div>
            <label style={lStyle}>詳細</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              rows={4} placeholder="チケットの詳細を入力"
              style={{ ...iStyle, resize: 'vertical', lineHeight: 1.6 }} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid rgba(26,23,20,0.08)', background: '#FFF', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 9, fontSize: 12, fontWeight: 600, border: '1px solid rgba(26,23,20,0.12)', background: '#FFF', color: '#6B7280', cursor: 'pointer' }}>キャンセル</button>
          <button onClick={handleSubmit} style={{ padding: '9px 16px', borderRadius: 9, fontSize: 12, fontWeight: 700, border: 'none', background: title.trim() ? '#059669' : '#D1D5DB', color: '#fff', cursor: title.trim() ? 'pointer' : 'not-allowed', boxShadow: title.trim() ? '0 2px 8px rgba(5,150,105,0.30)' : 'none' }}>
            作成する
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Ticket Detail Panel ──────────────────────────────────────────────────────
function TicketDetailModal({ ticket: initTicket, onClose, onStatusChange }: {
  ticket: Ticket; onClose: () => void; onStatusChange: (id: string, s: string) => void;
}) {
  const [title, setTitle] = useState(initTicket.title);
  const [status, setStatus] = useState(initTicket.status);
  const [priority, setPriority] = useState(initTicket.priority);
  const [assignee, setAssignee] = useState(initTicket.assignee);
  const [category, setCategory] = useState(initTicket.category || '');
  const [description, setDescription] = useState(initTicket.description);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([
    { id: '1', text: 'デザイン仕様書を確認しました。実装を開始します。', author: '田中太郎', time: '10:30' },
    { id: '2', text: 'APIエンドポイントの仕様を教えてください。', author: '鈴木花子', time: '14:15' },
  ]);

  const smeta = STATUS_META[status] ?? { color: '#6B7280', bg: '#F4F5F6' };
  const pmeta = PRIORITY_META[priority] ?? { color: '#6B7280', bg: '#F4F5F6' };
  const progress = STATUS_PROGRESS_DEMO[status] ?? initTicket.progress;
  const actionBtn = ACTION_BTNS[status];

  const handleAction = () => {
    if (!actionBtn) return;
    const next = actionBtn.next;
    onStatusChange(initTicket.id, next);
    setStatus(next);
  };

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    const t = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    setComments(prev => [...prev, { id: Date.now().toString(), text: commentText, author: '田中太郎', time: t }]);
    setCommentText('');
  };

  const fBox: React.CSSProperties = { background: '#FFF', border: '1px solid rgba(26,23,20,0.07)', borderRadius: 10, padding: '10px 12px' };
  const fLabel: React.CSSProperties = { fontSize: 9, color: '#B0A9A4', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 5, display: 'block' };
  const iStyle: React.CSSProperties = { width: '100%', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 8, padding: '6px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#FFF', fontFamily: 'inherit' };

  return (
    <>
      <style>{`@keyframes slideInPanel{from{transform:translateX(102%)}to{transform:translateX(0)}}`}</style>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(10,14,12,0.30)', backdropFilter: 'blur(3px)' }} />
      <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '56%', minWidth: 520, background: '#FAFAF8', zIndex: 151, boxShadow: '-16px 0 60px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', animation: 'slideInPanel 0.28s cubic-bezier(0.16,1,0.3,1)', fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif" }}>

        {/* Header */}
        <div style={{ padding: '16px 24px 14px', borderBottom: '1px solid rgba(26,23,20,0.07)', background: '#FFF', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' as const }}>
                <span style={{ fontSize: 10, color: '#B0A9A4', fontFamily: 'monospace', background: '#F4F5F6', padding: '2px 8px', borderRadius: 5 }}>{initTicket.id}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: smeta.bg, color: smeta.color }}>{status}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: pmeta.bg, color: pmeta.color }}>優先度: {priority}</span>
              </div>
              <input value={title} onChange={e => setTitle(e.target.value)}
                style={{ fontSize: 16, fontWeight: 800, color: '#1A1714', background: 'transparent', border: 'none', outline: 'none', width: '100%', padding: 0, borderBottom: '1.5px solid transparent', transition: 'border-color 0.15s' }}
                onFocus={e => { e.currentTarget.style.borderBottomColor = '#059669'; }}
                onBlur={e => { e.currentTarget.style.borderBottomColor = 'transparent'; }} />
            </div>
            <button onClick={onClose} style={{ padding: 7, borderRadius: 9, border: 'none', background: 'transparent', cursor: 'pointer', color: '#B0A9A4', display: 'flex', flexShrink: 0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#F4F5F6'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <div style={{ flex: 1, height: 6, background: '#EDE9E0', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: '#059669', borderRadius: 99, transition: 'width 0.6s ease' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#1A1714', flexShrink: 0 }}>{progress}%</span>
          </div>
          {/* Action button */}
          {actionBtn && (
            <button onClick={handleAction}
              style={{ width: '100%', padding: '8px 0', fontSize: 12, fontWeight: 700, borderRadius: 9, border: `1.5px solid ${actionBtn.color}33`, cursor: 'pointer', background: actionBtn.bg, color: actionBtn.color, marginTop: 10 }}>
              {actionBtn.label} →
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}
          onClick={() => assigneeOpen && setAssigneeOpen(false)}>

          {/* ステータス | 優先度 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={fBox}>
              <span style={fLabel}>ステータス</span>
              <select value={status} onChange={e => { const v = e.target.value; setStatus(v); onStatusChange(initTicket.id, v); }}
                style={{ ...iStyle, fontWeight: 600, color: smeta.color }}>
                {STATUSES.map(st => <option key={st}>{st}</option>)}
              </select>
            </div>
            <div style={fBox}>
              <span style={fLabel}>優先度</span>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                style={{ ...iStyle, fontWeight: 600, color: PRIORITY_META[priority]?.color ?? '#6B7280' }}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {/* 分類 */}
          <div style={fBox}>
            <span style={fLabel}>分類</span>
            <select value={category} onChange={e => setCategory(e.target.value)} style={iStyle}>
              <option value="">分類なし</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* 担当者 */}
          <div style={{ ...fBox, position: 'relative' }}>
            <span style={fLabel}>担当者</span>
            <button onClick={e => { e.stopPropagation(); setAssigneeOpen(o => !o); }}
              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontWeight: 600, color: '#1A1714', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 24, height: 24, borderRadius: 12, background: avatarColor(assignee), color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{getInitials(assignee)}</div>
                <span>{assignee || '未割り当て'}</span>
              </div>
              <ChevronDown style={{ width: 12, height: 12, color: '#B0A9A4', transform: assigneeOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
            {assigneeOpen && (
              <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#FFF', border: '1px solid rgba(26,23,20,0.12)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden', marginTop: 4 }}>
                {MEMBERS.map(n => (
                  <button key={n} onClick={() => { setAssignee(n); setAssigneeOpen(false); }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', background: assignee === n ? '#ECFDF5' : 'transparent', border: 'none', textAlign: 'left' as const }}>
                    <div style={{ width: 24, height: 24, borderRadius: 12, background: avatarColor(n), color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{getInitials(n)}</div>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#1A1714' }}>{n}</span>
                    {assignee === n && <CheckCheck style={{ width: 12, height: 12, color: '#059669', marginLeft: 'auto' }} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 開始日 | 期限日 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={fBox}>
              <span style={fLabel}>開始日</span>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1714' }}>{initTicket.start || '—'}</div>
            </div>
            <div style={fBox}>
              <span style={fLabel}>期限日</span>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1714' }}>{initTicket.due || '—'}</div>
            </div>
          </div>

          {/* 見積工数 */}
          <div style={{ background: '#F4F5F6', borderRadius: 10, padding: '10px 14px' }}>
            <span style={fLabel}>見積工数</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: '#1A1714' }}>{initTicket.hours}</span>
            <span style={{ fontSize: 13, color: '#6B6458', marginLeft: 2 }}> h</span>
          </div>

          {/* 起票者 | 起票日 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: '#F4F5F6', borderRadius: 10, padding: '10px 12px' }}>
              <span style={fLabel}>起票者</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1714' }}>田中太郎</span>
            </div>
            <div style={{ background: '#F4F5F6', borderRadius: 10, padding: '10px 12px' }}>
              <span style={fLabel}>起票日</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1714' }}>2025/06/01</span>
            </div>
          </div>

          {/* 詳細 */}
          <div>
            <span style={{ ...fLabel, marginBottom: 7 }}>詳細</span>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              rows={5} placeholder="詳細を入力..."
              style={{ ...iStyle, resize: 'vertical', lineHeight: 1.6 }} />
          </div>

          {/* コメント */}
          <div>
            <span style={{ ...fLabel, marginBottom: 10 }}>コメント</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {comments.map(c => (
                <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 14, background: avatarColor(c.author), color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{getInitials(c.author)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#1A1714' }}>{c.author}</span>
                      <span style={{ fontSize: 10, color: '#B0A9A4' }}>{c.time}</span>
                    </div>
                    <div style={{ background: '#FFF', border: '1px solid rgba(26,23,20,0.07)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#374151', lineHeight: 1.6 }}>{c.text}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 14, background: '#059669', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>田</div>
              <div style={{ flex: 1, display: 'flex', gap: 8 }}>
                <textarea value={commentText} onChange={e => setCommentText(e.target.value)}
                  rows={2} placeholder="コメントを追加... (Ctrl+Enter で投稿)"
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddComment(); }}
                  style={{ ...iStyle, flex: 1, resize: 'none', lineHeight: 1.5 }} />
                <button onClick={handleAddComment} disabled={!commentText.trim()}
                  style={{ padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: 'none', background: commentText.trim() ? '#059669' : '#F4F5F6', color: commentText.trim() ? '#fff' : '#B0A9A4', cursor: commentText.trim() ? 'pointer' : 'default', alignSelf: 'flex-end', whiteSpace: 'nowrap' as const }}>
                  投稿
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────
function InviteModal({ onClose, onInvite }: { onClose: () => void; onInvite: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('デベロッパー');
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.40)' }}>
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.22)', width: 420, overflow: 'hidden', fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid rgba(26,23,20,0.08)', background: '#FAFAFA' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1A1714' }}>メンバーを招待</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9E9690', display: 'flex', padding: 4 }}><X style={{ width: 14, height: 14 }} /></button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={s({ display: 'block', fontSize: 9, fontWeight: 600, color: '#9E9690', marginBottom: 4 })}>メールアドレス *</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="example@company.com" autoFocus
              style={s({ width: '100%', border: '1px solid rgba(26,23,20,0.12)', borderRadius: 8, padding: '7px 10px', fontSize: 11, boxSizing: 'border-box', fontFamily: 'inherit' })} />
          </div>
          <div>
            <label style={s({ display: 'block', fontSize: 9, fontWeight: 600, color: '#9E9690', marginBottom: 4 })}>ロール</label>
            <select value={role} onChange={e => setRole(e.target.value)}
              style={s({ width: '100%', border: '1px solid rgba(26,23,20,0.12)', borderRadius: 8, padding: '7px 10px', fontSize: 11, background: '#fff' })}>
              {['デベロッパー','デザイナー','PMO','アドミン'].map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid rgba(26,23,20,0.08)', background: '#F9FAFB' }}>
          <button onClick={onClose} style={s({ padding: '7px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, border: 'none', background: '#F4F5F6', color: '#6B7280', cursor: 'pointer' })}>キャンセル</button>
          <button onClick={() => { if (email) { onInvite(email); onClose(); } }} disabled={!email}
            style={s({ padding: '7px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, border: 'none', background: email ? '#059669' : '#D1D5DB', color: '#fff', cursor: email ? 'pointer' : 'not-allowed' })}>招待を送る</button>
        </div>
      </div>
    </div>
  );
}

// ─── New Sprint Modal ─────────────────────────────────────────────────────────
function NewSprintModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [goal, setGoal] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const handleSubmit = () => {
    if (!name.trim()) { setNameError(true); return; }
    onCreated(name);
    onClose();
  };

  const iStyle: React.CSSProperties = { width: '100%', border: '1px solid rgba(26,23,20,0.12)', borderRadius: 8, padding: '8px 12px', fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit' };
  const lStyle: React.CSSProperties = { display: 'block', fontSize: 9, fontWeight: 700, color: '#9E9690', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,14,12,0.40)', backdropFilter: 'blur(3px)' }}>
      <div style={{ background: '#FAFAF8', borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.25)', width: 500, overflow: 'hidden', fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(26,23,20,0.08)', background: '#FFF' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus style={{ width: 14, height: 14, color: '#059669' }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#1A1714' }}>新規スプリント作成</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B0A9A4', padding: 6, display: 'flex' }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lStyle}>スプリント名 <span style={{ color: '#DC2626' }}>*</span></label>
            <input value={name} onChange={e => { setName(e.target.value); if (e.target.value.trim()) setNameError(false); }}
              placeholder="例：第2スプリント — バックエンドAPI構築" autoFocus
              style={{ ...iStyle, borderColor: nameError ? '#DC2626' : 'rgba(26,23,20,0.12)' }} />
            {nameError && <p style={{ fontSize: 10, color: '#DC2626', margin: '3px 0 0' }}>スプリント名を入力してください</p>}
          </div>
          <div>
            <label style={lStyle}>ゴール</label>
            <textarea value={goal} onChange={e => setGoal(e.target.value)}
              rows={2} placeholder="このスプリントのゴールを入力"
              style={{ ...iStyle, resize: 'none', lineHeight: 1.6 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lStyle}>開始日</label>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} style={iStyle} />
            </div>
            <div>
              <label style={lStyle}>終了日</label>
              <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={iStyle} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid rgba(26,23,20,0.08)', background: '#F9FAFB' }}>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 9, fontSize: 12, fontWeight: 600, border: '1px solid rgba(26,23,20,0.12)', background: '#FFF', color: '#6B7280', cursor: 'pointer' }}>キャンセル</button>
          <button onClick={handleSubmit} style={{ padding: '9px 16px', borderRadius: 9, fontSize: 12, fontWeight: 700, border: 'none', background: name.trim() ? '#059669' : '#D1D5DB', color: '#fff', cursor: name.trim() ? 'pointer' : 'not-allowed', boxShadow: name.trim() ? '0 2px 8px rgba(5,150,105,0.30)' : 'none' }}>
            作成する
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────
// Inner content copied from MockDashboard (inside <MockAppShell>)
const projectBars = [
  { name: 'ECサイトリニューアル', done: 8, inProgress: 5, todo: 12 },
  { name: 'モバイルアプリ開発',   done: 15, inProgress: 8, todo: 6 },
  { name: '社内システム改修',     done: 3,  inProgress: 2, todo: 10 },
  { name: 'APIゲートウェイ構築',  done: 12, inProgress: 10, todo: 9 },
];
const dashProjects = [
  { name: 'ECサイトリニューアル', client: '株式会社サンプル商事', progress: 52, status: '進行中', color: '#059669' },
  { name: 'モバイルアプリ開発',   client: 'テクノ株式会社',       progress: 64, status: '進行中', color: '#059669' },
  { name: '社内システム改修',     client: 'ビジネス合同会社',     progress: 20, status: '計画中', color: '#6B7280' },
];

function DashboardPage({ tickets, onNewTicket, onTicket }: {
  tickets: Ticket[]; onNewTicket: () => void; onTicket: (t: Ticket) => void;
}) {
  const maxTotal = Math.max(...projectBars.map(p => p.done + p.inProgress + p.todo));
  const activeTickets = tickets.filter(t => t.status === '進行中');

  return (
    <div style={s({ padding: '32px 28px', background: '#F5F6F8' })}>
      <div style={s({ marginBottom: 28, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' })}>
        <div>
          <p style={s({ fontSize: 10, color: '#B0A9A4', letterSpacing: '0.10em', marginBottom: 8 })}>2026年6月8日 月曜日</p>
          <h1 style={s({ fontSize: 32, fontWeight: 800, color: '#1A1714', letterSpacing: '-0.04em', lineHeight: 1.05, margin: 0 })}>
            こんにちは、<span style={s({ color: '#059669' })}>田中太郎</span>さん
          </h1>
          <p style={s({ fontSize: 13, color: '#A09790', marginTop: 8, lineHeight: 1 })}>今日のチーム状況 — 6月8日 時点</p>
        </div>
        <button onClick={onNewTicket} style={s({ display: 'flex', alignItems: 'center', gap: 6, background: '#059669', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 10px rgba(5,150,105,0.30)' })}>
          <Plus style={{ width: 14, height: 14 }} />新規チケット
        </button>
      </div>

      <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 24 })}>
        {[
          { icon: FolderOpen, label: '進行中プロジェクト', value: '2',   trend: '全4件',        tUp: true,  accent: '#059669', accentBg: '#ECFDF5' },
          { icon: Zap,        label: '進行中チケット',     value: String(activeTickets.length), trend: '期限超過 1件', tUp: false, accent: '#D97706', accentBg: '#FFFBEB' },
          { icon: Clock,      label: '未着手チケット',     value: String(tickets.filter(t => t.status === '未着手').length), trend: `全${tickets.length}件`, tUp: true, accent: '#0284C7', accentBg: '#F0F9FF' },
          { icon: TrendingUp, label: 'チーム完了率',       value: '52%', trend: '完了 13件',    tUp: true,  accent: '#059669', accentBg: '#ECFDF5' },
        ].map(({ icon: Icon, label, value, trend, tUp, accent, accentBg }) => (
          <div key={label} style={s({ background: '#FFFFFF', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)', display: 'flex' })}>
            <div style={s({ width: 4, background: accent, flexShrink: 0 })} />
            <div style={s({ flex: 1, padding: '18px 18px 18px 16px' })}>
              <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 })}>
                <div style={s({ width: 32, height: 32, borderRadius: 9, background: accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                  <Icon style={{ width: 15, height: 15, color: accent }} />
                </div>
                <span style={s({ fontSize: 9, color: tUp ? '#059669' : '#D97706', fontWeight: 600, background: tUp ? '#ECFDF5' : '#FFFBEB', padding: '2px 7px', borderRadius: 20 })}>{trend}</span>
              </div>
              <p style={s({ fontSize: 34, fontWeight: 800, color: '#1A1714', letterSpacing: '-0.04em', lineHeight: 1, margin: 0 })}>{value}</p>
              <p style={s({ fontSize: 11, color: '#A09790', marginTop: 5, lineHeight: 1 })}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div style={s({ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginBottom: 16 })}>
        <div style={s({ background: '#FFFFFF', borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)' })}>
          <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 })}>
            <div>
              <h2 style={s({ fontSize: 13, fontWeight: 700, color: '#1A1714', margin: 0 })}>プロジェクト進捗</h2>
              <p style={s({ fontSize: 10, color: '#B0A9A4', marginTop: 3 })}>ステータス別チケット集計</p>
            </div>
            <div style={s({ display: 'flex', gap: 10 })}>
              {[['#059669','完了'],['#D97706','進行中'],['#E6E2D9','未着手']].map(([c,l]) => (
                <div key={l} style={s({ display: 'flex', alignItems: 'center', gap: 5 })}>
                  <div style={s({ width: 8, height: 8, borderRadius: 2, background: c })} />
                  <span style={s({ fontSize: 10, color: '#B0A9A4', fontWeight: 500 })}>{l}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={s({ display: 'flex', flexDirection: 'column', gap: 14 })}>
            {projectBars.map(p => {
              const total = p.done + p.inProgress + p.todo;
              return (
                <div key={p.name} style={s({ display: 'flex', alignItems: 'center', gap: 12 })}>
                  <span style={s({ fontSize: 11, color: '#9E9690', width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{p.name}</span>
                  <div style={s({ flex: 1, display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', gap: 1 })}>
                    {p.done > 0       && <div style={s({ width: `${p.done/maxTotal*100}%`,       background: '#059669' })} />}
                    {p.inProgress > 0 && <div style={s({ width: `${p.inProgress/maxTotal*100}%`, background: '#D97706' })} />}
                    {p.todo > 0       && <div style={s({ width: `${p.todo/maxTotal*100}%`,       background: '#E6E2D9' })} />}
                  </div>
                  <span style={s({ fontSize: 10, color: '#B0A9A4', width: 24, textAlign: 'right', flexShrink: 0 })}>{total}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={s({ background: '#FFFFFF', borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)' })}>
          <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 })}>
            <span style={s({ fontSize: 13, fontWeight: 700, color: '#1A1714' })}>アクティブチケット</span>
            <span style={s({ fontSize: 10, background: '#F4F5F6', color: '#9E9690', borderRadius: 20, padding: '2px 8px', fontWeight: 600 })}>{activeTickets.length}件</span>
          </div>
          <div style={s({ display: 'flex', flexDirection: 'column', gap: 2 })}>
            {activeTickets.slice(0, 5).map((t, i) => (
              <button key={i} onClick={() => onTicket(t)} style={s({ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', borderBottom: '1px solid rgba(26,23,20,0.05)', cursor: 'pointer', width: '100%', textAlign: 'left', padding: '8px 4px' })}>
                <div style={s({ width: 28, height: 28, borderRadius: 14, background: t.ac, color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>{t.initials}</div>
                <div style={s({ minWidth: 0 })}>
                  <div style={s({ fontSize: 12, color: '#1A1714', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 })}>{t.title}</div>
                  <span style={s({ fontSize: 10, fontWeight: 600, color: STATUS_COLOR[t.status] ?? '#6B7280' })}>{t.status}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={s({ background: '#FFFFFF', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)' })}>
        <div style={s({ fontSize: 13, fontWeight: 700, color: '#1A1714', padding: '14px 20px', borderBottom: '1px solid rgba(26,23,20,0.06)' })}>プロジェクト一覧</div>
        {dashProjects.map(p => (
          <div key={p.name} style={s({ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', borderBottom: '1px solid rgba(26,23,20,0.05)' })}>
            <div style={s({ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 })} />
            <div style={s({ flex: 1, minWidth: 0 })}>
              <div style={s({ fontSize: 13, fontWeight: 600, color: '#1A1714', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{p.name}</div>
              <div style={s({ fontSize: 11, color: '#B0A9A4' })}>{p.client}</div>
            </div>
            <div style={s({ width: 100, height: 6, background: '#F4F5F6', borderRadius: 3, overflow: 'hidden', flexShrink: 0 })}>
              <div style={s({ height: '100%', background: '#059669', width: `${p.progress}%`, borderRadius: 3 })} />
            </div>
            <span style={s({ fontSize: 11, color: '#6B7280', width: 32, textAlign: 'right', flexShrink: 0 })}>{p.progress}%</span>
            <span style={s({ fontSize: 10, fontWeight: 600, color: p.color, background: `${p.color}15`, borderRadius: 20, padding: '3px 8px', flexShrink: 0 })}>{p.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sprint Page ──────────────────────────────────────────────────────────────
// Content copied from MockSprintList / MockSprintBoard / MockSprintGantt

const days = Array.from({ length: 20 }, (_, i) => i + 1);
const colW = 24;
const LEFT_W = 140;
const todayDay = 1;

function SprintPage({ tickets, view, onView, onNavigate, onNewTicket, onTicket, onNewSprint, onToast }: {
  tickets: Ticket[]; view: SprintView; onView: (v: SprintView) => void;
  onNavigate: (p: AppPage) => void; onNewTicket: () => void; onTicket: (t: Ticket) => void;
  onNewSprint: () => void; onToast: (msg: string) => void;
}) {
  const [sprintCollapsed, setSprintCollapsed] = useState(false);
  const doneCount = tickets.filter(t => t.status === '完了').length;
  const totalHours = tickets.reduce((a, t) => a + t.hours, 0);
  const avgProgress = Math.round(tickets.reduce((a, t) => a + t.progress, 0) / Math.max(tickets.length, 1));

  return (
    <div style={s({ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16, background: '#F5F6F8', minHeight: '100%', boxSizing: 'border-box' })}>
      {/* Breadcrumb */}
      <div style={s({ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#B0A9A4' })}>
        <button onClick={() => onNavigate('projects')} style={s({ color: '#059669', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: 0, display: 'flex', alignItems: 'center', gap: 4 })}>
          <FolderKanban style={{ width: 12, height: 12 }} />プロジェクト
        </button>
        <ChevronRight style={{ width: 11, height: 11 }} />
        <span style={s({ color: '#1A1714', fontWeight: 600 })}>ECサイトリニューアル</span>
      </div>

      {/* Title */}
      <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' })}>
        <div>
          <h1 style={s({ fontSize: 20, fontWeight: 800, color: '#1A1714', margin: 0 })}>スプリント管理</h1>
          <p style={s({ fontSize: 12, color: '#B0A9A4', margin: '4px 0 0' })}>ECサイトリニューアル · 1スプリント</p>
        </div>
        <button onClick={onNewSprint} style={s({ display: 'flex', alignItems: 'center', gap: 6, background: '#059669', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 10px rgba(5,150,105,0.30)' })}>
          <Plus style={{ width: 14, height: 14 }} />新規スプリント
        </button>
      </div>

      {/* View tabs */}
      <div style={s({ background: '#FFFFFF', border: '1px solid rgba(26,23,20,0.08)', borderRadius: 10, padding: 4, display: 'flex', gap: 4, width: 'fit-content' })}>
        {[
          { key: 'list'  as SprintView, Icon: List,       label: 'リスト' },
          { key: 'board' as SprintView, Icon: LayoutGrid,  label: 'ボード' },
          { key: 'gantt' as SprintView, Icon: BarChart2,   label: 'ガントチャート' },
        ].map(({ key, Icon, label }) => {
          const active = view === key;
          return (
            <button key={key} onClick={() => onView(key)} style={s({ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: active ? '#059669' : 'transparent', color: active ? '#fff' : '#9E9690' })}>
              <Icon style={{ width: 13, height: 13 }} />{label}
            </button>
          );
        })}
      </div>

      {/* LIST VIEW */}
      {view === 'list' && (
        <div style={s({ background: '#FFFFFF', borderRadius: 12, border: '1px solid rgba(26,23,20,0.06)', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' })}>

          {/* Sprint header (帯) */}
          <div style={s({ background: '#F9F8F6', padding: '13px 16px', borderBottom: sprintCollapsed ? 'none' : '1px solid rgba(26,23,20,0.06)' })}>
            <div style={s({ display: 'flex', alignItems: 'flex-start', gap: 8 })}>
              {/* Collapse toggle */}
              <button onClick={() => setSprintCollapsed(c => !c)} style={s({ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#B0A9A4', flexShrink: 0, marginTop: 3 })}>
                <ChevronDown style={{ width: 14, height: 14, transform: sprintCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }} />
              </button>

              {/* Left: name + status + goal + progress */}
              <div style={s({ flex: 1, minWidth: 0 })}>
                <div style={s({ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' as const })}>
                  <span style={s({ fontSize: 14, fontWeight: 700, color: '#1A1714' })}>第1スプリント — フロントエンド基盤構築</span>
                  <span style={s({ fontSize: 10, fontWeight: 700, background: '#DBEAFE', color: '#0284C7', padding: '2px 8px', borderRadius: 20, flexShrink: 0 })}>進行中</span>
                </div>
                <p style={s({ fontSize: 11, color: '#B0A9A4', margin: '0 0 8px' })}>ECサイトのフロントエンド部分をReactで構築し、APIとの接続を完了する</p>
                <div style={s({ height: 4, background: '#E6E2D9', borderRadius: 2, overflow: 'hidden', maxWidth: 240 })}>
                  <div style={s({ height: '100%', background: '#059669', width: `${Math.round(doneCount / Math.max(tickets.length, 1) * 100)}%` })} />
                </div>
              </div>

              {/* Right: stats + date + buttons */}
              <div style={s({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' as const })}>
                {/* Stats */}
                {[
                  { label: 'チケット', value: tickets.length },
                  { label: '完了',     value: doneCount },
                  { label: '工数(h)',  value: totalHours },
                  { label: '進捗',     value: `${avgProgress}%` },
                  { label: '実績h',    value: 0 },
                ].map((stat, i, arr) => (
                  <div key={stat.label} style={s({ textAlign: 'center', paddingRight: i < arr.length - 1 ? 8 : 0, borderRight: i < arr.length - 1 ? '1px solid rgba(26,23,20,0.08)' : 'none' })}>
                    <div style={s({ fontSize: 16, fontWeight: 700, color: '#1A1714', lineHeight: 1 })}>{stat.value}</div>
                    <div style={s({ fontSize: 10, color: '#B0A9A4', marginTop: 2 })}>{stat.label}</div>
                  </div>
                ))}

                {/* Date range */}
                <span style={s({ fontSize: 10, color: '#B0A9A4', fontFamily: 'monospace', paddingLeft: 4, whiteSpace: 'nowrap' })}>05/31 → 06/12</span>

                {/* Action buttons */}
                <button onClick={() => onToast('スプリント詳細')}
                  style={s({ fontSize: 10, fontWeight: 600, background: '#ECFDF5', color: '#059669', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' })}>詳細</button>
                <button onClick={onNewTicket}
                  style={s({ fontSize: 10, fontWeight: 600, background: '#F5F3FF', color: '#7C3AED', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 3 })}>
                  <Plus style={{ width: 10, height: 10 }} />新規チケット
                </button>
                <button onClick={() => onToast('一括作成ダイアログを開く')}
                  style={s({ fontSize: 10, fontWeight: 600, background: '#F0F9FF', color: '#0284C7', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' })}>一括作成</button>
                <button onClick={() => onToast('Myフィルタを設定')} title="Myフィルタ"
                  style={s({ padding: '4px 6px', background: 'none', border: 'none', cursor: 'pointer', color: '#B0A9A4' })}>
                  <FolderOpen style={{ width: 13, height: 13 }} />
                </button>
                <button onClick={() => onToast('スプリントを編集')} title="編集"
                  style={s({ padding: '4px 6px', background: 'none', border: 'none', cursor: 'pointer', color: '#B0A9A4' })}>
                  <Pencil style={{ width: 13, height: 13 }} />
                </button>
                <button onClick={() => onToast('スプリントを削除しますか？')} title="削除"
                  style={s({ padding: '4px 6px', background: 'none', border: 'none', cursor: 'pointer', color: '#B0A9A4' })}>
                  <Trash2 style={{ width: 13, height: 13 }} />
                </button>
              </div>
            </div>
          </div>

          {/* Column headers + rows */}
          {!sprintCollapsed && (
            <div style={s({ overflowX: 'auto' })}>
              <div style={s({ minWidth: 900 })}>
                {/* Column headers */}
                <div style={s({ display: 'grid', gridTemplateColumns: '56px 1fr 160px 90px 110px 60px 106px 62px 62px 72px', background: '#F9FAFB', borderBottom: '1px solid rgba(26,23,20,0.06)', padding: '0 4px' })}>
                  {['No', 'チケット名', 'チケット詳細', '分類', 'ステータス', '優先度', '担当者', '開始日', '期限日'].map(h => (
                    <div key={h} style={s({ padding: '8px 8px', fontSize: 11, fontWeight: 600, color: '#9E9690', whiteSpace: 'nowrap' })}>{h}</div>
                  ))}
                  {/* CSV + filter buttons */}
                  <div style={s({ padding: '6px 4px', display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' })}>
                    <button onClick={() => onToast('CSVをダウンロードしました')}
                      style={s({ fontSize: 9, fontWeight: 600, background: '#EFF6FF', color: '#0284C7', border: 'none', borderRadius: 5, padding: '3px 7px', cursor: 'pointer', whiteSpace: 'nowrap' })}>CSV</button>
                    <button onClick={() => onToast('フィルタを保存しました')}
                      style={s({ fontSize: 9, fontWeight: 600, background: '#ECFDF5', color: '#059669', border: 'none', borderRadius: 5, padding: '3px 7px', cursor: 'pointer', whiteSpace: 'nowrap' })}>保存</button>
                  </div>
                </div>

                {/* Ticket rows */}
                {tickets.map(t => {
                  const smeta = STATUS_META[t.status] ?? { color: '#6B7280', bg: '#F4F5F6' };
                  const pmeta = PRIORITY_META[t.priority] ?? { color: '#6B7280', bg: '#F4F5F6' };
                  const pdot  = PRIORITY_DOT[t.priority] ?? '#6B7280';
                  return (
                    <div key={t.id} onClick={() => onTicket(t)}
                      style={s({ display: 'grid', gridTemplateColumns: '56px 1fr 160px 90px 110px 60px 106px 62px 62px 72px', borderBottom: '1px solid rgba(26,23,20,0.04)', background: '#FFFFFF', cursor: 'pointer', padding: '0 4px', alignItems: 'center' })}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#F9FAFB'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#FFFFFF'; }}>
                      {/* No (WBS) */}
                      <div style={s({ padding: '10px 8px', fontSize: 10, fontFamily: 'monospace', color: '#059669', fontWeight: 700, whiteSpace: 'nowrap' })}>{t.id}</div>
                      {/* チケット名 */}
                      <div style={s({ padding: '10px 8px', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 })}>
                        <div style={s({ width: 6, height: 6, borderRadius: 3, background: pdot, flexShrink: 0 })} />
                        <span style={s({ fontSize: 12, color: '#1A1714', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{t.title}</span>
                      </div>
                      {/* チケット詳細 */}
                      <div style={s({ padding: '10px 8px', fontSize: 11, color: '#B0A9A4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{t.description}</div>
                      {/* 分類 */}
                      <div style={s({ padding: '10px 8px' })}>
                        {t.category && <span style={s({ fontSize: 10, color: '#6B7280', background: '#F4F5F6', borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap', display: 'inline-block' })}>{t.category}</span>}
                      </div>
                      {/* ステータス */}
                      <div style={s({ padding: '10px 8px' })}>
                        <span style={s({ fontSize: 10, fontWeight: 600, color: smeta.color, background: smeta.bg, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap', display: 'inline-block' })}>{t.status}</span>
                      </div>
                      {/* 優先度 */}
                      <div style={s({ padding: '10px 8px' })}>
                        <span style={s({ fontSize: 10, fontWeight: 700, color: pmeta.color, background: pmeta.bg, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap', display: 'inline-block' })}>{t.priority}</span>
                      </div>
                      {/* 担当者 */}
                      <div style={s({ padding: '10px 8px', display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 })}>
                        <div style={s({ width: 20, height: 20, borderRadius: 10, background: t.ac, color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>{t.initials}</div>
                        <span style={s({ fontSize: 11, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{t.assignee}</span>
                      </div>
                      {/* 開始日 */}
                      <div style={s({ padding: '10px 8px', fontSize: 10, color: '#9E9690', fontFamily: 'monospace', whiteSpace: 'nowrap' })}>{t.start}</div>
                      {/* 期限日 */}
                      <div style={s({ padding: '10px 8px', fontSize: 10, color: '#9E9690', fontFamily: 'monospace', whiteSpace: 'nowrap' })}>{t.due}</div>
                      {/* (empty last cell) */}
                      <div />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* BOARD VIEW */}
      {view === 'board' && (
        <>
          <div style={s({ borderBottom: '2px solid #059669', paddingBottom: 8, flexShrink: 0 })}>
            <span style={s({ fontSize: 14, fontWeight: 700, color: '#1A1714' })}>第1スプリント — フロントエンド基盤構築</span>
            <p style={s({ fontSize: 11, color: '#B0A9A4', margin: '4px 0 0' })}>ECサイトのフロントエンド部分をReactで構築し、APIとの接続を完了する</p>
            <div style={s({ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, fontSize: 11 })}>
              <span style={s({ color: '#9E9690' })}>05/31 → 06/12</span>
              <button onClick={() => onToast('スプリント詳細')} style={s({ color: '#059669', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: 0 })}>詳細</button>
              <button onClick={onNewTicket} style={s({ color: '#7C3AED', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: 0 })}><Plus style={{ width: 11, height: 11 }} />新規チケット</button>
            </div>
          </div>
          <div style={s({ display: 'flex', gap: 10, overflowX: 'auto', flex: 1 })}>
            {BOARD_COLS.map(col => {
              const cards = tickets.filter(t => t.status === col.label);
              return (
                <div key={col.label} style={s({ flex: '0 0 150px', display: 'flex', flexDirection: 'column' })}>
                  <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 })}>
                    <span style={s({ fontSize: 12, fontWeight: 700, color: col.color })}>{col.label}</span>
                    <span style={s({ fontSize: 10, color: '#B0A9A4', background: '#F4F5F6', borderRadius: 10, padding: '2px 6px', fontWeight: 600 })}>{cards.length}</span>
                  </div>
                  <div style={s({ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflow: 'hidden' })}>
                    {cards.map(card => {
                      const cpm = PRIORITY_META[card.priority] ?? { color: '#6B7280', bg: '#F4F5F6' };
                      return (
                        <button key={card.id} onClick={() => onTicket(card)} style={s({ background: '#FFFFFF', borderRadius: 8, border: '1px solid rgba(26,23,20,0.07)', padding: '10px 12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', cursor: 'pointer', textAlign: 'left' })}>
                          <div style={s({ fontSize: 10, fontFamily: 'monospace', color: '#059669', marginBottom: 6, fontWeight: 700 })}>{card.id}</div>
                          <div style={s({ fontSize: 11, color: '#1A1714', fontWeight: 500, lineHeight: 1.4, marginBottom: 8, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const })}>{card.title}</div>
                          <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}>
                            <div style={s({ width: 22, height: 22, borderRadius: 11, background: card.ac, color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>{card.initials}</div>
                            <span style={s({ fontSize: 9, fontWeight: 700, color: cpm.color, background: cpm.bg, padding: '2px 6px', borderRadius: 20 })}>{card.priority}</span>
                          </div>
                        </button>
                      );
                    })}
                    {cards.length === 0 && <div style={s({ fontSize: 11, color: '#D1D5DB', textAlign: 'center', padding: '16px 0' })}>なし</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* GANTT VIEW */}
      {view === 'gantt' && (
        <div style={s({ background: '#FFFFFF', borderRadius: 12, border: '1px solid rgba(26,23,20,0.06)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' })}>
          <div style={s({ display: 'flex', overflowX: 'auto' })}>
            <div style={s({ width: 180, flexShrink: 0, borderRight: '1px solid rgba(26,23,20,0.06)', display: 'flex', flexDirection: 'column' })}>
              <div style={s({ height: 28, borderBottom: '1px solid rgba(26,23,20,0.06)', background: '#F9FAFB', display: 'flex', alignItems: 'center', padding: '0 12px' })}>
                <span style={s({ fontSize: 11, fontWeight: 700, color: '#9E9690' })}>スプリント</span>
              </div>
              <div style={s({ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#F9FAFB', borderBottom: '1px solid rgba(26,23,20,0.06)' })}>
                <ChevronDown style={{ width: 12, height: 12, color: '#9E9690' }} />
                <div>
                  <div style={s({ fontSize: 11, fontWeight: 700, color: '#1A1714' })}>第1スプリント</div>
                  <div style={s({ display: 'flex', gap: 6 })}>
                    <span style={s({ fontSize: 10, fontWeight: 600, color: '#D97706' })}>進行中</span>
                    <span style={s({ fontSize: 10, color: '#B0A9A4' })}>6%</span>
                  </div>
                </div>
              </div>
              {tickets.map(t => {
                const tSC = t.status === '進行中' ? '#D97706' : '#6B7280';
                return (
                  <button key={t.id} onClick={() => onTicket(t)} style={s({ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'none', border: 'none', borderBottom: '1px solid rgba(26,23,20,0.04)', cursor: 'pointer', width: '100%', textAlign: 'left' })}>
                    <div style={s({ width: 7, height: 7, borderRadius: '50%', background: tSC, flexShrink: 0 })} />
                    <span style={s({ fontSize: 10, fontFamily: 'monospace', color: '#6B7280' })}>{t.id}</span>
                    <span style={s({ fontSize: 10, fontWeight: 600, color: tSC })}>{t.status}</span>
                  </button>
                );
              })}
            </div>
            <div style={s({ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 480 })}>
              <div style={s({ height: 14, background: '#F9FAFB', borderBottom: '1px solid rgba(26,23,20,0.04)', display: 'flex', alignItems: 'center' })}>
                <div style={s({ width: colW * 12, flexShrink: 0, paddingLeft: 8, fontSize: 10, fontWeight: 700, color: '#9E9690' })}>6月</div>
                <div style={s({ width: colW * 8, flexShrink: 0, paddingLeft: 4, fontSize: 10, fontWeight: 700, color: '#9E9690' })}>7月</div>
              </div>
              <div style={s({ height: 14, background: '#F9FAFB', borderBottom: '1px solid rgba(26,23,20,0.06)', display: 'flex', alignItems: 'center' })}>
                {days.map(d => (
                  <div key={d} style={s({ width: colW, flexShrink: 0, textAlign: 'center', fontSize: 9, color: d === todayDay ? '#059669' : '#B0A9A4', fontWeight: d === todayDay ? 700 : 400 })}>{d}</div>
                ))}
              </div>
              <div style={s({ height: 32, position: 'relative', borderBottom: '1px solid rgba(26,23,20,0.06)', background: '#F9FAFB', flexShrink: 0 })}>
                <div style={s({ position: 'absolute', left: (todayDay - 0.5) * colW, top: 0, bottom: 0, width: 1, background: '#059669', zIndex: 1 })} />
                <div style={s({ position: 'absolute', left: 0, top: 7, height: 18, width: 12 * colW, background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 4, display: 'flex', alignItems: 'center', padding: '0 8px', boxSizing: 'border-box' })}>
                  <span style={s({ fontSize: 10, fontWeight: 600, color: '#059669', flex: 1 })}>第1スプリント</span>
                  <span style={s({ fontSize: 10, color: '#059669', fontWeight: 600 })}>06/12</span>
                </div>
              </div>
              {tickets.map(t => {
                const startDay = parseInt(t.start.split('/')[1]);
                const endDay   = parseInt(t.due.split('/')[1]);
                const tSC      = t.status === '進行中' ? '#D97706' : '#6B7280';
                return (
                  <div key={t.id} style={s({ height: 28, position: 'relative', borderBottom: '1px solid rgba(26,23,20,0.04)' })}>
                    <div style={s({ position: 'absolute', left: (todayDay - 0.5) * colW, top: 0, bottom: 0, width: 1, background: 'rgba(5,150,105,0.15)' })} />
                    <div style={s({ position: 'absolute', left: (startDay - 1) * colW, width: Math.max((endDay - startDay + 1) * colW, colW), top: 6, height: 16, borderRadius: 4, background: tSC === '#D97706' ? '#FEF3C7' : '#F3F4F6', borderLeft: `2px solid ${tSC}`, display: 'flex', alignItems: 'center', padding: '0 6px', boxSizing: 'border-box' })}>
                      <span style={s({ fontSize: 9, color: '#6B7280', whiteSpace: 'nowrap' })}>{t.due} {t.status}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Projects Page ────────────────────────────────────────────────────────────
// Inner content copied from MockProjects; clicking a card → sprint page
const projData = [
  { id: 'P-001', name: 'ECサイトリニューアル',  client: '株式会社サンプル商事', status: '進行中', sC: '#059669', desc: 'オンラインショップのUI刷新とバックエンドAPI接続', done: 8,  inP: 5,  todo: 12, progress: 32, start: '05/01', end: '07/31', members: ['田','鈴','佐','山'] },
  { id: 'P-002', name: 'モバイルアプリ開発',    client: 'テクノ株式会社',       status: '進行中', sC: '#059669', desc: 'iOS/Androidアプリの新規開発',                    done: 15, inP: 8,  todo: 6,  progress: 52, start: '04/15', end: '08/15', members: ['伊','田'] },
  { id: 'P-003', name: '社内システム改修',      client: 'ビジネス合同会社',     status: '計画中', sC: '#6B7280', desc: '既存の社内管理システムをモダン化',              done: 0,  inP: 0,  todo: 0,  progress: 0,  start: '—',    end: '—',    members: ['佐','山','伊','鈴'] },
  { id: 'P-004', name: 'APIゲートウェイ構築',   client: 'クラウドサービス株式会社', status: '進行中', sC: '#059669', desc: 'マイクロサービス向けAPIゲートウェイの設計・実装', done: 3,  inP: 2,  todo: 8,  progress: 8,  start: '05/31', end: '06/30', members: ['田','鈴','佐','山'] },
];
const projMemberColors: Record<string, string> = { '田': '#059669', '鈴': '#0284C7', '佐': '#7C3AED', '山': '#D97706', '伊': '#F43F5E' };
const projFilters = ['すべて 4','進行中 3','計画中 1','保留中 0','完了 0'];
const projFilterValues = ['すべて','進行中','計画中','保留中','完了'];

function ProjectsPage({ onNavigate }: { onNavigate: (p: AppPage) => void }) {
  const [activeFilter, setActiveFilter] = useState(0);
  const shown = activeFilter === 0 ? projData : projData.filter(p => p.status === projFilterValues[activeFilter]);

  return (
    <div style={s({ padding: '24px', background: '#F5F6F8' })}>
      <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 })}>
        <div>
          <h1 style={s({ fontSize: 20, fontWeight: 800, color: '#1A1714', margin: 0 })}>プロジェクト管理</h1>
          <p style={s({ fontSize: 11, color: '#B0A9A4', margin: '4px 0 0' })}>進行中のプロジェクトとスプリント</p>
        </div>
        <button style={s({ display: 'flex', alignItems: 'center', gap: 4, background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' })}>
          <Plus style={{ width: 13, height: 13 }} />新規プロジェクト
        </button>
      </div>
      <div style={s({ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 })}>
        <div style={s({ display: 'flex', alignItems: 'center', gap: 6, background: '#FFFFFF', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 8, padding: '7px 12px' })}>
          <Search style={{ width: 13, height: 13, color: '#B0A9A4' }} />
          <span style={s({ fontSize: 12, color: '#B0A9A4' })}>名前、クライアントで検索...</span>
        </div>
        <div style={s({ display: 'flex', gap: 4 })}>
          {projFilters.map((f, i) => (
            <button key={f} onClick={() => setActiveFilter(i)}
              style={s({ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: i === activeFilter ? '#059669' : '#FFFFFF', color: i === activeFilter ? '#fff' : '#9E9690', boxShadow: i === activeFilter ? 'none' : '0 0 0 1px rgba(26,23,20,0.10)' })}>{f}</button>
          ))}
        </div>
      </div>
      <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 })}>
        {shown.map(p => {
          const total = p.done + p.inP + p.todo;
          const dotColor = p.status === '進行中' ? '#FB923C' : p.status === '完了' ? '#10B981' : p.status === '保留中' ? '#F59E0B' : '#C9C4BB';
          const statusBg = p.status === '進行中' ? '#ECFDF5' : p.status === '完了' ? '#ECFDF5' : p.status === '保留中' ? '#FFFBEB' : '#F4F5F6';
          const statusTx = p.status === '進行中' ? '#059669' : p.status === '完了' ? '#059669' : p.status === '保留中' ? '#D97706' : '#A09790';
          return (
            <div key={p.id} onClick={() => onNavigate('sprint')}
              style={s({ background: '#FFFFFF', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)' })}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 28px rgba(26,23,20,0.12)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)'; (e.currentTarget as HTMLElement).style.transform = 'none'; }}>
              <div style={s({ height: 5, background: `linear-gradient(90deg, ${dotColor}, ${dotColor}CC)` })} />
              <div style={s({ padding: '16px 18px 18px' })}>
                <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 })}>
                  <div style={s({ flex: 1, minWidth: 0 })}>
                    <div style={s({ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 })}>
                      <span style={s({ fontSize: 10, color: '#B0A9A4', fontFamily: 'monospace' })}>{p.id}</span>
                      <span style={s({ fontSize: 10, background: statusBg, color: statusTx, padding: '2px 7px', borderRadius: 20, fontWeight: 600 })}>{p.status}</span>
                    </div>
                    <h3 style={s({ fontSize: 14, fontWeight: 700, color: '#1A1714', lineHeight: 1.3, marginBottom: 3, margin: 0 })}>{p.name}</h3>
                    <p style={s({ fontSize: 11, color: '#B0A9A4', display: 'flex', alignItems: 'center', gap: 4, margin: '4px 0 0' })}>
                      <Building2 style={{ width: 10, height: 10 }} />{p.client}
                    </p>
                  </div>
                  <button style={s({ padding: 6, borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', color: '#C9C4BB', display: 'flex' })} onClick={e => e.stopPropagation()}>
                    <MoreHorizontal style={{ width: 15, height: 15 }} />
                  </button>
                </div>
                <p style={s({ fontSize: 11, color: '#A09790', lineHeight: 1.6, marginBottom: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{p.desc}</p>
                <div style={s({ marginBottom: 14 })}>
                  <div style={s({ display: 'flex', justifyContent: 'space-between', marginBottom: 6 })}>
                    <span style={s({ fontSize: 10, color: '#B0A9A4', fontWeight: 600 })}>進捗</span>
                    <span style={s({ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#3D3732' })}>{p.progress}%</span>
                  </div>
                  <div style={s({ height: 6, background: '#F4F5F6', borderRadius: 3, overflow: 'hidden' })}>
                    <div style={s({ height: '100%', background: '#059669', width: `${p.progress}%`, borderRadius: 3 })} />
                  </div>
                  <div style={s({ display: 'flex', gap: 12, marginTop: 8 })}>
                    <span style={s({ fontSize: 10, color: '#059669', display: 'flex', alignItems: 'center', gap: 4 })}>✓{p.done}</span>
                    <span style={s({ fontSize: 10, color: '#D97706', display: 'flex', alignItems: 'center', gap: 4 })}>⚡{p.inP}</span>
                    <span style={s({ fontSize: 10, color: '#C9C4BB', display: 'flex', alignItems: 'center', gap: 4 })}>○{p.todo}</span>
                    <span style={s({ fontSize: 10, color: '#C9C4BB', marginLeft: 'auto' })}>{total}件</span>
                  </div>
                </div>
                <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid rgba(26,23,20,0.05)' })}>
                  <span style={s({ fontSize: 10, color: '#B0A9A4', display: 'flex', alignItems: 'center', gap: 4 })}>
                    <Calendar style={{ width: 10, height: 10 }} />{p.start} – {p.end}
                  </span>
                  <div style={s({ display: 'flex' })}>
                    {p.members.map((m, i) => (
                      <div key={m} style={s({ width: 24, height: 24, borderRadius: 12, background: projMemberColors[m] || '#6B7280', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff', marginLeft: i === 0 ? 0 : -8, zIndex: 4 - i })}>{m}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Members Page ─────────────────────────────────────────────────────────────
// Inner content copied exactly from MockMembers
const membersData = [
  { name: '田中太郎', email: 'tanaka@example.com',   roleLabel: 'アドミン',     rC: '#F43F5E', group: '管理グループ',   status: 'アクティブ', sC: '#059669', projects: 3, tickets: 12, initials: '田', ac: '#059669' },
  { name: '鈴木花子', email: 'suzuki@example.com',   roleLabel: 'デベロッパー', rC: '#0284C7', group: '開発チーム',     status: 'アクティブ', sC: '#059669', projects: 2, tickets: 8,  initials: '鈴', ac: '#0284C7' },
  { name: '佐藤健',   email: 'sato@example.com',     roleLabel: 'デザイナー',   rC: '#7C3AED', group: 'デザインチーム', status: 'アクティブ', sC: '#059669', projects: 2, tickets: 5,  initials: '佐', ac: '#7C3AED' },
  { name: '山田一郎', email: 'yamada@example.com',   roleLabel: 'PMO',         rC: '#059669', group: '管理グループ',   status: 'アクティブ', sC: '#059669', projects: 4, tickets: 3,  initials: '山', ac: '#D97706' },
  { name: '伊藤美咲', email: 'ito@example.com',      roleLabel: 'デベロッパー', rC: '#0284C7', group: '開発チーム',     status: 'アクティブ', sC: '#059669', projects: 1, tickets: 6,  initials: '伊', ac: '#F43F5E' },
  { name: '渡辺誠',   email: 'watanabe@example.com', roleLabel: 'デベロッパー', rC: '#0284C7', group: '開発チーム',     status: '招待中',   sC: '#D97706', projects: 0, tickets: 0,  initials: '渡', ac: '#6B7280' },
];
const memberTabs = ['すべて 6','アドミン 1','PMO 1','デベロッパー 3','デザイナー 1'];
const memberTabRoles = ['', 'アドミン', 'PMO', 'デベロッパー', 'デザイナー'];

function MembersPage({ onInvite, onToast }: { onInvite: () => void; onToast: (msg: string) => void }) {
  const [activeTab, setActiveTab] = useState(0);
  const shown = activeTab === 0 ? membersData : membersData.filter(m => m.roleLabel === memberTabRoles[activeTab]);

  const ROLE_GRAD: Record<string, { grad: string; badge: string; text: string }> = {
    'アドミン':     { grad: 'linear-gradient(135deg,#FB7185,#F43F5E)', badge: '#FFF1F2', text: '#F43F5E' },
    'PMO':         { grad: 'linear-gradient(135deg,#34D399,#059669)', badge: '#ECFDF5', text: '#059669' },
    'デベロッパー': { grad: 'linear-gradient(135deg,#38BDF8,#0284C7)', badge: '#F0F9FF', text: '#0284C7' },
    'デザイナー':   { grad: 'linear-gradient(135deg,#A78BFA,#7C3AED)', badge: '#F5F3FF', text: '#7C3AED' },
  };

  return (
    <div style={s({ padding: '24px', background: '#F5F6F8' })}>
      <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 })}>
        <div>
          <h1 style={s({ fontSize: 20, fontWeight: 800, color: '#1A1714', margin: 0 })}>メンバー管理</h1>
          <p style={s({ fontSize: 11, color: '#B0A9A4', margin: '4px 0 0' })}>全6名 · アクティブ5名</p>
        </div>
        <button onClick={onInvite} style={s({ display: 'flex', alignItems: 'center', gap: 4, background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' })}>
          <Plus style={{ width: 13, height: 13 }} />メンバー招待
        </button>
      </div>
      <div style={s({ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 })}>
        <div style={s({ background: '#FFFFFF', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#B0A9A4', minWidth: 180 })}>名前、メールで検索...</div>
        <div style={s({ display: 'flex', gap: 4 })}>
          {memberTabs.map((t, i) => (
            <button key={t} onClick={() => setActiveTab(i)}
              style={s({ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: i === activeTab ? '#059669' : '#FFFFFF', color: i === activeTab ? '#fff' : '#9E9690', boxShadow: i === activeTab ? 'none' : '0 0 0 1px rgba(26,23,20,0.10)' })}>{t}</button>
          ))}
        </div>
      </div>
      <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 })}>
        {shown.map(m => {
          const rc = ROLE_GRAD[m.roleLabel] ?? { grad: 'linear-gradient(135deg,#6B7280,#374151)', badge: '#F9FAFB', text: '#6B7280' };
          return (
            <div key={m.email} style={s({ background: '#FFFFFF', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)', cursor: 'pointer' })}>
              <div style={s({ height: 60, background: rc.grad, position: 'relative' })}>
                <div style={s({ position: 'absolute', bottom: -20, left: 18, width: 44, height: 44, borderRadius: 22, background: m.ac, color: '#fff', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '3px solid #fff', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' })}>{m.initials}</div>
              </div>
              <div style={s({ padding: '28px 18px 18px' })}>
                <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 })}>
                  <div>
                    <div style={s({ fontSize: 15, fontWeight: 700, color: '#1A1714' })}>{m.name}</div>
                    <div style={s({ fontSize: 11, color: '#B0A9A4' })}>{m.email}</div>
                  </div>
                  <span style={s({ fontSize: 10, fontWeight: 700, color: rc.text, background: rc.badge, borderRadius: 20, padding: '3px 8px' })}>{m.roleLabel}</span>
                </div>
                <div style={s({ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 })}>
                  <span style={s({ fontSize: 10, fontWeight: 600, color: m.sC, background: `${m.sC}15`, borderRadius: 20, padding: '2px 8px' })}>{m.status}</span>
                  <span style={s({ fontSize: 10, color: '#B0A9A4' })}>{m.group}</span>
                </div>
                <div style={s({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, paddingTop: 12, borderTop: '1px solid rgba(26,23,20,0.06)', marginBottom: 14 })}>
                  <div>
                    <div style={s({ fontSize: 22, fontWeight: 800, color: '#1A1714' })}>{m.projects}</div>
                    <div style={s({ fontSize: 10, color: '#B0A9A4' })}>プロジェクト</div>
                  </div>
                  <div>
                    <div style={s({ fontSize: 22, fontWeight: 800, color: '#1A1714' })}>{m.tickets}</div>
                    <div style={s({ fontSize: 10, color: '#B0A9A4' })}>チケット</div>
                  </div>
                </div>
                <div style={s({ display: 'flex', gap: 6 })}>
                  <button onClick={() => onToast(`${m.name} の詳細を表示`)} style={s({ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#6B7280', background: 'none', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 8, padding: '7px 0', cursor: 'pointer' })}>
                    詳細
                  </button>
                  <button onClick={() => onToast(`${m.name} を編集`)} style={s({ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#6B7280', background: 'none', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 8, padding: '7px 0', cursor: 'pointer' })}>
                    <Pencil style={{ width: 11, height: 11 }} />編集
                  </button>
                  <button onClick={() => onToast(`${m.name} を削除しますか？`)} style={s({ width: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 8, cursor: 'pointer' })}>
                    <Trash2 style={{ width: 11, height: 11, color: '#C9C4BB' }} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Clients Page ────────────────────────────────────────────────────────────
const clientsData = [
  { id: 'C-001', name: '株式会社サンプル商事', industry: 'EC / 小売', email: 'contact@sample.co.jp', phone: '03-1234-5678', active: true },
  { id: 'C-002', name: 'テクノ株式会社', industry: 'IT / SaaS', email: 'info@techno.co.jp', phone: '03-2345-6789', active: true },
  { id: 'C-003', name: 'ビジネス合同会社', industry: '製造業', email: 'biz@business.co.jp', phone: '06-3456-7890', active: false },
  { id: 'C-004', name: 'クラウドサービス株式会社', industry: 'クラウド / インフラ', email: 'cloud@example.jp', phone: '03-4567-8901', active: true },
  { id: 'C-005', name: 'デザイン工房', industry: 'デザイン / クリエイティブ', email: 'hello@design.jp', phone: '03-5678-9012', active: true },
];

function ClientsPage({ onToast }: { onToast: (msg: string) => void }) {
  return (
    <div style={s({ padding: '24px', background: '#F5F6F8' })}>
      <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 })}>
        <div>
          <h1 style={s({ fontSize: 20, fontWeight: 800, color: '#1A1714', margin: 0 })}>クライアント管理</h1>
          <p style={s({ fontSize: 11, color: '#B0A9A4', margin: '4px 0 0' })}>全{clientsData.length}社</p>
        </div>
        <button onClick={() => onToast('新規クライアントを追加')} style={s({ display: 'flex', alignItems: 'center', gap: 4, background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' })}>
          <Plus style={{ width: 13, height: 13 }} />新規クライアント
        </button>
      </div>
      <div style={s({ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 })}>
        <div style={s({ display: 'flex', alignItems: 'center', gap: 6, background: '#FFFFFF', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 8, padding: '7px 12px', flex: 1, maxWidth: 320 })}>
          <Search style={{ width: 13, height: 13, color: '#B0A9A4' }} />
          <span style={s({ fontSize: 12, color: '#B0A9A4' })}>企業名・業界で検索...</span>
        </div>
      </div>
      <div style={s({ background: '#FFFFFF', border: '1px solid rgba(26,23,20,0.08)', borderRadius: 14, overflow: 'hidden' })}>
        <div style={s({ display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 1.2fr 100px 80px', gap: 0, padding: '10px 16px', background: '#F9FAFB', borderBottom: '1px solid rgba(26,23,20,0.08)' })}>
          {['企業名', '業界', '連絡先', 'ステータス', '操作'].map(h => (
            <span key={h} style={s({ fontSize: 10, fontWeight: 700, color: '#9E9690' })}>{h}</span>
          ))}
        </div>
        {clientsData.map((c, i) => (
          <div key={c.id} style={s({ display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 1.2fr 100px 80px', gap: 0, padding: '14px 16px', borderBottom: i < clientsData.length - 1 ? '1px solid rgba(26,23,20,0.05)' : 'none', alignItems: 'center' })}>
            <div style={s({ display: 'flex', alignItems: 'center', gap: 10 })}>
              <div style={s({ width: 34, height: 34, borderRadius: 10, background: '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                <Building2 style={{ width: 16, height: 16, color: '#059669' }} />
              </div>
              <div>
                <div style={s({ fontSize: 13, fontWeight: 600, color: '#1A1714' })}>{c.name}</div>
                <div style={s({ fontSize: 10, color: '#B0A9A4', fontFamily: 'monospace' })}>{c.id}</div>
              </div>
            </div>
            <span style={s({ fontSize: 11, color: '#6B7280' })}>{c.industry}</span>
            <div>
              <div style={s({ fontSize: 11, color: '#3D3732' })}>{c.email}</div>
              <div style={s({ fontSize: 10, color: '#B0A9A4' })}>{c.phone}</div>
            </div>
            <span style={s({ fontSize: 10, fontWeight: 600, color: c.active ? '#059669' : '#9E9690', background: c.active ? '#ECFDF5' : '#F4F5F6', borderRadius: 20, padding: '3px 10px', display: 'inline-block' })}>{c.active ? 'アクティブ' : '非アクティブ'}</span>
            <div style={s({ display: 'flex', gap: 6 })}>
              <button onClick={() => onToast(`${c.name} を編集`)} style={s({ width: 30, height: 30, borderRadius: 7, border: '1px solid rgba(26,23,20,0.10)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                <Pencil style={{ width: 12, height: 12, color: '#6B7280' }} />
              </button>
              <button onClick={() => onToast(`${c.name} を削除しますか？`)} style={s({ width: 30, height: 30, borderRadius: 7, border: '1px solid rgba(26,23,20,0.10)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                <Trash2 style={{ width: 12, height: 12, color: '#C9C4BB' }} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Permissions Page ─────────────────────────────────────────────────────────
const permMembers = ['田中太郎', '鈴木花子', '佐藤健', '山田一郎', '伊藤美咲'];
const permGroups = [
  { name: '開発チーム', members: ['鈴木花子', '佐藤健', '伊藤美咲'] },
  { name: '管理グループ', members: ['田中太郎', '山田一郎'] },
];
const permProjects = [
  { name: 'ECサイトリニューアル', groups: ['開発チーム'] },
  { name: 'モバイルアプリ開発', groups: ['開発チーム', '管理グループ'] },
  { name: '社内システム改修', groups: ['管理グループ'] },
];

function PermissionsPage() {
  return (
    <div style={s({ padding: '28px 24px', background: '#F5F6F8' })}>
      <div style={s({ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 })}>
        <div style={s({ width: 36, height: 36, borderRadius: 10, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
          <CalendarRange style={{ width: 18, height: 18, color: '#0284C7' }} />
        </div>
        <div>
          <h1 style={s({ fontSize: 20, fontWeight: 800, color: '#1A1714', margin: 0 })}>アサイン計画</h1>
          <p style={s({ fontSize: 11, color: '#B0A9A4', margin: '2px 0 0' })}>メンバーをグループに割り当て、プロジェクトへアサインします</p>
        </div>
      </div>
      <div style={s({ display: 'grid', gridTemplateColumns: '260px 260px 1fr', gap: 16 })}>
        {/* Column 1: Members */}
        <div style={s({ background: '#FFFFFF', borderRadius: 12, border: '1px solid rgba(26,23,20,0.08)', overflow: 'hidden' })}>
          <div style={s({ padding: '12px 14px', borderBottom: '1px solid rgba(26,23,20,0.06)', background: '#F9FAFB' })}>
            <div style={s({ fontSize: 12, fontWeight: 700, color: '#1A1714' })}>メンバー</div>
            <div style={s({ fontSize: 10, color: '#B0A9A4' })}>{permMembers.length}名</div>
          </div>
          {permMembers.map(name => (
            <div key={name} style={s({ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid rgba(26,23,20,0.04)', cursor: 'grab' })}>
              <div style={s({ width: 30, height: 30, borderRadius: 15, background: avatarColor(name), color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>{name.slice(0, 1)}</div>
              <span style={s({ fontSize: 12, color: '#1A1714', fontWeight: 500 })}>{name}</span>
            </div>
          ))}
        </div>
        {/* Column 2: Groups */}
        <div style={s({ background: '#FFFFFF', borderRadius: 12, border: '1px solid rgba(26,23,20,0.08)', overflow: 'hidden' })}>
          <div style={s({ padding: '12px 14px', borderBottom: '1px solid rgba(26,23,20,0.06)', background: '#F9FAFB' })}>
            <div style={s({ fontSize: 12, fontWeight: 700, color: '#1A1714' })}>グループ</div>
            <div style={s({ fontSize: 10, color: '#B0A9A4' })}>{permGroups.length}グループ</div>
          </div>
          {permGroups.map(g => (
            <div key={g.name} style={s({ padding: '12px 14px', borderBottom: '1px solid rgba(26,23,20,0.04)' })}>
              <div style={s({ fontSize: 12, fontWeight: 700, color: '#1A1714', marginBottom: 6 })}>{g.name}</div>
              <div style={s({ display: 'flex', gap: 4, flexWrap: 'wrap' })}>
                {g.members.map(m => (
                  <div key={m} style={s({ display: 'flex', alignItems: 'center', gap: 4, background: '#F4F5F6', borderRadius: 20, padding: '3px 8px' })}>
                    <div style={s({ width: 18, height: 18, borderRadius: 9, background: avatarColor(m), color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>{m.slice(0,1)}</div>
                    <span style={s({ fontSize: 10, color: '#3D3732' })}>{m}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* Column 3: Projects */}
        <div style={s({ background: '#FFFFFF', borderRadius: 12, border: '1px solid rgba(26,23,20,0.08)', overflow: 'hidden' })}>
          <div style={s({ padding: '12px 14px', borderBottom: '1px solid rgba(26,23,20,0.06)', background: '#F9FAFB' })}>
            <div style={s({ fontSize: 12, fontWeight: 700, color: '#1A1714' })}>プロジェクト</div>
            <div style={s({ fontSize: 10, color: '#B0A9A4' })}>{permProjects.length}件</div>
          </div>
          {permProjects.map(p => (
            <div key={p.name} style={s({ padding: '12px 14px', borderBottom: '1px solid rgba(26,23,20,0.04)' })}>
              <div style={s({ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 })}>
                <FolderKanban style={{ width: 14, height: 14, color: '#059669' }} />
                <span style={s({ fontSize: 12, fontWeight: 700, color: '#1A1714' })}>{p.name}</span>
              </div>
              <div style={s({ display: 'flex', gap: 4 })}>
                {p.groups.map(g => (
                  <span key={g} style={s({ fontSize: 10, fontWeight: 600, color: '#0284C7', background: '#EFF6FF', borderRadius: 20, padding: '2px 8px' })}>{g}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Roles Page ───────────────────────────────────────────────────────────────
const rolesData = [
  { name: 'アドミン', label: 'admin', color: '#F43F5E', perms: ['canSkipReview', 'canAccessMembers', 'canAccessRoles', 'canAccessGroups', 'canAccessAdminSettings'] },
  { name: 'プロジェクトマネージャー', label: 'project-manager', color: '#059669', perms: ['canAccessMembers', 'canAccessGroups'] },
  { name: 'デベロッパー', label: 'developer', color: '#0284C7', perms: ['canSkipReview'] },
  { name: 'デザイナー', label: 'designer', color: '#7C3AED', perms: [] },
];
const PERM_FLAGS = [
  { key: 'canSkipReview', label: 'レビュースキップ' },
  { key: 'canAccessMembers', label: 'メンバー管理' },
  { key: 'canAccessRoles', label: 'ロール設定' },
  { key: 'canAccessGroups', label: 'グループ管理' },
  { key: 'canAccessAdminSettings', label: '管理者設定' },
];

function RolesPage({ onToast }: { onToast: (msg: string) => void }) {
  return (
    <div style={s({ padding: '28px 32px', background: '#F5F6F8' })}>
      <div style={s({ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 })}>
        <div style={s({ width: 36, height: 36, borderRadius: 10, background: '#F5F3FF', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
          <UserCog style={{ width: 18, height: 18, color: '#7C3AED' }} />
        </div>
        <div>
          <h1 style={s({ fontSize: 20, fontWeight: 800, color: '#1A1714', margin: 0 })}>ロール設定</h1>
          <p style={s({ fontSize: 11, color: '#B0A9A4', margin: '2px 0 0' })}>全{rolesData.length}ロール</p>
        </div>
        <button onClick={() => onToast('新規ロールを作成')} style={s({ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, background: '#7C3AED', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' })}>
          <Plus style={{ width: 13, height: 13 }} />ロールを追加
        </button>
      </div>
      <div style={s({ background: '#F5F3FF', border: '1px solid rgba(124,58,237,0.15)', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 11, color: '#7C3AED' })}>
        ここで設定した権限は管理画面へのアクセス制御に使われます
      </div>
      <div style={s({ display: 'flex', flexDirection: 'column', gap: 8 })}>
        {rolesData.map(r => (
          <div key={r.name} style={s({ background: '#FFFFFF', borderRadius: 12, border: '1px solid rgba(26,23,20,0.08)', padding: '16px 18px' })}>
            <div style={s({ display: 'flex', alignItems: 'center', gap: 12 })}>
              <div style={s({ width: 10, height: 10, borderRadius: 5, background: r.color, flexShrink: 0 })} />
              <div style={s({ flex: 1 })}>
                <div style={s({ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 })}>
                  <span style={s({ fontSize: 14, fontWeight: 700, color: '#1A1714' })}>{r.name}</span>
                  <span style={s({ fontSize: 10, fontFamily: 'monospace', color: '#B0A9A4' })}>{r.label}</span>
                </div>
                <div style={s({ display: 'flex', gap: 6, flexWrap: 'wrap' })}>
                  {PERM_FLAGS.map(f => (
                    <span key={f.key} style={s({ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: r.perms.includes(f.key) ? `${r.color}15` : '#F4F5F6', color: r.perms.includes(f.key) ? r.color : '#C9C4BB' })}>{f.label}</span>
                  ))}
                </div>
              </div>
              <div style={s({ display: 'flex', gap: 6 })}>
                <button onClick={() => onToast(`${r.name} を編集`)} style={s({ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(26,23,20,0.10)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                  <Pencil style={{ width: 13, height: 13, color: '#6B7280' }} />
                </button>
                <button onClick={() => onToast(`${r.name} を削除しますか？`)} style={s({ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(26,23,20,0.10)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                  <Trash2 style={{ width: 13, height: 13, color: '#C9C4BB' }} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Admin Settings Page (通知管理) ──────────────────────────────────────────
const notifTypes = [
  { key: 'email', label: 'メール通知', desc: 'チケット更新時にメールを送信' },
  { key: 'assign', label: 'アサイン通知', desc: 'タスクが割り当てられた際に通知' },
  { key: 'status', label: 'ステータス変更通知', desc: 'チケットのステータスが変わった際' },
  { key: 'comment', label: 'コメント通知', desc: 'コメントが追加された際' },
  { key: 'reminder', label: 'リマインダー', desc: '期限前日に自動通知' },
];

function AdminSettingsPage({ onToast }: { onToast: (msg: string) => void }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ email: true, assign: true, status: false, comment: true, reminder: false });
  return (
    <div style={s({ padding: '28px 32px', background: '#F5F6F8' })}>
      <div style={s({ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 })}>
        <div style={s({ width: 36, height: 36, borderRadius: 10, background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
          <BellRing style={{ width: 18, height: 18, color: '#D97706' }} />
        </div>
        <div>
          <h1 style={s({ fontSize: 20, fontWeight: 800, color: '#1A1714', margin: 0 })}>通知管理</h1>
          <p style={s({ fontSize: 11, color: '#B0A9A4', margin: '2px 0 0' })}>通知の受信設定を管理します</p>
        </div>
      </div>
      <div style={s({ background: '#FFFFFF', borderRadius: 12, border: '1px solid rgba(26,23,20,0.08)', overflow: 'hidden', maxWidth: 600 })}>
        {notifTypes.map((n, i) => (
          <div key={n.key} style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: i < notifTypes.length - 1 ? '1px solid rgba(26,23,20,0.06)' : 'none' })}>
            <div>
              <div style={s({ fontSize: 13, fontWeight: 600, color: '#1A1714' })}>{n.label}</div>
              <div style={s({ fontSize: 11, color: '#B0A9A4', marginTop: 2 })}>{n.desc}</div>
            </div>
            <button
              onClick={() => { setEnabled(prev => ({ ...prev, [n.key]: !prev[n.key] })); onToast(`${n.label}を${enabled[n.key] ? 'オフ' : 'オン'}にしました`); }}
              style={s({ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: enabled[n.key] ? '#059669' : '#E5E7EB', position: 'relative', transition: 'background 0.2s', flexShrink: 0 })}>
              <div style={s({ position: 'absolute', top: 3, left: enabled[n.key] ? 23 : 3, width: 18, height: 18, borderRadius: 9, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' })} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Settings Page ────────────────────────────────────────────────────────────
function SettingsPage({ onToast }: { onToast: (msg: string) => void }) {
  const [tab, setTab] = useState<'general' | 'notifications' | 'team'>('general');
  return (
    <div style={s({ padding: '24px', background: '#F5F6F8' })}>
      <h1 style={s({ fontSize: 20, fontWeight: 800, color: '#1A1714', margin: '0 0 16px' })}>設定</h1>
      <div style={s({ display: 'flex', gap: 4, marginBottom: 20, background: '#F4F5F6', borderRadius: 10, padding: 4, width: 'fit-content' })}>
        {(['general', 'notifications', 'team'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={s({ padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: tab === t ? '#FFFFFF' : 'transparent', color: tab === t ? '#1A1714' : '#9E9690', boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' })}>
            {t === 'general' ? '一般' : t === 'notifications' ? '通知' : 'チーム'}
          </button>
        ))}
      </div>
      <div style={s({ background: '#FFFFFF', borderRadius: 12, border: '1px solid rgba(26,23,20,0.08)', padding: '20px', maxWidth: 540 })}>
        {tab === 'general' && (
          <div style={s({ display: 'flex', flexDirection: 'column', gap: 16 })}>
            <div>
              <label style={s({ display: 'block', fontSize: 11, fontWeight: 600, color: '#9E9690', marginBottom: 6 })}>言語</label>
              <select style={s({ width: '100%', border: '1px solid rgba(26,23,20,0.12)', borderRadius: 8, padding: '8px 12px', fontSize: 12, background: '#fff' })}>
                <option>日本語</option><option>English</option>
              </select>
            </div>
            <div>
              <label style={s({ display: 'block', fontSize: 11, fontWeight: 600, color: '#9E9690', marginBottom: 6 })}>タイムゾーン</label>
              <select style={s({ width: '100%', border: '1px solid rgba(26,23,20,0.12)', borderRadius: 8, padding: '8px 12px', fontSize: 12, background: '#fff' })}>
                <option>Asia/Tokyo (UTC+9)</option><option>UTC</option>
              </select>
            </div>
            <button onClick={() => onToast('設定を保存しました')} style={s({ padding: '9px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', alignSelf: 'flex-start' })}>保存</button>
          </div>
        )}
        {tab === 'notifications' && (
          <div style={s({ color: '#B0A9A4', fontSize: 12, textAlign: 'center', padding: '32px 0' })}>通知設定は「通知管理」ページで管理します</div>
        )}
        {tab === 'team' && (
          <div style={s({ display: 'flex', flexDirection: 'column', gap: 16 })}>
            <div style={s({ display: 'flex', alignItems: 'center', gap: 14 })}>
              <div style={s({ width: 56, height: 56, borderRadius: 28, background: '#059669', color: '#fff', fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>田</div>
              <div>
                <div style={s({ fontSize: 14, fontWeight: 700, color: '#1A1714' })}>田中太郎</div>
                <div style={s({ fontSize: 11, color: '#B0A9A4' })}>tanaka@example.com</div>
              </div>
            </div>
            <div>
              <label style={s({ display: 'block', fontSize: 11, fontWeight: 600, color: '#9E9690', marginBottom: 6 })}>表示名</label>
              <input defaultValue="田中太郎" style={s({ width: '100%', border: '1px solid rgba(26,23,20,0.12)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxSizing: 'border-box' })} />
            </div>
            <button onClick={() => onToast('プロフィールを更新しました')} style={s({ padding: '9px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', alignSelf: 'flex-start' })}>更新</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function DemoInteractivePage({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState<AppPage>('dashboard');
  const [sprintView, setSprintView] = useState<SprintView>('list');
  const [tickets, setTickets] = useState<Ticket[]>(INIT_TICKETS);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [showNewSprint, setShowNewSprint] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  const handleNewTicket = (data: Omit<Ticket, 'id' | 'progress' | 'initials' | 'ac'>) => {
    const id = `EC-${String(tickets.length + 1).padStart(4, '0')}`;
    const ac = avatarColor(data.assignee);
    const initials = data.assignee.slice(0, 1);
    setTickets(prev => [...prev, { ...data, id, progress: 0, initials, ac }]);
    addToast(`チケット「${data.title.slice(0, 20)}」を作成しました`);
  };

  const handleStatusChange = (id: string, status: string) => {
    setTickets(prev => prev.map(t => t.id === id ? { ...t, status, progress: status === '完了' ? 100 : t.progress } : t));
    setSelectedTicket(prev => prev?.id === id ? { ...prev, status } : prev);
    addToast(`ステータスを「${status}」に変更しました`);
  };

  const handleNavigate = (p: AppPage) => {
    setPage(p);
    if (p !== 'sprint') setSprintView('list');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
      <InteractiveShell page={page} onNavigate={handleNavigate} onClose={onClose}>
        {page === 'dashboard' && (
          <DashboardPage tickets={tickets} onNewTicket={() => setShowNewTicket(true)} onTicket={setSelectedTicket} />
        )}
        {page === 'projects' && (
          <ProjectsPage onNavigate={handleNavigate} />
        )}
        {page === 'sprint' && (
          <SprintPage tickets={tickets} view={sprintView} onView={setSprintView}
            onNavigate={handleNavigate} onNewTicket={() => setShowNewTicket(true)} onTicket={setSelectedTicket}
            onNewSprint={() => setShowNewSprint(true)} onToast={addToast} />
        )}
        {page === 'clients' && (
          <ClientsPage onToast={addToast} />
        )}
        {page === 'members' && (
          <MembersPage onInvite={() => setShowInvite(true)} onToast={addToast} />
        )}
        {page === 'permissions' && (
          <PermissionsPage />
        )}
        {page === 'roles' && (
          <RolesPage onToast={addToast} />
        )}
        {page === 'admin-settings' && (
          <AdminSettingsPage onToast={addToast} />
        )}
        {page === 'settings' && (
          <SettingsPage onToast={addToast} />
        )}
      </InteractiveShell>

      {showNewTicket  && <NewTicketModal onClose={() => setShowNewTicket(false)} onSubmit={handleNewTicket} />}
      {showNewSprint  && <NewSprintModal onClose={() => setShowNewSprint(false)} onCreated={name => addToast(`スプリント「${name}」を作成しました`)} />}
      {selectedTicket && <TicketDetailModal ticket={selectedTicket} onClose={() => setSelectedTicket(null)} onStatusChange={handleStatusChange} />}
      {showInvite     && <InviteModal onClose={() => setShowInvite(false)} onInvite={email => addToast(`${email} に招待メールを送信しました`)} />}
      <ToastArea toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
