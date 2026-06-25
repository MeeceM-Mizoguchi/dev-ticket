import { useRef, useState, useCallback, useEffect } from "react";
import { Image as ImageIcon, X, Copy, CheckCheck } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PlanTooltip } from "./PlanTooltip";

interface Props {
  images: string[];
  onImagesChange: (images: string[]) => void;
  uploadPathPrefix: string;
  readOnly?: boolean;
  maxImages?: number | null;
}

export function ImageAttachments({ images, onImagesChange, uploadPathPrefix, readOnly, maxImages }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const imagesRef = useRef<string[]>(images);
  imagesRef.current = images;

  const uploadImage = useCallback(async (file: Blob): Promise<string> => {
    if (!isSupabaseEnabled) return URL.createObjectURL(file);
    const extMap: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
    const ext = extMap[file.type] ?? "png";
    const path = `${uploadPathPrefix}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { data, error } = await supabase!.storage.from("ticket-images").upload(path, file, { upsert: true, contentType: file.type || "image/png" });
    if (error || !data) return "";
    const { data: urlData } = supabase!.storage.from("ticket-images").getPublicUrl(path);
    return urlData.publicUrl;
  }, [uploadPathPrefix]);

  const addImages = useCallback(async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      if (maxImages !== null && maxImages !== undefined && imagesRef.current.length >= maxImages) break;
      const url = await uploadImage(f);
      if (!url) continue;
      const next = [...imagesRef.current, url];
      imagesRef.current = next;
      onImagesChange(next);
    }
  }, [uploadImage, onImagesChange, maxImages]);

  const removeImage = useCallback((idx: number) => {
    const next = imagesRef.current.filter((_, j) => j !== idx);
    imagesRef.current = next;
    onImagesChange(next);
  }, [onImagesChange]);

  const copyImage = useCallback(async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      let pngBlob: Blob;
      if (blob.type === "image/png") {
        pngBlob = blob;
      } else {
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width; canvas.height = bmp.height;
        canvas.getContext("2d")!.drawImage(bmp, 0, 0);
        pngBlob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png")
        );
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (e) {
      console.error("Failed to copy image:", e);
    }
  }, []);

  useEffect(() => {
    if (readOnly) return;
    const handler = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imgFiles = items.filter(i => i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean) as File[];
      if (imgFiles.length === 0) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT") return;
      // RichEditor(contenteditable)内でのペーストはRichEditor側で処理する
      if (target.closest('[contenteditable="true"]')) return;
      e.preventDefault();
      addImages(imgFiles);
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [readOnly, addImages]);

  return (
    <>
      <div
        onDragOver={readOnly || (maxImages !== null && maxImages !== undefined && images.length >= maxImages) ? undefined : e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={readOnly || (maxImages !== null && maxImages !== undefined && images.length >= maxImages) ? undefined : e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
        onDrop={readOnly || (maxImages !== null && maxImages !== undefined && images.length >= maxImages) ? undefined : e => { e.preventDefault(); setDragOver(false); addImages(e.dataTransfer.files); }}
      >
        {!readOnly && (() => {
          const limitReached = maxImages !== null && maxImages !== undefined && images.length >= maxImages;
          return limitReached ? (
            <PlanTooltip text="現在のプランではこれ以上添付できません" active={true}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1.5px dashed rgba(156,163,175,0.40)", borderRadius: 9, background: "#F3F4F6", cursor: "not-allowed", width: "100%" }}>
                <ImageIcon style={{ width: 13, height: 13, color: "#9CA3AF" }} />
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>画像の上限（{maxImages}枚）に達しました</span>
              </div>
            </PlanTooltip>
          ) : (
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: `1.5px dashed ${dragOver ? "rgba(5,150,105,0.5)" : "rgba(26,23,20,0.10)"}`, borderRadius: 9, cursor: "pointer", background: dragOver ? "rgba(5,150,105,0.04)" : "#FAFAF8", transition: "border-color 0.15s, background 0.15s" }}>
              <ImageIcon style={{ width: 13, height: 13, color: dragOver ? "#059669" : "#B0A9A4" }} />
              <span style={{ fontSize: 12, color: dragOver ? "#059669" : "#B0A9A4" }}>
                {dragOver ? "ドロップして追加" : `クリックして画像を追加、または Ctrl+V / ドラッグ&ドロップ${maxImages ? `（残り${maxImages - images.length}枚）` : ""}`}
              </span>
              <input type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={e => { addImages(e.target.files || []); e.target.value = ""; }} />
            </label>
          );
        })()}
        {images.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {images.map((img, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={img} alt="" onClick={() => setPreviewImg(img)}
                  style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 7, border: "1px solid rgba(26,23,20,0.08)", cursor: "zoom-in" }} />
                {!readOnly && (
                  <>
                    <button onClick={() => copyImage(img)}
                      style={{ position: "absolute", top: -5, right: 15, width: 18, height: 18, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                      title="コピー">
                      {copiedUrl === img ? <CheckCheck style={{ width: 8, height: 8, color: "#4ADE80" }} /> : <Copy style={{ width: 8, height: 8, color: "#FFF" }} />}
                    </button>
                    <button onClick={() => removeImage(i)}
                      style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <X style={{ width: 9, height: 9, color: "#FFF" }} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 画像プレビューモーダル */}
      {previewImg && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setPreviewImg(null)}
        >
          <img src={previewImg} alt="" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8, objectFit: "contain" }} onClick={e => e.stopPropagation()} />
          <button onClick={() => setPreviewImg(null)}
            style={{ position: "absolute", top: 20, right: 20, width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>
      )}
    </>
  );
}
