// BRU24-001-3 チケットをバックログへ戻す ─ 確認・実行・完了のダイアログ
//
// チケット詳細（1件）と一括操作の下部バー（複数件）の両方から使う。
//   1. 件数を集める（コメント・添付・子チケット・実績工数・PR）
//   2. 親を選ばずに子チケットだけが選ばれていたら「親から独立させるか」を1回だけ聞く
//      いいえ → 「親チケットからバックログへ登録してください」と出して何もしない
//   3. 件数を出して確認（実績工数・PRがあれば強めに警告）→ 実行
//      件数の下で戻す先のフォルダ（直下＋全階層）を選べる。その場でフォルダも作れる（BRU24-003）
//   4. 「B-012 としてバックログへ移動しました」とリンク付きで出す
// 実行とフォルダの作成は ref でガードする（BUG-05）。

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, ClipboardList, Folder, Plus } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSpinner } from "@/app/components/shared/PageLoader";
import { FolderPickerList, type DocTreeItem } from "@/app/components/shared/DocTree";
import { useAuth } from "@/app/contexts/AuthContext";
import { emitLinkItemsChanged } from "@/app/lib/linkSuggestSync";
import { createBacklogFolder } from "@/app/lib/backlogItems";
import { submitOnEnter } from "@/app/lib/submitKey";
import {
  summarizeMoveToBacklog, moveTicketsToBacklog,
  type MoveToBacklogSummary, type MovedBacklogItem,
} from "@/app/lib/bulkTicketOps";

type Phase = "loading" | "orphan" | "orphan-declined" | "confirm" | "running" | "done" | "error";

/** 戻す先の候補になるバックログのフォルダ一覧。BUG-01 対策で rank + id の安定ソート */
async function fetchBacklogFolders(projectId: string): Promise<DocTreeItem[]> {
  if (!isSupabaseEnabled || !projectId) return [];
  const { data, error } = await supabase!
    .from("backlog_items").select("id, parent_id, title")
    .eq("project_id", projectId).eq("is_folder", true)
    .order("rank", { ascending: true }).order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({ id: r.id as string, parentId: (r.parent_id as string | null) ?? null, title: (r.title as string) ?? "", isFolder: true }));
}

