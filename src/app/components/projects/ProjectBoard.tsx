import { useCallback, useRef } from "react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import type { Project, ProjectStatus } from "@/app/types";
import { getStatusMeta } from "@/app/lib/helpers";
import { ProjectCard } from "@/app/components/projects/ProjectCard";
import { updateProjectStatus } from "@/app/hooks/useProject";

const DRAG_TYPE = "PROJECT_CARD";

const BOARD_COLUMNS: { status: ProjectStatus; label: string; color: string }[] = [
  { status: "planning",    label: "計画中",   color: "#C9C4BB" },
  { status: "in-progress", label: "進行中",   color: "#FB923C" },
  { status: "on-hold",     label: "保留中",   color: "#F59E0B" },
  { status: "completed",   label: "完了",     color: "#10B981" },
];

interface DragItem { id: string; currentStatus: ProjectStatus }

function DraggableCard({
  project, onNavigate, onEdit, onDelete, onCategorySettings, onMonitor,
}: {
  project: Project;
  onNavigate: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCategorySettings?: () => void;
  onMonitor?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ isDragging }, drag] = useDrag<DragItem, void, { isDragging: boolean }>({
    type: DRAG_TYPE,
    item: { id: project.id, currentStatus: project.status },
    collect: monitor => ({ isDragging: monitor.isDragging() }),
  });
  drag(ref);

  return (
    <div ref={ref} style={{ opacity: isDragging ? 0.45 : 1, cursor: "grab" }}>
      <ProjectCard
        project={project}
        onNavigate={onNavigate}
        onEdit={onEdit}
        onDelete={onDelete}
        onCategorySettings={onCategorySettings}
        onMonitor={onMonitor}
      />
    </div>
  );
}

function BoardColumn({
  status, label, color, projects,
  onDrop, onNavigate, onEdit, onDelete, onCategorySettings, onMonitor,
}: {
  status: ProjectStatus;
  label: string;
  color: string;
  projects: Project[];
  onDrop: (projectId: string, newStatus: ProjectStatus) => void;
  onNavigate: (project: Project) => void;
  onEdit?: (project: Project) => void;
  onDelete?: (project: Project) => void;
  onCategorySettings?: (project: Project) => void;
  onMonitor?: (project: Project) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ isOver }, drop] = useDrop<DragItem, void, { isOver: boolean }>({
    accept: DRAG_TYPE,
    drop: item => {
      if (item.currentStatus !== status) onDrop(item.id, status);
    },
    collect: monitor => ({ isOver: monitor.isOver() }),
  });
  drop(ref);

  return (
    <div ref={ref} style={{ flex: "1 1 0", minWidth: 260, maxWidth: 340, display: "flex", flexDirection: "column" }}>
      {/* Column header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px", background: "#FFFFFF", borderRadius: 10, border: "1px solid rgba(26,23,20,0.07)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#3D3732" }}>{label}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "var(--font-mono)", color: "#B0A9A4", fontWeight: 600 }}>{projects.length}</span>
      </div>

      {/* Drop zone */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minHeight: 120, padding: "8px", borderRadius: 10, background: isOver ? "rgba(5,150,105,0.05)" : "rgba(26,23,20,0.02)", border: `2px dashed ${isOver ? "rgba(5,150,105,0.35)" : "transparent"}`, transition: "all 0.15s" }}>
        {projects.map(p => (
          <DraggableCard
            key={p.id}
            project={p}
            onNavigate={() => onNavigate(p)}
            onEdit={onEdit ? () => onEdit(p) : undefined}
            onDelete={onDelete ? () => onDelete(p) : undefined}
            onCategorySettings={onCategorySettings ? () => onCategorySettings(p) : undefined}
            onMonitor={onMonitor ? () => onMonitor(p) : undefined}
          />
        ))}
        {projects.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#C9C4BB", fontSize: 12 }}>
            ここにドラッグ
          </div>
        )}
      </div>
    </div>
  );
}

export function ProjectBoard({
  projects,
  onProjectsChange,
  onNavigate,
  onEdit,
  onDelete,
  onCategorySettings,
  onMonitor,
}: {
  projects: Project[];
  onProjectsChange: (updater: (prev: Project[]) => Project[]) => void;
  onNavigate: (project: Project) => void;
  onEdit?: (project: Project) => void;
  onDelete?: (project: Project) => void;
  onCategorySettings?: (project: Project) => void;
  onMonitor?: (project: Project) => void;
}) {
  const handleDrop = useCallback(async (projectId: string, newStatus: ProjectStatus) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    onProjectsChange(prev => prev.map(p => p.id === projectId ? { ...p, status: newStatus } : p));

    const updates = await updateProjectStatus(projectId, newStatus, project);
    if (Object.keys(updates).length > 1) {
      onProjectsChange(prev => prev.map(p => p.id === projectId ? { ...p, ...updates } : p));
    }
  }, [projects, onProjectsChange]);

  return (
    <DndProvider backend={HTML5Backend}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", overflowX: "auto", paddingBottom: 8 }}>
        {BOARD_COLUMNS.map(col => (
          <BoardColumn
            key={col.status}
            status={col.status}
            label={col.label}
            color={col.color}
            projects={projects.filter(p => p.status === col.status)}
            onDrop={handleDrop}
            onNavigate={onNavigate}
            onEdit={onEdit}
            onDelete={onDelete}
            onCategorySettings={onCategorySettings}
            onMonitor={onMonitor}
          />
        ))}
      </div>
    </DndProvider>
  );
}
