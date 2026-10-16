// 特効の計算結果の型（roadmap T1-3）
//
// - 特効は「段階のボスで効く艦名グループ × 倍率」だけを扱う（U11。艦種補正などは扱わない）。
// - 艦名は改装段階を問わず一致する。照合には艦船マスタの「改装段階を問わない艦名」（baseName）を使う。
// - 1 隻が同じ段階で複数のグループに当てはまるときは倍率を掛け合わせる（U12）。
// - 「効く」は倍率が 1 より大きいこと。

/** 1 つの段階での倍率 */
export interface StageBoost {
  /** 段階 ID */
  stageId: string;
  /** その段階での倍率（当てはまるグループの倍率の積） */
  multiplier: number;
}

/** 1 つの札についての特効（個体 × 札） */
export interface FudaBoost {
  /** 札 ID */
  fudaId: string;
  /**
   * スコア：その札を使う段階について Σ（倍率 − 1）× 100 × 重み（普通 1／重要 2／難所 3）。
   * 合計を整数に丸めた値（画面では「+81」）
   */
  score: number;
  /** その札で効く段階（倍率 > 1）と倍率。定義の海域の順、海域の中は段階の順 */
  stages: StageBoost[];
  /** その札で特効があるか（stages が 1 つ以上） */
  hasBoost: boolean;
  /** その札での最大倍率（一覧のバッジ「×1.24」）。特効がなければ 1 */
  maxMultiplier: number;
}

/** 個体ごとの特効のまとめ（割り振り画面の「この艦の特効（効く札の順）」） */
export interface ShipBoostSummary {
  /** 効く札。スコアの高い順（同点は定義の札の順） */
  effective: FudaBoost[];
  /** 効かない札の ID。定義の札の順（「特効なし：札A、札B」） */
  ineffectiveFudaIds: string[];
}
