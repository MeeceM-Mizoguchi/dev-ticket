// ============================================================
// マニュアルの権限出し分け（案A）
// ------------------------------------------------------------
// マニュアルは全ユーザーがアクセスできるが、各章・各ステップは
// 「必要権限」を持つ人にだけ表示する（サイドバーの表示制御と同方式）。
//
// 権限は2系統:
//  1) ロール設定系（メンバー管理・レポート管理 等）
//     → useAuth().userPermissions（ロールの base_permissions）で即判定
//  2) アサイン計画系（チケット作成・Wiki編集 等）
//     → project_member_permissions にプロジェクト毎に保存。
//       案A: 参加している全プロジェクトをOR集約し、
//            どれか1つで権限があれば「あり」とみなす。
// ============================================================
import { useEffect, useState } from "react";
import type { AccessLevel, Role, UserPermissions } from "@/app/types";
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

// 管理者相当（全権限を持つとみなすロール）
const ADMIN_ROLES = ["owner", "admin", "project-manager"];

/** boolトグル権限のキー */
export type BoolPermKey =
  | "canCreateTicket" | "canCreateSprint" | "canEditDelete" | "canReview" | "canSkipReview"
  | "canAccessMembers" | "canAccessRoles" | "canAccessGroups" | "canAccessAdminSettings"
  | "canUpdateAnnouncement" | "canAccessReports";

/** 閲覧/編集レベル権限のキー */
export type LevelPermKey =
  | "wikiPermission" | "backlogPermission" | "minutesPermission" | "whiteboardPermission";

/**
 * 章・ステップの表示要件。
 *  - 未指定 / { kind:'all' } … 全ユーザーに表示
 *  - { kind:'flag' }        … 指定のbool権限がtrueなら表示
 *  - { kind:'level' }       … 指定のページ権限が min 以上なら表示
 *  - { kind:'role' }        … 指定ロールなら表示（プロジェクト作成等・トグルでない権限）
 */
export type Requirement =
  | { kind: "all" }
  | { kind: "flag"; flag: BoolPermKey }
  | { kind: "level"; key: LevelPermKey; min: "view" | "edit" }
  | { kind: "role"; roles: Role[] };

/** よく使う要件のショートカット */
export const REQ = {
  all: { kind: "all" } as Requirement,
  adminOrPM: { kind: "role", roles: ADMIN_ROLES } as Requirement,
  flag: (flag: BoolPermKey): Requirement => ({ kind: "flag", flag }),
  level: (key: LevelPermKey, min: "view" | "edit"): Requirement => ({ kind: "level", key, min }),
};

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

function maxLevel(a: AccessLevel, b: AccessLevel): AccessLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/**
 * 参加している全プロジェクトの権限をOR集約した「実効権限」を返すフック。
 * ロール由来の権限（userPermissions）を土台に、
 * project_member_permissions の各行をOR/最大レベルでマージする。
 */
export function useAggregatedProjectPermissions(): { perms: UserPermissions; loaded: boolean } {
  const { userId, userRole, userPermissions } = useAuth();
  const [perms, setPerms] = useState<UserPermissions>(userPermissions);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // 管理者相当は全権限を持つ。DB照会不要。
    const isAdmin = ADMIN_ROLES.includes(userRole);
    if (isAdmin || !isSupabaseEnabled || !userId) {
      setPerms(userPermissions);
      setLoaded(true);
      return;
    }

    (async () => {
      const { data } = await supabase!
        .from("project_member_permissions")
        .select("permissions")
        .eq("member_id", userId);
      if (cancelled) return;

      // ロール由来の権限を土台にOR集約
      const merged: UserPermissions = { ...userPermissions };
      for (const row of data ?? []) {
        const p = (row.permissions ?? {}) as Partial<UserPermissions>;
        for (const k of Object.keys(p) as (keyof UserPermissions)[]) {
          const v = p[k];
          if (typeof v === "boolean") {
            (merged as any)[k] = (merged as any)[k] || v;
          } else if (v === "none" || v === "view" || v === "edit") {
            (merged as any)[k] = maxLevel((merged as any)[k] ?? "none", v);
          }
        }
      }
      setPerms(merged);
      setLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [userId, userRole, userPermissions]);

  return { perms, loaded };
}

/** 要件を満たすか判定する */
export function meetsRequirement(
  req: Requirement | undefined,
  perms: UserPermissions,
  role: Role,
): boolean {
  if (!req || req.kind === "all") return true;
  if (req.kind === "flag") return !!perms[req.flag];
  if (req.kind === "level") {
    const lvl = (perms[req.key] as AccessLevel) ?? "none";
    return LEVEL_RANK[lvl] >= LEVEL_RANK[req.min];
  }
  if (req.kind === "role") return req.roles.includes(role);
  return true;
}

/** 要件を日本語ラベルに変換（本文の権限注記に使用） */
export function requirementLabel(req: Requirement | undefined): string {
  if (!req || req.kind === "all") return "全ユーザー";
  if (req.kind === "role") return "管理者・PMロールの人";
  if (req.kind === "flag") {
    const map: Record<BoolPermKey, string> = {
      canCreateTicket: 'アサイン計画で「チケット作成」権限がある人',
      canCreateSprint: 'アサイン計画で「スプリント作成」権限がある人',
      canEditDelete: 'アサイン計画で「編集・削除」権限がある人',
      canReview: 'アサイン計画で「レビュー権限」がある人',
      canSkipReview: 'ロール設定で「レビュースキップ」権限がある人',
      canAccessMembers: 'ロール設定で「メンバー管理」権限がある人',
      canAccessRoles: 'ロール設定で「ロール設定」権限がある人',
      canAccessGroups: 'ロール設定で「アサイン計画」権限がある人',
      canAccessAdminSettings: 'ロール設定で「通知管理」権限がある人',
      canUpdateAnnouncement: 'ロール設定で「お知らせ更新」権限がある人',
      canAccessReports: 'ロール設定で「レポート管理」権限がある人',
    };
    return map[req.flag];
  }
  if (req.kind === "level") {
    const name: Record<LevelPermKey, string> = {
      wikiPermission: "Wiki", backlogPermission: "バックログ",
      minutesPermission: "議事録", whiteboardPermission: "ホワイトボード",
    };
    const lv = req.min === "edit" ? "編集" : "閲覧以上";
    return `アサイン計画で「${name[req.key]}」が${lv}の人`;
  }
  return "全ユーザー";
}
