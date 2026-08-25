// GitHub App の権限で操作が止まっているときの案内（docs/github-integration-design.md 8-7）。
//
// 「押してから失敗して初めて理由が出る」状態にしないための表示。
// 直しに行く画面は原因によって違う（App の設定 / インストールの承認）ので、
// 文言だけでなくリンク先もサーバーが決めたものをそのまま出す。
import { ExternalLink, ShieldAlert } from "lucide-react";
import type { GithubPermissionBlock } from "@/app/types";

const AMBER_TEXT = "#92400E";

export function PermissionBlockNotice({ block, compact }: {
  block: GithubPermissionBlock;
  /** ダイアログの中など、余白を詰めたい場所で使う */
  compact?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 10, background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.30)", borderRadius: 10, padding: compact ? "11px 13px" : "13px 16px", marginBottom: compact ? 0 : 12 }}>
      <ShieldAlert style={{ width: 15, height: 15, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: AMBER_TEXT, marginBottom: 4 }}>
          {block.scope === "app"
            ? "GitHub App の設定に権限がありません（承認では直りません）"
            : block.scope === "install"
              ? "GitHub App の権限更新が承認されていません"
              : "GitHub 側で拒否されました"}
        </p>
        <p style={{ fontSize: 12, color: AMBER_TEXT, lineHeight: 1.75 }}>{block.message}</p>
        {block.missing.length > 0 && (
          <div style={{ marginTop: 5 }}>
            {block.missing.map(m => (
              <p key={m.key} style={{ fontSize: 11, color: AMBER_TEXT, lineHeight: 1.7 }}>
                ・<strong>{m.label}</strong>：{m.current} → <strong>{m.need}</strong>（{m.why}）
              </p>
            ))}
          </div>
        )}
        {block.fixUrl && (
          <a href={block.fixUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 12, fontWeight: 700, color: AMBER_TEXT, textDecoration: "underline" }}>
            {block.scope === "app" ? "App の権限設定をひらく" : "インストール設定をひらく"}
            <ExternalLink style={{ width: 11, height: 11 }} />
          </a>
        )}
      </div>
    </div>
  );
}
