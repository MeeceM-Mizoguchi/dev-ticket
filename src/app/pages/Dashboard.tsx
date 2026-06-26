import { useEffect, useState, useRef, useCallback, type ElementType } from "react";
import { useNavigate } from "react-router";
import { FolderKanban, TrendingUp, Zap, Clock, Plus, ChevronRight, Maximize2, RefreshCw } from "lucide-react";
import { NewTicketDialog } from "@/app/components/tickets/NewTicketDialog";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid, Legend } from "recharts";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { TICKETS, PROJECTS, SPRINTS } from "@/app/data/mock";
import { mapProject, mapSprintTicket } from "@/app/lib/mappers";
import { calcProgress, formatDate, getPriorityMeta, computeSprintStatus, getSprintStatusMeta, sprintProgress } from "@/app/lib/helpers";
import type { ProjectStatus, SprintTicket, TicketStatus, Priority, SprintStatus } from "@/app/types";

type ChartType = 'horizontal' | 'vertical' | 'line' | 'gantt';
type LineChartMode = 'project-progress' | 'weekly-close';

type DashTicket = {
  id: string; // 各プロジェクト・各スプリントの本物のチケットNo (SprintPageのticket.wbsに完全同期)
  title: string;
  project?: string;
  projectId?: string; // プロジェクト固有のURL用Slug/ID (例: PROJ5e88, DEVTICKET)
  status: string;
  priority: string;
  assignee?: string;
  dueDate?: string;
  sprint?: string;
  category?: string;
  dbId?: string;       // Supabase UUID (for TicketDetailPanel queries)
  sprintId?: string;   // Sprint ID
  projectDbId?: string; // Project Supabase UUID
};

type DashProject = {
  id: string; // プロジェクト固有ID
  name: string;
  status: ProjectStatus;
  client: string;
  members?: string[];
  done: number;
  inProgress: number;
  todo: number;
};

const STATUS_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  'todo':            { label: '未着手',     bg: '#F4F5F6', color: '#A09790' },
  'in-progress':     { label: '進行中',     bg: '#FFFBEB', color: '#D97706' },
  'in-review':       { label: 'レビュー中', bg: '#EFF6FF', color: '#2563EB' },
  'review-done':     { label: 'レビュー完了', bg: '#F0FDF4', color: '#16A34A' },
  'stg-test':        { label: 'STGテスト',  bg: '#F5F3FF', color: '#7C3AED' },
  'uat':             { label: 'UAT',        bg: '#FFF7ED', color: '#EA580C' },
  'done':            { label: '完了',       bg: '#ECFDF5', color: '#059669' },
  'closed':          { label: 'クローズ',  bg: '#F1F5F9', color: '#64748B' },
  'waiting-release': { label: 'リリース待ち', color: "#7C3AED", bg: "#F5F3FF" },
  'released':        { label: 'クローズ',  color: "#6B7280", bg: "#F3F4F6" },
};

// 判定を一元化するため、完了・クローズ系のステータス配列を定義
const TERMINAL_STATUSES = ["done", "closed", "waiting-release", "released"];

// ガント帯ホバー時に表示するチケット
type GanttTicket = { id: string; title: string; status: string; priority: string };

// ガントチャート用のスプリント期間データ
type GanttSprint = {
  id: string;
  projectName: string;
  projectSlug: string;   // 遷移用（/{slug}）
  identifier: string;    // スプリント識別子（/{slug}/{identifier}）
  name: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  progress: number;
  tickets: GanttTicket[]; // 帯ホバーで一覧表示
};

// ガントの1行の高さ（プロジェクト行・スプリント行 共通）。他チャートの高さ揃えにも使う
const GANTT_ROW_H = 34;
// ガントの描画高さ（行数から算出）= トグル(40) + 枠[ボーダー+ヘッダー28+行] + 凡例(30)
function ganttContentHeight(rowCount: number) {
  if (rowCount <= 0) return 320;
  return 40 + (28 + rowCount * GANTT_ROW_H + 3) + 30;
}

// モックデータからガント用スプリント配列を生成（開始日/終了日・ステータス・進捗）
function buildMockGantt(): GanttSprint[] {
  return SPRINTS.map(s => {
    const proj = PROJECTS.find(p => p.id === s.projectId);
    return {
      id: s.id,
      projectName: proj?.name ?? "",
      projectSlug: (proj as any)?.slug || proj?.id || "",
      identifier: (s as any).identifier || s.id,
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      status: computeSprintStatus(s),
      progress: sprintProgress(s),
      tickets: s.tickets.map(t => ({ id: t.wbs || t.id, title: t.title, status: t.status, priority: t.priority })),
    };
  });
}

