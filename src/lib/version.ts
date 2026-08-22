// 稼働中（今表示している画面）のバージョン。
// vite.config.ts の define で、ビルド時刻(JST)から自動採番した値が埋め込まれる。
// 例: "v2026.06.28.1322"  ※ dev サーバーでは起動時刻ベースの値になる。
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "v0.0.0.0000";

// 今表示しているバンドル自身のビルド時刻(epoch ms の文字列)。
// dist/build-info.json の buildTime と同じ値が焼き込まれる。
// サーバー上の build-info.json と突き合わせることで「今動いているコードが古いか」を
// 直接判定できる（useVersionCheck）。
declare const __APP_BUILD_TIME__: string;

export const APP_BUILD_TIME: string = typeof __APP_BUILD_TIME__ !== "undefined" ? __APP_BUILD_TIME__ : "";

// ── 「このバージョンがいつ更新されたか」の表示用 ────────────────────────
// 基準は APP_BUILD_TIME（epoch ms＝ビルドされた瞬間そのもの）。
// 焼込みが無い環境（古いバンドル等）では、バージョン文字列 "v2026.08.22.1917" から
// 分単位まで復元する。採番は JST 基準なので、JST の壁時計時刻として UTC に戻す。
function parseVersionToDate(v: string): Date | null {
  const m = /^v(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 9, Number(m[5])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export const APP_BUILD_DATE: Date | null = (() => {
  const ms = Number(APP_BUILD_TIME);
  if (APP_BUILD_TIME && Number.isFinite(ms) && ms > 0) return new Date(ms);
  return parseVersionToDate(APP_VERSION);
})();

const JST_WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

// 端末のタイムゾーンに関係なく日本時間で「2026年8月22日(金) 19:17」と表示する。
// （バージョン番号自体が JST 採番なので、表示も JST で揃える）
export function formatJstDateTime(input: Date | string | number): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000); // UTC+9
  const p = (n: number) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}年${j.getUTCMonth() + 1}月${j.getUTCDate()}日(${JST_WEEKDAY[j.getUTCDay()]}) ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}

// 稼働中バージョンの更新日時（表示用文字列）。取得できない場合は空文字。
export const APP_BUILD_AT_TEXT: string = APP_BUILD_DATE ? formatJstDateTime(APP_BUILD_DATE) : "";

// 「3日前」「2時間前」などの経過表示。
export function formatElapsed(from: Date, now: number = Date.now()): string {
  const diff = now - from.getTime();
  if (diff < 0) return "";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "たった今";
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}日前`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}ヶ月前`;
  return `${Math.floor(d / 365)}年前`;
}
