import { useState, useEffect } from "react";
import type { Member } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { getRoleMeta } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";

const ROLE_COLORS: Record<string, { grad: string; badge: string; text: string }> = {
  admin: { grad: "linear-gradient(135deg,#FB7185,#F43F5E)", badge: "#FFF1F2", text: "#F43F5E" },
  "project-manager": { grad: "linear-gradient(135deg,#34D399,#059669)", badge: "#ECFDF5", text: "#059669" },
  developer: { grad: "linear-gradient(135deg,#38BDF8,#0284C7)", badge: "#F0F9FF", text: "#0284C7" },
  designer: { grad: "linear-gradient(135deg,#A78BFA,#7C3AED)", badge: "#F5F3FF", text: "#7C3AED" },
};
const DEFAULT_ROLE_COLOR = { grad: "linear-gradient(135deg,#9CA3AF,#6B7280)", badge: "#F3F4F6", text: "#6B7280" };

export function MemberDetailDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const [projectCount, setProjectCount] = useState<number>(member.projects ?? 0);
  const [ticketCount, setTicketCount] = useState<number>(member.tickets ?? 0);

  // 🌟 追加: モーダルが開かれた際に、DBから実際の件数を同期取得する
  useEffect(() => {
    if (!isSupabaseEnabled || !member.name) return;

    const fetchCounts = async () => {
      // 担当プロジェクトのカウント（members配列に名前が含まれるもの）
      const { data: projData } = await supabase!.from("projects").select("members");
      if (projData) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const count = projData.filter((p: any) => Array.isArray(p.members) && p.members.includes(member.name)).length;
        setProjectCount(count);
      }

      // 担当チケットのカウント（assigneeが一致するもの）
      const { count: tktCount } = await supabase!
        .from("sprint_tickets")
        .select("id", { count: "exact", head: true })
        .eq("assignee", member.name);
      if (tktCount !== null) {
        setTicketCount(tktCount);
      }
    };

    fetchCounts();
  }, [member.name]);

  const rc = ROLE_COLORS[member.role] ?? DEFAULT_ROLE_COLOR;
  const statusLabel = member.status === "active" ? "アクティブ" : member.status === "invited" ? "招待中" : "非アクティブ";
  return (
    <DialogShell title="メンバー詳細" onClose={onClose} footer={<BtnSecondary onClick={onClose}>閉じる</BtnSecondary>}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, padding: "14px", background: "#F4F5F6", borderRadius: 12 }}>
        <Avatar name={member.name} size="lg" />
        <div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#1A1714" }}>{member.name}</p>
          <p style={{ fontSize: 12, color: "#B0A9A4", marginTop: 2 }}>{member.email}</p>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: rc.badge, color: rc.text }}>{getRoleMeta(member.role).label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "#F4F5F6", color: "#6B6458" }}>{statusLabel}</span>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {/* 🌟 修正: valueの参照先を取得した projectCount と ticketCount に変更 */}
        {[{ label: "所属グループ", value: member.group || "—" }, { label: "担当プロジェクト", value: `${projectCount}件` }, { label: "担当チケット", value: `${ticketCount}件` }, { label: "ID", value: member.id }].map(({ label, value }) => (
          <div key={label} style={{ background: "#F4F5F6", borderRadius: 10, padding: "12px 14px" }}>
            <p style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>{label}</p>
            <p style={{ fontSize: 13, color: "#1A1714", fontWeight: 600 }}>{value}</p>
          </div>
        ))}
      </div>
    </DialogShell>
  );
}
