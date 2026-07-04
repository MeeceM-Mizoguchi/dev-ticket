// ArticleDoc(IR) → PDF(Blob)。既存 reportPdf.tsx と同じ @react-pdf/renderer + NotoSansJP 埋め込み方式。
// 実テキスト出力（選択・検索・コピー可）。A4縦。
// react-pdf のブラウザ版は画像埋め込み時に Node の Buffer を参照するため、Vite 環境では polyfill が必要。
import { Buffer as BufferPolyfill } from "buffer";
if (typeof (globalThis as any).Buffer === "undefined") (globalThis as any).Buffer = BufferPolyfill;
import { Document, Page, View, Text, Image, StyleSheet, Font, pdf } from "@react-pdf/renderer";
import type { ArticleDoc, Block, ListBlock, Run } from "./types";
import type { LoadedImage } from "./imageLoader";

Font.register({
  family: "NotoSansJP",
  fonts: [
    { src: "/fonts/NotoSansJP-Regular.ttf", fontWeight: "normal" },
    { src: "/fonts/NotoSansJP-Bold.ttf", fontWeight: "bold" },
  ],
});
Font.registerHyphenationCallback((word) => Array.from(word).map((c) => c));

const PAGE_W = 595, PAD = 40;
const CONTENT_W = PAGE_W - PAD * 2;

const s = StyleSheet.create({
  page: { backgroundColor: "#FFFFFF", fontFamily: "NotoSansJP", fontSize: 10.5, lineHeight: 1.6, color: "#1A1714", paddingTop: 44, paddingBottom: 48, paddingHorizontal: PAD },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 10 },
  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { fontSize: 9, color: "#9E9690", fontWeight: "bold", width: 72 },
  metaValue: { fontSize: 9.5, color: "#4B463F", flex: 1 },
  divider: { height: 1, backgroundColor: "#EEEBE7", marginTop: 12, marginBottom: 16 },
  h1: { fontSize: 16, fontWeight: "bold", marginTop: 12, marginBottom: 6 },
  h2: { fontSize: 14, fontWeight: "bold", marginTop: 10, marginBottom: 5 },
  h3: { fontSize: 12, fontWeight: "bold", marginTop: 8, marginBottom: 4 },
  para: { marginBottom: 6 },
  listRow: { flexDirection: "row", marginBottom: 3 },
  bullet: { width: 18, fontSize: 10.5 },
  quote: { borderLeftWidth: 3, borderLeftColor: "#D8D3CD", paddingLeft: 10, marginVertical: 6, color: "#6B6458" },
  code: { backgroundColor: "#F4F5F6", borderRadius: 6, padding: 10, marginVertical: 6, fontSize: 9.5, color: "#374151" },
  sectionHead: { fontSize: 13, fontWeight: "bold", marginTop: 16, marginBottom: 8 },
  tCell: { borderWidth: 0.5, borderColor: "#D8D3CD", padding: 5, fontSize: 9.5 },
  tHeadCell: { backgroundColor: "#F4F5F6", fontWeight: "bold" },
  aiRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 0.5, borderBottomColor: "#EEEBE7", paddingVertical: 5 },
});

function runStyle(r: Run) {
  // NotoSansJP は italic 変種を登録していないため fontStyle:italic は使わない（解決失敗で描画が落ちる）。
  return {
    fontWeight: r.bold ? ("bold" as const) : undefined,
    textDecoration: r.strike ? ("line-through" as const) : undefined,
    backgroundColor: r.code ? "#F4F5F6" : undefined,
  };
}

function Runs({ runs }: { runs: Run[] }) {
  if (!runs.length) return <Text> </Text>;
  return <>{runs.map((r, i) => <Text key={i} style={runStyle(r)}>{r.text}</Text>)}</>;
}

