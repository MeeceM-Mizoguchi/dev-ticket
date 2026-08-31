// BRU14-001 の検証スクリプト。
//
// お客様（山本さま）の再現手順を、そのまま自動で実行する。
//   1. アカウントでログインする
//   2. REST API を直接叩いて projects / sprint_tickets / ticket_comments / project_files を取る
//   3. 返ってきた行が「そのユーザーがアクセスしてよいもの」だけかを確認する
//
// service_role キーがあれば「DB全体の件数」も出すので、
//   全体 120 件のうち 8 件だけが返っている
// という形で、絞り込みが効いていることを数字で示せる。
//
// ── 使い方 ──────────────────────────────────────────────────
//   node scripts/verify-rls-BRU14-001.mjs <メールアドレス> <パスワード>
//
// URL / anonキーは .env から読む（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。
// SUPABASE_SERVICE_ROLE_KEY も .env にあれば自動で使う。
//
// ★ 適用前に一度流して「漏れている」ことを確認し、適用後にもう一度流して
//    「漏れていない」ことを確認する、という使い方を想定している。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env を素朴に読む（dotenv 依存を増やさないため）
function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = readFileSync(join(__dirname, "..", ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (env[m[1]]) continue; // 実環境変数を優先
      env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* .env が無くても環境変数だけで動く */ }
  return env;
}

const env = loadEnv();
const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const [email, password] = process.argv.slice(2);

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!url || !anonKey) die("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が読めません（.env を確認してください）");
if (!email || !password) die("使い方: node scripts/verify-rls-BRU14-001.mjs <メールアドレス> <パスワード>");

const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const ng = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

let failures = 0;
function report(label, passed, detail) {
  if (!passed) failures++;
  console.log(`  ${passed ? ok("PASS") : ng("FAIL")}  ${label}${detail ? dim(`  ${detail}`) : ""}`);
}

