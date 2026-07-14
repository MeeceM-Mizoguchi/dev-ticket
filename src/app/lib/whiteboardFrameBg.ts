// フレーム書式（背景色・枠線）を「実 Excalidraw 要素(rectangle)」で描く（BRU5-063）。
//
// 旧方式(FrameDecorLayer)は背景/枠線を別canvas(z-index:-1 / 4)へ描いていた。DOM canvas は
// exportToBlob/Svg や標準の右クリック「PNGでコピー」に含まれないため、書き出すとフレームの
// 色枠・背景色が丸ごと消え、さらに画面背景を透明にしていたため背景も白にならなかった。
// これはテキストボックス背景で BRU5-062 が解決したのと同一の問題なので、同じ方式に統一する：
// フレームの直後（＝そのフレームの中身の背面）にロックした矩形を敷き、ネイティブに描く。
// これで画像出力にもフレーム装飾が正しく出て、viewBackgroundColor を白へ戻せる。
//
// 書式は従来どおり frame.customData.wbFrame に保持（書式パネルの入出力・後方互換）。
// 影矩形は customData.wbFrameBg=<frameId> でフレームへ片方向リンクし、onChange 毎に
// syncFrameDecorRects が「生成・幾何/色の追従・削除・重複の自己修復・z-order修復」を行う。
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

// sharp: 角あり(true・既定) / 角丸(false)。未設定(undefined)は既定の角ありとして扱う。
// border: 枠線あり(true)/なし(false)/未設定(undefined=既定グレー枠)。
export interface WbFrameFormat { bg?: string; border?: boolean; borderColor?: string; sharp?: boolean }

const isFrame = (e: any) => e?.type === "frame" || e?.type === "magicframe";
// フレーム装飾の影矩形か
export const isFrameDecorRect = (e: any) => e?.type === "rectangle" && typeof e?.customData?.wbFrameBg === "string";

// 標準フレーム枠線(outline)を消す代わりに敷く既定の枠色。書式未設定でもフレーム境界が見えるように。
export const DEFAULT_FRAME_BORDER = "#adb5bd";
const RADIUS_TYPE = 3; // Excalidraw ADAPTIVE_RADIUS（角丸）
const rand = () => Math.floor(Math.random() * 0x7fffffff);

// フレーム矩形を正規化（ドラッグ方向で width/height が負になり得る）。
function normRect(f: any): { x: number; y: number; width: number; height: number } {
  const x = Math.min(f.x, f.x + f.width);
  const y = Math.min(f.y, f.y + f.height);
  return { x, y, width: Math.abs(f.width), height: Math.abs(f.height) };
}

// フレーム要素から、対の影矩形が持つべき幾何・色・角丸を導出する。
// 枠線は標準outlineを消したため装飾側が唯一の境界表現。既定は「枠線あり」で、色未指定なら
// グレー枠（ネイティブ枠の代替）を出す。明示的に「なし(border===false)」の時だけ透明にする。
function targetProps(f: any) {
  const fmt: WbFrameFormat = f.customData?.wbFrame ?? {};
  const r = normRect(f);
  const strokeColor = fmt.border === false ? "transparent" : (fmt.borderColor || DEFAULT_FRAME_BORDER);
  return {
    x: r.x, y: r.y, width: r.width, height: r.height,
    backgroundColor: fmt.bg || "transparent",
    strokeColor,
    sharp: fmt.sharp !== false,   // 未設定は既定で角あり（ホワイトボード全体のsharp既定に合わせる）
  };
}
const roundnessFor = (sharp: boolean) => (sharp ? null : { type: RADIUS_TYPE });

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
function rectMatches(r: any, p: ReturnType<typeof targetProps>, wbParent: string | undefined): boolean {
  return near(r.x, p.x) && near(r.y, p.y) && near(r.width, p.width) && near(r.height, p.height)
    && r.backgroundColor === p.backgroundColor && r.strokeColor === p.strokeColor
    && (!!r.roundness) === (!p.sharp)   // 角丸/角ありの一致
    && (r.customData?.wbParent ?? undefined) === (wbParent ?? undefined);
}

// 新しい影矩形を1枚作る。フレームと同じ矩形・色で、フレームへ紐付ける。
function makeRect(f: any): any {
  const p = targetProps(f);
  const els = convertToExcalidrawElements([
    {
      type: "rectangle",
      id: `wb_frbg_${f.id}_${rand().toString(36)}`,
      x: p.x, y: p.y, width: p.width, height: p.height,
      backgroundColor: p.backgroundColor, fillStyle: "solid",
      strokeColor: p.strokeColor, strokeWidth: 2, roughness: 0,
    } as any,
  ], { regenerateIds: false }) as any[];
  const rect = els[0];
  rect.roundness = roundnessFor(p.sharp);
  rect.locked = true;                    // 単独選択/移動不可の“影”。ユーザーはフレームを操作する。
  rect.frameId = null;
  rect.customData = { ...(rect.customData ?? {}), wbFrameBg: f.id, wbParent: f.id };
  return rect;
}

