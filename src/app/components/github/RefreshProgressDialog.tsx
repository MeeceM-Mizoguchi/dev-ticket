// GitHubタブの「更新」を押したあとに出す進捗画面。
//
// これまで押しても変わるのはボタンの文字（更新中...）だけで、GitHub の応答が返るまでの
// 数秒間は画面が止まったままだった。なので真ん中に大きなリングを1つ出して、進んでいることを見せる。
//
// 以前は工程（一覧／ブランチ／本番反映）ごとに行とリングを並べていたが、更新ボタンで
// そこまで細かく見せる必要はないので、1つのリングにまとめた。
// ％は「終わった工程の割合」と「経過時間から作った目安」の大きい方。GitHub の応答は
// 「終わったか」しか返さないので実測値ではない。94%で頭打ちにして、全体が終わった時点で100%にする。
//
// 閉じても取得そのものは止まらない。結果は閉じたあとの一覧に反映される。
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";

/** 進捗の工程。GithubPage 側の取得処理が、終わった順にこのキーを報告する */
export type RefreshStepKey = "list" | "extra" | "deploy";
export type RefreshTab = "pulls" | "issues" | "commits" | "branches";
export type RefreshProgressState = "running" | "done" | "error";

/** タブごとに走る工程の数（％の下限を出すのに使う） */
const STEP_COUNT: Record<RefreshTab, number> = {
  pulls: 3,     // 一覧・PRが無いブランチ・本番反映
  issues: 2,    // 一覧・本番反映
  commits: 2,   // 履歴・本番反映
  branches: 3,  // 一覧・チケットとの紐付け・本番反映
};

const GREEN = "#059669";
const AMBER = "#B45309";
const TRACK = "#E7E3DC";

/** リングの直径と線の太さ */
const SIZE = 148;
const SW = 10;

/** 経過時間から作る目安の％。2.2秒でだいたい6割まで進み、あとは詰まっていく */
function useCreepingPercent(running: boolean) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    setPct(3);
    const id = window.setInterval(() => {
      const t = (Date.now() - started) / 1000;
      setPct(Math.min(94, Math.round(94 * (1 - Math.exp(-t / 2.2)))));
    }, 90);
    return () => window.clearInterval(id);
  }, [running]);
  return pct;
}

export function RefreshProgressDialog({ tab, done, state, message, onClose }: {
  tab: RefreshTab;
  /** 完了した工程のキー */
  done: RefreshStepKey[];
  state: RefreshProgressState;
  /** 失敗したときの理由。取得側が拾ったものをそのまま出す */
  message?: string;
  onClose: () => void;
}) {
  const running = state === "running";
  const failed = state === "error";
  const creeping = useCreepingPercent(running);
  const floor = Math.min(94, Math.round((done.length / STEP_COUNT[tab]) * 100));
  const pct = state === "done" ? 100 : Math.max(creeping, floor);
  const color = failed ? AMBER : GREEN;

  const R = (SIZE - SW) / 2;
  const C = 2 * Math.PI * R;
  const mid = SIZE / 2;

  return (
    <DialogShell
      title={running ? "最新の情報に更新しています"
        : failed ? "更新できませんでした"
          : "最新の情報に更新しました"}
      minHeight={0}
      onClose={onClose}
      footer={<BtnSecondary onClick={onClose}>閉じる</BtnSecondary>}>
      <style>{`@keyframes rp-glint { to { transform: rotate(360deg); } }`}</style>
      <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 18, padding: "12px 0 4px" }}>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
          style={{ position: "relative", width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ display: "block", transform: "rotate(-90deg)" }}>
            <circle cx={mid} cy={mid} r={R} fill="none" stroke={TRACK} strokeWidth={SW} />
            <circle cx={mid} cy={mid} r={R} fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)}
              style={{ transition: "stroke-dashoffset .45s ease, stroke .3s ease" }} />
            {/* 実行中だけ、輪の上を小さな光が回る。％が詰まって動きが小さくなっても止まって見えないように */}
            {running && (
              <g style={{ transformOrigin: "50% 50%", animation: "rp-glint 1.4s linear infinite" }}>
                <circle cx={mid} cy={mid} r={R} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={SW - 4}
                  strokeLinecap="round" strokeDasharray={`10 ${C}`} />
              </g>
            )}
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center" }}>
            {state === "done" ? (
              <Check style={{ width: 52, height: 52, color: GREEN }} strokeWidth={3} />
            ) : failed ? (
              <span style={{ fontSize: 44, fontWeight: 800, color: AMBER, lineHeight: 1 }}>!</span>
            ) : (
              <>
                <span style={{ fontSize: 34, fontWeight: 800, color: "#1A1714", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                  {pct}<small style={{ fontSize: 16, marginLeft: 1 }}>%</small>
                </span>
                <span style={{ fontSize: 12, color: "#A09790", marginTop: 6 }}>更新中</span>
              </>
            )}
          </div>
        </div>

        <p style={{ fontSize: 14, color: failed ? AMBER : "#1A1714", lineHeight: 1.8, textAlign: "center" as const }}>
          {running ? "GitHubから最新の状態を取り直しています。"
            : failed
              ? (message || "GitHubの情報を取得できませんでした。少し時間をおいて、もう一度お試しください。")
              : "画面はいま取得した内容に切り替わっています。"}
        </p>
        {running && (
          <p style={{ fontSize: 12, color: "#A09790", lineHeight: 1.7, textAlign: "center" as const, marginTop: -10 }}>
            取得が終わると、この画面は自動で閉じます。閉じても取得は続きます。
          </p>
        )}
      </div>
    </DialogShell>
  );
}
