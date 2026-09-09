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

  // 上の余白は TaskWorkspace の固定ブロックへ預ける（stickyPadTop）。
  // ここに padding-top を残すと、その分だけ上部が動いてから固定される。
  return (
    <div style={{ padding: "0 24px", minWidth: 900 }}>
      <TaskWorkspace
        scopeKey="all"
        title="タスク"
        initialTaskId={initialTaskId}
        onConsumeInitialTask={consume}
        stickyPadTop={24}
      />
    </div>
  );
}
