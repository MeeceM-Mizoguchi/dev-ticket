import type { ReactNode } from "react";
import { requirementLabel, type Requirement } from "../manualPermissions";

/**
 * 番号付きステップ。左に連番バッジ、右に「見出し＋説明＋画面」。
 * requirement が全ユーザー以外なら、説明の下に権限注記を表示する。
 */
export function ManualStep({
  number,
  title,
  description,
  requirement,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  requirement?: Requirement;
  children?: ReactNode;
}) {
  const permText = requirementLabel(requirement);
  const showPerm = permText !== "全ユーザー";
  return (
    <section style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "#059669",
          color: "#fff",
          fontSize: 13,
          fontWeight: 800,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 2,
        }}
      >
        {number}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 説明テキストは読みやすい幅に抑える */}
        <div style={{ maxWidth: 820 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1A1714", margin: "2px 0 4px" }}>{title}</h3>
          {description && (
            <p style={{ fontSize: 13.5, color: "#6B6458", lineHeight: 1.7, margin: "0 0 10px" }}>{description}</p>
          )}
          {showPerm && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
                color: "#6D28D9",
                background: "#F5F3FF",
                border: "1px solid rgba(124,58,237,0.2)",
                borderRadius: 999,
                padding: "3px 10px",
                margin: "0 0 12px",
              }}
            >
              対象: {permText}
            </div>
          )}
        </div>
        {/* 画面は幅いっぱいに（横長のアプリ画面を大きく見せる） */}
        {children && <div style={{ marginTop: 4 }}>{children}</div>}
      </div>
    </section>
  );
}
