// 画像で保存で出力する画像（1600×900）の寸法と、札の列に載せられる艦の数（要件 3.9、U15）。画面に依存しない純粋な関数
//
// 列に入る艦の数は、ブラウザに測らせずに寸法から計算する（画像の DOM を描く前に決められ、どの環境でも同じ結果になる）。
// そのため、ここの高さは ExportImage.module.css の同じ名前の箇所と同じ値にする（変えるときは両方そろえる）。

/** 画像の幅（px） */
export const IMAGE_WIDTH = 1600;
/** 画像の高さ（px） */
export const IMAGE_HEIGHT = 900;

/** 上部（イベント名）の高さ（下の線を含む。.header） */
const HEADER_HEIGHT = 96;
/** 下部（ロゴ・ツール名・凡例）の高さ（.footer） */
const FOOTER_HEIGHT = 48;
/** 攻略の流れの上の余白（.timeline の padding-top） */
const TIMELINE_PADDING_TOP = 18;
/** 攻略の流れの海域の行どうしの間（.timeline の gap） */
const AREA_ROW_GAP = 6;
/** 海域の行の高さの上限（海域が 5 つまでならこの高さ） */
const AREA_ROW_MAX_HEIGHT = 44;
/** 海域の行の高さの下限 */
const AREA_ROW_MIN_HEIGHT = 26;
/** 攻略の流れの行の部分の高さの上限（海域 5 つ分。多いときは行を低くして収める） */
const AREA_ROWS_MAX_TOTAL = AREA_ROW_MAX_HEIGHT * 5 + AREA_ROW_GAP * 4;
/** 札の列の並びの上の余白（.columns の padding-top） */
const COLUMNS_PADDING_TOP = 18;
/** 札の列の上端の札の色の帯（.column の border-top） */
const COLUMN_TOP_BORDER = 8;
/** 札の列の見出し（札名・隻数）の高さ（.columnHead） */
const COLUMN_HEAD_HEIGHT = 54;
/** 艦 1 隻の行の高さ（.ship・.more） */
export const SHIP_ROW_HEIGHT = 42;

/** 海域の行の高さ（海域が多いときは低くして、札の列の高さを残す） */
export function areaRowHeight(areaCount: number): number {
  if (areaCount <= 0) return AREA_ROW_MAX_HEIGHT;
  const fitted = Math.floor((AREA_ROWS_MAX_TOTAL - AREA_ROW_GAP * (areaCount - 1)) / areaCount);
  return Math.max(AREA_ROW_MIN_HEIGHT, Math.min(AREA_ROW_MAX_HEIGHT, fitted));
}

/** 攻略の流れ全体の高さ（上の余白を含む。海域がなければ 0） */
function timelineHeight(areaCount: number): number {
  if (areaCount <= 0) return 0;
  return TIMELINE_PADDING_TOP + areaRowHeight(areaCount) * areaCount + AREA_ROW_GAP * (areaCount - 1);
}

/** 札の列に、艦の行（「ほか n 隻」の行を含む）がいくつ入るか（1 以上） */
export function shipRowCapacity(areaCount: number): number {
  const columnsHeight = IMAGE_HEIGHT - HEADER_HEIGHT - timelineHeight(areaCount) - FOOTER_HEIGHT;
  const bodyHeight = columnsHeight - COLUMNS_PADDING_TOP - COLUMN_TOP_BORDER - COLUMN_HEAD_HEIGHT;
  return Math.max(1, Math.floor(bodyHeight / SHIP_ROW_HEIGHT));
}

/** 列に載せる艦の数と、載せきれずに「ほか n 隻」と書く数 */
export interface ColumnFit {
  /** 載せる艦の数（Lv の高い艦から） */
  shown: number;
  /** 載せきれない艦の数（0 なら「ほか n 隻」を書かない） */
  rest: number;
}

/**
 * 列に載せる艦の数を決める（U15）。全員が入ればすべて載せる。
 * 入らなければ、最後の 1 行を「ほか n 隻」にして、その上に入るだけ載せる
 */
export function fitShipsInColumn(shipCount: number, capacity: number): ColumnFit {
  if (shipCount <= capacity) return { shown: shipCount, rest: 0 };
  const shown = Math.max(0, capacity - 1);
  return { shown, rest: shipCount - shown };
}
