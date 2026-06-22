import { MockAppShell } from './MockAppShell';
import { List, LayoutGrid, BarChart2, ChevronRight, ChevronDown, Plus } from 'lucide-react';

const tickets = [
  { id: 'EC-0001', status: '進行中', sC: '#D97706', startDay: 1, endDay: 5 },
  { id: 'EC-0002', status: '進行中', sC: '#D97706', startDay: 1, endDay: 8 },
  { id: 'EC-0003', status: '未着手', sC: '#6B7280', startDay: 3, endDay: 6 },
  { id: 'EC-0004', status: '進行中', sC: '#D97706', startDay: 1, endDay: 7 },
  { id: 'EC-0005', status: '未着手', sC: '#6B7280', startDay: 2, endDay: 7 },
  { id: 'EC-0006', status: '未着手', sC: '#6B7280', startDay: 5, endDay: 10 },
  { id: 'EC-0007', status: '未着手', sC: '#6B7280', startDay: 6, endDay: 12 },
  { id: 'EC-0008', status: '未着手', sC: '#6B7280', startDay: 8, endDay: 11 },
];

const days = Array.from({ length: 20 }, (_, i) => i + 1);
const todayDay = 1;
const colW = 24; // px per day
const LEFT_W = 140;

const s = (o: React.CSSProperties): React.CSSProperties => o;

