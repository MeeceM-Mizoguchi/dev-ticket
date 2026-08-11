// API連携モーダル。「新規チケット」メニューの「API連携」から開く。
//
// 2つのタブを持つ:
//   ・使い方   … AIに貼り付けるプロンプトをコピーする（毎フェーズ使う）
//   ・APIキー … キーの発行・失効・棚卸し（年に数回しか使わない）
//
// キーの平文は AES-256-GCM で暗号化して保存してある（暗号鍵はサーバー側の環境変数から導出）。
// そのため「使用するキー」で選ぶだけで、サーバーが復号した平文をプロンプトへ埋め込める。
// 利用者がキーを控えて貼り直す必要はない。
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyRound, Plus, Copy, Trash2, AlertTriangle, Sparkles, Loader2,
  ChevronRight, ChevronDown, ShieldCheck, Ban, Terminal, Globe,
} from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { copyText as copyToClipboard } from "@/lib/clipboard";
import { escStack } from "@/app/lib/escStack";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import {
  listApiKeys, createApiKey, revealApiKey, revokeApiKey, deleteApiKey,
  isActiveKey, keyStatus, maskedKey, formatRelative, formatDay,
  type ApiKeyRow,
} from "@/app/lib/apiKeys";
import { buildApiSetupPrompt } from "@/app/lib/apiKeyPrompt";
import { buildApiSample, buildKeySetupSnippet, SAMPLE_LANGS, API_LIMITS, type SampleLang } from "@/app/lib/apiSamples";
import { MD_STATUS_LABELS, MD_PRIORITY_LABELS } from "@/app/lib/mdTickets/parse";

const GREEN = "#059669";
const PURPLE = "#7C3AED";

const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: "30日", days: 30 },
  { label: "90日", days: 90 },
  { label: "1年", days: 365 },
  { label: "無期限", days: null },
];

// コンポーネント外に置く。中で定義すると再レンダーのたびに別コンポーネント扱いになり、
// 配下の input からフォーカスが外れる。
function Btn({ onClick, children, tone = "primary", disabled }: {
  onClick: () => void; children: React.ReactNode; tone?: "primary" | "ghost" | "danger"; disabled?: boolean;
}) {
  const color = tone === "danger" ? "#DC2626" : tone === "ghost" ? "#6B6458" : "#FFFFFF";
  const bg = tone === "danger" ? "#FEF2F2" : tone === "ghost" ? "#FFFFFF" : GREEN;
  const border = tone === "primary" ? "none" : `1px solid ${tone === "danger" ? "rgba(220,38,38,0.25)" : "rgba(26,23,20,0.12)"}`;
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px",
        fontSize: 12.5, fontWeight: 700, color, background: bg, border, borderRadius: 9,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap",
      }}>
      {children}
    </button>
  );
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 11.5, color: "#9E9690", lineHeight: 1.7 }}>{children}</p>;
}

