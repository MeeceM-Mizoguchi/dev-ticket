import { MockAppShell } from "@/app/components/lp/mocks/MockAppShell";
import {
  Layers, LayoutDashboard, BarChart2, ChevronRight, ChevronDown, Plus, Globe,
  ClipboardList, BookOpen, FileText, PenTool, FolderKanban, ExternalLink, Download, Pencil, Trash2, MousePointer2,
} from "lucide-react";

type View = "list" | "board" | "gantt";
const s = (o: React.CSSProperties) => o;

// ── プロジェクトサブナビ（実アプリ準拠） ──
const SUBNAV: { label: string; Icon: typeof Layers; active?: boolean }[] = [
  { label: "スプリント管理", Icon: Layers, active: true },
  { label: "バックログ", Icon: ClipboardList },
  { label: "Wiki", Icon: BookOpen },
  { label: "議事録", Icon: FileText },
  { label: "ホワイトボード", Icon: PenTool },
];
function ProjectSubNav() {
  return (
    <div style={s({ display: "flex", gap: 3, background: "#fff", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 9, padding: 3 })}>
      {SUBNAV.map(({ label, Icon, active }) => (
        <div key={label} style={s({ display: "flex", alignItems: "center", gap: 4, padding: "5px 9px", fontSize: 9.5, fontWeight: 500, borderRadius: 6, background: active ? "#059669" : "transparent", color: active ? "#fff" : "#6B6458" })}>
          <Icon style={{ width: 11, height: 11 }} />{label}
        </div>
      ))}
    </div>
  );
}

// ── ビュー切替タブ（右寄せ・グレーのセグメント・選択中は白＋影） ──
const TABS: { mode: View; label: string; Icon: typeof Layers }[] = [
  { mode: "list", label: "リスト", Icon: Layers },
  { mode: "board", label: "ボード", Icon: LayoutDashboard },
  { mode: "gantt", label: "ガントチャート", Icon: BarChart2 },
];
function ViewTabs({ active }: { active: View }) {
  return (
    <div style={s({ display: "flex", gap: 2, background: "#F0F0EE", border: "1px solid rgba(26,23,20,0.06)", borderRadius: 8, padding: 3 })}>
      {TABS.map(({ mode, label, Icon }) => {
        const on = active === mode;
        return (
          <div key={mode} data-spot={`tab-${mode}`} style={s({ display: "flex", alignItems: "center", gap: 4, padding: "5px 11px", fontSize: 10, fontWeight: 500, borderRadius: 6, background: on ? "#FFFFFF" : "transparent", color: on ? "#1A1714" : "#9E9690", boxShadow: on ? "0 1px 3px rgba(0,0,0,0.08)" : "none" })}>
            <Icon style={{ width: 11, height: 11 }} />{label}
          </div>
        );
      })}
    </div>
  );
}

