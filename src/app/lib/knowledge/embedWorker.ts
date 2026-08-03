/// <reference lib="webworker" />
// ナレッジノート: 埋め込み計算の Web Worker。
//
// ここで完結させる理由:
//   ・モデルの推論はメインスレッドを数十〜数百ms単位でブロックするため、UIが固まる
//   ・API を一切使わないので、外部送信もランニングコストも発生しない
//
// モデル: multilingual-e5-base（768次元 / q8量子化 で約266MB）
// LLM(2〜5GB)とは規模が1桁違うため、iPad のメモリにも収まる想定。

import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";

// バンドル同梱のローカルモデルは持たない（必ずリモートから取得してキャッシュさせる）
env.allowLocalModels = false;

// 既定は Hugging Face の CDN。社内FWやCSPで塞がれる環境に備え、
// VITE_KNOWLEDGE_MODEL_HOST を指定すれば自前配信（Supabase Storage 等）へ切り替えられる。
const CUSTOM_HOST = (import.meta as any).env?.VITE_KNOWLEDGE_MODEL_HOST as string | undefined;
if (CUSTOM_HOST) env.remoteHost = CUSTOM_HOST;

export const MODEL_ID = "Xenova/multilingual-e5-base";

type InMsg =
  | { type: "warmup" }
  | { type: "embed"; id: number; texts: string[] };

type OutMsg =
  | { type: "download"; file: string; progress: number }
  | { type: "ready"; device: string }
  | { type: "embedded"; id: number; vectors: number[][] }
  | { type: "error"; id?: number; message: string };

const post = (m: OutMsg) => (self as unknown as Worker).postMessage(m);

let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;
let device = "";

async function load(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  if (loading) return loading;

  loading = (async () => {
    // WebGPU が使えれば桁違いに速い。使えない環境（Safari/WKWebView 等）は WASM に落とす。
    // 落とせなかった場合はここで例外になり、呼び出し側がキーワード検索へフォールバックする。
    const candidates: { device: "webgpu" | "wasm" }[] = [{ device: "webgpu" }, { device: "wasm" }];
    let lastError: unknown = null;

    for (const c of candidates) {
      try {
        const p = await pipeline("feature-extraction", MODEL_ID, {
          device: c.device,
          dtype: "q8",
          progress_callback: (p: any) => {
            if (p?.status === "progress" && p?.file) {
              post({ type: "download", file: String(p.file), progress: Number(p.progress ?? 0) });
            }
          },
        });
        device = c.device;
        extractor = p;
        post({ type: "ready", device: c.device });
        return p;
      } catch (e) {
        lastError = e;
      }
    }
    loading = null;
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  })();

  return loading;
}

/** Tensor(dims=[n, 768]) を number[][] へ展開する */
function toVectors(out: any): number[][] {
  const dims: number[] = out?.dims ?? [];
  const data: ArrayLike<number> = out?.data ?? [];
  if (dims.length !== 2) throw new Error(`unexpected embedding shape: ${JSON.stringify(dims)}`);
  const [n, d] = dims;
  const vectors: number[][] = [];
  for (let i = 0; i < n; i++) {
    const v = new Array<number>(d);
    for (let j = 0; j < d; j++) v[j] = data[i * d + j];
    vectors.push(v);
  }
  return vectors;
}

self.onmessage = async (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  try {
    if (msg.type === "warmup") {
      await load();
      post({ type: "ready", device });
      return;
    }
    if (msg.type === "embed") {
      const model = await load();
      // e5 は mean pooling ＋ 正規化が前提。normalize しておくと
      // コサイン距離が内積と等価になり、pgvector 側も素直に効く。
      const out = await model(msg.texts, { pooling: "mean", normalize: true });
      post({ type: "embedded", id: msg.id, vectors: toVectors(out) });
      return;
    }
  } catch (e) {
    post({
      type: "error",
      id: (msg as any)?.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
