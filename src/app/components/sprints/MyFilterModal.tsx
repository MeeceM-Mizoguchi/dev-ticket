import { useState, useEffect } from "react";
import { Pencil, Trash2, Info, AlertTriangle } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { SortCol } from "@/app/types";

export interface SavedFilter {
  id: string;
  title: string;
  filters: Record<string, string[]>;
  sortCol: string;
  sortDir: "asc" | "desc";
  createdAt: string;
}

function mapRow(row: Record<string, unknown>): SavedFilter {
  return {
    id: row.id as string,
    title: row.title as string,
    filters: (row.filters ?? {}) as Record<string, string[]>,
    sortCol: (row.sort_col as string) ?? "",
    sortDir: (row.sort_dir as "asc" | "desc") ?? "asc",
    createdAt: row.created_at as string,
  };
}

export function serializeFilters(filters: Record<string, Set<string> | string[]>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  Object.entries(filters).forEach(([col, val]) => {
    const arr = val instanceof Set ? Array.from(val) : val;
    if (arr.length > 0) result[col] = arr;
  });
  return result;
}

function filtersMatch(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  const aNorm = Object.fromEntries(Object.entries(a).filter(([, v]) => v.length > 0));
  const bNorm = Object.fromEntries(Object.entries(b).filter(([, v]) => v.length > 0));
  const aKeys = Object.keys(aNorm).sort();
  const bKeys = Object.keys(bNorm).sort();
  if (aKeys.length !== bKeys.length) return false;
  if (!aKeys.every((k, i) => k === bKeys[i])) return false;
  return aKeys.every(k => {
    const aSet = new Set(aNorm[k]);
    const bVals = bNorm[k];
    return bVals.length === aSet.size && bVals.every(v => aSet.has(v));
  });
}

export async function checkDuplicateFilter(
  sprintId: string,
  userId: string,
  currentFilters: Record<string, string[]>
): Promise<string | null> {
  if (!isSupabaseEnabled || !supabase) return null;
  const { data } = await supabase
    .from("my_filters")
    .select("title, filters")
    .eq("sprint_id", sprintId)
    .eq("member_id", userId);
  if (!data) return null;
  const dup = data.find(f => filtersMatch(f.filters as Record<string, string[]>, currentFilters));
  return dup ? (dup.title as string) : null;
}

export async function addMyFilter(
  sprintId: string,
  userId: string,
  title: string,
  filters: Record<string, string[]>,
  sortCol: string,
  sortDir: "asc" | "desc"
): Promise<void> {
  if (!isSupabaseEnabled || !supabase) return;
  const cleanFilters: Record<string, string[]> = {};
  Object.entries(filters).forEach(([col, vals]) => { if (vals.length > 0) cleanFilters[col] = vals; });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  await supabase.from("my_filters").insert({
    id,
    sprint_id: sprintId,
    member_id: userId,
    title,
    filters: cleanFilters,
    sort_col: sortCol,
    sort_dir: sortDir,
  });
}

interface MyFilterModalProps {
  onClose: () => void;
  sprintId: string;
  userId: string;
  cols: Array<{ col: string; label: string }>;
  getColOptions: (col: string) => Array<{ value: string; label: string }>;
  onApply: (filters: Record<string, Set<string>>, sortCol: SortCol | "", sortDir: "asc" | "desc") => void;
}

