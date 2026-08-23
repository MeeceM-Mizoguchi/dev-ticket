// プルリクエストの作成（GitHub の画面へ行かずに Dev Ticket で完結させる）。
//
// ブランチ名に WBS 番号が含まれていれば、そのチケットを引いてタイトルと本文を先に埋める。
// 作成後は PR一覧の取得時に自動でチケットへ紐付く。
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { createPull, GithubApiError } from "@/app/lib/github";
import { inputCls, labelCls } from "@/app/lib/helpers";
import type { GithubBranch } from "@/app/types";

const BLACK = "#1F2328";
const WBS_RE = /[A-Z][A-Z0-9]*-\d+/;

export function CreatePullDialog({ projectId, projectSlug, repo, branches, defaultBranch, initialHead, onClose, onCreated }: {
  projectId: string;
  projectSlug: string;
  repo: string;
  branches: GithubBranch[];
  defaultBranch: string;
  /** 未作成ブランチの一覧から開いたときに、選択済みにしておくブランチ */
  initialHead?: string;
  onClose: () => void;
  onCreated: (created: { number: number | null; url: string | null }) => void;
}) {
  const [base, setBase] = useState(defaultBranch || "main");
  const [head, setHead] = useState(initialHead && initialHead !== (defaultBranch || "main") ? initialHead : "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  /** ブランチ名から見つけたチケット。タイトルの自動入力に使う */
  const [detected, setDetected] = useState<{ wbs: string; title: string } | null>(null);
  /** 利用者がタイトルを触ったら自動入力で上書きしない */
  const [titleTouched, setTitleTouched] = useState(false);

  // base に入っている値が一覧に無いと、<select> は先頭の項目を表示してしまい、
  // 画面に出ているマージ先と実際に送られる base がずれる。必ず選択肢に含めておく
  const baseCandidates = useMemo<GithubBranch[]>(() => (
    branches.some(b => b.name === base)
      ? branches
      : [{ name: base, protected: false, isDefault: base === (defaultBranch || "main"), lastCommitSha: "" }, ...branches]
  ), [branches, base, defaultBranch]);

  const headCandidates = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return branches
      .filter(b => b.name !== base)
      .filter(b => !q || b.name.toLowerCase().includes(q));
  }, [branches, base, filter]);

  // ブランチ名の WBS 番号から、このプロジェクトのチケットを引く
  const lookupTicket = useCallback(async (branch: string) => {
    setDetected(null);
    const m = branch.toUpperCase().match(WBS_RE);
    if (!m || !isSupabaseEnabled) return;
    const wbs = m[0];
    const { data } = await supabase!
      .from("sprint_tickets")
      .select("wbs, title, sprints!inner(project_id)")
      .eq("wbs", wbs)
      .eq("sprints.project_id", projectId)
      .limit(1);
    const t = (data ?? [])[0] as any;
    if (t) setDetected({ wbs: t.wbs, title: t.title });
  }, [projectId]);

  useEffect(() => { if (head) void lookupTicket(head); }, [head, lookupTicket]);

  // チケットが見つかったら、まだ触られていない欄だけ埋める
  useEffect(() => {
    if (!detected || titleTouched) return;
    setTitle(`${detected.wbs} ${detected.title}`);
    setBody(prev => prev.trim()
      ? prev
      : `対応チケット: ${detected.wbs} ${detected.title}\n${location.origin}/${projectSlug}/${detected.wbs}`);
  }, [detected, titleTouched, projectSlug]);

  const canCreate = !!head && !!title.trim() && head !== base && !creating;

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError("");
    try {
      const r = await createPull(projectId, { head, base, title: title.trim(), body, draft });
      onCreated({ number: r.number, url: r.url });
      onClose();
    } catch (e) {
      // 失敗しても閉じない。差分が無い・既にPRがある、など理由を読ませる
      setError(e instanceof GithubApiError ? e.message : "プルリクエストを作成できませんでした。");
      setCreating(false);
    }
  };

  return (
    <DialogShell title="プルリクエストを作成" size="lg" onClose={creating ? () => {} : onClose}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={creating}>キャンセル</BtnSecondary>
        <button type="button" onClick={handleCreate} disabled={!canCreate}
          style={{ padding: "9px 20px", background: canCreate ? BLACK : "#E5E7EB", color: canCreate ? "#fff" : "#9CA3AF", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: canCreate ? "pointer" : "not-allowed" }}>
          {creating ? "作成中..." : draft ? "Draft で作成する" : "作成する"}
        </button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>

        <p style={{ fontSize: 12, color: "#6B6458" }}>
          リポジトリ <strong style={{ fontFamily: "var(--font-mono)" }}>{repo}</strong>
        </p>

        {/* マージ先と比較ブランチ */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" as const }}>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <label className={labelCls}>マージ先（base）</label>
            <select className={inputCls} value={base}
              onChange={e => { setBase(e.target.value); if (e.target.value === head) setHead(""); }}
              style={{ width: "100%" }}>
              {baseCandidates.map(b => <option key={b.name} value={b.name}>{b.name}{b.isDefault ? "（既定）" : ""}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <label className={labelCls}>比較するブランチ（head）</label>
            <select className={inputCls} value={head} onChange={e => setHead(e.target.value)} style={{ width: "100%" }}>
              <option value="">選択してください</option>
              {headCandidates.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
          </div>
        </div>

        {branches.length > 8 && (
          <div style={{ position: "relative" }}>
            <Search style={{ width: 13, height: 13, color: "#B0A9A4", position: "absolute", left: 10, top: 9 }} />
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="ブランチ名で絞り込む"
              style={{ width: "100%", boxSizing: "border-box" as const, padding: "7px 10px 7px 30px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#F9F8F6", outline: "none" }} />
          </div>
        )}

        <p style={{ fontSize: 12, color: "#1A1714", background: "#F9FAFB", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 8, padding: "9px 12px", fontFamily: "var(--font-mono)" }}>
          {base} ← {head || "（未選択）"}
        </p>

        {detected && (
          <p style={{ fontSize: 11, color: "#0284C7" }}>
            ブランチ名から <strong>{detected.wbs}</strong>（{detected.title}）を検出しました。作成後にこのチケットへ自動で紐付きます。
          </p>
        )}

        <div>
          <label className={labelCls}>タイトル</label>
          <input className={inputCls} value={title} placeholder="例: BRU13-004 リリースノートの自動反映"
            onChange={e => { setTitle(e.target.value); setTitleTouched(true); }} />
        </div>

        <div>
          <label className={labelCls}>本文（任意）</label>
          <textarea className={inputCls} value={body} onChange={e => setBody(e.target.value)} rows={6}
            placeholder="変更内容や確認してほしい点を書きます"
            style={{ resize: "vertical", minHeight: 110, fontFamily: "inherit" }} />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={draft} onChange={e => setDraft(e.target.checked)} />
          <span style={{ fontSize: 12, color: "#1A1714" }}>Draft として作成する（レビュー依頼前の下書き）</span>
        </label>

        {error && (
          <div style={{ display: "flex", gap: 9, padding: "11px 13px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 9 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "#DC2626", flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12, color: "#B91C1C", lineHeight: 1.7, fontWeight: 600 }}>{error}</p>
          </div>
        )}

        <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.7 }}>
          GitHub 上では Dev Ticket[bot] 名義で作成され、本文の末尾に実行者が記録されます。
        </p>
      </div>
    </DialogShell>
  );
}
