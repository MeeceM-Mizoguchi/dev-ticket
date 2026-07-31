// Mermaid 図の共通コア。テキストエディタ(RichEditor)・記事エクスポート・ホワイトボードの
// 3箇所から共有する。mermaid 本体は重い(数百KB)ため必ず動的 import で遅延ロードし、初期バンドルを
// 肥大させない。描画は securityLevel:'strict'（<script>やイベント属性を除去）でXSSを防ぐ。
//
// - renderMermaid(code): 図の定義文字列 → SVG文字列（失敗時は error）。
// - mermaidSvgToPngDataUrl(svg): SVG → PNG(dataURL)。エクスポートやホワイトボード画像化で使う。
//
// mermaid はグローバル状態を持ち render の同時実行でまれに描画が壊れるため、runExclusive で
// アプリ全体の render 呼び出しを直列化する（1件あたり数ms〜数十msなので実用上の問題はない）。

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;

async function getMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => (mod.default ?? mod) as unknown as MermaidApi);
  }
  return mermaidPromise;
}

// 描画設定。render 直前に呼び出す（render は runExclusive で直列化しているので設定切替のレースはない）。
// - securityLevel:'loose' … <br/> や記号を忠実に描くため。図の作成者はチーム内メンバー前提で、
//   Wiki本文など既存のユーザー投稿HTMLと同じ信頼モデル。この設定でSVGが生成される。
// - fontFamily は指定しない（mermaid既定）。'inherit' にすると計測時(body直下の一時描画)と
//   表示時(エディタ内コンテナ)でフォントが変わり得て、箱幅がズレて矢印/線の位置がずれるため。
// - forRaster=true … PNG化(エクスポート/ホワイトボード画像)向け。foreignObject(HTML)を避けて
//   SVG text にし、WebKit(Safari/Capacitor)でも canvas 描画できるようにする。
// - forRaster=false … 画面プレビュー向け。htmlLabels を使いラベルを忠実に表示する。
function mermaidConfig(forRaster: boolean) {
  return {
    startOnLoad: false,
    securityLevel: "loose",
    theme: "default",
    htmlLabels: !forRaster,
    flowchart: { htmlLabels: !forRaster },
  };
}

// mermaid の render 呼び出しをアプリ全体で直列化するためのミューテックス。
let renderChain: Promise<unknown> = Promise.resolve();
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = renderChain.then(fn, fn);
  // チェーンが reject で止まらないよう握りつぶす（各呼び出し側は next で結果/例外を受け取る）。
  renderChain = next.then(() => undefined, () => undefined);
  return next;
}

let idCounter = 0;

export type MermaidRenderResult = { svg: string } | { error: string };

/**
 * Mermaid 定義文字列を SVG に変換する。パースエラー等は例外にせず { error } で返す。
 */
export async function renderMermaid(code: string, opts: { forRaster?: boolean } = {}): Promise<MermaidRenderResult> {
  const text = (code ?? "").trim();
  if (!text) return { error: "図の定義が空です" };
  return runExclusive(async () => {
    const id = `mermaid-${Date.now()}-${idCounter++}`;
    try {
      const mermaid = await getMermaid();
      mermaid.initialize(mermaidConfig(!!opts.forRaster));
      const { svg } = await mermaid.render(id, text);
      return { svg };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: msg || "図の生成に失敗しました" };
    } finally {
      // mermaid は測定用の一時 DOM を挿入することがある。成功時は自動で除去されるが、
      // 失敗時に残るケースの保険として id/'d'+id のノードを掃除する。
      try {
        document.getElementById(id)?.remove();
        document.getElementById("d" + id)?.remove();
      } catch { /* SSR等でdocument不在なら無視 */ }
    }
  });
}

// SVG の intrinsic サイズを決定し、width/height を明示した SVG 文字列に正規化する。
// mermaid の出力は width="100%" + style="max-width:..." のことがあり、そのままでは
// <img> の naturalWidth が 0 になりラスタライズできないため、viewBox から実寸を割り出す。
function normalizeSvgSize(svg: string): { width: number; height: number; normalized: string } {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const el = doc.documentElement;
    if (el && el.nodeName.toLowerCase() === "svg") {
      const vb = (el.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
      let width = parseFloat(el.getAttribute("width") || "");
      let height = parseFloat(el.getAttribute("height") || "");
      if ((!width || Number.isNaN(width)) && vb.length === 4) width = vb[2];
      if ((!height || Number.isNaN(height)) && vb.length === 4) height = vb[3];
      if (!width || Number.isNaN(width)) width = 800;
      if (!height || Number.isNaN(height)) height = 600;
      el.setAttribute("width", String(width));
      el.setAttribute("height", String(height));
      // max-width 等が残ると <img> の intrinsic サイズを縛るため style を除去
      el.removeAttribute("style");
      const normalized = new XMLSerializer().serializeToString(el);
      return { width, height, normalized };
    }
  } catch { /* パース失敗時は下のフォールバックへ */ }
  return { width: 800, height: 600, normalized: svg };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("SVG画像の読み込みに失敗しました"));
    img.src = src;
  });
}

/**
 * Mermaid の SVG を PNG(dataURL) にラスタライズする。エクスポート(PDF/Word/Excel)と
 * ホワイトボードの画像フォールバックで使用。背景は白で塗る（透過だと Word/PDF で見づらいため）。
 * @param scale 解像度倍率（既定2で高精細）。
 */
export async function mermaidSvgToPngDataUrl(svg: string, scale = 2): Promise<string> {
  const { width, height, normalized } = normalizeSvgSize(svg);
  const blob = new Blob([normalized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d コンテキストを取得できませんでした");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
