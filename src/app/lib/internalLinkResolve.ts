// 貼られた DevTicket 内リンクの「実在確認」と「表示ラベル（タイトル）取得」。
//
// チップ表示は本文の描画のたびに走るので、次の3点を守る:
//   ・同じ参照は1回しか問い合わせない（結果をモジュールレベルにキャッシュ）
//   ・同時に走った同じ問い合わせは1本にまとめる（in-flight の共有）
//   ・解決前は「無い」ではなく「未確定」として扱う（赤×のチカチカを出さない）
//
// 権限（RLS）で読めない行は 0件で返るため、削除済みと区別できない。
// ユーザーに出す文言は「見つかりません（削除されたか、閲覧権限がない可能性があります）」に寄せる。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import {
  INTERNAL_LINK_KIND_LABEL,
  internalLinkKey,
  isUuid,
  parseMinuteSlug,
  type InternalLinkKind,
  type InternalLinkRef,
} from "./internalLink";

export type InternalLinkStatus =
  /** 実在を確認できた */
  | "ok"
  /** 問い合わせた結果、存在しなかった（削除済み / 権限なし / URLの打ち間違い） */
  | "missing"
  /** 通信エラーや Supabase 未設定。「無い」とは言い切れないので赤×にはしない */
  | "unknown";

export interface ResolvedInternalLink {
  status: InternalLinkStatus;
  /** 表示ラベル（チケットのタイトル / Wikiのページ名 など）。未取得なら空 */
  label: string;
  /**
   * 解決後の種別。/PJ/BRU4-2 のように「チケットWBSにもスプリント識別子にも見える」URLは
   * ここで確定する（SprintPage と同じくスプリントを優先）。
   */
  kind: InternalLinkKind;
  /**
   * プレビューパネルに渡す正規ID。議事録は URL に slug が入ることがあるので、
   * ここで必ず meeting_minutes.id（UUID）に読み替えたものを持つ。
   */
  canonicalId: string;
  /** 所属プロジェクト名（別プロジェクトのリンクをツールチップで示すため） */
  projectName: string;
}

const resultCache = new Map<string, ResolvedInternalLink>();
const inflight = new Map<string, Promise<ResolvedInternalLink>>();

interface ProjectRow { id: string; name: string; slug: string }
interface SprintRow { id: string; identifier: string; name: string }

const projectCache = new Map<string, ProjectRow | null>();
const projectInflight = new Map<string, Promise<ProjectRow | null>>();
const sprintCache = new Map<string, SprintRow[]>();
const sprintInflight = new Map<string, Promise<SprintRow[]>>();

/** 解決が終わってチップの見た目が変わることを購読者へ知らせる */
const listeners = new Set<() => void>();

