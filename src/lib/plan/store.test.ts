// 札割りのデータのストア（createPlanDataStore）のテスト
//
// - 保存先は fake-indexeddb（src/test/setup.ts で有効）の上の本物の保存（openStorage）。テストごとに別の DB 名を使う。
// - 保存の失敗は vi.spyOn で 1 回だけ失敗させる。ブラウザ内の保存が使えない場面は、どの操作も失敗する偽物と、
//   indexedDB.open を失敗させた本物の保存で作る。
// - 時刻・乱数には頼らない（取り込みの日時は固定の値）。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssignmentMap } from "@/domain/plan/types";
import { createPlanDataStore, type PlanDataStore, type PlanDataStoreState } from "@/lib/plan";
import type { FudawariStorage } from "@/lib/storage";
import { summer2026Assignments, summer2026Definition, summer2026Ships, shipByUid } from "@/test/fixtures";
import {
  byUid,
  cleanupTestStorages,
  failingStorage,
  importInput,
  openStorageWithoutIndexedDB,
  openTestStorage,
} from "@/test/plan-storage";

// ---- テスト用のデータ ----

/** 最新イベントの ID（"2026-summer"） */
const EVENT_ID = summer2026Definition.event.id;
/** 次のイベントの ID（割り当ての切り替えのテスト用） */
const NEXT_EVENT_ID = "2027-winter";
/** 今の定義の札 ID の一覧（s31・tago・rengo・ulithi・sixth） */
const FUDA_IDS = summer2026Definition.fudas.map((fuda) => fuda.id);

/** 割り当てを 1 隻だけ変えた例：初霜改二を第三十一戦隊から連合艦隊へ */
const MOVED: AssignmentMap = { ...summer2026Assignments, hatsushimo: "rengo" };

// ---- 補助 ----

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupTestStorages();
});

/** 準備完了の状態を取り出す（準備完了でなければ、その時点でテストを失敗させる） */
function expectReady(store: PlanDataStore): Extract<PlanDataStoreState, { status: "ready" }> {
  const state = store.getState();
  expect(state.status).toBe("ready");
  if (state.status !== "ready") {
    throw new Error(`準備完了になっていない（status: ${state.status}）`);
  }
  return state;
}

/** 保存先の読み取りの操作を見張る */
function spyOnReads(storage: FudawariStorage) {
  return {
    loadShips: vi.spyOn(storage, "loadShips"),
    loadLastImport: vi.spyOn(storage, "loadLastImport"),
    loadAssignments: vi.spyOn(storage, "loadAssignments"),
    returnOrphanedAssignments: vi.spyOn(storage, "returnOrphanedAssignments"),
  };
}

/** 見張った読み取りの操作が呼ばれた回数の合計 */
function readCount(spies: ReturnType<typeof spyOnReads>): number {
  return Object.values(spies).reduce((sum, spy) => sum + spy.mock.calls.length, 0);
}

/** 取り込み（31 隻）と最新イベントの割り当てを保存しておく */
async function seedSummer2026(storage: FudawariStorage): Promise<void> {
  await storage.saveImport(importInput(summer2026Ships));
  await storage.saveAssignments(EVENT_ID, summer2026Assignments);
}

/**
 * 指定したイベントの割り当ての読み取りだけを、release を呼ぶまで待たせる保存先
 * （前のイベントの読み込みが、後のイベントの読み込みより遅れて終わる場面を作るため）
 */
function holdAssignmentsOf(storage: FudawariStorage, heldEventId: string) {
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const held: FudawariStorage = {
    ...storage,
    async loadAssignments(eventId) {
      if (eventId === heldEventId) await gate;
      return storage.loadAssignments(eventId);
    },
    async returnOrphanedAssignments(eventId, fudaIds) {
      if (eventId === heldEventId) await gate;
      return storage.returnOrphanedAssignments(eventId, fudaIds);
    },
  };
  return { storage: held, release: () => open() };
}

// ---- テスト ----