/**
 * フレーム書式の背景/枠線を実 rectangle 要素で描くための同期。onChange から毎tick呼ぶ。
 *  - 生成: 書式(bg/border)ありでまだ影矩形が無いフレームの直後へ矩形を挿入（＝中身の背面z-order）
 *  - 追従: 位置/サイズ/色/所属(wbParent=frame)をフレームから同期
 *  - 削除: 書式が消えた/フレームが消えた影矩形を削除
 *  - 自己修復: 対象フレームが無い/書式が消えた/重複した影矩形は所有権(先勝ち)で削除
 *  - z-order修復: 影矩形が対フレームの直後に無ければ直後へ入れ直す（中身の背面へ）
 * remote反映中・新規描画中は何もしない（次tickで収束）。最新シーンを内部で取り直す。
 * @returns updateScene で反映したら true（onChangeの二重適用回避に使う）
 */
export function syncFrameDecorRects(api: any, appState: any, remote: boolean): boolean {
  if (remote || appState?.newElement) return false;
  const elements = api.getSceneElements() as any[];

  const frameById = new Map<string, any>();
  for (const e of elements) if (isFrame(e) && !e.isDeleted) frameById.set(e.id, e);

  // 標準フレーム枠線(outline)を消したため、装飾矩形は全フレームに1対1で常に敷く（境界の唯一の表現）。
  // 影矩形を「有効(=実在フレームに1対1)」と「孤児(=対フレーム消滅・重複)」に仕分け（先勝ち）。
  const validByFrame = new Map<string, string>(); // frameId -> rectId
  const orphan = new Set<string>();
  for (const e of elements) {
    if (!isFrameDecorRect(e) || e.isDeleted) continue;
    const forId = e.customData.wbFrameBg as string;
    const f = frameById.get(forId);
    if (f && !validByFrame.has(forId)) validByFrame.set(forId, e.id);
    else orphan.add(e.id);
  }

  // 影矩形がまだ無いフレーム → 生成対象（書式未設定でも既定グレー枠として敷く）
  const needCreate: any[] = [];
  for (const f of frameById.values()) {
    if (!validByFrame.has(f.id)) needCreate.push(f);
  }

  // 孤児削除・幾何/色/所属の追従を適用する（配列順は変えない）。
  let dirty = false;
  let next: any[] = elements.map((e: any) => {
    if (isFrameDecorRect(e) && !e.isDeleted && orphan.has(e.id)) {
      dirty = true;
      return { ...e, isDeleted: true, version: (e.version ?? 1) + 1, versionNonce: rand() };
    }
    if (isFrameDecorRect(e) && validByFrame.get(e.customData.wbFrameBg) === e.id) {
      const f = frameById.get(e.customData.wbFrameBg);
      const p = targetProps(f);
      if (!rectMatches(e, p, f.id)) {
        dirty = true;
        const { sharp, ...geom } = p;
        return {
          ...e, ...geom, locked: true, roundness: roundnessFor(sharp), frameId: null,
          customData: { ...e.customData, wbFrameBg: f.id, wbParent: f.id },
          version: (e.version ?? 1) + 1, versionNonce: rand(),
        };
      }
    }
    return e;
  });

  if (needCreate.length) {
    // 生成: 各フレームの直後へ影矩形を挿入（配列で後ろ＝index大＝前面だが、フレームの子は
    // さらに後ろに来るため、フレーム直後＝中身の背面になる）。
    const created = new Map<string, any>();
    for (const f of needCreate) created.set(f.id, makeRect(f));
    const rebuilt: any[] = [];
    for (const e of next) {
      rebuilt.push(e);
      const r = isFrame(e) && !e.isDeleted ? created.get(e.id) : undefined;
      if (r) rebuilt.push(r);
    }
    next = rebuilt;
    dirty = true;
  } else {
    // z-order自己修復: 影矩形が対フレームの「直後」に無ければ直後へ入れ直す（中身の背面へ戻す）。
    const rectFor = new Map<string, any>(); // frameId -> rect
    for (const e of next) {
      if (isFrameDecorRect(e) && !e.isDeleted && validByFrame.get(e.customData.wbFrameBg) === e.id) rectFor.set(e.customData.wbFrameBg, e);
    }
    const misplaced = next.some((e, i) =>
      isFrame(e) && !e.isDeleted && rectFor.has(e.id) && next[i + 1]?.id !== rectFor.get(e.id).id);
    if (misplaced) {
      const decorIds = new Set([...rectFor.values()].map((r) => r.id));
      const rebuilt: any[] = [];
      for (const e of next) {
        if (isFrameDecorRect(e) && decorIds.has(e.id)) continue; // 元位置から抜く
        rebuilt.push(e);
        if (isFrame(e) && !e.isDeleted && rectFor.has(e.id)) rebuilt.push(rectFor.get(e.id)); // 直後へ
      }
      next = rebuilt;
      dirty = true;
    }
  }

  if (!dirty) return false;
  api.updateScene({ elements: next });
  return true;
}
