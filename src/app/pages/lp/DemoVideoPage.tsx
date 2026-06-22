import { useState, useEffect, useRef } from 'react';
import { X, ChevronRight, Monitor, Plus, Check } from 'lucide-react';
import { MockDashboard } from '@/app/components/lp/mocks/MockDashboard';
import { MockSprintList } from '@/app/components/lp/mocks/MockSprintList';
import { MockSprintBoard } from '@/app/components/lp/mocks/MockSprintBoard';
import { MockSprintGantt } from '@/app/components/lp/mocks/MockSprintGantt';
import { MockProjects } from '@/app/components/lp/mocks/MockProjects';
import { MockMembers } from '@/app/components/lp/mocks/MockMembers';

// ─── Scene Overlay definitions ────────────────────────────────────────────────
// Overlays simulate UI elements appearing in response to cursor clicks.
// Each overlay has position/size as % of the 16:9 screen area.

type OverlayType = 'ticket-form' | 'ticket-detail' | 'invite-modal' | 'toast';

interface Overlay {
  type: OverlayType;
  showAtMs: number;   // ms after scene start to show
  hideAtMs: number;   // ms after scene start to hide
}

interface Waypoint {
  x: number;        // % of screen width
  y: number;        // % of screen height
  click?: boolean;  // show click ripple
  holdMs: number;   // pause at this position
}

interface Scene {
  id: string;
  label: string;
  Component: React.ComponentType;
  duration: number;
  waypoints: Waypoint[];
  overlays?: Overlay[];
}

// ─── Overlay Components ───────────────────────────────────────────────────────

function TicketFormOverlay() {
  return (
    <div style={{ position: 'absolute', right: '2%', top: '18%', width: '28%', background: '#fff', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', border: '1px solid rgba(26,23,20,0.10)', overflow: 'hidden', zIndex: 20, fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid rgba(26,23,20,0.08)', background: '#FAFAFA' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1A1714' }}>新規チケット作成</span>
        <X style={{ width: 10, height: 10, color: '#B0A9A4' }} />
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <div style={{ fontSize: 8, fontWeight: 600, color: '#9E9690', marginBottom: 4 }}>タイトル *</div>
          <div style={{ border: '1.5px solid #059669', borderRadius: 6, padding: '5px 8px', fontSize: 9, color: '#1A1714', background: '#fff' }}>決済APIとのインテグレーション</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div>
            <div style={{ fontSize: 8, fontWeight: 600, color: '#9E9690', marginBottom: 4 }}>ステータス</div>
            <div style={{ border: '1px solid rgba(26,23,20,0.12)', borderRadius: 6, padding: '4px 7px', fontSize: 9, color: '#374151' }}>未着手</div>
          </div>
          <div>
            <div style={{ fontSize: 8, fontWeight: 600, color: '#9E9690', marginBottom: 4 }}>優先度</div>
            <div style={{ border: '1px solid rgba(26,23,20,0.12)', borderRadius: 6, padding: '4px 7px', fontSize: 9, color: '#DC2626', fontWeight: 700 }}>高</div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, fontWeight: 600, color: '#9E9690', marginBottom: 4 }}>担当者</div>
          <div style={{ border: '1px solid rgba(26,23,20,0.12)', borderRadius: 6, padding: '4px 7px', fontSize: 9, color: '#374151', display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 14, height: 14, borderRadius: 7, background: '#059669', color: '#fff', fontSize: 6, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>田</div>田中太郎
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, paddingTop: 4 }}>
          <div style={{ padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 600, background: '#F4F5F6', color: '#6B7280' }}>キャンセル</div>
          <div style={{ padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 600, background: '#059669', color: '#fff' }}>作成する</div>
        </div>
      </div>
    </div>
  );
}

