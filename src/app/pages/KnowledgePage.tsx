// ナレッジノート（KN-01〜03）
//
// 3ペイン: フォルダ／資料 ── 目次 ── 本文
//
// 設計の要点は「AIに答えさせない」こと。
// 対話で答えを返す方式は実データで破綻した（表とSQLが主体の資料では
// 抜き出した文が答えにならず、類似度のしきい値も機能しなかった）。
// 代わりに **見出しを機械的に辿るブラウズ操作** を主にしている。
//   ・見出しは Markdown から直接拾うので、押せば必ずその節が出る（しきい値に依存しない）
//   ・検索は補助。結果は「該当箇所」であって回答ではない
//
// 詳細は docs/knowledge-ai-design.md。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router";
import {
  BookOpen, Upload, Download, Trash2, Loader2, Search, X, FolderPlus, Folder, FolderOpen, FolderKanban,
  FileText, ChevronRight, ChevronDown, ChevronLeft, AlertTriangle, CheckCircle2, RefreshCw, Pencil, Save,
} from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { useToast } from "@/app/contexts/ToastContext";
import { mapProject } from "@/app/lib/mappers";
import type {
  Project, KnowledgeDocument, KnowledgeFolder, KnowledgeSearchHit, KnowledgeImportProgress,
  AccessLevel, UserPermissions,
} from "@/app/types";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { FolderNameDialog } from "@/app/components/knowledge/FolderNameDialog";
import { WikiImportDialog } from "@/app/components/knowledge/WikiImportDialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/app/components/ui/dropdown-menu";
import { markdownFileToHtml } from "@/app/lib/markdown";
import {
  listDocuments, getDocument, importFile, deleteDocument, indexDocument, search,
  listFolders, createFolder, renameFolder, deleteFolder, moveDocument,
  isKnowledgeFile, isSetupMissingError, downloadFileName, importWikiPage,
  KNOWLEDGE_FILE_ACCEPT, KNOWLEDGE_FILE_MAX_BYTES, updateDocumentContent,
  type WikiImportInput,
} from "@/app/lib/knowledge/knowledgeService";
import { downloadBlob } from "@/app/lib/articleExport/download";
import { warmup, onModelDownload, getUnavailableReason } from "@/app/lib/knowledge/embed";
import { outlineFromMarkdown, flattenOutline, resolveSection, type OutlineNode } from "@/app/lib/knowledge/outline";
import { submitOnModEnter } from "@/app/lib/submitKey";

const PHASE_LABEL: Record<KnowledgeImportProgress["phase"], string> = {
  reading: "読み込み中", chunking: "分割中", saving: "保存中",
  modelLoading: "検索用の準備中", embedding: "索引を作成中", done: "完了", error: "エラー",
};

const UNFILED = "__unfiled__";
/** ページ下端の余白。3ペインの高さ計算に使う */
const PAGE_BOTTOM_PADDING = 24;
/** これ以上は縮めない（極端に低いウィンドウで潰れないように） */
const MIN_ROW_HEIGHT = 240;

/**
 * 意味検索の絞り込み（相対しきい値）。
 *
 * e5 の余弦類似度は値域が圧縮されていて、無関係な日本語同士でも 0.70〜0.78 が出る。
 * そのため「0.78以上」のような絶対値で切っても実質何も切れず、
 * 全チャンクが関連ありになって本文が丸ごと塗られてしまった（実際に発生）。
 * クエリごとに最高スコアが変わるので、最高点からの差で切る。
 */
const SEMANTIC_MARGIN = 0.03;
/** 本文に帯を付ける節の上限。多すぎると「どこが関連か」が分からなくなる */
const MAX_BANDED_SECTIONS = 6;

/**
 * 検索結果カードの抜粋を作る。
 *
 * 断片の先頭をそのまま出すと、表の区切り行やコードフェンスの記号が並んで
 * 「何も見つかっていない」ように見える（実際にそう見えていた）。
 * 読める行だけを拾い、表はセルを「/」でつないで文にする。
 */
