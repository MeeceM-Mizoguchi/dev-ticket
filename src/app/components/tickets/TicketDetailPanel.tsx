import { useEffect, useRef, useState, useCallback } from "react";
import { X, Paperclip, ChevronDown, Trash2, FileCode2, ImageIcon, Pencil, Check, ChevronDown as CaretDown, Copy, CheckCheck, ArrowRightLeft, GitBranch, Plus, Activity, CornerDownRight } from "lucide-react";
import type { SprintTicket, TicketCategory, TicketComment, TicketSourceFile, Priority, TicketStatus, CommentType } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { TICKET_STATUSES, labelCls, validateParentStatusChange, htmlToMarkdown } from "@/app/lib/helpers";
import { CustomSelect, type SelectOption } from "@/app/components/shared/CustomSelect";
import { useAuth } from "@/app/contexts/AuthContext";
import { useAlert } from "@/app/contexts/AlertContext";
import { Avatar } from "@/app/components/shared/Avatar";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { mapComment, mapSourceFile, mapSprintTicket, mapTicketCategory } from "@/app/lib/mappers";
import { DatePicker } from "@/app/components/shared/DatePicker";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { BtnSpinner } from "@/app/components/shared/PageLoader";
import { NewTicketDialog } from "@/app/components/tickets/NewTicketDialog";
import { ProjectMonitor } from "@/app/components/projects/ProjectMonitor";
import { recordMilestoneFromTicketStatus } from "@/app/hooks/useProject";
import { fireSlackNotify } from "@/app/utils/slackNotify";

const STATUS_PROGRESS: Record<TicketStatus, number> = {
  todo: 0, "in-progress": 10, "in-review": 30,
  "review-done": 50, "stg-test": 70, uat: 90, done: 100, closed: 100,
};

const ACTION_BUTTONS: Partial<Record<TicketStatus, { label: string; next: TicketStatus; color: string; bg: string }>> = {
  todo: { label: "着手開始", next: "in-progress", color: "#D97706", bg: "#FFF7ED" },
  "review-done": { label: "STG完了", next: "stg-test", color: "#0D9488", bg: "#F0FDFA" },
  "stg-test": { label: "UAT完了", next: "uat", color: "#4F46E5", bg: "#EEF2FF" },
  uat: { label: "リリース完了", next: "closed", color: "#6B7280", bg: "#F3F4F6" },
};

const priorityMeta: Record<Priority, { label: string; color: string; bg: string }> = {
  high: { label: "高", color: "#DC2626", bg: "#FEF2F2" },
  medium: { label: "中", color: "#D97706", bg: "#FFFBEB" },
  low: { label: "低", color: "#0284C7", bg: "#F0F9FF" },
};

const PRIORITY_OPTIONS: SelectOption[] = [
  { value: "high", label: "高", color: "#DC2626", bg: "#FEF2F2" },
  { value: "medium", label: "中", color: "#D97706", bg: "#FFFBEB" },
  { value: "low", label: "低", color: "#0284C7", bg: "#F0F9FF" },
];

function formatTs(ts: string) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function extractReviewerName(content: string): string {
  const match = content.match(/<strong>@([^<]+)<\/strong>/);
  return match ? match[1] : "";
}

function StatusBadge({ status }: { status: string }) {
  const s = TICKET_STATUSES.find(x => x.value === status);
  if (!s) return null;
  return <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: s.bg, color: s.color, flexShrink: 0 }}>{s.label}</span>;
}

