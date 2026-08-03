// ナレッジノート: 埋め込み Worker のメインスレッド側ラッパー。
//
// ・Worker は1つだけ生成して使い回す（モデルの再ロードを避ける）
// ・モデルが読めない環境（WebGPU も WASM も不可）では null を返し、
//   呼び出し側はキーワード検索だけで動き続ける＝機能が全滅しない

// multilingual-e5-base（768次元 / q8 で約266MB）。
// small(384次元/113MB) から入れ替えた。small は日本語の技術文書で
// 「データベース≒テーブル≒SQL」を捉えられず、実測でスコアの幅が 3.6pt しかなく
// 上位に無関係な節が並んだ。base では 5.8pt に広がり上位が正しくなる。
// 詳細は supabase/add_knowledge_embedding_768.sql のコメント。
export const EMBEDDING_MODEL = "Xenova/multilingual-e5-base";
export const EMBEDDING_DIM = 768;

/** 1リクエストあたりの本数。多すぎるとWorker側のメモリが跳ねる */
export const EMBED_BATCH_SIZE = 8;

type WorkerOut =
  | { type: "download"; file: string; progress: number }
  | { type: "ready"; device: string }
  | { type: "embedded"; id: number; vectors: number[][] }
  | { type: "error"; id?: number; message: string };

interface Pending {
  resolve: (v: number[][]) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let seq = 0;
let unavailableReason: string | null = null;
const pending = new Map<number, Pending>();
const downloadListeners = new Set<(file: string, progress: number) => void>();

/** モデルのDL進捗を購読する。戻り値を呼ぶと解除 */
export function onModelDownload(fn: (file: string, progress: number) => void): () => void {
  downloadListeners.add(fn);
  return () => downloadListeners.delete(fn);
}

/** この環境で意味検索が使えないと判明している場合、その理由 */
export function getUnavailableReason(): string | null {
  return unavailableReason;
}

function ensureWorker(): Worker | null {
  if (unavailableReason) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined") {
    unavailableReason = "この環境では Web Worker が使えません";
    return null;
  }
  try {
    worker = new Worker(new URL("./embedWorker.ts", import.meta.url), { type: "module" });
  } catch (e) {
    unavailableReason = e instanceof Error ? e.message : String(e);
    return null;
  }

  worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
    const m = ev.data;
    if (m.type === "download") {
      downloadListeners.forEach(fn => fn(m.file, m.progress));
      return;
    }
    if (m.type === "embedded") {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); p.resolve(m.vectors); }
      return;
    }
    if (m.type === "error") {
      const err = new Error(m.message);
      if (typeof m.id === "number") {
        const p = pending.get(m.id);
        if (p) { pending.delete(m.id); p.reject(err); }
      } else {
        // ID を伴わないエラー = モデルロード失敗。以後この環境では諦める
        unavailableReason = m.message;
        pending.forEach(p => p.reject(err));
        pending.clear();
      }
    }
  };

  worker.onerror = (ev) => {
    unavailableReason = ev.message || "埋め込みモデルの読み込みに失敗しました";
    const err = new Error(unavailableReason);
    pending.forEach(p => p.reject(err));
    pending.clear();
  };

  return worker;
}

/**
 * モデルを先読みする。画面を開いた時点で呼んでおくと、
 * 検索を押した瞬間から待たせずに済む。
 * 失敗しても例外は投げない（意味検索なしで動作を継続させる）。
 */
export function warmup(): void {
  const w = ensureWorker();
  if (!w) return;
  try { w.postMessage({ type: "warmup" }); } catch { /* 起動できなければ諦める */ }
}

function request(texts: string[]): Promise<number[][]> {
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error(unavailableReason ?? "埋め込みを実行できません"));
  const id = ++seq;
  return new Promise<number[][]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: "embed", id, texts });
  });
}

/**
 * まとめてベクトル化する。EMBED_BATCH_SIZE ごとに分割して進捗を返す。
 * @param onProgress 完了本数 / 総本数
 */
export async function embedAll(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await request(batch);
    out.push(...vectors);
    onProgress?.(Math.min(i + batch.length, texts.length), texts.length);
  }
  return out;
}

/** 1件だけベクトル化する（検索クエリ用） */
export async function embedOne(text: string): Promise<number[]> {
  const [v] = await request([text]);
  return v;
}

/**
 * pgvector が受け取れるテキスト表現へ変換する。
 * RPC は vector 型ではなく text で受けるため（PostgREST が JSON配列を
 * vector へ自動キャストできないため）、ここで文字列にしておく。
 */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.map(v => (Number.isFinite(v) ? v.toFixed(6) : "0")).join(",")}]`;
}
