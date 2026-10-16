// ブラウザ内の保存（roadmap T2-2、U9・U17・U21）のテスト
//
// - IndexedDB は fake-indexeddb（src/test/setup.ts で有効）。同じファイルの中では中身が残るため、
//   テストごとに別の DB 名を使い、終わったら閉じて消す。
// - 「再読み込み」は、DB を閉じてから同じ名前で開き直すことで表す。
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import type { ImportFilter } from "@/domain/import/types";
import { parsePlanFile, serializePlanFile } from "@/domain/plan/planFile";
import type { OwnedShip } from "@/domain/ship/types";
import { STORAGE_SCHEMA_VERSION, STORAGE_SCHEMA_VERSIONS, type StorageSchemaVersion } from "./schema";
import { openStorage } from "./storage";
import type { FudawariStorage, SaveImportInput } from "./types";

// ---- テストごとの DB の用意と後片付け ----

let dbSeq = 0;
const openedStorages: FudawariStorage[] = [];
const usedNames: string[] = [];

/** このテストだけで使う DB 名 */
function newDbName(): string {
  dbSeq += 1;
  const name = `fudawari-storage-test-${dbSeq}`;
  usedNames.push(name);
  return name;
}

/** 保存を開く（後片付けのために記録する） */
function open(name: string, versions?: readonly StorageSchemaVersion[]): FudawariStorage {
  const storage = openStorage(versions === undefined ? { name } : { name, versions });
  openedStorages.push(storage);
  return storage;
}

/** 閉じてから同じ名前で開き直す（再読み込みの代わり） */
function reopen(storage: FudawariStorage, name: string): FudawariStorage {
  storage.close();
  return open(name);
}

afterEach(async () => {
  for (const storage of openedStorages.splice(0)) {
    storage.close();
  }
  for (const name of usedNames.splice(0)) {
    await Dexie.delete(name);
  }
});

// ---- テスト用のデータ ----

const ALL: ImportFilter = { lockedOnly: false, minLevel: 1 };

function ship(uid: string, shipId: number, level: number, luck: number, sallyArea = 0): OwnedShip {
  return { uid, shipId, level, luck, sallyArea };
}

/** 1 回目の取り込み（個体 ID あり） */
const firstImport: SaveImportInput = {
  ships: [ship("101", 961, 175, 59), ship("102", 145, 98, 22, 3), ship("103", 656, 168, 72)],
  importedAt: "2026-10-15T20:40:00.000+09:00",
  filter: { lockedOnly: true, minLevel: 50 },
  hasUid: true,
};

/** 2 回目の取り込み（個体 ID あり。101 は Lv が上がった。103 はいなくなり、104 が増えた） */
const secondImport: SaveImportInput = {
  ships: [ship("101", 961, 176, 60), ship("102", 145, 99, 22), ship("104", 419, 131, 48)],
  importedAt: "2026-10-16T21:00:00.000+09:00",
  filter: ALL,
  hasUid: true,
};

/** 並び順に左右されないよう、個体 ID の順に並べる */
function byUid(ships: readonly OwnedShip[]): OwnedShip[] {
  return [...ships].sort((a, b) => a.uid.localeCompare(b.uid));
}

// ---- テスト ----

