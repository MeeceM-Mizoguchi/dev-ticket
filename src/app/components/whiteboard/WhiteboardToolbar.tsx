// ホワイトボード補助ツールバー（下部中央）。付箋(Miro風) / フレーム(Excalidraw標準) / 折れ矢印トグル。
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { StickyNote, Frame, CornerDownRight } from "lucide-react";

interface Props { api: any; foldMode: boolean; setFoldMode: (v: boolean) => void }

const NOTE_SIZE = 180;
const NOTE_COLORS = ["#FFE066", "#FFC9C9", "#B2F2BB", "#A5D8FF", "#FFD8A8"];

// 現在のビューポート中心（scene座標）
function viewportCenter(api: any) {
  const st = api.getAppState();
  const zoom = st.zoom?.value ?? 1;
  return {
    cx: (st.width ?? 800) / 2 / zoom - st.scrollX,
    cy: (st.height ?? 600) / 2 / zoom - st.scrollY,
  };
}

export function WhiteboardToolbar({ api, foldMode, setFoldMode }: Props) {
  // 折れ矢印モード: ON中に引いた矢印/線が、両端を図形の4点に繋いだ時だけ直交(カギ型)に折れる（BRU5-064）。
  const toggleFold = () => {
    const next = !foldMode;
    setFoldMode(next);
    if (next) api.setActiveTool({ type: "arrow" }); // ONにしたらそのまま矢印ツールへ
  };
  const addStickyNote = (color: string) => {
    const { cx, cy } = viewportCenter(api);
    const x = cx - NOTE_SIZE / 2, y = cy - NOTE_SIZE / 2;
    const els = convertToExcalidrawElements([
      {
        type: "rectangle",
        id: `wb_note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        x, y, width: NOTE_SIZE, height: NOTE_SIZE,
        backgroundColor: color, strokeColor: "transparent", fillStyle: "solid", roughness: 0,
        label: { text: "", fontSize: 20, fontFamily: 2, verticalAlign: "top" },
      } as any,
    ]) as any[];
    els.forEach((e) => { if (e.type === "rectangle") { e.roughness = 0; e.fillStyle = "solid"; e.backgroundColor = color; } });
    api.updateScene({ elements: [...api.getSceneElements(), ...els] });
    const rect = els.find((e) => e.type === "rectangle");
    if (rect) api.updateScene({ appState: { selectedElementIds: { [rect.id]: true } } });
  };

  // フレーム: Excalidraw標準のフレームツールを起動（ドラッグで任意サイズ作成）
  const addFrame = () => {
    api.setActiveTool({ type: "frame" });
  };

  const groupBtn: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", fontSize: 12, fontWeight: 600,
    color: "#374151", background: "#fff", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 7, cursor: "pointer",
  };
  const divider = <div style={{ width: 1, height: 20, background: "rgba(0,0,0,0.08)" }} />;

  // Excalidraw の左プロパティパネル・上部ツールバーと干渉しないよう下部中央に横並び配置（FigJam風）
  return (
    <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 25, pointerEvents: "auto",
      display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
      background: "#fff", borderRadius: 10, border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
      <button onClick={() => addStickyNote(NOTE_COLORS[0])} title="付箋を追加"
        style={{ ...groupBtn, color: "#92700A", background: "#FFF9E6", border: "1px solid rgba(146,112,10,0.25)" }}>
        <StickyNote style={{ width: 13, height: 13 }} />付箋
      </button>
      <div style={{ display: "flex", gap: 5 }}>
        {NOTE_COLORS.map((c) => (
          <button key={c} onClick={() => addStickyNote(c)} title="この色の付箋を追加"
            style={{ width: 20, height: 20, borderRadius: 5, background: c, border: "1px solid rgba(0,0,0,0.12)", cursor: "pointer", padding: 0 }} />
        ))}
      </div>
      {divider}
      <button onClick={addFrame} title="フレームを作成（ドラッグで範囲指定）" style={groupBtn}>
        <Frame style={{ width: 13, height: 13 }} />フレーム
      </button>
      {divider}
      <button
        onClick={toggleFold}
        title="折れ矢印モード: ON中に引いた矢印は、両端を図形につなぐと自動でカギ型に折れます（Shiftを押しながら引いてもOK）"
        style={{ ...groupBtn, ...(foldMode ? { color: "#fff", background: "#1971c2", border: "1px solid #1971c2" } : {}) }}
      >
        <CornerDownRight style={{ width: 13, height: 13 }} />折れ矢印
      </button>
    </div>
  );
}
