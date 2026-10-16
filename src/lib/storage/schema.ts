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

/** 保存の形の版の一覧（古い順） */
export const STORAGE_SCHEMA_VERSIONS: readonly StorageSchemaVersion[] = [];

/** 今の保存の形の版（一覧の最後の版） */
export const STORAGE_SCHEMA_VERSION: number = 0;