function TicketDetailOverlay() {
  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: '38%', background: '#fff', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.20)', border: '1px solid rgba(26,23,20,0.10)', overflow: 'hidden', zIndex: 20, fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid rgba(26,23,20,0.08)', background: '#FAFAFA' }}>
        <span style={{ fontSize: 8, fontWeight: 700, color: '#059669', background: '#ECFDF5', padding: '2px 6px', borderRadius: 5, fontFamily: 'monospace' }}>EC-0002</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1A1714' }}>カート機能のフロントエンド実装</span>
        <X style={{ width: 10, height: 10, color: '#B0A9A4', marginLeft: 'auto' }} />
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ fontSize: 9, color: '#6B7280', margin: 0, lineHeight: 1.5 }}>ショッピングカートのUI・UXを実装します。商品追加・削除・数量変更機能を含みます。</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 8, color: '#B0A9A4', fontWeight: 600, marginBottom: 4 }}>ステータス</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#0284C7' }}>進行中</div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: '#B0A9A4', fontWeight: 600, marginBottom: 4 }}>優先度</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#DC2626' }}>高</div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: '#B0A9A4', fontWeight: 600, marginBottom: 4 }}>担当者</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 16, height: 16, borderRadius: 8, background: '#0284C7', color: '#fff', fontSize: 7, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>鈴</div>
              <span style={{ fontSize: 9 }}>鈴木花子</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: '#B0A9A4', fontWeight: 600, marginBottom: 4 }}>進捗</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ height: 5, flex: 1, background: '#F4F5F6', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#059669', width: '40%' }} />
              </div>
              <span style={{ fontSize: 9, fontWeight: 700 }}>40%</span>
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 14px', borderTop: '1px solid rgba(26,23,20,0.08)', background: '#F9FAFB' }}>
        <div style={{ padding: '4px 12px', borderRadius: 6, fontSize: 9, fontWeight: 600, background: '#F4F5F6', color: '#6B7280' }}>閉じる</div>
      </div>
    </div>
  );
}

function InviteModalOverlay() {
  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: '32%', background: '#fff', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.20)', border: '1px solid rgba(26,23,20,0.10)', overflow: 'hidden', zIndex: 20, fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(26,23,20,0.08)', background: '#FAFAFA' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1A1714' }}>メンバーを招待</span>
        <X style={{ width: 10, height: 10, color: '#B0A9A4' }} />
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <div style={{ fontSize: 8, fontWeight: 600, color: '#9E9690', marginBottom: 4 }}>メールアドレス</div>
          <div style={{ border: '1.5px solid #059669', borderRadius: 6, padding: '6px 8px', fontSize: 9, color: '#1A1714' }}>yamamoto@example.com</div>
        </div>
        <div>
          <div style={{ fontSize: 8, fontWeight: 600, color: '#9E9690', marginBottom: 4 }}>ロール</div>
          <div style={{ border: '1px solid rgba(26,23,20,0.12)', borderRadius: 6, padding: '5px 8px', fontSize: 9, color: '#374151' }}>デベロッパー</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, paddingTop: 2 }}>
          <div style={{ padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 600, background: '#F4F5F6', color: '#6B7280' }}>キャンセル</div>
          <div style={{ padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 600, background: '#059669', color: '#fff' }}>招待を送る</div>
        </div>
      </div>
    </div>
  );
}

