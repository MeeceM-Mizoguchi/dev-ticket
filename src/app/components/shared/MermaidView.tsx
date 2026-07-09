// Mermaid 図のプレビュー表示コンポーネント。RichEditor のコードブロック NodeView や
// ホワイトボードの生成モーダルから使う。
//
// 性能対策(重要): コメント一覧・アクションメモ一覧などでは readOnly の RichEditor が多数
// マウントされる。全図を即描画すると重いため、IntersectionObserver で画面内に入って初めて
// 描画する。コード変更時は 250ms デバウンスして再描画（編集中の一文字ごとの再描画を防ぐ）。
import { useEffect, useRef, useState } from "react";
import { renderMermaid } from "@/app/lib/mermaid";

// 拡大表示用: SVG を viewBox 由来の「自然サイズ(px)」に固定する。
// これで図の要素数に関わらず“1ノードあたりの表示倍率”が一定になり、少ない図が過剰に
// 大きく表示される問題を防ぐ（mermaid が付ける width="100%"/max-width も打ち消す）。
function toNaturalSizeSvg(svg: string): string {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const el = doc.documentElement;
    if (el && el.nodeName.toLowerCase() === "svg") {
      const vb = (el.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        el.setAttribute("width", String(vb[2]));
        el.setAttribute("height", String(vb[3]));
      }
      el.removeAttribute("style");
      return new XMLSerializer().serializeToString(el);
    }
  } catch { /* パース失敗時はそのまま */ }
  return svg;
}

interface Props {
  code: string;
  // 図の寄せ（既定は左寄せ）。エディタ内は左、モーダルは中央など。
  align?: "left" | "center";
  // 最小の高さ（描画前のプレースホルダ高さ）。
  minHeight?: number;
  // true のとき図を「自然サイズ」で表示（拡大表示ライトボックス用）。要素数によらず縮尺が一定。
  // 親コンテナより大きい図は max-width:100% で画面に収める（引き伸ばしはしない）。
  natural?: boolean;
}

export function MermaidView({ code, align = "left", minHeight = 40, natural = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  // 画面内に入ったら描画対象にする（一度可視になれば以後は常に描画）。
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // 可視かつコード変更時にデバウンス描画。
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await renderMermaid(code);
      if (cancelled) return;
      if ("svg" in res) {
        setSvg(res.svg);
        setError("");
      } else {
        // 直前の正常な図は残したまま、エラーだけ更新する（編集中の一時的な不正入力で
        // 図が消えてチラつくのを防ぐ）。
        setError(res.error);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [visible, code]);

  const hasCode = (code ?? "").trim().length > 0;

  return (
    <div
      ref={ref}
      contentEditable={false}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        minHeight,
        overflowX: "auto",
      }}
    >
      {natural && (
        // 自然サイズ表示: 親より大きい図は縮小して画面に収める（小さい図は等倍のまま）。
        <style>{`.mermaid-svg-natural svg { max-width: 100% !important; height: auto !important; }`}</style>
      )}
      {svg ? (
        // strict モードで mermaid がサニタイズ済みの SVG（<script>やイベント属性なし）を描画する。
        <div className={natural ? "mermaid-svg mermaid-svg-natural" : "mermaid-svg"} style={{ maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: natural ? toNaturalSizeSvg(svg) : svg }} />
      ) : error ? (
        <div style={{ fontSize: 12, color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "8px 10px", whiteSpace: "pre-wrap" }}>
          図を生成できませんでした：{error}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#B0A9A4", padding: "6px 2px" }}>
          {hasCode ? "図を生成中…" : "Mermaidの定義を入力してください"}
        </div>
      )}
      {/* 正常図を保持しつつエラーが出ている場合（編集中の途中状態）は、控えめに注意書きを出す。 */}
      {svg && error && (
        <div style={{ fontSize: 11, color: "#B45309", marginTop: 4 }}>
          ※ 現在の記述にエラーがあります：{error}
        </div>
      )}
    </div>
  );
}
