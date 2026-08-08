// ナレッジノート: Wiki から資料を取り込むダイアログ（BRU10-060）。
//
// 左に Wiki のツリー（チェックで選択）、右に中身のビュワーを出す。
// ビュワーが出しているのは「Wiki の見た目」ではなく **取り込んだあとの姿** で、
// Wiki の本文(TipTap の HTML)を Markdown に変換したものを描いている。
// ナレッジノートは Markdown を前提に「見出しで分割 → 検索 → 節を辿って読む」を
// 組んでいるため、取り込み前に落ちる書式が無いかをここで確認できるようにしている。

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Loader2, Search, X, CheckCircle2,
} from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { htmlDocToMarkdown, markdownFileToHtml } from "@/app/lib/markdown";
import type { KnowledgeFolder } from "@/app/types";
import type { WikiImportInput } from "@/app/lib/knowledge/knowledgeService";

/** ツリーに要る分だけ。本文は変換のためにここでも持つ */
interface WikiRow {
  id: string;
  title: string;
  parentId: string | null;
  isFolder: boolean;
  sortOrder: number;
  content: string;
}

interface TreeNode extends WikiRow {
  children: TreeNode[];
  depth: number;
}

/**
 * 取り込んだあとの Markdown を作る。
 *
 * 先頭に記事名の見出しを足しているのは、ナレッジノートの目次が
 * 「本文中の見出し」だけで作られるため。Wiki の本文は h2 から始まることが多く、
 * そのままだと資料全体を指す見出しが無くなる。
 *
 * empty は「見出しを足す前の本文が空だったか」。HTML としては `<p></p>` が入っていて
 * 空に見えない記事があるので、取り込めるかどうかはこちらで判定する。
 */
export function wikiPageToMarkdown(page: { title: string; content: string }): { markdown: string; empty: boolean } {
  const body = htmlDocToMarkdown(page.content).trim();
  const head = `# ${page.title.trim() || "無題"}`;
  if (!body) return { markdown: `${head}\n`, empty: true };
  const first = body.split("\n", 1)[0].trim();
  return { markdown: first === head ? `${body}\n` : `${head}\n\n${body}\n`, empty: false };
}

function buildTree(rows: WikiRow[]): TreeNode[] {
  const byParent = new Map<string | null, WikiRow[]>();
  rows.forEach(r => {
    const key = r.parentId && rows.some(x => x.id === r.parentId) ? r.parentId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(r);
  });
  const sortFn = (a: WikiRow, b: WikiRow) =>
    a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "ja");
  const walk = (parentId: string | null, depth: number): TreeNode[] =>
    (byParent.get(parentId) ?? []).slice().sort(sortFn)
      .map(r => ({ ...r, depth, children: walk(r.id, depth + 1) }));
  return walk(null, 0);
}

/** ノード配下（自分含む）の記事だけを平らにする */
function pagesUnder(node: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    if (!n.isFolder) out.push(n);
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/** 変換後の Markdown をそのまま描く。ホワイトボードの図は本文に出せないのでコードとして見せる */
function MarkdownPreview({ markdown }: { markdown: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    const raw = markdownFileToHtml(markdown) ?? "";
    return raw.replace(
      /<div data-type="mermaid"[^>]*data-code="([^"]*)"[^>]*><\/div>/g,
      (_m, code) => `<pre><code>${code}</code></pre>`,
    );
  }, [markdown]);

  useEffect(() => {
    const el = ref.current;
    if (el) el.innerHTML = html;
  }, [html]);

  return <div ref={ref} className="kn-body" />;
}

