// 札割りのデータ（src/lib/plan）のテストで使う保存先の部品
//
// - 普段のテストは、fake-indexeddb（src/test/setup.ts で有効）の上で本物の保存（openStorage）を使う。
//   同じテストファイルの中では DB の中身が残るため、テストごとに別の名前で開き、afterEach で cleanupTestStorages() を呼ぶ。
// - ブラウザ内の保存が使えない（IndexedDB を開けない）場面は、どの操作も失敗する偽物（failingStorage）か、
//   indexedDB.open を失敗させた本物の保存（openStorageWithoutIndexedDB）で作る。
// - 保存・読み込みが重なる場面（競合）は、本物の保存の saveAssignments・loadShips・saveImport を止めておける保存先
//   （holdableStorage）で作る。returnOrphanedAssignments は、本物の呼び出しが終わった後で（結果を返す前に）止められる。
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

/**
 * 古い形式（個体 ID がない短縮形式）で取り込んだ個体の一覧を作る。
 * 個体 ID は取り込みの並び順の連番（legacy-1 から）になるため、並びが変わると同じ個体 ID が別の艦を指す
 */
export function legacyShips(...bases: readonly OwnedShip[]): OwnedShip[] {
  return bases.map((base, index) => ({ ...base, uid: `legacy-${index + 1}` }));
}

/** 古い形式（個体 ID・ロックの情報がない）の取り込みの保存の入力 */
export function legacyImportInput(ships: readonly OwnedShip[], importedAt: string): SaveImportInput {
  return importInput(ships, { importedAt, hasUid: false, hasLockInfo: false });
}

/** 並び順に左右されないよう、個体 ID の順に並べる */
export function byUid(ships: readonly OwnedShip[]): OwnedShip[] {
  return [...ships].sort((a, b) => a.uid.localeCompare(b.uid));
}

/** holdableStorage で止めた保存先の操作（1 回分） */
export interface HeldOperation {
  /** 止めた操作が呼ばれたら（保存先に届いたら）解決する */
  readonly reached: Promise<void>;
  /** 止めていた操作を続ける（本物の保存先の操作を呼ぶ） */
  release(): void;
  /** 止めていた操作を、本物の保存先を呼ばずに失敗させる */
  fail(error?: unknown): void;
}

/** 操作を止めておける保存先（holdableStorage の戻り値） */
export interface HoldableStorage {
  /** 本物の保存先へ中継する保存先（ストアや resetPlanDataCache に渡す） */
  storage: FudawariStorage;
  /** 次に呼ばれる saveAssignments を 1 回だけ止める（続けて頼むと、その次の呼び出しも順に止める） */
  holdSaveAssignments(): HeldOperation;
  /** 次に呼ばれる loadShips を 1 回だけ止める（続けて頼むと、その次の呼び出しも順に止める） */
  holdLoadShips(): HeldOperation;
  /** 次に呼ばれる saveImport を 1 回だけ止める（本物の保存先を呼ぶ前に止める。続けて頼むと、その次の呼び出しも順に止める） */
  holdSaveImport(): HeldOperation;
  /**
   * 次に呼ばれる returnOrphanedAssignments を、本物の呼び出しが終わった後（保存先を読み書きし終えて、結果を返す前）で
   * 1 回だけ止める。reached は本物の呼び出しが終わったら解決する。release で結果を返し、fail で結果の代わりに失敗する。
   * 本物の呼び出しが失敗したときは止めない（失敗をそのまま返す）
   */
  holdAfterReturnOrphanedAssignments(): HeldOperation;
  /**
   * 本物の保存先の操作を呼んだ順の記録。呼んだときに操作名（例 "saveAssignments"）、
   * 終わったとき（成功・失敗とも）に「操作名:done」を足す。止めている間と、fail で失敗させた操作は記録しない
   */
  readonly calls: readonly string[];
}

/** 止める指定 1 回分 */
interface Hold {
  operation: HeldOperation;
  /** 止めた呼び出しが届いたことを知らせる */
  arrive(): void;
  /** release で解決し、fail で失敗する */
  gate: Promise<void>;
}

