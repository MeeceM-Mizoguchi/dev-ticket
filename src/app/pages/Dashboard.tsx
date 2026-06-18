import { useEffect, useState, useRef, type ElementType } from "react";
import { FolderKanban, TrendingUp, Zap, Clock, Plus, ChevronRight, Maximize2, X } from "lucide-react";
import { NewTicketDialog } from "@/app/components/tickets/NewTicketDialog";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { TICKETS, PROJECTS } from "@/app/data/mock";
import { mapProject, mapSprintTicket } from "@/app/lib/mappers";
import { calcProgress, formatDate, getPriorityMeta } from "@/app/lib/helpers";
import type { ProjectStatus, SprintTicket, TicketStatus, Priority } from "@/app/types";
import { escStack } from "@/app/lib/escStack";

type ChartType = 'horizontal' | 'vertical' | 'line' | 'scatter';
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

type MatrixTicket = DashTicket & { isBug: boolean };

const STATUS_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  'todo':        { label: '未着手',     bg: '#F4F5F6', color: '#A09790' },
  'in-progress': { label: '進行中',     bg: '#FFFBEB', color: '#D97706' },
  'in-review':   { label: 'レビュー中', bg: '#EFF6FF', color: '#2563EB' },
  'review-done': { label: 'レビュー完了', bg: '#F0FDF4', color: '#16A34A' },
  'stg-test':    { label: 'STGテスト',  bg: '#F5F3FF', color: '#7C3AED' },
  'uat':         { label: 'UAT',        bg: '#FFF7ED', color: '#EA580C' },
  'done':        { label: '完了',       bg: '#ECFDF5', color: '#059669' },
  'closed':      { label: 'クローズ',  bg: '#F1F5F9', color: '#64748B' },
};

const PRIORITY_META_MODAL: Record<string, { label: string; color: string }> = {
  'high':   { label: '高', color: '#EF4444' },
  'medium': { label: '中', color: '#F59E0B' },
  'low':    { label: '低', color: '#3B82F6' },
};

