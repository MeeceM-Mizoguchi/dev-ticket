// 図形（四角/ひし形/楕円/矢印・表セルなど）のラベルの文字色パネル（BRU7-056-2）。
//
// Excalidraw 標準の「線」は枠線と中の文字をまとめて塗るため、文字色だけを指定する場所が
// 左メニューに無かった。標準パネル（.App-menu__left .panelColumn）の「背景」の直後へ
// 「文字色」セクションを差し込む（TextBoxFormatPanel と同じく実ノードを挿し、
// React portal で中身を描く。legend/fieldset は標準セクションと同じ体裁になる）。
//
// まだ文字を入れていない図形でも出す（BRU7-056-2 追補）。色は図形側の customData.wbTextColor に
// 記録され、あとからラベルを入れるとその色で作られる（whiteboardTextColor が担当）。
//
// 文字を入力している最中／テキストツールを選んだ直後も出す（BRU7-056-2 追補2）。
// 素のテキストは Excalidraw 的には strokeColor がそのまま文字色なので、この状態の標準「線」は
// “線”という名前で文字色を変えている＝紛らわしい。ここで「文字色」に置き換えて標準の「線」は隠す。
//
// 素のテキストボックス単体を「選択」している時だけは TextBoxFormatPanel 側に「文字色」があるため
// ここでは出さない（同じ差し込み位置を2つのパネルで奪い合わないようにする）。複数選択に
// 混ざっている場合はこちらが面倒を見る。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CustomColorSwatch, Swatch, swatchRow } from "./ColorSwatch";
import { IndentField } from "./IndentField";
import { isPlainTextBox } from "@/app/lib/whiteboardTextBoxBg";
import { TEXT_COLORS, boundTextOf, canHaveLabel, readLabelColor, readTextColor, setTextColor } from "@/app/lib/whiteboardTextColor";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

// 標準の「線」セクションを隠すCSS。素のテキストが対象のときだけ差し込む
// （テキストの strokeColor ＝ 文字色。同じ操作が「線」と「文字色」の2箇所に出るのを避ける）。
// 図形が対象のときの「線」は本物の枠線色なので隠さない。
export const HIDE_NATIVE_STROKE = `
.excalidraw .App-menu__left .panelColumn > *:has(.color-picker__button.active-color) { display: none !important; }
`;

// 対象: 実際に色を書き込む要素id群 / 現在色 / 標準「線」を隠すか / 既定色(currentItemStrokeColor)も更新するか
// indentText / indentIds はインデント欄（BRU9-040）用。揃えの判定に使うテキスト要素と、書き換え対象。
interface Target {
  ids: string[];
  colors: string[];
  hideStroke: boolean;
  currentItem: boolean;
  indentText: any | null;
  indentIds: string[];
}
const NO_TARGET: Target = { ids: [], colors: [], hideStroke: false, currentItem: false, indentText: null, indentIds: [] };

/**
 * 「背景」セクション（＝標準パネルの2つ目のカラーピッカー）の直後を差し込み位置として返す。
 * 見出し文字はロケール依存なので、カラーピッカーの並び順で判定する
 * （プロパティパネルのカラーピッカーは 線 → 背景 の2つだけ）。背景を持たない要素では
 * 1つ目（線）の直後になる。
 */
function anchorSection(host: HTMLElement): HTMLElement | null {
  const pickers = host.querySelectorAll(".color-picker__button.active-color");
  let node = (pickers[1] ?? pickers[0] ?? null) as HTMLElement | null;
  while (node && node.parentElement !== host) node = node.parentElement;
  return node;
}

/**
 * 文字色の対象を集める。図形は「ラベルの色」の記録先、テキストは実際の塗り先。
 * 併せて、各対象が今どの色になっているか（＝スウォッチのハイライト用）も返す。
 *  1. 入力中     … 編集しているテキスト（図形のラベルなら図形にも記録する）
 *  2. 選択中     … ラベルを入れられる図形・テキストボックス
 *  3. テキストツール選択中 … これから作るテキストの色（currentItemStrokeColor）
 */