export function MoveToBacklogDialog({
  ticketIds, projectId, projectSlug, onClose, onMoved,
}: {
  ticketIds: string[];
  projectId: string;
  projectSlug?: string;
  /** ダイアログを閉じたとき（実行したかどうかに関わらず） */
  onClose: () => void;
  /** 移動が終わった直後。一覧の読み直しなどに使う */
  onMoved?: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const { userName } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [summary, setSummary] = useState<MoveToBacklogSummary | null>(null);
  const [detach, setDetach] = useState(false);
  const [moved, setMoved] = useState<MovedBacklogItem[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const runningRef = useRef(false);
  // 戻す先（null = バックログの直下）
  const [folders, setFolders] = useState<DocTreeItem[]>([]);
  const [folderError, setFolderError] = useState("");
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const creatingFolderRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      summarizeMoveToBacklog(ticketIds, projectId),
      fetchBacklogFolders(projectId).catch(e => {
        // フォルダが読めなくても直下へは戻せるので、止めずに理由だけ出す
        if (!cancelled) setFolderError(`フォルダ一覧を読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`);
        return [] as DocTreeItem[];
      }),
    ])
      .then(([s, f]) => {
        if (cancelled) return;
        setSummary(s);
        setFolders(f);
        setPhase(s.orphans.length > 0 ? "orphan" : "confirm");
      })
      .catch(e => {
        if (cancelled) return;
        setErrorMessage(String(e instanceof Error ? e.message : e));
        setPhase("error");
      });
    return () => { cancelled = true; };
  }, [ticketIds, projectId]);

  const run = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase("running");
    try {
      const result = await moveTicketsToBacklog({ ticketIds, projectId, movedBy: userName, detachOrphans: detach, folderId: targetFolderId });
      setMoved(result);
      emitLinkItemsChanged(projectId, "backlog");
      emitLinkItemsChanged(projectId, "ticket");
      setPhase("done");
      await onMoved?.();
    } catch (e) {
      setErrorMessage(String(e instanceof Error ? e.message : e));
      setPhase("error");
    } finally {
      runningRef.current = false;
    }
  };

  // いま選んでいる場所の中にフォルダを作り、作ったフォルダを選ぶ
  const createFolder = async () => {
    const title = newFolderName.trim();
    if (!title || creatingFolderRef.current) return;
    creatingFolderRef.current = true;
    setCreatingFolder(true);
    setFolderError("");
    const parentId = targetFolderId;
    try {
      const id = await createBacklogFolder({
        projectId, parentId, title,
        rank: folders.filter(f => f.parentId === parentId).length,
        createdBy: userName,
      });
      setFolders(prev => [...prev, { id, parentId, title, isFolder: true }]);
      setTargetFolderId(id);
      setAddingFolder(false);
      setNewFolderName("");
    } catch (e) {
      setFolderError(`フォルダを作成できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      creatingFolderRef.current = false;
      setCreatingFolder(false);
    }
  };

  const cancelAddFolder = () => {
    if (creatingFolderRef.current) return;
    setAddingFolder(false);
    setNewFolderName("");
  };

  const openItem = (id: string) => {
    onClose();
    if (projectSlug) navigate(`/${projectSlug}/backlog/${id}`);
  };

  const busy = phase === "running";
  const textStyle = { fontSize: 13, color: "#1A1714", margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" as const };

  if (phase === "loading") {
    return (
      <DialogShell title="バックログへ戻す" onClose={onClose} size="sm"
        footer={<BtnSecondary onClick={onClose}>キャンセル</BtnSecondary>}>
        <p style={{ ...textStyle, display: "flex", alignItems: "center", gap: 8, color: "#6B6458" }}><BtnSpinner />移すものを確認しています...</p>
      </DialogShell>
    );
  }

  if (phase === "orphan" && summary) {
    const parentList = Array.from(new Set(summary.orphans.map(o => o.parentWbs || "親チケット"))).join("、");
    return (
      <DialogShell title="バックログへ戻す" onClose={onClose} size="sm"
        footer={<>
          <BtnSecondary onClick={() => setPhase("orphan-declined")}>いいえ</BtnSecondary>
          <BtnPrimary onClick={() => { setDetach(true); setPhase("confirm"); }}>はい</BtnPrimary>
        </>}>
        <p style={textStyle}>
          {summary.orphans.length === 1
            ? `親チケット（${parentList}）から独立して、新しい親として登録しますか？`
            : `子チケット ${summary.orphans.length}件（${summary.orphans.map(o => o.wbs).join("、")}）を、親チケット（${parentList}）から独立して、新しい親として登録しますか？`}
        </p>
        <p style={{ ...textStyle, fontSize: 12, color: "#6B6458" }}>
          はいを選ぶと親との紐づけを外して単独の項目にし、本文に元の親を書き残します。
        </p>
      </DialogShell>
    );
  }

  if (phase === "orphan-declined") {
    return (
      <DialogShell title="バックログへ戻す" onClose={onClose} size="sm"
        footer={<BtnPrimary onClick={onClose}>OK</BtnPrimary>}>
        <p style={textStyle}>親チケットからバックログへ登録してください。</p>
      </DialogShell>
    );
  }

  if ((phase === "confirm" || phase === "running") && summary) {
    const strongWarn = summary.actualHours > 0 || summary.prLinkedCount > 0;
    const rows: [string, string][] = [
      ["チケット", `${summary.rootCount}件`],
      ["子チケット", `${summary.childCount}件`],
      ["コメント", `${summary.commentCount}件`],
      ["添付ファイル", `${summary.attachmentCount}件`],
      ["実績工数", `${summary.actualHours}h`],
    ];
    return (
      <DialogShell title="バックログへ戻す" onClose={busy ? () => { } : onClose} size="sm" busy={busy}
        footer={<>
          <BtnSecondary onClick={onClose} disabled={busy}>キャンセル</BtnSecondary>
          <button type="button" onClick={() => void run()} disabled={busy}
            style={{ padding: "9px 20px", background: busy ? "#9CA3AF" : (strongWarn ? "#DC2626" : "#059669"), color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: busy ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {busy && <BtnSpinner />}{busy ? "移動中..." : "バックログへ戻す"}
          </button>
        </>}>
        <p style={textStyle}>
          チケットをバックログへ移し、スプリントから外します。移動前の状態とコメントはバックログの本文の末尾に書き残し、添付ファイルもバックログへ移します。
        </p>
        <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: "8px 12px", background: "#FAFAF8" }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: "#1A1714" }}>
              <span style={{ color: "#6B6458" }}>{label}</span><span style={{ fontWeight: 700 }}>{value}</span>
            </div>
          ))}
        </div>
        {strongWarn && (
          <div style={{ display: "flex", gap: 8, padding: "10px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10 }}>
            <AlertTriangle style={{ width: 16, height: 16, color: "#DC2626", flexShrink: 0, marginTop: 1 }} />
            <p style={{ ...textStyle, fontSize: 12, color: "#991B1B" }}>
              {[
                summary.actualHours > 0 ? `実績工数（${summary.actualHours}h）が記録されています。チケットとしての実績は集計から外れ、本文に記録として残るだけになります。` : "",
                summary.prLinkedCount > 0 ? `プルリクエストが紐づいたチケットが ${summary.prLinkedCount}件 あります。紐づけは解除されます。` : "",
              ].filter(Boolean).join("\n")}
            </p>
          </div>
        )}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>戻す先</span>
            <button type="button" onClick={() => { setFolderError(""); setAddingFolder(true); }} disabled={busy || addingFolder}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", fontSize: 12, fontWeight: 600, color: busy || addingFolder ? "#B0A9A4" : "#059669", background: "none", border: "none", borderRadius: 6, cursor: busy || addingFolder ? "default" : "pointer" }}>
              <Plus style={{ width: 13, height: 13 }} />フォルダを追加
            </button>
          </div>
          <FolderPickerList
            folders={folders}
            selectedId={targetFolderId}
            onSelect={setTargetFolderId}
            rootLabel="/ バックログの直下"
            emptyText="フォルダはありません。"
            disabled={busy}
            addSlot={addingFolder ? {
              parentId: targetFolderId,
              node: (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", border: "1px dashed #10B981", borderRadius: 8, background: "#FFFFFF" }}>
                  <Folder style={{ width: 14, height: 14, color: "#F59E0B", flexShrink: 0 }} />
                  <input autoFocus value={newFolderName} disabled={creatingFolder}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={submitOnEnter(() => void createFolder(), { enabled: !!newFolderName.trim() && !creatingFolder, onCancel: cancelAddFolder })}
                    onBlur={() => { if (!newFolderName.trim()) cancelAddFolder(); }}
                    placeholder="フォルダ名を入力して Enter"
                    style={{ flex: 1, minWidth: 0, fontSize: 12, padding: "4px 0", border: "none", outline: "none", background: "transparent", color: "#1A1714" }} />
                  {creatingFolder && <BtnSpinner />}
                </div>
              ),
            } : undefined}
          />
          {folderError && <p style={{ ...textStyle, fontSize: 12, color: "#DC2626", marginTop: 6 }}>{folderError}</p>}
        </div>
        <p style={{ ...textStyle, fontSize: 12, color: "#9E9690" }}>WBS画面・リリースノート・内部リンク（#）の候補からも消えます。この操作は取り消せません。</p>
      </DialogShell>
    );
  }

  if (phase === "done") {
    const first = moved[0];
    return (
      <DialogShell title="完了" onClose={onClose} size="sm"
        footer={<BtnPrimary onClick={onClose}>OK</BtnPrimary>}>
        <p style={textStyle}>
          {moved.length <= 1
            ? `${first?.id ?? ""} としてバックログへ移動しました。`
            : `${moved.length}件をバックログへ移動しました。`}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {moved.map(m => (
            <button key={m.id} type="button" onClick={() => openItem(m.id)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#059669", fontWeight: 600, textAlign: "left" }}>
              <ClipboardList style={{ width: 13, height: 13, flexShrink: 0 }} />
              <span style={{ fontFamily: "var(--font-mono)", flexShrink: 0 }}>{m.id}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1A1714", fontWeight: 500 }}>{m.title}</span>
            </button>
          ))}
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title="バックログへ戻す" onClose={onClose} size="sm"
      footer={<BtnPrimary onClick={onClose}>閉じる</BtnPrimary>}>
      <p style={textStyle}>{`バックログへ戻せませんでした。\n\n${errorMessage}`}</p>
    </DialogShell>
  );
}
