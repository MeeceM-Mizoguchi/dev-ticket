// ENHA2-035 ファイルボックス: WebDAV エンドポイント（入口・薄いre-export）
//
// 実装本体は api/dav-open.ts に集約している。理由はルーティングの都合:
//   Office が開く実 URL /api/dav/<token>/<ファイル名>.xlsx は「2セグメント」だが、
//   本番 Vercel ではこの [...path] キャッチオールが 1セグメントしか関数へ振らず、
//   2セグメント以上は関数に届く前に NOT_FOUND になる（Office からは「接続できません」）。
//   そのため vercel.json の rewrite で /api/dav/* を /api/dav-open へ寄せている。
//
// このファイルは
//   - dev サーバー（vite の api 解決）が /api/dav/... を叩けるようにするため
//   - 本番でも単一セグメント(/api/dav/<token>)が来た場合の入口として
// 残しており、実装は dav-open.ts をそのまま使う。
export { default } from "../dav-open";
