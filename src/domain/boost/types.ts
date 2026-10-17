// 特効の計算結果の型（roadmap T1-3）
//
// - 特効は「段階のボスで効く艦名・国籍のグループ × 倍率」だけを扱う（U11。国籍は v1.1。艦種補正などは扱わない）。
// - 艦名は改装段階を問わず一致する。照合には艦船マスタの「改装段階を問わない艦名」（baseName）を使う。
// - 国籍は艦船マスタの国籍（nationality）で照合する。国籍が "unknown" の艦は国籍の条件には当てはまらない。
//   艦名と国籍は別々に照合する（艦名が「usa」の艦が、国籍 アメリカ のグループに当てはまることはない）。
// - 1 つのグループは、艦名と国籍の両方に当てはまっても倍率を 1 回だけ掛ける。
// - 1 隻が同じ段階で複数のグループに当てはまるときは倍率を掛け合わせる（U12）。
// - 「効く」は倍率が 1 より大きいこと。
import type { Nationality } from "@/domain/nationality";

/**
 * 特効の照合の対象（改装段階を問わない艦名と国籍）。
 * 艦船マスタの行（ShipMasterEntry）をそのまま渡せる形。個体からは boostTargetOf（@/domain/master）で引く
 */
export interface BoostTarget {
  /** 改装段階を問わない艦名（例「時雨」） */
  readonly baseName: string;
  /** 国籍 */
  readonly nationality: Nationality;
}

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
