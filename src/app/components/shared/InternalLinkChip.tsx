// 本文に貼られた「DevTicket 自身のURL」をチップ表示にする TipTap ノード。
//
// ねらい（BRU13-043）:
//   ・入力時   … URLを打った／貼った瞬間に `#QI1-034` のようなチップへ変わる
//   ・読み込み時 … すでに保存済みの本文でも、開いた時点でチップになる
//   ・不在時   … 存在しないリンクは赤＋×で示し、ツールチップで理由を出す
//
// 設計の要点:
//   ・保存されるHTMLは今までどおり `<a href="…">…</a>`（テキストは生URL）。
//     Markdown変換・Slack通知・全文検索など TipTap を通らない描画は一切変えずに済む。
//   ・チップの見た目とラベル解決は「描画時だけ」の関心事にして、ノードには href しか持たせない。
//     タイトルを属性に焼き込むと、改題したときに本文側が古いまま腐る。
//   ・ラベル未解決のうちは種別名を出す。赤×は「問い合わせた結果いなかった」ときだけ出す
//     （読み込み中に一瞬赤くなるチカチカを避ける）。
import { Node, mergeAttributes } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { useEffect, useMemo, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import {
  INTERNAL_LINK_KIND_LABEL,
  buildInternalPath,
  internalLinkKey,
  linkTextIsBareUrl,
  parseInternalLink,
  type InternalLinkKind,
  type InternalLinkRef,
} from "@/app/lib/internalLink";
import {
  peekInternalLink,
  resolveInternalLink,
  subscribeInternalLinks,
  type ResolvedInternalLink,
} from "@/app/lib/internalLinkResolve";
import { parseWhiteboardLink } from "@/app/lib/whiteboardLink";
import { requestWhiteboardFocus } from "@/app/lib/whiteboardFocusBus";
import type { PreviewOptions, PreviewType } from "@/app/contexts/PreviewPanelContext";

export const INTERNAL_LINK_NODE_NAME = "internalLink";

/** チップのクリック先。RichEditor が editor.storage 経由で最新のものを差し込む。 */
export interface InternalLinkHandlers {
  openPreview?: (type: PreviewType, id: string, opts?: PreviewOptions) => void;
  navigate?: (path: string) => void;
  onTicketClick?: (wbs: string) => void;
  /** いま開いているプロジェクトの slug。同一プロジェクトのチケットは既存の挙動に寄せる */
  currentProjectSlug?: string;
}

// 既存の $ / # / % メンションと同じ見た目にそろえる（貼り方が違うだけで意味は同じものなので）。
const CHIP_CLASS: Record<InternalLinkKind, string> = {
  project: "project-mention",
  sprint: "sprint-mention",
  ticket: "ticket-mention",
  backlog: "backlog-mention",
  "backlog-folder": "backlog-mention",
  wiki: "wiki-mention",
  "wiki-folder": "wiki-mention",
  minute: "minute-mention",
  "minute-folder": "minute-mention",
  file: "file-mention",
  "file-folder": "file-mention",
  whiteboard: "whiteboard-mention",
};

const CHIP_SIGIL: Partial<Record<InternalLinkKind, string>> = {
  ticket: "#",
  backlog: "$",
  wiki: "$",
  minute: "$",
  file: "%",
};

const FOLDER_KINDS = new Set<InternalLinkKind>(["backlog-folder", "wiki-folder", "minute-folder", "file-folder"]);

const MISSING_TOOLTIP = "リンク先が見つかりません（削除されたか、閲覧権限がない可能性があります）";

/** 解決前でも「それらしい」文字を出すための仮ラベル。 */
function fallbackText(ref: InternalLinkRef): string {
  if (ref.kind === "ticket") return `#${ref.id}`;
  if (ref.kind === "sprint") return ref.id;
  if (ref.kind === "project") return ref.projectSlug;
  if (ref.kind === "backlog" || ref.kind === "backlog-folder") return ref.id;
  return INTERNAL_LINK_KIND_LABEL[ref.kind];
}

function chipText(ref: InternalLinkRef, resolved: ResolvedInternalLink | undefined): string {
  const kind = resolved?.kind ?? ref.kind;
  // チケットは WBS 自体が呼び名なので、タイトルではなく #WBS を出す（既存の # メンションと同じ）
  if (kind === "ticket") return `#${ref.id}`;
  if (!resolved || resolved.status !== "ok" || !resolved.label) return fallbackText(ref);
  return `${CHIP_SIGIL[kind] ?? ""}${resolved.label}`;
}

function chipTooltip(ref: InternalLinkRef, resolved: ResolvedInternalLink | undefined, href: string): string {
  if (resolved?.status === "missing") return `${MISSING_TOOLTIP}\n${href}`;
  const kind = resolved?.kind ?? ref.kind;
  const head = INTERNAL_LINK_KIND_LABEL[kind];
  if (resolved?.status === "ok") {
    const title = kind === "ticket" ? `${ref.id} ${resolved.label}` : resolved.label;
    const pj = resolved.projectName ? `（${resolved.projectName}）` : "";
    return `${head}: ${title}${pj}\n${href}`;
  }
  return `${head}\n${href}`;
}

/** 解決結果を購読して、確定したタイミングで描き直す。 */
function useResolvedInternalLink(ref: InternalLinkRef | null): ResolvedInternalLink | undefined {
  const key = ref ? internalLinkKey(ref) : "";
  const [, bump] = useState(0);

  useEffect(() => {
    if (!ref) return;
    let alive = true;
    const unsubscribe = subscribeInternalLinks(() => { if (alive) bump(n => n + 1); });
    void resolveInternalLink(ref);
    return () => { alive = false; unsubscribe(); };
    // ref は href から都度作り直されるので、依存はキー文字列で見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return ref ? peekInternalLink(ref) : undefined;
}

function InternalLinkView({ node, editor }: NodeViewProps) {
  const href = (node.attrs.href as string) ?? "";
  const ref = useMemo(() => parseInternalLink(href), [href]);
  const resolved = useResolvedInternalLink(ref);

  if (!ref) {
    // 解析できないものはチップにしない（保険。通常ここには来ない）
    return (
      <NodeViewWrapper as="span">
        <a href={href} target="_blank" rel="noopener noreferrer">{href}</a>
      </NodeViewWrapper>
    );
  }

  const kind = resolved?.kind ?? ref.kind;
  const isMissing = resolved?.status === "missing";
  const className = [
    "internal-link-chip",
    isMissing ? "is-missing" : CHIP_CLASS[kind],
    resolved ? "" : "is-pending",
  ].filter(Boolean).join(" ");

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMissing) return; // 行き先が無いので何もしない（理由はツールチップで出している）
    const h: InternalLinkHandlers = editor.storage[INTERNAL_LINK_NODE_NAME]?.handlers ?? {};

    if (kind === "whiteboard") {
      // 既存のホワイトボード導線をそのまま使う（同じボードを開いていればその場で移動）
      const wb = parseWhiteboardLink(href);
      if (wb) {
        if (requestWhiteboardFocus(wb.boardId, { elementId: wb.elementId, commentId: wb.commentId, replyId: wb.replyId })) return;
        if (h.openPreview) {
          h.openPreview("whiteboard", wb.boardId, {
            elementId: wb.elementId, commentId: wb.commentId, replyId: wb.replyId, projectSlug: wb.projectSlug,
          });
          return;
        }
      }
    }

    if (kind === "ticket" && h.onTicketClick && ref.projectSlug === h.currentProjectSlug && !ref.search) {
      // 同じプロジェクトのチケットは、既存の # メンションと同じく画面内で開く
      h.onTicketClick(ref.id);
      return;
    }

    // バックログ / Wiki / 議事録 / ファイルは右パネルのプレビューへ。
    // 議事録はURLに slug が入ることがあるので、解決済みの正規ID(UUID)を渡す。
    const previewType: PreviewType | null =
      kind === "backlog" ? "backlog"
        : kind === "wiki" ? "wiki"
          : kind === "minute" ? "minute"
            : kind === "file" ? "file"
              : null;
    if (previewType && h.openPreview && resolved?.status === "ok") {
      h.openPreview(previewType, resolved.canonicalId, { projectSlug: ref.projectSlug });
      return;
    }

    if (h.navigate) { h.navigate(buildInternalPath(ref)); return; }
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <NodeViewWrapper as="span" style={{ whiteSpace: "nowrap" }}>
      <a
        className={className}
        href={href}
        title={chipTooltip(ref, resolved, href)}
        contentEditable={false}
        suppressContentEditableWarning
        onClick={handleClick}
      >
        {isMissing && <X className="internal-link-chip-icon" aria-hidden />}
        {!isMissing && FOLDER_KINDS.has(kind) && <FolderOpen className="internal-link-chip-icon" aria-hidden />}
        {chipText(ref, resolved)}
      </a>
    </NodeViewWrapper>
  );
}

// ── リンク → チップ の自動変換 ────────────────────────────────
// StarterKit の autolink が付けた link マークのうち、DevTicket 内リンクを指しているものを
// チップノードへ置き換える。autolink は「打ち終わり（空白/改行）」でしか動かないので、
// URLを打っている途中に部分一致でチップ化してしまう事故は起きない。
interface ConvertRange { from: number; to: number; href: string }

function collectLinkRanges(state: any): ConvertRange[] {
  const linkType = state.schema.marks.link;
  if (!linkType) return [];
  const ranges: ConvertRange[] = [];
  state.doc.descendants((node: any, pos: number) => {
    if (node.type.spec.code) return false;
    if (!node.isText || !node.text) return;
    const mark = node.marks.find((m: any) => m.type === linkType);
    if (!mark) return;
    const href = mark.attrs.href as string;
    if (!parseInternalLink(href)) return;
    const last = ranges[ranges.length - 1];
    if (last && last.to === pos && last.href === href) last.to = pos + node.nodeSize;
    else ranges.push({ from: pos, to: pos + node.nodeSize, href });
  });
  // 書き手がラベルを付けたリンク（[設計書](URL)）はチップ化しない＝ラベルを消さない
  return ranges.filter(r => linkTextIsBareUrl(state.doc.textBetween(r.from, r.to), r.href));
}

function applyRanges(tr: any, type: any, ranges: ConvertRange[]): boolean {
  if (ranges.length === 0) return false;
  // 後ろから置換すれば、前側の位置がずれない
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    const kind = parseInternalLink(r.href)?.kind;
    if (!kind) continue;
    tr.replaceWith(r.from, r.to, type.create({ href: r.href, kind }));
  }
  // 変換は「打った・貼った」操作と一体のものとして扱う。独立した履歴にすると
  // Ctrl+Z のたびに URL ⇄ チップを往復して抜け出せなくなる。
  tr.setMeta("addToHistory", false);
  tr.setMeta("preventAutolink", true);
  return tr.steps.length > 0;
}