function previewOf(content: string, max = 150): string {
  const kept: string[] = [];
  const codeLines: string[] = [];
  let inFence = false;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) { if (line) codeLines.push(line); continue; }  // コードは散文が無いときだけ使う
    if (!line) continue;
    if (/^\|?\s*:?-{2,}/.test(line)) continue;    // 表の区切り行
    if (/^#{1,6}\s/.test(line)) continue;         // 見出しはパンくずに出ている
    if (/^\|/.test(line)) {
      const cells = line.split("|").map(c => c.trim()).filter(Boolean);
      if (cells.length > 0) kept.push(cells.join(" / "));
      continue;
    }
    kept.push(line.replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
    if (kept.join(" ").length > max) break;
  }
  const text = kept.join(" ").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  // 散文が無い断片（SQL定義だけ等）はコードの中身を出す。生の Markdown よりは読める
  const body = text || codeLines.join(" ").replace(/\s+/g, " ").trim();
  if (!body) return "（コードのみ）";
  return body.length > max ? `${body.slice(0, max)}…` : body;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 描画済みDOMの中から語を探して <mark> で囲み、付けたマークを返す */
function highlightInDom(root: HTMLElement, needle: string): HTMLElement[] {
  const q = needle.trim();
  if (!q) return [];
  const marks: HTMLElement[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if ((node.textContent ?? "").toLowerCase().includes(q.toLowerCase())) targets.push(node as Text);
  }
  for (const text of targets.slice(0, 400)) {
    const value = text.textContent ?? "";
    const frag = document.createDocumentFragment();
    let from = 0;
    for (; ;) {
      const at = value.toLowerCase().indexOf(q.toLowerCase(), from);
      if (at < 0) break;
      if (at > from) frag.appendChild(document.createTextNode(value.slice(from, at)));
      const mark = document.createElement("mark");
      mark.className = "kn-hit";
      mark.textContent = value.slice(at, at + q.length);
      frag.appendChild(mark);
      marks.push(mark);
      from = at + q.length;
    }
    if (from === 0) continue;
    if (from < value.length) frag.appendChild(document.createTextNode(value.slice(from)));
    text.parentNode?.replaceChild(frag, text);
  }
  return marks;
}

/**
 * 節の本文を Markdown として描画する。表は表、SQL はコードとして読める形にする。
 *
 * innerHTML を effect の中で自前で入れているのは、描画後に語をハイライトするため。
 * dangerouslySetInnerHTML だと再実行のたびに <mark> が二重に入る危険がある。
 */
function Body({
  markdown, highlight, onHeadings, anchorIndex, anchorMode, scrollNonce, relatedSections,
}: {
  markdown: string;
  highlight?: string;
  /**
   * 意味検索が「関連あり」と判定した見出しの範囲。
   * 文字列一致ではないので、検索語が1度も出てこない節にも帯が付く。
   * { index: 見出しの文書順の添字, level: 見出しレベル }
   */
  relatedSections?: { index: number; level: number }[];
  /** 描画後の見出し要素（文書順）。目次からのスクロールに使う */
  onHeadings?: (els: HTMLElement[]) => void;
  /** 検索ヒットが属する見出しの添字。着地はこの節の中に限る */
  anchorIndex?: number;
  /** "word" = 節の中の語の位置へ / "section" = 節の頭へ */
  anchorMode?: "word" | "section";
  /** 同じ語・同じ見出しでも再スクロールさせるための連番 */
  scrollNonce?: number;
}) {
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
    if (!el) return;
    el.innerHTML = html;
    // 見出し要素は文書順に並ぶ。outlineFromMarkdown も同じ順で拾うので添字で対応づけできる
    const headings = Array.from(el.querySelectorAll("h1,h2,h3,h4,h5,h6")) as HTMLElement[];
    onHeadings?.(headings);

    // 意味的に関連する節に帯を付ける。見出しから、次の「同じか浅い見出し」の
    // 直前までの兄弟要素をまとめて塗る。
    for (const sec of relatedSections ?? []) {
      const head = headings[sec.index];
      if (!head) continue;
      head.classList.add("kn-related", "kn-related-head");
      let cur = head.nextElementSibling;
      while (cur) {
        const m = cur.tagName.match(/^H([1-6])$/);
        if (m && Number(m[1]) <= sec.level) break;
        cur.classList.add("kn-related");
        cur = cur.nextElementSibling;
      }
    }

    // 黄色マークは「その語がそのまま書かれている場所」を示すだけのもので、
    // ヒットの理由とは別物。意味検索の着地点をこれで決めてはいけない。
    const marks = highlight ? highlightInDom(el, highlight) : [];
    const anchor = typeof anchorIndex === "number" ? headings[anchorIndex] : undefined;

    // ヒットした節の範囲（次の「同じか浅い見出し」の手前まで）に閉じ込める。
    // これを外すと、節の中に語が無いときに文書のずっと後ろの
    // 「たまたま同じ語が出てくる無関係な箇所」へ飛んでしまう（実際に起きた）。
    const inAnchorSection = (m: HTMLElement) => {
      if (!anchor) return true;
      if ((anchor.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) return false;
      const level = Number(anchor.tagName[1]);
      for (const h of headings) {
        if ((anchor.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) continue;
        if (Number(h.tagName[1]) > level) continue;
        // 節の終わり。ここより前なら節の中
        return (h.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
      }
      return true;
    };

    // 語句で探したときは語の位置へ、意味で探したときは節の頭へ。
    // 意味のヒットで語の位置へ飛ばすと、「語句検索と何が違うのか」が
    // 分からない画面になる。
    const wordTarget = marks.find(inAnchorSection);
    const target = anchorMode === "word"
      ? wordTarget ?? anchor ?? marks[0]
      : anchor ?? wordTarget;
    if (!target) return;
    target.scrollIntoView({ block: target === anchor ? "start" : "center", behavior: "smooth" });
  }, [html, highlight, onHeadings, anchorIndex, anchorMode, scrollNonce, relatedSections]);

  if (!markdown.trim()) {
    return <div style={{ fontSize: 12.5, color: "#A09790" }}>本文がありません。</div>;
  }
  return <div ref={ref} className="kn-body" />;
}

export function KnowledgePage() {
  const { projectSlug, docId: routeDocId } = useParams<{ projectSlug: string; docId?: string }>();
  const navigate = useNavigate();
  const { userName, userRole, userId } = useAuth();
  const { plan, isLimitReached } = usePlan();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [folders, setFolders] = useState<KnowledgeFolder[]>([]);
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);

  // サブナビに出す他ページの権限。ナレッジノート自身はプロジェクトメンバーなら使える
  const [effectiveWikiPerm, setEffectiveWikiPerm] = useState<AccessLevel>("edit");
  const [effectiveBacklogPerm, setEffectiveBacklogPerm] = useState<AccessLevel>("edit");
  const [effectiveMinutesPerm, setEffectiveMinutesPerm] = useState<AccessLevel>("edit");
  const [effectiveWhiteboardPerm, setEffectiveWhiteboardPerm] = useState<AccessLevel>("edit");
  const isAdminRole = userRole === "owner" || userRole === "admin";

  // 開いている資料と、その目次・選択中の節
  const [openDoc, setOpenDoc] = useState<KnowledgeDocument | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 検索対象（チェック）。フォルダのチェックは配下の資料をまとめて切り替える
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  // 意味検索が実際に効いたか。false ならキーワードのみで実行された
  const [semantic, setSemantic] = useState(true);
  // 検索結果のタブ。意味で近いもの / 語句が一致するもの を分けて見せる
  const [resultTab, setResultTab] = useState<"semantic" | "keyword">("semantic");
  const [searchNote, setSearchNote] = useState<string | undefined>();
  // 検索結果からジャンプして本文を見ている状態。true の間は結果一覧ではなく本文を出す
  const [viewingBody, setViewingBody] = useState(false);
  // 本文内で強調する語（検索語）
  const [highlightWord, setHighlightWord] = useState("");
  // 検索ヒットが属する見出しの添字と、再スクロール用の連番
  const [jumpAnchor, setJumpAnchor] = useState<{ index: number; nonce: number; mode: "word" | "section" } | null>(null);

  const [progress, setProgress] = useState<KnowledgeImportProgress | null>(null);
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  // 複数資料をまとめて索引するときの進み具合（何件目か）
  const [indexBatch, setIndexBatch] = useState<{ done: number; total: number } | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [deleteDocTarget, setDeleteDocTarget] = useState<KnowledgeDocument | null>(null);
  // ダウンロード中の資料ID。本文を持っていない行は取得に一瞬かかるので、その間だけ印を出す
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<KnowledgeFolder | null>(null);
  const [importTargetFolder, setImportTargetFolder] = useState<string | null>(null);
  // フォルダ名の入力ダイアログ。null = 閉じている
  const [folderDialog, setFolderDialog] = useState<{ mode: "create" | "rename"; target?: KnowledgeFolder } | null>(null);
  // Wiki から取り込むダイアログ。null = 閉じている（開くときの取り込み先フォルダを持つ）
  const [wikiDialog, setWikiDialog] = useState<{ folderId: string | null } | null>(null);
  const [wikiImporting, setWikiImporting] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // 本文中の見出し要素（文書順）。目次のクリックでここへスクロールする
  const headingElsRef = useRef<HTMLElement[]>([]);
  // 検索結果一覧のスクロール位置。本文と同じ領域を使い回しているため、
  // 覚えておかないと本文のスクロール位置が一覧に引き継がれてしまう
  const resultsScrollRef = useRef(0);
  // すでに一覧に出ていた資料のID。新規追加を判定してチェックを自動で入れるために持つ
  const knownDocIdsRef = useRef<Set<string>>(new Set());
  const [rowHeight, setRowHeight] = useState(MIN_ROW_HEIGHT);

  // 一覧へ戻ったら、本文のスクロール位置ではなく一覧の位置に戻す
  useLayoutEffect(() => {
    if (viewingBody) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = hits !== null ? resultsScrollRef.current : 0;
  }, [viewingBody, hits]);

  const handleHeadings = useCallback((els: HTMLElement[]) => {
    headingElsRef.current = els;
  }, []);

  /** 目次の見出し → 本文中の同じ見出しへスクロールする */
  const scrollToNode = useCallback((nodeId: string) => {
    const idx = flatOutlineRef.current.findIndex(n => n.id === nodeId);
    const el = idx >= 0 ? headingElsRef.current[idx] : undefined;
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    else bodyRef.current?.scrollTo({ top: 0 });
  }, []);

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    const { data } = await supabase!.from("projects").select("*").eq("slug", projectSlug).limit(1);
    if (!data || data.length === 0) { setNotFound(true); setLoading(false); return; }
    const p = mapProject(data[0]);
    setProject(p);

    // サブナビの中身を他画面と揃える。権限が無いページはここでも出さない
    if (isAdminRole) {
      setEffectiveWikiPerm("edit"); setEffectiveBacklogPerm("edit");
      setEffectiveMinutesPerm("edit"); setEffectiveWhiteboardPerm("edit");
    } else {
      const { data: permRow } = await supabase!.from("project_member_permissions")
        .select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle();
      const perms = permRow?.permissions as Partial<UserPermissions> | null;
      setEffectiveWikiPerm((perms?.wikiPermission as AccessLevel | undefined) ?? "none");
      setEffectiveBacklogPerm((perms?.backlogPermission as AccessLevel | undefined) ?? "none");
      setEffectiveMinutesPerm((perms?.minutesPermission as AccessLevel | undefined) ?? "none");
      setEffectiveWhiteboardPerm((perms?.whiteboardPermission as AccessLevel | undefined) ?? "none");
    }

    try {
      const [ds, fs] = await Promise.all([listDocuments(p.id), listFolders(p.id)]);
      setDocs(ds);
      setFolders(fs);
      // 新しく追加された資料は自動でチェックを入れる。
      //   以前は「初回だけ全部チェック」だったため、あとから追加した資料が
      //   検索対象に入らず「増やしたのに結果が変わらない」という状態になっていた。
      setChecked(prev => {
        const ids = new Set(ds.map(d => d.id));
        const next = new Set<string>();
        ds.forEach(d => {
          const isNew = !knownDocIdsRef.current.has(d.id);
          if (isNew || prev.has(d.id)) next.add(d.id);
        });
        knownDocIdsRef.current = ids;
        return next;
      });
      setSetupRequired(false);
    } catch (e) {
      if (isSetupMissingError(e)) setSetupRequired(true);
      else toast(e instanceof Error ? e.message : "資料の取得に失敗しました", "error");
    }
    setLoading(false);
  }, [projectSlug, toast, userId, isAdminRole]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    warmup();
    return onModelDownload((_f, p) => setModelProgress(p));
  }, []);

  // URL の :docId に対応する資料を開く
  useEffect(() => {
    if (!routeDocId) { setOpenDoc(null); return; }
    let alive = true;
    void (async () => {
      try {
        const d = await getDocument(routeDocId);
        if (!alive) return;
        setOpenDoc(d);
        setSelectedNodeId(null);
        setIsEditing(false);
      } catch (e) {
        if (!alive) return;
        if (isSetupMissingError(e)) setSetupRequired(true);
        else toast(e instanceof Error ? e.message : "資料を開けませんでした", "error");
      }
    })();
    return () => { alive = false; };
  }, [routeDocId, toast]);

  // チェックは「検索の対象にするか」で、資料を開く操作ではない。
  // そのため全部チェックが入っていても、資料名を押すまで目次も本文も空のままだった。
  // 何も開いていなければ先頭の資料を開いておく（履歴は汚さない）。
  useEffect(() => {
    if (loading || routeDocId || docs.length === 0) return;
    navigate(`/${projectSlug}/knowledge/${docs[0].id}`, { replace: true });
  }, [loading, routeDocId, docs, projectSlug, navigate]);

  const outline = useMemo(
    () => (openDoc ? outlineFromMarkdown(openDoc.content) : []),
    [openDoc],
  );
  const flatOutline = useMemo(() => flattenOutline(outline), [outline]);
  const flatOutlineRef = useRef<OutlineNode[]>([]);
  flatOutlineRef.current = flatOutline;

  // 初期選択: 最初の見出し。ルートが1つだけならその直下を開いておく
  useEffect(() => {
    if (!openDoc || flatOutline.length === 0) return;
    if (selectedNodeId && flatOutline.some(n => n.id === selectedNodeId)) return;
    setSelectedNodeId(flatOutline[0].id);
    setExpanded(new Set(outline.map(n => n.id)));
  }, [openDoc, flatOutline, outline, selectedNodeId]);

  // 意味で近いもの / 語句が一致するもの に振り分ける。
  // 両方に該当する断片は両方のタブに出る（それが実態なので隠さない）。
  const semanticHits = useMemo(() => {
    const sorted = (hits ?? []).filter(h => h.vecScore > 0).sort((a, b) => b.vecScore - a.vecScore);
    if (sorted.length === 0) return sorted;
    const cut = sorted[0].vecScore - SEMANTIC_MARGIN;
    return sorted.filter(h => h.vecScore >= cut);
  }, [hits]);
  const keywordHits = useMemo(
    () => (hits ?? []).filter(h => h.kwScore > 0).sort((a, b) => b.kwScore - a.kwScore),
    [hits],
  );

  /**
   * 開いている資料のヒットが属する見出し（最も深いもの）を集める。
   * これが「意味的に関連する箇所」の実体。検索語の有無とは無関係。
   */
  const relatedSections = useMemo(() => {
    if (!openDoc || semanticHits.length === 0) return [];
    const found = new Map<number, { index: number; level: number }>();
    for (const hit of semanticHits.slice(0, MAX_BANDED_SECTIONS)) {
      if (hit.documentId !== openDoc.id) continue;
      const node = resolveSection(flatOutline, hit.charStart, hit.headingPath);
      if (!node) continue;
      const idx = flatOutline.indexOf(node);
      if (idx >= 0) found.set(idx, { index: idx, level: node.level });
    }
    return [...found.values()];
  }, [openDoc, semanticHits, flatOutline]);

  const relatedIndexSet = useMemo(
    () => new Set(relatedSections.map(r => r.index)),
    [relatedSections],
  );

  const selectedNode = useMemo(
    () => flatOutline.find(n => n.id === selectedNodeId) ?? null,
    [flatOutline, selectedNodeId],
  );

  const canManage = userRole === "owner" || userRole === "admin" || userRole === "project-manager"
    || (project?.members ?? []).includes(userName);
  const embedUnavailable = getUnavailableReason();
  const unindexed = useMemo(() => docs.filter(d => !d.indexedAt), [docs]);

  const showIndexBanner = unindexed.length > 0 && !embedUnavailable;

  // 3ペインの高さは「実測」で決める。
  //   固定値（calc(100vh - 175px) 等）だと Topbar・サブナビ・見出しの高さ変化に追従できず、
  //   数十pxはみ出してページ全体がスクロールしてしまう（実際に発生した）。
  //   スクロール親である AppShell の <main> の下端から、行の上端を引いた値が使える高さ。
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const scroller = el.closest("main");
    const update = () => {
      const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
      const h = bottom - el.getBoundingClientRect().top - PAGE_BOTTOM_PADDING;
      setRowHeight(Math.max(MIN_ROW_HEIGHT, Math.floor(h)));
    };
    update();
    // Topbar の高さ変化やウィンドウリサイズに追従する。
    // 監視対象を <main> に限定しているのは、行自身を監視すると
    // 「高さを変える → 監視が発火 → また高さを変える」のループになり得るため。
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (ro && scroller) ro.observe(scroller);
    window.addEventListener("resize", update);
    return () => { ro?.disconnect(); window.removeEventListener("resize", update); };
    // loading / setupRequired も依存に入れる。
    // これらが解けて初めて3ペインが描画されるため、入れないと
    // 資料0件のプロジェクトで一度も実測されず最小高さのままになる。
  }, [showIndexBanner, docs.length, folders.length, loading, setupRequired, plan.featureKnowledgeAi]);


  const docsByFolder = useMemo(() => {
    const map = new Map<string, KnowledgeDocument[]>();
    map.set(UNFILED, []);
    folders.forEach(f => map.set(f.id, []));
    docs.forEach(d => {
      const key = d.folderId && map.has(d.folderId) ? d.folderId : UNFILED;
      map.get(key)!.push(d);
    });
    return map;
  }, [docs, folders]);

  const checkedIds = useMemo(() => [...checked].filter(id => docs.some(d => d.id === id)), [checked, docs]);

  /**
   * 既に取り込んである Wiki 記事のID。
   * 出所を持つ列は無いので、資料の tags に入れた "wiki:<記事ID>" から拾う。
   */
  const importedWikiPageIds = useMemo(() => {
    const ids = new Set<string>();
    docs.forEach(d => d.tags.forEach(t => { if (t.startsWith("wiki:")) ids.add(t.slice(5)); }));
    return ids;
  }, [docs]);

  // Wiki を見られない人には「Wiki から追加」を出さない（見られない中身を取り込めてしまう）
  const canUseWiki = effectiveWikiPerm !== "none";

  // ── 操作 ────────────────────────────────────────────────────
  const toggleDoc = (id: string) =>
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleFolder = (folderId: string) => {
    const ids = (docsByFolder.get(folderId) ?? []).map(d => d.id);
    if (ids.length === 0) return;
    const allOn = ids.every(id => checked.has(id));
    setChecked(prev => {
      const next = new Set(prev);
      ids.forEach(id => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const runImport = useCallback(async (files: File[], folderId: string | null) => {
    if (!project) return;
    const targets = files.filter(isKnowledgeFile);
    if (targets.length === 0) { toast("取り込めるのは .md / .txt などのテキストファイルです", "error"); return; }
    if (isLimitReached(plan.maxKnowledgeDocsPerProject, docs.length)) {
      toast(`このプランで登録できる資料は ${plan.maxKnowledgeDocsPerProject} 件までです`, "error");
      return;
    }
    for (const file of targets) {
      try {
        const res = await importFile(file, project.id, userName, setProgress, folderId);
        toast(res.indexed
          ? `「${file.name}」を取り込みました`
          : `「${file.name}」を取り込みました（検索用の索引は未作成です）`, res.indexed ? "success" : "error");
      } catch (e) {
        if (isSetupMissingError(e)) { setSetupRequired(true); break; }
        toast(e instanceof Error ? e.message : "取り込みに失敗しました", "error");
      }
    }
    setProgress(null);
    await load();
  }, [project, docs.length, plan.maxKnowledgeDocsPerProject, isLimitReached, userName, toast, load]);

  /**
   * Wiki の記事を資料として取り込む。
   *
   * 既に取り込んだ記事は新しく作らずに更新する（同じ記事が2件並ぶのを避ける）。
   * 出所は資料の tags に "wiki:<記事ID>" として残していて、それで見分けている。
   */
  const runWikiImport = useCallback(async (pages: WikiImportInput[], folderId: string | null) => {
    if (!project) return;
    // 新しく増える件数だけをプランの上限と突き合わせる（更新は増えない）
    const adding = pages.filter(p => !importedWikiPageIds.has(p.pageId)).length;
    if (adding > 0 && isLimitReached(plan.maxKnowledgeDocsPerProject, docs.length + adding - 1)) {
      toast(`このプランで登録できる資料は ${plan.maxKnowledgeDocsPerProject} 件までです`, "error");
      return;
    }

    setWikiImporting(true);
    let added = 0, updated = 0, skipped = 0, failed = 0;
    let lastError = "";
    for (const page of pages) {
      try {
        const res = await importWikiPage(page, project.id, userName, setProgress, folderId);
        if (res.unchanged) skipped++;
        else if (res.updated) updated++;
        else added++;
      } catch (e) {
        if (isSetupMissingError(e)) { setSetupRequired(true); break; }
        failed++;
        lastError = e instanceof Error ? e.message : "取り込みに失敗しました";
      }
    }
    setProgress(null);
    setWikiImporting(false);
    setWikiDialog(null);

    const parts: string[] = [];
    if (added) parts.push(`${added} 件を追加`);
    if (updated) parts.push(`${updated} 件を更新`);
    if (skipped) parts.push(`${skipped} 件は変更なし`);
    if (failed) parts.push(`${failed} 件は失敗`);
    if (parts.length > 0) {
      toast(`Wiki から ${parts.join(" / ")}しました${failed && lastError ? `（${lastError}）` : ""}`, failed ? "error" : "success");
    }
    await load();
  }, [project, docs.length, importedWikiPageIds, plan.maxKnowledgeDocsPerProject, isLimitReached, userName, toast, load]);

  /**
   * 取り込んだ本文を Markdown ファイルとして取り出す。
   *
   * 一覧の行は本文を持っていない（listDocuments は転送量を抑えるため content を引かない）。
   * そのため押されたときに1件だけ引き直す。開いている資料は既に本文が手元にあるので、
   * その場合は取りに行かずそのまま保存する。
   */
  const runDownload = useCallback(async (doc: KnowledgeDocument) => {
    setDownloadingId(doc.id);
    try {
      const content = doc.content.trim() ? doc.content : (await getDocument(doc.id))?.content ?? "";
      if (!content.trim()) throw new Error("本文を取得できませんでした");
      // BOM 無しの UTF-8。Markdown なので改行は取り込み時に正規化された LF のまま
      downloadBlob(new Blob([content], { type: "text/markdown;charset=utf-8" }), downloadFileName(doc));
    } catch (e) {
      if (isSetupMissingError(e)) setSetupRequired(true);
      else toast(e instanceof Error ? e.message : "ダウンロードに失敗しました", "error");
    } finally {
      setDownloadingId(null);
    }
  }, [toast]);

  /**
   * 未索引の資料をまとめて索引する。
   * モデルの読み込みは1回で済むので、1件ずつ押すより速い。
   */
  const runIndexAll = useCallback(async () => {
    const targets = docs.filter(d => !d.indexedAt);
    if (targets.length === 0) return;
    let ok = 0;
    let lastNote: string | undefined;
    for (let i = 0; i < targets.length; i++) {
      setIndexBatch({ done: i, total: targets.length });
      const r = await indexDocument(targets[i], setProgress);
      if (r.indexed) ok++;
      else lastNote = r.note;
    }
    setIndexBatch(null);
    setProgress(null);
    if (ok === targets.length) {
      toast(targets.length === 1 ? "索引を作成しました" : `${ok} 件の索引を作成しました`);
    } else {
      toast(`${ok}/${targets.length} 件のみ作成できました${lastNote ? `（${lastNote}）` : ""}`, "error");
    }
    await load();
  }, [docs, toast, load]);

  const runSearch = useCallback(async () => {
    if (!project) return;
    const q = query.trim();
    if (!q) { setHits(null); return; }
    setSearching(true);
    setViewingBody(false);
    resultsScrollRef.current = 0;
    try {
      // 件数では切らない。意味検索は関連度の下限（RPC 側の p_min_vec）で絞る
      const out = await search(project.id, q, { documentIds: checkedIds });
      setHits(out.hits);
      setSemantic(out.semantic);
      setSearchNote(out.note);
      // タブは検索のたびに選び直す。
      // 前回の選択が残ると「意味検索の結果はあるのに、0件の語句タブを見ている」
      // という袋小路に入る（実際に発生した）。
      const hasSemantic = out.hits.some(h => h.vecScore > 0);
      setResultTab(hasSemantic ? "semantic" : "keyword");
    } catch (e) {
      if (isSetupMissingError(e)) setSetupRequired(true);
      else toast(e instanceof Error ? e.message : "検索に失敗しました", "error");
    } finally {
      setSearching(false);
    }
  }, [project, query, checkedIds, toast]);

  /** 検索結果 → そのヒットが属する節を開く */
  const jumpTo = (hit: { documentId: string; charStart: number; headingPath: string }) => {
    // 一覧に戻ったとき同じ位置から読み直せるよう、離れる前に覚えておく
    resultsScrollRef.current = bodyRef.current?.scrollTop ?? 0;
    // 本文表示へ切り替える。これをしないと検索結果一覧が出たままになり、
    // 目次だけが動いて「押しても何も起きない」ように見える。
    setViewingBody(true);
    setHighlightWord(query.trim());
    // 意味で探した結果は「節」が答えなので節の頭へ、語句で探した結果は語の位置へ
    const mode = resultTab === "semantic" ? "section" : "word";
    if (openDoc?.id !== hit.documentId) {
      navigate(`/${projectSlug}/knowledge/${hit.documentId}`);
      // 資料の読み込み後に選択したいので、行き先だけ覚えておく
      pendingJump.current = { charStart: hit.charStart, headingPath: hit.headingPath, mode };
      return;
    }
    selectNodeAt(hit.charStart, hit.headingPath, outline, mode);
  };
  const pendingJump = useRef<{ charStart: number; headingPath: string; mode: "word" | "section" } | null>(null);

  const selectNodeAt = useCallback((
    charStart: number, headingPath: string, nodes: OutlineNode[], mode: "word" | "section" = "word",
  ) => {
    const flat = flattenOutline(nodes);
    const best = resolveSection(flat, charStart, headingPath);
    if (best) {
      setSelectedNodeId(best.id);
      setJumpAnchor({ index: flat.indexOf(best), nonce: Date.now(), mode });
      setExpanded(prev => {
        const next = new Set(prev);
        flat.forEach(n => { if (best!.start >= n.start && best!.start < n.end) next.add(n.id); });
        return next;
      });
      // 位置決め（ハイライトへのスクロール）は Body 側で行うため、ここでは動かさない
    }
  }, []);

  useEffect(() => {
    if (pendingJump.current !== null && outline.length > 0) {
      selectNodeAt(
        pendingJump.current.charStart, pendingJump.current.headingPath, outline, pendingJump.current.mode,
      );
      pendingJump.current = null;
    }
  }, [outline, selectNodeAt]);

  const submitFolderName = async (name: string) => {
    if (!project || !folderDialog) return;
    if (folderDialog.mode === "create") {
      await createFolder(project.id, name, userName);
      toast(`フォルダ「${name}」を作成しました`);
    } else if (folderDialog.target) {
      await renameFolder(folderDialog.target.id, name);
      toast("フォルダ名を変更しました");
    }
    await load();
  };

  const handleDropOnFolder = async (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolder(null);
    if (!canManage) return;

    const movingId = e.dataTransfer.getData("text/kn-doc");
    if (movingId) {
      try { await moveDocument(movingId, folderId); await load(); }
      catch (err) { toast(err instanceof Error ? err.message : "移動できませんでした", "error"); }
      return;
    }
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) void runImport(files, folderId);
  };

  const handleSaveEdit = async () => {
    if (!openDoc || !project) return;
    setSavingEdit(true);
    try {
      await updateDocumentContent(openDoc.id, project.id, editContent, setProgress);
      const updatedDoc = await getDocument(openDoc.id);
      if (updatedDoc) setOpenDoc(updatedDoc);
      setIsEditing(false);
      toast("資料を更新しました");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "更新に失敗しました", "error");
    } finally {
      setProgress(null);
      setSavingEdit(false);
    }
  };

  // ── 画面 ────────────────────────────────────────────────────
  // 見出し・パンくず・サブナビの並びは他のプロジェクト配下の画面と揃える。
  // （タイトル左・メニュー右。ここだけメニューが上に出ていて位置が合っていなかった）
  const pageHead = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12, flexShrink: 0 }}>
        <button onClick={() => navigate("/projects")}
          style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{project?.name ?? projectSlug ?? ""}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>ナレッジノート</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>
            {project ? `${project.name} · 資料 ${docs.length} 件 · フォルダ ${folders.length} 件` : "..."}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="knowledge" marginBottom={0}
            minutesPerm={effectiveMinutesPerm} wikiPerm={effectiveWikiPerm}
            backlogPerm={effectiveBacklogPerm} whiteboardPerm={effectiveWhiteboardPerm} />
        </div>
      </div>
    </>
  );

  // 読み込み中にページ全体を差し替えない。
  // 以前は <PageLoader /> を返していたため、他画面から来ると
  // 「ヘッダーとメニューが一度消えて、また出る」＝画面がチカつく状態だった。
  // 他のプロジェクト配下の画面と同じく、枠は最初から出して中身だけ後から入れる。
  if (notFound) return <Navigate to="/projects" replace />;
  if (!loading && project && userRole !== "owner" && !(project.members ?? []).includes(userName)) {
    return <Navigate to="/projects" replace />;
  }
  if (!plan.featureKnowledgeAi) {
    return (
      <div style={{ padding: 24 }}>
        {pageHead}
        <div style={{ background: "#fff", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: 40, textAlign: "center" }}>
          <BookOpen style={{ width: 28, height: 28, color: "#A09790", marginBottom: 10 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1A1714" }}>ナレッジノートはご契約のプランに含まれていません</div>
          <div style={{ fontSize: 12.5, color: "#A09790", marginTop: 6 }}>ご利用をご希望の場合は管理者へお問い合わせください。</div>
        </div>
      </div>
    );
  }
  if (setupRequired) {
    return (
      <div style={{ padding: 24 }}>
        {pageHead}
        <div style={{ background: "#fff", border: "1px solid #FDE68A", borderLeft: "4px solid #D97706", borderRadius: 12, padding: 24, maxWidth: 720 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <AlertTriangle style={{ width: 17, height: 17, color: "#D97706" }} />
            <div style={{ fontSize: 15, fontWeight: 800, color: "#1A1714" }}>ナレッジノートの初期設定が完了していません</div>
          </div>
          <p style={{ fontSize: 13, color: "#6B6458", lineHeight: 1.8, marginBottom: 14 }}>
            この機能が使うテーブル・関数がデータベースに作成されていません。<br />
            Supabase の <strong>SQL Editor</strong> で、次の4つを<strong>この順に</strong>実行してください。
          </p>
          {/* 途中まで実行して止まると原因が分かりにくいので、4本すべてを並べる。
              1本でも欠けると「検索できない」「索引が作れない」の形で表面化する */}
          {[
            { file: "supabase/add_knowledge_ai.sql", note: "テーブル・RLS・検索の土台" },
            { file: "supabase/add_knowledge_folders.sql", note: "フォルダ" },
            { file: "supabase/add_knowledge_search_v2.sql", note: "検索結果の件数上限を撤廃" },
            { file: "supabase/add_knowledge_embedding_768.sql", note: "埋め込みを768次元へ" },
          ].map(({ file, note }, i) => (
            <div key={file} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: "50%", background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
              <code style={{ flex: 1, background: "#F6F8FA", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 8, padding: "9px 12px", fontSize: 12.5 }}>{file}</code>
              <span style={{ fontSize: 11, color: "#A09790", flexShrink: 0 }}>{note}</span>
            </div>
          ))}
          <div style={{ height: 8 }} />
          <p style={{ fontSize: 12, color: "#A09790", lineHeight: 1.8 }}>
            1つめは <code>vector</code> と <code>pg_trgm</code> 拡張の有効化から始まります。<br />
            拡張の作成でエラーになる場合は、先に Database → Extensions で両方を有効化してください。
          </p>
          <button
            onClick={() => { setSetupRequired(false); setLoading(true); void load(); }}
            style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer" }}
          >
            <RefreshCw style={{ width: 14, height: 14 }} />実行したので再確認する
          </button>
        </div>
      </div>
    );
  }

  const renderDocRow = (doc: KnowledgeDocument) => {
    const on = checked.has(doc.id);
    const isOpen = openDoc?.id === doc.id;
    return (
      <div
        key={doc.id}
        draggable={canManage}
        onDragStart={e => { e.dataTransfer.setData("text/kn-doc", doc.id); e.dataTransfer.effectAllowed = "move"; }}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 6px 22px", borderRadius: 7, background: isOpen ? "#ECFDF5" : "transparent", cursor: "pointer" }}
        onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = "#F7F6F4"; }}
        onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}
      >
        <input
          type="checkbox" checked={on} onChange={() => toggleDoc(doc.id)}
          title="検索の対象にする（開くには資料名を押します）"
          style={{ accentColor: "#059669", cursor: "pointer", flexShrink: 0 }}
        />
        <button
          onClick={() => navigate(`/${projectSlug}/knowledge/${doc.id}`)}
          title="この資料を開く"
          style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <FileText style={{ width: 11, height: 11, color: isOpen ? "#059669" : "#B0A9A4", flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: isOpen ? 700 : 500, color: isOpen ? "#047857" : "#3A342E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {doc.title}
            </span>
          </div>
          <div style={{ fontSize: 10, color: "#B0A9A4", marginLeft: 16 }}>
            {formatSize(doc.byteSize)}{doc.indexedAt ? "" : " · 索引なし"}
          </div>
        </button>
        {/* 取り出しは閲覧できる人なら誰でもできる。canManage で囲わない */}
        <button
          onClick={() => void runDownload(doc)}
          disabled={downloadingId === doc.id}
          title={`「${downloadFileName(doc)}」をダウンロード`}
          style={{ background: "none", border: "none", cursor: downloadingId === doc.id ? "default" : "pointer", color: "#C4BDB6", padding: 0, flexShrink: 0, display: "flex" }}
        >
          {downloadingId === doc.id
            ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} />
            : <Download style={{ width: 11, height: 11 }} />}
        </button>
        {canManage && (
          <button onClick={() => setDeleteDocTarget(doc)} title="削除"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDB6", padding: 0, flexShrink: 0 }}>
            <Trash2 style={{ width: 11, height: 11 }} />
          </button>
        )}
      </div>
    );
  };

  const renderOutline = (nodes: OutlineNode[], depth = 0) => nodes.map(node => {
    const isSel = node.id === selectedNodeId;
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    return (
      <div key={node.id}>
        <div
          style={{ display: "flex", alignItems: "center", gap: 3, paddingLeft: depth * 12 }}
        >
          {hasChildren ? (
            <button
              onClick={() => setExpanded(prev => {
                const n = new Set(prev);
                if (n.has(node.id)) n.delete(node.id); else n.add(node.id);
                return n;
              })}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#A09790", padding: 2, flexShrink: 0, display: "flex" }}
            >
              {isExpanded ? <ChevronDown style={{ width: 12, height: 12 }} /> : <ChevronRight style={{ width: 12, height: 12 }} />}
            </button>
          ) : <span style={{ width: 16, flexShrink: 0 }} />}
          {relatedIndexSet.has(flatOutline.findIndex(n => n.id === node.id)) && (
            <span title="関連する記述があります"
              style={{ width: 6, height: 6, borderRadius: "50%", background: "#F59E0B", flexShrink: 0 }} />
          )}
          <button
            onClick={() => { setSelectedNodeId(node.id); setViewingBody(true); setHighlightWord(""); setJumpAnchor(null); setTimeout(() => scrollToNode(node.id), 0); }}
            style={{ flex: 1, minWidth: 0, textAlign: "left", padding: "5px 8px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, lineHeight: 1.5, background: isSel ? "#059669" : "transparent", color: isSel ? "#fff" : "#3A342E", fontWeight: isSel ? 600 : 400 }}
            onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = "#F0F5F3"; }}
            onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
          >
            {node.title}
          </button>
        </div>
        {hasChildren && isExpanded && renderOutline(node.children, depth + 1)}
      </div>
    );
  });

  return (
    <div style={{ padding: 24 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .kn-body { font-size: 13px; line-height: 1.9; color: #1A1714; }
        .kn-body > *:first-child { margin-top: 0; }
        .kn-body h1, .kn-body h2, .kn-body h3, .kn-body h4 { font-size: 14px; font-weight: 700; margin: 18px 0 8px; }
        .kn-body p { margin: 8px 0; }
        .kn-body ul, .kn-body ol { margin: 8px 0; padding-left: 22px; }
        .kn-body li { margin: 4px 0; }
        .kn-body table { border-collapse: collapse; margin: 10px 0; font-size: 12px; display: block; overflow-x: auto; }
        .kn-body th, .kn-body td { border: 1px solid rgba(26,23,20,0.14); padding: 6px 10px; text-align: left; vertical-align: top; }
        .kn-body th { background: #F0F5F3; font-weight: 700; white-space: nowrap; }
        .kn-body pre { background: #F6F8FA; border: 1px solid rgba(26,23,20,0.08); border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: 10px 0; }
        .kn-body code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
        .kn-body :not(pre) > code { background: rgba(5,150,105,0.08); color: #047857; padding: 1px 5px; border-radius: 4px; }
        .kn-body blockquote { border-left: 3px solid rgba(26,23,20,0.15); margin: 10px 0; padding-left: 12px; color: #6B6458; }
        .kn-body a { color: #059669; }
        .kn-body mark.kn-hit { background: #FDE047; color: #1A1714; padding: 0 2px; border-radius: 3px; box-shadow: 0 0 0 2px #FDE047; }
        /* 意味検索が関連ありと判定した節。文字が一致していなくても塗られる */
        .kn-body .kn-related { background: #FFFBEB; box-shadow: -8px 0 0 #FFFBEB, 8px 0 0 #FFFBEB; }
        .kn-body .kn-related-head { border-left: 3px solid #F59E0B; padding-left: 9px; box-shadow: 0 0 0 #FFFBEB, 8px 0 0 #FFFBEB; }
      `}</style>

      {pageHead}

      {showIndexBanner && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "9px 14px", marginBottom: 12, fontSize: 12.5, color: "#92400E" }}>
          <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0 }} />
          {unindexed.length} 件の資料が未索引です（読むことはできますが、検索に出ません）。
          <button
            onClick={() => void runIndexAll()}
            disabled={!!progress}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, padding: "5px 12px", background: "#fff", border: "1px solid #FDE68A", borderRadius: 7, fontSize: 11.5, cursor: progress ? "default" : "pointer", color: "#92400E", opacity: progress ? 0.5 : 1, whiteSpace: "nowrap" }}
          >
            <RefreshCw style={{ width: 11, height: 11 }} />
            {unindexed.length > 1 ? `すべて索引を作成（${unindexed.length} 件）` : "索引を作成"}
          </button>
        </div>
      )}

      {/* 高さは useLayoutEffect で実測して入れる（固定値だとはみ出す） */}
      <div ref={rowRef} style={{ display: "flex", gap: 14, height: rowHeight, overflow: "hidden" }}>

        {/* ── ① フォルダと資料 ── */}
        <aside style={{ width: 252, flexShrink: 0, background: "#fff", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "11px 12px", borderBottom: "1px solid rgba(26,23,20,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1A1714" }}>資料</div>
            {canManage && (
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  ref={fileInputRef} type="file" multiple accept={KNOWLEDGE_FILE_ACCEPT}
                  style={{ display: "none" }}
                  onChange={e => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void runImport(fs, importTargetFolder); }}
                />
                <button onClick={() => setFolderDialog({ mode: "create" })} title="フォルダを作成"
                  style={{ display: "flex", alignItems: "center", padding: "5px 7px", background: "#fff", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 7, cursor: "pointer", color: "#6B6458" }}>
                  <FolderPlus style={{ width: 13, height: 13 }} />
                </button>
                {/* 追加の入口は2つ（MDファイル / Wiki）。ボタンを増やさずメニューにまとめる */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button title="資料を追加"
                      style={{ display: "flex", alignItems: "center", gap: 3, padding: "5px 9px", background: "#059669", color: "#fff", fontSize: 11.5, fontWeight: 600, borderRadius: 7, border: "none", cursor: "pointer" }}>
                      <Upload style={{ width: 11, height: 11 }} />追加
                      <ChevronDown style={{ width: 11, height: 11 }} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => { setImportTargetFolder(null); fileInputRef.current?.click(); }}>
                      <Upload style={{ width: 15, height: 15 }} />
                      MDファイルをアップロード
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setWikiDialog({ folderId: null })} disabled={!canUseWiki}>
                      <BookOpen style={{ width: 15, height: 15 }} />
                      Wiki から追加
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
            {loading ? (
              // 「資料がありません」を一瞬見せてから一覧に置き換わる方がちらついて見える
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "26px 10px", color: "#C4BDB6", fontSize: 12 }}>
                <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />読み込み中...
              </div>
            ) : docs.length === 0 && folders.length === 0 ? (
              <div style={{ textAlign: "center", padding: "26px 10px", color: "#A09790" }}>
                <Upload style={{ width: 20, height: 20, marginBottom: 8 }} />
                <div style={{ fontSize: 12, lineHeight: 1.7 }}>.md をここに<br />ドラッグ＆ドロップ</div>
                {canManage && canUseWiki && (
                  <div style={{ fontSize: 11, lineHeight: 1.7, marginTop: 8, color: "#C4BDB6" }}>
                    「追加」から Wiki の<br />記事も取り込めます
                  </div>
                )}
              </div>
            ) : (
              <>
                {folders.map(f => {
                  const fdocs = docsByFolder.get(f.id) ?? [];
                  const allOn = fdocs.length > 0 && fdocs.every(d => checked.has(d.id));
                  const someOn = fdocs.some(d => checked.has(d.id));
                  const collapsed = collapsedFolders.has(f.id);
                  return (
                    <div
                      key={f.id}
                      onDragOver={e => { e.preventDefault(); setDragOverFolder(f.id); }}
                      onDragLeave={() => setDragOverFolder(null)}
                      onDrop={e => void handleDropOnFolder(e, f.id)}
                      style={{ marginBottom: 2, borderRadius: 8, outline: dragOverFolder === f.id ? "2px dashed #059669" : "none", outlineOffset: -2 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 8px" }}>
                        <input
                          type="checkbox" checked={allOn}
                          ref={el => { if (el) el.indeterminate = !allOn && someOn; }}
                          onChange={() => toggleFolder(f.id)}
                          title="このフォルダの資料をまとめて対象にする"
                          style={{ accentColor: "#059669", cursor: "pointer", flexShrink: 0 }}
                        />
                        <button
                          onClick={() => setCollapsedFolders(prev => {
                            const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n;
                          })}
                          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
                        >
                          {collapsed
                            ? <Folder style={{ width: 12, height: 12, color: "#D97706", flexShrink: 0 }} />
                            : <FolderOpen style={{ width: 12, height: 12, color: "#D97706", flexShrink: 0 }} />}
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                          <span style={{ fontSize: 10, color: "#B0A9A4", flexShrink: 0 }}>{fdocs.length}</span>
                        </button>
                        {canManage && (
                          <>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button title="このフォルダに追加"
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDB6", padding: 0, display: "flex" }}>
                                  <Upload style={{ width: 11, height: 11 }} />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => { setImportTargetFolder(f.id); fileInputRef.current?.click(); }}>
                                  <Upload style={{ width: 15, height: 15 }} />
                                  MDファイルをアップロード
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setWikiDialog({ folderId: f.id })} disabled={!canUseWiki}>
                                  <BookOpen style={{ width: 15, height: 15 }} />
                                  Wiki から追加
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <button onClick={() => setFolderDialog({ mode: "rename", target: f })} title="名前を変更"
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDB6", padding: 0 }}>
                              <Pencil style={{ width: 11, height: 11 }} />
                            </button>
                            <button onClick={() => setDeleteFolderTarget(f)} title="フォルダを削除"
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDB6", padding: 0 }}>
                              <Trash2 style={{ width: 11, height: 11 }} />
                            </button>
                          </>
                        )}
                      </div>
                      {!collapsed && fdocs.map(renderDocRow)}
                      {!collapsed && fdocs.length === 0 && (
                        <div style={{ fontSize: 10.5, color: "#C4BDB6", padding: "3px 8px 6px 22px" }}>ここに資料をドロップ</div>
                      )}
                    </div>
                  );
                })}

                {/* 未分類 */}
                <div
                  onDragOver={e => { e.preventDefault(); setDragOverFolder(UNFILED); }}
                  onDragLeave={() => setDragOverFolder(null)}
                  onDrop={e => void handleDropOnFolder(e, null)}
                  style={{ marginTop: 4, borderRadius: 8, outline: dragOverFolder === UNFILED ? "2px dashed #059669" : "none", outlineOffset: -2 }}
                >
                  {(docsByFolder.get(UNFILED) ?? []).length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 8px" }}>
                      <input
                        type="checkbox"
                        checked={(docsByFolder.get(UNFILED) ?? []).every(d => checked.has(d.id))}
                        onChange={() => toggleFolder(UNFILED)}
                        style={{ accentColor: "#059669", cursor: "pointer" }}
                      />
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#A09790" }}>未分類</span>
                      <span style={{ fontSize: 10, color: "#B0A9A4" }}>{(docsByFolder.get(UNFILED) ?? []).length}</span>
                    </div>
                  )}
                  {(docsByFolder.get(UNFILED) ?? []).map(renderDocRow)}
                </div>
              </>
            )}
          </div>

          <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(26,23,20,0.06)", fontSize: 10.5, color: "#B0A9A4", lineHeight: 1.6 }}>
            チェック = 検索の対象（{checkedIds.length} 件）／資料名を押すと開きます
          </div>
        </aside>

        {/* ── ② 目次 ── */}
        <nav style={{ width: 264, flexShrink: 0, background: "#fff", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "11px 12px", borderBottom: "1px solid rgba(26,23,20,0.06)", fontSize: 12.5, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {openDoc ? openDoc.title : "目次"}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
            {loading ? null : !openDoc ? (
              <div style={{ fontSize: 12, color: "#A09790", padding: 14, lineHeight: 1.8 }}>
                左から資料を選ぶと、見出しの一覧が出ます。
              </div>
            ) : outline.length === 0 ? (
              <div style={{ fontSize: 12, color: "#A09790", padding: 14, lineHeight: 1.8 }}>
                この資料には見出し（#）がありません。右に全文を表示しています。
              </div>
            ) : renderOutline(outline)}
          </div>
        </nav>

        {/* ── ③ 本文／検索結果 ── */}
        <main style={{ flex: 1, minWidth: 0, background: "#fff", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: 12, borderBottom: "1px solid rgba(26,23,20,0.06)", display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#B0A9A4" }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void runSearch(); }}
                placeholder="チェックした資料から探す（言葉が一致しなくても近い箇所を見つけます）"
                style={{ width: "100%", padding: "9px 32px 9px 33px", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 9, fontSize: 13, outline: "none", background: "#FCFBFA" }}
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.4)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.12)"; }}
              />
              {(query || hits) && (
                <button onClick={() => { setQuery(""); setHits(null); setViewingBody(false); setHighlightWord(""); }} title="検索をやめる"
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#B0A9A4", padding: 2, display: "flex" }}>
                  <X style={{ width: 13, height: 13 }} />
                </button>
              )}
            </div>
            <button
              onClick={() => void runSearch()}
              disabled={searching || !query.trim()}
              style={{ padding: "9px 16px", background: searching || !query.trim() ? "#D9D5D2" : "#059669", color: "#fff", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "none", cursor: searching || !query.trim() ? "default" : "pointer", whiteSpace: "nowrap" }}
            >
              {searching ? "検索中..." : "検索"}
            </button>
          </div>

          <div ref={bodyRef} style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
            {hits !== null && !viewingBody ? (
              <>
                {/* 意味で近いもの / 語句が一致するもの をタブで分ける。
                    判定方法が違うので混ぜると「なぜこれが出たか」が分からなくなる。 */}
                <div style={{ display: "flex", gap: 4, background: "#F3F1EE", borderRadius: 9, padding: 3, marginBottom: 12, width: "fit-content" }}>
                  {([
                    ["semantic", "意味で探す", semanticHits.length],
                    ["keyword", "語句で探す", keywordHits.length],
                  ] as const).map(([key, label, count]) => {
                    const empty = count === 0;
                    const active = resultTab === key;
                    return (
                      <button
                        key={key}
                        onClick={() => { if (!empty) setResultTab(key); }}
                        disabled={empty}
                        title={empty ? "該当がないため選べません" : undefined}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 7, border: "none", cursor: empty ? "default" : "pointer", background: active ? "#fff" : "transparent", color: empty ? "#C4BDB6" : active ? "#059669" : "#8A8178", boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}
                      >
                        {label}
                        <span style={{ fontSize: 11, color: empty ? "#D3CDC6" : active ? "#047857" : "#B0A9A4" }}>{count}</span>
                      </button>
                    );
                  })}
                </div>

                <div style={{ fontSize: 11.5, color: "#A09790", marginBottom: 10, lineHeight: 1.7 }}>
                  {resultTab === "semantic" ? (
                    <>
                      <strong style={{ color: "#6B6458" }}>入力した語が出てこなくても、内容が近い箇所</strong>を関連度の高い順に出しています。
                      {semanticHits.length > 0 && (
                        <>
                          {" "}関連度 {Math.round(semanticHits[0].vecScore * 100)}
                          〜{Math.round(semanticHits[semanticHits.length - 1].vecScore * 100)}。
                        </>
                      )}
                    </>
                  ) : (
                    <><strong style={{ color: "#6B6458" }}>入力した語をそのまま含む箇所</strong>です。一致するものはすべて出しています。</>
                  )}
                </div>

                {!semantic && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: "7px 10px", fontSize: 11.5, color: "#92400E" }}>
                    <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />
                    意味検索は使えませんでした{searchNote ? `（${searchNote}）` : ""}。語句の一致のみの結果です
                  </div>
                )}

                {(resultTab === "semantic" ? semanticHits : keywordHits).length === 0 ? (
                  <div style={{ fontSize: 13, color: "#A09790", padding: 20, textAlign: "center", border: "1px dashed rgba(26,23,20,0.15)", borderRadius: 10 }}>
                    {resultTab === "semantic"
                      ? `内容が近い箇所は見つかりませんでした（対象 ${checkedIds.length} 件）`
                      : `「${query.trim()}」という語をそのまま含む箇所はありませんでした（対象 ${checkedIds.length} 件）`}
                    {resultTab === "keyword" && semanticHits.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <button
                          onClick={() => setResultTab("semantic")}
                          style={{ padding: "7px 14px", background: "#059669", color: "#fff", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer" }}
                        >
                          意味が近い箇所を見る（{semanticHits.length} 件）
                        </button>
                      </div>
                    )}
                    {resultTab === "semantic" && keywordHits.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <button
                          onClick={() => setResultTab("keyword")}
                          style={{ padding: "7px 14px", background: "#059669", color: "#fff", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer" }}
                        >
                          語句が一致する箇所を見る（{keywordHits.length} 件）
                        </button>
                      </div>
                    )}
                  </div>
                ) : (resultTab === "semantic" ? semanticHits : keywordHits).map(hit => (
                  <button
                    key={hit.chunkId}
                    onClick={() => void jumpTo(hit)}
                    style={{ display: "block", width: "100%", textAlign: "left", background: "#F7FAF9", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 9, padding: 12, marginBottom: 8, cursor: "pointer" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.35)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.08)"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                      <div style={{ fontSize: 11, color: "#059669", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                        {hit.title}{hit.headingPath ? ` › ${hit.headingPath}` : ""}
                      </div>
                      <span style={{ fontSize: 10, color: "#B0A9A4", flexShrink: 0 }}>
                        {resultTab === "semantic"
                          ? `関連度 ${Math.round(hit.vecScore * 100)}`
                          : `一致度 ${Math.round(hit.kwScore * 100)}`}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.75, color: "#3A342E", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>
                      {previewOf(hit.content)}
                    </div>
                  </button>
                ))}
              </>
            ) : loading ? null : !openDoc ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#A09790" }}>
                <BookOpen style={{ width: 26, height: 26, marginBottom: 12 }} />
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>資料を選んでください</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.8, textAlign: "center" }}>
                  左の一覧から資料を選ぶと見出しが並びます。<br />
                  見出しを押すとその節を読めます。
                </div>
              </div>
            ) : (
              <>
                {hits !== null && viewingBody && (
                  <button
                    onClick={() => { setViewingBody(false); setHighlightWord(""); }}
                    style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 12, padding: "6px 12px", background: "#F0F5F3", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 8, fontSize: 12, color: "#3A342E", cursor: "pointer" }}
                  >
                    <ChevronLeft style={{ width: 13, height: 13 }} />検索結果に戻る（{(resultTab === "semantic" ? semanticHits : keywordHits).length} 件）
                  </button>
                )}
                {relatedSections.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12, fontSize: 11.5, color: "#6B6458" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 22, height: 11, background: "#FFFBEB", borderLeft: "3px solid #F59E0B", borderRadius: 2 }} />
                      特に関連する節（上位 {relatedSections.length} 箇所）
                    </span>
                    {highlightWord && (
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 22, height: 11, background: "#FDE047", borderRadius: 2 }} />
                        {/* 黄色は「語がそのまま書かれている場所」を示すだけで、
                            意味検索がその節を選んだ理由ではない。混同されやすいので明示する */}
                        {resultTab === "semantic"
                          ? `参考：「${highlightWord}」という語そのものが出てくる場所`
                          : `「${highlightWord}」の出現箇所`}
                      </span>
                    )}
                  </div>
                )}
                {(
                  <div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid rgba(26,23,20,0.06)", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: "#A09790", marginBottom: 4 }}>{openDoc.fileName || openDoc.title}</div>
                      <h2 style={{ fontSize: 17, fontWeight: 800, color: "#1A1714", margin: 0 }}>{openDoc.title}</h2>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => setIsEditing(false)}
                            disabled={savingEdit}
                            style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#fff", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, fontSize: 12, color: "#6B6458", cursor: savingEdit ? "default" : "pointer" }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#F4F5F6"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "#fff"; }}
                          >
                            キャンセル
                          </button>
                          <button
                            onClick={handleSaveEdit}
                            disabled={savingEdit}
                            style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#059669", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "#fff", cursor: savingEdit ? "default" : "pointer" }}
                          >
                            {savingEdit ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Save style={{ width: 12, height: 12 }} />}
                            保存
                          </button>
                        </>
                      ) : (
                        <>
                          {canManage && (
                            <button
                              onClick={() => setDeleteDocTarget(openDoc)}
                              title="削除"
                              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#fff", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, fontSize: 12, color: "#DC2626", cursor: "pointer" }}
                              onMouseEnter={e => { e.currentTarget.style.background = "#FEF2F2"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "#fff"; }}
                            >
                              <Trash2 style={{ width: 12, height: 12 }} />
                              削除
                            </button>
                          )}
                          {canManage && (
                            <button
                              onClick={() => { setEditContent(openDoc.content); setIsEditing(true); }}
                              title="編集"
                              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#fff", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, fontSize: 12, color: "#3A342E", cursor: "pointer" }}
                              onMouseEnter={e => { e.currentTarget.style.background = "#F0F5F3"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "#fff"; }}
                            >
                              <Pencil style={{ width: 12, height: 12 }} />
                              編集
                            </button>
                          )}
                          <button
                            onClick={() => void runDownload(openDoc)}
                            disabled={downloadingId === openDoc.id}
                            title={`「${downloadFileName(openDoc)}」をダウンロード`}
                            style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#fff", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, fontSize: 12, color: "#3A342E", cursor: downloadingId === openDoc.id ? "default" : "pointer" }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#F0F5F3"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "#fff"; }}
                          >
                            {downloadingId === openDoc.id
                              ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                              : <Download style={{ width: 12, height: 12 }} />}
                            ダウンロード
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {isEditing ? (
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    onKeyDown={submitOnModEnter(() => { if (!savingEdit) void handleSaveEdit(); })}
                    placeholder="Markdown形式で本文を入力してください"
                    style={{ width: "100%", minHeight: "500px", resize: "vertical", padding: 16, fontSize: 13, lineHeight: 1.6, color: "#1A1714", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, outline: "none", fontFamily: "var(--font-mono, monospace)" }}
                    onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.4)"; }}
                    onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.12)"; }}
                  />
                ) : (
                  <Body
                    markdown={openDoc.content}
                    highlight={highlightWord}
                    onHeadings={handleHeadings}
                    anchorIndex={jumpAnchor?.index}
                    anchorMode={jumpAnchor?.mode}
                    scrollNonce={jumpAnchor?.nonce}
                    relatedSections={relatedSections}
                  />
                )}

              </>
            )}
          </div>
        </main>
      </div>

      {progress && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 26, width: 380, boxShadow: "0 12px 48px rgba(0,0,0,0.18)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Loader2 style={{ width: 16, height: 16, color: "#059669", animation: "spin 1s linear infinite" }} />
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1A1714" }}>{PHASE_LABEL[progress.phase]}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{progress.fileName}</div>
              {indexBatch && indexBatch.total > 1 && (
                <div style={{ fontSize: 11, color: "#A09790", flexShrink: 0 }}>
                  資料 {indexBatch.done + 1} / {indexBatch.total}
                </div>
              )}
            </div>
            <div style={{ height: 6, background: "#F0EEEC", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", background: "#059669", width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : "30%", transition: "width 0.2s" }} />
            </div>
            {progress.total > 0 && (
              <div style={{ fontSize: 11, color: "#A09790", marginTop: 7, textAlign: "right" }}>{progress.done} / {progress.total}</div>
            )}
            {progress.phase === "modelLoading" && (
              <div style={{ fontSize: 11, color: "#A09790", marginTop: 7 }}>
                初回のみ検索用のモデルを取得します（約266MB）。次回以降は数秒で終わります。
              </div>
            )}
          </div>
        </div>
      )}

      {modelProgress !== null && modelProgress < 100 && !progress && (
        <div style={{ position: "fixed", right: 20, bottom: 20, background: "#fff", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 10, padding: "9px 14px", fontSize: 11.5, color: "#6B6458", display: "flex", alignItems: "center", gap: 7, boxShadow: "0 4px 16px rgba(0,0,0,0.08)", zIndex: 500 }}>
          <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
          検索の準備中… {Math.round(modelProgress)}%（初回のみ）
        </div>
      )}

      {folderDialog && (
        <FolderNameDialog
          mode={folderDialog.mode}
          initialName={folderDialog.target?.name ?? ""}
          existingNames={folders.filter(f => f.id !== folderDialog.target?.id).map(f => f.name)}
          onSubmit={submitFolderName}
          onClose={() => setFolderDialog(null)}
        />
      )}

      {wikiDialog && project && (
        <WikiImportDialog
          projectId={project.id}
          folders={folders}
          defaultFolderId={wikiDialog.folderId}
          importedPageIds={importedWikiPageIds}
          busy={wikiImporting}
          onClose={() => { if (!wikiImporting) setWikiDialog(null); }}
          onSubmit={runWikiImport}
        />
      )}

      {deleteDocTarget && (
        <ConfirmDialog
          title="資料の削除"
          message={`「${deleteDocTarget.title}」を削除します。検索用の索引も一緒に削除されます。`}
          onConfirm={async () => {
            try {
              await deleteDocument(deleteDocTarget.id);
              toast(`「${deleteDocTarget.title}」を削除しました`);
              if (openDoc?.id === deleteDocTarget.id) navigate(`/${projectSlug}/knowledge`);
              setHits(null);
              await load();
            } catch (e) { toast(e instanceof Error ? e.message : "削除に失敗しました", "error"); }
          }}
          onClose={() => setDeleteDocTarget(null)}
        />
      )}

      {deleteFolderTarget && (
        <ConfirmDialog
          title="フォルダの削除"
          message={`フォルダ「${deleteFolderTarget.name}」を削除します。中の資料は削除されず、未分類に移動します。`}
          confirmLabel="フォルダを削除"
          onConfirm={async () => {
            try {
              await deleteFolder(deleteFolderTarget.id);
              toast(`フォルダ「${deleteFolderTarget.name}」を削除しました`);
              await load();
            } catch (e) { toast(e instanceof Error ? e.message : "削除に失敗しました", "error"); }
          }}
          onClose={() => setDeleteFolderTarget(null)}
        />
      )}
    </div>
  );
}
