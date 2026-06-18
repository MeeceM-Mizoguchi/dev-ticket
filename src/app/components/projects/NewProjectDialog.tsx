import { useState } from "react";
import { AlertCircle } from "lucide-react";
import type { Client, ProjectStatus } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";

const RESERVED_SLUGS = new Set(["login", "dashboard", "projects", "clients", "members", "permissions", "roles", "settings", "accept-invite"]);

const ErrMsg = ({ msg }: { msg: string }) => (
  <p style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#DC2626", marginTop: 4 }}>
    <AlertCircle style={{ width: 11, height: 11, flexShrink: 0 }} />{msg}
  </p>
);

function sanitizeSlug(v: string) { return v.replace(/[^A-Z0-9]/g, ""); }
function sanitizePrefix(v: string) { return v.replace(/[^A-Z]/g, ""); }
function autoSlug(name: string) { return sanitizeSlug(name.toUpperCase()).slice(0, 6) || "PROJ"; }
function autoPrefix(name: string) { return sanitizePrefix(name.toUpperCase()).slice(0, 3) || "TKT"; }

export function NewProjectDialog({ onClose, clients, onCreated }: { onClose: () => void; clients: Client[]; onCreated?: () => void }) {
  const { userName, userRole, userOrgId } = useAuth();
  const { selectedOrgId } = useOrg();
  const projectOrgId = userRole === "owner" ? selectedOrgId : userOrgId;

  const [name, setName] = useState("");
  const handleNameChange = (v: string) => {
    setName(v);
    if (!slug) setSlug(sanitizeSlug(v.toUpperCase()).slice(0, 6));
  };
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("planning");
  const [slug, setSlug] = useState("");
  const [slugError, setSlugError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const canSubmit = name.trim() !== "" && slug.trim() !== "";

  const DEFAULT_CATEGORIES = ["バグ", "改善", "新機能"];

  const handleSave = async () => {
    setAttempted(true);
    if (!canSubmit) return;

    const finalSlug = sanitizeSlug((slug.trim() || autoSlug(name.trim())).toUpperCase());
    const finalPrefix = autoPrefix(name);

    if (RESERVED_SLUGS.has(finalSlug.toLowerCase())) {
      setSlugError("その識別子は予約済みです。別の名前を使用してください。");
      return;
    }
    setSlugError("");

    if (isSupabaseEnabled) {
      setSaving(true);

      // org スコープ内での重複チェック
      let dupQ = supabase!.from("projects").select("id").eq("slug", finalSlug);
      if (projectOrgId) {
        dupQ = dupQ.eq("organization_id", projectOrgId);
      } else {
        dupQ = dupQ.is("organization_id", null);
      }
      const { data: existing } = await dupQ.maybeSingle();
      if (existing) {
        setSlugError("この組織内ですでに使用されている識別子です。別の名前を使用してください。");
        setSaving(false);
        return;
      }

      const projectId = `P-${Date.now()}`;
      const { error } = await supabase!.from("projects").insert({
        id: projectId, name, client: clientName, description,
        start_date: startDate || null, end_date: endDate || null,
        status, members: userName ? [userName] : [], done: 0, in_progress: 0, todo: 0,
        slug: finalSlug, wbs_prefix: finalPrefix,
        organization_id: projectOrgId || null,
      });
      if (error?.code === "23505") {
        setSlugError("その識別子はすでに使用されています。別の名前を使用してください。");
        setSaving(false);
        return;
      }
      const now = Date.now();
      await supabase!.from("ticket_categories").insert(
        DEFAULT_CATEGORIES.map((catName, i) => ({
          id: `CAT-${now}-${i}`,
          project_id: projectId,
          name: catName,
        }))
      );
      setSaving(false);
    }
    onCreated?.();
    onClose();
  };

  return (
    <DialogShell title="新規プロジェクト作成" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave} disabled={saving}>{saving ? "作成中..." : "作成する"}</BtnPrimary></>}>
      <div>
        <FieldInput label="プロジェクト名" placeholder="例: ECサイトリニューアル" required value={name} onChange={handleNameChange} />
        {attempted && !name.trim() && <ErrMsg msg="プロジェクト名を入力してください" />}
      </div>
      <div>
        <FieldInput
          label="プロジェクト識別子"
          placeholder={name ? autoSlug(name) : "例: PROJ"}
          required
          value={slug}
          onChange={v => setSlug(sanitizeSlug(v.toUpperCase()))}
        />
        <p style={{ fontSize: 10, color: "#9CA3AF", marginTop: 3 }}>URLに使用されます。空欄の場合はプロジェクト名から自動生成</p>
        {attempted && !slug.trim() && <ErrMsg msg="プロジェクト識別子を入力してください" />}
        {slugError && <ErrMsg msg={slugError} />}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
          クライアント
        </label>
        <CustomSelect
          value={clientName}
          options={[
            { value: "", label: "クライアントを選択" },
            ...clients.map(c => ({ value: c.name, label: c.name }))
          ]}
          onChange={setClientName}
          placeholder="クライアントを選択"
        />
      </div>

      <FieldTextarea label="説明" placeholder="プロジェクトの概要を入力..." value={description} onChange={setDescription} />

      <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 16 }}>
        <FieldInput label="開始日" type="date" value={startDate} onChange={setStartDate} />
        <FieldInput label="終了日" type="date" value={endDate} onChange={setEndDate} />
      </div>

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