export function TicketDetailPanel({
  ticket, projectId, sprintId, projectSlug, onClose, onUpdated, onDeleted, onSelectTicket, projectPermissions, anchor,
}: { ticket: SprintTicket | null; projectId?: string; sprintId?: string; projectSlug?: string; onClose: () => void; onUpdated?: () => void; onDeleted?: () => void; onSelectTicket?: (t: SprintTicket) => void; projectPermissions?: import("@/app/types").UserPermissions; anchor?: string }) {

  const { userName, userRole, userPermissions } = useAuth();
  const { showAlert } = useAlert();
  const isAdminOrPM = userRole === "admin" || userRole === "project-manager";
  const effectivePermissions = projectPermissions ?? userPermissions;
  // isAdminOrPM によるバイパスは行わない。権限はロール設定・プロジェクト個別設定に従う。
  const hasReviewPermission = effectivePermissions.canReview;
  const hasSkipReviewPermission = effectivePermissions.canSkipReview;
  // editable state
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [showMonitor, setShowMonitor] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveTargetSprintId, setMoveTargetSprintId] = useState<string | null>(null);
  const [availableSprints, setAvailableSprints] = useState<{ id: string; name: string; status: string; startDate: string; endDate: string; identifier: string | null }[]>([]);
  const [isMoveLoading, setIsMoveLoading] = useState(false);
  const [status, setStatus] = useState<TicketStatus>(ticket?.status ?? "todo");
  const [priority, setPriority] = useState<Priority>(ticket?.priority ?? "medium");
  const [assignee, setAssignee] = useState<string>(
    ticket?.assignee ?? ""
  );
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [startDate, setStartDate] = useState(ticket?.startDate ?? "");
  const [dueDate, setDueDate] = useState(ticket?.dueDate ?? "");
  const [estimatedH, setEstimatedH] = useState(ticket?.estimatedHours ?? 0);
  const [progress, setProgress] = useState(ticket?.progress ?? 0);
  const [description, setDescription] = useState(ticket?.description ?? "");
  const [reviewerName, setReviewerName] = useState(ticket?.reviewerName ?? "");
  const [reviewRound, setReviewRound] = useState(ticket?.reviewRound ?? 0);
  const [reviewerOpen, setReviewerOpen] = useState(false);
  const [createdBy, setCreatedBy] = useState(ticket?.createdBy ?? "");
  const [createdAt, setCreatedAt] = useState(ticket?.createdAt ?? "");

  const [categoryId, setCategoryId] = useState<string | null>(ticket?.categoryId ?? null);
  const [categories, setCategories] = useState<TicketCategory[]>([]);

  // related data
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [sourceFiles, setSourceFiles] = useState<TicketSourceFile[]>([]);
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [reviewerEligibleNames, setReviewerEligibleNames] = useState<string[]>([]);
  const [projectMemberNames, setProjectMemberNames] = useState<string[]>([]);
  const [adminMemberNames, setAdminMemberNames] = useState<string[]>([]);

  // review request form
  const [reviewContent, setReviewContent] = useState("");
  const [reviewFiles, setReviewFiles] = useState<{ name: string; file: File }[]>([]);
  const [reviewImages, setReviewImages] = useState<string[]>([]);
  // reviewer's input for revision/approval comment
  const [revisionInput, setRevisionInput] = useState("");
  // 再レビュー依頼フォームの表示フラグ
  const [showReReviewForm, setShowReReviewForm] = useState(false);
  const [revisionImages, setRevisionImages] = useState<string[]>([]);

  // comment form
  const [commentText, setCommentText] = useState("");
  const [commentImages, setCommentImages] = useState<string[]>([]);

  // ticket-level images
  const [ticketImages, setTicketImages] = useState<string[]>(ticket?.images ?? []);
  const ticketImagesRef = useRef<string[]>(ticket?.images ?? []);

  // image preview
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // drag over states
  const [imageDragOver, setImageDragOver] = useState(false);
  const [fileDragOver, setFileDragOver] = useState(false);

  const [copiedMd, setCopiedMd] = useState(false);
  const [copiedImageUrl, setCopiedImageUrl] = useState<string | null>(null);

  // comment editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editImages, setEditImages] = useState<string[]>([]);

  // reply form
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyImages, setReplyImages] = useState<string[]>([]);


  // 子チケット
  const [childTickets, setChildTickets] = useState<SprintTicket[]>([]);
  const [showCreateChild, setShowCreateChild] = useState(false);

  // レビューフロー アコーディオン
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set());

  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const descTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const reviewerDropRef = useRef<HTMLDivElement>(null);

  // mention tracking
  const prevDescRef = useRef<string>(ticket?.description ?? "");
  const notifiedMentionsRef = useRef(new Map<string, Set<string>>());
  const memberNamesRef = useRef<string[]>([]);
  const anchorScrolledRef = useRef<string | null>(null);

  const loadRelated = useCallback(async (ticketId: string) => {
    if (!isSupabaseEnabled) return;
    const [{ data: cData }, { data: fData }, { data: childData }] = await Promise.all([
      supabase!.from("ticket_comments").select("*").eq("ticket_id", ticketId).order("created_at"),
      supabase!.from("ticket_source_files").select("*").eq("ticket_id", ticketId).order("created_at"),
      supabase!.from("sprint_tickets").select("*").eq("parent_id", ticketId).order("wbs"),
    ]);
    if (cData) setComments(cData.map(mapComment));
    if (fData) setSourceFiles(fData.map(mapSourceFile));
    if (childData) setChildTickets(childData.map(mapSprintTicket));
  }, []);

  // sync when ticket changes — set from prop immediately, then fetch fresh from DB
  useEffect(() => {
    if (!ticket) return;
    setTitle(ticket.title);
    setStatus(ticket.status);
    setPriority(ticket.priority);
    setAssignee(ticket.assignee ?? "");
    setStartDate(ticket.startDate ?? "");
    setDueDate(ticket.dueDate ?? "");
    setEstimatedH(ticket.estimatedHours);
    setProgress(ticket.progress);
    setDescription(ticket.description ?? "");
    setReviewerName(ticket.reviewerName ?? "");
    setReviewRound(ticket.reviewRound ?? 0);
    const initImages = ticket.images ?? [];
    setTicketImages(initImages);
    ticketImagesRef.current = initImages;
    // reset form state on ticket change
    setCommentText("");
    setCommentImages([]);
    setReviewContent("");
    setReviewFiles([]);
    setRevisionInput("");
    setRevisionImages([]);
    setEditingId(null);
    setAssigneeOpen(false);
    setExpandedRounds(new Set());
    setReplyingToId(null);
    setReplyText("");
    setReplyImages([]);
    // reset mention tracking
    prevDescRef.current = ticket.description ?? "";
    notifiedMentionsRef.current.clear();
    anchorScrolledRef.current = null;
    setCategoryId(ticket.categoryId ?? null);
    // fetch fresh data from DB (in case sprint cache is stale)
    if (ticket.id && isSupabaseEnabled) {
      supabase!.from("sprint_tickets").select("*").eq("id", ticket.id).single()
        .then(({ data }) => {
          if (!data) return;
          const t = mapSprintTicket(data);
          setTitle(t.title);
          setStatus(t.status);
          setPriority(t.priority);
          setAssignee(t.assignee ?? "");
          setStartDate(t.startDate ?? "");
          setDueDate(t.dueDate ?? "");
          setEstimatedH(t.estimatedHours);
          setProgress(t.progress);
          setDescription(t.description ?? "");
          setReviewerName(t.reviewerName ?? "");
          setReviewRound(t.reviewRound ?? 0);
          const freshImages = t.images ?? [];
          setTicketImages(freshImages);
          ticketImagesRef.current = freshImages;
          setCategoryId(t.categoryId ?? null);
          setCreatedBy(t.createdBy ?? "");
          setCreatedAt(t.createdAt ?? "");
        });
    }
    if (ticket.id) loadRelated(ticket.id);
  }, [ticket?.id, loadRelated]);

  useEffect(() => {
    if (!isSupabaseEnabled || !projectId) return;
    supabase!.from("ticket_categories").select("*").eq("project_id", projectId).order("created_at")
      .then(({ data }) => { if (data) setCategories(data.map(mapTicketCategory)); });
    supabase!.from("projects").select("members").eq("id", projectId).single()
      .then(({ data }) => { if (data?.members) setProjectMemberNames(data.members as string[]); });
  }, [projectId]);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!.from("profiles").select("name, role, permissions").order("name")
      .then(({ data }) => {
        if (!data) return;
        setMemberNames(data.map((r: { name: string }) => r.name));
        const eligible = data
          .filter((r: { name: string; role: string; permissions?: Record<string, boolean> | null }) =>
            r.role === "admin" || r.role === "project-manager" || r.permissions?.canReview === true
          )
          .map((r: { name: string }) => r.name);
        setReviewerEligibleNames(eligible);
        const admins = data
          .filter((r: { name: string; role: string }) => r.role === "admin")
          .map((r: { name: string }) => r.name);
        setAdminMemberNames(admins);
      });
  }, []);

  useEffect(() => { memberNamesRef.current = memberNames; }, [memberNames]);

  // Poll for fresh comments/source files every 10s while panel is open
  useEffect(() => {
    if (!ticket?.id || !isSupabaseEnabled) return;
    const id = setInterval(() => loadRelated(ticket.id), 10000);
    return () => clearInterval(id);
  }, [ticket?.id, loadRelated]);

  useEffect(() => {
    if (!reviewerOpen) return;
    const h = (e: MouseEvent) => {
      if (reviewerDropRef.current && !reviewerDropRef.current.contains(e.target as Node)) setReviewerOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [reviewerOpen]);

  const save = useCallback(async (fields: Record<string, unknown>) => {
    if (!ticket || !isSupabaseEnabled) return;
    await supabase!.from("sprint_tickets").update(fields).eq("id", ticket.id);
    onUpdated?.();
  }, [ticket?.id]);

  const saveDebounced = useCallback((fields: Record<string, unknown>) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(fields), 1200);
  }, [save]);

  const saveDescriptionDebounced = useCallback((v: string) => {
    clearTimeout(descTimerRef.current);
    descTimerRef.current = setTimeout(async () => {
      if (!ticket || !isSupabaseEnabled) return;
      await supabase!.from("sprint_tickets").update({ description: v }).eq("id", ticket.id);
      onUpdated?.();
      // notify new mentions in description
      const stripped = v.replace(/<[^>]*>/g, " ");
      const prevStripped = prevDescRef.current.replace(/<[^>]*>/g, " ");
      const ctx = "description";
      if (!notifiedMentionsRef.current.has(ctx)) notifiedMentionsRef.current.set(ctx, new Set());
      const alreadyNotified = notifiedMentionsRef.current.get(ctx)!;
      for (const name of memberNamesRef.current) {
        if (name === userName || !stripped.includes(`@${name}`) || prevStripped.includes(`@${name}`) || alreadyNotified.has(name)) continue;
        if (!projectSlug) continue;
        alreadyNotified.add(name);

        // 🌟 修正: 通知のINSERT処理を await で確実に待機させる（非同期の抜け漏れを防止）
        // さらに、不要なカラム（mention_context）によるサイレントエラーを防ぐため、他の通知処理とフォーマットを統一
        const { error } = await supabase!.from("notifications").insert({
          user_name: name,
          type: "mention",
          title: `${userName}さんにメンションされました`,
          body: `${ticket.wbs}: ${ticket.title}（チケット詳細）`,
          ticket_id: ticket.id,
          ticket_wbs: ticket.wbs,
          ticket_title: ticket.title,
          project_slug: projectSlug,
          is_read: false,
        });
        if (error) console.error("[mention] description notification insert failed:", error.message);

        const ticketUrl = `${window.location.origin}/${projectSlug}/${ticket.wbs}`;
        fireSlackNotify({
          recipientUserName: name,
          projectSlug,
          title: `${userName}さんにメンションされました`,
          body: `<${ticketUrl}|${ticket.wbs}: ${ticket.title}>（チケット詳細）`,
        });
      }
      prevDescRef.current = v;
    }, 1200);
  }, [save, ticket?.id, projectSlug, userName]); // eslint-disable-line

  // scroll to anchor after panel + comments are ready
  useEffect(() => {
    if (!anchor || anchor === anchorScrolledRef.current) return;
    const targetId = anchor.startsWith("comment:")
      ? `panel-comment-${anchor.slice(8)}`
      : "panel-description-section";
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      anchorScrolledRef.current = anchor;
    }
  }, [anchor, comments.length, ticket?.id]); // eslint-disable-line

  const uploadImageToStorage = useCallback(async (file: Blob, folder: string): Promise<string> => {
    if (!isSupabaseEnabled || !ticket) return URL.createObjectURL(file);
    const extMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
    const ext = extMap[file.type] ?? 'png';
    const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { data, error } = await supabase!.storage.from("ticket-images").upload(path, file, {
      upsert: true,
      contentType: file.type || 'image/png',
    });
    if (error || !data) {
      console.error("[image upload] failed:", error?.message ?? "no data");
      return "";
    }
    const { data: urlData } = supabase!.storage.from("ticket-images").getPublicUrl(path);
    return urlData.publicUrl;
  }, [ticket?.id]);

  const copyImageToClipboard = useCallback(async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      let pngBlob: Blob;
      if (blob.type === "image/png") {
        pngBlob = blob;
      } else {
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.getContext("2d")!.drawImage(bmp, 0, 0);
        pngBlob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png")
        );
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      setCopiedImageUrl(url);
      setTimeout(() => setCopiedImageUrl(null), 2000);
    } catch (e) {
      console.error("Failed to copy image to clipboard:", e);
    }
  }, []);

  const pasteImage = useCallback((e: React.ClipboardEvent, setter: React.Dispatch<React.SetStateAction<string[]>>, pathPrefix: string) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgFiles = items.filter(i => i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean) as File[];
    if (imgFiles.length === 0) return;
    e.preventDefault();
    imgFiles.forEach(async f => {
      const url = await uploadImageToStorage(f, pathPrefix);
      if (url) setter(prev => [...prev, url]);
    });
  }, [uploadImageToStorage]);

  const addTicketImages = useCallback(async (files: FileList | File[]) => {
    if (!ticket) return;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      const url = await uploadImageToStorage(f, `tickets/${ticket.id}/detail`);
      if (!url) continue;
      const next = [...ticketImagesRef.current, url];
      ticketImagesRef.current = next;
      setTicketImages(next);
      if (isSupabaseEnabled) {
        const { error } = await supabase!.from("sprint_tickets").update({ images: next }).eq("id", ticket.id);
        if (error) console.error("[images] DB save failed:", error.message);
      }
    }
  }, [ticket?.id, uploadImageToStorage]);

  const removeTicketImage = useCallback(async (idx: number) => {
    if (!ticket) return;
    const next = ticketImagesRef.current.filter((_, j) => j !== idx);
    ticketImagesRef.current = next;
    setTicketImages(next);
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("sprint_tickets").update({ images: next }).eq("id", ticket.id);
      if (error) console.error("[images] DB delete failed:", error.message);
    }
  }, [ticket?.id]);

  const setStatusAndProgress = (newStatus: TicketStatus) => {
    const p = STATUS_PROGRESS[newStatus] ?? progress;
    setStatus(newStatus);
    setProgress(p);
    save({ status: newStatus, progress: p });
    if (ticket) recordMilestoneFromTicketStatus(ticket.id, newStatus);
  };

  const handleStatusAction = async (btn: { label: string; next: TicketStatus }) => {
    if (!ticket) return;
    const validErr = validateParentStatusChange(btn.next, childTickets);
    if (validErr) { showAlert(validErr, "変更できません"); return; }
    const newStatus = btn.next;
    const p = STATUS_PROGRESS[newStatus];
    setStatus(newStatus);
    setProgress(p);
    if (isSupabaseEnabled) {
      await supabase!.from("sprint_tickets").update({ status: newStatus, progress: p }).eq("id", ticket.id);
    }
    if (ticket) recordMilestoneFromTicketStatus(ticket.id, newStatus);
    const newLabel = TICKET_STATUSES.find(s => s.value === newStatus)?.label ?? newStatus;
    await addComment(`<p>${btn.label}：ステータスを「${newLabel}」に変更しました</p>`, "status_change", [], newStatus);
    onUpdated?.();
  };

  const saveAssignee = (name: string) => {
    const prevAssignee = assignee;
    setAssignee(name);
    save({ assignees: name ? [name] : [], assignee: name });
    if (name && name !== prevAssignee && isSupabaseEnabled && projectSlug && ticket) {
      supabase!.from("notifications").insert({
        user_name: name,
        type: "assign",
        title: "チケットが割り当てられました",
        body: `${ticket.wbs}: ${ticket.title}（担当: ${prevAssignee || "未割り当て"} → ${name}）`,
        ticket_id: ticket.id,
        ticket_wbs: ticket.wbs,
        ticket_title: ticket.title,
        project_slug: projectSlug,
        is_read: false,
      }).then(({ error }) => {
        if (error) console.error("[notifications] assign insert failed:", error.message, error);
      });
      fireSlackNotify({
        recipientUserName: name,
        projectSlug,
        title: "チケットが割り当てられました",
        body: `${ticket.wbs}: ${ticket.title}`,
      });
    }
  };

  const insertNotification = async (recipientName: string, type: string, title: string, body: string) => {
    if (!isSupabaseEnabled || !projectSlug || !ticket || !recipientName) return;
    const { error } = await supabase!.from("notifications").insert({
      user_name: recipientName,
      type,
      title,
      body,
      ticket_id: ticket.id,
      ticket_wbs: ticket.wbs,
      ticket_title: ticket.title,
      project_slug: projectSlug,
      is_read: false,
    });
    if (error) console.error("[notifications] insert failed:", error.message);
  };

  const notifyMentions = async (content: string, currentTicket: SprintTicket, context: string) => {
    if (!isSupabaseEnabled || !projectSlug) return;
    const stripped = content.replace(/<[^>]*>/g, " ");
    if (!notifiedMentionsRef.current.has(context)) notifiedMentionsRef.current.set(context, new Set());
    const alreadyNotified = notifiedMentionsRef.current.get(context)!;
    for (const name of memberNamesRef.current) {
      if (name === userName || !stripped.includes(`@${name}`) || alreadyNotified.has(name)) continue;
      alreadyNotified.add(name);
      const { error } = await supabase!.from("notifications").insert({
        user_name: name,
        type: "mention",
        title: `${userName}さんにメンションされました`,
        body: `${currentTicket.wbs}: ${currentTicket.title}`,
        ticket_id: currentTicket.id,
        ticket_wbs: currentTicket.wbs,
        ticket_title: currentTicket.title,
        project_slug: projectSlug,
        is_read: false, // 🌟 修正: mention_context を除去し安全化
      });
      if (error) console.error("[notifications] mention insert failed:", error.message);
      // @メンションのSlack通知（メンションが発生したプロジェクトのチャンネルに送信）
      const mentionMessageText = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const mentionTicketUrl = `${window.location.origin}/${projectSlug}/${currentTicket.wbs}`;
      fireSlackNotify({
        recipientUserName: name,
        projectSlug,
        title: `${userName}さんにメンションされました`,
        body: `<${mentionTicketUrl}|${currentTicket.wbs}: ${currentTicket.title}>\n${mentionMessageText}`,
      });
    }
  };

  const addComment = async (content: string, type: CommentType = "comment", images: string[] = [], explicitStatus?: TicketStatus) => {
    if (!ticket) return;
    const ts = explicitStatus ?? status;
    const row = { id: `CMT-${Date.now()}`, ticket_id: ticket.id, user_name: userName, content, ticket_status: ts, comment_type: type, images };
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("ticket_comments").insert(row);
      if (error) { console.error("comment insert failed:", error); return; }
      await loadRelated(ticket.id);
      await notifyMentions(content, ticket, `comment:${row.id}`);
    } else {
      setComments(prev => [...prev, { ...row, ticketId: ticket.id, userName, ticketStatus: ts, commentType: type, createdAt: new Date().toISOString() }]);
    }
  };

  const addReply = async (parentComment: TicketComment, content: string, images: string[]) => {
    if (!ticket || !content.trim()) return;
    const id = `CMT-${Date.now()}`;
    const row = { id, ticket_id: ticket.id, user_name: userName, content, ticket_status: status, comment_type: "comment" as CommentType, images, reply_to: parentComment.id };
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("ticket_comments").insert(row);
      if (error) { console.error("reply insert failed:", error); return; }
      await loadRelated(ticket.id);
      await notifyMentions(content, ticket, `comment:${id}`);
      if (parentComment.userName !== userName && projectSlug) {
        supabase!.from("notifications").insert({
          user_name: parentComment.userName, type: "comment",
          title: `${userName}さんがコメントに返信しました`,
          body: `${ticket.wbs}: ${ticket.title}`,
          ticket_id: ticket.id, ticket_wbs: ticket.wbs, ticket_title: ticket.title,
          project_slug: projectSlug, is_read: false,
        }).then(({ error: e }) => { if (e) console.error("[notifications] reply insert failed:", e.message); });
      }
    } else {
      setComments(prev => [...prev, { id, ticketId: ticket.id, userName, content, ticketStatus: status, commentType: "comment", images, createdAt: new Date().toISOString(), replyTo: parentComment.id }]);
    }
  };

  const uploadSourceFile = async (file: File, round: number): Promise<string> => {
    if (!ticket || !isSupabaseEnabled) return "";
    const path = `${ticket.id}/${round}/${Date.now()}_${file.name}`;
    const { data } = await supabase!.storage.from("ticket-files").upload(path, file, { upsert: true });
    if (!data) return "";
    const { data: urlData } = supabase!.storage.from("ticket-files").getPublicUrl(path);
    const row = { id: `SF-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, ticket_id: ticket.id, file_name: file.name, file_size: file.size, file_type: file.type, uploaded_by: userName, review_round: round, file_url: urlData.publicUrl };
    await supabase!.from("ticket_source_files").insert(row);
    return urlData.publicUrl;
  };

  const handleDate = (field: "start_date" | "due_date", v: string) => {
    const s = field === "start_date" ? v : startDate;
    const d = field === "due_date" ? v : dueDate;
    if (field === "start_date") setStartDate(v); else setDueDate(v);
    const days = s && d ? Math.max(0, Math.round((new Date(d).getTime() - new Date(s).getTime()) / 86400000)) : 0;
    const h = days * 8;
    setEstimatedH(h);
    save({ [field]: v || null, estimated_hours: h });
  };

  const handleReviewRequest = async () => {
    console.log("[debug] handleReviewRequest called", { reviewerName, status, projectSlug, ticketId: ticket?.id });
    if (!reviewerName || (status !== "in-progress" && status !== "review-done" && status !== "stg-test" && status !== "uat") || !ticket) {
      console.warn("[debug] handleReviewRequest early return", { reviewerName, status, hasTicket: !!ticket });
      return;
    }
    const validErr = validateParentStatusChange("in-review", childTickets);
    if (validErr) { showAlert(validErr, "変更できません"); return; }
    const round = reviewRound + 1;
    const newStatus: TicketStatus = "in-review";
    const newProgress = STATUS_PROGRESS[newStatus];
    // update local state immediately
    setReviewRound(round);
    setStatus(newStatus);
    setProgress(newProgress);
    // single awaited DB save (prevents onUpdated firing mid-flow)
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("sprint_tickets").update({
        status: newStatus, progress: newProgress,
        reviewer_name: reviewerName, review_round: round,
      }).eq("id", ticket.id);
      if (error) {
        console.error("handleReviewRequest save failed:", error);
        setStatus("in-progress"); setProgress(STATUS_PROGRESS["in-progress"]); setReviewRound(round - 1);
        return;
      }
      if (ticket) recordMilestoneFromTicketStatus(ticket.id, newStatus);
    }
    for (const rf of reviewFiles) await uploadSourceFile(rf.file, round);
    setReviewFiles([]);
    const content = reviewContent.trim()
      ? reviewContent
      : `<p><strong>@${reviewerName}</strong> にレビュー依頼を送信しました（第${round}回）</p>`;
    await addComment(content, "review_request", reviewImages, newStatus);
    setReviewImages([]);
    await insertNotification(
      reviewerName,
      "review_request",
      `${userName}さんからレビュー依頼が届きました`,
      `${ticket.wbs}: ${ticket.title}（第${round}回）`
    );
    if (projectSlug) {
      const reviewTicketUrl = `${window.location.origin}/${projectSlug}/${ticket.wbs}`;
      fireSlackNotify({
        recipientUserName: reviewerName,
        projectSlug,
        title: `${userName}さんからレビュー依頼が届きました`,
        body: `${ticket.wbs}: ${ticket.title}（第${round}回）\n${reviewTicketUrl}`,
      });
    }
    setReviewContent("");
    setShowReReviewForm(false);
    onUpdated?.();
  };

  const handleRevisionRequest = async (revisionText: string = "") => {
    if (!ticket) return;

    // 🌟 修正: APIリクエスト前の権限バリデーション（防御処理）
    if (userName !== reviewerName) {
      showAlert("権限エラー: 修正依頼（差戻し）は、指定されたレビュアーのみが実行できます。", "エラー");
      return;
    }

    const newStatus: TicketStatus = "in-progress";
    const newProgress = STATUS_PROGRESS[newStatus];
    setStatus(newStatus); setProgress(newProgress);
    if (isSupabaseEnabled) {
      await supabase!.from("sprint_tickets").update({ status: newStatus, progress: newProgress }).eq("id", ticket.id);
    }
    const mentions = assignee ? `<strong>@${assignee}</strong>` : "";
    const content = revisionText.trim()
      ? revisionText
      : `<p>${mentions} に修正依頼を送信しました</p>`;
    await addComment(content, "revision_request", revisionImages, newStatus);
    await insertNotification(
      assignee,
      "revision_request",
      `${userName}さんから修正依頼が届きました`,
      `${ticket.wbs}: ${ticket.title}`
    );
    if (assignee && projectSlug) {
      const revisionTicketUrl = `${window.location.origin}/${projectSlug}/${ticket.wbs}`;
      fireSlackNotify({
        recipientUserName: assignee,
        projectSlug,
        title: `${userName}さんから修正依頼が届きました`,
        body: `${ticket.wbs}: ${ticket.title}\n${revisionTicketUrl}`,
      });
    }
    setRevisionInput("");
    setRevisionImages([]);
    onUpdated?.();
  };

  const handleReviewApproval = async (approvalText: string = "") => {
    console.log("[debug] handleReviewApproval called", { assignee, projectSlug, ticketId: ticket?.id });
    if (!ticket) return;

    // 🌟 修正: APIリクエスト前の権限バリデーション（防御処理）
    if (userName !== reviewerName) {
      showAlert("権限エラー: レビューの承認は、指定されたレビュアーのみが実行できます。", "エラー");
      return;
    }

    const newStatus: TicketStatus = "review-done";
    const newProgress = STATUS_PROGRESS[newStatus];
    setStatus(newStatus); setProgress(newProgress);
    if (isSupabaseEnabled) {
      await supabase!.from("sprint_tickets").update({ status: newStatus, progress: newProgress }).eq("id", ticket.id);
    }
    if (ticket) recordMilestoneFromTicketStatus(ticket.id, newStatus);
    const defaultApproval = assignee
      ? `<p>✅ レビューを承認しました <strong>@${assignee}</strong></p>`
      : "<p>✅ レビューを承認しました</p>";
    const content = approvalText.trim() ? approvalText : defaultApproval;
    await addComment(content, "review_approved", revisionImages, newStatus);
    await insertNotification(
      assignee,
      "review_approved",
      `${userName}さんがレビューを承認しました`,
      `${ticket.wbs}: ${ticket.title}`
    );
    if (assignee && projectSlug) {
      const approvalTicketUrl = `${window.location.origin}/${projectSlug}/${ticket.wbs}`;
      fireSlackNotify({
        recipientUserName: assignee,
        projectSlug,
        title: `${userName}さんがレビューを承認しました`,
        body: `${ticket.wbs}: ${ticket.title}\n${approvalTicketUrl}`,
      });
    }
    setRevisionInput("");
    setRevisionImages([]);
    onUpdated?.();
  };

  const handleSkipReview = async () => {
    if (!ticket || !hasSkipReviewPermission) return;
    const newStatus: TicketStatus = "review-done";
    const p = STATUS_PROGRESS[newStatus];
    setStatus(newStatus);
    setProgress(p);
    if (isSupabaseEnabled) {
      await supabase!.from("sprint_tickets").update({ status: newStatus, progress: p }).eq("id", ticket.id);
    }
    if (ticket) recordMilestoneFromTicketStatus(ticket.id, newStatus);
    const newLabel = TICKET_STATUSES.find(s => s.value === newStatus)?.label ?? newStatus;
    await addComment(`<p>レビュースキップ：ステータスを「${newLabel}」に変更しました</p>`, "status_change", [], newStatus);
    onUpdated?.();
  };

  const handleWithdrawReview = async () => {
    if (!ticket) return;
    const newStatus: TicketStatus = "in-progress";
    const newProgress = STATUS_PROGRESS[newStatus];
    setStatus(newStatus);
    setProgress(newProgress);
    if (isSupabaseEnabled) {
      await supabase!.from("sprint_tickets").update({ status: newStatus, progress: newProgress }).eq("id", ticket.id);
    }
    await addComment(
      `<p>レビュー依頼（第${reviewRound}回）を取り下げました</p>`,
      "review_withdrawn",
      [],
      newStatus
    );
    await insertNotification(
      reviewerName,
      "review_withdrawn",
      `${userName}さんがレビュー依頼を取り下げました`,
      `${ticket.wbs}: ${ticket.title}（第${reviewRound}回）`
    );
    if (reviewerName && projectSlug) {
      const ticketUrl = `${window.location.origin}/${projectSlug}/${ticket.wbs}`;
      fireSlackNotify({
        recipientUserName: reviewerName,
        projectSlug,
        title: `${userName}さんがレビュー依頼を取り下げました`,
        body: `${ticket.wbs}: ${ticket.title}（第${reviewRound}回）\n${ticketUrl}`,
      });
    }
    onUpdated?.();
  };

  const handleDeleteTicket = async () => {
    if (!ticket || !isSupabaseEnabled) return;
    // 子チケットのコメント・ファイルを先に削除（DBカスケードでticket本体は自動削除される）
    for (const child of childTickets) {
      await supabase!.from("ticket_comments").delete().eq("ticket_id", child.id);
      await supabase!.from("ticket_source_files").delete().eq("ticket_id", child.id);
    }
    await supabase!.from("ticket_comments").delete().eq("ticket_id", ticket.id);
    await supabase!.from("ticket_source_files").delete().eq("ticket_id", ticket.id);
    await supabase!.from("sprint_tickets").delete().eq("id", ticket.id);
    onDeleted?.();
    onClose();
  };

  const openMoveModal = async () => {
    if (!ticket || !isSupabaseEnabled || !projectId) return;
    const [{ data: ticketRow }, { data: sprintsData }] = await Promise.all([
      supabase!.from("sprint_tickets").select("sprint_id").eq("id", ticket.id).single(),
      supabase!.from("sprints").select("id, name, status, start_date, end_date, identifier").eq("project_id", projectId).order("start_date"),
    ]);
    const currentSprintId = ticketRow?.sprint_id ?? null;
    setAvailableSprints(
      (sprintsData ?? [])
        .filter(s => s.id !== currentSprintId)
        .map(s => ({ id: s.id, name: s.name, status: s.status, startDate: s.start_date ?? "", endDate: s.end_date ?? "", identifier: s.identifier ?? null }))
    );
    setMoveTargetSprintId(null);
    setShowMoveModal(true);
  };

  const handleMoveTicket = async () => {
    if (!ticket || !isSupabaseEnabled || !moveTargetSprintId || !projectId) return;
    setIsMoveLoading(true);
    try {
      const targetSprint = availableSprints.find(s => s.id === moveTargetSprintId);

      // プロジェクト内の全スプリントIDと、プロジェクトのWBSプレフィックスを並列取得
      const [{ data: sprintRows }, { data: projectRow }] = await Promise.all([
        supabase!.from("sprints").select("id").eq("project_id", projectId),
        supabase!.from("projects").select("wbs_prefix").eq("id", projectId).single(),
      ]);

      const sprintIds = sprintRows?.map(s => s.id) ?? [];
      const wbsProjectPrefix = projectRow?.wbs_prefix ?? "T";
      const prefix = targetSprint?.identifier || wbsProjectPrefix;

      // 移動先スプリントのプレフィックスで既存の最大連番を取得（子チケット除く）
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
      const newWbs = `${prefix}-${String(nextNum).padStart(3, "0")}`;
      const oldWbs = ticket.wbs;

      // 親チケットのスプリントとWBSを更新
      await supabase!
        .from("sprint_tickets")
        .update({ sprint_id: moveTargetSprintId, wbs: newWbs })
        .eq("id", ticket.id);

      // 子チケットがあれば、スプリントとWBSを連動して更新
      if (!ticket.parentId) {
        const { data: children } = await supabase!
          .from("sprint_tickets")
          .select("id, wbs")
          .eq("parent_id", ticket.id);
        if (children && children.length > 0) {
          await Promise.all(
            children.map(child => {
              const childSuffix = child.wbs.slice(oldWbs.length); // e.g., "-1"
              return supabase!
                .from("sprint_tickets")
                .update({ sprint_id: moveTargetSprintId, wbs: `${newWbs}${childSuffix}` })
                .eq("id", child.id);
            })
          );
        }
      }

      onUpdated?.();
      setShowMoveModal(false);
      onClose();
    } finally {
      setIsMoveLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim() || !ticket) return;
    await addComment(commentText, "comment", commentImages);
    setCommentText("");
    setCommentImages([]);
  };

  const handleDeleteComment = async (id: string) => {
    if (isSupabaseEnabled) await supabase!.from("ticket_comments").delete().eq("id", id);
    setComments(prev => prev.filter(c => c.id !== id));
  };

  const handleEditComment = (c: TicketComment) => { setEditingId(c.id); setEditContent(c.content); setEditImages(c.images ?? []); };
  const handleSaveEdit = async (id: string) => {
    if (isSupabaseEnabled) await supabase!.from("ticket_comments").update({ content: editContent, images: editImages }).eq("id", id);
    setComments(prev => prev.map(c => c.id === id ? { ...c, content: editContent, images: editImages } : c));
    setEditingId(null);
    setEditImages([]);
  };

  const handleDeleteSourceFile = async (id: string) => {
    if (isSupabaseEnabled) await supabase!.from("ticket_source_files").delete().eq("id", id);
    setSourceFiles(prev => prev.filter(f => f.id !== id));
  };

  if (!ticket) return null;

  const todayStr = new Date().toISOString().split("T")[0];
  const isOverdue = status !== "done" && status !== "closed" && !!dueDate && dueDate < todayStr;
  const pm = priorityMeta[priority];
  const smeta = TICKET_STATUSES.find(s => s.value === status)!;

  const filesByRound = sourceFiles.reduce<Record<number, TicketSourceFile[]>>((acc, f) => {
    (acc[f.reviewRound] = acc[f.reviewRound] || []).push(f); return acc;
  }, {});
  const actionBtn = ACTION_BUTTONS[status];

  // 担当者チェック: 自分が担当者かどうか
  const isAssignee = !assignee || assignee === userName;
  const reviewRequestComments = comments.filter(c => c.commentType === "review_request");
  const hasBeenApproved = comments.some(c => c.commentType === "review_approved");
  // 自己レビュー: 担当者自身がレビュアーに指定されているケース
  const isSelfReview = !!reviewerName && userName === reviewerName && isAssignee;
  const canSendReview = !!reviewerName && isAssignee && (
    status === "in-progress" ||
    (showReReviewForm && (status === "review-done" || status === "stg-test" || status === "uat"))
  );
  const canWithdrawReview = status === "in-review" && isAssignee;

  // 🌟 修正: 管理者・PMのバイパスを排除。「ログインユーザーが指定されたレビュアーと完全に一致する場合のみ」レビュー可能
  const canReview = !!reviewerName && userName === reviewerName;

  const latestReviewReqId = [...comments].reverse().find(c => c.commentType === "review_request")?.id ?? null;
  const roundOutcomes = reviewRequestComments.map((reqComment, idx) => {
    const reqIdx = comments.findIndex(c => c.id === reqComment.id);
    const nextReqIdx = idx + 1 < reviewRequestComments.length
      ? comments.findIndex(c => c.id === reviewRequestComments[idx + 1].id)
      : comments.length;
    const between = comments.slice(reqIdx + 1, nextReqIdx);
    if (between.some(c => c.commentType === "review_approved")) return "approved" as const;
    if (between.some(c => c.commentType === "revision_request")) return "revision" as const;
    if (between.some(c => c.commentType === "review_withdrawn")) return "withdrawn" as const;
    return "pending" as const;
  });

  const assigneeLabel = assignee || "未割り当て";

  const repliesByParent = new Map<string, TicketComment[]>();
  const topLevelComments: TicketComment[] = [];
  const commentIdSet = new Set(comments.map(c => c.id));
  for (const c of comments) {
    if (c.replyTo && commentIdSet.has(c.replyTo)) {
      repliesByParent.set(c.replyTo, [...(repliesByParent.get(c.replyTo) ?? []), c]);
    } else {
      topLevelComments.push(c);
    }
  }

  return (
    <>
      {showMonitor && ticket && (
        <ProjectMonitor
          ticketId={ticket.id}
          subtitle={title}
          onClose={() => setShowMonitor(false)}
        />
      )}
      {showDeleteConfirm && (
        <ConfirmDialog
          message={childTickets.length > 0
            ? `「${title}」を削除しますか？\n子チケットが${childTickets.length}件あります。子チケットも全て削除されます。`
            : `「${title}」を削除しますか？`}
          onConfirm={handleDeleteTicket}
          onClose={() => setShowDeleteConfirm(false)}
        />
      )}
      {showMoveModal && (
        <DialogShell
          title="スプリントへ移動"
          onClose={isMoveLoading ? () => { } : () => setShowMoveModal(false)}
          footer={<>
            <BtnSecondary onClick={() => setShowMoveModal(false)} disabled={isMoveLoading}>キャンセル</BtnSecondary>
            <button type="button" onClick={handleMoveTicket} disabled={isMoveLoading || !moveTargetSprintId}
              style={{ padding: "9px 20px", background: isMoveLoading || !moveTargetSprintId ? "#9CA3AF" : "#059669", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: isMoveLoading || !moveTargetSprintId ? "not-allowed" : "pointer", boxShadow: isMoveLoading || !moveTargetSprintId ? "none" : "0 2px 8px rgba(5,150,105,0.30)", display: "flex", alignItems: "center", gap: 6 }}>
              {isMoveLoading && <BtnSpinner />}
              {isMoveLoading ? "移動中..." : "移動する"}
            </button>
          </>}>
          <p style={{ fontSize: 13, color: "#6B7280", margin: 0 }}>移動先のスプリントを選択してください</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {availableSprints.length === 0 ? (
              <p style={{ fontSize: 13, color: "#A09790", textAlign: "center", padding: "24px 0" }}>移動先のスプリントがありません</p>
            ) : availableSprints.map(s => {
              const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
                planning: { label: "計画中", color: "#4F46E5", bg: "#EEF2FF" },
                active: { label: "進行中", color: "#059669", bg: "#ECFDF5" },
                completed: { label: "完了", color: "#6B7280", bg: "#F3F4F6" },
                delayed: { label: "遅延", color: "#DC2626", bg: "#FEF2F2" },
              };
              const sm = statusMeta[s.status] ?? { label: s.status, color: "#6B7280", bg: "#F3F4F6" };
              const isSelected = moveTargetSprintId === s.id;
              return (
                <label key={s.id}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12, border: `2px solid ${isSelected ? "#059669" : "rgba(26,23,20,0.10)"}`, background: isSelected ? "#ECFDF5" : "#FAFAF8", cursor: "pointer", transition: "all 0.15s" }}>
                  <input type="radio" name="targetSprint" value={s.id} checked={isSelected} onChange={() => setMoveTargetSprintId(s.id)}
                    style={{ accentColor: "#059669", width: 16, height: 16, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{s.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: sm.bg, color: sm.color }}>{sm.label}</span>
                    </div>
                    {(s.startDate || s.endDate) && (
                      <span style={{ fontSize: 11, color: "#A09790", marginTop: 2, display: "block" }}>
                        {s.startDate || "—"} 〜 {s.endDate || "—"}
                      </span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </DialogShell>
      )}
      {showCreateChild && ticket && !ticket.parentId && (
        <NewTicketDialog
          sprintId={sprintId}
          projectId={projectId}
          projectSlug={projectSlug}
          parentTicketId={ticket.id}
          parentWbs={ticket.wbs}
          zIndexBase={310}
          onClose={() => setShowCreateChild(false)}
          onCreated={() => { setShowCreateChild(false); loadRelated(ticket.id); onUpdated?.(); }}
        />
      )}
      <style>{`@keyframes slideInPanel{from{transform:translateX(102%)}to{transform:translateX(0)}}`}</style>

      {/* Image preview modal */}
      {previewImage && (
        <div onClick={() => setPreviewImage(null)}
          style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
          <button onClick={e => { e.stopPropagation(); copyImageToClipboard(previewImage); }}
            style={{ position: "absolute", top: 16, right: 60, width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFF" }}
            title="画像をコピー">
            {copiedImageUrl === previewImage ? <CheckCheck style={{ width: 18, height: 18, color: "#4ADE80" }} /> : <Copy style={{ width: 18, height: 18 }} />}
          </button>
          <button onClick={() => setPreviewImage(null)}
            style={{ position: "absolute", top: 16, right: 16, width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFF" }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
          <img src={previewImage} alt="" onClick={e => e.stopPropagation()}
            style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 24px 80px rgba(0,0,0,0.6)", cursor: "default" }} />
        </div>
      )}

      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(10,14,12,0.30)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "56%", minWidth: 520, background: "#FAFAF8", zIndex: 201, boxShadow: "-16px 0 60px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", animation: "slideInPanel 0.28s cubic-bezier(0.16,1,0.3,1)" }}>

        {/* Header */}
        <div style={{ padding: "16px 24px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFF", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", background: "#F4F5F6", padding: "2px 8px", borderRadius: 5 }}>{ticket.wbs || ticket.id}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: smeta?.bg ?? "#F4F5F6", color: smeta?.color ?? "#9E9690" }}>{smeta?.label}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: pm.bg, color: pm.color }}>優先度: {pm.label}</span>
                {isOverdue && <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: "#FEF2F2", color: "#DC2626", border: "1px solid rgba(220,38,38,0.3)" }}>期限超過</span>}
              </div>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={e => {
                  (e.currentTarget as HTMLElement).style.borderBottomColor = "transparent";
                  if (e.target.value.trim()) save({ title: e.target.value });
                }}
                style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.025em", lineHeight: 1.3, background: "transparent", border: "none", outline: "none", width: "100%", padding: 0, borderBottom: "1.5px solid transparent", transition: "border-color 0.15s" }}
                onFocus={e => { (e.currentTarget as HTMLElement).style.borderBottomColor = "#059669"; }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              {/* 実績モニタボタン */}
              {projectId && (
                <button onClick={() => setShowMonitor(true)} title="実績モニタ"
                  style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
                  <Activity style={{ width: 15, height: 15 }} />
                </button>
              )}
              {/* 子チケット作成ボタン（親チケットのみ表示） */}
              {!ticket.parentId && (
                <button onClick={() => setShowCreateChild(true)} title="子チケットを作成"
                  style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
                  <GitBranch style={{ width: 15, height: 15 }} />
                </button>
              )}
              {/* スプリント移動ボタン（子チケットには表示しない） */}
              {!ticket.parentId && (
                <button onClick={openMoveModal} title="別のスプリントへ移動"
                  style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F0F9FF"; (e.currentTarget as HTMLElement).style.color = "#0284C7"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
                  <ArrowRightLeft style={{ width: 15, height: 15 }} />
                </button>
              )}
              <button onClick={() => setShowDeleteConfirm(true)} title="チケットを削除"
                style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
                <Trash2 style={{ width: 15, height: 15 }} />
              </button>
              <button onClick={onClose} style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
          </div>
          {/* Progress bar in header */}
          {(() => {
            const displayProgress = (status === "done" || status === "closed") ? 100 : progress;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <div style={{ flex: 1, height: 6, background: "#EDE9E0", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${displayProgress}%`, background: "#059669", borderRadius: 99, transition: "width 0.6s ease" }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", flexShrink: 0 }}>{displayProgress}%</span>
              </div>
            );
          })()}
          {/* STG完了ボタン: レビュー中は非活性で表示 */}
          {status === "in-review" && isAssignee && (
            <button disabled
              style={{ width: "100%", padding: "8px 0", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "1.5px solid rgba(13,148,136,0.20)", cursor: "not-allowed", background: "#F0FDFA", color: "#94A3B8", marginTop: 10 }}>
              STG完了 →
            </button>
          )}
          {/* Action button in header */}
          {actionBtn && isAssignee && (
            <button onClick={() => { if (!showReReviewForm) handleStatusAction(actionBtn); }}
              disabled={showReReviewForm}
              style={{ width: "100%", padding: "8px 0", fontSize: 12, fontWeight: 700, borderRadius: 9, border: `1.5px solid ${showReReviewForm ? "rgba(107,114,128,0.20)" : actionBtn.color + "33"}`, cursor: showReReviewForm ? "not-allowed" : "pointer", background: showReReviewForm ? "#F4F5F6" : actionBtn.bg, color: showReReviewForm ? "#B0A9A4" : actionBtn.color, marginTop: 10 }}>
              {actionBtn.label} →
            </button>
          )}
          {/* Review skip button: in-progressのみ表示 */}
          {hasSkipReviewPermission && status === "in-progress" && (
            <button onClick={handleSkipReview}
              style={{ width: "100%", padding: "8px 0", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "1.5px solid rgba(245,158,11,0.33)", cursor: "pointer", background: "#FFFBEB", color: "#F59E0B", marginTop: 8 }}>
              レビュースキップ →
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 32px", display: "flex", flexDirection: "column", gap: 16 }} onClick={() => assigneeOpen && setAssigneeOpen(false)}>

          {/* Metadata */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* ステータス | 優先度 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
                <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>ステータス</p>
                <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: smeta?.color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: smeta?.color }}>{smeta?.label}</span>
                </div>
              </div>
              <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
                <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>優先度</p>
                <CustomSelect
                  value={priority}
                  options={PRIORITY_OPTIONS}
                  onChange={v => { setPriority(v as Priority); save({ priority: v }); }}
                />
              </div>
            </div>

            {/* 分類 */}
            {categories.length > 0 && (
              <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px" }}>
                <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>分類</p>
                <CustomSelect
                  value={categoryId ?? ""}
                  options={[
                    { value: "", label: "分類なし" },
                    ...categories.map(c => ({ value: c.id, label: c.name })),
                  ]}
                  onChange={v => { const val = v || null; setCategoryId(val); save({ category_id: val }); }}
                  placeholder="分類なし"
                />
              </div>
            )}

            {/* 担当者 (全幅・1名のみ) */}
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "10px 12px", position: "relative" }}>
              <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>担当者</p>
              <button onClick={e => { e.stopPropagation(); setAssigneeOpen(o => !o); }}
                style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 13, fontWeight: 600, color: !assignee ? "#C9C4BB" : "#1A1714", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", padding: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>{assigneeLabel}</span>
                <CaretDown style={{ width: 12, height: 12, color: "#B0A9A4", flexShrink: 0, transform: assigneeOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>
              {assigneeOpen && (
                <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFF", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden", marginTop: 4 }}>
                  {projectMemberNames.length === 0
                    ? <p style={{ padding: "10px 12px", fontSize: 12, color: "#B0A9A4" }}>メンバーがいません</p>
                    : projectMemberNames.map(n => (
                      <button key={n} onClick={() => { saveAssignee(n); setAssigneeOpen(false); }}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", background: assignee === n ? "#ECFDF5" : "transparent", border: "none", transition: "background 0.1s", textAlign: "left" }}
                        onMouseEnter={e => { const target = e.currentTarget as HTMLElement; if (assignee !== n) target.style.background = "#F4F5F6"; }}
                        onMouseLeave={e => { const target = e.currentTarget as HTMLElement; target.style.background = assignee === n ? "#ECFDF5" : "transparent"; }}>
                        <Avatar name={n} size="xs" />
                        <span style={{ fontSize: 12, fontWeight: 500, color: "#1A1714", flex: 1 }}>{n}</span>
                        {assignee === n && <Check style={{ width: 12, height: 12, color: "#059669", marginLeft: "auto" }} />}
                      </button>
                    ))}
                  <div style={{ padding: "6px 12px", borderTop: "1px solid rgba(26,23,20,0.06)" }}>
                    <button onClick={() => { saveAssignee(""); setAssigneeOpen(false); }}
                      style={{ fontSize: 11, color: "#B0A9A4", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                      割り当て解除
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 開始日 | 期限日 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <DatePicker label="開始日" value={startDate} onChange={v => handleDate("start_date", v)} placeholder="年/月/日" />
              <DatePicker label="期限日" value={dueDate} onChange={v => handleDate("due_date", v)} placeholder="年/月/日" />
            </div>

            {/* 見積工数 (全幅) */}
            <div>
              <label className={labelCls}>見積工数（開始・終了日から自動計算）</label>
              <div style={{ background: "#F4F5F6", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#6B6458" }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{estimatedH}</span>
                <span style={{ marginLeft: 2 }}> h</span>
                {estimatedH === 0 && <span style={{ fontSize: 11, color: "#C9C4BB", marginLeft: 8 }}>（開始日・終了日を入力すると自動計算されます）</span>}
              </div>
            </div>

            {/* 起票者 | 起票日 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ background: "#F4F5F6", borderRadius: 10, padding: "10px 12px" }}>
                <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 4 }}>起票者</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714" }}>{createdBy || "—"}</p>
              </div>
              <div style={{ background: "#F4F5F6", borderRadius: 10, padding: "10px 12px" }}>
                <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 4 }}>起票日</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714" }}>{formatTs(createdAt) || "—"}</p>
              </div>
            </div>
          </div>

          {/* 子チケット一覧（親チケットのみ表示。将来の孫チケット対応時はこのセクションを再帰化予定） */}
          {!ticket.parentId && (
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#1A1714", display: "flex", alignItems: "center", gap: 6 }}>
                  <GitBranch style={{ width: 12, height: 12, color: "#059669" }} />
                  子チケット
                  <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 400 }}>({childTickets.length}件)</span>
                </p>
                <button onClick={() => setShowCreateChild(true)}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", background: "#ECFDF5", color: "#059669", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "1px solid rgba(5,150,105,0.20)", cursor: "pointer" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#D1FAE5"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}>
                  <Plus style={{ width: 11, height: 11 }} />子チケット作成
                </button>
              </div>
              {childTickets.length === 0 ? (
                <div style={{ padding: "12px 0", textAlign: "center" as const, color: "#C9C4BB", fontSize: 12, border: "1.5px dashed rgba(26,23,20,0.10)", borderRadius: 8 }}>
                  子チケットはありません
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {childTickets.map(child => {
                    const ctsm = TICKET_STATUSES.find(s => s.value === child.status) ?? TICKET_STATUSES[0];
                    const cPriBg = child.priority === "high" ? "#FEF2F2" : child.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
                    const cPriColor = child.priority === "high" ? "#DC2626" : child.priority === "medium" ? "#D97706" : "#0284C7";
                    const cPriLabel = child.priority === "high" ? "高" : child.priority === "medium" ? "中" : "低";
                    return (
                      <div key={child.id}
                        onClick={() => onSelectTicket?.(child)}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(26,23,20,0.07)", background: "#FAFAF8", cursor: onSelectTicket ? "pointer" : "default", transition: "background 0.1s" }}
                        onMouseEnter={e => { if (onSelectTicket) (e.currentTarget as HTMLElement).style.background = "#F0F9F5"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#FAFAF8"; }}>
                        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#059669", fontWeight: 700, flexShrink: 0 }}>{child.wbs}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "#1A1714", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{child.title}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: ctsm.bg, color: ctsm.color, flexShrink: 0 }}>{ctsm.label}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: cPriBg, color: cPriColor, flexShrink: 0 }}>{cPriLabel}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 詳細 + 画像 */}
          <div
            onPaste={e => {
              const items = Array.from(e.clipboardData?.items ?? []);
              const imgFiles = items.filter(i => i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean) as File[];
              if (imgFiles.length === 0) return;
              e.preventDefault();
              addTicketImages(imgFiles);
            }}
            onDragOver={e => { e.preventDefault(); setImageDragOver(true); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setImageDragOver(false); }}
            onDrop={e => { e.preventDefault(); setImageDragOver(false); addTicketImages(e.dataTransfer.files); }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em" }}>詳細</p>
              <button
                onClick={() => { navigator.clipboard.writeText(htmlToMarkdown(description)); setCopiedMd(true); setTimeout(() => setCopiedMd(false), 2000); }}
                title="Markdownとしてコピー"
                style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 8px", fontSize: 10, fontWeight: 600, borderRadius: 5, border: "1px solid rgba(26,23,20,0.12)", background: copiedMd ? "#ECFDF5" : "transparent", color: copiedMd ? "#059669" : "#B0A9A4", cursor: "pointer" }}>
                {copiedMd ? <CheckCheck style={{ width: 10, height: 10 }} /> : <Copy style={{ width: 10, height: 10 }} />}
                MDコピー
              </button>
            </div>
            <div id="panel-description-section">
              <RichEditor value={description} onChange={v => { setDescription(v); saveDescriptionDebounced(v); }} placeholder="チケットの詳細説明、要件、受け入れ条件..." minHeight={300} maxHeight={300} members={projectMemberNames.length > 0 ? [...new Set([...projectMemberNames, ...adminMemberNames])] : memberNames} />
            </div>
            {/* Inline image attachment */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: `1.5px dashed ${imageDragOver ? "rgba(5,150,105,0.5)" : "rgba(26,23,20,0.10)"}`, borderRadius: 9, cursor: "pointer", background: imageDragOver ? "rgba(5,150,105,0.04)" : "#FAFAF8", marginTop: 8, transition: "border-color 0.15s, background 0.15s" }}>
              <ImageIcon style={{ width: 13, height: 13, color: imageDragOver ? "#059669" : "#B0A9A4" }} />
              <span style={{ fontSize: 12, color: imageDragOver ? "#059669" : "#B0A9A4" }}>
                {imageDragOver ? "ドロップして追加" : "クリックして画像を追加、または Ctrl+V / ドラッグ&ドロップ"}
              </span>
              <input type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={e => { addTicketImages(e.target.files || []); e.target.value = ""; }} />
            </label>
            {ticketImages.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {ticketImages.map((img, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img src={img} alt="" onClick={() => setPreviewImage(img)}
                      style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 7, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                    <button onClick={() => copyImageToClipboard(img)}
                      style={{ position: "absolute", top: -5, right: 15, width: 18, height: 18, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                      title="画像をコピー">
                      {copiedImageUrl === img ? <CheckCheck style={{ width: 8, height: 8, color: "#4ADE80" }} /> : <Copy style={{ width: 8, height: 8, color: "#FFF" }} />}
                    </button>
                    <button onClick={() => removeTicketImage(i)}
                      style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <X style={{ width: 9, height: 9, color: "#FFF" }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Review flow + Source files ── */}
          {(reviewRequestComments.length > 0 || isAssignee || userName === reviewerName) && (
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "14px 16px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#1A1714", marginBottom: 12 }}>
                レビューフロー
                {status === "in-review" && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#F5F3FF", color: "#7C3AED", marginLeft: 8 }}>審査中</span>}
                {hasBeenApproved && status !== "in-review" && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#ECFDF5", color: "#059669", marginLeft: 8 }}>承認済み</span>}
              </p>

              {/* ラウンド別履歴 + ソースファイル（アコーディオン） */}
              {reviewRequestComments.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                  {reviewRequestComments.map((reqComment, idx) => {
                    const round = idx + 1;
                    const outcome = roundOutcomes[idx];
                    const roundFiles = filesByRound[round] ?? [];
                    const color = outcome === "approved" ? "#059669" : outcome === "revision" ? "#D97706" : outcome === "withdrawn" ? "#6B7280" : "#7C3AED";
                    const bg = outcome === "approved" ? "#ECFDF5" : outcome === "revision" ? "#FFF7ED" : outcome === "withdrawn" ? "#F4F5F6" : "#F5F3FF";
                    const border = outcome === "approved" ? "rgba(5,150,105,0.15)" : outcome === "revision" ? "rgba(217,119,6,0.15)" : outcome === "withdrawn" ? "rgba(107,114,128,0.15)" : "rgba(124,58,237,0.15)";
                    const label = outcome === "approved" ? "✅ レビュー承認" : outcome === "revision" ? "⚠️ 修正依頼" : outcome === "withdrawn" ? "↩ 取り下げ" : "🔄 審査中";

                    const isExpanded = expandedRounds.has(idx);
                    const reqIdx = comments.findIndex(c => c.id === reqComment.id);
                    const nextReqIdx = idx + 1 < reviewRequestComments.length
                      ? comments.findIndex(c => c.id === reviewRequestComments[idx + 1].id)
                      : comments.length;
                    const roundReviewComments = comments.slice(reqIdx + 1, nextReqIdx).filter(
                      c => c.commentType === "revision_request" || c.commentType === "review_approved" || c.commentType === "review_withdrawn"
                    );
                    const roundImages = [
                      ...(reqComment.images ?? []),
                      ...roundReviewComments.flatMap(c => c.images ?? []),
                    ];
                    const fileCount = roundFiles.length;
                    const imgCount = roundImages.length;

                    return (
                      <div key={idx} style={{ borderRadius: 8, border: `1px solid ${border}`, overflow: "hidden" }}>
                        <button
                          onClick={() => setExpandedRounds(prev => {
                            const next = new Set(prev);
                            if (next.has(idx)) next.delete(idx); else next.add(idx);
                            return next;
                          })}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", background: bg, border: "none", cursor: "pointer", textAlign: "left" as const }}
                        >
                          <span style={{ fontSize: 11, fontWeight: 700, color }}>第{round}回</span>
                          {reviewerName && (
                            <span style={{ fontSize: 10, color: color, opacity: 0.7 }}>→ {reviewerName}</span>
                          )}
                          <span style={{ fontSize: 10, color }}>{label}</span>
                          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                            {(fileCount > 0 || imgCount > 0) && (
                              <span style={{ fontSize: 9, color, opacity: 0.75 }}>
                                {[fileCount > 0 && `${fileCount}ファイル`, imgCount > 0 && `${imgCount}画像`].filter(Boolean).join(" · ")}
                              </span>
                            )}
                            <ChevronDown style={{ width: 13, height: 13, color, transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                          </div>
                        </button>

                        {isExpanded && (
                          <div style={{ padding: "10px 12px", background: "#FAFAF8", borderTop: `1px solid ${border}`, display: "flex", flexDirection: "column", gap: 10 }}>
                            {/* ソースファイル */}
                            {roundFiles.length > 0 && (
                              <div>
                                <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 5 }}>ソースファイル</p>
                                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                  {roundFiles.map(f => (
                                    <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <FileCode2 style={{ width: 11, height: 11, color: "#059669", flexShrink: 0 }} />
                                      {f.fileUrl
                                        ? <a href={f.fileUrl} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 11, color: "#059669", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{f.fileName}</a>
                                        : <span style={{ flex: 1, fontSize: 11, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{f.fileName}</span>}
                                      {isAssignee && (
                                        <button onClick={() => handleDeleteSourceFile(f.id)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB", flexShrink: 0 }}
                                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                                          <Trash2 style={{ width: 11, height: 11 }} />
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 添付画像 */}
                            {roundImages.length > 0 && (
                              <div>
                                <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 5 }}>添付画像</p>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {roundImages.map((img, i) => (
                                    <div key={i} style={{ position: "relative" }}>
                                      <img src={img} alt="" onClick={() => setPreviewImage(img)}
                                        style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                                      <button onClick={() => copyImageToClipboard(img)}
                                        style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                        title="画像をコピー">
                                        {copiedImageUrl === img ? <CheckCheck style={{ width: 8, height: 8, color: "#4ADE80" }} /> : <Copy style={{ width: 8, height: 8, color: "#FFF" }} />}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* レビューコメント（修正依頼・承認） */}
                            {roundReviewComments.length > 0 && (
                              <div>
                                <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 5 }}>レビューコメント</p>
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {roundReviewComments.map(c => {
                                    const isRevision = c.commentType === "revision_request";
                                    const cColor = isRevision ? "#D97706" : "#059669";
                                    const cBg = isRevision ? "#FFF7ED" : "#ECFDF5";
                                    const cBorder = isRevision ? "rgba(217,119,6,0.15)" : "rgba(5,150,105,0.15)";
                                    const cLabel = isRevision ? "⚠️ 修正依頼" : "✅ 承認";
                                    return (
                                      <div key={c.id} style={{ display: "flex", gap: 7 }}>
                                        <Avatar name={c.userName} size="xs" />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4, flexWrap: "wrap" as const }}>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: "#1A1714" }}>{c.userName}</span>
                                            <span style={{ fontSize: 9, fontWeight: 700, color: cColor, background: cBg, padding: "1px 6px", borderRadius: 20, border: `1px solid ${cBorder}` }}>{cLabel}</span>
                                            <span style={{ fontSize: 9, color: "#C9C4BB" }}>{formatTs(c.createdAt)}</span>
                                          </div>
                                          {(c.content || (c.images?.length ?? 0) > 0) && (
                                            <div style={{ background: cBg, border: `1px solid ${cBorder}`, borderRadius: 7, padding: "8px 10px" }}>
                                              {c.content && <RichEditor value={c.content} readOnly minHeight={20} />}
                                              {(c.images?.length ?? 0) > 0 && (
                                                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: c.content ? 5 : 0 }}>
                                                  {(c.images ?? []).map((img, i) => (
                                                    <div key={i} style={{ position: "relative" }}>
                                                      <img src={img} alt="" onClick={() => setPreviewImage(img)}
                                                        style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                                                      <button onClick={() => copyImageToClipboard(img)}
                                                        style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                                        title="画像をコピー">
                                                        {copiedImageUrl === img ? <CheckCheck style={{ width: 7, height: 7, color: "#4ADE80" }} /> : <Copy style={{ width: 7, height: 7, color: "#FFF" }} />}
                                                      </button>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {roundFiles.length === 0 && roundImages.length === 0 && roundReviewComments.length === 0 && (
                              <p style={{ fontSize: 11, color: "#C9C4BB", textAlign: "center" as const }}>添付ファイル・コメントなし</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* レビュー依頼フォーム（担当者のみ） */}
              {isAssignee && (
                status === "todo" ? (
                  <div style={{ padding: "16px", background: "#FFF7ED", borderRadius: 9, border: "1px solid rgba(217,119,6,0.20)", textAlign: "center" as const }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#D97706", marginBottom: 4 }}>まず着手を開始してください</p>
                    <p style={{ fontSize: 12, color: "#9E9690" }}>「着手開始」ボタンを押してから<br />レビュー依頼を送信できます</p>
                  </div>
                ) : (hasBeenApproved && !showReReviewForm && (status === "review-done" || status === "stg-test" || status === "uat")) ? (
                  <div style={{ padding: "12px 14px", background: "#ECFDF5", borderRadius: 9, border: "1px solid rgba(5,150,105,0.20)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>✅ レビューが承認されています</p>
                        <p style={{ fontSize: 11, color: "#9E9690", marginTop: 3 }}>再度レビューを依頼できます</p>
                      </div>
                      <button
                        onClick={() => setShowReReviewForm(true)}
                        style={{ flexShrink: 0, padding: "6px 14px", background: "#7C3AED", color: "#FFF", fontSize: 11, fontWeight: 700, borderRadius: 8, border: "none", cursor: "pointer", whiteSpace: "nowrap" as const }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#6D28D9"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#7C3AED"; }}
                      >
                        再レビュー依頼
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onPaste={e => pasteImage(e, setReviewImages, `tickets/${ticket.id}/comments`)}
                    onDragOver={e => { e.preventDefault(); setFileDragOver(true); }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileDragOver(false); }}
                    onDrop={async e => {
                      e.preventDefault();
                      setFileDragOver(false);
                      if (!e.dataTransfer.files.length) return;
                      Array.from(e.dataTransfer.files).forEach(f => {
                        if (f.type.startsWith("image/")) {
                          uploadImageToStorage(f, `tickets/${ticket.id}/comments`).then(url => { if (url) setReviewImages(prev => [...prev, url]); });
                        } else {
                          setReviewFiles(prev => [...prev, { name: f.name, file: f }]);
                        }
                      });
                    }}
                  >
                    <div style={{ marginBottom: 10 }}>
                      <label className={labelCls}>レビュアー</label>
                      <div ref={reviewerDropRef} style={{ position: "relative" }}>
                        <button onClick={() => { if (status !== "in-review") setReviewerOpen(o => !o); }}
                          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: status === "in-review" ? "#F4F5F6" : reviewerOpen ? "#FFF" : "#F7F8F9", border: `1px solid ${reviewerOpen ? "#059669" : "rgba(26,23,20,0.12)"}`, borderRadius: 10, padding: "9px 12px", fontSize: 13, color: reviewerName ? "#1A1714" : "#B0A9A4", cursor: status === "in-review" ? "default" : "pointer", outline: "none", opacity: status === "in-review" ? 0.7 : 1, boxShadow: reviewerOpen ? "0 0 0 3px rgba(5,150,105,0.08)" : "none", transition: "all 0.15s", textAlign: "left" as const }}>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{reviewerName || "レビュアーを選択..."}</span>
                          <CaretDown style={{ width: 12, height: 12, color: "#B0A9A4", flexShrink: 0, transform: reviewerOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                        </button>
                        {reviewerOpen && (
                          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20, background: "#FFF", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden" }}>
                            <button onClick={() => { setReviewerName(""); setReviewerOpen(false); }}
                              style={{ width: "100%", padding: "8px 12px", textAlign: "left" as const, background: !reviewerName ? "#ECFDF5" : "transparent", border: "none", cursor: "pointer", fontSize: 12, color: "#B0A9A4" }}
                              onMouseEnter={e => { if (reviewerName) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = !reviewerName ? "#ECFDF5" : "transparent"; }}>
                              レビュアーを選択...
                            </button>
                            {[...new Set([
                              ...(isAssignee && userName ? [userName] : []),
                              ...reviewerEligibleNames.filter(n => projectMemberNames.length === 0 || projectMemberNames.includes(n)),
                            ])].map(n => (
                              <button key={n} onClick={() => { setReviewerName(n); setReviewerOpen(false); }}
                                style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: reviewerName === n ? "#ECFDF5" : "transparent", border: "none", cursor: "pointer", fontSize: 12, color: reviewerName === n ? "#059669" : "#1A1714", textAlign: "left" as const, transition: "background 0.1s" }}
                                onMouseEnter={e => { if (reviewerName !== n) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = reviewerName === n ? "#ECFDF5" : "transparent"; }}>
                                <Avatar name={n} size="xs" />
                                <span style={{ flex: 1 }}>{n}</span>
                                {reviewerName === n && <Check style={{ width: 11, height: 11, color: "#059669", marginLeft: "auto" }} />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>レビュー依頼内容</p>
                      <div style={{ opacity: status === "in-review" ? 0.6 : 1, pointerEvents: status === "in-review" ? "none" : "auto" }}>
                        <RichEditor value={reviewContent} onChange={setReviewContent} placeholder="レビューしてほしい内容・確認ポイントを入力..." minHeight={80} members={projectMemberNames.length > 0 ? [...new Set([...projectMemberNames, ...adminMemberNames])] : memberNames} />
                      </div>
                    </div>
                    {fileDragOver && (
                      <div style={{ border: "2px dashed rgba(5,150,105,0.5)", borderRadius: 8, padding: "10px", textAlign: "center", color: "#059669", fontSize: 11, fontWeight: 600, background: "rgba(5,150,105,0.04)", marginBottom: 8 }}>
                        ドロップしてファイルを追加
                      </div>
                    )}
                    {reviewFiles.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                        {reviewFiles.map((rf, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, background: "#F4F5F6", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "#6B6458" }}>
                            <FileCode2 style={{ width: 11, height: 11, color: "#059669" }} />{rf.name}
                            <button onClick={() => setReviewFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 0 }}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {reviewImages.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                        {reviewImages.map((img, i) => (
                          <div key={i} style={{ position: "relative" }}>
                            <img src={img} alt="" onClick={() => setPreviewImage(img)}
                              style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                            <button onClick={() => copyImageToClipboard(img)}
                              style={{ position: "absolute", top: -5, right: 12, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                              title="画像をコピー">
                              {copiedImageUrl === img ? <CheckCheck style={{ width: 7, height: 7, color: "#4ADE80" }} /> : <Copy style={{ width: 7, height: 7, color: "#FFF" }} />}
                            </button>
                            <button onClick={() => setReviewImages(prev => prev.filter((_, j) => j !== i))}
                              style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <X style={{ width: 8, height: 8, color: "#FFF" }} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#F4F5F6", color: "#6B6458", fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "1px solid rgba(26,23,20,0.10)", flexShrink: 0, opacity: status === "in-review" ? 0.5 : 1, pointerEvents: status === "in-review" ? "none" : "auto" }}>
                        <ImageIcon style={{ width: 12, height: 12 }} />画像添付（Ctrl+V 可）
                        <input type="file" accept="image/*" multiple style={{ display: "none" }}
                          onChange={async e => {
                            for (const f of Array.from(e.target.files || [])) {
                              if (!f.type.startsWith("image/")) continue;
                              const url = await uploadImageToStorage(f, `tickets/${ticket.id}/comments`);
                              if (url) setReviewImages(prev => [...prev, url]);
                            }
                            e.target.value = "";
                          }} />
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#F4F5F6", color: "#6B6458", fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "1px solid rgba(26,23,20,0.10)", flexShrink: 0, opacity: status === "in-review" ? 0.5 : 1, pointerEvents: status === "in-review" ? "none" : "auto" }}>
                        <Paperclip style={{ width: 12, height: 12 }} />ファイル添付
                        <input type="file" multiple style={{ display: "none" }} onChange={e => { Array.from(e.target.files || []).forEach(f => setReviewFiles(prev => [...prev, { name: f.name, file: f }])); e.target.value = ""; }} />
                      </label>
                      {showReReviewForm && (
                        <button
                          onClick={() => { setShowReReviewForm(false); setReviewContent(""); setReviewFiles([]); setReviewImages([]); }}
                          style={{ padding: "7px 12px", background: "#F4F5F6", color: "#6B7280", fontSize: 11, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(107,114,128,0.25)", cursor: "pointer", flexShrink: 0 }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#E9EAEB"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                        >
                          キャンセル
                        </button>
                      )}
                      <button onClick={handleReviewRequest} disabled={!canSendReview}
                        style={{ flex: 1, padding: "7px 14px", background: canSendReview ? "#7C3AED" : "#F4F5F6", color: canSendReview ? "#FFF" : "#B0A9A4", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: canSendReview ? "pointer" : "not-allowed" }}>
                        {status === "in-review" ? "レビュー依頼中..." : "レビュー依頼を送信"}
                      </button>
                    </div>
                    {status === "in-review" && (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                        <p style={{ fontSize: 10, color: "#7C3AED" }}>修正依頼を受けてから再度送信できます</p>
                        {canWithdrawReview && (
                          <button
                            onClick={handleWithdrawReview}
                            style={{ padding: "5px 12px", background: "#F4F5F6", color: "#6B7280", fontSize: 11, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(107,114,128,0.25)", cursor: "pointer" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#E9EAEB"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                          >
                            ↩ レビュー取り下げ
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          )}

          {/* Comments */}
          <div>
            <p style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>コメント ({comments.length})</p>

            {topLevelComments.map(c => {
              const isOwn = c.userName === userName;
              const isReviewReq = c.commentType === "review_request";
              const isRevisionReq = c.commentType === "revision_request";
              const isApproved = c.commentType === "review_approved";
              const isWithdrawn = c.commentType === "review_withdrawn";
              const isStatusChange = c.commentType === "status_change";
              const isSystem = isReviewReq || isRevisionReq || isApproved || isWithdrawn || isStatusChange;

              const sysColor = isReviewReq ? "#7C3AED" : isRevisionReq ? "#D97706" : isApproved ? "#059669" : isWithdrawn ? "#6B7280" : "#6B7280";
              const sysBg = isReviewReq ? "#F5F3FF" : isRevisionReq ? "#FFF7ED" : isApproved ? "#ECFDF5" : isWithdrawn ? "#F4F5F6" : "#F4F5F6";
              const sysBorder = isReviewReq ? "rgba(124,58,237,0.15)" : isRevisionReq ? "rgba(217,119,6,0.15)" : isApproved ? "rgba(5,150,105,0.15)" : isWithdrawn ? "rgba(107,114,128,0.15)" : "rgba(26,23,20,0.08)";
              const sysLabel = isReviewReq ? `レビュー依頼${reviewerName ? ` → ${reviewerName}` : ""}` : isRevisionReq ? "修正依頼（差戻し）" : isApproved ? "✅ レビュー承認" : isWithdrawn ? "↩ 取り下げ" : "";

              if (isStatusChange) {
                return (
                  <div key={c.id} style={{ margin: "6px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 1, background: "rgba(26,23,20,0.06)" }} />
                      <Avatar name={c.userName} size="xs" />
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#9E9690", whiteSpace: "nowrap" as const }}>{c.userName}</span>
                      <span style={{ fontSize: 10, color: "#C9C4BB", whiteSpace: "nowrap" as const }}>{formatTs(c.createdAt)}</span>
                      <span style={{ fontSize: 10, color: "#9E9690", whiteSpace: "nowrap" as const }}>{c.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}</span>
                      <div style={{ flex: 1, height: 1, background: "rgba(26,23,20,0.06)" }} />
                    </div>
                  </div>
                );
              }

              if (isSystem) {
                const isLatestReviewReq = isReviewReq && c.id === latestReviewReqId;
                const showReviewForm = isLatestReviewReq && canReview && status === "in-review" && editingId !== c.id;
                return (
                  <div key={c.id} id={`panel-comment-${c.id}`} style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                    <Avatar name={c.userName} size="xs" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" as const }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>{c.userName}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: sysColor, background: sysBg, padding: "2px 8px", borderRadius: 20, border: `1px solid ${sysBorder}`, flexShrink: 0 }}>{sysLabel}</span>
                        <span style={{ fontSize: 10, color: "#C9C4BB" }}>{formatTs(c.createdAt)}</span>
                        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                          {isOwn && editingId !== c.id && (
                            <button onClick={() => handleEditComment(c)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                              <Pencil style={{ width: 11, height: 11 }} />
                            </button>
                          )}
                          {isOwn && (
                            <button onClick={() => handleDeleteComment(c.id)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                              <Trash2 style={{ width: 11, height: 11 }} />
                            </button>
                          )}
                          <button onClick={() => { setReplyingToId(replyingToId === c.id ? null : c.id); setReplyText(""); setReplyImages([]); }} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: replyingToId === c.id ? "#0284C7" : "#D5D0CB" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#0284C7"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = replyingToId === c.id ? "#0284C7" : "#D5D0CB"; }}
                            title="返信">
                            <CornerDownRight style={{ width: 11, height: 11 }} />
                          </button>
                        </div>
                      </div>
                      {editingId === c.id ? (
                        <div onPaste={e => pasteImage(e, setEditImages, `tickets/${ticket.id}/comments`)}>
                          <RichEditor value={editContent} onChange={setEditContent} minHeight={60} members={projectMemberNames.length > 0 ? [...new Set([...projectMemberNames, ...adminMemberNames])] : memberNames} />
                          {editImages.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
                              {editImages.map((img, i) => (
                                <div key={i} style={{ position: "relative" }}>
                                  <img src={img} alt="" onClick={() => setPreviewImage(img)}
                                    style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                                  <button onClick={() => copyImageToClipboard(img)}
                                    style={{ position: "absolute", top: -5, right: 12, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                    title="画像をコピー">
                                    {copiedImageUrl === img ? <CheckCheck style={{ width: 7, height: 7, color: "#4ADE80" }} /> : <Copy style={{ width: 7, height: 7, color: "#FFF" }} />}
                                  </button>
                                  <button onClick={() => setEditImages(prev => prev.filter((_, j) => j !== i))}
                                    style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <X style={{ width: 8, height: 8, color: "#FFF" }} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "#B0A9A4" }}>
                              <ImageIcon style={{ width: 13, height: 13 }} />画像（Ctrl+V 貼り付け可）
                              <input type="file" accept="image/*" multiple style={{ display: "none" }}
                                onChange={async e => {
                                  for (const f of Array.from(e.target.files || [])) {
                                    if (!f.type.startsWith("image/")) continue;
                                    const url = await uploadImageToStorage(f, `tickets/${ticket.id}/comments`);
                                    if (url) setEditImages(prev => [...prev, url]);
                                  }
                                  e.target.value = "";
                                }} />
                            </label>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => handleSaveEdit(c.id)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#059669", color: "#FFF", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", cursor: "pointer" }}>
                                <Check style={{ width: 11, height: 11 }} />保存
                              </button>
                              <button onClick={() => { setEditingId(null); setEditImages([]); }} style={{ padding: "5px 10px", background: "#F4F5F6", color: "#6B6458", fontSize: 11, borderRadius: 7, border: "none", cursor: "pointer" }}>キャンセル</button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        (c.content || c.images?.length > 0) && (
                          <div style={{ background: sysBg, border: `1px solid ${sysBorder}`, borderRadius: 8, padding: "10px 12px", marginBottom: showReviewForm ? 10 : 0 }}>
                            {c.content && <RichEditor value={c.content} readOnly minHeight={20} />}
                            {c.images?.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: c.content ? 6 : 0 }}>
                                {c.images.map((img, i) => (
                                  <div key={i} style={{ position: "relative" }}>
                                    <img src={img} alt="" onClick={() => setPreviewImage(img)}
                                      style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                                    <button onClick={() => copyImageToClipboard(img)}
                                      style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                      title="画像をコピー">
                                      {copiedImageUrl === img ? <CheckCheck style={{ width: 8, height: 8, color: "#4ADE80" }} /> : <Copy style={{ width: 8, height: 8, color: "#FFF" }} />}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      )}
                      {/* Replies */}
                      {(repliesByParent.get(c.id) ?? []).map(reply => {
                        const isOwnReply = reply.userName === userName;
                        return (
                          <div key={reply.id} id={`panel-comment-${reply.id}`} style={{ display: "flex", gap: 8, marginTop: 10, paddingLeft: 12, borderLeft: "2px solid rgba(26,23,20,0.07)" }}>
                            <Avatar name={reply.userName} size="xs" />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>{reply.userName}</span>
                                <span style={{ fontSize: 10, color: "#C9C4BB" }}>{formatTs(reply.createdAt)}</span>
                                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                                  {isOwnReply && editingId !== reply.id && (
                                    <button onClick={() => handleEditComment(reply)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                                      <Pencil style={{ width: 11, height: 11 }} />
                                    </button>
                                  )}
                                  {isOwnReply && (
                                    <button onClick={() => handleDeleteComment(reply.id)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                                      <Trash2 style={{ width: 11, height: 11 }} />
                                    </button>
                                  )}
                                </div>
                              </div>
                              {editingId === reply.id ? (
                                <div onPaste={e => pasteImage(e, setEditImages, `tickets/${ticket.id}/comments`)}>
                                  <RichEditor value={editContent} onChange={setEditContent} minHeight={60} members={projectMemberNames.length > 0 ? [...new Set([...projectMemberNames, ...adminMemberNames])] : memberNames} />
                                  {editImages.length > 0 && (
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
                                      {editImages.map((img, i) => (
                                        <div key={i} style={{ position: "relative" }}>
                                          <img src={img} alt="" onClick={() => setPreviewImage(img)} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                                          <button onClick={() => copyImageToClipboard(img)} style={{ position: "absolute", top: -5, right: 12, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="画像をコピー">
                                            {copiedImageUrl === img ? <CheckCheck style={{ width: 7, height: 7, color: "#4ADE80" }} /> : <Copy style={{ width: 7, height: 7, color: "#FFF" }} />}
                                          </button>
                                          <button onClick={() => setEditImages(prev => prev.filter((_, j) => j !== i))} style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            <X style={{ width: 8, height: 8, color: "#FFF" }} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                                    <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "#B0A9A4" }}>
                                      <ImageIcon style={{ width: 13, height: 13 }} />画像（Ctrl+V 貼り付け可）
                                      <input type="file" accept="image/*" multiple style={{ display: "none" }}
                                        onChange={async e => {
                                          for (const f of Array.from(e.target.files || [])) {
                                            if (!f.type.startsWith("image/")) continue;
                                            const url = await uploadImageToStorage(f, `tickets/${ticket.id}/comments`);
                                            if (url) setEditImages(prev => [...prev, url]);
                                          }
                                          e.target.value = "";
                                        }} />
                                    </label>
                                    <div style={{ display: "flex", gap: 6 }}>
                                      <button onClick={() => handleSaveEdit(reply.id)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#059669", color: "#FFF", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", cursor: "pointer" }}>
                                        <Check style={{ width: 11, height: 11 }} />保存
                                      </button>
                                      <button onClick={() => { setEditingId(null); setEditImages([]); }} style={{ padding: "5px 10px", background: "#F4F5F6", color: "#6B6458", fontSize: 11, borderRadius: 7, border: "none", cursor: "pointer" }}>キャンセル</button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 8, padding: "10px 12px" }}>
                                  <RichEditor value={reply.content} readOnly minHeight={20} />
                                  {reply.images.length > 0 && (
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                                      {reply.images.map((img, i) => (
                                        <div key={i} style={{ position: "relative" }}>
                                          <img src={img} alt="" onClick={() => setPreviewImage(img)} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                                          <button onClick={() => copyImageToClipboard(img)} style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="画像をコピー">
                                            {copiedImageUrl === img ? <CheckCheck style={{ width: 8, height: 8, color: "#4ADE80" }} /> : <Copy style={{ width: 8, height: 8, color: "#FFF" }} />}
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {/* Reply form */}
                      {replyingToId === c.id && (
                        <div onPaste={e => pasteImage(e, setReplyImages, `tickets/${ticket.id}/comments`)} style={{ display: "flex", gap: 8, marginTop: 10, paddingLeft: 12, borderLeft: "2px solid rgba(26,23,20,0.07)" }}>
                          <Avatar name={userName} size="xs" />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <RichEditor value={replyText} onChange={setReplyText} placeholder="返信を入力..." minHeight={60} members={projectMemberNames.length > 0 ? [...new Set([...projectMemberNames, ...adminMemberNames])] : memberNames} />
                            {replyImages.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
                                {replyImages.map((img, i) => (
                                  <div key={i} style={{ position: "relative" }}>
                                    <img src={img} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6 }} />
                                    <button onClick={() => setReplyImages(prev => prev.filter((_, j) => j !== i))} style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                      <X style={{ width: 8, height: 8, color: "#FFF" }} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                              <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "#B0A9A4" }}>
                                <ImageIcon style={{ width: 13, height: 13 }} />画像（Ctrl+V 貼り付け可）
                                <input type="file" accept="image/*" multiple style={{ display: "none" }}
                                  onChange={async e => {
                                    for (const f of Array.from(e.target.files || [])) {
                                      if (!f.type.startsWith("image/")) continue;
                                      const url = await uploadImageToStorage(f, `tickets/${ticket.id}/comments`);
                                      if (url) setReplyImages(prev => [...prev, url]);
                                    }
                                    e.target.value = "";
                                  }} />
                              </label>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={async () => { await addReply(c, replyText, replyImages); setReplyingToId(null); setReplyText(""); setReplyImages([]); }} disabled={!replyText.trim()}
                                  style={{ padding: "6px 12px", background: !replyText.trim() ? "#F4F5F6" : "#0284C7", color: !replyText.trim() ? "#B0A9A4" : "#FFF", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", cursor: !replyText.trim() ? "not-allowed" : "pointer" }}>
                                  返信
                                </button>
                                <button onClick={() => { setReplyingToId(null); setReplyText(""); setReplyImages([]); }} style={{ padding: "6px 12px", background: "#F4F5F6", color: "#6B6458", fontSize: 11, borderRadius: 7, border: "none", cursor: "pointer" }}>キャンセル</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {showReviewForm && (
                        <div onPaste={e => pasteImage(e, setRevisionImages, `tickets/${ticket.id}/comments`)} style={{ padding: "14px 16px", background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
                          <p style={{ fontSize: 10, fontWeight: 700, color: "#6B6458", marginBottom: 8 }}>レビューコメント（任意）</p>
                          <RichEditor value={revisionInput} onChange={setRevisionInput} placeholder="指摘内容・承認コメントを入力... （Ctrl+V で画像貼り付け可）" minHeight={60} members={projectMemberNames.length > 0 ? [...new Set([...projectMemberNames, ...adminMemberNames])] : memberNames} />
                          {revisionImages.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                              {revisionImages.map((img, i) => (
                                <div key={i} style={{ position: "relative" }}>
                                  <img src={img} alt="" onClick={() => setPreviewImage(img)}
                                    style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                                  <button onClick={() => copyImageToClipboard(img)}
                                    style={{ position: "absolute", top: -5, right: 12, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                    title="画像をコピー">
                                    {copiedImageUrl === img ? <CheckCheck style={{ width: 7, height: 7, color: "#4ADE80" }} /> : <Copy style={{ width: 7, height: 7, color: "#FFF" }} />}
                                  </button>
                                  <button onClick={() => setRevisionImages(prev => prev.filter((_, j) => j !== i))}
                                    style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <X style={{ width: 8, height: 8, color: "#FFF" }} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "#B0A9A4", marginTop: 8 }}>
                            <ImageIcon style={{ width: 13, height: 13 }} />画像（Ctrl+V 貼り付け可）
                            <input type="file" accept="image/*" multiple style={{ display: "none" }}
                              onChange={async e => {
                                for (const f of Array.from(e.target.files || [])) {
                                  if (!f.type.startsWith("image/")) continue;
                                  const url = await uploadImageToStorage(f, `tickets/${ticket.id}/comments`);
                                  if (url) setRevisionImages(prev => [...prev, url]);
                                }
                                e.target.value = "";
                              }} />
                          </label>
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button onClick={() => handleRevisionRequest(revisionInput)}
                              style={{ flex: 1, padding: "8px 0", background: "#FFF7ED", color: "#D97706", fontSize: 11, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(217,119,6,0.25)", cursor: "pointer" }}>
                              修正依頼（差戻し）
                            </button>
                            <button onClick={() => handleReviewApproval(revisionInput)}
                              style={{ flex: 1, padding: "8px 0", background: "#ECFDF5", color: "#059669", fontSize: 11, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(5,150,105,0.25)", cursor: "pointer" }}>
                              ✅ レビュー承認
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              // normal comment
              return (
                <div key={c.id} id={`panel-comment-${c.id}`} style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                  <Avatar name={c.userName} size="xs" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>{c.userName}</span>
                      <StatusBadge status={c.ticketStatus} />
                      <span style={{ fontSize: 10, color: "#C9C4BB" }}>{formatTs(c.createdAt)}</span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                        {isOwn && editingId !== c.id && (
                          <button onClick={() => handleEditComment(c)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                            <Pencil style={{ width: 11, height: 11 }} />
                          </button>
                        )}
                        {isOwn && (
                          <button onClick={() => handleDeleteComment(c.id)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                            <Trash2 style={{ width: 11, height: 11 }} />
                          </button>
                        )}
                        <button onClick={() => { setReplyingToId(replyingToId === c.id ? null : c.id); setReplyText(""); setReplyImages([]); }} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: replyingToId === c.id ? "#0284C7" : "#D5D0CB" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#0284C7"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = replyingToId === c.id ? "#0284C7" : "#D5D0CB"; }}
                          title="返信">
                          <CornerDownRight style={{ width: 11, height: 11 }} />
                        </button>
                      </div>
                    </div>

                    {editingId === c.id ? (
                      <div onPaste={e => pasteImage(e, setEditImages, `tickets/${ticket.id}/comments`)}>
                        <RichEditor value={editContent} onChange={setEditContent} minHeight={60} members={projectMemberNames.length > 0 ? [...new Set([...projectMemberNames, ...adminMemberNames])] : memberNames} />
                        {editImages.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
                            {editImages.map((img, i) => (
                              <div key={i} style={{ position: "relative" }}>
                                <img src={img} alt="" onClick={() => setPreviewImage(img)}
                                  style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                                <button onClick={() => copyImageToClipboard(img)}
                                  style={{ position: "absolute", top: -5, right: 12, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                  title="画像をコピー">
                                  {copiedImageUrl === img ? <CheckCheck style={{ width: 7, height: 7, color: "#4ADE80" }} /> : <Copy style={{ width: 7, height: 7, color: "#FFF" }} />}
                                </button>
                                <button onClick={() => setEditImages(prev => prev.filter((_, j) => j !== i))}
                                  style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <X style={{ width: 8, height: 8, color: "#FFF" }} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "#B0A9A4" }}>
                            <ImageIcon style={{ width: 13, height: 13 }} />画像（Ctrl+V 貼り付け可）
                            <input type="file" accept="image/*" multiple style={{ display: "none" }}
                              onChange={async e => {
                                for (const f of Array.from(e.target.files || [])) {
                                  if (!f.type.startsWith("image/")) continue;
                                  const url = await uploadImageToStorage(f, `tickets/${ticket.id}/comments`);
                                  if (url) setEditImages(prev => [...prev, url]);
                                }
                                e.target.value = "";
                              }} />
                          </label>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => handleSaveEdit(c.id)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#059669", color: "#FFF", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", cursor: "pointer" }}>
                              <Check style={{ width: 11, height: 11 }} />保存
                            </button>
                            <button onClick={() => { setEditingId(null); setEditImages([]); }} style={{ padding: "5px 10px", background: "#F4F5F6", color: "#6B6458", fontSize: 11, borderRadius: 7, border: "none", cursor: "pointer" }}>キャンセル</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 8, padding: "10px 12px" }}>
                        <RichEditor value={c.content} readOnly minHeight={20} />
                        {c.images.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                            {c.images.map((img, i) => (
                              <div key={i} style={{ position: "relative" }}>
                                <img src={img} alt="" onClick={() => setPreviewImage(img)}
                                  style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                                <button onClick={() => copyImageToClipboard(img)}
                                  style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                  title="画像をコピー">
                                  {copiedImageUrl === img ? <CheckCheck style={{ width: 8, height: 8, color: "#4ADE80" }} /> : <Copy style={{ width: 8, height: 8, color: "#FFF" }} />}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Replies */}
                    {(repliesByParent.get(c.id) ?? []).map(reply => {
                      const isOwnReply = reply.userName === userName;
                      return (
                        <div key={reply.id} id={`panel-comment-${reply.id}`} style={{ display: "flex", gap: 8, marginTop: 10, paddingLeft: 12, borderLeft: "2px solid rgba(26,23,20,0.07)" }}>
                          <Avatar name={reply.userName} size="xs" />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>{reply.userName}</span>
                              <span style={{ fontSize: 10, color: "#C9C4BB" }}>{formatTs(reply.createdAt)}</span>
                              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                                {isOwnReply && editingId !== reply.id && (
                                  <button onClick={() => handleEditComment(reply)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                                    <Pencil style={{ width: 11, height: 11 }} />
                                  </button>
                                )}
                                {isOwnReply && (
                                  <button onClick={() => handleDeleteComment(reply.id)} style={{ padding: 3, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                                    <Trash2 style={{ width: 11, height: 11 }} />
                                  </button>
                                )}
                              </div>
                            </div>
                            {editingId === reply.id ? (
                              <div onPaste={e => pasteImage(e, setEditImages, `tickets/${ticket.id}/comments`)}>
                                <RichEditor value={editContent} onChange={setEditContent} minHeight={60} members={projectMemberNames.length > 0 ? [...new Set([...projectMemberNames, ...adminMemberNames])] : memberNames} />
                                {editImages.length > 0 && (
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
                                    {editImages.map((img, i) => (
                                      <div key={i} style={{ position: "relative" }}>
                                        <img src={img} alt="" onClick={() => setPreviewImage(img)} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                                        <button onClick={() => copyImageToClipboard(img)} style={{ position: "absolute", top: -5, right: 12, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="画像をコピー">
                                          {copiedImageUrl === img ? <CheckCheck style={{ width: 7, height: 7, color: "#4ADE80" }} /> : <Copy style={{ width: 7, height: 7, color: "#FFF" }} />}
                                        </button>
                                        <button onClick={() => setEditImages(prev => prev.filter((_, j) => j !== i))} style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                          <X style={{ width: 8, height: 8, color: "#FFF" }} />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "#B0A9A4" }}>
                                    <ImageIcon style={{ width: 13, height: 13 }} />画像（Ctrl+V 貼り付け可）
                                    <input type="file" accept="image/*" multiple style={{ display: "none" }}
                                      onChange={async e => {
                                        for (const f of Array.from(e.target.files || [])) {
                                          if (!f.type.startsWith("image/")) continue;
                                          const url = await uploadImageToStorage(f, `tickets/${ticket.id}/comments`);
                                          if (url) setEditImages(prev => [...prev, url]);
                                        }
                                        e.target.value = "";
                                      }} />
                                  </label>
                                  <div style={{ display: "flex", gap: 6 }}>
                                    <button onClick={() => handleSaveEdit(reply.id)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#059669", color: "#FFF", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", cursor: "pointer" }}>
                                      <Check style={{ width: 11, height: 11 }} />保存
                                    </button>
                                    <button onClick={() => { setEditingId(null); setEditImages([]); }} style={{ padding: "5px 10px", background: "#F4F5F6", color: "#6B6458", fontSize: 11, borderRadius: 7, border: "none", cursor: "pointer" }}>キャンセル</button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 8, padding: "10px 12px" }}>
                                <RichEditor value={reply.content} readOnly minHeight={20} />
                                {reply.images.length > 0 && (
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                                    {reply.images.map((img, i) => (
                                      <div key={i} style={{ position: "relative" }}>
                                        <img src={img} alt="" onClick={() => setPreviewImage(img)} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                                        <button onClick={() => copyImageToClipboard(img)} style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="画像をコピー">
                                          {copiedImageUrl === img ? <CheckCheck style={{ width: 8, height: 8, color: "#4ADE80" }} /> : <Copy style={{ width: 8, height: 8, color: "#FFF" }} />}
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {/* Reply form */}
                    {replyingToId === c.id && (
                      <div onPaste={e => pasteImage(e, setReplyImages, `tickets/${ticket.id}/comments`)} style={{ display: "flex", gap: 8, marginTop: 10, paddingLeft: 12, borderLeft: "2px solid rgba(26,23,20,0.07)" }}>
                        <Avatar name={userName} size="xs" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <RichEditor value={replyText} onChange={setReplyText} placeholder="返信を入力..." minHeight={60} members={projectMemberNames.length > 0 ? [...new Set([...projectMemberNames, ...adminMemberNames])] : memberNames} />
                          {replyImages.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
                              {replyImages.map((img, i) => (
                                <div key={i} style={{ position: "relative" }}>
                                  <img src={img} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6 }} />
                                  <button onClick={() => setReplyImages(prev => prev.filter((_, j) => j !== i))} style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <X style={{ width: 8, height: 8, color: "#FFF" }} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "#B0A9A4" }}>
                              <ImageIcon style={{ width: 13, height: 13 }} />画像（Ctrl+V 貼り付け可）
                              <input type="file" accept="image/*" multiple style={{ display: "none" }}
                                onChange={async e => {
                                  for (const f of Array.from(e.target.files || [])) {
                                    if (!f.type.startsWith("image/")) continue;
                                    const url = await uploadImageToStorage(f, `tickets/${ticket.id}/comments`);
                                    if (url) setReplyImages(prev => [...prev, url]);
                                  }
                                  e.target.value = "";
                                }} />
                            </label>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={async () => { await addReply(c, replyText, replyImages); setReplyingToId(null); setReplyText(""); setReplyImages([]); }} disabled={!replyText.trim()}
                                style={{ padding: "6px 12px", background: !replyText.trim() ? "#F4F5F6" : "#0284C7", color: !replyText.trim() ? "#B0A9A4" : "#FFF", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", cursor: !replyText.trim() ? "not-allowed" : "pointer" }}>
                                返信
                              </button>
                              <button onClick={() => { setReplyingToId(null); setReplyText(""); setReplyImages([]); }} style={{ padding: "6px 12px", background: "#F4F5F6", color: "#6B6458", fontSize: 11, borderRadius: 7, border: "none", cursor: "pointer" }}>キャンセル</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Add comment */}
            <div onPaste={e => pasteImage(e, setCommentImages, `tickets/${ticket.id}/comments`)} style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <Avatar name={userName} size="xs" />
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1714" }}>{userName}</span>
                  <StatusBadge status={status} />
                </div>
              </div>
              <RichEditor value={commentText} onChange={setCommentText} placeholder="コメントを入力..." minHeight={72} members={projectMemberNames.length > 0 ? [...new Set([...projectMemberNames, ...adminMemberNames])] : memberNames} />
              {commentImages.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
                  {commentImages.map((img, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={img} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6 }} />
                      <button onClick={() => setCommentImages(prev => prev.filter((_, j) => j !== i))}
                        style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <X style={{ width: 8, height: 8, color: "#FFF" }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "#B0A9A4" }}>
                  <ImageIcon style={{ width: 13, height: 13 }} />画像（Ctrl+V 貼り付け可）
                  <input type="file" accept="image/*" multiple style={{ display: "none" }}
                    onChange={async e => {
                      for (const f of Array.from(e.target.files || [])) {
                        if (!f.type.startsWith("image/")) continue;
                        const url = await uploadImageToStorage(f, `tickets/${ticket.id}/comments`);
                        if (url) setCommentImages(prev => [...prev, url]);
                      }
                      e.target.value = "";
                    }} />
                </label>
                <button onClick={handleAddComment} disabled={!commentText.trim()}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: !commentText.trim() ? "#F4F5F6" : "#059669", color: !commentText.trim() ? "#B0A9A4" : "#FFF", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: !commentText.trim() ? "not-allowed" : "pointer" }}>
                  投稿
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
