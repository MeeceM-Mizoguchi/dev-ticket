import { ReactNode } from 'react';
import { LayoutDashboard, FolderKanban, Building2, Users, Settings, LogOut, CalendarRange, UserCog, BellRing, Search, Bell, Ticket } from 'lucide-react';

type Page = 'dashboard' | 'projects' | 'clients' | 'members' | 'permissions' | 'roles' | 'settings';

interface Props {
  children: ReactNode;
  activePage?: Page;
  fillHeight?: boolean;
}

// Deterministic avatar color from name (matches actual getAvatarColor logic)
function avatarColor(name: string) {
  const colors = ['#059669','#0284C7','#7C3AED','#D97706','#F43F5E','#0891B2','#65A30D','#9333EA'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

function getInitials(name: string) {
  return name.slice(0, 2);
}

const navItems: { id: Page; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard',   icon: LayoutDashboard },
  { id: 'projects',    icon: FolderKanban },
  { id: 'clients',     icon: Building2 },
  { id: 'members',     icon: Users },
  { id: 'permissions', icon: CalendarRange },
  { id: 'roles',       icon: UserCog },
  { id: 'settings',    icon: BellRing },
];

const userName = '田中太郎';

export function MockAppShell({ children, activePage, fillHeight }: Props) {
  return (
    <div style={{ ...(fillHeight ? { height: '100%' } : { aspectRatio: '16/9' }), width: '100%', display: 'flex', background: '#F4F5F6', fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic UI', 'Segoe UI', sans-serif", overflow: 'hidden', fontSize: 12 }}>

      {/* Sidebar — white, 64px wide */}
      <aside style={{ width: 64, background: '#FFFFFF', borderRight: '1px solid rgba(26,23,20,0.07)', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        {/* Logo */}
        <div style={{ padding: '16px 0 8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(145deg, #34D399, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(5,150,105,0.35)' }}>
            <Ticket style={{ width: 16, height: 16, color: '#fff' }} />
          </div>
        </div>
        <div style={{ width: 28, height: 1, background: 'rgba(26,23,20,0.06)', margin: '4px 0' }} />

        {/* Nav items */}
        <nav style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', paddingTop: 2 }}>
          {navItems.map(({ id, icon: Icon }) => {
            const active = activePage === id;
            return (
              <div key={id} style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0' }}>
                {active && (
                  <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: '0 99px 99px 0', background: '#059669' }} />
                )}
                <div style={{
                  width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: active ? '#ECFDF5' : 'transparent',
                  border: active ? '1px solid rgba(5,150,105,0.18)' : '1px solid transparent',
                }}>
                  <Icon style={{ width: 15, height: 15, color: active ? '#059669' : '#9E9690' }} />
                </div>
              </div>
            );
          })}
        </nav>

        {/* Bottom: Settings + Logout */}
        <div style={{ width: '100%', paddingBottom: 12 }}>
          <div style={{ width: 28, height: 1, background: 'rgba(26,23,20,0.06)', margin: '4px auto' }} />
          {[{ Icon: Settings }, { Icon: LogOut }].map(({ Icon }, i) => (
            <div key={i} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '7px 0' }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon style={{ width: 14, height: 14, color: '#C9C4BB' }} />
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Topbar */}
        <header style={{ height: 46, background: '#FFFFFF', borderBottom: '1px solid rgba(20,26,22,0.08)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0 }}>
          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F4F5F6', borderRadius: 8, padding: '5px 10px', maxWidth: 280, flex: 1 }}>
            <Search style={{ width: 12, height: 12, color: '#B0A9A4' }} />
            <span style={{ fontSize: 11, color: '#B0A9A4' }}>チケット・スプリント・プロジェクト・メンバーを検索...</span>
          </div>

          {/* Right: bell + separator + user pill */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            {/* Bell */}
            <div style={{ position: 'relative', width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bell style={{ width: 13, height: 13, color: '#059669' }} />
              <span style={{ position: 'absolute', top: 4, right: 4, width: 12, height: 12, borderRadius: 6, background: '#059669', border: '1.5px solid #fff', fontSize: 7, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>2</span>
            </div>
            {/* Separator */}
            <div style={{ width: 1, height: 16, background: 'rgba(26,23,20,0.08)', margin: '0 2px' }} />
            {/* User pill */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 4px', borderRadius: 9999, background: '#F4F5F6' }}>
              <div style={{ width: 22, height: 22, borderRadius: 11, background: avatarColor(userName), color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {getInitials(userName)}
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#3D3732' }}>{userName}</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>{children}</div>
      </div>
    </div>
  );
}
