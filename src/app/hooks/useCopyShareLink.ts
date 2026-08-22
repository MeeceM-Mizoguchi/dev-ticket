import { useCallback } from "react";
import { copyText } from "@/lib/clipboard";
import { useToast } from "@/app/contexts/ToastContext";
import { buildShareLink, type ShareTarget } from "@/app/lib/shareLink";

/**
 * ページ/フォルダ単位の共有リンクをクリップボードへコピーする共通フック。
 * Wiki・議事録・バックログ・ファイルボックスで文言と失敗時の扱いを揃えるために置いている。
 */
export function useCopyShareLink(projectSlug: string | null | undefined) {
  const { toast } = useToast();
  return useCallback(async (target: ShareTarget) => {
    const url = buildShareLink(projectSlug ?? "", target);
    if (!url) {
      toast("共有URLの設定(VITE_PUBLIC_APP_ORIGIN)がないためリンクを作れません", "error");
      return;
    }
    if (await copyText(url)) toast("リンクをコピーしました");
    else toast("リンクのコピーに失敗しました", "error");
  }, [projectSlug, toast]);
}
