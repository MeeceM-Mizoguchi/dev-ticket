// 他メンバーが「いま文字を編集している要素」を共有するための小さな置き場（BRU12-031）。
//
// Excalidraw はテキスト編集中 onChange を出さない＝入力内容も、それに追従して伸びた図形の高さも、
// 確定するまで Yjs へ流れない。一方で高さのフィット（whiteboardShapeFit）やインデント折り返し
// （whiteboardIndentWrap）は各クライアントが毎tick「今の同期内容」から導出し直す設計なので、
// 編集していない側は **1つ前の確定テキスト** を根拠に高さを計算してしまう。
//
//   編集者 : 入力中の行数で図形を伸ばす → 同期
//   他の人 : 確定済みテキストの行数で計算 → 「伸びすぎ」と判断して縮める → 同期
//   編集者 : 編集中の実体はローカル優先(keepLocalEditing)なので伸びたまま → また同期
//
// これが入力している間ずっと続き、編集していない側の画面で図形がチカチカする。
// 編集中の要素だけは「編集者が正」なので、他クライアントは導出を見送る。
//
// 値は awareness（カーソルと同じ経路）で配られる。編集者が離脱すれば awareness ごと消えるため、
// 編集中フラグが残り続けることはない。
let _ids: ReadonlySet<string> = new Set<string>();

/** 他メンバーが編集中の要素id（テキスト要素とそのコンテナ図形）を差し替える。 */
export function setRemoteEditingIds(next: Iterable<string>): void {
  _ids = new Set(next);
}

/** その要素を他メンバーが編集中か（＝こちらでは導出し直さない）。 */
export function isRemoteEditing(id?: string | null): boolean {
  return !!id && _ids.has(id);
}
