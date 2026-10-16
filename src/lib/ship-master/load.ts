// 艦船マスタの読み込み（roadmap T1-5・T2-1、U1、要件 5 章）
//
// - 一般の画面は、ビルド時に生成した静的ファイル（public/data/ship-master.json。generateShipMaster.ts の出力）だけを読む。
// - 取得した文字列の形（{ schemaVersion: 1, ships: ShipMasterEntry[] }）を確かめてから、createShipMaster（@/domain/master）で
//   艦 ID から引ける形にして返す。
// - 例外は投げず、結果（ShipMasterLoadResult）で返す。取得の失敗と形の誤りは kind で区別する（src/lib/definition/load.ts と同じ粒度）。
//
// 【未実装】TDD の Red の段階。型と空の入れ物だけを置いている（実装は実装担当が行う）。
import type { ShipMaster } from "@/domain/master";

/** 艦船マスタの置き場所（ファイルは public/data/ship-master.json。generateShipMaster.ts の SHIP_MASTER_OUTPUT_PATH と対応する） */
export const SHIP_MASTER_PATH = "/data/ship-master.json";

/**
 * 艦船マスタのファイルの形の誤りの種類
 * - "invalid_json"：JSON として読めない
 * - "unsupported_version"：形式の版（schemaVersion）が 1 でない（ない・数でないを含む）
 * - "invalid_shape"：形が違う（ルートがオブジェクトでない、ships が配列でない・空、項目が欠けた行・型の違う行がある）
 */
export type ShipMasterInvalidReason = "invalid_json" | "unsupported_version" | "invalid_shape";

/** 読み込みの失敗の理由 */
export type ShipMasterLoadError =
  /**
   * 取得の失敗。status は HTTP の状態コード（404 など）。
   * 通信そのものに失敗した（fetch が失敗した・本文を最後まで受け取れなかった）ときは null。
   * message は画面に出す理由の文（日本語。状態コードがあれば含める）
   */
  | { kind: "fetch"; status: number | null; message: string }
  /**
   * 形の誤り。reason は誤りの種類。
   * path は誤りの場所：ルートは ""、それ以外は "schemaVersion"、"ships"、"ships[1].name" の形（最初に見つけた 1 か所）。
   * message は画面に出す理由の文（日本語）
   */
  | { kind: "invalid"; reason: ShipMasterInvalidReason; path: string; message: string };

/** 読み込みの結果。成功なら艦 ID から引ける索引（createShipMaster の戻り値）を返す */
export type ShipMasterLoadResult =
  | { ok: true; master: ShipMaster }
  | { ok: false; error: ShipMasterLoadError };

/**
 * 艦船マスタを静的ファイル（SHIP_MASTER_PATH）から取得し、形を確かめて返す。
 * 呼ぶたびに取得する（取得を 1 回にまとめるのは useShipMaster の役目）。例外は投げない。
 */
export async function loadShipMaster(): Promise<ShipMasterLoadResult> {
  // 【未実装】取得も検証もしていない。テストが例外ではなく期待との違いで失敗するよう、仮の失敗を返す
  // （場所は、どのテストの期待とも一致しない仮の値にしてある）
  return {
    ok: false,
    error: { kind: "invalid", reason: "invalid_shape", path: "（未実装）", message: "" },
  };
}
