// 差分の画面（DriftPageContent。roadmap T2-11、要件 3.5、U10・U17・U23）の画面テスト
//
// - 公開定義（/data/latest-definition.json）と艦船マスタ（/data/ship-master.json）の取得は差し替える
//   （src/test/latest-data-fetch.ts でパスごとに振り分ける）。
// - 保存先は fake-indexeddb の上の本物の保存（テストごとに別の DB）を、共有の札割りのデータに渡す（resetPlanDataCache）。
//   反映・元に戻すは、共有の札割りのデータ（usePlanData の setAssignments）を通して保存することを、
//   同じ画面に置いた確認用の部品（PlanProbe）と保存先の中身で確かめる。
// - 判定（4 つの分類・件数・札ごとの進み具合）そのものは src/domain/drift/drift.test.ts で確かめている。
//   ここでは、画面がその結果を要件 3.5 の形で出し、操作で計画が変わることを見る。
// - 部品の探し方（実装の担当向けの公開する形）は src/test/drift-screen.ts の冒頭にまとめてある。
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { type ReactNode, useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { DriftPageContent } from "@/features/drift";
import { LATEST_DEFINITION_PATH, resetLatestDefinitionCache, useLatestDefinition } from "@/lib/definition";
import { resetPlanDataCache, usePlanData } from "@/lib/plan";
import { resetShipMasterCache, SHIP_MASTER_PATH } from "@/lib/ship-master";
import type { FudawariStorage } from "@/lib/storage";
import { type FetchMock, requestedPaths, stubFetch, textResponse } from "@/test/definition-fetch";
import { expectInDocumentOrder } from "@/test/dom-order";
import {
  actualFudaOf,
  bulkApplyLabel,
  getDoneStatus,
  getHeader,
  getIssueCard,
  getProgressItem,
  issueCards,
  issueCardsOf,
  issuesHeadingPattern,
  plannedFudaOf,
  progressItems,
  progressPattern,
  querySummaryList,
  SUMMARY_LABELS,
  summaryCount,
  summaryLabelsInOrder,
} from "@/test/drift-screen";
import {
  cloneSummer2026Definition,
  summer2026Assignments,
  summer2026Definition,
  summer2026Ships,
  unknownShip,
} from "@/test/fixtures";
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

/**
 * 取り込んだ日時（端末の時刻帯で 2026-10-15 20:40）。画面には「10/15 20:40」と出る。
 * 端末の時刻帯に左右されないよう、端末の時刻で作ってから ISO 8601 にする
 */
const IMPORTED_AT = new Date(2026, 9, 15, 20, 40).toISOString();
/** 取り込んだ日時の画面の表示 */
const IMPORTED_AT_TEXT = "10/15 20:40";

/** 読み込み中の表示 */
const LOADING = /読み込み中/;
/** 読み込みに失敗したときに書く次の行動（公開定義の失敗の警告と同じ） */
const RELOAD_ADVICE = "ページを再読み込みしてください";
/** 倍率の表示（「×1.24」など） */
const MULTIPLIER = /×\s*\d/;

/**
 * モック（Drift.dc.html）に近い場面の実際の札（個体 ID → 札番号。ほかの艦は 0＝札なし）。
 * 札番号：第三十一戦隊 1、多号作戦部隊 2、連合艦隊 3、ウルシー攻撃部隊 4、第六艦隊 5。
 * 計画は summer2026Assignments（19 隻。第三十一戦隊 4・多号作戦部隊 3・連合艦隊 8・ウルシー攻撃部隊 3・第六艦隊 1）
 * - 計画と違う札が付いた（2）：長波改二（計画 連合艦隊 → 多号作戦部隊）、北上改二（計画 連合艦隊 → 第三十一戦隊）
 * - 計画にない艦に札が付いた（2）：浜波改（控え → 多号作戦部隊）、あきつ丸改（控え → 第三十一戦隊。特効なし）
 * - 計画どおり（5）：初霜改二・冬月改（第三十一戦隊）、沖波改二（多号作戦部隊）、時雨改二・雪風改二（連合艦隊）
 * - まだ出撃していない（12）：計画の残り
 * - 札ごとの進み具合：第三十一戦隊 2／4、多号作戦部隊 1／3、連合艦隊 2／8、ウルシー攻撃部隊 0／3、第六艦隊 0／1
 */
const MOCK_LIKE_SALLY: Readonly<Record<string, number>> = {
  naganami: 2,
  kitakami: 1,
  hamanami: 2,
  akitsumaru: 1,
  hatsushimo: 1,
  fuyuzuki: 1,
  okinami: 2,
  shigure2: 3,
  yukikaze: 3,
};

/** 対応が必要な一覧の艦名（モックに近い場面）：計画と違う札が付いた艦 */
const MOCK_LIKE_DIFFERENT = ["長波改二", "北上改二"] as const;
/** 対応が必要な一覧の艦名（モックに近い場面）：計画にない艦に札が付いた艦 */
const MOCK_LIKE_UNPLANNED = ["浜波改", "あきつ丸改"] as const;

/** 確認用の部品（PlanProbe）が割り当てを出す個体 */
const PROBED_UIDS = ["naganami", "kitakami", "hamanami", "akitsumaru", "asashimo", "asashimo2", "unknown"] as const;

// ---- 補助 ----

let fetchMock: FetchMock;
/** このテストの保存先（beforeEach で開いて、共有の札割りのデータに渡す） */
let storage: FudawariStorage;

beforeEach(() => {
  resetLatestDefinitionCache();
  resetShipMasterCache();
  storage = openTestStorage("fudawari-drift-test").storage;
  resetPlanDataCache({ storage });
  fetchMock = stubFetch();
  respondWithLatestData(fetchMock);
});

afterEach(async () => {
  // 部品を外してから、共有の読み込みの状態を捨て、差し替えを戻し、DB を消す
  cleanup();
  resetLatestDefinitionCache();
  resetShipMasterCache();
  resetPlanDataCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await cleanupTestStorages();
});

/** 艦の一覧の実際の札（sallyArea）を当てる（sally にない艦は 0＝札なし）。sally の個体 ID の書き間違いは例外にする */
function withSally(ships: readonly OwnedShip[], sally: Readonly<Record<string, number>>): OwnedShip[] {
  for (const uid of Object.keys(sally)) {
    if (!ships.some((ship) => ship.uid === uid)) throw new Error(`テスト用データに個体 ${uid} がありません`);
  }
  return ships.map((ship) => ({ ...ship, sallyArea: sally[ship.uid] ?? 0 }));
}

/** 割り当てから個体を除いた（控えに戻した）割り当て */
function withoutUid(assignments: AssignmentMap, uid: string): AssignmentMap {
  return Object.fromEntries(Object.entries(assignments).filter(([key]) => key !== uid));
}

interface SeedOptions {
  /** 実際の札（既定はモックに近い場面） */
  sally?: Readonly<Record<string, number>>;
  /** 取り込む艦（既定はテスト用の 31 隻） */
  ships?: readonly OwnedShip[];
  /** 計画（既定は summer2026Assignments） */
  assignments?: AssignmentMap;
}

/** 取り込み（実際の札つき。日時は IMPORTED_AT）と、最新イベントの計画を保存しておく */
async function seed(options: SeedOptions = {}): Promise<void> {
  const ships = withSally(options.ships ?? summer2026Ships, options.sally ?? MOCK_LIKE_SALLY);
  await storage.saveImport(importInput(ships, { importedAt: IMPORTED_AT }));
  await storage.saveAssignments(EVENT_ID, options.assignments ?? summer2026Assignments);
}

/** 確認用の部品が出す文の書き出し */
const PROBE = "確認用：";
/** 確認用の部品の、割り当てを外から変えるボタン（北上改二〔kitakami〕をウルシー攻撃部隊へ） */
const PROBE_MOVE_KITAKAMI = "確認用：kitakami を ulithi へ";

/**
 * 確認用：同じ画面の別の部品が使う札割りのデータ（usePlanData）の割り当てを「確認用：個体 ID→札 ID」で出し、
 * 割り当てを外から変えるボタンを持つ（ほかの部品・画面で割り当てを変えた場面を作る）
 */
function PlanProbe(): ReactNode {
  const state = useLatestDefinition();
  const definition = state.status === "success" ? state.definition : null;
  const fudaIds = useMemo(() => definition?.fudas.map((fuda) => fuda.id) ?? [], [definition]);
  const plan = usePlanData(definition?.event.id ?? null, fudaIds);
  if (plan.status !== "ready") return <p>{`${PROBE}${plan.status}`}</p>;
  const { assignments, setAssignments } = plan;
  return (
    <div>
      {PROBED_UIDS.map((uid) => (
        <p key={uid}>{`${PROBE}${uid}→${assignments[uid] ?? "控え"}`}</p>
      ))}
      <button type="button" onClick={() => void setAssignments((prev) => ({ ...prev, kitakami: "ulithi" }))}>
        {PROBE_MOVE_KITAKAMI}
      </button>
    </div>
  );
}

/** 差分の画面（と確認用の部品）を描く */
function renderDrift(): { user: UserEvent } {
  const user = userEvent.setup();
  render(
    <>
      <DriftPageContent />
      <PlanProbe />
    </>,
  );
  return { user };
}

/** 中身（件数のまとめ）が出るまで待つ */
async function waitForReady(): Promise<void> {
  await screen.findByRole("list", { name: "件数のまとめ" });
}

/** 保存先の最新イベントの割り当てが expected になるまで待つ */
async function expectSaved(expected: AssignmentMap): Promise<void> {
  await waitFor(async () => {
    expect(await storage.loadAssignments(EVENT_ID)).toEqual(expected);
  });
}

/** 1 件の中のボタンを押す */
async function clickInCard(user: UserEvent, shipName: string, buttonName: string): Promise<void> {
  await user.click(within(getIssueCard(shipName)).getByRole("button", { name: buttonName }));
}

/** 反映後の文（「n件を計画に反映しました」）を出していないことを確かめる */
function expectNoDoneMessage(): void {
  expect(screen.queryByText(/件を計画に反映しました/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "元に戻す" })).not.toBeInTheDocument();
}

