// ENHA2-032 タスク（プロジェクト配下）。
//
// そのプロジェクトに紐付いたタスクだけを出す。中身は横断ビューと同じ TaskWorkspace で、
// 違いは projectId を渡すこと（＝新規作成時のプロジェクトが固定され、PJフィルタが消える）だけ。
import { useCallback, useEffect, useState } from "react";
import { useParams, Navigate } from "react-router";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { mapProject } from "@/app/lib/mappers";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { TaskWorkspace } from "@/app/components/tasks/TaskWorkspace";
import type { AccessLevel, Project, UserPermissions } from "@/app/types";

export function ProjectTasksPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const { userRole, userId } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // サブナビに出す他ページの権限（タスク自体はPJメンバーなら誰でも使える）
  const [wikiPerm, setWikiPerm] = useState<AccessLevel>("edit");
  const [backlogPerm, setBacklogPerm] = useState<AccessLevel>("edit");
  const [minutesPerm, setMinutesPerm] = useState<AccessLevel>("edit");
  const [whiteboardPerm, setWhiteboardPerm] = useState<AccessLevel>("edit");

  const isAdminRole = userRole === "owner" || userRole === "admin";

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    const { data: bySlug } = await supabase!.from("projects").select("*").eq("slug", projectSlug).limit(1);
    const p = bySlug?.[0] ?? (await supabase!.from("projects").select("*").eq("id", projectSlug).maybeSingle()).data;
    if (!p) { setNotFound(true); setLoading(false); return; }
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

  if (notFound) return <Navigate to="/projects" replace />;
  if (loading || !project) return <PageLoader label="プロジェクトを読み込み中..." />;

  return (
    <div style={{ padding: "24px 24px 0", minWidth: 900 }}>
      <ProjectSubNav
        projectSlug={projectSlug ?? project.slug} active="tasks" marginBottom={16}
        wikiPerm={wikiPerm} backlogPerm={backlogPerm}
        minutesPerm={minutesPerm} whiteboardPerm={whiteboardPerm}
      />
      <TaskWorkspace
        scopeKey={project.id}
        projectId={project.id}
        projectSlug={project.slug}
        title="タスク"
        subtitle={`${project.name} · チケットとは別に管理する軽いタスク`}
      />
    </div>
  );
}
