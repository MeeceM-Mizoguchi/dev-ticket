import { ChevronRight, GitBranch, Plus, PauseCircle, PlayCircle, Ban, ChevronDown, Image as ImageIcon, Paperclip, Calendar } from "lucide-react";
import { AppBackdrop } from "./AppBackdrop";

const s = (o: React.CSSProperties) => o;

// 工程。実アプリのチケット詳細は現在ステータスに応じて表示が変わる。
export type Phase = "edit" | "start" | "review" | "approve" | "skip" | "stg" | "uat" | "release" | "hold" | "held" | "withdrawn" | "subticket";

const STATUS: Record<Phase, { label: string; color: string; bg: string }> = {
  start: { label: "未着手", color: "#6B7280", bg: "#F3F4F6" },
  review: { label: "進行中", color: "#0284C7", bg: "#E0F2FE" },
  approve: { label: "レビュー中", color: "#7C3AED", bg: "#F5F3FF" },
  skip: { label: "進行中", color: "#0284C7", bg: "#E0F2FE" },
  stg: { label: "レビュー完了", color: "#059669", bg: "#ECFDF5" },
  uat: { label: "STG完了", color: "#0D9488", bg: "#F0FDFA" },
  release: { label: "UAT完了", color: "#4F46E5", bg: "#EEF2FF" },
  hold: { label: "進行中", color: "#0284C7", bg: "#E0F2FE" },
  held: { label: "保留中", color: "#DC2626", bg: "#FEF2F2" },
  withdrawn: { label: "取下", color: "#4B5563", bg: "#F3F4F6" },
  edit: { label: "進行中", color: "#0284C7", bg: "#E0F2FE" },
  subticket: { label: "進行中", color: "#0284C7", bg: "#E0F2FE" },
};

function Pill({ Icon, label, active }: { Icon: typeof Ban; label: string; active?: "red" | "gray" }) {
  const v = active === "red"
    ? { border: "1px solid rgba(220,38,38,0.35)", background: "#FEF2F2", color: "#DC2626" }
    : active === "gray"
      ? { border: "1px solid rgba(107,114,128,0.35)", background: "#F3F4F6", color: "#4B5563" }
      : { border: "1px solid rgba(26,23,20,0.12)", background: "#fff", color: "#6B6458" };
  return (
    <div style={s({ display: "flex", alignItems: "center", gap: 4, padding: "2px 9px", fontSize: 9, fontWeight: 700, borderRadius: 20, ...v })}>
      <Icon style={{ width: 10, height: 10 }} />{label}
    </div>
  );
}

function MetaCard({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={s({ gridColumn: wide ? "1 / -1" : undefined, background: "#fff", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 10, padding: "9px 11px" })}>
      <div style={s({ fontSize: 8.5, color: "#B0A9A4", fontWeight: 700, letterSpacing: "0.07em", marginBottom: 5 })}>{label}</div>
      {children}
    </div>
  );
}

/**
 * チケット詳細パネル（アプリ枠内・右スライドパネル、実アプリ準拠）。
 * phase で工程を切替。data-spot: action / skip / review / release / hold / fields / subticket
 */
