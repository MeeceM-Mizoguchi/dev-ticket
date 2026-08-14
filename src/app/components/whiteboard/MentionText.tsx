// ホワイトボードのコメント本文（ENHA2-039）を、メンションだけ色付きで描く。
//
// チケットのコメントは RichEditor（tiptap）の mention ノードなので描画側で勝手に色が付くが、
// ホワイトボードのコメントは素の textarea ＝ ただの文字列なので、表示のときに
// 「@メンバー名」を拾って着色してやらないと、送った側にも受け取った側にも
// メンションが成立したのかどうか分からない（通知だけ飛んで見た目は素のまま）。
//
// 色は RichEditor の .mention（緑）に合わせる。自分宛てだけは琥珀にして目立たせる。
import { useMemo } from "react";
import { splitMentions } from "@/app/lib/whiteboardComments";

const chipBase: React.CSSProperties = {
  fontWeight: 700, padding: "1px 4px", borderRadius: 4,
};
const chipOther: React.CSSProperties = { ...chipBase, color: "#059669", background: "#ECFDF5" };
const chipSelf: React.CSSProperties = { ...chipBase, color: "#B45309", background: "#FEF3C7" };

/**
 * 親の style（fontSize / whiteSpace: pre-wrap など）はそのまま活かしたいので、
 * ラッパーは作らずフラグメントだけを返す。
 */
export function MentionText({ text, members, selfName }: {
  text: string;
  members: string[];
  /** 自分の表示名。自分宛てのメンションだけ色を変える */
  selfName?: string;
}) {
  const parts = useMemo(() => splitMentions(text, members), [text, members]);
  return (
    <>
      {parts.map((p, i) => (p.mention
        ? <span key={i} style={p.mention === selfName ? chipSelf : chipOther}>{p.text}</span>
        : <span key={i}>{p.text}</span>
      ))}
    </>
  );
}

/**
 * 入力中（textarea）の背後に敷く下地。textarea は文字ごとの装飾ができないので、
 * 同じ文字を透明で並べて「メンションの位置に背景色だけ」を置き、その上に
 * 背景を透かした textarea を重ねる（＝文字は textarea が、色は下地が描く）。
 *
 * ズレると目も当てられないので、下地側の装飾は**文字幅を1pxも変えないもの限定**にする。
 * ＝ padding も font-weight も使わず、背景の広がりは box-shadow で外側に描く。
 */
export function MentionBackdrop({ text, members, selfName, style, innerRef }: {
  text: string;
  members: string[];
  selfName?: string;
  style: React.CSSProperties;
  /** textarea のスクロールに追従させるため */
  innerRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const parts = useMemo(() => splitMentions(text, members), [text, members]);
  return (
    <div ref={innerRef} aria-hidden style={{ ...style, color: "transparent", overflow: "hidden", pointerEvents: "none" }}>
      {parts.map((p, i) => (p.mention
        ? (
          <span key={i} style={{
            borderRadius: 3,
            background: p.mention === selfName ? "#FEF3C7" : "#ECFDF5",
            boxShadow: `0 0 0 2px ${p.mention === selfName ? "#FEF3C7" : "#ECFDF5"}`,
          }}>{p.text}</span>
        )
        : <span key={i}>{p.text}</span>
      ))}
      {/* 末尾が改行のときに下地の高さが1行足りなくなるのを防ぐ */}
      {"​"}
    </div>
  );
}
