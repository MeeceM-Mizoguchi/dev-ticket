// ブランチの作成（BRU13-054）。
//
// ブランチ名は自由。命名規則で縛らないのが要点で、そのぶん「このブランチはどのチケットか」は
// 名前ではなくサーバー側の記録（ticket_github_branches）で持つ。
// この記録があるので、名前が何であれ、そのブランチから出たPRはチケットへ紐付く。
//
// チケット詳細から開いたときは、これまでの運用に合わせて
// 「プロジェクト識別子/WBS番号」（例: DEVTICKET/BRU13-054）を初期値に入れる。
// あくまで初期値で、全部書き換えられる。
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, GitBranch, Search } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { createBranch, GithubApiError } from "@/app/lib/github";
import { inputCls, labelCls } from "@/app/lib/helpers";
import { submitOnEnter } from "@/app/lib/submitKey";
import type { GithubBranch } from "@/app/types";

const BLACK = "#1F2328";

/** ブランチ名の初期値。運用してきた「プロジェクト識別子/WBS番号」の形 */
export function suggestBranchName(projectSlug: string | undefined, wbs: string | undefined): string {
  const slug = (projectSlug ?? "").trim();
  const w = (wbs ?? "").trim();
  if (!w) return "";
  return slug ? `${slug}/${w}` : w;
}

/**
 * 画面側の名前チェック。サーバー側 branchNameError と同じ規則を先に当てて、
 * 押してから怒られるのではなく入力中に理由が出るようにする。
 * 最終的な可否はサーバーが決める（ここは体験のためだけの前倒し）。
 */
