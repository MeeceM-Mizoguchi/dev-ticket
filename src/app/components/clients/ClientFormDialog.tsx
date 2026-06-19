import { useState } from "react";
import type { Client } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useToast } from "@/app/contexts/ToastContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
// 🌟 追加: CustomSelect コンポーネントをインポート
import { CustomSelect } from "@/app/components/shared/CustomSelect";

export function ClientFormDialog({ client, onClose, onSaved }: { client?: Client; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { userRole, userOrgId } = useAuth();
  const { selectedOrgId } = useOrg();
  const clientOrgId = userRole === "owner" ? selectedOrgId : userOrgId;
  const isEdit = Boolean(client);
  const [name, setName] = useState(client?.name ?? "");
  const [industry, setIndustry] = useState(client?.industry ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [status, setStatus] = useState<"active" | "inactive">(client?.status ?? "active");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    if (isSupabaseEnabled) {
      if (isEdit) {
        const { error } = await supabase!.from("clients").update({ name, industry, email, phone, status }).eq("id", client!.id);
        if (error) { toast("更新に失敗しました", "error"); setSaving(false); return; }
        toast(`「${name}」を更新しました`);
      } else {
        const { error } = await supabase!.from("clients").insert({ id: `C-${Date.now()}`, name, industry, email, phone, status, organization_id: clientOrgId || null });
        if (error) { toast("追加に失敗しました", "error"); setSaving(false); return; }
        toast(`「${name}」を追加しました`);
      }
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <DialogShell title={isEdit ? "クライアント編集" : "新規クライアント追加"} onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave}>{saving ? "保存中..." : "保存する"}</BtnPrimary></>}>
      <FieldInput label="会社名" placeholder="例: 株式会社サンプル" required value={name} onChange={setName} />
      <FieldInput label="業界" placeholder="例: IT・通信" value={industry} onChange={setIndustry} />
      <FieldInput label="メールアドレス" placeholder="例: info@example.com" value={email} onChange={setEmail} />
      <FieldInput label="電話番号" placeholder="例: 03-1234-5678" value={phone} onChange={setPhone} style={{ marginBottom: 16 }} />

      {/* 🌟 修正: FieldSelect を CustomSelect に置き換え */}
      <div>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
          ステータス
        </label>
        <CustomSelect
          value={status}
          options={[
            { value: "active", label: "アクティブ" },
            { value: "inactive", label: "非アクティブ" }
          ]}
          onChange={v => setStatus(v as "active" | "inactive")}
        />
      </div>
    </DialogShell>
  );
}