function List({ block, depth = 0 }: { block: ListBlock; depth?: number }) {
  let n = 0;
  return (
    <View style={{ marginLeft: depth * 16, marginBottom: 4 }}>
      {block.items.map((it, i) => {
        n++;
        const marker = block.ordered ? `${n}.` : "•";
        return (
          <View key={i}>
            <View style={s.listRow}>
              <Text style={s.bullet}>{marker}</Text>
              <Text style={{ flex: 1 }}><Runs runs={it.runs} /></Text>
            </View>
            {it.sub && <List block={it.sub} depth={depth + 1} />}
          </View>
        );
      })}
    </View>
  );
}

function Table({ block }: { block: Block & { type: "table" } }) {
  const cols = Math.max(...block.rows.map(r => r.length), 1);
  const widths = block.colWidths && block.colWidths.length
    ? normalize(block.colWidths, cols)
    : new Array(cols).fill(1 / cols);
  return (
    <View style={{ marginVertical: 8 }}>
      {block.rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: "row" }}>
          {Array.from({ length: cols }).map((_, ci) => {
            const cell = row[ci];
            return (
              <View key={ci} style={[s.tCell, cell?.header ? s.tHeadCell : {}, { width: CONTENT_W * widths[ci] }]}>
                <Text><Runs runs={cell?.runs ?? [{ text: "" }]} /></Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function normalize(ws: number[], cols: number): number[] {
  const arr = new Array(cols).fill(0).map((_, i) => ws[i] || 0);
  const sum = arr.reduce((a, b) => a + b, 0);
  if (sum <= 0) return new Array(cols).fill(1 / cols);
  return arr.map(w => (w > 0 ? w / sum : 0)).map(w => (w > 0 ? w : (1 / cols)));
}

function Img({ url, images }: { url: string; images: Map<string, LoadedImage> }) {
  const im = images.get(url);
  if (!im) return null;
  const ptW = im.width * 0.75; // px→pt 目安
  const w = Math.min(ptW || CONTENT_W, CONTENT_W);
  const h = im.width ? (w * im.height) / im.width : undefined;
  return <Image src={im.dataUrl} style={{ width: w, height: h, marginVertical: 8 }} />;
}

function Blocks({ blocks, images }: { blocks: Block[]; images: Map<string, LoadedImage> }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading": return <Text key={i} style={b.level === 1 ? s.h1 : b.level === 2 ? s.h2 : s.h3}><Runs runs={b.runs} /></Text>;
          case "paragraph": return <Text key={i} style={s.para}><Runs runs={b.runs} /></Text>;
          case "list": return <List key={i} block={b} />;
          case "blockquote": return <View key={i} style={s.quote}><Blocks blocks={b.blocks} images={images} /></View>;
          case "codeblock": return <View key={i} style={s.code}><Text>{b.text}</Text></View>;
          case "table": return <Table key={i} block={b} />;
          case "image": return <Img key={i} url={b.url} images={images} />;
          default: return null;
        }
      })}
    </>
  );
}

function ArticlePdf({ doc, images }: { doc: ArticleDoc; images: Map<string, LoadedImage> }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{doc.title || "無題"}</Text>
        {doc.meta.map((m, i) => (
          <View key={i} style={s.metaRow}>
            <Text style={s.metaLabel}>{m.label}</Text>
            <Text style={s.metaValue}>{m.value}</Text>
          </View>
        ))}
        <View style={s.divider} />
        <Blocks blocks={doc.blocks} images={images} />
        {doc.actionItems && doc.actionItems.length > 0 && (
          <View>
            <Text style={s.sectionHead}>アクションアイテム</Text>
            {doc.actionItems.map((a, i) => (
              <View key={i} style={s.aiRow}>
                <Text style={{ width: 16 }}>{a.done ? "☑" : "☐"}</Text>
                <Text style={{ width: 56, fontSize: 9, color: "#9E9690" }}>{a.category}</Text>
                <Text style={{ flex: 1 }}>{a.title}</Text>
              </View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function renderPdf(doc: ArticleDoc, images: Map<string, LoadedImage>): Promise<Blob> {
  return pdf(<ArticlePdf doc={doc} images={images} />).toBlob();
}