export function Dashboard() {
  const { userName, userRole, userOrgId } = useAuth();
  const { selectedOrgId } = useOrg();
  const navigate = useNavigate();
  const firstName = userName.split(/[\s ]/)[0];

  // モックデータ読み込み時：クローズ・完了系のステータスのチケットをすべて除外する
  const [tickets, setTickets] = useState<DashTicket[]>(
    isSupabaseEnabled ? [] : TICKETS.filter(t => !TERMINAL_STATUSES.includes(t.status)).map(t => {
      const matchingProj = PROJECTS.find(p => p.name === t.project);
      return { 
        id: (t as any).wbs || t.id, // wbsプロパティがあれば最優先で参照
        title: t.title, 
        project: t.project, 
        projectId: matchingProj ? matchingProj.slug || matchingProj.id : (t.project === "DevTicket" ? "DEVTICKET" : "PROJ5e88"),
        status: t.status, 
        priority: t.priority, 
        assignee: t.assignee, 
        dueDate: t.dueDate 
      };
    })
  );
  
  const [projects, setProjects] = useState<DashProject[]>(
    isSupabaseEnabled ? [] : PROJECTS.map(p => ({ id: p.slug || p.id, name: p.name, status: p.status, client: p.client, members: p.members ?? [], done: p.done, inProgress: p.inProgress, todo: p.todo }))
  );
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [chartType, setChartType] = useState<ChartType>('vertical');
  const [ganttSprints, setGanttSprints] = useState<GanttSprint[]>(isSupabaseEnabled ? [] : buildMockGantt());
  const [lineChartMode] = useState<LineChartMode>('weekly-close');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);

  const [selectedSprintTicket, setSelectedSprintTicket] = useState<SprintTicket | null>(null);
  const [selectedTicketCtx, setSelectedTicketCtx] = useState<{ projectId: string; sprintId: string; projectSlug: string } | null>(null);
  
  // 更新中アニメーション制御用ステートを追加
  const [isRefreshing, setIsRefreshRefreshing] = useState(false);

  // 画面チカチカを発生させずにバックグラウンドで値を最新にマッピングし直す関数を切り出し
  const handleRefreshData = useCallback(async () => {
    if (!isSupabaseEnabled) {
      // ローカル環境時のサイレント・アップデート
      setIsRefreshRefreshing(true);
      setTickets(TICKETS.filter(t => !TERMINAL_STATUSES.includes(t.status)).map(t => {
        const matchingProj = PROJECTS.find(p => p.name === t.project);
        return { 
          id: (t as any).wbs || t.id,
          title: t.title, 
          project: t.project, 
          projectId: matchingProj ? matchingProj.slug || matchingProj.id : (t.project === "DevTicket" ? "DEVTICKET" : "PROJ5e88"),
          status: t.status, 
          priority: t.priority, 
          assignee: t.assignee, 
          dueDate: t.dueDate 
        };
      }));
      setProjects(PROJECTS.map(p => ({ id: p.slug || p.id, name: p.name, status: p.status, client: p.client, members: p.members ?? [], done: p.done, inProgress: p.inProgress, todo: p.todo })));
      setGanttSprints(buildMockGantt());
      setTimeout(() => setIsRefreshRefreshing(false), 500);
      return;
    }

    // Supabase環境時のサイレント・アップデート
    setIsRefreshRefreshing(true);
    const isOwner = userRole === "owner";
    let projQ = supabase!.from("projects").select("id, slug, name, status, client, members, organization_id");
    if (isOwner) {
      if (selectedOrgId) projQ = projQ.eq("organization_id", selectedOrgId);
    } else if (userOrgId) {
      projQ = (projQ as any).or(`organization_id.eq.${userOrgId},organization_id.is.null`);
    }

    try {
      const [tRes, sDataRes, pRes, cDataRes] = await Promise.all([
        supabase!.from("sprint_tickets").select("id, wbs, title, status, priority, due_date, sprint_id, assignee, category_id"),
        supabase!.from("sprints").select("id, project_id, name, start_date, end_date, identifier"),
        projQ,
        supabase!.from("ticket_categories").select("id, name"),
      ]);

      const tData = tRes.data;
      const sData = sDataRes.data;
      const pData = pRes.data;
      const cData = cDataRes.data;

      if (tData) {
        const sprints = sData ?? [];
        const projectsData = pData ?? [];
        const sprintToProject = new Map((sprints as any[]).map(s => [s.id, s.project_id]));
        const sprintNameMap = new Map((sprints as any[]).map(s => [s.id, s.name ?? '']));
        const projectSlugMap = new Map((projectsData as any[]).map(p => [p.id, p.slug || p.id]));
        const projectNameById = new Map((projectsData as any[]).map(p => [p.id, p.name]));
        const categoryNameMap = new Map(((cData ?? []) as any[]).map(c => [c.id, c.name]));
        
        // 🌟 変更: ダッシュボード全体のチケット同期部分において、TERMINAL_STATUSES（クローズ系）を除外する処理ではなく
        // 折れ線グラフ（クローズ累計）などを正しく描画できるように、全ステータスを安全に格納するように統一
        setTickets(tData.map((t: any) => {
          const resolvedProjectId = sprintToProject.get(t.sprint_id ?? '');
          const projSlug = projectSlugMap.get(resolvedProjectId ?? '') || 'DEVTICKET';

          return {
            id: t.wbs || t.id,
            dbId: t.id,                    
            sprintId: t.sprint_id,
            projectDbId: resolvedProjectId, 
            title: t.title,
            status: t.status,
            priority: t.priority,
            dueDate: t.due_date,
            assignee: t.assignee,
            project: projectNameById.get(resolvedProjectId ?? '') ?? undefined,
            projectId: projSlug,
            sprint: sprintNameMap.get(t.sprint_id ?? '') || undefined,
            category: t.category_id ? categoryNameMap.get(t.category_id) || undefined : undefined,
          };
        }));

        // ガント用: スプリント期間データを構築（ステータス/進捗・所属チケットは sprint_tickets から算出）
        const ganttData: GanttSprint[] = (sprints as any[])
          .filter(s => s.start_date && s.end_date)
          .map(s => {
            const rows = (tData as any[]).filter(t => t.sprint_id === s.id);
            const minimalSprint = { tickets: rows.map(t => ({ status: t.status })), endDate: s.end_date } as any;
            return {
              id: s.id,
              projectName: projectNameById.get(s.project_id ?? '') ?? '',
              projectSlug: projectSlugMap.get(s.project_id ?? '') || '',
              identifier: s.identifier || s.id,
              name: s.name ?? '',
              startDate: s.start_date,
              endDate: s.end_date,
              status: computeSprintStatus(minimalSprint),
              progress: sprintProgress(minimalSprint),
              tickets: rows.map(t => ({ id: t.wbs || t.id, title: t.title, status: t.status, priority: t.priority })),
            };
          });
        setGanttSprints(ganttData);
      }

      if (pData) {
        const sprints = sData ?? [];
        const ticketsData = tData ?? [];
        const mapped = pData.map((p: any) => {
          const sprintIds = sprints.filter((s: any) => s.project_id === p.id).map((s: any) => s.id);
          const projectTickets = ticketsData.filter((t: any) => sprintIds.includes(t.sprint_id));
          return {
            id: p.slug || p.id,
            name: p.name,
            status: p.status as ProjectStatus,
            client: p.client,
            members: (p as any).members ?? [],
            done: projectTickets.filter((t: any) => TERMINAL_STATUSES.includes(t.status)).length,
            inProgress: projectTickets.filter((t: any) => !TERMINAL_STATUSES.includes(t.status) && t.status !== "todo").length,
            todo: projectTickets.filter((t: any) => t.status === "todo").length,
          };
        });
        setProjects(mapped);
      }
    } catch (err) {
      console.error("Failed to background refresh dashboard:", err);
    } finally {
      setIsRefreshRefreshing(false);
    }
  }, [userRole, userOrgId, selectedOrgId]);

  // 初回ロード時
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    setLoading(true);
    handleRefreshData().then(() => setLoading(false));
  }, [handleRefreshData]);

  const normalizedFirst = firstName ? firstName.trim() : "";
  const normalizeName = (s?: string) => (s || "").toString().trim().replace(/\s+/g, '').replace(/[\p{P}\p{S}]/gu, '').toLowerCase();
  const userNorm = normalizeName(userName || normalizedFirst);

  const assignedProjects = projects.filter(p => {
    const members = Array.isArray(p.members) ? p.members : [];
    return members.some((m: string) => {
      const mNorm = normalizeName(m);
      return userNorm && (mNorm.includes(userNorm) || userNorm.includes(mNorm));
    });
  });

  const assignedProjectNames = assignedProjects.map(p => p.name);
  const assignedTickets = tickets.filter(t => t.project && assignedProjectNames.includes(t.project));

  const doneCount = assignedTickets.filter(t => TERMINAL_STATUSES.includes(t.status)).length;
  const inProgressCount = assignedTickets.filter(t => !TERMINAL_STATUSES.includes(t.status) && t.status !== "todo").length;
  const todoCount = assignedTickets.filter(t => t.status === "todo").length;
  const completionRate = assignedTickets.length > 0 ? Math.round((doneCount / assignedTickets.length) * 100) : 0;
  const activeProjects = assignedProjects.filter(p => p.status === "in-progress").length;

  const chartData = assignedProjects.map(p => ({
    name: p.name,
    完了: p.done, 進行中: p.inProgress, 未着手: p.todo,
  }));

  // 🌟 修正: 完了・クローズ系のステータス（TERMINAL_STATUSES）を正確にマッピングして、グラフ表示の不整合を排除
  const lineStatusCategories = [
    { key: '未着手', statuses: ['todo'] },
    { key: '進行中', statuses: ['in-progress'] },
    { key: 'レビュー中', statuses: ['in-review'] },
    { key: 'レビュー完了', statuses: ['review-done'] },
    { key: 'STG完了', statuses: ['stg-test'] },
    { key: 'UAT完了', statuses: ['uat'] },
    { key: 'クローズ', statuses: TERMINAL_STATUSES }, // システム標準のクローズ定義に完全同期
  ] as const;

  const getWeekStartKey = (dateString?: string) => {
    if (!dateString) return '';
    const value = new Date(dateString);
    if (Number.isNaN(value.getTime())) return '';
    const dayOfWeek = value.getDay();
    const diffToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(value);
    monday.setDate(value.getDate() - diffToMonday);
    
    const yyyy = monday.getFullYear();
    const mm = String(monday.getMonth() + 1).padStart(2, '0');
    const dd = String(monday.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const formatWeekLabel = (isoDate?: string) => {
    if (!isoDate) return '';
    const value = new Date(isoDate);
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getMonth() + 1}/${value.getDate()}週`;
  };

  const projectProgressLineData = lineStatusCategories.map(category => ({
    status: category.key,
    ...assignedProjects.reduce<Record<string, number>>((acc, project) => ({
      ...acc,
      [project.name]: assignedTickets.filter(t => t.project === project.name && category.statuses.includes(t.status)).length,
    }), {}),
  }));

  const weeklyCloseData = (() => {
    const grouped: Record<string, Record<string, number>> = {};
    assignedTickets
      .filter(t => TERMINAL_STATUSES.includes(t.status) && t.dueDate) // 🌟 修正: TERMINAL_STATUSESを参照して漏れなくクローズ数を集計
      .forEach(t => {
        const weekKey = getWeekStartKey(t.dueDate);
        if (!weekKey) return;
        if (!grouped[weekKey]) grouped[weekKey] = {};
        const projectName = t.project || 'Unknown';
        grouped[weekKey][projectName] = (grouped[weekKey][projectName] ?? 0) + 1;
      });
    return Object.keys(grouped).sort().map(weekKey => ({ 
      week: formatWeekLabel(weekKey), 
      weekKey,
      ...grouped[weekKey]
    }));
  })();

  const filteredWeeklyCloseData = (() => {
    if (!assignedProjects || assignedProjects.length === 0) return [];

    const currentYear = new Date().getFullYear();
    const firstDayOfMonth = new Date(currentYear, selectedMonth - 1, 1);
    
    const day = firstDayOfMonth.getDay();
    const diffToMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
    const firstMonday = new Date(firstDayOfMonth);
    firstMonday.setDate(firstDayOfMonth.getDate() + diffToMonday);

    const weeksInMonth: { week: string; weekKey: string }[] = [];
    const targetMonday = new Date(firstMonday);

    while (targetMonday.getMonth() + 1 === selectedMonth) {
      const yyyy = targetMonday.getFullYear();
      const mm = String(targetMonday.getMonth() + 1).padStart(2, '0');
      const dd = String(targetMonday.getDate()).padStart(2, '0');
      const key = `${yyyy}-${mm}-${dd}`;
      
      weeksInMonth.push({
        week: `${selectedMonth}/${targetMonday.getDate()}週`,
        weekKey: key
      });
      targetMonday.setDate(targetMonday.getDate() + 7);
    }

    return weeksInMonth.map(w => {
      const existingData = weeklyCloseData.find(d => d.weekKey === w.weekKey);
      
      const projectCounts = assignedProjects.reduce<Record<string, number>>((acc, p) => {
        acc[p.name] = existingData ? (existingData[p.name] ?? 0) : 0;
        return acc;
      }, {});

      return {
        week: w.week,
        ...projectCounts
      };
    });
  })();

  const RectangleMatrix = (() => {
    if (!filteredWeeklyCloseData || filteredWeeklyCloseData.length === 0) return true;
    let totalScore = 0;
    filteredWeeklyCloseData.forEach(weekItem => {
      if (!weekItem) return;
      assignedProjects.forEach(proj => {
        const val = weekItem[proj.name];
        if (typeof val === 'number') {
          totalScore += val;
        }
      });
    });
    return totalScore === 0;
  })();

  const isBarChartAllZero = assignedProjects.length === 0 ||
    chartData.every(d => d.完了 === 0 && d.進行中 === 0 && d.未着手 === 0);

  const isProjectProgressAllZero = assignedProjects.length === 0 ||
    projectProgressLineData.every(row =>
      assignedProjects.every(p => ((row as Record<string, number>)[p.name] ?? 0) === 0)
    );

  const activeTickets = assignedTickets.filter(t => !TERMINAL_STATUSES.includes(t.status)).slice(0, 5);

  const overdueCountValue = assignedTickets.filter(t => {
    if (!t.dueDate || TERMINAL_STATUSES.includes(t.status)) return false;
    return t.dueDate < new Date().toISOString().split("T")[0];
  }).length;

  const statTiles = [
    { value: activeProjects, label: "進行中プロジェクト", icon: FolderKanban, accent: "#059669", accentBg: "#ECFDF5", trend: `全${assignedProjects.length}件`, up: true },
    { value: inProgressCount, label: "進行中チケット", icon: Zap, accent: "#D97706", accentBg: "#FFFBEB", trend: overdueCountValue > 0 ? `期限超過 ${overdueCountValue}件` : "遅延なし", up: overdueCountValue === 0 },
    { value: todoCount, label: "未着手チケット", icon: Clock, accent: "#0284C7", accentBg: "#F0F9FF", trend: `全${assignedTickets.length}件`, up: true },
    { value: `${completionRate}%`, label: "チーム完了率", icon: TrendingUp, accent: "#059669", accentBg: "#ECFDF5", trend: `完了 ${doneCount}件`, up: true },
  ];

  // ガントの行数から高さを算出し、他チャート（横棒/縦棒/折れ線）も同じ縦サイズに揃える
  const ganttRowCount = (() => {
    const names = assignedProjects.map(p => p.name);
    const validGantt = ganttSprints.filter(s => s.startDate && s.endDate && names.includes(s.projectName));
    return names.reduce((sum, n) => {
      const c = validGantt.filter(s => s.projectName === n).length;
      return c > 0 ? sum + 1 + c : sum;
    }, 0);
  })();
  const chartAreaHeight = ganttContentHeight(ganttRowCount);

  const renderProjectNameTick = ({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => (
    <text x={2} y={y + 7} textAnchor="start" fill="#6B6458" fontSize={14} fontFamily="Inter,ui-sans-serif,system-ui,sans-serif" fontWeight={500}>
      {payload.value}
    </text>
  );

  const handleTicketClick = (ticket: DashTicket, event: React.MouseEvent) => {
    event.stopPropagation();
    const st: SprintTicket = {
      id: ticket.dbId || ticket.id,
      wbs: ticket.id,
      title: ticket.title,
      status: ticket.status as TicketStatus,
      priority: ticket.priority as Priority,
      assignee: ticket.assignee ?? '',
      startDate: '',
      dueDate: ticket.dueDate ?? '',
      estimatedHours: 0,
      progress: 0,
      description: '',
      reviewerName: '',
      reviewRound: 0,
      images: [],
      categoryId: null,
      parentId: null,
    };
    setSelectedSprintTicket(st);
    setSelectedTicketCtx({
      projectId: ticket.projectDbId ?? '',
      sprintId: ticket.sprintId ?? '',
      projectSlug: ticket.projectId ?? '',
    });
  };

  return (
    <div style={{ padding: "32px 28px", minWidth: 900 }}>
      <div style={{ marginBottom: 28, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", letterSpacing: "0.10em", marginBottom: 8, textTransform: "uppercase" as const }}>
            {new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
          </p>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.04em", lineHeight: 1.05 }}>
            こんにちは、<span style={{ color: "#059669" }}>{firstName}</span>さん
          </h1>
          <p style={{ fontSize: 13, color: "#A09790", marginTop: 8, lineHeight: 1 }}>今日のチーム状況 — {new Date().toLocaleDateString("ja-JP", { month: "short", day: "numeric" })} 時点</p>
        </div>
        <button
          onClick={() => setShowNewTicket(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 12, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 10px rgba(5,150,105,0.30)", letterSpacing: "0.01em" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
          <Plus style={{ width: 14, height: 14 }} />新規チケット
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
        {statTiles.map(({ value, label, icon: Icon, accent, accentBg, trend, up }) => (
          <div key={label} style={{ background: "#FFFFFF", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)", display: "flex" }}>
            <div style={{ width: 4, background: accent, flexShrink: 0 }} />
            <div style={{ flex: 1, padding: "18px 18px 18px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: accentBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon style={{ width: 15, height: 15, color: accent }} />
                </div>
                <span style={{ fontSize: 9, color: up ? "#059669" : "#D97706", fontFamily: "var(--font-mono)", fontWeight: 600, background: up ? "#ECFDF5" : "#FFFBEB", padding: "2px 7px", borderRadius: 20 }}>{trend}</span>
              </div>
              <p style={{ fontSize: 34, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</p>
              <p style={{ fontSize: 11, color: "#A09790", marginTop: 5, lineHeight: 1 }}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, marginBottom: 16 }}>
        <div style={{ minWidth: 0, background: "#FFFFFF", borderRadius: 14, padding: "20px 24px", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>プロジェクト進捗</h2>
              <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 3 }}>ステータス別チケット集計</p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { value: 'horizontal' as ChartType, label: '横棒' },
                  { value: 'vertical' as ChartType, label: '縦棒' },
                  { value: 'line' as ChartType, label: '面グラフ' },
                  { value: 'gantt' as ChartType, label: 'ガント' }
                ].map(btn => (
                  <button
                    key={btn.value}
                    onClick={() => setChartType(btn.value)}
                    style={{
                      padding: "6px 12px",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: "1px solid",
                      background: chartType === btn.value ? "#059669" : "transparent",
                      color: chartType === btn.value ? "#fff" : "#B0A9A4",
                      borderColor: chartType === btn.value ? "#059669" : "#E6E2D9",
                      cursor: "pointer",
                      transition: "all 0.2s ease"
                    }}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              {chartType === 'line' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ minWidth: 80 }}>
                    <CustomSelect
                      value={String(selectedMonth)}
                      options={[1,2,3,4,5,6,7,8,9,10,11,12].map(m => ({ value: String(m), label: `${m}月` }))}
                      onChange={v => setSelectedMonth(Number(v))}
                    />
                  </div>
                </div>
              )}
              {(chartType === 'horizontal' || chartType === 'vertical') && (
                <div style={{ display: "flex", gap: 10 }}>
                  {[{ c: "#059669", l: "完了" }, { c: "#D97706", l: "進行中" }, { c: "#E6E2D9", l: "未着手" }].map(({ c, l }) => (
                    <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
                      <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 500 }}>{l}</span>
                    </div>
                  ))}
                </div>
              )}
              
              <button 
                type="button"
                onClick={handleRefreshData}
                disabled={isRefreshing}
                title="データを最新に更新"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 6, borderRadius: 8, border: "1px solid #E6E2D9",
                  background: "#FFFFFF", cursor: isRefreshing ? "not-allowed" : "pointer",
                  color: "#6B6458", transition: "all 0.15s ease", outline: "none"
                }}
                onMouseEnter={e => { if (!isRefreshing) e.currentTarget.style.background = "#F4F5F6"; }}
                onMouseLeave={e => { if (!isRefreshing) e.currentTarget.style.background = "#FFFFFF"; }}
              >
                <RefreshCw 
                  style={{ 
                    width: 14, height: 14,
                    transition: "transform 0.5s ease",
                    transform: isRefreshing ? "rotate(360deg)" : "none"
                  }} 
                />
              </button>
            </div>
          </div>

          <div style={{ height: chartType === 'gantt' ? 'auto' : chartAreaHeight }}>
            {chartType === 'horizontal' && (
              isBarChartAllZero ? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 13, color: "#C9C4BB" }}>実績データがありません</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 24, top: 8, bottom: 8 }} barCategoryGap="28%" barSize={28}>
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#B0A9A4", fontFamily: "JetBrains Mono,monospace" }} tickMargin={6} padding={{ right: 18 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={renderProjectNameTick} axisLine={false} tickLine={false} width={180} />
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 10, fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}
                      labelStyle={{ color: "#1A1714", fontWeight: 700 }} itemStyle={{ color: "#6B6458" }} cursor={{ fill: "rgba(26,23,20,0.03)" }} />
                    <Bar dataKey="完了" stackId="a" fill="#059669" />
                    <Bar dataKey="進行中" stackId="a" fill="#D97706" />
                    <Bar dataKey="未着手" stackId="a" fill="#E6E2D9" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )
            )}
            {chartType === 'vertical' && (
              isBarChartAllZero ? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 13, color: "#C9C4BB" }}>実績データがありません</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ left: 16, right: 16, top: 16, bottom: 24 }} barCategoryGap="30%" barSize={60}>
                    <XAxis dataKey="name" height={36} tick={{ fontSize: 13, fontFamily: "Inter,ui-sans-serif,system-ui,sans-serif", fontWeight: 500, fill: "#6B6458" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#B0A9A4" }} axisLine={false} tickLine={false} width={32} />
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 10, fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}
                      labelStyle={{ color: "#1A1714", fontWeight: 700 }} itemStyle={{ color: "#6B6458" }} cursor={{ fill: "rgba(26,23,20,0.03)" }} />
                    <Bar dataKey="完了" fill="#059669" />
                    <Bar dataKey="進行中" fill="#D97706" />
                    <Bar dataKey="未着手" fill="#E6E2D9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )
            )}
            {chartType === 'line' && (
              (lineChartMode === 'project-progress' ? isProjectProgressAllZero : RectangleMatrix) ? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 13, color: "#C9C4BB" }}>実績データがありません</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={lineChartMode === 'project-progress' ? projectProgressLineData : filteredWeeklyCloseData} margin={{ left: 40, right: 80, top: 20, bottom: 10 }}>
                    <defs>
                      {assignedProjects.map((project, index) => {
                        const colors = ['#059669', '#D97706', '#2563EB', '#9333EA', '#F59E0B', '#14B8A6'];
                        const color = colors[index % colors.length];
                        return (
                          <linearGradient key={project.id} id={`areaGradient-${index}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                          </linearGradient>
                        );
                      })}
                    </defs>
                    <CartesianGrid vertical={false} stroke="#F0EEE9" strokeDasharray="0" />
                    <XAxis
                      type="category"
                      dataKey={lineChartMode === 'project-progress' ? 'status' : 'week'}
                      ticks={lineChartMode === 'project-progress' ? lineStatusCategories.map(c => c.key) : undefined}
                      interval={0}
                      tick={{ fontSize: 11, fill: '#B0A9A4' }}
                      angle={0}
                      textAnchor="middle"
                      height={40}
                      axisLine={false}
                      tickLine={false}
                      padding={{ left: 12, right: 12 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: '#B0A9A4' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid rgba(26,23,20,0.1)', borderRadius: 10, fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.10)' }}
                      labelStyle={{ color: '#1A1714', fontWeight: 700 }} itemStyle={{ color: '#6b7280' }} />
                    <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ paddingBottom: 8 }} />
                    {assignedProjects.map((project, index) => {
                      const colors = ['#059669', '#D97706', '#2563EB', '#9333EA', '#F59E0B', '#14B8A6'];
                      const color = colors[index % colors.length];
                      return (
                        <Area
                          key={project.id}
                          type="monotone"
                          dataKey={project.name}
                          stroke={color}
                          strokeWidth={2.5}
                          fill={`url(#areaGradient-${index})`}
                          fillOpacity={1}
                          dot={false}
                          activeDot={{ r: 4, fill: color, stroke: '#fff', strokeWidth: 2 }}
                        />
                      );
                    })}
                  </AreaChart>
                </ResponsiveContainer>
              )
            )}
            
            {chartType === 'gantt' && (
              <DashboardGantt projectNames={assignedProjects.map(p => p.name)} sprints={ganttSprints} navigate={navigate} />
            )}
          </div>
        </div>

        {/* アクティブチケットパネル */}
        <div style={{ background: "#FFFFFF", borderRadius: 14, padding: "20px 20px", display: "flex", flexDirection: "column", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>アクティブチケット</h2>
            <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#B0A9A4", background: "#F4F5F6", padding: "2px 8px", borderRadius: 20 }}>{inProgressCount + todoCount}件</span>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
            {activeTickets.length === 0 ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#C9C4BB", fontSize: 12 }}>アクティブチケットなし</div>
            ) : activeTickets.map(ticket => {
              const pr = getPriorityMeta(ticket.priority as "high" | "medium" | "low");
              const isInProgress = ticket.status !== "todo";
              
              return (
                <div style={{ display: "flex", gap: 10, padding: "9px 8px", borderRadius: 8, cursor: "pointer" }}
                  key={ticket.id}
                  onClick={(e) => handleTicketClick(ticket, e)}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: pr.dot, marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: "#1A1714", lineHeight: 1.3, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ticket.title}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 9, background: isInProgress ? "#ECFDF5" : "#F4F5F6", color: isInProgress ? "#059669" : "#A09790", padding: "2px 7px", borderRadius: 20, fontWeight: 600 }}>
                        {isInProgress ? "進行中" : "未着手"}
                      </span>
                      {ticket.dueDate && <span style={{ fontSize: 9, color: "#C9C4BB", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>{formatDate(ticket.dueDate)}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* プロジェクト一覧パネル */}
      <div style={{ background: "#FFFFFF", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px 14px" }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>プロジェクト一覧</h2>
          <ChevronRight style={{ width: 14, height: 14, color: "#C9C4BB" }} />
        </div>
        <div style={{ borderTop: "1px solid rgba(26,23,20,0.05)" }}>
          {assignedProjects.map((p, i) => {
            const progress = calcProgress(p.done, p.inProgress, p.todo);
            const statusStyle: Record<ProjectStatus, { bg: string; color: string; label: string }> = {
              "in-progress": { bg: "#ECFDF5", color: "#059669", label: "進行中" },
              completed:     { bg: "#ECFDF5", color: "#059669", label: "完了" },
              "on-hold":     { bg: "#FFFBEB", color: "#D97706", label: "保留中" },
              planning:      { bg: "#F4F5F6", color: "#A09790", label: "計画中" },
            };
            const ss = statusStyle[p.status];
            return (
              <div key={p.id}
                onClick={() => navigate(`/${p.id}`)}
                title={`${p.name} のスプリント一覧へ`}
                style={{ display: "grid", gridTemplateColumns: "1fr 160px 60px 90px", alignItems: "center", gap: 20, padding: "13px 24px", background: i % 2 === 1 ? "rgba(26,23,20,0.015)" : "transparent", cursor: "pointer", transition: "background 0.12s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FFF7F3"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 === 1 ? "rgba(26,23,20,0.015)" : "transparent"; }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: ss.color, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</p>
                    <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.client}</p>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 6, background: "#EDE9E0", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress}%`, background: "#059669", borderRadius: 99 }} />
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#3D3732", fontFamily: "var(--font-mono)", textAlign: "right" }}>{progress}%</span>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 20, background: ss.bg, color: ss.color, fontWeight: 700, letterSpacing: "0.01em" }}>{ss.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {showNewTicket && (
        <NewTicketDialog onClose={() => setShowNewTicket(false)} />
      )}

      {selectedSprintTicket && selectedTicketCtx && (
        <TicketDetailPanel
          ticket={selectedSprintTicket}
          projectId={selectedTicketCtx.projectId}
          sprintId={selectedTicketCtx.sprintId}
          projectSlug={selectedTicketCtx.projectSlug}
          onClose={() => { setSelectedSprintTicket(null); setSelectedTicketCtx(null); }}
          onUpdated={() => {}}
          onDeleted={() => { setSelectedSprintTicket(null); setSelectedTicketCtx(null); }}
          onSelectTicket={t => setSelectedSprintTicket(t)}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// ガントチャート（プロジェクト → スプリント階層 / 月・週ビュー切替）
// ----------------------------------------------------------------------------
function DashboardGantt({ projectNames, sprints, navigate }: { projectNames: string[]; sprints: GanttSprint[]; navigate: (to: string) => void }) {
  const [scale, setScale] = useState<'month' | 'week'>('month');
  const [hover, setHover] = useState<{ sprint: GanttSprint; left: number; top: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHover = (sprint: GanttSprint, e: React.MouseEvent) => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHover({ sprint, left: r.left, top: r.top - 6 });
  };
  const hideHover = () => { hoverTimer.current = setTimeout(() => setHover(null), 200); };
  const keepHover = () => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } };
  const openSprint = (s: GanttSprint) => navigate(`/${s.projectSlug}/${s.identifier || s.id}`);

  const LABEL_W = 200;
  const DAY = 86400000;
  const ROW_H = GANTT_ROW_H;
  const pxPerDay = scale === 'month' ? 4 : 12;
  const dayDiff = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);
  const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

  const valid = sprints.filter(s => s.startDate && s.endDate && projectNames.includes(s.projectName));

  // 表示領域の幅を計測して、空き領域まで月/週を伸ばす
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [valid.length]);

  if (valid.length === 0) {
    return (
      <div style={{ height: 320, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 13, color: "#C9C4BB" }}>表示できるスプリント期間データがありません</span>
      </div>
    );
  }

  const maxD = new Date(Math.max(...valid.map(s => new Date(s.endDate).getTime())));
  // 開始 = 今月の2ヶ月前の1日で固定。終了 = データ範囲 or 表示領域の広い方まで可変に伸ばす
  const today = new Date();
  const tlStart = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  const availTimeline = Math.max(0, viewW - LABEL_W);
  const dataWidth = (dayDiff(tlStart, maxD) + 1) * pxPerDay;
  const totalWidth = Math.max(dataWidth, availTimeline);
  const tickEnd = addDays(tlStart, Math.ceil(totalWidth / pxPerDay));
  const x = (d: Date) => dayDiff(tlStart, d) * pxPerDay;
  // バーを表示範囲[0,totalWidth]にクランプ（完全に範囲外ならnull）
  const barRange = (s: Date, e: Date) => {
    const l = x(s), r = x(e) + pxPerDay;
    const cl = Math.max(0, l), cr = Math.min(totalWidth, r);
    if (cr <= 0 || cl >= totalWidth || cr - cl <= 0) return null;
    return { left: cl, width: Math.max(cr - cl, 6) };
  };

  // 目盛り
  const ticks: { x: number; label: string; major: boolean }[] = [];
  if (scale === 'month') {
    const cur = new Date(tlStart);
    while (cur <= tickEnd) { ticks.push({ x: x(cur), label: `${cur.getMonth() + 1}月`, major: cur.getMonth() === 0 }); cur.setMonth(cur.getMonth() + 1); }
  } else {
    const cur = new Date(tlStart);
    cur.setDate(cur.getDate() + ((8 - cur.getDay()) % 7)); // 次の月曜
    while (cur <= tickEnd) { ticks.push({ x: x(cur), label: `${cur.getMonth() + 1}/${cur.getDate()}`, major: cur.getDate() <= 7 }); cur.setDate(cur.getDate() + 7); }
  }

  const todayX = x(today);
  const showToday = todayX >= 0 && todayX <= totalWidth;
  const groups = projectNames.map(name => ({ name, sprints: valid.filter(s => s.projectName === name) })).filter(g => g.sprints.length);

  return (
    <div style={{ minHeight: 320 }}>
      {/* 月/週 切替 */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 4, background: "#F4F5F6", padding: 3, borderRadius: 9, border: "1px solid #E6E2D9" }}>
          {[{ v: 'month' as const, l: '月' }, { v: 'week' as const, l: '週' }].map(({ v, l }) => (
            <button key={v} onClick={() => setScale(v)} style={{
              padding: "5px 16px", fontSize: 12, fontWeight: 600, borderRadius: 7, border: "none", cursor: "pointer",
              background: scale === v ? "#FFFFFF" : "transparent", color: scale === v ? "#059669" : "#9E9690",
              boxShadow: scale === v ? "0 1px 3px rgba(0,0,0,0.10)" : "none",
            }}>{l}</button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} style={{ overflowX: "auto", overflowY: "hidden", border: "1.5px solid #E6E2D9", borderRadius: 12 }}>
        <div style={{ width: LABEL_W + totalWidth, position: "relative" }}>
          {/* 目盛りヘッダー */}
          <div style={{ display: "flex", height: 28, borderBottom: "1.5px solid #E6E2D9", position: "relative" }}>
            <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 3, background: "#FFFFFF", display: "flex", alignItems: "center", paddingLeft: 12 }}>
              <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 600 }}>プロジェクト / スプリント</span>
            </div>
            <div style={{ position: "relative", flex: 1 }}>
              {ticks.map((t, i) => (
                <div key={i} style={{ position: "absolute", left: t.x, top: 0, bottom: 0, display: "flex", alignItems: "center", paddingLeft: 4 }}>
                  <span style={{ fontSize: 10, color: t.major ? "#6B6458" : "#B0A9A4", fontWeight: t.major ? 700 : 500, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 本体 */}
          <div style={{ position: "relative" }}>
            {/* 縦グリッド線 */}
            {ticks.map((t, i) => (
              <div key={i} style={{ position: "absolute", left: LABEL_W + t.x, top: 0, bottom: 0, width: 1, background: t.major ? "#E6E2D9" : "#F4F5F6", zIndex: 0 }} />
            ))}
            {/* 今日ライン */}
            {showToday && (
              <div style={{ position: "absolute", left: LABEL_W + todayX, top: 0, bottom: 0, width: 2, background: "#DC2626", zIndex: 1 }}>
                <span style={{ position: "absolute", top: 2, left: 4, fontSize: 9, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", padding: "0 5px", borderRadius: 10, whiteSpace: "nowrap" }}>今日</span>
              </div>
            )}

            {groups.map(g => {
              const gStart = new Date(Math.min(...g.sprints.map(s => new Date(s.startDate).getTime())));
              const gEnd = new Date(Math.max(...g.sprints.map(s => new Date(s.endDate).getTime())));
              const projSlug = g.sprints[0]?.projectSlug || "";
              return (
                <div key={g.name}>
                  {/* プロジェクト行 */}
                  <div style={{ display: "flex", height: ROW_H, alignItems: "center", position: "relative", zIndex: 2 }}>
                    <div
                      onClick={() => projSlug && navigate(`/${projSlug}?view=gantt`)}
                      title={`${g.name} のガントチャートを開く`}
                      style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: "#FAFAF8", display: "flex", alignItems: "center", gap: 7, paddingLeft: 12, paddingRight: 8, height: "100%", cursor: projSlug ? "pointer" : "default" }}
                      onMouseEnter={e => { (e.currentTarget.querySelector('[data-projname]') as HTMLElement | null)?.style.setProperty('text-decoration', 'underline'); }}
                      onMouseLeave={e => { (e.currentTarget.querySelector('[data-projname]') as HTMLElement | null)?.style.setProperty('text-decoration', 'none'); }}
                    >
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#059669", flexShrink: 0 }} />
                      <span data-projname style={{ fontSize: 12, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecorationColor: "#059669" }}>{g.name}</span>
                    </div>
                    <div style={{ position: "relative", flex: 1, height: "100%" }}>
                      {(() => { const b = barRange(gStart, gEnd); return b ? (
                        <div style={{ position: "absolute", left: b.left, width: b.width, top: "50%", transform: "translateY(-50%)", height: 8, background: "rgba(5,150,105,0.20)", borderRadius: 99 }} />
                      ) : null; })()}
                    </div>
                  </div>
                  {/* スプリント行 */}
                  {g.sprints.map(s => {
                    const meta = getSprintStatusMeta(s.status);
                    const b = barRange(new Date(s.startDate), new Date(s.endDate));
                    return (
                      <div key={s.id} style={{ display: "flex", height: ROW_H, alignItems: "center", position: "relative", zIndex: 2 }}>
                        <div
                          onClick={() => openSprint(s)}
                          title={`${s.name} のチケット一覧へ`}
                          style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: "#FFFFFF", display: "flex", alignItems: "center", paddingLeft: 28, paddingRight: 8, height: "100%", cursor: "pointer" }}
                          onMouseEnter={e => { (e.currentTarget.querySelector('[data-sprname]') as HTMLElement | null)?.style.setProperty('text-decoration', 'underline'); }}
                          onMouseLeave={e => { (e.currentTarget.querySelector('[data-sprname]') as HTMLElement | null)?.style.setProperty('text-decoration', 'none'); }}
                        >
                          <span data-sprname style={{ fontSize: 11, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecorationColor: "#9CA3AF" }}>{s.name}</span>
                        </div>
                        <div style={{ position: "relative", flex: 1, height: "100%" }}>
                          {b && (
                            <div
                              onClick={() => openSprint(s)}
                              onMouseEnter={e => showHover(s, e)}
                              onMouseLeave={hideHover}
                              style={{
                                position: "absolute", left: b.left, width: b.width, top: "50%", transform: "translateY(-50%)",
                                height: 18, background: meta.bg, border: `1px solid ${meta.color}`, borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", cursor: "pointer",
                              }}>
                              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${s.progress}%`, background: meta.color, opacity: 0.32 }} />
                              {b.width > 44 && <span style={{ position: "relative", fontSize: 9, fontWeight: 700, color: meta.color, paddingLeft: 6, whiteSpace: "nowrap" }}>{s.progress}%</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 凡例 */}
      <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
        {(['active', 'completed', 'planning', 'delayed'] as SprintStatus[]).map(k => {
          const m = getSprintStatusMeta(k);
          return (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 12, height: 12, background: m.bg, border: `1px solid ${m.color}`, borderRadius: 3 }} />
              <span style={{ fontSize: 10, color: "#6B6458", fontWeight: 500 }}>{m.label}</span>
            </div>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <div style={{ width: 2, height: 12, background: "#DC2626" }} />
          <span style={{ fontSize: 10, color: "#6B6458", fontWeight: 500 }}>今日</span>
        </div>
      </div>

      {/* 帯ホバー: 対象スプリントのチケット一覧（マトリックスの+Nポップアップを踏襲） */}
      {hover && (
        <div
          onMouseEnter={keepHover}
          onMouseLeave={hideHover}
          style={{
            position: "fixed", top: hover.top, left: hover.left, transform: "translateY(-100%)",
            background: "#ffffff", border: "1px solid #E6E2D9", borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "10px 12px", zIndex: 9999,
            minWidth: 300, maxWidth: 420, display: "flex", flexDirection: "column", gap: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, borderBottom: "1px solid #F3F4F6", paddingBottom: 6 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hover.sprint.name}</p>
              <p style={{ fontSize: 10, color: "#9CA3AF", marginTop: 1 }}>
                {(() => { const m = getSprintStatusMeta(hover.sprint.status); return m.label; })()}・進捗{hover.sprint.progress}%・{hover.sprint.tickets.length}件
              </p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); openSprint(hover.sprint); }}
              title="このスプリントのチケット一覧へ"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, border: "1px solid #E6E2D9", borderRadius: 4, background: "#FFFFFF", cursor: "pointer", color: "#9CA3AF", padding: 0, flexShrink: 0, transition: "all 0.15s ease" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#059669"; (e.currentTarget as HTMLElement).style.borderColor = "#059669"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#9CA3AF"; (e.currentTarget as HTMLElement).style.borderColor = "#E6E2D9"; }}
            >
              <Maximize2 style={{ width: 12, height: 12 }} />
            </button>
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
            {hover.sprint.tickets.length === 0 ? (
              <div style={{ padding: "10px 0", textAlign: "center", color: "#C9C4BB", fontSize: 11 }}>チケットなし</div>
            ) : hover.sprint.tickets.map(t => {
              const sm = STATUS_LABELS[t.status] ?? { label: t.status, bg: "#F4F5F6", color: "#6B6458" };
              return (
                <div
                  key={t.id}
                  onClick={() => navigate(`/${hover.sprint.projectSlug}/${t.id}`)}
                  title={`${t.id} のチケットを開く`}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", borderRadius: 6, cursor: "pointer", background: "transparent", transition: "background 0.12s ease" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#F0FDF4"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#6D28D9", border: "1.5px solid #8B5CF6", borderRadius: 10, padding: "1px 6px", background: "#F3F0FF", whiteSpace: "nowrap", flexShrink: 0 }}>{t.id}</span>
                  <span style={{ fontSize: 11, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={t.title}>{t.title}</span>
                  <span style={{ fontSize: 9, padding: "1px 7px", borderRadius: 20, fontWeight: 600, background: sm.bg, color: sm.color, whiteSpace: "nowrap", flexShrink: 0 }}>{sm.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}