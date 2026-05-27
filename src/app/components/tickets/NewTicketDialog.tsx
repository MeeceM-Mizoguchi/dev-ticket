import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { TicketStatus, Priority } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { MEMBERS } from "@/app/data/mock";
import { labelCls, inputCls, TICKET_STATUSES } from "@/app/lib/helpers";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { DatePicker } from "@/app/components/shared/DatePicker";

export function NewTicketDialog({ sprintId, onClose, onCreated, sprintStartDate, sprintEndDate }: {
  sprintId: string; onClose: () => void; onCreated?: () => void;
  sprintStartDate?: string; sprintEndDate?: string;
}) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<TicketStatus>("todo");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assigneeList, setAssigneeList] = useState<{ id: string; name: string }[]>(
    MEMBERS.map(m => ({ id: m.id, name: m.name }))
  );
  const [assignee, setAssignee] = useState(MEMBERS[0]?.name || "");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [estimatedHours, setEstimatedHours] = useState(0);

  const calcHours = (start: string, due: string) => {
    if (!start || !due) return 0;
    const days = Math.round((new Date(due).getTime() - new Date(start).getTime()) / 86400000);
    return Math.max(0, days) * 8;
  };
  const handleDateChange = (field: "start" | "due", v: string) => {
    const s = field === "start" ? v : startDate;
    const d = field === "due"   ? v : dueDate;
    if (field === "start") setStartDate(v); else setDueDate(v);
    setEstimatedHours(calcHours(s, d));
  };
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<{ name: string; url: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!.from("profiles").select("id, name").order("name")
      .then(({ data }) => {
        if (data?.length) {
          setAssigneeList(data);
          setAssignee(data[0]?.name || "");
        }
      });
  }, []);

  const handleSave = async () => {
    if (!title.trim()) return;
    if (isSupabaseEnabled) {
      setSaving(true);
      await supabase!.from("sprint_tickets").insert({
        id: `T-${Date.now()}`, sprint_id: sprintId, wbs: "",
        title, status, priority, assignee,
        start_date: startDate || null, due_date: dueDate || null,
        estimated_hours: estimatedHours || 0, progress: 0,
        description: description || null,
      });
      setSaving(false);
    }
    onCreated?.();
    onClose();
  };

  return (
    <>
      <style>{`@keyframes slideInPanel{from{transform:translateX(102%)}to{transform:translateX(0)}}`}</style>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(10,14,12,0.30)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "48%", minWidth: 440, background: "#FAFAF8", zIndex: 201, boxShadow: "-16px 0 60px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", animation: "slideInPanel 0.28s cubic-bezier(0.16,1,0.3,1)" }}>

        <div style={{ padding: "22px 24px 18px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFFFFF", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>新規チケット</p>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.025em" }}>チケット作成</h2>
            </div>
            <button onClick={onClose} style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label className={labelCls}>チケット名 <span style={{ color: "#DC2626" }}>*</span></label>
            <input className={inputCls} placeholder="例: ログイン機能の修正" value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className={labelCls}>ステータス</label>
              <select className={inputCls} value={status} onChange={e => setStatus(e.target.value as TicketStatus)}>
                {TICKET_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>優先度</label>
              <select className={inputCls} value={priority} onChange={e => setPriority(e.target.value as Priority)}>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>担当者</label>
            <select className={inputCls} value={assignee} onChange={e => setAssignee(e.target.value)}>
              {assigneeList.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <DatePicker label="開始日" value={startDate}
              onChange={v => handleDateChange("start", v)}
              min={sprintStartDate} max={sprintEndDate} />
            <DatePicker label="終了日" value={dueDate}
              onChange={v => handleDateChange("due", v)}
              min={startDate || sprintStartDate} max={sprintEndDate} />
          </div>

          <div>
            <label className={labelCls}>見積工数（開始・終了日から自動計算）</label>
            <div style={{ background: "#F4F5F6", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#6B6458" }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{estimatedHours}</span> h
              {estimatedHours === 0 && <span style={{ fontSize: 11, color: "#C9C4BB", marginLeft: 8 }}>（開始日・終了日を入力すると自動計算されます）</span>}
            </div>
          </div>

          <div>
            <label className={labelCls}>詳細・概要</label>
            <RichEditor value={description} onChange={setDescription} placeholder="チケットの詳細説明、要件、受け入れ条件などを入力..." minHeight={160} />
          </div>

          <div>
            <label className={labelCls}>添付画像</label>
            <div style={{ border: "2px dashed rgba(26,23,20,0.12)", borderRadius: 10, padding: "14px", background: "#FAFAF8" }}>
              <label style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 5, cursor: "pointer" }}>
                <div style={{ width: 36, height: 36, background: "#F4F5F6", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Plus style={{ width: 16, height: 16, color: "#B0A9A4" }} />
                </div>
                <span style={{ fontSize: 12, color: "#B0A9A4" }}>クリックして画像を選択</span>
                <span style={{ fontSize: 10, color: "#C9C4BB" }}>PNG, JPG, GIF, WebP 対応</span>
                <input type="file" accept="image/*" multiple style={{ display: "none" }}
                  onChange={e => {
                    Array.from(e.target.files || []).forEach(file => {
                      if (!file.type.startsWith("image/")) return;
                      setImages(prev => [...prev, { name: file.name, url: URL.createObjectURL(file) }]);
                    });
                    e.target.value = "";
                  }} />
              </label>
              {images.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8, marginTop: 10 }}>
                  {images.map((img, i) => (
                    <div key={i} style={{ position: "relative", width: 68, height: 68 }}>
                      <img src={img.url} alt={img.name} style={{ width: 68, height: 68, objectFit: "cover" as const, borderRadius: 7, border: "1px solid rgba(26,23,20,0.10)" }} />
                      <button onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                        style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <X style={{ width: 10, height: 10, color: "#fff" }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: "16px 24px", borderTop: "1px solid rgba(26,23,20,0.07)", background: "#FFFFFF", flexShrink: 0, display: "flex", gap: 8 }}>
          <BtnPrimary onClick={handleSave}>{saving ? "保存中..." : "作成する"}</BtnPrimary>
          <BtnSecondary onClick={onClose}>キャンセル</BtnSecondary>
        </div>
      </div>
    </>
  );
}
