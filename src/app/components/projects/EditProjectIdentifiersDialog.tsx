import { useState } from "react";
import type { Project } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";

const RESERVED_SLUGS = new Set(["login", "dashboard", "projects", "clients", "members", "permissions", "roles", "settings", "accept-invite"]);

function sanitizeSlug(v: string) { return v.replace(/[^A-Z0-9]/g, ""); }
function sanitizePrefix(v: string) { return v.replace(/[^A-Z]/g, ""); }

export function EditProjectIdentifiersDialog({ project, onClose, onUpdated }: {
  project: Project;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const [slug, setSlug] = useState(project.slug);
  const [wbsPrefix, setWbsPrefix] = useState(project.wbsPrefix);
  const [slugError, setSlugError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const finalSlug = sanitizeSlug(slug.trim().toUpperCase());
    const finalPrefix = sanitizePrefix(wbsPrefix.trim().toUpperCase());

    if (!finalSlug) { setSlugError("識別子を入力してください。"); return; }
    if (RESERVED_SLUGS.has(finalSlug.toLowerCase())) {
      setSlugError("その識別子は予約済みです。別の名前を使用してください。");
      return;
    }
    setSlugError("");

    if (isSupabaseEnabled) {
      setSaving(true);
      const { error } = await supabase!.from("projects").update({
        slug: finalSlug,
        wbs_prefix: finalPrefix || "T",
      }).eq("id", project.id);
      setSaving(false);
      if (error?.code === "23505") {
        setSlugError("その識別子はすでに使用されています。別の名前を使用してください。");
        return;
      }
    }
    onUpdated?.();
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
      <div>
        <FieldInput
          label="チケット番号プレフィックス"
          placeholder="例: TS"
          value={wbsPrefix}
          onChange={v => setWbsPrefix(sanitizePrefix(v.toUpperCase()))}
        />
        <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
          チケット番号の接頭辞: <code style={{ background: "#F3F4F6", padding: "1px 6px", borderRadius: 4, fontSize: 11 }}>{wbsPrefix || "T"}-00001</code>
        </p>
        <p style={{ fontSize: 11, color: "#D97706", marginTop: 6, lineHeight: 1.5 }}>
          ⚠ プレフィックスを変更しても既存チケットの番号は変わりません。新規チケットから適用されます。
        </p>
      </div>
    </DialogShell>
  );
}
