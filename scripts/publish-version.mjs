// デプロイ時にビルド済みバージョンを DB(app_version) へ自動記録する postbuild スクリプト。
// `pnpm build` の最後に実行される。Service Role Key がある環境（Vercel 本番ビルド等）でのみ動作し、
// ローカル/ネイティブビルドなど鍵が無い環境では何もせずスキップする（＝開発者の手作業は不要）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  if (!url || !serviceKey) {
    console.log("[publish-version] SUPABASE_SERVICE_ROLE_KEY 未設定のためスキップします（DBへのバージョン記録なし）。");
    return;
  }

  let info;
  try {
    const raw = readFileSync(join(__dirname, "..", "dist", "build-info.json"), "utf8");
    info = JSON.parse(raw);
  } catch (e) {
    console.error("[publish-version] dist/build-info.json を読めませんでした:", e?.message ?? e);
    process.exitCode = 0; // ビルド自体は失敗させない
    return;
  }

  const { version, buildTime } = info ?? {};
  if (!version) {
    console.error("[publish-version] build-info.json に version がありません。スキップします。");
    return;
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 同一バージョンが既にあれば二重登録しない（再デプロイ等での冪等性）。
  const { error } = await supabase
    .from("app_version")
    .upsert({ version, build_time: String(buildTime ?? "") }, { onConflict: "version", ignoreDuplicates: true });

  if (error) {
    console.error("[publish-version] DB記録に失敗:", error.message);
    process.exitCode = 0; // デプロイは止めない
    return;
  }
  console.log(`[publish-version] バージョン ${version} を app_version へ記録しました。`);
}

main();
