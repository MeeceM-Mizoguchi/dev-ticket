// 404 / アクセス不可 の共通画面。
//
// これまでは「アサインされていないプロジェクト」や「存在しないURL」を開くと、黙って
// プロジェクト一覧やダッシュボードへ飛ばしていた。受け取った側からは
// 「リンクの貼り付けに失敗した」のか「見る権限が無い」のかが区別できず、
// 同じリンクを何度も叩き直す・URLを手で書き換えて試す、という混乱が起きていた。
//
// そこで遷移させず、この画面をその場に描画する。URLはブラウザに残したまま、
//   ・なぜ見られないのか
//   ・開こうとしたURL（＝リンクは正しく届いている、という証拠）
//   ・次にどこへ行けばよいか
// の3点を必ず出す。詳細は docs/not-found-page-design.md 参照。
import { useEffect, useState, type ReactElement } from "react";
import { useNavigate, useLocation, useParams } from "react-router";
import { SearchX, Lock, FolderKanban, LayoutDashboard, Link2 } from "lucide-react";
import { appOrigin } from "@/app/lib/appOrigin";
import {
  checkProjectAccess,
  fetchProjectAccessHint,
  type ProjectAccessTarget,
  type ProjectAccessViewer,
} from "@/app/lib/projectAccess";
import { copyText } from "@/lib/clipboard";
import { useToast } from "@/app/contexts/ToastContext";

export type AccessErrorKind =
  /** URLに対応する画面が無い（打ち間違い・古いURL） */
  | "route"
  /** プロジェクトが存在しない／削除済み／別組織（＝存在を明かさない） */
  | "project"
  /** プロジェクトは開けるが、その中の項目が見つからない（削除済みリンク） */
  | "resource"
  /** プロジェクトは在るが、自分はアサインされていない */
  | "no-access"
  /** アサインはされているが、その機能の権限が none */
  | "no-permission";

export interface NotFoundViewProps {
  kind?: AccessErrorKind;
  /** resource / no-permission で出す対象名。例: "議事録" "レポート管理" */
  label?: string;
  /** no-access で出すプロジェクト名。無ければURLのスラッグを使う */
  projectLabel?: string;
  /** 既定の説明文を丸ごと差し替える（プラン制限の案内など、理由が別物のとき） */
  body?: string;
  /** 説明文に足したい補足 */
  detail?: string;
  /** 主ボタンの行き先を差し替える。例: 議事録一覧へ戻す */
  backTo?: { label: string; to: string };
}

interface Copy {
  code: string;
  tone: "notfound" | "denied";
  title: string;
  body: string;
}

function buildCopy({ kind, label, projectLabel }: NotFoundViewProps): Copy {
  const target = label || "このページ";
  switch (kind) {
    case "project":
      return {
        code: "404", tone: "notfound",
        title: "プロジェクトが見つかりません",
        body: "URLのプロジェクトが存在しないか、削除された可能性があります。URLが途中で切れていないかご確認ください。",
      };
    case "resource":
      return {
        code: "404", tone: "notfound",
        title: `${target}が見つかりません`,
        body: `リンク先の${target}は削除されたか、URLが正しくない可能性があります。`,
      };
    case "no-access":
      return {
        code: "403", tone: "denied",
        title: "このプロジェクトにアクセスできません",
        body: projectLabel
          ? `「${projectLabel}」にアサインされていないため表示できません。閲覧が必要な場合は、プロジェクトの管理者にアサインを依頼してください。`
          : "このプロジェクトにアサインされていないため表示できません。閲覧が必要な場合は、プロジェクトの管理者にアサインを依頼してください。",
      };
    case "no-permission":
      return {
        code: "403", tone: "denied",
        title: `${target}を表示する権限がありません`,
        body: `${target}の閲覧権限が付与されていません。必要な場合は管理者に権限の付与を依頼してください。`,
      };
    default:
      return {
        code: "404", tone: "notfound",
        title: "ページが見つかりません",
        body: "このURLに対応する画面はありません。URLが途中で切れていないか、古いリンクではないかご確認ください。",
      };
  }
}

