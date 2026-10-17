// 割り振りの画面（/assign。roadmap T2-7、要件 3.3・5 章、U17・U22）のテスト：読み込み・保存・設定とのつながり
//
// 画面の中身の表示と操作は src/features/assign/AssignScreen.test.tsx で確かめる。ここでは、ページが
// - 公開定義（/data/latest-definition.json）・艦船マスタ（/data/ship-master.json）・札割りのデータ（usePlanData）・設定を読み、
// - 読み込み中・失敗・取り込んでいないときの表示を出し分け、
// - すべて読めたら中身を出し、割り当ての変更をブラウザ内に保存する（再読み込みしても残る）
// ことを確かめる。ヘッダーの最新イベント名と公開定義の読み込みの失敗の表示は src/app/screen-headers.test.tsx でも確かめている。
//
// - fetch は差し替える（src/test/latest-data-fetch.ts でパスごとに振り分ける）。
// - 保存先は fake-indexeddb の上の本物の保存（テストごとに別の DB）を、共有の札割りのデータに渡す（resetPlanDataCache）。
// - 部品の探し方は src/test/assign-screen.ts の冒頭にまとめてある。
//
// PR-14（T4-2 の点検の B1）で足したこと（先に書いたテスト。直し方は親が決めた）
// - 割り振りの画面を開いたまま、共有の札割りのデータ（usePlanData）の割り当てが外から置き換えられたら
//   （設定の「札割りの書き出し・読み込み」の読み込みなど。setAssignments）、画面は新しい割り当てを表示し、
//   「元に戻す」の履歴を捨てる（押せなくする）。次の操作は新しい割り当ての上に重ねて保存する
//   （古い割り当てに 1 手を足した全体を保存して、読み込んだ内容を消さない）。
//   この画面の中の操作（setAssignments を通した保存）では履歴を捨てない（既存の「元に戻す」のテストのとおり）
// - 取り込み直し（取り込みの画面）・取り込んだ艦娘データの削除（艦が 0 隻になり、取り込みの案内に替わる）は、
//   割り振りの画面の中身を外すので、この問題は起きない（テストは足していない）
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssignPage from "@/app/assign/page";
import { SettingsDialog } from "@/components/SettingsDialog";
import { closeSettingsDialog, openSettingsDialog } from "@/components/settings-dialog-store";
import { serializePlanFile } from "@/domain/plan/planFile";
import type { AssignmentMap } from "@/domain/plan/types";
import { SettingsContent } from "@/features/settings";
import { LATEST_DEFINITION_PATH, resetLatestDefinitionCache, useLatestDefinition } from "@/lib/definition";
import { resetPlanDataCache, usePlanData } from "@/lib/plan";
import { resetShipMasterCache, SHIP_MASTER_PATH } from "@/lib/ship-master";
import type { FudawariStorage } from "@/lib/storage";
import {
  getCard,
  getColumn,
  getGroupHeader,
  getPanel,
  getTray,
  queryCard,
  queryTray,
  shipCountPattern,
  trayCountPattern,
} from "@/test/assign-screen";
import { type FetchMock, requestedPaths, stubFetch, textResponse } from "@/test/definition-fetch";
import { expectInDocumentOrder } from "@/test/dom-order";
import { summer2026Assignments, summer2026Definition, summer2026Ships } from "@/test/fixtures";
import {
  holdResponder,
  latestDataResponders,
  respondByPath,
  respondWithLatestData,
} from "@/test/latest-data-fetch";
import { cleanupTestStorages, failingStorage, importInput, openTestStorage } from "@/test/plan-storage";
import { shipMasterFileOf } from "@/test/ship-master-fetch";

// ---- テスト用のデータ ----

/** 最新イベントの ID（"2026-summer"） */
const EVENT_ID = summer2026Definition.event.id;

/** 読み込み中の表示 */
const LOADING = /読み込み中/;
/** 読み込みに失敗したときに書く次の行動（公開定義の失敗の警告と同じ） */
const RELOAD_ADVICE = "ページを再読み込みしてください";

