// WBSのマスタースケジュール画面（/:projectSlug/wbs/:wbsId/master）。
//
// WBS画面の「マスタースケジュール」ボタンから開く。大項目だけを並べ、期間を矢羽根で表示する。
// 見るだけの画面。見られる人はWBS画面と同じ（WBSの権限と、そのWBSの公開設定）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { FolderKanban, ChevronRight, ArrowLeft } from "lucide-react";
import { isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { mapProject } from "@/app/lib/mappers";
import type { AccessLevel, Project, WbsHoliday, WbsItem, WbsSheet, WbsStatus } from "@/app/types";
import { findProjectBySlug } from "@/app/lib/projectResolve";
import { useCanonicalSlugRedirect } from "@/app/hooks/useCanonicalSlugRedirect";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { NotFoundView, projectAccessView } from "@/app/components/shared/NotFoundView";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { WBS_FOCUS_STATE_KEY, WBS_LEVEL_LABELS, loadWbsHolidays, loadWbsItems, loadWbsPermission, loadWbsSheets, loadWbsStatuses } from "@/app/lib/wbsService";
import { buildWbsMasterRows, buildWbsMasterTimeline, buildWbsRows, todayStr, type WbsMasterScale } from "@/app/lib/wbsCalc";
import { WbsMasterSchedule } from "@/app/components/wbs/WbsMasterSchedule";
import { WBS_COLORS, wbsToolBtn, wbsToolLabel } from "@/app/components/wbs/wbsStyles";

const SCALES: { value: WbsMasterScale; label: string }[] = [
  { value: "day", label: "日" },
  { value: "week", label: "週" },
  { value: "month", label: "月" },
];

export function WbsMasterSchedulePage() {
  const { projectSlug, wbsId } = useParams<{ projectSlug: string; wbsId: string }>();
  const navigate = useNavigate();
  const { userId, userName, userRole, userOrgId } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [sheet, setSheet] = useState<WbsSheet | null>(null);
  const [items, setItems] = useState<WbsItem[]>([]);
  const [holidays, setHolidays] = useState<WbsHoliday[]>([]);
  const [statuses, setStatuses] = useState<WbsStatus[]>([]);
  const [perm, setPerm] = useState<AccessLevel>("none");
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [notFound, setNotFound] = useState(false);
  const [aliasCanonicalSlug, setAliasCanonicalSlug] = useState<string | null>(null);
  // 全体を見渡すための画面なので、はじめは月の目盛りで開く
  const [scale, setScale] = useState<WbsMasterScale>("month");
  const initializedRef = useRef(false);

  const isAdminRole = userRole === "owner" || userRole === "admin";

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug || !wbsId) { setLoading(false); return; }
    setNotFound(false);
    const found = await findProjectBySlug(projectSlug);
    if (!found) { setNotFound(true); setLoading(false); return; }
    const p = found.row;
    setAliasCanonicalSlug(found.viaAlias ? found.canonicalSlug : null);
    setProject(mapProject(p));

    const [level, list] = await Promise.all([loadWbsPermission(p.id, userId, isAdminRole), loadWbsSheets(p.id)]);
    setPerm(level);
    const target = list.find(s => s.id === wbsId) ?? null;
    setSheet(target);
    if (target) {
      const [its, hols, sts] = await Promise.all([loadWbsItems(target.id), loadWbsHolidays(p.id, target.id), loadWbsStatuses(target.id)]);
      setItems(its);
      setHolidays(hols);
      setStatuses(sts);
    }
    initializedRef.current = true;
    setLoading(false);
  }, [projectSlug, wbsId, userId, isAdminRole]);

  useEffect(() => {
    load().catch(() => { setNotFound(true); setLoading(false); });
  }, [load]);

  useCanonicalSlugRedirect(projectSlug, aliasCanonicalSlug);

  // 見られないWBS（消された・公開範囲の外）のときは、WBS画面へ寄せる（WBS画面が見られる先頭を開く）
  useEffect(() => {
    if (loading || !projectSlug || perm === "none" || !project) return;
    if (!sheet) navigate(`/${projectSlug}/wbs`, { replace: true });
  }, [loading, projectSlug, perm, project, sheet, navigate]);

  const today = todayStr();
  const rows = useMemo(
    () => (sheet ? buildWbsMasterRows(buildWbsRows(items, sheet.levels, today, statuses), statuses) : []),
    [items, sheet, today, statuses],
  );
  const statusColors = useMemo(() => new Map(statuses.map(s => [s.name, s.color])), [statuses]);
  const holidaySet = useMemo(() => new Set(holidays.map(h => h.date)), [holidays]);
  const timeline = useMemo(() => buildWbsMasterTimeline(rows, scale, holidaySet, today), [rows, scale, holidaySet, today]);

  const backToWbs = () => navigate(`/${projectSlug}/wbs/${wbsId}`);

  const accessBlocked = projectAccessView(notFound ? null : project, { userRole, userName, userOrgId });
  if (!loading && accessBlocked) return accessBlocked;
  if (loading && !initializedRef.current) return <PageLoader label="マスタースケジュールを読み込み中..." />;
  if (!loading && perm === "none") return <NotFoundView kind="no-permission" label="WBS" />;

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", boxSizing: "border-box", padding: "24px 24px 16px", minWidth: 1280, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12, flexShrink: 0 }}>
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
        <button onClick={backToWbs}
          style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
          WBS
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>マスタースケジュール</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            マスタースケジュール
          </h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {project && sheet ? `${project.name} · ${sheet.name} · 大項目 ${rows.length} 件` : "..."}
          </p>
        </div>
        <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="wbs" marginBottom={0} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexShrink: 0 }}>
        <button type="button" onClick={backToWbs} style={wbsToolBtn}>
          <ArrowLeft style={{ width: 12, height: 12 }} />WBSに戻る
        </button>
        <span style={{ ...wbsToolLabel, marginLeft: 6 }}>表示</span>
        <div style={{ display: "inline-flex" }}>
          {SCALES.map((s, i) => {
            const active = s.value === scale;
            return (
              <button key={s.value} type="button" onClick={() => setScale(s.value)} aria-pressed={active}
                style={{ ...wbsToolBtn, padding: "0 14px",
                  borderRadius: i === 0 ? "8px 0 0 8px" : i === SCALES.length - 1 ? "0 8px 8px 0" : 0,
                  marginLeft: i === 0 ? 0 : -1,
                  ...(active ? { color: "#FFFFFF", background: "#059669", border: "1px solid #059669", position: "relative", zIndex: 1 } : null) }}>
                {s.label}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        {rows.length > 0 && (
          <span style={{ fontSize: 12, color: "#A09790", whiteSpace: "nowrap" }}>
            行を押すと、WBSの画面でその大項目の位置を表示します
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, background: "#FFFFFF", border: `1px solid ${WBS_COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        {sheet && <WbsMasterSchedule rows={rows} timeline={timeline} leafLabel={WBS_LEVEL_LABELS[sheet.levels - 1]} statusColors={statusColors}
          // URL は変えず、移動先の行を画面の移動に持たせる（WbsPage が受け取って、その行を強調する）
          onOpenItem={id => navigate(`/${projectSlug}/wbs/${wbsId}`, { state: { [WBS_FOCUS_STATE_KEY]: id } })} />}
      </div>
    </div>
  );
}
