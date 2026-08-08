import { CornerDownRight, Plus, ChevronRight } from "lucide-react";
import { AppBackdrop } from "./AppBackdrop";

const s = (o: React.CSSProperties) => o;

function Comment({ initials, color, name, time, body, reply }: { initials: string; color: string; name: string; time: string; body: React.ReactNode; reply?: boolean }) {
  return (
    <div style={s({ display: "flex", gap: 9, marginBottom: 12, marginLeft: reply ? 26 : 0 })}>
      <div style={s({ width: 24, height: 24, borderRadius: 12, background: color, color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 })}>{initials}</div>
      <div style={s({ flex: 1 })}>
        <div style={s({ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 })}>
          <span style={s({ fontSize: 11, fontWeight: 700, color: "#1A1714" })}>{name}</span>
          <span style={s({ fontSize: 9, color: "#B0A9A4" })}>{time}</span>
        </div>
        <div style={s({ fontSize: 11, color: "#3D3732", lineHeight: 1.6, background: "#F7F7F6", borderRadius: 8, padding: "7px 10px" })}>{body}</div>
      </div>
    </div>
  );
}

/** コメント・メンション欄（アプリ枠内のチケット詳細パネル） */
export function ScreenComments() {
  return (
    <AppBackdrop>
      <div style={s({ position: "absolute", top: 0, right: 0, width: "64%", height: "100%", background: "#fff", boxShadow: "-10px 0 30px rgba(0,0,0,0.14)", display: "flex", flexDirection: "column", padding: "14px 18px", boxSizing: "border-box" })}>
        <div style={s({ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#B0A9A4", marginBottom: 4 })}>
          <span style={s({ fontFamily: "monospace", fontWeight: 700, color: "#059669" })}>TKT-001</span>
          <ChevronRight style={{ width: 9, height: 9 }} /><span>サンプルチケット：一覧画面の作成</span>
        </div>
        <div style={s({ fontSize: 12, fontWeight: 800, color: "#1A1714", marginBottom: 12 })}>コメント</div>
        <div style={s({ flex: 1, overflow: "hidden" })}>
          <Comment initials="鈴" color="#0284C7" name="鈴木 花子" time="2時間前" body={<>デザイン確認しました。<span style={{ color: "#059669", fontWeight: 700 }}>@田中太郎</span> カード間の余白を8pxにしてください。</>} />
          <Comment initials="田" color="#059669" name="田中 太郎" time="1時間前" reply body={<><span style={{ color: "#9E9690", fontSize: 9, display: "inline-flex", alignItems: "center", gap: 2 }}><CornerDownRight style={{ width: 9, height: 9 }} />返信</span> 対応しました！ご確認ください。</>} />
        </div>
        {/* mention suggest + input */}
        <div style={s({ position: "relative" })}>
          <div data-spot="mention" style={s({ position: "absolute", bottom: 38, left: 0, width: 150, background: "#fff", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 9, boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: 4 })}>
            {[["田", "#059669", "田中 太郎"], ["鈴", "#0284C7", "鈴木 花子"]].map(([i, c, n]) => (
              <div key={n} style={s({ display: "flex", alignItems: "center", gap: 7, padding: "5px 7px", borderRadius: 6, background: i === "田" ? "#F0FDF8" : "transparent" })}>
                <div style={s({ width: 18, height: 18, borderRadius: 9, background: c as string, color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" })}>{i}</div>
                <span style={s({ fontSize: 10, color: "#3D3732" })}>{n}</span>
              </div>
            ))}
          </div>
          <div data-spot="commentinput" style={s({ display: "flex", gap: 8 })}>
            <div style={s({ flex: 1, height: 30, borderRadius: 8, border: "1px solid rgba(5,150,105,0.4)", background: "#fff", display: "flex", alignItems: "center", padding: "0 10px", fontSize: 10, color: "#3D3732" })}>@田</div>
            <div style={s({ height: 30, borderRadius: 8, background: "#059669", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", padding: "0 12px", gap: 4 })}><Plus style={{ width: 11, height: 11 }} />送信</div>
          </div>
        </div>
      </div>
    </AppBackdrop>
  );
}