function autoChipPlugin(type: any) {
  return new Plugin({
    key: new PluginKey("internalLinkAutoChip"),
    appendTransaction: (transactions, _oldState, newState) => {
      if (!transactions.some(t => t.docChanged)) return null;
      const ranges = collectLinkRanges(newState);
      if (ranges.length === 0) return null;
      const tr = newState.tr;
      return applyRanges(tr, type, ranges) ? tr : null;
    },
  });
}

// 生URL（リンクマークすら付いていない素の文字列）の取り込み。
// autolink は末尾に空白や改行が来ないと動かないため、「URLを打って、そのまま保存」だと
// 生テキストのまま残ってしまう。フォーカスが外れた時点で拾い直す。
const BARE_URL_RE = /https?:\/\/[^\s<>"'`[\]{}()]+/g;

export function convertInternalUrlsInEditor(editor: Editor | null): void {
  if (!editor || editor.isDestroyed || !editor.isEditable) return;
  const type = editor.schema.nodes[INTERNAL_LINK_NODE_NAME];
  if (!type) return;
  const { state } = editor;
  const codeMark = state.schema.marks.code;
  const linkMark = state.schema.marks.link;
  const ranges: ConvertRange[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isText || !node.text) return;
    if (codeMark && node.marks.some(m => m.type === codeMark)) return;
    // link マークが付いているものは appendTransaction 側が拾う
    if (linkMark && node.marks.some(m => m.type === linkMark)) return;
    for (const m of node.text.matchAll(BARE_URL_RE)) {
      // 文末の句読点はURLに含めない（markdown/parse.ts と同じ方針）
      const raw = m[0].replace(/[.,;:!?]+$/, "");
      if (!parseInternalLink(raw)) continue;
      const from = pos + (m.index ?? 0);
      ranges.push({ from, to: from + raw.length, href: raw });
    }
  });

  const tr = state.tr;
  if (applyRanges(tr, type, ranges)) editor.view.dispatch(tr);
}

