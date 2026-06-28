// チケット更新のローカル同期(イベントバス)。
//
// Mac/iPad のタブ機能では、同じチケットの詳細パネルを複数タブで
// 開けてしまう。各パネルは自前のローカル state を持つため、片方で
// 保存しても、もう片方は古いまま → 同じフィールドの上書きや配列列の
// ロストアップデートが起きうる。
//
// アプリ内タブは「同一 WebView・同一 JS ランタイム」を共有するので、
// Supabase の realtime を使わずとも、保存時にこのバスへ通知すれば
// 同じチケットを開いている他パネルが即座に再取得できる。
// (別ユーザー間の同期は対象外。それは realtime 案=別チケット)

type Listener = (sourceId: string) => void;

const listeners = new Map<string, Set<Listener>>();

// チケットIDごとに購読する。戻り値で解除。
export function subscribeTicket(ticketId: string, fn: Listener): () => void {
  let set = listeners.get(ticketId);
  if (!set) {
    set = new Set();
    listeners.set(ticketId, set);
  }
  set.add(fn);
  return () => {
    const s = listeners.get(ticketId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) listeners.delete(ticketId);
  };
}

// チケットが更新されたことを通知する。
// sourceId は更新元パネルの識別子。購読側は自分が更新元なら無視する。
export function emitTicketUpdate(ticketId: string, sourceId: string): void {
  const set = listeners.get(ticketId);
  if (!set) return;
  // コピーしてから通知(購読解除の同時実行に備える)
  for (const fn of Array.from(set)) fn(sourceId);
}
