// ブラウザ内の保存（IndexedDB。Dexie）
import type { StorageSchemaVersion } from "./schema";
import type { FudawariStorage } from "./types";

/** 既定の DB 名 */
export const DEFAULT_STORAGE_NAME = "fudawari";

/** openStorage の引数 */
export interface OpenStorageOptions {
  /** DB 名（省略すると DEFAULT_STORAGE_NAME。テストではテストごとに別の名前を使う） */
  name?: string;
  /** 保存の形の版の一覧（省略すると STORAGE_SCHEMA_VERSIONS。移行のテストで、新しい版を足した一覧を渡す） */
  versions?: readonly StorageSchemaVersion[];
}

/** ブラウザ内の保存を開く（DB への接続は最初の読み書きのときに行う） */
export function openStorage(options: OpenStorageOptions = {}): FudawariStorage {
  void options;
  throw new Error("未実装");
}
