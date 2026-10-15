// ファイルボックスのアップロードをアプリ全体で受け持つ（BRU20-010）。
//
// 以前は FileBoxPage が送信と表示を持っていたため、別の画面へ移ると送信は裏で続くのに
// 表示がどこにも無くなり、失敗も5秒で消えるトーストだけだった。
// ここで1本のキューとして持ち、右下の UploadPanel に進み具合と結果を出す。
// CallProvider を画面遷移で切れない位置に置いているのと同じ考え方で、App の最上位に置く。
//
// ★ 1件ずつ順に送る。送信中に追加されたものは断らずにキューの最後に足す。
// ★ ブラウザを更新すると、選ばれた File は次のページから読み直せないため続きは送れない。
//   送信中は離脱の確認を出し、それでも更新されたら次に開いたときに1回だけ知らせる。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useToast } from "@/app/contexts/ToastContext";
import { emitLinkItemsChanged } from "@/app/lib/linkSuggestSync";
import {
  uploadProjectFile, ensureFolderPath, googleConvertKind, splitFileName, formatFileSize,
  UPLOAD_ABORTED_MSG,
} from "@/app/lib/projectFiles";
import { uploadAsGoogleFile } from "@/app/lib/googleDrive";
import { looksLikeFolder, type UploadEntry } from "@/app/lib/folderUpload";

export const MAX_UPLOAD_FILE_SIZE = 52428800; // 50MB（バケットの file_size_limit と揃える）

// 更新・タブを閉じたときに送り終えていなかったファイル名。次に開いたときに1回だけ知らせて消す
const INTERRUPTED_KEY = "devticket:fileUploadsInterrupted";

export type UploadStatus = "queued" | "uploading" | "done" | "failed" | "canceled";

export interface UploadItem {
  id: number;
  file: File;
  /** フォルダごとのアップロードのときの元の階層（ファイルボックス側にも同じ階層を作る） */
  dirPath: string[];
  projectId: string;
  /** 入れ先のフォルダ（null はルート） */
  folderId: string | null;
  /** Office文書を Google形式に変換して取り込む */
  convert: boolean;
  userName?: string;
  status: UploadStatus;
  /** 送れたバイト数 */
  loaded: number;
  /** 失敗の理由 */
  reason?: string;
  /** やり直しても結果が変わらない失敗（上限超え）は「やり直す」を出さない */
  retryable?: boolean;
}

export type UploadRequest = {
  projectId: string;
  folderId: string | null;
  entries: UploadEntry[];
  convert?: boolean;
  userName?: string;
};

interface UploadContextValue {
  items: UploadItem[];
  /** 送信中または待機中のファイルがある */
  active: boolean;
  enqueue: (req: UploadRequest) => void;
  retry: (id: number) => void;
  cancelAll: () => void;
  /** パネルを閉じる（送信中・待機中が無いときだけ） */
  dismiss: () => void;
  /** 1件以上取り込めたキューが終わったときに呼ばれる（ファイルボックスの一覧の読み直し用） */
  onFinished: (fn: (projectId: string) => void) => () => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUploads(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUploads は UploadProvider の内側で使ってください");
  return ctx;
}

export const isPendingUpload = (it: UploadItem) => it.status === "queued" || it.status === "uploading";

// 何十件も並べるとトーストが画面を埋めるので、先頭数件だけ出して残りは件数で伝える
function summarize(items: string[], head = 3): string {
  return items.length <= head
    ? items.join("、")
    : `${items.slice(0, head).join("、")} ほか ${items.length - head} 件`;
}

type DrainSummary = { ok: number; renamed: string[]; shareFailed: string[]; fellBack: string[] };

export function UploadProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [items, setItems] = useState<UploadItem[]>([]);
  // キューの実体。await をまたいで最新の一覧を読むため、state と別に ref で持つ
  const itemsRef = useRef<UploadItem[]>([]);
  const nextIdRef = useRef(0);
  // BUG-05 キューの処理を2本同時に走らせない
  const runningRef = useRef(false);
  // 送信中のファイルを止めるためのもの（すべて中止）
  const abortRef = useRef<AbortController | null>(null);
  const finishedListenersRef = useRef(new Set<(projectId: string) => void>());

