// 業務レポートの「テキストベースPDF」生成（@react-pdf/renderer）
// 画像ラスタライズではなく実テキスト＝選択・検索・コピー可能。日本語フォントを埋め込む。
// 画面（ReportsPage）の構成を踏襲しつつ、1セクション=1ページ（A4横）で空白を抑えたレイアウト。
import { Document, Page, View, Text, StyleSheet, Font, pdf, Svg, Path, Rect, Circle, Defs, LinearGradient, Stop } from "@react-pdf/renderer";

// ── 日本語フォント登録（public/fonts に配置） ────────────────────────────────
Font.register({
  family: "NotoSansJP",
  fonts: [
    { src: "/fonts/NotoSansJP-Regular.ttf", fontWeight: "normal" },
    { src: "/fonts/NotoSansJP-Bold.ttf", fontWeight: "bold" },
  ],
});
Font.registerHyphenationCallback((word) => Array.from(word).map((c) => c));

const SIGNAL_META: Record<string, { label: string; color: string }> = {
  green: { label: "順調", color: "#059669" },
  yellow: { label: "注意", color: "#D97706" },
  red: { label: "遅延", color: "#DC2626" },
};
const ISSUE_LEVEL: Record<string, { label: string; color: string; bg: string; border: string }> = {
  high: { label: "要対応", color: "#DC2626", bg: "#FEF2F2", border: "#FEE2E2" },
  medium: { label: "注意", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
  low: { label: "改善", color: "#2563EB", bg: "#EFF6FF", border: "#DBEAFE" },
};
const STATUS_META: Record<string, { label: string; color: string }> = {
  "todo": { label: "未着手", color: "#A09790" },
  "in-progress": { label: "進行中", color: "#D97706" },
  "in-review": { label: "レビュー中", color: "#2563EB" },
  "review-done": { label: "レビュー完了", color: "#16A34A" },
  "stg-test": { label: "STGテスト", color: "#7C3AED" },
  "uat": { label: "UAT", color: "#EA580C" },
  "done": { label: "完了", color: "#059669" },
  "closed": { label: "クローズ", color: "#64748B" },
  "waiting-release": { label: "リリース待ち", color: "#7C3AED" },
  "released": { label: "リリース済み", color: "#0D9488" },
};

function fmtDate(d: Date) {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
function deltaLabel(cur: number, prev: number) {
  if (prev === 0) return cur === 0 ? "±0" : "新規";
  const diff = Math.round(((cur - prev) / prev) * 100);
  return `${diff >= 0 ? "+" : ""}${diff}%`;
}
function periodOf(report: any) {
  return `${fmtDate(report.start)} 〜 ${fmtDate(new Date(report.end.getTime() - 1))}`;
}
function trunc(s: string, n: number) {
  if (!s) return "";
  const a = Array.from(s);
  return a.length > n ? a.slice(0, n - 1).join("") + "…" : s;
}
function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

const ACCENT = "#059669";
// A4横：842 x 595pt。コンテンツ幅 ≒ 842 - 36*2 = 770
const PAGE_W = 842, PAGE_H = 595, PAD_X = 36;
const CONTENT_W = PAGE_W - PAD_X * 2;
const styles = StyleSheet.create({
  page: { backgroundColor: "#FFFFFF", fontFamily: "NotoSansJP", fontSize: 9, color: "#111827", paddingTop: 28, paddingBottom: 40, paddingHorizontal: PAD_X },
  secHead: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  secAccent: { width: 24, height: 24, borderRadius: 7, marginRight: 11 },
  secTitle: { fontSize: 16, fontWeight: "bold", color: "#111827" },
  secDesc: { fontSize: 9, color: "#9CA3AF", marginTop: 2 },
  secPeriod: { fontSize: 10, color: "#9CA3AF", fontWeight: "bold" },
  divider: { height: 1, backgroundColor: "#EEF0F1", marginTop: 8, marginBottom: 14 },
  footer: { position: "absolute", bottom: 16, left: PAD_X, right: PAD_X, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: "#F0F1F2", paddingTop: 7 },
  footerBrand: { fontSize: 8, color: "#9CA3AF", fontWeight: "bold" },
  footerPage: { fontSize: 8, color: "#C9C4BB", fontWeight: "bold" },
  colHead: { fontSize: 11, fontWeight: "bold", color: "#374151", marginBottom: 8 },
  muted: { fontSize: 9, color: "#B0A9A4", paddingVertical: 6 },
  kpiRow: { flexDirection: "row", gap: 10 },
  kpi: { flexGrow: 1, flexBasis: 0, backgroundColor: "#F9FAFB", border: "1 solid #EFF0F1", borderRadius: 9, padding: 13 },
  kpiLabel: { fontSize: 9, color: "#6B7280", fontWeight: "bold", marginBottom: 6 },
  kpiValueRow: { flexDirection: "row", alignItems: "flex-end" },
  kpiValue: { fontSize: 22, fontWeight: "bold" },
  kpiUnit: { fontSize: 9, color: "#9CA3AF", fontWeight: "bold", marginLeft: 2, marginBottom: 3 },
  kpiSub: { fontSize: 8, color: "#9CA3AF", marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 6, paddingVertical: 5, paddingHorizontal: 9, marginBottom: 4 },
  rowAlert: { backgroundColor: "#FEF2F2", border: "1 solid #FEE2E2" },
  rowWbs: { width: 58, fontSize: 8, fontWeight: "bold", color: "#9CA3AF" },
  rowTitle: { flexGrow: 1, flexShrink: 1, fontSize: 9, color: "#374151" },
  rowAssignee: { width: 68, fontSize: 8, color: "#B0A9A4", textAlign: "right", marginLeft: 6 },
  rowRight: { width: 78, fontSize: 8, fontWeight: "bold", textAlign: "right", marginLeft: 6 },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  barLabel: { width: 78, fontSize: 9, color: "#374151" },
  barTrack: { flexGrow: 1, height: 13, backgroundColor: "#F0F1F2", borderRadius: 5 },
  barFill: { height: 13, borderRadius: 5 },
  barValue: { width: 96, fontSize: 8, color: "#6B7280", textAlign: "right", marginLeft: 8 },
});

function Footer() {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerBrand}>Dev Ticket ・ 業務レポート</Text>
      <Text style={styles.footerPage} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

// 各セクションページの共通枠（見出し＋区切り＋本文＋フッター）。本文は縦に伸びて空白を抑える。
function SectionPage({ title, desc, accent, period, fill, children }: { title: string; desc?: string; accent: string; period?: string; fill?: "between" | "start"; children: any }) {
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.secHead}>
        <View style={[styles.secAccent, { backgroundColor: accent }]} />
        <View style={{ flexGrow: 1 }}>
          <Text style={styles.secTitle}>{title}</Text>
          {desc ? <Text style={styles.secDesc}>{desc}</Text> : null}
        </View>
        {period ? <Text style={styles.secPeriod}>{period}</Text> : null}
      </View>
      <View style={styles.divider} />
      <View style={{ flexGrow: 1, justifyContent: fill === "between" ? "space-between" : "flex-start" }}>{children}</View>
      <Footer />
    </Page>
  );
}

