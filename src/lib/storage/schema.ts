// 保存の形の版（Dexie のバージョン）と移行の一覧
//
// - 保存の形を変えるときは、この一覧の末尾に新しい版を足す（前の版は消さない・書き換えない）。
//   DB を壊す変更は「足す → 切り替え → 消す」に分ける（CLAUDE.md）。
// - openStorage（storage.ts）は、この一覧の版を順に Dexie の version(n).stores(...).upgrade(...) に渡して DB を開く。
//   古い版のまま保存されたデータは、開いたときに Dexie が upgrade を順に実行して新しい版にする。
import type { Transaction } from "dexie";

/** 保存の形の 1 つの版 */
export interface StorageSchemaVersion {
  /** 版の番号（1 から。一覧の中で増えていく） */
  version: number;
  /** Dexie の stores に渡すテーブルの定義（この版で足す・変えるテーブル。null はテーブルを消す） */
  stores: Record<string, string | null>;
  /** 前の版のデータをこの版の形に直す処理（必要な版だけ） */
  upgrade?: (tx: Transaction) => PromiseLike<unknown> | void;
}

/**
 * テーブルの名前
 * - ships：取り込んだ艦の個体（主キーは個体 ID の uid）
 * - importRecords：最終取り込みの情報（主キー id。行は 1 つだけ）
 * - assignments：イベントごとの割り当て（主キーはイベント ID の eventId。値は個体 ID → 札 ID）
 * - settings：設定（主キー id。行は 1 つだけ。保存した項目だけを持ち、ない項目は読むときに初期値で補う）
 */
export const STORAGE_TABLES = {
  ships: "ships",
  importRecords: "importRecords",
  assignments: "assignments",
  settings: "settings",
} as const;

/** 保存の形の版の一覧（古い順） */
export const STORAGE_SCHEMA_VERSIONS: readonly StorageSchemaVersion[] = [
  {
    // 版 1（PR-04a）：個体・最終取り込み・割り当て・設定
    version: 1,
    stores: {
      [STORAGE_TABLES.ships]: "uid",
      [STORAGE_TABLES.importRecords]: "id",
      [STORAGE_TABLES.assignments]: "eventId",
      [STORAGE_TABLES.settings]: "id",
    },
  },
];

/** 今の保存の形の版（一覧の最後の版） */
export const STORAGE_SCHEMA_VERSION: number = STORAGE_SCHEMA_VERSIONS[STORAGE_SCHEMA_VERSIONS.length - 1].version;
