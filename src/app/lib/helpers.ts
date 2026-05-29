import type { ProjectStatus, TicketStatus, Priority, Role, Sprint, SprintStatus, SprintTicket } from "@/app/types";

// Compute sprint status dynamically from ticket states + deadline
export function computeSprintStatus(sprint: Sprint): SprintStatus {
  const today = new Date().toISOString().split("T")[0];
  const { tickets, endDate } = sprint;
  const active: TicketStatus[] = ["in-progress", "in-review", "review-done", "stg-test", "uat", "done"];
  if (tickets.length > 0 && tickets.every((t: SprintTicket) => t.status === "done" || t.status === "closed")) return "completed";
  if (endDate && endDate < today) return "delayed";
  if (tickets.some((t: SprintTicket) => active.includes(t.status))) return "active";
  return "planning";
}

export function getStatusMeta(status: ProjectStatus | TicketStatus) {
  const map: Record<string, { label: string; cls: string; dot: string; bar: string }> = {
    planning:      { label: "計画中",      cls: "bg-slate-100 text-slate-600",    dot: "bg-slate-400",  bar: "bg-slate-300" },
    "in-progress": { label: "進行中",      cls: "bg-orange-50 text-orange-700",   dot: "bg-orange-400", bar: "bg-orange-400" },
    completed:     { label: "完了",        cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500",bar: "bg-emerald-500" },
    "on-hold":     { label: "保留中",      cls: "bg-amber-50 text-amber-700",     dot: "bg-amber-400",  bar: "bg-amber-400" },
    todo:          { label: "未着手",      cls: "bg-stone-100 text-stone-500",    dot: "bg-stone-400",  bar: "bg-stone-300" },
    done:          { label: "完了",        cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500",bar: "bg-emerald-500" },
    "in-review":   { label: "レビュー中",  cls: "bg-violet-50 text-violet-700",   dot: "bg-violet-500", bar: "bg-violet-500" },
    "review-done": { label: "レビュー完了",cls: "bg-sky-50 text-sky-700",         dot: "bg-sky-500",    bar: "bg-sky-500" },
    "stg-test":    { label: "STG完了",     cls: "bg-teal-50 text-teal-700",       dot: "bg-teal-500",   bar: "bg-teal-500" },
    uat:           { label: "UAT完了",     cls: "bg-indigo-50 text-indigo-700",   dot: "bg-indigo-500", bar: "bg-indigo-500" },
    closed:        { label: "クローズ",    cls: "bg-stone-200 text-stone-500",    dot: "bg-stone-500",  bar: "bg-stone-400" },
  };
  return map[status] ?? { label: status, cls: "bg-stone-100 text-stone-500", dot: "bg-stone-400", bar: "bg-stone-300" };
}

export const TICKET_STATUSES: { value: import("@/app/types").TicketStatus; label: string; color: string; bg: string }[] = [
  { value: "todo",        label: "未着手",       color: "#9E9690", bg: "#F4F5F6" },
  { value: "in-progress", label: "進行中",       color: "#D97706", bg: "#FFF7ED" },
  { value: "in-review",   label: "レビュー中",   color: "#7C3AED", bg: "#F5F3FF" },
  { value: "review-done", label: "レビュー完了", color: "#0284C7", bg: "#F0F9FF" },
  { value: "stg-test",    label: "STG完了",      color: "#0D9488", bg: "#F0FDFA" },
  { value: "uat",         label: "UAT完了",      color: "#4F46E5", bg: "#EEF2FF" },
  { value: "done",        label: "完了",         color: "#059669", bg: "#ECFDF5" },
  { value: "closed",      label: "クローズ",     color: "#6B7280", bg: "#F3F4F6" },
];

export function getPriorityMeta(p: Priority) {
  return {
    high:   { label: "高", cls: "bg-red-50 text-red-600",    dot: "bg-red-500" },
    medium: { label: "中", cls: "bg-amber-50 text-amber-700",dot: "bg-amber-400" },
    low:    { label: "低", cls: "bg-sky-50 text-sky-600",    dot: "bg-sky-400" },
  }[p];
}

export function getRoleMeta(role: Role) {
  const map: Record<string, { label: string; cls: string; gradient: string }> = {
    admin:             { label: "管理者",    cls: "bg-rose-50 text-rose-700",      gradient: "from-rose-500 to-rose-600" },
    "project-manager": { label: "PM",        cls: "bg-orange-50 text-orange-700",   gradient: "from-orange-500 to-orange-600" },
    developer:         { label: "開発者",    cls: "bg-sky-50 text-sky-700",         gradient: "from-sky-500 to-sky-600" },
    designer:          { label: "デザイナー", cls: "bg-violet-50 text-violet-700",   gradient: "from-violet-500 to-violet-600" },
  };
  return map[role] ?? { label: role, cls: "bg-gray-50 text-gray-700", gradient: "from-gray-400 to-gray-500" };
}

export function getAvatarColor(name: string) {
  const colors = ["#059669","#D97706","#059669","#0284C7","#7C3AED","#DB2777"];
  return colors[name.charCodeAt(0) % colors.length];
}

export function calcProgress(done: number, ip: number, todo: number) {
  const t = done + ip + todo; return t === 0 ? 0 : Math.round((done / t) * 100);
}

export function getInitials(n: string) { return (n || "?").replace(/\s/g, "").slice(0, 2); }
export function formatDate(d: string | null | undefined) { if (!d) return "—"; return d.slice(5).replace("-", "/"); }
export function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export function getSprintStatusMeta(status: SprintStatus) {
  return ({
    planning:  { label:"計画中", bg:"#F4F5F6", color:"#6B6458", dot:"#B0A9A4", barColor:"#B0A9A4" },
    active:    { label:"進行中", bg:"#ECFDF5", color:"#059669", dot:"#059669", barColor:"#059669" },
    completed: { label:"完了",   bg:"#F0F9FF", color:"#0284C7", dot:"#0284C7", barColor:"#0284C7" },
    delayed:   { label:"遅延",   bg:"#FEF2F2", color:"#DC2626", dot:"#DC2626", barColor:"#DC2626" },
  } as Record<string, { label:string; bg:string; color:string; dot:string; barColor:string }>)[status]
    ?? { label: status, bg: "#F4F5F6", color: "#6B6458", dot: "#B0A9A4", barColor: "#B0A9A4" };
}

export function sprintProgress(s: Sprint) {
  if (!s.tickets.length) return 0;
  return Math.round(s.tickets.filter(t => t.status === "done").length / s.tickets.length * 100);
}

export const inputCls = "w-full bg-[#F7F8F9] border border-stone-200/70 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 focus:bg-white transition-all";
export const labelCls = "block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1.5";