export function ScreenTicketDetail({ phase = "edit" }: { phase?: Phase }) {
  const st = STATUS[phase];
  return (
    <AppBackdrop>
      <div style={s({ position: "absolute", top: 0, right: 0, width: "66%", height: "100%", background: "#fff", boxShadow: "-10px 0 30px rgba(0,0,0,0.14)", display: "flex", flexDirection: "column" })}>
        {/* header */}
        <div style={s({ padding: "12px 18px 12px", borderBottom: "1px solid rgba(26,23,20,0.07)" })}>
          <div style={s({ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#B0A9A4", marginBottom: 6 })}>
            <span>サンプルスプリント A</span><ChevronRight style={{ width: 9, height: 9 }} /><span>チケット詳細</span>
          </div>
          <div style={s({ fontSize: 14, fontWeight: 700, color: "#1A1714", marginBottom: 8 })}>サンプルチケット：一覧画面の作成</div>
          {/* badge row */}
          <div style={s({ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" })}>
            <span style={s({ fontSize: 9, fontFamily: "monospace", color: "#6B6458", background: "#F4F5F6", padding: "2px 8px", borderRadius: 5 })}>TKT-001</span>
            <span style={s({ fontSize: 9, fontWeight: 700, padding: "2px 9px", borderRadius: 20, background: st.bg, color: st.color })}>{st.label}</span>
            <span style={s({ fontSize: 9, fontWeight: 700, padding: "2px 9px", borderRadius: 20, background: "#FEF2F2", color: "#DC2626" })}>優先度: 高</span>
            {/* 保留する・取下する（保留中/取下ではボタンが解除に変わる＝復帰） */}
            <div data-spot={(phase === "hold" || phase === "held" || phase === "withdrawn") ? "hold" : undefined} style={s({ display: "flex", gap: 6 })}>
              <Pill Icon={phase === "held" ? PlayCircle : PauseCircle} label={phase === "held" ? "保留解除" : "保留する"} active={phase === "held" ? "red" : undefined} />
              <Pill Icon={Ban} label={phase === "withdrawn" ? "取下解除" : "取下する"} active={phase === "withdrawn" ? "gray" : undefined} />
            </div>
          </div>

          {/* 工程に応じたヘッダー操作（実アプリは状態で1つだけ表示） */}
          {phase === "start" && (
            <div data-spot="action" style={s({ marginTop: 10, height: 32, borderRadius: 9, border: "1.5px solid rgba(217,119,6,0.33)", background: "#FFF7ED", color: "#D97706", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" })}>着手開始 →</div>
          )}
          {phase === "skip" && (
            <div data-spot="skip" style={s({ marginTop: 10, height: 32, borderRadius: 9, border: "1.5px solid rgba(245,158,11,0.33)", background: "#FFFBEB", color: "#F59E0B", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" })}>レビュースキップ →</div>
          )}
          {phase === "stg" && (
            <div data-spot="action" style={s({ marginTop: 10, height: 32, borderRadius: 9, border: "1.5px solid rgba(13,148,136,0.33)", background: "#F0FDFA", color: "#0D9488", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" })}>STG完了 →</div>
          )}
          {phase === "uat" && (
            <div data-spot="action" style={s({ marginTop: 10, height: 32, borderRadius: 9, border: "1.5px solid rgba(79,70,229,0.33)", background: "#EEF2FF", color: "#4F46E5", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" })}>UAT完了 →</div>
          )}
          {phase === "release" && (
            <div data-spot="release" style={s({ marginTop: 10, display: "flex", alignItems: "stretch", gap: 8 })}>
              <div style={s({ flex: 1, height: 32, borderRadius: 9, border: "1px solid rgba(26,23,20,0.14)", background: "#fff", display: "flex", alignItems: "center", gap: 6, padding: "0 10px", fontSize: 11, color: "#9E9690" })}>
                <Calendar style={{ width: 12, height: 12, color: "#B0A9A4" }} />リリース日を選択
              </div>
              <div style={s({ flexShrink: 0, height: 32, borderRadius: 9, border: "1.5px solid rgba(124,58,237,0.33)", background: "#F5F3FF", color: "#7C3AED", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", padding: "0 12px" })}>対応完了してリリースノートに追加 →</div>
            </div>
          )}
        </div>

        {/* body */}
        {phase === "review" ? (
          // レビュー依頼を送る側の画面（実アプリ準拠）
          <div style={s({ flex: 1, overflow: "hidden", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 })}>
            <div data-spot="review" style={s({ border: "1px solid rgba(124,58,237,0.22)", background: "#FCFBFE", borderRadius: 12, padding: "12px 13px", display: "flex", flexDirection: "column", gap: 10 })}>
              <div>
                <div style={s({ fontSize: 9, fontWeight: 700, color: "#B0A9A4", letterSpacing: "0.07em", marginBottom: 5 })}>レビュアー</div>
                <div style={s({ height: 32, borderRadius: 10, border: "1px solid rgba(26,23,20,0.12)", background: "#F7F8F9", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", fontSize: 11, color: "#3D3732" })}>
                  <span style={s({ display: "flex", alignItems: "center", gap: 6 })}><span style={s({ width: 16, height: 16, borderRadius: 8, background: "#0284C7", color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" })}>鈴</span>鈴木 花子</span>
                  <ChevronDown style={{ width: 12, height: 12, color: "#B0A9A4" }} />
                </div>
              </div>
              <div>
                <div style={s({ fontSize: 9, fontWeight: 700, color: "#B0A9A4", letterSpacing: "0.07em", marginBottom: 5 })}>レビュー依頼内容</div>
                <div style={s({ minHeight: 56, borderRadius: 10, border: "1px solid rgba(26,23,20,0.12)", background: "#fff", padding: "8px 10px", fontSize: 11, color: "#6B6458", lineHeight: 1.55 })}>レスポンシブ表示を重点的に確認してください。</div>
              </div>
              <div style={s({ display: "flex", gap: 8 })}>
                <div style={s({ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#F4F5F6", color: "#6B6458", fontSize: 10.5, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.10)" })}><ImageIcon style={{ width: 12, height: 12 }} />画像添付</div>
                <div style={s({ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#F4F5F6", color: "#6B6458", fontSize: 10.5, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.10)" })}><Paperclip style={{ width: 12, height: 12 }} />ファイル添付</div>
                <div style={s({ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 14px", background: "#7C3AED", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 8 })}>レビュー依頼を送信</div>
              </div>
            </div>
            <div style={s({ fontSize: 9.5, color: "#9E9690" })}>※ 送信するとステータスが「レビュー中」になり、レビュアーが「承認」または「差し戻し（修正依頼）」を行います。</div>
            {/* コメント・レビュー履歴（送信後にここへ表示される旨） */}
            <div style={s({ flex: 1, minHeight: 0, borderTop: "1px dashed rgba(26,23,20,0.09)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 })}>
              <div style={s({ fontSize: 9, fontWeight: 700, color: "#B0A9A4", letterSpacing: "0.07em" })}>コメント・レビュー履歴</div>
              <div style={s({ fontSize: 10.5, color: "#B0A9A4" })}>レビュー依頼を送信すると、ここにレビュアーとのやり取りが表示されます。</div>
            </div>
          </div>
        ) : phase === "approve" ? (
          // レビュアーが承認／差し戻しする側の画面（実アプリ準拠）
          <div style={s({ flex: 1, overflow: "hidden", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 })}>
            {/* 受け取ったレビュー依頼 */}
            <div style={s({ display: "flex", gap: 9 })}>
              <span style={s({ flexShrink: 0, width: 22, height: 22, borderRadius: 11, background: "#059669", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" })}>田</span>
              <div style={s({ flex: 1 })}>
                <div style={s({ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 })}>
                  <span style={s({ fontSize: 11, fontWeight: 700, color: "#1A1714" })}>田中 太郎</span>
                  <span style={s({ fontSize: 8.5, fontWeight: 700, color: "#7C3AED", background: "#F5F3FF", borderRadius: 20, padding: "2px 8px" })}>レビュー依頼 → 鈴木 花子</span>
                </div>
                <div style={s({ borderRadius: 10, border: "1px solid rgba(26,23,20,0.08)", background: "#F9F8F6", padding: "8px 11px", fontSize: 11, color: "#6B6458", lineHeight: 1.55 })}>レスポンシブ表示を重点的に確認してください。</div>
              </div>
            </div>
            {/* レビュアーの操作（承認 / 差し戻し） */}
            <div data-spot="review" style={s({ background: "#fff", border: "1px solid rgba(124,58,237,0.22)", borderRadius: 12, padding: "12px 13px" })}>
              <div style={s({ fontSize: 9, fontWeight: 700, color: "#6B6458", letterSpacing: "0.04em", marginBottom: 7 })}>レビューコメント（任意）</div>
              <div style={s({ minHeight: 52, borderRadius: 10, border: "1px solid rgba(26,23,20,0.12)", background: "#fff", padding: "8px 10px", fontSize: 11, color: "#B0A9A4", lineHeight: 1.55 })}>指摘内容・承認コメントを入力…</div>
              <div style={s({ display: "flex", gap: 8, marginTop: 9 })}>
                <div style={s({ flex: 1, textAlign: "center", padding: "8px 0", background: "#FFF7ED", color: "#D97706", fontSize: 11, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(217,119,6,0.25)" })}>修正依頼（差戻し）</div>
                <div style={s({ flex: 1, textAlign: "center", padding: "8px 0", background: "#ECFDF5", color: "#059669", fontSize: 11, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(5,150,105,0.25)" })}>✅ レビュー承認</div>
              </div>
            </div>
            <div style={s({ fontSize: 9.5, color: "#9E9690" })}>※ 「レビュー承認」でレビュー完了、「修正依頼（差戻し）」で担当者に差し戻されます。</div>
          </div>
        ) : (
          // メタ情報
          <div data-spot="fields" style={s({ flex: 1, overflow: "hidden", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 })}>
            <div style={s({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 })}>
              <MetaCard label="ステータス">
                <div style={s({ display: "flex", alignItems: "center", gap: 5 })}>
                  <span style={s({ width: 7, height: 7, borderRadius: "50%", background: st.color })} />
                  <span style={s({ fontSize: 11, fontWeight: 600, color: st.color })}>{st.label}</span>
                </div>
              </MetaCard>
              <MetaCard label="担当者">
                <div style={s({ display: "flex", alignItems: "center", gap: 6 })}>
                  <span style={s({ width: 16, height: 16, borderRadius: 8, background: "#059669", color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" })}>田</span>
                  <span style={s({ fontSize: 11, color: "#3D3732" })}>田中 太郎</span>
                </div>
              </MetaCard>
            </div>
            <div style={s({ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 })}>
              <MetaCard label="開始日"><span style={s({ fontSize: 10.5, color: "#3D3732" })}>2026/06/01</span></MetaCard>
              <MetaCard label="終了日"><span style={s({ fontSize: 10.5, color: "#3D3732" })}>2026/06/05</span></MetaCard>
              <MetaCard label="見積(人日)"><span style={s({ fontSize: 10.5, color: "#3D3732" })}>3.0</span></MetaCard>
            </div>
            <MetaCard label="進捗率" wide>
              <div style={s({ height: 7, borderRadius: 4, background: "#EDEBE8", overflow: "hidden" })}><div style={s({ width: "60%", height: "100%", background: "#059669" })} /></div>
            </MetaCard>
            <MetaCard label="詳細" wide>
              <div style={s({ fontSize: 10, color: "#6B6458", lineHeight: 1.55 })}>一覧画面のレイアウトを作成する。@鈴木花子 デザイン確認お願いします。</div>
            </MetaCard>
            <div style={s({ display: "flex", alignItems: "center", gap: 6 })}>
              <span style={s({ fontSize: 9, fontWeight: 600, color: "#9E9690" })}>ラベル</span>
              <span style={s({ fontSize: 9, fontWeight: 700, color: "#0369A1", background: "#F0F9FF", borderRadius: 999, padding: "2px 8px" })}>UI</span>
              <div data-spot="subticket" style={s({ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 700, color: "#059669", border: "1px solid rgba(5,150,105,0.3)", borderRadius: 6, padding: "3px 9px" })}>
                <GitBranch style={{ width: 10, height: 10 }} /> 子チケット作成
              </div>
            </div>
          </div>
        )}

        {/* comment footer */}
        <div style={s({ padding: "10px 18px", borderTop: "1px solid rgba(26,23,20,0.06)", display: "flex", alignItems: "center", gap: 8 })}>
          <div style={s({ flex: 1, height: 28, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#FAFAFA", display: "flex", alignItems: "center", padding: "0 10px", fontSize: 10, color: "#B0A9A4" })}>コメントを入力…</div>
          <div style={s({ height: 28, borderRadius: 8, background: "#059669", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", padding: "0 12px", gap: 4 })}><Plus style={{ width: 11, height: 11 }} />送信</div>
        </div>
      </div>
    </AppBackdrop>
  );
}
