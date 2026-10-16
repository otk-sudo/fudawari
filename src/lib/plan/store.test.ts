// 札割りのデータのストア（createPlanDataStore）のテスト
//
// - 保存先は fake-indexeddb（src/test/setup.ts で有効）の上の本物の保存（openStorage）。テストごとに別の DB 名を使う。
// - 保存の失敗は vi.spyOn で 1 回だけ失敗させる。ブラウザ内の保存が使えない場面は、どの操作も失敗する偽物と、
//   indexedDB.open を失敗させた本物の保存で作る。
// - 保存・読み込みが重なる場面は、saveAssignments・loadShips を止めておける保存先（holdableStorage）で作る。
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
  holdableStorage,
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

/** 保留中の非同期の処理（保存の結果を状態に入れる、など）を進める */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  describe("重なった読み込み（古い読み込みが割り当てを消さない）", () => {
    it("同じイベントで札 ID の一覧が違う読み込みが続けて始まっても、古い一覧で割り当てを控えに戻さない", async () => {
      // 準備：定義の札が増えた直後の場面（第三十一戦隊だけの一覧 → 今の定義の一覧）
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      const store = createPlanDataStore(storage);

      // 実行：古い一覧の読み込みが終わる前に、新しい一覧で読み込む
      const stale = store.getState().load(EVENT_ID, ["s31"]);
      const latest = store.getState().load(EVENT_ID, FUDA_IDS);
      await Promise.all([stale, latest]);

      // 検証：今の定義の札の割り当ては、状態にも保存先にも残る
      const ready = expectReady(store);
      expect(ready.assignments).toEqual(summer2026Assignments);
      expect(ready.returnedCount).toBe(0);
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(summer2026Assignments);
    });

    it("保存を待つ間に古い一覧・新しい一覧の順で読み込みが重なっても、古い一覧で割り当てを控えに戻さない", async () => {
      // 準備：割り当ての保存を止めておく
      const { storage: real } = openTestStorage();
      await seedSummer2026(real);
      const holding = holdableStorage(real);
      const store = createPlanDataStore(holding.storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      const held = holding.holdSaveAssignments();
      const saving = store.getState().setAssignments(MOVED);
      await held.reached;

      // 実行：保存の途中で、古い一覧 → 新しい一覧の順に読み込みを頼み、それから保存を終える
      const stale = store.getState().load(EVENT_ID, ["s31"]);
      const latest = store.getState().load(EVENT_ID, FUDA_IDS);
      held.release();
      await Promise.all([saving, stale, latest]);

      // 検証：変えた割り当てが、状態にも保存先にも残る
      const ready = expectReady(store);
      expect(ready.assignments).toEqual(MOVED);
      expect(await real.loadAssignments(EVENT_ID)).toEqual(MOVED);
    });
  });

  describe("保存に失敗した割り当ての読み直し（黙って消さない）", () => {
    it("保存に失敗したまま読み直すと、変えた割り当てを残して保存し直し、成功すれば saveError は null に戻る", async () => {
      // 準備：1 回目の保存だけ失敗させる
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      vi.spyOn(storage, "saveAssignments").mockRejectedValueOnce(new Error("QuotaExceededError"));
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      await store.getState().setAssignments(MOVED);
      expect(expectReady(store).saveError).not.toBeNull();

      // 実行
      await store.getState().reload();

      // 検証：状態は変えた割り当てのまま。保存し直して保存先にも入り、saveError は null に戻る
      expect(expectReady(store).assignments).toEqual(MOVED);
      await vi.waitFor(async () => {
        expect(await storage.loadAssignments(EVENT_ID)).toEqual(MOVED);
        expect(expectReady(store).saveError).toBeNull();
      });
    });

    it("保存に失敗した後の取り込みで外れた個体があれば、その個体の割り当てだけを除いて残し、保存し直す", async () => {
      // 準備：1 回目の保存だけ失敗させる
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      vi.spyOn(storage, "saveAssignments").mockRejectedValueOnce(new Error("QuotaExceededError"));
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      await store.getState().setAssignments(MOVED);
      expect(expectReady(store).saveError).not.toBeNull();

      // 実行：初霜改二と明石改だけを取り込み直してから読み直す
      const ships = [shipByUid("hatsushimo"), shipByUid("akashi")];
      await storage.saveImport(importInput(ships, { importedAt: "2026-10-17T09:00:00.000+09:00" }));
      await store.getState().reload();

      // 検証：取り込みにいる初霜改二の、変えた後の割り当て（連合艦隊）だけが残り、保存し直される
      expect(expectReady(store).assignments).toEqual({ hatsushimo: "rengo" });
      await vi.waitFor(async () => {
        expect(await storage.loadAssignments(EVENT_ID)).toEqual({ hatsushimo: "rengo" });
        expect(expectReady(store).saveError).toBeNull();
      });
    });

    it("保存し直しにも失敗したら、変えた割り当てを残したまま saveError も残す", async () => {
      // 準備：1 回目（割り当ての変更）と 2 回目（読み直しの後の保存し直し）の保存を失敗させる
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      const save = vi
        .spyOn(storage, "saveAssignments")
        .mockRejectedValueOnce(new Error("QuotaExceededError"))
        .mockRejectedValueOnce(new Error("QuotaExceededError"));
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      await store.getState().setAssignments(MOVED);

      // 実行
      await store.getState().reload();

      // 検証：状態は変えた割り当てのまま。保存し直しを試み、失敗の理由が残る
      expect(expectReady(store).assignments).toEqual(MOVED);
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      await flush();
      const ready = expectReady(store);
      expect(ready.assignments).toEqual(MOVED);
      expect(ready.saveError).toEqual({ operation: "save", message: expect.any(String) });
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(summer2026Assignments);
    });
  });

  describe("保存と読み込みの重なり（競合を防ぐ処理）", () => {
    it("1 回目の保存を止めたまま 2 回目を変えると、保存は 1 つずつ順に行われ、保存先は後の割り当てになる", async () => {
      // 準備
      const { storage: real } = openTestStorage();
      await seedSummer2026(real);
      const holding = holdableStorage(real);
      const store = createPlanDataStore(holding.storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      const later: AssignmentMap = { ...MOVED, akashi: "sixth" };

      // 実行：1 回目の保存を止めている間に 2 回目を変え、それから 1 回目を終える
      const held = holding.holdSaveAssignments();
      const first = store.getState().setAssignments(MOVED);
      await held.reached;
      const second = store.getState().setAssignments(later);
      await flush();
      held.release();
      await Promise.all([first, second]);

      // 検証：2 回目の保存は 1 回目が終わってから始まり、保存先は後の割り当て
      expect(holding.calls.filter((name) => name.startsWith("saveAssignments"))).toEqual([
        "saveAssignments",
        "saveAssignments:done",
        "saveAssignments",
        "saveAssignments:done",
      ]);
      expect(expectReady(store).assignments).toEqual(later);
      expect(await real.loadAssignments(EVENT_ID)).toEqual(later);
    });

    it("読み直しが保存先を読んでいる間に割り当てを変えると、変えた割り当てが状態にも保存先にも残る", async () => {
      // 準備
      const { storage: real } = openTestStorage();
      await seedSummer2026(real);
      const holding = holdableStorage(real);
      const store = createPlanDataStore(holding.storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 実行：読み直しの艦の読み取りを止めている間に割り当てを変え、それから読み直しを終える
      const held = holding.holdLoadShips();
      const reloading = store.getState().reload();
      await held.reached;
      const saving = store.getState().setAssignments(MOVED);
      held.release();
      await Promise.all([reloading, saving]);

      // 検証
      expect(expectReady(store).assignments).toEqual(MOVED);
      expect(await real.loadAssignments(EVENT_ID)).toEqual(MOVED);
    });

    it("保存の途中で読み直すと、保存が終わってから保存先を読む（状態は変えた割り当てのまま）", async () => {
      // 準備
      const { storage: real } = openTestStorage();
      await seedSummer2026(real);
      const holding = holdableStorage(real);
      const store = createPlanDataStore(holding.storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 実行：保存を止めている間に読み直しを頼み、それから保存を終える
      const held = holding.holdSaveAssignments();
      const saving = store.getState().setAssignments(MOVED);
      await held.reached;
      const mark = holding.calls.length;
      const reloading = store.getState().reload();
      held.release();
      await Promise.all([saving, reloading]);

      // 検証：控えに戻す処理（保存先を読み書きする）は保存が終わってから。状態・保存先とも変えた割り当て
      const after = holding.calls.slice(mark);
      expect(after.indexOf("returnOrphanedAssignments")).toBeGreaterThan(after.indexOf("saveAssignments:done"));
      expect(expectReady(store).assignments).toEqual(MOVED);
      expect(await real.loadAssignments(EVENT_ID)).toEqual(MOVED);
    });

    it("準備完了から読み直す間も、status は ready のまま（読み込み中に戻らない）", async () => {
      // 準備
      const { storage: real } = openTestStorage();
      await seedSummer2026(real);
      const holding = holdableStorage(real);
      const store = createPlanDataStore(holding.storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      const seen: string[] = [];
      const unsubscribe = store.subscribe((state) => seen.push(state.status));

      // 実行：読み直しの艦の読み取りを止めている間の状態を見る
      const held = holding.holdLoadShips();
      const reloading = store.getState().reload();
      await held.reached;
      const during = store.getState().status;
      held.release();
      await reloading;
      unsubscribe();

      // 検証
      expect(during).toBe("ready");
      expect(seen).not.toContain("loading");
      expect(expectReady(store).assignments).toEqual(summer2026Assignments);
    });

    it("別のイベントを読み込んだ後に前のイベントの保存が失敗しても、新しいイベントの saveError に入らず、新しいイベントにも保存しない", async () => {
      // 準備
      const { storage: real } = openTestStorage();
      await seedSummer2026(real);
      const holding = holdableStorage(real);
      const store = createPlanDataStore(holding.storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 実行：最新イベントの保存を止めている間に次のイベントを読み込み、それから保存を失敗させる
      const held = holding.holdSaveAssignments();
      const saving = store.getState().setAssignments(MOVED);
      await held.reached;
      const switching = store.getState().load(NEXT_EVENT_ID, FUDA_IDS);
      held.fail(new Error("QuotaExceededError"));
      await Promise.all([saving, switching]);
      await flush();

      // 検証
      const ready = expectReady(store);
      expect(ready.eventId).toBe(NEXT_EVENT_ID);
      expect(ready.saveError).toBeNull();
      expect(ready.assignments).toEqual({});
      expect(await real.loadAssignments(NEXT_EVENT_ID)).toEqual({});
    });

    it("前のイベントの読み込みが後から失敗しても、新しいイベントの状態を失敗で上書きしない", async () => {
      // 準備：2 つのイベントの割り当てを保存しておく
      const { storage: real } = openTestStorage();
      await seedSummer2026(real);
      await real.saveAssignments(NEXT_EVENT_ID, { yamato: "rengo" });
      const holding = holdableStorage(real);
      const store = createPlanDataStore(holding.storage);

      // 実行：最新イベントの艦の読み取りを止めている間に次のイベントの読み込みを頼み、それから前の読み取りを失敗させる
      const held = holding.holdLoadShips();
      const stale = store.getState().load(EVENT_ID, FUDA_IDS);
      await held.reached;
      const seen: string[] = [];
      const unsubscribe = store.subscribe((state) => seen.push(state.status));
      const latest = store.getState().load(NEXT_EVENT_ID, FUDA_IDS);
      held.fail(new Error("UnknownError"));
      await Promise.all([stale, latest]);
      unsubscribe();

      // 検証：失敗の状態を一度も挟まず、次のイベントの準備完了になる
      expect(seen).not.toContain("error");
      const ready = expectReady(store);
      expect(ready.eventId).toBe(NEXT_EVENT_ID);
      expect(ready.assignments).toEqual({ yamato: "rengo" });
    });

    it("待機中（load(null)）にした後に、前の読み込みの結果で状態を上書きしない", async () => {
      // 準備
      const { storage: real } = openTestStorage();
      await seedSummer2026(real);
      const holding = holdableStorage(real);
      const store = createPlanDataStore(holding.storage);

      // 実行：艦の読み取りを止めている間に待機中にし、それから読み取りを終える
      const held = holding.holdLoadShips();
      const stale = store.getState().load(EVENT_ID, FUDA_IDS);
      await held.reached;
      const seen: string[] = [];
      const unsubscribe = store.subscribe((state) => seen.push(state.status));
      const idle = store.getState().load(null, FUDA_IDS);
      held.release();
      await Promise.all([stale, idle]);
      await flush();
      unsubscribe();

      // 検証：待機中のまま、準備完了を挟まない
      expect(store.getState().status).toBe("idle");
      expect(seen).not.toContain("ready");
    });
  });

  describe("控えに戻した件数（returnedCount）", () => {
    it("同じイベントで札 ID の一覧が変わって、また控えに戻したら、前の件数に足す", async () => {
      // 準備：利根改二を、定義から消えた札に置いておく
      const { storage } = openTestStorage();
      await storage.saveImport(importInput(summer2026Ships));
      await storage.saveAssignments(EVENT_ID, { ...summer2026Assignments, tone: "removed-fuda" });
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      expect(expectReady(store).returnedCount).toBe(1);

      // 実行：定義から第六艦隊（sixth）が消えた一覧で読み込み直す（伊41改が控えに戻る）
      await store.getState().load(
        EVENT_ID,
        FUDA_IDS.filter((id) => id !== "sixth"),
      );

      // 検証
      expect(expectReady(store).returnedCount).toBe(2);
    });

    it("同じイベントで読み直して控えに戻すものがなくても、知らせていない件数は消えない", async () => {
      // 準備
      const { storage } = openTestStorage();
      await storage.saveImport(importInput(summer2026Ships));
      await storage.saveAssignments(EVENT_ID, { ...summer2026Assignments, tone: "removed-fuda" });
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 実行：取り込みの後などに読み直す
      await store.getState().reload();

      // 検証
      expect(expectReady(store).returnedCount).toBe(1);
    });

    it("acknowledgeReturned で 0 に戻り、その後に控えに戻した分は 0 から数える", async () => {
      // 準備
      const { storage } = openTestStorage();
      await storage.saveImport(importInput(summer2026Ships));
      await storage.saveAssignments(EVENT_ID, { ...summer2026Assignments, tone: "removed-fuda" });
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);

      // 実行：知らせ終えた
      store.getState().acknowledgeReturned();

      // 検証：0 に戻り、読み直しても 0 のまま
      expect(expectReady(store).returnedCount).toBe(0);
      await store.getState().reload();
      expect(expectReady(store).returnedCount).toBe(0);

      // 実行：定義から第六艦隊（sixth）が消えた一覧で読み込み直す（伊41改が控えに戻る）
      await store.getState().load(
        EVENT_ID,
        FUDA_IDS.filter((id) => id !== "sixth"),
      );

      // 検証
      expect(expectReady(store).returnedCount).toBe(1);
    });

    it("別のイベントを読み込むと、前のイベントの件数を持ち越さずに 0 から数える", async () => {
      // 準備：どちらのイベントにも、定義から消えた札の割り当てが 1 つずつある
      const { storage } = openTestStorage();
      await storage.saveImport(importInput(summer2026Ships));
      await storage.saveAssignments(EVENT_ID, { ...summer2026Assignments, tone: "removed-fuda" });
      await storage.saveAssignments(NEXT_EVENT_ID, { yamato: "removed-fuda" });
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      expect(expectReady(store).returnedCount).toBe(1);

      // 実行
      await store.getState().load(NEXT_EVENT_ID, FUDA_IDS);

      // 検証
      expect(expectReady(store).returnedCount).toBe(1);
    });

    it("準備完了でないとき（待機中）に acknowledgeReturned を呼んでも、例外にならず待機中のまま", () => {
      // 準備
      const { storage } = openTestStorage();
      const store = createPlanDataStore(storage);

      // 実行
      store.getState().acknowledgeReturned();

      // 検証
      expect(store.getState().status).toBe("idle");
    });
  });

  describe("割り当てを関数で変える（setAssignments((prev) => next)）", () => {
    it("関数を渡すと、今の割り当てを受け取り、返した割り当てに変えて保存する", async () => {
      // 準備
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      const received: AssignmentMap[] = [];

      // 実行
      await store.getState().setAssignments((prev) => {
        received.push(prev);
        return { ...prev, hatsushimo: "rengo" };
      });

      // 検証
      expect(expectReady(store).assignments).toEqual(MOVED);
      expect(received).toEqual([summer2026Assignments]);
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(MOVED);
    });

    it("同じイベント処理の中で関数を 2 回渡しても、1 回目の変更が消えない", async () => {
      // 準備
      const { storage } = openTestStorage();
      await seedSummer2026(storage);
      const store = createPlanDataStore(storage);
      await store.getState().load(EVENT_ID, FUDA_IDS);
      const both: AssignmentMap = { ...MOVED, akashi: "sixth" };

      // 実行：保存を待たずに続けて 2 回変える（1 回のクリックで 2 隻を動かす場面）
      const first = store.getState().setAssignments((prev) => ({ ...prev, hatsushimo: "rengo" }));
      const second = store.getState().setAssignments((prev) => ({ ...prev, akashi: "sixth" }));
      await Promise.all([first, second]);

      // 検証
      expect(expectReady(store).assignments).toEqual(both);
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(both);
    });

    it("準備完了の前（待機中）に関数を渡しても、関数を呼ばず、保存もしない", async () => {
      // 準備
      const { storage } = openTestStorage();
      const save = vi.spyOn(storage, "saveAssignments");
      const store = createPlanDataStore(storage);
      const update = vi.fn((prev: AssignmentMap): AssignmentMap => ({ ...prev, hatsushimo: "rengo" }));

      // 実行
      await store.getState().setAssignments(update);

      // 検証
      expect(update).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(store.getState().status).toBe("idle");
    });
  });
});