/** まとめての確認を開いて返す */
async function openBulk(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: "計画をまとめて実際に合わせる" }));
  return screen.findByRole("alertdialog");
}

/** 読み込み中を出していて、中身・取り込みの案内・警告を出していないことを確かめる */
function expectLoadingOnly(): void {
  expect(screen.getByRole("heading", { level: 1, name: "計画と実際の札" })).toBeInTheDocument();
  expect(screen.getByText(LOADING)).toBeInTheDocument();
  expect(querySummaryList()).not.toBeInTheDocument();
  expect(screen.queryByText(/取り込んでいません/)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
}

// ---- テスト ----

describe("差分の画面（DriftPageContent）", () => {
  describe("読み込み中", () => {
    it("公開定義の読み込み中は「読み込み中」を出し、中身・取り込みの案内・警告を出さない。応答が来たら中身を出す", async () => {
      // 準備：公開定義の応答を待たせる
      await seed();
      const held = holdResponder();
      respondByPath(fetchMock, { ...latestDataResponders(), [LATEST_DEFINITION_PATH]: held.responder });

      // 実行
      renderDrift();
      await waitFor(() => expect(requestedPaths(fetchMock)).toContain(LATEST_DEFINITION_PATH));

      // 検証
      expectLoadingOnly();

      // 実行・検証：応答が来たら中身を出す
      held.release(() => textResponse(JSON.stringify(summer2026Definition)));
      await waitForReady();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });

    it("札割りのデータ（取り込んだ艦・割り当て）の読み込み中は「読み込み中」を出す。読み終えたら中身を出す", async () => {
      // 準備：保存先の取り込んだ艦の読み取りを待たせる
      await seed();
      let open: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      let requested = false;
      const held: FudawariStorage = {
        ...storage,
        async loadShips() {
          requested = true;
          await gate;
          return storage.loadShips();
        },
      };
      resetPlanDataCache({ storage: held });

      // 実行
      renderDrift();
      await waitFor(() => expect(requested).toBe(true));

      // 検証
      expectLoadingOnly();

      // 実行・検証：読み終えたら中身を出す
      open();
      await waitForReady();
    });

    it("艦船マスタの読み込み中は「読み込み中」を出す。応答が来たら中身を出す", async () => {
      // 準備：艦船マスタの応答を待たせる
      await seed();
      const held = holdResponder();
      respondByPath(fetchMock, { ...latestDataResponders(), [SHIP_MASTER_PATH]: held.responder });

      // 実行
      renderDrift();
      await waitFor(() => expect(requestedPaths(fetchMock)).toContain(SHIP_MASTER_PATH));

      // 検証
      expectLoadingOnly();

      // 実行・検証
      held.release(() => textResponse(JSON.stringify(shipMasterFileOf())));
      await waitForReady();
    });
  });

  describe("読み込みの失敗", () => {
    it("公開定義を読み込めなければ、警告（1 つだけ）に「イベントの定義を読み込めませんでした」・理由・次の行動を出し、中身と「読み込み中」を出さない", async () => {
      // 準備：公開定義は 404（艦船マスタは返す）
      await seed();
      respondByPath(fetchMock, { [SHIP_MASTER_PATH]: latestDataResponders()[SHIP_MASTER_PATH] });

      // 実行
      renderDrift();

      // 検証
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("イベントの定義を読み込めませんでした");
      expect(alert).toHaveTextContent("404");
      expect(alert).toHaveTextContent(RELOAD_ADVICE);
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 1, name: "計画と実際の札" })).toBeInTheDocument();
      expect(querySummaryList()).not.toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });

    it("ブラウザ内の保存を読めなければ、警告に「札割りのデータを読み込めませんでした」・理由・次の行動を出し、中身と「読み込み中」を出さない", async () => {
      // 準備：どの操作も失敗する保存先（IndexedDB を使えないブラウザの代わり）
      resetPlanDataCache({ storage: failingStorage() });

      // 実行
      renderDrift();

      // 検証
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("札割りのデータを読み込めませんでした");
      expect(alert).toHaveTextContent("ブラウザ内の保存");
      expect(alert).toHaveTextContent(RELOAD_ADVICE);
      expect(querySummaryList()).not.toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });

    it("艦船マスタを読み込めなければ、警告に「艦船マスタを読み込めませんでした」・理由（404）・次の行動を出し、中身と「読み込み中」を出さない", async () => {
      // 準備：艦船マスタは 404（公開定義は返す）
      await seed();
      respondByPath(fetchMock, { [LATEST_DEFINITION_PATH]: latestDataResponders()[LATEST_DEFINITION_PATH] });

      // 実行
      renderDrift();

      // 検証
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("艦船マスタを読み込めませんでした");
      expect(alert).toHaveTextContent("404");
      expect(alert).toHaveTextContent(RELOAD_ADVICE);
      expect(querySummaryList()).not.toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });
  });

  describe("取り込んでいないとき", () => {
    it("「取り込んでいません」の案内と取り込みの画面（/import）へのリンクを出し、件数のまとめ・比べている日時を出さず、艦船マスタを取得しない", async () => {
      // 準備：取り込みも割り当てもない保存先

      // 実行
      renderDrift();

      // 検証
      expect(await screen.findByText(/取り込んでいません/)).toBeInTheDocument();
      const importLinks = screen.getAllByRole("link").filter((link) => link.getAttribute("href") === "/import");
      expect(importLinks.length, "取り込みの画面へのリンクがあること").toBeGreaterThanOrEqual(1);
      expect(querySummaryList()).not.toBeInTheDocument();
      expect(screen.queryByText(/取り込んだ札の状態と、計画を比べています/)).not.toBeInTheDocument();
      expect(requestedPaths(fetchMock)).not.toContain(SHIP_MASTER_PATH);
    });
  });

  describe("ヘッダー", () => {
    it("画面名・最新イベント名・「10/15 20:40 に取り込んだ札の状態と、計画を比べています」・リンク「最新の状態を取り込む」（/import）を出す", async () => {
      // 準備
      await seed();

      // 実行
      renderDrift();
      await waitForReady();

      // 検証
      const header = getHeader();
      expect(within(header).getByText("2026夏イベ")).toBeInTheDocument();
      expect(header).toHaveTextContent(
        new RegExp(`${IMPORTED_AT_TEXT}\\s*に取り込んだ札の状態と、計画を比べています`),
      );
      expect(within(header).getByRole("link", { name: "最新の状態を取り込む" })).toHaveAttribute("href", "/import");
    });
  });

  describe("件数のまとめと対応が必要な一覧", () => {
    it("件数のまとめを要件 3.5 の順に 4 つ出す（計画と違う札 2・計画にない艦 2・計画どおり 5・まだ出撃していない 12）", async () => {
      // 準備
      await seed();

      // 実行
      renderDrift();
      await waitForReady();

      // 検証
      expect(summaryLabelsInOrder()).toEqual([...SUMMARY_LABELS]);
      expect(summaryCount("計画と違う札が付いた")).toBe(2);
      expect(summaryCount("計画にない艦に札が付いた")).toBe(2);
      expect(summaryCount("計画どおり")).toBe(5);
      expect(summaryCount("まだ出撃していない")).toBe(12);
    });

    it("見出し「対応が必要 4件」と、計画と違う札が付いた艦 → 計画にない艦に札が付いた艦の順に 1 件ずつ出す（各分類の中の順は問わない）", async () => {
      // 準備
      await seed();

      // 実行
      renderDrift();
      await waitForReady();

      // 検証
      expect(screen.getByRole("heading", { name: issuesHeadingPattern(4) })).toBeInTheDocument();
      const all = [...MOCK_LIKE_DIFFERENT, ...MOCK_LIKE_UNPLANNED];
      const names = issueCards().map((card) => all.find((name) => card.textContent?.includes(name)) ?? card.textContent);
      expect(names).toHaveLength(4);
      expect([...names.slice(0, 2)].sort()).toEqual([...MOCK_LIKE_DIFFERENT].sort());
      expect([...names.slice(2)].sort()).toEqual([...MOCK_LIKE_UNPLANNED].sort());
    });

    it("計画と違う札が付いた艦は、計画の札（取り消し線）→ 実際の札、計画の札での特効（E2 ゲージ3 ×1.24）、「代わりの艦を探す」（/assign）と「計画を実際に合わせる」を出す", async () => {
      // 準備
      await seed();

      // 実行
      renderDrift();
      await waitForReady();

      // 検証：長波改二（計画 連合艦隊 → 多号作戦部隊。連合艦隊では E2 ゲージ2 ×1.19・E2 ゲージ3 ×1.24）
      const card = getIssueCard("長波改二");
      const planned = plannedFudaOf(card);
      expect(planned).toHaveTextContent("連合艦隊");
      expectInDocumentOrder([planned, actualFudaOf(card, "多号作戦部隊")]);
      expect(card).toHaveTextContent(/E2 ゲージ3\s*×\s*1\.24/);
      expect(within(card).getByRole("button", { name: "計画を実際に合わせる" })).toBeEnabled();
      expect(within(card).getByRole("link", { name: "代わりの艦を探す" })).toHaveAttribute("href", "/assign");
      expect(within(card).queryByRole("button", { name: "計画に追加する" })).not.toBeInTheDocument();

      // 検証：北上改二（計画 連合艦隊 → 第三十一戦隊。連合艦隊では E2 ゲージ3 ×1.18）
      const kitakami = getIssueCard("北上改二");
      expect(plannedFudaOf(kitakami)).toHaveTextContent("連合艦隊");
      expectInDocumentOrder([plannedFudaOf(kitakami), actualFudaOf(kitakami, "第三十一戦隊")]);
      expect(kitakami).toHaveTextContent(/E2 ゲージ3\s*×\s*1\.18/);
    });

    it("計画にない艦に札が付いた艦は、「札なし（計画外）」（取り消し線）→ 実際の札、実際の札での特効（E2 ゲージ1 輸送 ×1.24）、「計画に追加する」だけを出す", async () => {
      // 準備
      await seed();

      // 実行
      renderDrift();
      await waitForReady();

      // 検証：浜波改（控え → 多号作戦部隊）
      const card = getIssueCard("浜波改");
      const planned = plannedFudaOf(card);
      expect(planned).toHaveTextContent("札なし（計画外）");
      expectInDocumentOrder([planned, actualFudaOf(card, "多号作戦部隊")]);
      expect(card).toHaveTextContent(/E2 ゲージ1 輸送\s*×\s*1\.24/);
      expect(within(card).getByRole("button", { name: "計画に追加する" })).toBeEnabled();
      expect(within(card).queryByRole("button", { name: "計画を実際に合わせる" })).not.toBeInTheDocument();
      expect(within(card).queryByRole("link", { name: "代わりの艦を探す" })).not.toBeInTheDocument();
    });

    it("特効のない艦（あきつ丸改）の説明には倍率を書かない", async () => {
      // 準備
      await seed();

      // 実行
      renderDrift();
      await waitForReady();

      // 検証
      const card = getIssueCard("あきつ丸改");
      expect(plannedFudaOf(card)).toHaveTextContent("札なし（計画外）");
      expect(card.textContent ?? "").not.toMatch(MULTIPLIER);
    });

    it("定義のどの札番号にも当たらない札が付いた計画の艦は、実際の札を「定義にない札（番号 9）」とし、反映すると控えに戻ることを書く", async () => {
      // 準備：長波改二（計画 連合艦隊）に、定義にない札番号 9 が付いている
      await seed({ sally: { naganami: 9 } });

      // 実行
      renderDrift();
      await waitForReady();

      // 検証
      const card = getIssueCard("長波改二");
      expect(plannedFudaOf(card)).toHaveTextContent("連合艦隊");
      expect(card).toHaveTextContent(/定義にない札（番号\s*9）/);
      expect(card).toHaveTextContent(/控えに戻/);
      expect(within(card).getByRole("button", { name: "計画を実際に合わせる" })).toBeEnabled();
      expect(summaryCount("計画と違う札が付いた")).toBe(1);
    });

    it("艦船マスタにない艦は「名前が分からない艦」として出す", async () => {
      // 準備：マスタにない艦（控え）に第三十一戦隊の札が付いている
      await seed({ ships: [...summer2026Ships, unknownShip], sally: { unknown: 1 } });

      // 実行
      renderDrift();
      await waitForReady();

      // 検証
      const card = getIssueCard("名前が分からない艦");
      expect(plannedFudaOf(card)).toHaveTextContent("札なし（計画外）");
      expect(within(card).getByRole("button", { name: "計画に追加する" })).toBeEnabled();
    });

    it("対応が必要なものがなければ「対応が必要なものはありません」を出し、1 件ずつの表示と「計画をまとめて実際に合わせる」を出さない", async () => {
      // 準備：計画どおりの艦と、まだ出撃していない艦だけ
      await seed({ sally: { hatsushimo: 1, okinami: 2 } });

      // 実行
      renderDrift();
      await waitForReady();

      // 検証
      expect(screen.getByText("対応が必要なものはありません")).toBeInTheDocument();
      expect(issueCards()).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "計画をまとめて実際に合わせる" })).not.toBeInTheDocument();
      expect(summaryCount("計画どおり")).toBe(2);
    });

    it("対応が必要なものが 1 件だけなら「計画をまとめて実際に合わせる」を出さない", async () => {
      // 準備
      await seed({ sally: { naganami: 2 } });

      // 実行
      renderDrift();
      await waitForReady();

      // 検証
      expect(issueCards()).toHaveLength(1);
      expect(screen.queryByText("対応が必要なものはありません")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "計画をまとめて実際に合わせる" })).not.toBeInTheDocument();
    });

    it("対応が必要なものが 2 件以上なら「計画をまとめて実際に合わせる」を出す", async () => {
      // 準備
      await seed();

      // 実行
      renderDrift();
      await waitForReady();

      // 検証
      expect(screen.getByRole("button", { name: "計画をまとめて実際に合わせる" })).toBeEnabled();
    });
  });

  describe("札ごとの進み具合", () => {
    it("定義の札の順に、札ごとに「札付き n ／ 計画 m隻」を出す", async () => {
      // 準備
      await seed();

      // 実行
      renderDrift();
      await waitForReady();

      // 検証
      const fudaNames = summer2026Definition.fudas.map((fuda) => fuda.name);
      expect(
        progressItems().map((item) => fudaNames.find((name) => item.textContent?.includes(name)) ?? item.textContent),
      ).toEqual(fudaNames);
      expect(getProgressItem("第三十一戦隊")).toHaveTextContent(progressPattern(2, 4));
      expect(getProgressItem("多号作戦部隊")).toHaveTextContent(progressPattern(1, 3));
      expect(getProgressItem("連合艦隊")).toHaveTextContent(progressPattern(2, 8));
      expect(getProgressItem("ウルシー攻撃部隊")).toHaveTextContent(progressPattern(0, 3));
      expect(getProgressItem("第六艦隊")).toHaveTextContent(progressPattern(0, 1));
    });

    it("札番号が未入力の札は「札番号が未入力」と出し、その札に置いた艦は差分の対象外にする（一覧にも件数にも入れない。U10）", async () => {
      // 準備：第三十一戦隊の札番号を未入力にする。初霜改二（計画 第三十一戦隊）に連合艦隊の札が付いている
      const definition = cloneSummer2026Definition();
      definition.fudas[0].gameNumber = null;
      respondWithLatestData(fetchMock, { definition });
      await seed({ sally: { hatsushimo: 3 } });

      // 実行
      renderDrift();
      await waitForReady();

      // 検証：第三十一戦隊の 4 隻は対象外。残りの計画 15 隻は「まだ出撃していない」
      const s31 = getProgressItem("第三十一戦隊");
      expect(s31).toHaveTextContent(/札番号が未入力/);
      expect(s31).not.toHaveTextContent(/札付き/);
      expect(getProgressItem("連合艦隊")).toHaveTextContent(progressPattern(0, 8));
      expect(issueCardsOf("初霜改二")).toHaveLength(0);
      expect(screen.getByText("対応が必要なものはありません")).toBeInTheDocument();
      expect(summaryCount("計画と違う札が付いた")).toBe(0);
      expect(summaryCount("まだ出撃していない")).toBe(15);
    });
  });

  describe("1 件ずつの反映", () => {
    it("「計画を実際に合わせる」で計画を実際の札に変えて保存し（共有の札割りのデータにも届く）、一覧・件数・進み具合を計算し直し、「1件を計画に反映しました（長波改二）」と「元に戻す」を出す", async () => {
      // 準備
      await seed();
      const { user } = renderDrift();
      await waitForReady();

      // 実行
      await clickInCard(user, "長波改二", "計画を実際に合わせる");

      // 検証：保存と共有の札割りのデータ
      await expectSaved({ ...summer2026Assignments, naganami: "tago" });
      expect(screen.getByText(`${PROBE}naganami→tago`)).toBeInTheDocument();
      // 検証：計算し直した表示
      expect(issueCardsOf("長波改二")).toHaveLength(0);
      expect(screen.getByRole("heading", { name: issuesHeadingPattern(3) })).toBeInTheDocument();
      expect(summaryCount("計画と違う札が付いた")).toBe(1);
      expect(summaryCount("計画どおり")).toBe(6);
      expect(getProgressItem("多号作戦部隊")).toHaveTextContent(progressPattern(2, 4));
      expect(getProgressItem("連合艦隊")).toHaveTextContent(progressPattern(2, 7));
      // 検証：反映後の文と「元に戻す」
      getDoneStatus(1, ["長波改二"]);
      expect(screen.getByRole("button", { name: "元に戻す" })).toBeEnabled();
    });

    it("「計画に追加する」で、控えの艦を実際の札に置いて保存する", async () => {
      // 準備
      await seed();
      const { user } = renderDrift();
      await waitForReady();

      // 実行
      await clickInCard(user, "浜波改", "計画に追加する");

      // 検証
      await expectSaved({ ...summer2026Assignments, hamanami: "tago" });
      expect(screen.getByText(`${PROBE}hamanami→tago`)).toBeInTheDocument();
      expect(issueCardsOf("浜波改")).toHaveLength(0);
      expect(summaryCount("計画にない艦に札が付いた")).toBe(1);
      getDoneStatus(1, ["浜波改"]);
    });

    it("定義にない札が付いた艦の「計画を実際に合わせる」は、その艦を控えに戻して保存する", async () => {
      // 準備：長波改二（計画 連合艦隊）に、定義にない札番号 9 が付いている
      await seed({ sally: { naganami: 9 } });
      const { user } = renderDrift();
      await waitForReady();

      // 実行
      await clickInCard(user, "長波改二", "計画を実際に合わせる");

      // 検証
      await expectSaved(withoutUid(summer2026Assignments, "naganami"));
      expect(screen.getByText(`${PROBE}naganami→控え`)).toBeInTheDocument();
      expect(issueCards()).toHaveLength(0);
    });

    it("同名艦は別の個体として扱い、押した 1 隻の計画だけを変える", async () => {
      // 準備：朝霜改二が 2 隻。1 隻目（計画 多号作戦部隊）に連合艦隊、2 隻目（控え）に第三十一戦隊の札が付いている
      await seed({ sally: { asashimo: 3, asashimo2: 1 } });
      const { user } = renderDrift();
      await waitForReady();
      const cards = issueCardsOf("朝霜改二");
      expect(cards).toHaveLength(2);
      const unplanned = cards.find((card) => plannedFudaOf(card).textContent?.includes("札なし（計画外）"));
      if (unplanned === undefined) throw new Error("控えの朝霜改二の 1 件がない");

      // 実行
      await user.click(within(unplanned).getByRole("button", { name: "計画に追加する" }));

      // 検証：2 隻目だけが第三十一戦隊に置かれ、1 隻目の計画（多号作戦部隊）は変わらない
      await expectSaved({ ...summer2026Assignments, asashimo2: "s31" });
      expect(screen.getByText(`${PROBE}asashimo→tago`)).toBeInTheDocument();
      expect(issueCardsOf("朝霜改二")).toHaveLength(1);
    });

    it("「元に戻す」で反映前の計画に戻して保存し、その 1 件を一覧に戻し、反映後の文と「元に戻す」を消す", async () => {
      // 準備：長波改二を反映しておく
      await seed();
      const { user } = renderDrift();
      await waitForReady();
      await clickInCard(user, "長波改二", "計画を実際に合わせる");
      await expectSaved({ ...summer2026Assignments, naganami: "tago" });

      // 実行
      await user.click(screen.getByRole("button", { name: "元に戻す" }));

      // 検証
      await expectSaved(summer2026Assignments);
      expect(screen.getByText(`${PROBE}naganami→rengo`)).toBeInTheDocument();
      expect(getIssueCard("長波改二")).toBeInTheDocument();
      expect(summaryCount("計画と違う札が付いた")).toBe(2);
      expectNoDoneMessage();
    });

    it("「元に戻す」で戻せるのは直前の反映 1 回分だけ（前の反映は戻さない）。戻した後は「元に戻す」を出さない", async () => {
      // 準備：長波改二、北上改二の順に反映する
      await seed();
      const { user } = renderDrift();
      await waitForReady();
      await clickInCard(user, "長波改二", "計画を実際に合わせる");
      await expectSaved({ ...summer2026Assignments, naganami: "tago" });
      await clickInCard(user, "北上改二", "計画を実際に合わせる");
      await expectSaved({ ...summer2026Assignments, naganami: "tago", kitakami: "s31" });
      getDoneStatus(1, ["北上改二"]);

      // 実行
      await user.click(screen.getByRole("button", { name: "元に戻す" }));

      // 検証：北上改二だけが戻る
      await expectSaved({ ...summer2026Assignments, naganami: "tago" });
      expect(getIssueCard("北上改二")).toBeInTheDocument();
      expect(issueCardsOf("長波改二")).toHaveLength(0);
      expectNoDoneMessage();
    });

    it("ほかの部品が割り当てを変えたら計算し直して表示し、その後の反映でもその変更を消さない（最新の割り当てで反映する）", async () => {
      // 準備
      await seed();
      const { user } = renderDrift();
      await waitForReady();

      // 実行：ほかの部品が北上改二の計画をウルシー攻撃部隊に変える
      await user.click(screen.getByRole("button", { name: PROBE_MOVE_KITAKAMI }));

      // 検証：北上改二の計画の札がウルシー攻撃部隊になる（実際は第三十一戦隊のまま）
      await waitFor(() => expect(plannedFudaOf(getIssueCard("北上改二"))).toHaveTextContent("ウルシー攻撃部隊"));

      // 実行：長波改二を反映する
      await clickInCard(user, "長波改二", "計画を実際に合わせる");

      // 検証：ほかの部品の変更（北上改二 → ウルシー攻撃部隊）が残っている
      await expectSaved({ ...summer2026Assignments, kitakami: "ulithi", naganami: "tago" });
    });

    it("反映の後にほかの部品が割り当てを変えたら、元に戻す記録を捨てる（「元に戻す」を出さない）", async () => {
      // 準備：長波改二を反映しておく
      await seed();
      const { user } = renderDrift();
      await waitForReady();
      await clickInCard(user, "長波改二", "計画を実際に合わせる");
      await expectSaved({ ...summer2026Assignments, naganami: "tago" });
      expect(screen.getByRole("button", { name: "元に戻す" })).toBeInTheDocument();

      // 実行：ほかの部品が割り当てを変える
      await user.click(screen.getByRole("button", { name: PROBE_MOVE_KITAKAMI }));

      // 検証
      await waitFor(() => expect(screen.queryByRole("button", { name: "元に戻す" })).not.toBeInTheDocument());
      await expectSaved({ ...summer2026Assignments, naganami: "tago", kitakami: "ulithi" });
    });

    it("割り当てを保存できなかったら、警告に「保存できませんでした」を出す", async () => {
      // 準備：割り当ての保存だけを失敗させる
      await seed();
      vi.spyOn(storage, "saveAssignments").mockRejectedValue(new Error("保存できない（テスト）"));
      const { user } = renderDrift();
      await waitForReady();

      // 実行
      await clickInCard(user, "長波改二", "計画を実際に合わせる");

      // 検証
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/保存できませんでした/);
    });
  });

  describe("まとめて反映（「計画をまとめて実際に合わせる」）", () => {
    it("確認の枠（role=alertdialog）に説明・1 件ずつのチェック（初期は全部 ON、艦名と「計画 A → B」）・注意書き・「4件を計画に反映する」・「やめる」を出す", async () => {
      // 準備
      await seed();
      const { user } = renderDrift();
      await waitForReady();

      // 実行
      const dialog = await openBulk(user);

      // 検証
      expect(dialog).toHaveTextContent("次の変更を計画に反映します。合わせないものはチェックを外してください");
      expect(dialog).toHaveTextContent(
        "実際に付いた札が正しいものとして計画を書き換えます。札が抜けた枠は空いたままになるので、あとで割り振り画面で埋めてください",
      );
      const boxes = within(dialog).getAllByRole("checkbox");
      expect(boxes).toHaveLength(4);
      for (const box of boxes) expect(box).toBeChecked();
      expect(within(dialog).getByRole("checkbox", { name: /長波改二.*計画\s*連合艦隊\s*→\s*多号作戦部隊/ })).toBeChecked();
      expect(within(dialog).getByRole("checkbox", { name: /北上改二.*計画\s*連合艦隊\s*→\s*第三十一戦隊/ })).toBeChecked();
      expect(
        within(dialog).getByRole("checkbox", { name: /浜波改.*計画\s*札なし（計画外）\s*→\s*多号作戦部隊/ }),
      ).toBeChecked();
      expect(within(dialog).getByRole("checkbox", { name: /あきつ丸改.*→\s*第三十一戦隊/ })).toBeChecked();
      expect(within(dialog).getByRole("button", { name: bulkApplyLabel(4) })).toBeEnabled();
      expect(within(dialog).getByRole("button", { name: "やめる" })).toBeEnabled();
    });

    it("チェックを外すと件数が減り、0 件になると「0件を計画に反映する」を押せない（押しても保存しない）", async () => {
      // 準備
      await seed();
      const { user } = renderDrift();
      await waitForReady();
      const dialog = await openBulk(user);

      // 実行・検証：1 つ外すと 3 件
      await user.click(within(dialog).getByRole("checkbox", { name: /長波改二/ }));
      expect(within(dialog).getByRole("button", { name: bulkApplyLabel(3) })).toBeEnabled();

      // 実行・検証：全部外すと 0 件で押せない
      for (const box of within(dialog).getAllByRole("checkbox")) {
        if ((box as HTMLInputElement).checked || box.getAttribute("aria-checked") === "true") await user.click(box);
      }
      const apply = within(dialog).getByRole("button", { name: bulkApplyLabel(0) });
      expect(apply).toBeDisabled();
      await user.click(apply);
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(summer2026Assignments);
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    it("「やめる」で確認の枠を閉じ、計画は変えない", async () => {
      // 準備
      await seed();
      const { user } = renderDrift();
      await waitForReady();
      const dialog = await openBulk(user);

      // 実行
      await user.click(within(dialog).getByRole("button", { name: "やめる" }));

      // 検証
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(summer2026Assignments);
      expect(issueCards()).toHaveLength(4);
      expect(screen.getByRole("button", { name: "計画をまとめて実際に合わせる" })).toBeEnabled();
      expectNoDoneMessage();
    });

    it("チェックしたものだけを反映して保存し、確認の枠を閉じて「3件を計画に反映しました（長波改二・北上改二・浜波改）」（艦名の順は問わない）を出す。「元に戻す」で 3 件とも戻す", async () => {
      // 準備：あきつ丸改のチェックを外す
      await seed();
      const { user } = renderDrift();
      await waitForReady();
      const dialog = await openBulk(user);
      await user.click(within(dialog).getByRole("checkbox", { name: /あきつ丸改/ }));

      // 実行
      await user.click(within(dialog).getByRole("button", { name: bulkApplyLabel(3) }));

      // 検証：3 件だけ反映。あきつ丸改は控えのまま一覧に残る
      await expectSaved({ ...summer2026Assignments, naganami: "tago", kitakami: "s31", hamanami: "tago" });
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(issueCards()).toHaveLength(1);
      expect(getIssueCard("あきつ丸改")).toBeInTheDocument();
      expect(screen.getByText(`${PROBE}akitsumaru→控え`)).toBeInTheDocument();
      getDoneStatus(3, ["長波改二", "北上改二", "浜波改"]);

      // 実行・検証：元に戻す
      await user.click(screen.getByRole("button", { name: "元に戻す" }));
      await expectSaved(summer2026Assignments);
      expect(issueCards()).toHaveLength(4);
      expectNoDoneMessage();
    });

    it("確認の枠を開き直すと、チェックは全部 ON に戻る", async () => {
      // 準備：1 つ外してから「やめる」
      await seed();
      const { user } = renderDrift();
      await waitForReady();
      const first = await openBulk(user);
      await user.click(within(first).getByRole("checkbox", { name: /長波改二/ }));
      await user.click(within(first).getByRole("button", { name: "やめる" }));

      // 実行
      const dialog = await openBulk(user);

      // 検証
      for (const box of within(dialog).getAllByRole("checkbox")) expect(box).toBeChecked();
      expect(within(dialog).getByRole("button", { name: bulkApplyLabel(4) })).toBeEnabled();
    });
  });
});