describe("ブラウザ内の保存：取り込んだ個体と取り込みの情報", () => {
  it("取り込む前は、個体は空で、最終取り込みは null", async () => {
    const storage = open(newDbName());

    expect(await storage.loadShips()).toEqual([]);
    expect(await storage.loadLastImport()).toBeNull();
  });

  it("取り込みを保存すると、再読み込みしても同じ個体と取り込みの情報（日時・条件・隻数）が読める", async () => {
    // 準備
    const name = newDbName();
    const storage = open(name);

    // 実行
    await storage.saveImport(firstImport);
    const reopened = reopen(storage, name);

    // 検証
    expect(byUid(await reopened.loadShips())).toEqual(byUid(firstImport.ships));
    expect(await reopened.loadLastImport()).toEqual({
      importedAt: "2026-10-15T20:40:00.000+09:00",
      filter: { lockedOnly: true, minLevel: 50 },
      shipCount: 3,
      hasUid: true,
    });
  });

  it("再取り込みすると、個体の一覧は置き換わり（前の取り込みにしかない個体は残らない）、最終取り込みは新しいほうになる", async () => {
    const storage = open(newDbName());

    await storage.saveImport(firstImport);
    await storage.saveImport(secondImport);

    expect(byUid(await storage.loadShips())).toEqual(byUid(secondImport.ships));
    expect(await storage.loadLastImport()).toMatchObject({
      importedAt: "2026-10-16T21:00:00.000+09:00",
      shipCount: 3,
    });
  });

  it("0 隻の取り込みも保存でき、最終取り込みの隻数は 0 になる", async () => {
    const storage = open(newDbName());
    await storage.saveImport(firstImport);

    await storage.saveImport({ ...secondImport, ships: [] });

    expect(await storage.loadShips()).toEqual([]);
    expect(await storage.loadLastImport()).toMatchObject({ shipCount: 0 });
  });

  it("「取り込んだ艦娘データを削除」で個体と取り込みの情報は消え、割り当て（札割り）は残る（再読み込み後も）", async () => {
    // 準備
    const name = newDbName();
    const storage = open(name);
    await storage.saveImport(firstImport);
    await storage.saveAssignments("summer2026", { "101": "rengo", "102": "s31" });

    // 実行
    await storage.clearImportedShips();
    const reopened = reopen(storage, name);

    // 検証
    expect(await reopened.loadShips()).toEqual([]);
    expect(await reopened.loadLastImport()).toBeNull();
    expect(await reopened.loadAssignments("summer2026")).toEqual({ "101": "rengo", "102": "s31" });
  });
});