  const commit = useCallback((next: UploadItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  const patch = useCallback((id: number, p: Partial<UploadItem>) => {
    commit(itemsRef.current.map(it => (it.id === id ? { ...it, ...p } : it)));
  }, [commit]);

  const uploadOne = useCallback(async (
    item: UploadItem, folderCache: Map<string, string>, sum: DrainSummary,
  ) => {
    const { id, file: f } = item;
    if (f.size > MAX_UPLOAD_FILE_SIZE) {
      patch(id, { status: "failed", reason: `上限(${formatFileSize(MAX_UPLOAD_FILE_SIZE)})を超えています`, retryable: false });
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    patch(id, { status: "uploading", loaded: 0, reason: undefined });
    // 進み具合の通知は細かく来るので、% が変わったときだけ反映する（一覧の多い画面を描き直しすぎない）
    let lastPct = -1;
    const send = {
      signal: ctrl.signal,
      onProgress: (loaded: number, total: number) => {
        const pct = total > 0 ? Math.floor((loaded / total) * 100) : 100;
        if (pct === lastPct) return;
        lastPct = pct;
        patch(id, { loaded });
      },
    };
    try {
      const parentId = item.dirPath.length > 0
        ? await ensureFolderPath(item.projectId, item.dirPath, item.folderId, item.userName, folderCache)
        : item.folderId;
      if (ctrl.signal.aborted) throw new Error(UPLOAD_ABORTED_MSG);

      // Google形式へ変換して取り込む。対象外の拡張子はそのまま storage へ入れる
      // （画像やPDFを混ぜてドロップされても、そちらは従来どおり動く）。
      const convertKind = item.convert ? googleConvertKind(f.name) : null;
      if (convertKind) {
        const g = await uploadAsGoogleFile(item.projectId, f, convertKind, parentId, send);
        if (!g.converted) {
          // 変換できなかったが、ファイル自体は「そのまま」で保存できている
          sum.fellBack.push(`「${f.name}」（${g.reason}）`);
          if (g.fileName !== f.name) sum.renamed.push(`「${f.name}」→「${g.fileName}」`);
        } else {
          if (g.fileName !== splitFileName(f.name).base) sum.renamed.push(`「${f.name}」→「${g.fileName}」`);
          for (const x of g.failed) sum.shareFailed.push(`${g.fileName} / ${x.name}`);
        }
      } else {
        // 同名でも上書き（新バージョン）にせず、別ファイルとして残す
        const stored = await uploadProjectFile(item.projectId, f, { uniqueName: true, parentId, ...send });
        if (stored !== f.name) sum.renamed.push(`「${f.name}」→「${stored}」`);
      }
      patch(id, { status: "done", loaded: f.size });
      sum.ok++;
    } catch (e) {
      if (ctrl.signal.aborted) {
        patch(id, { status: "canceled" });
        return;
      }
      console.error("[Upload] upload error:", e);
      const reason = e instanceof Error ? e.message : "";
      // 展開に対応していないブラウザでフォルダ自身を拾ってしまったときの説明
      const hint = looksLikeFolder(f) ? "フォルダの中身を読み取れませんでした。中のファイルを選んでください" : "";
      patch(id, { status: "failed", reason: [reason, hint].filter(Boolean).join("。") || "アップロードに失敗しました", retryable: true });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }, [patch]);

  const run = useCallback(async () => {
    // BUG-05 処理中なら何もしない（追加されたものは、走っている処理がそのまま拾う）
    if (runningRef.current) return;
    runningRef.current = true;
    // 同じ階層を何度も引き直さないよう、1回の処理の中で使い回す
    const folderCache = new Map<string, string>();
    const sums = new Map<string, DrainSummary>();
    try {
      for (;;) {
        const next = itemsRef.current.find(it => it.status === "queued");
        if (!next) break;
        let sum = sums.get(next.projectId);
        if (!sum) { sum = { ok: 0, renamed: [], shareFailed: [], fellBack: [] }; sums.set(next.projectId, sum); }
        await uploadOne(next, folderCache, sum);
      }
    } finally {
      runningRef.current = false;
    }

    // 失敗はパネルに残るのでトーストは出さない。それ以外の知らせはまとめて出す
    for (const [projectId, sum] of sums) {
      if (sum.renamed.length > 0) toast(`同名のファイルがあるため名前を変更しました：${summarize(sum.renamed)}`);
      if (sum.shareFailed.length > 0) {
        toast(`Googleファイルを共有できなかった相手がいます：${summarize(sum.shareFailed)}。Googleアカウントをお持ちか確認してください`, "error");
      }
      if (sum.fellBack.length > 0) {
        toast(`Google形式に変換できなかったため、そのまま保存しました：${summarize(sum.fellBack)}`, "error");
      }
      if (sum.ok > 0) {
        emitLinkItemsChanged(projectId, "file"); // 他タブの %サジェストへ即時反映
        for (const fn of finishedListenersRef.current) fn(projectId);
      }
    }
  }, [uploadOne, toast]);

  const enqueue = useCallback((req: UploadRequest) => {
    // BUG-05 同じ File を二重に積まない（確認ダイアログの連打・同じイベントの二重発火）
    const pendingFiles = new Set(itemsRef.current.filter(isPendingUpload).map(it => it.file));
    const added: UploadItem[] = [];
    for (const e of req.entries) {
      if (pendingFiles.has(e.file)) continue;
      pendingFiles.add(e.file);
      added.push({
        id: ++nextIdRef.current, file: e.file, dirPath: e.dirPath,
        projectId: req.projectId, folderId: req.folderId, convert: !!req.convert, userName: req.userName,
        status: "queued", loaded: 0,
      });
    }
    if (added.length === 0) return;
    commit([...itemsRef.current, ...added]);
    void run();
  }, [commit, run]);

  const retry = useCallback((id: number) => {
    const it = itemsRef.current.find(x => x.id === id);
    if (!it || it.status !== "failed" || it.retryable === false) return;
    patch(id, { status: "queued", loaded: 0, reason: undefined });
    void run();
  }, [patch, run]);

  const cancelAll = useCallback(() => {
    // 待機中を先に止めてから送信中を中断する（逆だと、中断の直後に次のファイルへ進んでしまう）
    commit(itemsRef.current.map(it => (it.status === "queued" ? { ...it, status: "canceled" } : it)));
    abortRef.current?.abort();
  }, [commit]);

  const dismiss = useCallback(() => {
    if (itemsRef.current.some(isPendingUpload)) return;
    commit([]);
  }, [commit]);

  const onFinished = useCallback((fn: (projectId: string) => void) => {
    finishedListenersRef.current.add(fn);
    return () => { finishedListenersRef.current.delete(fn); };
  }, []);

  // 前回、送り終える前に更新・タブを閉じられていたら、1回だけ知らせる。
  // ★ 下の「未完了の記録」より先に宣言すること（後だと、読む前に空で消してしまう）
  useEffect(() => {
    let names: string[] = [];
    try {
      const raw = localStorage.getItem(INTERRUPTED_KEY);
      if (raw) names = JSON.parse(raw) as string[];
      localStorage.removeItem(INTERRUPTED_KEY);
    } catch { /* 読めなければ知らせない */ }
    if (Array.isArray(names) && names.length > 0) {
      toast(`前回のアップロードが途中で止まりました：「${names[0]}」${names.length > 1 ? `ほか${names.length - 1}件` : ""}`, "error");
    }
  }, [toast]);

  const pending = items.filter(isPendingUpload);
  const active = pending.length > 0;
  // 進み具合の更新では書き直さない（並びが変わったときだけ）
  const pendingKey = pending.map(it => it.id).join(",");

  // 未完了のファイル名を覚えておく。全部終われば消す
  useEffect(() => {
    try {
      const names = itemsRef.current.filter(isPendingUpload).map(it => it.file.name);
      if (names.length > 0) localStorage.setItem(INTERRUPTED_KEY, JSON.stringify(names));
      else localStorage.removeItem(INTERRUPTED_KEY);
    } catch { /* 保存できなくてもアップロードは続ける */ }
  }, [pendingKey]);

  // 送信中だけ、更新・タブを閉じる前にブラウザ標準の確認を出す
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  // 全部終わって失敗が無ければ、数秒後にパネルを閉じる。失敗が残っていれば × まで出したまま
  const hasFailed = items.some(it => it.status === "failed");
  useEffect(() => {
    if (items.length === 0 || active || hasFailed) return;
    const t = setTimeout(() => commit([]), 4000);
    return () => clearTimeout(t);
  }, [items.length, active, hasFailed, commit]);

  const value = useMemo<UploadContextValue>(() => ({
    items, active, enqueue, retry, cancelAll, dismiss, onFinished,
  }), [items, active, enqueue, retry, cancelAll, dismiss, onFinished]);

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}
