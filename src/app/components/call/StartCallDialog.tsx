// 発信ダイアログ。プロジェクトを選び、そのPJにアサインされたメンバーを取得して
// プルダウン(複数選択可)で選択し、Callで発信する。
//
// BRU5-066: 通話中に開いた場合は「追加で呼ぶ」モードになる。
// 通話中のプロジェクトは固定(組織/PJの選択は出さない)で、既に参加中・呼び出し中の人は一覧から除外する。
import { useEffect, useMemo, useState } from "react";
import { X, Phone, Search, Check, Users, UserPlus } from "lucide-react";
import { Avatar } from "@/app/components/shared/Avatar";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";
import { useCall } from "@/app/contexts/CallContext";
import { fetchProjectCallMembers } from "@/app/lib/callService";
import { MAX_PARTICIPANTS, type CallMember } from "@/app/lib/callConstants";

interface Proj { id: string; name: string }

export function StartCallDialog({ onClose }: { onClose: () => void }) {
  const { userId, userName, userRole } = useAuth();
  const { orgs, selectedOrgId } = useOrg();
  const { online, startCall, inviteToCall, call } = useCall();
  const isOwner = userRole === "owner";
  const isAdmin = isOwner || userRole === "admin";
  // 通話中に開いたら「メンバーを追加」モード。プロジェクトは通話中のものに固定する。
  const addMode = !!call;

  // オーナーのみ、モーダル内で組織を選択する(グローバルの組織フィルタとは連動させない)。
  // 初期値はグローバルで選択中の組織を流用する。
  const [orgId, setOrgId] = useState<string>(() => (isOwner ? selectedOrgId ?? "" : ""));
  const [projects, setProjects] = useState<Proj[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [members, setMembers] = useState<CallMember[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [query, setQuery] = useState("");

  // 自分がアサインされているプロジェクト。
  // オーナー: 選択中の組織のPJのみ / admin: 全件 / 一般: 自分がアサインされたPJ
  useEffect(() => {
    if (!isSupabaseEnabled || addMode) return; // 追加モードではPJ選択自体を出さない
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
  }, [isOwner, isAdmin, userName, orgId, addMode]);

  // 組織を切り替えたらプロジェクト以降の選択をリセット
  useEffect(() => {
    if (addMode) return;
    setProjectId("");
    setMembers([]);
    setSelected(new Set());
  }, [orgId, addMode]);

  // 追加モードでは通話中のPJに固定、通常モードは選択されたPJ
  const effProjectId = call ? call.projectId : projectId;

  // プロジェクト選択でメンバー取得
  useEffect(() => {
    if (!effProjectId) { setMembers([]); setSelected(new Set()); return; }
    setLoadingMembers(true);
    setSelected(new Set());
    void fetchProjectCallMembers(effProjectId, userId).then((list) => {
      setMembers(list);
      setLoadingMembers(false);
    });
  }, [effProjectId, userId]);

  const project = call
    ? { id: call.projectId, name: call.projectName }
    : projects.find((p) => p.id === projectId) ?? null;

  // 追加モード: すでに参加中／呼び出し中の人は選べない(一覧から外す)
  const excluded = useMemo(
    () => new Set(call ? [...call.participants.map((p) => p.id), ...call.pending.map((p) => p.id)] : []),
    [call],
  );
  const filtered = useMemo(
    () => members
      .filter((m) => !excluded.has(m.id))
      .filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase())),
    [members, query, excluded],
  );

  // 上限判定の起点: 通常発信は自分1人、追加モードは「今いる人＋呼び出し中の人」
  const baseCount = call ? call.participants.length + call.pending.length : 1;
  const atLimit = selected.size + baseCount >= MAX_PARTICIPANTS;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size + baseCount < MAX_PARTICIPANTS) next.add(id);
      return next;
    });
  };

  const handleCall = () => {
    if (!project || selected.size === 0) return;
    const targets = members.filter((m) => selected.has(m.id));
    if (addMode) inviteToCall(targets);
    else void startCall({ id: project.id, name: project.name }, targets);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9997, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(20,26,22,0.4)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 400, maxHeight: "80vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 18, boxShadow: "0 20px 60px rgba(0,0,0,0.28)", overflow: "hidden" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(145deg,#34D399,#059669)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {addMode ? <UserPlus style={{ width: 15, height: 15, color: "#fff" }} /> : <Phone style={{ width: 15, height: 15, color: "#fff" }} />}
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#1A1714" }}>
              {addMode ? "通話にメンバーを追加" : "音声通話を発信"}
            </span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#A09790" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        {/* 追加モードは通話中のプロジェクトに固定。組織/PJ の選択は出さない。 */}
        {addMode && (
          <div style={{ padding: "14px 18px 0" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "#6B6458", marginBottom: 6 }}>プロジェクト</div>
            <div style={{ height: 40, borderRadius: 10, background: "#F5F4F2", border: "1px solid rgba(26,23,20,0.08)", display: "flex", alignItems: "center", padding: "0 12px", fontSize: 13, color: "#3D3732", fontWeight: 600 }}>
              {call!.projectName}
            </div>
          </div>
        )}

        {!addMode && isOwner && (
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

        {!addMode && (
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
        )}

        {effProjectId && (
          <div style={{ padding: "10px 18px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: "#6B6458", display: "flex", alignItems: "center", gap: 5 }}>
              <Users style={{ width: 13, height: 13 }} />
              {addMode
                ? `追加するメンバー（あと${Math.max(0, MAX_PARTICIPANTS - baseCount)}人まで）`
                : `メンバー（複数選択可・最大${MAX_PARTICIPANTS - 1}人）`}
            </label>
            {selected.size > 0 && <span style={{ fontSize: 11, color: "#059669", fontWeight: 700 }}>{selected.size}人選択中</span>}
          </div>
        )}

        {effProjectId && (
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
          {effProjectId && loadingMembers && <div style={{ padding: 20, textAlign: "center", color: "#B0A9A4", fontSize: 12 }}>読み込み中…</div>}
          {effProjectId && !loadingMembers && filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "#B0A9A4", fontSize: 12 }}>
              {addMode ? "追加できるメンバーがいません" : "通話できるメンバーがいません"}
            </div>
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
            disabled={selected.size === 0}
            style={{ width: "100%", height: 46, borderRadius: 13, border: "none", cursor: selected.size === 0 ? "not-allowed" : "pointer", background: selected.size === 0 ? "#E7E5E1" : "linear-gradient(145deg,#34D399,#059669)", color: selected.size === 0 ? "#A09790" : "#fff", fontWeight: 800, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {addMode ? <UserPlus style={{ width: 17, height: 17 }} /> : <Phone style={{ width: 17, height: 17 }} />}
            {selected.size === 0
              ? "メンバーを選択してください"
              : addMode ? `追加で呼ぶ（${selected.size}人）` : `発信（${selected.size}人）`}
          </button>
        </div>
      </div>
    </div>
  );
}