export function MockSprintGantt() {
  return (
    <MockAppShell activePage="projects">
      <div style={s({ padding: '12px 16px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8, background: '#F9FAFB', boxSizing: 'border-box' })}>

        {/* Breadcrumb */}
        <div style={s({ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#B0A9A4' })}>
          <span style={s({ color: '#059669', fontWeight: 600 })}>プロジェクト</span>
          <ChevronRight style={{ width: 10, height: 10 }} />
          <span>ECサイトリニューアル</span>
          <ChevronRight style={{ width: 10, height: 10 }} />
          <span>スプリント</span>
        </div>

        {/* Title */}
        <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' })}>
          <div>
            <h1 style={s({ fontSize: 15, fontWeight: 800, color: '#1A1714', margin: 0 })}>スプリント管理</h1>
            <p style={s({ fontSize: 9, color: '#B0A9A4', margin: '2px 0 0' })}>ECサイトリニューアル・1スプリント</p>
          </div>
          <button style={s({ display: 'flex', alignItems: 'center', gap: 4, background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer' })}>
            <Plus style={{ width: 11, height: 11 }} />新規スプリント
          </button>
        </div>

        {/* Tabs */}
        <div style={s({ display: 'flex', gap: 4 })}>
          {[{ Icon: List, label: 'リスト', active: false }, { Icon: LayoutGrid, label: 'ボード', active: false }, { Icon: BarChart2, label: 'ガントチャート', active: true }].map(({ Icon, label, active }) => (
            <button key={label} style={s({ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600, border: 'none', cursor: 'pointer', background: active ? '#059669' : '#FFFFFF', color: active ? '#fff' : '#9E9690', boxShadow: active ? 'none' : '0 0 0 1px rgba(26,23,20,0.10)' })}>
              <Icon style={{ width: 11, height: 11 }} />{label}
            </button>
          ))}
        </div>

        {/* Gantt */}
        <div style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.06)', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' })}>
          <div style={s({ display: 'flex', flex: 1, overflow: 'hidden' })}>
            {/* Left: labels */}
            <div style={s({ width: LEFT_W, flexShrink: 0, borderRight: '1px solid rgba(26,23,20,0.06)', display: 'flex', flexDirection: 'column' })}>
              {/* Month placeholder */}
              <div style={s({ height: 22, borderBottom: '1px solid rgba(26,23,20,0.06)', background: '#F9FAFB', display: 'flex', alignItems: 'center', padding: '0 10px' })}>
                <span style={s({ fontSize: 9, fontWeight: 700, color: '#9E9690' })}>スプリント</span>
              </div>
              {/* Sprint row */}
              <div style={s({ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#F9FAFB', borderBottom: '1px solid rgba(26,23,20,0.06)' })}>
                <ChevronDown style={{ width: 10, height: 10, color: '#9E9690' }} />
                <div>
                  <div style={s({ fontSize: 9, fontWeight: 700, color: '#1A1714' })}>第1スプリント</div>
                  <div style={s({ display: 'flex', gap: 4 })}>
                    <span style={s({ fontSize: 8, fontWeight: 600, color: '#D97706' })}>進行中</span>
                    <span style={s({ fontSize: 8, color: '#B0A9A4' })}>6%</span>
                  </div>
                </div>
              </div>
              {/* Ticket rows */}
              {tickets.map(t => (
                <div key={t.id} style={s({ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderBottom: '1px solid rgba(26,23,20,0.04)' })}>
                  <div style={s({ width: 6, height: 6, borderRadius: '50%', background: t.sC, flexShrink: 0 })} />
                  <span style={s({ fontSize: 9, fontFamily: 'monospace', color: '#6B7280' })}>{t.id}</span>
                  <span style={s({ fontSize: 8, fontWeight: 600, color: t.sC })}>{t.status}</span>
                </div>
              ))}
            </div>

            {/* Right: timeline */}
            <div style={s({ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' })}>
              {/* Month header */}
              <div style={s({ height: 11, background: '#F9FAFB', borderBottom: '1px solid rgba(26,23,20,0.04)', display: 'flex', alignItems: 'center' })}>
                <div style={s({ width: colW * 12, flexShrink: 0, paddingLeft: 8, fontSize: 8, fontWeight: 700, color: '#9E9690' })}>6月</div>
                <div style={s({ width: colW * 8, flexShrink: 0, paddingLeft: 4, fontSize: 8, fontWeight: 700, color: '#9E9690' })}>7月</div>
              </div>
              {/* Day header */}
              <div style={s({ height: 11, background: '#F9FAFB', borderBottom: '1px solid rgba(26,23,20,0.06)', display: 'flex', alignItems: 'center' })}>
                {days.map(d => (
                  <div key={d} style={s({ width: colW, flexShrink: 0, textAlign: 'center', fontSize: 8, color: d === todayDay ? '#059669' : '#B0A9A4', fontWeight: d === todayDay ? 700 : 400 })}>{d}</div>
                ))}
              </div>
              {/* Sprint bar row */}
              <div style={s({ height: 28, position: 'relative', borderBottom: '1px solid rgba(26,23,20,0.06)', background: '#F9FAFB', flexShrink: 0 })}>
                {/* Today line */}
                <div style={s({ position: 'absolute', left: (todayDay - 0.5) * colW, top: 0, bottom: 0, width: 1, background: '#059669', zIndex: 1 })} />
                <div style={s({ position: 'absolute', left: 0, top: 6, height: 16, width: 12 * colW, background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 4, display: 'flex', alignItems: 'center', padding: '0 6px', boxSizing: 'border-box' })}>
                  <span style={s({ fontSize: 8, fontWeight: 600, color: '#059669', flex: 1 })}>第1スプリント</span>
                  <span style={s({ fontSize: 8, color: '#059669', fontWeight: 600 })}>06/12</span>
                </div>
              </div>
              {/* Ticket bar rows */}
              {tickets.map(t => (
                <div key={t.id} style={s({ height: 24, position: 'relative', borderBottom: '1px solid rgba(26,23,20,0.04)' })}>
                  <div style={s({ position: 'absolute', left: (todayDay - 0.5) * colW, top: 0, bottom: 0, width: 1, background: 'rgba(5,150,105,0.15)' })} />
                  <div style={s({
                    position: 'absolute',
                    left: (t.startDay - 1) * colW,
                    width: Math.max((t.endDay - t.startDay + 1) * colW, colW),
                    top: 5, height: 14, borderRadius: 3,
                    background: t.sC === '#D97706' ? '#FEF3C7' : '#F3F4F6',
                    borderLeft: `2px solid ${t.sC}`,
                    display: 'flex', alignItems: 'center', padding: '0 5px', boxSizing: 'border-box'
                  })}>
                    <span style={s({ fontSize: 8, color: '#6B7280', whiteSpace: 'nowrap' })}>06/{String(t.endDay).padStart(2,'0')} {t.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </MockAppShell>
  );
}
