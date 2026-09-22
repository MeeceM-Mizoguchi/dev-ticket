import type { ComponentType, CSSProperties } from "react";
import type { FileKind } from "@/app/lib/projectFiles";

// ファイル一覧の種別アイコン。
//
// Excel と Googleスプレッドシート、Word と Googleドキュメントは色が近く、
// 同じ lucide アイコンに色だけ変えても見分けがつかなかった。
// そこで**形そのもの**を変える。
//   Office  … 塗りつぶしのタイルに頭文字（X / W / P）
//   Google  … 角の折れた書類の形に、中身を表す図柄（表 / 行 / 画面）
// 色だけに頼らないので、色覚の違いがあっても区別できる。
//
// ロゴそのものは使わない（商標のため）。頭文字タイルと書類の形は、
// どちらも一般的な表現として使われているもの。

const OFFICE: Partial<Record<FileKind, { letter: string; color: string; label: string }>> = {
  excel: { letter: "X", color: "#107C41", label: "Excel" },
  word: { letter: "W", color: "#185ABD", label: "Word" },
  powerpoint: { letter: "P", color: "#C43E1C", label: "PowerPoint" },
};

const GOOGLE: Partial<Record<FileKind, { color: string; label: string }>> = {
  gsheet: { color: "#0F9D58", label: "Googleスプレッドシート" },
  gdoc: { color: "#4285F4", label: "Googleドキュメント" },
  gslide: { color: "#F4B400", label: "Googleスライド" },
  // Googleドライブ上の draw.io の図。置き場所が Drive なので Google と同じ書類の形にそろえ、
  // 図柄（つながった箱）と色で見分ける
  drawio: { color: "#F08705", label: "draw.io（Googleドライブ）" },
};

const BOX: CSSProperties = {
  width: 30, height: 30, borderRadius: 7, flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
};

/** Google 各アプリの中身を表す図柄（白抜き） */
function GoogleGlyph({ kind }: { kind: FileKind }) {
  const s = { stroke: "#fff", strokeWidth: 1.2, fill: "none", strokeLinecap: "round" as const };
  if (kind === "gsheet") {
    return (
      <>
        <rect x="3.5" y="9.5" width="9" height="6.5" rx="0.6" {...s} />
        <line x1="8" y1="9.5" x2="8" y2="16" {...s} />
        <line x1="3.5" y1="12.75" x2="12.5" y2="12.75" {...s} />
      </>
    );
  }
  if (kind === "gdoc") {
    return (
      <>
        <line x1="4" y1="10" x2="12" y2="10" {...s} />
        <line x1="4" y1="12.6" x2="12" y2="12.6" {...s} />
        <line x1="4" y1="15.2" x2="9.5" y2="15.2" {...s} />
      </>
    );
  }
  if (kind === "drawio") {
    // 上の箱から下の2つの箱へ線がつながった図（フローチャートの形）
    return (
      <>
        <rect x="6" y="8" width="4" height="2.8" rx="0.4" {...s} />
        <path d="M8 10.8v1.6M4.8 12.4h6.4M4.8 12.4v1M11.2 12.4v1" {...s} />
        <rect x="3.2" y="13.4" width="3.2" height="2.6" rx="0.4" {...s} />
        <rect x="9.6" y="13.4" width="3.2" height="2.6" rx="0.4" {...s} />
      </>
    );
  }
  // gslide
  return <rect x="3.5" y="10" width="9" height="5.8" rx="0.6" {...s} />;
}

interface Props {
  kind: FileKind;
  /** Office / Google 以外の種別で使う、従来どおりのアイコン */
  fallback: ComponentType<{ style?: CSSProperties }>;
  /** Office / Google 以外の種別で使う色 */
  fallbackColor: string;
}

export function FileKindIcon({ kind, fallback: Fallback, fallbackColor }: Props) {
  const office = OFFICE[kind];
  if (office) {
    return (
      <span role="img" aria-label={office.label} title={office.label}
        style={{ ...BOX, background: office.color, boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.14)" }}>
        <span aria-hidden="true"
          style={{ color: "#fff", fontSize: 13, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em", fontFamily: "inherit" }}>
          {office.letter}
        </span>
      </span>
    );
  }

  const google = GOOGLE[kind];
  if (google) {
    return (
      <span role="img" aria-label={google.label} title={google.label}
        style={{ ...BOX, background: `${google.color}1F` }}>
        <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true">
          <path d="M2 0h8l6 6v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z" fill={google.color} />
          {/* 右上の折り返し */}
          <path d="M10 0v4a2 2 0 0 0 2 2h4z" fill="#fff" fillOpacity="0.45" />
          <GoogleGlyph kind={kind} />
        </svg>
      </span>
    );
  }

  return (
    <span style={{ ...BOX, background: `${fallbackColor}14` }}>
      <Fallback style={{ width: 14, height: 14, color: fallbackColor }} />
    </span>
  );
}