export function WikiImportDialog({
  projectId, folders, defaultFolderId, importedPageIds, busy, onClose, onSubmit,
}: {
  projectId: string;
  folders: KnowledgeFolder[];
  defaultFolderId: string | null;
  /** 既に取り込み済みの Wiki ページID。選ぶと上書き更新になることを示す */
  importedPageIds: Set<string>;
  busy: boolean;
  onClose: () => void;
  onSubmit: (pages: WikiImportInput[], folderId: string | null) => Promise<void>;
}) {
  const [rows, setRows] = useState<WikiRow[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [viewMode, setViewMode] = useState<"preview" | "markdown">("preview");
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isSupabaseEnabled || !supabase) { setError("Supabase が未設定です"); setRows([]); return; }
      const { data, error: e } = await supabase
        .from("wiki_pages")
        .select("id, title, parent_id, is_folder, sort_order, content")
        .eq("project_id", projectId)
        .order("sort_order");
      if (!alive) return;
      if (e) { setError(e.message); setRows([]); return; }
      setRows((data ?? []).map((r: any) => ({
        id: r.id,
        title: r.title || "",
        parentId: r.parent_id ?? null,
        isFolder: !!r.is_folder,
        sortOrder: r.sort_order ?? 0,
        content: r.content ?? "",
      })));
    })();
    return () => { alive = false; };
  }, [projectId]);

  const tree = useMemo(() => buildTree(rows ?? []), [rows]);
  const pages = useMemo(() => (rows ?? []).filter(r => !r.isFolder), [rows]);

  /**
   * 記事ID → 取り込んだあとの Markdown。
   *
   * 一度だけ作って使い回す。変換は DOMParser を通すので、
   * 描画のたびに走らせるとツリーの操作が重くなる。
   * 「取り込めるか（＝中身が空でないか）」の判定もこの結果で行う。
   * 本文が `<p></p>` だけの記事は HTML としては空ではないが Markdown にすると空になる。
   */
  const converted = useMemo(() => {
    const map = new Map<string, { markdown: string; empty: boolean }>();
    pages.forEach(p => map.set(p.id, wikiPageToMarkdown(p)));
    return map;
  }, [pages]);
  const hasBody = (id: string) => !(converted.get(id)?.empty ?? true);

  /** 検索中はツリーをたたまず、一致した記事だけを平らに並べる */
  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return null;
    return pages.filter(p => p.title.toLowerCase().includes(q));
  }, [keyword, pages]);

  const focused = useMemo(
    () => pages.find(p => p.id === focusedId) ?? null,
    [pages, focusedId],
  );
  const focusedMarkdown = focused ? converted.get(focused.id)?.markdown ?? "" : "";
  const focusedEmpty = focused ? converted.get(focused.id)?.empty ?? true : true;

  /** 記事は自分1件、フォルダは配下をまとめて切り替える（どちらも同じ経路） */
  const toggleMany = (ids: string[], on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const selectedPages = useMemo(
    () => pages.filter(p => selected.has(p.id)),
    [pages, selected],
  );
  const updateCount = selectedPages.filter(p => importedPageIds.has(p.id)).length;

  const submit = async () => {
    if (selectedPages.length === 0) return;
    await onSubmit(
      selectedPages.map(p => ({
        pageId: p.id,
        title: p.title.trim() || "無題",
        markdown: converted.get(p.id)?.markdown ?? "",
      })),
      folderId,
    );
  };

  const renderRow = (node: TreeNode) => {
    const under = pagesUnder(node);
    const selectable = under.filter(p => hasBody(p.id));
    const allOn = selectable.length > 0 && selectable.every(p => selected.has(p.id));
    const someOn = selectable.some(p => selected.has(p.id));
    const isOpen = !collapsed.has(node.id);
    const empty = !node.isFolder && !hasBody(node.id);
    const imported = importedPageIds.has(node.id);

    return (
      <div key={node.id}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 6px", paddingLeft: 6 + node.depth * 14,
            borderRadius: 7,
            background: focusedId === node.id ? "rgba(5,150,105,0.08)" : "transparent",
          }}
        >
          <input
            type="checkbox"
            checked={allOn}
            disabled={selectable.length === 0}
            ref={el => { if (el) el.indeterminate = !allOn && someOn; }}
            onChange={() => toggleMany(selectable.map(p => p.id), !allOn)}
            title={node.isFolder ? "配下の記事をまとめて選ぶ" : empty ? "本文が空です" : "この記事を取り込む"}
            style={{ accentColor: "#059669", cursor: selectable.length === 0 ? "default" : "pointer", flexShrink: 0 }}
          />
          {/* 記事も子を持てる（Wiki は folder / page どちらにもぶら下がる）ので折りたたみは両方に出す */}
          {node.children.length > 0 ? (
            <button
              onClick={() => setCollapsed(prev => {
                const n = new Set(prev); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n;
              })}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", color: "#A09790", flexShrink: 0 }}
            >
              {isOpen ? <ChevronDown style={{ width: 12, height: 12 }} /> : <ChevronRight style={{ width: 12, height: 12 }} />}
            </button>
          ) : (
            <span style={{ width: 12, flexShrink: 0 }} />
          )}
          <button
            onClick={() => { if (!node.isFolder) setFocusedId(node.id); }}
            disabled={node.isFolder}
            style={{
              flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 5,
              background: "none", border: "none", padding: 0, textAlign: "left",
              cursor: node.isFolder ? "default" : "pointer",
            }}
          >
            {node.isFolder
              ? (isOpen ? <FolderOpen style={{ width: 12, height: 12, color: "#D97706", flexShrink: 0 }} />
                : <Folder style={{ width: 12, height: 12, color: "#D97706", flexShrink: 0 }} />)
              : <FileText style={{ width: 12, height: 12, color: "#A09790", flexShrink: 0 }} />}
            <span style={{
              fontSize: 12, color: empty ? "#C4BDB6" : "#1A1714", fontWeight: node.isFolder ? 700 : 500,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {node.title.trim() || "無題"}
            </span>
            {imported && (
              <span title="取り込み済み。選ぶと最新の内容で更新します"
                style={{ fontSize: 9.5, color: "#047857", background: "rgba(5,150,105,0.10)", borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>
                取込済
              </span>
            )}
          </button>
        </div>
        {isOpen && node.children.map(renderRow)}
      </div>
    );
  };

  const body = (() => {
    if (rows === null) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 300, color: "#C4BDB6", fontSize: 12.5 }}>
          <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />Wiki を読み込み中...
        </div>
      );
    }
    if (error) {
      return <div style={{ padding: 20, fontSize: 12.5, color: "#DC2626" }}>Wiki を読み込めませんでした（{error}）</div>;
    }
    if (pages.length === 0) {
      return (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#A09790" }}>
          <BookOpen style={{ width: 22, height: 22, marginBottom: 10 }} />
          <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
            取り込める Wiki 記事がありません。<br />先に Wiki で記事を作成してください。
          </div>
        </div>
      );
    }

    return (
      <div style={{ display: "flex", gap: 12, height: 420 }}>
        {/* ── Wiki のツリー ── */}
        <div style={{ width: 296, flexShrink: 0, border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: 8, borderBottom: "1px solid rgba(26,23,20,0.06)", display: "flex", alignItems: "center", gap: 6 }}>
            <Search style={{ width: 12, height: 12, color: "#C4BDB6", flexShrink: 0 }} />
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="記事名で絞り込む"
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", fontSize: 12, background: "transparent", color: "#1A1714" }}
            />
            {keyword && (
              <button onClick={() => setKeyword("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDB6", padding: 0, display: "flex" }}>
                <X style={{ width: 12, height: 12 }} />
              </button>
            )}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
            {filtered
              ? (filtered.length === 0
                ? <div style={{ padding: "20px 8px", fontSize: 12, color: "#C4BDB6", textAlign: "center" }}>一致する記事がありません</div>
                : filtered.map(p => renderRow({ ...p, children: [], depth: 0 })))
              : tree.map(renderRow)}
          </div>
          <div style={{ padding: "7px 10px", borderTop: "1px solid rgba(26,23,20,0.06)", fontSize: 10.5, color: "#B0A9A4" }}>
            {selectedPages.length} 件を選択中
          </div>
        </div>

        {/* ── ビュワー（取り込んだあとの姿） ── */}
        <div style={{ flex: 1, minWidth: 0, border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(26,23,20,0.06)", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {focused ? focused.title.trim() || "無題" : "記事を選ぶと中身が出ます"}
            </span>
            {focused && (
              <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                {(["preview", "markdown"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setViewMode(m)}
                    style={{
                      padding: "3px 9px", fontSize: 11, borderRadius: 6, cursor: "pointer",
                      border: "1px solid rgba(26,23,20,0.12)",
                      background: viewMode === m ? "#059669" : "#fff",
                      color: viewMode === m ? "#fff" : "#6B6458",
                      fontWeight: viewMode === m ? 700 : 500,
                    }}
                  >
                    {m === "preview" ? "プレビュー" : "Markdown"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
            {!focused ? (
              <div style={{ textAlign: "center", padding: "70px 20px", color: "#C4BDB6" }}>
                <BookOpen style={{ width: 20, height: 20, marginBottom: 8 }} />
                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                  左の一覧から記事名を押すと、<br />取り込んだあとの中身を確認できます。
                </div>
              </div>
            ) : focusedEmpty ? (
              <div style={{ fontSize: 12.5, color: "#A09790" }}>本文がありません。この記事は取り込めません。</div>
            ) : viewMode === "preview" ? (
              <MarkdownPreview markdown={focusedMarkdown} />
            ) : (
              <pre style={{ margin: 0, fontSize: 11.5, lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#1A1714" }}>
                {focusedMarkdown}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  })();

  return (
    <DialogShell
      title="Wiki から資料を追加"
      size="xl"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
          <label
            title="新しく取り込む記事の置き場所です。取り込み済みの記事を更新するときは、いまのフォルダのままにします"
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#6B6458" }}
          >
            取り込み先
            <select
              value={folderId ?? ""}
              onChange={e => setFolderId(e.target.value || null)}
              style={{ fontSize: 12, padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(26,23,20,0.12)", background: "#fff", color: "#1A1714", maxWidth: 180 }}
            >
              <option value="">未分類</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          {updateCount > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#047857" }}>
              <CheckCircle2 style={{ width: 12, height: 12 }} />
              うち {updateCount} 件は取り込み済みのため更新します
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <BtnSecondary onClick={onClose} disabled={busy}>キャンセル</BtnSecondary>
            <BtnPrimary onClick={() => void submit()} disabled={busy || selectedPages.length === 0}>
              {busy ? "取り込み中..." : `${selectedPages.length} 件を取り込む`}
            </BtnPrimary>
          </div>
        </div>
      }
    >
      {body}
    </DialogShell>
  );
}
