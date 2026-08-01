// 選択中のオブジェクトへのリンクをコピーするボタン（右上・ヘルプ/エクスポートの隣）。
//
// Excalidraw 標準の右クリックメニューにも「リンクをコピー」はあるが、
//   ・閲覧モード(viewModeEnabled)ではメニューに出ない
//   ・Mac/iPadアプリ(WKWebView)では Excalidraw 内部のクリップボード処理が失敗し得る
// ため、確実な経路として自前ボタンを併設する。コピーは Capacitor 対応の copyText を使う。
import { Link2 } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { appOrigin } from "@/app/lib/appOrigin";
import { buildWhiteboardLink } from "@/app/lib/whiteboardLink";

interface Props {
  api: any;
  projectSlug: string;
  boardId: string;
  onResult: (message: string) => void;
}

/**
 * 選択内容からリンクの対象IDを決める（Excalidraw の getLinkIdAndTypeFromSelection と同じ規則）。
 *   ・1つだけ選択          → その要素ID
 *   ・複数選択かつグループ  → グループID
 *   ・それ以外              → null（リンクを作れない）
 */
export function linkTargetIdFromSelection(api: any): string | null {
  const st = api.getAppState?.() ?? {};
  const sel = st.selectedElementIds ?? {};
  const ids = Object.keys(sel).filter((id) => sel[id]);
  if (ids.length === 0) return null;

  const elements = (api.getSceneElements() as any[]).filter((e) => sel[e.id] && !e.isDeleted);
  if (elements.length === 1) {
    const el = elements[0];
    // ラベル(bound text)が選ばれている時は入れ物の図形をリンク先にする
    return el.containerId ?? el.id;
  }
  if (elements.length > 1) {
    const groupId = Object.keys(st.selectedGroupIds ?? {}).find((g) => st.selectedGroupIds[g])
      ?? elements[0]?.groupIds?.[0];
    // 全員が同じグループに属している時だけグループリンクにできる
    if (groupId && elements.every((e) => e.groupIds?.includes(groupId))) return groupId;
  }
  return null;
}

export function CopyObjectLinkButton({ api, projectSlug, boardId, onResult }: Props) {
  const handleClick = async () => {
    const id = linkTargetIdFromSelection(api);
    if (!id) {
      onResult("オブジェクトを1つ、またはグループを選択してください");
      return;
    }
    if (!appOrigin()) {
      onResult("共有URLの設定(VITE_PUBLIC_APP_ORIGIN)がないためリンクを作れません");
      return;
    }
    const url = buildWhiteboardLink(projectSlug, boardId, id);
    onResult(await copyText(url) ? "オブジェクトへのリンクをコピーしました" : "コピーに失敗しました");
  };

  return (
    <button
      onClick={handleClick}
      title="選択中のオブジェクトへのリンクをコピー"
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, flexShrink: 0,
        color: "#6B6458", background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8,
        cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <Link2 style={{ width: 15, height: 15 }} />
    </button>
  );
}
