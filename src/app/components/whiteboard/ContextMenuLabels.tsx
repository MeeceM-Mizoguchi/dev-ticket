// 右クリックメニューの文言を日本語に差し替える（ホワイトボード内だけ）。
//
// Excalidraw 0.18.1 の「オブジェクトへのリンク」系メニューは ja-JP ロケールに翻訳が無く、
// 英語のまま表示される（他の項目は日本語）。ロケールを外から差し替えるAPIが無いため、
// メニューが開いた瞬間にラベル要素のテキストだけを置き換える。
// 置換対象が見つからなければ何もしない（＝Excalidraw 側の文言が変わっても壊れない）。
import { useEffect } from "react";

const LABELS: Record<string, string> = {
  "Copy link to object": "オブジェクトへのリンクをコピー",
  "Link to object": "他のオブジェクトへリンク",
};

export function ContextMenuLabels({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const apply = () => {
      const labels = root.querySelectorAll<HTMLElement>(".context-menu-item__label");
      labels.forEach((el) => {
        const ja = LABELS[(el.textContent ?? "").trim()];
        if (ja) el.textContent = ja;
      });
    };

    // メニューは開くたびに生成/破棄されるので、DOM追加を監視して都度あてる
    const mo = new MutationObserver(apply);
    mo.observe(root, { childList: true, subtree: true });
    apply();
    return () => mo.disconnect();
  }, [containerRef]);

  return null;
}
