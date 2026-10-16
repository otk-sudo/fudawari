// 一覧の画面（/list。要件 3.2・3.9・5 章、roadmap T2-9・T2-10）のテスト：読み込み・出し分け・ヘッダーのボタン・通信
//
// 一覧の本文（攻略の流れ・札ごとの行・表示の切り替え）の細かい表示は src/features/list/ListBoard.test.tsx で、
// 画像で保存のウィンドウは src/features/export-image/ExportImageDialog.test.tsx で確かめる。ここでは、ページが
// - 公開定義（/data/latest-definition.json）・艦船マスタ（/data/ship-master.json）・札割りのデータ（usePlanData）を読み、
// - 読み込み中・失敗・取り込んでいないときの表示を出し分け、
// - すべて読めたら保存した割り当てで本文を出し、ヘッダーから画像で保存のウィンドウと割り振りの画面へ進める
// ことを確かめる。ヘッダーの最新イベント名と公開定義の失敗の表示は src/app/screen-headers.test.tsx でも確かめている。
//
// - fetch は差し替える（src/test/list-export.ts でパスごとに振り分ける）。一般の画面なので、ほかへは通信しない。
// - 保存先は fake-indexeddb の上の本物の保存（テストごとに別の DB）を、共有の札割りのデータに渡す（resetPlanDataCache）。
// - 部品の探し方は src/test/list-screen.ts の冒頭にまとめてある。
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { domToBlob, type Options } from "modern-screenshot";
import type * as ModernScreenshot from "modern-screenshot";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import ListPage from "@/app/list/page";
import type { AssignmentMap } from "@/domain/plan/types";
import { LATEST_DEFINITION_PATH, resetLatestDefinitionCache } from "@/lib/definition";
import { resetPlanDataCache } from "@/lib/plan";
import { resetShipMasterCache, SHIP_MASTER_PATH } from "@/lib/ship-master";
import type { FudawariStorage } from "@/lib/storage";
import { type FetchMock, requestedPaths, stubFetch, textResponse } from "@/test/definition-fetch";
import {
  installClipboard,
  installDocumentFonts,
  pngBlob,
  recordDownloads,
  restoreBrowserFakes,
} from "@/test/export-browser-fakes";
import { summer2026Assignments, summer2026Definition, summer2026Ships } from "@/test/fixtures";
import { holdStaticFile, listFileResponders, respondToPaths, respondWithListFiles } from "@/test/list-export";
import {
  boostCountPattern,
  getExportDialog,
  getFudaRegion,
  getStep,
  queryTimeline,
  expectRowCount,
} from "@/test/list-screen";
import { cleanupTestStorages, failingStorage, importInput, openTestStorage } from "@/test/plan-storage";
import { shipMasterFileOf } from "@/test/ship-master-fetch";

// modern-screenshot は domToBlob だけを差し替える（画像で保存の流れを通すため）
vi.mock("modern-screenshot", async (importOriginal) => {
  const actual = await importOriginal<typeof ModernScreenshot>();
  return { ...actual, domToBlob: vi.fn() };
});

/** domToBlob の差し替え（DOM を受け取る形で呼ばれる前提） */
const domToBlobMock = domToBlob as unknown as Mock<(node: Node, options?: Options) => Promise<Blob>>;

// ---- テスト用のデータ ----

/** 最新イベントの ID（"2026-summer"） */
const EVENT_ID = summer2026Definition.event.id;

/** 読み込み中の表示 */
const LOADING = /読み込み中/;
/** 読み込みに失敗したときに書く次の行動（公開定義の失敗の警告と同じ） */
const RELOAD_ADVICE = "ページを再読み込みしてください";
/** 取り込んでいないときの案内 */
const NOT_IMPORTED = /艦娘を取り込んでいません/;

// ---- 補助 ----

let fetchMock: FetchMock;
/** このテストの保存先（beforeEach で開いて、共有の札割りのデータに渡す） */
let storage: FudawariStorage;

