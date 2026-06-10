import { useEffect, useState, type ElementType } from "react";
import { FolderKanban, TrendingUp, Zap, Clock, Plus, ChevronRight } from "lucide-react";
import { NewTicketDialog } from "@/app/components/tickets/NewTicketDialog";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { TICKETS, PROJECTS } from "@/app/data/mock";
import { mapProject } from "@/app/lib/mappers";
import { calcProgress, formatDate, getPriorityMeta } from "@/app/lib/helpers";
import type { ProjectStatus } from "@/app/types";

type ChartType = 'horizontal' | 'vertical' | 'line' | 'scatter';
type LineChartMode = 'project-progress' | 'weekly-close';

type DashTicket = {
  id: string; // 内部の一時的なID
  title: string;
  project?: string;
  projectId?: string; // PROJ5e88 などの固有ID
  status: string;
  priority: string;
  assignee?: string;
  dueDate?: string;
};

type DashProject = {
  id: string;
  name: string;
  status: ProjectStatus;
  client: string;
  members?: string[];
  done: number;
  inProgress: number;
  todo: number;
};

export function Dashboard() {
  const { userName } = useAuth();
  const firstName = userName.split(/[\s ]/)[0];

  const [tickets, setTickets] = useState<DashTicket[]>(
    isSupabaseEnabled ? [] : TICKETS.map(t => {
      const matchingProj = PROJECTS.find(p => p.name === t.project);
      return { 
        id: t.id, 
        title: t.title, 
        project: t.project, 
        projectId: matchingProj ? matchingProj.id : (t.project === "DevTicket" ? "DEVTICKET" : "PROJ5e88"),
        status: t.status, 
        priority: t.priority, 
        assignee: t.assignee, 
        dueDate: t.dueDate 
      };
    })
  );
  const [projects, setProjects] = useState<DashProject[]>(
    isSupabaseEnabled ? [] : PROJECTS.map(p => ({ id: p.id, name: p.name, status: p.status, client: p.client, members: p.members ?? [], done: p.done, inProgress: p.inProgress, todo: p.todo }))
  );
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [chartType, setChartType] = useState<ChartType>('vertical');
  const [lineChartMode, setLineChartMode] = useState<LineChartMode>('project-progress');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);

  // 分布図用：自分がアサインされている特定のプロジェクトを選べるステート
  const [selectedScatterProject, setSelectedScatterProject] = useState<string>("");

  // ホバー時にどのセルのプラスUIを展開させるかを管理するインターフェース用ステート
  const [hoveredExtraCellKey, setHoveredExtraCellKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    Promise.all([
      supabase!.from("sprint_tickets").select("id, title, status, priority, due_date, sprint_id, assignee"),
      supabase!.from("sprints").select("id, project_id"),
      supabase!.from("projects").select("id, name, status, client, members"),
    ]).then(([{ data: tData }, { data: sData }, { data: pData }]) => {
      if (tData) {
        const sprints = sData ?? [];
        const projectsData = pData ?? [];
        const sprintToProject = new Map((sprints as { id: string; project_id: string }[]).map(s => [s.id, s.project_id]));
        const projectNameById = new Map((projectsData as { id: string; name: string }[]).map(p => [p.id, p.name]));
        
        setTickets(tData.map((t: { id: string; title: string; status: string; priority: string; due_date?: string; sprint_id?: string; assignee?: string }) => {
          const resolvedProjectId = sprintToProject.get(t.sprint_id ?? '');
          return {
            id: t.id, 
            title: t.title,
            status: t.status,
            priority: t.priority,
            dueDate: t.due_date,
            assignee: t.assignee,
            project: projectNameById.get(resolvedProjectId ?? '') ?? undefined,
            projectId: resolvedProjectId ?? undefined
          };
        }));
      }
      if (pData) {
        const sprints = sData ?? [];
        const ticketsData = tData ?? [];
        const mapped = pData.map((p: { id: string; name: string; status: string; client: string; members?: string[] }) => {
          const sprintIds = sprints
            .filter((s: { id: string; project_id: string }) => s.project_id === p.id)
            .map((s: { id: string }) => s.id);
          const projectTickets = ticketsData.filter((t: { sprint_id: string }) => sprintIds.includes(t.sprint_id));
          return {
            id: p.id,
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

  // 💡【位置固定】JSXレンダリングの前に完璧な順序で変数を定義してスコープエラーを完全に撲滅
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

  // 【正確な遷移処理】プロジェクト固有ID（PROJ5e88等）ベースのURLパス作成
  const handleTicketNavigation = (projId: string | undefined, projectName: string, ticketNo: string, event: React.MouseEvent) => {
    event.stopPropagation();
    let urlSegment = projId ? projId.trim() : projectName.replace(/\s+/g, '').toUpperCase();
    window.location.href = `/${urlSegment}/${ticketNo.toUpperCase()}`;
  };

  // 🛠️【チケットNo連動強化・上書きロジック】
  // 長い数値IDに影響されず、プロジェクト内の全チケットから常に一貫した「きれいな固有連番」を生成・内部IDへ完全同期
  const getFormattedMatrixTickets = (isBugTarget: boolean, priorityTarget: string) => {
    if (!selectedScatterProject || !tickets || tickets.length === 0) return [];
    
    // 現在選択中のプロジェクトに属するすべてのチケットを抽出してインデックス順を一定に固定
    const projectAllTickets = tickets.filter(t => t.project === selectedScatterProject);
    
    return projectAllTickets.map((ticket, index) => {
      const isBug = ticket.title.toLowerCase().includes('バグ') || ticket.title.toLowerCase().includes('bug') || ticket.title.toLowerCase().includes('不具合');
      
      // プロジェクト名からプレフィックス（TS1, BRU等）を確実に決定
      let prefix = "T";
      if (selectedScatterProject.toLowerCase().includes("ts") || selectedScatterProject.toLowerCase().includes("テスト")) {
        prefix = "TS1";
      } else if (selectedScatterProject.toUpperCase().includes("DEV")) {
        prefix = "BRU";
      }
      
      const cleanNo = `${prefix}-${String(index + 1).padStart(3, "0")}`;
      
      // ⚠️【超重要：生IDの完全書き換え処理】
      // ランダム数値が入っている ticket.id と formattedNo を両方とも cleanNo（例: TS1-001）で上書き。
      // これにより、クリック時もホバーリスト内でも、長い生IDが100%排除されて完全同期されます。
      return {
        ...ticket,
        id: cleanNo,
        isBug,
        formattedNo: cleanNo
      };
    }).filter(t => t.isBug === isBugTarget && t.priority === priorityTarget);
  };

  const renderMatrixCell = (isBug: boolean, priority: string, borderStyles: React.CSSProperties) => {
    const targetTickets = getFormattedMatrixTickets(isBug, priority);
    const displayTickets = targetTickets.slice(0, 3);
    const hiddenTickets = targetTickets.slice(3);
    const cellKey = `${isBug ? "bug" : "nobug"}_${priority}`;

    return (
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", minHeight: 110, ...borderStyles }}>
        <div style={{ position: "absolute", top: 12, right: 16, fontSize: 13, color: "#6B6458", fontWeight: 600 }}>
          {targetTickets.length} 件
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, paddingRight: 45 }}>
          {displayTickets.map(ticket => (
            <div 
              key={ticket.id} 
              onClick={(e) => handleTicketNavigation(ticket.projectId, selectedScatterProject, ticket.id, e)} // 完全にきれいな連番（ticket.id）をそのままURLへ引き渡す
              style={{ 
                padding: "4px 12px", 
                border: "1.5px solid #7c3aed", 
                borderRadius: "6px 2px 6px 2px",
                background: "#f5f3ff", 
                color: "#6d28d9", 
                fontSize: 12, 
                fontWeight: 700,
                whiteSpace: "nowrap",
                cursor: "pointer",
                transition: "transform 0.1s ease"
              }}
              onMouseEnter={e => e.currentTarget.style.transform = "scale(1.04)"}
              onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
              title={`クリックして詳細へ: ${ticket.title}`}
            >
              {ticket.id}
            </div>
          ))}

          {hiddenTickets.length > 0 && (
            <div 
              style={{ position: "relative", display: "inline-block", alignSelf: "center", paddingBottom: "10px" }}
              onMouseEnter={() => setHoveredExtraCellKey(cellKey)}
              onMouseLeave={(e) => {
                const toElement = e.relatedTarget as HTMLElement;
                if (toElement && toElement.closest && toElement.closest(`[data-popup-id="${cellKey}"]`)) {
                  return;
                }
                setHoveredExtraCellKey(null);
              }}
            >
              <div style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600, marginLeft: 2, cursor: "pointer", background: "#f3f4f6", padding: "2px 6px", borderRadius: 4 }}>
                +{hiddenTickets.length}
              </div>

              {hoveredExtraCellKey === cellKey && (
                <div 
                  data-popup-id={cellKey}
                  style={{
                    position: "absolute",
                    top: "80%",
                    left: 0,
                    marginTop: 4,
                    background: "#ffffff",
                    border: "1px solid #ccc5b9",
                    borderRadius: 12,
                    boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
                    padding: "12px 14px",
                    zIndex: 9999,
                    minWidth: 260,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6
                  }}
                  onMouseEnter={() => setHoveredExtraCellKey(cellKey)}
                  onMouseLeave={() => setHoveredExtraCellKey(null)}
                >
                  <div style={{ fontSize: 11, color: "#6b7280", borderBottom: "1px solid #f3f4f6", paddingBottom: 4, fontWeight: "bold" }}>
                    非表示のチケット一覧 ({hiddenTickets.length}件)
                  </div>
                  <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                    {hiddenTickets.map(t => (
                      <div
                        key={t.id}
                        onClick={(e) => handleTicketNavigation(t.projectId, selectedScatterProject, t.id, e)} // ポップアップメニュー内の一覧クリックも完全な連番パスを生成
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "6px 8px",
                          borderRadius: 6,
                          cursor: "pointer",
                          background: "#fdfbfa",
                          transition: "background 0.15s ease"
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = "#f5f3ff";
                          if (e.currentTarget.firstElementChild) {
                            (e.currentTarget.firstElementChild as HTMLElement).style.borderColor = "#6d28d9";
                          }
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = "#fdfbfa";
                          if (e.currentTarget.firstElementChild) {
                            (e.currentTarget.firstElementChild as HTMLElement).style.borderColor = "#7c3aed";
                          }
                        }}
                      >
                        <span style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#6d28d9",
                          border: "1.5px solid #7c3aed",
                          borderRadius: 4,
                          padding: "1px 6px",
                          background: "#f5f3ff"
                        }}>
                          {t.id}
                        </span>
                        <span style={{ fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={t.title}>
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

      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ background: "#FFFFFF", borderRadius: 14, height: 112, boxShadow: "0 1px 2px rgba(0,0,0,0.04)", overflow: "hidden", display: "flex" }}>
              <div style={{ width: 4, background: "#F4F5F6", flexShrink: 0 }} />
              <div style={{ flex: 1, padding: 18 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: "#F4F5F6", marginBottom: 14 }} />
                <div style={{ width: "60%", height: 32, borderRadius: 6, background: "#F4F5F6" }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
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
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, marginBottom: 16 }}>
        <div style={{ background: "#FFFFFF", borderRadius: 14, padding: "20px 24px", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.01em" }}>プロジェクト進捗</h2>
              <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 3 }}>ステータス別チケット集計</p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { value: 'horizontal' as ChartType, label: '横棒' },
                  { value: 'vertical' as ChartType, label: '縦棒' },
                  { value: 'line' as ChartType, label: '折れ線' },
                  { value: 'scatter' as ChartType, label: '分布図' }
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <select
                    value={lineChartMode}
                    onChange={e => setLineChartMode(e.target.value as LineChartMode)}
                    style={{
                      padding: '1px 28px 1px 8px',
                      fontSize: 13,
                      color: '#1A1714',
                      borderRadius: 8,
                      border: '1px solid #E6E2D9',
                      background: '#fff url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 10 6\'%3E%3Cpath fill=\'%23747474\' d=\'M0 0l5 6 5-6z\'/%3E%3C/svg%3E") no-repeat right 8px center',
                      backgroundSize: '10px 6px',
                      width: 'auto',
                      minWidth: 120,
                      appearance: 'none',
                      lineHeight: '16px',
                      textAlign: 'center' as const,
                      textAlignLast: 'center' as const,
                    }}
                  >
                    <option value="project-progress">プロジェクト進捗</option>
                    <option value="weekly-close">週次クローズ数</option>
                  </select>
                  {lineChartMode === 'weekly-close' && (
                    <select
                      value={selectedMonth}
                      onChange={e => setSelectedMonth(parseInt(e.target.value))}
                      style={{
                        padding: '1px 24px 1px 8px',
                        fontSize: 11,
                        color: '#1A1714',
                        borderRadius: 8,
                        border: '1px solid #E6E2D9',
                        background: '#fff url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 10 6\'%3E%3Cpath fill=\'%23747474\' d=\'M0 0l5 6 5-6z\'/%3E%3C/svg%3E") no-repeat right 6px center',
                        backgroundSize: '8px 5px',
                        width: 'auto',
                        minWidth: 65,
                        appearance: 'none',
                        lineHeight: '16px',
                        textAlign: 'center' as const,
                        textAlignLast: 'center' as const,
                      }}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                        <option key={m} value={m}>{m}月</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {chartType === 'scatter' && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <select
                    value={selectedScatterProject}
                    onChange={e => setSelectedScatterProject(e.target.value)}
                    style={{
                      padding: '4px 28px 4px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#1A1714',
                      borderRadius: 8,
                      border: '1px solid #E6E2D9',
                      background: '#fff url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 10 6\'%3E%3Cpath fill=\'%23747474\' d=\'M0 0l5 6 5-6z\'/%3E%3C/svg%3E") no-repeat right 10px center',
                      backgroundSize: '10px 6px',
                      width: 'auto',
                      minWidth: 150,
                      appearance: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {assignedProjects.map(proj => (
                      <option key={proj.id} value={proj.name}>{proj.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {chartType !== 'scatter' && (
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

          {loading ? (
            <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "#C9C4BB", fontSize: 12 }}>読み込み中...</div>
          ) : (chartType !== 'scatter' && chartData.length === 0) ? (
            <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "#C9C4BB", fontSize: 12 }}>データがありません</div>
          ) : (
            <>
              {chartType === 'horizontal' && (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 18, top: 0, bottom: 0 }} barCategoryGap="18%" barSize={20}>
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#B0A9A4", fontFamily: "JetBrains Mono,monospace" }} tickMargin={6} padding={{ right: 18 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={renderProjectNameTick} axisLine={false} tickLine={false} width={180} />
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 10, fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}
                      labelStyle={{ color: "#1A1714", fontWeight: 700 }} itemStyle={{ color: "#6B6458" }} cursor={{ fill: "rgba(26,23,20,0.03)" }} />
                    <Bar dataKey="完了" stackId="a" fill="#059669" />
                    <Bar dataKey="進行中" stackId="a" fill="#D97706" />
                    <Bar dataKey="未着手" stackId="a" fill="#E6E2D9" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
              {chartType === 'vertical' && (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={{ left: 40, right: 18, top: 20, bottom: 30 }} barCategoryGap="18%" barSize={40}>
                    <XAxis dataKey="name" height={40} tick={{ fontSize: 14, fontFamily: "Inter,ui-sans-serif,system-ui,sans-serif", fontWeight: 500, fill: "#6B6458" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#B0A9A4" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 10, fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}
                      labelStyle={{ color: "#1A1714", fontWeight: 700 }} itemStyle={{ color: "#6B6458" }} cursor={{ fill: "rgba(26,23,20,0.03)" }} />
                    <Bar dataKey="完了" fill="#059669" />
                    <Bar dataKey="進行中" fill="#D97706" />
                    <Bar dataKey="未着手" fill="#E6E2D9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
              {chartType === 'line' && (
                <ResponsiveContainer width="100%" height={340}>
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
              )}
              
              {chartType === 'scatter' && (
                <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 1fr", width: "100%", padding: "10px 0 20px" }}>
                  <div></div>
                  <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, color: "#1A1714", paddingBottom: 16 }}>バグ</div>
                  <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, color: "#1A1714", paddingBottom: 16 }}>バグ以外</div>

                  {/* 1行目：優先度高 */}
                  <div style={{ display: "flex", alignItems: "center", fontSize: 15, fontWeight: 600, color: "#1A1714", paddingLeft: 10 }}>優先度：高</div>
                  {renderMatrixCell(true, "high", { borderTop: "1px solid #000", borderLeft: "1px solid #000", borderRight: "1px solid #ccc" })}
                  {renderMatrixCell(false, "high", { borderTop: "1px solid #000", borderRight: "1px solid #000" })}

                  {/* 2行目：優先度中 */}
                  <div style={{ display: "flex", alignItems: "center", fontSize: 15, fontWeight: 600, color: "#1A1714", paddingLeft: 10 }}>優先度：中</div>
                  {renderMatrixCell(true, "medium", { borderTop: "1px solid #000", borderLeft: "1px solid #000", borderRight: "1px solid #ccc" })}
                  {renderMatrixCell(false, "medium", { borderTop: "1px solid #000", borderRight: "1px solid #000" })}

                  {/* 3行目：優先度低 */}
                  <div style={{ display: "flex", alignItems: "center", fontSize: 15, fontWeight: 600, color: "#1A1714", paddingLeft: 10 }}>優先度：低</div>
                  {renderMatrixCell(true, "low", { borderTop: "1px solid #000", borderBottom: "1px solid #000", borderLeft: "1px solid #000", borderRight: "1px solid #ccc" })}
                  {renderMatrixCell(false, "low", { borderTop: "1px solid #000", borderBottom: "1px solid #000", borderRight: "1px solid #000" })}
                </div>
              )}
            </>
          )}
        </div>

        {/* アクティブチケットパネル */}
        <div style={{ background: "#FFFFFF", borderRadius: 14, padding: "20px 20px", display: "flex", flexDirection: "column", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>アクティブチケット</h2>
            <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#B0A9A4", background: "#F4F5F6", padding: "2px 8px", borderRadius: 20 }}>{inProgressCount + todoCount}件</span>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
            {loading ? (
              [0,1,2,3,4].map(i => (
                <div key={i} style={{ padding: "9px 8px", display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#F4F5F6", flexShrink: 0 }} />
                  <div style={{ flex: 1, height: 32, borderRadius: 6, background: "#F4F5F6" }} />
                </div>
              ))
            ) : activeTickets.length === 0 ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#C9C4BB", fontSize: 12 }}>アクティブチケットなし</div>
            ) : activeTickets.map((ticket, index) => {
              const pr = getPriorityMeta(ticket.priority as "high" | "medium" | "low");
              const isInProgress = ticket.status !== "todo";
              const projName = ticket.project || "DEVTICKET";
              
              // 💡 アクティブチケット側もマトリクス側と同じプレフィックス連番ルールを「再計算」して同期
              let prefix = "T";
              if (projName.toLowerCase().includes("ts") || projName.toLowerCase().includes("テスト")) {
                prefix = "TS1";
              } else if (projName.toUpperCase().includes("DEV")) {
                prefix = "BRU";
              }
              const activeTicketNo = `${prefix}-${String(index + 1).padStart(3, "0")}`;
              
              return (
                <div style={{ display: "flex", gap: 10, padding: "9px 8px", borderRadius: 8, cursor: "pointer" }}
                  key={ticket.id}
                  onClick={(e) => handleTicketNavigation(ticket.projectId, projName, activeTicketNo, e)} // 🛠️右側パネルも完全なIDリンクへマージ
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
          {loading ? (
            [0,1,2].map(i => (
              <div key={i} style={{ padding: "13px 24px", display: "grid", gridTemplateColumns: "1fr 160px 60px 90px", gap: 20, alignItems: "center" }}>
                <div style={{ height: 36, borderRadius: 6, background: "#F4F5F6" }} />
                <div style={{ height: 6, borderRadius: 99, background: "#F4F5F6" }} />
                <div style={{ height: 20, borderRadius: 6, background: "#F4F5F6" }} />
                <div style={{ height: 24, borderRadius: 20, background: "#F4F5F6" }} />
              </div>
            ))
          ) : projects.map((p, i) => {
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
    </div>
  );
}