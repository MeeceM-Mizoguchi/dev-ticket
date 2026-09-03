// ENHA2-032 タスク（プロジェクト配下）。
//
// そのプロジェクトに紐付いたタスクだけを出す。中身は横断ビューと同じ TaskWorkspace で、
// 違いは projectId を渡すこと（＝新規作成時のプロジェクトが固定され、PJフィルタが消える）だけ。
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { mapProject } from "@/app/lib/mappers";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { projectAccessView } from "@/app/components/shared/NotFoundView";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { TaskWorkspace } from "@/app/components/tasks/TaskWorkspace";
import type { AccessLevel, Project, UserPermissions } from "@/app/types";
import { findProjectBySlug } from "@/app/lib/projectResolve";
import { useCanonicalSlugRedirect } from "@/app/hooks/useCanonicalSlugRedirect";

export function ProjectTasksPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const { userRole, userId, userName, userOrgId } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // 旧識別子(project_slug_aliases)で着地したときの現行slug。URLを正へ寄せるためだけに使う
  const [aliasCanonicalSlug, setAliasCanonicalSlug] = useState<string | null>(null);

  // タスクの見出し〜フィルタもこの下に固定する（TaskWorkspace の stickyTop）。
  // 決め打ちにせず実測するのは、サブナビのタブがプラン・権限で増減するため。
  const [subNavEl, setSubNavEl] = useState<HTMLDivElement | null>(null);
  const [subNavHeight, setSubNavHeight] = useState(0);
  useEffect(() => {
    if (!subNavEl) return;
    const measure = () => setSubNavHeight(subNavEl.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(subNavEl);
    return () => ro.disconnect();
  }, [subNavEl]);

  // サブナビに出す他ページの権限（タスク自体はPJメンバーなら誰でも使える）
  const [wikiPerm, setWikiPerm] = useState<AccessLevel>("edit");
  const [backlogPerm, setBacklogPerm] = useState<AccessLevel>("edit");
  const [minutesPerm, setMinutesPerm] = useState<AccessLevel>("edit");
  const [whiteboardPerm, setWhiteboardPerm] = useState<AccessLevel>("edit");

  const isAdminRole = userRole === "owner" || userRole === "admin";

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    // 404画面はリダイレクトせずその場に留まるので、別PJへ移ったときに前回の判定を
    // 引きずらないよう毎回クリアしてから引き直す。
    setNotFound(false);
    const found = await findProjectBySlug(projectSlug);
    if (!found) { setNotFound(true); setLoading(false); return; }
    const p = found.row;
    setAliasCanonicalSlug(found.viaAlias ? found.canonicalSlug : null);
    setProject(mapProject(p));

    if (isAdminRole) {
      setWikiPerm("edit"); setBacklogPerm("edit"); setMinutesPerm("edit"); setWhiteboardPerm("edit");
    } else {
      const { data } = await supabase!
        .from("project_member_permissions").select("permissions")
        .eq("project_id", p.id).eq("member_id", userId).maybeSingle();
      const perms = data?.permissions as Partial<UserPermissions> | null;
      setWikiPerm((perms?.wikiPermission as AccessLevel | undefined) ?? "none");
      setBacklogPerm((perms?.backlogPermission as AccessLevel | undefined) ?? "none");
      setMinutesPerm((perms?.minutesPermission as AccessLevel | undefined) ?? "none");
      setWhiteboardPerm((perms?.whiteboardPermission as AccessLevel | undefined) ?? "none");
    }
    setLoading(false);
  }, [projectSlug, userId, isAdminRole]);

  useEffect(() => { load(); }, [load]);

  // 旧識別子で来たURLを現行のものへ置き換える（配布済みリンクの受け皿）
  useCanonicalSlugRedirect(projectSlug, aliasCanonicalSlug);

  // 黙ってリダイレクトせず、理由と開こうとしたURLを出す（docs/not-found-page-design.md）。
  // アサイン判定はここまで無かったので追加した（DB側は tasks_select の can_access_project() が
  // 既に弾いており、未アサインの人には「空のタスク一覧」が出ていた）。
  const accessBlocked = projectAccessView(notFound ? null : project, { userRole, userName, userOrgId });
  if (notFound && accessBlocked) return accessBlocked;
  if (loading || !project) return <PageLoader label="プロジェクトを読み込み中..." />;
  if (accessBlocked) return accessBlocked;

  return (
    <div style={{ padding: "24px 24px 0", minWidth: 900 }}>
      {/* 🌟 プロジェクト内タブを画面上部に固定（スプリント管理と同じ扱い）。
          タスクが増えると下スクロールでタブが見切れ、他画面へ移動できなくなっていた。
          margin の -24px は外側の padding を打ち消すため（背景を左右いっぱいに敷く） */}
      <div ref={setSubNavEl}
        style={{ position: "sticky", top: 0, zIndex: 200, background: "#F5F6F8", margin: "-24px -24px 0", padding: "24px 24px 16px" }}>
        <ProjectSubNav
          projectSlug={projectSlug ?? project.slug} active="tasks" marginBottom={0}
          wikiPerm={wikiPerm} backlogPerm={backlogPerm}
          minutesPerm={minutesPerm} whiteboardPerm={whiteboardPerm}
        />
      </div>
      <TaskWorkspace
        scopeKey={project.id}
        projectId={project.id}
        projectSlug={project.slug}
        title="タスク"
        subtitle={`${project.name} · チケットとは別に管理する軽いタスク`}
        stickyTop={subNavHeight}
      />
    </div>
  );
}
