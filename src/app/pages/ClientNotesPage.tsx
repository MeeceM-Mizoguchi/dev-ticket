import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Building2, ChevronRight, FileText, Plus, Search, Trash2, Users, X } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { CLIENTS } from "@/app/data/mock";
import { mapClient, mapClientNote } from "@/app/lib/mappers";
import type { Client, ClientNote } from "@/app/types";
import { submitOnEnter } from "@/app/lib/submitKey";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { ImageAttachments } from "@/app/components/shared/ImageAttachments";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { NotFoundView } from "@/app/components/shared/NotFoundView";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { TruncatedText } from "@/app/components/shared/TruncatedText";
import { ArticleExportButton } from "@/app/components/shared/ArticleExportButton";
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
 * 構成は議事録に寄せてあるが、フォルダ階層とアクション項目は持たない。
 */
export function ClientNotesPage() {
  const { clientId, noteId: noteIdParam } = useParams<{ clientId: string; noteId?: string }>();
  const navigate = useNavigate();
  const { userRole, userName, userOrgId } = useAuth();
  const { plan } = usePlan();
  const { toast } = useToast();

  const [client, setClient] = useState<Client | null>(null);
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [orgMembers, setOrgMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientMissing, setClientMissing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [noteDate, setNoteDate] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ClientNote | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [showExternalInput, setShowExternalInput] = useState(false);
  const [externalInput, setExternalInput] = useState("");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 編集欄(title/noteDate/…)がどのメモの中身で埋まっているか。
  // 選択直後はまだ前のメモの値なので、これが selectedId と一致するまで保存しない。
  const hydratedIdRef = useRef<string | null>(null);
  // BUG-02/03: 一度でも読み終えたら、以後はスピナーでコンテンツを隠さない
  const initializedRef = useRef(false);
  // BUG-05: 「新規メモ」連打での二重登録を止める
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

    // 参加者チップ・@メンションの候補。owner が他組織を見ているときはその組織の顔ぶれを出す。
    const orgId = (clientRow?.organization_id as string | null) ?? userOrgId ?? null;
    const { data: profileRows } = await (orgId
      ? supabase!.from("profiles").select("name").eq("organization_id", orgId).order("name")
      : supabase!.from("profiles").select("name").order("name"));
    setOrgMembers((profileRows ?? []).map(p => p.name as string).filter(Boolean));

    initializedRef.current = true;
    setLoading(false);
  }, [clientId, userOrgId]);

  useEffect(() => { void load(); }, [load]);

  // URL(/clients/:clientId/notes/:noteId)からの選択
  useEffect(() => {
    if (!noteIdParam) { setSelectedId(null); return; }
    if (notes.length === 0) return;
    const found = notes.find(n => n.id === noteIdParam);
    if (found) setSelectedId(found.id);
  }, [noteIdParam, notes]);

  const selected = notes.find(n => n.id === selectedId) ?? null;

  // URLで名指しされたメモが実在しない（削除済みリンク等）。
  // 作成直後は load() 後に navigate するので notes に載っており、ここには落ちない。
  const noteMissing = !loading && !!noteIdParam && !notes.some(n => n.id === noteIdParam);

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

  const handleAdd = async () => {
    if (!client || !isSupabaseEnabled) return;
    // BUG-05: await をまたぐので ref でガードする（state だけだと同レンダーの連打をすり抜ける）
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const id = crypto.randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase!.from("client_notes").insert({
        id, client_id: client.id,
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
    } finally {
      creatingRef.current = false;
    }
  };

  const handleDelete = async (note: ClientNote) => {
    // 消す直前の入力に対する自動保存が残っていると、削除済みの行へ書きに行ってしまう
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("client_notes").delete().eq("id", note.id);
      if (error) { toast("削除に失敗しました", "error"); throw error; }
    }
    setNotes(prev => prev.filter(n => n.id !== note.id));
    if (selectedId === note.id) {
      setSelectedId(null);
      navigate(`/clients/${clientId}/notes`);
    }
    toast(`「${note.title || "新規メモ"}」を削除しました`);
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

  const filteredNotes = useMemo(() => {
    if (!sidebarSearch) return notes;
    const q = sidebarSearch.toLowerCase();
    return notes.filter(n =>
      (n.title || "").toLowerCase().includes(q)
      || plainText(n.content).toLowerCase().includes(q)
      || n.attendees.some(a => a.toLowerCase().includes(q)));
  }, [notes, sidebarSearch]);

  if (loading && !initializedRef.current) return <PageLoader />;

  if (clientMissing) return (
    <NotFoundView kind="resource" label="クライアント"
      backTo={{ label: "クライアント一覧へ", to: "/clients" }} />
  );
  if (noteMissing) return (
    <NotFoundView kind="resource" label="打ち合わせメモ"
      backTo={{ label: "メモ一覧へ", to: `/clients/${clientId}/notes` }} />
  );

  return (
    <div style={{ padding: "24px 24px 0", minWidth: 900 }}>
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
            {client ? `${client.name} · ${notes.length} 件` : "..."}
          </p>
        </div>
        {!canEdit && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", background: "#FEF3C7", color: "#92400E", borderRadius: 20, border: "1px solid rgba(217,119,6,0.25)", flexShrink: 0 }}>閲覧のみ</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 16, height: "calc(100vh - 175px)", overflow: "hidden" }}>
        {/* 左: メモ一覧 */}
        <div style={{ width: 260, flexShrink: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", padding: 10, overflowY: "auto" }}>
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
            <button onClick={handleAdd}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 8px", marginBottom: 6, background: "#ECFDF5", color: "#059669", border: "1.5px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <Plus style={{ width: 12, height: 12 }} />新規メモ
            </button>
          )}

          {filteredNotes.length === 0 ? (
            <div style={{ padding: "24px 8px", textAlign: "center" }}>
              <FileText style={{ width: 24, height: 24, color: "#D4CEC8", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>
                {sidebarSearch ? `「${sidebarSearch}」に一致するメモがありません` : "メモがありません"}
              </p>
            </div>
          ) : filteredNotes.map(note => {
            const isSelected = selectedId === note.id;
            return (
              <div key={note.id} onClick={() => gotoNote(note.id)}
                style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "7px 8px", borderRadius: 7, cursor: "pointer", background: isSelected ? "#ECFDF5" : "transparent", marginBottom: 1 }}>
                <FileText style={{ width: 12, height: 12, color: isSelected ? "#059669" : "#B0A9A4", flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TruncatedText as="div" text={note.title || "新規メモ"}
                    style={{ fontSize: 12, fontWeight: isSelected ? 700 : 500, color: isSelected ? "#059669" : "#1A1714" }} />
                  <div style={{ fontSize: 10, color: "#B0A9A4", marginTop: 1 }}>
                    {formatDate(note.noteDate)}{note.attendees.length > 0 ? ` · ${note.attendees.length}名` : ""}
                  </div>
                </div>
              </div>
            );
          })}
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
          ) : (
            <>
              {/* 固定ヘッダー: タイトル・エクスポート・削除・打ち合わせ日・参加者 */}
              <div style={{ padding: "20px 20px 12px", flexShrink: 0, borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
                  <input value={title} disabled={!canEdit}
                    onChange={e => { setTitle(e.target.value); scheduleSave({ title: e.target.value, noteDate, attendees, content }); }}
                    placeholder="メモのタイトル"
                    style={{ flex: 1, boxSizing: "border-box", border: "none", outline: "none", fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", padding: 0, background: "transparent" }} />
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
                      {orgMembers.map(member => {
                        const active = attendees.includes(member);
                        return (
                          <button key={member} disabled={!canEdit} onClick={() => toggleAttendee(member)}
                            style={{ padding: "3px 9px", fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: canEdit ? "pointer" : "default", border: `1.5px solid ${active ? "#059669" : "rgba(26,23,20,0.1)"}`, background: active ? "#ECFDF5" : "transparent", color: active ? "#059669" : "#9E9690" }}>
                            {member}
                          </button>
                        );
                      })}
                      {/* 先方の出席者など、社内メンバー以外は自由入力で足す */}
                      {attendees.filter(a => !orgMembers.includes(a)).map(external => (
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
                  placeholder="打ち合わせの内容を入力..." members={orgMembers} minHeight={220}
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
          title="メモの削除"
          message={`「${deleteTarget.title || "新規メモ"}」を削除します。`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
