// 追従中バナー（ENHA2-031）。誰を追従しているかを示し、解除ボタンを提供する。
// data-follow-ui を付け、追従中の「自分操作で自動解除」判定から除外させる。
interface Props {
  name: string;
  color: string;
  onUnfollow: () => void;
}

export function FollowBanner({ name, color, onUnfollow }: Props) {
  return (
    <div
      data-follow-ui
      style={{
        position: "absolute", top: 44, left: "50%", transform: "translateX(-50%)",
        display: "flex", alignItems: "center", gap: 8, padding: "5px 8px 5px 12px",
        background: color, color: "#fff", borderRadius: 999,
        boxShadow: "0 1px 4px rgba(0,0,0,0.2)", zIndex: 20, fontSize: 12, fontWeight: 600,
        pointerEvents: "auto", whiteSpace: "nowrap",
      }}
    >
      <span>{name} さんを追従中</span>
      <button
        type="button"
        onClick={onUnfollow}
        style={{
          border: "none", background: "rgba(255,255,255,0.25)", color: "#fff",
          borderRadius: 999, padding: "2px 8px", fontSize: 11, cursor: "pointer",
        }}
      >
        解除
      </button>
    </div>
  );
}
