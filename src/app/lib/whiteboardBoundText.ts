// 図形内ラベル（バウンドテキスト）が親図形から飛び出したときに、正しい位置へ戻す自己修復。
//
// 症状（BRU5-063）: 図形を移動 → Cmd/Ctrl+Z で戻す、を行うと、図形の中の文字だけが外へはみ出す
// ことがある。onChange 内で複数のヘルパーがそれぞれ updateScene するため、undo/redo 時に
// 「コンテナは元へ戻るがバインドテキストは取り残される」履歴の食い違いが起き得るのが原因。
// Excalidraw は毎tickでバインドテキストを再配置しないため、いちど食い違うと自然回復しない。
//
// そこで onChange の静穏フェーズ（remote/操作中でない・編集中でない）で、テキストの中心が
// コンテナ矩形の外に出ているものだけを検出し、Excalidraw と同じ配置式でコンテナ内へ戻す。
// 「はみ出し（＝明確な不具合）」のときだけ動くので、正常なラベルには一切触れず版差分も出さない。
import { isTableCell } from "./whiteboardTable";

// Excalidraw の BOUND_TEXT_PADDING と一致（left/right/top/bottom 揃え時の内側余白）
const PAD = 5;
const rand = () => Math.floor(Math.random() * 0x7fffffff);

// バインドテキスト t が、コンテナ c 内に収まるべき x/y（Excalidraw の配置式に一致）。
function expectedPos(t: any, c: any): { x: number; y: number } {
  const align = t.textAlign;
  const valign = t.verticalAlign;
  const tw = t.width ?? 0, th = t.height ?? 0;
  const x =
    align === "left" ? c.x + PAD :
    align === "right" ? c.x + c.width - tw - PAD :
    c.x + (c.width - tw) / 2;                 // center（既定）
  const y =
    valign === "top" ? c.y + PAD :
    valign === "bottom" ? c.y + c.height - th - PAD :
    c.y + (c.height - th) / 2;                // middle（既定）
  return { x, y };
}

// テキストの中心がコンテナ矩形の外なら「はみ出し」とみなす。
function hasEscaped(t: any, c: any): boolean {
  const tcx = (t.x ?? 0) + (t.width ?? 0) / 2;
  const tcy = (t.y ?? 0) + (t.height ?? 0) / 2;
  return tcx < c.x || tcx > c.x + c.width || tcy < c.y || tcy > c.y + c.height;
}

/**
 * 親図形から飛び出したバインドテキストをコンテナ内へ戻す。1つでも直したら true。
 * remote反映中・新規描画中・テキスト編集中は何もしない（Excalidraw と取り合いにしない）。
 * 表セルは reflowTables が中央そろえを担うため対象外。
 * @returns updateScene で反映したら true
 */
export function healEscapedBoundText(api: any, remote: boolean, appState?: any): boolean {
  if (remote || appState?.newElement) return false;
  // どれかを編集中は触らない（Excalidraw が配置を管理しているため）
  if (document.querySelector(".excalidraw-wysiwyg")) return false;

  const els = api.getSceneElements() as any[];
  const byId = new Map<string, any>(els.map((e) => [e.id, e]));

  const patch = new Map<string, any>();
  for (const t of els) {
    if (t.type !== "text" || t.isDeleted || !t.containerId) continue;
    const c = byId.get(t.containerId);
    if (!c || c.isDeleted || isTableCell(c)) continue; // 表セルは reflow が担当
    if (!hasEscaped(t, c)) continue;
    const { x, y } = expectedPos(t, c);
    if (Math.abs((t.x ?? 0) - x) < 0.5 && Math.abs((t.y ?? 0) - y) < 0.5) continue;
    patch.set(t.id, { ...t, x, y, version: (t.version ?? 1) + 1, versionNonce: rand() });
  }

  if (!patch.size) return false;
  const next = els.map((e) => patch.get(e.id) ?? e);
  api.updateScene({ elements: next });
  return true;
}
