import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { FolderKanban, ChevronRight } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { mapProject, mapSprint, mapTicketCategory } from "@/app/lib/mappers";
import { PROJECTS, SPRINTS } from "@/app/data/mock";
import type { AccessLevel, Project, Sprint, TicketCategory, UserPermissions } from "@/app/types";
import { TICKET_STATUSES } from "@/app/lib/helpers";
import { buildCategoryMap, resolveCategoryLabel } from "@/app/lib/ticketCategory";
import {
  TICKET_SEARCH_PATH, applyColumnFilters, buildRows, columnOptionsOf, emptyCriteria,
  filterRows, hasAnyCriteria, hasColumnFilters, sortRows,
  type ColumnFilters, type SearchSortCol, type SortDir, type TicketSearchCriteria, type TicketSearchRow,
} from "@/app/lib/ticketSearch";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { TicketSearchFilters, type FilterOption } from "@/app/components/tickets/TicketSearchFilters";
import { TicketSearchResults } from "@/app/components/tickets/TicketSearchResults";
import { useBulkTicketActions } from "@/app/components/sprints/useBulkTicketActions";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { projectAccessView } from "@/app/components/shared/NotFoundView";
import { applySprintOrder, fetchSprintOrder } from "@/app/lib/sprintOrder";
import { findProjectBySlug } from "@/app/lib/projectResolve";
import { useCanonicalSlugRedirect } from "@/app/hooks/useCanonicalSlugRedirect";
import { useScrollRestore } from "@/app/hooks/useScrollRestore";

// ENHA2-048 チケット一覧検索。
// プロジェクト配下のスプリントを横断して、条件に合うチケットを1枚の表に並べる。
// 上部の条件エリアは普通にスクロールして流れ、表の見出し行だけが画面上端で貼り付く
// （貼り付き/剥がれは TicketSearchResults の position:sticky が担当）。

const PRIORITY_OPTIONS: FilterOption[] = [
  { value: "high", label: "高", color: "#DC2626", bg: "#FEF2F2" },
  { value: "medium", label: "中", color: "#D97706", bg: "#FFFBEB" },
  { value: "low", label: "低", color: "#0284C7", bg: "#F0F9FF" },
];

const STATUS_OPTIONS: FilterOption[] = TICKET_STATUSES.map(s => ({
  value: s.value, label: s.label, color: s.color, bg: s.bg,
}));

const UNASSIGNED_LABEL = "（未割当）";

