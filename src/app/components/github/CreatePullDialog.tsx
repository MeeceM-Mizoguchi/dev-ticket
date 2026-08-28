// プルリクエストの作成（GitHub の画面へ行かずに Dev Ticket で完結させる）。
//
// ブランチ名に WBS 番号が含まれていれば、そのチケットを引いてタイトルと本文を先に埋める。
// 作成後は PR一覧の取得時に自動でチケットへ紐付く。
//
// BRU13-027：この画面を開いたままでもブランチを探し続ける。
//  ブランチ一覧は開く直前に1回取っただけなので（BRU13-019 でここに寄せた）、
//  「PRを作ろうとしたらまだ push していなかった → 別ウィンドウで push → 戻る」の流れで
//  候補が空のまま詰み、ダイアログを閉じて開き直すしかなかった。
//  開いている間だけ一定間隔で取り直し、増えたブランチをその場で選べるようにする。
//  レート制限を踏まないよう、非表示のタブでは止め、放置されたら自動確認そのものを打ち切る
//  （設計書 8章の「自動ポーリングはしない」は一覧画面の話。ここは人が待っている数分間だけ）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { StepProgressPanel, type ProgressStep } from "@/app/components/shared/StepProgress";
import { createPull, fetchBranches, GithubApiError } from "@/app/lib/github";
import { inputCls, labelCls } from "@/app/lib/helpers";
import type { GithubBranch } from "@/app/types";

const BLACK = "#1F2328";
/**
 * ブランチ名に含まれる WBS 番号らしき並び。
 * WBS の綴りはプロジェクトが決めるもので、大文字（BRU13-029）とは限らず
 * 小文字（demo-079）のプロジェクトもある。どちらのブランチ名からも拾えるよう
 * 大文字小文字を問わずに拾い、突き合わせるときだけ大文字へ揃える。
 * 1本のブランチに複数含まれることがあるので全部拾う（g）
 */
const WBS_RE = /[A-Za-z][A-Za-z0-9]*-\d+/g;
/** ブランチを取り直す間隔 */
const WATCH_MS = 10_000;
/** 自動確認を続ける上限（10分）。開きっぱなしで放置されたときに叩き続けないための打ち切り */
const WATCH_MAX = 60;
/** 連続でこの回数失敗したら自動確認をやめる（手動の「更新」で再開できる） */
const WATCH_MAX_FAILS = 3;

