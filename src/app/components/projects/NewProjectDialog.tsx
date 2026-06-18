import { useState } from "react";
import type { Client, ProjectStatus } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";
// 🌟 追加: CustomSelect コンポーネントをインポート
import { CustomSelect } from "@/app/components/shared/CustomSelect";
// 🌟ログイン中のユーザー情報を取得するために useAuth をインポートします
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";

const RESERVED_SLUGS = new Set(["login", "dashboard", "projects", "clients", "members", "permissions", "roles", "settings", "accept-invite"]);

function sanitizeSlug(v: string) { return v.replace(/[^A-Z0-9]/g, ""); }
function sanitizePrefix(v: string) { return v.replace(/[^A-Z]/g, ""); }
function autoSlug(name: string) { return sanitizeSlug(name.toUpperCase()).slice(0, 6) || "PROJ"; }
function autoPrefix(name: string) { return sanitizePrefix(name.toUpperCase()).slice(0, 3) || "TKT"; }

export function NewProjectDialog({ onClose, clients, onCreated }: { onClose: () => void; clients: Client[]; onCreated?: () => void }) {
  // 🌟現在のログインユーザー名（userName）を取得
  const { userName, userRole, userOrgId } = useAuth();
  const { selectedOrgId } = useOrg();
  // オーナーはOrgSelectorの選択、それ以外は自分の組織IDを使用
  const projectOrgId = userRole === "owner" ? selectedOrgId : userOrgId;

  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("planning");
  const [slug, setSlug] = useState("");
  const [wbsPrefix, setWbsPrefix] = useState("");
  const [slugError, setSlugError] = useState("");
  const [saving, setSaving] = useState(false);

  const DEFAULT_CATEGORIES = ["バグ", "改善", "新機能"];

  const handleSave = async () => {
    if (!name.trim()) return;

    const finalSlug = sanitizeSlug((slug.trim() || autoSlug(name.trim())).toUpperCase());
    const finalPrefix = sanitizePrefix((wbsPrefix.trim() || autoPrefix(name)).toUpperCase());

    if (RESERVED_SLUGS.has(finalSlug.toLowerCase())) {
      setSlugError("その識別子は予約済みです。別の名前を使用してください。");
      return;
    }
    setSlugError("");

    if (isSupabaseEnabled) {
      setSaving(true);
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
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave}>{saving ? "作成中..." : "作成する"}</BtnPrimary></>}>
      <FieldInput label="プロジェクト名" placeholder="例: ECサイトリニューアル" required value={name} onChange={setName} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldInput
            label="プロジェクト識別子"
            placeholder={name ? autoSlug(name) : "例: PROJ"}
            required
            value={slug}
            onChange={v => setSlug(sanitizeSlug(v.toUpperCase()))}
          />
          <p style={{ fontSize: 10, color: "#9CA3AF", marginTop: 3 }}>URLに使用されます。空欄の場合はプロジェクト名から自動生成</p>
          {slugError && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 3 }}>{slugError}</p>}
        </div>
        <div>
          <FieldInput
            label="チケットNoのプレフィックス"
            placeholder={name ? autoPrefix(name) : "例: TS"}
            value={wbsPrefix}
            onChange={v => setWbsPrefix(sanitizePrefix(v.toUpperCase()))}
          />
          <p style={{ fontSize: 10, color: "#9CA3AF", marginTop: 3 }}>チケットNoの接頭辞（例: TS-00001）</p>
        </div>
      </div>

      {/* 🌟 修正: FieldSelect を CustomSelect に置き換え */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
          クライアント <span style={{ color: "#DC2626" }}>*</span>
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
        <FieldInput label="開始日" type="date" required value={startDate} onChange={setStartDate} />
        <FieldInput label="終了日" type="date" required value={endDate} onChange={setEndDate} />
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