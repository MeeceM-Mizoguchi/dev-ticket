// チケット詳細の「関連PR」（docs/github-integration-design.md 8-5）。
//
// view … 一覧の閲覧のみ。merge … 紐付けの追加・解除・PRの作成・マージができる。
// 自動検出の行には根拠（ブランチ名／タイトル）を必ず添える。誤検出を人が判断できるようにするため。
//
// BRU13-013 でチケット側から完結できるようにした：
//  ・ブランチ名に WBS 番号を含む「まだPRが無いブランチ」を候補として出し、その場でPRを作る
//  ・「リリース待ち」以降は、紐付いたPRをこの画面からマージできる
//  ・PRが発生しないチケット（仕様確認・ドキュメント等）は「PR不要」で未紐付けアラートを畳める
//
// BRU13-015：
//  ・紐付いたPRの行からリンクをコピーできるようにした
//  ・PRが1件も紐付いていないときは、開いた時点で紐付け候補を出す。
//    「PRを紐付ける」を押すまで何も始まらない状態を無くすため
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, GitBranch, GitPullRequest, Github, Link2, Loader2, Plus, X } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import {
  fetchTicketLinks, fetchPulls, fetchPull, fetchBranches, fetchPendingBranches,
  linkTicket, unlinkTicket, mergePull, resolveLinkCandidate, relativeTime, GithubApiError,
} from "@/app/lib/github";
import { isPrLinkAlertStatus } from "@/app/lib/prLinkAlert";
import { CreatePullDialog } from "@/app/components/github/CreatePullDialog";
import { MergeConfirmDialog } from "@/app/components/github/MergeConfirmDialog";
import type {
  TicketGithubLink, TicketGithubLinkCandidate, GithubPull, GithubBranch, GithubPendingBranch,
  GithubAccessLevel, GithubMergeMethod, TicketStatus,
} from "@/app/types";

const BLACK = "#1F2328";

/** ブランチ候補を探しにいかないステータス。まだコミットが無い／作業が止まっているもの */
const CANDIDATE_SKIP_STATUSES: TicketStatus[] = ["todo", "on-hold", "withdrawn"];

/** 親（チケット詳細）へ渡す状態。リリースノート追加後の案内と離脱確認の判断に使う */
export interface TicketPrState {
  /** どのチケットの状態か。チケットを切り替えた直後に前のチケットの合図を誤って使わないため */
  ticketId: string;
  loaded: boolean;
  /**
   * このセクションの表示が確定したか（BRU13-016）。
   * 紐付け一覧に加えて、あとから差し込まれる「PR作成候補」「紐付け候補」まで出揃った状態。
   * チケット詳細の初回ロード用オーバーレイは、これが立つまで外さない
   */
  settled: boolean;
  level: GithubAccessLevel;
  /** 紐付いているPRの件数 */
  pullCount: number;
}