export function NotFoundView(props: NotFoundViewProps) {
  const { kind = "route", detail, backTo } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const { projectSlug } = useParams();
  const { toast } = useToast();

  // BRU14-001 で RLS を締めた結果、未アサインのプロジェクトは行ごと読めなくなり、
  // 画面からは「存在しない」と区別がつかなくなった。そのままだと同じ組織の
  // 未アサインPJまで 404 になり、「アサインを依頼してください」の案内が出せない。
  // そこで 404 を出す直前にDBへ理由だけを聞き直し、403 に差し替える。
  // 中身は返らないので、これで情報が増えることはない。
  const [hint, setHint] = useState<{ kind: AccessErrorKind; projectLabel?: string } | null>(null);
  useEffect(() => {
    if (kind !== "project" || !projectSlug) { setHint(null); return; }
    let alive = true;
    void fetchProjectAccessHint(projectSlug).then(r => {
      if (!alive || r.access !== "no-access") return;
      setHint({ kind: "no-access", projectLabel: r.projectName ?? undefined });
    });
    return () => { alive = false; };
  }, [kind, projectSlug]);

  const effective: NotFoundViewProps = hint ? { ...props, ...hint } : props;
  const copy = buildCopy(effective);
  if (props.body) copy.body = props.body;
  const path = location.pathname + location.search;
  // 共有できる形（＝相手に見せてもよい形）で出す。ネイティブの capacitor:// は appOrigin() が弾く。
  const fullUrl = `${appOrigin()}${path}`;

  const denied = copy.tone === "denied";
  const accent = denied ? "#D97706" : "#6B7280";
  const accentBg = denied ? "#FEF3C7" : "#F3F4F6";
  const Icon = denied ? Lock : SearchX;

  const handleCopy = async () => {
    if (await copyText(fullUrl)) toast("URLをコピーしました");
    else toast("URLのコピーに失敗しました", "error");
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 520, textAlign: "center" }}>
        <div style={{
          width: 60, height: 60, borderRadius: 18, background: accentBg,
          display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px",
        }}>
          <Icon style={{ width: 26, height: 26, color: accent }} />
        </div>

        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", color: accent,
          fontFamily: "var(--font-mono)", marginBottom: 8,
        }}>
          {copy.code}
        </div>

        <h2 style={{
          fontSize: 19, fontWeight: 800, color: "#1A1714", marginBottom: 10,
          fontFamily: "var(--font-heading)", letterSpacing: "-0.01em",
        }}>
          {copy.title}
        </h2>

        <p style={{ fontSize: 13, color: "#9E9690", lineHeight: 1.75, margin: "0 0 6px" }}>
          {copy.body}
        </p>
        {detail && (
          <p style={{ fontSize: 12.5, color: "#9E9690", lineHeight: 1.7, margin: "0 0 6px" }}>{detail}</p>
        )}

        {/* 「リンクの貼り付けに失敗したのでは？」という誤解を断つための一文。
            これが無いと、同じリンクを何度も叩き直す・URLを手で書き換えて試す、が起きる。 */}
        {kind === "route" ? <div style={{ height: 14 }} /> : (
          <p style={{ fontSize: 12, color: "#C9C4BB", lineHeight: 1.7, margin: "0 0 20px" }}>
            {denied
              ? "リンク自体は正しく開けています。URLを変えて開き直す必要はありません。"
              : "URLは正しく受け取れています。貼り直しても結果は変わりません。"}
          </p>
        )}

        {/* 開こうとしたURL。相手に「このURLを見たい」と伝えるためにコピーもできる。 */}
        {fullUrl && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, textAlign: "left",
            background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10,
            padding: "9px 10px 9px 12px", marginBottom: 22,
          }}>
            <Link2 style={{ width: 13, height: 13, color: "#C9C4BB", flexShrink: 0 }} />
            <span style={{
              flex: 1, minWidth: 0, fontSize: 11.5, color: "#6B6458", fontFamily: "var(--font-mono)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }} title={fullUrl}>
              {fullUrl}
            </span>
            <button onClick={handleCopy} style={{
              flexShrink: 0, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: "#059669",
              background: "rgba(5,150,105,0.08)", border: "none", borderRadius: 6, cursor: "pointer",
            }}>
              コピー
            </button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => navigate(backTo ? backTo.to : "/projects")} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 22px", background: "#059669", color: "#FFF", border: "none",
            borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>
            <FolderKanban style={{ width: 14, height: 14 }} />
            {backTo ? backTo.label : "プロジェクト一覧へ"}
          </button>
          <button onClick={() => navigate("/dashboard")} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 22px", background: "#FFF", color: "#6B6458",
            border: "1px solid rgba(26,23,20,0.12)", borderRadius: 10,
            fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>
            <LayoutDashboard style={{ width: 14, height: 14 }} />
            ダッシュボードへ
          </button>
        </div>
      </div>
    </div>
  );
}

/** ルーターの `*`（どのルートにも当たらないURL）用。 */
export function RouteNotFoundPage() {
  return <NotFoundView kind="route" />;
}

/**
 * プロジェクト配下の画面で使う共通ガード。表示してよければ null、
 * 弾くべきなら出すべき画面を返す。読み込みが終わってから呼ぶこと。
 *
 *   const blocked = projectAccessView(notFound ? null : project, { userRole, userName, userOrgId });
 *   if (!loading && blocked) return blocked;
 */
export function projectAccessView(
  project: (ProjectAccessTarget & { name?: string }) | null | undefined,
  viewer: ProjectAccessViewer,
): ReactElement | null {
  switch (checkProjectAccess(project, viewer)) {
    case "not-found": return <NotFoundView kind="project" />;
    case "no-access": return <NotFoundView kind="no-access" projectLabel={project?.name} />;
    default: return null;
  }
}
