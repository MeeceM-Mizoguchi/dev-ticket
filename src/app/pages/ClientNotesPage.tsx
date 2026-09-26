import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Building2, ChevronDown, ChevronRight, FileText, FileUp, FolderOpen, FolderPlus, Link2, Loader2, Plus, Search, Trash2, Upload, Users, X } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { copyText } from "@/lib/clipboard";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { CLIENTS } from "@/app/data/mock";
import { mapClient, mapClientNote } from "@/app/lib/mappers";
import type { Client, ClientNote } from "@/app/types";
import { submitOnEnter } from "@/app/lib/submitKey";
import { appOrigin } from "@/app/lib/appOrigin";
import { readMinutesMarkdownFiles, MINUTES_MD_ACCEPT } from "@/app/lib/minutesMdImport";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { ImageAttachments } from "@/app/components/shared/ImageAttachments";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { NotFoundView } from "@/app/components/shared/NotFoundView";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { TruncatedText } from "@/app/components/shared/TruncatedText";
import { ArticleExportButton } from "@/app/components/shared/ArticleExportButton";
import { DocTree, FolderMoveModal, buildDocTree, isCyclicMove, type DocTreeNode } from "@/app/components/shared/DocTree";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/app/components/ui/dropdown-menu";
import { exportClientNoteArticle } from "@/app/lib/articleExport";

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// 本文(HTML)から検索用・一覧のプレビュー用の素のテキストを作る
function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * クライアント（取引先企業）単位の打ち合わせメモ。
 *
 * 議事録(MinutesPage)はプロジェクト配下なので、どのプロジェクトにも属さない
 * 「その会社との打ち合わせ」の置き場が無かった。この画面がその受け皿。
 * フォルダ階層・MD取り込み・リンクコピーは議事録と同仕様（アクション項目は持たない）。
 */
