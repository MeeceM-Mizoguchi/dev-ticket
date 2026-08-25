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
//
// BRU13-019（チケットが開くのが遅いという指摘への対応）：
//  開いた時点で GitHub を叩くのをやめた。ここで自動で走っていた
//   ・PR作成候補（pending-branches：ブランチ全件の走査を伴う）
//   ・紐付け候補の自動表示（pulls の取得）
//  の2つが、チケット詳細の初回ロードのオーバーレイをそのまま数秒引き延ばしていたため。
//  紐付いたPRの一覧（links）はDBだけで返るので、これだけを待つ。
//  ブランチ探しは「PRを作成」を押してから走らせ、進捗を出す（CreatePullPrepDialog）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, GitPullRequest, Github, Link2, Loader2, Plus, X } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import {
  fetchTicketLinks, fetchPulls, fetchPull, fetchBranches, fetchPendingBranches,
  linkTicket, unlinkTicket, mergePull, resolveLinkCandidate, GithubApiError,
} from "@/app/lib/github";
import { isPrLinkAlertStatus } from "@/app/lib/prLinkAlert";
import { useGithubAccess } from "@/app/hooks/useGithubAccess";
import { CreatePullDialog } from "@/app/components/github/CreatePullDialog";
import { CreatePullPrepDialog, type PrepState } from "@/app/components/github/CreatePullPrepDialog";
import { MergeConfirmDialog } from "@/app/components/github/MergeConfirmDialog";
import type {
  TicketGithubLink, TicketGithubLinkCandidate, GithubPull, GithubBranch,
  GithubAccessLevel, GithubMergeMethod, TicketStatus,
} from "@/app/types";

const BLACK = "#1F2328";

/** 親（チケット詳細）へ渡す状態。リリースノート追加後の案内と離脱確認の判断に使う */
export interface TicketPrState {
  /** どのチケットの状態か。チケットを切り替えた直後に前のチケットの合図を誤って使わないため */
  ticketId: string;
  /**
   * 紐付け一覧が返ってきたか。これがこのセクションの表示が確定した合図でもある。
   * チケット詳細の初回ロード用オーバーレイは、これが立つまで外さない（BRU13-016）。
   * links はDBだけで返るので、本体のクエリと並べても待ち時間はほぼ増えない（BRU13-019）
   */
  loaded: boolean;
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
  /**
   * 「このセクションを出す見込みがあるか」を、取得を待たずに決めるための事前判定（BRU13-023）。
   *
   * チケット詳細の初回オーバーレイはこのセクションを待たなくなったので、
   * 取得中も枠を出しておかないと、あとから生えてきて下の要素を押し下げる。
   * かといって全員に枠を出すと、GitHub未連携のプロジェクトでは出してから消すことになる。
   *
   * useGithubAccess はスラッグ単位で60秒キャッシュされ、プロジェクト画面の
   * ProjectSubNav が既に解決済みなので、ここでは待ち時間なしで返る。
   * スラッグを渡してこない画面（レポート）もあるので、無ければIDで引く
   * （このフックはスラッグでもIDでも解決できる）
   */
  const access = useGithubAccess(projectSlug || projectId);
  const mayHaveSection = access.linked && !!access.level && access.level !== "none";
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

