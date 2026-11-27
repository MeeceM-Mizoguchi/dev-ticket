// KAIZEN2611-013 WBS画面の「AIで更新」。
//
// 会議の文字起こしなどと一緒に AI へ渡す手順書（APIキーと対象の WBS の sheetId 入り）をコピーする。
// 利用者がやるのは「キーを選ぶ → コピー → 文字起こしと一緒に AI へ貼る」だけ。
// AI は API（GET /api/v1/wbs・POST /api/v1/wbs-proposal）で WBS を読み、変更を「更新の案」として送って URL を返す。
// 利用者がその URL（WBS 画面の比べる画面）で新旧を見比べ、「この内容で反映」を押したときだけ反映される（KAIZEN2611-015）。
//
// キーの選び方と平文の取り出しは「AIで実装」（src/app/components/tickets/AiImplementDialog.tsx）と同じ仕組み。
// 書き込みに使うので、選べるのは権限が「すべて」のキーだけ。手順書の中身は src/app/lib/apiWbsPrompt.ts。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Copy, Loader2, ChevronRight, ChevronDown, KeyRound, Terminal, X } from "lucide-react";
import { isSupabaseEnabled } from "@/lib/supabase";
import { copyText as copyToClipboard } from "@/lib/clipboard";
import { escStack } from "@/app/lib/escStack";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { listApiKeys, createApiKey, revealApiKey, isActiveKey, maskedKey, scopeLabel, canUpdateStatus, type ApiKeyRow } from "@/app/lib/apiKeys";
import { buildWbsUpdatePrompt } from "@/app/lib/apiWbsPrompt";
import type { WbsSheet } from "@/app/types";

const GREEN = "#059669";
const PURPLE = "#7C3AED";

/** この画面から発行するキーの名前と期限。権限は「すべて」固定（WBS の更新に要る） */
const QUICK_KEY_NAME = "WBSのAI更新用";
const QUICK_KEY_DAYS = 90;

