// 発信ダイアログ。プロジェクトを選び、そのPJにアサインされたメンバーを取得して
// プルダウン(複数選択可)で選択し、Callで発信する。
import { useEffect, useMemo, useState } from "react";
import { X, Phone, Search, Check, Users } from "lucide-react";
import { Avatar } from "@/app/components/shared/Avatar";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useCall } from "@/app/contexts/CallContext";
import { fetchProjectCallMembers } from "@/app/lib/callService";
import { MAX_PARTICIPANTS, type CallMember } from "@/app/lib/callConstants";

interface Proj { id: string; name: string }

export function StartCallDialog({ onClose }: { onClose: () => void }) {
  const { userId, userName, userRole } = useAuth();
  const { online, startCall, call } = useCall();
  const isAdmin = userRole === "owner" || userRole === "admin";

  const [projects, setProjects] = useState<Proj[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [members, setMembers] = useState<CallMember[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [query, setQuery] = useState("");

  // 自分がアサインされているプロジェクト(adminは全件)
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!.from("projects").select("id, name, members").order("name").then(({ data }) => {
      if (!data) return;
      const accessible = data.filter((p: { members?: unknown[] }) => {
        if (isAdmin) return true;
        if (!Array.isArray(p.members)) return false;
        return p.members.some((m: unknown) => m && ((m as { name?: string }).name === userName || m === userName));
      });
      setProjects(accessible.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
    });
  }, [isAdmin, userName]);

  // プロジェクト選択でメンバー取得
  useEffect(() => {
    if (!projectId) { setMembers([]); setSelected(new Set()); return; }
    setLoadingMembers(true);
    setSelected(new Set());
    void fetchProjectCallMembers(projectId, userId).then((list) => {
      setMembers(list);
      setLoadingMembers(false);
    });
  }, [projectId, userId]);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const filtered = useMemo(
    () => members.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase())),
    [members, query],
  );
  const atLimit = selected.size + 1 >= MAX_PARTICIPANTS;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size + 1 < MAX_PARTICIPANTS) next.add(id);
      return next;
    });
  };

  const handleCall = () => {
    if (!project || selected.size === 0 || call) return;
    const targets = members.filter((m) => selected.has(m.id));
    void startCall({ id: project.id, name: project.name }, targets);
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

        <div style={{ padding: "14px 18px 6px" }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: "#6B6458", display: "block", marginBottom: 6 }}>プロジェクト</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            style={{ width: "100%", height: 40, borderRadius: 10, border: "1px solid rgba(26,23,20,0.14)", padding: "0 12px", fontSize: 13, color: "#1A1714", background: "#fff", cursor: "pointer" }}>
            <option value="">プロジェクトを選択…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {projectId && (
          <div style={{ padding: "10px 18px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: "#6B6458", display: "flex", alignItems: "center", gap: 5 }}>
              <Users style={{ width: 13, height: 13 }} /> メンバー（複数選択可・最大{MAX_PARTICIPANTS - 1}人）
            </label>
            {selected.size > 0 && <span style={{ fontSize: 11, color: "#059669", fontWeight: 700 }}>{selected.size}人選択中</span>}
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
            const isSel = selected.has(m.id);
            const disabled = !isSel && atLimit;
            return (
              <button
                key={m.id}
                onClick={() => toggle(m.id)}
                disabled={disabled}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "9px 10px", borderRadius: 10, border: "none", background: isSel ? "#F0FDF8" : "transparent", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, textAlign: "left", transition: "background 0.12s" }}
                onMouseEnter={(e) => { if (!isSel && !disabled) e.currentTarget.style.background = "#F7F8F9"; }}
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
            disabled={selected.size === 0 || !!call}
            style={{ width: "100%", height: 46, borderRadius: 13, border: "none", cursor: selected.size === 0 || call ? "not-allowed" : "pointer", background: selected.size === 0 || call ? "#E7E5E1" : "linear-gradient(145deg,#34D399,#059669)", color: selected.size === 0 || call ? "#A09790" : "#fff", fontWeight: 800, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Phone style={{ width: 17, height: 17 }} />
            {call ? "通話中です" : selected.size === 0 ? "メンバーを選択してください" : `発信（${selected.size}人）`}
          </button>
        </div>
      </div>
    </div>
  );
}
