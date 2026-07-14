// ENHA2-034 学習セットアップの「お知らせ」役（アプリ全体で1つだけマウント）
//
// ★分析と学習の実体はここではない★
//   デプロイした瞬間に、GitHub Actions (.github/workflows/ml-bootstrap.yml) が
//   サーバー側で全組織のスキル分析＋モデル学習を済ませている。
//   ログインの有無・誰が画面を開いたかに関係なく、もう終わっている。
//   以降も ml-daily.yml が毎日AM3時(JST)に自動で回す。
//
// このコンポーネントの仕事は2つだけ:
//   1. 済んだことを管理者に知らせる（「学習機能が搭載されました」モーダル）
//   2. 自動登録されたスキルの確認へ誘導する（→ メンバー管理へ）
//
//   ＋ 保険として、万一まだ分析されていない組織（デプロイ後に新規作成された組織など）に
//      出会ったら、その場で分析を走らせる。
//
// ★表示対象は「メンバー管理」権限(canAccessMembers)を持つ人だけ★
//   一般ユーザーには何も出さない。

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/app/contexts/AuthContext";
import { isSupabaseEnabled, supabase } from "@/lib/supabase";
import {
  fetchOrgMlState, runSkillAnalysis, markSkillsReviewed, dismissMlNotice,
  fetchSkills, fetchMemberSkills,
} from "@/app/lib/skillsApi";
import { MlNoticeModal, SkillReviewPromptDialog } from "@/app/components/members/MlNoticeModal";

export function MlSetupGate() {
  const { userId, userOrgId, userRole, userPermissions } = useAuth();
  const navigate = useNavigate();

  const [showNotice, setShowNotice] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [examples, setExamples] = useState<string[]>([]);

  const canManageSkills = Boolean(userPermissions.canAccessMembers) || userRole === "owner";

  // 自動登録されたスキルの実例を作る（誘導ダイアログに出す）
  const loadExamples = async (orgId: string) => {
    try {
      const [skills, memberSkills] = await Promise.all([fetchSkills(orgId), fetchMemberSkills()]);
      const byId = new Map(skills.map(s => [s.id, s]));
      const { data: profiles } = await supabase!
        .from("profiles").select("id, name").eq("organization_id", orgId).limit(20);

      const ex = (profiles ?? []).map(p => {
        const mine = memberSkills
          .filter(ms => ms.profileId === p.id)
          .sort((a, b) => b.level - a.level).slice(0, 2)
          .map(ms => `${byId.get(ms.skillId)?.name ?? "?"} Lv${ms.level}`);
        return mine.length > 0 ? `${p.name}さん: ${mine.join(" / ")}` : "";
      }).filter(Boolean).slice(0, 3);

      setExamples(ex);
    } catch {
      setExamples([]);
    }
  };

  useEffect(() => {
    if (!isSupabaseEnabled || !userOrgId || !userId || !canManageSkills) return;

    let cancelled = false;
    (async () => {
      let state = await fetchOrgMlState(userOrgId);
      if (!state || cancelled) return;

      // 保険: デプロイ後に作られた組織など、まだ分析されていなければその場で走らせる。
      // 通常はデプロイ時のワークフローで済んでいるので、ここは通らない。
      if (!state.mlSetupDone) {
        try {
          await runSkillAnalysis(userOrgId);
        } catch {
          return;   // 失敗してもアプリは通常どおり使える（レコメンドが出ないだけ）
        }
        if (cancelled) return;
        state = await fetchOrgMlState(userOrgId);
        if (!state || cancelled) return;
      }

      // スキルの確認がまだ済んでいない組織にだけ、お知らせと誘導を出す。
      if (state.mlSkillsReviewed) return;

      await loadExamples(userOrgId);
      if (cancelled) return;

      // 「次回以降表示しない」にチェック済みの人には、お知らせを飛ばして誘導だけ出す
      const { data: me } = await supabase!
        .from("profiles").select("ml_notice_dismissed").eq("id", userId).maybeSingle();
      if (cancelled) return;

      if (me?.ml_notice_dismissed) setShowReview(true);
      else setShowNotice(true);
    })();

    return () => { cancelled = true; };
  }, [userOrgId, userId, canManageSkills]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canManageSkills) return null;

  return (
    <>
      {showNotice && (
        <MlNoticeModal onClose={async dontShowAgain => {
          setShowNotice(false);
          if (dontShowAgain && userId) await dismissMlNotice(userId);
          setShowReview(true);   // 閉じた後、初回のスキル確認へ誘導
        }} />
      )}

      {showReview && !showNotice && (
        <SkillReviewPromptDialog
          examples={examples}
          onLater={() => setShowReview(false)}
          onReview={async () => {
            setShowReview(false);
            if (userOrgId) await markSkillsReviewed(userOrgId);
            navigate("/members");
          }} />
      )}
    </>
  );
}
