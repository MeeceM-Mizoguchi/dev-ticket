import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown, FileSpreadsheet, FileText, Presentation, Workflow, Loader2, AlertTriangle, FolderInput, Link2,
} from "lucide-react";
import { escStack } from "@/app/lib/escStack";
import { openPendingTab } from "@/app/lib/pendingTab";
import { submitOnEnter } from "@/app/lib/submitKey";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BlockingSpinner } from "@/app/components/shared/BlockingSpinner";
import { GoogleGLogo } from "@/app/components/files/GoogleGLogo";
import {
  createGoogleFile, importGoogleFiles, startGoogleOAuth, myDriveWarningKey, DRAWIO_OPEN_HINT,
  type GoogleDriveProjectConfig,
} from "@/app/lib/googleDrive";
import { pickGoogleFiles, parseGoogleFileUrl } from "@/app/lib/googlePicker";
import { GOOGLE_CREATE_LABEL, KIND_COLOR, type GoogleCreateKind } from "@/app/lib/projectFiles";

// ファイルボックスの「Googleアプリ」ボタン（docs/google-drive-integration-design.md 5.1）
//
// クリックで展開し、次のことができる。
//   ・スプレッドシート / ドキュメント / スライド / draw.io の図を新規作成して別タブで開く
//   ・もともと Drive にあるファイルを追加する（Picker で選ぶ / URL を貼る）
//     種別は問わない。Office文書・PDF・画像なども追加でき、どれも Drive で開く

const ITEMS: { kind: GoogleCreateKind; icon: typeof FileSpreadsheet; color: string }[] = [
  { kind: "spreadsheet", icon: FileSpreadsheet, color: KIND_COLOR.gsheet },
  { kind: "document", icon: FileText, color: KIND_COLOR.gdoc },
  { kind: "presentation", icon: Presentation, color: KIND_COLOR.gslide },
  { kind: "drawio", icon: Workflow, color: KIND_COLOR.drawio },
];

const GOOGLE_ICON = <GoogleGLogo size={14} />;

/** 注意モーダルを挟んでから実行する操作 */
type Action =
  | { type: "create"; kind: GoogleCreateKind }
  /** Picker で選んで追加する */
  | { type: "pick" }
  /** 貼られた URL のファイルを追加する（Picker で1回 Select してもらう） */
  | { type: "url"; fileId: string };

// トーストが画面を埋めないよう、先頭数件だけ出して残りは件数で伝える
function summarize(items: string[], head = 3): string {
  return items.length <= head
    ? items.join("、")
    : `${items.slice(0, head).join("、")} ほか ${items.length - head} 件`;
}

interface Props {
  projectId: string;
  /** 現在開いているフォルダ。DevTicket側の置き場所（Drive側の階層には影響しない） */
  parentId: string | null;
  drive: GoogleDriveProjectConfig;
  userId: string;
  /** 作成・追加の後に一覧を引き直す */
  onCreated: () => void;
  toast: (message: string, kind?: "success" | "error" | "info") => void;
}

