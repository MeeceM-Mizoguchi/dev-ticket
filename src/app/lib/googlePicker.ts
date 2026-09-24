import { fetchPickerToken } from "@/app/lib/googleDrive";

// Google Picker（保存先フォルダの選択）
//
// drive.file スコープでは drives.list が使えないため、共有ドライブの一覧を
// 自前のプルダウンで出すことができない。かわりに Google 公式の Picker を開いて
// 選んでもらう。
//
// ★ Picker を通すことには、選択UIを出す以上の意味がある。
//   drive.file は「アプリが作ったもの」と「ユーザーが Picker で選んだもの」しか触れない。
//   Picker で選んで初めて、そのフォルダがアプリからアクセスできるようになる。
//   URLやIDを手で貼らせる形にすると、ここが通らず 404 になる。
//
// ★ 選ばせるのは「共有ドライブそのもの」ではなく「共有ドライブの中のフォルダ」。
//   Picker には SHARED_DRIVES という ViewId が存在せず、共有ドライブは
//   中に入るための入れ物としてしか扱えない。ドライブのタイルを選んでも
//   Select ボタンは有効にならないため、必ずフォルダまで降りてもらう必要がある。

const PICKER_SRC = "https://apis.google.com/js/api.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { gapi?: any; google?: any } }

let scriptPromise: Promise<void> | null = null;

/** api.js を1回だけ読み込む（複数回開いても二重に差し込まない） */
function loadPickerScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (window.gapi?.load) { resolve(); return; }
    const el = document.createElement("script");
    el.src = PICKER_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // 次に開いたときに再試行できるよう、失敗したPromiseは残さない
      scriptPromise = null;
      reject(new Error("Google Picker を読み込めませんでした"));
    };
    document.head.appendChild(el);
  }).then(() => new Promise<void>((resolve, reject) => {
    window.gapi.load("picker", {
      callback: () => resolve(),
      onerror: () => { scriptPromise = null; reject(new Error("Google Picker を初期化できませんでした")); },
    });
  }));
  return scriptPromise;
}

export interface PickedFolder {
  id: string;
  name: string;
}

export function isPickerConfigured(): boolean {
  return !!import.meta.env.VITE_GOOGLE_API_KEY;
}

/**
 * 共有ドライブの中のフォルダを選ばせる。
 * @returns 選ばれたフォルダ。キャンセルされたら null
 */
export async function pickSharedFolder(): Promise<PickedFolder | null> {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
  if (!apiKey) throw new Error("VITE_GOOGLE_API_KEY が設定されていません");

  const [{ accessToken }] = await Promise.all([fetchPickerToken(), loadPickerScript()]);
  const picker = window.google?.picker;
  if (!picker) throw new Error("Google Picker を利用できません");

  return new Promise<PickedFolder | null>(resolve => {
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true)
      // 共有ドライブを一覧に出す。ドライブ自体は選べないので、中のフォルダまで降りてもらう
      .setEnableDrives(true);

    const builder = new picker.PickerBuilder()
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setTitle("共有ドライブを開き、保存先フォルダを選択してください")
      .addView(view)
      .setCallback((data: { action: string; docs?: { id: string; name: string }[] }) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name } : null);
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      });

    // Cloud プロジェクト番号。共有ドライブを扱うときに設定が要る
    const appId = import.meta.env.VITE_GOOGLE_APP_ID;
    if (appId) builder.setAppId(appId);

    builder.build().setVisible(true);
  });
}

/**
 * 既存の Driveファイルを選ばせる（ファイルボックスへの取り込み用）。
 *
 * ★ Picker で選ぶこと自体が、drive.file でそのファイルを扱うための許可になる。
 *   選ばれていないファイルは、IDが分かっていてもサーバーから 404 になる。
 *
 * @param fileIds 指定すると、そのファイルだけを表示する（URL を貼って追加する経路）。
 *   URL だけではアプリがファイルに触れないので、貼られたファイルを Picker に出して
 *   1回 Select してもらい、許可を得る。
 * @returns 選ばれたファイルのID。キャンセルされたら空配列
 */
