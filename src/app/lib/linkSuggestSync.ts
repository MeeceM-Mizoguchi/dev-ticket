// リンクサジェスト($ / # / @)の候補が変化したことを通知するバス。(BRU5-032)
//
// 背景: wiki/バックログ/議事録/チケットを「別のタブ」で作成しても、
// 既に開いている側のエディタは候補を projectId 依存で1回しか取得しておらず、
// リロードするまで新しい項目が $ 検索に出てこなかった。
//
// ticketSync.ts と同じ発想のローカルバスだが、対象がチケット単体ではなく
// 「プロジェクトの候補一覧」なので別モジュールにしている。
//
//  - 同一ランタイム(Mac/iPad のアプリ内タブ)  → listeners で即時通知
//  - 同一オリジンの別ブラウザタブ              → BroadcastChannel で即時通知
//  - それ以外(別ユーザー・別端末)              → 購読側の visibilitychange/focus 再取得で追随
//
// 別ユーザー間のリアルタイム同期(Supabase realtime)は対象外。

export type LinkItemKind = "ticket" | "backlog" | "wiki" | "minute" | "file";

type Listener = (kind: LinkItemKind) => void;

const listeners = new Map<string, Set<Listener>>(); // key = projectId

const CHANNEL_NAME = "dev-ticket:link-suggest";

let channel: BroadcastChannel | null = null;
let channelReady = false;

function getChannel(): BroadcastChannel | null {
  if (channelReady) return channel;
  channelReady = true;
  if (typeof BroadcastChannel === "undefined") return null; // 未対応環境(古い WebView 等)は A/B の層で吸収する
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e: MessageEvent) => {
      const msg = e.data as { projectId?: string; kind?: LinkItemKind } | null;
      if (!msg?.projectId || !msg.kind) return;
      dispatchLocal(msg.projectId, msg.kind); // 他タブ発 → 再ブロードキャストはしない
    };
  } catch {
    channel = null;
  }
  return channel;
}

function dispatchLocal(projectId: string, kind: LinkItemKind): void {
  const set = listeners.get(projectId);
  if (!set) return;
  // コピーしてから通知(購読解除の同時実行に備える)
  for (const fn of Array.from(set)) fn(kind);
}

// プロジェクトの候補変化を購読する。戻り値で解除。
export function subscribeLinkItems(projectId: string, fn: Listener): () => void {
  getChannel(); // 別タブからの通知を受けられるようにチャンネルを開いておく
  let set = listeners.get(projectId);
  if (!set) {
    set = new Set();
    listeners.set(projectId, set);
  }
  set.add(fn);
  return () => {
    const s = listeners.get(projectId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) listeners.delete(projectId);
  };
}

// 候補になる項目を作成/改題/削除したら呼ぶ。同一ランタイムと他タブの両方へ通知する。
export function emitLinkItemsChanged(projectId: string | null | undefined, kind: LinkItemKind): void {
  if (!projectId) return;
  dispatchLocal(projectId, kind);
  try {
    getChannel()?.postMessage({ projectId, kind });
  } catch {
    // チャンネルが閉じられている等。ローカル通知は済んでいるので握りつぶす
  }
}
