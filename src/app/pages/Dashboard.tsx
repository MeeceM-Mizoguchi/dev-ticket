import { type ElementType } from "react";
import { FolderKanban, TrendingUp, Zap, Clock, Plus, ChevronRight, CheckCircle2, Circle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useAuth } from "@/app/contexts/AuthContext";
import { TICKETS, PROJECTS } from "@/app/data/mock";
import { calcProgress, formatDate, getPriorityMeta } from "@/app/lib/helpers";
import type { ProjectStatus } from "@/app/types";

export function Dashboard() {
  const { userName } = useAuth();
  const firstName = userName.split(/[\s　]/)[0];
  const doneCount = TICKETS.filter(t => t.status === "done").length;
  const inProgressCount = TICKETS.filter(t => t.status === "in-progress").length;
  const todoCount = TICKETS.filter(t => t.status === "todo").length;
  const completionRate = Math.round((doneCount / TICKETS.length) * 100);
  const activeProjects = PROJECTS.filter(p => p.status === "in-progress").length;

  const chartData = PROJECTS.map(p => ({
    name: p.name.length > 8 ? p.name.slice(0, 8) + "…" : p.name,
    完了: p.done, 進行中: p.inProgress, 未着手: p.todo,
  }));

  const statTiles: { value: number | string; label: string; icon: ElementType; accent: string; accentBg: string; trend: string; up: boolean }[] = [
    { value: activeProjects, label: "進行中プロジェクト", icon: FolderKanban, accent: "#059669", accentBg: "#ECFDF5", trend: "今月 +1件", up: true },
    { value: inProgressCount, label: "進行中チケット", icon: Zap, accent: "#D97706", accentBg: "#FFFBEB", trend: "期限近い 3件", up: false },
    { value: todoCount, label: "未着手チケット", icon: Clock, accent: "#0284C7", accentBg: "#F0F9FF", trend: "新規 2件", up: true },
    { value: `${completionRate}%`, label: "チーム完了率", icon: TrendingUp, accent: "#059669", accentBg: "#ECFDF5", trend: "先月比 +5%", up: true },
  ];

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
        <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 12, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 10px rgba(5,150,105,0.30)", letterSpacing: "0.01em" }}
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
              <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.01em" }}>プロジェクト進捗</h2>
              <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 3 }}>ステータス別チケット集計</p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {[{ c: "#059669", l: "完了" }, { c: "#D97706", l: "進行中" }, { c: "#E6E2D9", l: "未着手" }].map(({ c, l }) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
                  <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 500 }}>{l}</span>
                </div>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 9, fill: "#B0A9A4", fontFamily: "JetBrains Mono,monospace" }} axisLine={false} tickLine={false} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "#6B6458" }} axisLine={false} tickLine={false} width={80} />
              <Tooltip contentStyle={{ background: "#fff", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 10, fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}
                labelStyle={{ color: "#1A1714", fontWeight: 700 }} itemStyle={{ color: "#6B6458" }} cursor={{ fill: "rgba(26,23,20,0.03)" }} />
              <Bar dataKey="完了" stackId="a" fill="#059669" />
              <Bar dataKey="進行中" stackId="a" fill="#D97706" />
              <Bar dataKey="未着手" stackId="a" fill="#E6E2D9" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: "#FFFFFF", borderRadius: 14, padding: "20px 20px", display: "flex", flexDirection: "column", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>アクティブチケット</h2>
            <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#B0A9A4", background: "#F4F5F6", padding: "2px 8px", borderRadius: 20 }}>{inProgressCount + todoCount}件</span>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
            {TICKETS.filter(t => t.status !== "done").slice(0, 5).map(ticket => {
              const pr = getPriorityMeta(ticket.priority);
              return (
                <div key={ticket.id} style={{ display: "flex", gap: 10, padding: "9px 8px", borderRadius: 8, cursor: "pointer" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: pr.dot, marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: "#1A1714", lineHeight: 1.3, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ticket.title}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 9, background: ticket.status === "in-progress" ? "#ECFDF5" : "#F4F5F6", color: ticket.status === "in-progress" ? "#059669" : "#A09790", padding: "2px 7px", borderRadius: 20, fontWeight: 600 }}>
                        {ticket.status === "in-progress" ? "進行中" : "未着手"}
                      </span>
                      <span style={{ fontSize: 9, color: "#C9C4BB", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>{formatDate(ticket.dueDate)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ background: "#FFFFFF", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px 14px" }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>プロジェクト一覧</h2>
          <ChevronRight style={{ width: 14, height: 14, color: "#C9C4BB" }} />
        </div>
        <div style={{ borderTop: "1px solid rgba(26,23,20,0.05)" }}>
          {PROJECTS.map((p, i) => {
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
    </div>
  );
}
