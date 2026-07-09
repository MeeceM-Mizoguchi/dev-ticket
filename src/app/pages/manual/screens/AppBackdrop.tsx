import type { ReactNode } from "react";
import { MockAppShell } from "@/app/components/lp/mocks/MockAppShell";
import { ChevronRight, ChevronDown } from "lucide-react";

const s = (o: React.CSSProperties) => o;

// アプリ画面の共通背景（薄いスプリント一覧）。パネル/モーダルはこの上に重ねる。
function FaintList() {
  const rows = [
    { name: "サンプルスプリント A", t: "12", d: "8", p: "66%" },
    { name: "サンプルスプリント B", t: "9", d: "3", p: "33%" },
  ];
  return (
    <div style={s({ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, opacity: 0.5 })}>
      <div style={s({ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#B0A9A4" })}>
        <span style={s({ color: "#059669", fontWeight: 600 })}>プロジェクト</span>
        <ChevronRight style={{ width: 10, height: 10 }} /><span>サンプルプロジェクト</span>
      </div>
      <h1 style={s({ fontSize: 15, fontWeight: 800, color: "#1A1714", margin: 0 })}>スプリント管理</h1>
      {rows.map((r) => (
        <div key={r.name} style={s({ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#F9F8F6", borderRadius: 11, border: "1px solid rgba(26,23,20,0.08)" })}>
          <ChevronDown style={{ width: 12, height: 12, color: "#B0A9A4", transform: "rotate(-90deg)" }} />
          <span style={s({ fontSize: 12, fontWeight: 700, color: "#1A1714" })}>{r.name}</span>
          <div style={s({ marginLeft: "auto", display: "flex", gap: 16, fontSize: 12, fontWeight: 800, color: "#1A1714" })}>
            <span>{r.t}</span><span>{r.d}</span><span>{r.p}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * アプリ画面の共通枠。MockAppShell（サイドバー＋上部バー）＋薄いスプリント一覧背景。
 * children にパネルやモーダルを重ねて配置する（この要素が position:relative の基準）。
 */
export function AppBackdrop({ children }: { children: ReactNode }) {
  return (
    <MockAppShell activePage="projects" fillHeight>
      <div style={s({ position: "relative", height: "100%", background: "#F9FAFB", overflow: "hidden" })}>
        <FaintList />
        {children}
      </div>
    </MockAppShell>
  );
}

/** モーダル用の暗転オーバーレイ */
export function DimOverlay() {
  return <div style={s({ position: "absolute", inset: 0, background: "rgba(26,23,20,0.35)" })} />;
}