export function branchNameError(name: string): string | null {
  if (!name) return null; // 未入力は「エラー」ではなく「まだ」なので出さない
  if (name.length > 244) return "ブランチ名が長すぎます。";
  if (/\s/.test(name)) return "ブランチ名に空白は使えません。";
  if (/[~^:?*[\\]/.test(name)) return "ブランチ名に ~ ^ : ? * [ \\ は使えません。";
  // 制御文字。正規表現に生の制御文字を書くとファイルがバイナリ扱いになるので文字コードで見る
  if (Array.from(name).some(c => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) {
    return "ブランチ名に制御文字は使えません。";
  }
  if (name.startsWith("/") || name.endsWith("/")) return "ブランチ名の先頭と末尾に / は使えません。";
  if (name.includes("//")) return "ブランチ名に / を続けて書くことはできません。";
  if (name.includes("..")) return "ブランチ名に .. は使えません。";
  if (name.includes("@{")) return "ブランチ名に @{ は使えません。";
  if (name === "@") return "ブランチ名を @ だけにすることはできません。";
  if (name.endsWith(".") || name.endsWith(".lock")) return "ブランチ名の末尾に . や .lock は使えません。";
  if (name.split("/").some(seg => seg.startsWith(".") || seg.endsWith(".lock"))) {
    return "ブランチ名の各区切りを . で始めたり .lock で終えたりはできません。";
  }
  return null;
}

export function CreateBranchDialog({
  projectId, repo, branches, defaultBranch, initialName, ticketId, ticketWbs, ticketTitle, onClose, onCreated,
}: {
  projectId: string;
  repo: string;
  /** 分岐元の選択肢。取得できていなければ空でよい（既定ブランチだけを出す） */
  branches: GithubBranch[];
  defaultBranch: string;
  /** ブランチ名の初期値。空なら利用者が最初から入力する */
  initialName?: string;
  /** チケット詳細から開いたとき。これを渡すと名前と無関係にチケットへ紐付く */
  ticketId?: string;
  ticketWbs?: string;
  ticketTitle?: string;
  onClose: () => void;
  /** 一覧の取り直しまで待てるように、Promise を返してよい */
  onCreated: (created: { name: string; base: string; url: string }) => void | Promise<void>;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [base, setBase] = useState(defaultBranch || "main");
  const [filter, setFilter] = useState("");
  const [phase, setPhase] = useState<"idle" | "creating" | "refreshing">("idle");
  const [error, setError] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // 初期値を入れてあっても書き換える前提なので、開いた時点で選択状態にしておく
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // base が一覧に無いと <select> は先頭を表示してしまい、画面の表示と送る値がずれる。
  // 必ず選択肢に含めておく（CreatePullDialog と同じ扱い）
  const baseCandidates = useMemo<GithubBranch[]>(() => {
    const q = filter.trim().toLowerCase();
    const filtered = branches.filter(b => !q || b.name.toLowerCase().includes(q) || b.name === base);
    return filtered.some(b => b.name === base)
      ? filtered
      : [{ name: base, protected: false, isDefault: base === (defaultBranch || "main"), lastCommitSha: "" }, ...filtered];
  }, [branches, base, filter, defaultBranch]);

  const trimmed = name.trim();
  const nameError = branchNameError(trimmed);
  const duplicated = !!trimmed && branches.some(b => b.name === trimmed);
  const busy = phase !== "idle";
  const canCreate = !!trimmed && !nameError && !duplicated && trimmed !== base && !busy;

  const handleCreate = async () => {
    if (!canCreate) return;
    setPhase("creating");
    setError("");
    let created: { name: string; base: string; url: string };
    try {
      const r = await createBranch(projectId, { name: trimmed, base, ticketId });
      created = { name: r.name, base: r.base, url: r.url };
    } catch (e) {
      // 失敗しても閉じない。同名がある・分岐元が無い、など理由を読ませる
      setError(e instanceof GithubApiError ? e.message : "ブランチを作成できませんでした。");
      setPhase("idle");
      return;
    }
    setPhase("refreshing");
    try {
      await onCreated(created);
    } catch {
      // 取り直しの失敗は呼び出し元で出す。作成は済んでいるので閉じる
    }
    onClose();
  };

  return (
    <DialogShell title="ブランチを作成" size="md" onClose={onClose} busy={busy}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={busy}>キャンセル</BtnSecondary>
        <button type="button" onClick={handleCreate} disabled={!canCreate}
          style={{ padding: "9px 20px", background: canCreate ? BLACK : "#E5E7EB", color: canCreate ? "#fff" : "#9CA3AF", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: canCreate ? "pointer" : "not-allowed" }}>
          {phase === "creating" ? "作成中..." : phase === "refreshing" ? "一覧を更新中..." : "作成する"}
        </button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
        <p style={{ fontSize: 12, color: "#6B6458" }}>
          リポジトリ <strong style={{ fontFamily: "var(--font-mono)" }}>{repo}</strong>
        </p>

        <div>
          <label className={labelCls}>ブランチ名</label>
          <input ref={inputRef} className={inputCls} value={name} onChange={e => setName(e.target.value)}
            onKeyDown={submitOnEnter(handleCreate, { enabled: canCreate })}
            placeholder="例: DEVTICKET/BRU13-054" spellCheck={false}
            style={{ fontFamily: "var(--font-mono)" }} />
          <p style={{ fontSize: 11, color: "#A09790", marginTop: 5, lineHeight: 1.7 }}>
            名前は自由に決められます。{ticketId
              ? "このチケットとの紐付けは名前ではなくDev Ticket側に記録されるので、どんな名前でもPRはこのチケットへ紐付きます。"
              : "チケット詳細から作成すると、名前に関係なくそのチケットへ紐付きます。"}
          </p>
        </div>

        <div>
          <label className={labelCls}>分岐元</label>
          {branches.length > 8 && (
            <div style={{ position: "relative", marginBottom: 6 }}>
              <Search style={{ width: 13, height: 13, color: "#B0A9A4", position: "absolute", left: 10, top: 9 }} />
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="ブランチ名で絞り込む"
                style={{ width: "100%", boxSizing: "border-box" as const, padding: "7px 10px 7px 30px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#F9F8F6", outline: "none" }} />
            </div>
          )}
          <select className={inputCls} value={base} onChange={e => setBase(e.target.value)} style={{ width: "100%" }}>
            {baseCandidates.map(b => <option key={b.name} value={b.name}>{b.name}{b.isDefault ? "（既定）" : ""}</option>)}
          </select>
        </div>

        <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#1A1714", background: "#F9FAFB", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 8, padding: "9px 12px", fontFamily: "var(--font-mono)" }}>
          <GitBranch style={{ width: 13, height: 13, color: "#6B6458", flexShrink: 0 }} />
          {base} → {trimmed || "（未入力）"}
        </p>

        {ticketId && ticketWbs && (
          <p style={{ fontSize: 11, color: "#0284C7", lineHeight: 1.7 }}>
            作成したブランチは <strong>{ticketWbs}</strong>{ticketTitle ? `（${ticketTitle}）` : ""} に紐付きます。
          </p>
        )}

        {(nameError || duplicated || (trimmed && trimmed === base)) && (
          <div style={{ display: "flex", gap: 9, padding: "11px 13px", background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 9 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12, color: "#B45309", lineHeight: 1.7, fontWeight: 600 }}>
              {nameError
                ?? (duplicated ? `ブランチ「${trimmed}」はすでに存在します。別の名前を入力してください。` : "分岐元と同じ名前のブランチは作成できません。")}
            </p>
          </div>
        )}

        {error && (
          <div style={{ display: "flex", gap: 9, padding: "11px 13px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 9 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "#DC2626", flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12, color: "#B91C1C", lineHeight: 1.7, fontWeight: 600 }}>{error}</p>
          </div>
        )}

        <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.7 }}>
          分岐元の最新のコミットから作成されます。ローカルには <span style={{ fontFamily: "var(--font-mono)" }}>git fetch</span> で取り込めます。
        </p>
      </div>
    </DialogShell>
  );
}
