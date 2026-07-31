// ENHA2-034 学習機能のお知らせ & スキル確認の誘導
//
// ★表示対象は「メンバー管理」権限(canAccessMembers)を持つ人だけ★
//   一般の開発者には、学習のお知らせもスキル確認の誘導も一切出さない。
//   呼び出し側(MembersPage)で権限を判定してからマウントすること。

import { useState } from "react";
import { Sparkles, X, ArrowRight, CheckCircle2 } from "lucide-react";

/** 学習完了のお知らせ。左下に「次回以降表示しない」チェック。 */
export function MlNoticeModal({ onClose }: {
  onClose: (dontShowAgain: boolean) => void;
}) {
  const [dontShow, setDontShow] = useState(false);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400, padding: 20 }}>
      <div style={{ background: "#FFFFFF", borderRadius: 18, width: 480, maxWidth: "100%", overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,0,0.3)" }}>

        <div style={{ background: "linear-gradient(135deg, #065F46 0%, #059669 100%)", padding: "26px 26px 22px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -30, right: -20, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
          <div style={{ width: 44, height: 44, borderRadius: 13, background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
            <Sparkles style={{ width: 22, height: 22, color: "#FFFFFF" }} />
          </div>
          <h2 style={{ fontSize: 19, fontWeight: 800, color: "#FFFFFF", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em", position: "relative" }}>
            学習機能が搭載されました
          </h2>
        </div>

        <div style={{ padding: "22px 26px" }}>
          <p style={{ fontSize: 13, color: "#4B4740", lineHeight: 1.75 }}>
            過去のチケット実績をもとに、システムがメンバーのスキルと得意分野を学習しました。
          </p>

          <div style={{ margin: "16px 0", padding: "14px 16px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 11 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#047857", marginBottom: 8 }}>
              この学習データを利用することで
            </p>
            {[
              "チケットの担当者を自動でレコメンド",
              "スプリント計画での一括アサイン提案",
            ].map(t => (
              <p key={t} style={{ fontSize: 12.5, color: "#065F46", display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                <CheckCircle2 style={{ width: 13, height: 13, flexShrink: 0 }} />{t}
              </p>
            ))}
            <p style={{ fontSize: 12, color: "#047857", marginTop: 8 }}>などが使えるようになります。</p>
          </div>

          <p style={{ fontSize: 12.5, color: "#6B6458", lineHeight: 1.7 }}>
            学習は<strong style={{ color: "#1A1714" }}>毎日深夜3時に自動で実行</strong>されます。
            <br />この間も画面は通常どおり操作いただけます。
          </p>
        </div>

        <div style={{ padding: "14px 26px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid rgba(26,23,20,0.07)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "#6B6458", cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={dontShow} onChange={e => setDontShow(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: "#059669", cursor: "pointer" }} />
            次回以降このお知らせを表示しない
          </label>
          <button onClick={() => onClose(dontShow)}
            style={{ padding: "9px 20px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "none", background: "#059669", color: "#fff", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)" }}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * スキル確認の誘導（初回のみ）。
 * お知らせモーダルを閉じた直後に出し、メンバー管理画面での確認を促す。
 */
export function SkillReviewPromptDialog({ examples, onLater, onReview }: {
  examples: string[];   // 「田中さん: React Lv4 / TypeScript Lv4」など
  onLater: () => void;
  onReview: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400, padding: 20 }}>
      <div style={{ background: "#FFFFFF", borderRadius: 16, width: 460, maxWidth: "100%", boxShadow: "0 24px 70px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "22px 24px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "#ECFDF5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <CheckCircle2 style={{ width: 18, height: 18, color: "#059669" }} />
            </div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>
              メンバーのスキルを自動登録しました
            </h2>
          </div>
          <button onClick={onLater} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 2 }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        <div style={{ padding: "14px 24px 20px" }}>
          <p style={{ fontSize: 12.5, color: "#6B6458", lineHeight: 1.7 }}>
            過去の実績データから、各メンバーのスキルを推定して登録しています。
            <br />内容に誤りがないかご確認ください。
          </p>

          {examples.length > 0 && (
            <div style={{ marginTop: 12, padding: "12px 14px", background: "#FAFAFA", borderRadius: 10, border: "1px solid rgba(26,23,20,0.06)" }}>
              {examples.slice(0, 3).map(e => (
                <p key={e} style={{ fontSize: 11.5, color: "#4B4740", lineHeight: 1.9 }}>例）{e}</p>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: "0 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onLater}
            style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", color: "#6B6458", cursor: "pointer" }}>
            後で
          </button>
          <button onClick={onReview}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "none", background: "#059669", color: "#fff", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)" }}>
            メンバー管理を確認する
            <ArrowRight style={{ width: 13, height: 13 }} />
          </button>
        </div>
      </div>
    </div>
  );
}
