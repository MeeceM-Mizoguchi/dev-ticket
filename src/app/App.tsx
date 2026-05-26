import { useState, useEffect, createContext, useContext, type ReactNode, type ElementType, type FormEvent } from "react";
import { supabase, isSupabaseEnabled } from "../lib/supabase";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams, Outlet } from "react-router";
import {
  LayoutDashboard, FolderKanban, Building2, Users, Settings, LogOut,
  Plus, Search, Calendar, TrendingUp, Ticket, Mail, Phone, X,
  Eye, Edit2, Trash2, UserPlus, Layers, AlertTriangle, ArrowRight,
  MoreHorizontal, CheckCircle2, Circle, Zap, Bell, ChevronRight,
  ChevronDown, BarChart2, Clock, Activity, ExternalLink,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// ─── Types ───────────────────────────────────────────────────────────────────
type Page = "login" | "dashboard" | "projects" | "clients" | "members" | "settings" | "sprint";
type Role = "admin" | "project-manager" | "developer" | "designer";
type ProjectStatus = "planning" | "in-progress" | "completed" | "on-hold";
type TicketStatus = "todo" | "in-progress" | "done";
type Priority = "low" | "medium" | "high";
type MemberStatus = "active" | "inactive" | "invited";
type NotifKey = "email" | "assign" | "status" | "comment" | "reminder";
type SprintStatus = "planning" | "active" | "completed" | "cancelled";
type SprintView = "list" | "board" | "gantt";

interface SprintTicket {
  id: string; wbs: string; title: string; status: TicketStatus;
  priority: Priority; assignee: string; startDate: string; dueDate: string;
  estimatedHours: number; progress: number;
}
interface Sprint {
  id: string; projectId: string; name: string; goal: string;
  status: SprintStatus; startDate: string; endDate: string;
  tickets: SprintTicket[];
}

interface Project {
  id: string; name: string; client: string; status: ProjectStatus;
  startDate: string; endDate: string; members: string[];
  done: number; inProgress: number; todo: number; description: string;
}
interface Client {
  id: string; name: string; industry: string; email: string;
  phone: string; status: "active" | "inactive";
}
interface Member {
  id: string; name: string; email: string; role: Role;
  group: string; status: MemberStatus; projects: number; tickets: number;
}
interface TicketItem {
  id: string; title: string; project: string; status: TicketStatus;
  priority: Priority; assignee: string; dueDate: string;
}

// ─── Data ────────────────────────────────────────────────────────────────────
const PROJECTS: Project[] = [
  { id: "P-001", name: "ECサイトリニューアル", client: "株式会社サンプル商事", status: "in-progress", startDate: "2026-01-15", endDate: "2026-06-30", members: ["田中太郎", "佐藤花子", "山田次郎"], done: 24, inProgress: 8, todo: 12, description: "既存ECサイトのUI/UX全面刷新。パフォーマンス改善とモバイル対応を含む大規模プロジェクト。" },
  { id: "P-002", name: "モバイルアプリ開発", client: "テクノロジー株式会社", status: "planning", startDate: "2026-03-01", endDate: "2026-09-30", members: ["田中太郎", "山田次郎"], done: 5, inProgress: 3, todo: 22, description: "iOS/Android向けのネイティブアプリ開発。React Nativeを使用した最新実装。" },
  { id: "P-003", name: "データ分析基盤構築", client: "グローバル産業", status: "completed", startDate: "2025-10-01", endDate: "2026-02-28", members: ["鈴木一郎", "田中太郎"], done: 31, inProgress: 0, todo: 0, description: "BIツールの導入とデータウェアハウスの構築。BigQuery連携を含む分析基盤。" },
  { id: "P-004", name: "社内ポータルサイト", client: "株式会社サンプル商事", status: "on-hold", startDate: "2026-02-01", endDate: "2026-07-31", members: ["佐藤花子", "鈴木一郎"], done: 12, inProgress: 2, todo: 14, description: "社内情報共有のためのイントラネットポータル。SSO対応と多言語対応を実装予定。" },
];
const CLIENTS: Client[] = [
  { id: "C-001", name: "株式会社サンプル商事", industry: "小売業", email: "contact@sample-corp.jp", phone: "03-1234-5678", status: "active" },
  { id: "C-002", name: "テクノロジー株式会社", industry: "IT・通信", email: "info@technology.co.jp", phone: "03-9876-5432", status: "active" },
  { id: "C-003", name: "グローバル産業", industry: "製造業", email: "global@industry.com", phone: "03-5555-1111", status: "inactive" },
];
const MEMBERS: Member[] = [
  { id: "M-001", name: "田中太郎", email: "tanaka@company.com", role: "developer", group: "開発第1チーム", status: "active", projects: 3, tickets: 8 },
  { id: "M-002", name: "佐藤花子", email: "sato@company.com", role: "designer", group: "デザインチーム", status: "active", projects: 2, tickets: 5 },
  { id: "M-003", name: "鈴木一郎", email: "suzuki@company.com", role: "project-manager", group: "マネジメント", status: "active", projects: 4, tickets: 2 },
  { id: "M-004", name: "山田次郎", email: "yamada@company.com", role: "developer", group: "開発第1チーム", status: "active", projects: 2, tickets: 6 },
  { id: "M-005", name: "システム管理者", email: "admin@example.com", role: "admin", group: "マネジメント", status: "active", projects: 4, tickets: 0 },
];
const TICKETS: TicketItem[] = [
  { id: "T-001", title: "トップページのバナー実装", project: "ECサイトリニューアル", status: "in-progress", priority: "high", assignee: "佐藤花子", dueDate: "2026-05-30" },
  { id: "T-002", title: "商品一覧APIのクエリ最適化", project: "ECサイトリニューアル", status: "todo", priority: "medium", assignee: "田中太郎", dueDate: "2026-06-05" },
  { id: "T-003", title: "ユーザー認証フローの修正", project: "モバイルアプリ開発", status: "in-progress", priority: "high", assignee: "田中太郎", dueDate: "2026-05-28" },
  { id: "T-004", title: "DBマイグレーションスクリプト", project: "ECサイトリニューアル", status: "done", priority: "low", assignee: "山田次郎", dueDate: "2026-05-20" },
  { id: "T-005", title: "CI/CDパイプライン構築", project: "モバイルアプリ開発", status: "todo", priority: "medium", assignee: "山田次郎", dueDate: "2026-06-15" },
  { id: "T-006", title: "レスポンシブデザイン対応", project: "社内ポータルサイト", status: "in-progress", priority: "medium", assignee: "佐藤花子", dueDate: "2026-06-01" },
];
const GROUPS = ["すべて", "マネジメント", "開発第1チーム", "開発第2チーム", "デザインチーム"];
const SPRINTS: Sprint[] = [
  { id:"S-001", projectId:"P-001", name:"Sprint 1: 要件定義・設計", goal:"要件定義の完了と基本設計書の作成", status:"completed", startDate:"2026-01-15", endDate:"2026-02-14",
    tickets:[
      { id:"T-101", wbs:"1.1", title:"要件定義書作成", status:"done", priority:"high", assignee:"鈴木一郎", startDate:"2026-01-15", dueDate:"2026-01-25", estimatedHours:16, progress:100 },
      { id:"T-102", wbs:"1.2", title:"UI/UXワイヤーフレーム設計", status:"done", priority:"high", assignee:"佐藤花子", startDate:"2026-01-20", dueDate:"2026-02-05", estimatedHours:24, progress:100 },
      { id:"T-103", wbs:"1.3", title:"DB設計・ER図作成", status:"done", priority:"medium", assignee:"田中太郎", startDate:"2026-01-22", dueDate:"2026-02-10", estimatedHours:20, progress:100 },
      { id:"T-104", wbs:"1.4", title:"API設計ドキュメント作成", status:"done", priority:"medium", assignee:"山田次郎", startDate:"2026-01-28", dueDate:"2026-02-14", estimatedHours:12, progress:100 },
    ]},
  { id:"S-002", projectId:"P-001", name:"Sprint 2: バックエンド開発", goal:"認証・商品・注文APIの実装完了", status:"completed", startDate:"2026-02-15", endDate:"2026-03-31",
    tickets:[
      { id:"T-201", wbs:"2.1", title:"ユーザー認証API実装", status:"done", priority:"high", assignee:"田中太郎", startDate:"2026-02-15", dueDate:"2026-02-28", estimatedHours:32, progress:100 },
      { id:"T-202", wbs:"2.2", title:"商品一覧・検索API実装", status:"done", priority:"high", assignee:"田中太郎", startDate:"2026-02-20", dueDate:"2026-03-10", estimatedHours:40, progress:100 },
      { id:"T-203", wbs:"2.3", title:"カート・注文API実装", status:"done", priority:"high", assignee:"山田次郎", startDate:"2026-03-01", dueDate:"2026-03-20", estimatedHours:48, progress:100 },
      { id:"T-204", wbs:"2.4", title:"DBマイグレーションスクリプト", status:"done", priority:"low", assignee:"山田次郎", startDate:"2026-03-15", dueDate:"2026-03-31", estimatedHours:8, progress:100 },
    ]},
  { id:"S-003", projectId:"P-001", name:"Sprint 3: フロントエンド開発", goal:"全ページのUI実装とAPI連携", status:"active", startDate:"2026-04-01", endDate:"2026-05-31",
    tickets:[
      { id:"T-301", wbs:"3.1", title:"トップページのバナー実装", status:"in-progress", priority:"high", assignee:"佐藤花子", startDate:"2026-04-01", dueDate:"2026-05-30", estimatedHours:16, progress:60 },
      { id:"T-302", wbs:"3.2", title:"商品一覧APIのクエリ最適化", status:"todo", priority:"medium", assignee:"田中太郎", startDate:"2026-04-15", dueDate:"2026-05-31", estimatedHours:20, progress:0 },
      { id:"T-303", wbs:"3.3", title:"商品詳細ページ実装", status:"in-progress", priority:"high", assignee:"佐藤花子", startDate:"2026-04-10", dueDate:"2026-05-15", estimatedHours:24, progress:45 },
      { id:"T-304", wbs:"3.4", title:"カートページ実装", status:"todo", priority:"medium", assignee:"山田次郎", startDate:"2026-04-20", dueDate:"2026-05-20", estimatedHours:20, progress:0 },
      { id:"T-305", wbs:"3.5", title:"チェックアウトフロー実装", status:"todo", priority:"high", assignee:"山田次郎", startDate:"2026-04-25", dueDate:"2026-05-31", estimatedHours:32, progress:0 },
      { id:"T-306", wbs:"3.6", title:"決済システム連携（Stripe）", status:"todo", priority:"high", assignee:"田中太郎", startDate:"2026-05-01", dueDate:"2026-05-31", estimatedHours:40, progress:0 },
      { id:"T-307", wbs:"3.7", title:"注文確認メール自動送信", status:"in-progress", priority:"medium", assignee:"佐藤花子", startDate:"2026-04-15", dueDate:"2026-05-10", estimatedHours:12, progress:30 },
      { id:"T-308", wbs:"3.8", title:"レスポンシブ対応・クロスブラウザQA", status:"todo", priority:"medium", assignee:"佐藤花子", startDate:"2026-05-10", dueDate:"2026-05-31", estimatedHours:16, progress:0 },
    ]},
  { id:"S-004", projectId:"P-001", name:"Sprint 4: テスト・リリース", goal:"本番リリースの準備と品質保証", status:"planning", startDate:"2026-06-01", endDate:"2026-06-30",
    tickets:[
      { id:"T-401", wbs:"4.1", title:"E2Eテスト作成・実行", status:"todo", priority:"high", assignee:"田中太郎", startDate:"2026-06-01", dueDate:"2026-06-15", estimatedHours:32, progress:0 },
      { id:"T-402", wbs:"4.2", title:"パフォーマンステスト", status:"todo", priority:"medium", assignee:"山田次郎", startDate:"2026-06-10", dueDate:"2026-06-20", estimatedHours:16, progress:0 },
      { id:"T-403", wbs:"4.3", title:"本番環境構築・デプロイ", status:"todo", priority:"high", assignee:"田中太郎", startDate:"2026-06-18", dueDate:"2026-06-28", estimatedHours:24, progress:0 },
    ]},
  { id:"S-005", projectId:"P-002", name:"Sprint 1: 設計・プロトタイプ", goal:"アーキテクチャ設計とプロトタイプ完成", status:"active", startDate:"2026-03-01", endDate:"2026-04-15",
    tickets:[
      { id:"T-501", wbs:"1.1", title:"アーキテクチャ設計書作成", status:"done", priority:"high", assignee:"鈴木一郎", startDate:"2026-03-01", dueDate:"2026-03-15", estimatedHours:16, progress:100 },
      { id:"T-502", wbs:"1.2", title:"UI設計・モックアップ作成", status:"in-progress", priority:"medium", assignee:"佐藤花子", startDate:"2026-03-10", dueDate:"2026-04-05", estimatedHours:32, progress:70 },
      { id:"T-503", wbs:"1.3", title:"ユーザー認証フローの設計", status:"in-progress", priority:"high", assignee:"田中太郎", startDate:"2026-03-15", dueDate:"2026-04-15", estimatedHours:24, progress:40 },
      { id:"T-504", wbs:"1.4", title:"プロトタイプ実装（主要画面）", status:"todo", priority:"high", assignee:"山田次郎", startDate:"2026-03-20", dueDate:"2026-04-15", estimatedHours:40, progress:0 },
      { id:"T-505", wbs:"1.5", title:"ユーザビリティテスト実施", status:"todo", priority:"medium", assignee:"鈴木一郎", startDate:"2026-04-01", dueDate:"2026-04-15", estimatedHours:16, progress:0 },
    ]},
  { id:"S-006", projectId:"P-002", name:"Sprint 2: コア機能開発", goal:"メイン機能の実装", status:"planning", startDate:"2026-04-16", endDate:"2026-09-30",
    tickets:[
      { id:"T-601", wbs:"2.1", title:"CI/CDパイプライン構築", status:"todo", priority:"medium", assignee:"山田次郎", startDate:"2026-04-16", dueDate:"2026-06-15", estimatedHours:20, progress:0 },
      { id:"T-602", wbs:"2.2", title:"プッシュ通知実装", status:"todo", priority:"high", assignee:"田中太郎", startDate:"2026-04-20", dueDate:"2026-05-31", estimatedHours:40, progress:0 },
      { id:"T-603", wbs:"2.3", title:"オフラインモード対応", status:"todo", priority:"low", assignee:"山田次郎", startDate:"2026-05-01", dueDate:"2026-06-15", estimatedHours:32, progress:0 },
    ]},
  { id:"S-007", projectId:"P-003", name:"Sprint 1: 基盤構築", goal:"データウェアハウスの基盤セットアップ", status:"completed", startDate:"2025-10-01", endDate:"2025-11-15",
    tickets:[
      { id:"T-701", wbs:"1.1", title:"BigQuery環境構築", status:"done", priority:"high", assignee:"鈴木一郎", startDate:"2025-10-01", dueDate:"2025-10-20", estimatedHours:24, progress:100 },
      { id:"T-702", wbs:"1.2", title:"データパイプライン設計", status:"done", priority:"high", assignee:"田中太郎", startDate:"2025-10-10", dueDate:"2025-11-05", estimatedHours:32, progress:100 },
      { id:"T-703", wbs:"1.3", title:"ETL処理の実装", status:"done", priority:"medium", assignee:"田中太郎", startDate:"2025-10-20", dueDate:"2025-11-15", estimatedHours:40, progress:100 },
    ]},
  { id:"S-008", projectId:"P-003", name:"Sprint 2: BIツール連携", goal:"Looker Studioとの連携完成", status:"completed", startDate:"2025-11-16", endDate:"2026-02-28",
    tickets:[
      { id:"T-801", wbs:"2.1", title:"Looker Studio接続設定", status:"done", priority:"high", assignee:"鈴木一郎", startDate:"2025-11-16", dueDate:"2025-12-10", estimatedHours:16, progress:100 },
      { id:"T-802", wbs:"2.2", title:"ダッシュボード設計・作成", status:"done", priority:"medium", assignee:"佐藤花子", startDate:"2025-12-01", dueDate:"2026-01-10", estimatedHours:48, progress:100 },
      { id:"T-803", wbs:"2.3", title:"データ品質テスト", status:"done", priority:"medium", assignee:"田中太郎", startDate:"2025-12-15", dueDate:"2026-02-28", estimatedHours:24, progress:100 },
    ]},
  { id:"S-009", projectId:"P-004", name:"Sprint 1: 要件整理", goal:"ステークホルダーへのヒアリングと要件定義", status:"completed", startDate:"2026-02-01", endDate:"2026-02-28",
    tickets:[
      { id:"T-901", wbs:"1.1", title:"ヒアリングシート作成", status:"done", priority:"medium", assignee:"鈴木一郎", startDate:"2026-02-01", dueDate:"2026-02-10", estimatedHours:8, progress:100 },
      { id:"T-902", wbs:"1.2", title:"要件定義書作成", status:"done", priority:"high", assignee:"佐藤花子", startDate:"2026-02-10", dueDate:"2026-02-28", estimatedHours:20, progress:100 },
    ]},
  { id:"S-010", projectId:"P-004", name:"Sprint 2: 保留中作業", goal:"承認待ちタスクの処理", status:"planning", startDate:"2026-03-01", endDate:"2026-07-31",
    tickets:[
      { id:"T-A01", wbs:"2.1", title:"レスポンシブデザイン対応", status:"in-progress", priority:"medium", assignee:"佐藤花子", startDate:"2026-03-01", dueDate:"2026-06-01", estimatedHours:32, progress:25 },
      { id:"T-A02", wbs:"2.2", title:"SSO認証連携", status:"todo", priority:"high", assignee:"鈴木一郎", startDate:"2026-04-01", dueDate:"2026-05-31", estimatedHours:40, progress:0 },
      { id:"T-A03", wbs:"2.3", title:"多言語対応（日本語・英語）", status:"todo", priority:"medium", assignee:"山田次郎", startDate:"2026-05-01", dueDate:"2026-07-15", estimatedHours:24, progress:0 },
      { id:"T-A04", wbs:"2.4", title:"パフォーマンス最適化", status:"todo", priority:"low", assignee:"田中太郎", startDate:"2026-06-01", dueDate:"2026-07-31", estimatedHours:20, progress:0 },
    ]},
];

const NOTIFICATIONS = [
  { id: 1, title: "新しいチケットが割り当てられました", body: "T-007: ログイン機能のバグ修正が担当になりました", time: "5分前", read: false },
  { id: 2, title: "ステータスが変更されました", body: "T-003: ユーザー認証フロー → 完了に更新されました", time: "1時間前", read: false },
  { id: 3, title: "コメントが追加されました", body: "ECサイトリニューアル: 田中太郎さんがコメントしました", time: "3時間前", read: true },
];

// ─── Supabase Mappers ─────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProject(r: any): Project {
  return { id:r.id, name:r.name, client:r.client, status:r.status, startDate:r.start_date, endDate:r.end_date, members:r.members||[], done:r.done||0, inProgress:r.in_progress||0, todo:r.todo||0, description:r.description||"" };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapClient(r: any): Client {
  return { id:r.id, name:r.name, industry:r.industry||"", email:r.email||"", phone:r.phone||"", status:r.status };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSprintTicket(r: any): SprintTicket {
  return { id:r.id, wbs:r.wbs||"", title:r.title, status:r.status, priority:r.priority, assignee:r.assignee||"", startDate:r.start_date, dueDate:r.due_date, estimatedHours:r.estimated_hours||0, progress:r.progress||0 };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSprint(r: any): Sprint {
  return { id:r.id, projectId:r.project_id, name:r.name, goal:r.goal||"", status:r.status, startDate:r.start_date, endDate:r.end_date, tickets:(r.sprint_tickets||[]).map(mapSprintTicket) };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMember(r: any): Member {
  return { id:r.id, name:r.name, email:r.email, role:r.role, group:r.group_name||"", status:r.status||"active", projects:r.project_count||0, tickets:r.ticket_count||0 };
}

// ─── Auth Context ─────────────────────────────────────────────────────────────
interface AuthCtxType { userName: string; userRole: Role; login: (email: string, password: string) => Promise<string | null>; logout: () => void; }
const AuthContext = createContext<AuthCtxType>({ userName: "", userRole: "developer", login: async () => null, logout: () => {} });
function useAuth() { return useContext(AuthContext); }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getStatusMeta(status: ProjectStatus | TicketStatus) {
  const map: Record<string, { label: string; cls: string; dot: string; bar: string }> = {
    planning:      { label: "計画中", cls: "bg-slate-100 text-slate-600",    dot: "bg-slate-400",  bar: "bg-slate-300" },
    "in-progress": { label: "進行中", cls: "bg-orange-50 text-orange-700",   dot: "bg-orange-400", bar: "bg-orange-400" },
    completed:     { label: "完了",   cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500",bar: "bg-emerald-500" },
    "on-hold":     { label: "保留中", cls: "bg-amber-50 text-amber-700",     dot: "bg-amber-400",  bar: "bg-amber-400" },
    todo:          { label: "未着手", cls: "bg-stone-100 text-stone-500",    dot: "bg-stone-400",  bar: "bg-stone-300" },
    done:          { label: "完了",   cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500",bar: "bg-emerald-500" },
  };
  return map[status] ?? { label: status, cls: "bg-stone-100 text-stone-500", dot: "bg-stone-400", bar: "bg-stone-300" };
}
function getPriorityMeta(p: Priority) {
  return {
    high:   { label: "高", cls: "bg-red-50 text-red-600",    dot: "bg-red-500" },
    medium: { label: "中", cls: "bg-amber-50 text-amber-700",dot: "bg-amber-400" },
    low:    { label: "低", cls: "bg-sky-50 text-sky-600",    dot: "bg-sky-400" },
  }[p];
}
function getRoleMeta(role: Role) {
  return {
    admin:             { label: "管理者",    cls: "bg-rose-50 text-rose-700",      gradient: "from-rose-500 to-rose-600" },
    "project-manager": { label: "PM",        cls: "bg-orange-50 text-orange-700",   gradient: "from-orange-500 to-orange-600" },
    developer:         { label: "開発者",    cls: "bg-sky-50 text-sky-700",         gradient: "from-sky-500 to-sky-600" },
    designer:          { label: "デザイナー", cls: "bg-violet-50 text-violet-700",   gradient: "from-violet-500 to-violet-600" },
  }[role];
}
function getAvatarColor(name: string) {
  const colors = ["#059669","#D97706","#059669","#0284C7","#7C3AED","#DB2777"];
  return colors[name.charCodeAt(0) % colors.length];
}
function calcProgress(done: number, ip: number, todo: number) {
  const t = done + ip + todo; return t === 0 ? 0 : Math.round((done / t) * 100);
}
function getInitials(n: string) { return n.replace(/\s/g, "").slice(0, 2); }
function formatDate(d: string) { return d.slice(5).replace("-", "/"); }
function daysBetween(a: string, b: string) { return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000); }
function getSprintStatusMeta(status: SprintStatus) {
  return {
    planning:  { label:"計画中", bg:"#F4F5F6", color:"#6B6458", dot:"#B0A9A4", barColor:"#B0A9A4" },
    active:    { label:"進行中", bg:"#ECFDF5", color:"#059669", dot:"#059669", barColor:"#059669" },
    completed: { label:"完了",   bg:"#F0F9FF", color:"#0284C7", dot:"#0284C7", barColor:"#0284C7" },
    cancelled: { label:"中止",   bg:"#FEF2F2", color:"#DC2626", dot:"#DC2626", barColor:"#DC2626" },
  }[status];
}
function sprintProgress(s: Sprint) {
  if (!s.tickets.length) return 0;
  return Math.round(s.tickets.filter(t => t.status === "done").length / s.tickets.length * 100);
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${className}`}>{children}</span>;
}
function Avatar({ name, size = "md" }: { name: string; size?: "xs" | "sm" | "md" | "lg" }) {
  const sz = { xs: 24, sm: 28, md: 36, lg: 48 };
  const fs = { xs: 9, sm: 10, md: 13, lg: 16 };
  const color = getAvatarColor(name);
  const s = sz[size];
  return (
    <div style={{ width: s, height: s, borderRadius: s / 2, background: color, color: "#fff", fontSize: fs[size], fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, userSelect: "none", letterSpacing: "-0.01em" }}>
      {getInitials(name)}
    </div>
  );
}
function ProgressBar({ value }: { value: number }) {
  const color = value >= 70 ? "#059669" : value >= 30 ? "#059669" : "#C9C4BB";
  return (
    <div style={{ height: 5, background: "#EDE9E0", borderRadius: 9999, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(value, 100)}%`, background: color, borderRadius: 9999, transition: "width 0.6s ease" }} />
    </div>
  );
}
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange}
      style={{ width: 44, height: 24, borderRadius: 12, background: checked ? "#059669" : "#C9C4BB", position: "relative", flexShrink: 0, border: "none", cursor: "pointer", transition: "background 0.2s" }}>
      <span style={{ position: "absolute", top: 2, left: checked ? 22 : 2, width: 20, height: 20, background: "#fff", borderRadius: 10, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
    </button>
  );
}

const inputCls = "w-full bg-[#F7F8F9] border border-stone-200/70 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 focus:bg-white transition-all";
const labelCls = "block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1.5";

function FieldInput({ label, type = "text", placeholder, required, value, onChange, readOnly }: {
  label: string; type?: string; placeholder?: string; required?: boolean;
  value?: string; onChange?: (v: string) => void; readOnly?: boolean;
}) {
  return (
    <div>
      <label className={labelCls}>{label}{required && " *"}</label>
      <input type={type} placeholder={placeholder} value={value} readOnly={readOnly}
        onChange={e => onChange?.(e.target.value)} className={inputCls + (readOnly ? " opacity-60 cursor-default" : "")} />
    </div>
  );
}
function FieldTextarea({ label, placeholder, value, onChange }: { label: string; placeholder?: string; value?: string; onChange?: (v: string) => void }) {
  return <div><label className={labelCls}>{label}</label><textarea rows={3} placeholder={placeholder} value={value} onChange={e => onChange?.(e.target.value)} className={inputCls + " resize-none"} /></div>;
}
function FieldSelect({ label, children, required, value, onChange }: { label: string; children: ReactNode; required?: boolean; value?: string; onChange?: (v: string) => void }) {
  return <div><label className={labelCls}>{label}{required && " *"}</label><select value={value} onChange={e => onChange?.(e.target.value)} className={inputCls + " appearance-none cursor-pointer"}>{children}</select></div>;
}
function ConfirmDialog({ message, onConfirm, onClose }: { message: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <DialogShell title="削除の確認" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary>
        <button type="button" onClick={() => { onConfirm(); onClose(); }} style={{ padding:"9px 20px", background:"#DC2626", color:"#fff", fontSize:13, fontWeight:700, borderRadius:10, border:"none", cursor:"pointer", boxShadow:"0 2px 8px rgba(220,38,38,0.30)" }}>削除する</button>
      </>}>
      <p style={{ fontSize:14, color:"#1A1714", lineHeight:1.7 }}>{message}</p>
      <p style={{ fontSize:12, color:"#A09790" }}>この操作は取り消せません。</p>
    </DialogShell>
  );
}
function DialogShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div style={{ position: "relative", zIndex: 10, width: "100%", maxWidth: 460, background: "#FFFFFF", borderRadius: 20, boxShadow: "0 24px 80px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.08)", overflow: "hidden" }}>

        {/* Premium gradient header */}
        <div style={{ background: "linear-gradient(135deg, #059669 0%, #047857 60%, #065F46 100%)", padding: "22px 24px 20px", position: "relative", overflow: "hidden" }}>
          {/* Decorative shimmer orbs */}
          <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
          <div style={{ position: "absolute", bottom: -30, left: 40, width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 5 }}>Dev Ticket</p>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: "#FFFFFF", fontFamily: "var(--font-heading)", letterSpacing: "-0.025em", lineHeight: 1.1 }}>{title}</h2>
            </div>
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid rgba(255,255,255,0.20)", background: "rgba(255,255,255,0.10)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.8)", flexShrink: 0, transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.20)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)"; }}>
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "24px 24px 20px", display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto" }}>{children}</div>

        {/* Footer */}
        <div style={{ padding: "14px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid rgba(26,23,20,0.07)" }}>{footer}</div>
      </div>
    </div>
  );
}
function BtnPrimary({ children, onClick, type = "button" }: { children: ReactNode; onClick?: () => void; type?: "button" | "submit" }) {
  return <button type={type} onClick={onClick} style={{ padding: "9px 20px", background: "linear-gradient(135deg,#059669,#047857)", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 10px rgba(5,150,105,0.30), inset 0 1px 0 rgba(255,255,255,0.12)", letterSpacing: "-0.01em", transition: "all 0.15s" }}
    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(5,150,105,0.40), inset 0 1px 0 rgba(255,255,255,0.12)"; }}
    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 10px rgba(5,150,105,0.30), inset 0 1px 0 rgba(255,255,255,0.12)"; }}>
    {children}
  </button>;
}
function BtnSecondary({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return <button type="button" onClick={onClick} style={{ padding: "9px 20px", background: "transparent", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "1px solid rgba(26,23,20,0.12)", cursor: "pointer", transition: "all 0.15s" }}
    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
    {children}
  </button>;
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("password");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (sessionStorage.getItem("isLoggedIn") === "true") return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setLoading(true); setError("");
    const err = await login(email, password);
    if (err) { setError(err); setLoading(false); }
    else navigate("/dashboard");
  };

  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex w-[42%] bg-teal-700 flex-col justify-between p-12 relative overflow-hidden"
        style={{ backgroundImage: "radial-gradient(circle at 70% 30%, rgba(255,255,255,0.07) 0%, transparent 60%), radial-gradient(circle at 20% 80%, rgba(0,0,0,0.1) 0%, transparent 50%)" }}>
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="relative">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-md">
              <Ticket className="text-teal-700" style={{ width: 18, height: 18 }} />
            </div>
            <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--font-heading)" }}>Dev Ticket</span>
          </div>
          <h2 className="text-4xl font-bold text-white leading-tight mb-5" style={{ fontFamily: "var(--font-heading)" }}>プロジェクトを、<br />スマートに。</h2>
          <p className="text-teal-100 text-sm leading-relaxed max-w-xs">チケット・スプリント・メンバーを一元管理。<br />チームの生産性を最大化するツール。</p>
        </div>
        <div className="relative">
          <div className="flex gap-8 mb-6">
            {[{ n: "4件", l: "進行中PJ" }, { n: "5名", l: "メンバー" }, { n: "87%", l: "完了率" }].map(({ n, l }) => (
              <div key={l}><p className="text-2xl font-bold text-white" style={{ fontFamily: "var(--font-heading)" }}>{n}</p><p className="text-xs text-teal-300 mt-0.5">{l}</p></div>
            ))}
          </div>
          <p className="text-xs text-teal-400">パスワードは「password」でお試しください</p>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-8 bg-[#F5F6F8]">
        <div className="w-full max-w-[360px]">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-stone-900 mb-1" style={{ fontFamily: "var(--font-heading)" }}>ログイン</h1>
            <p className="text-sm text-stone-500">アカウントにアクセスしてください</p>
          </div>
          <div className="bg-white rounded-2xl border border-stone-200 p-7 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />{error}
                </div>
              )}
              <FieldInput label="メールアドレス" type="email" placeholder="you@company.com" value={email} onChange={setEmail} />
              <FieldInput label="パスワード" type="password" placeholder="••••••••" value={password} onChange={setPassword} />
              <button type="submit" disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-sm shadow-emerald-200 mt-1">
                {loading
                  ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />認証中...</>
                  : <>ログイン <ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>
          </div>
          <div className="mt-4 p-4 bg-white rounded-xl border border-stone-200">
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">クイックログイン</p>
            <div className="flex flex-wrap gap-1.5">
              {MEMBERS.map(m => (
                <button key={m.id} type="button" onClick={() => { setEmail(m.email); setPassword("password"); }}
                  className="text-xs px-2.5 py-1.5 bg-stone-50 hover:bg-emerald-50 border border-stone-200 hover:border-emerald-300 rounded-lg text-stone-500 hover:text-emerald-700 transition-all font-medium">
                  {m.name.replace(" ", "")}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar (Icon Rail) ──────────────────────────────────────────────────────
const NAV_ITEMS: { id: Page; label: string; icon: ElementType; roles?: Role[] }[] = [
  { id: "dashboard", label: "ダッシュ", icon: LayoutDashboard },
  { id: "projects",  label: "PJ一覧",   icon: FolderKanban },
  { id: "clients",   label: "クライアント", icon: Building2, roles: ["admin", "project-manager"] },
  { id: "members",   label: "メンバー",  icon: Users, roles: ["admin", "project-manager"] },
];

function Sidebar({ page, onNavigate, onLogout, userName, userRole }: {
  page: Page; onNavigate: (p: Page) => void; onLogout: () => void;
  userName: string; userRole: Role;
}) {
  const [hoveredNav, setHoveredNav] = useState<string | null>(null);
  const visible = NAV_ITEMS.filter(n => !n.roles || n.roles.includes(userRole));

  const Tooltip = ({ label }: { label: string }) => (
    <div style={{
      position: "absolute", left: 68, top: "50%", transform: "translateY(-50%)",
      background: "#1A1714", color: "#fff", fontSize: 11, fontWeight: 600,
      padding: "5px 10px", borderRadius: 7, whiteSpace: "nowrap" as const,
      pointerEvents: "none", zIndex: 100,
      boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
    }}>
      {label}
      <div style={{
        position: "absolute", right: "100%", top: "50%", transform: "translateY(-50%)",
        width: 0, height: 0,
        borderTop: "5px solid transparent", borderBottom: "5px solid transparent",
        borderRight: "6px solid #1A1714",
      }} />
    </div>
  );

  const NavBtn = ({ id, label, Icon }: { id: Page; label: string; Icon: ElementType }) => {
    const active = page === id;
    return (
      <div style={{ position: "relative" }}
        onMouseEnter={() => setHoveredNav(id)}
        onMouseLeave={() => setHoveredNav(null)}>
        <button
          onClick={() => onNavigate(id)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
            padding: "11px 0", position: "relative", border: "none",
            background: "transparent", cursor: "pointer",
          }}>
          {active && (
            <div style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: "0 99px 99px 0", background: "#059669" }} />
          )}
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: active ? "#ECFDF5" : "transparent",
            border: active ? "1px solid rgba(5,150,105,0.18)" : "1px solid transparent",
            transition: "all 0.15s",
          }}
            onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; } }}
            onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "transparent"; } }}>
            <Icon style={{ width: 17, height: 17, color: active ? "#059669" : "#9E9690" }} />
          </div>
        </button>
        {hoveredNav === id && <Tooltip label={label} />}
      </div>
    );
  };

  return (
    <aside style={{ width: 64, background: "#FFFFFF", borderRight: "1px solid rgba(26,23,20,0.07)", display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>

      {/* Brand */}
      <div style={{ padding: "20px 0 10px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div title="Dev Ticket" style={{ width: 38, height: 38, borderRadius: 11, background: "linear-gradient(145deg, #34D399, #059669)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(5,150,105,0.35), inset 0 1px 0 rgba(255,255,255,0.30)" }}>
          <Ticket style={{ width: 17, height: 17, color: "#fff" }} />
        </div>
      </div>

      <div style={{ width: 28, height: 1, background: "rgba(26,23,20,0.06)", margin: "6px 0 4px" }} />

      {/* Main nav */}
      <nav style={{ flex: 1, width: "100%", display: "flex", flexDirection: "column", paddingTop: 2 }}>
        {visible.map(({ id, label, icon: Icon }) => (
          <NavBtn key={id} id={id} label={label} Icon={Icon} />
        ))}
      </nav>

      {/* Bottom */}
      <div style={{ width: "100%", paddingBottom: 16 }}>
        <div style={{ width: 28, height: 1, background: "rgba(26,23,20,0.06)", margin: "4px auto 4px" }} />
        <NavBtn id="settings" label="設定" Icon={Settings} />
        <div style={{ position: "relative" }}
          onMouseEnter={() => setHoveredNav("logout")}
          onMouseLeave={() => setHoveredNav(null)}>
          <button
            onClick={onLogout}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "11px 0", border: "none", background: "transparent", cursor: "pointer" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <LogOut style={{ width: 16, height: 16, color: "#C9C4BB" }} />
            </div>
          </button>
          {hoveredNav === "logout" && <Tooltip label="ログアウト" />}
        </div>
      </div>
    </aside>
  );
}

// ─── Topbar ───────────────────────────────────────────────────────────────────
const PAGE_META: Record<Exclude<Page, "login">, { title: string; sub: string }> = {
  dashboard: { title: "ダッシュボード", sub: "チームの進捗状況" },
  projects:  { title: "プロジェクト管理", sub: "進行中のスプリントと案件" },
  clients:   { title: "クライアント", sub: "取引先企業の一覧" },
  members:   { title: "メンバー", sub: "チーム構成と担当状況" },
  settings:  { title: "設定", sub: "アカウントとシステム設定" },
  sprint:    { title: "スプリント管理", sub: "スプリントと進捗" },
};

function Topbar({ userName }: { userName: string }) {
  const [showNotif, setShowNotif] = useState(false);
  const location = useLocation();
  const getPageKey = (): Exclude<Page, "login"> => {
    const p = location.pathname;
    if (p.startsWith("/projects/")) return "sprint";
    if (p.startsWith("/projects")) return "projects";
    if (p.startsWith("/clients")) return "clients";
    if (p.startsWith("/members")) return "members";
    if (p.startsWith("/settings")) return "settings";
    return "dashboard";
  };
  const meta = PAGE_META[getPageKey()];
  const unreadCount = NOTIFICATIONS.filter(n => !n.read).length;

  return (
    <header style={{ height: 52, background: "#FFFFFF", borderBottom: "1px solid rgba(20,26,22,0.08)", display: "flex", alignItems: "center", padding: "0 20px", gap: 14, flexShrink: 0 }}>
      {/* Page title */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.015em" }}>{meta.title}</span>
        <ChevronRight style={{ width: 12, height: 12, color: "#D5D0CB" }} />
      </div>

      {/* Search */}
      <div style={{ flex: 1, maxWidth: 320, position: "relative" }}>
        <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, color: "#C9C4BB" }} />
        <input
          placeholder="検索..."
          style={{ width: "100%", background: "#F4F5F6", border: "1px solid transparent", borderRadius: 8, padding: "6px 12px 6px 28px", fontSize: 12, color: "#1A1714", outline: "none", transition: "all 0.15s" }}
          onFocus={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "rgba(5,150,105,0.30)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(5,150,105,0.08)"; }}
          onBlur={e => { e.currentTarget.style.background = "#F4F5F6"; e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
        />
      </div>

      {/* Right side */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>

        {/* Notification bell */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowNotif(!showNotif)}
            style={{ position: "relative", width: 34, height: 34, borderRadius: 9, border: "none", background: showNotif ? "#F4F5F6" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { if (!showNotif) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <Bell style={{ width: 15, height: 15, color: "#9E9690" }} />
            {unreadCount > 0 && (
              <span style={{ position: "absolute", top: 4, right: 4, minWidth: 14, height: 14, borderRadius: 7, background: "#059669", border: "1.5px solid #FFFFFF", fontSize: 8, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, padding: "0 2px" }}>
                {unreadCount}
              </span>
            )}
          </button>

          {showNotif && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setShowNotif(false)} />
              <div style={{ position: "absolute", top: 40, right: 0, width: 320, background: "#fff", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.06)", border: "1px solid rgba(26,23,20,0.08)", zIndex: 50, overflow: "hidden" }}>
                {/* Header */}
                <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid rgba(26,23,20,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>お知らせ</span>
                  {unreadCount > 0 && (
                    <span style={{ fontSize: 10, background: "#ECFDF5", color: "#059669", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>{unreadCount}件 未読</span>
                  )}
                </div>
                {/* List */}
                <div>
                  {NOTIFICATIONS.map(notif => (
                    <div key={notif.id}
                      style={{ padding: "12px 16px", borderBottom: "1px solid rgba(26,23,20,0.04)", background: notif.read ? "transparent" : "#F0FDF8", cursor: "pointer", transition: "background 0.12s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = notif.read ? "transparent" : "#F0FDF8"; }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: notif.read ? "transparent" : "#059669", marginTop: 5, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: "#1A1714", lineHeight: 1.3, marginBottom: 2 }}>{notif.title}</p>
                          <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.4, marginBottom: 4 }}>{notif.body}</p>
                          <span style={{ fontSize: 10, color: "#C9C4BB", fontFamily: "var(--font-mono)" }}>{notif.time}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Footer */}
                <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(26,23,20,0.06)", textAlign: "center" as const }}>
                  <button style={{ fontSize: 12, color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#047857"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#059669"; }}>
                    すべてのお知らせを見る
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ width: 1, height: 18, background: "rgba(26,23,20,0.08)", margin: "0 4px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 10px 4px 5px", borderRadius: 9999, background: "#F4F5F6", cursor: "default" }}>
          <Avatar name={userName} size="xs" />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#3D3732" }}>{userName}</span>
        </div>
      </div>
    </header>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard() {
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

  const statTiles = [
    { value: activeProjects, label: "進行中プロジェクト", icon: FolderKanban, accent: "#059669", accentBg: "#ECFDF5", trend: "今月 +1件", up: true },
    { value: inProgressCount, label: "進行中チケット", icon: Zap, accent: "#D97706", accentBg: "#FFFBEB", trend: "期限近い 3件", up: false },
    { value: todoCount, label: "未着手チケット", icon: Clock, accent: "#0284C7", accentBg: "#F0F9FF", trend: "新規 2件", up: true },
    { value: `${completionRate}%`, label: "チーム完了率", icon: TrendingUp, accent: "#059669", accentBg: "#ECFDF5", trend: "先月比 +5%", up: true },
  ];

  return (
    <div style={{ padding: "32px 28px" }}>

      {/* Page header */}
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

      {/* Stat tiles — left border accent design */}
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

      {/* Main content grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, marginBottom: 16 }}>

        {/* Project progress */}
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

        {/* Active tickets feed */}
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

      {/* Project list overview */}
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
                    <div style={{ height: "100%", width: `${progress}%`, background: progress >= 70 ? "#059669" : "#059669", borderRadius: 99 }} />
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

// ─── Projects ─────────────────────────────────────────────────────────────────
function ProjectCard({ project, onNavigate, onDelete }: { project: Project; onNavigate: () => void; onDelete?: () => void }) {
  const progress = calcProgress(project.done, project.inProgress, project.todo);
  const total = project.done + project.inProgress + project.todo;
  const sm = getStatusMeta(project.status);
  const dotColor = project.status === "in-progress" ? "#FB923C" : project.status === "completed" ? "#10B981" : project.status === "on-hold" ? "#F59E0B" : "#C9C4BB";

  return (
    <div onClick={onNavigate} style={{ background: "#FFFFFF", borderRadius: 16, overflow: "hidden", cursor: "pointer", transition: "all 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 28px rgba(26,23,20,0.12)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(26,23,20,0.06), 0 4px 12px rgba(26,23,20,0.04)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
      <div style={{ height: 5, background: `linear-gradient(90deg, ${dotColor}, ${dotColor}CC)` }} />
      <div style={{ padding: "16px 18px 18px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <span style={{ fontSize: 9, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{project.id}</span>
              <span style={{ fontSize: 9, background: project.status === "in-progress" ? "#ECFDF5" : project.status === "completed" ? "#ECFDF5" : project.status === "on-hold" ? "#FFFBEB" : "#F4F5F6", color: project.status === "in-progress" ? "#059669" : project.status === "completed" ? "#059669" : project.status === "on-hold" ? "#D97706" : "#A09790", padding: "2px 7px", borderRadius: 20, fontWeight: 600 }}>{sm.label}</span>
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", lineHeight: 1.3, marginBottom: 3 }}>{project.name}</h3>
            <p style={{ fontSize: 11, color: "#B0A9A4", display: "flex", alignItems: "center", gap: 4 }}>
              <Building2 style={{ width: 10, height: 10 }} />{project.client}
            </p>
          </div>
          {onDelete ? (
            <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ padding: 6, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
              <Trash2 style={{ width: 13, height: 13 }} />
            </button>
          ) : (
            <button onClick={e => e.stopPropagation()} style={{ padding: 6, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <MoreHorizontal style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>

        {project.description && (
          <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.6, marginBottom: 14, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>{project.description}</p>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 600 }}>進捗</span>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700, color: "#3D3732" }}>{progress}%</span>
          </div>
          <ProgressBar value={progress} />
          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <span style={{ fontSize: 10, color: "#059669", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 4 }}><CheckCircle2 style={{ width: 10, height: 10 }} />{project.done}</span>
            <span style={{ fontSize: 10, color: "#D97706", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 4 }}><Zap style={{ width: 10, height: 10 }} />{project.inProgress}</span>
            <span style={{ fontSize: 10, color: "#C9C4BB", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 4 }}><Circle style={{ width: 10, height: 10 }} />{project.todo}</span>
            <span style={{ fontSize: 10, color: "#C9C4BB", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>{total}件</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid rgba(26,23,20,0.05)" }}>
          <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 4 }}>
            <Calendar style={{ width: 10, height: 10 }} />{formatDate(project.startDate)} – {formatDate(project.endDate)}
          </span>
          <div style={{ display: "flex" }}>
            {project.members.slice(0, 3).map((name, i) => (
              <div key={name} style={{ marginLeft: i === 0 ? 0 : -8, border: "2px solid #fff", borderRadius: "50%" }}>
                <Avatar name={name} size="xs" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewProjectDialog({ onClose, clients, onCreated }: { onClose: () => void; clients: Client[]; onCreated?: () => void }) {
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("planning");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    if (isSupabaseEnabled) {
      setSaving(true);
      await supabase!.from("projects").insert({
        id: `P-${Date.now()}`, name, client: clientName, description,
        start_date: startDate || null, end_date: endDate || null,
        status, members: [], done: 0, in_progress: 0, todo: 0,
      });
      setSaving(false);
    }
    onCreated?.();
    onClose();
  };

  return (
    <DialogShell title="新規プロジェクト作成" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave}>{saving ? "作成中..." : "作成する"}</BtnPrimary></>}>
      <FieldInput label="プロジェクト名" placeholder="例: ECサイトリニューアル" required value={name} onChange={setName} />
      <FieldSelect label="クライアント" required value={clientName} onChange={setClientName}>
        <option value="">クライアントを選択</option>
        {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
      </FieldSelect>
      <FieldTextarea label="説明" placeholder="プロジェクトの概要を入力..." value={description} onChange={setDescription} />
      <div className="grid grid-cols-2 gap-3">
        <FieldInput label="開始日" type="date" required value={startDate} onChange={setStartDate} />
        <FieldInput label="終了日" type="date" required value={endDate} onChange={setEndDate} />
      </div>
      <FieldSelect label="ステータス" value={status} onChange={setStatus as (v: string) => void}>
        <option value="planning">計画中</option><option value="in-progress">進行中</option>
        <option value="completed">完了</option><option value="on-hold">保留中</option>
      </FieldSelect>
    </DialogShell>
  );
}

function ProjectsPage() {
  const { userRole } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showDialog, setShowDialog] = useState(false);
  const [projects, setProjects] = useState<Project[]>(PROJECTS);
  const [clients, setClients] = useState<Client[]>(CLIENTS);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const canManage = userRole === "admin" || userRole === "project-manager";

  const refreshProjects = () => {
    if (!isSupabaseEnabled) return;
    supabase!.from("projects").select("*").order("id")
      .then(({ data }) => { if (data?.length) setProjects(data.map(mapProject)); });
  };

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!.from("projects").select("*").order("id")
      .then(({ data }) => { if (data?.length) setProjects(data.map(mapProject)); });
    supabase!.from("clients").select("*").order("id")
      .then(({ data }) => { if (data?.length) setClients(data.map(mapClient)); });
  }, []);

  const handleDeleteProject = async (project: Project) => {
    if (isSupabaseEnabled) await supabase!.from("projects").delete().eq("id", project.id);
    setProjects(prev => prev.filter(p => p.id !== project.id));
  };

  const filtered = projects.filter(p => {
    const ms = p.name.includes(search) || p.client.includes(search) || p.id.includes(search);
    return ms && (statusFilter === "all" || p.status === statusFilter);
  });

  const statusOpts = [
    { value: "all", label: "すべて", count: projects.length },
    { value: "in-progress", label: "進行中", count: projects.filter(p => p.status === "in-progress").length },
    { value: "planning", label: "計画中", count: projects.filter(p => p.status === "planning").length },
    { value: "on-hold", label: "保留中", count: projects.filter(p => p.status === "on-hold").length },
    { value: "completed", label: "完了", count: projects.filter(p => p.status === "completed").length },
  ];

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>プロジェクト管理</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>進行中のプロジェクトとスプリント</p>
        </div>
        {canManage && (
          <button onClick={() => setShowDialog(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
            <Plus style={{ width: 15, height: 15 }} />新規プロジェクト
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "#B0A9A4" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="名前、クライアントで検索..."
            style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "8px 12px 8px 30px", fontSize: 12, color: "#1A1714", outline: "none", width: 240 }}
            onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; }} />
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {statusOpts.map(opt => (
            <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", fontSize: 12, fontWeight: 500, borderRadius: 8, border: "1px solid", cursor: "pointer", transition: "all 0.15s", background: statusFilter === opt.value ? "#059669" : "#FFFFFF", color: statusFilter === opt.value ? "#fff" : "#6B6458", borderColor: statusFilter === opt.value ? "#059669" : "rgba(26,23,20,0.10)" }}>
              {opt.label}
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", opacity: 0.7 }}>{opt.count}</span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{ width: 56, height: 56, background: "#F4F5F6", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <FolderKanban style={{ width: 24, height: 24, color: "#B0A9A4" }} />
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#3D3732" }}>プロジェクトが見つかりません</p>
          <p style={{ fontSize: 12, color: "#B0A9A4", marginTop: 4 }}>検索条件を変更してみてください</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {filtered.map(p => <ProjectCard key={p.id} project={p} onNavigate={() => navigate(`/projects/${p.id}/sprints`)} onDelete={canManage ? () => setDeleteTarget(p) : undefined} />)}
        </div>
      )}
      {showDialog && <NewProjectDialog onClose={() => setShowDialog(false)} clients={clients} onCreated={refreshProjects} />}
      {deleteTarget && <ConfirmDialog message={`「${deleteTarget.name}」を削除しますか？関連するスプリントとチケットもすべて削除されます。`} onConfirm={() => handleDeleteProject(deleteTarget)} onClose={() => setDeleteTarget(null)} />}
    </div>
  );
}

// ─── Clients ──────────────────────────────────────────────────────────────────
function NewClientDialog({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    if (isSupabaseEnabled) {
      setSaving(true);
      await supabase!.from("clients").insert({ id: `C-${Date.now()}`, name, industry, email, phone, status });
      setSaving(false);
    }
    onCreated?.();
    onClose();
  };

  return (
    <DialogShell title="新規クライアント追加" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave}>{saving ? "保存中..." : "保存する"}</BtnPrimary></>}>
      <FieldInput label="会社名" placeholder="例: 株式会社サンプル" required value={name} onChange={setName} />
      <FieldInput label="業界" placeholder="例: IT・通信" value={industry} onChange={setIndustry} />
      <FieldInput label="メールアドレス" type="email" placeholder="例: info@example.com" value={email} onChange={setEmail} />
      <FieldInput label="電話番号" placeholder="例: 03-1234-5678" value={phone} onChange={setPhone} />
      <FieldSelect label="ステータス" value={status} onChange={setStatus as (v: string) => void}>
        <option value="active">アクティブ</option><option value="inactive">非アクティブ</option>
      </FieldSelect>
    </DialogShell>
  );
}

function ClientsPage() {
  const { userRole } = useAuth();
  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [clients, setClients] = useState<Client[]>(CLIENTS);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const isAdmin = userRole === "admin";

  const refreshClients = () => {
    if (!isSupabaseEnabled) return;
    supabase!.from("clients").select("*").order("id")
      .then(({ data }) => { if (data?.length) setClients(data.map(mapClient)); });
  };

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!.from("clients").select("*").order("id")
      .then(({ data }) => { if (data?.length) setClients(data.map(mapClient)); });
  }, []);

  const handleDeleteClient = async (client: Client) => {
    if (isSupabaseEnabled) await supabase!.from("clients").delete().eq("id", client.id);
    setClients(prev => prev.filter(c => c.id !== client.id));
  };

  const filtered = clients.filter(c => c.name.includes(search) || c.industry.includes(search) || c.id.includes(search));

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>クライアント管理</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>取引先企業の一覧と基本情報</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowDialog(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
            <Plus style={{ width: 15, height: 15 }} />新規クライアント
          </button>
        )}
      </div>

      <div style={{ position: "relative", marginBottom: 16 }}>
        <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "#B0A9A4" }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="会社名、業界で検索..."
          style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "8px 12px 8px 30px", fontSize: 12, color: "#1A1714", outline: "none", width: 240 }}
          onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; }} />
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px 90px", padding: "10px 20px", background: "#F4F5F6", borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
          {["企業名 / 業界", "連絡先", "ステータス", "操作"].map(h => (
            <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{h}</span>
          ))}
        </div>
        {filtered.length === 0
          ? <div style={{ textAlign: "center", padding: "60px 0" }}><p style={{ fontSize: 13, color: "#A09790" }}>クライアントが見つかりません</p></div>
          : filtered.map((client, i) => (
            <div key={client.id}
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px 90px", padding: "14px 20px", alignItems: "center", borderBottom: i < filtered.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FAF8F4"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: "#F4F5F6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Building2 style={{ width: 15, height: 15, color: "#A09790" }} />
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714" }}>{client.name}</p>
                  <p style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", marginTop: 2 }}>{client.id} · {client.industry}</p>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <p style={{ fontSize: 11, color: "#6B6458", display: "flex", alignItems: "center", gap: 5 }}><Mail style={{ width: 10, height: 10, color: "#C9C4BB" }} />{client.email}</p>
                <p style={{ fontSize: 11, color: "#6B6458", display: "flex", alignItems: "center", gap: 5 }}><Phone style={{ width: 10, height: 10, color: "#C9C4BB" }} />{client.phone}</p>
              </div>
              <div>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 20, background: client.status === "active" ? "#ECFDF5" : "#F4F5F6", color: client.status === "active" ? "#059669" : "#A09790", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: client.status === "active" ? "#059669" : "#C9C4BB" }} />
                  {client.status === "active" ? "アクティブ" : "非アクティブ"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button style={{ padding: 7, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.color = "#6B6458"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                  <Eye style={{ width: 13, height: 13 }} />
                </button>
                {isAdmin && (
                  <button onClick={() => setDeleteTarget(client)} style={{ padding: 7, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                    <Trash2 style={{ width: 13, height: 13 }} />
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
      {showDialog && <NewClientDialog onClose={() => setShowDialog(false)} onCreated={refreshClients} />}
      {deleteTarget && <ConfirmDialog message={`「${deleteTarget.name}」を削除しますか？`} onConfirm={() => handleDeleteClient(deleteTarget)} onClose={() => setDeleteTarget(null)} />}
    </div>
  );
}

// ─── Members ──────────────────────────────────────────────────────────────────
function InviteDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("developer");
  const [group, setGroup] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSend = async () => {
    if (!email.trim()) return;
    setSending(true); setError("");
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, role, group }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "送信に失敗しました"); setSending(false); }
      else { setSuccess(true); setTimeout(() => { onClose(); }, 2000); }
    } catch {
      setError("ネットワークエラーが発生しました"); setSending(false);
    }
  };

  return (
    <DialogShell title="メンバーを招待" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSend}>{sending ? "送信中..." : success ? "✓ 送信しました" : "招待メールを送信"}</BtnPrimary></>}>
      {error && <div style={{ padding:"10px 14px", background:"#FEF2F2", borderRadius:8, fontSize:12, color:"#DC2626", border:"1px solid rgba(220,38,38,0.2)" }}>{error}</div>}
      {success && <div style={{ padding:"10px 14px", background:"#ECFDF5", borderRadius:8, fontSize:12, color:"#059669", border:"1px solid rgba(5,150,105,0.2)" }}>招待メールを送信しました。メールを確認してください。</div>}
      <FieldInput label="メールアドレス" type="email" placeholder="taro@example.com" required value={email} onChange={setEmail} />
      <FieldInput label="氏名（任意）" placeholder="例: 田中太郎" value={name} onChange={setName} />
      <FieldSelect label="付与する権限" value={role} onChange={setRole}>
        <option value="developer">開発者</option><option value="designer">デザイナー</option>
        <option value="project-manager">PM</option><option value="admin">管理者</option>
      </FieldSelect>
      <FieldSelect label="所属グループ" value={group} onChange={setGroup}>
        <option value="">未割り当て</option><option value="マネジメント">マネジメント</option>
        <option value="開発第1チーム">開発第1チーム</option><option value="開発第2チーム">開発第2チーム</option>
        <option value="デザインチーム">デザインチーム</option>
      </FieldSelect>
    </DialogShell>
  );
}

function MemberCard({ member, canEdit, onDelete }: { member: Member; canEdit: boolean; onDelete?: () => void }) {
  const roleColors: Record<Role, { grad: string; badge: string; text: string }> = {
    admin:             { grad: "linear-gradient(135deg,#FB7185,#F43F5E)", badge: "#FFF1F2", text: "#F43F5E" },
    "project-manager": { grad: "linear-gradient(135deg,#34D399,#059669)", badge: "#ECFDF5", text: "#059669" },
    developer:         { grad: "linear-gradient(135deg,#38BDF8,#0284C7)", badge: "#F0F9FF", text: "#0284C7" },
    designer:          { grad: "linear-gradient(135deg,#A78BFA,#7C3AED)", badge: "#F5F3FF", text: "#7C3AED" },
  };
  const rc = roleColors[member.role];
  const roleMeta = getRoleMeta(member.role);

  return (
    <div style={{ background: "#FFFFFF", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)", transition: "all 0.2s", cursor: "pointer" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 28px rgba(26,23,20,0.12)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(26,23,20,0.06), 0 4px 12px rgba(26,23,20,0.04)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>

      {/* Gradient banner — no overflow:hidden so avatar isn't clipped */}
      <div style={{ height: 60, background: rc.grad, position: "relative", borderRadius: "16px 16px 0 0", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 80% 50%, rgba(255,255,255,0.12) 0%, transparent 60%)" }} />
        <div style={{ position: "absolute", top: 12, right: 14 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.9)", background: "rgba(255,255,255,0.18)", padding: "3px 8px", borderRadius: 20, letterSpacing: "0.04em" }}>
            {roleMeta.label.toUpperCase()}
          </span>
        </div>
      </div>
      {/* Avatar — sits between banner and content, not inside banner */}
      <div style={{ position: "relative", height: 0 }}>
        <div style={{ position: "absolute", top: -20, left: 18, border: "3px solid #FFFFFF", borderRadius: "50%", boxShadow: "0 2px 8px rgba(26,23,20,0.15)", zIndex: 1 }}>
          <Avatar name={member.name} size="md" />
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "28px 18px 18px" }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>{member.name}</p>
            {member.status === "invited" && <span style={{ fontSize: 9, background: "#FFFBEB", color: "#D97706", padding: "2px 6px", borderRadius: 20, fontWeight: 600 }}>招待中</span>}
          </div>
          <p style={{ fontSize: 11, color: "#B0A9A4", marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
            <Mail style={{ width: 9, height: 9 }} />{member.email}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: rc.badge, color: rc.text }}>{roleMeta.label}</span>
            <span style={{ fontSize: 10, color: "#C9C4BB", display: "flex", alignItems: "center", gap: 3 }}>
              <Layers style={{ width: 9, height: 9 }} />{member.group}
            </span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {[{ value: member.projects, label: "PJ", accent: "#059669" }, { value: member.tickets, label: "チケット", accent: "#0284C7" }].map(({ value, label, accent }) => (
            <div key={label} style={{ background: "#F4F5F6", borderRadius: 10, padding: "12px", textAlign: "center" as const }}>
              <p style={{ fontSize: 26, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</p>
              <p style={{ fontSize: 9, color: "#B0A9A4", marginTop: 3, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em" }}>{label}</p>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 7 }}>
          <button style={{ flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <Eye style={{ width: 12, height: 12 }} />詳細
          </button>
          {canEdit && (
            <button style={{ flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; (e.currentTarget as HTMLElement).style.color = "#059669"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(5,150,105,0.25)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#6B6458"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.10)"; }}>
              <Edit2 style={{ width: 12, height: 12 }} />編集
            </button>
          )}
          {onDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ padding: "9px 10px", fontSize: 12, borderRadius: 9, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(220,38,38,0.25)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.10)"; }}>
              <Trash2 style={{ width: 12, height: 12 }} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MembersPage() {
  const { userRole } = useAuth();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("すべて");
  const [showInvite, setShowInvite] = useState(false);
  const [members, setMembers] = useState<Member[]>(MEMBERS);
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const canAdd = userRole === "admin" || userRole === "project-manager";

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!.from("profiles").select("*").order("name")
      .then(({ data }) => { if (data?.length) setMembers(data.map(mapMember)); });
  }, []);

  const handleDeleteMember = async (member: Member) => {
    try {
      const res = await fetch("/api/delete-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, memberName: member.name }),
      });
      if (res.ok) setMembers(prev => prev.filter(m => m.id !== member.id));
    } catch { /* ignore */ }
  };

  const filtered = members.filter(m => {
    return (m.name.includes(search) || m.email.includes(search)) && (group === "すべて" || m.group === group);
  });

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>メンバー管理</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>総数 {members.length} 名 · アクティブ {members.filter(m => m.status === "active").length} 名</p>
        </div>
        {canAdd && (
          <button onClick={() => setShowInvite(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
            <UserPlus style={{ width: 15, height: 15 }} />メンバー招待
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "#B0A9A4" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="名前、メールで検索..."
            style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "8px 12px 8px 30px", fontSize: 12, color: "#1A1714", outline: "none", width: 220 }}
            onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; }} />
        </div>
        <div style={{ display: "flex", gap: 4, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 9, padding: 4 }}>
          {GROUPS.map(g => (
            <button key={g} onClick={() => setGroup(g)}
              style={{ padding: "5px 10px", fontSize: 11, fontWeight: 500, borderRadius: 6, border: "none", cursor: "pointer", transition: "all 0.15s", background: group === g ? "#059669" : "transparent", color: group === g ? "#fff" : "#6B6458" }}>
              {g === "すべて" ? "ALL" : g}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0
        ? <div style={{ textAlign: "center", padding: "80px 0" }}><p style={{ fontSize: 13, color: "#A09790" }}>メンバーが見つかりません</p></div>
        : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {filtered.map(m => <MemberCard key={m.id} member={m} canEdit={canAdd} onDelete={canAdd ? () => setDeleteTarget(m) : undefined} />)}
          </div>
      }
      {showInvite && <InviteDialog onClose={() => setShowInvite(false)} />}
      {deleteTarget && <ConfirmDialog message={`「${deleteTarget.name}」をチームから削除しますか？担当チケットの割り当てもすべて解除されます。`} onConfirm={() => handleDeleteMember(deleteTarget)} onClose={() => setDeleteTarget(null)} />}
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsPage() {
  const { userName, userRole } = useAuth();
  const [tab, setTab] = useState("general");
  const [saved, setSaved] = useState(false);
  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>({ email: true, assign: true, status: false, comment: true, reminder: false });
  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2200); };
  const tabs = [{ id: "general", label: "一般" }, { id: "notifications", label: "通知" }, { id: "team", label: "チーム" }, { id: "integrations", label: "連携" }];
  const notifItems: { key: NotifKey; label: string; desc: string }[] = [
    { key: "email", label: "メール通知", desc: "重要なアップデートをメールで受け取る" },
    { key: "assign", label: "担当割り当て通知", desc: "チケットが自分に割り当てられたときに通知" },
    { key: "status", label: "ステータス変更通知", desc: "チケットのステータスが変更されたときに通知" },
    { key: "comment", label: "コメント通知", desc: "コメントが追加されたときに通知" },
    { key: "reminder", label: "リマインダー通知", desc: "期限の前日にデスクトップ通知を受け取る" },
  ];
  const integrations = [
    { name: "Slack", desc: "チャンネルに通知を送信", icon: "💬" },
    { name: "GitHub", desc: "PRとIssueをチケットにリンク", icon: "🐙" },
    { name: "Google Calendar", desc: "スプリント期間をカレンダーに同期", icon: "📅" },
  ];

  return (
    <div style={{ padding: "24px", maxWidth: 660 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>設定</h1>
        <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>アカウントとシステムの設定</p>
      </div>

      <div style={{ display: "flex", gap: 4, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: 4, marginBottom: 24, width: "fit-content" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: "7px 16px", fontSize: 13, fontWeight: 500, borderRadius: 7, border: "none", cursor: "pointer", transition: "all 0.15s", background: tab === t.id ? "#059669" : "transparent", color: tab === t.id ? "#fff" : "#6B6458" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "20px 24px" }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", marginBottom: 16 }}>システム設定</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <FieldSelect label="言語"><option value="ja">日本語</option><option value="en">English</option></FieldSelect>
              <FieldSelect label="タイムゾーン"><option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option><option value="UTC">UTC</option></FieldSelect>
            </div>
          </div>
          <button onClick={handleSave}
            style={{ padding: "10px 20px", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", transition: "all 0.2s", background: saved ? "#059669" : "#059669", color: "#fff", width: "fit-content" }}>
            {saved ? "✓ 保存しました" : "設定を保存"}
          </button>
        </div>
      )}

      {tab === "notifications" && (
        <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "20px 24px" }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", marginBottom: 4 }}>通知設定</h2>
          <p style={{ fontSize: 11, color: "#B0A9A4", marginBottom: 20 }}>通知の受け取り方をカスタマイズしてください</p>
          <div>
            {notifItems.map(({ key, label, desc }) => (
              <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500, color: "#1A1714" }}>{label}</p>
                  <p style={{ fontSize: 11, color: "#B0A9A4", marginTop: 2 }}>{desc}</p>
                </div>
                <Toggle checked={notifs[key]} onChange={() => setNotifs(prev => ({ ...prev, [key]: !prev[key] }))} />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "team" && (
        <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "20px 24px" }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", marginBottom: 16 }}>チーム情報</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px", background: "#F4F5F6", borderRadius: 10, marginBottom: 20 }}>
            <Avatar name={userName} size="lg" />
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: "#1A1714" }}>{userName}</p>
              <span style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 20, background: "#ECFDF5", color: "#059669", display: "inline-block", marginTop: 4 }}>{getRoleMeta(userRole).label}</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <FieldInput label="表示名" value={userName} readOnly />
            <div><label className={labelCls}>メンバーID</label><p style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "#6B6458", paddingTop: 10 }}>{MEMBERS.find(m => m.name === userName)?.id ?? "—"}</p></div>
          </div>
        </div>
      )}

      {tab === "integrations" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {integrations.map(({ name, desc, icon }) => (
            <div key={name} style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "#F4F5F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{icon}</div>
                <div><p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714" }}>{name}</p><p style={{ fontSize: 11, color: "#A09790", marginTop: 2 }}>{desc}</p></div>
              </div>
              <button style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", cursor: "pointer", color: "#6B6458", flexShrink: 0 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; (e.currentTarget as HTMLElement).style.color = "#059669"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(5,150,105,0.3)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#6B6458"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.12)"; }}>
                接続する
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── New Ticket Dialog ────────────────────────────────────────────────────────
function NewTicketDialog({ sprintId, onClose, onCreated }: { sprintId: string; onClose: () => void; onCreated?: () => void }) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<TicketStatus>("todo");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assignee, setAssignee] = useState(MEMBERS[0]?.name || "");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<{ name: string; url: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    if (isSupabaseEnabled) {
      setSaving(true);
      await supabase!.from("sprint_tickets").insert({
        id: `T-${Date.now()}`, sprint_id: sprintId, wbs: "",
        title, status, priority, assignee,
        start_date: startDate || null, due_date: dueDate || null,
        estimated_hours: parseInt(estimatedHours) || 0, progress: 0,
      });
      setSaving(false);
    }
    onCreated?.();
    onClose();
  };

  return (
    <DialogShell title="新規チケット作成" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave}>{saving ? "保存中..." : "作成する"}</BtnPrimary></>}>
      <FieldInput label="チケット名" placeholder="例: ログイン機能の修正" required value={title} onChange={setTitle} />
      <div className="grid grid-cols-2 gap-3">
        <FieldSelect label="ステータス" value={status} onChange={setStatus as (v: string) => void}>
          <option value="todo">未着手</option><option value="in-progress">進行中</option><option value="done">完了</option>
        </FieldSelect>
        <FieldSelect label="優先度" value={priority} onChange={setPriority as (v: string) => void}>
          <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
        </FieldSelect>
      </div>
      <FieldSelect label="担当者" value={assignee} onChange={setAssignee}>
        {MEMBERS.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
      </FieldSelect>
      <div className="grid grid-cols-2 gap-3">
        <FieldInput label="開始日" type="date" value={startDate} onChange={setStartDate} />
        <FieldInput label="終了日" type="date" value={dueDate} onChange={setDueDate} />
      </div>
      <FieldInput label="見積工数（時間）" type="number" placeholder="例: 8" value={estimatedHours} onChange={setEstimatedHours} />
      <FieldTextarea label="詳細・概要" placeholder="チケットの詳細説明、要件、受け入れ条件などを入力してください..." value={description} onChange={setDescription} />

      {/* Image upload */}
      <div>
        <label className={labelCls}>添付画像</label>
        <div style={{ border:"2px dashed rgba(26,23,20,0.12)", borderRadius:10, padding:"14px", background:"#FAFAF8" }}>
          <label style={{ display:"flex", flexDirection:"column" as const, alignItems:"center", gap:5, cursor:"pointer" }}>
            <div style={{ width:36, height:36, background:"#F4F5F6", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Plus style={{ width:16, height:16, color:"#B0A9A4" }} />
            </div>
            <span style={{ fontSize:12, color:"#B0A9A4" }}>クリックして画像を選択</span>
            <span style={{ fontSize:10, color:"#C9C4BB" }}>PNG, JPG, GIF, WebP 対応</span>
            <input type="file" accept="image/*" multiple style={{ display:"none" }}
              onChange={e => {
                Array.from(e.target.files || []).forEach(file => {
                  if (!file.type.startsWith("image/")) return;
                  setImages(prev => [...prev, { name: file.name, url: URL.createObjectURL(file) }]);
                });
                e.target.value = "";
              }} />
          </label>
          {images.length > 0 && (
            <div style={{ display:"flex", flexWrap:"wrap" as const, gap:8, marginTop:10 }}>
              {images.map((img, i) => (
                <div key={i} style={{ position:"relative", width:68, height:68 }}>
                  <img src={img.url} alt={img.name} style={{ width:68, height:68, objectFit:"cover" as const, borderRadius:7, border:"1px solid rgba(26,23,20,0.10)" }} />
                  <button onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                    style={{ position:"absolute", top:-5, right:-5, width:18, height:18, borderRadius:"50%", background:"#1A1714", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <X style={{ width:10, height:10, color:"#fff" }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  );
}

// ─── Ticket Detail Panel ───────────────────────────────────────────────────────
function TicketDetailPanel({ ticket, onClose, onUpdated }: { ticket: SprintTicket | null; onClose: () => void; onUpdated?: () => void }) {
  const [newStatus, setNewStatus] = useState<TicketStatus>("todo");
  const [updating, setUpdating] = useState(false);

  useEffect(() => { if (ticket) setNewStatus(ticket.status); }, [ticket?.id]);

  const handleStatusUpdate = async () => {
    if (!ticket || newStatus === ticket.status) { onClose(); return; }
    if (isSupabaseEnabled) {
      setUpdating(true);
      await supabase!.from("sprint_tickets").update({ status: newStatus }).eq("id", ticket.id);
      setUpdating(false);
    }
    onUpdated?.();
    onClose();
  };

  if (!ticket) return null;
  const todayStr = new Date().toISOString().split("T")[0];
  const isOverdue = ticket.status !== "done" && ticket.dueDate < todayStr;
  const statusMeta = ticket.status === "done"
    ? { label:"完了",   bg:"#ECFDF5", color:"#059669", border:"none" }
    : ticket.status === "in-progress"
    ? { label:"進行中", bg:"#FFF7ED", color:"#D97706", border:"none" }
    : { label:"未着手", bg:"#FEF2F2", color:"#DC2626", border:"1px solid rgba(220,38,38,0.30)" };
  const priorityMeta = ticket.priority === "high"
    ? { label:"高", bg:"#FEF2F2", color:"#DC2626" }
    : ticket.priority === "medium"
    ? { label:"中", bg:"#FFFBEB", color:"#D97706" }
    : { label:"低", bg:"#F0F9FF", color:"#0284C7" };
  const barColor = ticket.progress === 100 ? "#059669" : ticket.status === "in-progress" ? "#D97706" : "#C9C4BB";

  return (
    <>
      <style>{`@keyframes slideInPanel{from{transform:translateX(102%)}to{transform:translateX(0)}}`}</style>
      <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(10,14,12,0.30)", backdropFilter:"blur(3px)" }} />
      <div style={{ position:"fixed", top:0, right:0, bottom:0, width:"48%", minWidth:420, background:"#FAFAF8", zIndex:201, boxShadow:"-16px 0 60px rgba(0,0,0,0.18)", overflowY:"auto", animation:"slideInPanel 0.28s cubic-bezier(0.16,1,0.3,1)" }}>

        {/* Sticky header */}
        <div style={{ padding:"22px 24px 18px", borderBottom:"1px solid rgba(26,23,20,0.07)", background:"#FFFFFF", position:"sticky", top:0, zIndex:10 }}>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                <span style={{ fontSize:10, color:"#B0A9A4", fontFamily:"var(--font-mono)", background:"#F4F5F6", padding:"2px 8px", borderRadius:5 }}>{ticket.id}</span>
                <span style={{ fontSize:10, color:"#C9C4BB", fontFamily:"var(--font-mono)" }}>WBS {ticket.wbs}</span>
              </div>
              <h2 style={{ fontSize:18, fontWeight:800, color:"#1A1714", fontFamily:"var(--font-heading)", letterSpacing:"-0.025em", lineHeight:1.25, marginBottom:10 }}>{ticket.title}</h2>
              <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" as const }}>
                <span style={{ fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:20, background:statusMeta.bg, color:statusMeta.color, border:statusMeta.border }}>{statusMeta.label}</span>
                <span style={{ fontSize:10, fontWeight:600, padding:"3px 10px", borderRadius:20, background:priorityMeta.bg, color:priorityMeta.color }}>優先度: {priorityMeta.label}</span>
                {isOverdue && <span style={{ fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:20, background:"#FEF2F2", color:"#DC2626", border:"1px solid rgba(220,38,38,0.3)" }}>期限超過</span>}
              </div>
            </div>
            <button onClick={onClose} style={{ padding:7, borderRadius:9, border:"none", background:"transparent", cursor:"pointer", color:"#B0A9A4", flexShrink:0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <X style={{ width:16, height:16 }} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding:"20px 24px", display:"flex", flexDirection:"column", gap:16 }}>

          {/* Progress */}
          <div style={{ background:"#FFFFFF", border:"1px solid rgba(26,23,20,0.07)", borderRadius:12, padding:"14px 16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <span style={{ fontSize:11, fontWeight:700, color:"#6B6458" }}>進捗状況</span>
              <span style={{ fontSize:16, fontWeight:800, color:"#1A1714", fontFamily:"var(--font-heading)" }}>{ticket.progress}%</span>
            </div>
            <div style={{ height:8, background:"#EDE9E0", borderRadius:99, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${ticket.progress}%`, background:barColor, borderRadius:99, transition:"width 0.6s ease" }} />
            </div>
          </div>

          {/* Meta grid */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            {[
              { label:"担当者", content:(
                <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                  <Avatar name={ticket.assignee} size="xs" />
                  <span style={{ fontSize:13, color:"#1A1714", fontWeight:600 }}>{ticket.assignee}</span>
                </div>
              )},
              { label:"見積工数", content:<span style={{ fontSize:14, fontWeight:800, color:"#1A1714", fontFamily:"var(--font-heading)" }}>{ticket.estimatedHours}<span style={{ fontSize:11, fontWeight:400, color:"#9E9690", marginLeft:2 }}>h</span></span> },
              { label:"開始日", content:<span style={{ fontSize:12, fontFamily:"var(--font-mono)", color:"#6B6458" }}>{ticket.startDate}</span> },
              { label:"期限日", content:<span style={{ fontSize:12, fontFamily:"var(--font-mono)", fontWeight:isOverdue ? 700 : 400, color:isOverdue ? "#DC2626" : "#6B6458" }}>{ticket.dueDate}{isOverdue ? " ⚠" : ""}</span> },
            ].map(({ label, content }) => (
              <div key={label} style={{ background:"#FFFFFF", border:"1px solid rgba(26,23,20,0.07)", borderRadius:10, padding:"12px 14px" }}>
                <p style={{ fontSize:9, color:"#B0A9A4", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.07em", marginBottom:6 }}>{label}</p>
                {content}
              </div>
            ))}
          </div>

          {/* Description */}
          <div>
            <p style={{ fontSize:10, color:"#B0A9A4", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.07em", marginBottom:8 }}>詳細・説明</p>
            <div style={{ background:"#FFFFFF", border:"1px solid rgba(26,23,20,0.07)", borderRadius:10, padding:"14px", minHeight:96, color:"#A09790", fontSize:12, lineHeight:1.8 }}>
              チケットの詳細説明がここに表示されます。担当者が追加した要件・受け入れ条件などが記録されます。
            </div>
          </div>

          {/* Attachments */}
          <div>
            <p style={{ fontSize:10, color:"#B0A9A4", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.07em", marginBottom:8 }}>添付ファイル</p>
            <div style={{ background:"#FFFFFF", border:"2px dashed rgba(26,23,20,0.10)", borderRadius:10, padding:"24px", textAlign:"center" as const }}>
              <div style={{ width:36, height:36, background:"#F4F5F6", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 8px" }}>
                <Plus style={{ width:16, height:16, color:"#C9C4BB" }} />
              </div>
              <p style={{ fontSize:11, color:"#B0A9A4" }}>添付ファイルなし</p>
            </div>
          </div>

          {/* Status Update */}
          <div style={{ background:"#FFFFFF", border:"1px solid rgba(26,23,20,0.07)", borderRadius:12, padding:"14px 16px" }}>
            <p style={{ fontSize:11, fontWeight:700, color:"#6B6458", marginBottom:10 }}>ステータス変更</p>
            <div style={{ display:"flex", gap:6, marginBottom:12 }}>
              {([ ["todo","未着手","#DC2626","#FEF2F2"], ["in-progress","進行中","#D97706","#FFF7ED"], ["done","完了","#059669","#ECFDF5"] ] as [TicketStatus,string,string,string][]).map(([s,l,c,bg]) => (
                <button key={s} onClick={() => setNewStatus(s)}
                  style={{ flex:1, padding:"7px 0", fontSize:11, fontWeight:700, borderRadius:8, border:`1.5px solid ${newStatus===s?c:"rgba(26,23,20,0.10)"}`, background:newStatus===s?bg:"transparent", color:newStatus===s?c:"#9E9690", cursor:"pointer", transition:"all 0.15s" }}>
                  {l}
                </button>
              ))}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <BtnPrimary onClick={handleStatusUpdate}>{updating ? "更新中..." : "ステータスを更新"}</BtnPrimary>
              <BtnSecondary onClick={onClose}>閉じる</BtnSecondary>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Sprint Detail (WBS) ─────────────────────────────────────────────────────
type SortCol = "wbs" | "title" | "status" | "priority" | "startDate" | "dueDate" | "estimatedHours" | "progress";

function SprintDetailPage() {
  const { projectId, sprintId } = useParams<{ projectId: string; sprintId: string }>();
  const navigate = useNavigate();
  const project = PROJECTS.find(p => p.id === projectId) || null;
  const [sprint, setSprint] = useState<Sprint | null>(SPRINTS.find(s => s.id === sprintId) || null);

  const [sortCol, setSortCol] = useState<SortCol>("wbs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterStatus, setFilterStatus] = useState<TicketStatus | "all">("all");
  const [filterPriority, setFilterPriority] = useState<Priority | "all">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<SprintTicket | null>(null);
  const [deleteTicketTarget, setDeleteTicketTarget] = useState<SprintTicket | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled || !sprintId) return;
    supabase!.from("sprints").select("*, sprint_tickets(*)").eq("id", sprintId).single()
      .then(({ data }) => { if (data) setSprint(mapSprint(data)); });
  }, [sprintId]);

  const refreshSprint = () => {
    if (!isSupabaseEnabled || !sprintId) return;
    supabase!.from("sprints").select("*, sprint_tickets(*)").eq("id", sprintId).single()
      .then(({ data }) => { if (data) setSprint(mapSprint(data)); });
  };

  const handleDeleteTicket = async (ticket: SprintTicket) => {
    if (isSupabaseEnabled) await supabase!.from("sprint_tickets").delete().eq("id", ticket.id);
    refreshSprint();
    if (!isSupabaseEnabled && sprint) {
      setSprint({ ...sprint, tickets: sprint.tickets.filter(t => t.id !== ticket.id) });
    }
  };

  if (!project || !sprint) return <Navigate to="/projects" replace />;

  const done = sprint.tickets.filter(t => t.status === "done").length;
  const inProg = sprint.tickets.filter(t => t.status === "in-progress").length;
  const progress = sprintProgress(sprint);
  const totalHours = sprint.tickets.reduce((s, t) => s + t.estimatedHours, 0);
  const sm = getSprintStatusMeta(sprint.status);

  const statusOrder: Record<TicketStatus, number> = { todo: 0, "in-progress": 1, done: 2 };
  const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

  const displayTickets = [...sprint.tickets]
    .filter(t => (filterStatus === "all" || t.status === filterStatus) && (filterPriority === "all" || t.priority === filterPriority))
    .sort((a, b) => {
      let v = 0;
      if (sortCol === "wbs") v = a.wbs.localeCompare(b.wbs);
      else if (sortCol === "title") v = a.title.localeCompare(b.title);
      else if (sortCol === "status") v = statusOrder[a.status] - statusOrder[b.status];
      else if (sortCol === "priority") v = priorityOrder[a.priority] - priorityOrder[b.priority];
      else if (sortCol === "startDate") v = a.startDate.localeCompare(b.startDate);
      else if (sortCol === "dueDate") v = a.dueDate.localeCompare(b.dueDate);
      else if (sortCol === "estimatedHours") v = a.estimatedHours - b.estimatedHours;
      else if (sortCol === "progress") v = a.progress - b.progress;
      return sortDir === "asc" ? v : -v;
    });

  const SortTh = ({ col, label }: { col: SortCol; label: string }) => {
    const active = sortCol === col;
    return (
      <button onClick={() => { if (active) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("asc"); } }}
        style={{ display:"flex", alignItems:"center", gap:3, background:"none", border:"none", cursor:"pointer", padding:0, fontSize:10, fontWeight:700, color:active ? "#059669" : "#B0A9A4", textTransform:"uppercase" as const, letterSpacing:"0.06em" }}>
        {label}{active && <span style={{ fontSize:9 }}>{sortDir === "asc" ? " ↑" : " ↓"}</span>}
      </button>
    );
  };

  return (
    <div style={{ padding:"24px" }}>
      {/* Breadcrumb */}
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:18, fontSize:12 }}>
        <button onClick={() => navigate("/projects")} style={{ color:"#059669", fontWeight:600, background:"none", border:"none", cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", gap:4 }}>
          <FolderKanban style={{ width:12, height:12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width:10, height:10, color:"#C9C4BB" }} />
        <button onClick={() => navigate(`/projects/${projectId}/sprints`)} style={{ color:"#059669", fontWeight:600, background:"none", border:"none", cursor:"pointer", fontSize:12 }}>
          スプリント一覧
        </button>
        <ChevronRight style={{ width:10, height:10, color:"#C9C4BB" }} />
        <span style={{ color:"#1A1714", fontWeight:600 }}>{sprint.name}</span>
      </div>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:16 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
            <h1 style={{ fontSize:20, fontWeight:800, color:"#1A1714", fontFamily:"var(--font-heading)", letterSpacing:"-0.02em" }}>{sprint.name}</h1>
            <span style={{ fontSize:10, fontWeight:700, padding:"2px 10px", borderRadius:20, background:sm.bg, color:sm.color }}>{sm.label}</span>
          </div>
          <p style={{ fontSize:12, color:"#A09790" }}>{sprint.goal}</p>
          <p style={{ fontSize:11, color:"#B0A9A4", marginTop:4, fontFamily:"var(--font-mono)" }}>{formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}</p>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <div style={{ display:"flex", gap:10 }}>
            {[
              { label:"チケット数", value:sprint.tickets.length },
              { label:"完了", value:done },
              { label:"進行中", value:inProg },
              { label:"総工数(h)", value:totalHours },
              { label:"進捗", value:`${progress}%` },
            ].map(({ label, value }) => (
              <div key={label} style={{ background:"#FFFFFF", borderRadius:10, padding:"10px 14px", border:"1px solid rgba(26,23,20,0.08)", textAlign:"center" as const }}>
                <p style={{ fontSize:20, fontWeight:800, color:"#1A1714", fontFamily:"var(--font-heading)", letterSpacing:"-0.03em" }}>{value}</p>
                <p style={{ fontSize:10, color:"#B0A9A4", marginTop:2 }}>{label}</p>
              </div>
            ))}
          </div>
          <button onClick={() => setShowCreate(true)}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"9px 16px", background:"#059669", color:"#fff", fontSize:13, fontWeight:600, borderRadius:10, border:"none", cursor:"pointer", boxShadow:"0 2px 8px rgba(5,150,105,0.25)", flexShrink:0 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
            <Plus style={{ width:15, height:15 }} />チケット作成
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ fontSize:10, color:"#B0A9A4", fontWeight:600, letterSpacing:"0.05em" }}>ステータス</span>
          {([ ["all","すべて"], ["todo","未着手"], ["in-progress","進行中"], ["done","完了"] ] as [TicketStatus|"all", string][]).map(([v, l]) => (
            <button key={v} onClick={() => setFilterStatus(v)}
              style={{ padding:"4px 10px", fontSize:11, borderRadius:7, border:"1px solid", cursor:"pointer", fontWeight:500, transition:"all 0.12s",
                background:filterStatus === v ? "#059669" : "transparent",
                color:filterStatus === v ? "#fff" : "#6B6458",
                borderColor:filterStatus === v ? "#059669" : "rgba(26,23,20,0.10)" }}>
              {l}
            </button>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ fontSize:10, color:"#B0A9A4", fontWeight:600, letterSpacing:"0.05em" }}>優先度</span>
          {([ ["all","すべて"], ["high","高"], ["medium","中"], ["low","低"] ] as [Priority|"all", string][]).map(([v, l]) => (
            <button key={v} onClick={() => setFilterPriority(v)}
              style={{ padding:"4px 10px", fontSize:11, borderRadius:7, border:"1px solid", cursor:"pointer", fontWeight:500, transition:"all 0.12s",
                background:filterPriority === v ? "#059669" : "transparent",
                color:filterPriority === v ? "#fff" : "#6B6458",
                borderColor:filterPriority === v ? "#059669" : "rgba(26,23,20,0.10)" }}>
              {l}
            </button>
          ))}
        </div>
        {displayTickets.length !== sprint.tickets.length && (
          <span style={{ fontSize:11, color:"#B0A9A4", fontFamily:"var(--font-mono)" }}>{displayTickets.length} / {sprint.tickets.length} 件</span>
        )}
      </div>

      {/* WBS Table */}
      <div style={{ background:"#FFFFFF", borderRadius:14, overflow:"hidden", border:"1px solid rgba(26,23,20,0.08)", boxShadow:"0 1px 2px rgba(0,0,0,0.04)" }}>
        <div style={{ display:"grid", gridTemplateColumns:"56px 1fr 90px 60px 100px 72px 72px 52px 130px 36px", padding:"10px 16px", background:"#F4F5F6", borderBottom:"1px solid rgba(26,23,20,0.06)", gap:8, alignItems:"center" }}>
          <SortTh col="wbs" label="WBS" />
          <SortTh col="title" label="チケット名" />
          <SortTh col="status" label="ステータス" />
          <SortTh col="priority" label="優先度" />
          <span style={{ fontSize:10, fontWeight:700, color:"#B0A9A4", textTransform:"uppercase" as const, letterSpacing:"0.06em" }}>担当者</span>
          <SortTh col="startDate" label="開始日" />
          <SortTh col="dueDate" label="終了日" />
          <SortTh col="estimatedHours" label="工数" />
          <SortTh col="progress" label="進捗" />
          <span />
        </div>
        {displayTickets.length === 0 ? (
          <div style={{ padding:"40px 0", textAlign:"center" as const, color:"#B0A9A4", fontSize:13 }}>条件に一致するチケットがありません</div>
        ) : displayTickets.map((ticket, i) => {
          const statusBg = ticket.status === "done" ? "#ECFDF5" : ticket.status === "in-progress" ? "#FFF7ED" : "#F4F5F6";
          const statusColor = ticket.status === "done" ? "#059669" : ticket.status === "in-progress" ? "#D97706" : "#9E9690";
          const statusLabel = ticket.status === "done" ? "完了" : ticket.status === "in-progress" ? "進行中" : "未着手";
          const priBg = ticket.priority === "high" ? "#FEF2F2" : ticket.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
          const priColor = ticket.priority === "high" ? "#DC2626" : ticket.priority === "medium" ? "#D97706" : "#0284C7";
          const priLabel = ticket.priority === "high" ? "高" : ticket.priority === "medium" ? "中" : "低";
          const barColor = ticket.progress === 100 ? "#059669" : ticket.status === "in-progress" ? "#D97706" : "#C9C4BB";
          return (
            <div key={ticket.id} onClick={() => setSelectedTicket(ticket)} style={{ display:"grid", gridTemplateColumns:"56px 1fr 90px 60px 100px 72px 72px 52px 130px 36px", padding:"11px 16px", alignItems:"center", gap:8, borderBottom:i < displayTickets.length - 1 ? "1px solid rgba(26,23,20,0.04)" : "none", background:i % 2 === 1 ? "rgba(26,23,20,0.012)" : "transparent", transition:"background 0.1s", cursor:"pointer" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FFF7F3"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 === 1 ? "rgba(26,23,20,0.012)" : "transparent"; }}>
              <span style={{ fontSize:11, fontFamily:"var(--font-mono)", color:"#B0A9A4", fontWeight:600 }}>{ticket.wbs}</span>
              <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                <div style={{ width:4, height:4, borderRadius:"50%", background:priColor, flexShrink:0 }} />
                <span style={{ fontSize:12, fontWeight:500, color:"#1A1714", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>{ticket.title}</span>
              </div>
              <span style={{ fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:20, background:statusBg, color:statusColor, display:"inline-block" }}>{statusLabel}</span>
              <span style={{ fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:20, background:priBg, color:priColor, display:"inline-block" }}>{priLabel}</span>
              <div style={{ display:"flex", alignItems:"center", gap:5, overflow:"hidden" }}>
                <Avatar name={ticket.assignee} size="xs" />
                <span style={{ fontSize:11, color:"#6B6458", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>{ticket.assignee.split(/[\s　]/)[0]}</span>
              </div>
              <span style={{ fontSize:11, color:"#B0A9A4", fontFamily:"var(--font-mono)" }}>{formatDate(ticket.startDate)}</span>
              <span style={{ fontSize:11, color:"#B0A9A4", fontFamily:"var(--font-mono)" }}>{formatDate(ticket.dueDate)}</span>
              <span style={{ fontSize:11, color:"#6B6458", fontFamily:"var(--font-mono)", fontWeight:600 }}>{ticket.estimatedHours}h</span>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ flex:1, height:5, background:"#EDE9E0", borderRadius:99, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${ticket.progress}%`, background:barColor, borderRadius:99 }} />
                </div>
                <span style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"#6B6458", fontWeight:600, minWidth:28 }}>{ticket.progress}%</span>
              </div>
              <button onClick={e => { e.stopPropagation(); setDeleteTicketTarget(ticket); }}
                style={{ padding:4, borderRadius:6, border:"none", background:"transparent", cursor:"pointer", color:"#D5D0CB" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                <Trash2 style={{ width:12, height:12 }} />
              </button>
            </div>
          );
        })}
      </div>
      {showCreate && <NewTicketDialog sprintId={sprintId!} onClose={() => setShowCreate(false)} onCreated={refreshSprint} />}
      {deleteTicketTarget && <ConfirmDialog message={`「${deleteTicketTarget.title}」を削除しますか？`} onConfirm={() => handleDeleteTicket(deleteTicketTarget)} onClose={() => setDeleteTicketTarget(null)} />}
      <TicketDetailPanel ticket={selectedTicket} onClose={() => setSelectedTicket(null)} onUpdated={refreshSprint} />
    </div>
  );
}

// ─── Sprint List / Board / Gantt Views ───────────────────────────────────────

function SprintListView({ sprints, onSelectSprint, onDeleteSprint }: { sprints: Sprint[]; onSelectSprint: (s: Sprint) => void; onDeleteSprint?: (s: Sprint) => void }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {sprints.map(sprint => {
        const sm = getSprintStatusMeta(sprint.status);
        const progress = sprintProgress(sprint);
        const done = sprint.tickets.filter(t => t.status === "done").length;
        const inProg = sprint.tickets.filter(t => t.status === "in-progress").length;
        const totalHours = sprint.tickets.reduce((s, t) => s + t.estimatedHours, 0);
        return (
          <div key={sprint.id} onClick={() => onSelectSprint(sprint)}
            style={{ background:"#FFFFFF", borderRadius:14, padding:"18px 20px", border:"1px solid rgba(26,23,20,0.08)", cursor:"pointer", transition:"all 0.2s", boxShadow:"0 1px 2px rgba(0,0,0,0.04)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.10)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 2px rgba(0,0,0,0.04)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:9, color:"#B0A9A4", fontFamily:"var(--font-mono)" }}>{sprint.id}</span>
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20, background:sm.bg, color:sm.color }}>{sm.label}</span>
                </div>
                <h3 style={{ fontSize:15, fontWeight:700, color:"#1A1714", fontFamily:"var(--font-heading)", letterSpacing:"-0.02em", marginBottom:4 }}>{sprint.name}</h3>
                <p style={{ fontSize:11, color:"#A09790" }}>{sprint.goal}</p>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:16, flexShrink:0, marginLeft:20 }}>
                {[{ label:"チケット", value:sprint.tickets.length }, { label:"完了", value:done }, { label:"進行中", value:inProg }, { label:"工数(h)", value:totalHours }].map(({ label, value }) => (
                  <div key={label} style={{ textAlign:"center" as const }}>
                    <p style={{ fontSize:18, fontWeight:800, color:"#1A1714", fontFamily:"var(--font-heading)", letterSpacing:"-0.03em" }}>{value}</p>
                    <p style={{ fontSize:10, color:"#B0A9A4" }}>{label}</p>
                  </div>
                ))}
                {onDeleteSprint && (
                  <button onClick={e => { e.stopPropagation(); onDeleteSprint(sprint); }}
                    style={{ padding:6, borderRadius:7, border:"none", background:"transparent", cursor:"pointer", color:"#C9C4BB", flexShrink:0 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                    <Trash2 style={{ width:14, height:14 }} />
                  </button>
                )}
              </div>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                <span style={{ fontSize:10, color:"#B0A9A4" }}>進捗 <span style={{ fontFamily:"var(--font-mono)", color:"#6B6458", fontWeight:700 }}>{progress}%</span></span>
                <span style={{ fontSize:10, color:"#B0A9A4", fontFamily:"var(--font-mono)" }}>{formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}</span>
              </div>
              <ProgressBar value={progress} />
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingTop:10, borderTop:"1px solid rgba(26,23,20,0.05)" }}>
              <div style={{ display:"flex", gap:12 }}>
                <span style={{ fontSize:10, color:"#059669", fontFamily:"var(--font-mono)", display:"flex", alignItems:"center", gap:4 }}><CheckCircle2 style={{ width:10, height:10 }} />{done}</span>
                <span style={{ fontSize:10, color:"#D97706", fontFamily:"var(--font-mono)", display:"flex", alignItems:"center", gap:4 }}><Zap style={{ width:10, height:10 }} />{inProg}</span>
                <span style={{ fontSize:10, color:"#C9C4BB", fontFamily:"var(--font-mono)", display:"flex", alignItems:"center", gap:4 }}><Circle style={{ width:10, height:10 }} />{sprint.tickets.filter(t => t.status === "todo").length}</span>
              </div>
              <div style={{ display:"flex" }}>
                {[...new Set(sprint.tickets.map(t => t.assignee))].slice(0, 4).map((name, i) => (
                  <div key={name} style={{ marginLeft:i === 0 ? 0 : -6, border:"2px solid #fff", borderRadius:"50%" }}>
                    <Avatar name={name} size="xs" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SprintBoardView({ sprints, onSelectSprint }: { sprints: Sprint[]; onSelectSprint: (s: Sprint) => void }) {
  const columns: { status: SprintStatus; label: string; color: string; bg: string }[] = [
    { status:"planning",  label:"計画中", color:"#6B6458", bg:"#F4F5F6" },
    { status:"active",    label:"進行中", color:"#059669", bg:"#ECFDF5" },
    { status:"completed", label:"完了",   color:"#0284C7", bg:"#F0F9FF" },
    { status:"cancelled", label:"中止",   color:"#DC2626", bg:"#FEF2F2" },
  ];
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16 }}>
      {columns.map(col => {
        const colSprints = sprints.filter(s => s.status === col.status);
        return (
          <div key={col.status}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:12 }}>
              <span style={{ fontSize:11, fontWeight:700, color:col.color }}>{col.label}</span>
              <span style={{ fontSize:10, background:col.bg, color:col.color, padding:"1px 7px", borderRadius:20, fontFamily:"var(--font-mono)", fontWeight:600 }}>{colSprints.length}</span>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {colSprints.map(sprint => {
                const progress = sprintProgress(sprint);
                return (
                  <div key={sprint.id} onClick={() => onSelectSprint(sprint)}
                    style={{ background:"#FFFFFF", borderRadius:12, padding:"14px", border:"1px solid rgba(26,23,20,0.08)", cursor:"pointer", transition:"all 0.2s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.10)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
                    <p style={{ fontSize:12, fontWeight:700, color:"#1A1714", marginBottom:6, lineHeight:1.3 }}>{sprint.name}</p>
                    <p style={{ fontSize:10, color:"#A09790", marginBottom:10, lineHeight:1.4 }}>{sprint.goal}</p>
                    <ProgressBar value={progress} />
                    <div style={{ display:"flex", justifyContent:"space-between", marginTop:8 }}>
                      <span style={{ fontSize:10, color:"#B0A9A4", fontFamily:"var(--font-mono)" }}>{sprint.tickets.length}チケット</span>
                      <span style={{ fontSize:10, color:"#6B6458", fontFamily:"var(--font-mono)", fontWeight:700 }}>{progress}%</span>
                    </div>
                    <p style={{ fontSize:10, color:"#B0A9A4", marginTop:6, fontFamily:"var(--font-mono)" }}>{formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}</p>
                  </div>
                );
              })}
              {colSprints.length === 0 && <div style={{ padding:"24px 0", textAlign:"center" as const, color:"#C9C4BB", fontSize:12 }}>なし</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SprintGanttView({ sprints, onSelectSprint, onSelectTicket }: { sprints: Sprint[]; onSelectSprint: (s: Sprint) => void; onSelectTicket?: (t: SprintTicket) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const DAY_W = 8;
  if (!sprints.length) return null;

  const minDate = sprints.reduce((m, s) => s.startDate < m ? s.startDate : m, sprints[0].startDate);
  const maxDate = sprints.reduce((m, s) => s.endDate > m ? s.endDate : m, sprints[0].endDate);
  const totalDays = daysBetween(minDate, maxDate) + 1;
  const getLeft = (d: string) => daysBetween(minDate, d) * DAY_W;
  const getWidth = (s: string, e: string) => (daysBetween(s, e) + 1) * DAY_W;
  const todayStr = new Date().toISOString().split("T")[0];
  const todayLeft = todayStr >= minDate && todayStr <= maxDate ? getLeft(todayStr) : -1;

  // Month data with year/month separate
  const months: { year: number; month: number; label: string; left: number; width: number }[] = [];
  const startD = new Date(minDate);
  const endD = new Date(maxDate);
  let cur = new Date(startD.getFullYear(), startD.getMonth(), 1);
  while (cur <= endD) {
    const mStart = new Date(cur);
    const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const effStart = mStart < startD ? startD : mStart;
    const effEnd = mEnd > endD ? endD : mEnd;
    const days = daysBetween(effStart.toISOString().split("T")[0], effEnd.toISOString().split("T")[0]) + 1;
    months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1, label: `${cur.getMonth() + 1}月`, left: getLeft(effStart.toISOString().split("T")[0]), width: days * DAY_W });
    cur.setMonth(cur.getMonth() + 1);
  }

  // Year spans (group consecutive months by year)
  const yearSpans: { year: number; left: number; width: number }[] = [];
  months.forEach(m => {
    const last = yearSpans[yearSpans.length - 1];
    if (last && last.year === m.year) { last.width += m.width; }
    else { yearSpans.push({ year: m.year, left: m.left, width: m.width }); }
  });

  // Week lines (every 7 days)
  const weekLines: number[] = [];
  for (let d = 7; d < totalDays; d += 7) weekLines.push(d * DAY_W);

  const LEFT_W = 230;
  const ROW_H = 44;
  const TICK_ROW_H = 30;
  const YEAR_H = 22;
  const MON_H = 28;
  const HDR_H = YEAR_H + MON_H;

  const GridLines = () => (
    <>
      {weekLines.map(x => (
        <div key={x} style={{ position:"absolute", top:0, bottom:0, left:x, width:1, background:"rgba(26,23,20,0.04)", pointerEvents:"none" }} />
      ))}
      {months.map((m, i) => (
        <div key={i} style={{ position:"absolute", top:0, bottom:0, left:m.left + m.width - 1, width:1, background:"rgba(26,23,20,0.10)", pointerEvents:"none" }} />
      ))}
      {todayLeft >= 0 && <div style={{ position:"absolute", top:0, bottom:0, left:todayLeft, width:2, background:"#059669", opacity:0.5, pointerEvents:"none" }} />}
    </>
  );

  return (
    <div style={{ background:"#FFFFFF", borderRadius:14, border:"1px solid rgba(26,23,20,0.08)", overflow:"hidden" }}>
      <div style={{ display:"flex" }}>
        {/* Left label panel */}
        <div style={{ width:LEFT_W, flexShrink:0, borderRight:"1px solid rgba(26,23,20,0.07)" }}>
          {/* Header matching two-row timeline header */}
          <div style={{ height:HDR_H, borderBottom:"1px solid rgba(26,23,20,0.07)", background:"#F4F5F6", display:"flex", alignItems:"center", padding:"0 14px" }}>
            <span style={{ fontSize:10, fontWeight:700, color:"#B0A9A4", textTransform:"uppercase" as const, letterSpacing:"0.06em" }}>スプリント</span>
          </div>
          {sprints.map(sprint => {
            const isExp = expanded.has(sprint.id);
            const sm = getSprintStatusMeta(sprint.status);
            return (
              <div key={sprint.id}>
                <div style={{ height:ROW_H, borderBottom:"1px solid rgba(26,23,20,0.05)", padding:"0 8px 0 10px", display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}
                  onClick={() => { const n = new Set(expanded); n.has(sprint.id) ? n.delete(sprint.id) : n.add(sprint.id); setExpanded(n); }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F9F8F6"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <ChevronDown style={{ width:11, height:11, color:"#B0A9A4", transform:isExp ? "rotate(0deg)" : "rotate(-90deg)", transition:"transform 0.2s", flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:11, fontWeight:700, color:"#1A1714", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>{sprint.name}</p>
                    <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:2 }}>
                      <span style={{ fontSize:9, fontWeight:600, color:sm.color }}>{sm.label}</span>
                      <span style={{ fontSize:9, color:"#B0A9A4", fontFamily:"var(--font-mono)" }}>{sprintProgress(sprint)}%</span>
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); onSelectSprint(sprint); }}
                    title="チケット一覧を開く"
                    style={{ padding:4, borderRadius:5, border:"none", background:"transparent", cursor:"pointer", color:"#C9C4BB", flexShrink:0, display:"flex", alignItems:"center" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                    <ExternalLink style={{ width:11, height:11 }} />
                  </button>
                </div>
                {isExp && sprint.tickets.map(t => {
                  const isTodo = t.status === "todo";
                  const dotColor = t.status === "done" ? "#059669" : t.status === "in-progress" ? "#D97706" : "#C9C4BB";
                  const sBg = t.status === "done" ? "#ECFDF5" : t.status === "in-progress" ? "#FFF7ED" : "#FEF2F2";
                  const sColor = t.status === "done" ? "#059669" : t.status === "in-progress" ? "#D97706" : "#DC2626";
                  const sLabel = t.status === "done" ? "完了" : t.status === "in-progress" ? "進行中" : "未着手";
                  return (
                    <div key={t.id}
                      onClick={() => onSelectTicket?.(t)}
                      style={{ height:TICK_ROW_H, borderBottom:"1px solid rgba(26,23,20,0.03)", padding:"0 8px 0 28px", display:"flex", alignItems:"center", gap:5, background:isTodo ? "rgba(220,38,38,0.03)" : "rgba(26,23,20,0.012)", cursor:"pointer" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isTodo ? "rgba(220,38,38,0.07)" : "#F0F9F5"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isTodo ? "rgba(220,38,38,0.03)" : "rgba(26,23,20,0.012)"; }}>
                      <div style={{ width:5, height:5, borderRadius:"50%", background:dotColor, flexShrink:0 }} />
                      <span style={{ fontSize:10, color:"#6B6458", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const, flex:1 }}>{t.title}</span>
                      <span style={{ fontSize:8, fontWeight:700, padding:"1px 5px", borderRadius:10, background:sBg, color:sColor, flexShrink:0, border:isTodo ? "1px solid rgba(220,38,38,0.25)" : "none" }}>{sLabel}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Right timeline panel */}
        <div style={{ flex:1, overflowX:"auto" }}>
          <div style={{ width: Math.max(totalDays * DAY_W, 600), position:"relative" }}>
            {/* Year header row */}
            <div style={{ height:YEAR_H, background:"#EDEAE5", borderBottom:"1px solid rgba(26,23,20,0.08)", position:"relative" }}>
              {yearSpans.map((y, i) => (
                <div key={i} style={{ position:"absolute", left:y.left, width:y.width, height:"100%", display:"flex", alignItems:"center", padding:"0 8px", borderRight:"2px solid rgba(26,23,20,0.12)", boxSizing:"border-box" }}>
                  <span style={{ fontSize:10, fontWeight:800, color:"#6B6458", letterSpacing:"0.04em" }}>{y.year}</span>
                </div>
              ))}
            </div>
            {/* Month header row */}
            <div style={{ height:MON_H, background:"#F4F5F6", borderBottom:"1px solid rgba(26,23,20,0.07)", position:"relative" }}>
              {months.map((m, i) => (
                <div key={i} style={{ position:"absolute", left:m.left, width:m.width, height:"100%", display:"flex", alignItems:"center", padding:"0 6px", borderRight:"1px solid rgba(26,23,20,0.08)", boxSizing:"border-box" }}>
                  <span style={{ fontSize:10, fontWeight:600, color:"#9E9690", whiteSpace:"nowrap" as const }}>{m.label}</span>
                </div>
              ))}
            </div>

            {/* Sprint rows */}
            {sprints.map(sprint => {
              const isExp = expanded.has(sprint.id);
              const sm = getSprintStatusMeta(sprint.status);
              const barL = getLeft(sprint.startDate);
              const barW = getWidth(sprint.startDate, sprint.endDate);
              const prog = sprintProgress(sprint);
              return (
                <div key={sprint.id}>
                  <div style={{ height:ROW_H, borderBottom:"1px solid rgba(26,23,20,0.05)", position:"relative" }}>
                    <GridLines />
                    <div style={{ position:"absolute", left:barL, top:"50%", transform:"translateY(-50%)", display:"flex", alignItems:"center", gap:5, zIndex:1 }}>
                      <div style={{ width:Math.max(barW, 2), height:22, borderRadius:5, background:sm.barColor + "22", border:`1.5px solid ${sm.barColor}55`, overflow:"hidden", display:"flex", alignItems:"center", position:"relative", flexShrink:0 }}>
                        <div style={{ position:"absolute", height:"100%", width:`${prog}%`, background:sm.barColor + "55", borderRadius:4 }} />
                        <span style={{ position:"relative", paddingLeft:6, fontSize:9, fontWeight:700, color:sm.color, whiteSpace:"nowrap" as const }}>
                          {barW > 60 ? (sprint.name.length > 16 ? sprint.name.slice(0, 15) + "…" : sprint.name) : ""}
                        </span>
                      </div>
                      <span style={{ fontSize:9, fontFamily:"var(--font-mono)", color:sm.color, fontWeight:600, whiteSpace:"nowrap" as const }}>{formatDate(sprint.endDate)}</span>
                    </div>
                  </div>
                  {isExp && sprint.tickets.map(t => {
                    const tL = getLeft(t.startDate);
                    const tW = getWidth(t.startDate, t.dueDate);
                    const tColor = t.status === "done" ? "#059669" : t.status === "in-progress" ? "#D97706" : "#B0A9A4";
                    const isTodo = t.status === "todo";
                    const sBg = t.status === "done" ? "#ECFDF5" : t.status === "in-progress" ? "#FFF7ED" : "#FEF2F2";
                    const sColor = t.status === "done" ? "#059669" : t.status === "in-progress" ? "#D97706" : "#DC2626";
                    const sLabel = t.status === "done" ? "完了" : t.status === "in-progress" ? "進行中" : "未着手";
                    return (
                      <div key={t.id} style={{ height:TICK_ROW_H, borderBottom:"1px solid rgba(26,23,20,0.03)", position:"relative", background:isTodo ? "rgba(220,38,38,0.02)" : "rgba(26,23,20,0.012)" }}>
                        <GridLines />
                        <div style={{ position:"absolute", left:tL, top:"50%", transform:"translateY(-50%)", display:"flex", alignItems:"center", gap:4, zIndex:1 }}>
                          <div style={{ width:Math.max(tW, 2), height:12, borderRadius:3, background:tColor + "25", border:isTodo ? `1px dashed ${tColor}70` : `1px solid ${tColor}50`, overflow:"hidden", flexShrink:0, position:"relative" }}>
                            <div style={{ height:"100%", width:`${t.progress}%`, background:tColor + "55", borderRadius:2 }} />
                          </div>
                          <span style={{ fontSize:8, fontFamily:"var(--font-mono)", color:"#9E9690", whiteSpace:"nowrap" as const }}>{formatDate(t.dueDate)}</span>
                          <span style={{ fontSize:8, fontWeight:700, padding:"1px 4px", borderRadius:8, background:sBg, color:sColor, whiteSpace:"nowrap" as const, border:isTodo ? "1px solid rgba(220,38,38,0.25)" : "none" }}>{sLabel}</span>
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
    </div>
  );
}

// ─── New Sprint Dialog ────────────────────────────────────────────────────────
function NewSprintDialog({ onClose, projectId, onCreated }: { onClose: () => void; projectId: string; onCreated?: () => void }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<SprintStatus>("planning");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    if (isSupabaseEnabled) {
      setSaving(true);
      await supabase!.from("sprints").insert({
        id: `S-${Date.now()}`, project_id: projectId, name, goal,
        start_date: startDate || null, end_date: endDate || null, status,
      });
      setSaving(false);
    }
    onCreated?.();
    onClose();
  };

  return (
    <DialogShell title="新規スプリント作成" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave}>{saving ? "作成中..." : "作成する"}</BtnPrimary></>}>
      <FieldInput label="スプリント名" placeholder="例: Sprint 5: リリース準備" required value={name} onChange={setName} />
      <FieldTextarea label="ゴール" placeholder="このスプリントで達成するゴールを入力..." value={goal} onChange={setGoal} />
      <div className="grid grid-cols-2 gap-3">
        <FieldInput label="開始日" type="date" required value={startDate} onChange={setStartDate} />
        <FieldInput label="終了日" type="date" required value={endDate} onChange={setEndDate} />
      </div>
      <FieldSelect label="ステータス" value={status} onChange={setStatus as (v: string) => void}>
        <option value="planning">計画中</option>
        <option value="active">進行中</option>
        <option value="completed">完了</option>
        <option value="cancelled">中止</option>
      </FieldSelect>
    </DialogShell>
  );
}

// ─── Sprint Page ──────────────────────────────────────────────────────────────
function SprintPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const project = PROJECTS.find(p => p.id === projectId);
  const [sprints, setSprints] = useState<Sprint[]>(SPRINTS.filter(s => s.projectId === projectId));
  const [viewMode, setViewMode] = useState<SprintView>("list");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<SprintTicket | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sprint | null>(null);

  const refreshSprints = () => {
    if (!isSupabaseEnabled || !projectId) return;
    supabase!.from("sprints").select("*, sprint_tickets(*)").eq("project_id", projectId).order("start_date")
      .then(({ data }) => { if (data?.length) setSprints(data.map(mapSprint)); });
  };

  useEffect(() => {
    if (!isSupabaseEnabled || !projectId) return;
    supabase!.from("sprints").select("*, sprint_tickets(*)").eq("project_id", projectId).order("start_date")
      .then(({ data }) => { if (data?.length) setSprints(data.map(mapSprint)); });
  }, [projectId]);

  const handleDeleteSprint = async (sprint: Sprint) => {
    if (isSupabaseEnabled) await supabase!.from("sprints").delete().eq("id", sprint.id);
    setSprints(prev => prev.filter(s => s.id !== sprint.id));
  };

  if (!project) return <Navigate to="/projects" replace />;

  const goToSprint = (sprint: Sprint) => navigate(`/projects/${projectId}/sprints/${sprint.id}`);

  const viewBtns: { mode: SprintView; label: string; Icon: ElementType }[] = [
    { mode:"list",  label:"リスト",       Icon:Layers },
    { mode:"board", label:"ボード",       Icon:LayoutDashboard },
    { mode:"gantt", label:"ガントチャート", Icon:BarChart2 },
  ];

  return (
    <div style={{ padding:"24px" }}>
      {/* Breadcrumb */}
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:16, fontSize:12 }}>
        <button onClick={() => navigate("/projects")} style={{ color:"#059669", fontWeight:600, background:"none", border:"none", cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", gap:4 }}>
          <FolderKanban style={{ width:12, height:12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width:10, height:10, color:"#C9C4BB" }} />
        <span style={{ color:"#B0A9A4" }}>{project.name}</span>
        <ChevronRight style={{ width:10, height:10, color:"#C9C4BB" }} />
        <span style={{ color:"#1A1714", fontWeight:600 }}>スプリント</span>
      </div>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:800, color:"#1A1714", fontFamily:"var(--font-heading)", letterSpacing:"-0.02em" }}>スプリント管理</h1>
          <p style={{ fontSize:12, color:"#A09790", marginTop:3 }}>{project.name} · {sprints.length} スプリント</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{ display:"flex", alignItems:"center", gap:6, padding:"9px 16px", background:"#059669", color:"#fff", fontSize:13, fontWeight:600, borderRadius:10, border:"none", cursor:"pointer", boxShadow:"0 2px 8px rgba(5,150,105,0.25)", transition:"background 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
          <Plus style={{ width:15, height:15 }} />新規スプリント
        </button>
      </div>

      {/* View toggle */}
      <div style={{ display:"flex", gap:4, background:"#FFFFFF", border:"1px solid rgba(26,23,20,0.08)", borderRadius:10, padding:4, marginBottom:20, width:"fit-content" }}>
        {viewBtns.map(({ mode, label, Icon }) => (
          <button key={mode} onClick={() => setViewMode(mode)}
            style={{ display:"flex", alignItems:"center", gap:5, padding:"7px 14px", fontSize:12, fontWeight:500, borderRadius:7, border:"none", cursor:"pointer", transition:"all 0.15s", background:viewMode === mode ? "#059669" : "transparent", color:viewMode === mode ? "#fff" : "#6B6458" }}>
            <Icon style={{ width:13, height:13 }} />{label}
          </button>
        ))}
      </div>

      {/* Views */}
      {viewMode === "list"  && <SprintListView sprints={sprints} onSelectSprint={goToSprint} onDeleteSprint={s => setDeleteTarget(s)} />}
      {viewMode === "board" && <SprintBoardView sprints={sprints} onSelectSprint={goToSprint} />}
      {viewMode === "gantt" && <SprintGanttView sprints={sprints} onSelectSprint={goToSprint} onSelectTicket={setSelectedTicket} />}

      {showCreate && <NewSprintDialog onClose={() => setShowCreate(false)} projectId={projectId!} onCreated={refreshSprints} />}
      {deleteTarget && <ConfirmDialog message={`「${deleteTarget.name}」を削除しますか？関連するチケットもすべて削除されます。`} onConfirm={() => handleDeleteSprint(deleteTarget)} onClose={() => setDeleteTarget(null)} />}
      <TicketDetailPanel ticket={selectedTicket} onClose={() => setSelectedTicket(null)} onUpdated={refreshSprints} />
    </div>
  );
}

// ─── Accept Invite ────────────────────────────────────────────────────────────
function AcceptInvitePage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    if (!isSupabaseEnabled) { setSessionReady(true); return; }
    supabase!.auth.getSession().then(({ data: { session } }) => {
      if (session) { setSessionReady(true); return; }
      const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
        if (session) { setSessionReady(true); subscription.unsubscribe(); }
      });
    });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError("パスワードは8文字以上にしてください"); return; }
    if (password !== confirm) { setError("パスワードが一致しません"); return; }
    setLoading(true); setError("");
    if (!isSupabaseEnabled) { navigate("/dashboard"); return; }
    const { error } = await supabase!.auth.updateUser({ password });
    if (error) { setError(error.message); setLoading(false); }
    else { sessionStorage.setItem("isLoggedIn", "true"); navigate("/dashboard"); }
  };

  if (!sessionReady) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#F5F6F8" }}>
      <div style={{ textAlign:"center" as const }}>
        <div style={{ width:38, height:38, borderRadius:11, background:"linear-gradient(145deg,#34D399,#059669)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px", boxShadow:"0 4px 12px rgba(5,150,105,0.35)" }}>
          <Ticket style={{ width:17, height:17, color:"#fff" }} />
        </div>
        <p style={{ fontSize:12, color:"#A09790" }}>招待を確認中...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex w-[42%] bg-teal-700 flex-col justify-between p-12 relative overflow-hidden"
        style={{ backgroundImage: "radial-gradient(circle at 70% 30%, rgba(255,255,255,0.07) 0%, transparent 60%)" }}>
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="relative">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-md">
              <Ticket className="text-teal-700" style={{ width: 18, height: 18 }} />
            </div>
            <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--font-heading)" }}>Dev Ticket</span>
          </div>
          <h2 className="text-4xl font-bold text-white leading-tight mb-5" style={{ fontFamily: "var(--font-heading)" }}>チームへ<br />ようこそ。</h2>
          <p className="text-teal-100 text-sm leading-relaxed max-w-xs">パスワードを設定してアカウントを有効化してください。チームのプロジェクトやチケット管理にすぐ参加できます。</p>
        </div>
        <p className="relative text-xs text-teal-400">© 2026 Dev Ticket. All rights reserved.</p>
      </div>
      <div className="flex-1 flex items-center justify-center p-8 bg-[#F5F6F8]">
        <div className="w-full max-w-[360px]">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-stone-900 mb-1" style={{ fontFamily: "var(--font-heading)" }}>パスワード設定</h1>
            <p className="text-sm text-stone-500">新しいパスワードを入力してアカウントを有効化してください</p>
          </div>
          <div className="bg-white rounded-2xl border border-stone-200 p-7 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />{error}
                </div>
              )}
              <FieldInput label="新しいパスワード" type="password" placeholder="8文字以上" value={password} onChange={setPassword} />
              <FieldInput label="パスワード（確認）" type="password" placeholder="もう一度入力" value={confirm} onChange={setConfirm} />
              <button type="submit" disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-sm shadow-emerald-200 mt-1">
                {loading
                  ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />設定中...</>
                  : <>パスワードを設定 <ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── App Shell (layout for authenticated pages) ───────────────────────────────
function AppShell() {
  const { userName, userRole, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const getActivePage = (): Exclude<Page, "login"> => {
    const p = location.pathname;
    if (p.startsWith("/projects/")) return "projects";
    if (p.startsWith("/projects")) return "projects";
    if (p.startsWith("/clients")) return "clients";
    if (p.startsWith("/members")) return "members";
    if (p.startsWith("/settings")) return "settings";
    return "dashboard";
  };

  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:"#F5F6F8" }}>
      <Sidebar page={getActivePage()} onNavigate={p => navigate(`/${p}`)}
        onLogout={() => { logout(); navigate("/login"); }}
        userName={userName} userRole={userRole} />
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <Topbar userName={userName} />
        <main style={{ flex:1, overflowY:"auto" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function ProtectedShell() {
  if (sessionStorage.getItem("isLoggedIn") !== "true") return <Navigate to="/login" replace />;
  return <AppShell />;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState<Role>("developer");
  const [authReady, setAuthReady] = useState(!isSupabaseEnabled);

  useEffect(() => {
    if (!isSupabaseEnabled) {
      setUserName(sessionStorage.getItem("userName") || "");
      setUserRole((sessionStorage.getItem("userRole") as Role) || "developer");
      return;
    }
    const authTimer = setTimeout(() => setAuthReady(true), 5000);
    supabase!.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(authTimer);
      if (session) {
        const { data: p } = await supabase!.from("profiles").select("name, role").eq("id", session.user.id).single();
        if (p) {
          setUserName(p.name); setUserRole(p.role as Role);
          sessionStorage.setItem("isLoggedIn", "true");
          sessionStorage.setItem("userName", p.name);
          sessionStorage.setItem("userRole", p.role);
        }
      }
      setAuthReady(true);
    }).catch(() => { clearTimeout(authTimer); setAuthReady(true); });
    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
      if (session) {
        supabase!.from("profiles").select("name, role").eq("id", session.user.id).single()
          .then(({ data: p }) => {
            if (p) {
              setUserName(p.name); setUserRole(p.role as Role);
              sessionStorage.setItem("userName", p.name);
              sessionStorage.setItem("userRole", p.role);
            }
          });
      } else {
        setUserName(""); setUserRole("developer");
        sessionStorage.removeItem("isLoggedIn");
        sessionStorage.removeItem("userName");
        sessionStorage.removeItem("userRole");
      }
    });
    return () => { clearTimeout(authTimer); subscription.unsubscribe(); };
  }, []);

  const login = async (email: string, password: string): Promise<string | null> => {
    if (!isSupabaseEnabled) {
      await new Promise(r => setTimeout(r, 650));
      const member = MEMBERS.find(m => m.email === email);
      if (member && password === "password") {
        setUserName(member.name); setUserRole(member.role);
        sessionStorage.setItem("isLoggedIn", "true");
        sessionStorage.setItem("userName", member.name);
        sessionStorage.setItem("userRole", member.role);
        return null;
      }
      return "メールアドレスまたはパスワードが正しくありません。";
    }
    const { data, error } = await supabase!.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    if (data.session) sessionStorage.setItem("isLoggedIn", "true");
    return null;
  };

  const logout = () => {
    if (isSupabaseEnabled) supabase!.auth.signOut();
    setUserName(""); setUserRole("developer");
    sessionStorage.removeItem("isLoggedIn");
    sessionStorage.removeItem("userName");
    sessionStorage.removeItem("userRole");
  };

  if (!authReady) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#F5F6F8" }}>
      <div style={{ textAlign:"center" as const }}>
        <div style={{ width:38, height:38, borderRadius:11, background:"linear-gradient(145deg,#34D399,#059669)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px", boxShadow:"0 4px 12px rgba(5,150,105,0.35)" }}>
          <Ticket style={{ width:17, height:17, color:"#fff" }} />
        </div>
        <p style={{ fontSize:12, color:"#A09790" }}>読み込み中...</p>
      </div>
    </div>
  );

  return (
    <AuthContext.Provider value={{ userName, userRole, login, logout }}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route element={<ProtectedShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId/sprints" element={<SprintPage />} />
          <Route path="/projects/:projectId/sprints/:sprintId" element={<SprintDetailPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}
