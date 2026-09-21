// 新しいバージョンのデプロイを検知してから、新しい画面に切り替わり終わるまでの全画面プログレス。
// 進捗は useVersionCheck のストアから購読する。アプリ最上位(App.tsx)に1つだけマウントする。
//
// 見た目の CSS は index.html にある（.vu-*）。リロード直後、JS が届く前に出す起動用オーバーレイ
// (#vu-boot)と共用し、React が起動したらこちらに継ぎ目なく差し替えるため。
// 工程名・構造を変えるときは index.html 側も揃えること。
import { useLayoutEffect } from "react";
import { useAppUpdateState, reloadNow, dismissUpdate, STARTED_FROM_RELOAD, type UpdatePhase } from "@/app/hooks/useVersionCheck";

const STEPS = [
  "新しいバージョンを検知",
  "サーバーへの公開を待機",
  "古いキャッシュを整理",
  "新しい画面を読み込み",
  "データを読み込み直して仕上げ",
] as const;

// 各工程のうち、いま進めているもの（これより前は完了）
const ACTIVE_STEP: Record<UpdatePhase, number> = {
  idle: -1, waiting: 1, preparing: 2, reloading: 3, finishing: 4, done: STEPS.length, failed: -1,
};

const SUBTEXT: Record<UpdatePhase, string> = {
  idle: "",
  waiting: "サーバーで新しいバージョンの公開作業が進んでいます",
  preparing: "古い画面のデータを片付けています",
  reloading: "新しい画面を読み込んでいます",
  finishing: "最新のデータを読み込んでいます",
  done: "最新のバージョンでご利用いただけます",
  failed: "",
};

const R = 66;
const C = 2 * Math.PI * R;

export function AppUpdateOverlay() {
  const s = useAppUpdateState();

  // React 側が描画されたら、index.html の起動用オーバーレイを外す（同じ見た目なので継ぎ目は出ない）
  useLayoutEffect(() => {
    document.getElementById("vu-boot")?.remove();
  }, []);

  if (s.phase === "idle") return null;

  // 起動用オーバーレイから引き継いだときは出現アニメを付けない（二重に「出てくる」のを防ぐ）
  const staticCls = STARTED_FROM_RELOAD && s.phase !== "failed" ? " vu-static" : "";

  if (s.phase === "failed") {
    return (
      <div className={`vu-backdrop${staticCls}`} role="alertdialog" aria-modal="true" aria-labelledby="vu-failed-title">
        <div className="vu-card">
          <div className="vu-failed-icon" aria-hidden="true">!</div>
          <p className="vu-title" id="vu-failed-title">更新を完了できませんでした</p>
          <p className="vu-sub">
            新しい画面の配信が遅れているようです。<br />
            少し時間をおいて、もう一度読み込んでください。
          </p>
          {s.version && <span className="vu-ver">{s.version}</span>}
          <div className="vu-actions">
            <button type="button" className="vu-btn" onClick={dismissUpdate}>このまま使う</button>
            <button type="button" className="vu-btn vu-btn-primary" onClick={() => { void reloadNow(); }}>再読み込みする</button>
          </div>
        </div>
      </div>
    );
  }

  const done = s.phase === "done";
  const pct = Math.min(100, Math.floor(s.progress));
  const active = ACTIVE_STEP[s.phase];

  return (
    <div className={`vu-backdrop${staticCls}`} role="alertdialog" aria-modal="true" aria-busy={!done} aria-labelledby="vu-title">
      <div className="vu-card">
        <div className="vu-ring" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <svg viewBox="0 0 156 156">
            <defs>
              <linearGradient id="vu-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#059669" />
                <stop offset="1" stopColor="#34D399" />
              </linearGradient>
            </defs>
            <circle className="vu-ring-track" cx="78" cy="78" r={R} />
            <circle
              className="vu-ring-bar" cx="78" cy="78" r={R} stroke="url(#vu-grad)"
              strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)}
            />
            {!done && (
              <g className="vu-ring-glint">
                <circle cx="78" cy="78" r={R} strokeDasharray={`14 ${C}`} />
              </g>
            )}
          </svg>
          <div className="vu-ring-center">
            {done ? (
              <div className="vu-check" aria-hidden="true" />
            ) : (
              <>
                <div className="vu-pct">{pct}<small>%</small></div>
                <div className="vu-pct-label">更新中</div>
              </>
            )}
          </div>
        </div>

        <p className="vu-title" id="vu-title">{done ? "更新が完了しました" : "新しいバージョンに更新しています"}</p>
        <p className="vu-sub">{s.note ?? SUBTEXT[s.phase]}</p>
        {s.version && <span className="vu-ver">{s.version}</span>}

        <ul className="vu-steps">
          {STEPS.map((label, i) => {
            const st = i < active ? "done" : i === active ? "active" : "todo";
            return (
              <li key={label} className="vu-step" data-s={st}>
                <span className="vu-dot" />
                <span>{label}</span>
                {st === "active" && <span className="vu-step-tag">処理中</span>}
              </li>
            );
          })}
        </ul>

        {!done && (
          <p className="vu-note">
            <strong>画面を閉じずにそのままお待ちください。</strong><br />
            完了すると自動で新しい画面に切り替わります。
          </p>
        )}
      </div>
    </div>
  );
}
