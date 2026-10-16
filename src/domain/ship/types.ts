// 艦の個体（取り込んだ艦 1 隻。要件 4.1）の型
// 同名艦は別の個体として扱い、個体 ID（uid）で区別する。それぞれ別の札に回せる。

/** 個体 ID。取り込みデータの api_id／id（個体 ID がない古い形式では取り込み時に作る） */
export type ShipUid = string;

/** 艦の個体 */
export interface OwnedShip {
  /** 個体 ID */
  uid: ShipUid;
  /** 艦 ID（艦船マスタの ID。api_ship_id／ship_id） */
  shipId: number;
  /** Lv */
  level: number;
  /** 運の表示値（マスタの運の初期値＋近代化改修の運） */
  luck: number;
  /** 実際に付いている札（取り込みデータの api_sally_area／area の値。0 は札なし） */
  sallyArea: number;
}