// ---- 補助 ----

let fetchMock: FetchMock;
/** このテストの保存先（beforeEach で開いて、共有の札割りのデータに渡す） */
let storage: FudawariStorage;

beforeEach(() => {
  resetLatestDefinitionCache();
  resetShipMasterCache();
  storage = openTestStorage("fudawari-assign-page-test").storage;
  resetPlanDataCache({ storage });
  fetchMock = stubFetch();
  respondWithLatestData(fetchMock);
});

afterEach(async () => {
  // 部品を外してから、共有の読み込みの状態を捨て、差し替えを戻し、DB を消す
  cleanup();
  closeSettingsDialog();
  resetLatestDefinitionCache();
  resetShipMasterCache();
  resetPlanDataCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await cleanupTestStorages();
});

/** 取り込み（31 隻）と、最新イベントの割り当てを保存しておく */
async function seedPlan(target: FudawariStorage, assignments: AssignmentMap = summer2026Assignments): Promise<void> {
  await target.saveImport(importInput(summer2026Ships));
  await target.saveAssignments(EVENT_ID, assignments);
}

/** 割り振りの画面を描く */
function renderAssignPage(): { user: UserEvent; unmount: () => void } {
  const user = userEvent.setup();
  const { unmount } = render(<AssignPage />);
  return { user, unmount };
}

/** 中身（控え）が出るまで待つ */
async function waitForReady(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: "控えの艦" });
}

/** ページを開き直す（共有の読み込みの状態を捨ててから描き直す。保存先は同じ） */
async function reopenAssignPage(unmount: () => void): Promise<UserEvent> {
  unmount();
  resetLatestDefinitionCache();
  resetShipMasterCache();
  resetPlanDataCache({ storage });
  const { user } = renderAssignPage();
  await waitForReady();
  return user;
}

/** 控えの利根改二を選び、連合艦隊の「ここに置く」で置く */
async function placeToneOnRengo(user: UserEvent): Promise<void> {
  await user.click(getCard(getTray(), "利根改二"));
  await user.click(within(getColumn("連合艦隊")).getByRole("button", { name: "ここに置く（特効あり）" }));
}

/** 取り込んだ艦の読み取りだけを、release を呼ぶまで待たせる保存先（札割りのデータの読み込み中を作る） */
function holdPlanLoading(target: FudawariStorage) {
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let requested = false;
  const held: FudawariStorage = {
    ...target,
    async loadShips() {
      requested = true;
      await gate;
      return target.loadShips();
    },
  };
  return { storage: held, release: () => open(), wasRequested: () => requested };
}

/** 確認用：同じページの別の部品が使う札割りのデータ（usePlanData）の、利根改二の割り当てを文字で出す */
function PlanProbe(): ReactNode {
  const state = useLatestDefinition();
  const definition = state.status === "success" ? state.definition : null;
  const plan = usePlanData(definition?.event.id ?? null, definition?.fudas.map((fuda) => fuda.id) ?? []);
  const text = plan.status === "ready" ? (plan.assignments.tone ?? "控え") : plan.status;
  return <p>{`確認用：利根改二→${text}`}</p>;
}

/** 確認用：同じページの別の部品が使う札割りのデータ（usePlanData）の、控えに戻した件数（returnedCount）を文字で出す */
function ReturnedProbe(): ReactNode {
  const state = useLatestDefinition();
  const definition = state.status === "success" ? state.definition : null;
  const plan = usePlanData(definition?.event.id ?? null, definition?.fudas.map((fuda) => fuda.id) ?? []);
  const text = plan.status === "ready" ? String(plan.returnedCount) : plan.status;
  return <p>{`確認用：控えに戻した件数→${text}`}</p>;
}

/** 確認用の部品の、共有の札割りのデータの割り当てを外から置き換えるボタン */
const PROBE_REPLACE = "確認用：割り当てを置き換える";