export function ApiIntegrationDialog({
  sprintId, sprintName, projectId, projectName, onClose,
}: {
  sprintId: string;
  sprintName: string;
  projectId?: string;
  projectName: string;
  onClose: () => void;
}) {
  const { userRole } = useAuth();
  const { toast } = useToast();

  const canManage = userRole === "admin" || userRole === "owner";

  const [tab, setTab] = useState<"usage" | "embed" | "keys">("usage");
  /** 「組み込み」タブで表示中のサンプル言語 */
  const [lang, setLang] = useState<SampleLang>("curl");
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [categoryNames, setCategoryNames] = useState<string[]>([]);

  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);
  // 「使用するキー」で選ばれたキーの平文。プロンプトへ埋め込む。
  // 暗号化して保存してあるので、選ぶたびにサーバーへ復号を依頼して取り出す。
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<{ message: string; needsReissue: boolean } | null>(null);

  // 発行フォーム
  const [formOpen, setFormOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formExpiry, setFormExpiry] = useState<number | null>(90);
  const [issuing, setIssuing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 発行直後に大きく見せるための平文（あとから「APIキー」タブでも取り出せる）
  const [issuedKey, setIssuedKey] = useState<{ plain: string; name: string } | null>(null);

  // 失効の確認
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);

  useEffect(() => { escStack.push(onClose); return () => escStack.pop(onClose); }, [onClose]);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const today = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  // ── 読み込み ──────────────────────────────────────────────────
  const reloadKeys = useCallback(async () => {
    if (!projectId) { setKeys([]); setLoading(false); return; }
    const rows = await listApiKeys(projectId);
    setKeys(rows);
    setLoading(false);
    return rows;
  }, [projectId]);

  useEffect(() => {
    if (!isSupabaseEnabled) {
      setLoading(false);
      setLoadError("この環境ではAPI連携をご利用いただけません");
      return;
    }
    if (!projectId) { setLoading(false); return; }

    void (async () => {
      const [{ data: project }, { data: categories }] = await Promise.all([
        supabase!.from("projects").select("members").eq("id", projectId).maybeSingle(),
        supabase!.from("ticket_categories").select("name").eq("project_id", projectId).order("created_at"),
      ]);
      setMemberNames(Array.isArray(project?.members) ? (project!.members as string[]) : []);
      setCategoryNames(Array.isArray(categories) ? categories.map((c: { name: string }) => c.name) : []);
      await reloadKeys();
    })();
  }, [projectId, reloadKeys]);

  const activeKeys = useMemo(() => keys.filter(isActiveKey), [keys]);

  // 既定の選択キー。最後に使ったものではなく、最後に発行したもの（一覧は作成日の降順）
  useEffect(() => {
    if (selectedKeyId && activeKeys.some(k => k.id === selectedKeyId)) return;
    setSelectedKeyId(activeKeys[0]?.id ?? "");
  }, [activeKeys, selectedKeyId]);

  // 選ばれたキーの平文をサーバーで復号して取り出す。
  // 発行直後も選択が切り替わるので一度呼ばれるが、返るのは同じ平文なので実害はない。
  useEffect(() => {
    if (!selectedKeyId) { setRevealedKey(null); setRevealError(null); return; }
    let cancelled = false;
    setRevealing(true);
    setRevealError(null);
    void revealApiKey(selectedKeyId).then(result => {
      if (cancelled) return;
      setRevealing(false);
      if (result.ok) { setRevealedKey(result.plainKey); return; }
      setRevealedKey(null);
      setRevealError({ message: result.error, needsReissue: result.needsReissue });
    });
    return () => { cancelled = true; };
  }, [selectedKeyId]);

  // ── コピー ────────────────────────────────────────────────────
  const copy = useCallback(async (text: string, label: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      toast(`${label}をコピーしました`);
      setManualCopyText(null);
    } else {
      setManualCopyText(text);
      toast("自動コピーできませんでした。下のテキストを手動でコピーしてください", "error");
    }
  }, [toast]);

  const buildPrompt = useCallback((plainKey?: string) => buildApiSetupPrompt({
    baseUrl, projectName, sprintId, sprintName,
    memberNames, categoryNames, today, plainKey,
  }), [baseUrl, projectName, sprintId, sprintName, memberNames, categoryNames, today]);

  // ── 発行 ──────────────────────────────────────────────────────
  const handleIssue = async () => {
    if (!projectId) return;
    setFormError(null);
    setIssuing(true);
    // 乱数生成・ハッシュ化・暗号化・組織IDの解決はすべてサーバー側で行う
    const result = await createApiKey({
      name: formName,
      projectId,
      expiresInDays: formExpiry,
    });
    setIssuing(false);
    if (!result.ok) { setFormError(result.error); return; }

    setIssuedKey({ plain: result.result.plainKey, name: result.result.row.name });
    // 「使い方」タブへそのまま引き継ぐ（復号のための往復を省く）
    setRevealedKey(result.result.plainKey);
    setRevealError(null);
    setFormOpen(false);
    setFormName("");
    setFormExpiry(90);
    setKeys(prev => [result.result.row, ...prev]);
    setSelectedKeyId(result.result.row.id);
  };

  const handleRevoke = async (key: ApiKeyRow) => {
    const { error } = await revokeApiKey(key.id);
    setRevokeTarget(null);
    if (error) { toast(error, "error"); return; }
    toast(`「${key.name}」を失効させました`);
    await reloadKeys();
  };

  /** 一覧からキーの平文をコピーする。暗号化して保存してあるので後からでも取り出せる。 */
  const handleCopyKey = async (key: ApiKeyRow) => {
    const result = await revealApiKey(key.id);
    if (!result.ok) {
      toast(
        result.needsReissue
          ? "このキーは以前の方式で発行されているため取り出せません。発行し直してください"
          : result.error,
        "error",
      );
      return;
    }
    await copy(result.plainKey, `APIキー（${key.name}）`);
  };

  const handleDelete = async (key: ApiKeyRow) => {
    const { error } = await deleteApiKey(key.id);
    if (error) { toast(error, "error"); return; }
    setKeys(prev => prev.filter(k => k.id !== key.id));
  };

  // ── 発行直後の表示（最優先で出す） ────────────────────────────
  const renderIssued = () => issuedKey && (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, padding: "13px 15px", background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.28)", borderRadius: 11 }}>
        <AlertTriangle style={{ width: 16, height: 16, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
        <div>
          <p style={{ fontSize: 12.5, fontWeight: 800, color: "#92400E" }}>キーはパスワードと同じものです</p>
          <p style={{ fontSize: 11.5, color: "#B45309", marginTop: 3, lineHeight: 1.7 }}>
            Gitにコミットしたり、外部に共有したりしないでください。
            漏れた可能性があれば、その場で失効させて発行し直してください。
            なお、このキーは暗号化して保存されているため、あとから「APIキー」タブでコピーし直すこともできます。
          </p>
        </div>
      </div>

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 6 }}>
          Dev Ticket のAPIキー（{issuedKey.name}）
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <code style={{
            flex: 1, minWidth: 0, padding: "11px 13px", background: "#F7F6F4",
            border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9,
            fontSize: 12, fontFamily: "var(--font-mono)", color: "#1A1714",
            wordBreak: "break-all", lineHeight: 1.6,
          }}>{issuedKey.plain}</code>
          <Btn onClick={() => void copy(issuedKey.plain, "APIキー")}><Copy style={{ width: 13, height: 13 }} />コピー</Btn>
        </div>
        <p style={{ fontSize: 10.5, color: "#B0A9A4", marginTop: 6 }}>
          先頭の <code style={{ fontFamily: "var(--font-mono)" }}>dvt</code> は Dev Ticket の意味です。他サービスのキーとは無関係です。
        </p>
      </div>

      <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 15 }}>
        <p style={{ fontSize: 12.5, fontWeight: 700, color: "#1A1714" }}>AIに使ってもらう場合</p>
        <SectionNote>
          キーだけを渡してもAIは動きません。エンドポイント・JSONの形式・このプロジェクトのメンバー名や分類名を含んだプロンプトに、
          <strong>上のAPIキーを埋め込んだ状態</strong>でコピーします。AIに貼るだけで登録できます。
        </SectionNote>
        <div style={{ marginTop: 10 }}>
          <Btn onClick={() => void copy(buildPrompt(issuedKey.plain), "プロンプト")}>
            <Sparkles style={{ width: 13, height: 13 }} />プロンプトコピー（APIキー込み）
          </Btn>
        </div>
      </div>
    </div>
  );

  // ── 使い方タブ ────────────────────────────────────────────────
  const renderUsage = () => {
    if (activeKeys.length === 0) {
      return (
        <div style={{ textAlign: "center", padding: "26px 12px" }}>
          <div style={{ width: 46, height: 46, borderRadius: 13, background: "#F5F3FF", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
            <KeyRound style={{ width: 21, height: 21, color: PURPLE }} />
          </div>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: "#1A1714" }}>使えるAPIキーがまだありません</p>
          <p style={{ fontSize: 11.5, color: "#9E9690", marginTop: 5, lineHeight: 1.8 }}>
            APIキーを発行すると、AIやCIが「{sprintName}」に直接チケットを登録できるようになります。<br />
            MDファイルを書き出して取り込む作業が不要になります。
          </p>
          <div style={{ marginTop: 16 }}>
            {canManage
              ? <Btn onClick={() => { setTab("keys"); setFormOpen(true); }}><Plus style={{ width: 13, height: 13 }} />APIキーを発行する</Btn>
              : <SectionNote>APIキーの発行は管理者のみ行えます。管理者に発行を依頼してください。</SectionNote>}
          </div>
        </div>
      );
    }

    const selected = activeKeys.find(k => k.id === selectedKeyId) ?? activeKeys[0];
    const prompt = buildPrompt(revealedKey ?? undefined);
    const keyEmbedded = !!revealedKey;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 12.5, color: "#4B4640", lineHeight: 1.8 }}>
          下のプロンプトをAIに渡すと、<strong>{sprintName}</strong> に直接チケットを登録できます。
          MDファイルの書き出しと取り込みは不要です。
        </p>

        {/* 貼り付け先を誤ると必ず失敗するため、コピーボタンより前に置く。
            ブラウザで動くAIはサンドボックスの外へ通信できず、プロンプトだけでは動かない。 */}
        <div style={{ padding: "13px 15px", background: "#F0FDF4", border: `1px solid ${GREEN}22`, borderRadius: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Terminal style={{ width: 14, height: 14, color: GREEN, flexShrink: 0 }} />
            <p style={{ fontSize: 12, fontWeight: 800, color: "#1A1714" }}>貼り付け先：コマンドを実行できるAI</p>
          </div>
          <p style={{ fontSize: 11.5, color: "#4B4640", lineHeight: 1.85 }}>
            <strong>Claude Code</strong>（デスクトップアプリの「Code」タブ / ターミナル）、
            <strong>Cursor</strong>、<strong>Gemini CLI</strong> などに、
            上のキー入りプロンプトを貼るだけで登録されます。設定は要りません。
          </p>

          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${GREEN}1A`, display: "flex", gap: 6 }}>
            <Globe style={{ width: 13, height: 13, color: "#D97706", flexShrink: 0, marginTop: 2 }} />
            <p style={{ fontSize: 11, color: "#6B6458", lineHeight: 1.8 }}>
              <strong style={{ color: "#B45309" }}>Claude.ai・ChatGPT・Gemini のブラウザ版では動きません。</strong>
              これらは外部への通信が遮断されているため、プロンプトを貼っても登録されません
              （AIが「登録しました」と答えても実際には登録されていないことがあります）。
              ブラウザのAIを使う場合は「新規チケット → MDファイルから取り込み」で、
              AIの出力をそのまま貼り付けてください。
            </p>
          </div>
        </div>

        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 6 }}>使用するキー</p>
          <select
            value={selected?.id ?? ""}
            onChange={e => setSelectedKeyId(e.target.value)}
            style={{
              width: "100%", padding: "10px 12px", fontSize: 12.5, color: "#1A1714",
              background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 9, cursor: "pointer",
            }}>
            {activeKeys.map(k => (
              <option key={k.id} value={k.id}>
                {maskedKey(k.keyPrefix)}（{k.name}） ／ 最終利用 {formatRelative(k.lastUsedAt)}
              </option>
            ))}
          </select>
          {/* 選ばれたキーの平文をサーバーで復号し、そのままプロンプトへ埋め込む。
              利用者がキーを控えて貼り直す必要はない。 */}
          <p style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.7, color: revealError ? "#DC2626" : keyEmbedded ? GREEN : "#B0A9A4" }}>
            {revealing
              ? "キーを読み込んでいます…"
              : revealError
                ? (revealError.needsReissue
                  ? "⚠ このキーは以前の方式で発行されているため、プロンプトへ埋め込めません。「APIキー」タブで新しく発行し直してください。"
                  : `⚠ ${revealError.message}`)
                : keyEmbedded
                  ? "✅ 選択中のキーを埋め込んだ状態でコピーされます。AIに貼るだけで使えます。"
                  : "キーを読み込めませんでした。"}
          </p>
        </div>

        <div>
          <Btn onClick={() => void copy(prompt, "プロンプト")}>
            <Sparkles style={{ width: 13, height: 13 }} />
            {keyEmbedded ? "プロンプトコピー（APIキー込み）" : "プロンプトコピー"}
          </Btn>
        </div>

        <div>
          <button type="button" onClick={() => setPromptOpen(v => !v)}
            style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: GREEN }}>
            {promptOpen ? <ChevronDown style={{ width: 13, height: 13 }} /> : <ChevronRight style={{ width: 13, height: 13 }} />}
            プロンプトの中身を表示
          </button>
          {promptOpen && (
            <pre style={{
              marginTop: 8, padding: "12px 14px", maxHeight: 260, overflow: "auto",
              background: "#F7F6F4", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 9,
              fontSize: 10.5, lineHeight: 1.65, fontFamily: "var(--font-mono)",
              color: "#4B4640", whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>{prompt}</pre>
          )}
        </div>

        <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 11.5, color: "#9E9690" }}>キーの発行・失効はこちら</span>
          <button type="button" onClick={() => setTab("keys")}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: GREEN }}>
            キーを管理する →
          </button>
        </div>
      </div>
    );
  };

  // ── 組み込みタブ ──────────────────────────────────────────────
  /** 自社システム・CI・バッチから叩くための説明。MCP など追加の仕組みは要らない。 */
  const renderEmbed = () => {
    const sample = buildApiSample(lang, {
      baseUrl, sprintId, plainKey: revealedKey ?? undefined,
    });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <div style={{ padding: "13px 15px", background: "#F0FDF4", border: `1px solid ${GREEN}22`, borderRadius: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
            <ShieldCheck style={{ width: 14, height: 14, color: GREEN, flexShrink: 0 }} />
            <p style={{ fontSize: 12, fontWeight: 800, color: "#1A1714" }}>必要なのはAPIキーだけです</p>
          </div>
          <p style={{ fontSize: 11.5, color: "#4B4640", lineHeight: 1.85 }}>
            Bearer認証の一般的なHTTPS APIです。自社サーバー・バッチ処理・CI・Zapier など、
            HTTPリクエストを送れるものなら何からでも使えます。
            MCPサーバーやSDKの導入は不要です。
          </p>
        </div>

        {/* 組み込みの流れ。サンプルを写すだけでは動かないので、前後にやることを先に示す */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 7 }}>組み込みの流れ</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {[
              { n: 1, t: "APIキーを発行する", d: "「APIキー」タブで発行します。発行は最初の1回だけです" },
              { n: 2, t: "キーを自分のシステムに設定する", d: "環境変数に入れます。この画面に毎回入力するのではありません" },
              { n: 3, t: "自分のデータを tickets の形に変換する", d: "下の「送れる項目」を見て、自社データの項目を対応づけます" },
              { n: 4, t: "POST する", d: "登録されると wbs（チケット番号）が返ります" },
            ].map(s => (
              <div key={s.n} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                <span style={{
                  width: 19, height: 19, borderRadius: 6, background: GREEN, color: "#FFFFFF", flexShrink: 0,
                  fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1,
                }}>{s.n}</span>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>{s.t}</p>
                  <p style={{ fontSize: 10.5, color: "#9E9690", lineHeight: 1.7, marginTop: 1 }}>{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* エンドポイント */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 7 }}>エンドポイント</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { m: "POST", path: "/api/v1/tickets", desc: "チケットを登録する" },
              { m: "GET", path: "/api/v1/context", desc: "スプリント・担当者・分類の候補を取得する" },
            ].map(e => (
              <div key={e.path} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", background: "#F7F6F4", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: e.m === "POST" ? GREEN : "#0284C7", minWidth: 34 }}>{e.m}</span>
                <code style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#1A1714" }}>{e.path}</code>
                <span style={{ fontSize: 10.5, color: "#9E9690", marginLeft: "auto", textAlign: "right" }}>{e.desc}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 10.5, color: "#9E9690", marginTop: 7, lineHeight: 1.75 }}>
            プロジェクトはAPIキーに紐づいているため指定不要です。
            登録先スプリントは <code style={{ fontFamily: "var(--font-mono)", color: "#4B4640" }}>sprintId</code> で指定します
            （このスプリントは <code style={{ fontFamily: "var(--font-mono)", color: "#4B4640" }}>{sprintId}</code>）。
          </p>
        </div>

        {/* キーの置き場所。「画面に入力するのか？」という誤解が起きやすいので明示する */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 7 }}>APIキーの置き場所</p>
          <p style={{ fontSize: 11.5, color: "#4B4640", lineHeight: 1.85, marginBottom: 8 }}>
            キーはこの画面で発行して、<strong>自分のシステム側の環境変数に設定します</strong>。
            Dev Ticket の画面に毎回入力するものではありません。
            ソースコードに直接書くとGitに残って漏れるため、環境変数を使ってください。
          </p>
          <pre style={{
            padding: "11px 13px", overflow: "auto",
            background: "#F7F6F4", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 9,
            fontSize: 10.5, lineHeight: 1.7, fontFamily: "var(--font-mono)", color: "#4B4640", whiteSpace: "pre",
          }}>{buildKeySetupSnippet(revealedKey ?? "dvt_live_ここにAPIキー")}</pre>
          <div style={{ marginTop: 7 }}>
            <Btn onClick={() => void copy(buildKeySetupSnippet(revealedKey ?? "dvt_live_ここにAPIキー"), "設定例")} tone="ghost">
              <Copy style={{ width: 13, height: 13 }} />設定例をコピー
            </Btn>
          </div>
        </div>

        {/* サンプルコード */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458" }}>サンプルコード</p>
            <div style={{ display: "flex", gap: 3 }}>
              {SAMPLE_LANGS.map(l => (
                <button key={l.id} type="button" onClick={() => setLang(l.id)}
                  style={{
                    padding: "4px 10px", fontSize: 10.5, fontWeight: 700, borderRadius: 6, cursor: "pointer",
                    border: `1px solid ${lang === l.id ? GREEN : "rgba(26,23,20,0.12)"}`,
                    background: lang === l.id ? GREEN : "#FFFFFF",
                    color: lang === l.id ? "#FFFFFF" : "#6B6458",
                  }}>{l.label}</button>
              ))}
            </div>
          </div>

          <pre style={{
            padding: "12px 14px", maxHeight: 300, overflow: "auto",
            background: "#F7F6F4", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 9,
            fontSize: 10.5, lineHeight: 1.7, fontFamily: "var(--font-mono)",
            color: "#4B4640", whiteSpace: "pre", wordBreak: "normal",
          }}>{sample}</pre>

          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <Btn onClick={() => void copy(sample, "サンプルコード")} tone="ghost">
              <Copy style={{ width: 13, height: 13 }} />サンプルをコピー
            </Btn>
            {/* curl は手元で1回叩く用途なのでキーを直に入れる。
                コード側は環境変数から読む形にしてあるので、埋め込み済みと書くと嘘になる。 */}
            <span style={{ fontSize: 10.5, color: lang === "curl" && revealedKey ? GREEN : "#9E9690", lineHeight: 1.6 }}>
              {lang === "curl"
                ? (revealedKey
                  ? "✅ キーが埋め込まれています。このまま実行できます"
                  : "キーの部分は自分で差し替えてください")
                : "このコードにキーは含まれません。上の「APIキーの置き場所」で環境変数に設定してください"}
            </span>
          </div>
        </div>

        {/* 送れる項目。このプロジェクトの実際の分類名・メンバー名を出すので、そのまま写せる */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 3 }}>送れる項目</p>
          <p style={{ fontSize: 10.5, color: "#9E9690", lineHeight: 1.7, marginBottom: 8 }}>
            tickets 配列の1要素に指定できるキーです。<strong>title 以外はすべて任意</strong>で、
            省略すると「未指定のとき」の値になります。判断材料が無い項目は、空文字を入れずに
            <strong>キーごと省略</strong>してください。
          </p>
          <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 9, overflow: "hidden" }}>
            {[
              { k: "title", req: true, v: "チケット名（500文字まで）", def: "—" },
              { k: "status", req: false, v: MD_STATUS_LABELS.join(" / "), def: "未着手" },
              { k: "priority", req: false, v: MD_PRIORITY_LABELS.join(" / "), def: "中" },
              { k: "category", req: false, v: categoryNames.length > 0 ? categoryNames.join(" / ") : "（このプロジェクトには分類が未登録）", def: "分類なし" },
              // 実名を画面に並べない（画面共有や資料に映るため）。
              // 名前の一覧が必要なときは API から取る。
              { k: "assignee", req: false, v: `プロジェクトのメンバー名（完全一致）。${memberNames.length}名が登録済み。名前は GET /api/v1/context で取得`, def: "空欄" },
              { k: "startDate", req: false, v: "YYYY/MM/DD", def: "空欄" },
              { k: "dueDate", req: false, v: "YYYY/MM/DD", def: "空欄" },
              { k: "estimatedHours", req: false, v: "整数（時間）", def: "0" },
              { k: "description", req: false, v: "本文（Markdown文字列）", def: "空欄" },
              { k: "children", req: false, v: "子チケットの配列（同じ形・1階層まで）", def: "なし" },
            ].map((f, i) => (
              <div key={f.k} style={{
                display: "flex", gap: 9, padding: "7px 11px", alignItems: "flex-start",
                background: i % 2 === 0 ? "#FFFFFF" : "#FAFAF8",
                borderTop: i === 0 ? "none" : "1px solid rgba(26,23,20,0.05)",
              }}>
                <code style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: "#1A1714", minWidth: 104, flexShrink: 0 }}>
                  {f.k}
                  {f.req && <span style={{ color: "#DC2626", fontWeight: 800 }}> *</span>}
                </code>
                <span style={{ fontSize: 10.5, color: "#4B4640", lineHeight: 1.65, flex: 1 }}>{f.v}</span>
                <span style={{ fontSize: 10, color: "#B0A9A4", flexShrink: 0, textAlign: "right", minWidth: 62 }}>{f.def}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 10.5, color: "#9E9690", marginTop: 7, lineHeight: 1.75 }}>
            右端は未指定のときの値です。<code style={{ fontFamily: "var(--font-mono)" }}>category</code> /
            <code style={{ fontFamily: "var(--font-mono)" }}>assignee</code> は登録済みの名前と完全一致させてください。
            一致しない場合は空欄で登録され、レスポンスの <code style={{ fontFamily: "var(--font-mono)" }}>warnings</code> に理由が入ります
            （エラーにはなりません）。表に無いキーは送っても無視されます。
          </p>
        </div>

        {/* 制限と注意 */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 7 }}>制限</p>
          <ul style={{ margin: 0, paddingLeft: 17, fontSize: 11.5, color: "#4B4640", lineHeight: 1.9 }}>
            <li>1分あたり {API_LIMITS.requestsPerMinute} リクエストまで（超過すると 429）</li>
            <li>1リクエストで親チケット {API_LIMITS.parentsPerRequest} 件、親1件あたり子 {API_LIMITS.childrenPerParent} 件まで</li>
            <li>子チケットの階層は1段まで</li>
          </ul>
        </div>

        <div style={{ display: "flex", gap: 7, padding: "11px 13px", background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.18)", borderRadius: 10 }}>
          <AlertTriangle style={{ width: 14, height: 14, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 11, color: "#6B6458", lineHeight: 1.8 }}>
            <strong style={{ color: "#B45309" }}>冪等キーはありません。</strong>
            同じ内容を2回送ると2件登録されます。タイムアウトした場合は、自動で再送せず
            <code style={{ fontFamily: "var(--font-mono)" }}>GET /api/v1/context</code> などで
            登録済みかを確認してから判断してください。
          </p>
        </div>
      </div>
    );
  };

  // ── APIキータブ ───────────────────────────────────────────────
  const renderKeys = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!canManage && (
        <div style={{ display: "flex", gap: 9, padding: "11px 14px", background: "#F7F6F4", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
          <ShieldCheck style={{ width: 15, height: 15, color: "#9E9690", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 11.5, color: "#6B6458", lineHeight: 1.7 }}>
            APIキーの発行・失効は管理者のみ行えます。閲覧のみ可能です。
          </p>
        </div>
      )}

      {canManage && !formOpen && (
        <div><Btn onClick={() => { setFormOpen(true); setFormError(null); }}><Plus style={{ width: 13, height: 13 }} />新規発行</Btn></div>
      )}

      {canManage && formOpen && (
        <div style={{ padding: "15px 16px", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 12, display: "flex", flexDirection: "column", gap: 13 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 5 }}>このキーの用途名</label>
            <input
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="例: Claude Code用"
              autoFocus
              style={{ width: "100%", padding: "9px 11px", fontSize: 12.5, border: "1px solid rgba(26,23,20,0.14)", borderRadius: 8, color: "#1A1714" }}
            />
            <p style={{ fontSize: 10.5, color: "#B0A9A4", marginTop: 5 }}>
              どのツール・システムで使うキーかが分かる名前を付けてください（後で見分けるためのラベルです）
            </p>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 6 }}>有効期限</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {EXPIRY_OPTIONS.map(o => {
                const active = formExpiry === o.days;
                return (
                  <button key={o.label} type="button" onClick={() => setFormExpiry(o.days)}
                    style={{
                      padding: "7px 14px", fontSize: 11.5, fontWeight: 600, borderRadius: 8, cursor: "pointer",
                      background: active ? GREEN : "#FFFFFF", color: active ? "#FFFFFF" : "#6B6458",
                      border: active ? "none" : "1px solid rgba(26,23,20,0.14)",
                    }}>{o.label}</button>
                );
              })}
            </div>
            {formExpiry === null && (
              <p style={{ fontSize: 10.5, color: "#D97706", marginTop: 6 }}>
                無期限のキーは漏れたときに影響が続きます。期限を付けることを推奨します。
              </p>
            )}
          </div>

          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 4 }}>対象プロジェクト</p>
            <p style={{ fontSize: 12, color: "#1A1714" }}>{projectName}</p>
            <p style={{ fontSize: 10.5, color: "#B0A9A4", marginTop: 4, lineHeight: 1.7 }}>
              このキーで操作できるのはこのプロジェクトだけです。他のプロジェクトには一切アクセスできません。
            </p>
          </div>

          {formError && (
            <p style={{ fontSize: 11.5, color: "#DC2626", lineHeight: 1.7 }}>{formError}</p>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn tone="ghost" onClick={() => { setFormOpen(false); setFormError(null); }}>キャンセル</Btn>
            <Btn onClick={() => void handleIssue()} disabled={issuing || !formName.trim()}>
              {issuing ? <Loader2 style={{ width: 13, height: 13 }} /> : <KeyRound style={{ width: 13, height: 13 }} />}
              {issuing ? "発行中…" : "発行する"}
            </Btn>
          </div>
        </div>
      )}

      {keys.length === 0 && !formOpen && (
        <p style={{ fontSize: 12, color: "#9E9690", textAlign: "center", padding: "20px 0" }}>
          このプロジェクトにはまだAPIキーがありません
        </p>
      )}

      {keys.map(k => {
        const st = keyStatus(k);
        const stColor = st.kind === "active" ? GREEN : st.kind === "expired" ? "#D97706" : "#9E9690";
        const stBg = st.kind === "active" ? "#ECFDF5" : st.kind === "expired" ? "#FFFBEB" : "#F3F4F6";
        return (
          <div key={k.id} style={{
            display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 15px",
            background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 11,
            opacity: st.kind === "active" ? 1 : 0.66,
          }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <code style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "#1A1714", fontWeight: 600 }}>
                  {maskedKey(k.keyPrefix)}
                </code>
                <span style={{ fontSize: 10, fontWeight: 700, color: stColor, background: stBg, padding: "2px 8px", borderRadius: 5 }}>
                  {st.label}
                </span>
              </div>
              <p style={{ fontSize: 11.5, color: "#6B6458", marginTop: 4 }}>{k.name}</p>
              <p style={{ fontSize: 10.5, color: "#B0A9A4", marginTop: 3, lineHeight: 1.6 }}>
                {k.createdBy ? `${k.createdBy} / ` : ""}{formatDay(k.createdAt)}発行
                {k.expiresAt ? ` ／ 期限 ${formatDay(k.expiresAt)}` : " ／ 無期限"}
                {" ／ 最終利用 "}{formatRelative(k.lastUsedAt)}
              </p>
            </div>
            {canManage && (
              st.kind === "active"
                ? (
                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    {/* 暗号化して保存してあるので、後からでも平文を取り出せる */}
                    <button type="button" onClick={() => void handleCopyKey(k)} title="このキーをコピーする"
                      style={{ padding: 7, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#ECFDF5"; e.currentTarget.style.color = GREEN; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#C9C4BB"; }}>
                      <Copy style={{ width: 14, height: 14 }} />
                    </button>
                    <button type="button" onClick={() => setRevokeTarget(k)} title="このキーを失効させる"
                      style={{ padding: 7, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#FEF2F2"; e.currentTarget.style.color = "#DC2626"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#C9C4BB"; }}>
                      <Ban style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                )
                : (
                  <button type="button" onClick={() => void handleDelete(k)} title="一覧から削除する"
                    style={{ padding: 7, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", flexShrink: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#FEF2F2"; e.currentTarget.style.color = "#DC2626"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#C9C4BB"; }}>
                    <Trash2 style={{ width: 14, height: 14 }} />
                  </button>
                )
            )}
          </div>
        );
      })}

      <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 13 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 6 }}>⚠ キーの取り扱い</p>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: "#9E9690", lineHeight: 1.9 }}>
          <li>キーはパスワードと同じです。Gitにコミットしないでください</li>
          <li>漏れた可能性があれば、その場で失効させて発行し直してください</li>
          <li>キーは暗号化して保存されているため、📋 アイコンでいつでもコピーし直せます</li>
          <li>1本のキーにつき1分あたり60リクエストまでです</li>
        </ul>
      </div>
    </div>
  );

  // ── 描画 ──────────────────────────────────────────────────────
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(10,14,12,0.35)", backdropFilter: "blur(3px)" }} />

      <div style={{
        position: "fixed", top: "5vh", left: "50%", transform: "translateX(-50%)",
        width: "min(94vw, 640px)", maxHeight: "90vh",
        background: "#FAFAF8", zIndex: 301, borderRadius: 16,
        boxShadow: "0 24px 80px rgba(0,0,0,0.22)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* ヘッダー */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFFFFF", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: "#F5F3FF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <KeyRound style={{ width: 16, height: 16, color: PURPLE }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: "#1A1714", letterSpacing: "-0.01em" }}>
                {issuedKey ? "APIキーを発行しました" : "API連携"}
              </p>
              <p style={{ fontSize: 11, color: "#9E9690", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {projectName} ／ {sprintName}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(26,23,20,0.10)", background: "#FFFFFF", cursor: "pointer", color: "#9E9690", flexShrink: 0, fontSize: 15, lineHeight: 1 }}>×</button>
        </div>

        {/* タブ（発行直後は隠す。キーのコピーに集中させるため） */}
        {!issuedKey && (
          <div style={{ display: "flex", gap: 4, padding: "12px 24px 0", background: "#FAFAF8", flexShrink: 0 }}>
            {([["usage", "AIから使う"], ["embed", "システムに組み込む"], ["keys", "APIキー"]] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTab(id)}
                style={{
                  padding: "7px 16px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer",
                  background: tab === id ? GREEN : "transparent", color: tab === id ? "#FFFFFF" : "#6B6458",
                }}>{label}</button>
            ))}
          </div>
        )}

        {/* 本文 */}
        <div style={{ padding: "18px 24px 20px", overflowY: "auto", flex: 1 }}>
          {loadError
            ? <p style={{ fontSize: 12, color: "#DC2626" }}>{loadError}</p>
            : loading
              ? <p style={{ fontSize: 12, color: "#9E9690", textAlign: "center", padding: "24px 0" }}>読み込み中…</p>
              : issuedKey
                ? renderIssued()
                : tab === "usage" ? renderUsage()
                  : tab === "embed" ? renderEmbed()
                    : renderKeys()}

          {manualCopyText && (
            <div style={{ marginTop: 14 }}>
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
        <div style={{ padding: "13px 24px", borderTop: "1px solid rgba(26,23,20,0.07)", background: "#FFFFFF", display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
          {issuedKey
            ? <Btn onClick={() => { setIssuedKey(null); setTab("usage"); }}>コピーしました。閉じる</Btn>
            : <Btn tone="ghost" onClick={onClose}>閉じる</Btn>}
        </div>
      </div>

      {/* 失効の確認 */}
      {revokeTarget && (
        <>
          <div onClick={() => setRevokeTarget(null)} style={{ position: "fixed", inset: 0, zIndex: 320, background: "rgba(10,14,12,0.35)" }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            width: "min(92vw, 420px)", background: "#FFFFFF", zIndex: 321, borderRadius: 14,
            boxShadow: "0 24px 80px rgba(0,0,0,0.24)", padding: "20px 22px",
          }}>
            <p style={{ fontSize: 13.5, fontWeight: 800, color: "#1A1714", display: "flex", alignItems: "center", gap: 7 }}>
              <AlertTriangle style={{ width: 15, height: 15, color: "#D97706" }} />このキーを失効させますか
            </p>
            <p style={{ fontSize: 12, color: "#4B4640", marginTop: 10, lineHeight: 1.8 }}>
              「{revokeTarget.name}」（<code style={{ fontFamily: "var(--font-mono)" }}>{maskedKey(revokeTarget.keyPrefix)}</code>）
            </p>
            <p style={{ fontSize: 11.5, color: "#6B6458", marginTop: 8, lineHeight: 1.8 }}>
              失効させると、このキーを使っている連携はただちに 401 で失敗するようになります。
              この操作は取り消せません。
            </p>
            <p style={{ fontSize: 11.5, color: "#D97706", marginTop: 8 }}>
              最終利用: {formatRelative(revokeTarget.lastUsedAt)}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <Btn tone="ghost" onClick={() => setRevokeTarget(null)}>キャンセル</Btn>
              <Btn tone="danger" onClick={() => void handleRevoke(revokeTarget)}>失効させる</Btn>
            </div>
          </div>
        </>
      )}
    </>
  );
}
