// ENHA2-032 タスク表の文字セル（タイトル・詳細）。
//
// 列幅は他の項目と縦を揃えるために狭く、長い文章はセルの中に収まらない。
// 幅そのものを広げると他の列が押し出されて表が崩れるので、幅は変えずに
//   ・欄に入った（クリック・Tab）ときだけ、セルの上に広い入力欄を重ねて全文を出す
//   ・欄に入っていなくても、マウスを乗せれば全文をツールチップで出す
// の2つで「見えない・直しにくい」を解消する。
//
// 重ねる入力欄は body 直下に出す（行やスクロール枠で切られないようにするため）。
// 出している間もセルの入力欄は元の場所に残るので、行の並びは動かない。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** 重ねる入力欄の最低幅。セルがこれより狭くても、これだけは広げる */
const EXPAND_MIN_WIDTH = 420;
/** 重ねる入力欄の高さの上限。これを超えたぶんは中でスクロールさせる */
const EXPAND_MAX_HEIGHT = 220;
/** ツールチップの最大幅 */
const TIP_MAX_WIDTH = 440;
/** 画面の縁からの余白 */
const EDGE = 8;
/** マウスを乗せてからツールチップを出すまで（すぐ出すと通り過ぎるだけで点滅するため） */
const TIP_DELAY = 350;

/** body 直下に出すので、行から継承できない文字まわりは書き下す */
const OVERLAY_TEXT: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: 1.6,
  color: "#1A1714",
  fontWeight: 500,
};

type Box = { top: number; left: number; width: number };

/** Tab で移りたい欄（ブラウザ標準の順番と同じもの） */
const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

/**
 * 隣の欄へフォーカスを移す。
 *
 * 重ねる入力欄は body 直下に出しているので、そのまま Tab を押すと
 * ブラウザは「body の末尾の次」へ飛ばしてしまい、右の列へ移れない。
 * 元のセル（表の中にある入力欄）を基準に、画面の並び順で次／前を探して渡す。
 *
 * @param from  基準にするセルの入力欄
 * @param back  Shift+Tab（前へ戻る）か
 * @param skip  数えたくない要素（重ねている入力欄そのもの）
 */
export function focusAdjacentCell(from: HTMLElement, back: boolean, skip?: HTMLElement | null) {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))
    // 隠れている欄（閉じたメニューの中など）は飛ばす。基準そのものは必ず残す
    .filter(el => el === from || (el !== skip && el.tabIndex >= 0 && el.offsetParent !== null));
  const i = all.indexOf(from);
  if (i < 0) return;
  all[back ? i - 1 : i + 1]?.focus();
}

/**
 * マウスを乗せたセルの中身を全文出す。
 *
 * 切れていないセルにも出す（どこまでが1件ぶんの文章かを、欄に入らずに読めるように）。
 * 空のセルだけは出さない（出しても読むものが無いため）。
 */
export function useCellTooltip(text: string, enabled = true) {
  const ref = useRef<HTMLElement | null>(null);
  const [tip, setTip] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
  };
  const hide = () => { stop(); setTip(null); };

  // 出しっぱなしのまま行が消える（削除・絞り込み）ことがあるので、後片付けする
  useEffect(() => hide, []);

  const onMouseEnter = () => {
    stop();
    if (!enabled || !text) return;
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - TIP_MAX_WIDTH - EDGE));
      // 下に置く余裕がなければ上に置く（表の最終行でも隠れないように）
      const below = window.innerHeight - r.bottom > 140;
      setTip(below
        ? { left, top: r.bottom + 6 }
        : { left, bottom: window.innerHeight - r.top + 6 });
    }, TIP_DELAY);
  };

  const tooltip = tip
    ? createPortal(
      <div style={{
        position: "fixed", top: tip.top, bottom: tip.bottom, left: tip.left,
        maxWidth: TIP_MAX_WIDTH, zIndex: 600, pointerEvents: "none",
        background: "#1A1714", color: "#FFF", borderRadius: 7, padding: "7px 10px",
        fontFamily: "var(--font-body)", fontSize: 12, lineHeight: 1.6, fontWeight: 500,
        whiteSpace: "pre-wrap", wordBreak: "break-word",
        boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
      }}>
        {text}
      </div>,
      document.body,
    )
    : null;

  return { ref, hide, hoverProps: { onMouseEnter, onMouseLeave: hide }, tooltip };
}

/**
 * 欄に入ると広がる1行の入力欄。
 *
 * 見た目は表のセルのまま（素の文字）で、フォーカスしたときだけ同じ位置に
 * 折り返し表示の入力欄を重ねる。中身はあくまで1行なので、貼り付けた改行は空白に潰す
 * （詳細メモは確定するときに段落へ戻る＝TaskListView 側の変換に任せる）。
 */
