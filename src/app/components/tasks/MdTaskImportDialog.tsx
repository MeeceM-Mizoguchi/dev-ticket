// MDファイルからタスクをまとめて作るダイアログ。
//
// チケットの「MDファイルから一括作成」（MdBulkCreateDialog）と同じ流れ:
//   画面A: MDを取り込む（複数ファイル可）＋テンプレート／AI用プロンプトのコピー
//   画面B: 読み取った内容を一覧で確認し、要らないものを外して登録
// 書式もチケットと共通（見出し=タイトル / 直後の「- キー: 値」=項目 / 残り=詳細メモ）。
//
// タスクならではの点:
//   ・ステータスは 未着手 / 進行中 / 完了 の3つ
//   ・分類は自由入力（複数可）。プロジェクトのマスタは見ない
//   ・横断ビューから開いたときは「取り込み先」（個人 / プロジェクト）をここで選ぶ
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X, FileText, Upload, Copy, Sparkles, ChevronDown, ChevronRight,
  AlertTriangle, CornerDownRight, Loader2, Plus, CheckSquare,
} from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { escStack } from "@/app/lib/escStack";
import { MD_MAX_LENGTH } from "@/app/lib/markdown";
import { mdTextToTasks, flattenTasks, countTasks } from "@/app/lib/mdTasks/parse";
import { MD_TASK_TEMPLATE, buildMdTaskPrompt } from "@/app/lib/mdTasks/template";
import type { ParsedTask, ParseWarning } from "@/app/lib/mdTasks/types";
import { insertBulkTasks, type BulkInsertTask } from "@/app/lib/bulkTaskInsert";
import { getTaskStatusMeta, getTaskPriorityMeta, type MemberOption, type ProjectOption } from "@/app/lib/taskService";
import { PickerCell, type PickerOption } from "@/app/components/tasks/TaskPickerCell";
import type { Task } from "@/app/types";

