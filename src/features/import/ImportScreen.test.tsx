// 取り込み画面（ImportScreen）のテスト（要件 3.4・13.1 の U8・U9・U17、モック Import.dc.html、roadmap T2-4）
//
// - 画面は引数を取らず、艦船マスタ（useShipMaster）・最新イベントの定義（useLatestDefinition）・
//   札割りのデータ（usePlanData）・保存先（getPlanStorage）を自分で読む。
//   取り込みは「解析（parseImportText）→ 外れる割り当ての件数（previewImport）→ 必要なら確認 → 保存（saveImport）→ 読み直し（reload）」。
// - 差し替えるのは外との境界だけ：fetch（静的ファイル 2 つ）は respondWithStaticData、保存先は fake-indexeddb の上の本物の保存
//   （テストごとに別の DB。resetPlanDataCache({ storage }) で渡す）。時刻は Date だけを固定する（取り込んだ日時の表示のため）。
// - 文言は、要件・モックにあるものはそのまま確かめ、ないもの（失敗の理由・確認・知らせ）は要点の語句だけを確かめる。
//
// 2026-10-17 に親が決めたこと（要件の文書にはまだ書いていない）
// - 絞り込みの後に 0 隻（noShips）なら保存せず、理由を出す
// - 取り込みで外れる割り当ての件数（previewImport）が 1 以上なら、保存の前に確認を挟む。やめれば保存しない
// - 完了の表示の件数は saveImport の戻り値（実際に外した件数）を使う
// - 個体 ID がない古い形式は「割り当ては引き継げない」ことを知らせる（U9）
// - ロック情報がない形式で「ロック済みだけ」を選んだら、効かなかったことを知らせる
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseImportText } from "@/domain/import";
import { createShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { ImportScreen } from "@/features/import/ImportScreen";
import { resetLatestDefinitionCache, useLatestDefinition } from "@/lib/definition";
import { resetPlanDataCache, usePlanData } from "@/lib/plan";
import { resetShipMasterCache, SHIP_MASTER_PATH, useShipMaster } from "@/lib/ship-master";
import type { FudawariStorage } from "@/lib/storage";
import { expectInDocumentOrder } from "@/test/dom-order";
import { type FetchMock, stubFetch } from "@/test/definition-fetch";
import { summer2026Definition, summer2026MasterEntries } from "@/test/fixtures";
import {
  compactShip,
  kyouka,
  standardCompactText,
  standardSvdataText,
  svShip,
  toCompactText,
  toSvdataText,
} from "@/test/fixtures/importSamples";
import {
  cleanupTestStorages,
  failingStorage,
  IMPORT_ALL,
  importInput,
  openStorageWithoutIndexedDB,
  openTestStorage,
} from "@/test/plan-storage";
import { respondWithStaticData } from "@/test/static-data-fetch";

// ---- テスト用のデータ ----
//
// 標準のサンプル（src/test/fixtures/importSamples.ts の standardSamples）の中身
// | 個体 ID | 艦（艦 ID）           | Lv  | 札 | ロック |
// |---------|-----------------------|-----|----|--------|
// | 101     | 時雨改三（961）       | 175 | 0  | あり   |
// | 102     | 時雨改二（145）       | 99  | 3  | あり   |
// | 103     | 雪風改二（656）       | 168 | 0  | なし   |
// | 104     | マスタにない（99999） | 50  | 2  | あり   |
// | 105     | 初霜改二（419）       | 98  | 0  | なし   |
// （106 は艦の ID が 0 なので飛ばす）
// すべての艦娘・Lv1 以上なら 5 隻（札が付いている艦 2 隻〔102・104〕、名前が分からない艦 1 隻〔104〕）

/** 最新イベントの ID（"2026-summer"） */
const EVENT_ID = summer2026Definition.event.id;
/** テスト用の仮マスタ（保存先に入れる艦を作るときだけ使う。画面は fetch で同じ中身を読む） */
const TEST_MASTER = createShipMaster(summer2026MasterEntries);

/**
 * 今の時刻（今回の取り込みの日時）。表示は利用者の端末の時刻帯で出すため、
 * どの時刻帯で実行しても「10/17 21:40」になるよう、実行する端末の時刻帯で作る
 */
const NOW = new Date(2026, 9, 17, 21, 40);
/** 前の取り込みの日時（端末の時刻帯で 10/15 20:40） */
const PREVIOUS_IMPORTED_AT = new Date(2026, 9, 15, 20, 40).toISOString();

/** 個体 ID がない古い短縮形式（ship_id がなく、id が艦の ID）の 2 隻：時雨改三 Lv175、時雨改二 Lv99（札 3） */
const LEGACY_TEXT = toCompactText([
  compactShip({ id: 961, lv: 175, st: kyouka(39) }),
  compactShip({ id: 145, lv: 99, st: kyouka(7), area: 3 }),
]);

/** 名前が分かる艦だけの svdata 形式（時雨改三 Lv175、ロックあり） */
const KNOWN_ONLY_SVDATA_TEXT = toSvdataText([
  svShip({ api_id: 201, api_ship_id: 961, api_lv: 175, api_kyouka: kyouka(39), api_locked: 1 }),
]);

// ---- 要件・モックの文言 ----

const COPY_STEP = "艦娘の情報をコピーする";
const COPY_GUIDE = "制空権シミュレータに艦娘を反映するときと同じ方法でコピーしてください。";
const PASTE_STEP = "ここに貼り付ける";
const PRIVACY_NOTE = "データはこのブラウザの中だけで読み取ります";
const EMPTY_MESSAGE =
  "まだ何も貼り付けられていません。コピーした艦娘の情報を左の欄に貼り付けてから「取り込む」を押してください";
const DONE_HEADING = "取り込みました";

// ---- 要件・モックにない文言の要点（実装はこの語句を含める） ----

/** JSON として読めない（invalidJson） */
const INVALID_JSON_REASON = "JSON として読めません";
/** どちらの形式の形でもない（unexpectedShape） */
const UNEXPECTED_SHAPE_REASON = "艦娘の情報の形式ではありません";
/** 絞り込んだ後に 1 隻も残らない（noShips） */
const NO_SHIPS_REASON = "艦がいません";
/** 保存先に保存できない（previewImport・saveImport の失敗） */
const SAVE_FAILED_REASON = "保存できませんでした";
/** 艦船マスタを読み込めない（理由の文は @/lib/ship-master の error.message を続ける） */
const MASTER_LOAD_FAILED = "艦船マスタを読み込めませんでした";
/** 札割りのデータを読み込めない（@/lib/plan の usePlanData の error.message に含まれる語句） */
const PLAN_LOAD_FAILED = "札割りのデータを読み込めませんでした";
/** 個体 ID がない古い形式の知らせ（U9） */
const NO_UID_NOTICE = "引き継げません";
/** ロックの情報がない形式で「ロック済みだけ」を選んだときの知らせ */
const LOCK_IGNORED_NOTICE = "ロックの情報がない";
/** 確認の「外して取り込む」・「やめる」 */
const CONFIRM_BUTTON = "外して取り込む";
const CANCEL_BUTTON = "やめる";

/** 確認に書く「n件の割り当てが外れます」 */
function willRemoveText(count: number): RegExp {
  return new RegExp(`${count}\\s*件の割り当てが外れます`);
}

/** 完了の表示に書く「n件の割り当てを外しました」 */
function removedText(count: number): RegExp {
  return new RegExp(`${count}\\s*件の割り当てを外しました`);
}

// ---- 準備と後片付け ----

/** このテストの保存先（beforeEach で開いて、共有のストアに渡す） */
let storage: FudawariStorage;
let fetchMock: FetchMock;

beforeEach(() => {
  resetShipMasterCache();
  resetLatestDefinitionCache();
  storage = openTestStorage("fudawari-import-screen-test").storage;
  resetPlanDataCache({ storage });
  fetchMock = stubFetch();
  respondWithStaticData(fetchMock);
  // Date だけを固定する（タイマーは本物のまま。user-event と fake-indexeddb を止めないため）
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  // 部品を外してから、共有の状態を捨て、差し替えを戻し、DB を消す
  cleanup();
  resetPlanDataCache();
  resetShipMasterCache();
  resetLatestDefinitionCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await cleanupTestStorages();
});

// ---- 補助 ----

/** 標準のサンプル（svdata 形式）の 5 隻（個体 ID 101〜105）。前に取り込んだ艦として保存先に入れるために使う */
function standardShips(): OwnedShip[] {
  const result = parseImportText(standardSvdataText, TEST_MASTER, IMPORT_ALL);
  if (!result.ok) throw new Error(`標準のサンプルを解析できない（${result.reason}）`);
  return result.ships;
}

/** 前の取り込み（標準のサンプルの 5 隻、10/15 20:40）と、最新イベントの割り当てを保存しておく（描く前に呼ぶ） */
async function seedPreviousImport(assignments: AssignmentMap = {}): Promise<void> {
  await storage.saveImport(importInput(standardShips(), { importedAt: PREVIOUS_IMPORTED_AT }));
  await storage.saveAssignments(EVENT_ID, assignments);
}

/** 保存先にある艦の個体 ID（並び順に左右されないよう並べる） */
async function storedUids(): Promise<string[]> {
  return (await storage.loadShips()).map((ship) => ship.uid).sort();
}

/** 確認用の部品が出す文の書き出し */
const PROBE_LABEL = "確認用：";

/**
 * 共有している読み込みの状態（艦船マスタ・札割りのデータ）を文字で出す、テストだけで使う確認用の部品。
 * 画面と同じ状態を共有するため、取得・読み込みは増えない（usePlanData には画面と同じ最新イベントの ID・札 ID を渡す）
 */
function LoadStatusProbe(): ReactNode {
  const master = useShipMaster();
  const definition = useLatestDefinition();
  const loaded = definition.status === "success" ? definition.definition : null;
  const plan = usePlanData(loaded?.event.id ?? null, loaded?.fudas.map((fuda) => fuda.id) ?? []);
  return <p>{`${PROBE_LABEL}マスタ＝${master.status}／札割り＝${plan.status}`}</p>;
}

/** 読み込みの状態（艦船マスタ・札割りのデータ） */
interface ExpectedLoad {
  master: "success" | "error";
  plan: "ready" | "error";
}

/**
 * 取り込み画面を描き、艦船マスタと札割りのデータの読み込みが済むまで待つ（既定は、どちらも成功）。
 * 状態が変わったことを確かめてから、その結果を受けた描き直しを済ませる
 */
async function renderImportScreen(expected: ExpectedLoad = { master: "success", plan: "ready" }): Promise<UserEvent> {
  const user = userEvent.setup();
  render(
    <>
      <ImportScreen />
      <LoadStatusProbe />
    </>,
  );
  expect(
    await screen.findByText(`${PROBE_LABEL}マスタ＝${expected.master}／札割り＝${expected.plan}`),
  ).toBeInTheDocument();
  await act(async () => {
    await Promise.resolve();
  });
  return user;
}

/** 貼り付け欄 */
function pasteBox(): HTMLElement {
  return screen.getByRole("textbox", { name: "艦娘の情報を貼り付け" });
}

/** 「取り込む」ボタン */
function importButton(): HTMLElement {
  return screen.getByRole("button", { name: "取り込む" });
}

/** Lv 下限の欄 */
function lvInput(): HTMLElement {
  return screen.getByRole("spinbutton", { name: /Lv\s*下限/ });
}

/** 取り込む艦娘の選択肢（「すべての艦娘」「ロック済みだけ」） */
function lockOption(label: "すべての艦娘" | "ロック済みだけ"): HTMLElement {
  const group = screen.getByRole("radiogroup", { name: "取り込む艦娘" });
  return within(group).getByRole("radio", { name: new RegExp(`^${label}`) });
}

/** 貼り付け欄に文字列を貼り付ける */
async function pasteText(user: UserEvent, text: string): Promise<void> {
  await user.click(pasteBox());
  await user.paste(text);
}

/** 貼り付けて「取り込む」を押す */
async function pasteAndImport(user: UserEvent, text: string): Promise<void> {
  await pasteText(user, text);
  await user.click(importButton());
}

/** Lv 下限の欄に数を入れ直す */
async function typeMinLevel(user: UserEvent, level: number): Promise<void> {
  await user.clear(lvInput());
  await user.type(lvInput(), String(level));
}

/** 完了の表示（見出し「取り込みました」〔h2〕を含む role="status" の領域）が出るまで待って返す */
async function findDoneRegion(): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { level: 2, name: DONE_HEADING });
  const region = heading.closest<HTMLElement>('[role="status"]');
  if (region === null) {
    throw new Error("見出し「取り込みました」が role=\"status\" の領域の中にない");
  }
  return region;
}

