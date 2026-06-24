import { useEffect, useState, useRef, useCallback } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import type { TicketCategory, TicketStatus, Priority } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, SPRINTS, MEMBERS } from "@/app/data/mock";
import { labelCls, inputCls, TICKET_STATUSES } from "@/app/lib/helpers";
import { mapTicketCategory } from "@/app/lib/mappers";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePreviewPanel } from "@/app/contexts/PreviewPanelContext";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { DatePicker } from "@/app/components/shared/DatePicker";
import { fireSlackNotify } from "@/app/utils/slackNotify";
// CustomSelect コンポーネントをインポート
import { CustomSelect, type SelectOption } from "@/app/components/shared/CustomSelect";
// 削除確認UIと同じ統一デザインのモーダルを出すために ConfirmDialog をインポート
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { escStack } from "@/app/lib/escStack";

// 優先度の選択肢と色を定義
const PRIORITY_OPTIONS: SelectOption[] = [
  { value: "high", label: "高", color: "#DC2626", bg: "#FEF2F2" },
  { value: "medium", label: "中", color: "#D97706", bg: "#FFFBEB" },
  { value: "low", label: "低", color: "#0284C7", bg: "#F0F9FF" },
];

const CACHE_KEY_PREFIX = "new_ticket_draft_";

