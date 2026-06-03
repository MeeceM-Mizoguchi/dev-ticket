import type { Project, Client, Member, Sprint, TicketItem, AppNotification } from "@/app/types";

export const PROJECTS: Project[] = [
  { id: "P-001", name: "ECサイトリニューアル", client: "株式会社サンプル商事", status: "in-progress", startDate: "2026-01-15", endDate: "2026-06-30", members: ["田中太郎", "佐藤花子", "山田次郎"], groupIds: [], done: 24, inProgress: 8, todo: 12, description: "既存ECサイトのUI/UX全面刷新。パフォーマンス改善とモバイル対応を含む大規模プロジェクト。" },
  { id: "P-002", name: "モバイルアプリ開発", client: "テクノロジー株式会社", status: "planning", startDate: "2026-03-01", endDate: "2026-09-30", members: ["田中太郎", "山田次郎"], groupIds: [], done: 5, inProgress: 3, todo: 22, description: "iOS/Android向けのネイティブアプリ開発。React Nativeを使用した最新実装。" },
  { id: "P-003", name: "データ分析基盤構築", client: "グローバル産業", status: "completed", startDate: "2025-10-01", endDate: "2026-02-28", members: ["鈴木一郎", "田中太郎"], groupIds: [], done: 31, inProgress: 0, todo: 0, description: "BIツールの導入とデータウェアハウスの構築。BigQuery連携を含む分析基盤。" },
  { id: "P-004", name: "社内ポータルサイト", client: "株式会社サンプル商事", status: "on-hold", startDate: "2026-02-01", endDate: "2026-07-31", members: ["佐藤花子", "鈴木一郎"], groupIds: [], done: 12, inProgress: 2, todo: 14, description: "社内情報共有のためのイントラネットポータル。SSO対応と多言語対応を実装予定。" },
];

export const CLIENTS: Client[] = [
  { id: "C-001", name: "株式会社サンプル商事", industry: "小売業", email: "contact@sample-corp.jp", phone: "03-1234-5678", status: "active" },
  { id: "C-002", name: "テクノロジー株式会社", industry: "IT・通信", email: "info@technology.co.jp", phone: "03-9876-5432", status: "active" },
  { id: "C-003", name: "グローバル産業", industry: "製造業", email: "global@industry.com", phone: "03-5555-1111", status: "inactive" },
];

export const MEMBERS: Member[] = [
  { id: "M-001", name: "田中太郎", email: "tanaka@company.com", role: "developer", group: "開発第1チーム", status: "active", projects: 3, tickets: 8 },
  { id: "M-002", name: "佐藤花子", email: "sato@company.com", role: "designer", group: "デザインチーム", status: "active", projects: 2, tickets: 5 },
  { id: "M-003", name: "鈴木一郎", email: "suzuki@company.com", role: "project-manager", group: "マネジメント", status: "active", projects: 4, tickets: 2 },
  { id: "M-004", name: "山田次郎", email: "yamada@company.com", role: "developer", group: "開発第1チーム", status: "active", projects: 2, tickets: 6 },
  { id: "M-005", name: "システム管理者", email: "admin@example.com", role: "admin", group: "マネジメント", status: "active", projects: 4, tickets: 0 },
];

export const TICKETS: TicketItem[] = [
  { id: "T-001", title: "トップページのバナー実装", project: "ECサイトリニューアル", status: "in-progress", priority: "high", assignee: "佐藤花子", dueDate: "2026-05-30" },
  { id: "T-002", title: "商品一覧APIのクエリ最適化", project: "ECサイトリニューアル", status: "todo", priority: "medium", assignee: "田中太郎", dueDate: "2026-06-05" },
  { id: "T-003", title: "ユーザー認証フローの修正", project: "モバイルアプリ開発", status: "in-progress", priority: "high", assignee: "田中太郎", dueDate: "2026-05-28" },
  { id: "T-004", title: "DBマイグレーションスクリプト", project: "ECサイトリニューアル", status: "done", priority: "low", assignee: "山田次郎", dueDate: "2026-05-20" },
  { id: "T-005", title: "CI/CDパイプライン構築", project: "モバイルアプリ開発", status: "todo", priority: "medium", assignee: "山田次郎", dueDate: "2026-06-15" },
  { id: "T-006", title: "レスポンシブデザイン対応", project: "社内ポータルサイト", status: "in-progress", priority: "medium", assignee: "佐藤花子", dueDate: "2026-06-01" },
];

export const GROUPS = ["すべて", "マネジメント", "開発第1チーム", "開発第2チーム", "デザインチーム"];

export const SPRINTS: Sprint[] = [
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

export const NOTIFICATIONS: AppNotification[] = [
  { id: "1", userName: "田中太郎", type: "assign", title: "新しいチケットが割り当てられました", body: "T-007: ログイン機能のバグ修正が担当になりました", ticketId: "T-007", ticketWbs: "T-007", ticketTitle: "ログイン機能のバグ修正", projectSlug: "", isRead: false, createdAt: new Date(Date.now() - 5 * 60000).toISOString() },
  { id: "2", userName: "田中太郎", type: "status", title: "ステータスが変更されました", body: "T-003: ユーザー認証フロー → 完了に更新されました", ticketId: "T-003", ticketWbs: "T-003", ticketTitle: "ユーザー認証フロー", projectSlug: "", isRead: false, createdAt: new Date(Date.now() - 60 * 60000).toISOString() },
  { id: "3", userName: "田中太郎", type: "comment", title: "コメントが追加されました", body: "ECサイトリニューアル: 田中太郎さんがコメントしました", ticketId: null, ticketWbs: "", ticketTitle: "", projectSlug: "", isRead: true, createdAt: new Date(Date.now() - 3 * 60 * 60000).toISOString() },
];