export function WbsAiUpdateDialog({ sheet, projectId, projectName, onClose }: {
  sheet: WbsSheet;
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const { userRole } = useAuth();
  const { toast } = useToast();
  const canManage = userRole === "admin" || userRole === "owner";

  useEffect(() => { escStack.push(onClose); return () => escStack.pop(onClose); }, [onClose]);

  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  // どのキーの復号を済ませた（または実行中）か。発行直後のキーは平文が手元にあるので復号を省く
  const revealedForRef = useRef("");

  const [issuing, setIssuing] = useState(false);
  const issuingRef = useRef(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [promptOpen, setPromptOpen] = useState(false);
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);

  // ── 読み込み ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isSupabaseEnabled || !projectId) { setLoading(false); return; }
    let cancelled = false;
    void (async () => {
      const rows = await listApiKeys(projectId);
      if (cancelled) return;
      // 書き込みに使うので「すべて」のキーだけを候補にする（一覧は作成日の降順）
      const usable = rows.filter(k => isActiveKey(k) && canUpdateStatus(k));
      setKeys(usable);
      setSelectedKeyId(usable[0]?.id ?? "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // 選ばれたキーの平文をサーバーで復号して取り出す（AiImplementDialog と同じ仕組み）
  useEffect(() => {
    if (!selectedKeyId) { revealedForRef.current = ""; setRevealedKey(null); setRevealError(null); return; }
    if (revealedForRef.current === selectedKeyId) return;
    revealedForRef.current = selectedKeyId;
    let cancelled = false;
    let done = false;
    setRevealing(true);
    // 前のキーの平文を残したままにすると、復号中に押されたとき別のキー入りでコピーされる
    setRevealedKey(null);
    setRevealError(null);
    void revealApiKey(selectedKeyId).then(result => {
      done = true;
      if (cancelled) return;
      setRevealing(false);
      if (result.ok) { setRevealedKey(result.plainKey); return; }
      setRevealError(result.needsReissue
        ? "このキーは以前の方式で発行されているため、手順書へ埋め込めません。新しく発行し直してください。"
        : result.error);
    });
    return () => {
      cancelled = true;
      if (!done && revealedForRef.current === selectedKeyId) revealedForRef.current = "";
    };
  }, [selectedKeyId]);

  const handleQuickIssue = async () => {
    // BUG-05: state だけだと同じレンダーのハンドラが2回走ったとき両方すり抜け、キーが2本発行される
    if (issuingRef.current) return;
    issuingRef.current = true;
    setIssuing(true);
    setIssueError(null);
    try {
      const result = await createApiKey({ name: QUICK_KEY_NAME, projectId, expiresInDays: QUICK_KEY_DAYS, scope: "full" });
      if (!result.ok) { setIssueError(result.error); return; }
      // 発行直後は平文が手元にあるので、復号の往復を省いてそのまま使う
      revealedForRef.current = result.result.row.id;
      setRevealedKey(result.result.plainKey);
      setRevealing(false);
      setRevealError(null);
      setKeys(prev => [result.result.row, ...prev]);
      setSelectedKeyId(result.result.row.id);
      toast(`APIキー「${QUICK_KEY_NAME}」を発行しました`);
    } finally {
      issuingRef.current = false;
      setIssuing(false);
    }
  };

  // ── 手順書 ────────────────────────────────────────────────────
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const prompt = useMemo(() => buildWbsUpdatePrompt({
    baseUrl, projectName, sheetId: sheet.id, sheetName: sheet.name, levels: sheet.levels,
    plainKey: revealedKey ?? undefined,
  }), [baseUrl, projectName, sheet.id, sheet.name, sheet.levels, revealedKey]);

  const selectedKey = keys.find(k => k.id === selectedKeyId) ?? null;
  const keyEmbedded = !!revealedKey;
  /**
   * コピーできない理由。null ならコピーできる。
   * キーを1本も見られない人（管理者以外。RLS で一覧が空になる）は、キー欄を空にした手順書をコピーできる。
   */
  const blockedReason: string | null =
    loading || revealing ? "キーを読み込んでいます…"
      : selectedKey && !revealedKey ? (revealError ?? "キーを読み込めませんでした")
        : null;

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(prompt);
    if (ok) {
      toast(keyEmbedded ? "手順をコピーしました（APIキー入り）。文字起こしと一緒にAIへ貼り付けてください" : "手順をコピーしました。文字起こしと一緒にAIへ貼り付けてください");
      setManualCopyText(null);
    } else {
      setManualCopyText(prompt);
      toast("自動コピーできませんでした。下のテキストを手動でコピーしてください", "error");
    }
  }, [prompt, keyEmbedded, toast]);

  // ── 描画 ──────────────────────────────────────────────────────
  const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 7 };

  const issueButton = canManage && (
    <button type="button" onClick={() => void handleQuickIssue()} disabled={issuing}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700,
        color: GREEN, background: "#FFFFFF", border: `1px solid ${GREEN}55`, borderRadius: 9,
        cursor: issuing ? "not-allowed" : "pointer", opacity: issuing ? 0.6 : 1,
      }}>
      {issuing ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} /> : <KeyRound style={{ width: 13, height: 13 }} />}
      {issuing ? "発行中…" : `権限「すべて」のキーを発行する（${QUICK_KEY_DAYS}日間有効）`}
    </button>
  );

  const renderKeySection = () => {
    if (loading) {
      return (
        <p style={{ fontSize: 11.5, color: "#9E9690", display: "flex", alignItems: "center", gap: 6 }}>
          <Loader2 className="animate-spin" style={{ width: 13, height: 13, color: GREEN }} />APIキーを読み込んでいます…
        </p>
      );
    }
    if (keys.length === 0) {
      return (
        <div style={{ padding: "12px 14px", background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.22)", borderRadius: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#92400E" }}>
            {canManage ? "WBS を更新できるAPIキー（権限「すべて」）がまだありません" : "APIキーは管理者だけが参照できます"}
          </p>
          <p style={{ fontSize: 11.5, color: "#6B6458", marginTop: 5, lineHeight: 1.8 }}>
            {canManage
              ? "AIが WBS を更新するには、権限が「すべて」のキーが必要です。下のボタンで発行できます。"
              : "キーの欄を空にした手順がコピーされます。AIに貼り付けたあと、管理者から受け取った権限が「すべて」のキーに置き換えてください。"}
          </p>
          {canManage && <div style={{ marginTop: 10 }}>{issueButton}</div>}
          {issueError && <p style={{ fontSize: 11.5, color: "#DC2626", marginTop: 8, lineHeight: 1.7 }}>{issueError}</p>}
        </div>
      );
    }
    return (
      <div>
        <select value={selectedKeyId} onChange={e => setSelectedKeyId(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", fontSize: 12.5, color: "#1A1714", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 9, cursor: "pointer" }}>
          {keys.map(k => (
            <option key={k.id} value={k.id}>{maskedKey(k.keyPrefix)}（{k.name}） ／ 権限: {scopeLabel(k.scope)}</option>
          ))}
        </select>
        <p style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.7, color: revealError ? "#DC2626" : keyEmbedded ? GREEN : "#B0A9A4", display: "flex", alignItems: "flex-start", gap: 5 }}>
          {revealing
            ? <><Loader2 className="animate-spin" style={{ width: 12, height: 12, color: GREEN, flexShrink: 0, marginTop: 2 }} />キーを読み込んでいます…</>
            : revealError ? `⚠ ${revealError}`
              : keyEmbedded ? "✅ 選択中のキーを埋め込んだ状態でコピーされます。APIキーを別に貼る必要はありません。"
                : "キーを読み込めませんでした。"}
        </p>
        <p style={{ fontSize: 10.5, color: "#9E9690", marginTop: 2, lineHeight: 1.7 }}>
          WBS は、キーを発行した人の権限で読み書きされます（その人がこの WBS を編集できる必要があります）。
        </p>
      </div>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,0.35)", backdropFilter: "blur(3px)" }} onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="AIで更新"
        style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", width: "min(94vw, 620px)", maxHeight: "90vh", background: "#FAFAF8", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.22)" }}>
        {/* ヘッダー */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFFFFF", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: "#F5F3FF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Sparkles style={{ width: 16, height: 16, color: PURPLE }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: "#1A1714", letterSpacing: "-0.01em" }}>AIで更新</p>
              <p style={{ fontSize: 11, color: "#9E9690", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>WBS ／ {sheet.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる"
            style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(26,23,20,0.10)", background: "#FFFFFF", cursor: "pointer", color: "#9E9690", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>

        {/* 本文 */}
        <div style={{ padding: "18px 24px 20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 17 }}>
          <p style={{ fontSize: 12.5, color: "#4B4640", lineHeight: 1.8 }}>
            手順をコピーし、<strong>会議の文字起こし（議事録・メモ）と一緒に</strong>AIへ貼り付けてください。
            AIがこの WBS の今の中身を読み、文字起こしで<strong>決まったこと</strong>（日程・担当・進捗・新しい作業）だけを反映します。
          </p>

          <div style={{ padding: "12px 14px", background: "#F5F3FF", border: `1px solid ${PURPLE}22`, borderRadius: 10 }}>
            <p style={{ fontSize: 11.5, fontWeight: 800, color: "#1A1714", marginBottom: 5 }}>AIが行うこと</p>
            <ul style={{ margin: 0, paddingLeft: 17, fontSize: 11.5, color: "#4B4640", lineHeight: 1.85 }}>
              <li>すぐには反映せず「更新の案」として送り、確かめる画面の URL を渡します</li>
              <li>URL を開くと変わる行が新旧で並びます。「この内容で反映」を押すまで WBS は変わりません</li>
              <li>文字起こしに無い日付・担当者は、推測で埋めません</li>
              <li>行の削除はしません（削除は画面で行ってください）</li>
              <li>更新の前の状態は「バックアップ」に残り、「APIで更新する前に保存」から元に戻せます</li>
            </ul>
          </div>

          <div>
            <p style={sectionTitle}>使用するAPIキー</p>
            {renderKeySection()}
          </div>

          <div>
            <button type="button" onClick={() => void handleCopy()} disabled={!!blockedReason}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px",
                fontSize: 12.5, fontWeight: 700, color: "#FFFFFF", background: GREEN, border: "none", borderRadius: 9,
                cursor: blockedReason ? "not-allowed" : "pointer", opacity: blockedReason ? 0.45 : 1, whiteSpace: "nowrap",
              }}>
              <Copy style={{ width: 13, height: 13 }} />
              {keyEmbedded ? "手順をコピー（APIキー入り）" : "手順をコピー"}
            </button>
            {blockedReason && <p style={{ fontSize: 11, color: "#9E9690", marginTop: 7, lineHeight: 1.7 }}>{blockedReason}</p>}
          </div>

          <div style={{ padding: "12px 14px", background: "#F0FDF4", border: `1px solid ${GREEN}22`, borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Terminal style={{ width: 14, height: 14, color: GREEN, flexShrink: 0 }} />
              <p style={{ fontSize: 12, fontWeight: 800, color: "#1A1714" }}>貼り付け先：APIを呼べるAI</p>
            </div>
            <p style={{ fontSize: 11.5, color: "#4B4640", lineHeight: 1.85 }}>
              <strong>Claude Code</strong>・<strong>Cursor</strong>・<strong>Gemini CLI</strong> など、コマンドを実行して Dev Ticket の API を呼べるAIに貼り付けてください。
              ブラウザ版のAI（Claude.ai・ChatGPT など）では、API を呼べないため動きません。
              別のシステムから更新するときは、手順の中の API の説明をそのまま使えます。
            </p>
          </div>

          <div>
            <button type="button" onClick={() => setPromptOpen(v => !v)}
              style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: GREEN }}>
              {promptOpen ? <ChevronDown style={{ width: 13, height: 13 }} /> : <ChevronRight style={{ width: 13, height: 13 }} />}
              手順の中身を表示
            </button>
            {promptOpen && (
              <pre style={{
                marginTop: 8, padding: "12px 14px", maxHeight: 280, overflow: "auto",
                background: "#F7F6F4", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 9,
                fontSize: 10.5, lineHeight: 1.65, fontFamily: "var(--font-mono)",
                color: "#4B4640", whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>{revealedKey ? prompt.split(revealedKey).join(`${maskedKey(selectedKey?.keyPrefix ?? "")}（コピー時は実際のキーが入ります）`) : prompt}</pre>
            )}
          </div>

          {manualCopyText && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#D97706", marginBottom: 5 }}>下のテキストを選択してコピーしてください</p>
              <textarea readOnly value={manualCopyText} onFocus={e => e.currentTarget.select()} autoFocus
                style={{ width: "100%", height: 140, padding: "10px 12px", fontSize: 11, fontFamily: "var(--font-mono)", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 9, color: "#4B4640", resize: "vertical" }} />
            </div>
          )}
        </div>

        {/* フッター */}
        <div style={{ padding: "13px 24px", borderTop: "1px solid rgba(26,23,20,0.07)", background: "#FFFFFF", display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
          <button type="button" onClick={onClose}
            style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 700, color: "#6B6458", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 9, cursor: "pointer" }}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
