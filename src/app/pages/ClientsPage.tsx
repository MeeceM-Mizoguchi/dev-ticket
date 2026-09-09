import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Search, Plus, Mail, Phone, Edit2, Trash2, NotebookPen } from "lucide-react";
import { Building2 } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";
import { OrgSelector } from "@/app/components/shared/OrgSelector";
import { useToast } from "@/app/contexts/ToastContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { CLIENTS } from "@/app/data/mock";
import { mapClient } from "@/app/lib/mappers";
import type { Client } from "@/app/types";
import { ClientFormDialog } from "@/app/components/clients/ClientFormDialog";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { PageLoader } from "@/app/components/shared/PageLoader";

type ClientSortField = "name" | "industry" | "status";

// ヘッダー行と各行で同じ定義を使う（列を足すときのズレ防止）
const GRID_COLUMNS = "1.6fr 0.5fr 1fr 100px 92px 72px";

export function ClientsPage() {
  const { userRole, userOrgId } = useAuth();
  const { selectedOrgId } = useOrg();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState("");
  const [searchField, setSearchField] = useState<"name" | "industry" | "email" | "all">("all");
  const [sortField, setSortField] = useState<ClientSortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Client | null>(null);
  const [clients, setClients] = useState<Client[]>(isSupabaseEnabled ? [] : CLIENTS);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  // クライアントごとの打ち合わせメモ件数（一覧のメモ列に出す）
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const isOwner = userRole === "owner";
  const canManage = isOwner || userRole === "admin" || userRole === "project-manager";

  const buildQuery = () => {
    let q = supabase!.from("clients").select("*").order("id");
    if (isOwner) {
      if (selectedOrgId) q = q.eq("organization_id", selectedOrgId);
    } else if (userOrgId) {
      q = (q as any).or(`organization_id.eq.${userOrgId},organization_id.is.null`);
    }
    return q;
  };

  const refreshClients = () => {
    if (!isSupabaseEnabled) return;
    buildQuery().then(({ data }) => setClients((data ?? []).map(mapClient)));
  };

  // メモ件数はRLSで見える範囲しか返らないので、クライアント側で数えるだけでよい。
  // テーブル未作成(add_client_notes.sql 未実行)の環境でも一覧が壊れないよう、エラーは握りつぶす。
  const refreshNoteCounts = () => {
    if (!isSupabaseEnabled) return;
    supabase!.from("client_notes").select("client_id").then(({ data, error }) => {
      if (error || !data) return;
      const counts: Record<string, number> = {};
      for (const row of data) counts[row.client_id] = (counts[row.client_id] ?? 0) + 1;
      setNoteCounts(counts);
    });
  };

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    buildQuery()
      .then(({ data }) => { if (data) setClients(data.map(mapClient)); setLoading(false); })
      .catch(() => setLoading(false));
    refreshNoteCounts();
  }, [isOwner, userOrgId, selectedOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteClient = async (client: Client) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("clients").delete().eq("id", client.id);
      if (error) { toast("削除に失敗しました", "error"); throw error; }
    }
    setClients(prev => prev.filter(c => c.id !== client.id));
    toast(`「${client.name}」を削除しました`);
  };

  const handleSort = (field: ClientSortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const filtered = clients
    .filter(c => {
      if (!searchValue) return true;
      const v = searchValue.toLowerCase();
      if (searchField === "name") return c.name.toLowerCase().includes(v);
      if (searchField === "industry") return c.industry.toLowerCase().includes(v);
      if (searchField === "email") return c.email.toLowerCase().includes(v);
      return c.name.toLowerCase().includes(v) || c.industry.toLowerCase().includes(v) || c.email.toLowerCase().includes(v) || c.id.toLowerCase().includes(v);
    })
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortField === "name") return a.name.localeCompare(b.name) * dir;
      if (sortField === "industry") return a.industry.localeCompare(b.industry) * dir;
      if (sortField === "status") return a.status.localeCompare(b.status) * dir;
      return 0;
    });

  const SortBtn = ({ field, label }: { field: ClientSortField; label: string }) => (
    <button onClick={() => handleSort(field)} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, color: sortField === field ? "#059669" : "#B0A9A4", letterSpacing: "0.06em", textTransform: "uppercase" as const, padding: 0 }}>
      {label}
      <span style={{ fontSize: 10, opacity: sortField === field ? 1 : 0.4 }}>{sortField === field ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
    </button>
  );

  if (loading) return <PageLoader />;

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>クライアント管理</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>取引先企業の一覧と基本情報 · {clients.length}社</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <OrgSelector />
          {canManage && (
            <button onClick={() => setShowCreate(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
              <Plus style={{ width: 15, height: 15 }} />新規クライアント
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <select value={searchField} onChange={e => setSearchField(e.target.value as typeof searchField)}
          style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "8px 10px", fontSize: 13, color: "#1A1714", outline: "none", cursor: "pointer", height: 38 }}
          onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; }}>
          <option value="all">すべて</option>
          <option value="name">会社名</option>
          <option value="industry">業界</option>
          <option value="email">メール</option>
        </select>
        <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
          <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#B0A9A4" }} />
          <input value={searchValue} onChange={e => setSearchValue(e.target.value)} placeholder="検索..."
            style={{ width: "100%", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "8px 12px 8px 32px", fontSize: 13, color: "#1A1714", outline: "none", boxSizing: "border-box" as const, height: 38 }}
            onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; }} />
        </div>
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: GRID_COLUMNS, padding: "12px 20px", background: "#F4F5F6", borderBottom: "1px solid rgba(26,23,20,0.06)", alignItems: "center" }}>
          <SortBtn field="name" label="企業名" />
          <SortBtn field="industry" label="業界" />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>連絡先</span>
          <SortBtn field="status" label="ステータス" />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>メモ</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>操作</span>
        </div>

        {filtered.length === 0
          ? <div style={{ textAlign: "center", padding: "60px 0" }}><p style={{ fontSize: 14, color: "#A09790" }}>クライアントが見つかりません</p></div>
          : filtered.map((client, i) => (
            <div key={client.id} onClick={() => canManage && setEditTarget(client)}
              style={{ display: "grid", gridTemplateColumns: GRID_COLUMNS, padding: "16px 20px", alignItems: "center", borderBottom: i < filtered.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none", cursor: canManage ? "pointer" : "default", transition: "background 0.12s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FAF8F4"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #ECFDF5, #D1FAE5)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Building2 style={{ width: 18, height: 18, color: "#059669" }} />
                </div>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "#1A1714" }}>{client.name}</p>
                  <p style={{ fontSize: 11, color: "#B0A9A4", fontFamily: "var(--font-mono)", marginTop: 2 }}>{client.id}</p>
                </div>
              </div>

              <p style={{ fontSize: 13, color: "#3D3732" }}>{client.industry || "—"}</p>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <p style={{ fontSize: 12, color: "#6B6458", display: "flex", alignItems: "center", gap: 6 }}>
                  <Mail style={{ width: 12, height: 12, color: "#059669" }} />{client.email || "—"}
                </p>
                <p style={{ fontSize: 12, color: "#6B6458", display: "flex", alignItems: "center", gap: 6 }}>
                  <Phone style={{ width: 12, height: 12, color: "#059669" }} />{client.phone || "—"}
                </p>
              </div>

              <div onClick={e => e.stopPropagation()}>
                <span style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20, background: client.status === "active" ? "#ECFDF5" : "#F4F5F6", color: client.status === "active" ? "#059669" : "#9E9690", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: client.status === "active" ? "#059669" : "#C9C4BB" }} />
                  {client.status === "active" ? "アクティブ" : "非アクティブ"}
                </span>
              </div>

              {/* 打ち合わせメモ。プロジェクトに紐づかない「この会社との打ち合わせ」の置き場 */}
              <div onClick={e => e.stopPropagation()}>
                <button onClick={() => navigate(`/clients/${client.id}/notes`)}
                  title={`${client.name} の打ち合わせメモ`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: (noteCounts[client.id] ?? 0) > 0 ? "#059669" : "#9E9690", fontSize: 12, fontWeight: 600, transition: "all 0.15s" }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#ECFDF5"; el.style.color = "#059669"; el.style.borderColor = "rgba(5,150,105,0.25)"; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = (noteCounts[client.id] ?? 0) > 0 ? "#059669" : "#9E9690"; el.style.borderColor = "rgba(26,23,20,0.10)"; }}>
                  <NotebookPen style={{ width: 13, height: 13 }} />
                  {noteCounts[client.id] ?? 0}
                </button>
              </div>

              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }} onClick={e => e.stopPropagation()}>
                {canManage && (
                  <button onClick={() => setEditTarget(client)} title="編集"
                    style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#6B6458", flexShrink: 0, transition: "all 0.15s" }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#ECFDF5"; el.style.color = "#059669"; el.style.borderColor = "rgba(5,150,105,0.25)"; }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "#6B6458"; el.style.borderColor = "rgba(26,23,20,0.10)"; }}>
                    <Edit2 style={{ width: 14, height: 14 }} />
                  </button>
                )}
                {canManage && (
                  <button onClick={() => setDeleteTarget(client)} title="削除"
                    style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#C9C4BB", flexShrink: 0, transition: "all 0.15s" }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#FEF2F2"; el.style.color = "#DC2626"; el.style.borderColor = "rgba(220,38,38,0.25)"; }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "#C9C4BB"; el.style.borderColor = "rgba(26,23,20,0.10)"; }}>
                    <Trash2 style={{ width: 14, height: 14 }} />
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>

      {showCreate && <ClientFormDialog onClose={() => setShowCreate(false)} onSaved={refreshClients} />}
      {editTarget && <ClientFormDialog client={editTarget} onClose={() => setEditTarget(null)} onSaved={refreshClients} />}
      {deleteTarget && <ConfirmDialog message={`「${deleteTarget.name}」を削除しますか？`} onConfirm={() => handleDeleteClient(deleteTarget)} onClose={() => setDeleteTarget(null)} />}
    </div>
  );
}