/**
 * 外から置き換える割り当て（設定で読み込む札割りの代わり）：
 * 時雨改二（shigure2）を連合艦隊から外して控えへ、浜波改（hamanami）を第六艦隊へ。利根改二（tone）は控え
 */
const REPLACED: AssignmentMap = {
  ...Object.fromEntries(Object.entries(summer2026Assignments).filter(([uid]) => uid !== "shigure2")),
  hamanami: "sixth",
};

/** 確認用：同じページの別の部品（設定の読み込みなど）として、共有の札割りのデータの割り当てを next で丸ごと置き換えるボタン */
function PlanReplacer({ next }: { next: AssignmentMap }): ReactNode {
  const state = useLatestDefinition();
  const definition = state.status === "success" ? state.definition : null;
  const plan = usePlanData(definition?.event.id ?? null, definition?.fudas.map((fuda) => fuda.id) ?? []);
  return (
    <button type="button" disabled={plan.status !== "ready"} onClick={() => void plan.setAssignments(next)}>
      {PROBE_REPLACE}
    </button>
  );
}

/** ヘッダーの「元に戻す」 */
function getUndoButton(): HTMLElement {
  return screen.getByRole("button", { name: "元に戻す" });
}

/** 外から置き換えた割り当て（REPLACED）を表示していることを確かめる（利根改二は控えにいる前提） */
async function expectReplacedShown(): Promise<void> {
  // 時雨改二は控えへ（連合艦隊から外れる）、浜波改は第六艦隊へ
  await waitFor(() => expect(getCard(getTray(), "時雨改二")).toBeInTheDocument());
  expect(queryCard(getColumn("連合艦隊"), "時雨改二")).toBeNull();
  expect(getColumn("連合艦隊")).toHaveTextContent(shipCountPattern(7));
  expect(getCard(getColumn("第六艦隊"), "浜波改")).toBeInTheDocument();
  expect(getCard(getTray(), "利根改二")).toBeInTheDocument();
  expect(queryCard(getColumn("連合艦隊"), "利根改二")).toBeNull();
}

