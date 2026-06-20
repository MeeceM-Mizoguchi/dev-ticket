import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, Hash, Layers, FolderKanban, Users, MessageSquare, AlignLeft } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, SPRINTS, MEMBERS } from "@/app/data/mock";
import { htmlToText } from "@/app/lib/helpers";

interface TicketResult {
  type: "ticket";
  id: string;
  title: string;
  wbs: string;
  status: string;
  projectId: string;
  projectName: string;
  sprintId: string;
  sprintName: string;
}
interface SprintResult {
  type: "sprint";
  id: string;
  name: string;
  status: string;
  projectId: string;
  projectName: string;
}
interface ProjectResult {
  type: "project";
  id: string;
  name: string;
  client: string;
  status: string;
}
interface MemberResult {
  type: "member";
  id: string;
  name: string;
  email: string;
  role: string;
}
interface CommentResult {
  type: "comment";
  id: string;
  content: string;
  ticketId: string;
  ticketWbs: string;
  ticketTitle: string;
  sprintId: string;
  projectId: string;
  projectName: string;
  sprintName: string;
}
interface DescriptionResult {
  type: "description";
  id: string;
  title: string;
  wbs: string;
  status: string;
  sprintId: string;
  sprintName: string;
  projectId: string;
  projectName: string;
  snippet: string;
}
type SearchResult = TicketResult | SprintResult | ProjectResult | MemberResult | CommentResult | DescriptionResult;
interface SearchResults {
  tickets: TicketResult[];
  sprints: SprintResult[];
  projects: ProjectResult[];
  members: MemberResult[];
  comments: CommentResult[];
  descriptions: DescriptionResult[];
}

const STATUS_LABELS: Record<string, string> = {
  "todo": "未着手", "in-progress": "進行中", "in-review": "レビュー中",
  "review-done": "レビュー完了", "stg-test": "STGテスト", "uat": "UAT",
  "done": "完了", "closed": "クローズ", "planning": "計画中",
  "active": "進行中", "completed": "完了", "delayed": "遅延", "on-hold": "保留",
};

const ROLE_LABELS: Record<string, string> = {
  "admin": "管理者", "project-manager": "PM", "developer": "開発者",
  "designer": "デザイナー", "tester": "テスター",
};

function searchMock(query: string, userName: string, userRole: string): SearchResults {
  const q = query.toLowerCase();
  const isAdmin = userRole === "admin" || userRole === "project-manager" || userRole === "owner";
  const accessible = isAdmin ? PROJECTS : PROJECTS.filter(p => p.members.includes(userName));
  const accessibleIds = new Set(accessible.map(p => p.id));

  const projects: ProjectResult[] = accessible
    .filter(p => p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q))
    .slice(0, 5)
    .map(p => ({ type: "project", id: p.id, name: p.name, client: p.client, status: p.status }));

  const accessibleSprints = SPRINTS.filter(s => accessibleIds.has(s.projectId));
  const sprints: SprintResult[] = accessibleSprints
    .filter(s => s.name.toLowerCase().includes(q) || s.goal.toLowerCase().includes(q))
    .slice(0, 5)
    .map(s => {
      const proj = PROJECTS.find(p => p.id === s.projectId);
      return { type: "sprint", id: s.id, name: s.name, status: s.status, projectId: s.projectId, projectName: proj?.name ?? "" };
    });

  const tickets: TicketResult[] = [];
  for (const s of accessibleSprints) {
    const proj = PROJECTS.find(p => p.id === s.projectId);
    for (const t of s.tickets) {
      if (t.title.toLowerCase().includes(q) || t.wbs.toLowerCase().includes(q)) {
        tickets.push({ type: "ticket", id: t.id, title: t.title, wbs: t.wbs, status: t.status, projectId: s.projectId, projectName: proj?.name ?? "", sprintId: s.id, sprintName: s.name });
        if (tickets.length >= 5) break;
      }
    }
    if (tickets.length >= 5) break;
  }

  const members: MemberResult[] = MEMBERS
    .filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    .slice(0, 5)
    .map(m => ({ type: "member", id: m.id, name: m.name, email: m.email, role: m.role }));

  return { tickets, sprints, projects, members, comments: [], descriptions: [] };
}