function collectTargets(api: any, appState: any): Target {
  const els = api.getSceneElements() as any[];
  const byId = new Map<string, any>(els.map((e) => [e.id, e]));

  // 1. 入力中: そのテキストだけを対象に（このとき TextBoxFormatPanel は出ていないので競合しない）
  // シーンにまだ載っていない作りかけのテキストもあるので、見つからなければ appState 側を使う
  const editingId = appState.editingTextElement?.id;
  const editing = editingId ? (byId.get(editingId) ?? appState.editingTextElement) : undefined;
  if (editing?.type === "text") {
    const container = editing.containerId ? byId.get(editing.containerId) : undefined;
    const plain = !container;
    return {
      ids: container ? [editing.id, container.id] : [editing.id],
      colors: [readTextColor(editing)],
      hideStroke: plain,   // 図形のラベル編集中の「線」は本物の枠線色なので残す
      currentItem: plain,  // 入力中の見た目を即座に切り替えるため（標準の「線」と同じ振る舞い）
      indentText: editing,
      indentIds: [editing.id],
    };
  }

  // 2. 選択中
  const sel = appState.selectedElementIds || {};
  const picked = els.filter((e) => sel[e.id] && (canHaveLabel(e) || isPlainTextBox(e)));
  if (picked.length) {
    // テキストボックス単体の選択は TextBoxFormatPanel の担当（「文字色」が二重に出ないように）
    if (picked.length === 1 && isPlainTextBox(picked[0])) return NO_TARGET;
    const ids: string[] = [];
    const colors: string[] = [];
    for (const e of picked) {
      ids.push(e.id);
      colors.push(isPlainTextBox(e) ? readTextColor(e) : readLabelColor(e, byId));
      // 図形は記録先。実際に塗る対象としてラベル自身も一緒に更新する
      for (const b of e.boundElements ?? []) {
        const t = b?.type === "text" ? byId.get(b.id) : undefined;
        if (t && !t.isDeleted) ids.push(t.id);
      }
    }
    // インデントの揃え判定は「最初に見つかった実テキスト」で行う（ラベル未作成の図形は対象外）
    let indentText: any = null;
    for (const e of picked) {
      const t = isPlainTextBox(e) ? e : boundTextOf(e, byId);
      if (t) { indentText = t; break; }
    }
    // テキストボックスだけを選んでいる時は、標準の「線」＝文字色なので隠す
    return {
      ids, colors, hideStroke: picked.every(isPlainTextBox), currentItem: false,
      indentText, indentIds: indentText ? picked.map((e) => e.id) : [],
    };
  }

  // 3. テキストツール選択中（まだ何も無い）: これから作るテキストの色を決める
  if (appState.activeTool?.type === "text") {
    return { ids: [], colors: [appState.currentItemStrokeColor], hideStroke: true, currentItem: true, indentText: null, indentIds: [] };
  }
  return NO_TARGET;
}

export function TextColorPanel({ api, containerRef, canEdit }: Props) {
  const [target, setTarget] = useState<
    { ids: string[]; color: string | undefined; hideStroke: boolean; currentItem: boolean; indentText: any | null; indentIds: string[] } | null
  >(null);
  const mountRef = useRef<HTMLDivElement | null>(null); // 標準パネルへ差し込む実ノード
  const raf = useRef<number>(0);
  const sigRef = useRef<string>("");

  // 差し込み用ノードを1つだけ生成（.panelColumn と同じ縦並び間隔にする）
  if (!mountRef.current && typeof document !== "undefined") {
    const node = document.createElement("div");
    node.style.display = "flex";
    node.style.flexDirection = "column";
    node.style.rowGap = "0.75rem";
    mountRef.current = node;
  }

  useEffect(() => {
    const mount = mountRef.current;
    if (!canEdit) { setTarget(null); return; }
    const detach = () => { if (mount?.parentNode) mount.parentNode.removeChild(mount); };

    const tick = () => {
      try {
        const st = api.getAppState();
        // 新規描画/リサイズ/範囲選択中はパネルを出さない（操作の邪魔をしない）。
        // テキスト入力中は逆に出す（入力しながら色を変えられるように・collectTargets が担当）。
        const interacting = !!(st.newElement || st.resizingElement || st.selectionElement);
        const { ids, colors, hideStroke, currentItem, indentText, indentIds } = interacting ? NO_TARGET : collectTargets(api, st);

        if (colors.length && mount) {
          const host = containerRef.current?.querySelector(".App-menu__left .panelColumn") as HTMLElement | null;
          const anchor = host ? anchorSection(host) : null;
          if (host) {
            // 位置がズレている時だけDOMを触る（毎フレームの再挿入を避け、Excalidrawの再描画にも自己修復）
            if (anchor && mount.previousElementSibling !== anchor) host.insertBefore(mount, anchor.nextSibling);
            else if (!mount.parentNode) host.appendChild(mount); // 万一アンカーが取れない時のフォールバック
          }
          // textAlign も署名に入れる: 揃えを変えた瞬間にインデント欄の活性/非活性を切り替えるため
          const sig = `${ids.join(",")}:${colors.join(",")}:${hideStroke}:${!!anchor}:${!!host}:${indentText?.id}:${indentText?.textAlign}`;
          if (sig !== sigRef.current) {
            sigRef.current = sig;
            // 複数選択で色が混在している時はどのスウォッチも光らせない（クリックで一括統一される）
            const uniq = new Set(colors);
            setTarget({ ids, color: uniq.size === 1 ? [...uniq][0] : undefined, hideStroke, currentItem, indentText, indentIds });
          }
        } else if (sigRef.current !== "") {
          sigRef.current = "";
          detach();
          setTarget(null);
        }
      } catch { /* noop */ }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); detach(); };
  }, [api, canEdit, containerRef]);

  if (!target || !mountRef.current) return null;

  const { ids, color, hideStroke, currentItem, indentText, indentIds } = target;
  const isCustom = !!color && !TEXT_COLORS.includes(color);
  const apply = (c: string) => setTextColor(api, ids, c, currentItem);

  return createPortal(
    <>
      {hideStroke && <style>{HIDE_NATIVE_STROKE}</style>}
      <fieldset>
        <legend>文字色</legend>
        <div style={swatchRow}>
          {TEXT_COLORS.map((c) => <Swatch key={c} color={c} active={color === c} onPick={() => apply(c)} />)}
          <CustomColorSwatch value={color} active={isCustom} onPick={apply} />
        </div>
      </fieldset>
      <IndentField api={api} text={indentText} ids={indentIds} />
    </>,
    mountRef.current,
  );
}