export function GoogleAppsButton({ projectId, parentId, drive, userId, onCreated, toast }: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<GoogleCreateKind | null>(null);
  const [importing, setImporting] = useState(false);
  // Picker を閉じた後、サーバーで追加している間だけ true。
  // importing は Picker を開いている間も true なので、大きなぐるぐるの表示には使えない
  // （Picker の手前に幕が来て操作を塞いでしまう）。
  const [savingImport, setSavingImport] = useState(false);
  // 個人ドライブの注意モーダル。作成・追加の「前」に挟む
  const [pending, setPending] = useState<Action | null>(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  // URL を貼って追加するダイアログ
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlText, setUrlText] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  // BUG-05 送信ガード。state はボタンの見た目用で、二重起動を止めるのはこの ref。
  // 作成も追加も同じ ref で守る（どちらかが走っている間は、もう片方も始めさせない）。
  const busyRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 展開中は Esc と外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    escStack.push(close);
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => { escStack.pop(close); document.removeEventListener("mousedown", onDocClick); };
  }, [open]);

  /** 428 = Googleアカウント未連携 / 連携切れ。エラーで終わらせず連携へ誘導する */
  const handleError = useCallback(async (e: unknown, fallback: string) => {
    const err = e as Error & { status?: number };
    if (err?.status === 428) {
      toast("Googleアカウントの連携が必要です。連携画面へ移動します");
      try { await startGoogleOAuth(); } catch { toast("連携を開始できませんでした", "error"); }
      return;
    }
    toast(err?.message || fallback, "error");
  }, [toast]);

  const runCreate = useCallback(async (kind: GoogleCreateKind) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setCreating(kind);

    // 空タブはクリックと同じ実行の中で確保する（理由は pendingTab.ts の冒頭コメント）
    const tab = openPendingTab(
      `${GOOGLE_CREATE_LABEL[kind]}を作成しています`,
      kind === "drawio"
        ? "Googleドライブ上に図を作成し、ファイルの画面を開きます。"
        : "Googleドライブ上にファイルを作成し、編集画面を開きます。",
    );

    try {
      const res = await createGoogleFile(projectId, kind, parentId);
      if (tab) tab.location.href = res.url;
      // ポップアップそのものが禁止されている環境向けの逃げ道
      else toast("別タブを開けませんでした。一覧のファイルをクリックして開いてください", "error");

      if (res.failed.length > 0) {
        toast(`${res.failed.length} 人に共有できませんでした（${summarize(res.failed.map(f => f.name))}）。Googleアカウントをお持ちか確認してください`, "error");
      } else {
        toast(`「${res.fileName}」を作成しました`);
      }
      // draw.io の図は Googleドライブのファイル画面が開く（直接 draw.io を開けない理由は DRAWIO_OPEN_HINT）
      if (kind === "drawio" && tab) toast(DRAWIO_OPEN_HINT, "info");
      onCreated();
    } catch (e) {
      // 作れなかったのに空タブが残ると「何が起きたのか」が分からなくなるので閉じる
      try { tab?.close(); } catch { /* 既に閉じられている場合は無視 */ }
      await handleError(e, "作成に失敗しました");
    } finally {
      busyRef.current = false;
      setCreating(null);
    }
  }, [projectId, parentId, onCreated, toast, handleError]);

  /**
   * 既存の Driveファイルを追加する（種別は問わない）。
   * @param fileIds URL から取り出したID。指定するとそのファイルだけを Picker に出す
   */
  const runImport = useCallback(async (fileIds?: string[]) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setImporting(true);
    try {
      const picked = await pickGoogleFiles(fileIds);
      if (picked.length === 0) return; // Picker を閉じた

      setSavingImport(true);
      const res = await importGoogleFiles(projectId, picked, parentId);

      if (res.imported.length > 0) {
        const copied = res.imported.filter(i => i.copied).length;
        toast(copied > 0
          ? `${res.imported.length} 件を追加しました。うち ${copied} 件は保存先の外にあったためコピーして追加しました。元のファイルは残っているので、今後は DevTicket 側のファイルを編集してください`
          : `${res.imported.length} 件を追加しました`);
        onCreated();
      }
      if (res.failed.length > 0) {
        toast(`${res.failed.length} 件は追加できませんでした：${summarize(res.failed.map(f => `「${f.name}」（${f.reason}）`))}`, "error");
      }
      if (res.shareFailed.length > 0) {
        toast(`共有できなかった相手がいます：${summarize(res.shareFailed.map(f => f.name))}。Googleアカウントをお持ちか確認してください`, "error");
      }
    } catch (e) {
      await handleError(e, "追加に失敗しました");
    } finally {
      busyRef.current = false;
      setImporting(false);
      setSavingImport(false);
    }
  }, [projectId, parentId, onCreated, toast, handleError]);

  const runAction = useCallback((a: Action) => {
    if (a.type === "create") void runCreate(a.kind);
    else if (a.type === "pick") void runImport();
    else void runImport([a.fileId]);
  }, [runCreate, runImport]);

  /** 個人ドライブ運用のときは、所有者が個人になることを先に知らせてから実行する */
  const request = useCallback((a: Action) => {
    setOpen(false);
    const dismissed = (() => {
      try { return localStorage.getItem(myDriveWarningKey(userId)) === "1"; } catch { return false; }
    })();
    if (drive.mode === "my_drive" && !dismissed) {
      setDontShowAgain(false);
      setPending(a);
      return;
    }
    runAction(a);
  }, [drive.mode, userId, runAction]);

  const confirmWarning = useCallback(() => {
    const a = pending;
    if (dontShowAgain) {
      try { localStorage.setItem(myDriveWarningKey(userId), "1"); } catch { /* 保存できなくても続行する */ }
    }
    setPending(null);
    if (a) runAction(a);
  }, [pending, dontShowAgain, userId, runAction]);

  const openUrlDialog = useCallback(() => {
    setOpen(false);
    setUrlText("");
    setUrlError(null);
    setUrlOpen(true);
  }, []);

  const closeUrlDialog = useCallback(() => setUrlOpen(false), []);

  const submitUrl = useCallback(() => {
    const id = parseGoogleFileUrl(urlText);
    if (!id) {
      setUrlError("GoogleドライブのファイルのURLを貼り付けてください（例: https://drive.google.com/file/d/… / https://docs.google.com/spreadsheets/d/…）");
      return;
    }
    setUrlOpen(false);
    request({ type: "url", fileId: id });
  }, [urlText, request]);

  const busy = creating !== null || importing;

  const menuItemStyle = {
    display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px",
    background: "none", border: "none", borderRadius: 7, cursor: "pointer",
    fontSize: 12.5, fontWeight: 600, color: "#1A1714", textAlign: "left" as const,
  };
  const hover = {
    onMouseEnter: (e: ReactMouseEvent) => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; },
    onMouseLeave: (e: ReactMouseEvent) => { (e.currentTarget as HTMLElement).style.background = "none"; },
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {/* 作成中・追加の保存中は、画面の真ん中に大きなぐるぐるを出す */}
      {(creating !== null || savingImport) && (
        <BlockingSpinner label={creating !== null ? `${GOOGLE_CREATE_LABEL[creating]}を作成しています` : "ファイルを追加しています"} />
      )}
      <button onClick={() => setOpen(v => !v)} disabled={busy}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>
        {busy
          ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
          : GOOGLE_ICON}
        Googleアプリ
        <ChevronDown style={{ width: 12, height: 12, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div role="menu"
          style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 400, minWidth: 230, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.12)", padding: 5, overflow: "hidden" }}>
          <p style={{ margin: "4px 8px 4px", fontSize: 10, fontWeight: 700, color: "#B0A9A4", letterSpacing: "0.06em" }}>新規作成</p>
          {ITEMS.map(({ kind, icon: Icon, color }) => (
            <button key={kind} role="menuitem" onClick={() => request({ type: "create", kind })}
              style={menuItemStyle} {...hover}>
              <span style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `${color}14` }}>
                <Icon style={{ width: 13, height: 13, color }} />
              </span>
              {GOOGLE_CREATE_LABEL[kind]}
            </button>
          ))}

          <div role="separator" style={{ height: 1, background: "rgba(26,23,20,0.07)", margin: "5px 4px" }} />

          <p style={{ margin: "4px 8px 4px", fontSize: 10, fontWeight: 700, color: "#B0A9A4", letterSpacing: "0.06em" }}>既存のファイルを追加</p>
          <button role="menuitem" onClick={() => request({ type: "pick" })} style={menuItemStyle} {...hover}>
            <span style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#EFF6FF" }}>
              <FolderInput style={{ width: 13, height: 13, color: "#2563EB" }} />
            </span>
            Googleドライブから選ぶ
          </button>
          <button role="menuitem" onClick={openUrlDialog} style={menuItemStyle} {...hover}>
            <span style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#EFF6FF" }}>
              <Link2 style={{ width: 13, height: 13, color: "#2563EB" }} />
            </span>
            URLを貼って追加
          </button>

          <p style={{ margin: "6px 8px 4px", fontSize: 10.5, color: "#B0A9A4", lineHeight: 1.6 }}>
            {drive.mode === "shared_drive"
              ? `${drive.folderName ?? "共有ドライブ"} の中に保存されます。`
              : "あなたのGoogleドライブに保存されます。"}
            <br />保存先の外にあるファイルは、保存先へコピーして追加します。
            <br />Excel・PDF なども追加できます（開くときはGoogleドライブが開きます）。
          </p>
        </div>
      )}

      {/* ★ ダイアログは document.body へポータルで描く。
          このボタンはファイルボックス上部の固定ヘッダー（position: sticky; z-index: 200）の中にあり、
          その中に描くと、ダイアログの z-index(300) はその塊の中でしか効かない。
          アプリ上部のバー(Topbar, z-index 250)が塊より上に来て、グレーの幕の上に乗ってしまう。
          Topbar は「モーダルは画面の一番外側に z-index 300 以上で描かれる」前提で作られている。 */}
      {urlOpen && createPortal(
        <DialogShell title="URLを貼って追加" size="sm" minHeight={0} onClose={closeUrlDialog}
          footer={<>
            <button type="button" onClick={closeUrlDialog}
              style={{ padding: "8px 16px", background: "#F4F5F6", color: "#1A1714", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer" }}>
              キャンセル
            </button>
            <button type="button" onClick={submitUrl} disabled={!urlText.trim()}
              style={{ padding: "8px 16px", background: urlText.trim() ? "#059669" : "#9CA3AF", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: urlText.trim() ? "pointer" : "not-allowed" }}>
              次へ
            </button>
          </>}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 6 }}>
            GoogleドライブのファイルのURL
          </label>
          <input
            type="url"
            value={urlText}
            onChange={e => { setUrlText(e.target.value); setUrlError(null); }}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            autoFocus
            onKeyDown={submitOnEnter(submitUrl, { enabled: !!urlText.trim(), onCancel: closeUrlDialog })}
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", fontSize: 13, border: `1px solid ${urlError ? "rgba(220,38,38,0.5)" : "rgba(26,23,20,0.15)"}`, borderRadius: 8, outline: "none", fontFamily: "inherit" }}
          />
          {urlError && (
            <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "#DC2626", lineHeight: 1.6 }}>{urlError}</p>
          )}
          {/* URL だけではアプリがファイルを読めない（drive.file の仕様）ので、
              次の画面で Select を押してもらう理由を先に伝えておく */}
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "#A09790", lineHeight: 1.7 }}>
            「次へ」を押すとGoogleの画面にそのファイルが表示されるので、「Select」を押してください。
            DevTicketがそのファイルを扱うための確認です。
          </p>
        </DialogShell>,
        document.body,
      )}

      {/* 上の URL ダイアログと同じ理由で document.body へ描く */}
      {pending && createPortal(
        <DialogShell title="個人のGoogleドライブに保存されます" size="sm" minHeight={0}
          onClose={() => setPending(null)}
          footer={<>
            <button type="button" onClick={() => setPending(null)}
              style={{ padding: "8px 16px", background: "#F4F5F6", color: "#1A1714", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer" }}>
              キャンセル
            </button>
            <button type="button" onClick={confirmWarning}
              style={{ padding: "8px 16px", background: "#059669", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: "pointer" }}>
              {pending.type === "create" ? "作成する" : "続ける"}
            </button>
          </>}>
          <div style={{ display: "flex", gap: 11, padding: "2px 0" }}>
            <AlertTriangle style={{ width: 18, height: 18, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
            <p style={{ margin: 0, fontSize: 12.5, color: "#1A1714", lineHeight: 1.85 }}>
              このプロジェクトの組織には Google Workspace が登録されていません。<br />
              作成・追加したファイルは<strong>あなた個人のGoogleドライブ</strong>に保存され、所有者もあなたになります。<br />
              そのGoogleアカウントが削除・無効化されると、<strong>ファイルボックスからも開けなくなります</strong>。ご注意ください。
            </p>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 12, color: "#6B6458", cursor: "pointer" }}>
            <input type="checkbox" checked={dontShowAgain} onChange={e => setDontShowAgain(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: "#059669", cursor: "pointer" }} />
            次回以降表示しない
          </label>
        </DialogShell>,
        document.body,
      )}
    </div>
  );
}