export function Dashboard() {
  const { userName } = useAuth();
  const firstName = userName.split(/[\s ]/)[0];

  // モックデータ読み込み時：wbsを最優先でidに設定して完全同期
  const [tickets, setTickets] = useState<DashTicket[]>(
    isSupabaseEnabled ? [] : TICKETS.map(t => {
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
  const [lineChartMode, setLineChartMode] = useState<LineChartMode>('project-progress');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);

  const [selectedScatterProject, setSelectedScatterProject] = useState<string>("");
  const [hoveredExtraCellKey, setHoveredExtraCellKey] = useState<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandModalData, setExpandModalData] = useState<{
    tickets: MatrixTicket[];
    isBug: boolean;
    priority: string;
    priorityLabel: string;
  } | null>(null);
  const [selectedSprintTicket, setSelectedSprintTicket] = useState<SprintTicket | null>(null);
  const [selectedTicketCtx, setSelectedTicketCtx] = useState<{ projectId: string; sprintId: string; projectSlug: string } | null>(null);

  useEffect(() => {
    if (!expandModalData) return;
    const fn = () => setExpandModalData(null);
    escStack.push(fn);
    return () => escStack.pop(fn);
  }, [expandModalData]);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    Promise.all([
      supabase!.from("sprint_tickets").select("id, wbs, title, status, priority, due_date, sprint_id, assignee, category_id"),
      supabase!.from("sprints").select("id, project_id, name"),
      supabase!.from("projects").select("id, slug, name, status, client, members"),
      supabase!.from("ticket_categories").select("id, name"),
    ]).then(([{ data: tData }, { data: sData }, { data: pData }, { data: cData }]) => {
      if (tData) {
        const sprints = sData ?? [];
        const projectsData = pData ?? [];
        const sprintToProject = new Map((sprints as { id: string; project_id: string; name?: string }[]).map(s => [s.id, s.project_id]));
        const sprintNameMap = new Map((sprints as { id: string; name?: string }[]).map(s => [s.id, s.name ?? '']));

        const projectSlugMap = new Map((projectsData as { id: string; slug?: string }[]).map(p => [p.id, p.slug || p.id]));
        const projectNameById = new Map((projectsData as { id: string; name: string }[]).map(p => [p.id, p.name]));
        const categoryNameMap = new Map(((cData ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]));
        
        setTickets(tData.map((t: { id: string; wbs?: string; title: string; status: string; priority: string; due_date?: string; sprint_id?: string; assignee?: string; category_id?: string }) => {
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
      }
      if (pData) {
        const sprints = sData ?? [];
        const ticketsData = tData ?? [];
        const mapped = pData.map((p: { id: string; slug?: string; name: string; status: string; client: string; members?: string[] }) => {
          const sprintIds = sprints
            .filter((s: { id: string; project_id: string }) => s.project_id === p.id)
            .map((s: { id: string }) => s.id);
          const projectTickets = ticketsData.filter((t: { sprint_id: string }) => sprintIds.includes(t.sprint_id));
          return {
            id: p.slug || p.id,
            name: p.name,
            status: p.status as ProjectStatus,
            client: p.client,
            members: (p as any).members ?? [],
            done: projectTickets.filter((t: { status: string }) => t.status === "done" || t.status === "closed").length,
            inProgress: projectTickets.filter((t: { status: string }) => ["in-progress","in-review","review-done","stg-test","uat"].includes(t.status)).length,
            todo: projectTickets.filter((t: { status: string }) => t.status === "todo").length,
          };
        });
        setProjects(mapped);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const doneCount = tickets.filter(t => t.status === "done" || t.status === "closed").length;
  const inProgressCount = tickets.filter(t => ["in-progress", "in-review", "review-done", "stg-test", "uat"].includes(t.status)).length;
  const todoCount = tickets.filter(t => t.status === "todo").length;
  const completionRate = tickets.length > 0 ? Math.round((doneCount / tickets.length) * 100) : 0;
  const activeProjects = projects.filter(p => p.status === "in-progress").length;

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

  useEffect(() => {
    if (assignedProjects.length > 0 && !selectedScatterProject) {
      setSelectedScatterProject(assignedProjects[0].name);
    }
  }, [assignedProjects, selectedScatterProject]);

  const chartData = assignedProjects.map(p => ({
    name: p.name,
    完了: p.done, 進行中: p.inProgress, 未着手: p.todo,
  }));

  const lineStatusCategories = [
    { key: '未着手', statuses: ['todo'] },
    { key: '進行中', statuses: ['in-progress'] },
    { key: 'レビュー中', statuses: ['in-review'] },
    { key: 'レビュー完了', statuses: ['review-done'] },
    { key: 'STG完了', statuses: ['stg-test'] },
    { key: 'UAT完了', statuses: ['uat'] },
    { key: 'クローズ', statuses: ['done', 'closed'] },
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

  const assignedProjectNames = assignedProjects.map(p => p.name);
  const assignedTickets = tickets.filter(t => t.project && assignedProjectNames.includes(t.project));

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
      .filter(t => ['done', 'closed'].includes(t.status) && t.dueDate)
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

  const isWeeklyCloseAllZero = (() => {
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

  const activeTickets = tickets.filter(t => t.status !== "done" && t.status !== "closed").slice(0, 5);

  const overdueCountValue = tickets.filter(t => {
    if (!t.dueDate || t.status === "done" || t.status === "closed") return false;
    return t.dueDate < new Date().toISOString().split("T")[0];
  }).length;

  const statTiles = [
    { value: activeProjects, label: "進行中プロジェクト", icon: FolderKanban, accent: "#059669", accentBg: "#ECFDF5", trend: `全${projects.length}件`, up: true },
    { value: inProgressCount, label: "進行中チケット", icon: Zap, accent: "#D97706", accentBg: "#FFFBEB", trend: overdueCountValue > 0 ? `期限超過 ${overdueCountValue}件` : "遅延なし", up: overdueCountValue === 0 },
    { value: todoCount, label: "未着手チケット", icon: Clock, accent: "#0284C7", accentBg: "#F0F9FF", trend: `全${tickets.length}件`, up: true },
    { value: `${completionRate}%`, label: "チーム完了率", icon: TrendingUp, accent: "#059669", accentBg: "#ECFDF5", trend: `完了 ${doneCount}件`, up: true },
  ];

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

  const getFormattedMatrixTickets = (isBugTarget: boolean, priorityTarget: string) => {
    if (!selectedScatterProject || !tickets || tickets.length === 0) return [];
    
    const projectAllTickets = tickets.filter(t => t.project === selectedScatterProject);
    
    return projectAllTickets.map(ticket => {
      const isBug = ticket.title.toLowerCase().includes('バグ') || ticket.title.toLowerCase().includes('bug') || ticket.title.toLowerCase().includes('不具合');
      return {
        ...ticket,
        isBug
      };
    }).filter(t => t.isBug === isBugTarget && t.priority === priorityTarget);
  };

  const cancelHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const startHideTimer = (delay = 200) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHoveredExtraCellKey(null), delay);
  };

  const renderMatrixCell = (isBug: boolean, priority: string, hasLeftBorder: boolean) => {
    const targetTickets = getFormattedMatrixTickets(isBug, priority);
    const displayTickets = targetTickets.slice(0, 6);
    const hiddenTickets = targetTickets.slice(6);
    const cellKey = `${isBug ? "bug" : "nobug"}_${priority}`;
    const hasAny = targetTickets.length > 0;

    return (
      <div style={{
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        borderLeft: hasLeftBorder ? "1.5px solid #E6E2D9" : "none",
        background: "#FFFFFF"
      }}>
        <div style={{
          position: "absolute",
          top: 8,
          right: 10,
          fontSize: 11,
          color: hasAny ? "#374151" : "#C9C4BB",
          fontWeight: 700,
          fontFamily: "var(--font-mono)",
          background: hasAny ? "#F3F4F6" : "transparent",
          padding: "1px 7px",
          borderRadius: 20
        }}>
          {targetTickets.length} 件
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4, paddingRight: 42 }}>
          {displayTickets.map(ticket => (
            <div
              key={ticket.id}
              onClick={(e) => handleTicketClick(ticket, e)}
              style={{
                padding: "3px 10px",
                border: "1.5px solid #8B5CF6",
                borderRadius: 20,
                background: "#F3F0FF",
                color: "#6D28D9",
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: "nowrap",
                cursor: "pointer",
                transition: "all 0.15s ease",
                letterSpacing: "0.01em"
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "#EDE9FE";
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(109,40,217,0.18)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "#F3F0FF";
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
              }}
              title={`クリックして詳細へ: ${ticket.title}`}
            >
              {ticket.id}
            </div>
          ))}

          {hiddenTickets.length > 0 && (
            <div
              style={{ position: "relative", display: "inline-block", alignSelf: "center" }}
              onMouseEnter={() => { cancelHideTimer(); setHoveredExtraCellKey(cellKey); }}
              onMouseLeave={() => startHideTimer()}
            >
              <div style={{
                fontSize: 11,
                color: "#6B7280",
                fontWeight: 600,
                cursor: "pointer",
                background: "#F3F4F6",
                padding: "3px 10px",
                borderRadius: 20,
                border: "1.5px solid #E5E7EB"
              }}>
                +{hiddenTickets.length}
              </div>

              {hoveredExtraCellKey === cellKey && (
                <div
                  data-popup-id={cellKey}
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    // 🛠️ バグ欄（左側の列）なら左端をボタンに揃え、バグ以外（右側の列）なら真ん中揃えにする
                    ...(isBug 
                      ? { left: 0, transform: "none" } 
                      : { left: "50%", transform: "translateX(-50%)" }
                    ),
                    background: "#ffffff",
                    border: "1px solid #E6E2D9",
                    borderRadius: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                    padding: "10px 12px",
                    zIndex: 9999,
                    minWidth: 260,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6
                  }}
                  onMouseEnter={() => { cancelHideTimer(); setHoveredExtraCellKey(cellKey); }}
                  onMouseLeave={() => startHideTimer()}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #F3F4F6", paddingBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600 }}>残り {hiddenTickets.length} 件</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const allTickets = getFormattedMatrixTickets(isBug, priority);
                        const priorityLabel = priority === 'high' ? '優先度：高' : priority === 'medium' ? '優先度：中' : '優先度：低';
                        setExpandModalData({ tickets: allTickets, isBug, priority, priorityLabel });
                        setHoveredExtraCellKey(null);
                        cancelHideTimer();
                      }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 22, height: 22, border: "1px solid #E6E2D9", borderRadius: 4,
                        background: "#FFFFFF", cursor: "pointer", color: "#9CA3AF", padding: 0,
                        transition: "all 0.15s ease"
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#6D28D9"; (e.currentTarget as HTMLElement).style.borderColor = "#8B5CF6"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#9CA3AF"; (e.currentTarget as HTMLElement).style.borderColor = "#E6E2D9"; }}
                      title="一覧をモーダルで表示"
                    >
                      <Maximize2 style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                  <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                    {hiddenTickets.map(t => (
                      <div
                        key={t.id}
                        onClick={(e) => handleTicketClick(t, e)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "5px 6px",
                          borderRadius: 6,
                          cursor: "pointer",
                          background: "transparent",
                          transition: "background 0.12s ease"
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "#F5F3FF"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#6D28D9",
                          border: "1.5px solid #8B5CF6",
                          borderRadius: 10,
                          padding: "1px 6px",
                          background: "#F3F0FF",
                          whiteSpace: "nowrap"
                        }}>
                          {t.id}
                        </span>
                        <span style={{ fontSize: 11, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={t.title}>
                          {t.title}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: "32px 28px" }}>
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
        <div style={{ background: "#FFFFFF", borderRadius: 14, padding: "20px 24px", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)" }}>
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
                  { value: 'line' as ChartType, label: '折れ線' },
                  { value: 'scatter' as ChartType, label: 'マトリックス図' }
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
                  <div style={{ minWidth: 160 }}>
                    <CustomSelect
                      value={lineChartMode}
                      options={[
                        { value: 'project-progress', label: 'プロジェクト進捗' },
                        { value: 'weekly-close', label: '週次クローズ数' },
                      ]}
                      onChange={v => setLineChartMode(v as LineChartMode)}
                    />
                  </div>
                  {lineChartMode === 'weekly-close' && (
                    <div style={{ minWidth: 80 }}>
                      <CustomSelect
                        value={String(selectedMonth)}
                        options={[1,2,3,4,5,6,7,8,9,10,11,12].map(m => ({ value: String(m), label: `${m}月` }))}
                        onChange={v => setSelectedMonth(Number(v))}
                      />
                    </div>
                  )}
                </div>
              )}
              {chartType === 'scatter' && (
                <div style={{ minWidth: 160 }}>
                  <CustomSelect
                    value={selectedScatterProject}
                    options={assignedProjects.map(p => ({ value: p.name, label: p.name }))}
                    onChange={v => setSelectedScatterProject(v)}
                  />
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
            </div>
          </div>

          <div style={{ height: chartType === 'scatter' ? 'auto' : 320 }}>
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
              (lineChartMode === 'project-progress' ? isProjectProgressAllZero : isWeeklyCloseAllZero) ? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 13, color: "#C9C4BB" }}>実績データがありません</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lineChartMode === 'project-progress' ? projectProgressLineData : filteredWeeklyCloseData} margin={{ left: 40, right: 80, top: 20, bottom: 10 }}>
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
                      return (
                        <Line
                          key={project.id}
                          type="monotone"
                          dataKey={project.name}
                          stroke={colors[index % colors.length]}
                          strokeWidth={2}
                          dot={{ fill: colors[index % colors.length], r: 4 }}
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              )
            )}
            
            {chartType === 'scatter' && (
              <div style={{ minHeight: 320, height: "auto" }}>
                <div style={{ border: "1.5px solid #E6E2D9", borderRadius: 12, display: "flex", flexDirection: "column", height: "auto", boxSizing: "border-box" }}>
                  {/* ヘッダー行 */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "130px 1fr 1fr",
                    background: "#F9F8F6",
                    borderBottom: "1.5px solid #E6E2D9",
                    flexShrink: 0
                  }}>
                    <div style={{ padding: "10px 14px", borderTopLeftRadius: 11 }}></div>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 7, justifyContent: "center",
                      padding: "10px 16px",
                      borderLeft: "1.5px solid #E6E2D9"
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#F87171", display: "inline-block", flexShrink: 0 }}></span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", letterSpacing: "-0.01em" }}>バグ</span>
                    </div>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 7, justifyContent: "center",
                      padding: "10px 16px",
                      borderLeft: "1.5px solid #E6E2D9",
                      borderTopRightRadius: 11
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#34D399", display: "inline-block", flexShrink: 0 }}></span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", letterSpacing: "-0.01em" }}>バグ以外</span>
                    </div>
                  </div>

                  {/* 優先度行 */}
                  {[
                    { label: "優先度：高", priority: "high", dotColor: "#EF4444" },
                    { label: "優先度：中", priority: "medium", dotColor: "#F59E0B" },
                    { label: "優先度：低", priority: "low", dotColor: "#3B82F6" },
                  ].map(({ label, priority, dotColor }, idx, arr) => (
                    <div key={priority} style={{
                      flex: "1 0 auto",
                      minHeight: 80,
                      display: "grid",
                      gridTemplateColumns: "130px 1fr 1fr",
                      borderBottom: idx < arr.length - 1 ? "1.5px solid #E6E2D9" : "none"
                    }}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "10px 12px",
                        borderRight: "1.5px solid #E6E2D9",
                        background: "#F9F8F6",
                        borderBottomLeftRadius: idx === arr.length - 1 ? 11 : 0
                      }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }}></div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", letterSpacing: "-0.01em" }}>{label}</span>
                      </div>
                      {renderMatrixCell(true, priority, false)}
                      {renderMatrixCell(false, priority, true)}
                    </div>
                  ))}
                </div>
              </div>
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
          {projects.map((p, i) => {
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
                style={{ display: "grid", gridTemplateColumns: "1fr 160px 60px 90px", alignItems: "center", gap: 20, padding: "13px 24px", background: i % 2 === 1 ? "rgba(26,23,20,0.015)" : "transparent", cursor: "pointer", transition: "background 0.12s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FFF7F3"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 === 1 ? "rgba(26,23,20,0.015)" : "transparent"; }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: ss.color, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.name}</p>
                    <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.client}</p>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 6, background: "#EDE9E0", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress}%`, background: "#059669", borderRadius: 99 }} />
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#3D3732", fontFamily: "var(--font-mono)", textAlign: "right" as const }}>{progress}%</span>
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

      {/* 拡大モーダル */}
      {expandModalData && (
        <div
          onClick={() => setExpandModalData(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 150, padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: "#FFFFFF", borderRadius: 16, width: "min(1200px, 95vw)", maxHeight: "82vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.22)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #F3F4F6", flexShrink: 0 }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>
                  {expandModalData.priorityLabel} / {expandModalData.isBug ? 'バグ' : 'バグ以外'}
                </h2>
                <p style={{ fontSize: 11, color: "#B0A9A4", marginTop: 2 }}>{expandModalData.tickets.length} 件のチケット</p>
              </div>
              <button
                onClick={() => setExpandModalData(null)}
                style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E6E2D9", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7280" }}
              >
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#F9F8F6", position: "sticky", top: 0, zIndex: 1 }}>
                    {['スプリント', 'チケット番号', 'チケット名', '分類', 'ステータス', '優先度', '担当者'].map(h => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, color: "#B0A9A4", fontWeight: 600, letterSpacing: "0.05em", borderBottom: "1px solid #E6E2D9", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const sorted = [...expandModalData.tickets].sort((a, b) => (a.sprint || '').localeCompare(b.sprint || '', 'ja'));
                    const groups: { sprintName: string; tickets: MatrixTicket[] }[] = [];
                    for (const t of sorted) {
                      const sn = t.sprint || '—';
                      const last = groups[groups.length - 1];
                      if (last && last.sprintName === sn) { last.tickets.push(t); } else { groups.push({ sprintName: sn, tickets: [t] }); }
                    }
                    return groups.flatMap((g) =>
                      g.tickets.map((t, ti) => {
                        const sm = STATUS_LABELS[t.status] ?? { label: t.status, bg: '#F4F5F6', color: '#6B7280' };
                        const pm = PRIORITY_META_MODAL[t.priority] ?? { label: t.priority, color: '#6B7280' };
                        return (
                          <tr
                            key={t.id}
                            onClick={(e) => { handleTicketClick(t, e); }}
                            style={{ background: "transparent", cursor: "pointer", transition: "background 0.1s" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FFF7F3"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                          >
                            {ti === 0 && (
                              <td rowSpan={g.tickets.length} style={{ padding: "10px 16px", fontSize: 12, color: "#9CA3AF", borderBottom: "1px solid #F3F4F6", whiteSpace: "nowrap", verticalAlign: "top" }}>{g.sprintName}</td>
                            )}
                            <td style={{ padding: "10px 16px", borderBottom: "1px solid #F3F4F6", whiteSpace: "nowrap" }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#6D28D9", border: "1.5px solid #8B5CF6", borderRadius: 10, padding: "2px 8px", background: "#F3F0FF" }}>{t.id}</span>
                            </td>
                            <td style={{ padding: "10px 16px", fontSize: 13, color: "#1A1714", borderBottom: "1px solid #F3F4F6", maxWidth: 280 }}>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{t.title}</span>
                            </td>
                            <td style={{ padding: "10px 16px", borderBottom: "1px solid #F3F4F6", whiteSpace: "nowrap" }}>
                              <span style={{ fontSize: 11, color: "#6B7280" }}>
                                {t.category || '—'}
                              </span>
                            </td>
                            <td style={{ padding: "10px 16px", borderBottom: "1px solid #F3F4F6", whiteSpace: "nowrap" }}>
                              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 600, background: sm.bg, color: sm.color }}>{sm.label}</span>
                            </td>
                            <td style={{ padding: "10px 16px", borderBottom: "1px solid #F3F4F6", whiteSpace: "nowrap" }}>
                              <span style={{ fontSize: 12, color: pm.color, fontWeight: 700 }}>● {pm.label}</span>
                            </td>
                            <td style={{ padding: "10px 16px", fontSize: 12, color: "#6B7280", borderBottom: "1px solid #F3F4F6" }}>{t.assignee || '—'}</td>
                          </tr>
                        );
                      })
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
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
        />
      )}
    </div>
  );
}