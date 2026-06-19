import { useState } from "react";
import type { Project } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";

const RESERVED_SLUGS = new Set(["login", "dashboard", "projects", "clients", "members", "permissions", "roles", "settings", "accept-invite"]);

function sanitizeSlug(v: string) { return v.replace(/[^A-Z0-9]/g, ""); }

export function EditProjectIdentifiersDialog({ project, onClose, onUpdated }: {
  project: Project;
  onClose: () => void;
  onUpdated?: (newSlug: string) => void;
}) {
  const { userOrgId } = useAuth();
  const orgId = project.organizationId ?? userOrgId;
  const [slug, setSlug] = useState(project.slug);
  const [slugError, setSlugError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const finalSlug = sanitizeSlug(slug.trim().toUpperCase());

    if (!finalSlug) { setSlugError("識別子を入力してください。"); return; }
    if (RESERVED_SLUGS.has(finalSlug.toLowerCase())) {
      setSlugError("その識別子は予約済みです。別の名前を使用してください。");
      return;
    }
    setSlugError("");

    if (isSupabaseEnabled) {
      setSaving(true);
      if (finalSlug !== project.slug) {
        let dupQ = supabase!.from("projects").select("id").eq("slug", finalSlug).neq("id", project.id);
        if (orgId) dupQ = dupQ.eq("organization_id", orgId);
        else dupQ = dupQ.is("organization_id", null);
        const { data: dup } = await dupQ.maybeSingle();
        if (dup) { setSlugError("この組織内ですでに使用されている識別子です。別の名前を使用してください。"); setSaving(false); return; }
      }
      const { error } = await supabase!.from("projects").update({ slug: finalSlug }).eq("id", project.id);
      setSaving(false);
      if (error?.code === "23505") {
        setSlugError("その識別子はすでに使用されています。別の名前を使用してください。");
        return;
      }
    }
    onUpdated?.(finalSlug);
    onClose();
  };

  return (
    <DialogShell title="識別子の編集" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave}>{saving ? "保存中..." : "保存する"}</BtnPrimary></>}>
      <div>
        <FieldInput
          label="プロジェクト識別子"
          placeholder="例: TEST"
          value={slug}
          onChange={v => setSlug(sanitizeSlug(v.toUpperCase()))}
        />
        <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
          URLに使用されます: <code style={{ background: "#F3F4F6", padding: "1px 6px", borderRadius: 4, fontSize: 11 }}>{slug || "TEST"}/TS-00001</code>
        </p>
        {slugError && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>{slugError}</p>}
      </div>
    </DialogShell>
  );
}
