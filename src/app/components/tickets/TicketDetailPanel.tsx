import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";
import type { SprintTicket, TicketStatus } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { Avatar } from "@/app/components/shared/Avatar";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";

export function TicketDetailPanel({ ticket, onClose, onUpdated }: { ticket: SprintTicket | null; onClose: () => void; onUpdated?: () => void }) {
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
  const isOverdue = ticket.status !== "done" && !!ticket.dueDate && ticket.dueDate < todayStr;
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
        <div style={{ padding:"20px 24px", display:"flex", flexDirection:"column", gap:16 }}>
          <div style={{ background:"#FFFFFF", border:"1px solid rgba(26,23,20,0.07)", borderRadius:12, padding:"14px 16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <span style={{ fontSize:11, fontWeight:700, color:"#6B6458" }}>進捗状況</span>
              <span style={{ fontSize:16, fontWeight:800, color:"#1A1714", fontFamily:"var(--font-heading)" }}>{ticket.progress}%</span>
            </div>
            <div style={{ height:8, background:"#EDE9E0", borderRadius:99, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${ticket.progress}%`, background:barColor, borderRadius:99, transition:"width 0.6s ease" }} />
            </div>
          </div>
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
          <div>
            <p style={{ fontSize:10, color:"#B0A9A4", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.07em", marginBottom:8 }}>詳細・説明</p>
            <div style={{ background:"#FFFFFF", border:"1px solid rgba(26,23,20,0.07)", borderRadius:10, padding:"14px", minHeight:96, color:"#A09790", fontSize:12, lineHeight:1.8 }}>
              チケットの詳細説明がここに表示されます。担当者が追加した要件・受け入れ条件などが記録されます。
            </div>
          </div>
          <div>
            <p style={{ fontSize:10, color:"#B0A9A4", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.07em", marginBottom:8 }}>添付ファイル</p>
            <div style={{ background:"#FFFFFF", border:"2px dashed rgba(26,23,20,0.10)", borderRadius:10, padding:"24px", textAlign:"center" as const }}>
              <div style={{ width:36, height:36, background:"#F4F5F6", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 8px" }}>
                <Plus style={{ width:16, height:16, color:"#C9C4BB" }} />
              </div>
              <p style={{ fontSize:11, color:"#B0A9A4" }}>添付ファイルなし</p>
            </div>
          </div>
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
