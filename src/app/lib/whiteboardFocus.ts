// リンクで指定されたオブジェクトへキャンバスを移動させる処理。
//
// リンクのIDは Excalidraw の要素ID、または「グループID」（複数選択のリンク）。
// どちらも ?element= に入ってくる（Excalidraw の仕様）ので、両方を解決する。
import { CaptureUpdateAction, getCommonBounds } from "@excalidraw/excalidraw";

export interface FocusTargets {
  elements: any[];
  groupId: string | null;
}

// 見た目に対して余白をどれだけ取るか（1.8 = 対象が画面の約55%を占める）
const PADDING_FACTOR = 1.8;
// 小さな図形へのリンクで極端なズームにならないよう上下限で挟む
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.2;

/**
 * ID から移動対象を解決する。
 *   1) 要素ID完全一致（フレームも同じ扱い）
 *   2) グループID（その グループに属する要素すべて）
 * 見つからなければ null（削除済み or 別ボードのリンク）。
 */
export function resolveFocusTargets(elements: readonly any[], id: string): FocusTargets | null {
  if (!id) return null;
  const live = elements.filter((e: any) => e && !e.isDeleted);

  const byId = live.find((e: any) => e.id === id);
  if (byId) {
    // 図形のラベル(bound text)を直接指している場合は、入れ物の図形へ寄せる方が自然
    const container = byId.containerId ? live.find((e: any) => e.id === byId.containerId) : null;
    return { elements: [container ?? byId], groupId: null };
  }

  const grouped = live.filter((e: any) => Array.isArray(e.groupIds) && e.groupIds.includes(id));
  if (grouped.length) return { elements: grouped, groupId: id };

  return null;
}

/**
 * 対象が画面中央に来るようスクロール/ズームし、選択状態にする。
 *
 * captureUpdate は必ず NEVER。ここを履歴に載せると「リンクで飛んだだけ」が
 * undo の対象になり、直前の編集を戻せなくなる（BRU7-058 と同じ理由）。
 */
export function focusOnTargets(api: any, targets: FocusTargets): void {
  const st = api.getAppState();
  const vw = st.width ?? 0;
  const vh = st.height ?? 0;
  if (!vw || !vh || targets.elements.length === 0) return;

  const [x1, y1, x2, y2] = getCommonBounds(targets.elements as any);
  const bw = Math.max(1, x2 - x1);
  const bh = Math.max(1, y2 - y1);

  const raw = Math.min(vw / (bw * PADDING_FACTOR), vh / (bh * PADDING_FACTOR));
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, raw));

  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;

  const selectedElementIds: Record<string, boolean> = {};
  for (const el of targets.elements) selectedElementIds[el.id] = true;

  api.updateScene({
    appState: {
      ...st,
      scrollX: vw / 2 / zoom - cx,
      scrollY: vh / 2 / zoom - cy,
      zoom: { value: zoom },
      selectedElementIds,
      selectedGroupIds: targets.groupId ? { [targets.groupId]: true } : {},
      selectedLinearElement: null,
      editingGroupId: null,
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}