function Kpi({ label, value, unit, sub, color }: { label: string; value: string | number; unit?: string; sub?: string; color?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <View style={styles.kpiValueRow}>
        <Text style={[styles.kpiValue, color ? { color } : {}]}>{value}</Text>
        {unit ? <Text style={styles.kpiUnit}>{unit}</Text> : null}
      </View>
      {sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

function Metric({ label, value, unit, hint }: { label: string; value: string | number; unit?: string; hint?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <View style={styles.kpiValueRow}>
        <Text style={[styles.kpiValue, { fontSize: 20 }]}>{value}</Text>
        {unit ? <Text style={styles.kpiUnit}>{unit}</Text> : null}
      </View>
      {hint ? <Text style={styles.kpiSub}>{hint}</Text> : null}
    </View>
  );
}

function Row({ wbs, title, assignee, right, rightColor, alert, maxLen = 50 }: { wbs?: string; title: string; assignee?: string; right?: string; rightColor?: string; alert?: boolean; maxLen?: number }) {
  return (
    <View style={[styles.row, alert ? styles.rowAlert : {}]} wrap={false}>
      <Text style={styles.rowWbs}>{wbs || "—"}</Text>
      <Text style={styles.rowTitle}>{trunc(title, maxLen)}</Text>
      {assignee ? <Text style={styles.rowAssignee}>{assignee}</Text> : null}
      {right ? <Text style={[styles.rowRight, { color: rightColor || "#6B7280" }]}>{right}</Text> : null}
    </View>
  );
}

function HBar({ label, ratio, color, value }: { label: string; ratio: number; color: string; value: string }) {
  return (
    <View style={styles.barRow} wrap={false}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max(1, ratio * 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.barValue}>{value}</Text>
    </View>
  );
}

function ThroughputArea({ data, max, width, height = 160 }: { data: { label: string; count: number }[]; max: number; width: number; height?: number }) {
  const W = width, H = height;
  const n = data.length;
  const xs = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const ys = (v: number) => H - (v / max) * (H - 8);
  const pts = data.map((d, i) => `${xs(i).toFixed(1)},${ys(d.count).toFixed(1)}`);
  const linePath = `M ${pts.join(" L ")}`;
  const areaPath = `M 0,${H} L ${pts.join(" L ")} L ${W},${H} Z`;
  return (
    <View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="thrGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#7C3AED" stopOpacity={0.35} />
            <Stop offset="1" stopColor="#7C3AED" stopOpacity={0.03} />
          </LinearGradient>
        </Defs>
        <Path d={areaPath} fill="url(#thrGrad)" />
        <Path d={linePath} stroke="#7C3AED" strokeWidth={2} fill="none" />
      </Svg>
      <View style={{ flexDirection: "row", marginTop: 4, width: W }}>
        {data.map((d, i) => (
          <Text key={i} style={{ flexGrow: 1, flexBasis: 0, fontSize: 7, color: "#9CA3AF", textAlign: "center" }}>{d.label}</Text>
        ))}
      </View>
    </View>
  );
}

function CompareBars({ prev, cur }: { prev: number; cur: number }) {
  const max = Math.max(1, prev, cur);
  return (
    <View>
      <HBar label="前期" ratio={prev / max} color="#C4B5FD" value={`${prev}件`} />
      <HBar label="今期" ratio={cur / max} color="#7C3AED" value={`${cur}件`} />
    </View>
  );
}

// ドーナツ / リング（Svg の円弧で描画）
function Donut({ segments, size = 168, thickness = 28, centerMain, centerSub }: { segments: { value: number; color: string }[]; size?: number; thickness?: number; centerMain?: string; centerSub?: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = size / 2 - thickness / 2;
  const cx = size / 2, cy = size / 2;
  const arcs: { d: string; color: string }[] = [];
  let ang = -90;
  if (total > 0) {
    for (const s of segments) {
      if (s.value <= 0) continue;
      const frac = s.value / total;
      const full = frac >= 0.9999;
      const a1 = ang + (full ? 359.99 : frac * 360);
      const large = a1 - ang > 180 ? 1 : 0;
      const p0 = polar(cx, cy, r, ang), p1 = polar(cx, cy, r, a1);
      arcs.push({ d: `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`, color: s.color });
      ang = a1;
    }
  }
  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} stroke="#EEF0F2" strokeWidth={thickness} fill="none" />
        {arcs.map((a, i) => <Path key={i} d={a.d} stroke={a.color} strokeWidth={thickness} fill="none" />)}
      </Svg>
      {(centerMain || centerSub) && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
          {centerMain ? <Text style={{ fontSize: 26, fontWeight: "bold", color: "#111827" }}>{centerMain}</Text> : null}
          {centerSub ? <Text style={{ fontSize: 9, color: "#9CA3AF", marginTop: 2 }}>{centerSub}</Text> : null}
        </View>
      )}
    </View>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 9 }}>
      <View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: color, marginRight: 8 }} />
      <Text style={{ fontSize: 11, color: "#374151", flexGrow: 1 }}>{label}</Text>
      <Text style={{ fontSize: 12, fontWeight: "bold", color: "#111827" }}>{value}</Text>
    </View>
  );
}