  const [createTarget, setCreateTarget] = useState<{ branches: GithubBranch[]; defaultBranch: string; head?: string } | null>(null);
  /** PR作成の準備（ブランチ取得＋このチケットのブランチ探し）の進捗。null なら準備していない */
  const [prep, setPrep] = useState<PrepState | null>(null);
  /** 準備の実行回。キャンセル・チケット切り替えのあとに返ってきた結果を捨てる目印 */
  const prepRunRef = useRef(0);
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
    setAvailable(null);
    setPicking(false);
    // 準備中に別のチケットへ移ったら、その進捗は前のチケットのもの。閉じて結果も捨てる
    prepRunRef.current++;
    setPrep(null);
  }

  // 非同期の完了が「今開いているチケットのものか」を、effect の再実行に左右されずに判定する
  const currentKeyRef = useRef(shownKey);
  currentKeyRef.current = shownKey;

  useEffect(() => { void load(); }, [load]);

  // 親へ状態を上げる。オブジェクトを毎回作ると無限ループになるので、値が変わったときだけ通知する
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => {
    onStateChangeRef.current?.({ ticketId, loaded, level, pullCount: pullLinks.length });
  }, [ticketId, loaded, level, pullLinks.length]);

  // 「PRを紐付ける」を押したときだけ走る。開いた時点では叩かない（BRU13-019）
  const openPicker = useCallback(async () => {
    setPicking(true);
    if (available) return;
    const key = currentKeyRef.current;
    try {
      // CI・レビューの状態はこの一覧では使わないので軽い方を叩く
      const r = await fetchPulls(projectId, { light: true });
      if (currentKeyRef.current !== key) return; // 別チケットに切り替わっていたら捨てる
      // WBSが一致するPRを先頭に持ってくる
      setAvailable(wbsKey
        ? [...r.pulls].sort((a, b) => Number(b.detectedWbs.includes(wbsKey)) - Number(a.detectedWbs.includes(wbsKey)))
        : r.pulls);
    } catch (e) {
      if (currentKeyRef.current !== key) return;
      toast(e instanceof GithubApiError ? e.message : "PRを取得できませんでした", "error");
      setPicking(false);
    }
  }, [available, projectId, wbsKey, toast]);

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

  /**
   * PR作成の準備。「PRを作成」を押してから、必要なものを取りにいく（BRU13-019）。
   *
   *  ・ブランチ一覧（必須）
   *  ・このチケットのWBS番号を含む、まだPRが無いブランチ（head を選択済みにするためだけ）
   *
   * 後者はブランチ全件の走査を伴って遅いので、以前はチケットを開いた時点で先回りしていたが、
   * それがチケットが開くまでの待ち時間そのものになっていた。押してから走らせ、進捗を出す。
   * 失敗しても作成そのものは続けられる（ブランチは作成画面で手で選べる）。
   *
   * 準備中に「キャンセル」やチケット切り替えがあったら、返ってきた結果は捨てる
   */
  const openCreate = async () => {
    if (prep) return;
    const run = ++prepRunRef.current;
    const alive = () => prepRunRef.current === run;
    setPrep({ branches: "running", candidates: wbs ? "running" : "skipped" });

    const branchesP = fetchBranches(projectId).then(
      r => { if (alive()) setPrep(p => p && { ...p, branches: "done" }); return r; },
      e => { if (alive()) setPrep(p => p && { ...p, branches: "failed" }); throw e; },
    );

    const headP: Promise<string | undefined> = wbs
      ? fetchPendingBranches(projectId, wbs).then(
        r => {
          const upper = wbs.toUpperCase();
          const hit = r.branches.find(b => b.name.toUpperCase().includes(upper))?.name;
          if (alive()) setPrep(p => p && { ...p, candidates: hit ? "done" : "none" });
          return hit;
        },
        () => { if (alive()) setPrep(p => p && { ...p, candidates: "failed" }); return undefined; },
      )
      : Promise.resolve(undefined);

    try {
      const [r, head] = await Promise.all([branchesP, headP]);
      if (!alive()) return;
      if (!r.branches.length) { toast("ブランチを取得できませんでした", "error"); return; }
      setCreateTarget({ branches: r.branches, defaultBranch: r.defaultBranch || "main", head });
    } catch (e) {
      if (!alive()) return;
      toast(e instanceof GithubApiError ? e.message : "ブランチを取得できませんでした", "error");
    } finally {
      if (alive()) setPrep(null);
    }
  };

  const cancelPrep = () => { prepRunRef.current++; setPrep(null); };

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

  // onMerged は「GitHub 側のマージが終わった」合図。ダイアログの進捗を次の段
  //（この画面の取り直し）へ進めるために呼ぶ
  const handleMerge = async (method: GithubMergeMethod, onMerged: () => void) => {
    if (!mergeTarget) return;
    await mergePull(projectId, mergeTarget.number, method);
    onMerged();
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

  // サーバーが「権限が無い／リポジトリ未紐付け」と答えたらセクションごと出さない
  if (loaded && level === "none") return null;
  // まだ取得中で、出す見込みも無いなら何も置かない。
  // 見込みの判定に access を使うのは、枠を出してから消すのを避けるため（BRU13-023）
  if (!loaded && !mayHaveSection) return null;

  // 「リリース待ち以降なのにPRが無い」なら、開くたびに紐付けを促す。
  // PRを1件でも紐付けるか「PR不要」にすれば消える。
  // 取得前は「PRが無い」と断定できないので出さない（赤枠を出してから引っ込めない）
  const showGuide = loaded && pullLinks.length === 0 && !prLinkWaived
    && !!ticketStatus && isPrLinkAlertStatus(ticketStatus);

  // ヘッダーのボタンの出し分け。取得前は事前に分かっている権限で決める。
  // ここが後から変わるとボタンが増減してヘッダーの見た目が動くため、
  // 取得後もサーバーの答え（level）に静かに引き継がれるようにしてある
  const shownLevel = loaded ? level : access.level;

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
        {/* 取得が終わるまでは押させない。repo が未取得のままダイアログを開かせないため */}
        {shownLevel === "merge" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: loaded ? 1 : 0.5 }}>
            <button onClick={() => void openCreate()} disabled={!loaded || busy || !!prep}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "none", background: prep ? "#9CA3AF" : BLACK, color: "#FFF", cursor: !loaded || busy || prep ? "default" : "pointer" }}>
              <GitPullRequest style={{ width: 11, height: 11 }} />
              {prep ? "準備中..." : "PRを作成"}
            </button>
            <button onClick={() => void openPicker()} disabled={!loaded || busy}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "1px solid rgba(26,23,20,0.14)", background: "#FFF", color: BLACK, cursor: !loaded || busy ? "default" : "pointer" }}>
              <Plus style={{ width: 11, height: 11 }} />PRを紐付ける
            </button>
          </div>
        )}
      </div>

      {/*
        取得が終わるまでの本文（BRU13-023）。
        チケット詳細の初回オーバーレイはこのセクションを待たなくなったので、
        待っているのはここだけになる。

        高さは「PR1行ぶん」に合わせてある。0にすると、出揃った瞬間に
        下のレビューフロー・添付ファイルが押し下げられて見える
      */}
      {!loaded && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, minHeight: 34 }}>
          <Loader2 style={{ width: 12, height: 12, color: "#0284C7", animation: "tpr-spin 1s linear infinite" }} />
          <span style={{ fontSize: 11, color: "#8A837B" }}>関連PRを読み込んでいます...</span>
        </div>
      )}

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

      {!loaded ? null : pullLinks.length === 0 && links.length === 0 ? (
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
      {prep && createPortal(
        <div style={{ position: "relative", zIndex: 340 }}>
          <CreatePullPrepDialog state={prep} onCancel={cancelPrep} />
        </div>, document.body)}

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