export function MyFilterModal({ onClose, sprintId, userId, cols, getColOptions, onApply }: MyFilterModalProps) {
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTouched, setEditTouched] = useState(false);
  const [editFilters, setEditFilters] = useState<Record<string, string[]>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled || !supabase) { setSavedFilters([]); return; }
    supabase
      .from("my_filters")
      .select("*")
      .eq("sprint_id", sprintId)
      .eq("member_id", userId)
      .order("created_at")
      .then(({ data }) => {
        setSavedFilters(data?.map(row => mapRow(row as Record<string, unknown>)) ?? []);
      });
  }, [sprintId, userId]);

  const getStaleValues = (filter: SavedFilter): Array<{ colLabel: string; value: string }> => {
    const stale: Array<{ colLabel: string; value: string }> = [];
    cols.forEach(({ col, label }) => {
      const values = filter.filters[col];
      if (!values || values.length === 0) return;
      const opts = getColOptions(col);
      values.forEach(v => {
        if (!opts.find(o => o.value === v)) {
          stale.push({ colLabel: label, value: v });
        }
      });
    });
    return stale;
  };

  const getSummary = (filter: SavedFilter): string => {
    const parts: string[] = [];
    cols.forEach(({ col, label }) => {
      const values = filter.filters[col];
      if (!values || values.length === 0) return;
      const opts = getColOptions(col);
      const labels = values.map(v => opts.find(o => o.value === v)?.label ?? v);
      parts.push(`${label}: ${labels.join("・")}`);
    });
    return parts.join(" / ") || "フィルタ条件なし";
  };

  const openEdit = (filter: SavedFilter) => {
    setEditingId(filter.id);
    setEditTitle(filter.title);
    setEditFilters(filter.filters);
    setEditTouched(false);
  };

  const toggleEditFilter = (col: string, value: string) => {
    setEditFilters(prev => {
      const current = new Set(prev[col] ?? []);
      current.has(value) ? current.delete(value) : current.add(value);
      return { ...prev, [col]: Array.from(current) };
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId || editTitle.trim() === "") { setEditTouched(true); return; }
    if (isSupabaseEnabled && supabase) {
      await supabase
        .from("my_filters")
        .update({ title: editTitle.trim(), filters: editFilters })
        .eq("id", editingId)
        .eq("member_id", userId);
    }
    setSavedFilters(savedFilters.map(f =>
      f.id === editingId ? { ...f, title: editTitle.trim(), filters: editFilters } : f
    ));
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    if (isSupabaseEnabled && supabase) {
      await supabase.from("my_filters").delete().eq("id", id).eq("member_id", userId);
    }
    setSavedFilters(savedFilters.filter(f => f.id !== id));
    if (selectedId === id) setSelectedId(null);
    setConfirmDeleteId(null);
  };

  const handleApply = () => {
    if (!selectedId) return;
    const filter = savedFilters.find(f => f.id === selectedId);
    if (!filter) return;
    const filterSets: Record<string, Set<string>> = {};
    cols.forEach(({ col }) => {
      const values = filter.filters[col];
      if (values && values.length > 0) {
        filterSets[col] = new Set(values);
      }
    });
    onApply(filterSets, filter.sortCol as SortCol | "", filter.sortDir);
    onClose();
  };

  const selectedFilter = selectedId ? savedFilters.find(f => f.id === selectedId) : null;
  const selectedIsStale = selectedFilter ? getStaleValues(selectedFilter).length > 0 : false;

  // ---- 編集ビュー ----
  if (editingId) {
    const editTitleEmpty = editTitle.trim() === "";
    return (
      <DialogShell
        title="フィルタを編集"
        onClose={() => setEditingId(null)}
        size="lg"
        footer={
          <>
            <BtnSecondary onClick={() => setEditingId(null)}>キャンセル</BtnSecondary>
            <BtnPrimary onClick={handleSaveEdit} disabled={editTitleEmpty}>保存</BtnPrimary>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6B6458", marginBottom: 6 }}>
              タイトル <span style={{ color: "#DC2626" }}>*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onBlur={() => setEditTouched(true)}
              onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSaveEdit(); }}
              style={{
                width: "100%", padding: "9px 12px", fontSize: 13,
                border: `1.5px solid ${editTouched && editTitleEmpty ? "#DC2626" : "rgba(26,23,20,0.15)"}`,
                borderRadius: 8, outline: "none", boxSizing: "border-box" as const,
                background: "#FAFAF9", color: "#1A1714",
              }}
            />
            {editTouched && editTitleEmpty && (
              <p style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>タイトルを入力してください</p>
            )}
          </div>

          <div style={{ borderTop: "1px solid rgba(26,23,20,0.06)", paddingTop: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#6B6458", marginBottom: 14 }}>フィルタ条件</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {cols.map(({ col, label }) => {
                const opts = getColOptions(col);
                if (opts.length === 0) return null;
                const checked = new Set(editFilters[col] ?? []);
                return (
                  <div key={col}>
                    <p style={{ fontSize: 10, fontWeight: 700, color: "#9C9490", marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
                      {label}
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6 }}>
                      {opts.map(opt => {
                        const isChecked = checked.has(opt.value);
                        return (
                          <button key={opt.value} onClick={() => toggleEditFilter(col, opt.value)}
                            style={{
                              fontSize: 11, padding: "4px 10px", borderRadius: 20,
                              border: `1.5px solid ${isChecked ? "#059669" : "rgba(26,23,20,0.15)"}`,
                              background: isChecked ? "#ECFDF5" : "transparent",
                              color: isChecked ? "#059669" : "#6B6458",
                              cursor: "pointer", transition: "all 0.1s",
                            }}>
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogShell>
    );
  }

  // ---- 一覧ビュー ----
  return (
    <DialogShell
      title="Myフィルタ"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <BtnSecondary onClick={onClose}>キャンセル</BtnSecondary>
          <BtnPrimary onClick={handleApply} disabled={!selectedId || selectedIsStale}>反映</BtnPrimary>
        </>
      }
    >
      {savedFilters.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "32px 0", color: "#C9C4BB" }}>
          <Info style={{ width: 28, height: 28 }} />
          <p style={{ fontSize: 13, fontWeight: 600 }}>保存されたフィルタがありません</p>
          <p style={{ fontSize: 11 }}>フィルタを設定して保存アイコンをクリックしてください</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {savedFilters.map(filter => {
            const staleVals = getStaleValues(filter);
            const isStale = staleVals.length > 0;
            const isSelected = selectedId === filter.id;
            const isConfirmDelete = confirmDeleteId === filter.id;

            return (
              <div key={filter.id}
                onClick={() => !isConfirmDelete && setSelectedId(isSelected ? null : filter.id)}
                style={{
                  borderRadius: 10, padding: "12px 14px",
                  border: `1.5px solid ${isSelected && !isStale ? "#059669" : isStale ? "rgba(217,119,6,0.30)" : "rgba(26,23,20,0.08)"}`,
                  background: isSelected && !isStale ? "#ECFDF5" : isStale ? "#FFFBEB" : "#FAFAF9",
                  cursor: isConfirmDelete ? "default" : "pointer",
                  transition: "all 0.15s",
                }}>
                {isConfirmDelete ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <p style={{ fontSize: 12, color: "#1A1714", flex: 1 }}>「{filter.title}」を削除しますか？</p>
                    <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}
                      style={{ fontSize: 11, padding: "4px 10px", borderRadius: 7, border: "1px solid rgba(26,23,20,0.15)", background: "transparent", cursor: "pointer", color: "#6B6458" }}>
                      キャンセル
                    </button>
                    <button onClick={e => { e.stopPropagation(); handleDelete(filter.id); }}
                      style={{ fontSize: 11, padding: "4px 10px", borderRadius: 7, border: "none", background: "#DC2626", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                      削除
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {/* ラジオボタン */}
                      <div style={{
                        width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                        border: `2px solid ${isSelected && !isStale ? "#059669" : "rgba(26,23,20,0.25)"}`,
                        background: isSelected && !isStale ? "#059669" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.15s",
                      }}>
                        {isSelected && !isStale && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                      </div>

                      <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", flex: 1 }}>
                        {filter.title}
                      </span>

                      {isStale && (
                        <AlertTriangle style={{ width: 14, height: 14, color: "#D97706", flexShrink: 0 }} />
                      )}

                      <button onClick={e => { e.stopPropagation(); openEdit(filter); }}
                        style={{ padding: 5, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", alignItems: "center" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#EFF6FF"; (e.currentTarget as HTMLElement).style.color = "#2563EB"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                        <Pencil style={{ width: 12, height: 12 }} />
                      </button>

                      <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(filter.id); }}
                        style={{ padding: 5, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", alignItems: "center" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                        <Trash2 style={{ width: 12, height: 12 }} />
                      </button>
                    </div>

                    <p style={{ fontSize: 11, color: "#9C9490", marginTop: 6, paddingLeft: 24, lineHeight: 1.5 }}>
                      {getSummary(filter)}
                    </p>

                    {isStale && (
                      <div style={{ marginTop: 6, paddingLeft: 24, display: "flex", alignItems: "flex-start", gap: 5 }}>
                        <Info style={{ width: 11, height: 11, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
                        <p style={{ fontSize: 11, color: "#D97706", lineHeight: 1.5 }}>
                          存在しない項目が含まれているため反映できません：
                          {staleVals.map((s, i) => (
                            <span key={i}>{i > 0 ? "、" : ""}{s.colLabel}「{s.value}」</span>
                          ))}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedIsStale && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.25)", marginTop: 4 }}>
          <AlertTriangle style={{ width: 13, height: 13, color: "#D97706", flexShrink: 0 }} />
          <p style={{ fontSize: 11, color: "#D97706" }}>選択中のフィルタに存在しない項目が含まれているため、反映できません</p>
        </div>
      )}
    </DialogShell>
  );
}
