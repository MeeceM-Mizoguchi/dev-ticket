// ENHA2-053 WBSマニュアルの中身（項目ごとの説明と、イメージ画面）。
//
// イメージ画面は画像ファイルではなく、実際の画面と同じ色・同じ部品の形で小さく描いた図にしてある。
// 画面を作り替えたときは、ここの図と手順も一緒に直すこと（説明だけが古いまま残ると、かえって迷わせる）。
// モーダルの枠と左メニューは WbsManualDialog.tsx。
import type { CSSProperties, ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, GripVertical, Plus } from "lucide-react";
import { WBS_COLORS } from "./wbsStyles";

export interface WbsManualItem {
  id: string;
  title: string;
  /** 最初に読む1〜2文。何ができる機能かを言い切る */
  lead: string;
  illustration: ReactNode;
  /** 操作の手順（番号つきで出す） */
  steps: string[];
  /** 知っておくとよいこと・注意点 */
  notes?: string[];
  /** 編集できる人だけが使える機能か（閲覧のみの人向けに注記を出す） */
  editOnly?: boolean;
}

export interface WbsManualGroup { title: string; items: WbsManualItem[] }

// ── 図の部品 ──────────────────────────────────────────────────

const GREEN = "#059669";
const BORDER = `1px solid ${WBS_COLORS.border}`;
const HEADING_BG = ["#D9E2F6", "#EDF1FA"];

/** 図の外枠 */
function Frame({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ position: "relative", background: "#FFFFFF", border: BORDER, borderRadius: 10, overflow: "hidden", fontSize: 11, color: WBS_COLORS.text, ...style }}>
      {children}
    </div>
  );
}

/** 図の中の番号（説明文の「①」などと対応させる） */
function Mark({ n, style }: { n: number; style?: CSSProperties }) {
  return (
    <span style={{ position: "absolute", zIndex: 3, display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: "50%",
      background: "#DC2626", color: "#FFF", fontSize: 11, fontWeight: 800, boxShadow: "0 1px 4px rgba(0,0,0,0.25)", ...style }}>{n}</span>
  );
}

/** 表の列の割り付け（チェック／No.／項目／担当者／開始／終了／進捗率／ステータス） */
const GRID = "26px 34px minmax(0,1fr) 64px 76px 76px 44px 62px";

function HeadRow({ labels = ["", "No.", "項目", "担当者", "開始予定日", "終了予定日", "進捗率", "ステータス"], template = GRID }: { labels?: string[]; template?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: template, background: WBS_COLORS.headBg, color: "#FFF", fontWeight: 700, fontSize: 10 }}>
      {labels.map((l, i) => <div key={i} style={{ padding: "7px 4px", textAlign: "center", borderRight: "1px solid rgba(255,255,255,0.18)" }}>{l}</div>)}
    </div>
  );
}

function Box({ on }: { on?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 13, height: 13, borderRadius: 3, boxSizing: "border-box",
      background: on ? GREEN : "#FFF", border: on ? "none" : "1.5px solid rgba(26,23,20,0.28)" }}>
      {on && <Check style={{ width: 9, height: 9, color: "#FFF" }} />}
    </span>
  );
}

function StatusChip({ name, color }: { name: string; color: string }) {
  return <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 4, background: color, fontSize: 10, fontWeight: 700, boxShadow: "inset 0 0 0 1px rgba(30,41,58,0.14)" }}>{name}</span>;
}

/**
 * 表の1行。level 1・2 は見出し行（No. と項目だけ・行全体を塗りつぶし）、3 は入力する行。
 * cells は「担当者／開始／終了／進捗率／ステータス」の順。
 */
function Row({ no, level, name, cells, checked, closed, bg, grip = true }: {
  no: number | ""; level: 1 | 2 | 3; name: ReactNode; cells?: ReactNode[]; checked?: boolean; closed?: boolean; bg?: string; grip?: boolean;
}) {
  const heading = level < 3;
  const background = bg ?? (checked ? "#ECFDF5" : heading ? HEADING_BG[level - 1] : "#FFFFFF");
  const cell: CSSProperties = { padding: "6px 5px", borderBottom: BORDER, borderRight: heading ? "none" : BORDER, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: GRID, background }}>
      <div style={{ ...cell, borderRight: BORDER, textAlign: "center", padding: "6px 0" }}>{no !== "" && <Box on={checked} />}</div>
      <div style={{ ...cell, borderRight: BORDER, textAlign: "center", color: WBS_COLORS.subText, display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
        {no !== "" && grip && <GripVertical style={{ width: 9, height: 9, color: "#C9CED6" }} />}{no}
      </div>
      <div style={{ ...cell, paddingLeft: 6 + (level - 1) * 14, display: "flex", alignItems: "center", gap: 3, fontWeight: heading ? (level === 1 ? 800 : 700) : 400 }}>
        {heading && (closed ? <ChevronRight style={{ width: 11, height: 11, color: WBS_COLORS.headBg, flexShrink: 0 }} /> : <ChevronDown style={{ width: 11, height: 11, color: WBS_COLORS.headBg, flexShrink: 0 }} />)}
        {name}
      </div>
      {[0, 1, 2, 3, 4].map(i => <div key={i} style={{ ...cell, textAlign: "center" }}>{heading ? null : cells?.[i]}</div>)}
    </div>
  );
}

