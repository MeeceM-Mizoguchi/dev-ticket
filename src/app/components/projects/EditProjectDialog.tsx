import { useState } from "react";
import type { Project, ProjectStatus } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";
// 🌟 追加: CustomSelect コンポーネントをインポート
import { CustomSelect } from "@/app/components/shared/CustomSelect";

const RESERVED_SLUGS = new Set(["login", "dashboard", "projects", "clients", "members", "permissions", "roles", "settings", "accept-invite"]);
function sanitizeSlug(v: string) { return v.replace(/[^A-Z0-9]/g, ""); }

export function EditProjectDialog({ project, onClose, onUpdated }: {
  project: Project;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [startDate, setStartDate] = useState(project.startDate || "");
  const [endDate, setEndDate] = useState(project.endDate || "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [slug, setSlug] = useState(project.slug || "");
  const [slugError, setSlugError] = useState("");
  const [saving, setSaving] = useState(false);

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
      const { error } = await supabase!.from("projects").update({
        name, description,
        start_date: startDate || null,
        end_date: endDate || null,
        status,
        slug: finalSlug || null,
      }).eq("id", project.id);
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
      <FieldTextarea label="説明" placeholder="プロジェクトの概要を入力..." value={description} onChange={setDescription} />
      <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 16 }}>
        <FieldInput label="開始日" type="date" value={startDate} onChange={setStartDate} />
        <FieldInput label="終了日" type="date" value={endDate} onChange={setEndDate} />
      </div>

      {/* 🌟 修正: FieldSelect を CustomSelect に置き換え */}
      <div>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
          ステータス
        </label>
        <CustomSelect
          value={status}
          options={[
            { value: "planning", label: "計画中" },
            { value: "in-progress", label: "進行中" },
            { value: "completed", label: "完了" },
            { value: "on-hold", label: "保留中" }
          ]}
          onChange={v => setStatus(v as ProjectStatus)}
        />
      </div>
    </DialogShell>
  );
}
