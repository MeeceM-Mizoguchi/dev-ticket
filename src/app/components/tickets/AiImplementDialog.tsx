// 「AIで実装」モーダル。チケット詳細のヘッダーから開く。
//
// ApiIntegrationDialog（AI にチケットを登録させる）の逆向きで、
// AI にチケットを読み取らせて実装させるための手順書をコピーする。
// 利用者がやるのは「どこまでやるかを選ぶ → コピー → AI に貼る」だけ。
// 本文・画像・コメント・子チケットは、AI が API（GET /api/v1/ticket）で自分で取りに行く。
//
// どこまでやるかは6つのチェックボックスで選ぶ。
//   ・初期値はすべて OFF。「実装」を選ぶまでコピーできない（うっかり全部やらせない）
//   ・前提が揃っていない項目は選べない（「PR作成」だけ ON、のような矛盾を作らせない）
//   ・「マージ」は取り消せないので、ON にするときに確認を1回挟む
// 依存関係と手順書の中身は src/app/lib/apiImplementPrompt.ts が持つ。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Copy, AlertTriangle, Loader2, ChevronRight, ChevronDown, Terminal, KeyRound, Lock } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { copyText as copyToClipboard } from "@/lib/clipboard";
import { escStack } from "@/app/lib/escStack";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import {
  listApiKeys, createApiKey, revealApiKey,
  isActiveKey, maskedKey, scopeLabel, canReadTickets, canUpdateStatus,
  type ApiKeyRow,
} from "@/app/lib/apiKeys";
import {
  IMPLEMENT_STEPS, EMPTY_SELECTION, toggleStep, lockedReason, statusPlan, buildImplementPrompt,
  type ImplementSelection, type ImplementStep,
} from "@/app/lib/apiImplementPrompt";

const GREEN = "#059669";
const PURPLE = "#7C3AED";

/** この画面から発行するキーの名前と期限。権限は「すべて」固定（読み取りとステータス更新の両方に要る） */
const QUICK_KEY_NAME = "AIで実装用";
const QUICK_KEY_DAYS = 90;