/** 緑の丸いボタン（行の境目に出る「＋ ◯項目を追加」） */
function AddPill({ label }: { label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, height: 20, padding: "0 9px", borderRadius: 10, background: GREEN, color: "#FFF", fontSize: 10, fontWeight: 700, boxShadow: "0 2px 6px rgba(5,150,105,0.35)", whiteSpace: "nowrap" }}>
      <Plus style={{ width: 10, height: 10 }} />{label}
    </span>
  );
}

/** 上の操作列に並ぶボタン */
function ToolBtn({ children, primary, danger }: { children: ReactNode; primary?: boolean; danger?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 9px", borderRadius: 7, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
      color: primary ? "#FFF" : danger ? "#DC2626" : "#4B5563", background: primary ? GREEN : "#FFF", border: `1px solid ${primary ? GREEN : "rgba(26,23,20,0.14)"}` }}>{children}</span>
  );
}

function Tile({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div style={{ padding: "5px 11px", background: WBS_COLORS.stripeBg, borderRadius: 7, flexShrink: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: WBS_COLORS.subText }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: color ?? WBS_COLORS.text, whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

const STATUS = { todo: "#EDECF4", doing: "#9DBEFF", done: "#D1F9E4", drop: "#767E8E", hold: "#FDF3C6" };

/** ガントの見出し＋帯。bars は [開始の列, 終了の列, 色]（列は 0 始まり）。off は休みの列 */
function MiniGantt({ days, off, rows, today, holiday }: {
  days: string[]; off: number[]; rows: ([number, number, string][] | "heading")[]; today?: number; holiday?: number;
}) {
  const W = 22;
  return (
    <div style={{ position: "relative", width: days.length * W }}>
      <div style={{ display: "flex", background: WBS_COLORS.ganttHeadBg }}>
        {days.map((d, i) => (
          <div key={i} style={{ width: W, padding: "4px 0", textAlign: "center", fontSize: 9, fontWeight: 700, color: i === holiday ? "#CC3333" : "#FFF", background: i === today ? GREEN : i === holiday ? "#FFEAEA" : undefined }}>{d}</div>
        ))}
      </div>
      {rows.map((bars, r) => (
        <div key={r} style={{ position: "relative", height: 26, borderBottom: BORDER, background: bars === "heading" ? HEADING_BG[1] : "#FFF" }}>
          {bars !== "heading" && days.map((_, i) => (
            <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: i * W, width: W, boxSizing: "border-box", borderRight: BORDER, background: off.includes(i) ? WBS_COLORS.offDayBg : undefined }} />
          ))}
          {bars !== "heading" && bars.map(([a, b, c], k) => (
            <div key={k} style={{ position: "absolute", top: 5, left: a * W + 1, width: (b - a + 1) * W - 3, height: 15, borderRadius: 3, background: c, boxShadow: "inset 0 0 0 1px rgba(30,41,58,0.14)" }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Excel 風の小さな表（インポート・エクスポートの図） */
function MiniSheet({ rows }: { rows: { level: 1 | 2 | 3; cells: string[] }[] }) {
  const template = "30px 30px minmax(0,1fr) 70px 80px 80px 50px 64px";
  return (
    <Frame>
      <HeadRow template={template} labels={["No.", "段", "項目", "担当者", "開始予定日", "終了予定日", "進捗率", "ステータス"]} />
      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: template, background: r.level < 3 ? HEADING_BG[r.level - 1] : "#FFF" }}>
          {[String(i + 1), "大中小"[r.level - 1], ...r.cells].map((c, k) => (
            <div key={k} style={{ padding: "5px", borderBottom: BORDER, borderRight: r.level < 3 ? "none" : BORDER, textAlign: k === 2 ? "left" : "center",
              paddingLeft: k === 2 ? 6 + (r.level - 1) * 12 : 5, fontWeight: r.level < 3 && k === 2 ? 700 : 400, whiteSpace: "nowrap", overflow: "hidden" }}>{c}</div>
          ))}
        </div>
      ))}
    </Frame>
  );
}

function Card({ title, lines, active }: { title: string; lines: string[]; active?: boolean }) {
  return (
    <div style={{ flex: 1, padding: "10px 12px", borderRadius: 10, background: active ? "#ECFDF5" : "#FFF", border: `1.5px solid ${active ? GREEN : "rgba(26,23,20,0.12)"}` }}>
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>{title}</div>
      {lines.map((l, i) => <div key={i} style={{ fontSize: 11, color: "#6B6458", lineHeight: 1.7 }}>{l}</div>)}
    </div>
  );
}

// ── 項目 ──────────────────────────────────────────────────────

export const WBS_MANUAL: WbsManualGroup[] = [
  {
    title: "はじめに",
    items: [
      {
        id: "overview",
        title: "画面の見かた",
        lead: "WBS（作業分解表）は、プロジェクトの作業を大項目・中項目・小項目に分けて、予定と進み具合を1つの表で管理する画面です。",
        illustration: (
          <Frame style={{ padding: 8 }}>
            <div style={{ position: "relative", display: "flex", gap: 6, marginBottom: 6 }}>
              <Mark n={1} style={{ top: -4, left: -4 }} />
              <Tile label="全体進捗率" value="42%" color={WBS_COLORS.headBg} /><Tile label="総タスク数" value="12" /><Tile label="遅延" value="1" color="#DC2525" />
              <Tile label="未着手" value="5" /><Tile label="着手中" value="4" />
            </div>
            <div style={{ position: "relative", display: "flex", gap: 6, marginBottom: 6, justifyContent: "flex-end" }}>
              <Mark n={2} style={{ top: 2, left: -4 }} />
              <ToolBtn>インポート</ToolBtn><ToolBtn>エクスポート</ToolBtn><ToolBtn>ステータス設定</ToolBtn><ToolBtn>休日設定</ToolBtn>
            </div>
            <div style={{ position: "relative", display: "flex", border: BORDER, borderRadius: 6, overflow: "hidden" }}>
              <Mark n={3} style={{ top: 30, left: 6 }} />
              <Mark n={4} style={{ top: 30, right: 6 }} />
              <div style={{ flex: "1 1 60%", minWidth: 0, borderRight: `2px solid ${WBS_COLORS.headBg}` }}>
                <HeadRow />
                <Row no={1} level={1} name="調査" />
                <Row no={2} level={2} name="現行システム" />
                <Row no={3} level={3} name="機能一覧の作成" cells={["山田", "10/01", "10/06", "50%", <StatusChip key="s" name="着手中" color={STATUS.doing} />]} />
              </div>
              <div style={{ flex: "0 0 auto", overflow: "hidden" }}>
                <MiniGantt days={["1", "2", "3", "4", "5", "6"]} off={[2, 3]} rows={["heading", "heading", [[0, 1, STATUS.doing], [4, 5, STATUS.doing]]]} />
              </div>
            </div>
          </Frame>
        ),
        steps: [
          "① 集計：全体進捗率・総タスク数・遅延と、ステータスごとの件数が出ます。",
          "② 操作列：インポート・エクスポート・ステータス設定・休日設定などのボタンが並びます。",
          "③ 表：左側です。作業を1行ずつ入力します。",
          "④ ガント：右側です。開始予定日〜終了予定日を、1日1列の帯で表示します。",
        ],
        notes: [
          "ページ全体は縦にスクロールしません。行が増えると、表の中だけが縦にスクロールします。",
          "ここでいう「WBS」は作業分解表のことです。チケット番号の「WBS」とは別のものです。",
        ],
      },
      {
        id: "permission",
        title: "権限（閲覧のみ・編集可）",
        lead: "WBS を見られるか・編集できるかは、アサイン計画の「WBS」の権限で決まります。",
        illustration: (
          <div style={{ display: "flex", gap: 10 }}>
            <Card title="権限なし" lines={["プロジェクト内のタブに「WBS」が出ません。"]} />
            <Card title="閲覧のみ" lines={["表・ガント・集計を見られます。", "エクスポートできます。", "紐づけたチケットを開けます。"]} />
            <Card title="編集可" active lines={["行の追加・編集・削除ができます。", "ステータス設定・休日設定・", "インポートができます。"]} />
          </div>
        ),
        steps: [
          "権限は、「アサイン計画」の画面で、メンバーやグループごとに「WBS」の項目から設定します。",
          "オーナーと管理者は、常に編集できます。",
        ],
        notes: ["「閲覧のみ」の人には、チェックボックスや追加のボタンなど、編集のための部品が表示されません。"],
      },
    ],
  },
  {
    title: "WBSを用意する",
    items: [
      {
        id: "sheets",
        title: "作成・切り替え・名前変更・削除",
        lead: "1つのプロジェクトに、WBS を複数作れます。画面上部の操作列で切り替えます。",
        editOnly: true,
        illustration: (
          <Frame style={{ padding: 10 }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
              <Mark n={1} style={{ top: -8, left: 40 }} /><Mark n={2} style={{ top: -8, left: 150 }} /><Mark n={3} style={{ top: -8, right: 20 }} />
              <ToolBtn>全体計画　▾</ToolBtn><ToolBtn>名前変更</ToolBtn><ToolBtn danger>削除</ToolBtn>
              <span style={{ fontSize: 10, color: "#A09790", fontWeight: 700 }}>段数</span><ToolBtn>3段（大・中・小）▾</ToolBtn><ToolBtn>全メンバーに公開</ToolBtn>
              <span style={{ flex: 1 }} /><ToolBtn>マニュアル</ToolBtn><ToolBtn primary>＋ 新しいWBS</ToolBtn>
            </div>
          </Frame>
        ),
        steps: [
          "① 左端のプルダウンで、表示する WBS を切り替えます。",
          "② 「名前変更」で名前を変え、「削除」でその WBS を消します。",
          "③ 「新しいWBS」で、WBS を追加します。3段・全メンバーに公開・5つのステータスで始まります。",
        ],
        notes: [
          "同じ名前の WBS は作れません。",
          "WBS を削除すると、その行・ステータス・チケットの紐づけもすべて消えます（チケット自体は消えません）。元に戻せません。",
          "削除できるのは、その WBS を作った人とオーナーです。",
        ],
      },
      {
        id: "levels",
        title: "段数（3段・2段・1段）",
        lead: "作業を何段に分けるかを、WBS ごとに選べます。最大は3段です。",
        editOnly: true,
        illustration: (
          <div style={{ display: "flex", gap: 10 }}>
            {[{ t: "3段（大・中・小）", l: [1, 2, 3, 3] }, { t: "2段（大・中）", l: [1, 2, 2] }, { t: "1段（大のみ）", l: [1, 1] }].map(x => (
              <div key={x.t} style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{x.t}</div>
                <Frame>
                  {x.l.map((lv, i) => {
                    const leaf = lv === Math.max(...x.l);
                    return (
                      <div key={i} style={{ padding: "5px 6px", paddingLeft: 6 + (lv - 1) * 14, borderBottom: BORDER, background: leaf ? "#FFF" : HEADING_BG[lv - 1], fontWeight: leaf ? 400 : 700 }}>
                        {["大項目", "中項目", "小項目"][lv - 1]}{leaf ? "（入力する行）" : "（見出し行）"}
                      </div>
                    );
                  })}
                </Frame>
              </div>
            ))}
          </div>
        ),
        steps: [
          "上部の「段数」のプルダウンで、3段・2段・1段から選びます。",
          "一番下の段の行が「入力する行」になり、担当者・日付・進捗率・ステータスなどを入れます。",
          "それより上の段の行は「見出し行」になり、名前だけを持ちます。",
        ],
        notes: [
          "段数を減らすときは、減らす段に行が残っていると変更できません。「対象の行を確認する」を押すと、その行が赤く表示されます。",
          "2段や1段から3段へ戻すことは、いつでもできます。",
        ],
      },
      {
        id: "visibility",
        title: "公開設定",
        lead: "WBS を、プロジェクトの全員に見せるか、選んだメンバーだけに見せるかを選べます。",
        editOnly: true,
        illustration: (
          <div style={{ display: "flex", gap: 10 }}>
            <Card title="プロジェクトの全メンバー" active lines={["WBS の権限がある人は、全員見られます。", "（新しく作った WBS は、こちらで始まります）"]} />
            <Card title="指定したメンバーのみ" lines={["作成者・オーナーと、", "選んだメンバーだけが見られます。"]} />
          </div>
        ),
        steps: [
          "上部の「全メンバーに公開」（または「指定したメンバーのみ」）のボタンを押します。",
          "どちらにするかを選びます。「指定したメンバーのみ」では、見せるメンバーにチェックを付けます。",
          "「保存する」を押します。",
        ],
        notes: ["公開設定を変えられるのは、その WBS を作った人とオーナーです。", "指定していないメンバーには、その WBS は一覧にも出ません。"],
      },
    ],
  },
  {
    title: "行を操作する",
    items: [
      {
        id: "add",
        title: "行を追加する",
        lead: "行と行の間にマウスを乗せると、追加のボタンが出ます。押した位置に行が入ります。",
        editOnly: true,
        illustration: (
          <Frame>
            <HeadRow />
            <Row no={1} level={1} name="調査" />
            <Row no={2} level={2} name="現行システム" />
            <div style={{ position: "relative", height: 0 }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: -1, height: 2, background: GREEN, zIndex: 2 }} />
              <div style={{ position: "absolute", left: 70, top: -10, display: "flex", gap: 4, zIndex: 3 }}><AddPill label="小項目を追加" /><AddPill label="中項目を追加" /></div>
              <Mark n={1} style={{ left: 250, top: -10 }} />
            </div>
            <Row no={3} level={3} name="機能一覧の作成" cells={["山田", "10/01", "10/06", "50%", <StatusChip key="s" name="着手中" color={STATUS.doing} />]} />
            <div style={{ position: "relative", display: "grid", gridTemplateColumns: GRID }}>
              <div style={{ borderRight: BORDER }} /><div style={{ borderRight: BORDER }} />
              <div style={{ padding: "6px 6px 6px 26px", color: "#C9CED6" }}>大項目を入力</div>
              <Mark n={2} style={{ left: 150, top: 3 }} />
            </div>
          </Frame>
        ),
        steps: [
          "① 行と行の間（行の境目）にマウスを乗せると、緑の線と「＋ ◯項目を追加」のボタンが出ます。",
          "ボタンを押すと行が入り、そのまま名前を入力できます。Enter で確定します。",
          "② 最初の大項目は、いちばん下の空の行の「大項目を入力」に打ち込んで追加します。",
        ],
        notes: [
          "境目に出るボタンは、すぐ上の行と同じ段と、その1つ下の段の2つまでです（中項目の下なら「小項目を追加／中項目を追加」）。",
          "下に行がある見出し行の境目で、同じ段を追加すると、新しい行はそのまとまりの後ろに入ります。",
          "名前を入れずに Esc で抜けると、「（名前を入力）」の行が残ります。不要ならチェックを付けて削除してください。",
        ],
      },
      {
        id: "heading",
        title: "見出し行と開閉",
        lead: "一番下の段より上の行（3段なら大項目・中項目）は、色の付いた見出し行になります。左の三角で、下の行をたためます。",
        illustration: (
          <Frame>
            <HeadRow />
            <div style={{ position: "relative" }}><Mark n={1} style={{ left: 62, top: 4 }} /><Row no={1} level={1} name="　　調査" /></div>
            <Row no={2} level={2} name="現行システム" />
            <Row no={3} level={3} name="機能一覧の作成" cells={["山田", "10/01", "10/06", "50%", <StatusChip key="s" name="着手中" color={STATUS.doing} />]} />
            <div style={{ position: "relative" }}>
              <Mark n={2} style={{ left: 190, top: 4 }} />
              <Row no={4} level={2} closed name={<>連携先 <span style={{ fontSize: 9, color: WBS_COLORS.subText, marginLeft: 8 }}>3行</span></>} />
            </div>
          </Frame>
        ),
        steps: [
          "① 見出し行の左の三角（▼）を押すと、その下の行がたたまれます。もう一度押すと開きます。",
          "② たたんでいるあいだは、隠れている行数が見出し行に出ます。",
        ],
        notes: [
          "見出し行は、No. と項目の名前だけを持ちます。担当者・日付・ステータスなどの欄と、ガントの帯はありません。",
          "開閉の状態は、WBS ごと・利用者ごとにブラウザへ保存されます（ほかの人の画面には影響しません）。",
        ],
      },
      {
        id: "edit",
        title: "行を編集する",
        lead: "表のセルをクリックすると、その場で編集できます。保存ボタンはありません。",
        editOnly: true,
        illustration: (
          <Frame>
            <HeadRow />
            <Row no={2} level={2} name="現行システム" />
            <div style={{ position: "relative" }}>
              <Mark n={1} style={{ left: 150, top: 4 }} /><Mark n={2} style={{ right: 250, top: 4 }} /><Mark n={3} style={{ right: 100, top: 4 }} /><Mark n={4} style={{ right: 12, top: 4 }} />
              <Row no={3} level={3} name="機能一覧の作成" cells={["山田 ▾", "2026/10/01", "2026/10/06", "50 %", <StatusChip key="s" name="着手中 ▾" color={STATUS.doing} />]} />
            </div>
          </Frame>
        ),
        steps: [
          "① 項目：名前をクリックして書き換えます。Enter か、欄の外をクリックすると確定します。Esc で取り消します。",
          "② 担当者：プルダウンから、プロジェクトのメンバーを選びます。",
          "③ 開始予定日・終了予定日：クリックするとカレンダーが開きます。進捗率は 0〜100 の数字で入れます。",
          "④ ステータス：プルダウンから選びます。",
        ],
        notes: [
          "予定日数は、開始予定日〜終了予定日から、土日と休日を除いて自動で計算されます。",
          "終了予定日を過ぎていて進捗率が100%でない行は、遅延として赤く表示されます。",
          "備考は、表の右のほうにあります。ガントに隠れているときは、固定の線を動かすか、右へスクロールしてください。",
        ],
      },
      {
        id: "reorder",
        title: "行を並べ替える",
        lead: "No. の列をつかんでドラッグすると、行の順番を変えられます。",
        editOnly: true,
        illustration: (
          <Frame>
            <HeadRow />
            <Row no={2} level={2} name="現行システム" />
            <Row no={3} level={3} name="機能一覧の作成" cells={["山田", "10/01", "10/06", "50%", ""]} />
            <div style={{ position: "relative", height: 0 }}><div style={{ position: "absolute", left: 0, right: 0, top: -1, height: 2, background: GREEN, zIndex: 2 }} /><Mark n={2} style={{ left: 180, top: -10 }} /></div>
            <div style={{ position: "relative", opacity: 0.55 }}><Mark n={1} style={{ left: 30, top: 4 }} /><Row no={4} level={3} name="テーブル定義の確認" cells={["山田", "10/07", "10/09", "0%", ""]} /></div>
          </Frame>
        ),
        steps: [
          "① 動かしたい行の No. の列（点々の印）をつかんで、ドラッグします。",
          "② 緑の線が出た位置で離すと、そこへ移動します。",
        ],
        notes: [
          "同じ段の行の上で離すと、その行の前か後ろに入ります。別の見出しの下へも移せます。",
          "1つ上の段の見出し行の上で離すと、その見出しの下のいちばん最後に入ります。",
          "段は変わりません（小項目を中項目にする、といった移動はできません）。見出し行を動かすと、下の行も一緒に動きます。",
        ],
      },
      {
        id: "delete",
        title: "行を削除する",
        lead: "左端のチェックボックスで行を選び、「選択した ◯ 行を削除」で、まとめて削除します。",
        editOnly: true,
        illustration: (
          <Frame>
            <div style={{ position: "relative", padding: 6, borderBottom: BORDER }}><Mark n={2} style={{ left: 150, top: 6 }} /><ToolBtn danger>選択した 3 行を削除</ToolBtn></div>
            <HeadRow />
            <Row no={1} level={1} name="調査" />
            <div style={{ position: "relative" }}><Mark n={1} style={{ left: -2, top: 4 }} /><Row no={2} level={2} name="現行システム" checked /></div>
            <Row no={3} level={3} name="機能一覧の作成" checked cells={["山田", "10/01", "10/06", "50%", ""]} />
            <Row no={4} level={3} name="テーブル定義の確認" checked cells={["山田", "10/07", "10/09", "0%", ""]} />
          </Frame>
        ),
        steps: [
          "① 削除したい行の、左端のチェックボックスにチェックを付けます。",
          "② 上の「選択した ◯ 行を削除」を押し、確認で「削除する」を押します。",
        ],
        notes: [
          "見出し行にチェックを付けると、その下の行にも自動でチェックが付きます（見出し行を消すと、下の行も一緒に消えるためです）。",
          "下の行のチェックを外すと、上の見出し行のチェックも外れます。",
          "見出しのチェックボックスで、すべての行をまとめて選べます。",
          "削除した行は元に戻せません。その行のチケットの紐づけも消えます（チケット自体は消えません）。",
        ],
      },
    ],
  },
  {
    title: "表示を読む",
    items: [
      {
        id: "summary",
        title: "集計の見かた",
        lead: "画面の上部に、WBS 全体の進み具合が出ます。数えるのは、一番下の段の行（入力する行）だけです。",
        illustration: (
          <Frame style={{ padding: 8 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Tile label="全体進捗率" value="42%" color={WBS_COLORS.headBg} /><Tile label="総タスク数" value="12" /><Tile label="遅延" value="1" color="#DC2525" />
              <Tile label="未着手" value="5" /><Tile label="着手中" value="4" /><Tile label="完了" value="3" />
              <span style={{ flex: 1 }} />
              <Tile label="最大並行タスク数" value="3 タスク" /><Tile label="負荷状況" value="要調整（高負荷）" color="#DC2525" /><Tile label="総稼働日数" value="24 日" />
            </div>
          </Frame>
        ),
        steps: [
          "全体進捗率：入力する行の進捗率の平均です。",
          "総タスク数：入力する行の数です（見出し行は数えません）。",
          "遅延：終了予定日を過ぎていて、進捗率が100%でない行の数です。",
          "ステータスごとの件数：そのステータスになっている行の数です。並びは「ステータス設定」の順です。",
          "最大並行タスク数：同じ日に重なっている行の、いちばん多い数です。",
          "負荷状況：最大並行タスク数が3以上で「要調整（高負荷）」、2で「適正（並行作業あり）」、それ以外は「標準（単独作業）」です。",
          "総稼働日数：1つ以上の行の予定が入っている日の数です。",
        ],
        notes: ["ステータスの数が多くて入りきらないときは、件数の部分だけが横にスクロールします。そのときは、件数の部分をたたむボタンも出ます。"],
      },
      {
        id: "gantt",
        title: "ガントの見かた",
        lead: "表の右側に、各行の開始予定日〜終了予定日が、1日1列の帯で表示されます。",
        illustration: (
          <Frame style={{ padding: 8 }}>
            <div style={{ position: "relative", display: "inline-block" }}>
              <MiniGantt days={["5", "6", "7", "8", "9", "10", "11", "12", "13", "14"]} off={[1, 5, 6]} today={8} holiday={1}
                rows={["heading", [[0, 0, STATUS.doing], [2, 4, STATUS.doing], [7, 9, STATUS.doing]], [[2, 3, STATUS.todo]]]} />
              <Mark n={1} style={{ left: 60, top: 54 }} /><Mark n={2} style={{ left: 120, top: 26 }} /><Mark n={3} style={{ left: 24, top: -6 }} /><Mark n={4} style={{ left: 180, top: -6 }} />
            </div>
          </Frame>
        ),
        steps: [
          "① 帯の色は、その行のステータスの色です。",
          "② 土日と休日はグレーの列になり、帯はそこで区切られます（休みの前で一度終わり、休み明けからまた始まります）。",
          "③ 休日設定で登録した日は、見出しが赤くなります。その列にマウスを乗せると、休日の名前が出ます。",
          "④ 今日の列は、緑で示されます。",
        ],
        notes: [
          "見出しのいちばん下の数字は、その日に重なっている行の数（並行タスク数）です。土日と休日は 0 です。",
          "表示する期間は、行に入っている日付を含む月の、月初〜月末です。少なくとも3か月ぶん出ます。",
          "横にスクロールできるのは、ガントの側だけです。縦は、表とガントが一緒に動きます。",
        ],
      },
      {
        id: "freeze",
        title: "列固定（表とガントの境目）",
        lead: "表とガントの境目の線を、左右にドラッグして動かせます。線より左の列は固定され、右の列はガントと一緒に横へスクロールします。",
        illustration: (
          <Frame>
            <div style={{ position: "relative", display: "flex" }}>
              <div style={{ flex: "0 0 52%", minWidth: 0 }}>
                <HeadRow template="26px 34px minmax(0,1fr) 64px" labels={["", "No.", "項目", "担当者"]} />
                <div style={{ display: "grid", gridTemplateColumns: "26px 34px minmax(0,1fr) 64px" }}>
                  {["", "3", "機能一覧の作成", "山田"].map((c, i) => <div key={i} style={{ padding: "6px 5px", borderBottom: BORDER, borderRight: BORDER, textAlign: i === 2 ? "left" : "center" }}>{c}</div>)}
                </div>
              </div>
              <div style={{ position: "absolute", top: 0, bottom: 0, left: "52%", width: 4, background: GREEN, zIndex: 2 }} />
              <Mark n={1} style={{ left: "calc(52% - 8px)", top: 22 }} />
              <div style={{ position: "absolute", left: "calc(52% + 16px)", top: 26, fontSize: 14, fontWeight: 800, color: GREEN, zIndex: 3 }}>⟷</div>
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                <HeadRow template="76px 76px 60px" labels={["開始予定日", "終了予定日", "…"]} />
                <div style={{ display: "grid", gridTemplateColumns: "76px 76px 60px" }}>
                  {["10/01", "10/06", ""].map((c, i) => <div key={i} style={{ padding: "6px 5px", borderBottom: BORDER, borderRight: BORDER, textAlign: "center" }}>{c}</div>)}
                </div>
              </div>
            </div>
          </Frame>
        ),
        steps: [
          "① 表とガントの境目の線にマウスを乗せると、線が緑になり、カーソルが左右の矢印に変わります。",
          "そのまま左右にドラッグします。緑の線が、近くの列の境目に吸い付きます。",
          "離した位置の列までが、左に固定されます。",
        ],
        notes: [
          "ガントを広く見たいときは、線を左へ動かして、固定する列を減らします。",
          "線を動かせるのは、いま画面に見えている列の境目までです。",
          "位置は、WBS ごと・利用者ごとにブラウザへ保存されます。",
        ],
      },
    ],
  },
  {
    title: "設定",
    items: [
      {
        id: "status",
        title: "ステータス設定",
        lead: "行のステータスは、WBS ごとに自由に追加・削除・変更できます。",
        editOnly: true,
        illustration: (
          <Frame style={{ padding: 10 }}>
            {[["未着手", STATUS.todo, "5行"], ["着手中", STATUS.doing, "4行"], ["完了", STATUS.done, "3行"]].map(([n, c, u], i) => (
              <div key={n} style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                {i === 0 && <><Mark n={1} style={{ left: -6, top: -6 }} /><Mark n={2} style={{ left: 46, top: -6 }} /><Mark n={3} style={{ right: -4, top: -6 }} /></>}
                <span style={{ color: "#6B6458" }}>↑ ↓</span>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: c, border: "1px solid rgba(26,23,20,0.14)" }} />
                <span style={{ flex: 1, padding: "4px 8px", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 6 }}>{n}</span>
                <span style={{ color: "#A09790" }}>{u}</span><span style={{ color: "#DC2626" }}>🗑</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: "#E0F2FE", border: "1px solid rgba(26,23,20,0.14)" }} />
              <span style={{ flex: 1, padding: "4px 8px", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 6, color: "#C9CED6" }}>例：確認待ち</span>
              <ToolBtn primary>＋ 追加</ToolBtn>
            </div>
          </Frame>
        ),
        steps: [
          "操作列の「ステータス設定」を押します。",
          "① 矢印で、並び順を変えます。",
          "② 色の四角を押して色を、名前の欄で名前を変えます。",
          "③ ごみ箱で削除します。下の欄に名前を入れて「追加」を押すと、ステータスが増えます。",
        ],
        notes: [
          "変更はすぐに保存され、表のプルダウン・ガントの色・集計に反映されます。",
          "行で使われているステータスを削除するときは、移し先のステータスを選びます。該当する行が、そのステータスに変わります。",
          "同じ名前・空の名前のステータスは作れません。最後の1つは削除できません。",
          "チケットのステータス（未着手・進行中・レビュー中など）とは別のもので、互いに影響しません。",
        ],
      },
      {
        id: "holiday",
        title: "休日設定",
        lead: "土日のほかに休みにする日（祝日・会社の休業日など）を登録します。予定日数とガントから、土日と同じように除かれます。",
        editOnly: true,
        illustration: (
          <Frame style={{ padding: 10 }}>
            {[["2026/10/12（月）", "スポーツの日", "全WBS", true], ["2026/10/30（金）", "社内イベント", "このWBSのみ", false]].map(([d, n, s, all], i) => (
              <div key={String(d)} style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: BORDER }}>
                {i === 0 && <Mark n={3} style={{ right: 26, top: -8 }} />}
                <span style={{ width: 110 }}>{d}</span><span style={{ flex: 1 }}>{n}</span>
                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5, color: all ? "#1E3989" : "#6B6458", background: all ? "#E3E9FB" : "#EFEDE9" }}>{s}</span>
                <span style={{ color: "#DC2626" }}>🗑</span>
              </div>
            ))}
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, margin: "10px 0", padding: "7px 9px", borderRadius: 8, background: "#ECFDF5", border: `1.5px solid ${GREEN}` }}>
              <Mark n={1} style={{ left: -8, top: -8 }} /><Box on /><b>全WBSに適用する</b>
            </div>
            <div style={{ position: "relative", display: "flex", gap: 8, alignItems: "center" }}>
              <Mark n={2} style={{ left: -8, top: -8 }} />
              <span style={{ padding: "4px 8px", border: `1.5px solid ${GREEN}`, borderRadius: 6, color: "#B0A9A4" }}>年/月/日 📅</span>
              <span style={{ flex: 1, padding: "4px 8px", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 6, color: "#C9CED6" }}>休日名</span>
              <ToolBtn primary>＋ 追加</ToolBtn><ToolBtn>CSVファイルを選ぶ</ToolBtn>
            </div>
          </Frame>
        ),
        steps: [
          "操作列の「休日設定」を押します。",
          "① 休日を、プロジェクトのすべての WBS で使うときは、「全WBSに適用する」にチェックを付けます。付けなければ、いま開いている WBS だけの休日になります。",
          "② 日付をカレンダーで選び、休日の名前を入れて「追加」を押します。",
          "③ 登録した休日には、「全WBS」か「このWBSのみ」の印が付きます。ごみ箱で削除します。",
        ],
        notes: [
          "CSV からまとめて追加できます。決まった形式はありません。日付の列（例：2026/10/12）と名前の列があれば、自動で読み取ります。内閣府の祝日 CSV もそのまま読めます。",
          "CSV を選ぶと、追加する内容の一覧が先に表示されます。確認してから「◯件を追加する」を押します。",
          "「全WBS」の休日を削除すると、ほかの WBS からも消えます。",
        ],
      },
    ],
  },
  {
    title: "チケット",
    items: [
      {
        id: "ticket",
        title: "チケットを紐づける",
        lead: "行に、関連するチケットを紐づけておけます。チケット番号を押すと、WBS 画面のままチケットの詳細が開きます。",
        illustration: (
          <Frame style={{ padding: 10 }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 5, width: 190, padding: "6px 8px", border: BORDER }}>
              <Mark n={2} style={{ left: 8, top: -10 }} /><Mark n={3} style={{ left: 96, top: -10 }} /><Mark n={1} style={{ left: 136, top: -10 }} />
              <span style={{ padding: "1px 6px", borderRadius: 5, fontWeight: 700, fontFamily: "var(--font-mono)", color: "#047857", background: "#ECFDF5", border: "1px solid #A7F3D0" }}>BRU19-001</span>
              <span style={{ padding: "1px 6px", borderRadius: 5, fontWeight: 700, color: "#4B5563", background: "#F3F4F6", border: "1px solid #E5E7EB" }}>+2</span>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, border: "1px dashed #C9CED6", borderRadius: 5 }}><Plus style={{ width: 10, height: 10 }} /></span>
            </div>
          </Frame>
        ),
        steps: [
          "① 「チケット」の列の「＋」を押すと、チケットを選ぶ画面が開きます。チケット番号かタイトルで検索し、チェックを付けて「保存する」を押します。",
          "② チケット番号を押すと、右からチケットの詳細が開きます。閉じると、WBS の元の位置に戻ります。",
          "③ 2件以上を紐づけると、2件目からは「+2」のようにまとめて表示されます。押すと、すべてのチケットが一覧で出ます。",
        ],
        notes: [
          "チケットを選ぶ画面では、スプリントごとにまとめて表示されます。スプリントを1つに絞るプルダウンもあります。",
          "紐づけを外すときは、チケットを選ぶ画面でチェックを外して保存します。",
          "1つの行に複数のチケットを、1つのチケットを複数の行に紐づけられます。",
          "紐づけは関連を示すだけです。行の進捗率・ステータス・日付にも、チケットの内容にも影響しません。",
          "チケットを紐づけられるのは、一番下の段の行（入力する行）です。",
        ],
      },
    ],
  },
  {
    title: "ファイル",
    items: [
      {
        id: "import",
        title: "インポートとテンプレート",
        lead: "Excel や CSV で作った行を、まとめて取り込めます。テンプレートに入力して、アップロードします。",
        editOnly: true,
        illustration: (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 11, fontWeight: 700 }}>
              {["① テンプレートをダウンロード", "② Excel で入力", "③ ファイルを選ぶ", "④ 内容を確認して取り込む"].map((t, i) => (
                <span key={t} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {i > 0 && <span style={{ color: "#A09790" }}>›</span>}
                  <span style={{ padding: "4px 9px", borderRadius: 7, background: "#ECFDF5", color: "#047857", whiteSpace: "nowrap" }}>{t}</span>
                </span>
              ))}
            </div>
            <MiniSheet rows={[
              { level: 1, cells: ["調査", "", "", "", "", ""] },
              { level: 2, cells: ["現行システム", "", "", "", "", ""] },
              { level: 3, cells: ["機能一覧の作成", "山田 太郎", "2026/10/01", "2026/10/06", "50%", "着手中"] },
              { level: 3, cells: ["テーブル定義の確認", "山田 太郎", "2026/10/07", "2026/10/09", "0%", "未着手"] },
            ]} />
          </div>
        ),
        steps: [
          "操作列の「インポート」を押し、「テンプレートをダウンロード」でテンプレートを保存します。",
          "Excel で開き、入力例を消してから、1行に1つずつ項目を入力します。「段」で大・中・小を選び、「項目」に名前を入れます。",
          "「ファイルを選ぶ」で、入力したファイルを選びます。取り込む行数と、エラーが先に表示されます。",
          "「いまの行に追加する」か「いまの行をすべて置き換える」を選び、「◯ 行を取り込む」を押します。",
        ],
        notes: [
          "見出し行（大・中）は、「段」と「項目」だけを入れます。ほかの欄に入力しようとすると、Excel がエラーを出します。",
          "「段」が空の行があると、エラーになって取り込めません。",
          "中項目は直前の大項目の下、小項目は直前の中項目の下に入ります。",
          "WBS に無いステータス名を入れると、新しいステータスとして追加されます。",
          "「いまの行をすべて置き換える」は、いまの行とチケットの紐づけを消してから取り込みます。元に戻せません。",
          "エクスポートしたファイルも同じ形なので、直してそのまま取り込めます。CSV（UTF-8／Shift_JIS）も使えます。",
        ],
      },
      {
        id: "export",
        title: "エクスポート",
        lead: "いまの WBS を、Excel ファイル（.xlsx）として保存できます。画面と同じ並びで、右側にガントも付きます。",
        illustration: (
          <MiniSheet rows={[
            { level: 1, cells: ["調査", "", "", "", "", ""] },
            { level: 2, cells: ["現行システム", "", "", "", "", ""] },
            { level: 3, cells: ["機能一覧の作成", "山田 太郎", "2026/10/01", "2026/10/06", "50%", "着手中"] },
          ]} />
        ),
        steps: [
          "操作列の「エクスポート」を押します。",
          "「WBS_（WBSの名前）_（日付）.xlsx」という名前のファイルが保存されます。",
        ],
        notes: [
          "「閲覧のみ」の人も、エクスポートできます。",
          "見出し行は、画面と同じように行全体が塗りつぶされます。ステータスの色・遅延の赤・土日休日のグレーも付きます。",
          "画面でたたんでいる行も、すべて出力されます。",
        ],
      },
    ],
  },
];