export function NewTicketDialog({ sprintId, projectId, projectSlug, onClose, onCreated, sprintStartDate, sprintEndDate, parentTicketId, parentWbs, zIndexBase = 200 }: {
  sprintId?: string; projectId?: string; projectSlug?: string; onClose: () => void; onCreated?: () => void;
  sprintStartDate?: string; sprintEndDate?: string;
  parentTicketId?: string; parentWbs?: string;
  zIndexBase?: number;
}) {
  const { userName, userRole, userOrgId } = useAuth();
  const { open: openPreview } = usePreviewPanel();
  const isChildMode = !!parentTicketId;
  const needsSelection = !sprintId && !isChildMode;

  const contextKey = `${CACHE_KEY_PREFIX}${projectId || "global"}_${sprintId || "global"}_${parentTicketId || "root"}`;

  // --- プロジェクト・スプリント選択 ---
  const [availableProjects, setAvailableProjects] = useState<{ id: string; name: string; slug?: string }[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [availableSprints, setAvailableSprints] = useState<{ id: string; name: string; startDate?: string; endDate?: string }[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState("");
  const [projectError, setProjectError] = useState(false);
  const [sprintError, setSprintError] = useState(false);

  const [currentProjectMembers, setCurrentProjectMembers] = useState<string[]>([]);
  const [projectTickets, setProjectTickets] = useState<{ wbs: string; title: string }[]>([]);
  const [projectBacklogItems, setProjectBacklogItems] = useState<{ id: string; title: string }[]>([]);
  const [projectWikiItems, setProjectWikiItems] = useState<{ id: string; title: string }[]>([]);
  const [projectMinuteItems, setProjectMinuteItems] = useState<{ id: string; title: string }[]>([]);

  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // --- チケット入力フィールド ---
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<TicketStatus>("todo");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assigneeList, setAssigneeList] = useState<{ id: string; name: string }[]>([]);
  const [assignee, setAssignee] = useState("");
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

  const effectiveSprintId = sprintId || selectedSprintId;
  const effectiveProjectId = projectId || selectedProjectId;
  const effectiveProjectSlug = projectSlug || availableProjects.find(p => p.id === effectiveProjectId)?.slug || "";
  const selectedSprintData = availableSprints.find(s => s.id === selectedSprintId);
  const effectiveSprintStart = sprintStartDate || selectedSprintData?.startDate;
  const effectiveSprintEnd = sprintEndDate || selectedSprintData?.endDate;

  const savedSprintIdRef = useRef<string>("");

  // 下書きデータの復元
  useEffect(() => {
    try {
      const savedDraft = localStorage.getItem(contextKey);
      if (savedDraft) {
        const draft = JSON.parse(savedDraft);
        if (draft.title) setTitle(draft.title);
        if (draft.status) setStatus(draft.status);
        if (draft.priority) setPriority(draft.priority);
        if (draft.categoryId) setCategoryId(draft.categoryId);
        if (draft.assignee) setAssignee(draft.assignee);
        if (draft.startDate) setStartDate(draft.startDate);
        if (draft.dueDate) setDueDate(draft.dueDate);
        if (draft.estimatedHours) setEstimatedHours(draft.estimatedHours);
        if (draft.description) setDescription(draft.description);
        if (draft.images) setImages(draft.images);
        if (needsSelection && draft.selectedProjectId) {
          setSelectedProjectId(draft.selectedProjectId);
        }
        if (needsSelection && draft.selectedSprintId) {
          savedSprintIdRef.current = draft.selectedSprintId;
          setSelectedSprintId(draft.selectedSprintId);
        }
      }
    } catch (e) {
      console.error("Failed to restore form draft:", e);
    }
  }, [contextKey, needsSelection]);

  useEffect(() => {
    if (needsSelection && availableSprints.length > 0 && savedSprintIdRef.current) {
      const exists = availableSprints.some(s => s.id === savedSprintIdRef.current);
      if (exists) {
        setSelectedSprintId(savedSprintIdRef.current);
      }
    }
  }, [availableSprints, needsSelection]);

  // 入力変更時のローカルストレージ自動退避
  useEffect(() => {
    if (saving) return;
    const draftPayload = {
      title,
      status,
      priority,
      categoryId,
      assignee,
      startDate,
      dueDate,
      estimatedHours,
      description,
      images,
      selectedProjectId,
      selectedSprintId
    };
    try {
      localStorage.setItem(contextKey, JSON.stringify(draftPayload));
    } catch (e) {
      console.error("Failed to update form draft:", e);
    }
  }, [title, status, priority, categoryId, assignee, startDate, dueDate, estimatedHours, description, images, selectedProjectId, selectedSprintId, contextKey, saving]);

  const handleInterceptClose = useCallback(() => {
    setShowCloseConfirm(true);
  }, []);

  useEffect(() => {
    escStack.push(handleInterceptClose);
    return () => escStack.pop(handleInterceptClose);
  }, [handleInterceptClose]);

  // 1. プロジェクト一覧と固定プロジェクト時のメンバー取得
  useEffect(() => {
    if (!isSupabaseEnabled) {
      const accessible = userRole === "admin" ? PROJECTS : PROJECTS.filter(p => p.members.includes(userName));
      setAvailableProjects(accessible.map(p => ({ id: p.id, name: p.name, slug: p.slug })));
      if (projectId) {
        const pData = PROJECTS.find(p => p.id === projectId);
        if (pData?.members) setCurrentProjectMembers(pData.members);
      }
      return;
    }

    supabase!.from("projects").select("id, name, members, slug").order("name").then(({ data }) => {
      if (data) {
        const accessible = userRole === "admin"
          ? data
          : data.filter((p: any) => {
            if (!Array.isArray(p.members)) return false;
            return p.members.some((m: any) => m && (m.name === userName || m === userName));
          });

        setAvailableProjects(accessible.map((p: any) => ({ id: p.id, name: p.name, slug: p.slug })));

        if (projectId) {
          const pData = data.find((p: any) => p.id === projectId);
          if (pData?.members) {
            const memberNames = Array.isArray(pData.members)
              ? pData.members.map((m: any) => typeof m === 'object' ? m?.name : m).filter(Boolean)
              : [];
            setCurrentProjectMembers(memberNames);
          }
        }
      }
    });
  }, [needsSelection, userName, userRole, projectId]);

  // 2. 選択されたプロジェクトに応じたスプリント一覧、メンバー情報の動的更新
  useEffect(() => {
    if (!effectiveProjectId) { setAvailableSprints([]); setSelectedSprintId(""); return; }

    if (!isSupabaseEnabled) {
      const mockSprints = SPRINTS.filter(s => s.projectId === effectiveProjectId).map(s => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate }));
      setAvailableSprints(mockSprints);
      if (needsSelection) {
        const pData = PROJECTS.find(p => p.id === effectiveProjectId);
        if (pData?.members) setCurrentProjectMembers(pData.members);
      }
      return;
    }

    supabase!.from("sprints").select("id, name, start_date, end_date").eq("project_id", effectiveProjectId).order("created_at")
      .then(({ data }) => {
        if (data) {
          const dbSprints = data.map((s: any) => ({ id: s.id, name: s.name, startDate: s.start_date, endDate: s.end_date }));
          setAvailableSprints(dbSprints);
        }
      });

    supabase!.from("projects").select("members").eq("id", effectiveProjectId).single().then(({ data }) => {
      if (data?.members) {
        setCurrentProjectMembers(data.members);
      }
    });

  }, [needsSelection, effectiveProjectId, contextKey]);

  // チケットメンション等の関連アイテムロード
  useEffect(() => {
    if (!isSupabaseEnabled || !effectiveProjectId) { setProjectTickets([]); return; }
    (async () => {
      const { data: sprintData } = await supabase!.from("sprints").select("id").eq("project_id", effectiveProjectId);
      if (!sprintData?.length) return;
      const { data } = await supabase!.from("sprint_tickets")
        .select("wbs, title")
        .in("sprint_id", sprintData.map((s: { id: string }) => s.id))
        .order("wbs");
      if (data) setProjectTickets(data as { wbs: string; title: string }[]);
    })();
    supabase!.from("backlog_items").select("id, title").eq("project_id", effectiveProjectId).order("id")
      .then(({ data }) => { if (data) setProjectBacklogItems(data as { id: string; title: string }[]); });
    supabase!.from("wiki_pages").select("id, title").eq("project_id", effectiveProjectId).eq("is_folder", false)
      .then(({ data }) => { if (data) setProjectWikiItems(data as { id: string; title: string }[]); });
    supabase!.from("meeting_minutes").select("id, title").eq("project_id", effectiveProjectId).order("meeting_date", { ascending: false })
      .then(({ data }) => { if (data) setProjectMinuteItems(data as { id: string; title: string }[]); });
  }, [effectiveProjectId]);

  const calcHours = (start: string, due: string) => {
    if (!start || !due) return 0;
    const diffDays = Math.round((new Date(due).getTime() - new Date(start).getTime()) / 86400000);
    return Math.max(0, diffDays + 1) * 8;
  };

  const handleDateChange = (field: "start" | "due", v: string) => {
    const s = field === "start" ? v : startDate;
    const d = field === "due" ? v : dueDate;
    if (field === "start") setStartDate(v); else setDueDate(v);
    setEstimatedHours(calcHours(s, d));
  };

  // 担当者選択肢のフィルタリング
  useEffect(() => {
    const noneOption = { id: "none", name: "担当者なし" };

    if (!isSupabaseEnabled) {
      const filteredMock = MEMBERS.filter(m => currentProjectMembers.includes(m.name));
      const list = filteredMock.map(m => ({ id: m.id, name: m.name }));
      setAssigneeList([noneOption, ...list]);
      if (currentProjectMembers.length > 0) {
        const cached = localStorage.getItem(contextKey);
        if (cached && JSON.parse(cached).assignee) {
          setAssignee(JSON.parse(cached).assignee);
        } else {
          setAssignee(list[0]?.name || "担当者なし");
        }
      }
      return;
    }

    let pq = supabase!.from("profiles").select("id, name").order("name");
    if (userOrgId) pq = pq.eq("organization_id", userOrgId);
    pq.then(({ data }) => {
      if (data) {
        const filtered = data.filter((u: any) => currentProjectMembers.includes(u.name));
        setAssigneeList([noneOption, ...filtered]);
        if (currentProjectMembers.length > 0) {
          const cached = localStorage.getItem(contextKey);
          if (cached && JSON.parse(cached).assignee) {
            setAssignee(JSON.parse(cached).assignee);
          } else {
            const hasMe = filtered.some((u: any) => u.name === userName);
            setAssignee(hasMe ? userName : (filtered[0]?.name || "担当者なし"));
          }
        }
      }
    });
  }, [currentProjectMembers, userName, contextKey]);

  const [wbsPrefix, setWbsPrefix] = useState("T");

  useEffect(() => {
    if (!isSupabaseEnabled || !effectiveProjectId) return;
    supabase!.from("ticket_categories").select("*").eq("project_id", effectiveProjectId).order("created_at")
      .then(({ data }) => { if (data) setCategories(data.map(mapTicketCategory)); });
    supabase!.from("projects").select("wbs_prefix").eq("id", effectiveProjectId).single()
      .then(({ data }) => { if (data?.wbs_prefix) setWbsPrefix(data.wbs_prefix); });
  }, [effectiveProjectId]);

  useEffect(() => {
    if (!isSupabaseEnabled || !effectiveSprintId) return;
    supabase!.from("sprints").select("identifier").eq("id", effectiveSprintId).single()
      .then(({ data }) => { if (data?.identifier) setWbsPrefix(data.identifier); });
  }, [effectiveSprintId]);

  const executeFormClear = () => {
    savedSprintIdRef.current = "";
    setTitle("");
    setStatus("todo");
    setPriority("medium");
    setAssignee("");
    setStartDate("");
    setDueDate("");
    setEstimatedHours(0);
    setDescription("");
    setImages([]);
    setCategoryId("");
    if (needsSelection) {
      setSelectedProjectId("");
      setSelectedSprintId("");
    }
    setTitleError(false);
    setProjectError(false);
    setSprintError(false);
    try {
      localStorage.removeItem(contextKey);
    } catch (e) {
      console.error("Failed to purge form draft cache:", e);
    }
  };

  const addImages = useCallback(async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      if (isSupabaseEnabled) {
        const extMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
        const ext = extMap[f.type] ?? 'png';
        const path = `tickets/${ticketId.current}/detail/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const { data, error } = await supabase!.storage.from("ticket-images").upload(path, f, { upsert: false });
        if (error || !data) { console.error("[image upload] failed:", error); continue; }
        const { data: { publicUrl } } = supabase!.storage.from("ticket-images").getPublicUrl(path);
        setImages(prev => [...prev, publicUrl]);
      } else {
        const reader = new FileReader();
        reader.onload = e => { if (e.target?.result) setImages(prev => [...prev, e.target!.result as string]); };
        reader.readAsDataURL(f);
      }
    }
  }, []);

  // RichEditor(contenteditable)にフォーカスがあると React onPaste が届かないため
  // document レベルでキャプチャして画像だけ処理する
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imgFiles = items.filter(i => i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean) as File[];
      if (imgFiles.length === 0) return;
      e.preventDefault();
      addImages(imgFiles);
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [addImages]);

  const handleSave = async () => {
    let valid = true;
    if (needsSelection && !selectedProjectId) { setProjectError(true); valid = false; }
    if (needsSelection && !selectedSprintId) { setSprintError(true); valid = false; }
    if (!title.trim()) { setTitleError(true); valid = false; }
    if (!valid) return;

    const finalAssignee = (assignee === "担当者なし" || !assignee) ? "" : assignee;

    const notifyMentions = async (ticketWbs: string) => {
      if (!description || !effectiveProjectSlug) return;
      const stripped = description.replace(/<[^>]*>/g, " ");
      const mentionedNames = currentProjectMembers.filter(name => name !== userName && stripped.includes(`@${name}`));
      for (const name of mentionedNames) {
        const { error } = await supabase!.from("notifications").insert({
          user_name: name,
          type: "mention",
          title: `${userName}さんにメンションされました`,
          body: `${ticketWbs}: ${title}（チケット作成）`,
          ticket_id: ticketId.current,
          ticket_wbs: ticketWbs,
          ticket_title: title,
          project_slug: effectiveProjectSlug,
          is_read: false,
        });
        if (error) console.error("[mention] new ticket insert failed:", error.message);
      }
      if (mentionedNames.length > 0) {
        fireSlackNotify({
          recipientUserNames: mentionedNames,
          projectSlug: effectiveProjectSlug,
          title: `${userName}さんにメンションされました`,
          body: `<${window.location.origin}/${effectiveProjectSlug}/${ticketWbs}|${ticketWbs}: ${title}>（チケット作成）`,
        });
      }
    };

    setSaving(true);

    if (isSupabaseEnabled) {
      let wbs: string;
      if (isChildMode && parentTicketId && parentWbs) {
        const { data: maxChildRow } = await supabase!
          .from("sprint_tickets")
          .select("wbs")
          .eq("parent_id", parentTicketId)
          .like("wbs", `${parentWbs}-%`)
          .order("wbs", { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextNum = maxChildRow?.wbs
          ? (parseInt(maxChildRow.wbs.slice(parentWbs.length + 1), 10) || 0) + 1
          : 1;

        wbs = `${parentWbs}-${nextNum}`;
        if (!effectiveSprintId) {
          const { data: parentRow } = await supabase!
            .from("sprint_tickets").select("sprint_id").eq("id", parentTicketId).single();
          if (parentRow?.sprint_id) {
            const { error: insErr } = await supabase!.from("sprint_tickets").insert({
              id: ticketId.current, sprint_id: parentRow.sprint_id, wbs,
              title, status, priority, assignee: finalAssignee,
              start_date: startDate || null, due_date: dueDate || null,
              estimated_hours: estimatedHours || 0, progress: 0,
              description: description || null,
              category_id: categoryId || null,
              created_by: userName || null,
              images: images.length ? images : [],
              parent_id: parentTicketId,
            });
            if (!insErr) {
              if (finalAssignee && effectiveProjectSlug) {
                const { error: nErr } = await supabase!.from("notifications").insert({
                  user_name: finalAssignee, type: "assign",
                  title: "チケットが割り当てられました",
                  body: `${wbs}: ${title}`,
                  ticket_id: ticketId.current, ticket_wbs: wbs, ticket_title: title,
                  project_slug: effectiveProjectSlug, is_read: false,
                });
                if (nErr) console.error("[notifications] new ticket (child early) insert failed:", nErr.message);
                fireSlackNotify({ recipientUserNames: [finalAssignee], projectSlug: effectiveProjectSlug, title: "チケットが割り当てられました", body: `${wbs}: ${title}` });
              }
              await notifyMentions(wbs);
            }
            try { localStorage.removeItem(contextKey); } catch (e) { }
            savedSprintIdRef.current = "";
            setSaving(false);
            onCreated?.();
            onClose();
            return;
          }
        }
      } else {
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
        title, status, priority, assignee: finalAssignee,
        start_date: startDate || null, due_date: dueDate || null,
        estimated_hours: estimatedHours || 0, progress: 0,
        description: description || null,
        category_id: categoryId || null,
        created_by: userName || null,
        images: images.length ? images : [],
        parent_id: parentTicketId || null,
      });
      if (!insErr2) {
        if (finalAssignee && effectiveProjectSlug) {
          const { error: nErr2 } = await supabase!.from("notifications").insert({
            user_name: finalAssignee, type: "assign",
            title: "チケットが割り当てられました",
            body: `${wbs}: ${title}`,
            ticket_id: ticketId.current, ticket_wbs: wbs, ticket_title: title,
            project_slug: effectiveProjectSlug, is_read: false,
          });
          if (nErr2) console.error("[notifications] new ticket insert failed:", nErr2.message);
          fireSlackNotify({ recipientUserNames: [finalAssignee], projectSlug: effectiveProjectSlug, title: "チケットが割り当てられました", body: `${wbs}: ${title}` });
        }
        await notifyMentions(wbs);
      }
      try { localStorage.removeItem(contextKey); } catch (e) { }
      savedSprintIdRef.current = "";
      setSaving(false);
    } else {
      try { localStorage.removeItem(contextKey); } catch (e) { }
      savedSprintIdRef.current = "";
      setSaving(false);
    }
    onCreated?.();
    onClose();
  };



  return (
    <>
      <style>{`@keyframes slideInPanel{from{transform:translateX(102%)}to{transform:translateX(0)}}`}</style>
      <div onClick={handleInterceptClose} style={{ position: "fixed", inset: 0, zIndex: zIndexBase, background: "rgba(10,14,12,0.30)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "48%", minWidth: 440, background: "#FAFAF8", zIndex: zIndexBase + 1, boxShadow: "-16px 0 60px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", animation: "slideInPanel 0.28s cubic-bezier(0.16,1,0.3,1)" }}>

        <div style={{ padding: "22px 24px 18px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFFFFF", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{isChildMode ? "子チケット作成" : "新規チケット"}</p>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.025em" }}>{isChildMode ? `子チケット作成 (${parentWbs})` : "チケット作成"}</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                title="入力内容をすべてクリア"
                style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4", display: "flex", alignItems: "center", justifyContent: "center" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
                <Trash2 style={{ width: 16, height: 16 }} />
              </button>
              <button onClick={handleInterceptClose} style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* プロジェクト・スプリント選択 */}
          {needsSelection && (
            <div style={{ background: "#F0FDF8", borderRadius: 12, border: "1px solid rgba(5,150,105,0.18)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#059669", letterSpacing: "0.04em", textTransform: "uppercase" as const }}>追加先を選択</p>
              <div>
                <label className={labelCls}>プロジェクト <span style={{ color: "#DC2626" }}>*</span></label>
                <div style={projectError ? { outline: "2px solid #DC2626", outlineOffset: 1, borderRadius: 8 } : undefined}>
                  <CustomSelect
                    value={selectedProjectId}
                    options={availableProjects.map(p => ({ value: p.id, label: p.name }))}
                    onChange={v => { setSelectedProjectId(v); setProjectError(false); setSelectedSprintId(""); setSprintError(false); if (!saving) { savedSprintIdRef.current = ""; } }}
                    placeholder="プロジェクトを選択してください"
                  />
                </div>
                {projectError && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 5 }}>プロジェクトを選択してください</p>}
              </div>
              <div>
                <label className={labelCls}>スプリント <span style={{ color: "#DC2626" }}>*</span></label>
                <div style={sprintError ? { outline: "2px solid #DC2626", outlineOffset: 1, borderRadius: 8 } : undefined}>
                  <CustomSelect
                    value={selectedSprintId}
                    options={availableSprints.map(s => ({ value: s.id, label: s.name }))}
                    onChange={v => { setSelectedSprintId(v); setSprintError(false); if (!saving) { savedSprintIdRef.current = v; } }}
                    disabled={!selectedProjectId}
                    placeholder={
                      !selectedProjectId
                        ? "先にプロジェクトを選択してください"
                        : availableSprints.length === 0
                          ? "スプリントがありません"
                          : "スプリントを選択してください"
                    }
                  />
                </div>
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
              <CustomSelect
                value={status}
                options={isChildMode
                  ? [
                    { value: "todo", label: "未着手", color: "#6B7280", bg: "#F3F4F6" },
                    { value: "in-progress", label: "進行中", color: "#D97706", bg: "#FFF7ED" },
                    { value: "closed", label: "対応完了", color: "#059669", bg: "#ECFDF5" },
                  ]
                  : TICKET_STATUSES.map(s => ({ value: s.value, label: s.label, color: s.color, bg: s.bg }))}
                onChange={v => setStatus(v as TicketStatus)}
              />
            </div>
            <div>
              <label className={labelCls}>優先度</label>
              <CustomSelect
                value={priority}
                options={PRIORITY_OPTIONS}
                onChange={v => setPriority(v as Priority)}
              />
            </div>
          </div>

          {categories.length > 0 && (
            <div>
              <label className={labelCls}>分類</label>
              <CustomSelect
                value={categoryId}
                options={[
                  { value: "", label: "分類なし" },
                  ...categories.map(c => ({ value: c.id, label: c.name }))
                ]}
                onChange={v => setCategoryId(v)}
                placeholder="分類なし"
              />
            </div>
          )}

          <div>
            <label className={labelCls}>担当者</label>
            <CustomSelect
              value={assignee}
              options={assigneeList.map(m => ({ value: m.name, label: m.name }))}
              onChange={v => setAssignee(v)}
            />
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
            <RichEditor value={description} onChange={setDescription} placeholder="チケットの詳細説明、要件、受け入れ条件などを入力..." minHeight={300} maxHeight={300} members={currentProjectMembers} tickets={projectTickets} backlogItems={projectBacklogItems} wikiItems={projectWikiItems} minuteItems={projectMinuteItems} onBacklogClick={id => openPreview("backlog", id)} onWikiClick={id => openPreview("wiki", id)} onMinuteClick={id => openPreview("minute", id)} />
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
                <BtnSecondary onClick={handleInterceptClose}>キャンセル</BtnSecondary>
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

      {showCloseConfirm && (
        <ConfirmDialog
          title="画面を閉じる確認"
          message="チケットを閉じますか？"
          confirmLabel="閉じる"
          confirmColor="#059669"
          hasWarningText={false}
          zIndex={zIndexBase + 10}
          onConfirm={onClose}
          onClose={() => setShowCloseConfirm(false)}
        />
      )}

      {showClearConfirm && (
        <ConfirmDialog
          title="入力内容のクリア"
          message="入力内容をすべて消去しますか？"
          confirmLabel="消去する"
          confirmColor="#DC2626"
          hasWarningText={false}
          zIndex={zIndexBase + 10}
          onConfirm={executeFormClear}
          onClose={() => setShowClearConfirm(false)}
        />
      )}
    </>
  );
}