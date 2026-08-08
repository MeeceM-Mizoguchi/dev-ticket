// ENHA2-032 タスク（横断ビュー）。
//
// 自分が持っているタスク、共有されたタスク、参加しているプロジェクトのタスクを
// まとめて1画面で見る。可視範囲は RLS が決めるので、ここに条件は書かない。
import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { TaskWorkspace } from "@/app/components/tasks/TaskWorkspace";

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // お知らせ（mention_context = "task:{id}"）からの着地
  const initialTaskId = searchParams.get("task");

  const consume = useCallback(() => {
    if (!searchParams.has("task")) return;
    searchParams.delete("task");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <div style={{ padding: "24px 24px 0", minWidth: 900 }}>
      <TaskWorkspace
        scopeKey="all"
        title="タスク"
        initialTaskId={initialTaskId}
        onConsumeInitialTask={consume}
      />
    </div>
  );
}