export function TicketPrSection({
  projectId, projectSlug, ticketId, wbs, ticketStatus, prLinkWaived, guide,
  onStateChange, onWaiveChange, onLinked,
}: {
  projectId: string;
  /** PR本文にチケットのURLを載せるために使う */
  projectSlug?: string;
  ticketId: string;
  /** 未紐付けのPRから候補を絞る／ブランチ候補を探すために使う */
  wbs?: string;
  /** マージボタンを出すかの判断に使う。「リリース待ち」以降だけ出す */
  ticketStatus?: TicketStatus;
  prLinkWaived?: boolean;
  /** リリースノート追加直後の強調案内を出す */
  guide?: boolean;
  onStateChange?: (state: TicketPrState) => void;
  onWaiveChange?: (waived: boolean) => void;
  /** PRを作成・紐付けした直後。一覧側のアラートを取り直させる */
  onLinked?: () => void;
}) {
  const { userName } = useAuth();
  const { toast } = useToast();
  const [links, setLinks] = useState<TicketGithubLink[]>([]);
  /** 大文字小文字違いで割れていて、自動紐付けを見送ったPR */
  const [linkCandidates, setLinkCandidates] = useState<TicketGithubLinkCandidate[]>([]);
  const [level, setLevel] = useState<GithubAccessLevel>("none");
  const [repo, setRepo] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState<GithubPull[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  // 紐付け処理中のPR番号。押した行そのものに進捗を出すために持つ（BRU13-017）。
  // 候補の行を押してから完了までは通信2往復（紐付け＋取り直し）あって数秒かかるため、
  // 何も出ないと固まったように見える
  const [linking, setLinking] = useState<number | null>(null);

  // このチケットのブランチ候補（ブランチ名に WBS 番号を含み、まだPRが無いもの）
  const [candidates, setCandidates] = useState<GithubPendingBranch[] | null>(null);
  // 「出す／出さない」が決まったか。GitHubを叩かずに決まるケースはその場で true にして待たせない
  const [candidatesSettled, setCandidatesSettled] = useState(false);
  const [pickerSettled, setPickerSettled] = useState(false);
  const [createTarget, setCreateTarget] = useState<{ branches: GithubBranch[]; defaultBranch: string; head?: string } | null>(null);
  const [preparingCreate, setPreparingCreate] = useState(false);
  /** マージ確認を開くために詳細を引いている最中のPR番号 */
  const [preparingMerge, setPreparingMerge] = useState<number | null>(null);
  const [mergeTarget, setMergeTarget] = useState<GithubPull | null>(null);

  const pullLinks = useMemo(() => links.filter(l => l.kind === "pull"), [links]);
  const canMergeHere = level === "merge" && !!ticketStatus && isPrLinkAlertStatus(ticketStatus);

  // サーバー側の検出は大文字に正規化されている。チケットの WBS 番号は
  // プロジェクトが決めた綴りのままなので、突き合わせる前に揃える
  const wbsKey = wbs ? wbs.toUpperCase() : "";

  // 候補は WBS 番号ごとにまとめて出す。「この番号のPRはどれか」を1回で選ばせる
  const candidateGroups = useMemo(() => {
    const m = new Map<string, TicketGithubLinkCandidate[]>();
    for (const c of linkCandidates) m.set(c.wbsKey, [...(m.get(c.wbsKey) ?? []), c]);
    return Array.from(m.entries());
  }, [linkCandidates]);

  const load = useCallback(async () => {
    try {
      const r = await fetchTicketLinks(projectId, ticketId);
      setLinks(r.links);
      setLinkCandidates(r.candidates ?? []);
      setLevel(r.level);
      setRepo(r.repo);
    } catch {
      // リポジトリ未紐付け・権限なしはセクションごと出さない。エラー表示はしない
      setLevel("none");
    } finally {
      setLoaded(true);
    }
  }, [projectId, ticketId]);

  // チケットを切り替えたときは、前のチケットの表示・確定状態をすべて捨ててから読み直す。
  // 残したままだと、前のチケットのPRが一瞬見えるうえ、下の「表示が確定した」合図が
  // 新しいチケットのIDを付けて即座に上がり、親のオーバーレイが待たずに外れてしまう。
  //
  // useEffect ではなくレンダー中に切り替えるのは、副作用だと1フレーム分だけ
  // 前のチケットの値のまま親へ通知が飛ぶため（React の「props に合わせて state を調整する」パターン。
  // この回のレンダー結果は破棄され、更新後の値で描き直されるので副作用は走らない）。
  // 紐付け操作後の load() は再取得だけなので、ここは通らない＝セクションが消えてチカつくこともない
  const shownKey = `${projectId}|${ticketId}`;
  const [loadedKey, setLoadedKey] = useState(shownKey);
  if (loadedKey !== shownKey) {
    setLoadedKey(shownKey);
    setLoaded(false);
    setLinks([]);
    setLinkCandidates([]);
    setLevel("none");
    setCandidates(null);
    setCandidatesSettled(false);
    setPickerSettled(false);
    setAvailable(null);
    setPicking(false);
  }

  // 非同期の完了が「今開いているチケットのものか」を、effect の再実行に左右されずに判定する。
  // 「確定した」の合図はこの ref で見張る（cleanup の alive フラグだと、
  //  同じチケットのまま effect が張り直されただけでも合図が落ちてしまう）
  const currentKeyRef = useRef(shownKey);
  currentKeyRef.current = shownKey;

  useEffect(() => { void load(); }, [load]);

  // 親へ状態を上げる。オブジェクトを毎回作ると無限ループになるので、値が変わったときだけ通知する
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  // 一覧・PR作成候補・紐付け候補がすべて出揃った状態。親のオーバーレイ解除の条件になる
  const settled = loaded && candidatesSettled && pickerSettled;
  useEffect(() => {
    onStateChangeRef.current?.({ ticketId, loaded, settled, level, pullCount: pullLinks.length });
  }, [ticketId, loaded, settled, level, pullLinks.length]);

  // ブランチ候補は「作れる人」にだけ、かつPRがまだ無いときだけ探す。
  // pending-branches はブランチ全件の走査を伴うので、まだ着手していない／止まっている
  // チケットでは投げない。取れなくてもこのセクションの本体は出したいので失敗は握りつぶす。
  //
  // 「出さない」と分かるものは通信せずその場で確定させる（親のオーバーレイを待たせないため）。
  // 投げる場合も wbs を渡してサーバー側で絞らせる（compare の往復が桁で減る）
  useEffect(() => {
    if (!loaded) return;
    const skip = level !== "merge" || !wbs
      || (!!ticketStatus && CANDIDATE_SKIP_STATUSES.includes(ticketStatus))
      || pullLinks.length > 0;
    if (skip) { setCandidates(null); setCandidatesSettled(true); return; }
    const key = shownKey;
    let alive = true;
    fetchPendingBranches(projectId, wbs)
      .then(r => {
        if (!alive) return;
        const upper = wbs.toUpperCase();
        setCandidates(r.branches.filter(b => b.name.toUpperCase().includes(upper)));
      })
      .catch(() => { if (alive) setCandidates([]); })
      .finally(() => { if (currentKeyRef.current === key) setCandidatesSettled(true); });
    return () => { alive = false; };
  }, [loaded, level, wbs, pullLinks.length, projectId, ticketStatus, shownKey]);

  // auto … 開いた直後の自動表示。
  // 押していないのに読み込み中の枠を出して畳むとチカつくので、取れてから出す。
  // 同じ理由で、失敗もトーストにしない（押していない処理の失敗は直しようがない）
  const openPicker = useCallback(async (auto = false) => {
    if (!auto) setPicking(true);
    if (available) { setPicking(true); return; }
    try {
      // CI・レビューの状態はこの一覧では使わないので軽い方を叩く
      const r = await fetchPulls(projectId, { light: true });
      // WBSが一致するPRを先頭に持ってくる
      const sorted = wbsKey
        ? [...r.pulls].sort((a, b) => Number(b.detectedWbs.includes(wbsKey)) - Number(a.detectedWbs.includes(wbsKey)))
        : r.pulls;
      setAvailable(sorted);
      // 自動表示で候補が0件なら、何も出さない
      if (!auto || sorted.length > 0) setPicking(true);
    } catch (e) {
      if (!auto) toast(e instanceof GithubApiError ? e.message : "PRを取得できませんでした", "error");
      setPicking(false);
    }
  }, [available, projectId, wbsKey, toast]);

  // PRがまだ1件も紐付いていないなら、開いた（リロードした）時点で候補を出す。
  // 候補の選択待ち（大文字小文字違い）が出ているときは、そちらを先に決めさせたいので出さない。
  // 一度閉じたら開き直さないよう、チケットごとに1回だけ走らせる
  const autoPickedRef = useRef("");
  useEffect(() => {
    if (!loaded) return;
    // 自動表示を出さないと決まるケースは、通信せずにその場で確定させる
    if (level !== "merge" || pullLinks.length > 0 || candidateGroups.length > 0
      || autoPickedRef.current === ticketId) {
      setPickerSettled(true);
      return;
    }
    autoPickedRef.current = ticketId;
    const key = shownKey;
    void openPicker(true).finally(() => { if (currentKeyRef.current === key) setPickerSettled(true); });
  }, [loaded, level, ticketId, pullLinks.length, candidateGroups.length, openPicker, shownKey]);

  // コピーできたことをその場で返す。行ごとに出し分けたいので対象のリンクIDを持つ
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copiedTimer = useRef<number | null>(null);
  useEffect(() => () => { if (copiedTimer.current) window.clearTimeout(copiedTimer.current); }, []);

  const handleCopyUrl = async (id: number, url: string) => {
    if (!await copyText(url)) { toast("リンクをコピーできませんでした", "error"); return; }
    setCopiedId(id);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedId(null), 1600);
  };

  const handleLink = async (number: number) => {
    setBusy(true);
    setLinking(number);
    try {
      await linkTicket(projectId, ticketId, "pull", number);
      await load();
      setPicking(false);
      onLinked?.();
      toast(`#${number} を紐付けました`, "success");
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "紐付けに失敗しました", "error");
    } finally {
      setBusy(false);
      setLinking(null);
    }
  };

  // 大文字小文字違いで割れていた候補から1件を選ぶ。
  // 選ばれなかったPRの自動紐付けはサーバー側で外れ、この候補は二度と出てこない
  const handleChooseCandidate = async (number: number) => {
    setBusy(true);
    setLinking(number);
    try {
      await resolveLinkCandidate(projectId, ticketId, number);
      await load();
      onLinked?.();
      toast(`#${number} を紐付けました`, "success");
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "紐付けに失敗しました", "error");
    } finally {
      setBusy(false);
      setLinking(null);
    }
  };

  const handleUnlink = async (id: number) => {
    setBusy(true);
    try {
      await unlinkTicket(projectId, id);
      await load();
      onLinked?.();
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "解除に失敗しました", "error");
    } finally {
      setBusy(false);
    }
  };

  // PR作成ダイアログはブランチ一覧が要る。head を渡すと、そのブランチを選択済みで開く
  const openCreate = async (head?: string) => {
    setPreparingCreate(true);
    try {
      const r = await fetchBranches(projectId);
      if (!r.branches.length) { toast("ブランチを取得できませんでした", "error"); return; }
      setCreateTarget({ branches: r.branches, defaultBranch: r.defaultBranch || "main", head });
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "ブランチを取得できませんでした", "error");
    } finally {
      setPreparingCreate(false);
    }
  };

  // 作成したPRはこのチケットのものと分かっているので、その場で紐付ける。
  // 一覧の取り直し（PR一覧経由の自動検出）を待たせない
  const handleCreated = async (created: { number: number | null; url: string | null }) => {
    if (created.number != null) {
      try {
        await linkTicket(projectId, ticketId, "pull", created.number);
      } catch {
        // 紐付けに失敗しても作成は済んでいる。取り直しで自動検出に拾わせる
      }
    }
    await load();
    onLinked?.();
    toast(created.number ? `#${created.number} を作成して紐付けました` : "プルリクエストを作成しました", "success");
  };

  // マージ確認にはCI・レビュー・マージ可否が要る。紐付け行には無いので詳細を引いてから開く
  const openMerge = async (number: number) => {
    setPreparingMerge(number);
    try {
      const r = await fetchPull(projectId, number);
      setMergeTarget(r.pull);
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "PRの詳細を取得できませんでした", "error");
    } finally {
      setPreparingMerge(null);
    }
  };

  const handleMerge = async (method: GithubMergeMethod) => {
    if (!mergeTarget) return;
    await mergePull(projectId, mergeTarget.number, method);
    toast(`#${mergeTarget.number} をマージしました`, "success");
    await load();
    onLinked?.();
  };

  const setWaived = async (waived: boolean) => {
    setBusy(true);
    try {
      if (isSupabaseEnabled) {
        const { error } = await supabase!.from("sprint_tickets").update({ pr_link_waived: waived }).eq("id", ticketId);
        // 列が無い（マイグレーション未適用）ときに黙って効かないと原因が分からない
        if (error) { toast("設定を保存できませんでした", "error"); return; }
      }
      onWaiveChange?.(waived);
      onLinked?.();
    } finally {
      setBusy(false);
    }
  };

  // 権限が無い／リポジトリ未紐付けのときはセクションごと出さない
  if (!loaded || level === "none") return null;

  // 「リリース待ち以降なのにPRが無い」なら、開くたびに紐付けを促す。
  // PRを1件でも紐付けるか「PR不要」にすれば消える
  const showGuide = pullLinks.length === 0 && !prLinkWaived
    && !!ticketStatus && isPrLinkAlertStatus(ticketStatus);

  return (
    <div style={{
      background: "#FFF",
      border: `1px solid ${showGuide ? "rgba(220,38,38,0.35)" : "rgba(26,23,20,0.08)"}`,
      borderRadius: 12,
      padding: "14px 16px",
      boxShadow: showGuide ? "0 0 0 3px rgba(220,38,38,0.08)" : "none",
    }}>
      {/* spin は各画面で個別に定義されているので、ここでも名前をぶつけないよう接頭辞を付けて持つ */}
      <style>{"@keyframes tpr-spin { to { transform: rotate(360deg); } }"}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Github style={{ width: 13, height: 13, color: BLACK }} />
          <p style={{ fontSize: 11, fontWeight: 700, color: "#1A1714" }}>関連PR</p>
        </div>
        {level === "merge" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => openCreate(candidates?.[0]?.name)} disabled={busy || preparingCreate}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", background: preparingCreate ? "#9CA3AF" : BLACK, color: "#FFF", cursor: busy || preparingCreate ? "default" : "pointer" }}>
              <GitPullRequest style={{ width: 11, height: 11 }} />
              {preparingCreate ? "準備中..." : "PRを作成"}
            </button>
            <button onClick={() => void openPicker()} disabled={busy}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "1px solid rgba(26,23,20,0.14)", background: "#FFF", color: BLACK, cursor: busy ? "default" : "pointer" }}>
              <Plus style={{ width: 11, height: 11 }} />PRを紐付ける
            </button>
          </div>
        )}
      </div>

      {showGuide && (
        <div style={{ background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 9, padding: "10px 12px", marginBottom: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#B91C1C", lineHeight: 1.7 }}>
            {guide
              ? "リリースノートに追加しました。対応内容のプルリクエストを紐付けてください。"
              : "このチケットにはプルリクエストが紐付いていません。"}
          </p>
          <p style={{ fontSize: 11, color: "#B91C1C", lineHeight: 1.7, marginTop: 3 }}>
            紐付けるまで、チケット一覧・スプリント一覧でこのチケットの行が赤く表示されます。
            プルリクエストが発生しないチケットは、下の「プルリクエスト不要」で外せます。
          </p>
        </div>
      )}

      {/*
        大文字小文字だけが違うブランチのPRが複数あって、自動では決められなかったもの。
        機械が勝手に選ぶと関係の無いPRが混ざるので、ここで人に選ばせる
      */}
      {candidateGroups.map(([key, group]) => (
        <div key={key} style={{ border: "1px solid rgba(217,119,6,0.30)", background: "#FFFBEB", borderRadius: 9, padding: "10px 12px", marginBottom: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#B45309", lineHeight: 1.7 }}>
            {key} のプルリクエストが複数見つかりました。どれを紐付けますか？
          </p>
          <p style={{ fontSize: 11, color: "#B45309", lineHeight: 1.7, marginTop: 3, marginBottom: 8 }}>
            大文字小文字だけが違う書き方（{Array.from(new Set(group.map(c => c.spelling).filter(Boolean))).join(" / ")}）
            が混ざっているため、自動では紐付けていません。選ばなかったPRは紐付きません。
          </p>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
            {group.map(c => {
              const already = links.some(l => l.kind === c.kind && l.number === c.number);
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const, background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 8, padding: "8px 10px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#8A837B", fontFamily: "var(--font-mono)", flexShrink: 0 }}>#{c.number}</span>
                  <a href={c.url ?? undefined} target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, minWidth: 140, fontSize: 12, fontWeight: 600, color: "#1A1714", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                    {c.title ?? `#${c.number}`}
                  </a>
                  {c.spelling && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#B45309", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{c.spelling}</span>
                  )}
                  <span style={{ fontSize: 10, color: "#A09790", flexShrink: 0 }}>
                    {c.state === "merged" ? "マージ済み" : c.state === "closed" ? "クローズ" : "オープン"}
                  </span>
                  {already && <span style={{ fontSize: 10, color: "#A09790", flexShrink: 0 }}>紐付け済み</span>}
                  {level === "merge" && (
                    <button onClick={() => handleChooseCandidate(c.number)} disabled={busy}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", background: busy ? "#9CA3AF" : BLACK, color: "#FFF", cursor: busy ? "default" : "pointer", whiteSpace: "nowrap" as const, flexShrink: 0 }}>
                      {linking === c.number && <Loader2 style={{ width: 11, height: 11, animation: "tpr-spin 1s linear infinite" }} />}
                      {linking === c.number ? "紐付け中..." : "これを紐付ける"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* このチケットのブランチ候補。「このコミットのPRを作りますか？」の導線 */}
      {level === "merge" && pullLinks.length === 0 && candidates && candidates.length > 0 && (
        <div style={{ border: "1px solid rgba(2,132,199,0.28)", background: "#F0F9FF", borderRadius: 9, padding: "10px 12px", marginBottom: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#0284C7", marginBottom: 7 }}>
            このチケットのブランチが見つかりました。プルリクエストを作成しますか？
          </p>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
            {candidates.map(b => (
              <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const, background: "#FFF", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <GitBranch style={{ width: 11, height: 11, color: "#8A837B", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{b.name}</span>
                  </div>
                  {(b.message || b.committedDate) && (
                    <p style={{ fontSize: 11, color: "#6B6458", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                      {b.message}
                      {b.committedDate && ` ・ ${relativeTime(b.committedDate)}`}
                      {b.authorName && ` ・ ${b.authorName}`}
                    </p>
                  )}
                </div>
                <button onClick={() => openCreate(b.name)} disabled={busy || preparingCreate}
                  style={{ padding: "5px 12px", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", background: busy || preparingCreate ? "#9CA3AF" : BLACK, color: "#FFF", cursor: busy || preparingCreate ? "default" : "pointer", whiteSpace: "nowrap" as const, flexShrink: 0 }}>
                  このブランチでPRを作成
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pullLinks.length === 0 && links.length === 0 ? (
        <p style={{ fontSize: 11, color: "#B0A9A4" }}>紐付いたPRはありません。</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
          {links.map(l => {
            const mergeable = canMergeHere && l.kind === "pull" && l.state !== "merged" && l.state !== "closed";
            return (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "#F9FAFB", border: "1px solid rgba(26,23,20,0.06)", borderRadius: 8, flexWrap: "wrap" as const }}>
                <span style={{ fontSize: 12, color: l.state === "merged" ? "#7C3AED" : l.state === "closed" ? "#DC2626" : "#059669", flexShrink: 0 }}>
                  {l.state === "merged" ? "✔" : l.state === "closed" ? "✕" : "●"}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#8A837B", fontFamily: "var(--font-mono)", flexShrink: 0 }}>#{l.number}</span>
                <a href={l.url ?? undefined} target="_blank" rel="noopener noreferrer"
                  style={{ flex: 1, minWidth: 120, fontSize: 12, fontWeight: 600, color: "#1A1714", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {l.title ?? `#${l.number}`}
                </a>
                <span style={{ fontSize: 10, color: "#A09790", flexShrink: 0 }}>
                  {l.state === "merged" ? "マージ済み" : l.state === "closed" ? "クローズ" : "オープン"}
                </span>
                {l.autoLinked && l.autoReason && (
                  <span style={{ fontSize: 10, color: "#0284C7", flexShrink: 0 }} title="自動検出">
                    自動検出（{l.autoReason}）
                  </span>
                )}
                {/* レビュー依頼やチャットへ貼るため、PRのURLをここからコピーできるようにする */}
                {l.url && (
                  <button onClick={() => void handleCopyUrl(l.id, l.url!)} title="PRのリンクをコピー"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", fontSize: 10, fontWeight: 700, borderRadius: 7, border: "1px solid rgba(26,23,20,0.14)", background: "#FFF", color: copiedId === l.id ? "#059669" : BLACK, cursor: "pointer", whiteSpace: "nowrap" as const, flexShrink: 0 }}>
                    {copiedId === l.id
                      ? <><Check style={{ width: 11, height: 11 }} />コピーしました</>
                      : <><Copy style={{ width: 11, height: 11 }} />リンクをコピー</>}
                  </button>
                )}
                {/* マージはリリース待ち以降だけ。レビュー前に誤って入れられないようにする */}
                {mergeable && (
                  <button onClick={() => openMerge(l.number)} disabled={busy || preparingMerge !== null}
                    style={{ padding: "4px 12px", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", background: busy || preparingMerge !== null ? "#9CA3AF" : BLACK, color: "#FFF", cursor: busy || preparingMerge !== null ? "default" : "pointer", whiteSpace: "nowrap" as const, flexShrink: 0 }}>
                    {preparingMerge === l.number ? "確認中..." : "マージする"}
                  </button>
                )}
                {level === "merge" && (
                  <button onClick={() => handleUnlink(l.id)} disabled={busy} title="紐付けを解除"
                    style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: busy ? "default" : "pointer", color: "#B0A9A4", flexShrink: 0 }}>
                    <X style={{ width: 11, height: 11 }} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* PRが発生しないチケットの逃げ道。未紐付けアラートだけを畳む */}
      {level === "merge" && pullLinks.length === 0 && !!ticketStatus && isPrLinkAlertStatus(ticketStatus) && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10, cursor: busy ? "default" : "pointer" }}>
          <input type="checkbox" checked={!!prLinkWaived} disabled={busy}
            onChange={e => void setWaived(e.target.checked)} />
          <span style={{ fontSize: 11, color: "#6B6458" }}>
            このチケットはプルリクエスト不要（未紐付けのアラートを出さない）
          </span>
        </label>
      )}

      {picking && (
        <div style={{ marginTop: 10, border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, overflow: "hidden" }}>
          {/* 一覧を下までスクロールしていて押した行が見えていなくても分かるよう、見出しにも進捗を出す */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: linking !== null ? "#EFF6FF" : "#F4F5F6" }}>
            {linking !== null ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "#0284C7" }}>
                <Loader2 style={{ width: 11, height: 11, animation: "tpr-spin 1s linear infinite" }} />
                #{linking} を紐付けています...
              </span>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 700, color: "#6B6458" }}>
                紐付け候補（オープンなPR）{wbsKey && "・このチケットの番号を含むものが上"}
              </span>
            )}
            <button onClick={() => setPicking(false)} disabled={linking !== null}
              style={{ background: "none", border: "none", cursor: linking !== null ? "default" : "pointer", color: "#B0A9A4", display: "flex", opacity: linking !== null ? 0.4 : 1 }}>
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            {!available ? (
              <p style={{ fontSize: 11, color: "#B0A9A4", padding: "12px 10px" }}>読み込み中...</p>
            ) : available.length === 0 ? (
              <p style={{ fontSize: 11, color: "#B0A9A4", padding: "12px 10px" }}>オープンなプルリクエストはありません。</p>
            ) : (
              available.map(p => {
                const already = links.some(l => l.kind === "pull" && l.number === p.number);
                // 押した行だけ進捗を出し、他の行は薄くして「今はこれを処理中」と分かるようにする
                const linkingThis = linking === p.number;
                return (
                  <button key={p.number} onClick={() => !already && handleLink(p.number)} disabled={already || busy}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", border: "none", borderBottom: "1px solid rgba(26,23,20,0.05)", background: linkingThis ? "#EFF6FF" : already ? "#F9FAFB" : "#FFF", cursor: already || busy ? "default" : "pointer", textAlign: "left" as const, opacity: linking !== null && !linkingThis ? 0.45 : 1, transition: "opacity .15s, background .15s" }}>
                    {linkingThis
                      ? <Loader2 style={{ width: 11, height: 11, color: "#0284C7", flexShrink: 0, animation: "tpr-spin 1s linear infinite" }} />
                      : <Link2 style={{ width: 11, height: 11, color: "#0284C7", flexShrink: 0 }} />}
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#8A837B", fontFamily: "var(--font-mono)", flexShrink: 0 }}>#{p.number}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.title}</span>
                    {linkingThis ? (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#0284C7", flexShrink: 0 }}>紐付け中...</span>
                    ) : (
                      <>
                        {wbsKey && p.detectedWbs.includes(wbsKey) && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", flexShrink: 0 }}>一致</span>
                        )}
                        {already && <span style={{ fontSize: 10, color: "#B0A9A4", flexShrink: 0 }}>紐付け済み</span>}
                      </>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/*
        チケット詳細パネルはスライドインのアニメーションで transform が乗るため、
        その内側に置いた position:fixed のダイアログはパネル基準に閉じ込められることがある。
        オーバーレイは body 直下に出す
      */}
      {createTarget && createPortal(
        <div style={{ position: "relative", zIndex: 340 }}>
          <CreatePullDialog
            projectId={projectId}
            projectSlug={projectSlug ?? ""}
            repo={repo}
            branches={createTarget.branches}
            defaultBranch={createTarget.defaultBranch}
            initialHead={createTarget.head}
            onClose={() => setCreateTarget(null)}
            onCreated={handleCreated}
          />
        </div>, document.body)}

      {mergeTarget && createPortal(
        <div style={{ position: "relative", zIndex: 340 }}>
          <MergeConfirmDialog
            pull={mergeTarget}
            repo={repo}
            actorName={userName}
            onClose={() => setMergeTarget(null)}
            onMerge={handleMerge}
          />
        </div>, document.body)}
    </div>
  );
}
