// 実績入力の「担当者別」欄。
//
// 対応完了時の工数入力（CompletionOverlay）と、実績モニタの「実績を修正する」から使う。
// チケットの途中で担当が替わったとき、工程別の合計だけでは「誰がどれだけやったか」が
// 残らない。ここで各担当の取り分を直接入れられるようにする。
//
// 【設計】合計は常に工程別の合計（＝チケットの実績）に一致させる。
//   誰かの値を直すと、その差分を「他の担当」が自動で吸収する。
//   こうすると入力途中でも合計がズレず、「合計が合っていません」というエラー状態が存在しない。
//   担当が2人の引継ぎ（いちばん多いケース）では、片方を入れればもう片方が自動で決まる。
//
// 担当が1人しかいないチケットでは何も描画しない（分ける相手がいないので）。

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/app/components/shared/Avatar";
import { formatPersonDays } from "@/app/lib/helpers";
import { fetchMilestones } from "@/app/hooks/useProject";
import {
  fetchAssignmentSegments, splitActualHours,
  type AssignmentSegment, type TicketTimestamps,
} from "@/app/lib/handover";
import type { HoldCommentLike } from "@/app/lib/holdHours";

const NO_MILESTONES: TicketTimestamps = {
  startedAt: null, reviewRequestedAt: null, reviewApprovedAt: null,
  stgCompletedAt: null, uatCompletedAt: null, releasedAt: null,
};

export interface AssigneeHoursState {
  /** 表示順（区間の古い順）の担当者名 */
  names: string[];
  /** 担当者 → 取り分（時間） */
  hours: Map<string, number>;
  /** 保存時に区間へ書き戻すための元データ */
  segments: AssignmentSegment[];
  /** 保存時の按分計算に使う、DBから読み直したマイルストーン */
  ticket: TicketTimestamps;
}