/** 読み込み中を出していて、中身・取り込みの案内・警告を出していないことを確かめる */
function expectLoadingOnly(): void {
  expect(screen.getByRole("heading", { level: 1, name: "割り振り" })).toBeInTheDocument();
  expect(screen.getByText(LOADING)).toBeInTheDocument();
  expect(queryTray()).not.toBeInTheDocument();
  expect(screen.queryByText(/取り込んでいません/)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
}

// ---- テスト ----

describe("割り振りの画面（/assign）", () => {
  describe("読み込み中", () => {
    it("公開定義の読み込み中は「読み込み中」を出し、中身・取り込みの案内・警告を出さない", async () => {
      // 準備：公開定義の応答を待たせる
      await seedPlan(storage);
      const held = holdResponder();
      respondByPath(fetchMock, { ...latestDataResponders(), [LATEST_DEFINITION_PATH]: held.responder });

      // 実行
      renderAssignPage();
      await waitFor(() => expect(requestedPaths(fetchMock)).toContain(LATEST_DEFINITION_PATH));

      // 検証
      expectLoadingOnly();

      // 実行・検証：応答が来たら中身を出す
      held.release(() => textResponse(JSON.stringify(summer2026Definition)));
      expect(await waitForReady()).toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });

    it("艦船マスタの読み込み中は「読み込み中」を出し、中身・取り込みの案内・警告を出さない", async () => {
      // 準備：艦船マスタの応答を待たせる
      await seedPlan(storage);
      const held = holdResponder();
      respondByPath(fetchMock, { ...latestDataResponders(), [SHIP_MASTER_PATH]: held.responder });

      // 実行
      renderAssignPage();
      await waitFor(() => expect(requestedPaths(fetchMock)).toContain(SHIP_MASTER_PATH));

      // 検証
      expectLoadingOnly();

      // 実行・検証：応答が来たら中身を出す
      held.release(() => textResponse(JSON.stringify(shipMasterFileOf())));
      expect(await waitForReady()).toBeInTheDocument();
    });

    it("札割りのデータ（取り込んだ艦・割り当て）の読み込み中は「読み込み中」を出し、中身・取り込みの案内・警告を出さない", async () => {
      // 準備：保存先の読み取りを待たせる
      await seedPlan(storage);
      const held = holdPlanLoading(storage);
      resetPlanDataCache({ storage: held.storage });

      // 実行
      renderAssignPage();
      await waitFor(() => expect(held.wasRequested()).toBe(true));

      // 検証
      expectLoadingOnly();

      // 実行・検証：読み終えたら中身を出す
      held.release();
      expect(await waitForReady()).toBeInTheDocument();
    });
  });

  describe("読み込みの失敗", () => {
    it("公開定義を読み込めなければ、警告に「イベントの定義を読み込めませんでした」・理由・次の行動を出し、中身と「読み込み中」を出さない", async () => {
      // 準備：公開定義は 404
      await seedPlan(storage);
      respondByPath(fetchMock, { [SHIP_MASTER_PATH]: latestDataResponders()[SHIP_MASTER_PATH] });

      // 実行
      renderAssignPage();

      // 検証
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("イベントの定義を読み込めませんでした");
      expect(alert).toHaveTextContent("404");
      expect(alert).toHaveTextContent(RELOAD_ADVICE);
      expect(queryTray()).not.toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });

    it("艦船マスタを読み込めなければ、警告に「艦船マスタを読み込めませんでした」・理由（404）・次の行動を出し、中身と「読み込み中」を出さない", async () => {
      // 準備：艦船マスタは 404
      await seedPlan(storage);
      respondByPath(fetchMock, { [LATEST_DEFINITION_PATH]: latestDataResponders()[LATEST_DEFINITION_PATH] });

      // 実行
      renderAssignPage();

      // 検証
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("艦船マスタを読み込めませんでした");
      expect(alert).toHaveTextContent("404");
      expect(alert).toHaveTextContent(RELOAD_ADVICE);
      expect(queryTray()).not.toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });

    it("ブラウザ内の保存を読めなければ、警告に「札割りのデータを読み込めませんでした」（理由）と次の行動を出し、中身と「読み込み中」を出さない", async () => {
      // 準備：どの操作も失敗する保存先（IndexedDB を使えないブラウザの代わり）
      resetPlanDataCache({ storage: failingStorage() });

      // 実行
      renderAssignPage();

      // 検証
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("札割りのデータを読み込めませんでした");
      expect(alert).toHaveTextContent(RELOAD_ADVICE);
      expect(queryTray()).not.toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });
  });

  describe("取り込んでいないとき", () => {
    it("艦娘を取り込んでいなければ、そのことと取り込みの画面（/import）への案内を出し、中身・「読み込み中」・警告を出さない", async () => {
      // 準備：何も保存していない

      // 実行
      renderAssignPage();

      // 検証
      expect(await screen.findByText(/艦娘を取り込んでいません/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /取り込み/ })).toHaveAttribute("href", "/import");
      expect(screen.getByRole("heading", { level: 1, name: "割り振り" })).toBeInTheDocument();
      expect(queryTray()).not.toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("艦娘を取り込んでいなければ、艦船マスタ（/data/ship-master.json）を取得しない（取り込む前の人にマスタを配らない）", async () => {
      // 準備：何も保存していない

      // 実行：取り込みの案内が出るまで待つ（公開定義と札割りのデータは読み終えている）
      renderAssignPage();
      expect(await screen.findByText(/艦娘を取り込んでいません/)).toBeInTheDocument();

      // 検証：公開定義だけを取得し、艦船マスタは取得しない
      expect(requestedPaths(fetchMock)).toContain(LATEST_DEFINITION_PATH);
      expect(requestedPaths(fetchMock)).not.toContain(SHIP_MASTER_PATH);
    });
  });

  describe("読み込めたとき", () => {
    it("取り込んだ艦と保存した割り当てで中身を出す（控え 11 / 12隻、連合艦隊 8隻）。「読み込み中」・警告・取り込みの案内は出さない", async () => {
      // 準備
      await seedPlan(storage);

      // 実行
      renderAssignPage();

      // 検証
      const tray = await waitForReady();
      expect(tray).toHaveTextContent(trayCountPattern(11, 12));
      expect(getColumn("連合艦隊")).toHaveTextContent(shipCountPattern(8));
      expect(getCard(getColumn("連合艦隊"), "時雨改二")).toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(/取り込んでいません/)).not.toBeInTheDocument();
    });

    it("取得するのは公開定義と艦船マスタの静的ファイルだけ（ほかへは通信しない）", async () => {
      // 準備
      await seedPlan(storage);

      // 実行
      renderAssignPage();
      await waitForReady();

      // 検証：取り込んだ艦や割り当てを外へ送らない（要件 5 章）
      expect(new Set(requestedPaths(fetchMock))).toEqual(new Set([LATEST_DEFINITION_PATH, SHIP_MASTER_PATH]));
    });
  });

  describe("割り当ての保存", () => {
    it("置いた割り当てはブラウザ内に保存され、画面を開き直しても残る", async () => {
      // 準備
      await seedPlan(storage);
      const { user, unmount } = renderAssignPage();
      await waitForReady();

      // 実行
      await placeToneOnRengo(user);

      // 検証：保存先に入った
      const moved = { ...summer2026Assignments, tone: "rengo" };
      await waitFor(async () => expect(await storage.loadAssignments(EVENT_ID)).toEqual(moved));

      // 実行：開き直す
      await reopenAssignPage(unmount);

      // 検証：利根改二は連合艦隊のまま（控えにはいない）
      expect(getCard(getColumn("連合艦隊"), "利根改二")).toBeInTheDocument();
      expect(queryCard(getTray(), "利根改二")).toBeNull();
      expect(getColumn("連合艦隊")).toHaveTextContent(shipCountPattern(9));
    });

    it("置いた割り当ては、同じページの別の部品が使う札割りのデータ（usePlanData）にも入る（一覧などへ移っても古い割り当てを見せない）", async () => {
      // 準備
      await seedPlan(storage);
      const user = userEvent.setup();
      render(
        <>
          <AssignPage />
          <PlanProbe />
        </>,
      );
      await waitForReady();
      expect(screen.getByText("確認用：利根改二→控え")).toBeInTheDocument();

      // 実行
      await placeToneOnRengo(user);

      // 検証
      expect(await screen.findByText("確認用：利根改二→rengo")).toBeInTheDocument();
    });

    it("「元に戻す」で戻した割り当ても保存される", async () => {
      // 準備：置いて、保存されるまで待つ
      await seedPlan(storage);
      const { user } = renderAssignPage();
      await waitForReady();
      await placeToneOnRengo(user);
      await waitFor(async () =>
        expect(await storage.loadAssignments(EVENT_ID)).toEqual({ ...summer2026Assignments, tone: "rengo" }),
      );

      // 実行
      await user.click(screen.getByRole("button", { name: "元に戻す" }));

      // 検証
      await waitFor(async () => expect(await storage.loadAssignments(EVENT_ID)).toEqual(summer2026Assignments));
      expect(getCard(getTray(), "利根改二")).toBeInTheDocument();
    });

    it("保存に失敗したら「保存できませんでした」を出し、画面の割り当ては変えたまま", async () => {
      // 準備：割り当ての保存を失敗させる（準備の保存の後から）
      await seedPlan(storage);
      vi.spyOn(storage, "saveAssignments").mockRejectedValue(new Error("QuotaExceededError"));
      const { user } = renderAssignPage();
      await waitForReady();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // 実行
      await placeToneOnRengo(user);

      // 検証
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("保存できませんでした");
      expect(getCard(getColumn("連合艦隊"), "利根改二")).toBeInTheDocument();
    });
  });

  describe("共有の札割りのデータが外から置き換えられたとき（PR-14：T4-2 の点検の B1）", () => {    it("画面を開いたまま共有の割り当てが外から置き換えられたら、新しい割り当てを表示し、「元に戻す」の履歴を捨てる（押せなくする）", async () => {
      // 準備：この画面で利根改二を連合艦隊に置き（「元に戻す」を押せる）、保存されるまで待つ
      await seedPlan(storage);
      const user = userEvent.setup();
      render(
        <>
          <AssignPage />
          <PlanReplacer next={REPLACED} />
        </>,
      );
      await waitForReady();
      await placeToneOnRengo(user);
      await waitFor(async () =>
        expect(await storage.loadAssignments(EVENT_ID)).toEqual({ ...summer2026Assignments, tone: "rengo" }),
      );
      expect(getUndoButton()).toBeEnabled();

      // 実行：ほかの部品（設定の読み込みなど）が割り当てを丸ごと置き換える
      await user.click(screen.getByRole("button", { name: PROBE_REPLACE }));

      // 検証：置き換えた割り当てを表示する（この画面で置いた利根改二も控えに戻る）。「元に戻す」は押せない
      await expectReplacedShown();
      expect(getUndoButton()).toBeDisabled();
    });

    it("外から置き換えられた後の次の操作は、新しい割り当ての上に重ねて保存する（読み込んだ内容を消さない）。「元に戻す」は置き換えた割り当てまで戻す", async () => {
      // 準備：開いた後に、ほかの部品が割り当てを置き換え、保存されるまで待つ
      await seedPlan(storage);
      const user = userEvent.setup();
      render(
        <>
          <AssignPage />
          <PlanReplacer next={REPLACED} />
        </>,
      );
      await waitForReady();
      await user.click(screen.getByRole("button", { name: PROBE_REPLACE }));
      await waitFor(async () => expect(await storage.loadAssignments(EVENT_ID)).toEqual(REPLACED));
      await expectReplacedShown();

      // 実行：利根改二をウルシー攻撃部隊に置く
      await user.click(getCard(getTray(), "利根改二"));
      await user.click(within(getPanel()).getByRole("button", { name: "ウルシー攻撃部隊に置く" }));

      // 検証：置き換えた割り当てに 1 手を足したものを保存する（時雨改二は控え・浜波改は第六艦隊のまま）
      await waitFor(async () =>
        expect(await storage.loadAssignments(EVENT_ID)).toEqual({ ...REPLACED, tone: "ulithi" }),
      );
      expect(getCard(getTray(), "時雨改二")).toBeInTheDocument();
      expect(getCard(getColumn("第六艦隊"), "浜波改")).toBeInTheDocument();

      // 実行：元に戻す
      await user.click(getUndoButton());

      // 検証：置き換えた割り当てに戻り（置き換える前の割り当てには戻らない）、それ以上は戻せない
      await waitFor(async () => expect(await storage.loadAssignments(EVENT_ID)).toEqual(REPLACED));
      await expectReplacedShown();
      expect(getUndoButton()).toBeDisabled();
    });

    it("設定のウィンドウで札割りのファイルを読み込んで置き換えたら、閉じた後の割り振りの画面は読み込んだ割り当てを表示し、次の操作はその上に重ねて保存する", async () => {
      // 準備：割り振りの画面と設定のウィンドウ（全画面で 1 つ）を描き、利根改二を連合艦隊に置いておく
      await seedPlan(storage);
      const user = userEvent.setup();
      render(
        <>
          <AssignPage />
          <SettingsDialog>
            <SettingsContent />
          </SettingsDialog>
        </>,
      );
      await waitForReady();
      await placeToneOnRengo(user);
      await waitFor(async () =>
        expect(await storage.loadAssignments(EVENT_ID)).toEqual({ ...summer2026Assignments, tone: "rengo" }),
      );

      // 実行：設定のウィンドウを開き、REPLACED の札割りのファイルを読み込んで「置き換える」、ウィンドウを閉じる
      act(() => {
        openSettingsDialog();
      });
      const dialog = await screen.findByRole("dialog", { name: "設定" });
      const fileInput = await within(dialog).findByLabelText(/読み込む/);
      await waitFor(() => expect(fileInput).toBeEnabled());
      const file = new File([serializePlanFile(EVENT_ID, REPLACED)], "fudawari-plan.json", { type: "application/json" });
      await user.upload(fileInput, file);
      const confirm = await screen.findByRole("alertdialog");
      await user.click(within(confirm).getByRole("button", { name: /置き換える/ }));
      await waitFor(async () => expect(await storage.loadAssignments(EVENT_ID)).toEqual(REPLACED));
      act(() => {
        closeSettingsDialog();
      });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "設定" })).not.toBeInTheDocument());

      // 検証：読み込んだ割り当てを表示し、「元に戻す」は押せない
      await expectReplacedShown();
      expect(getUndoButton()).toBeDisabled();

      // 実行：次の操作（利根改二をウルシー攻撃部隊に置く）
      await user.click(getCard(getTray(), "利根改二"));
      await user.click(within(getPanel()).getByRole("button", { name: "ウルシー攻撃部隊に置く" }));

      // 検証：読み込んだ割り当てに 1 手を足したものを保存する
      await waitFor(async () =>
        expect(await storage.loadAssignments(EVENT_ID)).toEqual({ ...REPLACED, tone: "ulithi" }),
      );
    });
  });

  describe("定義から消えた札の割り当て（U17）", () => {
    it("定義にない札に置いていた割り当てを控えに戻したら、その件数を控えの一覧より上に知らせ、開き直すと（戻すものがないので）知らせない", async () => {
      // 準備：利根改二と日向改二を、定義から消えた札に置いておく
      await seedPlan(storage, { ...summer2026Assignments, tone: "removed-fuda", hyuga: "removed-fuda" });
      const { unmount } = renderAssignPage();
      const tray = await waitForReady();

      // 検証：2 件を知らせ、2 隻は控えにいる
      const notice = await screen.findByText(/控えに戻しました/);
      expect(notice).toHaveTextContent(/(?<!\d)2\s*件/);
      expectInDocumentOrder([notice, within(tray).getByRole("searchbox", { name: "図鑑ID・名称で検索" })]);
      expect(getCard(getTray(), "利根改二")).toBeInTheDocument();
      expect(getCard(getTray(), "日向改二")).toBeInTheDocument();

      // 実行：開き直す
      await reopenAssignPage(unmount);

      // 検証：もう知らせない（一度だけ）
      expect(screen.queryByText(/控えに戻しました/)).not.toBeInTheDocument();
    });

    it("控えに戻した件数を知らせたら、共有の札割りのデータ（usePlanData）の件数を 0 に戻す（知らせ終えた）。この画面にいる間は知らせを出したまま", async () => {
      // 準備：利根改二と日向改二を、定義から消えた札に置いておく
      await seedPlan(storage, { ...summer2026Assignments, tone: "removed-fuda", hyuga: "removed-fuda" });
      render(
        <>
          <AssignPage />
          <ReturnedProbe />
        </>,
      );
      await waitForReady();
      expect(await screen.findByText(/控えに戻しました/)).toHaveTextContent(/(?<!\d)2\s*件/);

      // 検証：共有の札割りのデータでは知らせ終えた（0 件）
      await waitFor(() => expect(screen.getByText(/確認用：控えに戻した件数/)).toHaveTextContent("確認用：控えに戻した件数→0"));
      // 検証：この画面の知らせは消さない
      expect(screen.getByText(/控えに戻しました/)).toHaveTextContent(/(?<!\d)2\s*件/);
    });

    it("知らせた後に、共有の札割りのデータを捨てずに割り振りの画面を外して描き直しても、同じ知らせは出さない（一度だけ）", async () => {
      // 準備：利根改二と日向改二を、定義から消えた札に置いておき、知らせが出るまで進める
      await seedPlan(storage, { ...summer2026Assignments, tone: "removed-fuda", hyuga: "removed-fuda" });
      const { unmount } = renderAssignPage();
      await waitForReady();
      expect(await screen.findByText(/控えに戻しました/)).toHaveTextContent(/(?<!\d)2\s*件/);

      // 実行：画面を外して描き直す（一覧などへ移って戻ったときと同じ。共有の読み込みの状態〔resetPlanDataCache など〕は捨てない）
      unmount();
      renderAssignPage();
      await waitForReady();

      // 検証：知らせない。2 隻は控えのまま
      expect(screen.queryByText(/控えに戻しました/)).not.toBeInTheDocument();
      expect(getCard(getTray(), "利根改二")).toBeInTheDocument();
      expect(getCard(getTray(), "日向改二")).toBeInTheDocument();
    });

    it("控えに戻した割り当てがなければ知らせない", async () => {
      // 準備
      await seedPlan(storage);

      // 実行
      renderAssignPage();
      await waitForReady();

      // 検証
      expect(screen.queryByText(/控えに戻しました/)).not.toBeInTheDocument();
    });
  });

  describe("設定とのつながり（控えの並び順・表示の初期値）", () => {
    it("設定の「控えの並び順」「控えの表示」（traySort・trayView）を、控えの初期値に使う", async () => {
      // 準備：並び順 Lv・表示 カード を保存しておく
      await seedPlan(storage);
      await storage.saveSettings({ traySort: "lv", trayView: "card" });

      // 実行
      renderAssignPage();
      await waitForReady();

      // 検証
      await waitFor(() =>
        expect(within(getTray()).getByRole("combobox", { name: "並び順" })).toHaveDisplayValue("Lv"),
      );
      const viewGroup = within(getTray()).getByRole("group", { name: "表示の詰め具合" });
      expect(within(viewGroup).getByRole("button", { name: "カード" })).toHaveAttribute("aria-pressed", "true");
      expect(getGroupHeader("Lv 90 以上")).toHaveTextContent(shipCountPattern(4));
    });

    it("設定を保存していなければ、並び順は艦型・表示は一行", async () => {
      // 準備
      await seedPlan(storage);

      // 実行
      renderAssignPage();
      await waitForReady();

      // 検証
      expect(within(getTray()).getByRole("combobox", { name: "並び順" })).toHaveDisplayValue("艦型");
      const viewGroup = within(getTray()).getByRole("group", { name: "表示の詰め具合" });
      expect(within(viewGroup).getByRole("button", { name: "一行" })).toHaveAttribute("aria-pressed", "true");
    });

    it("設定を読めなくても、初期値（艦型・一行）で中身を出す", async () => {
      // 準備：設定の読み取りだけ失敗させる
      await seedPlan(storage);
      vi.spyOn(storage, "loadSettings").mockRejectedValue(new Error("設定を読めません"));

      // 実行
      renderAssignPage();

      // 検証
      await waitForReady();
      expect(within(getTray()).getByRole("combobox", { name: "並び順" })).toHaveDisplayValue("艦型");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("選んだ艦のパネルの「（札名）に置く」でも保存される", async () => {
    // 準備
    await seedPlan(storage);
    const { user } = renderAssignPage();
    await waitForReady();
    await user.click(getCard(getTray(), "利根改二"));

    // 実行
    await user.click(within(getPanel()).getByRole("button", { name: "ウルシー攻撃部隊に置く" }));

    // 検証
    await waitFor(async () =>
      expect(await storage.loadAssignments(EVENT_ID)).toEqual({ ...summer2026Assignments, tone: "ulithi" }),
    );
  });
});
