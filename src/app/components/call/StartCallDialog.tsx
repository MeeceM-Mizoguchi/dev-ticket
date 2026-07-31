// 発信ダイアログ。プロジェクトを選び、そのPJにアサインされたメンバーを取得して
// 1人だけ選択し、1対1で発信する。
//
// グループ通話は廃止したため複数選択・通話中の追加招待は行わない（単一選択のみ）。
import { useEffect, useState } from "react";
import { X, Phone, Search, Check, Users } from "lucide-react";
import { Avatar } from "@/app/components/shared/Avatar";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";
import { useCall } from "@/app/contexts/CallContext";
import { fetchProjectCallMembers } from "@/app/lib/callService";
import { type CallMember } from "@/app/lib/callConstants";

interface Proj { id: string; name: string }

export function StartCallDialog({ onClose }: { onClose: () => void }) {
  const { userId, userName, userRole } = useAuth();
  const { orgs, selectedOrgId } = useOrg();
  const { online, startCall } = useCall();
  const isOwner = userRole === "owner";
  const isAdmin = isOwner || userRole === "admin";

  // オーナーのみ、モーダル内で組織を選択する(グローバルの組織フィルタとは連動させない)。
  // 初期値はグローバルで選択中の組織を流用する。
  const [orgId, setOrgId] = useState<string>(() => (isOwner ? selectedOrgId ?? "" : ""));
  const [projects, setProjects] = useState<Proj[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [members, setMembers] = useState<CallMember[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [query, setQuery] = useState("");

  // 自分がアサインされているプロジェクト。
  // オーナー: 選択中の組織のPJのみ / admin: 全件 / 一般: 自分がアサインされたPJ
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    // オーナーは組織未選択なら取得しない
    if (isOwner && !orgId) { setProjects([]); return; }
    let q = supabase!.from("projects").select("id, name, members, organization_id");
    if (isOwner) q = q.eq("organization_id", orgId);
    q.order("name").then(({ data }) => {
      if (!data) return;
      const accessible = data.filter((p: { members?: unknown[] }) => {
        if (isAdmin) return true;
        if (!Array.isArray(p.members)) return false;
        return p.members.some((m: unknown) => m && ((m as { name?: string }).name === userName || m === userName));
      });
      setProjects(accessible.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
    });
  }, [isOwner, isAdmin, userName, orgId]);

  // 組織を切り替えたらプロジェクト以降の選択をリセット
  useEffect(() => {
    setProjectId("");
    setMembers([]);
    setSelectedId(null);
  }, [orgId]);

  // プロジェクト選択でメンバー取得
  useEffect(() => {
    if (!projectId) { setMembers([]); setSelectedId(null); return; }
    setLoadingMembers(true);
    setSelectedId(null);
    void fetchProjectCallMembers(projectId, userId).then((list) => {
      setMembers(list);
      setLoadingMembers(false);
    });
  }, [projectId, userId]);

  const project = projects.find((p) => p.id === projectId) ?? null;

  const filtered = members.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()));

  // 単一選択: 同じ相手を再度押すと解除、別の相手を押すと切り替え
  const toggle = (id: string) => setSelectedId((prev) => (prev === id ? null : id));

  const handleCall = () => {
    if (!project || !selectedId) return;
    const target = members.find((m) => m.id === selectedId);
    if (!target) return;
    void startCall({ id: project.id, name: project.name }, [target]);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9997, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(20,26,22,0.4)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 400, maxHeight: "80vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 18, boxShadow: "0 20px 60px rgba(0,0,0,0.28)", overflow: "hidden" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(145deg,#34D399,#059669)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Phone style={{ width: 15, height: 15, color: "#fff" }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#1A1714" }}>音声通話を発信</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#A09790" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        {isOwner && (
          <div style={{ padding: "14px 18px 0" }}>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: "#6B6458", display: "block", marginBottom: 6 }}>組織</label>
            <select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              style={{ width: "100%", height: 40, borderRadius: 10, border: "1px solid rgba(26,23,20,0.14)", padding: "0 12px", fontSize: 13, color: "#1A1714", background: "#fff", cursor: "pointer" }}>
              <option value="">組織を選択…</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ padding: "14px 18px 6px" }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: "#6B6458", display: "block", marginBottom: 6 }}>プロジェクト</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={isOwner && !orgId}
            style={{ width: "100%", height: 40, borderRadius: 10, border: "1px solid rgba(26,23,20,0.14)", padding: "0 12px", fontSize: 13, color: "#1A1714", background: isOwner && !orgId ? "#F5F4F2" : "#fff", cursor: isOwner && !orgId ? "not-allowed" : "pointer" }}>
            <option value="">{isOwner && !orgId ? "先に組織を選択してください" : "プロジェクトを選択…"}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {projectId && (
          <div style={{ padding: "10px 18px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: "#6B6458", display: "flex", alignItems: "center", gap: 5 }}>
              <Users style={{ width: 13, height: 13 }} />
              メンバー
            </label>
          </div>
        )}

        {projectId && (
          <div style={{ padding: "0 18px 8px" }}>
            <div style={{ position: "relative" }}>
              <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#C9C4BB" }} />
              <input
                value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名前で絞り込み"
                style={{ width: "100%", height: 36, borderRadius: 9, border: "1px solid rgba(26,23,20,0.12)", padding: "0 10px 0 30px", fontSize: 12.5 }} />
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "0 10px" }}>
          {projectId && loadingMembers && <div style={{ padding: 20, textAlign: "center", color: "#B0A9A4", fontSize: 12 }}>読み込み中…</div>}
          {projectId && !loadingMembers && filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "#B0A9A4", fontSize: 12 }}>通話できるメンバーがいません</div>
          )}
          {filtered.map((m) => {
            const isOn = online.has(m.id);
            const isSel = selectedId === m.id;
            return (
              <button
                key={m.id}
                onClick={() => toggle(m.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "9px 10px", borderRadius: 10, border: "none", background: isSel ? "#F0FDF8" : "transparent", cursor: "pointer", textAlign: "left", transition: "background 0.12s" }}
                onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "#F7F8F9"; }}
                onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "transparent"; }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <Avatar name={m.name} size="sm" />
                  <div title={isOn ? "オンライン" : "オフライン"} style={{ position: "absolute", right: -1, bottom: -1, width: 11, height: 11, borderRadius: "50%", background: isOn ? "#22C55E" : "#C9C4BB", border: "2px solid #fff" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1A1714" }}>{m.name}</div>
                  <div style={{ fontSize: 10.5, color: isOn ? "#059669" : "#B0A9A4" }}>{isOn ? "オンライン" : "オフライン"}</div>
                </div>
                <div style={{ width: 20, height: 20, borderRadius: 6, border: isSel ? "none" : "1.5px solid rgba(26,23,20,0.18)", background: isSel ? "#059669" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {isSel && <Check style={{ width: 13, height: 13, color: "#fff" }} />}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(26,23,20,0.07)" }}>
          <button
            onClick={handleCall}
            disabled={!selectedId}
            style={{ width: "100%", height: 46, borderRadius: 13, border: "none", cursor: !selectedId ? "not-allowed" : "pointer", background: !selectedId ? "#E7E5E1" : "linear-gradient(145deg,#34D399,#059669)", color: !selectedId ? "#A09790" : "#fff", fontWeight: 800, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Phone style={{ width: 17, height: 17 }} />
            {!selectedId ? "メンバーを選択してください" : "発信"}
          </button>
        </div>
      </div>
    </div>
  );
}
