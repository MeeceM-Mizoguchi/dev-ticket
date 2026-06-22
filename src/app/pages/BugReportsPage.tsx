import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Bug, ChevronLeft, CheckCircle2, Clock } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { mapBugReport } from "@/app/lib/mappers";
import { BugReportModal } from "@/app/components/bug-report/BugReportModal";
import type { BugReport, BugCategory, BugSeverity } from "@/app/types";

const CATEGORY_LABELS: Record<BugCategory, string> = {
  login:  "ログイン・認証",
  ticket: "チケット操作",
  sprint: "スプリント管理",
  member: "メンバー管理",
  ui:     "表示・UI",
  other:  "その他",
};

const SEVERITY_META: Record<BugSeverity, { label: string; color: string; bg: string }> = {
  critical: { label: "致命的", color: "#DC2626", bg: "#FEF2F2" },
  major:    { label: "重大",   color: "#D97706", bg: "#FFF7ED" },
  minor:    { label: "軽微",   color: "#0284C7", bg: "#F0F9FF" },
};

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export function BugReportsPage() {
  const { userId } = useAuth();
  const navigate = useNavigate();

  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const loadReports = async () => {
    if (!isSupabaseEnabled || !userId) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase!
      .from("bug_reports")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[bug-reports] load failed:", error.message);
    } else {
      setReports((data ?? []).map(mapBugReport));
    }
    setLoading(false);
  };

  useEffect(() => {
    loadReports();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {showModal && (
        <BugReportModal onClose={() => { setShowModal(false); loadReports(); }} />
      )}

      <div style={{ minHeight: "100vh", background: "#F9FAFB", padding: "0 0 80px" }}>
        {/* ページヘッダー */}
        <div style={{ background: "#FFFFFF", borderBottom: "1px solid rgba(26,23,20,0.08)", padding: "0 24px" }}>
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 0 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => navigate(-1)}
                style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#9E9690" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                <ChevronLeft style={{ width: 16, height: 16 }} />
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: "#FEF2F2", border: "1px solid #FECACA", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Bug style={{ width: 15, height: 15, color: "#DC2626" }} />
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1A1714" }}>バグ報告一覧</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#9E9690" }}>あなたが報告したバグの対応状況</p>
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowModal(true)}
              style={{ padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none", background: "#059669", color: "#FFFFFF", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)" }}>
              ＋ 新規報告
            </button>
          </div>
        </div>

        <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 24px 0" }}>
          {loading && (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#9E9690", fontSize: 13 }}>
              読み込み中...
            </div>
          )}

          {!loading && reports.length === 0 && (
            <div style={{ padding: "64px 24px", textAlign: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: "#F4F5F6", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <Bug style={{ width: 24, height: 24, color: "#C9C4BB" }} />
              </div>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#6B6458", margin: "0 0 6px" }}>
                まだ報告はありません
              </p>
              <p style={{ fontSize: 12, color: "#9E9690", margin: "0 0 20px" }}>
                バグや不具合を見つけたらお気軽にご報告ください
              </p>
              <button
                onClick={() => setShowModal(true)}
                style={{ padding: "8px 20px", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", background: "#059669", color: "#FFFFFF", cursor: "pointer" }}>
                バグを報告する
              </button>
            </div>
          )}

          {!loading && reports.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {reports.map(r => {
                const sev = SEVERITY_META[r.severity];
                const isResolved = r.status === "resolved";
                return (
                  <div
                    key={r.id}
                    style={{ background: "#FFFFFF", borderRadius: 12, border: `1px solid ${isResolved ? "rgba(5,150,105,0.15)" : "rgba(26,23,20,0.08)"}`, padding: "16px 18px", transition: "box-shadow 0.15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.06)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      {/* ステータスアイコン */}
                      <div style={{ marginTop: 2, flexShrink: 0 }}>
                        {isResolved
                          ? <CheckCircle2 style={{ width: 18, height: 18, color: "#059669" }} />
                          : <Clock style={{ width: 18, height: 18, color: "#9E9690" }} />
                        }
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* タイトル行 */}
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1A1714", flex: 1, minWidth: 0 }}>
                            {r.title}
                          </p>
                          {/* 深刻度バッジ */}
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, flexShrink: 0, background: sev.bg, color: sev.color }}>
                            {sev.label}
                          </span>
                          {/* 対応状況バッジ */}
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, flexShrink: 0,
                            background: isResolved ? "#ECFDF5" : "#F3F4F6",
                            color: isResolved ? "#059669" : "#6B7280",
                          }}>
                            {isResolved ? "対応済み" : "対応中"}
                          </span>
                        </div>

                        {/* カテゴリ・日付 */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, color: "#9E9690", background: "#F4F5F6", padding: "2px 8px", borderRadius: 20 }}>
                            {CATEGORY_LABELS[r.category]}
                          </span>
                          <span style={{ fontSize: 11, color: "#C9C4BB" }}>
                            {formatDate(r.createdAt)}
                          </span>
                        </div>

                        {/* 概要プレビュー */}
                        {r.steps && (
                          <p style={{ margin: "8px 0 0", fontSize: 11, color: "#9E9690", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                            {r.steps.split("\n")[0]}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