export function subscribeInternalLinks(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function notify() {
  for (const cb of [...listeners]) {
    try { cb(); } catch (e) { console.error("[internalLink] listener failed", e); }
  }
}

/** すでに解決済みなら即座に返す（描画時の同期読み出し用） */
export function peekInternalLink(ref: InternalLinkRef): ResolvedInternalLink | undefined {
  return resultCache.get(internalLinkKey(ref));
}

/**
 * 解決結果を捨てて再取得できるようにする。
 * リンク先を作り直した／改題したあとに、古い「見つかりません」が残らないようにするため。
 */
export function invalidateInternalLinks(): void {
  resultCache.clear();
  projectCache.clear();
  sprintCache.clear();
  notify();
}

export function resolveInternalLink(ref: InternalLinkRef): Promise<ResolvedInternalLink> {
  const key = internalLinkKey(ref);
  const cached = resultCache.get(key);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(key);
  if (running) return running;

  const p = fetchRef(ref)
    .catch((e): ResolvedInternalLink => {
      console.warn("[internalLink] 解決に失敗しました", ref, e);
      return unknown(ref);
    })
    .then((r) => {
      // unknown（通信エラー等）はキャッシュしない。次に描画されたときに再挑戦させる。
      if (r.status !== "unknown") resultCache.set(key, r);
      inflight.delete(key);
      notify();
      return r;
    });
  inflight.set(key, p);
  return p;
}

function unknown(ref: InternalLinkRef): ResolvedInternalLink {
  return { status: "unknown", label: "", kind: ref.kind, canonicalId: ref.id, projectName: "" };
}

function missing(ref: InternalLinkRef, projectName = ""): ResolvedInternalLink {
  return { status: "missing", label: "", kind: ref.kind, canonicalId: ref.id, projectName };
}

function ok(
  ref: InternalLinkRef,
  label: string,
  projectName: string,
  opts?: { kind?: InternalLinkKind; canonicalId?: string },
): ResolvedInternalLink {
  return {
    status: "ok",
    label: label || INTERNAL_LINK_KIND_LABEL[opts?.kind ?? ref.kind],
    kind: opts?.kind ?? ref.kind,
    canonicalId: opts?.canonicalId ?? ref.id,
    projectName,
  };
}

async function getProject(slug: string): Promise<ProjectRow | null> {
  if (projectCache.has(slug)) return projectCache.get(slug) ?? null;
  const running = projectInflight.get(slug);
  if (running) return running;

  const p = (async () => {
    const { data } = await supabase!.from("projects").select("id, name, slug").eq("slug", slug).limit(1);
    let row = (data?.[0] as ProjectRow | undefined) ?? null;
    // MinutesPage 等が「slug でも id でも開ける」作りになっているので、UUID なら id でも引く
    if (!row && isUuid(slug)) {
      const { data: byId } = await supabase!.from("projects").select("id, name, slug").eq("id", slug).limit(1);
      row = (byId?.[0] as ProjectRow | undefined) ?? null;
    }
    projectCache.set(slug, row);
    projectInflight.delete(slug);
    return row;
  })();
  projectInflight.set(slug, p);
  return p;
}

async function getSprints(projectId: string): Promise<SprintRow[]> {
  const hit = sprintCache.get(projectId);
  if (hit) return hit;
  const running = sprintInflight.get(projectId);
  if (running) return running;

  const p = (async () => {
    const { data } = await supabase!.from("sprints").select("id, identifier, name").eq("project_id", projectId);
    const rows = (data ?? []) as SprintRow[];
    sprintCache.set(projectId, rows);
    sprintInflight.delete(projectId);
    return rows;
  })();
  sprintInflight.set(projectId, p);
  return p;
}

async function fetchRef(ref: InternalLinkRef): Promise<ResolvedInternalLink> {
  if (!isSupabaseEnabled || !supabase) return unknown(ref);

  const project = await getProject(ref.projectSlug);
  if (!project) return missing(ref);
  const pn = project.name || project.slug;

  switch (ref.kind) {
    case "project":
      return ok(ref, pn, pn);

    case "ticket":
    case "sprint": {
      // 「BRU4-2」のような識別子もあるため、チケットWBSより先にスプリントとして照合する
      // （SprintPage.tsx:314-320 と同じ優先順位）
      const sprints = await getSprints(project.id);
      const sp = sprints.find(s => s.identifier === ref.id || s.id === ref.id);
      if (sp) return ok(ref, sp.name || sp.identifier, pn, { kind: "sprint", canonicalId: sp.id });
      if (ref.kind !== "ticket" || sprints.length === 0) return missing(ref, pn);
      const { data } = await supabase.from("sprint_tickets")
        .select("wbs, title")
        .eq("wbs", ref.id)
        .in("sprint_id", sprints.map(s => s.id))
        .limit(1);
      const t = data?.[0] as { wbs: string; title: string } | undefined;
      return t ? ok(ref, t.title || t.wbs, pn) : missing(ref, pn);
    }

    case "backlog":
    case "backlog-folder": {
      // backlog_items.id は "B-001" のような文字列（UUIDではない）
      const { data } = await supabase.from("backlog_items")
        .select("id, title, is_folder").eq("project_id", project.id).eq("id", ref.id).limit(1);
      const r = data?.[0] as { id: string; title: string; is_folder: boolean } | undefined;
      if (!r) return missing(ref, pn);
      return ok(ref, r.title, pn, { kind: r.is_folder ? "backlog-folder" : "backlog" });
    }

    case "wiki":
    case "wiki-folder": {
      if (!isUuid(ref.id)) return missing(ref, pn);
      const { data } = await supabase.from("wiki_pages")
        .select("id, title, is_folder").eq("project_id", project.id).eq("id", ref.id).limit(1);
      const r = data?.[0] as { id: string; title: string; is_folder: boolean } | undefined;
      if (!r) return missing(ref, pn);
      return ok(ref, r.title, pn, { kind: r.is_folder ? "wiki-folder" : "wiki" });
    }

    case "minute":
    case "minute-folder": {
      const base = supabase.from("meeting_minutes")
        .select("id, title, is_folder").eq("project_id", project.id);
      let rows: { id: string; title: string; is_folder: boolean }[] | null = null;
      if (isUuid(ref.id)) {
        const { data } = await base.eq("id", ref.id).limit(1);
        rows = data as typeof rows;
      } else {
        // URLには toMinuteSlug(created_at) = YYYYMMDD-HHMMSS が入ることがある
        const range = parseMinuteSlug(ref.id);
        if (!range) return missing(ref, pn);
        const { data } = await base.gte("created_at", range.fromIso).lt("created_at", range.toIso).limit(1);
        rows = data as typeof rows;
      }
      const r = rows?.[0];
      if (!r) return missing(ref, pn);
      return ok(ref, r.title, pn, { kind: r.is_folder ? "minute-folder" : "minute", canonicalId: r.id });
    }

    case "file":
    case "file-folder": {
      if (!isUuid(ref.id)) return missing(ref, pn);
      const { data } = await supabase.from("project_files")
        .select("id, file_name, is_folder").eq("project_id", project.id).eq("id", ref.id).limit(1);
      const r = data?.[0] as { id: string; file_name: string; is_folder: boolean } | undefined;
      if (!r) return missing(ref, pn);
      return ok(ref, r.file_name, pn, { kind: r.is_folder ? "file-folder" : "file" });
    }

    case "whiteboard": {
      if (!isUuid(ref.id)) return missing(ref, pn);
      const { data } = await supabase.from("whiteboards")
        .select("id, title").eq("project_id", project.id).eq("id", ref.id).limit(1);
      const r = data?.[0] as { id: string; title: string } | undefined;
      return r ? ok(ref, r.title || "無題のボード", pn) : missing(ref, pn);
    }
  }
}