describe("札割りのデータのストア（createPlanDataStore）", () => {
  describe("読み込み", () => {
    it("作った直後は待機中（idle）で、保存先をまだ読まない", () => {
      // 準備
      const { storage } = openTestStorage();
      const spies = spyOnReads(storage);

      // 実行
      const store = createPlanDataStore(storage);

      // 検証
      expect(store.getState().status).toBe("idle");
      expect(readCount(spies)).toBe(0);
    });

    it("イベント ID が null（定義の読み込み中・失敗）なら、読まずに待機中（idle）のまま", async () => {
      // 準備
      const { storage } = openTestStorage();
      const spies = spyOnReads(storage);
      const store = createPlanDataStore(storage);

      // 実行
      await store.getState().load(null, FUDA_IDS);

      // 検証
      expect(store.getState().status).toBe("idle");
      expect(readCount(spies)).toBe(0);
    });

    it("load を呼ぶとすぐに読み込み中になり、読み終えると準備完了（艦・最終取り込み・割り当て）になる", async () => {
      // 準備
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      const store = createPlanDataStore(storage);

      // 実行
      const loading = store.getState().load(EVENT_ID, FUDA_IDS);

      // 検証：保存先を読み終える前は読み込み中
      expect(store.getState().status).toBe("loading");

      // 実行：読み終えるのを待つ
      await loading;

      // 検証：準備完了
      const ready = expectReady(store);
      expect(ready.eventId).toBe(EVENT_ID);
      expect(byUid(ready.ships)).toEqual(byUid(summer2026Ships));
      expect(ready.lastImport).toEqual({
        importedAt: "2026-10-16T21:00:00.000+09:00",
        filter: { lockedOnly: false, minLevel: 1 },
        shipCount: summer2026Ships.length,
        hasUid: true,
      });
      expect(ready.assignments).toEqual(summer2026Assignments);
      expect(ready.returnedCount).toBe(0);
      expect(ready.saveError).toBeNull();
    });

    it("取り込んでいなければ、艦は空・最終取り込みは null・割り当ては空で準備完了になる", async () => {
      // 準備
      const { storage } = openTestStorage();
      const store = createPlanDataStore(storage);

      // 実行
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 検証
      const ready = expectReady(store);
      expect(ready.ships).toEqual([]);
      expect(ready.lastImport).toBeNull();
      expect(ready.assignments).toEqual({});
      expect(ready.returnedCount).toBe(0);
    });

    it("今の定義の札 ID にない札の割り当ては控えに戻し、戻した件数を状態に持つ（U17）", async () => {
      // 準備：2 隻を、定義から消えた札（removed-fuda）に置いておく
      const { storage } = openTestStorage();
      await storage.saveImport(importInput(summer2026Ships));
      await storage.saveAssignments(EVENT_ID, {
        ...summer2026Assignments,
        tone: "removed-fuda",
        hyuga: "removed-fuda",
      });
      const store = createPlanDataStore(storage);

      // 実行
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 検証：2 隻は控え（キーがない）に戻り、ほかの割り当てはそのまま
      const ready = expectReady(store);
      expect(ready.assignments).toEqual(summer2026Assignments);
      expect(ready.assignments.tone).toBeUndefined();
      expect(ready.returnedCount).toBe(2);
    });

    it("控えに戻した割り当ては保存先にも残る（次に読み込んでも戻した件数は 0）", async () => {
      // 準備
      const { storage } = openTestStorage();
      await storage.saveImport(importInput(summer2026Ships));
      await storage.saveAssignments(EVENT_ID, { ...summer2026Assignments, tone: "removed-fuda" });
      const first = createPlanDataStore(storage);
      await first.getState().load(EVENT_ID, FUDA_IDS);

      // 実行：別のストアで読み込み直す（画面を開き直す場面）
      const second = createPlanDataStore(storage);
      await second.getState().load(EVENT_ID, FUDA_IDS);

      // 検証
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(summer2026Assignments);
      expect(expectReady(second).returnedCount).toBe(0);
    });
  });

  describe("割り当ての変更と保存", () => {
    it("割り当てを変えると、保存を待たずに状態が変わる", async () => {
      // 準備
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 実行：保存の完了を待たずに状態を見る
      const saving = store.getState().setAssignments(MOVED);

      // 検証
      expect(expectReady(store).assignments).toEqual(MOVED);
      await saving;
    });

    it("変えた割り当ては、読み込んだイベントの割り当てとして保存される", async () => {
      // 準備
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 実行
      await store.getState().setAssignments(MOVED);

      // 検証
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(MOVED);
      expect(expectReady(store).saveError).toBeNull();
    });

    it("保存に失敗しても例外にならず、状態は変えたまま、saveError に理由（operation: save）が入る", async () => {
      // 準備
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      vi.spyOn(storage, "saveAssignments").mockRejectedValueOnce(new Error("QuotaExceededError"));
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 実行
      const saving = store.getState().setAssignments(MOVED);

      // 検証：例外にならない
      await expect(saving).resolves.toBeUndefined();
      const ready = expectReady(store);
      expect(ready.assignments).toEqual(MOVED);
      expect(ready.saveError).toEqual({ operation: "save", message: expect.any(String) });
      expect(ready.saveError?.message.trim()).not.toBe("");
    });

    it("保存に失敗した後、次の保存が成功すると saveError は null に戻る", async () => {
      // 準備：1 回目の保存だけ失敗させる
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      vi.spyOn(storage, "saveAssignments").mockRejectedValueOnce(new Error("QuotaExceededError"));
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      await store.getState().setAssignments(MOVED);
      expect(expectReady(store).saveError).not.toBeNull();

      // 実行：もう一度変える
      const again: AssignmentMap = { ...MOVED, akashi: "sixth" };
      await store.getState().setAssignments(again);

      // 検証
      expect(expectReady(store).saveError).toBeNull();
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(again);
    });

    it("続けて 2 回変えると、状態も保存先も後の割り当てになる（保存の順番が入れ替わらない）", async () => {
      // 準備
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      const later: AssignmentMap = { ...MOVED, akashi: "sixth" };

      // 実行：1 回目の保存を待たずに 2 回目を変える
      const first = store.getState().setAssignments(MOVED);
      const second = store.getState().setAssignments(later);
      await Promise.all([first, second]);

      // 検証
      expect(expectReady(store).assignments).toEqual(later);
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(later);
    });

    it("準備完了の前（待機中）に割り当てを変えても、保存しない", async () => {
      // 準備
      const { storage } = openTestStorage();
      const save = vi.spyOn(storage, "saveAssignments");
      const store = createPlanDataStore(storage);

      // 実行
      await store.getState().setAssignments(MOVED);

      // 検証
      expect(save).not.toHaveBeenCalled();
      expect(store.getState().status).toBe("idle");
    });
  });

  describe("読み直し（reload）", () => {
    it("取り込みを保存した後に読み直すと、新しい艦と最終取り込みになり、割り当ては残る", async () => {
      // 準備：前の取り込み（31 隻）と割り当て
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 実行：取り込み画面で 2 隻だけを取り込み直してから読み直す（初霜改二は第三十一戦隊、明石改は控え）
      const ships = [shipByUid("hatsushimo"), shipByUid("akashi")];
      await storage.saveImport(importInput(ships, { importedAt: "2026-10-17T09:00:00.000+09:00" }));
      await store.getState().reload();

      // 検証：割り当ては、今回の取り込みにいる個体の分だけが残る（U9。整理は保存先が行う）
      const ready = expectReady(store);
      expect(byUid(ready.ships)).toEqual(byUid(ships));
      expect(ready.lastImport).toMatchObject({ importedAt: "2026-10-17T09:00:00.000+09:00", shipCount: 2 });
      expect(ready.assignments).toEqual({ hatsushimo: "s31" });
    });

    it("取り込んだ艦娘データを削除した後に読み直すと、艦は空・最終取り込みは null になり、割り当ては残る", async () => {
      // 準備
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 実行
      await storage.clearImportedShips();
      await store.getState().reload();

      // 検証
      const ready = expectReady(store);
      expect(ready.ships).toEqual([]);
      expect(ready.lastImport).toBeNull();
      expect(ready.assignments).toEqual(summer2026Assignments);
    });

    it("待機中（読み込む対象のイベントがない）に読み直しても、保存先を読まない", async () => {
      // 準備
      const { storage } = openTestStorage();
      const spies = spyOnReads(storage);
      const store = createPlanDataStore(storage);

      // 実行
      await store.getState().reload();

      // 検証
      expect(store.getState().status).toBe("idle");
      expect(readCount(spies)).toBe(0);
    });
  });

  describe("イベントの切り替え", () => {
    it("別のイベント ID で読み込むと、そのイベントの割り当てに替わる", async () => {
      // 準備：2 つのイベントの割り当てを保存しておく
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      await storage.saveAssignments(NEXT_EVENT_ID, { yamato: "rengo" });
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 実行
      await store.getState().load(NEXT_EVENT_ID, FUDA_IDS);

      // 検証
      const ready = expectReady(store);
      expect(ready.eventId).toBe(NEXT_EVENT_ID);
      expect(ready.assignments).toEqual({ yamato: "rengo" });
    });

    it("割り当てを保存していない新しいイベントは、空の割り当てから始まる（U17）", async () => {
      // 準備
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      const store = createPlanDataStore(storage);

      // 実行
      await store.getState().load(NEXT_EVENT_ID, FUDA_IDS);

      // 検証：艦は取り込んだまま、割り当ては空
      const ready = expectReady(store);
      expect(ready.ships).toHaveLength(summer2026Ships.length);
      expect(ready.assignments).toEqual({});
      expect(ready.returnedCount).toBe(0);
    });

    it("前のイベントの読み込みが後から終わっても、切り替えた後のイベントの状態を上書きしない", async () => {
      // 準備：最新イベントの割り当ての読み取りだけを待たせる
      const { storage: real } = openTestStorage();
      await seedSummer2026(real);
      await real.saveAssignments(NEXT_EVENT_ID, { yamato: "rengo" });
      const { storage, release } = holdAssignmentsOf(real, EVENT_ID);
      const store = createPlanDataStore(storage);

      // 実行：最新イベントの読み込みが終わる前に、次のイベントに切り替える
      const stale = store.getState().load(EVENT_ID, FUDA_IDS);
      await store.getState().load(NEXT_EVENT_ID, FUDA_IDS);
      release();
      await stale;

      // 検証
      const ready = expectReady(store);
      expect(ready.eventId).toBe(NEXT_EVENT_ID);
      expect(ready.assignments).toEqual({ yamato: "rengo" });
    });

    it("切り替えた後に割り当てを変えると、新しいイベントに保存し、前のイベントの割り当ては変わらない", async () => {
      // 準備
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      await store.getState().load(NEXT_EVENT_ID, FUDA_IDS);

      // 実行
      await store.getState().setAssignments({ akashi: "sixth" });

      // 検証
      expect(await storage.loadAssignments(NEXT_EVENT_ID)).toEqual({ akashi: "sixth" });
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(summer2026Assignments);
    });
  });

  describe("ブラウザ内の保存が使えないとき", () => {
    it("どの操作も失敗する保存先なら、例外を投げずに失敗の状態（operation: load、理由の文つき）になる", async () => {
      // 準備
      const store = createPlanDataStore(failingStorage());

      // 実行
      const loading = store.getState().load(EVENT_ID, FUDA_IDS);

      // 検証：例外にならず、失敗の状態になる
      await expect(loading).resolves.toBeUndefined();
      const state = store.getState();
      expect(state).toMatchObject({
        status: "error",
        error: { operation: "load", message: expect.any(String) },
      });
      if (state.status === "error") {
        expect(state.error.message.trim()).not.toBe("");
      }
    });

    it("本物の保存でも IndexedDB を開けない（indexedDB.open が失敗する）なら、失敗の状態になる", async () => {
      // 準備：この保存先は開けないことを先に確かめる
      const { storage } = openStorageWithoutIndexedDB();
      await expect(storage.loadShips()).rejects.toThrow();
      const store = createPlanDataStore(storage);

      // 実行
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 検証
      expect(store.getState()).toMatchObject({ status: "error", error: { operation: "load" } });
    });

    it("読み込みに失敗した後でも、読み直して読めれば準備完了になる", async () => {
      // 準備：1 回目の艦の読み取りだけ失敗させる
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      vi.spyOn(storage, "loadShips").mockRejectedValueOnce(new Error("UnknownError"));
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      expect(store.getState().status).toBe("error");

      // 実行
      await store.getState().reload();

      // 検証
      const ready = expectReady(store);
      expect(ready.ships).toHaveLength(summer2026Ships.length);
      expect(ready.assignments).toEqual(summer2026Assignments);
    });
  });
});
