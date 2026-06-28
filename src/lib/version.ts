// 稼働中（今表示している画面）のバージョン。
// vite.config.ts の define で、ビルド時刻(JST)から自動採番した値が埋め込まれる。
// 例: "v2026.06.28.1322"  ※ dev サーバーでは起動時刻ベースの値になる。
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "v0.0.0.0000";