export function CreatePullDialog({ projectId, projectSlug, repo, branches, defaultBranch, initialHead, ticketWbs, onClose, onCreated }: {
  projectId: string;
  projectSlug: string;
  repo: string;
  branches: GithubBranch[];
  defaultBranch: string;
  /** 未作成ブランチの一覧から開いたときに、選択済みにしておくブランチ */
  initialHead?: string;
  /**
   * チケット詳細から開いたときのWBS番号。
   * 開いている間に現れたブランチがこの番号を含んでいたら、head に選んでおく
   */
  ticketWbs?: string;
  onClose: () => void;
  /** 一覧の取り直しまで待てるように、Promise を返してよい */
  onCreated: (created: { number: number | null; url: string | null }) => void | Promise<void>;
}) {
  const [base, setBase] = useState(defaultBranch || "main");
  const [head, setHead] = useState(initialHead && initialHead !== (defaultBranch || "main") ? initialHead : "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [filter, setFilter] = useState("");
  /**
   * idle … 入力中／creating … GitHubへ作成中／refreshing … 呼び出し元が一覧を取り直している最中。
   * 作成できた時点で閉じてしまうと、一覧が返ってくるまでの間だけ裏の画面が
   * 「プルリクエスト未作成のブランチ」に戻り、そのあとマージの表示に切り替わって見える。
   * 最後まで閉じずに進捗を出し続ける。
   */
  const [phase, setPhase] = useState<"idle" | "creating" | "refreshing">("idle");
  const [error, setError] = useState("");
  /** ブランチ名から見つけたチケット。タイトルの自動入力に使う */
  const [detected, setDetected] = useState<{ wbs: string; title: string } | null>(null);
  /** 利用者がタイトルを触ったら自動入力で上書きしない */
  const [titleTouched, setTitleTouched] = useState(false);

  /* ── 開いている間のブランチ探し（BRU13-027） ────────────────────── */

  /** 取り直した結果を含む、いま画面に出しているブランチ。初期値は開く直前に取ったもの */
  const [liveBranches, setLiveBranches] = useState<GithubBranch[]>(branches);
  /** この画面を開いたあとに現れたブランチ（新しい順）。選択肢に「新着」を付け、その場で選ばせる */
  const [freshNames, setFreshNames] = useState<string[]>([]);
  /** 取り直し中か。手動の「更新」でも自動確認でも立てる */
  const [checking, setChecking] = useState(false);
  /** 最後に確認できた時刻。「いつの情報か」を出すために持つ */
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  /** 自動確認を打ち切ったか（放置・連続失敗）。手動の「更新」で戻す */
  const [watchOff, setWatchOff] = useState(false);

  /** 既に知っているブランチ名。「増えた分」だけを新着として拾うために持つ */
  const knownRef = useRef<Set<string>>(new Set(branches.map(b => b.name)));
  /** 取り直しの多重起動を止める（インターバルと手動が重なることがある） */
  const checkingRef = useRef(false);
  const failsRef = useRef(0);
  /** 最後に取りにいった時刻。復帰のたびに叩かないための間引きに使う */
  const lastAtRef = useRef(0);

  // 呼び出し元が一覧を取り直してブランチを差し替えたら、こちらの積み上げも初期化する
  // （props に合わせて state を調整するパターン。この回のレンダー結果は破棄される）
  const [seed, setSeed] = useState(branches);
  if (seed !== branches) {
    setSeed(branches);
    setLiveBranches(branches);
    setFreshNames([]);
    knownRef.current = new Set(branches.map(b => b.name));
  }

  // base に入っている値が一覧に無いと、<select> は先頭の項目を表示してしまい、
  // 画面に出ているマージ先と実際に送られる base がずれる。必ず選択肢に含めておく
  const baseCandidates = useMemo<GithubBranch[]>(() => (
    liveBranches.some(b => b.name === base)
      ? liveBranches
      : [{ name: base, protected: false, isDefault: base === (defaultBranch || "main"), lastCommitSha: "" }, ...liveBranches]
  ), [liveBranches, base, defaultBranch]);

  const headCandidates = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return liveBranches
      .filter(b => b.name !== base)
      .filter(b => !q || b.name.toLowerCase().includes(q));
  }, [liveBranches, base, filter]);

  /**
   * ブランチの取り直し。増えた分を新着として覚え、選択肢へ反映する。
   * 自動確認から呼ばれたときは静かに失敗させる（数秒ごとにエラーを出しても直しようがない）
   */
  const refreshBranches = useCallback(async (minGapMs = 0) => {
    if (checkingRef.current) return;
    // ウィンドウの行き来のたびに叩かないよう、直前に取っていたら見送る
    if (minGapMs && Date.now() - lastAtRef.current < minGapMs) return;
    checkingRef.current = true;
    lastAtRef.current = Date.now();
    setChecking(true);
    try {
      const r = await fetchBranches(projectId);
      if (!r.branches.length) return;
      failsRef.current = 0;
      const known = knownRef.current;
      const appeared = r.branches.map(b => b.name).filter(n => !known.has(n));
      for (const b of r.branches) known.add(b.name);
      setLiveBranches(r.branches);
      setCheckedAt(Date.now());
      if (appeared.length) setFreshNames(prev => [...appeared, ...prev.filter(n => !appeared.includes(n))]);
    } catch {
      failsRef.current++;
      if (failsRef.current >= WATCH_MAX_FAILS) setWatchOff(true);
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [projectId]);

  /** 検出の実行回。head を続けて変えたときに、古い問い合わせの結果を後から被せない */
  const lookupRunRef = useRef(0);

  /**
   * ブランチ名の WBS 番号から、このプロジェクトのチケットを引く。
   *
   * 突き合わせは必ず大文字小文字を無視する。チケット側の wbs はプロジェクトが決めた
   * 綴りのままで、大文字（BRU13-029）のプロジェクトもあれば小文字（demo-079）の
   * プロジェクトもあるため、完全一致で引くと後者だけ1件も当たらず、
   * ブランチを選んでもタイトル・本文が空のままだった（サーバー側の紐付けは
   * 既に ilike で引いており、GitHub画面ではチケット名が出ていた）。
   *
   * 表示・タイトルにはDBに入っている綴りをそのまま使う。正規化した大文字を出すと、
   * 本文に入れるチケットのURLが実在しないものになる。
   */
  const lookupTicket = useCallback(async (branch: string) => {
    const run = ++lookupRunRef.current;
    setDetected(null);
    if (!isSupabaseEnabled) return;

    // 拾った番号は突き合わせ用に大文字へ揃える（重複も畳む）
    const hits = Array.from(new Set((branch.match(WBS_RE) ?? []).map(w => w.toUpperCase())));
    if (!hits.length) return;

    // チケット詳細から開いたときは、そのチケットの番号を最優先で見る。
    // ブランチ名に別の番号も混じっている場合に、関係の無いチケットを拾わないため
    const mine = ticketWbs?.toUpperCase();
    const order = mine && hits.includes(mine) ? [mine, ...hits.filter(w => w !== mine)] : hits;

    // WBS は英数字とハイフンだけなので、ilike のワイルドカードが混ざることはない
    const { data } = await supabase!
      .from("sprint_tickets")
      .select("wbs, title, sprints!inner(project_id)")
      .eq("sprints.project_id", projectId)
      .or(order.map(w => `wbs.ilike.${w}`).join(","))
      .limit(order.length);
    if (lookupRunRef.current !== run) return;

    const rows = (data ?? []) as any[];
    const t = order
      .map(w => rows.find(r => String(r.wbs ?? "").toUpperCase() === w))
      .find(Boolean);
    if (t) setDetected({ wbs: t.wbs, title: t.title });
  }, [projectId, ticketWbs]);

  useEffect(() => { if (head) void lookupTicket(head); }, [head, lookupTicket]);

  // チケットが見つかったら、まだ触られていない欄だけ埋める
  useEffect(() => {
    if (!detected || titleTouched) return;
    setTitle(`${detected.wbs} ${detected.title}`);
    setBody(prev => prev.trim()
      ? prev
      : `対応チケット: ${detected.wbs} ${detected.title}\n${location.origin}/${projectSlug}/${detected.wbs}`);
  }, [detected, titleTouched, projectSlug]);

  // 開いている間はブランチを探し続ける。
  //  ・非表示のタブでは叩かない（裏で開きっぱなしのタブが数を食うのを避ける）
  //  ・作成中は止める（結果が入れ替わって選択がずれる）
  //  ・上限に達したら自動確認をやめ、手動の「更新」に切り替える
  useEffect(() => {
    if (phase !== "idle" || watchOff) return;
    let n = 0;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (++n > WATCH_MAX) { setWatchOff(true); return; }
      void refreshBranches();
    }, WATCH_MS);
    return () => clearInterval(id);
  }, [phase, watchOff, refreshBranches]);

  // 別ウィンドウで push して戻ってきた直後が一番見たいタイミング。
  // 次のインターバルを待たずに取り直す
  useEffect(() => {
    if (phase !== "idle" || watchOff) return;
    const onVisible = () => { if (document.visibilityState === "visible") void refreshBranches(WATCH_MS / 2); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [phase, watchOff, refreshBranches]);

  // 現れたブランチがこのチケットのものなら、まだ選んでいないときだけ選択しておく。
  // （利用者が選んだあとに勝手に差し替えない）
  useEffect(() => {
    if (head || !ticketWbs || !freshNames.length) return;
    const upper = ticketWbs.toUpperCase();
    const hit = freshNames.find(n => n.toUpperCase().includes(upper) && n !== base);
    if (hit) setHead(hit);
  }, [freshNames, head, ticketWbs, base]);

  /** 開いた直後の自動選択を1回で打ち切る目印。利用者が「選択してください」に戻したら尊重する */
  const autoHeadRef = useRef(false);

  // 開いた時点で head が決まっていないときの受け皿。
  //
  // 呼び出し元は「まだPRが無いブランチ」の走査（pending-branches）で head を決めているが、
  // それは GraphQL・compare を挟む重い判定で、失敗したり件数の上限で漏れたりする。
  // その場合でもブランチ一覧そのものには載っているので、チケットの番号を含むブランチを
  // ここで拾って選んでおく。番号の綴りは大文字小文字を問わない
  useEffect(() => {
    if (autoHeadRef.current || head || !ticketWbs || !liveBranches.length) return;
    autoHeadRef.current = true;
    const upper = ticketWbs.toUpperCase();
    const hit = liveBranches.find(b => b.name !== base && b.name.toUpperCase().includes(upper));
    if (hit) setHead(hit.name);
  }, [liveBranches, head, ticketWbs, base]);

  /** 手動の「更新」。自動確認を打ち切ったあとの再開も兼ねる */
  const manualRefresh = () => {
    failsRef.current = 0;
    setWatchOff(false);
    void refreshBranches();
  };

  /** 新着のうち、いま選べるもの（base と同じものは選べない） */
  const freshSelectable = useMemo(
    () => freshNames.filter(n => n !== base && liveBranches.some(b => b.name === n)),
    [freshNames, base, liveBranches],
  );

  const busy = phase !== "idle";
  const canCreate = !!head && !!title.trim() && head !== base && !busy;

  /**
   * 作成中の進捗。作成そのものと、呼び出し元の一覧の取り直しの2段階を出す。
   * どちらも数秒かかることがあり、ボタンの「作成中...」だけだと何を待っているのか分からない
   */
  const steps: ProgressStep[] = [
    {
      key: "create",
      state: phase === "creating" ? "running" : "done",
      text: phase === "creating" ? "プルリクエストを作成しています..." : "プルリクエストを作成しました",
    },
    {
      key: "refresh",
      state: phase === "creating" ? "pending" : "running",
      text: phase === "creating" ? "画面の更新を待っています" : "画面を最新の状態にしています...",
    },
  ];

  const handleCreate = async () => {
    if (!canCreate) return;
    setPhase("creating");
    setError("");
    let created: { number: number | null; url: string | null };
    try {
      const r = await createPull(projectId, { head, base, title: title.trim(), body, draft }, projectSlug);
      created = { number: r.number, url: r.url };
    } catch (e) {
      // 失敗しても閉じない。差分が無い・既にPRがある、など理由を読ませる
      setError(e instanceof GithubApiError ? e.message : "プルリクエストを作成できませんでした。");
      setPhase("idle");
      return;
    }
    // ここから先は作成そのものは成功している。一覧の取り直しが終わってから閉じる
    setPhase("refreshing");
    try {
      await onCreated(created);
    } catch {
      // 取り直しの失敗は一覧側で出す。作成は済んでいるのでダイアログは閉じる
    }
    onClose();
  };

  return (
    <DialogShell title="プルリクエストを作成" size="lg" minHeight={busy ? 0 : undefined} onClose={onClose} busy={busy}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={busy}>キャンセル</BtnSecondary>
        <button type="button" onClick={handleCreate} disabled={!canCreate}
          style={{ padding: "9px 20px", background: canCreate ? BLACK : "#E5E7EB", color: canCreate ? "#fff" : "#9CA3AF", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: canCreate ? "pointer" : "not-allowed" }}>
          {phase === "creating" ? "作成中..." : phase === "refreshing" ? "一覧を更新中..." : draft ? "Draft で作成する" : "作成する"}
        </button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
        <style>{`@keyframes spin-cpd { to { transform: rotate(360deg); } }`}</style>

        <p style={{ fontSize: 12, color: "#6B6458" }}>
          リポジトリ <strong style={{ fontFamily: "var(--font-mono)" }}>{repo}</strong>
        </p>

        {/* 作成が始まったら入力は触れないので、進捗だけに切り替えて何を待っているかを出す */}
        {busy ? (<>
          <p style={{ fontSize: 12, color: "#1A1714", background: "#F9FAFB", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 8, padding: "9px 12px", fontFamily: "var(--font-mono)" }}>
            {base} ← {head}
          </p>
          <StepProgressPanel steps={steps} note="作成が終わるまで、この画面は閉じないでください。" />
        </>) : (<>

        {/* マージ先と比較ブランチ */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" as const }}>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <label className={labelCls}>マージ先（base）</label>
            <select className={inputCls} value={base}
              onChange={e => { setBase(e.target.value); if (e.target.value === head) setHead(""); }}
              style={{ width: "100%" }}>
              {baseCandidates.map(b => <option key={b.name} value={b.name}>{b.name}{b.isDefault ? "（既定）" : ""}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <label className={labelCls}>比較するブランチ（head）</label>
            <select className={inputCls} value={head} onChange={e => setHead(e.target.value)} style={{ width: "100%" }}>
              <option value="">選択してください</option>
              {headCandidates.map(b => (
                <option key={b.name} value={b.name}>{b.name}{freshNames.includes(b.name) ? "（新着）" : ""}</option>
              ))}
            </select>
          </div>
        </div>

        {liveBranches.length > 8 && (
          <div style={{ position: "relative" }}>
            <Search style={{ width: 13, height: 13, color: "#B0A9A4", position: "absolute", left: 10, top: 9 }} />
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="ブランチ名で絞り込む"
              style={{ width: "100%", boxSizing: "border-box" as const, padding: "7px 10px 7px 30px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#F9F8F6", outline: "none" }} />
          </div>
        )}

        {/*
          この画面を開いたままでもブランチを探し続けていることを出す（BRU13-027）。
          出さないと「押した時点の一覧で固定されている」のか「探しているのか」が分からず、
          結局ダイアログを閉じて開き直すことになる
        */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" as const }}>
          <p style={{ fontSize: 11, color: "#A09790", display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: watchOff ? "#D6D3D1" : "#10B981", flexShrink: 0 }} />
            {watchOff
              ? "新しいブランチの自動確認を止めています。更新すると再開します"
              : checking
                ? "新しいブランチを確認しています..."
                : `新しいブランチを自動で確認しています（最終確認 ${new Date(checkedAt).toLocaleTimeString("ja-JP")}）`}
          </p>
          <button type="button" onClick={manualRefresh} disabled={checking}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", fontSize: 11, fontWeight: 700, borderRadius: 7, border: "1px solid rgba(26,23,20,0.12)", background: "#FFFFFF", color: checking ? "#A09790" : "#1A1714", cursor: checking ? "default" : "pointer", flexShrink: 0 }}>
            <RefreshCw style={{ width: 12, height: 12, animation: checking ? "spin-cpd 1s linear infinite" : undefined }} />
            {watchOff ? "再開して更新" : "更新"}
          </button>
        </div>

        {freshSelectable.length > 0 && (
          <div style={{ padding: "10px 12px", background: "#ECFDF5", border: "1px solid rgba(16,185,129,0.35)", borderRadius: 9 }}>
            <p style={{ fontSize: 11, color: "#047857", fontWeight: 700, marginBottom: 6 }}>
              この画面を開いたあとに、新しいブランチが見つかりました
            </p>
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6 }}>
              {freshSelectable.map(n => (
                <button key={n} type="button" onClick={() => setHead(n)}
                  style={{ padding: "4px 9px", fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)", borderRadius: 7, border: head === n ? "1px solid #047857" : "1px solid rgba(16,185,129,0.4)", background: head === n ? "#047857" : "#FFFFFF", color: head === n ? "#FFFFFF" : "#047857", cursor: "pointer" }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        <p style={{ fontSize: 12, color: "#1A1714", background: "#F9FAFB", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 8, padding: "9px 12px", fontFamily: "var(--font-mono)" }}>
          {base} ← {head || "（未選択）"}
        </p>

        {detected && (
          <p style={{ fontSize: 11, color: "#0284C7" }}>
            ブランチ名から <strong>{detected.wbs}</strong>（{detected.title}）を検出しました。作成後にこのチケットへ自動で紐付きます。
          </p>
        )}

        <div>
          <label className={labelCls}>タイトル</label>
          <input className={inputCls} value={title} placeholder="例: BRU13-004 リリースノートの自動反映"
            onChange={e => { setTitle(e.target.value); setTitleTouched(true); }} />
        </div>

        <div>
          <label className={labelCls}>本文（任意）</label>
          <textarea className={inputCls} value={body} onChange={e => setBody(e.target.value)} rows={6}
            placeholder="変更内容や確認してほしい点を書きます"
            style={{ resize: "vertical", minHeight: 110, fontFamily: "inherit" }} />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={draft} onChange={e => setDraft(e.target.checked)} />
          <span style={{ fontSize: 12, color: "#1A1714" }}>Draft として作成する（レビュー依頼前の下書き）</span>
        </label>

        {error && (
          <div style={{ display: "flex", gap: 9, padding: "11px 13px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 9 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "#DC2626", flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12, color: "#B91C1C", lineHeight: 1.7, fontWeight: 600 }}>{error}</p>
          </div>
        )}

        <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.7 }}>
          GitHub 上では Dev Ticket[bot] 名義で作成され、本文の末尾に実行者が記録されます。
        </p>
        </>)}
      </div>
    </DialogShell>
  );
}
