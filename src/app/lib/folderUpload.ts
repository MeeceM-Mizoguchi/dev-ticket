// ファイルボックスの「フォルダごとアップロード」。
//
// 【なぜ必要か】
// ブラウザはフォルダをドロップされたとき、DataTransfer.files に
// **フォルダ自身**をサイズ0・type空の File として1件だけ入れてくる（中身は入らない）。
// これをそのまま fetch の body に載せると、OS がディレクトリの読み取りを拒否して
//   net::ERR_ACCESS_DENIED → JS からは "Failed to fetch"
// になり、アップロードが必ず失敗する。エラーが storage への直接 PUT で起きるため、
// 画面には原因の分からないメッセージしか出ない。
//
// フォルダを File として送ってはいけない。ここで webkitGetAsEntry() の
// ディレクトリツリーを歩き、実ファイルだけに展開してから送ること。
//
// 【DataTransfer は同期的に読むこと】
// collectDropEntries() は onDrop ハンドラの中から **await を挟まずに** 呼ぶこと。
// ドロップイベントが終わると DataTransfer の中身は破棄され、後から
// webkitGetAsEntry() を呼んでも null しか返らない。
// この関数は入口で items を同期的に読み終えてから非同期処理へ入る。

/** 1ファイルと、ドロップしたフォルダを基準にした所属フォルダ（ファイル名は含まない） */
export type UploadEntry = { file: File; dirPath: string[] };

/** 一度に受け付ける件数の上限。フォルダを取り違えて数千件走らせない。 */
export const MAX_UPLOAD_ENTRIES = 300;

/** 階層の上限。循環したシンボリックリンクで無限に潜らないための保険。 */
const MAX_DEPTH = 12;

/** OS が勝手に作るメタファイル。アップロードしても意味が無いので黙って捨てる。 */
const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

// File System API (webkitGetAsEntry) の最小限の型。lib.dom の FileSystemEntry は
// ブラウザ間で定義が揺れるため、使う分だけ自前で持つ。
type FsEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file(onOk: (f: File) => void, onErr: (e: unknown) => void): void;
  createReader(): { readEntries(onOk: (e: FsEntry[]) => void, onErr: (e: unknown) => void): void };
};

function isIgnored(name: string): boolean {
  return IGNORED_NAMES.has(name);
}

/**
 * ディレクトリの中身を最後まで読む。
 * readEntries() は1回の呼び出しで最大100件しか返さない（Chrome）。
 * 1回で済ませると101件目以降が黙って消えるので、空になるまで読み続ける。
 */
function readAllEntries(dir: FsEntry): Promise<FsEntry[]> {
  const reader = dir.createReader();
  const acc: FsEntry[] = [];
  return new Promise((resolve, reject) => {
    const next = () => reader.readEntries(batch => {
      if (batch.length === 0) { resolve(acc); return; }
      acc.push(...batch);
      next();
    }, reject);
    next();
  });
}

function entryToFile(entry: FsEntry): Promise<File | null> {
  return new Promise(resolve => entry.file(f => resolve(f), () => resolve(null)));
}

async function walk(entries: FsEntry[], dirPath: string[], out: UploadEntry[]): Promise<void> {
  for (const entry of entries) {
    if (out.length >= MAX_UPLOAD_ENTRIES) return;
    if (isIgnored(entry.name)) continue;
    if (entry.isFile) {
      const file = await entryToFile(entry);
      if (file) out.push({ file, dirPath });
    } else if (entry.isDirectory && dirPath.length < MAX_DEPTH) {
      await walk(await readAllEntries(entry), [...dirPath, entry.name], out);
    }
  }
}

/**
 * ドロップされたものを、フォルダの階層ごとファイル一覧に展開する。
 * ※ onDrop の中から await を挟まずに呼ぶこと（先頭のコメント参照）。
 */
export function collectDropEntries(dataTransfer: DataTransfer): Promise<UploadEntry[]> {
  // ── ここから先の items 参照は同期的に済ませる ──
  const roots: FsEntry[] = [];
  let entriesUsable = false;
  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null })
      .webkitGetAsEntry?.() ?? null;
    if (!entry) { entriesUsable = false; roots.length = 0; break; }
    entriesUsable = true;
    roots.push(entry);
  }
  // 対応していないブラウザは従来どおり files をそのまま使う（フォルダは展開できない）
  if (!entriesUsable) {
    return Promise.resolve(fileListToEntries(dataTransfer.files));
  }

  const out: UploadEntry[] = [];
  return walk(roots, [], out).then(() => out);
}

/** <input type="file"> / webkitdirectory の選択結果を展開する */
export function collectInputEntries(files: FileList | File[]): UploadEntry[] {
  return fileListToEntries(files);
}

function fileListToEntries(files: FileList | File[] | null): UploadEntry[] {
  const out: UploadEntry[] = [];
  for (const file of Array.from(files ?? [])) {
    if (isIgnored(file.name)) continue;
    // webkitdirectory で選ぶと "親フォルダ/子/foo.xlsx" が入る。通常の選択では空文字。
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
    const parts = rel ? rel.split("/").filter(Boolean) : [];
    out.push({ file, dirPath: parts.slice(0, -1) });
    if (out.length >= MAX_UPLOAD_ENTRIES) break;
  }
  return out;
}

/**
 * File がフォルダ（＝中身を読めない）かどうかの推定。
 * 展開に対応していないブラウザで拾ってしまったときに、
 * "Failed to fetch" ではなく理由の分かるメッセージを出すために使う。
 * サイズ0・種別なしは実在する空ファイルとも区別できないため、
 * 判定はアップロードが失敗した後の説明にだけ使うこと。
 */
export function looksLikeFolder(file: File): boolean {
  return file.size === 0 && !file.type;
}