export function AssigneeHoursFields({
  ticketId,
  comments,
  currentAssignee,
  total,
  disabled,
  onChange,
}: {
  ticketId: string;
  /** 保留時間を按分の重みから外すためのコメント（status_change を含むもの） */
  comments: HoldCommentLike[];
  currentAssignee: string;
  /** 工程別入力の合計（時間）。ここが動くと各担当の取り分も比率を保ったまま追随する */
  total: number;
  disabled?: boolean;
  /** 入力が変わるたびに呼ばれる。担当が1人以下のときは null */
  onChange: (state: AssigneeHoursState | null) => void;
}) {
  const [segments, setSegments] = useState<AssignmentSegment[] | null>(null);
  // ★ マイルストーンは必ずDBから読み直す ★
  //   呼び出し側が持っているチケットオブジェクトは、パネル内でステータスを進めても
  //   更新されない（reloadTicketFields はフィールドの state しか直さない）。
  //   古い日時で按分すると各担当の取り分がまるごと狂うので、ここで取り直す。
  const [ticket, setTicket] = useState<TicketTimestamps>(NO_MILESTONES);
  // 取り分は「時間」ではなく「比率」で持つ。工程別の合計を直したときに、
  // 入力済みの配分を保ったまま各担当の時間だけスライドさせるため。
  const [ratios, setRatios] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let alive = true;
    Promise.all([fetchAssignmentSegments(ticketId), fetchMilestones(ticketId)]).then(([segs, ms]) => {
      if (!alive) return;
      setTicket(ms ?? NO_MILESTONES);
      setSegments(segs);   // segments が入った時点で描画されるので、必ず最後に入れる
    });
    return () => { alive = false; };
  }, [ticketId]);

  const names = useMemo(() => {
    if (!segments) return [];
    const seen: string[] = [];
    for (const s of segments) if (s.assignee && !seen.includes(s.assignee)) seen.push(s.assignee);
    return seen;
  }, [segments]);

  // 初期比率は自動按分（担当していた期間の稼働時間ベース）から作る
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!segments || names.length < 2 || initializedRef.current) return;
    initializedRef.current = true;
    // 比率を出すだけなので、合計が 0 でも割れるよう 1 を基準に按分させる
    const base = total > 0 ? total : 1;
    const shares = splitActualHours(base, segments, ticket, comments, currentAssignee);
    const next = new Map<string, number>();
    for (const n of names) {
      const h = shares.find(s => s.assignee === n)?.hours ?? 0;
      next.set(n, base > 0 ? h / base : 0);
    }
    // 端数で合計が 1 からズレることがあるので正規化する
    const sum = [...next.values()].reduce((a, b) => a + b, 0);
    if (sum > 0) for (const [k, v] of next) next.set(k, v / sum);
    else for (const n of names) next.set(n, 1 / names.length);
    setRatios(next);
  }, [segments, names, ticket, comments, currentAssignee, total]);

  const hours = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of names) m.set(n, Math.round((ratios.get(n) ?? 0) * total * 100) / 100);
    return m;
  }, [names, ratios, total]);

  // 親へ通知。names/hours が変わったときだけ
  useEffect(() => {
    if (!segments || names.length < 2) { onChange(null); return; }
    onChange({ names, hours, segments, ticket });
    // onChange を依存に入れると親の再レンダーごとに走るので意図的に外す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, names, hours, ticket]);

  if (!segments || names.length < 2) return null;

  /**
   * 1人ぶんを直す。差分は「その人以外」が今の比率のまま吸収する。
   * 全員が0で吸収できないときは等分に配る。
   */
  const setHoursFor = (name: string, raw: string) => {
    const parsed = Number(raw);
    const value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    if (total <= 0) return;
    const mine = Math.min(value, total) / total;
    const rest = Math.max(0, 1 - mine);
    const others = names.filter(n => n !== name);
    const otherSum = others.reduce((a, n) => a + (ratios.get(n) ?? 0), 0);
    const next = new Map<string, number>();
    next.set(name, mine);
    for (const n of others) {
      next.set(n, otherSum > 0 ? ((ratios.get(n) ?? 0) / otherSum) * rest : rest / others.length);
    }
    setRatios(next);
  };

  // 区切り線はこの中に持つ。呼び出し側で囲むと、担当が1人のチケットで
  // 中身が空のまま線だけ残ってしまう
  return (
    <div style={{ marginBottom: 16, borderTop: "1.5px solid rgba(26,23,20,0.08)", paddingTop: 14 }}>
      <p style={{ fontSize: 11, color: "#9E9690", margin: "0 0 4px" }}>
        担当者別の実績（このチケットは途中で担当が替わっています）
      </p>
      <p style={{ fontSize: 10.5, color: "#B0A9A4", margin: "0 0 10px", lineHeight: 1.6 }}>
        担当していた期間から自動で割った値です。1人ぶんを直すと、残りが他の担当へ自動で振り分けられます。
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {names.map(name => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Avatar name={name} size="xs" />
            <span style={{ flex: 1, fontSize: 12, color: "#4B4744", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
              {name === currentAssignee && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: "#059669", background: "#ECFDF5", padding: "1px 6px", borderRadius: 20 }}>現担当</span>}
            </span>
            <span style={{ fontSize: 10.5, color: "#9E9690", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
              {formatPersonDays(hours.get(name) ?? 0)}
            </span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={String(hours.get(name) ?? 0)}
              onChange={e => setHoursFor(name, e.target.value)}
              disabled={disabled || total <= 0}
              style={{
                width: 72, padding: "6px 8px", fontSize: 14, fontWeight: 700,
                border: "1.5px solid rgba(26,23,20,0.15)", borderRadius: 8, outline: "none",
                color: "#1A1714", background: "#FFFFFF", textAlign: "right", flexShrink: 0,
              }}
              onFocus={e => { e.currentTarget.style.borderColor = "#059669"; e.currentTarget.style.boxShadow = "0 0 0 2px rgba(5,150,105,0.12)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.15)"; e.currentTarget.style.boxShadow = "none"; }}
            />
            <span style={{ fontSize: 12, color: "#6B6458", width: 18, flexShrink: 0 }}>h</span>
          </div>
        ))}
      </div>
    </div>
  );
}