export function TicketSearchPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const { userId, userName, userRole, userOrgId } = useAuth();
  const { plan } = usePlan();

  const [project, setProject] = useState<Project | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [sprintOrder, setSprintOrder] = useState<string[]>([]);
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [notFound, setNotFound] = useState(false);
  // 旧識別子(project_slug_aliases)で着地したときの現行slug。URLを正へ寄せるためだけに使う
  const [aliasCanonicalSlug, setAliasCanonicalSlug] = useState<string | null>(null);
  const [projectPermissions, setProjectPermissions] = useState<UserPermissions | null>(null);
  const [projectPermissionsLoaded, setProjectPermissionsLoaded] = useState(false);

  const [criteria, setCriteria] = useState<TicketSearchCriteria>(emptyCriteria);
  // 列見出し側の絞り込み（スプリント一覧の表と同じ操作）。上部の条件エリアとはANDで効く
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  const [sortCol, setSortCol] = useState<SearchSortCol | "">("");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [selectedWbs, setSelectedWbs] = useState<string | null>(null);
  // パネルを閉じた直後、どの行を見ていたか分かるように残す目印
  const [closedHighlightWbs, setClosedHighlightWbs] = useState<string | null>(null);
  // 別スプリントへ移動して閉じたときの移動後WBS。移動元のWBSはもう無いので目印を差し替える
  const movedAwayRef = useRef<string | null>(null);

  const isAdmin = userRole === "owner" || userRole === "admin";

  const scrollRestoreRef = useScrollRestore(
    projectSlug ? `ticket-search:${projectSlug}` : null,
    { ready: !loading, disabled: !!selectedWbs },
  );

  // ── データ取得 ──────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!isSupabaseEnabled) {
      // Supabase 無しの開発時。スプリント一覧と同じモックを見せる
      const mock = PROJECTS.find(p => p.slug === projectSlug?.toUpperCase());
      if (mock) { setProject(mock); setSprints(SPRINTS.filter(s => s.projectId === mock.id)); }
      setLoading(false); setProjectPermissionsLoaded(true);
      return;
    }
    if (!projectSlug) { setLoading(false); setProjectPermissionsLoaded(true); return; }
    // 404画面はリダイレクトせずその場に留まるので、別PJへ移ったときに前回の判定を
    // 引きずらないよう毎回クリアしてから引き直す。
    setNotFound(false);
    const found = await findProjectBySlug(projectSlug);
    if (!found) { setNotFound(true); setLoading(false); setProjectPermissionsLoaded(true); return; }
    const p = found.row;
    setAliasCanonicalSlug(found.viaAlias ? found.canonicalSlug : null);
    setProject(mapProject(p));

    const [{ data: s }, { data: cats }, { data: pmp }, order] = await Promise.all([
      supabase!.from("sprints").select("*, sprint_tickets(*)").eq("project_id", p.id)
        .order("start_date")
        .order("created_at", { referencedTable: "sprint_tickets" })
        .order("id", { referencedTable: "sprint_tickets" }),
      supabase!.from("ticket_categories").select("*").eq("project_id", p.id),
      userId
        ? supabase!.from("project_member_permissions").select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle()
        : Promise.resolve({ data: null }),
      fetchSprintOrder(p.id, userId),
    ]);
    setSprints((s ?? []).map(mapSprint));
    setCategories((cats ?? []).map(mapTicketCategory));
    setSprintOrder(order);
    if (pmp?.permissions) setProjectPermissions(pmp.permissions as UserPermissions);
    setProjectPermissionsLoaded(true);
    setLoading(false);
  }, [projectSlug, userId]);

  useEffect(() => {
    load().catch(() => { setNotFound(true); setProjectPermissionsLoaded(true); setLoading(false); });
  }, [load]);

  // 旧識別子で来たURLを現行のものへ置き換える（配布済みリンクの受け皿）
  useCanonicalSlugRedirect(projectSlug, aliasCanonicalSlug);

  // 他の人の更新を拾う。スプリント一覧と同じ間隔。条件は画面側の状態なので消えない。
  useEffect(() => {
    if (!isSupabaseEnabled || !project?.id) return;
    const id = setInterval(() => { load().catch(() => { }); }, 60000);
    return () => clearInterval(id);
  }, [project?.id, load]);

  // 詳細パネルはURLだけ差し替えて開く（スプリント一覧と同じ作り）。
  // ブラウザの戻る／進むでもパネルの開閉が合うようにしておく。
  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname;
      const match = path.match(new RegExp(`^/${projectSlug}/(.+)$`));
      const seg = match ? match[1] : null;
      setSelectedWbs(seg && seg !== TICKET_SEARCH_PATH ? seg : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [projectSlug]);

  // ── 表示用の組み立て ────────────────────────────────────────
  const orderedSprints = useMemo(() => applySprintOrder(sprints, sprintOrder), [sprints, sprintOrder]);

  const allTickets = useMemo(() => orderedSprints.flatMap(s => s.tickets), [orderedSprints]);

  const categoryMap = useMemo(() => buildCategoryMap(categories, allTickets), [categories, allTickets]);

  const rows = useMemo(
    () => buildRows(orderedSprints, t => resolveCategoryLabel(t, categoryMap)),
    [orderedSprints, categoryMap],
  );

  const sprintOrderIndex = useMemo(
    () => new Map(orderedSprints.map((s, i) => [s.id, i])),
    [orderedSprints],
  );

  // 上部の条件エリアで絞ったところ。列見出しの候補はこの一覧から作る
  // （列で絞ったあとの一覧から作ると、選んだ値しか候補に残らず選び直せなくなる）
  const criteriaRows = useMemo(() => filterRows(rows, criteria), [rows, criteria]);

  const visibleRows = useMemo(
    () => sortRows(applyColumnFilters(criteriaRows, columnFilters), sortCol, sortDir, sprintOrderIndex),
    [criteriaRows, columnFilters, sortCol, sortDir, sprintOrderIndex],
  );

  const getColumnOptions = useCallback(
    (col: SearchSortCol) => columnOptionsOf(criteriaRows, col),
    [criteriaRows],
  );

  // 一括操作（選択・アサイン・移動・リンクコピー・エクスポート・削除）は
  // スプリント管理の一覧と共通のフック。選択はスプリントをまたいで保持される。
  const sprintNameByTicketId = useMemo(() => {
    const m = new Map<string, string>();
    orderedSprints.forEach(s => s.tickets.forEach(t => m.set(t.id, s.name)));
    return m;
  }, [orderedSprints]);

  const bulk = useBulkTicketActions({
    tickets: allTickets,
    moveTargets: orderedSprints,
    projectId: project?.id ?? null,
    projectSlug,
    projectMembers: project?.members,
    onUpdated: load,
    exportOptions: {
      title: `${project?.name || projectSlug || "チケット"} 一覧検索`,
      enabled: plan.featureCsvExport,
      getSprintName: t => sprintNameByTicketId.get(t.id) ?? "",
      getCategoryLabel: t => resolveCategoryLabel(t, categoryMap),
      // 画面に出ている並び（条件・列フィルタ・並び替え適用後）のままで書き出す
      order: visibleRows.map(r => r.ticket),
    },
  });

  // ── 絞り込みの候補 ──────────────────────────────────────────
  const assigneeOptions = useMemo<FilterOption[]>(() => {
    const names = new Set<string>((project?.members ?? []).filter(Boolean));
    let hasUnassigned = false;
    allTickets.forEach(t => { if (t.assignee) names.add(t.assignee); else hasUnassigned = true; });
    const opts = [...names].sort((a, b) => a.localeCompare(b, "ja")).map(n => ({ value: n, label: n }));
    // 「担当者が空のチケットだけ見たい」も条件として選べるようにする
    if (hasUnassigned) opts.push({ value: "", label: UNASSIGNED_LABEL });
    return opts;
  }, [project?.members, allTickets]);

  const categoryOptions = useMemo<FilterOption[]>(() => {
    const labels = new Set(rows.map(r => r.categoryLabel));
    categories.forEach(c => { if (c.name) labels.add(c.name); });
    return [...labels].sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
  }, [rows, categories]);

  const sprintOptions = useMemo<FilterOption[]>(
    () => orderedSprints.map(s => ({ value: s.id, label: s.name })),
    [orderedSprints],
  );

  // ── 操作 ────────────────────────────────────────────────────
  const handleSort = (col: SearchSortCol, dir: SortDir) => { setSortCol(col); setSortDir(dir); };
  const clearSort = () => { setSortCol(""); setSortDir("asc"); };

  const setColumnFilter = (col: SearchSortCol, values: string[]) => {
    setColumnFilters(prev => ({ ...prev, [col]: values }));
  };

  const openTicket = (wbs: string) => {
    setClosedHighlightWbs(null);
    window.history.pushState({ fromTicketSearch: true }, "", `/${projectSlug}/${wbs}`);
    setSelectedWbs(wbs);
  };

  const closePanel = () => {
    // 移動していたら移動後のWBS。それ以外は今まで開いていたWBS
    const wbs = movedAwayRef.current ?? selectedWbs;
    movedAwayRef.current = null;
    window.history.pushState(null, "", `/${projectSlug}/${TICKET_SEARCH_PATH}`);
    setSelectedWbs(null);
    setClosedHighlightWbs(wbs);
    if (wbs) {
      requestAnimationFrame(() => {
        document.querySelector(`[data-wbs="${wbs}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  };

  const selected = useMemo<TicketSearchRow | null>(() => {
    if (!selectedWbs) return null;
    return rows.find(r => r.ticket.wbs === selectedWbs) ?? null;
  }, [selectedWbs, rows]);

  // ── ガード ─────────────────────────────────────────────────
  // 黙ってリダイレクトせず、理由と開こうとしたURLを出す（docs/not-found-page-design.md）。
  const accessBlocked = projectAccessView(notFound ? null : project, { userRole, userName, userOrgId });
  if (!loading && accessBlocked) return accessBlocked;

  const subNavPerm = (key: keyof UserPermissions | string): AccessLevel => {
    if (isAdmin) return "edit";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (projectPermissions as any)?.[key] as AccessLevel | undefined;
    return v ?? (projectPermissionsLoaded ? "none" : "view");
  };

  return (
    <div ref={scrollRestoreRef} style={{ padding: "24px 24px 24px", minWidth: 1280 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")}
          style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <button onClick={() => navigate(`/${projectSlug}`)}
          style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
          {project?.name ?? projectSlug ?? ""}
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>一覧検索</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.01em" }}>一覧検索</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>
            {!project ? "..." : loading ? project.name : `${project.name} · ${orderedSprints.length} スプリント / ${rows.length} チケット`}
          </p>
        </div>
        <ProjectSubNav
          projectSlug={projectSlug ?? project?.slug ?? ""}
          active="ticket-search" marginBottom={0}
          wikiPerm={subNavPerm("wikiPermission")}
          backlogPerm={subNavPerm("backlogPermission")}
          minutesPerm={subNavPerm("minutesPermission")}
          whiteboardPerm={subNavPerm("whiteboardPermission")}
        />
      </div>

      <TicketSearchFilters
        criteria={criteria}
        onChange={setCriteria}
        onClear={() => { setCriteria(emptyCriteria()); setColumnFilters({}); }}
        columnFilterActive={hasColumnFilters(columnFilters)}
        statusOptions={STATUS_OPTIONS}
        priorityOptions={PRIORITY_OPTIONS}
        assigneeOptions={assigneeOptions}
        categoryOptions={categoryOptions}
        sprintOptions={sprintOptions}
        resultCount={visibleRows.length}
        totalCount={rows.length}
      />

      <TicketSearchResults
        rows={visibleRows}
        loading={loading}
        sortCol={sortCol}
        sortDir={sortDir}
        onSort={handleSort}
        onClearSort={clearSort}
        columnFilters={columnFilters}
        onColumnFilterChange={setColumnFilter}
        onClearColumnFilters={() => setColumnFilters({})}
        getColumnOptions={getColumnOptions}
        onSelect={row => openTicket(row.ticket.wbs)}
        highlightWbs={selectedWbs ?? closedHighlightWbs}
        hasCriteria={hasAnyCriteria(criteria) || hasColumnFilters(columnFilters)}
        selectedIds={bulk.selectedIds}
        onToggleTicket={bulk.toggleTicket}
        onSetSelection={(rs, checked) => bulk.setSelection(rs.map(r => r.ticket), checked)}
      />

      <TicketDetailPanel
        ticket={selected?.ticket ?? null}
        projectId={project?.id}
        sprintId={selected?.sprint.id}
        sprintSlug={selected?.sprint.identifier || undefined}
        projectSlug={projectSlug}
        projectPermissions={projectPermissions ?? undefined}
        onClose={closePanel}
        onUpdated={load}
        onDeleted={() => {
          setClosedHighlightWbs(null);
          window.history.pushState(null, "", `/${projectSlug}/${TICKET_SEARCH_PATH}`);
          setSelectedWbs(null);
          load().catch(() => { });
        }}
        // 移動先で採番し直されるので、閉じたあとは新しいWBSの行を目印にする（onClose の直前に来る）
        onMoved={movedWbs => { movedAwayRef.current = movedWbs; }}
        onSelectTicket={t => { if (t.wbs) openTicket(t.wbs); }}
      />

      {bulk.ui}
    </div>
  );
}