const EMPTY: SearchResults = { tickets: [], sprints: [], projects: [], members: [], comments: [], descriptions: [] };

export function GlobalSearch() {
  const { userName, userRole, userOrgId } = useAuth();
  const { selectedOrgId } = useOrg();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAdmin = userRole === "admin" || userRole === "project-manager" || userRole === "owner";

  const hasResults = results.tickets.length + results.descriptions.length + results.comments.length + results.sprints.length + results.projects.length + results.members.length > 0;

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults(EMPTY);
      setIsOpen(false);
      return;
    }
    setIsLoading(true);
    setIsOpen(true);

    if (!isSupabaseEnabled) {
      setResults(searchMock(q, userName, userRole));
      setIsLoading(false);
      return;
    }

    try {
      // Get accessible projects with their sprints in one query_
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let projQuery = supabase!.from("projects").select("id, name, client, status, members, organization_id, sprints(id, name, status, project_id)");
      if (userRole === "owner") {
        if (selectedOrgId) projQuery = projQuery.eq("organization_id", selectedOrgId);
      } else if (userOrgId) {
        projQuery = projQuery.or(`organization_id.eq.${userOrgId},organization_id.is.null`);
      }
      const { data: projData } = await projQuery as { data: any[] | null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accessible: any[] = isAdmin ? (projData ?? []) : (projData ?? []).filter(p => Array.isArray(p.members) && p.members.includes(userName));
      const sprintIds: string[] = accessible.flatMap(p => (p.sprints ?? []).map((s: { id: string }) => s.id));

      const ql = q.toLowerCase();
      const projectResults: ProjectResult[] = accessible
        .filter(p => p.name.toLowerCase().includes(ql) || (p.client ?? "").toLowerCase().includes(ql))
        .slice(0, 5)
        .map(p => ({ type: "project", id: p.id, name: p.name, client: p.client ?? "", status: p.status }));

      // Build sprint map for lookup
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sprintMap = new Map<string, { id: string; name: string; status: string; projectId: string; projectName: string }>();
      for (const p of accessible) {
        for (const s of (p.sprints ?? [])) {
          sprintMap.set(s.id, { id: s.id, name: s.name, status: s.status, projectId: p.id, projectName: p.name });
        }
      }

      const sprintResults: SprintResult[] = Array.from(sprintMap.values())
        .filter(s => s.name.toLowerCase().includes(ql))
        .slice(0, 5)
        .map(s => ({ type: "sprint", ...s }));

      // Parallel: search tickets(title/wbs/description) + members + raw comments
      const [ticketResp, memberResp, rawCommentResp] = await Promise.all([
        sprintIds.length > 0
          ? supabase!.from("sprint_tickets").select("id, title, wbs, status, sprint_id, description").or(`title.ilike.%${q}%,wbs.ilike.%${q}%,description.ilike.%${q}%`).in("sprint_id", sprintIds).limit(10)
          : Promise.resolve({ data: [] }),
        (() => {
          let mq = supabase!.from("profiles").select("id, name, email, role").or(`name.ilike.%${q}%,email.ilike.%${q}%`).limit(5);
          if (userRole === "owner") { if (selectedOrgId) mq = mq.eq("organization_id", selectedOrgId); }
          else if (userOrgId) mq = mq.eq("organization_id", userOrgId);
          return mq;
        })(),
        sprintIds.length > 0
          ? supabase!.from("ticket_comments").select("id, content, ticket_id").eq("comment_type", "comment").ilike("content", `%${q}%`).limit(20)
          : Promise.resolve({ data: [] }),
      ]);

      // Split ticket results: title/WBS match → TicketResult, description-only match → DescriptionResult
      const ticketResults: TicketResult[] = [];
      const descriptionResults: DescriptionResult[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const t of (ticketResp.data ?? []) as any[]) {
        const sprint = sprintMap.get(t.sprint_id);
        const titleOrWbs = t.title.toLowerCase().includes(ql) || (t.wbs ?? "").toLowerCase().includes(ql);
        if (titleOrWbs && ticketResults.length < 5) {
          ticketResults.push({ type: "ticket", id: t.id, title: t.title, wbs: t.wbs ?? "", status: t.status, sprintId: t.sprint_id, sprintName: sprint?.name ?? "", projectId: sprint?.projectId ?? "", projectName: sprint?.projectName ?? "" });
        } else if (!titleOrWbs && descriptionResults.length < 5) {
          const snippet = htmlToText(t.description ?? "").slice(0, 70);
          descriptionResults.push({ type: "description", id: t.id, title: t.title, wbs: t.wbs ?? "", status: t.status, sprintId: t.sprint_id, sprintName: sprint?.name ?? "", projectId: sprint?.projectId ?? "", projectName: sprint?.projectName ?? "", snippet });
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memberResults: MemberResult[] = (memberResp.data ?? []).map((m: any) => ({ type: "member", id: m.id, name: m.name, email: m.email, role: m.role }));

      // Comments: resolve ticket info via a second query (no FK join needed)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawComments = (rawCommentResp.data ?? []) as any[];
      const commentTicketIds = [...new Set(rawComments.map(c => c.ticket_id).filter(Boolean))];
      let commentResults: CommentResult[] = [];
      if (commentTicketIds.length > 0) {
        const { data: ctData } = await supabase!.from("sprint_tickets").select("id, wbs, title, sprint_id").in("id", commentTicketIds).in("sprint_id", sprintIds);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctMap = new Map<string, any>((ctData ?? []).map((t: any) => [t.id, t]));
        commentResults = rawComments
          .filter(c => ctMap.has(c.ticket_id))
          .slice(0, 5)
          .map(c => {
            const ticket = ctMap.get(c.ticket_id);
            const sprint = sprintMap.get(ticket.sprint_id);
            return { type: "comment" as const, id: c.id, content: c.content, ticketId: c.ticket_id, ticketWbs: ticket.wbs ?? "", ticketTitle: ticket.title ?? "", sprintId: ticket.sprint_id, projectId: sprint?.projectId ?? "", projectName: sprint?.projectName ?? "", sprintName: sprint?.name ?? "" };
          });
      }

      setResults({ tickets: ticketResults, sprints: sprintResults, projects: projectResults, members: memberResults, comments: commentResults, descriptions: descriptionResults });
    } catch {
      setResults(EMPTY);
    } finally {
      setIsLoading(false);
    }
  }, [userName, userRole, userOrgId, selectedOrgId, isAdmin]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const clearQuery = () => {
    setQuery("");
    setResults(EMPTY);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleSelect = (result: SearchResult) => {
    setIsOpen(false);
    setQuery("");
    switch (result.type) {
      case "ticket":
        navigate(`/${result.projectId}/${result.wbs}`);
        break;
      case "description":
        navigate(`/${result.projectId}/${result.wbs}?anchor=description`);
        break;
      case "comment":
        navigate(`/${result.projectId}/${result.ticketWbs}?anchor=comment:${result.id}`);
        break;
      case "sprint":
        navigate(`/${result.projectId}/sprint/${result.id}`);
        break;
      case "project":
        navigate(`/${result.id}`);
        break;
      case "member":
        navigate("/members", { state: { highlightMemberId: result.id } });
        break;
    }
  };

  const avatarInitial = (name: string) => name.charAt(0);

  const CategoryHeader = ({ icon, label, color, showBorder }: { icon: React.ReactNode; label: string; color: string; showBorder: boolean }) => (
    <div style={{ padding: "9px 14px 5px", display: "flex", alignItems: "center", gap: 5, borderTop: showBorder ? "1px solid rgba(26,23,20,0.07)" : undefined, background: "#FAFAFA" }}>
      {icon}
      <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
    </div>
  );

  const ResultRow = ({ onClick, hoverColor, children }: { onClick: () => void; hoverColor: string; children: React.ReactNode }) => (
    <div
      onClick={onClick}
      style={{ padding: "7px 14px", cursor: "pointer", transition: "background 0.1s", borderTop: "1px solid rgba(26,23,20,0.04)" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = hoverColor; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {children}
    </div>
  );

  return (
    <div ref={containerRef} style={{ flex: 1, maxWidth: 440, position: "relative" }}>
      <div style={{ position: "relative" }}>
        <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: query ? "#059669" : "#C9C4BB", pointerEvents: "none", transition: "color 0.15s" }} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={e => {
            e.currentTarget.style.background = "#fff";
            e.currentTarget.style.borderColor = "rgba(5,150,105,0.30)";
            e.currentTarget.style.boxShadow = "0 0 0 3px rgba(5,150,105,0.08)";
            if (query.length >= 2) setIsOpen(true);
          }}
          onBlur={e => {
            e.currentTarget.style.background = "#F4F5F6";
            e.currentTarget.style.borderColor = "transparent";
            e.currentTarget.style.boxShadow = "none";
          }}
          onKeyDown={e => { if (e.key === "Escape") { setIsOpen(false); e.currentTarget.blur(); } }}
          placeholder="チケット・スプリント・プロジェクト・メンバーを検索..."
          style={{ width: "100%", background: "#F4F5F6", border: "1px solid transparent", borderRadius: 8, padding: "6px 30px 6px 30px", fontSize: 12, color: "#1A1714", outline: "none", transition: "all 0.15s", boxSizing: "border-box" }}
        />
        {query && (
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={clearQuery}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", padding: 2, color: "#A09790", display: "flex", alignItems: "center", borderRadius: 4 }}
          >
            <X style={{ width: 12, height: 12 }} />
          </button>
        )}
      </div>

      {isOpen && (
        <div
          style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#fff", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.05)", border: "1px solid rgba(26,23,20,0.08)", zIndex: 9999, overflow: "hidden", maxHeight: 520, overflowY: "auto" }}
        >
          {isLoading ? (
            <div style={{ padding: "22px 16px", textAlign: "center", color: "#A09790", fontSize: 12 }}>検索中...</div>
          ) : hasResults ? (
            <>
              {results.tickets.length > 0 && (
                <div>
                  <CategoryHeader
                    icon={<Hash style={{ width: 10, height: 10, color: "#059669" }} />}
                    label="チケット"
                    color="#059669"
                    showBorder={false}
                  />
                  {results.tickets.map(t => (
                    <ResultRow key={t.id} onClick={() => handleSelect(t)} hoverColor="#F0FDF8">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#9E9690", minWidth: 34, flexShrink: 0 }}>{t.wbs}</span>
                        <span style={{ fontSize: 13, color: "#1A1714", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                        <span style={{ fontSize: 10, color: "#9E9690", flexShrink: 0 }}>{STATUS_LABELS[t.status] ?? t.status}</span>
                      </div>
                      <div style={{ marginLeft: 42, fontSize: 11, color: "#B0A9A4", marginTop: 1 }}>{t.projectName} / {t.sprintName}</div>
                    </ResultRow>
                  ))}
                </div>
              )}

              {results.descriptions.length > 0 && (
                <div>
                  <CategoryHeader
                    icon={<AlignLeft style={{ width: 10, height: 10, color: "#6366F1" }} />}
                    label="詳細記載"
                    color="#6366F1"
                    showBorder={results.tickets.length > 0}
                  />
                  {results.descriptions.map(d => (
                    <ResultRow key={d.id} onClick={() => handleSelect(d)} hoverColor="#EEF2FF">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#9E9690", minWidth: 34, flexShrink: 0 }}>{d.wbs}</span>
                        <span style={{ fontSize: 13, color: "#1A1714", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
                        <span style={{ fontSize: 10, color: "#9E9690", flexShrink: 0 }}>{STATUS_LABELS[d.status] ?? d.status}</span>
                      </div>
                      <div style={{ marginLeft: 42, fontSize: 11, color: "#B0A9A4", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.snippet}</div>
                    </ResultRow>
                  ))}
                </div>
              )}

              {results.comments.length > 0 && (
                <div>
                  <CategoryHeader
                    icon={<MessageSquare style={{ width: 10, height: 10, color: "#0891B2" }} />}
                    label="コメント"
                    color="#0891B2"
                    showBorder={results.tickets.length + results.descriptions.length > 0}
                  />
                  {results.comments.map(c => (
                    <ResultRow key={c.id} onClick={() => handleSelect(c)} hoverColor="#ECFEFF">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#9E9690", minWidth: 34, flexShrink: 0 }}>{c.ticketWbs}</span>
                        <span style={{ fontSize: 13, color: "#1A1714", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{htmlToText(c.content).slice(0, 60) || c.ticketTitle}</span>
                      </div>
                      <div style={{ marginLeft: 42, fontSize: 11, color: "#B0A9A4", marginTop: 1 }}>{c.ticketTitle} · {c.projectName} / {c.sprintName}</div>
                    </ResultRow>
                  ))}
                </div>
              )}

              {results.sprints.length > 0 && (
                <div>
                  <CategoryHeader
                    icon={<Layers style={{ width: 10, height: 10, color: "#7C3AED" }} />}
                    label="スプリント"
                    color="#7C3AED"
                    showBorder={results.tickets.length + results.descriptions.length + results.comments.length > 0}
                  />
                  {results.sprints.map(s => (
                    <ResultRow key={s.id} onClick={() => handleSelect(s)} hoverColor="#F5F3FF">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, color: "#1A1714", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                        <span style={{ fontSize: 10, color: "#9E9690", flexShrink: 0 }}>{STATUS_LABELS[s.status] ?? s.status}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#B0A9A4", marginTop: 1 }}>{s.projectName}</div>
                    </ResultRow>
                  ))}
                </div>
              )}

              {results.projects.length > 0 && (
                <div>
                  <CategoryHeader
                    icon={<FolderKanban style={{ width: 10, height: 10, color: "#D97706" }} />}
                    label="プロジェクト"
                    color="#D97706"
                    showBorder={results.tickets.length + results.descriptions.length + results.comments.length + results.sprints.length > 0}
                  />
                  {results.projects.map(p => (
                    <ResultRow key={p.id} onClick={() => handleSelect(p)} hoverColor="#FFFBEB">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, color: "#1A1714", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        <span style={{ fontSize: 10, color: "#9E9690", flexShrink: 0 }}>{STATUS_LABELS[p.status] ?? p.status}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#B0A9A4", marginTop: 1 }}>{p.client}</div>
                    </ResultRow>
                  ))}
                </div>
              )}

              {results.members.length > 0 && (
                <div>
                  <CategoryHeader
                    icon={<Users style={{ width: 10, height: 10, color: "#0891B2" }} />}
                    label="メンバー"
                    color="#0891B2"
                    showBorder={results.tickets.length + results.descriptions.length + results.comments.length + results.sprints.length + results.projects.length > 0}
                  />
                  {results.members.map(m => (
                    <ResultRow key={m.id} onClick={() => handleSelect(m)} hoverColor="#ECFEFF">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#E0F2FE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#0891B2", flexShrink: 0 }}>
                          {avatarInitial(m.name)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: "#1A1714", fontWeight: 500 }}>{m.name}</div>
                          <div style={{ fontSize: 11, color: "#B0A9A4" }}>{m.email}</div>
                        </div>
                        <span style={{ fontSize: 10, color: "#9E9690", flexShrink: 0 }}>{ROLE_LABELS[m.role] ?? m.role}</span>
                      </div>
                    </ResultRow>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: "22px 16px", textAlign: "center" as const }}>
              <p style={{ fontSize: 13, color: "#6B7280", margin: 0 }}>「{query}」に一致する結果がありません</p>
              <p style={{ fontSize: 11, color: "#B0A9A4", marginTop: 4 }}>別のキーワードでお試しください</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