export async function pickGoogleFiles(fileIds?: string[]): Promise<string[]> {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
  if (!apiKey) throw new Error("VITE_GOOGLE_API_KEY が設定されていません");

  const [{ accessToken }] = await Promise.all([fetchPickerToken(), loadPickerScript()]);
  const picker = window.google?.picker;
  if (!picker) throw new Error("Google Picker を利用できません");

  return new Promise<string[]>(resolve => {
    const builder = new picker.PickerBuilder()
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setCallback((data: { action: string; docs?: { id: string }[] }) => {
        if (data.action === picker.Action.PICKED) {
          resolve((data.docs ?? []).map(d => d.id).filter(Boolean));
        } else if (data.action === picker.Action.CANCEL) {
          resolve([]);
        }
      });

    if (fileIds && fileIds.length > 0) {
      // 貼られたURLのファイルだけを出す。種別で絞ると、形式違いのときに
      // 何も表示されず理由が分からなくなるので、ここでは絞らない（種別はサーバーで確かめる）
      //
      // ★ setEnableDrives(true) を付けてはいけない。Google の仕様で、
      //   setEnableDrives は「それ以前の setFileIds / setParent の呼び出しを上書きする」。
      //   付けると貼ったファイルの指定が消え、共有ドライブの一覧が出てしまう（本番で実測）。
      //   共有ドライブ上のファイル向けの Feature.SUPPORT_DRIVES は非推奨なので使わない。
      //
      // NAV_HIDDEN で左のナビゲーション（他のドライブへ移動する欄）を隠し、
      // 「貼ったファイルを確認して Select を押すだけ」の画面にする。
      builder
        .setTitle("追加するファイルを確認して「Select」を押してください")
        .enableFeature(picker.Feature.NAV_HIDDEN)
        .addView(new picker.DocsView(picker.ViewId.DOCS)
          .setFileIds(fileIds.join(",")));
    } else {
      // ★ 種別で絞らない（setMimeTypes を付けない）。Drive にあるものは
      //   Office文書でも PDF でも追加でき、どれも Drive で開く形に揃えているため、
      //   一覧に出ないファイルがあると「なぜか選べない」だけの状態になる。
      //   フォルダは中に入るために出すだけで、選択はできない（setSelectFolderEnabled を付けていない）。
      builder
        .setTitle("ファイルボックスに追加するファイルを選択")
        .enableFeature(picker.Feature.MULTISELECT_ENABLED)
        // マイドライブ・共有アイテム
        .addView(new picker.DocsView(picker.ViewId.DOCS)
          .setIncludeFolders(true))
        // 共有ドライブ。setEnableDrives を付けたビューは共有ドライブを出すものなので、
        // マイドライブ用のビューとは分けて、タブを2つ並べる
        .addView(new picker.DocsView(picker.ViewId.DOCS)
          .setIncludeFolders(true)
          .setEnableDrives(true));
    }

    const appId = import.meta.env.VITE_GOOGLE_APP_ID;
    if (appId) builder.setAppId(appId);

    builder.build().setVisible(true);
  });
}

/**
 * Googleドライブ上のファイルの URL からファイルIDを取り出す。
 * Google形式（スプレッドシート等）の編集画面、Drive のファイル画面（Office文書・PDF などはこの形）、
 * draw.io で開いているときの URL に対応する。
 * 対応していない URL なら null（呼び出し側で「このURLは追加できません」と伝える）。
 */
export function parseGoogleFileUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }

  // draw.io で Googleドライブ上の図を開いているときの URL（app.diagrams.net/#G<id>）。
  // ファイルIDは # の後ろに G を付けて載っている
  if (/(^|\.)(diagrams\.net|draw\.io|drawio\.com)$/.test(url.hostname)) {
    const byHash = url.hash.match(/^#G([-\w]{20,})/);
    return byHash ? byHash[1] : null;
  }

  if (!/(^|\.)google\.com$/.test(url.hostname)) return null;

  // docs.google.com/spreadsheets/d/<id>/edit などの形
  const byPath = url.pathname.match(/\/(?:spreadsheets|document|presentation|file)\/d\/([-\w]{20,})/);
  if (byPath) return byPath[1];

  // drive.google.com/open?id=<id> の形
  const byQuery = url.searchParams.get("id");
  if (byQuery && /^[-\w]{20,}$/.test(byQuery)) return byQuery;
  return null;
}
