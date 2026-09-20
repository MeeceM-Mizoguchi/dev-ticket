import { useCallback, useEffect, useRef, useState } from "react";
import { HardDrive, AlertTriangle, Check, Loader2, FolderOpen } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import {
  fetchGoogleDriveStatus, startGoogleOAuth, disconnectGoogle, testGoogleConnection,
  resolveGoogleFolder, type GoogleDriveMode,
} from "@/app/lib/googleDrive";
import { pickSharedFolder, isPickerConfigured } from "@/app/lib/googlePicker";

// Googleドライブ連携の組織設定（docs/google-drive-integration-design.md 5.3）

const GOOGLE_ICON = (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 3-2.26 5.54-4.78 7.25l7.73 6c4.51-4.18 7.09-10.36 7.09-17.72z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

const MODES: { value: GoogleDriveMode; label: string; desc: string }[] = [
  { value: "off", label: "使わない", desc: "ファイルボックスに「Googleアプリ」ボタンを出しません" },
  { value: "shared_drive", label: "組織の共有ドライブに保存する", desc: "ファイルの所有者が組織になります。担当者が退職してもファイルは残ります" },
  { value: "my_drive", label: "各メンバーの個人ドライブに保存する", desc: "Google Workspace が無くても使えますが、作成者のアカウントが削除されると開けなくなります" },
];

interface Props {
  isAdmin: boolean;
  orgId?: string | null;
}

export function GoogleDriveSetting({ isAdmin, orgId }: Props) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);

  const [mode, setMode] = useState<GoogleDriveMode>("off");
  // driveId は files.list の corpora 指定に使う。実際の保存先の親は folderId。
  const [driveId, setDriveId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);

  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // BUG-05 保存は接続テスト(Drive への往復)を挟むので、ref でガードする
  const savingRef = useRef(false);

  const reload = useCallback(async () => {
    if (!isSupabaseEnabled) { setLoading(false); return; }
    try {
      const status = await fetchGoogleDriveStatus();
      setConnected(status.connected);
      setGoogleEmail(status.googleEmail);
      setConfigured(status.configured);
    } catch {
      setConfigured(false);
    }
    // 組織の設定は、OrgSelector で切り替えた組織のものを直接引く
    if (orgId) {
      const { data } = await supabase!.from("organizations")
        .select("google_drive_mode, google_shared_drive_id, google_shared_folder_id, google_shared_drive_name")
        .eq("id", orgId).maybeSingle();
      setMode((data?.google_drive_mode as GoogleDriveMode) ?? "off");
      setDriveId(data?.google_shared_drive_id ?? null);
      setFolderId(data?.google_shared_folder_id ?? null);
      setFolderName(data?.google_shared_drive_name ?? null);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { reload(); }, [reload]);

  const handlePick = useCallback(async () => {
    setError(null);
    setPicking(true);
    try {
      const picked = await pickSharedFolder();
      if (!picked) return; // キャンセル
      // Picker が返すのはIDと名前だけ。フォルダかどうか・どの共有ドライブかはサーバーで確かめる
      const info = await resolveGoogleFolder(picked.id);
      setFolderId(info.id);
      setFolderName(info.name);
      setDriveId(info.driveId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存先フォルダを選択できませんでした");
    } finally {
      setPicking(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!orgId || !isSupabaseEnabled) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setError(null);
    setSaving(true);
    try {
      // 設定だけ保存できて誰もファイルを開けない状態を作らないための関門。
      // 実際に作成と共有を試し、通ってから保存する。
      if (mode === "shared_drive") {
        if (!folderId) { setError("保存先フォルダを選択してください"); return; }
        await testGoogleConnection(folderId);
      }

      const { error: dbErr } = await supabase!.from("organizations").update({
        google_drive_mode: mode,
        google_shared_drive_id: mode === "shared_drive" ? driveId : null,
        google_shared_folder_id: mode === "shared_drive" ? folderId : null,
        google_shared_drive_name: mode === "shared_drive" ? folderName : null,
      }).eq("id", orgId);
      if (dbErr) throw new Error(dbErr.message);

      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [orgId, mode, driveId, folderId, folderName]);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await disconnectGoogle();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "連携を解除できませんでした");
    } finally {
      setDisconnecting(false);
    }
  }, [reload]);

  if (!isAdmin) return <p style={{ fontSize: 12, color: "#A09790" }}>管理者のみ変更できます。</p>;
  if (!isSupabaseEnabled) return <p style={{ fontSize: 12, color: "#A09790" }}>Supabase未接続のため利用できません。</p>;
  if (loading) return <p style={{ fontSize: 12, color: "#A09790" }}>読み込み中...</p>;

  // サーバー側の環境変数が未設定なら、設定してもらうまで何も操作させない
  if (!configured) {
    return (
      <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <AlertTriangle style={{ width: 15, height: 15, color: "#D97706" }} />
          <p style={{ fontSize: 13, fontWeight: 700, color: "#92400E" }}>Googleドライブ連携はまだ有効化されていません</p>
        </div>
        <p style={{ fontSize: 12, color: "#B45309", lineHeight: 1.8 }}>
          サーバー側に <code style={{ fontFamily: "var(--font-mono)" }}>GOOGLE_CLIENT_ID</code> /
          {" "}<code style={{ fontFamily: "var(--font-mono)" }}>GOOGLE_CLIENT_SECRET</code> が設定されていません。<br />
          設定手順は <code style={{ fontFamily: "var(--font-mono)" }}>docs/google-drive-integration-design.md</code> の「10. セットアップ」を参照してください。
        </p>
      </div>
    );
  }

  const needsDrive = mode === "shared_drive" && !folderId;
  const canSave = !saving && !needsDrive;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Googleアカウントの連携状態 */}
      {connected ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#059669", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Check style={{ width: 11, height: 11, color: "#fff" }} />
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#15803D" }}>Googleアカウント連携済み</span>
              {googleEmail && <span style={{ fontSize: 12, color: "#166534", marginLeft: 8 }}>{googleEmail}</span>}
            </div>
          </div>
          <button onClick={handleDisconnect} disabled={disconnecting}
            style={{ padding: "5px 12px", fontSize: 12, fontWeight: 500, borderRadius: 7, border: "1px solid rgba(220,38,38,0.25)", background: "#FEF2F2", color: "#DC2626", cursor: disconnecting ? "default" : "pointer", opacity: disconnecting ? 0.6 : 1 }}>
            {disconnecting ? "解除中..." : "連携を解除"}
          </button>
        </div>
      ) : (
        <div style={{ background: "#FAFAF8", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "26px 24px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "#fff", border: "1px solid rgba(26,23,20,0.08)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
            {GOOGLE_ICON}
          </div>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", marginBottom: 5, fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>
            Googleアカウントを連携する
          </p>
          <p style={{ fontSize: 12, color: "#6B6458", marginBottom: 20, lineHeight: 1.7, textAlign: "center" }}>
            共有ドライブの選択と設定の保存には、Googleアカウントの連携が必要です。<br />
            DevTicket が作成したファイルのみにアクセスします（他のファイルは見えません）。
          </p>
          <button onClick={() => { void startGoogleOAuth(); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "11px 26px", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "1px solid rgba(26,23,20,0.12)", cursor: "pointer", background: "#fff", color: "#1A1714" }}>
            {GOOGLE_ICON} Googleに接続する
          </button>
        </div>
      )}

      {connected && (
        <>
          {/* 保存先の選択 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {MODES.map(m => (
              <label key={m.value}
                style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 10, cursor: "pointer", background: mode === m.value ? "#ECFDF5" : "#FAFAF8", border: `1px solid ${mode === m.value ? "#A7F3D0" : "rgba(26,23,20,0.07)"}`, transition: "all 0.15s" }}>
                <input type="radio" name="google-drive-mode" value={m.value} checked={mode === m.value}
                  onChange={() => { setMode(m.value); setError(null); }}
                  style={{ marginTop: 2, accentColor: "#059669", cursor: "pointer" }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1A1714" }}>{m.label}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "#A09790", lineHeight: 1.6 }}>{m.desc}</p>

                  {/* 共有ドライブの選択（このモードのときだけ） */}
                  {m.value === "shared_drive" && mode === "shared_drive" && (
                    <div style={{ marginTop: 10 }} onClick={e => e.preventDefault()}>
                      <button type="button" onClick={handlePick} disabled={picking || !isPickerConfigured()}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#fff", color: "#1A1714", cursor: picking ? "wait" : "pointer" }}>
                        {picking
                          ? <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />
                          : <FolderOpen style={{ width: 13, height: 13 }} />}
                        保存先フォルダを選択
                      </button>
                      {folderName && (
                        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#059669", fontWeight: 600 }}>
                          選択中: {folderName}
                        </p>
                      )}
                      {/* 共有ドライブそのものは Picker で選択できない（ViewId に SHARED_DRIVES が無い）。
                          ドライブのタイルを選んでも Select が有効にならないので、操作を明示する */}
                      <p style={{ margin: "8px 0 0", fontSize: 11, color: "#6B6458", lineHeight: 1.7, background: "#F4F5F6", borderRadius: 8, padding: "8px 10px" }}>
                        「Shared drives」から<strong>共有ドライブをダブルクリックで開き、中のフォルダを選んで</strong>ください。
                        共有ドライブ自体は選択できません（Select ボタンが押せません）。
                        フォルダが1つも無い場合は、先にGoogleドライブ側でフォルダを1つ作成してください。
                      </p>
                      {!isPickerConfigured() && (
                        <p style={{ margin: "8px 0 0", fontSize: 11, color: "#B45309", lineHeight: 1.6 }}>
                          <code style={{ fontFamily: "var(--font-mono)" }}>VITE_GOOGLE_API_KEY</code> が未設定のため、フォルダを選択できません。
                        </p>
                      )}
                      {/* 共有ドライブは「中の特定ファイルだけ隠す」ことが原理的にできない。
                          プロジェクト単位より粒度が粗くなることを設定時に伝える */}
                      <p style={{ margin: "8px 0 0", fontSize: 11, color: "#A09790", lineHeight: 1.7 }}>
                        共有ドライブのメンバーは、そのプロジェクトに参加していなくても
                        Googleドライブ側ではファイルを開けます。
                      </p>
                    </div>
                  )}

                  {m.value === "my_drive" && mode === "my_drive" && (
                    <p style={{ margin: "10px 0 0", fontSize: 11, color: "#B45309", lineHeight: 1.7, background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 10px" }}>
                      作成者のGoogleアカウントが削除・無効化されると、ファイルボックスからも開けなくなります。
                      作成時にも同じ注意を表示します。
                    </p>
                  )}
                </div>
              </label>
            ))}
          </div>

          {error && (
            <div style={{ padding: "11px 14px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 10, fontSize: 12, color: "#B91C1C", lineHeight: 1.7 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
            {needsDrive && (
              <span style={{ fontSize: 11, color: "#A09790" }}>保存先フォルダを選択すると保存できます</span>
            )}
            <button onClick={handleSave} disabled={!canSave}
              style={{ padding: "9px 22px", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: canSave ? "pointer" : "not-allowed", background: canSave ? "linear-gradient(135deg,#059669,#047857)" : "#E5E7EB", color: canSave ? "#fff" : "#9CA3AF", letterSpacing: "-0.01em" }}>
              {saved ? "✓ 保存しました" : saving ? "接続を確認中..." : "設定を保存"}
            </button>
          </div>

          <div style={{ display: "flex", gap: 9, padding: "12px 14px", background: "#F4F5F6", borderRadius: 10 }}>
            <HardDrive style={{ width: 14, height: 14, color: "#A09790", flexShrink: 0, marginTop: 2 }} />
            <p style={{ margin: 0, fontSize: 11, color: "#6B6458", lineHeight: 1.8 }}>
              {mode === "shared_drive"
                ? <>ファイルは <code style={{ fontFamily: "var(--font-mono)" }}>{folderName ?? "選択したフォルダ"}/&lt;プロジェクト名&gt;/</code> に作成されます。<br /></>
                : <>ファイルは <code style={{ fontFamily: "var(--font-mono)" }}>マイドライブ/DevTicket/&lt;プロジェクト名&gt;/</code> に作成されます。<br /></>}
              DevTicket でファイルを削除しても、Googleドライブ上のファイルは残ります。
            </p>
          </div>
        </>
      )}
    </div>
  );
}