beforeEach(() => {
  resetLatestDefinitionCache();
  resetShipMasterCache();
  storage = openTestStorage("fudawari-list-page-test").storage;
  resetPlanDataCache({ storage });
  fetchMock = stubFetch();
  respondWithListFiles(fetchMock);
  domToBlobMock.mockReset();
  domToBlobMock.mockImplementation(async () => pngBlob());
});

afterEach(async () => {
  // 部品を外してから、共有の読み込みの状態を捨て、差し替えを戻し、DB を消す
  cleanup();
  resetLatestDefinitionCache();
  resetShipMasterCache();
  resetPlanDataCache();
  restoreBrowserFakes();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await cleanupTestStorages();
});

/** 取り込み（31 隻）と、最新イベントの割り当てを保存しておく */
async function seedPlan(target: FudawariStorage, assignments: AssignmentMap = summer2026Assignments): Promise<void> {
  await target.saveImport(importInput(summer2026Ships));
  await target.saveAssignments(EVENT_ID, assignments);
}

/** 一覧の画面を描く */
function renderListPage(): UserEvent {
  const user = userEvent.setup();
  render(<ListPage />);
  return user;
}

/** 本文（攻略の流れ）が出るまで待つ */
async function waitForBoard(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: "攻略の流れ" });
}

