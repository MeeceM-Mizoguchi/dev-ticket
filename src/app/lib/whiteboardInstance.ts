// ホワイトボードキャンバスの「アクティブなインスタンス」管理。
//
// リンクプレビュー（右半分パネル）を使うと、裏のホワイトボード画面と重なって
// WhiteboardCanvas が同時に2枚存在し得る。ところが WhiteboardCanvas の
//   ・window レベルのキーボード/ポインタ処理（Esc・Cmd+Shift+C・undo検知・Shift追跡 など）
//   ・「テキスト編集中か」を document 全体から探す判定（.excalidraw-wysiwyg）
// はどちらも "画面に1枚しかない" 前提で書かれている。2枚あるとお互いの操作を拾ってしまい、
// 「パネル側でセル編集中 → 裏のボードが自分の表を編集中だと誤認して再レイアウトする」
// といった別ボードを壊す事故になる。
//
// そこで「最後に触られたインスタンスだけが自動処理とグローバル操作を担当する」ようにする。
// 非アクティブ側は自動処理を止めるだけで、リモート反映（Yjs）は従来どおり動く。
const stack: string[] = [];

const remove = (key: string) => {
  const i = stack.indexOf(key);
  if (i >= 0) stack.splice(i, 1);
};

/** マウント時に登録（登録した時点でアクティブになる）。 */
export function registerWbInstance(key: string): void {
  remove(key);
  stack.push(key);
}

/** アンマウント時に登録解除（残っている中で最後のものがアクティブに戻る）。 */
export function unregisterWbInstance(key: string): void {
  remove(key);
}

/** そのインスタンスを操作した（クリック/フォーカス）ときに呼ぶ。 */
export function activateWbInstance(key: string): void {
  if (stack[stack.length - 1] === key) return;
  remove(key);
  stack.push(key);
}

/** 自動処理・グローバル操作を担当してよいか。1枚しか無い時は常に true。 */
export function isActiveWbInstance(key: string): boolean {
  if (stack.length <= 1) return true;
  return stack[stack.length - 1] === key;
}
