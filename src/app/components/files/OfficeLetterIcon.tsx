import type { GoogleAppKind } from "@/app/lib/projectFiles";

// Office の頭文字タイル（X / W / P）。一覧の「Excelに変換」等のボタンで使う。
// FileKindIcon と同じく、ロゴそのものは使わず頭文字タイルで表す（商標のため）。
const TILE: Record<GoogleAppKind, { letter: string; color: string }> = {
  spreadsheet: { letter: "X", color: "#107C41" },
  document: { letter: "W", color: "#185ABD" },
  presentation: { letter: "P", color: "#C43E1C" },
};

export function OfficeLetterIcon({ kind, size = 14 }: { kind: GoogleAppKind; size?: number }) {
  const t = TILE[kind];
  return (
    <span aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: 3, background: t.color, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: Math.round(size * 0.68), fontWeight: 800, lineHeight: 1,
      }}>
      {t.letter}
    </span>
  );
}