function createHold(): Hold {
  let arrive: () => void = () => {};
  const reached = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let open: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const gate = new Promise<void>((resolve, rejectGate) => {
    open = resolve;
    reject = rejectGate;
  });
  // 止めた呼び出しが届く前に fail しても、未処理の失敗として報告しない（届いた呼び出しには失敗が伝わる）
  gate.catch(() => {});
  return {
    arrive: () => arrive(),
    gate,
    operation: {
      reached,
      release: () => open(),
      fail: (error: unknown = new Error("保存先の操作を失敗させた（テスト）")) => reject(error),
    },
  };
}

/**
 * 本物の保存先へ中継し、saveAssignments・loadShips・saveImport を止めておける
 * （returnOrphanedAssignments は本物の呼び出しの後で止められる）保存先を返す
 * （保存の途中で読み込む・読み込みの途中で割り当てを変える・取り込みの途中で割り当てを変える、などの重なりを作るため）。
 * 中継は呼ぶたびに本物の保存先のメソッドを読むので、本物の保存先への vi.spyOn も効く
 */
export function holdableStorage(real: FudawariStorage): HoldableStorage {
  const calls: string[] = [];
  const holds: {
    saveAssignments: Hold[];
    loadShips: Hold[];
    saveImport: Hold[];
    afterReturnOrphanedAssignments: Hold[];
  } = { saveAssignments: [], loadShips: [], saveImport: [], afterReturnOrphanedAssignments: [] };

  /** 本物の保存先の操作を呼び、呼んだこと・終わったことを記録する */
  async function call<T>(name: string, run: () => Promise<T>): Promise<T> {
    calls.push(name);
    try {
      return await run();
    } finally {
      calls.push(`${name}:done`);
    }
  }

  /** 止める指定が残っていれば、release／fail まで待つ（fail なら失敗する） */
  async function waitIfHeld(queue: Hold[]): Promise<void> {
    const hold = queue.shift();
    if (hold === undefined) return;
    hold.arrive();
    await hold.gate;
  }

  /** 止める指定を 1 回分足す */
  function hold(queue: Hold[]): HeldOperation {
    const created = createHold();
    queue.push(created);
    return created.operation;
  }

  const storage: FudawariStorage = {
    saveImport(input) {
      // 止める指定がなければ、これまでどおりすぐに本物の保存先を呼ぶ
      if (holds.saveImport.length === 0) return call("saveImport", () => real.saveImport(input));
      return waitIfHeld(holds.saveImport).then(() => call("saveImport", () => real.saveImport(input)));
    },
    previewImport: (input) => call("previewImport", () => real.previewImport(input)),
    async loadShips() {
      await waitIfHeld(holds.loadShips);
      return call("loadShips", () => real.loadShips());
    },
    loadLastImport: () => call("loadLastImport", () => real.loadLastImport()),
    clearImportedShips: () => call("clearImportedShips", () => real.clearImportedShips()),
    loadAssignments: (eventId) => call("loadAssignments", () => real.loadAssignments(eventId)),
    async saveAssignments(eventId, assignments) {
      await waitIfHeld(holds.saveAssignments);
      return call("saveAssignments", () => real.saveAssignments(eventId, assignments));
    },
    returnOrphanedAssignments(eventId, fudaIds) {
      const after = holds.afterReturnOrphanedAssignments.shift();
      const run = call("returnOrphanedAssignments", () => real.returnOrphanedAssignments(eventId, fudaIds));
      // 止める指定がなければ、これまでどおり本物の保存先の結果をそのまま返す
      if (after === undefined) return run;
      return run.then(async (result) => {
        after.arrive();
        await after.gate;
        return result;
      });
    },
    loadSettings: () => call("loadSettings", () => real.loadSettings()),
    saveSettings: (patch) => call("saveSettings", () => real.saveSettings(patch)),
    close: () => real.close(),
  };

  return {
    storage,
    holdSaveAssignments: () => hold(holds.saveAssignments),
    holdLoadShips: () => hold(holds.loadShips),
    holdSaveImport: () => hold(holds.saveImport),
    holdAfterReturnOrphanedAssignments: () => hold(holds.afterReturnOrphanedAssignments),
    calls,
  };
}
