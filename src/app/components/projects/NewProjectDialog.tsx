import { useState } from "react";
import { AlertCircle, Plus, X } from "lucide-react";
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
import { usePlan } from "@/app/contexts/PlanContext";

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

export function NewProjectDialog({ onClose, clients, onCreated, currentProjectCount }: { onClose: () => void; clients: Client[]; onCreated?: () => void; currentProjectCount?: number }) {
  const { userName, userRole, userOrgId } = useAuth();
  const { selectedOrgId } = useOrg();
  const { plan } = usePlan();
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
  
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const [slugError, setSlugError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const [slug, setSlug] = useState("");
  const canSubmit = name.trim() !== "" && slug.trim() !== "";

  const DEFAULT_CATEGORIES = ["バグ", "改善", "新機能"];

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (indexToRemove: number) => {
    setTags(tags.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSave = async () => {
    setAttempted(true);
    if (!canSubmit) return;
    if (plan.maxProjects !== null && currentProjectCount !== undefined && currentProjectCount >= plan.maxProjects) return;

    const finalSlug = sanitizeSlug((slug.trim() || autoSlug(name.trim())).toUpperCase());
    const finalPrefix = autoPrefix(name);

    if (RESERVED_SLUGS.has(finalSlug.toLowerCase())) {
      setSlugError("その識別子は予約済みです。別の名前を使用してください。");
      return;
    }
    setSlugError("");

    const projectId = `P-${Date.now()}`;

    if (isSupabaseEnabled) {
      setSaving(true);

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

    if (tags.length > 0) {
      try {
        const localTagsStore = localStorage.getItem("local_project_tags_map");
        const currentMap = localTagsStore ? JSON.parse(localTagsStore) : {};
        
        currentMap[projectId] = tags;
        if (finalSlug) {
          currentMap[finalSlug] = tags;
        }
        
        localStorage.setItem("local_project_tags_map", JSON.stringify(currentMap));
      } catch (e) {
        console.error("Failed to save project tags to localStorage:", e);
      }
    }

    onCreated?.();
    onClose();
  };

  return (
    <DialogShell title="新規プロジェクト作成" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave} disabled={saving}>{saving ? "作成中..." : "作成する"}</BtnPrimary></>}>
      
      {/* 🌟 プランB最適化: 無駄な空白や複雑なイベントを一切使わず、要素の並び順の設計だけで完璧に解決します */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        
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

        {/* 🌟 改善：見切れやすい2大プルダウン（クライアント・ステータス）を中段の横並びにまとめることで、展開スペースを上〜中部にしっかりと確保 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
              クライアント
            </label>
            <CustomSelect
              value={clientName}
              options={[
                { value: "", label: "選択なし" },
                ...clients.map(c => ({ value: c.name, label: c.name }))
              ]}
              onChange={setClientName}
              placeholder="クライアントを選択"
            />
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
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FieldInput label="開始日" type="date" value={startDate} onChange={setStartDate} />
          <FieldInput label="終了日" type="date" value={endDate} onChange={setEndDate} />
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
            プロジェクトタグ
          </label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <input 
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(); } }}
                placeholder="任意のタグを入力 (例: 重要顧客)"
                style={{ width: "100%", background: "#F7F8F9", border: "1px solid #E6E2D9", borderRadius: 10, padding: "8px 12px", fontSize: 13, color: "#1A1714", outline: "none" }}
              />
            </div>
            <button 
              type="button"
              onClick={handleAddTag}
              style={{ padding: "0 14px", background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 10, cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Plus style={{ width: 14, height: 14 }} />
            </button>
          </div>
          {tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.06)", padding: "10px", borderRadius: 10 }}>
              {tags.map((tag, idx) => (
                <span 
                  key={idx}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#F0F9FF", color: "#0284C7", border: "1px solid rgba(2,132,199,0.15)", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}
                >
                  {tag}
                  <X 
                    onClick={() => handleRemoveTag(idx)}
                    style={{ width: 12, height: 12, cursor: "pointer", opacity: 0.7 }} 
                  />
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 🌟 解決：最も縦幅を広く使う「説明（Textarea）」を一番下に持ってきます。
            これにより、中段にあるステータスやクライアントを展開しても、説明欄の真上に綺麗に重なるため、不自然な空白を一切作らずに100%見切れを回避できます！ */}
        <div>
          <FieldTextarea label="説明" placeholder="プロジェクトの概要を入力..." value={description} onChange={setDescription} />
        </div>
        
      </div>
    </DialogShell>
  );
}