/** "2026-08-03" → "8/3" */
function shortDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${Number(m[2])}/${Number(m[3])}` : d;
}

function isMarkdownFile(file: File): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(file.name);
}

// ── バッジ ────────────────────────────────────────────────────────────────

function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "1px 6px", borderRadius: 5,
      fontSize: 10, fontWeight: 700, color, background: bg, whiteSpace: "nowrap",
    }}>{text}</span>
  );
}

function TaskBadges({ t }: { t: ParsedTask }) {
  const dateText = t.startDate && t.dueDate ? `${shortDate(t.startDate)}〜${shortDate(t.dueDate)}`
    : t.dueDate ? `〜${shortDate(t.dueDate)}`
    : t.startDate ? `${shortDate(t.startDate)}〜` : null;
  const sm = getTaskStatusMeta(t.status);
  const pm = getTaskPriorityMeta(t.priority);

  return (
    <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 4 }}>
      {t.filled.status && <Badge text={sm.label} color={sm.color} bg={sm.bg} />}
      {t.filled.priority && <Badge text={pm.label} color={pm.color} bg={pm.bg} />}
      {t.categories.map(c => <Badge key={c} text={c} color="#7C3AED" bg="#F5F3FF" />)}
      {t.assignee && <Badge text={t.assignee} color="#6B6458" bg="#F4F5F6" />}
      {dateText && <Badge text={dateText} color="#0D9488" bg="#F0FDFA" />}
      {t.descriptionExcerpt && <Badge text="詳細あり" color="#9E9690" bg="#F7F6F4" />}
    </span>
  );
}

/** 取り込み済みのMDファイル1つ分。複数ファイルをまとめて1回で登録できる。 */
interface LoadedFile {
  /** 同名ファイルを複数回取り込めるようにするための一意キー */
  key: string;
  name: string;
  tasks: ParsedTask[];
  warnings: ParseWarning[];
}

let fileKeySeq = 0;

// ── 本体 ──────────────────────────────────────────────────────────────────

export function MdTaskImportDialog({
  projectId, projectSlug, projects, members, categoryOptions, minSortOrder, onClose, onCreated,
}: {
  /** 画面のスコープ。プロジェクト配下なら固定、横断ビューなら null（ダイアログ内で選ぶ） */
  projectId: string | null;
  projectSlug?: string;
  projects: ProjectOption[];
  members: MemberOption[];
  /** 既に使われている分類。同じ綴りに寄せるために解析へ渡す */
  categoryOptions: string[];
  /** 一覧の最小 sort_order。取り込んだ分をその手前（＝先頭）に積む */
  minSortOrder: number | null;
  onClose: () => void;
  onCreated: (created: Task[]) => void;
}) {
  const { userId, userName } = useAuth();
  const { toast } = useToast();

  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [flat, setFlat] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);
  /** 取り込み先。プロジェクト配下の画面では固定、横断ビューでは選べる（"" = 個人タスク） */
  const [targetProjectId, setTargetProjectId] = useState(projectId ?? "");

  const [templateOpen, setTemplateOpen] = useState(false);
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const phase: "drop" | "review" = files.length > 0 ? "review" : "drop";

  useEffect(() => { escStack.push(onClose); return () => escStack.pop(onClose); }, [onClose]);

  const memberNames = useMemo(() => members.map(m => m.name).filter(Boolean), [members]);

  // ── 取り込み ──────────────────────────────────────────────────────────

  /** 1ファイルを解析する。読めなければ理由を返す（他のファイルの取り込みは止めない）。 */
  const parseOneFile = useCallback(async (file: File): Promise<LoadedFile | { skipped: string }> => {
    if (!isMarkdownFile(file)) {
      return { skipped: `「${file.name}」はMDファイルではありません` };
    }
    let text = "";
    try {
      text = await file.text();
    } catch {
      return { skipped: `「${file.name}」を読み込めませんでした` };
    }
    if (text.length > MD_MAX_LENGTH) {
      return { skipped: `「${file.name}」が大きすぎます（${MD_MAX_LENGTH.toLocaleString()}文字まで）` };
    }
    const result = mdTextToTasks(text, { memberNames, categoryOptions });
    if (result.tasks.length === 0) {
      return { skipped: `「${file.name}」にタスクが見つかりませんでした（見出しが必要です）` };
    }
    return { key: `f${++fileKeySeq}`, name: file.name, tasks: result.tasks, warnings: result.warnings };
  }, [memberNames, categoryOptions]);

  /** 選択・ドロップされたファイルをまとめて取り込み、既に読み込み済みのものへ追加する。 */
  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);

    const picked: File[] = Array.from(fileList);
    const results: (LoadedFile | { skipped: string })[] =
      await Promise.all(picked.map(f => parseOneFile(f)));

    const loaded: LoadedFile[] = [];
    const skipped: string[] = [];
    for (const r of results) {
      if ("skipped" in r) skipped.push(r.skipped);
      else loaded.push(r);
    }

    if (loaded.length > 0) {
      setFiles(prev => [...prev, ...loaded]);
      setWarningsOpen(false);
    }
    if (skipped.length > 0) {
      setError(skipped.join(" / "));
      // 一部だけ取り込めた場合は、成功した分があることも伝える
      if (loaded.length > 0) toast(`${loaded.length}件のファイルを取り込みました`, "info");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [parseOneFile, toast]);

  const removeFile = (key: string) => {
    setFiles(prev => prev.filter(f => f.key !== key));
    setError(null);
  };

  const resetFiles = () => {
    setFiles([]);
    setExcluded(new Set());
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── 表示用のツリー ────────────────────────────────────────────────────

  const tasks = useMemo(() => files.flatMap(f => f.tasks), [files]);
  const warnings = useMemo(() => files.flatMap(f => f.warnings), [files]);
  const hasChildren = useMemo(() => tasks.some(t => t.children.length > 0), [tasks]);
  const displayed = useMemo(() => (flat ? flattenTasks(tasks) : tasks), [tasks, flat]);

  /**
   * ファイルごとの表示単位。ファイルが1つのときはグループ見出しを出さない。
   * 連番はファイルを跨いで通しで振る（登録される順序と一致させるため）。
   */
  const groups = useMemo(() => {
    let nextNo = 1;
    return files.map(f => {
      const items = flat ? flattenTasks(f.tasks) : f.tasks;
      const startNo = nextNo;
      nextNo += items.length;
      return { file: f, items, startNo };
    });
  }, [files, flat]);

  const toggleExcluded = (t: ParsedTask) => {
    setExcluded(prev => {
      const next = new Set(prev);
      const flip = (id: string) => { next.has(id) ? next.delete(id) : next.add(id); };
      const willExclude = !next.has(t.uid);
      flip(t.uid);
      // 親を外したらサブタスクも連動して外す（親不在ではサブタスクを作れないため）。フラット時は連動しない。
      if (!flat) {
        for (const c of t.children) {
          if (willExclude) next.add(c.uid);
          else next.delete(c.uid);
        }
      }
      return next;
    });
  };

  /** 登録対象（除外を除いたもの）。親が除外されていればサブタスクも落ちる。 */
  const selected = useMemo(() => {
    const out: ParsedTask[] = [];
    for (const t of displayed) {
      if (excluded.has(t.uid)) continue;
      out.push({ ...t, children: t.children.filter(c => !excluded.has(c.uid)) });
    }
    return out;
  }, [displayed, excluded]);

  const selectedCount = countTasks(selected);

  // ── コピー ────────────────────────────────────────────────────────────

  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label}をコピーしました`);
      setManualCopyText(null);
    } catch {
      // 非セキュアコンテキスト等でクリップボードが使えない場合は手動コピーへ逃がす
      setManualCopyText(text);
      toast("自動コピーできませんでした。下のテキストを手動でコピーしてください", "error");
    }
  }, [toast]);

  const copyPrompt = () => {
    const now = new Date();
    const today = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
    void copyText(
      buildMdTaskPrompt({
        memberNames,
        categoryNames: categoryOptions,
        projectName: projects.find(p => p.id === targetProjectId)?.name,
        today,
      }),
      "AI用プロンプト",
    );
  };

  // ── 登録 ──────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (selectedCount === 0) { setError("登録するタスクが選ばれていません"); return; }
    setError(null);
    setSaving(true);

    const toInsert = (t: ParsedTask): BulkInsertTask => ({
      title: t.title,
      status: t.status,
      priority: t.priority,
      categories: t.categories,
      assignee: t.assignee,
      startDate: t.startDate,
      dueDate: t.dueDate,
      descriptionHtml: t.descriptionHtml,
      children: t.children.map(toInsert),
    });

    const result = await insertBulkTasks({
      ownerId: userId,
      createdBy: userName,
      projectId: targetProjectId || null,
      projectSlug: targetProjectId
        ? (projects.find(p => p.id === targetProjectId)?.slug || projectSlug)
        : undefined,
      members,
      minSortOrder,
      tasks: selected.map(toInsert),
    });

    setSaving(false);
    if (result.error) { setError(result.error); return; }
    onCreated(result.created);
    onClose();
  };

  // ── 描画 ──────────────────────────────────────────────────────────────

  const projectOptions: PickerOption[] = [
    { value: "", label: "個人タスク" },
    ...projects.map(p => ({ value: p.id, label: p.name })),
  ];

  const renderRow = (t: ParsedTask, index: number | null, isChild: boolean) => {
    const isExcluded = excluded.has(t.uid);
    return (
      <label
        key={t.uid}
        title={t.descriptionExcerpt ?? undefined}
        style={{
          display: "flex", alignItems: "flex-start", gap: 9,
          padding: isChild ? "7px 14px 7px 40px" : "9px 14px",
          borderBottom: "1px solid rgba(26,23,20,0.05)",
          background: isExcluded ? "#FAFAF8" : isChild ? "rgba(5,150,105,0.02)" : "#FFFFFF",
          opacity: isExcluded ? 0.45 : 1,
          cursor: "pointer", transition: "opacity 0.12s",
        }}
      >
        <input
          type="checkbox"
          checked={!isExcluded}
          onChange={() => toggleExcluded(t)}
          style={{ marginTop: 2, width: 14, height: 14, accentColor: "#059669", cursor: "pointer", flexShrink: 0 }}
        />
        {isChild
          ? <CornerDownRight style={{ width: 12, height: 12, color: "#059669", flexShrink: 0, marginTop: 2 }} />
          : <span style={{ fontSize: 11, color: "#B0A9A4", fontFamily: "var(--font-mono)", flexShrink: 0, minWidth: 18, marginTop: 1 }}>{index}</span>}
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{
            display: "block", fontSize: isChild ? 12 : 13, fontWeight: isChild ? 500 : 600, color: "#1A1714",
            lineHeight: 1.4, textDecoration: isExcluded ? "line-through" : "none",
          }}>{t.title}</span>
          <TaskBadges t={t} />
        </span>
      </label>
    );
  };

  return (
    <>
      <style>{`@keyframes md-task-spin { to { transform: rotate(360deg); } }`}</style>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(10,14,12,0.35)", backdropFilter: "blur(3px)" }} />

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }}
        onDrop={e => { e.preventDefault(); setDragOver(false); void handleFiles(e.dataTransfer.files); }}
        style={{
          position: "fixed", top: "5vh", left: "50%", transform: "translateX(-50%)",
          width: "min(94vw, 720px)", maxHeight: "90vh",
          background: "#FAFAF8", zIndex: 301, borderRadius: 16,
          boxShadow: "0 24px 80px rgba(0,0,0,0.22)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* ファイル選択（確認画面からの「ファイルを追加」でも使うので、常に描画しておく） */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".md,.markdown,.mdown,.mkd,text/markdown"
          onChange={e => void handleFiles(e.target.files)}
          style={{ display: "none" }}
        />

        {/* ヘッダー */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFFFFF", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: "#ECFDF5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <CheckSquare style={{ width: 16, height: 16, color: "#059669" }} />
            </div>
            <div>
              <p style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>MDファイルから取り込み</p>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>
                タスクの一括作成
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {phase === "drop" ? (
          /* ── 画面A: 取り込み ── */
          <div style={{ padding: 24, overflowY: "auto" }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: "100%", padding: "40px 20px", borderRadius: 14,
                border: `2px dashed ${dragOver ? "#059669" : "rgba(26,23,20,0.16)"}`,
                background: dragOver ? "#F0FDF4" : "#FFFFFF",
                cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                transition: "background 0.15s, border-color 0.15s",
              }}
            >
              <Upload style={{ width: 26, height: 26, color: dragOver ? "#059669" : "#C9C4BB" }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1714" }}>MDファイルを選択</span>
              <span style={{ fontSize: 12, color: "#9E9690" }}>クリック、またはドラッグ＆ドロップ（複数まとめて可）</span>
              <span style={{ fontSize: 10.5, color: "#C9C4BB" }}>.md / .markdown</span>
            </button>

            {error && (
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.15)", borderRadius: 9 }}>
                <AlertTriangle style={{ width: 13, height: 13, color: "#DC2626", flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, color: "#DC2626", fontWeight: 600 }}>{error}</span>
              </div>
            )}

            {/* テンプレート／プロンプト */}
            <div style={{ marginTop: 22, padding: 16, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 12 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 3 }}>AIに書いてもらう場合</p>
              <p style={{ fontSize: 11, color: "#9E9690", marginBottom: 12 }}>
                プロンプトをAIに渡し、返ってきたMarkdownを .md ファイルとして保存してから取り込みます。
                ステータス・優先度・分類・担当者・日程まで埋めるよう指示が入っています。
              </p>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void copyText(MD_TASK_TEMPLATE, "テンプレート")}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 13px", fontSize: 12, fontWeight: 600, color: "#6B6458", background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 8, cursor: "pointer" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECEAE6"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                >
                  <Copy style={{ width: 12, height: 12 }} />テンプレートをコピー
                </button>
                <button
                  type="button"
                  onClick={copyPrompt}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 13px", fontSize: 12, fontWeight: 700, color: "#FFFFFF", background: "#059669", border: "none", borderRadius: 8, cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}
                >
                  <Sparkles style={{ width: 12, height: 12 }} />AI用プロンプトをコピー
                </button>
              </div>

              {manualCopyText && (
                <textarea
                  readOnly
                  value={manualCopyText}
                  autoFocus
                  onFocus={e => e.currentTarget.select()}
                  style={{ width: "100%", height: 140, marginTop: 10, padding: 10, fontSize: 11, fontFamily: "var(--font-mono)", color: "#1A1714", background: "#F7F6F4", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 8, resize: "vertical" }}
                />
              )}

              <button
                type="button"
                onClick={() => setTemplateOpen(v => !v)}
                style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 12, padding: 0, border: "none", background: "transparent", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#6B6458" }}
              >
                {templateOpen ? <ChevronDown style={{ width: 13, height: 13 }} /> : <ChevronRight style={{ width: 13, height: 13 }} />}
                テンプレートを表示
              </button>
              {templateOpen && (
                <pre style={{
                  marginTop: 8, padding: 12, background: "#F7F6F4", border: "1px solid rgba(26,23,20,0.07)",
                  borderRadius: 9, fontSize: 11, lineHeight: 1.6, color: "#1A1714",
                  fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", maxHeight: 260, overflowY: "auto",
                }}>{MD_TASK_TEMPLATE}</pre>
              )}
            </div>
          </div>
        ) : (
          /* ── 画面B: 確認 ── */
          <>
            <div style={{ padding: "10px 24px", background: "#F8F9FA", borderBottom: "1px solid rgba(26,23,20,0.05)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <FileText style={{ width: 13, height: 13, color: "#9E9690", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {files.length === 1 ? files[0].name : `${files.length}ファイル`}
                  </span>
                  <span style={{ fontSize: 11, color: "#9E9690", flexShrink: 0 }}>／ {countTasks(tasks)}件</span>
                </div>
                {hasChildren && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: "#9E9690" }}>階層</span>
                    <div style={{ display: "flex", gap: 3, padding: 2, background: "#ECEAE6", borderRadius: 7 }}>
                      {([false, true] as const).map(v => (
                        <button
                          key={String(v)}
                          type="button"
                          onClick={() => setFlat(v)}
                          style={{
                            padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 5, border: "none", cursor: "pointer",
                            background: flat === v ? "#FFFFFF" : "transparent",
                            color: flat === v ? "#1A1714" : "#9E9690",
                            boxShadow: flat === v ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                          }}
                        >{v ? "すべて親タスク" : "サブタスクで作成"}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {warnings.length > 0 && (
                <div style={{ marginTop: 8, background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.20)", borderRadius: 8, padding: "6px 10px" }}>
                  <button
                    type="button"
                    onClick={() => setWarningsOpen(v => !v)}
                    style={{ display: "flex", alignItems: "center", gap: 5, width: "100%", padding: 0, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
                  >
                    <AlertTriangle style={{ width: 12, height: 12, color: "#D97706", flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: "#B45309", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {warningsOpen ? `読み取れなかった項目が ${warnings.length} 件あります` : warnings[0].message}
                    </span>
                    <span style={{ fontSize: 10.5, color: "#B45309", fontWeight: 600, flexShrink: 0 }}>
                      {warningsOpen ? "閉じる" : `全${warnings.length}件`}
                    </span>
                  </button>
                  {warningsOpen && (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18, maxHeight: 96, overflowY: "auto" }}>
                      {warnings.map((w, i) => (
                        <li key={i} style={{ fontSize: 11, color: "#B45309", lineHeight: 1.6 }}>
                          {w.ticketTitle ? `「${w.ticketTitle}」: ` : ""}{w.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div style={{ flex: 1, overflowY: "auto", background: "#FFFFFF", minHeight: 120 }}>
              {groups.map(({ file, items, startNo }) => (
                <div key={file.key}>
                  {/* 複数ファイルのときだけ、どのファイル由来かが分かるよう見出しを出す */}
                  {files.length > 1 && (
                    <div style={{
                      position: "sticky", top: 0, zIndex: 1,
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 14px", background: "#F4F5F6",
                      borderBottom: "1px solid rgba(26,23,20,0.06)",
                    }}>
                      <FileText style={{ width: 11, height: 11, color: "#9E9690", flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
                        {file.name}
                      </span>
                      <span style={{ fontSize: 10.5, color: "#9E9690", flexShrink: 0 }}>{countTasks(file.tasks)}件</span>
                      <button
                        type="button"
                        title="このファイルを取り込みから外す"
                        onClick={() => removeFile(file.key)}
                        style={{ padding: 2, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4", display: "flex", flexShrink: 0 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}
                      >
                        <X style={{ width: 12, height: 12 }} />
                      </button>
                    </div>
                  )}
                  {items.map((t, i) => (
                    <div key={t.uid}>
                      {renderRow(t, startNo + i, false)}
                      {t.children.map(c => renderRow(c, null, true))}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {error && (
              <div style={{ flexShrink: 0, borderTop: "1px solid rgba(220,38,38,0.15)", background: "#FEF2F2", padding: "8px 24px", display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle style={{ width: 13, height: 13, color: "#DC2626", flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, color: "#DC2626", fontWeight: 600 }}>{error}</span>
              </div>
            )}

            <div style={{ padding: "12px 24px", background: "#FFFFFF", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, borderTop: "1px solid rgba(26,23,20,0.07)", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.20)", borderRadius: 9, cursor: saving ? "not-allowed" : "pointer" }}
                >
                  <Plus style={{ width: 12, height: 12 }} />ファイルを追加
                </button>
                <button
                  onClick={resetFiles}
                  disabled={saving}
                  style={{ padding: "8px 14px", fontSize: 12.5, fontWeight: 600, color: "#6B6458", background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, cursor: saving ? "not-allowed" : "pointer" }}
                >
                  選び直す
                </button>
                {/* 横断ビューから開いたときだけ、取り込み先をここで決める */}
                {!projectId && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: "#9E9690" }}>取り込み先</span>
                    <PickerCell variant="chip" width={150} value={targetProjectId} title="取り込み先"
                      options={projectOptions} placeholder="個人タスク" disabled={saving}
                      onChange={setTargetProjectId} />
                  </span>
                )}
              </div>
              <button
                onClick={handleCreate}
                disabled={saving || selectedCount === 0}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 22px", fontSize: 13, fontWeight: 700, color: "#FFF",
                  background: (saving || selectedCount === 0) ? "#9CA3AF" : "#059669",
                  border: "none", borderRadius: 9,
                  cursor: (saving || selectedCount === 0) ? "not-allowed" : "pointer",
                  boxShadow: (saving || selectedCount === 0) ? "none" : "0 2px 8px rgba(5,150,105,0.25)",
                }}
              >
                {saving && <Loader2 style={{ width: 13, height: 13, animation: "md-task-spin 1s linear infinite" }} />}
                {saving ? "作成中..." : `タスクにする (${selectedCount}件)`}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
