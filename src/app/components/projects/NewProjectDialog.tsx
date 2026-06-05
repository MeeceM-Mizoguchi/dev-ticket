import { useState } from "react";
import type { Client, ProjectStatus } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldSelect } from "@/app/components/shared/FieldSelect";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";
// 🌟ログイン中のユーザー情報を取得するために useAuth をインポートします
import { useAuth } from "@/app/contexts/AuthContext";

const RESERVED_SLUGS = new Set(["login", "dashboard", "projects", "clients", "members", "permissions", "roles", "settings", "accept-invite"]);

function sanitizeSlug(v: string) { return v.replace(/[^A-Z0-9]/g, ""); }
function sanitizePrefix(v: string) { return v.replace(/[^A-Z]/g, ""); }
function autoSlug(name: string) { return sanitizeSlug(name.toUpperCase()).slice(0, 6) || "PROJ"; }
function autoPrefix(name: string) { return sanitizePrefix(name.toUpperCase()).slice(0, 3) || "TKT"; }

export function NewProjectDialog({ onClose, clients, onCreated }: { onClose: () => void; clients: Client[]; onCreated?: () => void }) {
  // 🌟現在のログインユーザー名（userName）を取得
  const { userName } = useAuth();

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

    const finalSlug = sanitizeSlug((slug.trim() || autoSlug(name)).toUpperCase());
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
        // 🌟 members を [] から [userName] へ変更し、作成者自身を初期メンバーとしてセット！
        status, members: userName ? [userName] : [], done: 0, in_progress: 0, todo: 0,
        slug: finalSlug, wbs_prefix: finalPrefix,
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
            value={slug}
            onChange={v => setSlug(sanitizeSlug(v.toUpperCase()))}
          />
          <p style={{ fontSize: 10, color: "#9CA3AF", marginTop: 3 }}>URLに使用されます。空欄の場合は自動生成</p>
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
      <FieldSelect label="クライアント" required value={clientName} onChange={setClientName}>
        <option value="">クライアントを選択</option>
        {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
      </FieldSelect>
      <FieldTextarea label="説明" placeholder="プロジェクトの概要を入力..." value={description} onChange={setDescription} />
      <div className="grid grid-cols-2 gap-3">
        <FieldInput label="開始日" type="date" required value={startDate} onChange={setStartDate} />
        <FieldInput label="終了日" type="date" required value={endDate} onChange={setEndDate} />
      </div>
      <FieldSelect label="ステータス" value={status} onChange={setStatus as (v: string) => void}>
        <option value="planning">計画中</option><option value="in-progress">進行中</option>
        <option value="completed">完了</option><option value="on-hold">保留中</option>
      </FieldSelect>
    </DialogShell>
  );
}