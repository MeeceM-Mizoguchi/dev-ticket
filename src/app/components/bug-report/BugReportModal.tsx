import { useRef, useState, useCallback, useEffect } from "react";
import { X, Bug, List, ChevronLeft, CheckCircle2, Clock, Plus, AlertCircle } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { ImageAttachments } from "@/app/components/shared/ImageAttachments";
import { mapBugReport } from "@/app/lib/mappers";
import { escStack } from "@/app/lib/escStack";
import type { BugCategory, BugSeverity, BugReport } from "@/app/types";

const CATEGORY_OPTIONS: { value: BugCategory; label: string }[] = [
  { value: "login",   label: "ログイン・認証" },
  { value: "ticket",  label: "チケット操作" },
  { value: "sprint",  label: "スプリント管理" },
  { value: "member",  label: "メンバー管理" },
  { value: "ui",      label: "表示・UI" },
  { value: "other",   label: "その他" },
];

const SEVERITY_OPTIONS: { value: BugSeverity; label: string; desc: string; color: string }[] = [
  { value: "critical", label: "致命的", desc: "操作ができない",     color: "#DC2626" },
  { value: "major",    label: "重大",   desc: "回避策あり",         color: "#D97706" },
  { value: "minor",    label: "軽微",   desc: "見た目・軽微な問題", color: "#0284C7" },
];

const CATEGORY_LABELS: Record<BugCategory, string> = {
  login: "ログイン・認証", ticket: "チケット操作", sprint: "スプリント管理",
  member: "メンバー管理", ui: "表示・UI", other: "その他",
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

interface BugReportBubble {
  id: number; x: number; size: number; duration: number; delay: number; opacity: number;
}
function createBubbles(count: number): BugReportBubble[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i, x: 5 + Math.random() * 90, size: 8 + Math.random() * 18,
    duration: 3.5 + Math.random() * 2.5, delay: Math.random() * 2,
    opacity: 0.7 + Math.random() * 0.3,
  }));
}

// 🌟 追加: スプリント等とデザインを統一したオリジナルUIのエラーコンポーネント
const ErrMsg = ({ msg }: { msg: string }) => (
  <p style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#DC2626", marginTop: 4, marginBottom: 0 }}>
    <AlertCircle style={{ width: 11, height: 11, flexShrink: 0 }} />{msg}
  </p>
);

interface Props { onClose: () => void; }
type Phase = "form" | "submitting" | "success" | "list";

