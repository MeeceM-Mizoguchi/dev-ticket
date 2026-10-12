// ENHA2-053 WBS画面の上部の集計。
//
// 左から「全体進捗率／総タスク数／遅延」を常に表示し、その右にステータスごとの件数を並べる。
// 右端（ガントの上）には「最大並行タスク数／負荷状況／総稼働日数」を出す。
// 件数は保存せず、表と同じ行のデータから計算する。数えるのは一番右の段の行だけ。
// ステータスの名前は自由に変わるので、集計をステータスの名前に頼らない（id で数える）。
//
// 開閉ボタンは「入りきらないとき」だけ出す。右側にまだ余白があるなら閉じる理由が無いので
// ボタン自体を出さない（ENHA2-053 の指摘）。入るかどうかは実際の幅を測って決める。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { WbsGanttModel, WbsRow } from "@/app/lib/wbsCalc";
import type { WbsStatus } from "@/app/types";
import { WBS_COLORS } from "./wbsStyles";

// 集計タイルの間隔。開閉ボタンを出したときに何px持っていかれるかの計算にも使う
const GAP = 8;

function Tile({ label, children, minWidth }: { label: string; children: ReactNode; minWidth?: number }) {
  return (
    <div style={{ flexShrink: 0, minWidth, padding: "6px 14px", background: WBS_COLORS.stripeBg, borderRadius: 8 }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: WBS_COLORS.subText, whiteSpace: "nowrap" }}>{label}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, whiteSpace: "nowrap" }}>{children}</div>
    </div>
  );
}

const valueStyle = { fontSize: 18, fontWeight: 800, lineHeight: 1.2, fontFamily: "var(--font-heading)" } as const;

export function WbsSummary({ rows, statuses, gantt }: { rows: WbsRow[]; statuses: WbsStatus[]; gantt: WbsGanttModel }) {
  const [open, setOpen] = useState(true);
  // 入りきらないかどうか。開いているときに実測して決める
  const [overflowing, setOverflowing] = useState(false);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const stats = useMemo(() => {
    const leaves = rows.filter(r => r.isLeafLevel);
    const total = leaves.length;
    const progress = total ? Math.round(leaves.reduce((a, r) => a + r.item.progress, 0) / total) : 0;
    const delayed = leaves.filter(r => r.delayed).length;
    const firstId = statuses[0]?.id ?? null;
    const known = new Set(statuses.map(s => s.id));
    const counts = new Map<string, number>();
    for (const r of leaves) {
      // status_id が空・消えたステータスを指している行は、先頭のステータスとして数える（表の表示と同じ）
      const id = r.item.statusId && known.has(r.item.statusId) ? r.item.statusId : firstId;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return { total, progress, delayed, counts };
  }, [rows, statuses]);

  // 閉じているときは中身が無いので測れない。開いているときだけ測り、閉じている間は
  // 直前の判定を保つ（でないと開き直すボタンごと消えてしまう）。
  const measure = () => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    // ボタンを出していると、その分だけ件数の置き場が狭くなる。判定がボタンの有無で
    // ひっくり返らないよう、「ボタンが無かったときの幅」に戻して比べる。
    const button = buttonRef.current;
    const reclaimed = button ? button.offsetWidth + GAP : 0;
    setOverflowing(content.offsetWidth > scroller.clientWidth + reclaimed + 1);
  };

  // ステータスの増減・名前の変更で中身の幅が変わるので、描画のたびに測り直す
  useLayoutEffect(measure);

  // 画面幅やパネル幅が変わったときにも測り直す
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(scroller);
    ro.observe(content);
    return () => ro.disconnect();
  }, [open]);

  // 入りきるようになったら開いた状態に戻す（閉じたままだとボタンが消えて開けなくなる）
  useEffect(() => {
    if (!overflowing && !open) setOpen(true);
  }, [overflowing, open]);

  const showToggle = overflowing || !open;

  return (
    <div style={{ flexShrink: 0, display: "flex", alignItems: "stretch", gap: GAP, padding: "8px 10px", borderBottom: `1px solid ${WBS_COLORS.border}` }}>
      <Tile label="全体進捗率" minWidth={170}>
        <span style={{ ...valueStyle, color: WBS_COLORS.headBg }}>{stats.progress}%</span>
        <span style={{ flex: 1, minWidth: 80, height: 8, borderRadius: 4, background: "#E2E6EC", overflow: "hidden" }}>
          <span style={{ display: "block", width: `${stats.progress}%`, height: "100%", background: WBS_COLORS.headBg, borderRadius: 4, transition: "width 0.3s" }} />
        </span>
      </Tile>
      <Tile label="総タスク数"><span style={{ ...valueStyle, color: WBS_COLORS.text }}>{stats.total}</span></Tile>
      <Tile label="遅延"><span style={{ ...valueStyle, color: stats.delayed > 0 ? "#DC2525" : WBS_COLORS.text }}>{stats.delayed}</span></Tile>

      {/* ステータスごとの件数。入りきらないときだけ開閉ボタンを出す */}
      {showToggle && (
        <button type="button" ref={buttonRef} onClick={() => setOpen(o => !o)}
          title={open ? "ステータスごとの件数を閉じる" : "ステータスごとの件数を開く"}
          aria-label={open ? "ステータスごとの件数を閉じる" : "ステータスごとの件数を開く"}
          aria-expanded={open}
          style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 2, padding: "0 6px", fontSize: 11, fontWeight: 700, color: WBS_COLORS.subText, background: "#FFFFFF", border: `1px solid ${WBS_COLORS.border}`, borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
          {open ? <ChevronLeft style={{ width: 13, height: 13 }} /> : <>ステータス別<ChevronRight style={{ width: 13, height: 13 }} /></>}
        </button>
      )}
      {open && (
        // 入りきらないときは、この部分だけ横にスクロールする
        <div ref={scrollerRef} style={{ flex: 1, minWidth: 0, overflowX: "auto", overflowY: "hidden" }}>
          <div ref={contentRef} style={{ display: "flex", gap: GAP, width: "max-content" }}>
            {statuses.map(s => (
              <Tile key={s.id} label={s.name}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, border: "1px solid rgba(26,23,20,0.12)", flexShrink: 0 }} />
                <span style={{ ...valueStyle, color: WBS_COLORS.text }}>{stats.counts.get(s.id) ?? 0}</span>
              </Tile>
            ))}
          </div>
        </div>
      )}

      {/* ガントの集計。件数の部分を閉じているときも右端に寄せる */}
      {!open && <div style={{ flex: 1 }} />}
      <Tile label="最大並行タスク数"><span style={{ ...valueStyle, fontSize: 15, color: WBS_COLORS.text }}>{gantt.maxConcurrent} タスク</span></Tile>
      <Tile label="負荷状況">
        <span style={{ ...valueStyle, fontSize: 13, color: gantt.maxConcurrent >= 3 ? "#DC2525" : WBS_COLORS.text }}>{gantt.loadLabel}</span>
      </Tile>
      <Tile label="総稼働日数"><span style={{ ...valueStyle, fontSize: 15, color: WBS_COLORS.text }}>{gantt.workingDays} 日</span></Tile>
    </div>
  );
}
