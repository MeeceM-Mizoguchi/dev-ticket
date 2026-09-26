// Vercel の Ignored Build Step（vercel.json の ignoreCommand）。
// 終了コード 0 = このビルドを飛ばす / 1 = 通常どおりビルドする。
//
// PRをまとめてマージすると、数秒おきに main へコミットが積まれ、その1件ずつに本番ビルドが走る。
// すると app_version に同じ分の版が並び（バージョン情報の更新履歴に同時刻が何件も出る）、
// 画面側のデプロイ検知(useVersionCheck)も途中の版に乗り換えるたびにリロードしてしまう。
// 後ろのコミットのビルドは前のコミットを全部含むので、途中のコミットはビルドしなくてよい。
//
// そこで本番ビルドの開始時にしばらく main の先頭を見張り、自分より後のコミットが積まれたら
// このビルドを飛ばす。最後のコミットのビルドだけが残り、デプロイもリロードも1回で済む。
// 本番反映の確認（api/github の層B）は compare（祖先関係）で見ているので、途中を飛ばしても崩れない。
//
// 判断がつかないとき（プレビュー・通信失敗・古いコミットの再デプロイ等）は必ずビルドする側に倒す。
// ※ ignoreCommand は依存関係のインストール前に走るため、npm パッケージは使わない。
import { execFileSync } from "node:child_process";

// 自分より後のコミットが来ないか見張る時間。まとめてマージは1件あたり数秒間隔なので、
// 各コミットはこの間に次のコミットを必ず目にする（件数が多くても最後の1件だけが残る）。
const WATCH_MS = 25 * 1000;
const POLL_MS = 4 * 1000;
// コミットからこれ以上経っているビルドは、マージ直後のビルドではない（再デプロイ等）ので見張らない。
const FRESH_SEC = 10 * 60;

const BUILD = 1;
const SKIP = 0;

const env = process.env;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => console.log(`[skip-superseded-build] ${msg}`);

function remoteTip(url, ref) {
  const out = execFileSync("git", ["ls-remote", url, `refs/heads/${ref}`], {
    encoding: "utf8",
    timeout: 10 * 1000,
    env: { ...env, GIT_TERMINAL_PROMPT: "0" },
  });
  const sha = out.trim().split(/\s+/)[0] ?? "";
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null;
}

function commitAgeSec() {
  const t = Number(execFileSync("git", ["log", "-1", "--format=%ct", "HEAD"], { encoding: "utf8" }).trim());
  return Number.isFinite(t) && t > 0 ? Date.now() / 1000 - t : null;
}

async function main() {
  if (env.VERCEL_ENV !== "production") return BUILD;
  const sha = (env.VERCEL_GIT_COMMIT_SHA ?? "").toLowerCase();
  const ref = env.VERCEL_GIT_COMMIT_REF;
  const owner = env.VERCEL_GIT_REPO_OWNER;
  const slug = env.VERCEL_GIT_REPO_SLUG;
  if (env.VERCEL_GIT_PROVIDER !== "github" || !sha || !ref || !owner || !slug) return BUILD;

  const age = commitAgeSec();
  if (age === null || age > FRESH_SEC) {
    log("マージ直後のビルドではないため、そのままビルドします。");
    return BUILD;
  }

  const url = `https://github.com/${owner}/${slug}.git`;
  const until = Date.now() + WATCH_MS;
  for (;;) {
    const tip = remoteTip(url, ref);
    if (!tip) {
      log(`${ref} の先頭を取得できなかったため、そのままビルドします。`);
      return BUILD;
    }
    if (tip !== sha) {
      log(`${ref} にさらに新しいコミット(${tip.slice(0, 7)})があるため、${sha.slice(0, 7)} のビルドは飛ばします（新しい方のビルドに含まれます）。`);
      return SKIP;
    }
    if (Date.now() >= until) break;
    await sleep(POLL_MS);
  }
  log(`${sha.slice(0, 7)} が ${ref} の最新のため、ビルドします。`);
  return BUILD;
}

main().then(
  code => process.exit(code),
  e => {
    log(`確認に失敗したため、そのままビルドします: ${e?.message ?? e}`);
    process.exit(BUILD);
  },
);
