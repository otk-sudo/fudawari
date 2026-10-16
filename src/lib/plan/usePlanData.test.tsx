// 札割りのデータのフック（usePlanData）のテスト
//
// - 共有のストアはモジュールに残るため、テストごとに resetPlanDataCache({ storage }) で、そのテストだけの保存先
//   （fake-indexeddb の上の本物の保存。別の DB 名）に差し替える。
// - 時刻・乱数には頼らない。
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentMap } from "@/domain/plan/types";
import { getPlanStorage, type PlanData, resetPlanDataCache, usePlanData } from "@/lib/plan";
import type { FudawariStorage } from "@/lib/storage";
import { shipByUid, summer2026Assignments, summer2026Definition, summer2026Ships } from "@/test/fixtures";
import {
  byUid,
  cleanupTestStorages,
  failingStorage,
  importInput,
  openTestStorage,
} from "@/test/plan-storage";

// ---- テスト用のデータ ----

/** 最新イベントの ID（"2026-summer"） */
const EVENT_ID = summer2026Definition.event.id;
/** 次のイベントの ID */
const NEXT_EVENT_ID = "2027-winter";
/** 今の定義の札 ID の一覧（s31・tago・rengo・ulithi・sixth） */
const FUDA_IDS = summer2026Definition.fudas.map((fuda) => fuda.id);
/** 割り当てを 1 隻だけ変えた例：初霜改二を第三十一戦隊から連合艦隊へ */
const MOVED: AssignmentMap = { ...summer2026Assignments, hatsushimo: "rengo" };

// ---- 補助 ----

/** このテストの保存先（beforeEach で開いて、共有のストアに渡す） */
let storage: FudawariStorage;

beforeEach(() => {
  storage = openTestStorage("fudawari-plan-hook-test").storage;
  resetPlanDataCache({ storage });
});

afterEach(async () => {
  // 部品を外してから、共有のストアを捨て、DB を消す
  cleanup();
  resetPlanDataCache();
  vi.restoreAllMocks();
  await cleanupTestStorages();
});

/** 準備完了の値を取り出す（準備完了でなければ、その時点でテストを失敗させる） */
function expectReady(data: PlanData): Extract<PlanData, { status: "ready" }> {
  expect(data.status).toBe("ready");
  if (data.status !== "ready") {
    throw new Error(`準備完了になっていない（status: ${data.status}）`);
  }
  return data;
}

/** 取り込み（31 隻）と最新イベントの割り当てを保存しておく */
async function seedSummer2026(target: FudawariStorage): Promise<void> {
  await target.saveImport(importInput(summer2026Ships));
  await target.saveAssignments(EVENT_ID, summer2026Assignments);
}

/** 保留中の非同期の処理（保存先の読み取りなど）を進める */
async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** フックの状態を文字で出す部品。初霜改二（hatsushimo）の割り当てと隻数を出す */
function PlanProbe({ label }: { label: string }): ReactNode {
  const plan = usePlanData(EVENT_ID, FUDA_IDS);
  if (plan.status !== "ready") return <p>{`${label}：${plan.status}`}</p>;
  return (
    <p>{`${label}：${plan.ships.length}隻・初霜改二→${plan.assignments.hatsushimo ?? "控え"}`}</p>
  );
}

/** 押すと初霜改二を連合艦隊へ移すボタン */
function MoveButton(): ReactNode {
  const plan = usePlanData(EVENT_ID, FUDA_IDS);
  return (
    <button type="button" disabled={plan.status !== "ready"} onClick={() => void plan.setAssignments(MOVED)}>
      初霜改二を連合艦隊へ
    </button>
  );
}

// ---- テスト ----