/** 完了の表示が出ていない */
function expectNoDoneRegion(): void {
  expect(screen.queryByRole("heading", { name: DONE_HEADING })).not.toBeInTheDocument();
}

/** 完了の表示の中の、書き出しが start の行（例「艦娘」「すでに札が付いている艦」「名前が分からない艦」） */
function doneLine(region: HTMLElement, start: string): HTMLElement {
  return within(region).getByText(new RegExp(`^${start}`));
}

/** text を含む警告（role="alert"）が出るまで待って返す（警告が複数あってもよい） */
async function findAlertContaining(text: string | RegExp): Promise<HTMLElement> {
  return waitFor(() => {
    const match = screen
      .queryAllByRole("alert")
      .find((alert) => {
        const content = alert.textContent ?? "";
        return typeof text === "string" ? content.includes(text) : text.test(content);
      });
    if (match === undefined) {
      throw new Error(`「${String(text)}」を含む警告（role="alert"）がない`);
    }
    return match;
  });
}

/** 「最終取り込み（日時） ／ n隻」の表示（「最終取り込み」で始まる要素） */
function lastImportText(): HTMLElement {
  return screen.getByText(/^最終取り込み/);
}

/** 最終取り込みの表示が「最終取り込み M/D HH:mm ／ n隻」になるまで待つ */
async function expectLastImport(monthDayTime: string, shipCount: number): Promise<void> {
  const [monthDay, time] = monthDayTime.split(" ");
  const pattern = new RegExp(`最終取り込み\\s*${monthDay}\\s+${time}\\s*／\\s*${shipCount}\\s*隻`);
  await waitFor(() => expect(lastImportText()).toHaveTextContent(pattern));
}

