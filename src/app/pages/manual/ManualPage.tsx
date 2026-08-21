import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { BookMarked } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useTabs } from "@/app/contexts/TabContext";
import { MANUAL, type ManualCategoryDef } from "./manualRegistry";
import { meetsRequirement, useAggregatedProjectPermissions } from "./manualPermissions";
import { ManualStep } from "./components/ManualStep";
import { Callout } from "./components/Callout";

export function ManualPage() {
  const { chapterSlug } = useParams();
  const navigate = useNavigate();
  const tabs = useTabs();
  const { userRole } = useAuth();
  const { perms } = useAggregatedProjectPermissions();
  const contentRef = useRef<HTMLDivElement>(null);

  // 権限で章・ステップを出し分け（案A：集約済み perms で判定）
  const visibleCats: ManualCategoryDef[] = useMemo(() => {
    return MANUAL.map((cat) => ({
      ...cat,
      chapters: cat.chapters
        .map((ch) => ({ ...ch, steps: ch.steps.filter((st) => meetsRequirement(st.requirement, perms, userRole)) }))
        .filter((ch) => ch.steps.length > 0),
    })).filter((cat) => cat.chapters.length > 0);
  }, [perms, userRole]);

  const flatChapters = useMemo(() => visibleCats.flatMap((c) => c.chapters), [visibleCats]);
  const active = useMemo(
    () => flatChapters.find((c) => c.slug === chapterSlug) ?? flatChapters[0],
    [flatChapters, chapterSlug],
  );

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [active?.slug]);

  const go = (slug: string) => {
    const path = `/manual/${slug}`;
    if (tabs) tabs.navigateActive(path);
    else navigate(path);
  };

  if (!active) {
    return (
      <div style={{ padding: 40, color: "#6B6458" }}>表示できるマニュアルがありません。</div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", background: "#F7F7F6", fontFamily: "-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif" }}>
      {/* 目次 */}
      <aside style={{ width: 244, flexShrink: 0, background: "#fff", borderRight: "1px solid rgba(26,23,20,0.08)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ padding: "18px 18px 12px", display: "flex", alignItems: "center", gap: 9, borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(145deg,#34D399,#059669)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <BookMarked style={{ width: 16, height: 16, color: "#fff" }} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#1A1714" }}>使い方ガイド</div>
            <div style={{ fontSize: 10, color: "#A09790" }}>Dev Ticket マニュアル</div>
          </div>
        </div>

        <nav style={{ padding: "8px 10px 24px" }}>
          {visibleCats.map((cat) => (
            <div key={cat.id} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#A09790", padding: "8px 10px 4px" }}>
                {cat.emoji} {cat.title}
              </div>
              {cat.chapters.map((ch) => {
                const on = ch.slug === active.slug;
                const Icon = ch.icon;
                return (
                  <button
                    key={ch.slug}
                    onClick={() => go(ch.slug)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                      padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                      background: on ? "#ECFDF5" : "transparent",
                      color: on ? "#047857" : "#3D3732",
                      fontSize: 12.5, fontWeight: on ? 700 : 500, transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => { if (!on) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                    onMouseLeave={(e) => { if (!on) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <Icon style={{ width: 15, height: 15, color: on ? "#059669" : "#9E9690", flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.title}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* 本文 */}
      <div ref={contentRef} style={{ flex: 1, overflowY: "auto" }}>
        <article style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 40px 80px" }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1A1714", margin: "0 0 8px", maxWidth: 820 }}>{active.title}</h1>
          {active.intro && (
            <p style={{ fontSize: 14, color: "#6B6458", lineHeight: 1.8, margin: "0 0 8px", maxWidth: 820 }}>{active.intro}</p>
          )}
          <div style={{ height: 1, background: "rgba(26,23,20,0.08)", margin: "18px 0 26px" }} />

          <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
            {active.steps.map((st, i) => (
              <ManualStep key={i} number={i + 1} title={st.title} description={st.description} requirement={st.requirement}>
                {st.screen?.()}
              </ManualStep>
            ))}
          </div>

          <div style={{ marginTop: 40 }}>
            <Callout variant="tip">
              画面の<strong style={{ color: "#EF4444" }}>赤枠</strong>が操作・確認の対象です。まわりがグレーになっている部分は今は気にしなくてOKです。
            </Callout>
          </div>
        </article>
      </div>
    </div>
  );
}