export function ExpandingInput({
  value, onChange, onOpen, onClose, onEnter, onEscape,
  placeholder, style, className, inputRef, tooltip = true,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 欄に入った */
  onOpen?: () => void;
  /** 欄から離れた（確定はここで行う） */
  onClose?: () => void;
  /** Enter。省略すると「閉じて確定する」だけ（追加行は続けて打てるよう閉じない） */
  onEnter?: () => void;
  /** Esc。打ちかけを捨てるなど。呼んだあとに閉じる */
  onEscape?: () => void;
  placeholder?: string;
  /** 列幅など、セルとしての見た目 */
  style?: React.CSSProperties;
  className?: string;
  /** 追加行のフォーカス制御用。閉じているときのセルの入力欄を指す */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** マウスオーバーで全文を出すか */
  tooltip?: boolean;
}) {
  const localRef = useRef<HTMLInputElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  /** 重ねた欄の実際の高さ（中身に合わせて伸ばしたあと） */
  const [height, setHeight] = useState(0);
  const openRef = useRef(false);
  const tip = useCellTooltip(value, tooltip && !box);

  const setInput = (el: HTMLInputElement | null) => {
    localRef.current = el;
    tip.ref.current = el;
    if (inputRef) inputRef.current = el;
  };

  const measure = (): Box | null => {
    const el = localRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const width = Math.min(
      Math.max(r.width + 14, EXPAND_MIN_WIDTH),
      window.innerWidth - EDGE * 2,
    );
    // 右端からはみ出すぶんは左へ寄せる。文字の出だしはセルと同じ位置に来るよう 7px ずらす
    const left = Math.max(EDGE, Math.min(r.left - 7, window.innerWidth - width - EDGE));
    return { top: r.top - 5, left, width };
  };

  const open = () => {
    if (openRef.current) return;
    const b = measure();
    if (!b) return;
    openRef.current = true;
    tip.hide();
    setBox(b);
    onOpen?.();
  };

  const close = () => {
    if (!openRef.current) return;
    openRef.current = false;
    setBox(null);
    onClose?.();
  };

  // 開いている間に表がスクロールしたら、重ねた欄も一緒に動かす
  useEffect(() => {
    if (!box) return;
    const follow = () => { const b = measure(); if (b) setBox(b); };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [box !== null]);

  // 開いた直後にフォーカスを移し、カーソルは末尾に置く（続きから打てるように）
  useEffect(() => {
    if (!box) return;
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [box !== null]);

  // 中身に合わせて高さを伸ばす（伸びた高さは、下にはみ出さない位置を出すのに使う）
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el || !box) return;
    el.style.height = "auto";
    const h = Math.min(el.scrollHeight, EXPAND_MAX_HEIGHT);
    el.style.height = `${h}px`;
    setHeight(h);
  }, [value, box]);

  // 画面の下からはみ出すなら上へ詰める（最終行で欄が切れないように）
  const top = box
    ? Math.max(EDGE, Math.min(box.top, window.innerHeight - EDGE - (height + 12)))
    : 0;

  return (
    <>
      <input
        ref={setInput}
        className={className}
        value={value}
        placeholder={placeholder}
        style={style}
        {...tip.hoverProps}
        // 打ち込みは重ねた欄が受け持つ。開く前に打てた1文字も取りこぼさない
        onChange={e => onChange(e.target.value)}
        onFocus={() => {
          // 追加行のように外からフォーカスを戻されたときは、重ねた欄へ返す
          if (openRef.current) { areaRef.current?.focus(); return; }
          open();
        }} />

      {box && createPortal(
        <textarea
          ref={areaRef}
          value={value}
          placeholder={placeholder}
          rows={1}
          onChange={e => onChange(e.target.value.replace(/\r?\n/g, " "))}
          onBlur={e => {
            // 自分のセルの入力欄へ移っただけなら閉じない（フォーカスを返しに来ただけ）
            if (e.relatedTarget && e.relatedTarget === localRef.current) return;
            close();
          }}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (onEnter) onEnter(); else close();
              return;
            }
            // Tab は「打ち終えて右の列へ」。ここで閉じてから自分で次の欄へ渡す
            // （重ねた欄は body 直下にあるので、標準の Tab では右の列へ移れない）
            if (e.key === "Tab" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const cell = localRef.current;
              const overlay = areaRef.current;
              close();
              if (cell) focusAdjacentCell(cell, e.shiftKey, overlay);
              return;
            }
            if (e.key === "Escape") { onEscape?.(); close(); }
          }}
          style={{
            ...OVERLAY_TEXT,
            position: "fixed", top, left: box.left, width: box.width,
            zIndex: 500, boxSizing: "border-box",
            padding: "5px 7px", margin: 0,
            background: "#FFF",
            border: "1px solid #059669",
            borderRadius: 8,
            boxShadow: "0 10px 28px rgba(0,0,0,0.16)",
            outline: "none", resize: "none", overflow: "auto",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }} />,
        document.body,
      )}

      {tip.tooltip}
    </>
  );
}

/**
 * 文字のセル。1文字ごとに保存すると更新が飛びすぎるので、
 * Enter か欄から離れたときにだけ確定する（Esc で打ちかけを捨てる）。
 */
export function TextCell({ value, onCommit, disabled, placeholder, allowEmpty = true, style }: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** 空を許すか。タイトルは空にできないので、空のまま離れたら元に戻す */
  allowEmpty?: boolean;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  /** Esc で捨てた直後の確定を止める（打ちかけを保存してしまわないように） */
  const canceled = useRef(false);
  const readonlyTip = useCellTooltip(value, !!disabled);

  // 他の場所（かんばんの D&D など）で書き換わったら、打っていない間は追従する
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (canceled.current) { canceled.current = false; setDraft(value); return; }
    const v = draft.trim();
    if (!v && !allowEmpty) { setDraft(value); return; }
    if (v === value) return;
    onCommit(v);
  };

  if (disabled) {
    return (
      <>
        <span
          ref={el => { readonlyTip.ref.current = el; }}
          {...readonlyTip.hoverProps}
          style={{ ...style, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || "—"}
        </span>
        {readonlyTip.tooltip}
      </>
    );
  }

  return (
    <ExpandingInput
      className="task-cell"
      value={draft}
      placeholder={placeholder}
      style={{ ...style, cursor: "text" }}
      onChange={v => { setEditing(true); setDraft(v); }}
      onOpen={() => setEditing(true)}
      onClose={commit}
      onEscape={() => { canceled.current = true; setDraft(value); }} />
  );
}
