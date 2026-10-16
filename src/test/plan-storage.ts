// 札割りのデータ（src/lib/plan）のテストで使う保存先の部品
//
// - 普段のテストは、fake-indexeddb（src/test/setup.ts で有効）の上で本物の保存（openStorage）を使う。
//   同じテストファイルの中では DB の中身が残るため、テストごとに別の名前で開き、afterEach で cleanupTestStorages() を呼ぶ。
// - ブラウザ内の保存が使えない（IndexedDB を開けない）場面は、どの操作も失敗する偽物（failingStorage）か、
//   indexedDB.open を失敗させた本物の保存（openStorageWithoutIndexedDB）で作る。
import Dexie from "dexie";
import { vi } from "vitest";
import type { ImportFilter } from "@/domain/import/types";
import type { OwnedShip } from "@/domain/ship/types";
import {
  type FudawariStorage,
  openStorage,
  type SaveImportInput,
} from "@/lib/storage";

let dbSeq = 0;
const openedStorages: FudawariStorage[] = [];
const usedNames: string[] = [];

/** テスト用の保存先（DB 名つき） */
export interface TestStorage {
  storage: FudawariStorage;
  name: string;
}

/** このテストだけで使う DB 名 */
function newDbName(prefix: string): string {
  dbSeq += 1;
  const name = `${prefix}-${dbSeq}`;
  usedNames.push(name);
  return name;
}

/** このテストだけで使う保存先を開く（後片付けは cleanupTestStorages） */
export function openTestStorage(prefix = "fudawari-plan-test"): TestStorage {
  const name = newDbName(prefix);
  const storage = openStorage({ name });
  openedStorages.push(storage);
  return { storage, name };
}

/** openTestStorage で開いた保存先を閉じ、DB を消す（afterEach で呼ぶ） */
export async function cleanupTestStorages(): Promise<void> {
  for (const storage of openedStorages.splice(0)) {
    storage.close();
  }
  for (const name of usedNames.splice(0)) {
    await Dexie.delete(name);
  }
}

/** どの操作も失敗する保存先（ブラウザが IndexedDB を使えないときの代わり）。close だけは何もしない */
export function failingStorage(
  error: unknown = new Dexie.MissingAPIError("IndexedDB API missing"),
): FudawariStorage {
  const fail = async (): Promise<never> => {
    throw error;
  };
  return {
    saveImport: fail,
    previewImport: fail,
    loadShips: fail,
    loadLastImport: fail,
    clearImportedShips: fail,
    loadAssignments: fail,
    saveAssignments: fail,
    returnOrphanedAssignments: fail,
    loadSettings: fail,
    saveSettings: fail,
    close: () => {},
  };
}

/**
 * IndexedDB を開けない（indexedDB.open が失敗する）ブラウザでの、本物の保存先を返す。
 * プライベートモードなどで IndexedDB が使えない場面の代わり。この保存先の読み書きはすべて失敗する。
 * indexedDB.open の差し替えは vi.spyOn なので、テストの afterEach で vi.restoreAllMocks() を呼んで元に戻す
 */
export function openStorageWithoutIndexedDB(): TestStorage {
  vi.spyOn(indexedDB, "open").mockImplementation(() => {
    throw new DOMException("IndexedDB を使えません", "InvalidStateError");
  });
  const name = newDbName("fudawari-plan-test-unavailable");
  const storage = openStorage({ name });
  openedStorages.push(storage);
  return { storage, name };
}

/** すべての艦娘を取り込む条件 */
export const IMPORT_ALL: ImportFilter = { lockedOnly: false, minLevel: 1 };

/** 取り込みの保存の入力（個体 ID あり。日時は固定の値） */
export function importInput(
  ships: readonly OwnedShip[],
  overrides: Partial<SaveImportInput> = {},
): SaveImportInput {
  return {
    ships,
    importedAt: "2026-10-16T21:00:00.000+09:00",
    filter: IMPORT_ALL,
    hasUid: true,
    hasLockInfo: true,
    ...overrides,
  };
}

/** 並び順に左右されないよう、個体 ID の順に並べる */
export function byUid(ships: readonly OwnedShip[]): OwnedShip[] {
  return [...ships].sort((a, b) => a.uid.localeCompare(b.uid));
}