export function BugReportModal({ onClose }: Props) {
  const { userId, userName } = useAuth();
  const bubbles = useRef(createBubbles(18)).current;

  useEffect(() => {
    escStack.push(onClose);
    return () => escStack.pop(onClose);
  }, [onClose]);

  const [phase, setPhase] = useState<Phase>("form");

  // フォームの状態
  const [category, setCategory] = useState<BugCategory>("other");
  const [severity, setSeverity] = useState<BugSeverity>("minor");
  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState("");
  const [actual, setActual] = useState("");
  const [expected, setExpected] = useState("");
  const [url, setUrl] = useState("");
  const [consoleLog, setConsoleLog] = useState(""); // コンソールログ用のステート
  const [images, setImages] = useState<string[]>([]);
  
  // 🌟 修正: フッター一括文字列ではなく、送信を試みたかどうかのフラグと通信系一般エラー用ステートに変更
  const [attempted, setAttempted] = useState(false);
  const [generalError, setGeneralError] = useState("");

  // 一覧の状態
  const [reports, setReports] = useState<BugReport[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const loadReports = useCallback(async () => {
    if (!isSupabaseEnabled || !userId) { setListLoading(false); return; }
    setListLoading(true);
    const { data } = await supabase!
      .from("bug_reports").select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setReports((data ?? []).map(mapBugReport));
    setListLoading(false);
  }, [userId]);

  const openList = useCallback(() => {
    setPhase("list");
    loadReports();
  }, [loadReports]);

  const resetForm = () => {
    setCategory("other"); setSeverity("minor");
    setTitle(""); setSteps(""); setActual(""); setExpected(""); setUrl(""); setConsoleLog("");
    setImages([]); setAttempted(false); setGeneralError("");
  };

  const handleImagesChange = useCallback((next: string[]) => {
    setImages(next.slice(0, 5));
  }, []);

  const handleSubmit = async () => {
    // 🌟 追加: 送信を試みたフラグを立てて個別エラー表示をONにする
    setAttempted(true);
    setGeneralError("");

    // バリデーションチェック
    if (!title.trim() || !steps.trim() || !actual.trim()) {
      return; 
    }

    setPhase("submitting");

    if (!isSupabaseEnabled) {
      setTimeout(() => setPhase("success"), 400);
      return;
    }

    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const userEmail = session?.user?.email ?? "";

      const { data: reportData, error: reportErr } = await supabase!
        .from("bug_reports")
        .insert({
          user_id: userId || null, user_name: userName, user_email: userEmail,
          category, severity, title: title.trim(), steps: steps.trim(),
          actual: actual.trim(), expected: expected.trim(), url: url.trim(),
          images, status: "open",
        })
        .select("id").single();

      if (reportErr || !reportData) throw reportErr ?? new Error("insert failed");
      const reportId: string = reportData.id;

      const inquirySlug = import.meta.env.VITE_INQUIRY_PROJECT_SLUG as string | undefined;
      if (inquirySlug) {
        const { data: proj } = await supabase!.from("projects").select("id")
          .eq("slug", inquirySlug).maybeSingle();

        if (proj?.id) {
          const { data: lastItem } = await supabase!.from("backlog_items").select("id")
            .like("id", "B-%").order("id", { ascending: false }).limit(1).maybeSingle();
          const nextNum = (parseInt(lastItem?.id?.slice(2) ?? "0", 10) || 0) + 1;
          const backlogId = `B-${String(nextNum).padStart(3, "0")}`;

          const catLabel = CATEGORY_OPTIONS.find(c => c.value === category)?.label ?? category;
          const sevLabel = SEVERITY_OPTIONS.find(s => s.value === severity)?.label ?? severity;
          const toLines = (text: string) => text.split("\n").map(l => `<p>${l || ""}</p>`).join("");
          const description = [
            `<p><strong>【カテゴリ】</strong>${catLabel} <strong>【深刻度】</strong>${sevLabel}</p>`,
            `<p></p>`,
            `<p><strong>【再現手順】</strong></p>`, toLines(steps.trim()),
            `<p></p>`,
            `<p><strong>【実際の動作】</strong></p>`, toLines(actual.trim()),
            ...(expected.trim() ? [`<p></p>`, `<p><strong>【期待する動作】</strong></p>`, toLines(expected.trim())] : []),
            ...(url.trim() ? [`<p></p>`, `<p><strong>【発生URL】</strong></p>`, `<p>${url.trim()}</p>`] : []),
            ...(consoleLog.trim() ? [`<p></p>`, `<p><strong>【コンソールログ】</strong></p>`, `<pre style="background:#f4f5f6; padding:8px; border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">${consoleLog.replace(/</g, "&lt;").replace(/>/g, "&gt;").trim()}</pre>`] : []),
            `<p></p>`,
            `<p><strong>【報告者】</strong>${userName}</p>`,
          ].join("");

          const { data: backlogData } = await supabase!.from("backlog_items").insert({
            id: backlogId, project_id: proj.id,
            title: `【問い合わせ】${title.trim()}`, description,
            status: "open",
            priority: severity === "critical" ? "high" : severity === "major" ? "medium" : "low",
            rank: 0, is_user_inquiry: true, bug_report_id: reportId,
            created_by: userName, images,
          }).select("id").single();

          if (backlogData?.id) {
            await supabase!.from("bug_reports").update({ backlog_item_id: backlogData.id }).eq("id", reportId);
          }
        }
      }

      setPhase("success");
    } catch (e) {
      console.error("[bug-report] submit failed:", e);
      setGeneralError("送信に失敗しました。もう一度お試しください。");
      setPhase("form");
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", fontSize: 13, color: "#1A1714",
    border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 8, outline: "none",
    background: "#FAFAF8", boxSizing: "border-box",
  };
  const textareaStyle: React.CSSProperties = {
    ...inputStyle, resize: "vertical" as const, minHeight: 72, lineHeight: 1.6,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, color: "#4B4744", marginBottom: 6, display: "block",
  };

  const focusStyle = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "#059669";
    e.currentTarget.style.boxShadow = "0 0 0 2px rgba(5,150,105,0.1)";
  };
  const blurStyle = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "rgba(26,23,20,0.12)";
    e.currentTarget.style.boxShadow = "none";
  };

  return (
    <>
      <style>{`
        @keyframes brBubbleRise {
          0%   { transform:translateY(0) scale(0.8); opacity:0; }
          12%  { opacity:var(--brop); }
          80%  { opacity:var(--brop); }
          100% { transform:translateY(-80vh) scale(1.05); opacity:0; }
        }
        @keyframes brFadeInUp {
          from { opacity:0; transform:translateY(20px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes brCircleDraw {
          from { stroke-dashoffset:283; } to { stroke-dashoffset:0; }
        }
        @keyframes brCheckDraw {
          from { stroke-dashoffset:80; } to { stroke-dashoffset:0; }
        }
        @keyframes brCheckIn {
          0%   { opacity:0; transform:scale(0.6); }
          65%  { transform:scale(1.08); }
          100% { opacity:1; transform:scale(1); }
        }
        @keyframes brModalIn {
          from { opacity:0; transform:translateY(12px) scale(0.98); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
        @keyframes brSlideIn {
          from { opacity:0; transform:translateX(12px); }
          to   { opacity:1; transform:translateX(0); }
        }
      `}</style>

      <div
        style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
        onClick={phase === "success" ? undefined : onClose}
      >
        <div
          style={{
            width:"min(520px, 100%)", height:"min(680px, 90vh)",
            background: phase === "success" ? "#052E16" : "#FFFFFF",
            borderRadius:16, boxShadow:"0 24px 64px rgba(0,0,0,0.25)",
            display:"flex", flexDirection:"column", overflow:"hidden", position:"relative",
            animation:"brModalIn 0.25s ease both", transition:"background 0.4s ease",
          }}
          onClick={e => e.stopPropagation()}
        >

          {/* ── 成功アニメーション ── */}
          {phase === "success" && (
            <>
              <div style={{ position:"absolute", inset:0, pointerEvents:"none", overflow:"hidden" }}>
                {bubbles.map(b => (
                  <div key={b.id} style={{
                    position:"absolute", bottom:-30, left:`${b.x}%`,
                    width:b.size, height:b.size, borderRadius:"50%",
                    background: b.size > 18 ? `rgba(52,211,153,${b.opacity})` : `rgba(16,185,129,${b.opacity})`,
                    border:`1.5px solid rgba(167,243,208,${b.opacity * 0.7})`,
                    animation:`brBubbleRise ${b.duration}s ${b.delay}s infinite ease-in-out`,
                    ["--brop" as string]: b.opacity,
                  }} />
                ))}
              </div>
              <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"48px 32px", position:"relative", zIndex:1, animation:"brFadeInUp 0.5s 0.1s ease both" }}>
                <svg viewBox="0 0 100 100" style={{ width:120, height:120, marginBottom:24, animation:"brCheckIn 0.5s ease both" }}>
                  <circle cx="50" cy="50" r="45" fill="rgba(52,211,153,0.12)" />
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#34D399" strokeWidth="5" strokeLinecap="round"
                    strokeDasharray="283" strokeDashoffset="283"
                    style={{ animation:"brCircleDraw 0.9s 0.15s cubic-bezier(0.4,0,0.2,1) forwards" }} />
                  <path d="M26 52 L42 68 L74 32" fill="none" stroke="#6EE7B7" strokeWidth="7"
                    strokeLinecap="round" strokeLinejoin="round"
                    strokeDasharray="80" strokeDashoffset="80"
                    style={{ animation:"brCheckDraw 0.45s 1.0s ease forwards" }} />
                </svg>
                <p style={{ color:"#D1FAE5", fontSize:22, fontWeight:800, margin:0, letterSpacing:"-0.3px" }}>ありがとうございます！</p>
                <p style={{ color:"#6EE7B7", fontSize:13, marginTop:10, fontWeight:500, textAlign:"center", lineHeight:1.6 }}>
                  報告を受け付けました。<br />対応後にご連絡いたします。
                </p>
                <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:32, width:"100%", maxWidth:280 }}>
                  <button
                    onClick={openList}
                    style={{ width:"100%", padding:"10px 0", fontSize:13, fontWeight:700, borderRadius:10, border:"1.5px solid rgba(52,211,153,0.5)", background:"rgba(52,211,153,0.12)", color:"#6EE7B7", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                    <List style={{ width:14, height:14 }} />
                    過去の報告一覧を見る
                  </button>
                  <button
                    onClick={onClose}
                    style={{ width:"100%", padding:"10px 0", fontSize:13, fontWeight:600, borderRadius:10, border:"none", background:"transparent", color:"rgba(167,243,208,0.7)", cursor:"pointer" }}>
                    閉じる
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── 過去の報告一覧 ── */}
          {phase === "list" && (
            <>
              {/* ヘッダー */}
              <div style={{ padding:"16px 20px 14px", borderBottom:"1px solid rgba(26,23,20,0.08)", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <button
                    onClick={() => setPhase("form")}
                    style={{ width:28, height:28, borderRadius:7, border:"none", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#9E9690", flexShrink:0 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                    <ChevronLeft style={{ width:15, height:15 }} />
                  </button>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:28, height:28, borderRadius:8, background:"#FEF2F2", border:"1px solid #FECACA", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <Bug style={{ width:14, height:14, color:"#DC2626" }} />
                    </div>
                    <span style={{ fontSize:14, fontWeight:700, color:"#1A1714" }}>過去の報告一覧</span>
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <button
                    onClick={() => { resetForm(); setPhase("form"); }}
                    style={{ padding:"5px 12px", fontSize:12, fontWeight:700, borderRadius:8, border:"none", background:"#059669", color:"#fff", cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                    <Plus style={{ width:12, height:12 }} />新規報告
                  </button>
                  <button
                    onClick={onClose}
                    style={{ width:28, height:28, borderRadius:7, border:"none", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#9E9690" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                    <X style={{ width:15, height:15 }} />
                  </button>
                </div>
              </div>

              {/* 一覧本体 */}
              <div style={{ flex:1, overflowY:"auto", padding:"12px 16px", animation:"brSlideIn 0.2s ease both" }}>
                {listLoading && (
                  <p style={{ textAlign:"center", color:"#9E9690", fontSize:13, padding:"40px 0" }}>読み込み中...</p>
                )}
                {!listLoading && reports.length === 0 && (
                  <div style={{ textAlign:"center", padding:"40px 0" }}>
                    <p style={{ fontSize:13, color:"#9E9690", margin:0 }}>まだ報告はありません</p>
                  </div>
                )}
                {!listLoading && reports.length > 0 && (
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {reports.map(r => {
                      const sev = SEVERITY_META[r.severity];
                      const isResolved = r.status === "resolved";
                      return (
                        <div key={r.id} style={{ background:"#FAFAF8", borderRadius:10, border:`1px solid ${isResolved ? "rgba(5,150,105,0.15)" : "rgba(26,23,20,0.07)"}`, padding:"12px 14px" }}>
                          <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                            <div style={{ marginTop:2, flexShrink:0 }}>
                              {isResolved
                                ? <CheckCircle2 style={{ width:16, height:16, color:"#059669" }} />
                                : <Clock style={{ width:16, height:16, color:"#9E9690" }} />
                              }
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:"flex", alignItems:"flex-start", gap:6, marginBottom:5, flexWrap:"wrap" }}>
                                <p style={{ margin:0, fontSize:13, fontWeight:700, color:"#1A1714", flex:1, minWidth:0 }}>{r.title}</p>
                                <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:20, flexShrink:0, background:sev.bg, color:sev.color }}>{sev.label}</span>
                                <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:20, flexShrink:0, background: isResolved ? "#ECFDF5" : "#F3F4F6", color: isResolved ? "#059669" : "#6B7280" }}>
                                  {isResolved ? "対応済み" : "対応中"}
                                </span>
                              </div>
                              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                <span style={{ fontSize:11, color:"#9E9690", background:"#EDEDEB", padding:"2px 7px", borderRadius:20 }}>{CATEGORY_LABELS[r.category]}</span>
                                <span style={{ fontSize:11, color:"#C9C4BB" }}>{formatDate(r.createdAt)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── フォーム ── */}
          {(phase === "form" || phase === "submitting") && (
            <>
              {/* ヘッダー */}
              <div style={{ padding:"16px 20px 14px", borderBottom:"1px solid rgba(26,23,20,0.08)", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:28, height:28, borderRadius:8, background:"#FEF2F2", border:"1px solid #FECACA", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <Bug style={{ width:14, height:14, color:"#DC2626" }} />
                  </div>
                  <span style={{ fontSize:14, fontWeight:700, color:"#1A1714" }}>バグ・不具合を報告する</span>
                </div>
                <button
                  onClick={onClose}
                  style={{ width:28, height:28, borderRadius:7, border:"none", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifySelf:"center", color:"#9E9690" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <X style={{ width:15, height:15 }} />
                </button>
              </div>

              {/* フォーム本体 */}
              <div style={{ flex:1, overflowY:"auto", padding:20 }}>
                <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

                  {/* カテゴリ */}
                  <div>
                    <label style={labelStyle}>カテゴリ <span style={{ color:"#EF4444" }}>*</span></label>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {CATEGORY_OPTIONS.map(opt => (
                        <button key={opt.value} onClick={() => setCategory(opt.value)} style={{ padding:"5px 12px", fontSize:12, fontWeight:600, borderRadius:20, cursor:"pointer", transition:"all 0.12s", border:`1.5px solid ${category === opt.value ? "#059669" : "rgba(26,23,20,0.12)"}`, background: category === opt.value ? "#ECFDF5" : "#FAFAF8", color: category === opt.value ? "#059669" : "#6B6458" }}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 深刻度 */}
                  <div>
                    <label style={labelStyle}>深刻度 <span style={{ color:"#EF4444" }}>*</span></label>
                    <div style={{ display:"flex", gap:8 }}>
                      {SEVERITY_OPTIONS.map(opt => (
                        <button key={opt.value} onClick={() => setSeverity(opt.value)} style={{ flex:1, padding:"8px 6px", fontSize:12, fontWeight:600, borderRadius:9, cursor:"pointer", transition:"all 0.12s", border:`1.5px solid ${severity === opt.value ? opt.color : "rgba(26,23,20,0.12)"}`, background: severity === opt.value ? `${opt.color}12` : "#FAFAF8", color: severity === opt.value ? opt.color : "#6B6458", lineHeight:1.4, textAlign:"center" as const }}>
                          <div style={{ fontSize:13, fontWeight:700 }}>{opt.label}</div>
                          <div style={{ fontSize:10, opacity:0.8, marginTop:2 }}>{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* バグ概要 */}
                  <div>
                    <label style={labelStyle}>バグの概要 <span style={{ color:"#EF4444" }}>*</span></label>
                    <input 
                      value={title} 
                      onChange={e => setTitle(e.target.value)} 
                      placeholder="例：チケットのステータスが保存されない" 
                      style={inputStyle} 
                      onFocus={focusStyle} 
                      onBlur={blurStyle} 
                    />
                    {/* 🌟 修正: オリジナルUIの個別バリデーションエラーを追加 */}
                    {attempted && !title.trim() && <ErrMsg msg="バグの概要を入力してください" />}
                  </div>

                  {/* 再現手順 */}
                  <div>
                    <label style={labelStyle}>再現手順 <span style={{ color:"#EF4444" }}>*</span></label>
                    <textarea 
                      value={steps} 
                      onChange={e => setSteps(e.target.value)} 
                      placeholder={"1. ○○ページを開く\n2. △△をクリックする\n3. □□が起きる"} 
                      style={textareaStyle} 
                      onFocus={focusStyle} 
                      onBlur={blurStyle} 
                    />
                    {/* 🌟 修正: オリジナルUIの個別バリデーションエラーを追加 */}
                    {attempted && !steps.trim() && <ErrMsg msg="再現手順を入力してください" />}
                  </div>

                  {/* 実際の動作 */}
                  <div>
                    <label style={labelStyle}>実際の動作 <span style={{ color:"#EF4444" }}>*</span></label>
                    <textarea 
                      value={actual} 
                      onChange={e => setActual(e.target.value)} 
                      placeholder="実際に何が起きているか" 
                      style={textareaStyle} 
                      onFocus={focusStyle} 
                      onBlur={blurStyle} 
                    />
                    {/* 🌟 修正: オリジナルUIの個別バリデーションエラーを追加 */}
                    {attempted && !actual.trim() && <ErrMsg msg="実際の動作を入力してください" />}
                  </div>

                  {/* 期待する動作 */}
                  <div>
                    <label style={labelStyle}>期待する動作 <span style={{ color:"#9E9690", fontWeight:500 }}>（任意）</span></label>
                    <textarea value={expected} onChange={e => setExpected(e.target.value)} placeholder="本来どうなるべきか" style={{ ...textareaStyle, minHeight:56 }} onFocus={focusStyle} onBlur={blurStyle} />
                  </div>

                  {/* 発生URL */}
                  <div>
                    <label style={labelStyle}>発生URL <span style={{ color:"#9E9690", fontWeight:500 }}>（任意）</span></label>
                    <input value={url} onChange={e => setUrl(e.target.value)} placeholder="例：https://dv-ticket.com/devticket/sprint" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} />
                  </div>

                  {/* コンソールログ貼り付けフィールド */}
                  <div>
                    <label style={labelStyle}>コンソールログ <span style={{ color:"#9E9690", fontWeight:500 }}>（任意）</span></label>
                    <textarea 
                      value={consoleLog} 
                      onChange={e => setConsoleLog(e.target.value)} 
                      placeholder={"デベロッパーツール（F12）の Console タブに表示されているエラーログ等があれば、ここにコピー＆ペーストしてください。"} 
                      style={{ ...textareaStyle, minHeight:90, fontFamily:"var(--font-mono)", fontSize:12 }} 
                      onFocus={focusStyle} 
                      onBlur={blurStyle} 
                    />
                  </div>

                  {/* 画像添付 */}
                  <div>
                    <label style={labelStyle}>スクリーンショット <span style={{ color:"#9E9690", fontWeight:500 }}>（任意・最大5枚）</span></label>
                    {images.length < 5 ? (
                      <ImageAttachments images={images} onImagesChange={handleImagesChange} uploadPathPrefix={`bug-reports/${userId ?? "anon"}`} />
                    ) : (
                      <>
                        <ImageAttachments images={images} onImagesChange={handleImagesChange} uploadPathPrefix={`bug-reports/${userId ?? "anon"}`} readOnly />
                        <p style={{ fontSize:11, color:"#D97706", marginTop:6 }}>最大5枚まで（削除してから追加してください）</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* フッター */}
              <div style={{ padding:"14px 20px", borderTop:"1px solid rgba(26,23,20,0.07)", flexShrink:0 }}>
                {/* 🌟 修正: 一括バリデーションの文言配置を廃止し、Supabase接続失敗などのシステムエラー(generalError)のみを出すように変更 */}
                {generalError && <p style={{ fontSize:12, color:"#EF4444", fontWeight:600, margin:"0 0 10px" }}>{generalError}</p>}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
                  <button
                    onClick={openList}
                    style={{ fontSize:12, color:"#059669", fontWeight:600, background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:4, padding:"4px 0", flexShrink:0 }}>
                    <List style={{ width:13, height:13 }} />
                    過去の報告一覧
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={phase === "submitting"}
                    style={{ padding:"9px 24px", fontSize:13, fontWeight:700, borderRadius:10, border:"none", cursor: phase === "submitting" ? "not-allowed" : "pointer", background: phase === "submitting" ? "rgba(5,150,105,0.25)" : "#059669", color: phase === "submitting" ? "#059669" : "#FFFFFF", boxShadow: phase === "submitting" ? "none" : "0 4px 12px rgba(5,150,105,0.28)", transition:"all 0.15s" }}>
                    {phase === "submitting" ? "送信中..." : "送信する"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}