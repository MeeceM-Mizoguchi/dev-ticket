import { useState } from "react";
import type { Project, ProjectStatus } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";
// 🌟 追加: CustomSelect コンポーネントをインポート
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { computeProjectStatus } from "@/app/lib/helpers";
import { findSlugConflict, SLUG_CONFLICT_MESSAGE } from "@/app/lib/projectResolve";

const RESERVED_SLUGS = new Set(["login", "dashboard", "projects", "clients", "members", "permissions", "roles", "settings", "accept-invite"]);
function sanitizeSlug(v: string) { return v.replace(/[^A-Z0-9]/g, ""); }

export function EditProjectDialog({ project, onClose, onUpdated }: {
  project: Project;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const { userOrgId } = useAuth();
  const orgId = project.organizationId ?? userOrgId;
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [startDate, setStartDate] = useState(project.startDate || "");
  const [endDate, setEndDate] = useState(project.endDate || "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [isManualStatus, setIsManualStatus] = useState<boolean>(project.isManualStatus ?? false);
  const [slug, setSlug] = useState(project.slug || "");
  const [slugError, setSlugError] = useState("");
  const [saving, setSaving] = useState(false);

  // ステータス手動変更時のハンドラー
  const handleStatusChange = (newStatus: ProjectStatus) => {
    setStatus(newStatus);
    setIsManualStatus(true);
  };

  // 自動設定トグルのON/OFF切替
  const handleToggleAuto = () => {
    if (isManualStatus) {
      setIsManualStatus(false);
      const autoStatus = computeProjectStatus({ ...project, isManualStatus: false });
      setStatus(autoStatus);
    } else {
      setIsManualStatus(true);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;

    const finalSlug = sanitizeSlug(slug.trim().toUpperCase());

    if (finalSlug && RESERVED_SLUGS.has(finalSlug.toLowerCase())) {
      setSlugError("その識別子は予約済みです。");
      return;
    }
    setSlugError("");

    if (isSupabaseEnabled) {
      setSaving(true);
      if (finalSlug && finalSlug !== project.slug) {
        const conflict = await findSlugConflict(finalSlug, orgId, project.id);
        if (conflict) { setSlugError(SLUG_CONFLICT_MESSAGE[conflict]); setSaving(false); return; }
      }
      const { error } = await supabase!.from("projects").update({
        name, description,
        start_date: startDate || null,
        end_date: endDate || null,
        status,
        is_manual_status: isManualStatus,
        slug: finalSlug || null,
      }).eq("id", project.id);
      // 旧識別子は projects の UPDATE トリガーが project_slug_aliases に残す（lib/projectResolve.ts 参照）
      setSaving(false);
      if (error?.code === "23505") {
        setSlugError("その識別子はすでに使用されています。");
        return;
      }
    }
    onUpdated?.();
    onClose();
  };

  return (
    <DialogShell title="プロジェクト編集" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave}>{saving ? "保存中..." : "保存する"}</BtnPrimary></>}>
      <FieldInput label="プロジェクト名" placeholder="例: ECサイトリニューアル" required value={name} onChange={setName} />
      <div>
        <FieldInput
          label="プロジェクト識別子"
          placeholder="例: TEST"
          value={slug}
          onChange={v => setSlug(sanitizeSlug(v.toUpperCase()))}
        />
        <p style={{ fontSize: 10, color: "#9CA3AF", marginTop: 3 }}>
          URLに使用: <code style={{ background: "#F3F4F6", padding: "1px 5px", borderRadius: 3, fontSize: 10 }}>{slug || "TEST"}/TS-00001</code>
        </p>
        {slugError && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 3 }}>{slugError}</p>}
      </div>
      <FieldTextarea label="説明" placeholder="プロジェクトの概要を入力..." value={description} onChange={setDescription} onSubmit={() => { if (!saving) void handleSave(); }} />
      <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 16 }}>
        <FieldInput label="開始日" type="date" value={startDate} onChange={setStartDate} />
        <FieldInput label="終了日" type="date" value={endDate} onChange={setEndDate} />
      </div>

      {/* 🌟 修正: FieldSelect を CustomSelect に置き換え */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714" }}>
              ステータス
            </label>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 20,
              background: isManualStatus ? "#FFFBEB" : "#ECFDF5",
              color: isManualStatus ? "#D97706" : "#059669",
              border: `1px solid ${isManualStatus ? "rgba(217,119,6,0.25)" : "rgba(5,150,105,0.25)"}`,
            }}>
              {isManualStatus ? "手動設定中" : "自動設定中"}
            </span>
          </div>

          <div
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
            onClick={handleToggleAuto}
            title={isManualStatus ? "クリックして自動設定に戻す" : "クリックして手動設定に切替"}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: "#6B6458" }}>
              ステータス自動設定
            </span>
            <div style={{
              width: 36,
              height: 20,
              borderRadius: 10,
              background: !isManualStatus ? "#059669" : "#D1D5DB",
              position: "relative",
              transition: "background 0.2s ease",
            }}>
              <div style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#FFFFFF",
                position: "absolute",
                top: 2,
                left: !isManualStatus ? 18 : 2,
                transition: "left 0.2s ease",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </div>
          </div>
        </div>
        <CustomSelect
          value={status}
          options={[
            { value: "planning", label: "計画中" },
            { value: "in-progress", label: "進行中" },
            { value: "completed", label: "完了" },
            { value: "on-hold", label: "保留中" }
          ]}
          onChange={v => handleStatusChange(v as ProjectStatus)}
        />
        {isManualStatus && (
          <p style={{ fontSize: 11, color: "#D97706", marginTop: 6, lineHeight: 1.4 }}>
            ※手動でステータスを変更した場合、進捗率による自動ステータス更新は行われなくなります。
          </p>
        )}
      </div>
    </DialogShell>
  );
}
