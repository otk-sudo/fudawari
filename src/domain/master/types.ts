// 艦船マスタの型（roadmap T1-5。入手元は U1：Tibowl/api_start2 の start2.json）
//
// - ビルド時（PR-04）に start2.json の api_mst_ship から必要な項目だけを抜き出し、
//   ShipMasterEntry の配列（自前の形式の最小マスタ）を作って静的ファイルとして配る。
// - 画面側は createShipMaster（master.ts）で索引を作り、lookupShip・baseNameOf・boostTargetOf で艦 ID から引く。
// - 国籍（v1.1）は api_start2 にないため、艦型の番号から自前の対応表（SHIP_CLASS_NATIONALITIES）で入れる。
// - ゲームの画像は含めない。
import type { Nationality } from "@/domain/nationality";

/** 改造状態。未改造／中間改造／最終改造 */
export type RemodelStage = "unremodeled" | "intermediate" | "final";

/** 艦船マスタの 1 行（艦 1 種類） */
export interface ShipMasterEntry {
  /** 艦 ID（api_id。取り込みデータの api_ship_id／ship_id） */
  id: number;
  /** 艦名（api_name。例「時雨改二」） */
  name: string;
  /** 読み（api_yomi。例「しぐれ」。名前順の並べ替えに使う） */
  yomi: string;
  /** 改装段階を問わない艦名（改造の連鎖の起点の艦名。例「時雨」）。特効の照合に使う */
  baseName: string;
  /** 艦種の番号（api_stype。例 2＝駆逐艦） */
  shipTypeId: number;
  /** 艦型の番号（api_ctype） */
  shipClassId: number;
  /** 艦型の名前（例「白露型」。api_start2 にないため自前の対応表から入れる） */
  shipClassName: string;
  /** 国籍（艦型の番号から自前の対応表で入れる。対応表にない艦型は "unknown"。特効の国籍の条件の照合に使う。v1.1） */
  nationality: Nationality;
  /** 改造状態 */
  remodelStage: RemodelStage;
  /** 図鑑番号（api_sortno） */
  sortNo: number;
  /** 運の初期値（api_luck[0]）。運の表示値＝これ＋近代化改修の運 */
  luckBase: number;
}

/** 艦 ID から引くための索引。createShipMaster で作る */
export interface ShipMaster {
  readonly byId: ReadonlyMap<number, ShipMasterEntry>;
}

/**
 * 艦 ID で引いた結果
 * - マスタにある艦：known が true で、マスタの行の項目をすべて持つ
 * - マスタにない艦（新しく実装された艦など）：known が false、name は「名前が分からない艦」
 */
export type ShipLookup =
  | ({ known: true } & ShipMasterEntry)
  | { known: false; id: number; name: string };

/**
 * api_start2 の api_mst_ship に近い最小の形（ビルド時の生成と、改造の連鎖の計算の入力）
 * 深海棲艦などの行には api_aftershipid がないことがある
 */
export interface ApiMstShipLike {
  api_id: number;
  api_name: string;
  api_yomi?: string;
  api_stype?: number;
  api_ctype?: number;
  api_sortno?: number;
  /** [初期値, 最大値] */
  api_luck?: number[];
  /** 改造先の艦 ID（文字列）。"0" は改造先なし */
  api_aftershipid?: string;
}

/** 改造の連鎖から求めた値 */
export interface RemodelInfo {
  /** 改装段階を問わない艦名（連鎖の起点の艦名） */
  baseName: string;
  /** 改造状態 */
  remodelStage: RemodelStage;
}
