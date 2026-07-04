// 本文中の画像URL(Supabase Storage public URL)を1回だけ取得し、
// 各レンダラーが必要とする形（dataUrl / ArrayBuffer / 寸法）に整えて返す。
// 取得失敗(CORS/404等)した画像はスキップし、他の出力を止めない。

export interface LoadedImage {
  url: string;
  dataUrl: string;          // react-pdf / exceljs 用
  base64: string;           // exceljs 用（プレフィックスなし）
  arrayBuffer: ArrayBuffer; // docx 用
  ext: "png" | "jpeg" | "gif" | "bmp"; // exceljs 拡張子表現
  docxType: "png" | "jpg" | "gif" | "bmp"; // docx 型表現
  width: number;
  height: number;
}

function mimeToExt(mime: string): { ext: LoadedImage["ext"]; docxType: LoadedImage["docxType"] } {
  if (/jpe?g/i.test(mime)) return { ext: "jpeg", docxType: "jpg" };
  if (/gif/i.test(mime)) return { ext: "gif", docxType: "gif" };
  if (/bmp/i.test(mime)) return { ext: "bmp", docxType: "bmp" };
  return { ext: "png", docxType: "png" };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => resolve({ width: 1, height: 1 });
    img.src = dataUrl;
  });
}

export async function loadImages(
  urls: string[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<Map<string, LoadedImage>> {
  const uniq = Array.from(new Set(urls.filter(Boolean)));
  const total = uniq.length;
  let loaded = 0;
  onProgress?.(0, total);
  const entries = await Promise.all(uniq.map(async (url): Promise<readonly [string, LoadedImage] | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      const mime = blob.type || "image/png";
      const arrayBuffer = await blob.arrayBuffer();
      const dataUrl = await blobToDataUrl(blob);
      const base64 = dataUrl.split(",")[1] ?? "";
      const { width, height } = await imageSize(dataUrl);
      const { ext, docxType } = mimeToExt(mime);
      return [url, { url, dataUrl, base64, arrayBuffer, ext, docxType, width, height }] as const;
    } catch {
      return null;
    } finally {
      loaded++;
      onProgress?.(loaded, total);
    }
  }));
  const map = new Map<string, LoadedImage>();
  for (const e of entries) if (e) map.set(e[0], e[1]);
  return map;
}

// IR から画像URLを列挙するヘルパ
export function collectImageUrls(blocks: { type: string; url?: string; blocks?: unknown[] }[]): string[] {
  const urls: string[] = [];
  const walk = (bs: any[]) => {
    for (const b of bs) {
      if (b.type === "image" && b.url) urls.push(b.url);
      if (b.type === "blockquote" && Array.isArray(b.blocks)) walk(b.blocks);
    }
  };
  walk(blocks as any[]);
  return urls;
}
