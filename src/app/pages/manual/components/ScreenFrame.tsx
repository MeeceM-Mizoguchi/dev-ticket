import type { ReactNode, CSSProperties } from "react";

/**
 * マニュアル用の「画面枠」。画像貼り付けのサイズ感で、
 * 中にコーディング再現の画面モックと <Spotlight> を重ねる。
 * position:relative + overflow:hidden により、Spotlight は
 * この枠を基準に配置され、box-shadow のグレーアウトも枠内に収まる。
 */
export function ScreenFrame({
  children,
  aspectRatio = "16 / 10",
  maxWidth = 760,
}: {
  children: ReactNode;
  aspectRatio?: string;
  maxWidth?: number;
}) {
  const frame: CSSProperties = {
    position: "relative",
    width: "100%",
    maxWidth,
    margin: "0 auto",
    aspectRatio,
    borderRadius: 12,
    overflow: "hidden",
    background: "#fff",
    border: "1px solid rgba(26,23,20,0.12)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
  };
  return <div style={frame}>{children}</div>;
}
