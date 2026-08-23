// チケット詳細の「関連PR」（docs/github-integration-design.md 8-5）。
//
// view … 一覧の閲覧のみ。merge … 紐付けの追加・解除ができる。
// 自動検出の行には根拠（ブランチ名／タイトル）を必ず添える。誤検出を人が判断できるようにするため。
import { useCallback, useEffect, useState } from "react";
import { Github, Link2, Plus, X } from "lucide-react";
import { fetchTicketLinks, fetchPulls, linkTicket, unlinkTicket, GithubApiError } from "@/app/lib/github";
import { useToast } from "@/app/contexts/ToastContext";
import type { TicketGithubLink, GithubPull, GithubAccessLevel } from "@/app/types";

const BLACK = "#1F2328";

export function TicketPrSection({ projectId, ticketId, wbs }: {
  projectId: string;
  ticketId: string;
  /** 未紐付けのPRから候補を絞るために使う */
  wbs?: string;
}) {
  const { toast } = useToast();
  const [links, setLinks] = useState<TicketGithubLink[]>([]);
  const [level, setLevel] = useState<GithubAccessLevel>("none");
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState<GithubPull[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetchTicketLinks(projectId, ticketId);
      setLinks(r.links);
      setLevel(r.level);
    } catch {
      // リポジトリ未紐付け・権限なしはセクションごと出さない。エラー表示はしない
      setLevel("none");
    } finally {
      setLoaded(true);
    }
  }, [projectId, ticketId]);

  useEffect(() => { void load(); }, [load]);

  const openPicker = async () => {
    setPicking(true);
    if (available) return;
    try {
      const r = await fetchPulls(projectId);
      // WBSが一致するPRを先頭に持ってくる
      const sorted = wbs
        ? [...r.pulls].sort((a, b) => Number(b.detectedWbs.includes(wbs)) - Number(a.detectedWbs.includes(wbs)))
        : r.pulls;
      setAvailable(sorted);
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "PRを取得できませんでした", "error");
      setPicking(false);
    }
  };

  const handleLink = async (number: number) => {
    setBusy(true);
    try {
      await linkTicket(projectId, ticketId, "pull", number);
      await load();
      setPicking(false);
      toast(`#${number} を紐付けました`, "success");
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "紐付けに失敗しました", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async (id: number) => {
    setBusy(true);
    try {
      await unlinkTicket(projectId, id);
      await load();
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "解除に失敗しました", "error");
    } finally {
      setBusy(false);
    }
  };

  // 権限が無い／リポジトリ未紐付けのときはセクションごと出さない
  if (!loaded || level === "none") return null;

  return (
    <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Github style={{ width: 13, height: 13, color: BLACK }} />
          <p style={{ fontSize: 11, fontWeight: 700, color: "#1A1714" }}>関連PR</p>
        </div>
        {level === "merge" && (
          <button onClick={openPicker} disabled={busy}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "1px solid rgba(26,23,20,0.14)", background: "#FFF", color: BLACK, cursor: busy ? "default" : "pointer" }}>
            <Plus style={{ width: 11, height: 11 }} />PRを紐付ける
          </button>
        )}
      </div>

      {links.length === 0 ? (
        <p style={{ fontSize: 11, color: "#B0A9A4" }}>紐付いたPRはありません。</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
          {links.map(l => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "#F9FAFB", border: "1px solid rgba(26,23,20,0.06)", borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: l.state === "merged" ? "#7C3AED" : l.state === "closed" ? "#DC2626" : "#059669", flexShrink: 0 }}>
                {l.state === "merged" ? "✔" : l.state === "closed" ? "✕" : "●"}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#8A837B", fontFamily: "var(--font-mono)", flexShrink: 0 }}>#{l.number}</span>
              <a href={l.url ?? undefined} target="_blank" rel="noopener noreferrer"
                style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: "#1A1714", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                {l.title ?? `#${l.number}`}
              </a>
              <span style={{ fontSize: 10, color: "#A09790", flexShrink: 0 }}>
                {l.state === "merged" ? "マージ済み" : l.state === "closed" ? "クローズ" : "オープン"}
              </span>
              {l.autoLinked && l.autoReason && (
                <span style={{ fontSize: 10, color: "#0284C7", flexShrink: 0 }} title="自動検出">
                  自動検出（{l.autoReason}）
                </span>
              )}
              {level === "merge" && (
                <button onClick={() => handleUnlink(l.id)} disabled={busy} title="紐付けを解除"
                  style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: busy ? "default" : "pointer", color: "#B0A9A4", flexShrink: 0 }}>
                  <X style={{ width: 11, height: 11 }} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {picking && (
        <div style={{ marginTop: 10, border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: "#F4F5F6" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6B6458" }}>オープンなPRから選ぶ</span>
            <button onClick={() => setPicking(false)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#B0A9A4", display: "flex" }}>
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            {!available ? (
              <p style={{ fontSize: 11, color: "#B0A9A4", padding: "12px 10px" }}>読み込み中...</p>
            ) : available.length === 0 ? (
              <p style={{ fontSize: 11, color: "#B0A9A4", padding: "12px 10px" }}>オープンなプルリクエストはありません。</p>
            ) : (
              available.map(p => {
                const already = links.some(l => l.kind === "pull" && l.number === p.number);
                return (
                  <button key={p.number} onClick={() => !already && handleLink(p.number)} disabled={already || busy}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", border: "none", borderBottom: "1px solid rgba(26,23,20,0.05)", background: already ? "#F9FAFB" : "#FFF", cursor: already || busy ? "default" : "pointer", textAlign: "left" as const }}>
                    <Link2 style={{ width: 11, height: 11, color: "#0284C7", flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#8A837B", fontFamily: "var(--font-mono)", flexShrink: 0 }}>#{p.number}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.title}</span>
                    {wbs && p.detectedWbs.includes(wbs) && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", flexShrink: 0 }}>一致</span>
                    )}
                    {already && <span style={{ fontSize: 10, color: "#B0A9A4", flexShrink: 0 }}>紐付け済み</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