describe("札割りのデータのフック（usePlanData）", () => {
  describe("読み込み", () => {
    it("イベント ID が null（定義の読み込み中・失敗）なら待機中（idle）を返し、保存先を読まない", async () => {
      // 準備
      const loadShips = vi.spyOn(storage, "loadShips");

      // 実行
      const { result } = renderHook(() => usePlanData(null, []));
      await flushAsync();

      // 検証
      expect(result.current.status).toBe("idle");
      expect(loadShips).not.toHaveBeenCalled();
    });

    it("イベント ID があれば、最初の描画から読み込み中で（待機中を挟まない）、読み終えると準備完了になる", async () => {
      // 準備
      await seedSummer2026(storage);
      const seen: string[] = [];

      // 実行
      const { result } = renderHook(() => {
        const plan = usePlanData(EVENT_ID, FUDA_IDS);
        seen.push(plan.status);
        return plan;
      });

      // 検証
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(seen[0]).toBe("loading");
      expect(seen).not.toContain("idle");
      const ready = expectReady(result.current);
      expect(ready.eventId).toBe(EVENT_ID);
      expect(byUid(ready.ships)).toEqual(byUid(summer2026Ships));
      expect(ready.lastImport).toMatchObject({ shipCount: summer2026Ships.length, hasUid: true });
      expect(ready.assignments).toEqual(summer2026Assignments);
      expect(ready.returnedCount).toBe(0);
      expect(ready.saveError).toBeNull();
    });

    it("取り込んでいなければ、艦は空・最終取り込みは null・割り当ては空で準備完了になる", async () => {
      // 実行
      const { result } = renderHook(() => usePlanData(EVENT_ID, FUDA_IDS));

      // 検証
      await waitFor(() => expect(result.current.status).toBe("ready"));
      const ready = expectReady(result.current);
      expect(ready.ships).toEqual([]);
      expect(ready.lastImport).toBeNull();
      expect(ready.assignments).toEqual({});
    });

    it("今の定義の札 ID にない札の割り当ては控えに戻し、戻した件数を返す（U17）", async () => {
      // 準備：利根改二を、定義から消えた札に置いておく
      await storage.saveImport(importInput(summer2026Ships));
      await storage.saveAssignments(EVENT_ID, { ...summer2026Assignments, tone: "removed-fuda" });

      // 実行
      const { result } = renderHook(() => usePlanData(EVENT_ID, FUDA_IDS));

      // 検証
      await waitFor(() => expect(result.current.status).toBe("ready"));
      const ready = expectReady(result.current);
      expect(ready.assignments).toEqual(summer2026Assignments);
      expect(ready.returnedCount).toBe(1);
    });
  });

  describe("引数が変わったとき", () => {
    it("イベント ID が null から決まると、読み込みを始める（定義の読み込みが済んだ場面）", async () => {
      // 準備
      await seedSummer2026(storage);
      const { result, rerender } = renderHook(
        ({ eventId }: { eventId: string | null }) => usePlanData(eventId, FUDA_IDS),
        { initialProps: { eventId: null as string | null } },
      );
      expect(result.current.status).toBe("idle");

      // 実行
      rerender({ eventId: EVENT_ID });

      // 検証
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(expectReady(result.current).assignments).toEqual(summer2026Assignments);
    });

    it("別のイベント ID に変わると、そのイベントの割り当てを読み直す", async () => {
      // 準備
      await seedSummer2026(storage);
      await storage.saveAssignments(NEXT_EVENT_ID, { yamato: "rengo" });
      const { result, rerender } = renderHook(
        ({ eventId }: { eventId: string }) => usePlanData(eventId, FUDA_IDS),
        { initialProps: { eventId: EVENT_ID } },
      );
      await waitFor(() => expect(result.current.status).toBe("ready"));

      // 実行
      rerender({ eventId: NEXT_EVENT_ID });

      // 検証
      await waitFor(() =>
        expect(result.current).toMatchObject({ status: "ready", eventId: NEXT_EVENT_ID }),
      );
      expect(expectReady(result.current).assignments).toEqual({ yamato: "rengo" });
    });

    it("札 ID の一覧が同じ中身の新しい配列で渡されても、読み直さない", async () => {
      // 準備
      await seedSummer2026(storage);
      const loadShips = vi.spyOn(storage, "loadShips");
      const { result, rerender } = renderHook(
        ({ fudaIds }: { fudaIds: readonly string[] }) => usePlanData(EVENT_ID, fudaIds),
        { initialProps: { fudaIds: FUDA_IDS } },
      );
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(loadShips).toHaveBeenCalledTimes(1);

      // 実行：描画のたびに定義から札 ID の一覧を作り直す場面
      rerender({ fudaIds: [...FUDA_IDS] });
      await flushAsync();

      // 検証
      expect(result.current.status).toBe("ready");
      expect(loadShips).toHaveBeenCalledTimes(1);
    });

    it("札 ID の一覧から札が消えると、読み直して、その札の割り当てを控えに戻す", async () => {
      // 準備
      await seedSummer2026(storage);
      const { result, rerender } = renderHook(
        ({ fudaIds }: { fudaIds: readonly string[] }) => usePlanData(EVENT_ID, fudaIds),
        { initialProps: { fudaIds: FUDA_IDS } },
      );
      await waitFor(() => expect(result.current.status).toBe("ready"));

      // 実行：定義から第六艦隊（sixth）が消えた
      rerender({ fudaIds: FUDA_IDS.filter((id) => id !== "sixth") });

      // 検証：第六艦隊にいた伊41改（i41）が控えに戻る
      await waitFor(() => expect(result.current).toMatchObject({ status: "ready", returnedCount: 1 }));
      const ready = expectReady(result.current);
      expect(ready.assignments.i41).toBeUndefined();
      expect(ready.assignments.hatsushimo).toBe("s31");
    });
  });

  describe("複数の部品で共有する", () => {
    it("同じ画面の 3 つの部品が使っても（StrictMode でも）、読み込みは 1 回で、全員が同じデータを受け取る", async () => {
      // 準備
      await seedSummer2026(storage);
      const loadShips = vi.spyOn(storage, "loadShips");

      // 実行
      render(
        <StrictMode>
          <PlanProbe label="控え" />
          <PlanProbe label="札の列" />
          <PlanProbe label="右側" />
        </StrictMode>,
      );

      // 検証
      expect(await screen.findByText("控え：31隻・初霜改二→s31")).toBeInTheDocument();
      expect(screen.getByText("札の列：31隻・初霜改二→s31")).toBeInTheDocument();
      expect(screen.getByText("右側：31隻・初霜改二→s31")).toBeInTheDocument();
      expect(loadShips).toHaveBeenCalledTimes(1);
    });

    it("ある部品で割り当てを変えると、ほかの部品にもすぐに映り、保存される", async () => {
      // 準備
      await seedSummer2026(storage);
      const user = userEvent.setup();
      render(
        <>
          <PlanProbe label="札の列" />
          <MoveButton />
        </>,
      );
      expect(await screen.findByText("札の列：31隻・初霜改二→s31")).toBeInTheDocument();

      // 実行
      await user.click(screen.getByRole("button", { name: "初霜改二を連合艦隊へ" }));

      // 検証
      expect(await screen.findByText("札の列：31隻・初霜改二→rengo")).toBeInTheDocument();
      await waitFor(async () => expect(await storage.loadAssignments(EVENT_ID)).toEqual(MOVED));
    });
  });

  describe("取り込み・削除の後の読み直し", () => {
    it("getPlanStorage で取り込みを保存してから reload を呼ぶと、新しい艦と最終取り込みを返す", async () => {
      // 準備：まだ取り込んでいない
      const { result } = renderHook(() => usePlanData(EVENT_ID, FUDA_IDS));
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(expectReady(result.current).ships).toEqual([]);

      // 実行：取り込み画面での保存の後に読み直す
      const ships = [shipByUid("hatsushimo"), shipByUid("akashi")];
      await getPlanStorage().saveImport(importInput(ships, { importedAt: "2026-10-17T09:00:00.000+09:00" }));
      await act(async () => {
        await result.current.reload();
      });

      // 検証
      const ready = expectReady(result.current);
      expect(byUid(ready.ships)).toEqual(byUid(ships));
      expect(ready.lastImport).toMatchObject({ importedAt: "2026-10-17T09:00:00.000+09:00", shipCount: 2 });
    });

    it("取り込んだ艦娘データを削除してから reload を呼ぶと、艦は空・最終取り込みは null になり、割り当ては残る", async () => {
      // 準備
      await seedSummer2026(storage);
      const { result } = renderHook(() => usePlanData(EVENT_ID, FUDA_IDS));
      await waitFor(() => expect(result.current.status).toBe("ready"));

      // 実行
      await getPlanStorage().clearImportedShips();
      await act(async () => {
        await result.current.reload();
      });

      // 検証
      const ready = expectReady(result.current);
      expect(ready.ships).toEqual([]);
      expect(ready.lastImport).toBeNull();
      expect(ready.assignments).toEqual(summer2026Assignments);
    });
  });

  describe("ブラウザ内の保存が使えないとき", () => {
    it("例外で画面が落ちず、失敗の状態（operation: load、理由の文つき）を返す", async () => {
      // 準備
      resetPlanDataCache({ storage: failingStorage() });

      // 実行
      render(<PlanProbe label="一覧" />);

      // 検証：部品は描画されたまま、失敗の状態になる
      expect(await screen.findByText("一覧：error")).toBeInTheDocument();
      const { result } = renderHook(() => usePlanData(EVENT_ID, FUDA_IDS));
      expect(result.current).toMatchObject({
        status: "error",
        error: { operation: "load", message: expect.any(String) },
      });
      if (result.current.status === "error") {
        expect(result.current.error.message.trim()).not.toBe("");
      }
    });
  });

  describe("保存先の差し替えと共有（テストの前準備・取り込み画面向け）", () => {
    it("getPlanStorage は、resetPlanDataCache で渡した保存先（usePlanData が読み書きする保存先）を返す", () => {
      // 検証：beforeEach で渡した保存先
      expect(getPlanStorage()).toBe(storage);
    });

    it("保存先を渡さずに resetPlanDataCache すると、既定の保存先になり、getPlanStorage は何度呼んでも同じものを返す", () => {
      // 実行
      resetPlanDataCache();

      // 検証
      const first = getPlanStorage();
      expect(first).not.toBe(storage);
      expect(getPlanStorage()).toBe(first);
    });

    it("resetPlanDataCache の後に使うと、新しい保存先から読み直す（テストの前準備が効くことの確認）", async () => {
      // 準備：1 つ目の保存先で読み込む
      await seedSummer2026(storage);
      const first = render(<PlanProbe label="1 回目" />);
      expect(await screen.findByText("1 回目：31隻・初霜改二→s31")).toBeInTheDocument();
      first.unmount();

      // 実行：初霜改二だけを取り込んだ別の保存先に差し替える
      const other = openTestStorage("fudawari-plan-hook-test-other").storage;
      await other.saveImport(importInput([shipByUid("hatsushimo")]));
      resetPlanDataCache({ storage: other });
      render(<PlanProbe label="2 回目" />);

      // 検証
      expect(await screen.findByText("2 回目：1隻・初霜改二→控え")).toBeInTheDocument();
    });
  });
});
