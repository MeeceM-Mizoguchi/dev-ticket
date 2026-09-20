import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, FileSpreadsheet, FileText, Presentation, Loader2, AlertTriangle } from "lucide-react";
import { escStack } from "@/app/lib/escStack";
import { openPendingTab } from "@/app/lib/pendingTab";
import { DialogShell } from "@/app/components/shared/DialogShell";
import {
  createGoogleFile, startGoogleOAuth, myDriveWarningKey,
  type GoogleDriveProjectConfig,
} from "@/app/lib/googleDrive";
import { GOOGLE_APP_LABEL, KIND_COLOR, type GoogleAppKind } from "@/app/lib/projectFiles";

// ファイルボックスの「Googleアプリ」ボタン（docs/google-drive-integration-design.md 5.1）
//
// クリックで スプレッドシート / ドキュメント / スライド を展開し、
// 選ぶとサーバーが Google 上にファイルを作って別タブで開く。

const ITEMS: { kind: GoogleAppKind; icon: typeof FileSpreadsheet; color: string }[] = [
  { kind: "spreadsheet", icon: FileSpreadsheet, color: KIND_COLOR.gsheet },
  { kind: "document", icon: FileText, color: KIND_COLOR.gdoc },
  { kind: "presentation", icon: Presentation, color: KIND_COLOR.gslide },
];

const GOOGLE_ICON = (
  <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 3-2.26 5.54-4.78 7.25l7.73 6c4.51-4.18 7.09-10.36 7.09-17.72z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

interface Props {
  projectId: string;
  /** 現在開いているフォルダ。DevTicket側の置き場所（Drive側の階層には影響しない） */
  parentId: string | null;
  drive: GoogleDriveProjectConfig;
  userId: string;
  /** 作成後に一覧を引き直す */
  onCreated: () => void;
  toast: (message: string, kind?: "success" | "error" | "info") => void;
}

export function GoogleAppsButton({ projectId, parentId, drive, userId, onCreated, toast }: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<GoogleAppKind | null>(null);
  // 個人ドライブの注意モーダル。作成処理の「前」に挟む
  const [pendingKind, setPendingKind] = useState<GoogleAppKind | null>(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // BUG-05 送信ガード。state はボタンの見た目用で、二重起動を止めるのはこの ref。
  // 3種類のボタンが同じ処理を呼ぶので、先に1つのハンドラへ寄せてからガードを付ける。
  const creatingRef = useRef(false);
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

  const runCreate = useCallback(async (kind: GoogleAppKind) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(kind);

    // 空タブはクリックと同じ実行の中で確保する（理由は pendingTab.ts の冒頭コメント）
    const tab = openPendingTab(
      `${GOOGLE_APP_LABEL[kind]}を作成しています`,
      "Googleドライブ上にファイルを作成し、編集画面を開きます。",
    );

    try {
      const res = await createGoogleFile(projectId, kind, parentId);
      if (tab) tab.location.href = res.url;
      // ポップアップそのものが禁止されている環境向けの逃げ道
      else toast("別タブを開けませんでした。一覧のファイルをクリックして開いてください", "error");

      if (res.failed.length > 0) {
        const names = res.failed.slice(0, 3).map(f => f.name).join("、");
        toast(`${res.failed.length} 人に共有できませんでした（${names}${res.failed.length > 3 ? " ほか" : ""}）。Googleアカウントをお持ちか確認してください`, "error");
      } else {
        toast(`「${res.fileName}」を作成しました`);
      }
      onCreated();
    } catch (e) {
      // 作れなかったのに空タブが残ると「何が起きたのか」が分からなくなるので閉じる
      try { tab?.close(); } catch { /* 既に閉じられている場合は無視 */ }
      const err = e as Error & { status?: number };
      // 428 = Googleアカウント未連携 / 連携切れ。エラーで終わらせず連携へ誘導する
      if (err.status === 428) {
        toast("Googleアカウントの連携が必要です。連携画面へ移動します");
        try { await startGoogleOAuth(); } catch { toast("連携を開始できませんでした", "error"); }
        return;
      }
      toast(err.message || "作成に失敗しました", "error");
    } finally {
      creatingRef.current = false;
      setCreating(null);
    }
  }, [projectId, parentId, onCreated, toast]);

  const handlePick = useCallback((kind: GoogleAppKind) => {
    setOpen(false);
    // 個人ドライブ運用のときは、所有者が個人になることを作成前に知らせる
    const dismissed = (() => {
      try { return localStorage.getItem(myDriveWarningKey(userId)) === "1"; } catch { return false; }
    })();
    if (drive.mode === "my_drive" && !dismissed) {
      setDontShowAgain(false);
      setPendingKind(kind);
      return;
    }
    void runCreate(kind);
  }, [drive.mode, userId, runCreate]);

  const confirmWarning = useCallback(() => {
    const kind = pendingKind;
    if (dontShowAgain) {
      try { localStorage.setItem(myDriveWarningKey(userId), "1"); } catch { /* 保存できなくても作成は進める */ }
    }
    setPendingKind(null);
    if (kind) void runCreate(kind);
  }, [pendingKind, dontShowAgain, userId, runCreate]);

  const busy = creating !== null;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
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
          style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 400, minWidth: 200, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.12)", padding: 5, overflow: "hidden" }}>
          {ITEMS.map(({ kind, icon: Icon, color }) => (
            <button key={kind} role="menuitem" onClick={() => handlePick(kind)}
              style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", background: "none", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#1A1714", textAlign: "left" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `${color}14` }}>
                <Icon style={{ width: 13, height: 13, color }} />
              </span>
              {GOOGLE_APP_LABEL[kind]}
            </button>
          ))}
          <p style={{ margin: "4px 8px 4px", fontSize: 10.5, color: "#B0A9A4", lineHeight: 1.5 }}>
            {drive.mode === "shared_drive"
              ? `${drive.folderName ?? "共有ドライブ"} の中に作成されます`
              : "あなたのGoogleドライブに作成されます"}
          </p>
        </div>
      )}

      {pendingKind && (
        <DialogShell title="個人のGoogleドライブに保存されます" size="sm" minHeight={0}
          onClose={() => setPendingKind(null)}
          footer={<>
            <button type="button" onClick={() => setPendingKind(null)}
              style={{ padding: "8px 16px", background: "#F4F5F6", color: "#1A1714", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer" }}>
              キャンセル
            </button>
            <button type="button" onClick={confirmWarning}
              style={{ padding: "8px 16px", background: "#059669", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: "pointer" }}>
              作成する
            </button>
          </>}>
          <div style={{ display: "flex", gap: 11, padding: "2px 0" }}>
            <AlertTriangle style={{ width: 18, height: 18, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
            <p style={{ margin: 0, fontSize: 12.5, color: "#1A1714", lineHeight: 1.85 }}>
              このプロジェクトの組織には Google Workspace が登録されていません。<br />
              作成したファイルは<strong>あなた個人のGoogleドライブ</strong>に保存され、所有者もあなたになります。<br />
              そのGoogleアカウントが削除・無効化されると、<strong>ファイルボックスからも開けなくなります</strong>。ご注意ください。
            </p>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 12, color: "#6B6458", cursor: "pointer" }}>
            <input type="checkbox" checked={dontShowAgain} onChange={e => setDontShowAgain(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: "#059669", cursor: "pointer" }} />
            次回以降表示しない
          </label>
        </DialogShell>
      )}
    </div>
  );
}
