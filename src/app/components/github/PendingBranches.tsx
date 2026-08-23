// まだプルリクエストが作られていないブランチの案内（docs/github-integration-design.md）。
//
// GitHub の「had recent pushes / Compare & pull request」に相当するものを Dev Ticket 側に出す。
// ・バナー … 直近24時間以内のものを1本だけ強調する
// ・一覧  … PR未作成のブランチをすべて出す（溜まっている分に気づけるようにする）
// どちらのボタンからも、そのブランチを選択済みの状態で作成ダイアログを開く。
import { useState } from "react";
import { GitBranch, ChevronDown, ChevronUp, Link2 } from "lucide-react";
import { relativeTime } from "@/app/lib/github";
import type { GithubPendingBranch } from "@/app/types";

const BLACK = "#1F2328";
const RECENT_MS = 24 * 60 * 60 * 1000;

export function PendingBranches({ branches, canCreate, onCreate }: {
  branches: GithubPendingBranch[];
  /** 「マージ可」の人だけが作成できる */
  canCreate: boolean;
  onCreate: (branchName: string) => void;
}) {
  const [open, setOpen] = useState(true);

  if (!branches.length) return null;

  // 一覧は新しい順で返ってくるので、先頭が最新
  const newest = branches[0];
  const showBanner = !!newest.committedDate
    && Date.now() - new Date(newest.committedDate).getTime() < RECENT_MS;

  return (
    <div style={{ marginBottom: 12 }}>
      {/* バナー：直前に push したものにすぐ気づけるように */}
      {showBanner && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" as const, background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.28)", borderRadius: 10, padding: "12px 16px", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <GitBranch style={{ width: 15, height: 15, color: "#D97706", flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, color: "#92400E" }}>
                <strong style={{ fontFamily: "var(--font-mono)" }}>{newest.name}</strong>
                {" に "}{relativeTime(newest.committedDate!)}のコミットがあります
              </p>
              <p style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}>
                まだプルリクエストが作られていません
              </p>
            </div>
          </div>
          {canCreate && (
            <button onClick={() => onCreate(newest.name)}
              style={{ padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none", background: BLACK, color: "#FFF", cursor: "pointer", whiteSpace: "nowrap" as const }}>
              プルリクエストを作成
            </button>
          )}
        </div>
      )}

      {/* 一覧：溜まっている分をまとめて見せる */}
      <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.09)", borderRadius: 12, overflow: "hidden" }}>
        <button onClick={() => setOpen(v => !v)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "10px 14px", background: "#FAFAF8", border: "none", borderBottom: open ? "1px solid rgba(26,23,20,0.07)" : "none", cursor: "pointer", textAlign: "left" as const }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#4B4540" }}>
            プルリクエスト未作成のブランチ {branches.length}件
          </span>
          {open ? <ChevronUp style={{ width: 13, height: 13, color: "#8A837B" }} /> : <ChevronDown style={{ width: 13, height: 13, color: "#8A837B" }} />}
        </button>

        {open && branches.map((b, i) => (
          <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: i < branches.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none", flexWrap: "wrap" as const }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
                <GitBranch style={{ width: 12, height: 12, color: "#8A837B", flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-mono)" }}>{b.name}</span>
                {b.committedDate && (
                  <span style={{ fontSize: 11, color: "#A09790" }}>{relativeTime(b.committedDate)}</span>
                )}
                {i === 0 && showBanner && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10, background: "#FFFBEB", color: "#D97706" }}>新着</span>
                )}
              </div>
              {b.message && (
                <p style={{ fontSize: 11, color: "#6B6458", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {b.message}{b.authorName && ` ・ ${b.authorName}`}
                </p>
              )}
              <p style={{ fontSize: 11, marginTop: 3 }}>
                {b.wbs
                  ? <span style={{ color: "#0284C7", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Link2 style={{ width: 11, height: 11 }} />
                      {b.wbs}
                      {b.ticketTitle && <span style={{ color: "#6B6458" }}>{b.ticketTitle}</span>}
                    </span>
                  : <span style={{ color: "#C9C4BB" }}>ブランチ名からチケットを特定できません</span>}
              </p>
            </div>
            {canCreate && (
              <button onClick={() => onCreate(b.name)}
                style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#FFF", color: BLACK, cursor: "pointer", whiteSpace: "nowrap" as const, flexShrink: 0 }}>
                プルリクエストを作成
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