async function main() {
  // ── 1. 未ログインで叩く（お客様の言う「未ログインでは何も返らない」の確認） ──
  console.log("\n■ 未ログイン（anonキーのみ）");
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: anonProjects } = await anon.from("projects").select("id");
  report("projects が0件", (anonProjects ?? []).length === 0, `返却 ${(anonProjects ?? []).length} 件`);

  // ── 2. ログインする ──
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: signIn, error: signInError } = await sb.auth.signInWithPassword({ email, password });
  if (signInError || !signIn?.user) die(`ログインに失敗しました: ${signInError?.message ?? "unknown"}`);

  const { data: me } = await sb.from("profiles").select("name, role, organization_id").eq("id", signIn.user.id).maybeSingle();
  if (!me) die("自分の profiles 行が読めません。profiles のポリシーを確認してください");
  console.log(`\n■ ログイン: ${me.name} (role=${me.role}, org=${me.organization_id ?? "なし"})`);

  // ── 3. 見えてよいプロジェクトの集合を作る ──
  // 画面(ProjectsPage)と同じ基準。owner / 同組織のadmin・PM は組織全体、
  // それ以外は members に自分が入っているものだけ。
  const admin = serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;

  let expected = null; // 期待されるプロジェクトIDの集合（service_role が無ければ null）
  let totalProjects = null;
  if (admin) {
    const { data: all } = await admin.from("projects").select("id, organization_id, members");
    totalProjects = (all ?? []).length;
    expected = new Set(
      (all ?? [])
        .filter(p => {
          if (me.role === "owner") return true;
          const sameOrg = p.organization_id != null && String(p.organization_id) === String(me.organization_id);
          if (sameOrg) return (p.members ?? []).includes(me.name) || ["admin", "project-manager"].includes(me.role);
          if (p.organization_id == null) return (p.members ?? []).includes(me.name);
          return false;
        })
        .map(p => p.id),
    );
  }

  // ── 4. REST API を直接叩く（お客様がやったこと） ──
  console.log("\n■ ログイン済みで REST API を直接呼ぶ");
  const { data: projects } = await sb.from("projects").select("id, name, organization_id, members");
  const projectIds = new Set((projects ?? []).map(p => p.id));
  console.log(dim(`  projects: ${projectIds.size} 件返却${totalProjects != null ? ` / DB全体 ${totalProjects} 件` : ""}`));

  // 別組織の行が混ざっていないか（これが今回の指摘そのもの）
  const foreignOrg = (projects ?? []).filter(
    p => me.role !== "owner" && p.organization_id != null && String(p.organization_id) !== String(me.organization_id),
  );
  report("他組織のプロジェクトが返らない", foreignOrg.length === 0,
    foreignOrg.length ? `混入 ${foreignOrg.length} 件: ${foreignOrg.slice(0, 3).map(p => p.name).join(", ")}` : "");

  // 同組織でも未アサインの行が返っていないか
  const unassigned = (projects ?? []).filter(
    p => !["owner", "admin", "project-manager"].includes(me.role) && !(p.members ?? []).includes(me.name),
  );
  report("アサインされていないプロジェクトが返らない", unassigned.length === 0,
    unassigned.length ? `混入 ${unassigned.length} 件: ${unassigned.slice(0, 3).map(p => p.name).join(", ")}` : "");

  if (expected) {
    const missing = [...expected].filter(id => !projectIds.has(id));
    const extra = [...projectIds].filter(id => !expected.has(id));
    report("見えるべきものが全部見えている（絞りすぎていない）", missing.length === 0,
      missing.length ? `欠落 ${missing.length} 件: ${missing.slice(0, 5).join(", ")}` : "");
    report("見えてはいけないものが1件も無い", extra.length === 0,
      extra.length ? `余分 ${extra.length} 件: ${extra.slice(0, 5).join(", ")}` : "");
  }

  // ── 5. 子テーブルも同じ境界で絞られているか ──
  console.log("\n■ 子テーブル（チケット本文・コメント・ファイル等）");

  const { data: sprints } = await sb.from("sprints").select("id, project_id");
  const sprintIds = new Set((sprints ?? []).map(s => s.id));
  const strayS = (sprints ?? []).filter(s => !projectIds.has(s.project_id));
  report("sprints", strayS.length === 0,
    `${(sprints ?? []).length} 件返却${strayS.length ? ` / 圏外 ${strayS.length} 件` : ""}`);

  const { data: tickets } = await sb.from("sprint_tickets").select("id, sprint_id, title");
  const ticketIds = new Set((tickets ?? []).map(t => t.id));
  const strayT = (tickets ?? []).filter(t => !sprintIds.has(t.sprint_id));
  report("sprint_tickets", strayT.length === 0,
    `${(tickets ?? []).length} 件返却${strayT.length ? ` / 圏外 ${strayT.length} 件` : ""}`);

  const { data: comments } = await sb.from("ticket_comments").select("id, ticket_id");
  const strayC = (comments ?? []).filter(c => !ticketIds.has(c.ticket_id));
  report("ticket_comments", strayC.length === 0,
    `${(comments ?? []).length} 件返却${strayC.length ? ` / 圏外 ${strayC.length} 件` : ""}`);

  for (const table of ["project_files", "wiki_pages", "meeting_minutes", "backlog_items", "whiteboards"]) {
    const { data, error } = await sb.from(table).select("id, project_id");
    if (error) { report(table, false, `取得エラー: ${error.message}`); continue; }
    const stray = (data ?? []).filter(r => !projectIds.has(r.project_id));
    report(table, stray.length === 0,
      `${(data ?? []).length} 件返却${stray.length ? ` / 圏外 ${stray.length} 件` : ""}`);
  }

  // ── 6. 組織単位のテーブル ──
  console.log("\n■ 組織単位のテーブル");
  const { data: profiles } = await sb.from("profiles").select("id, name, organization_id");
  const strayP = (profiles ?? []).filter(
    p => me.role !== "owner" && p.id !== signIn.user.id && String(p.organization_id) !== String(me.organization_id),
  );
  report("profiles（他社のメンバー一覧が返らない）", strayP.length === 0,
    `${(profiles ?? []).length} 件返却${strayP.length ? ` / 圏外 ${strayP.length} 件` : ""}`);

  const { data: notifs } = await sb.from("notifications").select("id, user_name");
  const strayN = (notifs ?? []).filter(n => n.user_name !== me.name);
  report("notifications（他人宛の通知が返らない）", strayN.length === 0,
    `${(notifs ?? []).length} 件返却${strayN.length ? ` / 圏外 ${strayN.length} 件` : ""}`);

  await sb.auth.signOut();

  console.log("");
  if (failures === 0) {
    console.log(ok("✓ すべて期待どおりに絞り込まれています。"));
  } else {
    console.log(ng(`✗ ${failures} 件が期待どおりではありません。`));
    console.log(dim("  supabase/fix_project_level_rls_BRU14-001.sql が適用済みか、"));
    console.log(dim("  末尾 8-1 のポリシー一覧に dt_rls_* が並んでいるかを確認してください。"));
    process.exitCode = 1;
  }
}

main().catch(e => die(e?.message ?? String(e)));