// ① ガント（スプリント。1セクション1ページなので行高を可変にして空白を抑える）
function PdfGantt({ report, availH }: { report: any; availH: number }) {
  const DAY = 86400000;
  const periodStart = report.periodStart, periodEnd = report.periodEnd, now = report.nowMs;
  const lenDays = Math.max(1, Math.round((periodEnd - periodStart) / DAY));
  const unit = lenDays >= 28 ? "week" : "day";
  const UNIT = (unit === "week" ? 7 : 1) * DAY;
  const PAST_UNITS = unit === "week" ? 8 : 14;
  const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const startOfUnit = (ms: number) => {
    const d0 = startOfDay(ms);
    if (unit !== "week") return d0;
    const dow = (new Date(d0).getDay() + 6) % 7;
    return d0 - dow * DAY;
  };
  const winStart = startOfUnit(periodStart) - PAST_UNITS * UNIT;
  const LABEL_W = 160;
  const TRACK_W = 610;
  const colOf = (ms: number) => Math.floor((ms - winStart) / UNIT);
  const spotStart = Math.max(0, colOf(periodStart));
  const spotEndRaw = Math.max(spotStart, colOf(periodEnd - 1));
  const minCols = spotEndRaw + 1 + (unit === "week" ? 4 : 6);
  const CELL = Math.max(8, Math.min(18, Math.floor(TRACK_W / Math.max(minCols, 1))));
  const totalCols = Math.max(1, Math.floor(TRACK_W / CELL));
  const winEnd = winStart + totalCols * UNIT;
  const spotEnd = Math.min(totalCols - 1, spotEndRaw);
  const todayCol = now >= winStart && now < winEnd ? colOf(now) : -1;
  const cols = Array.from({ length: totalCols }, (_, i) => {
    const d = new Date(winStart + i * UNIT);
    return { label: `${d.getMonth() + 1}/${d.getDate()}`, spotlight: i >= spotStart && i <= spotEnd, today: i === todayCol };
  });
  const labelEvery = unit === "week" ? 1 : Math.max(1, Math.ceil(totalCols / 14));
  const colorOf = (s: any) => s.isOverdue ? "#E5484D" : s.isDone ? "#30A46C" : "#E08C00";
  const rows = (report.ganttRows || []).filter((s: any) => s.endMs >= winStart && s.startMs < winEnd).sort((a: any, b: any) => a.startMs - b.startMs).slice(0, 16);
  // 行高を可変に：スプリントが少なければ広げる（広げすぎは抑制）
  const ROW_H = Math.max(20, Math.min(52, Math.floor((availH - 30) / Math.max(rows.length, 1))));
  const BAR_H = Math.max(11, Math.min(20, Math.round(ROW_H * 0.42)));
  return (
    <View>
      <View style={{ flexDirection: "row", marginBottom: 3 }}>
        <View style={{ width: LABEL_W }} />
        {cols.map((c, i) => (
          <Text key={i} style={{ width: CELL, fontSize: 6, textAlign: "center", color: c.today ? "#E5484D" : c.spotlight ? "#3B82F6" : "#A6ADBA", fontWeight: (c.today || c.spotlight) ? "bold" : "normal" }}>{i % labelEvery === 0 ? c.label : ""}</Text>
        ))}
      </View>
      <View style={{ borderTop: "1 solid #ECEEF1", borderLeft: "1 solid #ECEEF1" }}>
        {rows.length === 0 && <Text style={[styles.muted, { paddingHorizontal: 8 }]}>表示範囲にスケジュールされたスプリントはありません</Text>}
        {rows.map((s: any) => {
          const ds = Math.max(0, colOf(s.startMs));
          const de = Math.min(totalCols - 1, colOf(s.endMs));
          const barW = Math.max(CELL - 2, (de - ds + 1) * CELL - 2);
          return (
            <View key={s.id} style={{ flexDirection: "row", height: ROW_H }} wrap={false}>
              <View style={{ width: LABEL_W, height: ROW_H, borderRight: "1 solid #ECEEF1", borderBottom: "1 solid #F1F3F5", flexDirection: "row", alignItems: "center", paddingHorizontal: 6 }}>
                <Text style={{ fontSize: 6.5, color: "#AEB4BE", marginRight: 5 }}>{s.wbs || "—"}</Text>
                <Text style={{ fontSize: 8.5, color: "#384150", flexGrow: 1, flexShrink: 1 }}>{trunc(s.title, 20)}</Text>
              </View>
              <View style={{ width: TRACK_W, height: ROW_H, position: "relative", borderBottom: "1 solid #F1F3F5" }}>
                {spotEnd >= spotStart && <View style={{ position: "absolute", left: spotStart * CELL, top: 0, width: (spotEnd - spotStart + 1) * CELL, height: ROW_H, backgroundColor: "#F3F8FF" }} />}
                {todayCol >= 0 && <View style={{ position: "absolute", left: todayCol * CELL, top: 0, width: CELL, height: ROW_H, backgroundColor: "#FCEBEC" }} />}
                <View style={{ position: "absolute", left: ds * CELL + 1, top: (ROW_H - BAR_H) / 2, width: barW, height: BAR_H, backgroundColor: colorOf(s), borderRadius: BAR_H / 2 }} />
              </View>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: 16, marginTop: 10, marginLeft: LABEL_W }}>
        {[["完了", "#30A46C"], ["進行中", "#E08C00"], ["遅延", "#E5484D"]].map(([l, c]) => (
          <View key={l} style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ width: 10, height: 7, borderRadius: 2, backgroundColor: c, marginRight: 5 }} />
            <Text style={{ fontSize: 9, color: "#6B7280" }}>{l}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function MemberTablePdf({ rows }: { rows: any[] }) {
  if (!rows || rows.length === 0) return <Text style={styles.muted}>データがありません</Text>;
  const headCell = (w: number | undefined, grow: boolean, align: "left" | "right") => ({ width: w, flexGrow: grow ? 1 : 0, flexBasis: grow ? 0 : undefined, fontSize: 9, fontWeight: "bold" as const, color: "#6B7280", textAlign: align });
  const bodyCell = (w: number | undefined, grow: boolean, align: "left" | "right", color: string, bold?: boolean) => ({ width: w, flexGrow: grow ? 1 : 0, flexBasis: grow ? 0 : undefined, fontSize: 10, color, textAlign: align, fontWeight: (bold ? "bold" : "normal") as "bold" | "normal" });
  // 行高を行数に応じて広げ、縦の余白を抑える
  const rowH = Math.max(26, Math.min(54, Math.floor(360 / Math.max(rows.length, 1))));
  return (
    <View>
      <View style={{ flexDirection: "row", borderBottom: "1.5 solid #E5E7EB", paddingBottom: 7, marginBottom: 2 }}>
        <Text style={headCell(undefined, true, "left")}>メンバー</Text>
        <Text style={headCell(80, false, "right")}>完了</Text>
        <Text style={headCell(110, false, "right")}>工数(人日)</Text>
        <Text style={headCell(140, false, "right")}>平均サイクル(日)</Text>
        <Text style={headCell(80, false, "right")}>遅延</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", height: rowH, borderBottom: "1 solid #F3F4F6" }} wrap={false}>
          <Text style={bodyCell(undefined, true, "left", "#374151", true)}>{trunc(r.name, 22)}</Text>
          <Text style={bodyCell(80, false, "right", "#374151")}>{r.count}</Text>
          <Text style={bodyCell(110, false, "right", "#374151")}>{r.personDays}</Text>
          <Text style={bodyCell(140, false, "right", "#374151")}>{r.avgCycle}</Text>
          <Text style={bodyCell(80, false, "right", r.overdue > 0 ? "#DC2626" : "#374151", r.overdue > 0)}>{r.overdue}</Text>
        </View>
      ))}
    </View>
  );
}

function IssueCardPdf({ iss }: { iss: any }) {
  const m = ISSUE_LEVEL[iss.level] || ISSUE_LEVEL.medium;
  return (
    <View style={{ flexDirection: "row", backgroundColor: m.bg, border: `1 solid ${m.border}`, borderRadius: 9, padding: 13, marginBottom: 9 }} wrap={false}>
      <Text style={{ fontSize: 9, fontWeight: "bold", color: "#FFFFFF", backgroundColor: m.color, borderRadius: 5, paddingVertical: 3, paddingHorizontal: 8, marginRight: 11 }}>{m.label}</Text>
      <View style={{ flexGrow: 1, flexShrink: 1 }}>
        <Text style={{ fontSize: 11, fontWeight: "bold", color: "#1F2937" }}>{iss.title}</Text>
        <View style={{ flexDirection: "row", marginTop: 4 }}>
          <Text style={{ fontSize: 9.5, fontWeight: "bold", color: m.color, marginRight: 7 }}>対策</Text>
          <Text style={{ fontSize: 9.5, color: "#4B5563", flexGrow: 1, flexShrink: 1, lineHeight: 1.5 }}>{iss.action}</Text>
        </View>
      </View>
    </View>
  );
}

function ReportDocument({ report, scopeName }: { report: any; scopeName: string }) {
  const period = periodOf(report);
  const sm = SIGNAL_META[report.signal] || SIGNAL_META.green;
  const maxStatus = Math.max(1, ...report.statusBreakdown.map((s: any) => s.count));
  const maxWeek = Math.max(1, ...report.weekBuckets.map((w: any) => w.count));
  const coverKpis = [
    { l: "完了", v: `${report.completed.length}件` },
    { l: "進行中", v: `${report.inProgress.length}件` },
    { l: "完了率", v: `${report.completionRate}%` },
    { l: "遅延", v: `${report.overdue.length}件` },
    { l: "平均サイクル", v: `${report.cycleTime}日` },
  ];
  const workSegments = [
    { value: report.completed.length, color: "#059669" },
    { value: report.inProgress.length, color: "#D97706" },
    { value: report.todo.length, color: "#A09790" },
    { value: report.overdue.length, color: "#DC2626" },
  ];

  return (
    <Document title={`業務レポート_${scopeName}`} author="Dev Ticket">
      {/* ── 表紙（A4横・ブランド配色） ── */}
      <Page size="A4" orientation="landscape" style={{ fontFamily: "NotoSansJP", position: "relative" }}>
        <Svg width={PAGE_W} height={PAGE_H} style={{ position: "absolute", top: 0, left: 0 }}>
          <Defs>
            <LinearGradient id="cover" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#10B981" />
              <Stop offset="0.55" stopColor="#059669" />
              <Stop offset="1" stopColor="#064E3B" />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={PAGE_W} height={PAGE_H} fill="url(#cover)" />
          <Circle cx={690} cy={70} r={150} fill="#FFFFFF" opacity={0.06} />
          <Circle cx={780} cy={470} r={230} fill="#FFFFFF" opacity={0.05} />
          <Circle cx={90} cy={540} r={150} fill="#064E3B" opacity={0.3} />
        </Svg>
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, paddingHorizontal: 56, paddingVertical: 44, justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Svg width={34} height={34} style={{ marginRight: 11 }}>
                <Defs>
                  <LinearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0" stopColor="#6EE7B7" />
                    <Stop offset="1" stopColor="#34D399" />
                  </LinearGradient>
                </Defs>
                <Rect x={0} y={0} width={34} height={34} rx={9} fill="url(#mark)" />
                <Rect x={8} y={11} width={18} height={12} rx={2.5} fill="#FFFFFF" />
                <Circle cx={17} cy={17} r={1.6} fill="#34D399" />
              </Svg>
              <Text style={{ fontSize: 16, fontWeight: "bold", color: "#FFFFFF" }}>Dev Ticket</Text>
            </View>
            <Text style={{ fontSize: 12, fontWeight: "bold", color: sm.color, backgroundColor: "#FFFFFF", paddingVertical: 6, paddingHorizontal: 15, borderRadius: 20 }}>総合：{sm.label}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 13, color: "#D1FAE5", fontWeight: "bold", marginBottom: 8, letterSpacing: 1 }}>業務レポート</Text>
            <Text style={{ fontSize: 44, fontWeight: "bold", color: "#FFFFFF" }}>{scopeName}</Text>
            <Text style={{ fontSize: 15, color: "#D1FAE5", marginTop: 10 }}>{period}</Text>
          </View>
          <View style={{ flexDirection: "row" }}>
            {coverKpis.map((s, i) => (
              <View key={i} style={{ backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 11, paddingVertical: 13, paddingHorizontal: 20, marginRight: 13 }}>
                <Text style={{ fontSize: 10, color: "#D1FAE5", marginBottom: 5 }}>{s.l}</Text>
                <Text style={{ fontSize: 23, fontWeight: "bold", color: "#FFFFFF" }}>{s.v}</Text>
              </View>
            ))}
          </View>
        </View>
      </Page>

      {/* ── 2: サマリー（結論） ── */}
      <SectionPage title={`${report.periodLabel}サマリー（結論）`} desc={scopeName} accent={ACCENT} period={period} fill="between">
        <View style={{ backgroundColor: "#F9FAFB", border: "1 solid #F0F1F2", borderRadius: 10, padding: 16, marginBottom: 14 }}>
          {report.sentences.map((s: string, i: number) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 6 }}>
              <Text style={{ color: ACCENT, fontWeight: "bold", marginRight: 7, fontSize: 12 }}>•</Text>
              <Text style={{ fontSize: 11.5, color: "#374151", lineHeight: 1.5, flexGrow: 1, flexShrink: 1 }}>{s}</Text>
            </View>
          ))}
        </View>
        <View style={[styles.kpiRow, { marginBottom: 16 }]}>
          <Kpi label="完了" value={report.completed.length} unit="件" sub={`前期比 ${deltaLabel(report.completed.length, report.completedPrev.length)}`} color="#059669" />
          <Kpi label="進行中" value={report.inProgress.length} unit="件" sub={`未着手 ${report.todo.length}件`} color="#D97706" />
          <Kpi label="完了率" value={report.completionRate} unit="%" sub={`残 ${report.activeTickets.length}件`} color="#2563EB" />
          <Kpi label="遅延" value={report.overdue.length} unit="件" sub={`期限間近 ${report.dueSoon.length}件`} color="#DC2626" />
        </View>
        {/* グラフ行（作業内訳ドーナツ＋完了率リング） */}
        <View style={{ flexDirection: "row", flexGrow: 1, alignItems: "center" }}>
          <View style={{ flexGrow: 1, flexBasis: 0, flexDirection: "row", alignItems: "center" }}>
            <Donut segments={workSegments} size={166} thickness={28} />
            <View style={{ marginLeft: 26, flexGrow: 1 }}>
              <Text style={styles.colHead}>作業内訳</Text>
              <LegendDot color="#059669" label="完了" value={`${report.completed.length}件`} />
              <LegendDot color="#D97706" label="進行中" value={`${report.inProgress.length}件`} />
              <LegendDot color="#A09790" label="未着手" value={`${report.todo.length}件`} />
              <LegendDot color="#DC2626" label="遅延" value={`${report.overdue.length}件`} />
            </View>
          </View>
          <View style={{ width: 30 }} />
          <View style={{ flexGrow: 1, flexBasis: 0, flexDirection: "row", alignItems: "center" }}>
            <Donut segments={[{ value: report.completionRate, color: "#059669" }, { value: Math.max(0, 100 - report.completionRate), color: "#EEF0F2" }]} size={150} thickness={24} centerMain={`${report.completionRate}%`} centerSub="完了率" />
            <View style={{ marginLeft: 24, flexGrow: 1 }}>
              <Text style={styles.colHead}>進捗状況</Text>
              <LegendDot color="#059669" label="完了済み" value={`${report.completed.length}件`} />
              <LegendDot color="#E5E7EB" label="未完了（残）" value={`${report.activeTickets.length}件`} />
            </View>
          </View>
        </View>
      </SectionPage>

      {/* ── 3: ① 今週のスケジュール（ガント） ── */}
      <SectionPage title="① 今週のスケジュール" desc="対象期間のスプリントを俯瞰（色＝状態：完了 / 進行中 / 遅延）" accent="#0EA5E9" period={period}>
        <PdfGantt report={report} availH={420} />
      </SectionPage>

      {/* ── 4: ② 進捗 ── */}
      <SectionPage title="② 進捗：終わった？終わってない？" desc="完了・進行中・未着手の内訳と完了チケット（収まる分のみ表示）" accent="#059669" period={period}>
        <View style={{ flexDirection: "row", gap: 30, flexGrow: 1 }}>
          <View style={{ width: 320 }}>
            <Text style={styles.colHead}>ステータス内訳</Text>
            {report.statusBreakdown.length === 0 ? <Text style={styles.muted}>データがありません</Text> :
              report.statusBreakdown.map((s: any) => (
                <HBar key={s.key} label={s.label} ratio={s.count / maxStatus} color={s.color} value={`${s.count}`} />
              ))}
          </View>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.colHead}>完了したチケット（{report.completed.length}件）</Text>
            {report.completed.length === 0 ? <Text style={styles.muted}>この期間に完了したチケットはありません</Text> : (
              <View style={{ flexGrow: 1, justifyContent: report.completed.length > 13 ? "space-between" : "flex-start" }}>
                {report.completed.slice(0, 13).map((t: any) => (
                  <Row key={t.id} wbs={t.wbs} title={t.title} assignee={t.assignee} right={STATUS_META[t.status]?.label} rightColor={STATUS_META[t.status]?.color} maxLen={30} />
                ))}
                {report.completed.length > 13 && <Text style={{ fontSize: 9, color: "#9CA3AF", marginTop: 2 }}>ほか {report.completed.length - 13}件（紙面の都合で省略）</Text>}
              </View>
            )}
          </View>
        </View>
      </SectionPage>

      {/* ── 5: ③ 効率・生産性 ── */}
      <SectionPage title="③ 効率・生産性" desc="1チケットあたりの効率と、チーム全体のスループット" accent="#D97706" period={period} fill="between">
        <View style={[styles.kpiRow, { marginBottom: 12 }]}>
          <Metric label="平均サイクルタイム" value={report.cycleTime} unit="日" hint="着手→完了" />
          <Metric label="1件あたり工数" value={report.pdPerTicket} unit="人日" hint={`約 ${report.hoursPerTicket} 時間/件`} />
          <Metric label="平均リードタイム" value={report.leadTime} unit="日" hint="作成→完了" />
          <Metric label="見積精度" value={report.estimateAccuracy} unit="%" hint="実績/見積" />
        </View>
        <View style={[styles.kpiRow, { marginBottom: 14 }]}>
          <Metric label="スループット" value={report.completed.length} unit="件" hint={`前期比 ${deltaLabel(report.completed.length, report.completedPrev.length)}`} />
          <Metric label="総工数" value={Math.round((report.actSum / 8) * 10) / 10} unit="人日" hint="完了分の実績" />
          <Metric label="完了率" value={report.completionRate} unit="%" hint={`全体 ${report.totalScoped}件`} />
        </View>
        <View style={{ flexDirection: "row", flexGrow: 1 }}>
          <View style={{ width: 470 }}>
            <Text style={styles.colHead}>スループット推移（直近8週・完了数）</Text>
            <ThroughputArea data={report.weekBuckets} max={maxWeek} width={450} height={170} />
          </View>
          <View style={{ width: 24 }} />
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.colHead}>前期との比較（完了数）</Text>
            <CompareBars prev={report.completedPrev.length} cur={report.completed.length} />
          </View>
        </View>
      </SectionPage>

      {/* ── 6: ⑤ 遅れ（リスク） ── */}
      <SectionPage title="④ 遅れ（リスク）" desc="期限超過・期限間近のチケット" accent="#DC2626" period={period}>
        <View style={{ flexDirection: "row", gap: 30 }}>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.colHead}>期限超過（{report.overdue.length}件）</Text>
            {report.overdue.length === 0 && <Text style={styles.muted}>期限超過はありません</Text>}
            {report.overdue.slice(0, 11).map((t: any) => (
              <Row key={t.id} wbs={t.wbs} title={t.title} right={t.dueDate ?? ""} rightColor="#DC2626" alert maxLen={30} />
            ))}
            {report.overdue.length > 11 && <Text style={{ fontSize: 9, color: "#9CA3AF", marginTop: 4 }}>ほか {report.overdue.length - 11}件</Text>}
          </View>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.colHead}>期限間近・3日以内（{report.dueSoon.length}件）</Text>
            {report.dueSoon.length === 0 && <Text style={styles.muted}>期限間近のチケットはありません</Text>}
            {report.dueSoon.slice(0, 11).map((t: any) => (
              <Row key={t.id} wbs={t.wbs} title={t.title} right={t.dueDate ?? ""} rightColor="#D97706" maxLen={30} />
            ))}
            {report.dueSoon.length > 11 && <Text style={{ fontSize: 9, color: "#9CA3AF", marginTop: 4 }}>ほか {report.dueSoon.length - 11}件</Text>}
          </View>
        </View>
      </SectionPage>

      {/* ── 7: ⑥ メンバー個別の生産性 ── */}
      <SectionPage title="⑤ メンバー個別の生産性" desc="人別の完了数・工数・サイクルタイム・遅延" accent="#0D9488" period={period}>
        <MemberTablePdf rows={report.memberStats} />
      </SectionPage>

      {/* ── 8: ⑦ 今後の予定 ── */}
      <SectionPage title="⑥ 今後の予定" desc="来期に期限を迎えるチケットとリリース予定（収まる分のみ表示）" accent="#2563EB" period={period}>
        <View style={{ flexDirection: "row", gap: 30, flexGrow: 1 }}>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.colHead}>来期に期限を迎える（{report.upcoming.length}件）</Text>
            {report.upcoming.length === 0 ? <Text style={styles.muted}>該当チケットはありません</Text> : (
              <View style={{ flexGrow: 1, justifyContent: report.upcoming.length > 13 ? "space-between" : "flex-start" }}>
                {report.upcoming.slice(0, 13).map((t: any) => (
                  <Row key={t.id} wbs={t.wbs} title={t.title} right={t.dueDate ?? ""} rightColor="#6B7280" maxLen={30} />
                ))}
                {report.upcoming.length > 13 && <Text style={{ fontSize: 9, color: "#9CA3AF", marginTop: 2 }}>ほか {report.upcoming.length - 13}件</Text>}
              </View>
            )}
          </View>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.colHead}>リリース予定（{report.releases.length}件）</Text>
            {report.releases.length === 0 ? <Text style={styles.muted}>登録されたリリース予定はありません</Text> : (
              <View style={{ flexGrow: 1, justifyContent: report.releases.length > 13 ? "space-between" : "flex-start" }}>
                {report.releases.slice(0, 13).map((t: any) => (
                  <Row key={t.id} wbs={t.releaseDate ?? ""} title={t.title} rightColor="#0D9488" maxLen={32} />
                ))}
                {report.releases.length > 13 && <Text style={{ fontSize: 9, color: "#9CA3AF", marginTop: 2 }}>ほか {report.releases.length - 13}件</Text>}
              </View>
            )}
          </View>
        </View>
      </SectionPage>

      {/* ── 9: ⑧ 現在の課題と対策 ── */}
      <SectionPage title="⑦ 現在の課題と対策" desc="メトリクスから自動抽出した課題と、推奨される対策" accent="#DC2626" period={period} fill={(report.issues && report.issues.length >= 3) ? "between" : "start"}>
        {(!report.issues || report.issues.length === 0) ? (
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#ECFDF5", border: "1 solid #D1FAE5", borderRadius: 9, padding: 16 }}>
            <Text style={{ fontSize: 12, color: "#065F46", fontWeight: "bold" }}>現在、対応が必要な大きな課題はありません。計画通りに推移しています。</Text>
          </View>
        ) : (
          report.issues.map((iss: any, i: number) => <IssueCardPdf key={i} iss={iss} />)
        )}
      </SectionPage>
    </Document>
  );
}

export async function exportReportPdf(report: any, scopeName: string, fileName: string) {
  const blob = await pdf(<ReportDocument report={report} scopeName={scopeName} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