describe("ブラウザ内の保存：割り当て（イベントごと。U17）", () => {
  it("割り当てを保存すると、再読み込みしても同じ割り当てが読める", async () => {
    const name = newDbName();
    const storage = open(name);

    await storage.saveAssignments("summer2026", { "101": "rengo", "102": "s31", "103": "rengo" });
    const reopened = reopen(storage, name);

    expect(await reopened.loadAssignments("summer2026")).toEqual({ "101": "rengo", "102": "s31", "103": "rengo" });
  });

  it("割り当てはイベントごとに分かれ、保存していない（新しい）イベントは空から始まる", async () => {
    const storage = open(newDbName());

    await storage.saveAssignments("summer2026", { "101": "rengo" });
    await storage.saveAssignments("autumn2026", { "102": "e1-fuda" });

    expect(await storage.loadAssignments("summer2026")).toEqual({ "101": "rengo" });
    expect(await storage.loadAssignments("autumn2026")).toEqual({ "102": "e1-fuda" });
    expect(await storage.loadAssignments("winter2027")).toEqual({});
  });

  it("保存は丸ごとの置き換え：前にあって今回ない個体は控えに戻る", async () => {
    const storage = open(newDbName());
    await storage.saveAssignments("summer2026", { "101": "rengo", "102": "s31" });

    await storage.saveAssignments("summer2026", { "101": "tago" });

    expect(await storage.loadAssignments("summer2026")).toEqual({ "101": "tago" });
  });

  it("再取り込み（個体 ID あり）しても、同じ個体 ID の割り当ては残る（U9）", async () => {
    // 準備：1 回目の取り込みのあとに割り当てる
    const name = newDbName();
    const storage = open(name);
    await storage.saveImport(firstImport);
    await storage.saveAssignments("summer2026", { "101": "rengo", "102": "s31" });

    // 実行：2 回目の取り込み（101・102 は同じ個体 ID のまま）
    await storage.saveImport(secondImport);
    const reopened = reopen(storage, name);

    // 検証
    const assignments = await reopened.loadAssignments("summer2026");
    expect(assignments["101"]).toBe("rengo");
    expect(assignments["102"]).toBe("s31");
  });

  it("個体 ID がない古い形式の取り込みでは、取り込んだ艦に前の割り当てを引き継がない（同じ値の個体 ID があっても）", async () => {
    // 準備：個体 ID "1"〜"3" に割り当てがある（ほかのイベントにも）
    const name = newDbName();
    const storage = open(name);
    await storage.saveImport({ ...firstImport, ships: [ship("1", 961, 175, 59), ship("2", 145, 98, 22), ship("3", 656, 168, 72)] });
    await storage.saveAssignments("summer2026", { "1": "rengo", "2": "s31", "3": "tago" });
    await storage.saveAssignments("spring2026", { "1": "e1-fuda" });

    // 実行：古い形式の取り込み（個体 ID は取り込み時に振った連番。前の個体 ID と同じ値になっていても別の艦かもしれない）
    const legacyShips = [ship("1", 419, 131, 48), ship("2", 543, 152, 31), ship("3", 145, 60, 15)];
    await storage.saveImport({ ships: legacyShips, importedAt: "2026-10-16T22:00:00.000+09:00", filter: ALL, hasUid: false });
    const reopened = reopen(storage, name);

    // 検証：取り込んだ艦はどのイベントでも控えから始まる
    for (const eventId of ["summer2026", "spring2026"]) {
      const assignments = await reopened.loadAssignments(eventId);
      for (const legacy of legacyShips) {
        expect(assignments[legacy.uid], `${eventId} の個体 ${legacy.uid}`).toBeUndefined();
      }
    }
    expect(await reopened.loadLastImport()).toMatchObject({ hasUid: false, shipCount: 3 });
  });

  it("古い形式で 2 回続けて取り込んでも、1 回目のあとに付けた割り当ては 2 回目の艦に引き継がない", async () => {
    const storage = open(newDbName());
    const legacy1 = [ship("1", 961, 175, 59), ship("2", 145, 98, 22)];
    await storage.saveImport({ ships: legacy1, importedAt: "2026-10-16T22:00:00.000+09:00", filter: ALL, hasUid: false });
    await storage.saveAssignments("summer2026", { "1": "rengo", "2": "s31" });

    const legacy2 = [ship("1", 145, 98, 22), ship("2", 961, 175, 59)];
    await storage.saveImport({ ships: legacy2, importedAt: "2026-10-16T23:00:00.000+09:00", filter: ALL, hasUid: false });

    const assignments = await storage.loadAssignments("summer2026");
    expect(assignments["1"]).toBeUndefined();
    expect(assignments["2"]).toBeUndefined();
  });

  it("定義から消えた札の割り当てを控えに戻して保存し、戻した件数を返す。ほかのイベントには触らない（U17）", async () => {
    // 準備
    const name = newDbName();
    const storage = open(name);
    await storage.saveAssignments("summer2026", { "101": "rengo", "102": "ulithi", "103": "ulithi" });
    await storage.saveAssignments("spring2026", { "101": "ulithi" });

    // 実行：今の定義に札 ulithi がない
    const result = await storage.returnOrphanedAssignments("summer2026", ["s31", "tago", "rengo"]);
    const reopened = reopen(storage, name);

    // 検証
    expect(result).toEqual({ assignments: { "101": "rengo" }, returnedCount: 2 });
    expect(await reopened.loadAssignments("summer2026")).toEqual({ "101": "rengo" });
    expect(await reopened.loadAssignments("spring2026")).toEqual({ "101": "ulithi" });
  });

  it("消えた札がなければ、0 件を返し、割り当ては変わらない", async () => {
    const storage = open(newDbName());
    await storage.saveAssignments("summer2026", { "101": "rengo" });

    const result = await storage.returnOrphanedAssignments("summer2026", ["rengo"]);

    expect(result).toEqual({ assignments: { "101": "rengo" }, returnedCount: 0 });
    expect(await storage.loadAssignments("summer2026")).toEqual({ "101": "rengo" });
  });
});

