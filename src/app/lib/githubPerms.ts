// GitHub連携の操作ごと権限（BRU13-054）の読み取りと合成。
//
// 権限は project_member_permissions / permission_groups / roles の jsonb に
// キーとして入っている。読み手が4か所（AuthContext・useGithubAccess・
// PermissionsPage・GithubIntegrationSetting）あり、それぞれで
// 「新キーが無ければ旧キーから展開する」を書くと必ずずれるのでここに集約する。
//
// ※ サーバー側 api/github/[resource].ts は単体で動く決まりなので、
//   同じ判定をあちらにも書いてある。片方を直したら必ず両方直すこと。
import type { GithubAccessLevel, GithubActionKey, GithubActionLevel, GithubPerms } from "@/app/types";

/** 画面で回す順番。権限設定の並び順もこれに従う */
export const GITHUB_ACTION_KEYS: GithubActionKey[] = ["branch", "pull", "merge"];

export const NO_GITHUB_PERMS: GithubPerms = { pull: "none", merge: "none", branch: "none" };
export const FULL_GITHUB_PERMS: GithubPerms = { pull: "write", merge: "write", branch: "write" };

const RANK: Record<GithubActionLevel, number> = { none: 0, view: 1, write: 2 };

/** jsonb に入っていた値を GithubActionLevel に均す。未知の値は none 扱い */
function level(v: unknown): GithubActionLevel | undefined {
  return v === "none" || v === "view" || v === "write" ? v : undefined;
}

/**
 * 旧 githubPermission (none/view/merge) を3軸へ展開する。
 * merge は「PRのマージができる」＝当時の最上位なので、3軸とも write にする。
 * 移行SQL（supabase/add_github_split_permissions.sql）と同じ対応表。
 */
export function fromLegacyGithubLevel(v: unknown): GithubPerms | null {
  if (v === "merge") return { ...FULL_GITHUB_PERMS };
  if (v === "view") return { pull: "view", merge: "view", branch: "view" };
  if (v === "none") return { ...NO_GITHUB_PERMS };
  return null;
}

/**
 * 権限が入った jsonb 1件から3軸を取り出す。
 * 「この階層には何も書かれていない」を null で返す。呼び出し側は次の階層へ降りる。
 *
 * 新キーが1つでもあれば新形式とみなし、欠けた軸だけを旧キー（無ければ none）で埋める。
 * 移行SQLを当てる前でも、当てた後でも同じ結論になるようにするため。
 */
export function githubPermsFrom(raw: unknown): GithubPerms | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const pull = level(o.githubPullPermission);
  const merge = level(o.githubMergePermission);
  const branch = level(o.githubBranchPermission);
  const legacy = fromLegacyGithubLevel(o.githubPermission);

  if (pull === undefined && merge === undefined && branch === undefined) return legacy;
  return {
    pull: pull ?? legacy?.pull ?? "none",
    merge: merge ?? legacy?.merge ?? "none",
    branch: branch ?? legacy?.branch ?? "none",
  };
}

/** 軸ごとに強いほうを採る。複数グループに属している場合の合成に使う */
export function strongerGithubPerms(a: GithubPerms, b: GithubPerms): GithubPerms {
  const pick = (x: GithubActionLevel, y: GithubActionLevel) => (RANK[x] >= RANK[y] ? x : y);
  return { pull: pick(a.pull, b.pull), merge: pick(a.merge, b.merge), branch: pick(a.branch, b.branch) };
}

/**
 * GitHubタブを開けるか。
 * 軸ごとに閲覧ゲートを持つと「PRは見えるがマージ状況は見えない」といった
 * 破綻した組み合わせが作れてしまうため、閲覧だけは3軸の論理和で判定する。
 */
export function canViewGithub(p: GithubPerms | undefined): boolean {
  return !!p && (p.pull !== "none" || p.merge !== "none" || p.branch !== "none");
}

/** 3軸を旧形式の1段階へ畳む。旧いUI・表示（バッジや件数）との互換用 */
export function toLegacyGithubLevel(p: GithubPerms | undefined): GithubAccessLevel {
  if (!p) return "none";
  if (p.merge === "write") return "merge";
  return canViewGithub(p) ? "view" : "none";
}

/** 権限を書き戻すときの jsonb 断片。旧キーも一緒に更新して、未移行の読み手とずれないようにする */
export function githubPermsToJson(p: GithubPerms): Record<string, string> {
  return {
    githubPullPermission: p.pull,
    githubMergePermission: p.merge,
    githubBranchPermission: p.branch,
    githubPermission: toLegacyGithubLevel(p),
  };
}
