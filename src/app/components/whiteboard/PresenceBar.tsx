// 参加者アバター列（ENHA2-031）。接続中メンバーを上部に表示し、他メンバーのアバターを
// クリックするとその人のビューポートを追従する（もう一度クリックで解除）。
// data-follow-ui を付け、追従中の「自分操作で自動解除」判定から除外させる。
import type { RosterMember } from "@/app/hooks/useWhiteboardSync";

interface Props {
  roster: RosterMember[];
  followingClientId: string | null;
  onFollow: (clientId: string) => void;
  onUnfollow: () => void;
}

export function PresenceBar({ roster, followingClientId, onFollow, onUnfollow }: Props) {
  const others = roster.filter((m) => !m.self);
  if (others.length === 0) return null; // 自分だけなら追従対象がないので非表示
  const self = roster.find((m) => m.self);
  const ordered = self ? [self, ...others] : others;

  return (
    <div
      data-follow-ui
      style={{
        position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)",
        display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
        background: "rgba(255,255,255,0.92)", borderRadius: 999,
        boxShadow: "0 1px 4px rgba(0,0,0,0.15)", zIndex: 20, pointerEvents: "auto",
      }}
    >
      {ordered.map((m) => {
        const isFollowing = m.clientId === followingClientId;
        const initial = (m.name || "?").trim().charAt(0).toUpperCase();
        const title = m.self
          ? `${m.name}（あなた）`
          : isFollowing ? `${m.name} を追従中（クリックで解除）` : `${m.name} を追従`;
        return (
          <button
            key={m.clientId}
            type="button"
            title={title}
            onClick={() => { if (m.self) return; isFollowing ? onUnfollow() : onFollow(m.clientId); }}
            style={{
              width: 28, height: 28, borderRadius: "50%",
              border: isFollowing ? "2px solid #2b8a3e" : m.self ? "2px solid #fff" : "2px solid transparent",
              background: m.color, color: "#fff", fontSize: 12, fontWeight: 700,
              cursor: m.self ? "default" : "pointer", padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.1)",
            }}
          >
            {initial}
          </button>
        );
      })}
    </div>
  );
}
