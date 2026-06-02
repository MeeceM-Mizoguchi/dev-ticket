import { useState } from "react";
import type { Project, ProjectStatus } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldSelect } from "@/app/components/shared/FieldSelect";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";

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
      <div className="grid grid-cols-2 gap-3">
        <FieldInput label="開始日" type="date" value={startDate} onChange={setStartDate} />
        <FieldInput label="終了日" type="date" value={endDate} onChange={setEndDate} />
      </div>
      <FieldSelect label="ステータス" value={status} onChange={setStatus as (v: string) => void}>
        <option value="planning">計画中</option>
        <option value="in-progress">進行中</option>
        <option value="completed">完了</option>
        <option value="on-hold">保留中</option>
      </FieldSelect>
    </DialogShell>
  );
}
