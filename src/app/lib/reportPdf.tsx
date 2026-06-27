// 業務レポートの「テキストベースPDF」生成（@react-pdf/renderer）
// 画像ラスタライズではなく実テキスト＝選択・検索・コピー可能。日本語フォントを埋め込む。
import { Document, Page, View, Text, StyleSheet, Font, pdf, Svg, Path, Defs, LinearGradient, Stop } from "@react-pdf/renderer";
import { formatPersonDays } from "@/app/lib/helpers";

// ── 日本語フォント登録（public/fonts に配置） ────────────────────────────────
Font.register({
  family: "NotoSansJP",
  fonts: [
    { src: "/fonts/NotoSansJP-Regular.ttf", fontWeight: "normal" },
    { src: "/fonts/NotoSansJP-Bold.ttf", fontWeight: "bold" },
  ],
});
// CJKを単語単位で改行させない（1文字ずつ折り返し可にする）
Font.registerHyphenationCallback((word) => Array.from(word).map((c) => c));

const SIGNAL_META: Record<string, { label: string; color: string }> = {
  green: { label: "順調", color: "#059669" },
  yellow: { label: "注意", color: "#D97706" },
  red: { label: "遅延", color: "#DC2626" },
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
// 長いタイトルを1行に収まるよう省略（あふれによるレイアウト崩れ防止）
function trunc(s: string, n: number) {
  if (!s) return "";
  const a = Array.from(s);
  return a.length > n ? a.slice(0, n - 1).join("") + "…" : s;
}

const ACCENT = "#059669";
const styles = StyleSheet.create({
  page: { backgroundColor: "#FFFFFF", fontFamily: "NotoSansJP", fontSize: 9, color: "#111827", paddingTop: 30, paddingBottom: 42, paddingHorizontal: 38 },
  // ヘッダー
  header: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  headerIcon: { width: 26, height: 26, borderRadius: 8, marginRight: 11 },
  headerTitle: { fontSize: 16, fontWeight: "bold" },
  headerDesc: { fontSize: 9, color: "#9CA3AF", marginTop: 2 },
  headerPeriod: { fontSize: 10, color: "#9CA3AF", fontWeight: "bold" },
  divider: { height: 1, backgroundColor: "#EEF0F1", marginTop: 8, marginBottom: 14 },
  // フッター
  footer: { position: "absolute", bottom: 16, left: 38, right: 38, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: "#F0F1F2", paddingTop: 8 },
  footerBrand: { fontSize: 8, color: "#9CA3AF", fontWeight: "bold" },
  footerPage: { fontSize: 8, color: "#C9C4BB", fontWeight: "bold" },
  // 共通
  colHead: { fontSize: 11, fontWeight: "bold", color: "#374151", marginBottom: 8 },
  muted: { fontSize: 9, color: "#B0A9A4", paddingVertical: 6 },
  // KPI
  kpiRow: { flexDirection: "row", gap: 10 },
  kpi: { flexGrow: 1, flexBasis: 0, backgroundColor: "#F9FAFB", border: "1 solid #EFF0F1", borderRadius: 8, padding: 12 },
  kpiLabel: { fontSize: 9, color: "#6B7280", fontWeight: "bold", marginBottom: 6 },
  kpiValueRow: { flexDirection: "row", alignItems: "flex-end" },
  kpiValue: { fontSize: 22, fontWeight: "bold" },
  kpiUnit: { fontSize: 9, color: "#9CA3AF", fontWeight: "bold", marginLeft: 2, marginBottom: 3 },
  kpiSub: { fontSize: 8, color: "#9CA3AF", marginTop: 4 },
  // 行
  row: { flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 6, paddingVertical: 6, paddingHorizontal: 9, marginBottom: 5 },
  rowAlert: { backgroundColor: "#FEF2F2", border: "1 solid #FEE2E2" },
  rowWbs: { width: 60, fontSize: 8, fontWeight: "bold", color: "#9CA3AF" },
  rowTitle: { flexGrow: 1, flexShrink: 1, fontSize: 9, color: "#374151" },
  rowAssignee: { width: 70, fontSize: 8, color: "#B0A9A4", textAlign: "right", marginLeft: 6 },
  rowRight: { width: 78, fontSize: 8, fontWeight: "bold", textAlign: "right", marginLeft: 6 },
  // バー
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 7 },
  barLabel: { width: 78, fontSize: 9, color: "#374151" },
  barTrack: { flexGrow: 1, height: 12, backgroundColor: "#F0F1F2", borderRadius: 4 },
  barFill: { height: 12, borderRadius: 4 },
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

function Header({ title, desc, period, accent = ACCENT }: { title: string; desc?: string; period?: string; accent?: string }) {
  return (
    <View style={styles.header}>
      <View style={[styles.headerIcon, { backgroundColor: accent }]} />
      <View style={{ flexGrow: 1 }}>
        <Text style={styles.headerTitle}>{title}</Text>
        {desc ? <Text style={styles.headerDesc}>{desc}</Text> : null}
      </View>
      {period ? <Text style={styles.headerPeriod}>{period}</Text> : null}
    </View>
  );
}

function Kpi({ label, value, unit, sub, color }: { label: string; value: string; unit?: string; sub?: string; color?: string }) {
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

function Row({ wbs, title, assignee, right, rightColor, alert, maxLen = 60 }: { wbs?: string; title: string; assignee?: string; right?: string; rightColor?: string; alert?: boolean; maxLen?: number }) {
  return (
    <View style={[styles.row, alert ? styles.rowAlert : {}]} wrap={false}>
      <Text style={styles.rowWbs}>{wbs || "—"}</Text>
      <Text style={styles.rowTitle}>{trunc(title, maxLen)}</Text>
      {assignee ? <Text style={styles.rowAssignee}>{assignee}</Text> : null}
      {right ? <Text style={[styles.rowRight, { color: rightColor || "#6B7280" }]}>{right}</Text> : null}
    </View>
  );
}

// 横棒グラフ（ステータス内訳 / メンバー別負荷）
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

// スループット推移：画面と同じ面グラフ（react-pdfのSVGで描画）
function ThroughputArea({ data, max }: { data: { label: string; count: number }[]; max: number }) {
  const W = 380;
  const H = 130;
  const n = data.length;
  const xs = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const ys = (v: number) => H - (v / max) * (H - 6);
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
      <View style={{ flexDirection: "row", marginTop: 4 }}>
        {data.map((d, i) => (
          <Text key={i} style={{ flexGrow: 1, flexBasis: 0, fontSize: 7, color: "#9CA3AF", textAlign: "center" }}>{d.label}</Text>
        ))}
      </View>
    </View>
  );
}

function ReportDocument({ report, scopeName }: { report: any; scopeName: string }) {
  const period = periodOf(report);
  const sm = SIGNAL_META[report.signal] || SIGNAL_META.green;
  const maxStatus = Math.max(1, ...report.statusBreakdown.map((s: any) => s.count));
  const maxLoad = report.memberLoad[0]?.hours || 1;
  const maxWeek = Math.max(1, ...report.weekBuckets.map((w: any) => w.count));

  return (
    <Document title={`業務レポート_${scopeName}`} author="Dev Ticket">
      {/* ── 表紙 ── */}
      <Page size={[960, 540]} style={{ fontFamily: "NotoSansJP", position: "relative" }}>
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#064E3B" }} />
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 280, backgroundColor: "#059669" }} />
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, paddingHorizontal: 64, paddingVertical: 60, justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 13, color: "#FFFFFF", fontWeight: "bold", backgroundColor: "rgba(255,255,255,0.18)", paddingVertical: 7, paddingHorizontal: 16, borderRadius: 20 }}>業務レポート</Text>
            <Text style={{ fontSize: 13, fontWeight: "bold", color: sm.color, backgroundColor: "#FFFFFF", paddingVertical: 7, paddingHorizontal: 16, borderRadius: 20 }}>総合ステータス：{sm.label}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 46, fontWeight: "bold", color: "#FFFFFF" }}>{scopeName}</Text>
            <Text style={{ fontSize: 18, color: "#D1FAE5", marginTop: 12 }}>{period}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 14 }}>
            {[
              { l: "完了", v: `${report.completed.length}件` },
              { l: "進行中", v: `${report.inProgress.length}件` },
              { l: "残チケット", v: `${report.activeTickets.length}件` },
              { l: "完了率", v: `${report.completionRate}%` },
              { l: "平均サイクル", v: `${report.cycleTime}日` },
            ].map((s, i) => (
              <View key={i} style={{ backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, paddingVertical: 14, paddingHorizontal: 20 }}>
                <Text style={{ fontSize: 11, color: "#D1FAE5", marginBottom: 5 }}>{s.l}</Text>
                <Text style={{ fontSize: 26, fontWeight: "bold", color: "#FFFFFF" }}>{s.v}</Text>
              </View>
            ))}
          </View>
        </View>
      </Page>

      {/* ── エグゼクティブサマリー ── */}
      <Page size={[960, 540]} style={styles.page}>
        <Header title="エグゼクティブサマリー" period={period} />
        <View style={styles.divider} />
        <View style={{ backgroundColor: "#F9FAFB", border: "1 solid #F0F1F2", borderRadius: 10, padding: 18, marginBottom: 16 }}>
          {report.sentences.map((s: string, i: number) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 6 }}>
              <Text style={{ color: ACCENT, fontWeight: "bold", marginRight: 6, fontSize: 12 }}>•</Text>
              <Text style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, flexGrow: 1, flexShrink: 1 }}>{s}</Text>
            </View>
          ))}
        </View>
        <View style={styles.kpiRow}>
          <Kpi label="完了" value={`${report.completed.length}`} unit="件" sub={`前期比 ${deltaLabel(report.completed.length, report.completedPrev.length)}`} color="#059669" />
          <Kpi label="進行中" value={`${report.inProgress.length}`} unit="件" sub={`未着手 ${report.todo.length}件`} color="#D97706" />
          <Kpi label="残チケット" value={`${report.activeTickets.length}`} unit="件" sub={`全体 ${report.totalScoped}件`} color="#2563EB" />
          <Kpi label="完了率" value={`${report.completionRate}`} unit="%" sub={`サイクル ${report.cycleTime}日`} color="#7C3AED" />
        </View>
        <Footer />
      </Page>

      {/* ── ① 進捗（実績） ── */}
      <Page size={[960, 540]} style={styles.page}>
        <Header title="① 進捗（実績）" desc="期間内に完了したチケットと現在のステータス内訳" period={period} />
        <View style={styles.divider} />
        <View style={{ flexDirection: "row", gap: 28 }}>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.colHead}>ステータス内訳</Text>
            {report.statusBreakdown.length === 0 ? <Text style={styles.muted}>データがありません</Text> :
              report.statusBreakdown.map((s: any) => (
                <HBar key={s.key} label={s.label} ratio={s.count / maxStatus} color={s.color} value={`${s.count}`} />
              ))}
          </View>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.colHead}>完了したチケット（{report.completed.length}件）</Text>
            {report.completed.length === 0 && <Text style={styles.muted}>この期間に完了したチケットはありません</Text>}
            {report.completed.slice(0, 9).map((t: any) => (
              <Row key={t.id} wbs={t.wbs} title={t.title} assignee={t.assignee} right={STATUS_META[t.status]?.label} rightColor={STATUS_META[t.status]?.color} maxLen={20} />
            ))}
            {report.completed.length > 9 && <Text style={{ fontSize: 9, color: "#9CA3AF", marginTop: 3 }}>ほか {report.completed.length - 9}件（次ページに続く）</Text>}
          </View>
        </View>
        <Footer />
      </Page>

      {/* 完了チケット 全件（自動改ページ） */}
      {report.completed.length > 9 && (
        <Page size={[960, 540]} style={styles.page}>
          <Header title="完了したチケット（一覧）" />
          <View style={styles.divider} />
          {report.completed.slice(9).map((t: any) => (
            <Row key={t.id} wbs={t.wbs} title={t.title} assignee={t.assignee} right={STATUS_META[t.status]?.label} rightColor={STATUS_META[t.status]?.color} maxLen={58} />
          ))}
          <Footer />
        </Page>
      )}

      {/* ── ② 今後の予定 ── */}
      <Page size={[960, 540]} style={styles.page}>
        <Header title="② 今後の予定（フォーキャスト）" desc="来期の期限・リリース予定・遅延リスク" period={period} accent="#2563EB" />
        <View style={styles.divider} />
        <View style={{ flexDirection: "row", gap: 28 }}>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.colHead}>遅延リスク（超過 {report.overdue.length}件 / 間近 {report.dueSoon.length}件）</Text>
            {report.overdue.length === 0 && report.dueSoon.length === 0 && <Text style={styles.muted}>遅延リスクのあるチケットはありません</Text>}
            {report.overdue.slice(0, 7).map((t: any) => (
              <Row key={t.id} wbs={t.wbs} title={t.title} right={`超過 ${t.dueDate ?? ""}`} rightColor="#DC2626" alert maxLen={22} />
            ))}
            {report.dueSoon.slice(0, 3).map((t: any) => (
              <Row key={t.id} wbs={t.wbs} title={t.title} right={`間近 ${t.dueDate ?? ""}`} rightColor="#D97706" maxLen={22} />
            ))}
            {report.overdue.length > 7 && <Text style={{ fontSize: 9, color: "#9CA3AF", marginTop: 3 }}>期限超過ほか {report.overdue.length - 7}件</Text>}
          </View>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.colHead}>リリース予定（{report.releases.length}件）</Text>
            {report.releases.length === 0 && <Text style={styles.muted}>登録されたリリース予定はありません</Text>}
            {report.releases.slice(0, 10).map((t: any) => (
              <Row key={t.id} wbs={t.releaseDate ?? ""} title={t.title} rightColor="#0D9488" maxLen={26} />
            ))}
            {report.releases.length > 10 && <Text style={{ fontSize: 9, color: "#9CA3AF", marginTop: 3 }}>ほか {report.releases.length - 10}件（次ページに続く）</Text>}
          </View>
        </View>
        <Footer />
      </Page>

      {/* リリース予定 全件 */}
      {report.releases.length > 10 && (
        <Page size={[960, 540]} style={styles.page}>
          <Header title="リリース予定（一覧）" accent="#0D9488" />
          <View style={styles.divider} />
          {report.releases.slice(10).map((t: any) => (
            <Row key={t.id} wbs={t.releaseDate ?? ""} title={t.title} maxLen={80} />
          ))}
          <Footer />
        </Page>
      )}

      {/* ── ③ チーム生産性 ── */}
      <Page size={[960, 540]} style={styles.page}>
        <Header title="③ チーム生産性" desc="スループット・サイクルタイム・工数・負荷" period={period} accent="#7C3AED" />
        <View style={styles.divider} />
        <View style={[styles.kpiRow, { marginBottom: 18 }]}>
          <Kpi label="平均サイクルタイム" value={`${report.cycleTime}`} unit="日" sub="着手→完了" />
          <Kpi label="平均リードタイム" value={`${report.leadTime}`} unit="日" sub="作成→完了" />
          <Kpi label="見積精度" value={`${report.estimateAccuracy}`} unit="%" sub="実績/見積" />
          <Kpi label="総工数" value={`${Math.round((report.actSum / 8) * 10) / 10}`} unit="人日" sub="完了分の実績" />
        </View>
        <View style={{ flexDirection: "row", gap: 28 }}>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.colHead}>スループット推移（直近8週・完了数）</Text>
            <ThroughputArea data={report.weekBuckets} max={maxWeek} />
          </View>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.colHead}>メンバー別負荷（完了分の工数）</Text>
            {report.memberLoad.length === 0 && <Text style={styles.muted}>データがありません</Text>}
            {report.memberLoad.slice(0, 8).map((m: any) => (
              <HBar key={m.name} label={m.name} ratio={m.hours / maxLoad} color="#7C3AED" value={`${formatPersonDays(m.hours)}・${m.count}件`} />
            ))}
          </View>
        </View>
        <Footer />
      </Page>
    </Document>
  );
}

// 生成してダウンロード
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