export function ClientNotesPage() {
  const { clientId, noteId: noteIdParam, folderId: folderIdParam } =
    useParams<{ clientId: string; noteId?: string; folderId?: string }>();
  const navigate = useNavigate();
  const { userRole, userName, userOrgId } = useAuth();
  const { plan } = usePlan();
  const { toast } = useToast();

  const [client, setClient] = useState<Client | null>(null);
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [projectMembers, setProjectMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientMissing, setClientMissing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [noteDate, setNoteDate] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ClientNote | null>(null);
  const [movingNodeTarget, setMovingNodeTarget] = useState<ClientNote | null>(null);
  const [isTreeDragOverRoot, setIsTreeDragOverRoot] = useState(false);
  // 作成直後のフォルダ/メモを一時的にハイライトし、そこまでスクロールする（議事録と同仕様）
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [scrollToId, setScrollToId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [showExternalInput, setShowExternalInput] = useState(false);
  const [externalInput, setExternalInput] = useState("");
  // MD取り込みの進捗（null=非実行中）。取り込み中は「新規メモ」ボタンを進捗表示へ差し替える。
  const [mdImportProgress, setMdImportProgress] = useState<{ done: number; total: number } | null>(null);
  const singleMdInputRef = useRef<HTMLInputElement | null>(null);
  const bulkMdInputRef = useRef<HTMLInputElement | null>(null);
  // どのフォルダへ取り込むか。input は1組を使い回すので、開く直前にここへ入れて change で読む。
  const mdImportParentRef = useRef<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 編集欄(title/noteDate/…)がどのメモの中身で埋まっているか。
  // 選択直後はまだ前のメモの値なので、これが selectedId と一致するまで保存しない。
  const hydratedIdRef = useRef<string | null>(null);
  // BUG-02/03: 一度でも読み終えたら、以後はスピナーでコンテンツを隠さない
  const initializedRef = useRef(false);
  // BUG-05: 「新規メモ」「新規フォルダ」連打での二重登録を止める
  const creatingRef = useRef(false);

  const canEdit = isSupabaseEnabled
    && (userRole === "owner" || userRole === "admin" || userRole === "project-manager");

  const load = useCallback(async () => {
    if (!clientId) { setLoading(false); return; }
    if (!isSupabaseEnabled) {
      // デモ(モック)モード。会社名だけ出して、メモはDBが要るので空のままにする。
      const mock = CLIENTS.find(c => c.id === clientId) ?? null;
      setClient(mock);
      setClientMissing(!mock);
      initializedRef.current = true;
      setLoading(false);
      return;
    }
    const [{ data: clientRow }, { data: noteRows }] = await Promise.all([
      supabase!.from("clients").select("*").eq("id", clientId).maybeSingle(),
      // BUG-01: 打ち合わせ日 → 作成日時 → id の安定ソート
      supabase!.from("client_notes").select("*").eq("client_id", clientId)
        .order("note_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }),
    ]);
    setClient(clientRow ? mapClient(clientRow) : null);
    setClientMissing(!clientRow);
    setNotes((noteRows ?? []).map(mapClientNote));

    // 参加者チップ・@メンション・MD取り込みの参加者照合の候補。
    // 組織の全員を出すと、この会社と無関係なプロジェクトの人の名前まで見えてしまうため、
    // この会社を「クライアント」に持つプロジェクトのメンバー(projects.members)だけに絞る。
    // projects.client は会社名で持っている（NewProjectDialog が clients.name を入れる）。
    // owner が他組織を見ているときはその組織のプロジェクトから引く。
    const members = new Set<string>();
    if (clientRow?.name) {
      const orgId = (clientRow.organization_id as string | null) ?? userOrgId ?? null;
      let q = supabase!.from("projects").select("members").eq("client", clientRow.name as string);
      if (orgId) q = q.eq("organization_id", orgId);
      // BUG-01
      const { data: projectRows } = await q
        .order("created_at", { ascending: true }).order("id", { ascending: true });
      for (const p of projectRows ?? []) {
        for (const n of ((p as { members?: unknown }).members as unknown[] | null) ?? []) {
          if (typeof n === "string" && n) members.add(n);
        }
      }
    }
    setProjectMembers([...members].sort((a, b) => a.localeCompare(b, "ja")));

    initializedRef.current = true;
    setLoading(false);
  }, [clientId, userOrgId]);

  useEffect(() => { void load(); }, [load]);

  // URL(/clients/:clientId/notes/:noteId または /notes/folders/:folderId)からの選択
  useEffect(() => {
    const target = folderIdParam ?? noteIdParam;
    if (!target) { setSelectedId(null); return; }
    if (notes.length === 0) return;
    const found = notes.find(n => n.id.toLowerCase() === target.toLowerCase());
    if (found) setSelectedId(found.id);
  }, [noteIdParam, folderIdParam, notes]);

  const selected = notes.find(n => n.id === selectedId) ?? null;

  // URLで名指しされたメモ/フォルダが実在しない（削除済みリンク等）。
  // 作成直後は load() 後に navigate するので notes に載っており、ここには落ちない。
  const routeTarget = folderIdParam ?? noteIdParam;
  const routeTargetMissing = !loading && !!routeTarget
    && !notes.some(n => n.id.toLowerCase() === routeTarget.toLowerCase());

  // ツリー用の並び。フォルダを先頭に、メモは打ち合わせ日の新しい順（議事録と同じ）。
  const orderedNotes = useMemo(() => [...notes].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    if (a.isFolder) return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "ja");
    return (b.noteDate || "").localeCompare(a.noteDate || "")
      || (b.createdAt || "").localeCompare(a.createdAt || "");
  }), [notes]);
  const tree = useMemo(() => buildDocTree(orderedNotes), [orderedNotes]);
  const noteCount = useMemo(() => notes.filter(n => !n.isFolder).length, [notes]);
  const noteById = useMemo(() => new Map(notes.map(n => [n.id, n])), [notes]);

  // パンくず用：選択中の祖先フォルダ一覧
  const ancestors = useMemo(() => {
    if (!selected) return [];
    const list: ClientNote[] = [];
    let current: ClientNote | undefined = selected;
    while (current?.parentId) {
      const parent: ClientNote | undefined = noteById.get(current.parentId);
      if (!parent) break;
      list.unshift(parent);
      current = parent;
    }
    return list;
  }, [selected, noteById]);

  useEffect(() => {
    setTitle(selected?.title ?? "");
    setNoteDate(selected?.noteDate ?? "");
    setAttendees(selected?.attendees ?? []);
    setContent(selected?.content ?? "");
    setImages(selected?.images ?? []);
    setShowExternalInput(false);
    setExternalInput("");
    // ここまで来て初めて編集欄が選択中メモの中身になる。これ以前の保存要求は
    // 前のメモ（もしくは空）の値を握っているので捨てる。
    hydratedIdRef.current = selected?.id ?? null;
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自動保存の待機タイマーは画面を離れても止めない。
  // ここで clearTimeout すると、打ち終わって 600ms 以内に別画面へ移ったときに
  // 最後の入力が保存されずに消える（DBへの書き込みは selectedId を握っているので安全）。

  const gotoNote = useCallback((id: string) => {
    navigate(`/clients/${clientId}/notes/${id}`);
  }, [navigate, clientId]);

  const gotoFolder = useCallback((id: string) => {
    navigate(`/clients/${clientId}/notes/folders/${id}`);
  }, [navigate, clientId]);

  // 作成したノードまでスクロールして数秒ハイライトする（議事録と同仕様）
  const flashCreated = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightIds(ids);
    setScrollToId(ids[0]);
    highlightTimer.current = setTimeout(() => { setHighlightIds([]); setScrollToId(null); }, 2400);
  }, []);

  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  const scheduleSave = useCallback((
    patch: Partial<{ title: string; noteDate: string; attendees: string[]; content: string }>,
    immediate = false,
  ) => {
    if (!selectedId || !isSupabaseEnabled) return;
    // 編集欄がまだ選択中メモの中身になっていない間の保存要求は無視する。
    // エディタは表示のための流し込みでも onChange を出すことがあり、その時点の値は
    // 前のメモ（初回は空）のものなので、書き込むと中身を壊す。
    if (hydratedIdRef.current !== selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const run = async () => {
      // note_date は NOT NULL。日付欄を空にしたまま送ると保存ごと失敗するので、
      // 空のときは列自体を送らず現在値を残す。
      const patchRow: Record<string, unknown> = {
        title: patch.title, attendees: patch.attendees, content: patch.content,
        updated_at: new Date().toISOString(),
      };
      if (patch.noteDate) patchRow.note_date = patch.noteDate;
      const { error } = await supabase!.from("client_notes").update(patchRow).eq("id", selectedId);
      if (error) {
        console.error("[ClientNotesPage] save error:", error);
        toast("メモの保存に失敗しました", "error");
        return;
      }
      setNotes(prev => prev.map(n => n.id === selectedId ? { ...n, ...patch } as ClientNote : n));
    };
    // ⌘/Ctrl + Enter の確定は自動保存(600ms待ち)を待たずに即書き込む
    if (immediate) void run();
    else saveTimer.current = setTimeout(run, 600);
  }, [selectedId, toast]);

  const handleImagesChange = useCallback(async (next: string[]) => {
    if (!selectedId) return;
    setImages(next);
    setNotes(prev => prev.map(n => n.id === selectedId ? { ...n, images: next } : n));
    if (!isSupabaseEnabled) return;
    await supabase!.from("client_notes").update({ images: next, updated_at: new Date().toISOString() }).eq("id", selectedId);
  }, [selectedId]);

  const handleAdd = async (parentId: string | null = null) => {
    if (!client || !isSupabaseEnabled) return;
    // BUG-05: await をまたぐので ref でガードする（state だけだと同レンダーの連打をすり抜ける）
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const id = crypto.randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase!.from("client_notes").insert({
        id, client_id: client.id, parent_id: parentId,
        organization_id: client.organizationId ?? userOrgId ?? null,
        title: "新規メモ", note_date: today, attendees: [], content: "", images: [],
        created_by: userName || "",
      });
      if (error) {
        console.error("[ClientNotesPage] insert error:", error);
        toast("メモの作成に失敗しました", "error");
        return;
      }
      await load();
      gotoNote(id);
      flashCreated([id]);
    } finally {
      creatingRef.current = false;
    }
  };

  // ── フォルダ（議事録と同仕様） ─────────────────────────────────
  const handleAddFolder = async (parentId: string | null = null) => {
    if (!client || !isSupabaseEnabled) return;
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const id = crypto.randomUUID();
      const { error } = await supabase!.from("client_notes").insert({
        id, client_id: client.id, parent_id: parentId,
        organization_id: client.organizationId ?? userOrgId ?? null,
        title: "無題のフォルダ", is_folder: true, attendees: [], content: "", images: [],
        sort_order: notes.filter(n => n.parentId === parentId).length,
        created_by: userName || "",
      });
      if (error) {
        console.error("[ClientNotesPage] folder insert error:", error);
        toast("フォルダの作成に失敗しました", "error");
        return;
      }
      await load();
      gotoFolder(id);
      flashCreated([id]);
    } finally {
      creatingRef.current = false;
    }
  };

  const handleRenameNode = useCallback(async (id: string, nextTitle: string) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, title: nextTitle } : n));
    if (id === selectedId) setTitle(nextTitle);
    const { error } = await supabase!.from("client_notes")
      .update({ title: nextTitle, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      console.error("[ClientNotesPage] rename error:", error);
      toast("名前の変更に失敗しました", "error");
      void load();
    }
  }, [selectedId, load, toast]);

  const handleMoveNode = useCallback(async (draggedId: string, targetParentId: string | null) => {
    if (draggedId === targetParentId) return;
    const dragged = notes.find(n => n.id === draggedId);
    if (!dragged || dragged.parentId === targetParentId) return;
    if (isCyclicMove(notes, draggedId, targetParentId)) {
      toast("フォルダを自身の子孫フォルダ配下に移動することはできません", "error");
      return;
    }
    const sortOrder = notes.filter(n => n.parentId === targetParentId).length;
    setNotes(prev => prev.map(n => n.id === draggedId ? { ...n, parentId: targetParentId, sortOrder } : n));
    const { error } = await supabase!.from("client_notes")
      .update({ parent_id: targetParentId, sort_order: sortOrder, updated_at: new Date().toISOString() })
      .eq("id", draggedId);
    if (error) {
      console.error("[ClientNotesPage] move error:", error);
      toast("移動に失敗しました", "error");
    } else {
      toast("配置を変更しました");
    }
    void load();
  }, [notes, load, toast]);

  // プロジェクト配下ではないので shareLink(プロジェクトslug前提)は使わず、ここで組み立てる。
  // オリジンは必ず appOrigin() を通す（ネイティブの capacitor:// を渡さないため）。
  const handleCopyLink = useCallback(async (node: { id: string; isFolder: boolean }) => {
    const origin = appOrigin();
    if (!origin || !clientId) {
      toast("共有URLの設定(VITE_PUBLIC_APP_ORIGIN)がないためリンクを作れません", "error");
      return;
    }
    const base = `${origin}/clients/${encodeURIComponent(clientId)}/notes`;
    const url = node.isFolder ? `${base}/folders/${node.id}` : `${base}/${node.id}`;
    if (await copyText(url)) toast("リンクをコピーしました");
    else toast("リンクのコピーに失敗しました", "error");
  }, [clientId, toast]);

  // ── MDファイル取り込み（単体 / 一括） ──────────────────────────
  // 1ファイル = 1メモ。議事録と同じ読み取り(minutesMdImport)を使い、
  // タイトル・日付・参加者は本文の前置きから拾う。parentId を渡すとそのフォルダ直下に入る。
  const handleImportMdFiles = useCallback(async (files: File[], parentId: string | null = null) => {
    if (!client || !isSupabaseEnabled || files.length === 0) return;
    setMdImportProgress({ done: 0, total: files.length });

    const { minutes: imported, skipped } = await readMinutesMarkdownFiles(
      files, projectMembers, (done, total) => setMdImportProgress({ done, total }),
    );

    if (imported.length === 0) {
      setMdImportProgress(null);
      toast(skipped[0]?.reason ?? "取り込める内容がありませんでした", "error");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows = imported.map(m => ({
      id: crypto.randomUUID(), client_id: client.id, parent_id: parentId,
      organization_id: client.organizationId ?? userOrgId ?? null,
      title: m.title, note_date: m.meetingDate || today,
      attendees: m.attendees, content: m.content, images: [],
      created_by: userName || "",
    }));

    const { error } = await supabase!.from("client_notes").insert(rows);
    setMdImportProgress(null);
    if (error) {
      console.error("[ClientNotesPage] md import insert error:", error);
      toast("メモの作成に失敗しました", "error");
      return;
    }

    await load();
    toast(`${rows.length}件のメモを作成しました${skipped.length ? `（${skipped.length}件はスキップ）` : ""}`);
    gotoNote(rows[0].id);
    // フォルダへ取り込んだときは畳んだ中に入って見えないので、開いて光らせる
    flashCreated(rows.map(r => r.id));
  }, [client, projectMembers, userOrgId, userName, load, toast, gotoNote, flashCreated]);

  // フォルダのメニューから開いたときは、そのフォルダを親にして取り込む
  const handleOpenMdPicker = useCallback((parentId: string | null, multiple: boolean) => {
    mdImportParentRef.current = parentId;
    (multiple ? bulkMdInputRef : singleMdInputRef).current?.click();
  }, []);

  const handleMdInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // 同じファイルを続けて選び直せるように値をクリアする
    e.target.value = "";
    // 取り込み先は「開く直前に指定されたフォルダ」。次回にひきずらないよう毎回リセットする
    const parentId = mdImportParentRef.current;
    mdImportParentRef.current = null;
    if (picked.length > 0) void handleImportMdFiles(picked, parentId);
  };

  const handleDelete = async (note: ClientNote) => {
    // 消す直前の入力に対する自動保存が残っていると、削除済みの行へ書きに行ってしまう
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("client_notes").delete().eq("id", note.id);
      if (error) { toast("削除に失敗しました", "error"); throw error; }
    }
    // フォルダを消すと配下も消える(cascade)ので、選択中が子孫なら選択を外す
    const isSelectionGone = selectedId === note.id
      || (!!selectedId && isCyclicMove(notes, note.id, selectedId));
    if (isSelectionGone) {
      setSelectedId(null);
      navigate(`/clients/${clientId}/notes`);
    }
    toast(`「${note.title || (note.isFolder ? "無題のフォルダ" : "新規メモ")}」を削除しました`);
    void load();
  };

  const toggleAttendee = (name: string) => {
    const next = attendees.includes(name) ? attendees.filter(a => a !== name) : [...attendees, name];
    setAttendees(next);
    scheduleSave({ title, noteDate, attendees: next, content });
  };

  const addExternalAttendee = () => {
    const name = externalInput.trim();
    if (name && !attendees.includes(name)) {
      const next = [...attendees, name];
      setAttendees(next);
      scheduleSave({ title, noteDate, attendees: next, content });
    }
    setExternalInput("");
    setShowExternalInput(false);
  };

  // 検索中はフォルダ階層をたたんで、一致したメモだけを平らに並べる（議事録と同仕様）
  const searchedNotes = useMemo(() => {
    if (!sidebarSearch) return [];
    const q = sidebarSearch.toLowerCase();
    return orderedNotes.filter(n => !n.isFolder && (
      (n.title || "").toLowerCase().includes(q)
      || plainText(n.content).toLowerCase().includes(q)
      || n.attendees.some(a => a.toLowerCase().includes(q))));
  }, [orderedNotes, sidebarSearch]);

  if (loading && !initializedRef.current) return <PageLoader />;

  if (clientMissing) return (
    <NotFoundView kind="resource" label="クライアント"
      backTo={{ label: "クライアント一覧へ", to: "/clients" }} />
  );
  if (routeTargetMissing) return (
    <NotFoundView kind="resource" label={folderIdParam ? "フォルダ" : "打ち合わせメモ"}
      backTo={{ label: "メモ一覧へ", to: `/clients/${clientId}/notes` }} />
  );

  return (
    <div style={{ padding: "24px 24px 0", minWidth: 900 }}>
      <style>{"@keyframes client-notes-md-spin { to { transform: rotate(360deg); } }"}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/clients")}
          style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <Building2 style={{ width: 12, height: 12 }} /> クライアント
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{client?.name ?? clientId ?? ""}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>打ち合わせメモ</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {client ? `${client.name} · ${noteCount} 件` : "..."}
          </p>
        </div>
        {!canEdit && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", background: "#FEF3C7", color: "#92400E", borderRadius: 20, border: "1px solid rgba(217,119,6,0.25)", flexShrink: 0 }}>閲覧のみ</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 16, height: "calc(100vh - 175px)", overflow: "hidden" }}>
        {/* 左: メモ一覧（フォルダツリー）。枠へのドロップでルート直下へ戻す */}
        <div
          onDragOver={e => { if (!canEdit || sidebarSearch) return; e.preventDefault(); setIsTreeDragOverRoot(true); }}
          onDragLeave={() => setIsTreeDragOverRoot(false)}
          onDrop={async e => {
            if (!canEdit || sidebarSearch) return;
            e.preventDefault();
            setIsTreeDragOverRoot(false);
            const draggedId = e.dataTransfer.getData("text/plain");
            if (draggedId) await handleMoveNode(draggedId, null);
          }}
          style={{
            width: 260, flexShrink: 0, background: "#FFFFFF", borderRadius: 14,
            border: isTreeDragOverRoot ? "1px dashed #059669" : "1px solid rgba(26,23,20,0.07)",
            padding: 10, overflowY: "auto", transition: "all 0.15s",
          }}>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <Search style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 11, height: 11, color: sidebarSearch ? "#059669" : "#C9C4BB", pointerEvents: "none" }} />
            <input value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)} placeholder="検索..."
              style={{ width: "100%", boxSizing: "border-box", padding: "6px 26px", fontSize: 11, background: "#F4F5F6", border: `1px solid ${sidebarSearch ? "rgba(5,150,105,0.25)" : "transparent"}`, borderRadius: 7, outline: "none", fontFamily: "inherit" }} />
            {sidebarSearch && (
              <button onClick={() => setSidebarSearch("")}
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 2, color: "#A09790", display: "flex", alignItems: "center" }}>
                <X style={{ width: 10, height: 10 }} />
              </button>
            )}
          </div>

          {canEdit && (
            <>
              {/* MD取り込み用の隠しinput。単体/一括で multiple だけが違う。 */}
              <input ref={singleMdInputRef} type="file" accept={MINUTES_MD_ACCEPT} onChange={handleMdInputChange} style={{ display: "none" }} />
              <input ref={bulkMdInputRef} type="file" accept={MINUTES_MD_ACCEPT} multiple onChange={handleMdInputChange} style={{ display: "none" }} />
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild disabled={!!mdImportProgress}>
                    <button
                      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 8px", background: "#ECFDF5", color: "#059669", border: "1.5px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: mdImportProgress ? "default" : "pointer" }}>
                      {mdImportProgress ? (
                        <>
                          <Loader2 style={{ width: 12, height: 12, animation: "client-notes-md-spin 1s linear infinite" }} />
                          取り込み中 {mdImportProgress.done}/{mdImportProgress.total}
                        </>
                      ) : (
                        <>
                          <Plus style={{ width: 12, height: 12 }} />新規メモ
                          <ChevronDown style={{ width: 11, height: 11 }} />
                        </>
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" style={{ minWidth: 190 }}>
                    <DropdownMenuItem onSelect={() => handleAdd(null)}>
                      <FileText style={{ width: 14, height: 14 }} />新規メモを作成
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleOpenMdPicker(null, false)}>
                      <FileUp style={{ width: 14, height: 14 }} />MDファイルから作成
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleOpenMdPicker(null, true)}>
                      <Upload style={{ width: 14, height: 14 }} />一括MD取り込み
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button onClick={() => handleAddFolder(null)}
                  title="新規フォルダ"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "7px 10px", background: "#FFFBEB", color: "#D97706", border: "1.5px solid #FDE68A", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <FolderPlus style={{ width: 13, height: 13 }} />
                </button>
              </div>
            </>
          )}

          {sidebarSearch ? (
            searchedNotes.length === 0 ? (
              <div style={{ padding: "24px 8px", textAlign: "center" }}>
                <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>「{sidebarSearch}」に一致するメモがありません</p>
              </div>
            ) : searchedNotes.map(note => {
              const parent = note.parentId ? noteById.get(note.parentId) : null;
              const isSelected = selectedId === note.id;
              return (
                <div key={note.id} onClick={() => gotoNote(note.id)}
                  style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "7px 8px", borderRadius: 7, cursor: "pointer", background: isSelected ? "#ECFDF5" : "transparent", marginBottom: 1 }}>
                  <FileText style={{ width: 12, height: 12, color: isSelected ? "#059669" : "#B0A9A4", flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TruncatedText as="div" text={note.title || "新規メモ"}
                      style={{ fontSize: 12, fontWeight: isSelected ? 700 : 500, color: isSelected ? "#059669" : "#1A1714" }} />
                    <div style={{ fontSize: 10, color: "#B0A9A4", marginTop: 1 }}>
                      {formatDate(note.noteDate)}{parent ? ` · ${parent.title || "無題のフォルダ"}` : ""}
                    </div>
                  </div>
                </div>
              );
            })
          ) : tree.length === 0 ? (
            <div style={{ padding: "24px 8px", textAlign: "center" }}>
              <FileText style={{ width: 24, height: 24, color: "#D4CEC8", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>メモがありません</p>
            </div>
          ) : (
            <DocTree
              tree={tree}
              selectedId={selectedId}
              canEdit={canEdit}
              onSelect={(node: DocTreeNode) => { if (node.isFolder) gotoFolder(node.id); else gotoNote(node.id); }}
              onAddChild={(parentId, isFolder) => { if (isFolder) void handleAddFolder(parentId); else void handleAdd(parentId); }}
              addItemLabel="メモを追加"
              onRename={handleRenameNode}
              onDelete={node => { const n = noteById.get(node.id); if (n) setDeleteTarget(n); }}
              onMove={handleMoveNode}
              onOpenMoveModal={node => { const n = noteById.get(node.id); if (n) setMovingNodeTarget(n); }}
              onCopyLink={handleCopyLink}
              onImportMd={canEdit ? handleOpenMdPicker : undefined}
              highlightIds={highlightIds}
              scrollToId={scrollToId}
              renderItemRow={(node, isSelected) => {
                const n = noteById.get(node.id);
                return (
                  <>
                    <FileText style={{ width: 12, height: 12, color: isSelected ? "#059669" : "#B0A9A4", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <TruncatedText as="p" text={node.title || "新規メモ"}
                        style={{ fontSize: 12, fontWeight: isSelected ? 700 : 500, color: isSelected ? "#059669" : "#1A1714", margin: 0 }} />
                      <p style={{ fontSize: 10, color: "#B0A9A4", margin: 0 }}>
                        {formatDate(n?.noteDate ?? "")}{n && n.attendees.length > 0 ? ` · ${n.attendees.length}名` : ""}
                      </p>
                    </div>
                  </>
                );
              }}
            />
          )}
        </div>

        {/* 右: 本文 */}
        <div style={{ flex: 1, minWidth: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {!selected ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <FileText style={{ width: 32, height: 32, color: "#D4CEC8", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>
                {canEdit ? "左の一覧からメモを選択するか、新規作成してください" : "左の一覧からメモを選択してください"}
              </p>
            </div>
          ) : selected.isFolder ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <FolderOpen style={{ width: 32, height: 32, color: "#FCD34D", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", margin: "0 0 6px" }}>{selected.title || "無題のフォルダ"}</p>
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: "0 0 16px" }}>
                {notes.filter(n => n.parentId === selected.id).length} 件のアイテム
              </p>
              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <button onClick={() => handleCopyLink(selected)}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <Link2 style={{ width: 13, height: 13 }} />リンクをコピー
                </button>
                {canEdit && (
                  <button onClick={() => handleAdd(selected.id)}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#FFFFFF", color: "#6B6458", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    <Plus style={{ width: 13, height: 13 }} />このフォルダにメモを追加
                  </button>
                )}
                {/* フォルダを開いた状態からも取り込めるようにする。取り込み先はこのフォルダ。 */}
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild disabled={!!mdImportProgress}>
                      <button
                        style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#FFFFFF", color: "#6B6458", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: mdImportProgress ? "default" : "pointer" }}>
                        {mdImportProgress ? (
                          <>
                            <Loader2 style={{ width: 13, height: 13, animation: "client-notes-md-spin 1s linear infinite" }} />
                            取り込み中 {mdImportProgress.done}/{mdImportProgress.total}
                          </>
                        ) : (
                          <>
                            <FileUp style={{ width: 13, height: 13 }} />MDから追加
                            <ChevronDown style={{ width: 11, height: 11 }} />
                          </>
                        )}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" style={{ minWidth: 190 }}>
                      <DropdownMenuItem onSelect={() => handleOpenMdPicker(selected.id, false)}>
                        <FileUp style={{ width: 14, height: 14 }} />MDファイルから作成
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleOpenMdPicker(selected.id, true)}>
                        <Upload style={{ width: 14, height: 14 }} />一括MD取り込み
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* 固定ヘッダー: タイトル・リンク・エクスポート・削除・打ち合わせ日・参加者 */}
              <div style={{ padding: "20px 20px 12px", flexShrink: 0, borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
                {ancestors.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#9E9690", marginBottom: 8, flexWrap: "wrap" }}>
                    <span onClick={() => { setSelectedId(null); navigate(`/clients/${clientId}/notes`); }} style={{ color: "#059669", cursor: "pointer", fontWeight: 600 }}>メモホーム</span>
                    {ancestors.map(folder => (
                      <div key={folder.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span>&gt;</span>
                        <span onClick={() => gotoFolder(folder.id)} style={{ color: "#059669", cursor: "pointer", fontWeight: 600 }}>
                          {folder.title || "無題のフォルダ"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
                  <input value={title} disabled={!canEdit}
                    onChange={e => { setTitle(e.target.value); scheduleSave({ title: e.target.value, noteDate, attendees, content }); }}
                    placeholder="メモのタイトル"
                    style={{ flex: 1, boxSizing: "border-box", border: "none", outline: "none", fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", padding: 0, background: "transparent" }} />
                  <button onClick={() => handleCopyLink(selected)} title="このメモへのリンクをコピー"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 4, flexShrink: 0, display: "flex", alignItems: "center" }}>
                    <Link2 style={{ width: 14, height: 14 }} />
                  </button>
                  <ArticleExportButton formats={["xlsx", "docx", "pdf", "md"]}
                    onExport={f => exportClientNoteArticle(selected, client?.name ?? "", f)} />
                  {canEdit && (
                    <button onClick={() => setDeleteTarget(selected)} title="このメモを削除"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 4, flexShrink: 0 }}>
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>打ち合わせ日</label>
                    <input type="date" value={noteDate} disabled={!canEdit}
                      onChange={e => { setNoteDate(e.target.value); scheduleSave({ title, noteDate: e.target.value, attendees, content }); }}
                      style={{ padding: "6px 10px", fontSize: 12, border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 8, outline: "none", fontFamily: "inherit" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                      <Users style={{ width: 10, height: 10 }} />参加者
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                      {projectMembers.map(member => {
                        const active = attendees.includes(member);
                        return (
                          <button key={member} disabled={!canEdit} onClick={() => toggleAttendee(member)}
                            style={{ padding: "3px 9px", fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: canEdit ? "pointer" : "default", border: `1.5px solid ${active ? "#059669" : "rgba(26,23,20,0.1)"}`, background: active ? "#ECFDF5" : "transparent", color: active ? "#059669" : "#9E9690" }}>
                            {member}
                          </button>
                        );
                      })}
                      {/* 先方の出席者など、社内メンバー以外は自由入力で足す */}
                      {attendees.filter(a => !projectMembers.includes(a)).map(external => (
                        <span key={external} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", fontSize: 11, fontWeight: 600, borderRadius: 20, border: "1.5px solid #059669", background: "#ECFDF5", color: "#059669" }}>
                          {external}
                          {canEdit && (
                            <button onClick={() => toggleAttendee(external)}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", color: "#059669" }}>
                              <X style={{ width: 10, height: 10 }} />
                            </button>
                          )}
                        </span>
                      ))}
                      {canEdit && !showExternalInput && (
                        <button onClick={() => setShowExternalInput(true)} title="参加者を追加"
                          style={{ width: 22, height: 22, borderRadius: "50%", border: "1.5px dashed rgba(26,23,20,0.2)", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#9E9690" }}>
                          <Plus style={{ width: 11, height: 11 }} />
                        </button>
                      )}
                      {canEdit && showExternalInput && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input autoFocus value={externalInput} onChange={e => setExternalInput(e.target.value)}
                            onKeyDown={submitOnEnter(addExternalAttendee, {
                              onCancel: () => { setExternalInput(""); setShowExternalInput(false); },
                            })}
                            placeholder="名前を入力..."
                            style={{ padding: "3px 8px", fontSize: 11, border: "1.5px solid #059669", borderRadius: 20, outline: "none", fontFamily: "inherit", width: 100 }} />
                          <button onClick={addExternalAttendee}
                            style={{ padding: "3px 8px", fontSize: 11, fontWeight: 600, background: "#059669", color: "#fff", border: "none", borderRadius: 20, cursor: "pointer" }}>追加</button>
                          <button onClick={() => { setExternalInput(""); setShowExternalInput(false); }}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#9E9690" }}>
                            <X style={{ width: 11, height: 11 }} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 本文 + 添付画像（内部でスクロール） */}
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "12px 20px 16px", display: "flex", flexDirection: "column" }}>
                <RichEditor value={content} readOnly={!canEdit}
                  onChange={v => { setContent(v); scheduleSave({ title, noteDate, attendees, content: v }); }}
                  onSubmit={() => { if (canEdit) scheduleSave({ title, noteDate, attendees, content }, true); }}
                  placeholder="打ち合わせの内容を入力..." members={projectMembers} minHeight={220}
                  style={{ flex: 1, minHeight: 0 }}
                  onImageUpload={canEdit ? async (file) => {
                    if (plan.maxImagesPerItem !== null) {
                      const currentCount = (content.match(/<img/g) ?? []).length;
                      if (currentCount >= plan.maxImagesPerItem) { toast("現在のプランではこれ以上添付できません", "error"); return ""; }
                    }
                    if (!isSupabaseEnabled) return URL.createObjectURL(file);
                    const extMap: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
                    const ext = extMap[file.type] ?? "png";
                    const path = `client-notes/${selected.id}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
                    const { data, error } = await supabase!.storage.from("ticket-images").upload(path, file, { upsert: true, contentType: file.type });
                    if (error || !data) return "";
                    return supabase!.storage.from("ticket-images").getPublicUrl(path).data.publicUrl;
                  } : undefined} />
                <div style={{ marginTop: 16, flexShrink: 0 }}>
                  <ImageAttachments images={images} onImagesChange={handleImagesChange}
                    uploadPathPrefix={`client-notes/${selected.id}`} readOnly={!canEdit}
                    maxImages={plan.maxImagesPerItem} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.isFolder ? "フォルダの削除" : "メモの削除"}
          message={deleteTarget.isFolder
            ? `「${deleteTarget.title || "無題のフォルダ"}」を削除します。フォルダ内のメモも一緒に削除されます。`
            : `「${deleteTarget.title || "新規メモ"}」を削除します。`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)} />
      )}

      {/* Googleドライブ風のフォルダ階層一覧選択移動モーダル */}
      {movingNodeTarget && (
        <FolderMoveModal
          node={movingNodeTarget}
          items={notes}
          onClose={() => setMovingNodeTarget(null)}
          onConfirm={async targetParentId => {
            await handleMoveNode(movingNodeTarget.id, targetParentId);
            setMovingNodeTarget(null);
          }}
        />
      )}
    </div>
  );
}