export const InternalLinkNode = Node.create({
  name: INTERNAL_LINK_NODE_NAME,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  // Link マークより先に <a> を判定させる（同じ tag を奪い合うため）
  priority: 1000,

  addStorage() {
    return { handlers: {} as InternalLinkHandlers };
  },

  addAttributes() {
    return {
      href: {
        default: "",
        parseHTML: (el) => el.getAttribute("href") ?? "",
        renderHTML: (attrs) => ({ href: attrs.href ?? "" }),
      },
      // 見た目とデバッグのための印。値は href から導出できるので、正としては扱わない
      kind: {
        default: "",
        parseHTML: (el) => parseInternalLink(el.getAttribute("href") ?? "")?.kind ?? "",
        renderHTML: (attrs) => (attrs.kind ? { "data-internal-link": attrs.kind } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[href]",
        // ProseMirror の既定は 50。Link マークの規則より先に評価させる
        priority: 100,
        getAttrs: (el) => {
          const dom = el as HTMLElement;
          const href = dom.getAttribute("href") ?? "";
          const ref = parseInternalLink(href);
          if (!ref) return false; // 内部リンクでなければ従来どおり Link マークに落とす
          // 書き手がラベルを付けたリンクはそのまま（false を返すと次の規則＝Linkマークが拾う）
          if (!linkTextIsBareUrl(dom.textContent ?? "", href)) return false;
          return { href, kind: ref.kind };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const href = (node.attrs.href as string) ?? "";
    // 保存されるHTMLは従来と同じ「生URLのアンカー」。TipTap を通さない描画（Markdown変換・
    // 通知本文・全文検索）は今までどおり動く。
    return [
      "a",
      mergeAttributes({ target: "_blank", rel: "noopener noreferrer" }, HTMLAttributes),
      href,
    ];
  },

  renderText({ node }) {
    return (node.attrs.href as string) ?? "";
  },

  addNodeView() {
    return ReactNodeViewRenderer(InternalLinkView);
  },

  addProseMirrorPlugins() {
    return [autoChipPlugin(this.type)];
  },
});
