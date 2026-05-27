import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { TicketStatus, Priority } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { MEMBERS } from "@/app/data/mock";
import { labelCls } from "@/app/lib/helpers";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldSelect } from "@/app/components/shared/FieldSelect";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";

export function NewTicketDialog({ sprintId, onClose, onCreated }: { sprintId: string; onClose: () => void; onCreated?: () => void }) {
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
