import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

// 旧プロジェクト識別子で着地したときに、URLを現行の識別子へ静かに寄せる。
//
// ページ側は findProjectBySlug() が viaAlias:true を返したときだけ canonicalSlug を渡す。
// （slug ではなくプロジェクトIDで開いた場合は従来どおりURLを触らない。IDで開けるのは
//   意図的な仕様なので、勝手に書き換えると既存の使い方を壊す）
//
// replace で置き換えるので「戻る」で旧URLへ戻ってループすることはない。
export function useCanonicalSlugRedirect(
  paramSlug: string | undefined,
  canonicalSlug: string | null | undefined,
): void {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!paramSlug || !canonicalSlug || paramSlug === canonicalSlug) return;

    // useLocation() は「実ルーターの現在地」を返す。タブモード(Mac/iPad)の非アクティブ
    // タブは <Routes location={固定パス}> で描画されているため、ここが一致しない。
    // その状態で navigate するとアクティブタブを横取りしてしまうので、
    // 実際に旧slugのURLを表示しているときだけ書き換える。
    const path = location.pathname;
    const firstSegRaw = path.replace(/^\//, "").split("/")[0] ?? "";
    let firstSeg: string;
    try {
      firstSeg = decodeURIComponent(firstSegRaw);
    } catch {
      return;
    }
    if (firstSeg !== paramSlug) return;

    // 残りのセグメントはエンコード済みのまま持ち回る（二重エンコードを避ける）
    const rest = path.slice(1 + firstSegRaw.length);
    const next = `/${encodeURIComponent(canonicalSlug)}${rest}${location.search}${location.hash}`;
    if (next === path + location.search + location.hash) return;
    navigate(next, { replace: true });
  }, [paramSlug, canonicalSlug, location.pathname, location.search, location.hash, navigate]);
}
