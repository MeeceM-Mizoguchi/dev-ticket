// エクスポート進捗のグローバルストア（外部ストア）。
// 複数箇所(ページヘッダ/フォルダビュー/ツリーメニュー)から呼ばれる生成処理の進捗を
// 単一のオーバーレイ(ExportProgressOverlay)へ配信する。useSyncExternalStore で購読する。
import type { ExportFormat } from "./types";

export type ExportPhase = "prepare" | "images" | "render";

export interface ExportProgressState {
  active: boolean;
  format: ExportFormat | null;
  phase: ExportPhase;
  loaded: number; // 取得済み画像数
  total: number;  // 総画像数
  scope: string;  // 対象名（記事名/フォルダ名）
}

const IDLE: ExportProgressState = { active: false, format: null, phase: "prepare", loaded: 0, total: 0, scope: "" };
let state: ExportProgressState = IDLE;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }

export function subscribeExportProgress(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function getExportProgress(): ExportProgressState {
  return state;
}

export function startExport(format: ExportFormat, scope: string) {
  state = { active: true, format, phase: "prepare", loaded: 0, total: 0, scope };
  emit();
}

export function reportImages(loaded: number, total: number) {
  state = { ...state, phase: "images", loaded, total };
  emit();
}

export function reportRender() {
  state = { ...state, phase: "render" };
  emit();
}

export function finishExport() {
  state = IDLE;
  emit();
}
