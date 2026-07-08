// ENHA2-030 画面共有 — 座標正規化ヘルパ。
// 共有映像は端末ごとに表示サイズが異なり、object-fit:contain でレターボックス(余白)が出る。
// ポインター/アノテーションは画素座標ではなく「映像フレーム基準の正規化座標[0,1]」でやり取りし、
// 送り手と受け手の解像度・ウィンドウサイズが違っても同じ位置を指せるようにする。

export interface Rect { left: number; top: number; width: number; height: number; }

// video 要素内で実際に映像が描画されている矩形(contain した実描画領域、レターボックス除外)。
// video 要素の左上を原点とする px 座標で返す。
export function contentRect(video: HTMLVideoElement): Rect | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const ew = video.clientWidth;
  const eh = video.clientHeight;
  if (!vw || !vh || !ew || !eh) return null;
  const scale = Math.min(ew / vw, eh / vh);
  const width = vw * scale;
  const height = vh * scale;
  return { left: (ew - width) / 2, top: (eh - height) / 2, width, height };
}

// クライアント座標(clientX/Y) → 正規化座標。映像描画領域の外なら null。
export function toNorm(video: HTMLVideoElement, clientX: number, clientY: number): { nx: number; ny: number } | null {
  const cr = contentRect(video);
  if (!cr) return null;
  const box = video.getBoundingClientRect();
  const x = clientX - box.left - cr.left;
  const y = clientY - box.top - cr.top;
  const nx = x / cr.width;
  const ny = y / cr.height;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  return { nx, ny };
}

// 正規化座標 → video 要素左上を原点とする px 座標(オーバーレイ描画用)。
export function fromNorm(cr: Rect | null, nx: number, ny: number): { x: number; y: number } {
  if (!cr) return { x: 0, y: 0 };
  return { x: cr.left + nx * cr.width, y: cr.top + ny * cr.height };
}
