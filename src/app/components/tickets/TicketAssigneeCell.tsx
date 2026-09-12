// 一覧の担当者セル。
//
// 途中で担当を引き継いだチケットは、関わった人を古い順に「A / B / C」と全員出す。
// 現在の担当（いちばん右）だけ濃く出して、過去の担当は薄くする。
// 「いま誰が持っているか」を一目で保ったまま、履歴も同じ場所で読めるようにするため。
//
// 列幅は狭いので、あふれたら省略＋ホバーで全文ツールチップ（TruncatedText に寄せる）。

import { Avatar } from "@/app/components/shared/Avatar";
import { TruncatedText } from "@/app/components/shared/TruncatedText";

export function TicketAssigneeCell({
  assignee,
  history,
  fontSize = 11,
}: {
  /** 現在の担当（sprint_tickets.assignee） */
  assignee: string;
  /** 引き継いだ順の担当者名。引継ぎが無いチケットでは undefined */
  history?: string[];
  fontSize?: number;
}) {
  // 履歴に現担当が入っていないことがある（区間を作る前の割り当て解除→再アサインなど）。
  // 一覧の見た目としては「今の担当が末尾」が正なので、足りなければ足す
  const names = history && history.length > 1
    ? (assignee && history[history.length - 1] !== assignee ? [...history, assignee] : history)
    : null;

  if (!names) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
        <Avatar name={assignee} size="xs" />
        <span style={{ fontSize, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {assignee || "—"}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
      {/* アバターは現担当のもの。行をざっと眺めたときの「持ち主」が変わらないようにする */}
      <Avatar name={names[names.length - 1]} size="xs" />
      {/* ツールチップは TruncatedText が出すので title 属性は付けない。
          付けるとブラウザ標準のツールチップと2枚重なって出る */}
      <TruncatedText
        text={`担当の引継ぎ: ${names.join(" → ")}`}
        style={{ fontSize, color: "#6B6458", minWidth: 0 }}
      >
        {names.map((n, i) => {
          const isCurrent = i === names.length - 1;
          return (
            <span key={`${n}-${i}`}>
              {i > 0 && <span style={{ color: "#D5D0CB", margin: "0 3px" }}>/</span>}
              <span style={{ color: isCurrent ? "#6B6458" : "#B0A9A4", fontWeight: isCurrent ? 600 : 400 }}>{n}</span>
            </span>
          );
        })}
      </TruncatedText>
    </div>
  );
}
