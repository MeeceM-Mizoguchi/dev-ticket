import { useEffect, useState, useRef, useCallback } from "react";
import { Plus, X, Trash2 } from "lucide-react";
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
import { fireSlackNotify } from "@/app/utils/slackNotify";
// 🌟 追加: CustomSelect コンポーネントをインポート
import { CustomSelect, type SelectOption } from "@/app/components/shared/CustomSelect";
// 🛠️ 削除確認UIと同じ統一デザインのモーダルを出すために ConfirmDialog をインポート
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";

// 🌟 追加: 優先度の選択肢と色を定義
const PRIORITY_OPTIONS: SelectOption[] = [
  { value: "high", label: "高", color: "#DC2626", bg: "#FEF2F2" },
  { value: "medium", label: "中", color: "#D97706", bg: "#FFFBEB" },
  { value: "low", label: "低", color: "#0284C7", bg: "#F0F9FF" },
];

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
  const [availableProjects, setAvailableProjects] = useState<{ id: string; name: string; slug?: string }[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [availableSprints, setAvailableSprints] = useState<{ id: string; name: string; startDate?: string; endDate?: string }[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState("");
  const [projectError, setProjectError] = useState(false);
  const [sprintError, setSprintError] = useState(false);

  // 現在選択されている（または親から渡された）プロジェクトのメンバー名の配列
  const [currentProjectMembers, setCurrentProjectMembers] = useState<string[]>([]);

  // 🛠️ 確認用モーダルダイアログの表示状態を管理するステートを追加
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const effectiveSprintId = sprintId || selectedSprintId;
  const effectiveProjectId = projectId || selectedProjectId;
  // 🌟 追加: ダッシュボードから選択した場合でも、正しい projectSlug を特定して保持する
  const effectiveProjectSlug = projectSlug || availableProjects.find(p => p.id === effectiveProjectId)?.slug || "";
  const selectedSprintData = availableSprints.find(s => s.id === selectedSprintId);
  const effectiveSprintStart = sprintStartDate || selectedSprintData?.startDate;
  const effectiveSprintEnd = sprintEndDate || selectedSprintData?.endDate;

  // 🛠️ バツボタン、キャンセルボタン、背景マスクがクリックされた際に確認画面を呼び出すハンドラー
  const handleInterceptClose = () => {
    setShowCloseConfirm(true);
  };

  // 1. プロジェクト一覧の取得、および固定プロジェクト時のメンバー取得
  useEffect(() => {
    if (!isSupabaseEnabled) {
      const accessible = isAdmin ? PROJECTS : PROJECTS.filter(p => p.members.includes(userName));
      setAvailableProjects(accessible.map(p => ({ id: p.id, name: p.name, slug: p.slug })));

      // 親から固定の projectId が渡されている場合はそのメンバーを設定
      if (projectId) {
        const pData = PROJECTS.find(p => p.id === projectId);
        if (pData?.members) setCurrentProjectMembers(pData.members);
      }
      return;
    }

    // 🌟 修正: 通知用に `slug` カラムもデータベースから同時に取得する
    supabase!.from("projects").select("id, name, members, slug").order("name").then(({ data }) => {
      if (data) {
        const accessible = isAdmin ? data : data.filter((p: any) => Array.isArray(p.members) && p.members.includes(userName));
        setAvailableProjects(accessible.map((p: any) => ({ id: p.id, name: p.name, slug: p.slug })));

        // 親から固定の projectId が渡されている場合は、そのプロジェクトの所属メンバー名配列を初期設定
        if (projectId) {
          const pData = data.find((p: any) => p.id === projectId);
          if (pData?.members) setCurrentProjectMembers(pData.members);
        }
      }
    });
  }, [needsSelection, isAdmin, userName, projectId]);


  // 2. 選択されたプロジェクトに応じたスプリント一覧、およびメンバー情報の動的更新
  useEffect(() => {
    if (!effectiveProjectId) { setAvailableSprints([]); setSelectedSprintId(""); return; }

    if (!isSupabaseEnabled) {
      setAvailableSprints(SPRINTS.filter(s => s.projectId === effectiveProjectId).map(s => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate })));
      if (needsSelection) {
        setSelectedSprintId("");
        // 🌟 追加
        const pData = PROJECTS.find(p => p.id === effectiveProjectId);
        if (pData?.members) setCurrentProjectMembers(pData.members);
      }
      return;
    }

    // スプリント一覧を取得
    supabase!.from("sprints").select("id, name, start_date, end_date").eq("project_id", effectiveProjectId).order("created_at")
      .then(({ data }) => {
        if (data) setAvailableSprints(data.map((s: any) => ({ id: s.id, name: s.name, startDate: s.start_date, endDate: s.end_date })));
        if (needsSelection) setSelectedSprintId("");
      });

    // 🌟 追加：動的にプロジェクトが変わった、あるいは子チケット作成時のプロジェクトメンバー情報を再取得
    supabase!.from("projects").select("members").eq("id", effectiveProjectId).single().then(({ data }) => {
      if (data?.members) {
        setCurrentProjectMembers(data.members);
      }
    });
  }, [needsSelection, effectiveProjectId]);


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

  // 🌟【メンバー制限ロジック】
  // プロジェクト所属メンバー（currentProjectMembers）が更新されるたびに、担当者セレクトボックスの選択肢をフィルタリング
  useEffect(() => {
    // 未設定（分類なし用フォールバック）を常に先頭に配置できるよう準備
    const noneOption = { id: "none", name: "担当者なし" };

    if (!isSupabaseEnabled) {
      // モックデータから該当プロジェクトのメンバーのみに制限
      const filteredMock = MEMBERS.filter(m => currentProjectMembers.includes(m.name));
      const list = filteredMock.map(m => ({ id: m.id, name: m.name }));
      setAssigneeList([noneOption, ...list]);
      setAssignee(list[0]?.name || "担当者なし");
      return;
    }

    // Supabaseから全プロフィールを取得した上で、プロジェクトの参加メンバーのみに厳重に .filter
    supabase!.from("profiles").select("id, name").order("name").then(({ data }) => {
      if (data) {
        const filtered = data.filter((u: any) => currentProjectMembers.includes(u.name));
        setAssigneeList([noneOption, ...filtered]);
        // ログイン中の自分自身がメンバーにいれば初期値に設定、いなければ先頭のメンバーにする
        const hasMe = filtered.some((u: any) => u.name === userName);
        setAssignee(hasMe ? userName : (filtered[0]?.name || "担当者なし"));
      }
    });
  }, [currentProjectMembers, userName]);

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

  // 🛠️ 入力状態を初期状態へ一気にクリアする実処理関数
  const executeFormClear = () => {
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
  };

  const handleSave = async () => {
    let valid = true;
    if (needsSelection && !selectedProjectId) { setProjectError(true); valid = false; }
    if (needsSelection && !selectedSprintId) { setSprintError(true); valid = false; }
    if (!title.trim()) { setTitleError(true); valid = false; }
    if (!valid) return;

    const finalAssignee = assignee === "担当者なし" ? null : assignee;

    // 🌟 追加：新規チケット作成時に、詳細欄のメンションを解析して通知を飛ばす関数
    const notifyMentions = async (ticketWbs: string) => {
      if (!description || !effectiveProjectSlug) return;
      const stripped = description.replace(/<[^>]*>/g, " ");
      for (const name of currentProjectMembers) {
        if (name === userName || !stripped.includes(`@${name}`)) continue;

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

        fireSlackNotify({
          recipientUserName: name,
          projectSlug: effectiveProjectSlug,
          title: `${userName}さんにメンションされました`,
          body: `<${window.location.origin}/${effectiveProjectSlug}/${ticketWbs}|${ticketWbs}: ${title}>（チケット作成）`,
        });
      }
    };

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
                fireSlackNotify({ recipientUserName: finalAssignee, projectSlug: effectiveProjectSlug, title: "チケットが割り当てられました", body: `${wbs}: ${title}` });
              }
              await notifyMentions(wbs); // 🌟 ここでメンション通知を実行
            }
            setSaving(false);
            onCreated?.();
            onClose();
            return;
          }
        }
      } else {
        // プロジェクト内の全スプリントIDを取得し、プロジェクトスコープでwbs連番を生成
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
          fireSlackNotify({ recipientUserName: finalAssignee, projectSlug: effectiveProjectSlug, title: "チケットが割り当てられました", body: `${wbs}: ${title}` });
        }
        await notifyMentions(wbs); // 🌟 ここでメンション通知を実行
      }
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
            {/* 🛠️ ボタンコンテナを整列させ、×ボタンの左横へゴミ箱デザインのクリアボタンを精密に配置 */}
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
                {/* 🌟 修正: CustomSelect に置換し、エラー時は枠線で囲う */}
                <div style={projectError ? { outline: "2px solid #DC2626", outlineOffset: 1, borderRadius: 8 } : undefined}>
                  <CustomSelect
                    value={selectedProjectId}
                    options={availableProjects.map(p => ({ value: p.id, label: p.name }))}
                    onChange={v => { setSelectedProjectId(v); setProjectError(false); setSelectedSprintId(""); setSprintError(false); }}
                    placeholder="プロジェクトを選択してください"
                  />
                </div>
                {projectError && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 5 }}>プロジェクトを選択してください</p>}
              </div>
              <div>
                <label className={labelCls}>スプリント <span style={{ color: "#DC2626" }}>*</span></label>
                {/* 🌟 修正: CustomSelect に置換 */}
                <div style={sprintError ? { outline: "2px solid #DC2626", outlineOffset: 1, borderRadius: 8 } : undefined}>
                  <CustomSelect
                    value={selectedSprintId}
                    options={availableSprints.map(s => ({ value: s.id, label: s.name }))}
                    onChange={v => { setSelectedSprintId(v); setSprintError(false); }}
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
              {/* 🌟 修正: CustomSelect に置換。ステータスは色付きバッジで表示 */}
              <CustomSelect
                value={status}
                options={TICKET_STATUSES.map(s => ({ value: s.value, label: s.label, color: s.color, bg: s.bg }))}
                onChange={v => setStatus(v as TicketStatus)}
              />
            </div>
            <div>
              <label className={labelCls}>優先度</label>
              {/* 🌟 修正: CustomSelect に置換 */}
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
              {/* 🌟 修正: CustomSelect に置換 */}
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
            {/* 🌟 修正: CustomSelect に置換 */}
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
            {/* 🌟 修正: メンション候補として currentProjectMembers を RichEditor に渡す */}
            <RichEditor value={description} onChange={setDescription} placeholder="チケットの詳細説明、要件、受け入れ条件などを入力..." minHeight={300} maxHeight={300} members={currentProjectMembers} />
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

      {/* 🛠️ コンポーネントを共通・統一化し、ご指定の仕様（破棄テキスト無し、右下ボタンを「閉じる」）へ完全に修正したモーダル */}
      {showCloseConfirm && (
        <ConfirmDialog
          title="画面を閉じる確認"
          message="チケットを閉じますか？"
          confirmLabel="閉じる"
          confirmColor="#059669"
          hasWarningText={false}
          onConfirm={onClose}
          onClose={() => setShowCloseConfirm(false)}
        />
      )}

      {/* 🛠️ 入力情報の一気クリア用確認ダイアログ */}
      {showClearConfirm && (
        <ConfirmDialog
          title="入力内容のクリア"
          message="入力内容をすべて消去しますか？"
          confirmLabel="消去する"
          confirmColor="#DC2626"
          hasWarningText={false}
          onConfirm={executeFormClear}
          onClose={() => setShowClearConfirm(false)}
        />
      )}
    </>
  );
}