/** 画面名（h1「札割り一覧」）を含むヘッダー */
function getHeader(): HTMLElement {
  const title = screen.getByRole("heading", { level: 1, name: "札割り一覧" });
  const header = title.closest("header");
  if (header === null) throw new Error("見出し「札割り一覧」を含む <header> がない");
  return header;
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

/** 読み込み中を出していて、本文・取り込みの案内・警告を出していないことを確かめる */
function expectLoadingOnly(): void {
  expect(screen.getByRole("heading", { level: 1, name: "札割り一覧" })).toBeInTheDocument();
  expect(screen.getByText(LOADING)).toBeInTheDocument();
  expect(queryTimeline()).not.toBeInTheDocument();
  expect(screen.queryByText(NOT_IMPORTED)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
}

// ---- テスト ----

describe("一覧の画面（/list）", () => {
  describe("読み込み中", () => {
    it("公開定義の読み込み中は「読み込み中」を出し、本文・取り込みの案内・警告を出さない", async () => {
      // 準備：公開定義の応答を待たせる
      await seedPlan(storage);
      const held = holdStaticFile();
      respondToPaths(fetchMock, { ...listFileResponders(), [LATEST_DEFINITION_PATH]: held.responder });

      // 実行
      renderListPage();
      await waitFor(() => expect(requestedPaths(fetchMock)).toContain(LATEST_DEFINITION_PATH));

      // 検証
      expectLoadingOnly();

      // 実行・検証：応答が来たら本文を出す
      held.release(() => textResponse(JSON.stringify(summer2026Definition)));
      expect(await waitForBoard()).toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });

    it("艦船マスタの読み込み中は「読み込み中」を出し、本文・取り込みの案内・警告を出さない", async () => {
      // 準備：艦船マスタの応答を待たせる
      await seedPlan(storage);
      const held = holdStaticFile();
      respondToPaths(fetchMock, { ...listFileResponders(), [SHIP_MASTER_PATH]: held.responder });

      // 実行
      renderListPage();
      await waitFor(() => expect(requestedPaths(fetchMock)).toContain(SHIP_MASTER_PATH));

      // 検証
      expectLoadingOnly();

      // 実行・検証：応答が来たら本文を出す
      held.release(() => textResponse(JSON.stringify(shipMasterFileOf())));
      expect(await waitForBoard()).toBeInTheDocument();
    });

    it("札割りのデータ（取り込んだ艦・割り当て）の読み込み中は「読み込み中」を出し、本文・取り込みの案内・警告を出さない", async () => {
      // 準備：保存先の読み取りを待たせる
      await seedPlan(storage);
      const held = holdPlanLoading(storage);
      resetPlanDataCache({ storage: held.storage });

      // 実行
      renderListPage();
      await waitFor(() => expect(held.wasRequested()).toBe(true));

      // 検証
      expectLoadingOnly();

      // 実行・検証：読み終えたら本文を出す
      held.release();
      expect(await waitForBoard()).toBeInTheDocument();
    });
  });

  describe("読み込みの失敗", () => {
    it("公開定義を読み込めなければ、警告（1 つ）に「イベントの定義を読み込めませんでした」・理由・次の行動を出し、本文と「読み込み中」を出さない", async () => {
      // 準備：公開定義は 404
      await seedPlan(storage);
      respondToPaths(fetchMock, { [SHIP_MASTER_PATH]: listFileResponders()[SHIP_MASTER_PATH] });

      // 実行
      renderListPage();

      // 検証（findByRole は警告が 2 つ以上あると失敗する）
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("イベントの定義を読み込めませんでした");
      expect(alert).toHaveTextContent("404");
      expect(alert).toHaveTextContent(RELOAD_ADVICE);
      expect(queryTimeline()).not.toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });

    it("艦船マスタを読み込めなければ、警告に「艦船マスタを読み込めませんでした」・理由（404）・次の行動を出し、本文と「読み込み中」を出さない", async () => {
      // 準備：艦船マスタは 404
      await seedPlan(storage);
      respondToPaths(fetchMock, { [LATEST_DEFINITION_PATH]: listFileResponders()[LATEST_DEFINITION_PATH] });

      // 実行
      renderListPage();

      // 検証
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("艦船マスタを読み込めませんでした");
      expect(alert).toHaveTextContent("404");
      expect(alert).toHaveTextContent(RELOAD_ADVICE);
      expect(queryTimeline()).not.toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });

    it("ブラウザ内の保存を読めなければ、警告に「札割りのデータを読み込めませんでした」（理由）と次の行動を出し、本文と「読み込み中」を出さない", async () => {
      // 準備：どの操作も失敗する保存先（IndexedDB を使えないブラウザの代わり）
      resetPlanDataCache({ storage: failingStorage() });

      // 実行
      renderListPage();

      // 検証
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("札割りのデータを読み込めませんでした");
      expect(alert).toHaveTextContent(RELOAD_ADVICE);
      expect(queryTimeline()).not.toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });
  });

  describe("取り込んでいないとき", () => {
    it("艦娘を取り込んでいなければ、そのことと取り込みの画面（/import）への案内を出し、本文・「読み込み中」・警告を出さない", async () => {
      // 準備：何も保存していない

      // 実行
      renderListPage();

      // 検証
      expect(await screen.findByText(NOT_IMPORTED)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /取り込み/ })).toHaveAttribute("href", "/import");
      expect(screen.getByRole("heading", { level: 1, name: "札割り一覧" })).toBeInTheDocument();
      expect(queryTimeline()).not.toBeInTheDocument();
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("艦娘を取り込んでいなければ、艦船マスタ（/data/ship-master.json）を取得しない（割り振りの画面と同じ）", async () => {
      // 準備：何も保存していない

      // 実行：取り込みの案内が出るまで待つ（公開定義と札割りのデータは読み終えている）
      renderListPage();
      expect(await screen.findByText(NOT_IMPORTED)).toBeInTheDocument();

      // 検証
      expect(requestedPaths(fetchMock)).toContain(LATEST_DEFINITION_PATH);
      expect(requestedPaths(fetchMock)).not.toContain(SHIP_MASTER_PATH);
    });
  });

  describe("読み込めたとき", () => {
    it("取り込んだ艦と保存した割り当てで本文を出す（E2 ゲージ3「特効 8隻」、連合艦隊「8隻 ・ 特効 8隻」）。「読み込み中」・警告・取り込みの案内は出さない", async () => {
      // 準備
      await seedPlan(storage);

      // 実行
      renderListPage();

      // 検証
      const timeline = await waitForBoard();
      expect(getStep(timeline, "E2", "ゲージ3", "連合艦隊")).toHaveTextContent(boostCountPattern(8));
      expectRowCount(getFudaRegion(document.body, "連合艦隊"), 8, 8);
      expectRowCount(getFudaRegion(document.body, "第三十一戦隊"), 4, 3);
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(NOT_IMPORTED)).not.toBeInTheDocument();
    });

    it("取り込んでいて割り当てがなければ、本文を出し、全札に「まだ割り当てがありません」を出す", async () => {
      // 準備：取り込みだけ
      await storage.saveImport(importInput(summer2026Ships));

      // 実行
      renderListPage();
      await waitForBoard();

      // 検証
      expect(screen.getAllByText("まだ割り当てがありません")).toHaveLength(summer2026Definition.fudas.length);
      expect(screen.queryByText(NOT_IMPORTED)).not.toBeInTheDocument();
    });

    it("取得するのは公開定義と艦船マスタの静的ファイルだけ（Supabase などほかへは通信しない）", async () => {
      // 準備
      await seedPlan(storage);

      // 実行
      renderListPage();
      await waitForBoard();

      // 検証：取り込んだ艦や割り当てを外へ送らない（要件 5 章）
      expect(new Set(requestedPaths(fetchMock))).toEqual(new Set([LATEST_DEFINITION_PATH, SHIP_MASTER_PATH]));
      expect(fetchMock.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input))).not.toContainEqual(
        expect.stringContaining("supabase"),
      );
    });

    it("ヘッダーに「割り振りを編集」（割り振りの画面 /assign へのリンク）と「画像で保存」（ウィンドウを開くボタン）を出す", async () => {
      // 準備
      await seedPlan(storage);

      // 実行
      renderListPage();
      await waitForBoard();

      // 検証
      const header = getHeader();
      expect(within(header).getByRole("link", { name: "割り振りを編集" })).toHaveAttribute("href", "/assign");
      expect(within(header).getByRole("button", { name: "画像で保存" })).toHaveAttribute("aria-haspopup", "dialog");
    });

    it("「画像で保存」で画像で保存のウィンドウを開き（後ろの一覧は触れない）、「やめる」で閉じると「画像で保存」にフォーカスが戻る", async () => {
      // 準備
      await seedPlan(storage);
      installDocumentFonts();
      const user = renderListPage();
      await waitForBoard();
      const openButton = within(getHeader()).getByRole("button", { name: "画像で保存" });

      // 実行
      await user.click(openButton);

      // 検証：保存した割り当ての札（艦がいる 5 札）で開く
      const dialog = getExportDialog();
      expect(dialog).toHaveTextContent(/5\s*札\s*→\s*1\s*枚/);
      expect(screen.queryByRole("region", { name: "攻略の流れ" })).not.toBeInTheDocument();

      // 実行・検証：閉じる
      await user.click(within(dialog).getByRole("button", { name: "やめる" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.activeElement === openButton, "「画像で保存」にフォーカスが戻ること").toBe(true);
    });

    it("画像で保存のウィンドウの「PNGで保存」で、保存した割り当ての画像を PNG で保存する", async () => {
      // 準備
      await seedPlan(storage);
      installDocumentFonts();
      const recorder = recordDownloads();
      const user = renderListPage();
      installClipboard("supported");
      await waitForBoard();
      await user.click(within(getHeader()).getByRole("button", { name: "画像で保存" }));

      // 実行
      await user.click(within(getExportDialog()).getByRole("button", { name: "PNGで保存" }));

      // 検証
      await waitFor(() => expect(recorder.downloads).toHaveLength(1));
      expect(recorder.downloads[0].download).toBe("2026夏イベ_札割り.png");
      expect(domToBlobMock).toHaveBeenCalledTimes(1);
      const [node] = domToBlobMock.mock.calls[0];
      expect(node.textContent).toContain("連合艦隊");
      expect(node.textContent).toContain("時雨改二");
    });
  });
});