// ── スプリント行（統計＋操作ボタン） ──
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={s({ textAlign: "center" })}>
      <div style={s({ fontSize: 13, fontWeight: 800, color: "#1A1714", letterSpacing: "-0.02em", lineHeight: 1.1 })}>{value}</div>
      <div style={s({ fontSize: 8, color: "#B0A9A4" })}>{label}</div>
    </div>
  );
}
function GreenBtn({ Icon, label }: { Icon: typeof Plus; label: string }) {
  return (
    <div style={s({ display: "flex", alignItems: "center", gap: 3, padding: "4px 7px", fontSize: 8.5, fontWeight: 600, color: "#059669", background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.20)", borderRadius: 6, whiteSpace: "nowrap" })}>
      <Icon style={{ width: 9, height: 9 }} />{label}
    </div>
  );
}
function PurpleBtn({ label, spot }: { label: string; spot?: string }) {
  return (
    <div data-spot={spot} style={s({ display: "flex", alignItems: "center", gap: 3, padding: "4px 7px", fontSize: 8.5, fontWeight: 600, color: "#7C3AED", background: "#F5F3FF", border: "1px solid rgba(124,58,237,0.20)", borderRadius: 6, whiteSpace: "nowrap" })}>
      <Plus style={{ width: 9, height: 9 }} />{label}
    </div>
  );
}

function SprintHeaderRow({ name, badge, badgeBg, badgeColor, tickets, done, hours, progress, actual, range, expanded, markNewTicket }: {
  name: string; badge: string; badgeBg: string; badgeColor: string;
  tickets: string; done: string; hours: string; progress: string; actual: string; range: string; expanded?: boolean; markNewTicket?: boolean;
}) {
  return (
    <div style={s({ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#F9F8F6", borderRadius: expanded ? "11px 11px 0 0" : 11, borderBottom: expanded ? "1px solid rgba(26,23,20,0.06)" : "none" })}>
      <ChevronDown style={{ width: 12, height: 12, color: "#B0A9A4", transform: expanded ? "none" : "rotate(-90deg)", flexShrink: 0 }} />
      <div style={s({ flex: 1, minWidth: 0 })}>
        <div style={s({ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 })}>
          <span style={s({ fontSize: 12, fontWeight: 700, color: "#1A1714", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" })}>{name}</span>
          <span style={s({ fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: badgeBg, color: badgeColor })}>{badge}</span>
        </div>
        <div style={s({ height: 5, borderRadius: 4, background: "#E6E4E0", overflow: "hidden", maxWidth: 230 })}>
          <div style={s({ width: progress, height: "100%", background: "#059669" })} />
        </div>
      </div>
      <div style={s({ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 })}>
        <Stat value={tickets} label="チケット" />
        <Stat value={done} label="完了" />
        <Stat value={hours} label="工数(h)" />
        <Stat value={progress} label="進捗" />
        <div style={s({ textAlign: "center" })}>
          <div style={s({ fontSize: 13, fontWeight: 800, color: "#059669", letterSpacing: "-0.02em", lineHeight: 1.1 })}>{actual}</div>
          <div style={s({ fontSize: 8, color: "#B0A9A4" })}>実績(人日)</div>
        </div>
        <span style={s({ fontSize: 8.5, color: "#B0A9A4", fontFamily: "monospace", whiteSpace: "nowrap" })}>{range}</span>
        <GreenBtn Icon={FolderKanban} label="Myフィルタ" />
        <GreenBtn Icon={ExternalLink} label="詳細" />
        <GreenBtn Icon={Download} label="CSVダウンロード" />
        <PurpleBtn label="一括作成" />
        <PurpleBtn label="新規チケット" spot={markNewTicket ? "new-ticket" : undefined} />
        <Pencil style={{ width: 12, height: 12, color: "#C9C4BB", flexShrink: 0 }} />
        <Trash2 style={{ width: 12, height: 12, color: "#C9C4BB", flexShrink: 0 }} />
      </div>
    </div>
  );
}

// 展開時のチケット表
const TCOLS = ["No", "チケット名", "分類", "ステータス", "優先度", "担当者", "開始日", "期限日", "実績"];
const TROWS = [
  { no: "TKT-001", name: "サンプルチケット：一覧画面の作成", cat: "開発", st: "進行中", sc: "#B45309", sb: "#FEF3C7", pr: "高", pc: "#DC2626", who: "田中 太郎", wc: "#059669", sd: "06/01", ed: "06/05", act: "—" },
  { no: "TKT-002", name: "サンプルチケット：APIの接続", cat: "開発", st: "未着手", sc: "#6B7280", sb: "#F3F4F6", pr: "中", pc: "#D97706", who: "鈴木 花子", wc: "#0284C7", sd: "06/02", ed: "06/06", act: "—" },
  { no: "TKT-003", name: "サンプルチケット：レビュー対応", cat: "改善", st: "クローズ", sc: "#374151", sb: "#F3F4F6", pr: "低", pc: "#6B7280", who: "佐藤 次郎", wc: "#7C3AED", sd: "06/03", ed: "06/04", act: "0.5人日" },
];

type Row = { no: string; name: string; cat: string; st: string; sc: string; sb: string; pr: string; pc: string; who: string; wc: string; sd: string; ed: string; act: string };

function TicketRow({ r, dim }: { r: Row; dim?: boolean }) {
  return (
    <div style={s({ display: "flex", alignItems: "center", fontSize: 8.5, padding: "6px 12px", borderBottom: "1px solid rgba(26,23,20,0.04)", background: dim ? "#F5F5F4" : undefined, opacity: dim ? 0.65 : 1 })}>
      <span style={s({ width: 60, fontFamily: "monospace", color: "#059669", fontWeight: 700 })}>{r.no}</span>
      <span style={s({ flex: 1, color: "#1A1714", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 6 })}>{r.name}</span>
      <span style={s({ width: 44, color: "#6B6458" })}>{r.cat}</span>
      <span style={s({ width: 52 })}><span style={s({ fontSize: 7.5, fontWeight: 700, color: r.sc, background: r.sb, borderRadius: 5, padding: "2px 5px" })}>{r.st}</span></span>
      <span style={s({ width: 34, fontWeight: 700, color: r.pc })}>{r.pr}</span>
      <span style={s({ width: 66, display: "flex", alignItems: "center", gap: 4, color: "#3D3732" })}>
        <span style={s({ width: 14, height: 14, borderRadius: 7, background: r.wc, color: "#fff", fontSize: 7, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 })}>{r.who.slice(0, 1)}</span>
        <span style={s({ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" })}>{r.who}</span>
      </span>
      <span style={s({ width: 40, color: "#9E9690", fontFamily: "monospace" })}>{r.sd}</span>
      <span style={s({ width: 40, color: "#9E9690", fontFamily: "monospace" })}>{r.ed}</span>
      <span style={s({ width: 44, textAlign: "right", color: "#059669", fontWeight: 700 })}>{r.act}</span>
    </div>
  );
}

// 保留中・取下チケット（リストでの見た目デモ用）
const HOLD_ROWS: Row[] = [
  { no: "TKT-005", name: "サンプルチケット：保留中の作業", cat: "開発", st: "保留中", sc: "#DC2626", sb: "#FEF2F2", pr: "中", pc: "#D97706", who: "田中 太郎", wc: "#059669", sd: "06/02", ed: "06/06", act: "—" },
  { no: "TKT-006", name: "サンプルチケット：取り下げた作業", cat: "改善", st: "取下", sc: "#4B5563", sb: "#F3F4F6", pr: "低", pc: "#6B7280", who: "鈴木 花子", wc: "#0284C7", sd: "06/03", ed: "06/07", act: "—" },
];

function ListBody({ holdDemo }: { holdDemo?: boolean }) {
  return (
    <div style={s({ display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" })}>
      <div style={s({ borderRadius: 11, border: "1px solid rgba(26,23,20,0.08)" })}>
        <SprintHeaderRow name="サンプルスプリント A" badge="進行中" badgeBg="#DBEAFE" badgeColor="#2563EB" tickets="12" done="8" hours="40" progress="66%" actual="5.0人日" range="06/01 → 06/07" markNewTicket />
      </div>
      <div style={s({ borderRadius: 11, border: "1px solid rgba(26,23,20,0.08)", overflow: "hidden" })}>
        <SprintHeaderRow name="サンプルスプリント B" badge="進行中" badgeBg="#DBEAFE" badgeColor="#2563EB" tickets="9" done="3" hours="24" progress="33%" actual="2.5人日" range="06/08 → 06/14" expanded />
        {/* column headers */}
        <div style={s({ display: "flex", alignItems: "center", padding: "6px 12px", background: "#F4F5F6", fontSize: 8, fontWeight: 700, color: "#B0A9A4", borderBottom: "1px solid rgba(26,23,20,0.08)" })}>
          <span style={s({ width: 60 })}>{TCOLS[0]}</span>
          <span style={s({ flex: 1 })}>{TCOLS[1]}</span>
          <span style={s({ width: 44 })}>{TCOLS[2]}</span>
          <span style={s({ width: 52 })}>{TCOLS[3]}</span>
          <span style={s({ width: 34 })}>{TCOLS[4]}</span>
          <span style={s({ width: 66 })}>{TCOLS[5]}</span>
          <span style={s({ width: 40 })}>{TCOLS[6]}</span>
          <span style={s({ width: 40 })}>{TCOLS[7]}</span>
          <span style={s({ width: 44, textAlign: "right" })}>{TCOLS[8]}</span>
        </div>
        {TROWS.map((r) => <TicketRow key={r.no} r={r} />)}
        {holdDemo && (
          <div data-spot="hold-list">
            {HOLD_ROWS.map((r) => <TicketRow key={r.no} r={r} dim />)}
          </div>
        )}
      </div>
    </div>
  );
}

const COLS = [
  { label: "未着手", count: 5, color: "#6B7280", cards: [{ id: "TKT-002", ini: "鈴", ac: "#0284C7", p: "中", pc: "#D97706" }, { id: "TKT-004", ini: "佐", ac: "#7C3AED", p: "中", pc: "#D97706" }] },
  { label: "進行中", count: 3, color: "#0284C7", cards: [{ id: "TKT-001", ini: "田", ac: "#059669", p: "高", pc: "#DC2626" }] },
  { label: "レビュー中", count: 0, color: "#7C3AED", cards: [] },
  { label: "レビュー完了", count: 0, color: "#059669", cards: [] },
  { label: "STG完了", count: 0, color: "#D97706", cards: [] },
];
// ドラッグ演出（未着手→進行中）：矢印＋ループで動くゴーストカード
function DragHint() {
  return (
    <>
      <style>{`@keyframes mgDrag {
        0%, 8% { transform: translate(0, 0) rotate(-3deg); opacity: 0.96; }
        58%, 68% { transform: translate(124px, 0) rotate(-3deg); opacity: 0.96; }
        80%, 100% { transform: translate(124px, 0) rotate(-3deg); opacity: 0; }
      }`}</style>
      {/* 方向を示す赤い破線矢印 */}
      <svg style={{ position: "absolute", top: 18, left: 8, width: 220, height: 90, overflow: "visible", pointerEvents: "none", zIndex: 11 }}>
        <defs>
          <marker id="mgArrow" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 Z" fill="#EF4444" />
          </marker>
        </defs>
        <path d="M 46,66 C 70,8 150,6 176,40" stroke="#EF4444" strokeWidth="2.5" fill="none" strokeDasharray="5 4" markerEnd="url(#mgArrow)" />
      </svg>
      {/* 動くゴーストカード */}
      <div style={s({ position: "absolute", top: 26, left: 0, width: 116, background: "#fff", borderRadius: 8, border: "1px solid rgba(5,150,105,0.4)", padding: "8px 10px", boxShadow: "0 8px 20px rgba(0,0,0,0.18)", zIndex: 12, animation: "mgDrag 2.8s ease-in-out infinite", pointerEvents: "none" })}>
        <div style={s({ fontSize: 8.5, fontFamily: "monospace", color: "#6B7280", marginBottom: 6 })}>TKT-002</div>
        <div style={s({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
          <div style={s({ width: 18, height: 18, borderRadius: 9, background: "#0284C7", color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" })}>鈴</div>
          <span style={s({ fontSize: 9, fontWeight: 700, color: "#D97706" })}>中</span>
        </div>
        <MousePointer2 style={{ position: "absolute", right: -6, bottom: -8, width: 15, height: 15, color: "#1A1714", fill: "#fff" }} />
      </div>
      {/* ラベル */}
      <div style={s({ position: "absolute", top: 2, left: 150, background: "#EF4444", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 7, zIndex: 13, boxShadow: "0 2px 8px rgba(239,68,68,0.35)" })}>ここへドラッグ</div>
    </>
  );
}

function BoardBody({ dragHint }: { dragHint?: boolean }) {
  return (
    <div style={s({ position: "relative", display: "flex", gap: 8, overflow: "hidden", flex: 1 })}>
      {dragHint && <DragHint />}
      {COLS.map((col) => (
        <div key={col.label} data-spot={col.label === "未着手" ? "board-todo" : col.label === "進行中" ? "board-inprogress" : undefined} style={s({ flex: "0 0 116px", display: "flex", flexDirection: "column" })}>
          <div style={s({ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 })}>
            <span style={s({ fontSize: 10, fontWeight: 700, color: col.color })}>{col.label}</span>
            <span style={s({ fontSize: 9, color: "#B0A9A4", background: "#F4F5F6", borderRadius: 10, padding: "1px 5px", fontWeight: 600 })}>{col.count}</span>
          </div>
          <div style={s({ display: "flex", flexDirection: "column", gap: 6 })}>
            {col.cards.map((c) => (
              <div key={c.id} style={s({ background: "#fff", borderRadius: 8, border: "1px solid rgba(26,23,20,0.07)", padding: "8px 10px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" })}>
                <div style={s({ fontSize: 8.5, fontFamily: "monospace", color: "#6B7280", marginBottom: 6 })}>{c.id}</div>
                <div style={s({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
                  <div style={s({ width: 18, height: 18, borderRadius: 9, background: c.ac, color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" })}>{c.ini}</div>
                  <span style={s({ fontSize: 9, fontWeight: 700, color: c.pc })}>{c.p}</span>
                </div>
              </div>
            ))}
            {col.cards.length === 0 && <div style={s({ fontSize: 9, color: "#D1D5DB", textAlign: "center", padding: "12px 0" })}>なし</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

const GANTT = [
  { name: "一覧画面の作成", off: 0, len: 4, c: "#059669" },
  { name: "APIの接続", off: 2, len: 5, c: "#0284C7" },
  { name: "レビュー対応", off: 4, len: 3, c: "#D97706" },
];
function GanttBody() {
  return (
    <div style={s({ flex: 1, overflow: "hidden" })}>
      <div style={s({ display: "flex", fontSize: 8, color: "#B0A9A4", marginBottom: 6, paddingLeft: 108 })}>
        {["06/29", "07/01", "07/03", "07/05", "07/07", "07/09"].map((d) => (
          <div key={d} style={s({ flex: 1 })}>{d}</div>
        ))}
      </div>
      {GANTT.map((g) => (
        <div key={g.name} style={s({ display: "flex", alignItems: "center", marginBottom: 8 })}>
          <div style={s({ width: 108, fontSize: 9, color: "#3D3732", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 6 })}>{g.name}</div>
          <div style={s({ flex: 1, position: "relative", height: 14 })}>
            <div style={s({ position: "absolute", left: `${(g.off / 12) * 100}%`, width: `${(g.len / 12) * 100}%`, height: "100%", background: g.c, borderRadius: 4, opacity: 0.85 })} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * スプリントのビュー画面（現行アプリ準拠）。view でリスト/ボード/ガントを切替。
 * 各タブに data-spot="tab-list|tab-board|tab-gantt" を付与。
 */
export function ScreenSprintViews({ view, dragHint, holdDemo }: { view: View; dragHint?: boolean; holdDemo?: boolean }) {
  return (
    <MockAppShell activePage="projects" fillHeight>
      <div style={s({ padding: "10px 14px", height: "100%", display: "flex", flexDirection: "column", gap: 7, background: "#F9FAFB", boxSizing: "border-box", overflow: "hidden" })}>
        {/* breadcrumb */}
        <div style={s({ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#B0A9A4" })}>
          <span style={s({ color: "#059669", fontWeight: 600 })}>プロジェクト</span>
          <ChevronRight style={{ width: 10, height: 10 }} /><span style={s({ color: "#3D3732", fontWeight: 600 })}>サンプルプロジェクト</span>
        </div>
        {/* title row + sub-nav */}
        <div style={s({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 })}>
          <div>
            <div style={s({ display: "flex", alignItems: "center", gap: 7 })}>
              <h1 style={s({ fontSize: 15, fontWeight: 800, color: "#1A1714", margin: 0 })}>スプリント管理</h1>
              <span style={s({ fontSize: 8, fontWeight: 700, color: "#6B6458", background: "#EDEBE8", borderRadius: 5, padding: "2px 6px", fontFamily: "monospace" })}>SAMPLE</span>
            </div>
            <div style={s({ display: "flex", alignItems: "center", gap: 7, marginTop: 3 })}>
              <span style={s({ fontSize: 9, color: "#B0A9A4" })}>サンプルプロジェクト · 3 スプリント</span>
              <span style={s({ display: "flex", alignItems: "center", gap: 3, fontSize: 8, fontWeight: 600, color: "#059669", background: "#ECFDF5", borderRadius: 20, padding: "2px 7px" })}>
                <Globe style={{ width: 9, height: 9 }} />本番環境
              </span>
            </div>
          </div>
          <ProjectSubNav />
        </div>
        {/* view switcher row */}
        <div style={s({ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 })}>
          <ViewTabs active={view} />
          <div style={s({ display: "flex", alignItems: "center", gap: 5, background: "#059669", color: "#fff", borderRadius: 9, padding: "6px 11px", fontSize: 10, fontWeight: 600 })}>
            <Plus style={{ width: 12, height: 12 }} />新規スプリント
          </div>
        </div>
        {/* body */}
        {view === "list" ? <ListBody holdDemo={holdDemo} /> : view === "board" ? <BoardBody dragHint={dragHint} /> : <GanttBody />}
      </div>
    </MockAppShell>
  );
}