export function AiImplementDialog({
  ticket, childCount, projectId, projectName, zIndexBase = 310, onClose,
}: {
  ticket: { wbs: string; title: string; parentId?: string | null };
  /** 開いているチケットの子の数（子チケットなら 0） */
  childCount: number;
  projectId: string;
  projectName: string;
  zIndexBase?: number;
  onClose: () => void;
}) {
  const { userRole } = useAuth();
  const { toast } = useToast();
  const canManage = userRole === "admin" || userRole === "owner";

  const [selection, setSelection] = useState<ImplementSelection>(EMPTY_SELECTION);
  // 「マージ」を ON にする前の確認
  const [mergeConfirm, setMergeConfirm] = useState(false);

  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  // どのキーの復号を済ませた（または実行中）か。発行直後のキーは平文が手元にあるので復号を省く
  const revealedForRef = useRef("");

  const [repo, setRepo] = useState<string | null>(null);
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);

  const [issuing, setIssuing] = useState(false);
  const issuingRef = useRef(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [promptOpen, setPromptOpen] = useState(false);
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);

  // 確認ダイアログが開いている間の ESC は、確認だけを閉じる
  useEffect(() => { escStack.push(onClose); return () => escStack.pop(onClose); }, [onClose]);
  useEffect(() => {
    if (!mergeConfirm) return;
    const close = () => setMergeConfirm(false);
    escStack.push(close);
    return () => escStack.pop(close);
  }, [mergeConfirm]);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const target = useMemo(
    () => ({ isChild: !!ticket.parentId, childCount: ticket.parentId ? 0 : childCount }),
    [ticket.parentId, childCount],
  );

  // ── 読み込み ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isSupabaseEnabled || !projectId) { setLoading(false); return; }
    let cancelled = false;
    void (async () => {
      const [rows, { data: project }] = await Promise.all([
        listApiKeys(projectId),
        // GitHub連携の列（add_github_integration.sql）が無い環境ではエラーになるが、
        // その場合はリポジトリ未登録として手順書を作るだけなので握りつぶしてよい
        supabase!.from("projects").select("github_repo_full_name, github_default_branch").eq("id", projectId).maybeSingle(),
      ]);
      if (cancelled) return;
      const active = rows.filter(isActiveKey);
      setKeys(active);
      // 既定は「すべて」のキー。無ければ読み取れるキー（一覧は作成日の降順）
      const first = active.find(canUpdateStatus) ?? active.find(canReadTickets);
      setSelectedKeyId(first?.id ?? "");
      setRepo((project?.github_repo_full_name as string | null) || null);
      setDefaultBranch((project?.github_default_branch as string | null) || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // 選ばれたキーの平文をサーバーで復号して取り出す（ApiIntegrationDialog と同じ仕組み）
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

  // ── チェックボックス ──────────────────────────────────────────
  const handleToggle = (step: ImplementStep, on: boolean) => {
    if (on && lockedReason(step, selection)) return;
    // マージは取り消せないので、ON にするときだけ確認を挟む
    if (step === "merge" && on) { setMergeConfirm(true); return; }
    setSelection(prev => toggleStep(prev, step, on));
  };

  // ── キー ──────────────────────────────────────────────────────
  const selectedKey = keys.find(k => k.id === selectedKeyId) ?? null;
  const readableKeys = keys.filter(canReadTickets);

  /** 選んだ範囲に対して、いまのキーで足りないこと。足りていれば null */
  const keyProblem: string | null = (() => {
    if (!selectedKey) return null;
    if (!canReadTickets(selectedKey)) return "このキーは「登録のみ」のため、チケットを読み取れません。";
    if (selection.status && !canUpdateStatus(selectedKey)) {
      return "このキーは「読み取りのみ」のため、ステータスを更新できません。権限が「すべて」のキーを選ぶか、「チケットのステータスの更新」を外してください。";
    }
    return null;
  })();

  const handleQuickIssue = async () => {
    // BUG-05: state だけだと同じレンダーのハンドラが2回走ったとき両方すり抜け、キーが2本発行される
    if (issuingRef.current) return;
    issuingRef.current = true;
    setIssuing(true);
    setIssueError(null);
    try {
      const result = await createApiKey({
        name: QUICK_KEY_NAME, projectId, expiresInDays: QUICK_KEY_DAYS, scope: "full",
      });
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
  const prompt = useMemo(() => buildImplementPrompt({
    baseUrl, projectName, wbs: ticket.wbs, title: ticket.title,
    target, selection, repo, defaultBranch,
    plainKey: revealedKey ?? undefined,
  }), [baseUrl, projectName, ticket.wbs, ticket.title, target, selection, repo, defaultBranch, revealedKey]);

  const keyEmbedded = !!revealedKey && !keyProblem;
  /**
   * コピーできない理由。null ならコピーできる。
   * キーを1本も見られない人（管理者以外。RLS で一覧が空になる）は、キー欄を空にした手順書をコピーできる。
   */
  const blockedReason: string | null =
    !selection.implement ? "「実装」にチェックを入れると、コピーできるようになります"
      : loading || revealing ? "キーを読み込んでいます…"
        : keyProblem ? keyProblem
          : selectedKey && !revealedKey ? (revealError ?? "キーを読み込めませんでした")
            : null;

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(prompt);
    if (ok) {
      toast(keyEmbedded ? "手順をコピーしました（APIキー入り）。AIに貼り付けてください" : "手順をコピーしました。AIに貼り付けてください");
      setManualCopyText(null);
    } else {
      setManualCopyText(prompt);
      toast("自動コピーできませんでした。下のテキストを手動でコピーしてください", "error");
    }
  }, [prompt, keyEmbedded, toast]);

  // ── 描画 ──────────────────────────────────────────────────────
  const renderKeySection = () => {
    if (loading) {
      return (
        <p style={{ fontSize: 11.5, color: "#9E9690", display: "flex", alignItems: "center", gap: 6 }}>
          <Loader2 className="animate-spin" style={{ width: 13, height: 13, color: GREEN }} />APIキーを読み込んでいます…
        </p>
      );
    }

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

    if (readableKeys.length === 0) {
      return (
        <div style={{ padding: "12px 14px", background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.22)", borderRadius: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#92400E" }}>
            {canManage ? "チケットを読み取れるAPIキーがまだありません" : "APIキーは管理者だけが参照できます"}
          </p>
          <p style={{ fontSize: 11.5, color: "#6B6458", marginTop: 5, lineHeight: 1.8 }}>
            {canManage
              ? "これまでのキーは「登録のみ」です。AIがチケットを読み取るには、権限が「読み取りのみ」または「すべて」のキーが必要です。"
              : "キーの欄を空にした手順がコピーされます。AIに貼り付けたあと、管理者から受け取ったキー（権限が「すべて」または「読み取りのみ」のもの）に置き換えてください。"}
          </p>
          {canManage && <div style={{ marginTop: 10 }}>{issueButton}</div>}
          {issueError && <p style={{ fontSize: 11.5, color: "#DC2626", marginTop: 8, lineHeight: 1.7 }}>{issueError}</p>}
        </div>
      );
    }

    return (
      <div>
        <select
          value={selectedKeyId}
          onChange={e => setSelectedKeyId(e.target.value)}
          style={{
            width: "100%", padding: "10px 12px", fontSize: 12.5, color: "#1A1714",
            background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 9, cursor: "pointer",
          }}>
          {readableKeys.map(k => (
            <option key={k.id} value={k.id}>
              {maskedKey(k.keyPrefix)}（{k.name}） ／ 権限: {scopeLabel(k.scope)}
            </option>
          ))}
        </select>
        <p style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.7, color: keyProblem || revealError ? "#DC2626" : keyEmbedded ? GREEN : "#B0A9A4", display: "flex", alignItems: "flex-start", gap: 5 }}>
          {revealing
            ? <><Loader2 className="animate-spin" style={{ width: 12, height: 12, color: GREEN, flexShrink: 0, marginTop: 2 }} />キーを読み込んでいます…</>
            : keyProblem ? `⚠ ${keyProblem}`
              : revealError ? `⚠ ${revealError}`
                : keyEmbedded ? "✅ 選択中のキーを埋め込んだ状態でコピーされます。APIキーを別に貼る必要はありません。"
                  : "キーを読み込めませんでした。"}
        </p>
        {/* ステータス更新を選んだのに「すべて」のキーが無いときは、その場で発行できるようにする */}
        {keyProblem && canManage && !keys.some(canUpdateStatus) && (
          <div style={{ marginTop: 8 }}>
            {issueButton}
            {issueError && <p style={{ fontSize: 11.5, color: "#DC2626", marginTop: 8, lineHeight: 1.7 }}>{issueError}</p>}
          </div>
        )}
      </div>
    );
  };

  const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 7 };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: zIndexBase, background: "rgba(10,14,12,0.35)", backdropFilter: "blur(3px)" }} />

      <div style={{
        position: "fixed", top: "5vh", left: "50%", transform: "translateX(-50%)",
        width: "min(94vw, 620px)", maxHeight: "90vh",
        background: "#FAFAF8", zIndex: zIndexBase + 1, borderRadius: 16,
        boxShadow: "0 24px 80px rgba(0,0,0,0.22)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* ヘッダー */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFFFFF", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: "#F5F3FF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Sparkles style={{ width: 16, height: 16, color: PURPLE }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: "#1A1714", letterSpacing: "-0.01em" }}>AIで実装</p>
              <p style={{ fontSize: 11, color: "#9E9690", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {ticket.wbs} ／ {ticket.title}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(26,23,20,0.10)", background: "#FFFFFF", cursor: "pointer", color: "#9E9690", flexShrink: 0, fontSize: 15, lineHeight: 1 }}>×</button>
        </div>

        {/* 本文 */}
        <div style={{ padding: "18px 24px 20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 17 }}>
          <p style={{ fontSize: 12.5, color: "#4B4640", lineHeight: 1.8 }}>
            どこまでやるかを選んで手順をコピーし、AIに貼り付けてください。
            チケットの本文・画像・コメント{target.childCount > 0 ? <>・<strong>子チケット {target.childCount} 件</strong></> : ""}は、AIが自分で読み取ります。
            <strong>コピーして貼り直す必要はありません。</strong>
          </p>

          {/* どこまでやるか */}
          <div>
            <p style={sectionTitle}>どこまでやりますか（選んだものだけを実行します）</p>
            <div style={{ border: "1px solid rgba(26,23,20,0.10)", borderRadius: 11, overflow: "hidden", background: "#FFFFFF" }}>
              {IMPLEMENT_STEPS.map((s, i) => {
                const checked = selection[s.id];
                const locked = !checked ? lockedReason(s.id, selection) : null;
                return (
                  <label key={s.id} style={{
                    display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 14px",
                    borderTop: i === 0 ? "none" : "1px solid rgba(26,23,20,0.06)",
                    cursor: locked ? "not-allowed" : "pointer",
                    background: checked ? "#F0FDF4" : "#FFFFFF",
                    opacity: locked ? 0.55 : 1,
                  }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!!locked}
                      onChange={e => handleToggle(s.id, e.target.checked)}
                      style={{ width: 16, height: 16, marginTop: 1, accentColor: GREEN, flexShrink: 0, cursor: locked ? "not-allowed" : "pointer" }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 12.5, fontWeight: 700, color: "#1A1714", display: "flex", alignItems: "center", gap: 6 }}>
                        {s.label}
                        {s.id === "merge" && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#B45309", background: "#FFFBEB", padding: "1px 7px", borderRadius: 5 }}>取り消せません</span>
                        )}
                      </p>
                      <p style={{ fontSize: 11, color: "#9E9690", marginTop: 2, lineHeight: 1.65 }}>{s.description}</p>
                      {locked && (
                        <p style={{ fontSize: 10.5, color: "#6B6458", marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
                          <Lock style={{ width: 10, height: 10, flexShrink: 0 }} />{locked}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* ステータスがどこまで進むか。選んだ範囲で変わるので、コピーの前に見せる */}
          {selection.status && (
            <div style={{ padding: "12px 14px", background: "#F5F3FF", border: `1px solid ${PURPLE}22`, borderRadius: 10 }}>
              <p style={{ fontSize: 11.5, fontWeight: 800, color: "#1A1714", marginBottom: 5 }}>この範囲でのステータスの進み方</p>
              <ul style={{ margin: 0, paddingLeft: 17, fontSize: 11.5, color: "#4B4640", lineHeight: 1.85 }}>
                {statusPlan(selection, target).map(line => <li key={line}>{line}</li>)}
              </ul>
              <p style={{ fontSize: 10.5, color: "#9E9690", marginTop: 6, lineHeight: 1.7 }}>
                ステータスは前にしか進みません。レビュアーの指定とレビュー依頼の通知は行われません。
              </p>
            </div>
          )}

          {/* 使用するキー */}
          <div>
            <p style={sectionTitle}>使用するAPIキー</p>
            {renderKeySection()}
          </div>

          {/* コピー */}
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
            {blockedReason && !keyProblem && (
              <p style={{ fontSize: 11, color: "#9E9690", marginTop: 7, lineHeight: 1.7 }}>{blockedReason}</p>
            )}
          </div>

          {/* 貼り付け先 */}
          <div style={{ padding: "12px 14px", background: "#F0FDF4", border: `1px solid ${GREEN}22`, borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Terminal style={{ width: 14, height: 14, color: GREEN, flexShrink: 0 }} />
              <p style={{ fontSize: 12, fontWeight: 800, color: "#1A1714" }}>貼り付け先：対象のリポジトリを開いた、コマンドを実行できるAI</p>
            </div>
            <p style={{ fontSize: 11.5, color: "#4B4640", lineHeight: 1.85 }}>
              <strong>Claude Code</strong>・<strong>Cursor</strong>・<strong>Gemini CLI</strong> などで、
              {repo ? <>リポジトリ <code style={{ fontFamily: "var(--font-mono)", color: "#1A1714" }}>{repo}</code> </> : "実装するリポジトリ"}を開いた状態で貼り付けてください。
              ブランチ・コミット・PR・マージは、AIが手元の <code style={{ fontFamily: "var(--font-mono)" }}>git</code> と <code style={{ fontFamily: "var(--font-mono)" }}>gh</code> で行います。
              ブラウザ版のAI（Claude.ai・ChatGPT など）では動きません。
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
              <p style={{ fontSize: 11, fontWeight: 700, color: "#D97706", marginBottom: 5 }}>
                下のテキストを選択してコピーしてください
              </p>
              <textarea
                readOnly
                value={manualCopyText}
                onFocus={e => e.currentTarget.select()}
                autoFocus
                style={{
                  width: "100%", height: 140, padding: "10px 12px", fontSize: 11,
                  fontFamily: "var(--font-mono)", border: "1px solid rgba(26,23,20,0.14)",
                  borderRadius: 9, color: "#4B4640", resize: "vertical",
                }}
              />
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

      {/* マージの確認 */}
      {mergeConfirm && (
        <>
          <div onClick={() => setMergeConfirm(false)} style={{ position: "fixed", inset: 0, zIndex: zIndexBase + 10, background: "rgba(10,14,12,0.35)" }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            width: "min(92vw, 440px)", background: "#FFFFFF", zIndex: zIndexBase + 11, borderRadius: 14,
            boxShadow: "0 24px 80px rgba(0,0,0,0.24)", padding: "20px 22px",
          }}>
            <p style={{ fontSize: 13.5, fontWeight: 800, color: "#1A1714", display: "flex", alignItems: "center", gap: 7 }}>
              <AlertTriangle style={{ width: 15, height: 15, color: "#D97706" }} />マージまでAIに任せますか
            </p>
            <p style={{ fontSize: 12, color: "#4B4640", marginTop: 10, lineHeight: 1.85 }}>
              マージは取り消せません。AIは CI のチェックが通ったことを確かめてからマージしますが、
              <strong>人のレビューを挟まずに {defaultBranch ?? "ベースブランチ"} へ入ります。</strong>
            </p>
            <p style={{ fontSize: 11.5, color: "#6B6458", marginTop: 8, lineHeight: 1.8 }}>
              チェックの失敗・コンフリクト・レビュー必須の設定がある場合、AIはマージせずに止まります。
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <button type="button" onClick={() => setMergeConfirm(false)}
                style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 700, color: "#6B6458", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 9, cursor: "pointer" }}>
                キャンセル
              </button>
              <button type="button"
                onClick={() => { setSelection(prev => toggleStep(prev, "merge", true)); setMergeConfirm(false); }}
                style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 9, cursor: "pointer" }}>
                マージまで任せる
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