// ---- テスト ----

describe("取り込み画面（ImportScreen）", () => {
  describe("表示（要件 3.4・モック）", () => {
    it("左側に「艦娘の情報をコピーする」とその説明、「ここに貼り付ける」と貼り付け欄（「Ctrl+V で貼り付け」）がこの順で並ぶ", async () => {
      // 準備・実行
      await renderImportScreen();

      // 検証
      expect(pasteBox()).toHaveAttribute("placeholder", "Ctrl+V で貼り付け");
      expectInDocumentOrder([
        screen.getByText(COPY_STEP),
        screen.getByText(COPY_GUIDE),
        screen.getByText(PASTE_STEP),
        pasteBox(),
      ]);
    });

    it("貼り付ける前は、欄の下に「データはこのブラウザの中だけで読み取ります」を出す", async () => {
      // 準備・実行
      await renderImportScreen();

      // 検証
      expect(pasteBox()).toBeInTheDocument();
      expect(screen.getByText(PRIVACY_NOTE)).toBeInTheDocument();
    });

    it("貼り付けると「貼り付けました（n文字）」と貼り付けた文字数を出す", async () => {
      // 準備
      const user = await renderImportScreen();

      // 実行
      await pasteText(user, standardCompactText);

      // 検証
      expect(
        screen.getByText(new RegExp(`貼り付けました（\\s*${standardCompactText.length}\\s*文字）`)),
      ).toBeInTheDocument();
    });

    it("右側に「取り込む範囲」と、「すべての艦娘」「ロック済みだけ」の選択肢（説明つき）を出し、最初は「すべての艦娘」を選んでいる", async () => {
      // 準備・実行
      await renderImportScreen();

      // 検証
      expect(screen.getByText("取り込む範囲")).toBeInTheDocument();
      expect(lockOption("すべての艦娘")).toBeChecked();
      expect(lockOption("ロック済みだけ")).not.toBeChecked();
      expect(screen.getByText("未ロックの艦も含める")).toBeInTheDocument();
      expect(screen.getByText("育成中・保護中の艦に絞る")).toBeInTheDocument();
    });

    it("「ロック済みだけ」を押すと、そちらを選んだ状態に切り替わる", async () => {
      // 準備
      const user = await renderImportScreen();

      // 実行
      await user.click(lockOption("ロック済みだけ"));

      // 検証
      expect(lockOption("ロック済みだけ")).toBeChecked();
      expect(lockOption("すべての艦娘")).not.toBeChecked();
    });

    it("Lv 下限の欄（1〜185、最初は 1）と「−」「＋」、「以上」、すぐ選べる Lv1／Lv50／Lv99／Lv150、「取り込む」ボタンを出す", async () => {
      // 準備・実行
      await renderImportScreen();

      // 検証
      expect(screen.getByText("Lv がいくつ以上の艦を取り込むか")).toBeInTheDocument();
      expect(lvInput()).toHaveValue(1);
      expect(lvInput()).toHaveAttribute("min", "1");
      expect(lvInput()).toHaveAttribute("max", "185");
      expect(screen.getByRole("button", { name: /下げる/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /上げる/ })).toBeInTheDocument();
      expect(screen.getByText("以上")).toBeInTheDocument();
      for (const preset of ["Lv1", "Lv50", "Lv99", "Lv150"]) {
        expect(screen.getByRole("button", { name: preset })).toBeInTheDocument();
      }
      expect(importButton()).toBeInTheDocument();
    });
  });

  describe("Lv 下限の操作", () => {
    it.each([
      ["Lv1", 1],
      ["Lv50", 50],
      ["Lv99", 99],
      ["Lv150", 150],
    ] as const)("「%s」を押すと、Lv 下限が %i になる", async (preset, expected) => {
      // 準備：先に別の値にしておく（Lv1 を押したときに変わったことが分かるように）
      const user = await renderImportScreen();
      await typeMinLevel(user, 120);

      // 実行
      await user.click(screen.getByRole("button", { name: preset }));

      // 検証
      expect(lvInput()).toHaveValue(expected);
    });

    it("「＋」で 1 上がり、「−」で 1 下がる", async () => {
      // 準備
      const user = await renderImportScreen();
      await user.click(screen.getByRole("button", { name: "Lv50" }));

      // 実行・検証
      await user.click(screen.getByRole("button", { name: /上げる/ }));
      expect(lvInput()).toHaveValue(51);
      await user.click(screen.getByRole("button", { name: /下げる/ }));
      await user.click(screen.getByRole("button", { name: /下げる/ }));
      expect(lvInput()).toHaveValue(49);
    });

    it("1 より下には下がらない（1 のときに「−」を押しても 1 のまま）", async () => {
      // 準備
      const user = await renderImportScreen();

      // 実行
      await user.click(screen.getByRole("button", { name: /下げる/ }));

      // 検証
      expect(lvInput()).toHaveValue(1);
    });

    it("185 より上には上がらない（185 のときに「＋」を押しても 185 のまま）", async () => {
      // 準備
      const user = await renderImportScreen();
      await typeMinLevel(user, 185);

      // 実行
      await user.click(screen.getByRole("button", { name: /上げる/ }));

      // 検証
      expect(lvInput()).toHaveValue(185);
    });
  });

  describe("取り込みの流れ（貼り付け → 解析 → 保存 → 表示）", () => {
    it("svdata 形式を貼り付けて「取り込む」を押すと保存し、「取り込みました」と隻数（条件つき）・札が付いている艦・名前が分からない艦の隻数を出す", async () => {
      // 準備
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証：表示
      const region = await findDoneRegion();
      const countLine = doneLine(region, "艦娘");
      expect(countLine).toHaveTextContent(/艦娘\s*5\s*隻/);
      expect(countLine).toHaveTextContent("すべての艦娘");
      expect(countLine).toHaveTextContent(/Lv\s*1\s*以上/);
      const taggedLine = doneLine(region, "すでに札が付いている艦");
      expect(taggedLine).toHaveTextContent(/艦\s*2\s*隻/);
      expect(taggedLine).toHaveTextContent("計画との差分に使います");
      const unknownLine = doneLine(region, "名前が分からない艦");
      expect(unknownLine).toHaveTextContent(/艦が\s*1\s*隻/);
      expect(unknownLine).toHaveTextContent("新しく実装された艦かもしれません");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // 検証：保存先（艦の ID が 0 の 106 は飛ばす）
      await waitFor(async () => expect(await storedUids()).toEqual(["101", "102", "103", "104", "105"]));
    });

    it("完了の表示に「割り振りへ進む」（/assign へのリンク）と「差分を見る」（/drift へのリンク）を出す", async () => {
      // 準備
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      const region = await findDoneRegion();
      expect(within(region).getByRole("link", { name: "割り振りへ進む" })).toHaveAttribute("href", "/assign");
      expect(within(region).getByRole("link", { name: "差分を見る" })).toHaveAttribute("href", "/drift");
    });

    it("開いたときに、前の取り込みを「最終取り込み 10/15 20:40 ／ 5隻」の形で出す", async () => {
      // 準備
      await seedPreviousImport();

      // 実行
      await renderImportScreen();

      // 検証
      await expectLastImport("10/15 20:40", 5);
    });

    it("取り込むと、最終取り込みの表示が今回の日時と隻数（10/17 21:40 ／ 3隻）に変わる", async () => {
      // 準備：前の取り込みがある状態で開き、Lv99 以上（101・102・103 の 3 隻）にする
      await seedPreviousImport();
      const user = await renderImportScreen();
      await expectLastImport("10/15 20:40", 5);
      await user.click(screen.getByRole("button", { name: "Lv99" }));

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      await findDoneRegion();
      await expectLastImport("10/17 21:40", 3);
    });

    it("「ロック済みだけ」を選ぶと、ロック済みの艦（101・102・104）だけを保存し、条件に「ロック済みだけ」と出す", async () => {
      // 準備
      const user = await renderImportScreen();
      await user.click(lockOption("ロック済みだけ"));

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      const countLine = doneLine(await findDoneRegion(), "艦娘");
      expect(countLine).toHaveTextContent(/艦娘\s*3\s*隻/);
      expect(countLine).toHaveTextContent("ロック済みだけ");
      await waitFor(async () => expect(await storedUids()).toEqual(["101", "102", "104"]));
    });

    it("Lv 下限を Lv99 にすると、Lv99 以上の艦（101・102・103）だけを保存し、条件に「Lv99以上」と出す", async () => {
      // 準備
      const user = await renderImportScreen();
      await user.click(screen.getByRole("button", { name: "Lv99" }));

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      const countLine = doneLine(await findDoneRegion(), "艦娘");
      expect(countLine).toHaveTextContent(/艦娘\s*3\s*隻/);
      expect(countLine).toHaveTextContent(/Lv\s*99\s*以上/);
      await waitFor(async () => expect(await storedUids()).toEqual(["101", "102", "103"]));
    });

    it("短縮形式（個体 ID あり）を貼り付けても取り込める", async () => {
      // 準備
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, standardCompactText);

      // 検証
      expect(doneLine(await findDoneRegion(), "艦娘")).toHaveTextContent(/艦娘\s*5\s*隻/);
      await waitFor(async () => expect(await storedUids()).toEqual(["101", "102", "103", "104", "105"]));
    });

    it("名前が分からない艦がいなければ、その知らせは出さない", async () => {
      // 準備
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, KNOWN_ONLY_SVDATA_TEXT);

      // 検証
      const region = await findDoneRegion();
      expect(doneLine(region, "艦娘")).toHaveTextContent(/艦娘\s*1\s*隻/);
      expect(region).not.toHaveTextContent("名前が分からない艦");
    });
  });

  describe("外れる割り当ての確認（2026-10-17 親の決定）", () => {
    // 前の取り込み（101〜105）で、最新イベントに 101・103・105 を割り当てておく。
    // 「ロック済みだけ」で取り込むと 101・102・104 が残り、103・105 の割り当て（2 件）が外れる
    const ASSIGNED: AssignmentMap = { "101": "s31", "103": "rengo", "105": "tago" };

    /** 前の取り込みと割り当て（ASSIGNED）を保存してから開く */
    async function openWithAssignments(): Promise<UserEvent> {
      await seedPreviousImport(ASSIGNED);
      return renderImportScreen();
    }

    /** 「ロック済みだけ」で標準のサンプルを取り込み、確認が出るまで進めて、確認を返す */
    async function importLockedOnly(user: UserEvent): Promise<HTMLElement> {
      await user.click(lockOption("ロック済みだけ"));
      await pasteAndImport(user, standardSvdataText);
      return screen.findByRole("alertdialog");
    }

    it("外れる割り当てがなければ（件数 0）、確認を出さずに保存し、外した件数も書かない", async () => {
      // 準備：101・102 だけを割り当てておく（どちらも今回の取り込みにいる）
      await seedPreviousImport({ "101": "s31", "102": "tago" });
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      const region = await findDoneRegion();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(region).not.toHaveTextContent(/割り当てを外しました/);
      expect(await storage.loadAssignments(EVENT_ID)).toEqual({ "101": "s31", "102": "tago" });
    });

    it("外れる割り当てが 1 件以上なら、保存の前に確認（role=\"alertdialog\"）を出し、「2件の割り当てが外れます」と件数を書く。この時点では保存しない", async () => {
      // 準備：保存の見張りは、前の取り込みを保存した後に付ける
      const user = await openWithAssignments();
      const saveImport = vi.spyOn(storage, "saveImport");

      // 実行
      const dialog = await importLockedOnly(user);

      // 検証
      expect(dialog).toHaveTextContent(willRemoveText(2));
      expect(within(dialog).getByRole("button", { name: CONFIRM_BUTTON })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: CANCEL_BUTTON })).toBeInTheDocument();
      expect(saveImport).not.toHaveBeenCalled();
      expect((await storage.loadLastImport())?.importedAt).toBe(PREVIOUS_IMPORTED_AT);
      expectNoDoneRegion();
    });

    it("確認で「やめる」を押すと、確認を閉じ、保存しない（艦・最終取り込み・割り当てはそのまま）", async () => {
      // 準備：保存の見張りは、前の取り込みを保存した後に付ける
      const user = await openWithAssignments();
      const saveImport = vi.spyOn(storage, "saveImport");
      const dialog = await importLockedOnly(user);

      // 実行
      await user.click(within(dialog).getByRole("button", { name: CANCEL_BUTTON }));

      // 検証
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expectNoDoneRegion();
      expect(saveImport).not.toHaveBeenCalled();
      expect(await storedUids()).toEqual(["101", "102", "103", "104", "105"]);
      expect((await storage.loadLastImport())?.importedAt).toBe(PREVIOUS_IMPORTED_AT);
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(ASSIGNED);
      await expectLastImport("10/15 20:40", 5);
    });

    it("確認で「外して取り込む」を押すと保存し、完了の表示に「2件の割り当てを外しました」と出す", async () => {
      // 準備
      const user = await openWithAssignments();
      const dialog = await importLockedOnly(user);

      // 実行
      await user.click(within(dialog).getByRole("button", { name: CONFIRM_BUTTON }));

      // 検証
      const region = await findDoneRegion();
      expect(region).toHaveTextContent(removedText(2));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(await storedUids()).toEqual(["101", "102", "104"]);
      expect(await storage.loadAssignments(EVENT_ID)).toEqual({ "101": "s31" });
      await expectLastImport("10/17 21:40", 3);
    });

    it("確認の後に割り当てが変わっていたら、完了の表示には実際に外した件数（saveImport の戻り値）を出す", async () => {
      // 準備：確認が「2件」と出た後に、別の画面などで 105 の割り当てが外れた（外れるのは 103 の 1 件だけになる）
      const user = await openWithAssignments();
      const dialog = await importLockedOnly(user);
      expect(dialog).toHaveTextContent(willRemoveText(2));
      await storage.saveAssignments(EVENT_ID, { "101": "s31", "103": "rengo" });

      // 実行
      await user.click(within(dialog).getByRole("button", { name: CONFIRM_BUTTON }));

      // 検証
      const region = await findDoneRegion();
      expect(region).toHaveTextContent(removedText(1));
      expect(region).not.toHaveTextContent(removedText(2));
    });

    it("個体 ID がない古い形式で前の割り当てがあると、すべての割り当てが外れるため確認を出し、進めると引き継げないことと外した件数を出す", async () => {
      // 準備：101・102 を割り当てておく
      await seedPreviousImport({ "101": "s31", "102": "tago" });
      const user = await renderImportScreen();

      // 実行：古い形式を取り込み、確認で進める
      await pasteAndImport(user, LEGACY_TEXT);
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent(willRemoveText(2));
      await user.click(within(dialog).getByRole("button", { name: CONFIRM_BUTTON }));

      // 検証
      const region = await findDoneRegion();
      expect(region).toHaveTextContent(removedText(2));
      expect(region).toHaveTextContent(NO_UID_NOTICE);
      expect(await storage.loadAssignments(EVENT_ID)).toEqual({});
    });
  });

  describe("形式についての知らせ（2026-10-17 親の決定、U9）", () => {
    it("個体 ID がない古い形式を取り込むと、割り当ては引き継げないことを知らせる", async () => {
      // 準備
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, LEGACY_TEXT);

      // 検証
      const region = await findDoneRegion();
      expect(doneLine(region, "艦娘")).toHaveTextContent(/艦娘\s*2\s*隻/);
      expect(region).toHaveTextContent(NO_UID_NOTICE);
    });

    it.each([
      ["svdata 形式", standardSvdataText],
      ["短縮形式（個体 ID あり）", standardCompactText],
    ])("%s では、引き継げない知らせを出さない", async (_label, text) => {
      // 準備
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, text);

      // 検証
      expect(await findDoneRegion()).not.toHaveTextContent(NO_UID_NOTICE);
    });

    it("ロックの情報がない短縮形式で「ロック済みだけ」を選ぶと、効かなかったことを知らせ、すべての艦を取り込む（条件は「すべての艦娘」と出す）", async () => {
      // 準備
      const user = await renderImportScreen();
      await user.click(lockOption("ロック済みだけ"));

      // 実行
      await pasteAndImport(user, standardCompactText);

      // 検証
      const region = await findDoneRegion();
      expect(region).toHaveTextContent(LOCK_IGNORED_NOTICE);
      const countLine = doneLine(region, "艦娘");
      expect(countLine).toHaveTextContent(/艦娘\s*5\s*隻/);
      expect(countLine).toHaveTextContent("すべての艦娘");
      await waitFor(async () => expect(await storedUids()).toEqual(["101", "102", "103", "104", "105"]));
    });

    it("svdata 形式で「ロック済みだけ」を選んだときは、ロックの知らせを出さない", async () => {
      // 準備
      const user = await renderImportScreen();
      await user.click(lockOption("ロック済みだけ"));

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      expect(await findDoneRegion()).not.toHaveTextContent(LOCK_IGNORED_NOTICE);
    });

    it("短縮形式でも「すべての艦娘」のままなら、ロックの知らせを出さない", async () => {
      // 準備
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, standardCompactText);

      // 検証
      expect(await findDoneRegion()).not.toHaveTextContent(LOCK_IGNORED_NOTICE);
    });
  });

  describe("失敗（理由を警告で出し、保存しない）", () => {
    /** 保存先の取り込みの操作を見張る（呼ばれていないことを確かめるため。前の取り込みを保存した後に呼ぶ） */
    function watchStorage() {
      return {
        previewImport: vi.spyOn(storage, "previewImport"),
        saveImport: vi.spyOn(storage, "saveImport"),
      };
    }

    it("何も貼り付けずに「取り込む」を押すと、「まだ何も貼り付けられていません。…」を警告で出し、保存しない", async () => {
      // 準備
      const watched = watchStorage();
      const user = await renderImportScreen();

      // 実行
      await user.click(importButton());

      // 検証
      await findAlertContaining(EMPTY_MESSAGE);
      expectNoDoneRegion();
      expect(watched.previewImport).not.toHaveBeenCalled();
      expect(watched.saveImport).not.toHaveBeenCalled();
      expect(await storage.loadLastImport()).toBeNull();
    });

    it("空白・改行だけを貼り付けて「取り込む」を押しても、何も貼り付けていないときと同じ警告を出し、保存しない", async () => {
      // 準備
      const watched = watchStorage();
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, "   \n\t  \n");

      // 検証
      await findAlertContaining(EMPTY_MESSAGE);
      expectNoDoneRegion();
      expect(watched.saveImport).not.toHaveBeenCalled();
      expect(await storage.loadLastImport()).toBeNull();
    });

    it.each([
      ["JSON でも svdata= でもない文字列", "これは艦娘の情報ではありません"],
      ["svdata= の後ろが JSON として読めない", "svdata={broken"],
      ["途中で切れた JSON 配列", '[{"id": 101, "ship_id": 961,'],
    ])("JSON として読めない（%s）と、「JSON として読めません」を含む理由を警告で出し、保存しない", async (_label, text) => {
      // 準備
      const watched = watchStorage();
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, text);

      // 検証
      await findAlertContaining(INVALID_JSON_REASON);
      expectNoDoneRegion();
      expect(watched.previewImport).not.toHaveBeenCalled();
      expect(watched.saveImport).not.toHaveBeenCalled();
      expect(await storage.loadLastImport()).toBeNull();
    });

    it.each([
      ["JSON のオブジェクト（配列でない）", '{"api_data":{"api_ship":[]}}'],
      ["艦を表す要素がない JSON 配列", "[1, 2, 3]"],
      ["svdata= の後ろに api_data.api_ship がない", 'svdata={"api_result":1}'],
    ])("形が違う（%s）と、「艦娘の情報の形式ではありません」を含む理由を警告で出し、保存しない", async (_label, text) => {
      // 準備
      const watched = watchStorage();
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, text);

      // 検証
      await findAlertContaining(UNEXPECTED_SHAPE_REASON);
      expectNoDoneRegion();
      expect(watched.previewImport).not.toHaveBeenCalled();
      expect(watched.saveImport).not.toHaveBeenCalled();
      expect(await storage.loadLastImport()).toBeNull();
    });

    it("取り込む範囲で絞り込んだ後に 1 隻も残らない（Lv180 以上。noShips）と、理由を警告で出し、保存しない（前の取り込みはそのまま）", async () => {
      // 準備：前の取り込みがある状態で開き、Lv 下限を 180（標準のサンプルの最高は 175）にする
      await seedPreviousImport();
      const watched = watchStorage();
      const user = await renderImportScreen();
      await typeMinLevel(user, 180);

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      await findAlertContaining(NO_SHIPS_REASON);
      expectNoDoneRegion();
      expect(watched.previewImport).not.toHaveBeenCalled();
      expect(watched.saveImport).not.toHaveBeenCalled();
      expect(await storedUids()).toEqual(["101", "102", "103", "104", "105"]);
      expect((await storage.loadLastImport())?.importedAt).toBe(PREVIOUS_IMPORTED_AT);
      await expectLastImport("10/15 20:40", 5);
    });

    it("svdata 形式の艦の配列が空（noShips）でも、理由を警告で出し、保存しない", async () => {
      // 準備
      const watched = watchStorage();
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, toSvdataText([]));

      // 検証
      await findAlertContaining(NO_SHIPS_REASON);
      expectNoDoneRegion();
      expect(watched.saveImport).not.toHaveBeenCalled();
      expect(await storage.loadLastImport()).toBeNull();
    });

    it("失敗の後に正しい内容を貼り付けて取り込むと、警告を消して完了の表示を出す", async () => {
      // 準備：何も貼り付けずに押して、警告を出しておく
      const user = await renderImportScreen();
      await user.click(importButton());
      await findAlertContaining(EMPTY_MESSAGE);

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      await findDoneRegion();
      expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    });

    it("取り込んだ後に、欄を空にして「取り込む」を押すと、前の完了の表示を消して警告を出す", async () => {
      // 準備：一度取り込む
      const user = await renderImportScreen();
      await pasteAndImport(user, standardSvdataText);
      await findDoneRegion();

      // 実行
      await user.clear(pasteBox());
      await user.click(importButton());

      // 検証
      await findAlertContaining(EMPTY_MESSAGE);
      expectNoDoneRegion();
    });
  });

  describe("艦船マスタ・ブラウザ内の保存が使えないとき", () => {
    it("艦船マスタを読み込めないと、「艦船マスタを読み込めませんでした」と理由（状態コード 404）を警告で出し、取り込んでも保存しない", async () => {
      // 準備：艦船マスタだけを 404 にする
      respondWithStaticData(fetchMock, {
        [SHIP_MASTER_PATH]: () => new Response("Not Found", { status: 404 }),
      });
      const saveImport = vi.spyOn(storage, "saveImport");
      const user = await renderImportScreen({ master: "error", plan: "ready" });

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      const alert = await findAlertContaining(MASTER_LOAD_FAILED);
      expect(alert).toHaveTextContent("状態コード 404");
      expectNoDoneRegion();
      expect(saveImport).not.toHaveBeenCalled();
      expect(await storage.loadLastImport()).toBeNull();
    });

    it("ブラウザ内の保存を使えないと、開いたときに札割りのデータを読み込めなかったことを警告で出す", async () => {
      // 準備：どの操作も失敗する保存先に差し替える
      resetPlanDataCache({ storage: failingStorage() });

      // 実行
      await renderImportScreen({ master: "success", plan: "error" });

      // 検証
      await findAlertContaining(PLAN_LOAD_FAILED);
    });

    it("IndexedDB を開けないブラウザでは、「取り込む」を押しても「取り込みました」を出さず、保存できなかったことを警告で出す", async () => {
      // 準備：indexedDB.open が失敗する本物の保存先に差し替える（前提として、読み込みが失敗することを先に確かめる）
      const unavailable = openStorageWithoutIndexedDB().storage;
      await expect(unavailable.loadLastImport()).rejects.toThrow();
      resetPlanDataCache({ storage: unavailable });
      const user = await renderImportScreen({ master: "success", plan: "error" });

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      await findAlertContaining(SAVE_FAILED_REASON);
      expectNoDoneRegion();
    });

    it("保存（saveImport）に失敗したら、「取り込みました」を出さずに理由を警告で出し、最終取り込みは変わらない", async () => {
      // 準備：前の取り込みがある状態で、保存だけを失敗させる（空きが足りないなど）
      await seedPreviousImport();
      vi.spyOn(storage, "saveImport").mockRejectedValue(new DOMException("空きが足りません", "QuotaExceededError"));
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      await findAlertContaining(SAVE_FAILED_REASON);
      expectNoDoneRegion();
      expect((await storage.loadLastImport())?.importedAt).toBe(PREVIOUS_IMPORTED_AT);
      await expectLastImport("10/15 20:40", 5);
    });
  });
});