function ToastOverlay({ message }: { message: string }) {
  return (
    <div style={{ position: 'absolute', bottom: '5%', right: '2%', background: '#fff', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.14)', border: '1px solid rgba(26,23,20,0.10)', padding: '8px 12px', zIndex: 30, display: 'flex', alignItems: 'center', gap: 7, fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif", minWidth: '22%' }}>
      <div style={{ width: 16, height: 16, borderRadius: 8, background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Check style={{ width: 9, height: 9, color: '#059669' }} />
      </div>
      <span style={{ fontSize: 9, fontWeight: 600, color: '#374151' }}>{message}</span>
    </div>
  );
}

// ─── Scene definitions ────────────────────────────────────────────────────────
// Waypoint positions are calibrated to actual MockAppShell layout:
//   Sidebar: 64px wide (~5.6% of 16:9 content)
//   Topbar: 46px tall (~8.1% of 9/16 content)
//   Content area starts at ~5.6% x, ~8% y
//
// Screen % mapping (0–100):
//   x=88%, y=13%  → "新規チケット" button (top-right of dashboard)
//   x=50%, y=55%  → ticket rows in sprint list
//   x=22%, y=55%  → left column cards in board/members

const SCENES: Scene[] = [
  {
    id: 'dashboard', label: 'ダッシュボード',
    Component: MockDashboard, duration: 5500,
    waypoints: [
      { x: 50, y: 50, holdMs: 400 },              // center idle
      { x: 88, y: 13, holdMs: 500, click: true }, // click "新規チケット"
      { x: 72, y: 50, holdMs: 600 },              // drift while modal open
      { x: 72, y: 75, holdMs: 400 },              // scroll toward "作成する"
      { x: 86, y: 70, click: true, holdMs: 500 }, // click "作成する" area
    ],
    overlays: [
      { type: 'ticket-form', showAtMs: 1400, hideAtMs: 4600 },
      { type: 'toast', showAtMs: 4700, hideAtMs: 5400 },
    ],
  },
  {
    id: 'sprintList', label: 'スプリント（リスト）',
    Component: MockSprintList, duration: 5000,
    waypoints: [
      { x: 50, y: 40, holdMs: 400 },
      { x: 50, y: 53, holdMs: 500 },              // hover ticket row
      { x: 50, y: 60, click: true, holdMs: 600 }, // click ticket row
      { x: 55, y: 55, holdMs: 600 },              // cursor inside modal area
      { x: 74, y: 78, click: true, holdMs: 500 }, // click "閉じる"
    ],
    overlays: [
      { type: 'ticket-detail', showAtMs: 1700, hideAtMs: 4500 },
    ],
  },
  {
    id: 'sprintBoard', label: 'スプリント（ボード）',
    Component: MockSprintBoard, duration: 4000,
    waypoints: [
      { x: 22, y: 55, holdMs: 500 },
      { x: 38, y: 55, holdMs: 400 },
      { x: 38, y: 65, holdMs: 500 },
      { x: 22, y: 65, holdMs: 400 },
      { x: 22, y: 55, holdMs: 300 },
    ],
  },
  {
    id: 'sprintGantt', label: 'スプリント（ガント）',
    Component: MockSprintGantt, duration: 4000,
    waypoints: [
      { x: 30, y: 40, holdMs: 400 },
      { x: 55, y: 40, holdMs: 500 },
      { x: 75, y: 50, holdMs: 500 },
      { x: 85, y: 55, holdMs: 400 },
      { x: 65, y: 60, holdMs: 300 },
    ],
  },
  {
    id: 'projects', label: 'プロジェクト',
    Component: MockProjects, duration: 4500,
    waypoints: [
      { x: 25, y: 45, holdMs: 400 },
      { x: 50, y: 45, holdMs: 400 },
      { x: 50, y: 65, holdMs: 500 },
      { x: 25, y: 65, holdMs: 400 },
      { x: 25, y: 45, click: true, holdMs: 400 },
    ],
  },
  {
    id: 'members', label: 'メンバー',
    Component: MockMembers, duration: 5000,
    waypoints: [
      { x: 50, y: 45, holdMs: 400 },
      { x: 88, y: 14, holdMs: 500, click: true }, // click "メンバー招待"
      { x: 60, y: 52, holdMs: 600 },              // cursor inside modal
      { x: 63, y: 68, click: true, holdMs: 500 }, // click "招待を送る"
    ],
    overlays: [
      { type: 'invite-modal', showAtMs: 1400, hideAtMs: 4400 },
      { type: 'toast', showAtMs: 4500, hideAtMs: 4900 },
    ],
  },
];

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { onClose: () => void; onInteractive: () => void }

export function DemoVideoPage({ onClose, onInteractive }: Props) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 50, y: 50 });
  const [clicking, setClicking] = useState(false);
  const [fading, setFading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeOverlays, setActiveOverlays] = useState<OverlayType[]>([]);
  const cancelRef = useRef(false);

  const scene = SCENES[sceneIndex];

  useEffect(() => {
    cancelRef.current = false;
    setProgress(0);
    setCursorPos({ x: 50, y: 50 });
    setActiveOverlays([]);

    const startMs = Date.now();
    const progInterval = setInterval(() => {
      setProgress(Math.min(((Date.now() - startMs) / scene.duration) * 100, 100));
    }, 60);

    // Cursor waypoints
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let offset = 400;
    scene.waypoints.forEach((wp) => {
      timeouts.push(setTimeout(() => {
        if (cancelRef.current) return;
        setCursorPos({ x: wp.x, y: wp.y });
        if (wp.click) {
          setTimeout(() => {
            if (cancelRef.current) return;
            setClicking(true);
            setTimeout(() => { if (!cancelRef.current) setClicking(false); }, 350);
          }, 500);
        }
      }, offset));
      offset += 500 + wp.holdMs;
    });

    // Overlay show/hide timers
    (scene.overlays ?? []).forEach(ov => {
      timeouts.push(setTimeout(() => {
        if (cancelRef.current) return;
        setActiveOverlays(prev => [...prev, ov.type]);
      }, ov.showAtMs));
      timeouts.push(setTimeout(() => {
        if (cancelRef.current) return;
        setActiveOverlays(prev => prev.filter(t => t !== ov.type));
      }, ov.hideAtMs));
    });

    const advanceTimer = setTimeout(() => {
      if (cancelRef.current) return;
      setFading(true);
      setTimeout(() => {
        if (cancelRef.current) return;
        setSceneIndex(prev => (prev + 1) % SCENES.length);
        setFading(false);
      }, 350);
    }, scene.duration);

    return () => {
      cancelRef.current = true;
      clearInterval(progInterval);
      timeouts.forEach(clearTimeout);
      clearTimeout(advanceTimer);
    };
  }, [sceneIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const Component = scene.Component;

  const goToScene = (i: number) => {
    setFading(true);
    setTimeout(() => { setSceneIndex(i); setFading(false); }, 200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      {/* Topbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-600 to-teal-700 flex items-center justify-center">
            <Monitor className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-semibold text-sm">Dev Ticket デモ</span>
          <span className="text-xs bg-teal-600/20 text-teal-400 border border-teal-600/30 rounded-full px-2 py-0.5">自動再生</span>
        </div>

        <div className="hidden lg:flex items-center gap-1">
          {SCENES.map((s, i) => (
            <button key={s.id} onClick={() => goToScene(i)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${i === sceneIndex ? 'bg-teal-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onInteractive}
            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            デモのご予約 <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-0">
        <div className="w-full max-w-5xl flex flex-col" style={{ maxHeight: 'calc(100vh - 160px)' }}>
          {/* Browser chrome */}
          <div className="bg-slate-800 rounded-t-xl px-4 py-2 flex items-center gap-2 flex-shrink-0">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/70" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
              <div className="w-3 h-3 rounded-full bg-green-500/70" />
            </div>
            <div className="flex-1 mx-4 bg-slate-700 rounded-md px-3 py-1 text-xs text-slate-400">
              app.devticket.jp
            </div>
          </div>

          {/* Screen */}
          <div className="relative overflow-hidden rounded-b-xl shadow-2xl ring-1 ring-white/5" style={{ aspectRatio: '16/9' }}>
            {/* Dimming backdrop when overlay is shown */}
            {activeOverlays.some(t => t !== 'toast') && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 15, pointerEvents: 'none' }} />
            )}

            <div className={`w-full h-full transition-opacity duration-350 ${fading ? 'opacity-0' : 'opacity-100'}`}>
              <Component />
            </div>

            {/* Overlays */}
            {activeOverlays.includes('ticket-form')   && <TicketFormOverlay />}
            {activeOverlays.includes('ticket-detail') && <TicketDetailOverlay />}
            {activeOverlays.includes('invite-modal')  && <InviteModalOverlay />}
            {activeOverlays.includes('toast')         && <ToastOverlay message={scene.id === 'members' ? 'yamamoto@example.com に招待メールを送信しました' : 'チケットを作成しました'} />}

            {/* Cursor hidden */}
          </div>
        </div>
      </div>

      {/* Progress footer */}
      <div className="px-8 pb-5 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-slate-400 text-xs">{sceneIndex + 1} / {SCENES.length} — {scene.label}</span>
          <span className="text-slate-600 text-xs">画面は自動で切り替わります</span>
        </div>
        <div className="w-full h-0.5 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-teal-500 rounded-full" style={{ width: `${progress}%`, transition: 'width 0.06s linear' }} />
        </div>
        <div className="flex items-center gap-1.5 mt-3 justify-center">
          {SCENES.map((_, i) => (
            <button key={i} onClick={() => goToScene(i)}
              className={`rounded-full transition-all duration-300 ${i === sceneIndex ? 'w-5 h-1.5 bg-teal-500' : 'w-1.5 h-1.5 bg-slate-700 hover:bg-slate-500'}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
