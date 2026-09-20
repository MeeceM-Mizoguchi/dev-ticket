import { fetchPickerToken } from "@/app/lib/googleDrive";

// Google Picker（共有ドライブの選択）
//
// drive.file スコープでは drives.list が使えないため、共有ドライブの一覧を
// 自前のプルダウンで出すことができない。かわりに Google 公式の Picker を開いて
// 選んでもらう。
//
// ★ Picker を通すことには、選択UIを出す以上の意味がある。
//   drive.file は「アプリが作ったもの」と「ユーザーが Picker で選んだもの」しか触れない。
//   Picker で選んで初めて、その共有ドライブがアプリからアクセスできるようになる。
//   URLを手で貼らせる形にすると、ここが通らず 404 になる。

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

export interface PickedDrive {
  id: string;
  name: string;
}

export function isPickerConfigured(): boolean {
  return !!import.meta.env.VITE_GOOGLE_API_KEY;
}

/**
 * 共有ドライブを選ばせる。
 * @returns 選ばれた共有ドライブ。キャンセルされたら null
 */
export async function pickSharedDrive(): Promise<PickedDrive | null> {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
  if (!apiKey) throw new Error("VITE_GOOGLE_API_KEY が設定されていません");

  const [{ accessToken }] = await Promise.all([fetchPickerToken(), loadPickerScript()]);
  const picker = window.google?.picker;
  if (!picker) throw new Error("Google Picker を利用できません");

  return new Promise<PickedDrive | null>(resolve => {
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true)
      // 共有ドライブを出す。マイドライブ側は選ばせない（保存先は設定で決まるため）
      .setEnableDrives(true);

    const builder = new picker.PickerBuilder()
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setTitle("DevTicket のファイルを保存する共有ドライブを選択")
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
