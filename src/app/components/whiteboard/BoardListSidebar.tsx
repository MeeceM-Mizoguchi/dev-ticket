// ホワイトボード一覧サイドバー（議事録の分割ペインUXに合わせる）。
import { useState } from "react";
import { Plus, Search, X, Trash2, Pencil, PenTool } from "lucide-react";
import type { Whiteboard } from "@/app/types";

interface Props {
  boards: Whiteboard[];
  selectedId: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function BoardListSidebar({ boards, selectedId, canEdit, onSelect, onCreate, onRename, onDelete }: Props) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const filtered = boards.filter((b) => b.title.toLowerCase().includes(search.toLowerCase()));

  const commitRename = (id: string) => {
    const t = draft.trim();
    if (t) onRename(id, t);
    setEditingId(null);
  };

  return (
    <div style={{ width: 260, flexShrink: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", padding: 10, overflowY: "auto", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "relative", marginBottom: 8 }}>
        <Search style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 11, height: 11, color: search ? "#059669" : "#C9C4BB", pointerEvents: "none" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="検索..."
          style={{ width: "100%", boxSizing: "border-box", padding: "6px 26px", fontSize: 11, background: "#F4F5F6", border: `1px solid ${search ? "rgba(5,150,105,0.25)" : "transparent"}`, borderRadius: 7, outline: "none", fontFamily: "inherit" }} />
        {search && (
          <button onClick={() => setSearch("")} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 2, color: "#A09790", display: "flex" }}>
            <X style={{ width: 10, height: 10 }} />
          </button>
        )}
      </div>

      {canEdit && (
        <button onClick={onCreate}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 10px", marginBottom: 8, fontSize: 11, fontWeight: 600, color: "#fff", background: "#059669", border: "none", borderRadius: 7, cursor: "pointer" }}>
          <Plus style={{ width: 12, height: 12 }} />新規ボード
        </button>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {filtered.length === 0 && (
          <div style={{ padding: "20px 8px", fontSize: 11, color: "#A09790", textAlign: "center" }}>ボードがありません</div>
        )}
        {filtered.map((b) => {
          const active = b.id === selectedId;
          return (
            <div key={b.id} onClick={() => onSelect(b.id)}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 9px", borderRadius: 8, cursor: "pointer", background: active ? "#ECFDF5" : "transparent", border: `1px solid ${active ? "rgba(5,150,105,0.25)" : "transparent"}` }}>
              <PenTool style={{ width: 12, height: 12, color: active ? "#059669" : "#C9C4BB", flexShrink: 0 }} />
              {editingId === b.id ? (
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(b.id)} onKeyDown={(e) => { if (e.key === "Enter") commitRename(b.id); if (e.key === "Escape") setEditingId(null); }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ flex: 1, fontSize: 12, border: "1px solid rgba(5,150,105,0.3)", borderRadius: 5, padding: "2px 5px", outline: "none", fontFamily: "inherit" }} />
              ) : (
                <span style={{ flex: 1, fontSize: 12, fontWeight: active ? 600 : 500, color: "#1A1714", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.title}</span>
              )}
              {canEdit && editingId !== b.id && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); setEditingId(b.id); setDraft(b.title); }}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#C9C4BB", display: "flex" }}>
                    <Pencil style={{ width: 11, height: 11 }} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete(b.id); }}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#C9C4BB", display: "flex" }}>
                    <Trash2 style={{ width: 11, height: 11 }} />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
