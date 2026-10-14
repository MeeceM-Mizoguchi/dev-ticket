// ENHA2-053 WBSマニュアル。
//
// 「マニュアル」ボタンで開く大きなモーダル。左のメニューから知りたい機能を選ぶと、
// 真ん中にイメージ画面つきの説明が出る。中身（項目・説明・図）は wbsManualContent.tsx。
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Lightbulb, X } from "lucide-react";
import { escStack } from "@/app/lib/escStack";
import { WBS_MANUAL } from "./wbsManualContent";

/** 手順の先頭に書く、図の番号と対応する文字 */
const CIRCLED = "①②③④⑤⑥⑦⑧⑨";

export function WbsManualDialog({ canEdit, onClose }: {
  /** WBSの権限が「編集可」か。「閲覧のみ」の人には、編集できる人向けの機能に注記を出す */
  canEdit: boolean;
  onClose: () => void;
}) {
  const items = useMemo(() => WBS_MANUAL.flatMap(g => g.items), []);
  const [activeId, setActiveId] = useState(items[0].id);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    escStack.push(onClose);
    return () => escStack.pop(onClose);
  }, [onClose]);

  // 項目を切り替えたら、説明の先頭から読めるようにする
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [activeId]);

  const index = Math.max(0, items.findIndex(i => i.id === activeId));
  const item = items[index];
  const prev = items[index - 1];
  const next = items[index + 1];

  const navBtn = (enabled: boolean) => ({
    display: "inline-flex", alignItems: "center", gap: 4, height: 34, padding: "0 14px", fontSize: 13, fontWeight: 600, borderRadius: 10,
    color: enabled ? "#4B5563" : "#C9C4BB", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.12)", cursor: enabled ? "pointer" : "not-allowed",
  } as const);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="WBS マニュアル"
        style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", width: "min(1100px, 92vw)", height: "min(760px, 88vh)", background: "#FFFFFF", borderRadius: 20, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.08)" }}>
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", background: "linear-gradient(135deg, #059669 0%, #047857 60%, #065F46 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BookOpen style={{ width: 18, height: 18, color: "#FFFFFF" }} />
            <div>
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 3 }}>Dev Ticket</p>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: "#FFFFFF", fontFamily: "var(--font-heading)", letterSpacing: "-0.025em", lineHeight: 1.1 }}>WBS マニュアル</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる"
            style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid rgba(255,255,255,0.20)", background: "rgba(255,255,255,0.10)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.8)" }}>
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* 左メニュー */}
          <nav aria-label="マニュアルの目次" style={{ flex: "0 0 230px", overflowY: "auto", padding: "14px 10px", background: "#F7F8F9", borderRight: "1px solid rgba(26,23,20,0.07)" }}>
            {WBS_MANUAL.map(group => (
              <div key={group.title} style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: "#A09790", padding: "0 10px 4px", letterSpacing: "0.04em" }}>{group.title}</p>
                {group.items.map(it => {
                  const active = it.id === activeId;
                  return (
                    <button key={it.id} type="button" onClick={() => setActiveId(it.id)} aria-current={active ? "page" : undefined}
                      style={{ display: "block", width: "100%", padding: "7px 10px", textAlign: "left", fontSize: 13, borderRadius: 8, border: "none", cursor: "pointer",
                        fontWeight: active ? 700 : 500, color: active ? "#047857" : "#4B5563", background: active ? "#D1FAE5" : "transparent" }}>
                      {it.title}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* 説明 */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 28px" }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.01em" }}>{item.title}</h3>
              <p style={{ fontSize: 14, color: "#1A1714", lineHeight: 1.8, marginTop: 8 }}>{item.lead}</p>
              {item.editOnly && !canEdit && (
                <p style={{ fontSize: 12, color: "#92400E", background: "#FEF3C7", borderRadius: 8, padding: "7px 11px", marginTop: 10, lineHeight: 1.7 }}>
                  この機能は、WBS の権限が「編集可」の人が使えます。あなたの権限は「閲覧のみ」のため、操作のための部品は表示されません。
                </p>
              )}

              {/* イメージ画面 */}
              <div style={{ margin: "16px 0", padding: 16, background: "#F5F6F8", borderRadius: 14 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: "#A09790", marginBottom: 8, letterSpacing: "0.04em" }}>画面のイメージ</p>
                <div style={{ overflowX: "auto" }}>{item.illustration}</div>
              </div>

              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {item.steps.map((s, i) => {
                  // 先頭が「①」などの手順は、図の中の赤い番号と同じ印を付ける（図のどこの話かが分かるように）。
                  // 番号の無い手順は、小さな点だけにする（図と関係のない通し番号を振ると、①②と食い違って紛らわしい）
                  const mark = CIRCLED.indexOf(s[0]);
                  return (
                    <li key={i} style={{ display: "flex", gap: 10, fontSize: 14, color: "#1A1714", lineHeight: 1.8 }}>
                      {mark >= 0 ? (
                        <span style={{ flexShrink: 0, width: 20, height: 20, marginTop: 3, borderRadius: "50%", background: "#DC2626", color: "#FFF", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{mark + 1}</span>
                      ) : (
                        <span style={{ flexShrink: 0, width: 20, height: 20, marginTop: 3, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#059669" }} />
                        </span>
                      )}
                      <span>{mark >= 0 ? s.slice(1).trimStart() : s}</span>
                    </li>
                  );
                })}
              </ol>

              {item.notes && item.notes.length > 0 && (
                <div style={{ marginTop: 18, padding: "12px 14px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12 }}>
                  <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#047857", marginBottom: 6 }}>
                    <Lightbulb style={{ width: 13, height: 13 }} />知っておくとよいこと
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                    {item.notes.map((n, i) => <li key={i} style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.8 }}>{n}</li>)}
                  </ul>
                </div>
              )}
            </div>

            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 28px", borderTop: "1px solid rgba(26,23,20,0.07)" }}>
              <span style={{ fontSize: 12, color: "#A09790" }}>{index + 1} / {items.length}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={!prev} onClick={() => prev && setActiveId(prev.id)} style={navBtn(!!prev)}>
                  <ChevronLeft style={{ width: 14, height: 14 }} />前へ
                </button>
                <button type="button" disabled={!next} onClick={() => next && setActiveId(next.id)} style={navBtn(!!next)}>
                  次へ<ChevronRight style={{ width: 14, height: 14 }} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