describe("ブラウザ内の保存：札割りの書き出し・読み込み（U21）", () => {
  it("書き出したファイルを別のブラウザで読み込んで保存すると、同じ割り当てになる（前にあった割り当ては置き換わる）", async () => {
    // 準備：書き出す側
    const source = open(newDbName());
    await source.saveAssignments("summer2026", { "101": "rengo", "102": "s31", "105": "tago" });
    const text = serializePlanFile("summer2026", await source.loadAssignments("summer2026"));

    // 準備：読み込む側（別の割り当てがすでにある）
    const target = open(newDbName());
    await target.saveAssignments("summer2026", { "101": "tago", "999": "rengo" });

    // 実行
    const parsed = parsePlanFile(text);
    if (!parsed.ok) {
      throw new Error(`読み込みに失敗した（理由：${parsed.reason}）`);
    }
    await target.saveAssignments(parsed.eventId, parsed.assignments);

    // 検証
    expect(await target.loadAssignments("summer2026")).toEqual({ "101": "rengo", "102": "s31", "105": "tago" });
  });
});

describe("ブラウザ内の保存：設定", () => {
  it("保存していないときは初期値（モックどおり：ダーク・標準・一行・艦型）", async () => {
    const storage = open(newDbName());

    expect(await storage.loadSettings()).toEqual({
      themeMode: "dark",
      fontSize: "mid",
      trayView: "dense",
      traySort: "class",
    });
  });

  it("一部の項目を保存すると、ほかの項目は初期値のまま、保存後の設定全体を返す", async () => {
    const storage = open(newDbName());

    const saved = await storage.saveSettings({ fontSize: "large" });

    expect(saved).toEqual({ themeMode: "dark", fontSize: "large", trayView: "dense", traySort: "class" });
  });

  it("保存した設定は、再読み込みしても元に戻る（続けて保存した項目も合わせて残る）", async () => {
    const name = newDbName();
    const storage = open(name);

    await storage.saveSettings({ themeMode: "light", trayView: "card" });
    await storage.saveSettings({ traySort: "lv" });
    const reopened = reopen(storage, name);

    expect(await reopened.loadSettings()).toEqual({
      themeMode: "light",
      fontSize: "mid",
      trayView: "card",
      traySort: "lv",
    });
  });
});

describe("ブラウザ内の保存：保存の形の版と移行", () => {
  it("版の一覧は 1 から始まって増えていき、最後の版が今の版", () => {
    const versions = STORAGE_SCHEMA_VERSIONS.map((v) => v.version);

    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0]).toBe(1);
    for (let i = 1; i < versions.length; i += 1) {
      expect(versions[i]).toBeGreaterThan(versions[i - 1]);
    }
    expect(versions[versions.length - 1]).toBe(STORAGE_SCHEMA_VERSION);
  });

  it("古い版で保存したデータは、新しい版を足した DB で開いても読める（新しい版の移行の処理は 1 回だけ動く）", async () => {
    // 準備：今の版でデータを保存して閉じる（＝古い版のデータ）
    const name = newDbName();
    const oldStorage = open(name);
    await oldStorage.saveImport(firstImport);
    await oldStorage.saveAssignments("summer2026", { "101": "rengo" });
    await oldStorage.saveSettings({ fontSize: "small" });
    oldStorage.close();

    // 実行：新しい版（テーブルを 1 つ足し、移行の処理を持つ）を足した一覧で開き直す
    let upgradeCount = 0;
    const nextVersion: StorageSchemaVersion = {
      version: STORAGE_SCHEMA_VERSION + 1,
      stores: { migrationProbe: "id" },
      upgrade: () => {
        upgradeCount += 1;
      },
    };
    const newStorage = open(name, [...STORAGE_SCHEMA_VERSIONS, nextVersion]);

    // 検証：古い版のデータがそのまま読める
    expect(byUid(await newStorage.loadShips())).toEqual(byUid(firstImport.ships));
    expect(await newStorage.loadLastImport()).toMatchObject({ shipCount: 3 });
    expect(await newStorage.loadAssignments("summer2026")).toEqual({ "101": "rengo" });
    expect(await newStorage.loadSettings()).toMatchObject({ fontSize: "small" });
    expect(upgradeCount).toBe(1);
  });
});
