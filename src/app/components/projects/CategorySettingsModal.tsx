import { useEffect, useState } from "react";
import { X, Plus, Pencil, Trash2, Check } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { TicketCategory } from "@/app/types";
import { mapTicketCategory } from "@/app/lib/mappers";

export function CategorySettingsModal({
  projectId, projectName, onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  const loadCategories = async () => {
    if (!isSupabaseEnabled) return;
    const { data } = await supabase!.from("ticket_categories")
      .select("*").eq("project_id", projectId).order("created_at");
    if (data) setCategories(data.map(mapTicketCategory));
  };

  useEffect(() => { loadCategories(); }, [projectId]);

  const handleAdd = async () => {
    if (!newName.trim() || saving) return;
    setSaving(true);
    if (isSupabaseEnabled) {
      await supabase!.from("ticket_categories").insert({
        id: `CAT-${Date.now()}`,
        project_id: projectId,
        name: newName.trim(),
      });
    }
    setNewName("");
    await loadCategories();
    setSaving(false);
  };

  const handleEdit = async (id: string) => {
    if (!editName.trim()) return;
    if (isSupabaseEnabled) {
      await supabase!.from("ticket_categories").update({ name: editName.trim() }).eq("id", id);
    }
    setEditingId(null);
    await loadCategories();
  };

  const handleDelete = async (id: string) => {
    if (isSupabaseEnabled) {
      await supabase!.from("ticket_categories").delete().eq("id", id);
    }
    setCategories(prev => prev.filter(c => c.id !== id));
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(10,14,12,0.40)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 301, width: "min(460px, 92vw)", background: "#FFF", borderRadius: 18, boxShadow: "0 24px 80px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.10)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "linear-gradient(135deg, #ECFDF5 0%, #F0FDF4 100%)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 10, color: "#059669", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>分類設定</p>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.025em" }}>{projectName}</h2>
            </div>
            <button onClick={onClose}
              style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 24px 20px", maxHeight: "calc(70vh - 120px)", overflowY: "auto" }}>
          {categories.length === 0 ? (
            <div style={{ textAlign: "center", padding: "28px 0", color: "#C9C4BB", fontSize: 13 }}>分類がありません</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
              {categories.map(cat => (
                <div key={cat.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F9F8F6", borderRadius: 10, padding: "9px 12px", border: "1px solid rgba(26,23,20,0.06)" }}>
                  {editingId === cat.id ? (
                    <>
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleEdit(cat.id); if (e.key === "Escape") setEditingId(null); }}
                        style={{ flex: 1, fontSize: 13, border: "1.5px solid #059669", borderRadius: 7, padding: "5px 8px", outline: "none", background: "#FFF" }}
                      />
                      <button onClick={() => handleEdit(cat.id)}
                        style={{ padding: "5px 8px", background: "#059669", color: "#FFF", border: "none", borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center" }}>
                        <Check style={{ width: 13, height: 13 }} />
                      </button>
                      <button onClick={() => setEditingId(null)}
                        style={{ padding: "5px 10px", background: "#F4F5F6", color: "#6B6458", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13 }}>
                        ×
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#1A1714" }}>{cat.name}</span>
                      <button
                        onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}
                        style={{ padding: 5, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#059669"; (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                        <Pencil style={{ width: 12, height: 12 }} />
                      </button>
                      <button
                        onClick={() => handleDelete(cat.id)}
                        style={{ padding: 5, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                        <Trash2 style={{ width: 12, height: 12 }} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add new */}
          <div style={{ display: "flex", gap: 8, paddingTop: categories.length > 0 ? 12 : 0, borderTop: categories.length > 0 ? "1px solid rgba(26,23,20,0.07)" : "none" }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
              placeholder="新しい分類名を入力"
              style={{ flex: 1, fontSize: 13, border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 9, padding: "8px 12px", outline: "none", background: "#F9F8F6", transition: "border-color 0.15s" }}
              onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = "#059669"; }}
              onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.12)"; }}
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || saving}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 16px", background: !newName.trim() ? "#F4F5F6" : "#059669", color: !newName.trim() ? "#B0A9A4" : "#FFF", border: "none", borderRadius: 9, cursor: !newName.trim() ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, transition: "all 0.15s", flexShrink: 0 }}>
              <Plus style={{ width: 13, height: 13 }} />追加
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 24px 16px", borderTop: "1px solid rgba(26,23,20,0.06)", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "8px 22px", background: "#F4F5F6", color: "#6B6458", border: "none", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}
