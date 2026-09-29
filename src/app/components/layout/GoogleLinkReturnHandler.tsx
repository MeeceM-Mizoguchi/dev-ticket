import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useToast } from "@/app/contexts/ToastContext";
import { useGoogleAccountLink } from "@/app/hooks/useGoogleAccountLink";
import { grantGoogleToSelf, GOOGLE_RESULT_PARAM, GOOGLE_MESSAGE_PARAM } from "@/app/lib/googleDrive";

// Googleアカウントの連携から戻ってきたときの後処理（BRU17-028）。
//
// 連携は右上のメニュー・ファイルボックスなど、どの画面からでも始まり、終わると元の画面へ
// ?google=success|error 付きで戻ってくる。ここで結果を伝え、成功なら既存のGoogleファイルへ
// 紐づけたアドレスの権限を付け直す（それまでは招待メールのアドレス宛てにしか配られていない）。
//
// ★ ProtectedShell に1つだけ置く。Topbar に置くと、タブレット版はタブの数だけ Topbar が
//   マウントされるので、付け直しがタブの数だけ走る。
// ★ 外部連携画面(/admin-settings)は自前でバナーを出してクエリを消すので、そちらには触らない。
//   付け直しだけはどの画面でも行う。

let handled = false;

export function GoogleLinkReturnHandler() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { reload } = useGoogleAccountLink();

  // 外部連携画面は描画直後の effect でクエリを消すので、描画中に読んで押さえておく
  const [result] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      status: params.get(GOOGLE_RESULT_PARAM),
      message: params.get(GOOGLE_MESSAGE_PARAM),
      onAdminSettings: window.location.pathname.startsWith("/admin-settings"),
    };
  });

  useEffect(() => {
    if (handled) return;
    if (result.status !== "success" && result.status !== "error") return;
    handled = true;

    if (!result.onAdminSettings) {
      const params = new URLSearchParams(location.search);
      params.delete(GOOGLE_RESULT_PARAM);
      params.delete(GOOGLE_MESSAGE_PARAM);
      const qs = params.toString();
      navigate({ pathname: location.pathname, search: qs ? `?${qs}` : "" }, { replace: true });
      if (result.status === "error") {
        toast(result.message || "Googleアカウントを紐づけられませんでした", "error");
      } else {
        toast("Googleアカウントを紐づけました");
      }
    }
    if (result.status !== "success") return;

    void (async () => {
      await reload().catch(() => undefined);
      try {
        const r = await grantGoogleToSelf();
        if (r.failed.length > 0) {
          const names = r.failed.slice(0, 3).map(f => `「${f.name}」`).join("、");
          const more = r.failed.length > 3 ? ` ほか ${r.failed.length - 3} 件` : "";
          toast(`紐づけたGoogleアカウントに共有できなかったファイルがあります：${names}${more}（${r.failed[0].reason}）`, "error");
        } else if (r.granted > 0) {
          toast(`紐づけたGoogleアカウントで、Googleファイル ${r.granted} 件を開けるようにしました`);
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : "Googleファイルの共有を更新できませんでした", "error");
      }
    })();
    // 戻ってきた直後に1回だけ行う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
