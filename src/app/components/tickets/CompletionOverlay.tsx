import { useEffect, useRef, useState } from "react";

const SEGMENT_LABELS = [
  "開始 → レビュー依頼",
  "レビュー依頼 → レビュー承認",
  "レビュー承認 → STG完了",
  "STG完了 → UAT完了",
  "UAT完了 → 対応完了",
];

interface Props {
  ticketTitle: string;
  initialSegmentHours: number[];
  skipAnimation?: boolean;
  onSave: (totalHours: number, segmentHours: string[]) => Promise<void>;
  onClose: () => void;
}

interface Bubble {
  id: number;
  x: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
}

function createBubbles(count: number): Bubble[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: 5 + Math.random() * 90,
    size: 10 + Math.random() * 22,
    duration: 4 + Math.random() * 3,
    delay: Math.random() * 2.5,
    opacity: 0.75 + Math.random() * 0.25,
  }));
}

function toPersonDays(h: number): string {
  if (h <= 0) return "0人日";
  const pd = Math.round(h / 8 * 10) / 10;
  return pd < 0.1 ? "0.1人日未満" : `${pd}人日`;
}

export function CompletionOverlay({ ticketTitle, initialSegmentHours, skipAnimation, onSave, onClose }: Props) {
  const [phase, setPhase] = useState<"animation" | "input">(skipAnimation ? "input" : "animation");
  const [segmentValues, setSegmentValues] = useState<string[]>(
    () => initialSegmentHours.map(h => h > 0 ? String(h) : "")
  );

  // 高速クリック対策: DB取得でマイルストーンが後から確定した場合に空欄のみ補完する。
  // ユーザーが既に入力したフィールドは上書きしない。
  useEffect(() => {
    setSegmentValues(prev => {
      const next = prev.map((v, i) => {
        const h = initialSegmentHours[i] ?? 0;
        if ((!v || parseFloat(v) <= 0) && h > 0) return String(h);
        return v;
      });
      return next.some((v, i) => v !== prev[i]) ? next : prev;
    });
  }, [initialSegmentHours]);
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const bubbles = useRef(createBubbles(24)).current;
  const firstInputRef = useRef<HTMLInputElement>(null);

  const total = segmentValues.reduce((sum, v) => {
    const n = parseFloat(v);
    return sum + (isNaN(n) || n < 0 ? 0 : n);
  }, 0);

  useEffect(() => {
    if (skipAnimation) return;
    const t = setTimeout(() => setPhase("input"), 2000);
    return () => clearTimeout(t);
  }, [skipAnimation]);

  useEffect(() => {
    if (phase === "input") setTimeout(() => firstInputRef.current?.focus(), 100);
  }, [phase]);

  const handleSave = async () => {
    if (total <= 0) {
      setError("少なくとも1つの工程に時間を入力してください");
      return;
    }
    setSaving(true);
    await onSave(Math.round(total * 100) / 100, segmentValues);
    setSaving(false);
    onClose();
  };

  const updateSegment = (i: number, v: string) => {
    setSegmentValues(prev => { const n = [...prev]; n[i] = v; return n; });
    setError("");
  };

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: phase === "animation" ? "#052E16" : "#FFFFFF",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column",
      overflow: "hidden",
      transition: "background 0.5s ease",
    }}>
      <style>{`
        @keyframes cpBubbleRise {
          0%   { transform: translateY(0) scale(0.75); opacity: 0; }
          12%  { opacity: var(--bop); }
          80%  { opacity: var(--bop); }
          100% { transform: translateY(-90vh) scale(1.05); opacity: 0; }
        }
        @keyframes cpFadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes cpInputPop {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes cpCircleDraw {
          from { stroke-dashoffset: 283; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes cpCheckDraw {
          from { stroke-dashoffset: 80; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes cpCheckIn {
          0%   { opacity: 0; transform: scale(0.6); }
          65%  { transform: scale(1.06); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* 浮かぶ泡 */}
      {phase === "animation" && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
          {bubbles.map(b => (
            <div key={b.id} style={{
              position: "absolute", bottom: -40, left: `${b.x}%`,
              width: b.size, height: b.size, borderRadius: "50%",
              background: b.size > 24
                ? `rgba(52,211,153,${b.opacity})`
                : `rgba(16,185,129,${b.opacity})`,
              border: `1.5px solid rgba(167,243,208,${b.opacity * 0.8})`,
              animation: `cpBubbleRise ${b.duration}s ${b.delay}s infinite ease-in-out`,
              ["--bop" as string]: b.opacity,
            }} />
          ))}
        </div>
      )}

      {/* アニメーションフェーズ */}
      {phase === "animation" && (
        <div style={{
          textAlign: "center", position: "relative", zIndex: 1,
          animation: "cpFadeInUp 0.6s ease both", padding: "0 32px",
        }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
            <svg viewBox="0 0 100 100" style={{ width: 160, height: 160, animation: "cpCheckIn 0.5s ease both" }}>
              <circle cx="50" cy="50" r="45" fill="rgba(52,211,153,0.12)" />
              <circle cx="50" cy="50" r="45" fill="none" stroke="#34D399" strokeWidth="5" strokeLinecap="round"
                strokeDasharray="283" strokeDashoffset="283"
                style={{ animation: "cpCircleDraw 0.9s 0.15s cubic-bezier(0.4,0,0.2,1) forwards" }} />
              <path d="M26 52 L42 68 L74 32" fill="none" stroke="#6EE7B7" strokeWidth="7"
                strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray="80" strokeDashoffset="80"
                style={{ animation: "cpCheckDraw 0.45s 1.0s ease forwards" }} />
            </svg>
          </div>
          <p style={{ color: "#D1FAE5", fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: "-0.5px" }}>
            お疲れ様でした！
          </p>
          <p style={{ color: "#6EE7B7", fontSize: 14, marginTop: 10, fontWeight: 500 }}>
            {ticketTitle}
          </p>
        </div>
      )}

      {/* 工数入力フェーズ（白背景） */}
      {phase === "input" && (
        <div style={{
          width: "min(420px, calc(100% - 32px))",
          animation: "cpInputPop 0.35s ease both",
          position: "relative", zIndex: 1,
          display: "flex", flexDirection: "column",
          maxHeight: "calc(100% - 48px)",
          overflowY: "auto",
        }}>
          {/* 小さなチェックアイコン */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <svg viewBox="0 0 100 100" style={{ width: 56, height: 56 }}>
              <circle cx="50" cy="50" r="45" fill="rgba(5,150,105,0.08)" />
              <circle cx="50" cy="50" r="45" fill="none" stroke="#059669" strokeWidth="5" strokeLinecap="round" />
              <path d="M26 52 L42 68 L74 32" fill="none" stroke="#059669" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <p style={{ fontSize: 17, fontWeight: 800, color: "#1A1714", margin: "0 0 4px", textAlign: "center" }}>
            対応工数を記録してください
          </p>
          <p style={{ fontSize: 12, color: "#9E9690", margin: "0 0 20px", textAlign: "center" }}>
            {ticketTitle}
          </p>
          <p style={{ fontSize: 11, color: "#9E9690", margin: "0 0 12px" }}>
            各工程の実際の時間を入力してください（時間単位）
          </p>

          {/* 工程別入力 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {SEGMENT_LABELS.map((label, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, fontSize: 12, color: "#4B4744", fontWeight: 500 }}>{label}</span>
                <input
                  ref={i === 0 ? firstInputRef : undefined}
                  type="number"
                  min="0"
                  step="0.5"
                  value={segmentValues[i]}
                  onChange={e => updateSegment(i, e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
                  placeholder="0"
                  style={{
                    width: 72, padding: "6px 8px", fontSize: 14, fontWeight: 700,
                    border: "1.5px solid rgba(26,23,20,0.15)",
                    borderRadius: 8, outline: "none", color: "#1A1714",
                    textAlign: "right" as const, flexShrink: 0,
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = "#059669"; e.currentTarget.style.boxShadow = "0 0 0 2px rgba(5,150,105,0.12)"; }}
                  onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.15)"; e.currentTarget.style.boxShadow = "none"; }}
                />
                <span style={{ fontSize: 12, color: "#6B6458", width: 18, flexShrink: 0 }}>h</span>
              </div>
            ))}
          </div>

          {/* 合計 */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            borderTop: "1.5px solid rgba(26,23,20,0.08)", paddingTop: 12, marginBottom: 4,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#3D3732" }}>合計</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#059669" }}>
              {Math.round(total * 100) / 100}h（{toPersonDays(total)}）
            </span>
          </div>
          {error && <p style={{ fontSize: 12, color: "#EF4444", margin: "0 0 8px", fontWeight: 600 }}>{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              width: "100%", padding: "12px 0", marginTop: 12,
              fontSize: 14, fontWeight: 700, borderRadius: 11,
              border: "none", cursor: saving ? "not-allowed" : "pointer",
              background: saving ? "rgba(5,150,105,0.25)" : "#059669",
              color: saving ? "#059669" : "#FFFFFF",
              boxShadow: saving ? "none" : "0 4px 14px rgba(5,150,105,0.30)",
              transition: "all 0.15s",
            }}>
            {saving ? "保存中..." : "完了する"}
          </button>

          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#B0A9A4", fontSize: 13, textDecoration: "underline",
              marginTop: 14, textAlign: "center" as const, padding: "4px 0",
            }}>
            チケット詳細に戻る
          </button>
        </div>
      )}
    </div>
  );
}