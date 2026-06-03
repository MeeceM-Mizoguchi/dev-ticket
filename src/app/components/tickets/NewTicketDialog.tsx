import { useEffect, useState, useRef, useCallback } from "react";
import { Plus, X } from "lucide-react";
import type { TicketCategory, TicketStatus, Priority } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, SPRINTS, MEMBERS } from "@/app/data/mock";
import { labelCls, inputCls, TICKET_STATUSES } from "@/app/lib/helpers";
import { mapTicketCategory } from "@/app/lib/mappers";
import { useAuth } from "@/app/contexts/AuthContext";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { DatePicker } from "@/app/components/shared/DatePicker";

export function NewTicketDialog({ sprintId, projectId, projectSlug, onClose, onCreated, sprintStartDate, sprintEndDate, parentTicketId, parentWbs, zIndexBase = 200 }: {
  sprintId?: string; projectId?: string; projectSlug?: string; onClose: () => void; onCreated?: () => void;
  sprintStartDate?: string; sprintEndDate?: string;
  // 子チケット作成モード用。parentTicketId が指定された場合は子チケットとして作成される。将来の孫チケット対応も同プロパティを再利用予定。
  parentTicketId?: string; parentWbs?: string;
  zIndexBase?: number; // TicketDetailPanel 内から呼ぶ際は 310 を指定してz-index競合を回避
}) {
  const { userName, userRole } = useAuth();
  const isAdmin = userRole === "admin" || userRole === "project-manager";
  const isChildMode = !!parentTicketId;
  const needsSelection = !sprintId && !isChildMode;

  // --- プロジェクト・スプリント選択（ダッシュボードから開く場合） ---
  const [availableProjects, setAvailableProjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [availableSprints, setAvailableSprints] = useState<{ id: string; name: string; startDate?: string; endDate?: string }[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState("");
  const [projectError, setProjectError] = useState(false);
  const [sprintError, setSprintError] = useState(false);

  const effectiveSprintId = sprintId || selectedSprintId;
  const effectiveProjectId = projectId || selectedProjectId;
  const selectedSprintData = availableSprints.find(s => s.id === selectedSprintId);
  const effectiveSprintStart = sprintStartDate || selectedSprintData?.startDate;
  const effectiveSprintEnd = sprintEndDate || selectedSprintData?.endDate;

  useEffect(() => {
    if (!needsSelection) return;
    if (!isSupabaseEnabled) {
      const accessible = isAdmin ? PROJECTS : PROJECTS.filter(p => p.members.includes(userName));
      setAvailableProjects(accessible.map(p => ({ id: p.id, name: p.name })));
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase!.from("projects").select("id, name, members").order("name").then(({ data }) => {
      if (data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const accessible = isAdmin ? data : data.filter((p: any) => Array.isArray(p.members) && p.members.includes(userName));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setAvailableProjects(accessible.map((p: any) => ({ id: p.id, name: p.name })));
      }
    });
  }, [needsSelection, isAdmin, userName]);

  useEffect(() => {
    if (!needsSelection || !selectedProjectId) { setAvailableSprints([]); setSelectedSprintId(""); return; }
    if (!isSupabaseEnabled) {
      setAvailableSprints(SPRINTS.filter(s => s.projectId === selectedProjectId).map(s => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate })));
      setSelectedSprintId("");
      return;
    }
    supabase!.from("sprints").select("id, name, start_date, end_date").eq("project_id", selectedProjectId).order("created_at")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (data) setAvailableSprints(data.map((s: any) => ({ id: s.id, name: s.name, startDate: s.start_date, endDate: s.end_date })));
        setSelectedSprintId("");
      });
  }, [needsSelection, selectedProjectId]);

  // --- チケット入力フィールド ---
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
  const [description, setDescription] = useState("");
  const ticketId = useRef<string>(`T-${Date.now()}`);
  const [images, setImages] = useState<string[]>([]);
  const [imageDragOver, setImageDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");

  const calcHours = (start: string, due: string) => {
    if (!start || !due) return 0;
    return Math.max(0, Math.round((new Date(due).getTime() - new Date(start).getTime()) / 86400000)) * 8;
  };
  const handleDateChange = (field: "start" | "due", v: string) => {
    const s = field === "start" ? v : startDate;
    const d = field === "due" ? v : dueDate;
    if (field === "start") setStartDate(v); else setDueDate(v);
    setEstimatedHours(calcHours(s, d));
  };

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!.from("profiles").select("id, name").order("name").then(({ data }) => {
      if (data?.length) { setAssigneeList(data); setAssignee(data[0]?.name || ""); }
    });
  }, []);

  const [wbsPrefix, setWbsPrefix] = useState("T");

  useEffect(() => {
    if (!isSupabaseEnabled || !effectiveProjectId) return;
    supabase!.from("ticket_categories").select("*").eq("project_id", effectiveProjectId).order("created_at")
      .then(({ data }) => { if (data) setCategories(data.map(mapTicketCategory)); });
    // Project prefix is fallback when sprint has no identifier
    supabase!.from("projects").select("wbs_prefix").eq("id", effectiveProjectId).single()
      .then(({ data }) => { if (data?.wbs_prefix) setWbsPrefix(data.wbs_prefix); });
  }, [effectiveProjectId]);

  // Sprint identifier takes priority over project prefix
  useEffect(() => {
    if (!isSupabaseEnabled || !effectiveSprintId) return;
    supabase!.from("sprints").select("identifier").eq("id", effectiveSprintId).single()
      .then(({ data }) => { if (data?.identifier) setWbsPrefix(data.identifier); });
  }, [effectiveSprintId]);

  const uploadImageToStorage = useCallback(async (file: Blob): Promise<string> => {
    if (!isSupabaseEnabled) return URL.createObjectURL(file);
    const extMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
    const ext = extMap[file.type] ?? 'png';
    const path = `tickets/${ticketId.current}/detail/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { data, error } = await supabase!.storage.from("ticket-images").upload(path, file, { upsert: true, contentType: file.type || 'image/png' });
    if (error || !data) return "";
    const { data: urlData } = supabase!.storage.from("ticket-images").getPublicUrl(path);
    return urlData.publicUrl;
  }, []);

  const addImages = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const url = await uploadImageToStorage(file);
      if (url) setImages(prev => [...prev, url]);
    }
  }, [uploadImageToStorage]);

  const handleSave = async () => {
    let valid = true;
    if (needsSelection && !selectedProjectId) { setProjectError(true); valid = false; }
    if (needsSelection && !selectedSprintId) { setSprintError(true); valid = false; }
    if (!title.trim()) { setTitleError(true); valid = false; }
    if (!valid) return;

    if (isSupabaseEnabled) {
      setSaving(true);
      let wbs: string;
      if (isChildMode && parentTicketId && parentWbs) {
        // 子チケットのWBS: 親WBS + "-" + 連番 (例: PRJ-001-1, PRJ-001-2)
        const { data: existingChildren } = await supabase!
          .from("sprint_tickets").select("id").eq("parent_id", parentTicketId);
        const nextNum = (existingChildren?.length ?? 0) + 1;
        wbs = `${parentWbs}-${nextNum}`;
        // sprintId が未指定の場合は親チケットから取得
        if (!effectiveSprintId) {
          const { data: parentRow } = await supabase!
            .from("sprint_tickets").select("sprint_id").eq("id", parentTicketId).single();
          if (parentRow?.sprint_id) {
            const { error: insErr } = await supabase!.from("sprint_tickets").insert({
              id: ticketId.current, sprint_id: parentRow.sprint_id, wbs,
              title, status, priority, assignee,
              start_date: startDate || null, due_date: dueDate || null,
              estimated_hours: estimatedHours || 0, progress: 0,
              description: description || null,
              category_id: categoryId || null,
              created_by: userName || null,
              images: images.length ? images : [],
              parent_id: parentTicketId,
            });
            if (!insErr && assignee && projectSlug) {
              const { error: nErr } = await supabase!.from("notifications").insert({
                user_name: assignee, type: "assign",
                title: "チケットが割り当てられました",
                body: `${wbs}: ${title}`,
                ticket_id: ticketId.current, ticket_wbs: wbs, ticket_title: title,
                project_slug: projectSlug, is_read: false,
              });
              if (nErr) console.error("[notifications] new ticket (child early) insert failed:", nErr.message);
            }
            setSaving(false);
            onCreated?.();
            onClose();
            return;
          }
        }
      } else {
        // プロジェクト内の全スプリントIDを取得し、プロジェクトスコープでwbs連番を生成
        // identifier も一緒に取得することで、state の非同期タイミング問題を回避する
        const { data: sprintRows } = await supabase!.from("sprints").select("id, identifier").eq("project_id", effectiveProjectId!);
        const sprintIds = sprintRows?.map(s => s.id) ?? [];
        const currentSprintIdentifier = sprintRows?.find(s => s.id === effectiveSprintId)?.identifier;
        const prefix = currentSprintIdentifier || wbsPrefix || "T";
        let nextNum = 1;
        if (sprintIds.length > 0) {
          const { data: maxRow } = await supabase!
            .from("sprint_tickets")
            .select("wbs")
            .in("sprint_id", sprintIds)
            .like("wbs", `${prefix}-%`)
            .not("wbs", "like", `${prefix}-%-_%`)
            .order("wbs", { ascending: false })
            .limit(1)
            .maybeSingle();
          nextNum = (parseInt(maxRow?.wbs?.slice(prefix.length + 1) ?? "0", 10) || 0) + 1;
        }
        wbs = `${prefix}-${String(nextNum).padStart(3, "0")}`;
      }
      const { error: insErr2 } = await supabase!.from("sprint_tickets").insert({
        id: ticketId.current, sprint_id: effectiveSprintId, wbs,
        title, status, priority, assignee,
        start_date: startDate || null, due_date: dueDate || null,
        estimated_hours: estimatedHours || 0, progress: 0,
        description: description || null,
        category_id: categoryId || null,
        created_by: userName || null,
        images: images.length ? images : [],
        parent_id: parentTicketId || null,
      });
      if (!insErr2 && assignee && projectSlug) {
        const { error: nErr2 } = await supabase!.from("notifications").insert({
          user_name: assignee, type: "assign",
          title: "チケットが割り当てられました",
          body: `${wbs}: ${title}`,
          ticket_id: ticketId.current, ticket_wbs: wbs, ticket_title: title,
          project_slug: projectSlug, is_read: false,
        });
        if (nErr2) console.error("[notifications] new ticket insert failed:", nErr2.message);
      }
      setSaving(false);
    }
    onCreated?.();
    onClose();
  };

  return (
    <>
      <style>{`@keyframes slideInPanel{from{transform:translateX(102%)}to{transform:translateX(0)}}`}</style>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: zIndexBase, background: "rgba(10,14,12,0.30)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "48%", minWidth: 440, background: "#FAFAF8", zIndex: zIndexBase + 1, boxShadow: "-16px 0 60px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", animation: "slideInPanel 0.28s cubic-bezier(0.16,1,0.3,1)" }}>

        <div style={{ padding: "22px 24px 18px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFFFFF", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{isChildMode ? "子チケット作成" : "新規チケット"}</p>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.025em" }}>{isChildMode ? `子チケット作成 (${parentWbs})` : "チケット作成"}</h2>
            </div>
            <button onClick={onClose} style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>

        <div onPaste={e => {
          const items = Array.from(e.clipboardData?.items ?? []);
          const imgFiles = items.filter(i => i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean) as File[];
          if (imgFiles.length === 0) return;
          e.preventDefault();
          addImages(imgFiles);
        }} style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* プロジェクト・スプリント選択（ダッシュボードから開く場合のみ表示） */}
          {needsSelection && (
            <div style={{ background: "#F0FDF8", borderRadius: 12, border: "1px solid rgba(5,150,105,0.18)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#059669", letterSpacing: "0.04em", textTransform: "uppercase" as const }}>追加先を選択</p>
              <div>
                <label className={labelCls}>プロジェクト <span style={{ color: "#DC2626" }}>*</span></label>
                <select
                  className={inputCls}
                  value={selectedProjectId}
                  onChange={e => { setSelectedProjectId(e.target.value); setProjectError(false); setSelectedSprintId(""); setSprintError(false); }}
                  style={projectError ? { outline: "2px solid #DC2626", outlineOffset: 1 } : undefined}
                >
                  <option value="">プロジェクトを選択してください</option>
                  {availableProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {projectError && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 5 }}>プロジェクトを選択してください</p>}
              </div>
              <div>
                <label className={labelCls}>スプリント <span style={{ color: "#DC2626" }}>*</span></label>
                <select
                  className={inputCls}
                  value={selectedSprintId}
                  onChange={e => { setSelectedSprintId(e.target.value); setSprintError(false); }}
                  disabled={!selectedProjectId}
                  style={sprintError ? { outline: "2px solid #DC2626", outlineOffset: 1 } : undefined}
                >
                  <option value="">
                    {!selectedProjectId
                      ? "先にプロジェクトを選択してください"
                      : availableSprints.length === 0
                        ? "スプリントがありません"
                        : "スプリントを選択してください"}
                  </option>
                  {availableSprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {sprintError && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 5 }}>スプリントを選択してください</p>}
              </div>
            </div>
          )}

          <div>
            <label className={labelCls}>チケット名 <span style={{ color: "#DC2626" }}>*</span></label>
            <input className={inputCls} placeholder="例: ログイン機能の修正" value={title}
              onChange={e => { setTitle(e.target.value); if (e.target.value.trim()) setTitleError(false); }}
              style={titleError ? { outline: "2px solid #DC2626", outlineOffset: 1 } : undefined} />
            {titleError && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 5 }}>チケット名を入力してください</p>}
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

          {categories.length > 0 && (
            <div>
              <label className={labelCls}>分類</label>
              <select className={inputCls} value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                <option value="">分類なし</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={labelCls}>担当者</label>
            <select className={inputCls} value={assignee} onChange={e => setAssignee(e.target.value)}>
              {assigneeList.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <DatePicker label="開始日" value={startDate}
              onChange={v => handleDateChange("start", v)}
              min={effectiveSprintStart} max={effectiveSprintEnd} />
            <DatePicker label="終了日" value={dueDate}
              onChange={v => handleDateChange("due", v)}
              min={startDate || effectiveSprintStart} max={effectiveSprintEnd} />
          </div>

          <div>
            <label className={labelCls}>見積工数（開始・終了日から自動計算）</label>
            <div style={{ background: "#F4F5F6", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#6B6458" }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{estimatedHours}</span> h
              {estimatedHours === 0 && <span style={{ fontSize: 11, color: "#C9C4BB", marginLeft: 8 }}>（開始日・終了日を入力すると自動計算されます）</span>}
            </div>
          </div>

          <div>
            <label className={labelCls}>詳細</label>
            <RichEditor value={description} onChange={setDescription} placeholder="チケットの詳細説明、要件、受け入れ条件などを入力..." minHeight={300} maxHeight={300} />
          </div>

          <div>
            <label className={labelCls}>添付画像</label>
            <div
              onDragOver={e => { e.preventDefault(); setImageDragOver(true); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setImageDragOver(false); }}
              onDrop={e => { e.preventDefault(); setImageDragOver(false); addImages(e.dataTransfer.files); }}
              style={{ border: `2px dashed ${imageDragOver ? "rgba(5,150,105,0.5)" : "rgba(26,23,20,0.12)"}`, borderRadius: 10, padding: "14px", background: imageDragOver ? "rgba(5,150,105,0.04)" : "#FAFAF8", transition: "border-color 0.15s, background 0.15s" }}>
              <label style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 5, cursor: "pointer" }}>
                <div style={{ width: 36, height: 36, background: imageDragOver ? "rgba(5,150,105,0.10)" : "#F4F5F6", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" }}>
                  <Plus style={{ width: 16, height: 16, color: imageDragOver ? "#059669" : "#B0A9A4" }} />
                </div>
                <span style={{ fontSize: 12, color: imageDragOver ? "#059669" : "#B0A9A4" }}>
                  {imageDragOver ? "ドロップして追加" : "クリックして選択、Ctrl+V で貼り付け、またはドラッグ&ドロップ"}
                </span>
                <span style={{ fontSize: 10, color: "#C9C4BB" }}>PNG, JPG, GIF, WebP 対応</span>
                <input type="file" accept="image/*" multiple style={{ display: "none" }}
                  onChange={e => { addImages(e.target.files || []); e.target.value = ""; }} />
              </label>
              {images.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8, marginTop: 10 }}>
                  {images.map((url, i) => (
                    <div key={i} style={{ position: "relative", width: 68, height: 68 }}>
                      <img src={url} alt="" style={{ width: 68, height: 68, objectFit: "cover" as const, borderRadius: 7, border: "1px solid rgba(26,23,20,0.10)" }} />
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

        <div style={{ padding: "16px 24px", borderTop: "1px solid rgba(26,23,20,0.07)", background: "#FFFFFF", flexShrink: 0, display: "flex", gap: 8, alignItems: "center" }}>
          {(() => {
            const errs: string[] = [];
            if (needsSelection && !selectedProjectId) errs.push("プロジェクト");
            if (needsSelection && !selectedSprintId) errs.push("スプリント");
            if (!title.trim()) errs.push("チケット名");
            const isValid = errs.length === 0;
            return (
              <>
                <BtnPrimary onClick={handleSave} disabled={!isValid || saving}>{saving ? "保存中..." : "作成する"}</BtnPrimary>
                <BtnSecondary onClick={onClose}>キャンセル</BtnSecondary>
                {!isValid && (
                  <span style={{ fontSize: 11, color: "#DC2626", marginLeft: 4 }}>
                    {errs.join("・")}を入力してください
                  </span>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </>
  );
}
