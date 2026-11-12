// ENHA2-056 ファイルボックスの「同じファイルの最新の版」を選ぶ（サーバー側API共通）。
//
// 高度検索（api/_lib/researchSearch.ts）と、既存ファイルの一括取り出し（api/project-files の extract-text-backfill）が使う。
// fileText.ts（Excel・PDF などの読み取り部品を読み込む）とは分けてある。検索の API が、使わない重い部品まで読み込まないようにするため。

/**
 * 同じファイル（同じフォルダ・同じ名前）の行のうち、最新の版だけを返す。
 * 検索で古い版の文字に当てないために使う（画面 FileBoxPage の isSameFile と同じ見分け方）。
 */
export function latestVersions<T extends { parent_id?: string | null; file_name: string; version?: number | null }>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const key = `${r.parent_id ?? ""}\u0000${r.file_name}`;
    const cur = best.get(key);
    if (!cur || (r.version ?? 0) > (cur.version ?? 0)) best.set(key, r);
  }
  return [...best.values()];
}
