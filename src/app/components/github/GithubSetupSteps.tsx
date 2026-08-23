// GitHub連携のセットアップ進捗（docs/github-integration-design.md 8-1）。
//
// この機能は「①App のインストール → ②リポジトリの紐付け → ③メンバーへの権限付与」の
// 3段で、③を忘れると誰の画面にも GitHub タブが出ない。今どこまで終わっているかを
// 常に見せて、探させないための帯。
import { Check } from "lucide-react";

export interface SetupStepState {
  installed: boolean;
  linked: boolean;
  granted: boolean;
}

const STEPS: { key: keyof SetupStepState; label: string }[] = [
  { key: "installed", label: "GitHubに接続" },
  { key: "linked", label: "リポジトリを紐付け" },
  { key: "granted", label: "権限を付与" },
];

export function GithubSetupSteps({ state, onJump }: {
  state: SetupStepState;
  onJump?: (key: keyof SetupStepState) => void;
}) {
  // 先頭の未完了ステップが「実施中」
  const currentIndex = STEPS.findIndex(s => !state[s.key]);

  return (
    <div style={{ display: "flex", alignItems: "stretch", background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: "12px 8px", marginBottom: 16 }}>
      {STEPS.map((s, i) => {
        const done = state[s.key];
        const active = i === currentIndex;
        const color = done ? "#059669" : active ? "#1F2328" : "#C9C4BB";
        return (
          <div key={s.key} style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "0 10px" }}>
            <button
              type="button"
              onClick={() => onJump?.(s.key)}
              style={{ display: "flex", alignItems: "center", gap: 9, background: "none", border: "none", padding: 0, cursor: onJump ? "pointer" : "default", textAlign: "left" as const, flex: 1, minWidth: 0 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: done || active ? "#FFF" : "#8A837B", background: done ? "#059669" : active ? "#1F2328" : "#EDEBE7" }}>
                {done ? <Check style={{ width: 12, height: 12 }} /> : i + 1}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: done || active ? "#1A1714" : "#A09790", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</p>
                <p style={{ fontSize: 10, color, marginTop: 1 }}>{done ? "完了" : active ? "実施中" : "未実施"}</p>
              </div>
            </button>
            {i < STEPS.length - 1 && (
              <div style={{ width: 24, height: 1, background: "rgba(26,23,20,0.12)", flexShrink: 0 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 3段すべて完了したときに、ステップ表示の代わりに出す状態帯。
 * 以前はこれを出して設定ブロックを畳んでいたが、設定画面なのに中身が消えて
 * 一行だけの殺風景な画面になってしまうため、畳まずに設定はそのまま表示する。
 */
export function GithubSetupDone({ linkedCount, grantedCount }: {
  linkedCount: number; grantedCount: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "13px 16px", marginBottom: 16 }}>
      <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#059669", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Check style={{ width: 12, height: 12, color: "#FFF" }} />
      </div>
      <div>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#15803D" }}>セットアップ完了</span>
        <span style={{ fontSize: 12, color: "#166534", marginLeft: 10 }}>
          {linkedCount}プロジェクトに紐付け済み ・ {grantedCount}名に権限を付与済み
        </span>
      </div>
    </div>
  );
}
