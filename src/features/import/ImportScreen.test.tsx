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
// - 確認の件数は、すべてのイベントの割り当ての合計のまま、「保存しているすべてのイベントの割り当てのうち n 件が外れます」
//   の趣旨の文で分かるようにする（PR-04b のレビューの提案を受けて）
//
// PR-04b のレビュー・Codex の指摘を受けて足したもの
// - レビュー担当の確認用テスト（P1〜P6。今の実装で通る守りのテスト）
// - 取り込みの途中で公開定義が読めても、保存の後に札割りのデータを読み直す（Codex の指摘）
// - 取り込みの処理中と確認の間は、貼り付け欄・取り込む範囲・Lv 下限の欄とボタンを操作できない（Codex の指摘）
// - 同じ失敗を続けたら警告を作り直す・すぐ選べる Lv の今の値に aria-pressed（レビューの提案）
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseImportText } from "@/domain/import";
import { createShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { ImportScreen } from "@/features/import/ImportScreen";
import { LATEST_DEFINITION_PATH, resetLatestDefinitionCache, useLatestDefinition } from "@/lib/definition";
import { resetPlanDataCache, usePlanData } from "@/lib/plan";
import { resetShipMasterCache, SHIP_MASTER_PATH, useShipMaster } from "@/lib/ship-master";
import type { FudawariStorage, SaveImportInput, SaveImportResult } from "@/lib/storage";
import { expectInDocumentOrder } from "@/test/dom-order";
import { type FetchMock, stubFetch, textResponse } from "@/test/definition-fetch";
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
/** 最新でない別のイベントの ID（保存先に割り当てが残っている前のイベント） */
const OTHER_EVENT_ID = "2026-spring";
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

/**
 * 確認に書く「n件が外れます」。
 * 文は「保存しているすべてのイベントの割り当てのうち n 件が外れます」の趣旨にする（2026-10-17 親の決定）ため、
 * 前の文（「n件の割り当てが外れます」）と新しい文のどちらでも、件数と「外れます」が続いていればよい
 */
function willRemoveText(count: number): RegExp {
  return new RegExp(`${count}\\s*件(?:の割り当て)?が外れます`);
}

/** 確認に書く「すべてのイベント」（件数がすべてのイベントの合計であることが分かる語句） */
const ALL_EVENTS_PHRASE = "すべてのイベント";

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

/**
 * 読み込みの状態（艦船マスタ・札割りのデータ）。
 * 公開定義を読み込めない・読み込み中のときは、札割りのデータは待機中（idle）になる
 */
interface ExpectedLoad {
  master: "loading" | "success" | "error";
  plan: "idle" | "ready" | "error";
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

/** 止めておいた処理（保存先の操作・公開定義の取得）の続け方 */
interface HeldCall {
  /** 止めた処理が呼ばれたら解決する */
  readonly reached: Promise<void>;
  /** 止めていた処理を続ける */
  release(): void;
  /** 止めていた処理を、本物を呼ばずに失敗させる */
  fail(error?: unknown): void;
}

/** release／fail まで待たせる門と、届いたことの知らせを作る */
function createGate(defaultError: () => unknown): HeldCall & { arrive(): void; gate: Promise<void> } {
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
  // 届く前に fail しても、未処理の失敗として報告しない（届いた呼び出しには失敗が伝わる）
  gate.catch(() => {});
  return {
    reached,
    arrive: () => arrive(),
    gate,
    release: () => open(),
    fail: (error: unknown = defaultError()) => reject(error),
  };
}

/**
 * このテストの保存先の previewImport・saveImport を、release／fail まで止める（取り込みの処理中の場面を作るため）。
 * 画面は getPlanStorage()（この保存先を包んだもの。呼ぶたびに中のメソッドを読む）から呼ぶので、vi.spyOn で止められる。
 * 前の取り込みを保存した後に呼ぶ（止めた後の呼び出しは、すべて同じ門を待つ）
 */
function holdStorageCall(method: "previewImport" | "saveImport"): HeldCall {
  const real: (input: SaveImportInput) => Promise<SaveImportResult> = storage[method].bind(storage);
  const held = createGate(() => new DOMException("空きが足りません", "QuotaExceededError"));
  vi.spyOn(storage, method).mockImplementation(async (input: SaveImportInput) => {
    held.arrive();
    await held.gate;
    return real(input);
  });
  return held;
}

/** 公開定義の取得を release まで止める（ほかの静的ファイル〔艦船マスタ〕はすぐに返す） */
function holdDefinitionFetch(): HeldCall {
  const held = createGate(() => new TypeError("Failed to fetch"));
  respondWithStaticData(fetchMock, {
    [LATEST_DEFINITION_PATH]: async () => {
      held.arrive();
      await held.gate;
      return textResponse(JSON.stringify(summer2026Definition));
    },
  });
  return held;
}

/**
 * 取り込みの処理中と確認の間に操作できなくする部品
 * - "text"：貼り付け欄・Lv 下限の欄（disabled か readOnly）
 * - "choice"：取り込む範囲の選択肢・Lv 下限のボタン（disabled。readOnly は選択肢・ボタンには効かない）
 * - "import"：「取り込む」（disabled か aria-disabled="true"。押せない間もフォーカスを残すため aria-disabled を使っている）
 */
type LockKind = "text" | "choice" | "import";

interface LockableControl {
  /** 失敗したときに読める名前 */
  label: string;
  element: HTMLElement;
  kind: LockKind;
}

/**
 * 取り込みの処理中と確認の間に操作できなくする部品の一覧。
 * 確認を開いている間は、後ろの画面が支援技術から隠される（aria-hidden）ため、隠れた部品も探す
 */
function lockableControls(): LockableControl[] {
  const byRole = (role: string, name: string | RegExp): HTMLElement =>
    screen.getByRole(role, { name, hidden: true });
  return [
    { label: "貼り付け欄", element: byRole("textbox", "艦娘の情報を貼り付け"), kind: "text" },
    { label: "すべての艦娘", element: byRole("radio", /^すべての艦娘/), kind: "choice" },
    { label: "ロック済みだけ", element: byRole("radio", /^ロック済みだけ/), kind: "choice" },
    { label: "Lv下限の欄", element: byRole("spinbutton", /Lv\s*下限/), kind: "text" },
    { label: "Lv下限を下げる", element: byRole("button", /下げる/), kind: "choice" },
    { label: "Lv下限を上げる", element: byRole("button", /上げる/), kind: "choice" },
    ...["Lv1", "Lv50", "Lv99", "Lv150"].map(
      (preset): LockableControl => ({ label: preset, element: byRole("button", preset), kind: "choice" }),
    ),
    { label: "取り込む", element: byRole("button", "取り込む"), kind: "import" },
  ];
}

/** 部品が disabled か（disabled 属性、または disabled の fieldset の中） */
function isDisabled(element: HTMLElement): boolean {
  return element.hasAttribute("disabled") || element.closest("fieldset[disabled]") !== null;
}

/** 部品を操作できない状態か */
function isLocked({ element, kind }: LockableControl): boolean {
  switch (kind) {
    case "text":
      return (
        isDisabled(element) ||
        ((element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) && element.readOnly)
      );
    case "choice":
      return isDisabled(element);
    case "import":
      return isDisabled(element) || element.getAttribute("aria-disabled") === "true";
  }
}

/** まだ操作できる部品の名前 */
function operableControlLabels(): string[] {
  return lockableControls()
    .filter((control) => !isLocked(control))
    .map((control) => control.label);
}

/** 操作できなくなっている部品の名前 */
function lockedControlLabels(): string[] {
  return lockableControls()
    .filter(isLocked)
    .map((control) => control.label);
}

/** すべての部品を操作できなくなるまで待つ（できなければ、まだ操作できる部品の名前を出して失敗する） */
async function expectControlsLocked(): Promise<void> {
  await waitFor(() => expect(operableControlLabels()).toEqual([]));
}

/** すべての部品を操作できるようになるまで待つ（できなければ、操作できない部品の名前を出して失敗する） */
async function expectControlsOperable(): Promise<void> {
  await waitFor(() => expect(lockedControlLabels()).toEqual([]));
}

/** text を含む警告（role="alert"）の一覧 */
function alertsContaining(text: string): HTMLElement[] {
  return screen.queryAllByRole("alert").filter((alert) => (alert.textContent ?? "").includes(text));
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

    it("Lv 下限の欄に 200 を打って欄を離れると 185 に、0 を打って欄を離れると 1 に収める（PR-04b のレビューの確認 P5）", async () => {
      // 準備
      const user = await renderImportScreen();

      // 実行・検証：200 を打って、貼り付け欄を押して離れる
      await typeMinLevel(user, 200);
      await user.click(pasteBox());
      expect(lvInput()).toHaveValue(185);

      // 実行・検証：0 を打って、Tab で離れる
      await typeMinLevel(user, 0);
      await user.tab();
      expect(lvInput()).toHaveValue(1);
    });
  });

  describe("すぐ選べる Lv の押された状態（aria-pressed。PR-04b のレビューの提案）", () => {
    const PRESETS = ["Lv1", "Lv50", "Lv99", "Lv150"] as const;

    /** すぐ選べる Lv のボタンごとの aria-pressed（属性がなければ null） */
    function pressedStates(): Record<string, string | null> {
      return Object.fromEntries(
        PRESETS.map((preset) => [preset, screen.getByRole("button", { name: preset }).getAttribute("aria-pressed")]),
      );
    }

    /**
     * pressed のボタンだけが aria-pressed="true" で、ほかは "false"
     * （押して切り替えるボタンであることが支援技術に伝わるよう、押されていないボタンにも "false" を付ける）
     */
    function onlyPressed(pressed: (typeof PRESETS)[number] | null): Record<string, string> {
      return Object.fromEntries(PRESETS.map((preset) => [preset, preset === pressed ? "true" : "false"]));
    }

    it("最初（Lv 下限 1）は「Lv1」だけが aria-pressed=\"true\" で、ほかは \"false\"", async () => {
      // 準備・実行
      await renderImportScreen();

      // 検証
      expect(pressedStates()).toEqual(onlyPressed("Lv1"));
    });

    it.each(["Lv50", "Lv99", "Lv150"] as const)(
      "「%s」を押すと、そのボタンだけが aria-pressed=\"true\" になる",
      async (preset) => {
        // 準備
        const user = await renderImportScreen();

        // 実行
        await user.click(screen.getByRole("button", { name: preset }));

        // 検証
        expect(pressedStates()).toEqual(onlyPressed(preset));
      },
    );

    it("すぐ選べる値でない Lv（120）を打つと、どのボタンも aria-pressed=\"true\" にならない", async () => {
      // 準備
      const user = await renderImportScreen();

      // 実行
      await typeMinLevel(user, 120);

      // 検証
      expect(pressedStates()).toEqual(onlyPressed(null));
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

    it("「取り込む」を同じ描画のうちに 2 回押しても、previewImport・saveImport は 1 回だけ呼ぶ（PR-04b のレビューの確認 P1）", async () => {
      // 準備
      const previewImport = vi.spyOn(storage, "previewImport");
      const saveImport = vi.spyOn(storage, "saveImport");
      const user = await renderImportScreen();
      await pasteText(user, standardSvdataText);

      // 実行：次の描画を待たずに 2 回押す
      act(() => {
        importButton().click();
        importButton().click();
      });

      // 検証
      await findDoneRegion();
      expect(previewImport).toHaveBeenCalledTimes(1);
      expect(saveImport).toHaveBeenCalledTimes(1);
    });
  });

  describe("取り込みの途中で公開定義が読めたとき（PR-04b の Codex の指摘）", () => {
    it("「取り込む」を押した時点で公開定義が読み込み中でも、保存の後に札割りのデータを読み直し、最終取り込みが今回の日時と隻数（10/17 21:40 ／ 3隻）になる", async () => {
      // 準備：前の取り込み（5 隻、10/15 20:40）を保存し、公開定義の取得と previewImport・saveImport を止めておく
      await seedPreviousImport();
      const definitionFetch = holdDefinitionFetch();
      const previewImport = holdStorageCall("previewImport");
      const saveImport = holdStorageCall("saveImport");
      const user = await renderImportScreen({ master: "success", plan: "idle" });
      await definitionFetch.reached;
      // 前提：定義の読み込み中は、札割りのデータを読んでいない（最終取り込みを出していない）
      expect(screen.queryByText(/^最終取り込み/)).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Lv99" }));

      // 実行：定義の読み込み中に取り込み、previewImport を待つ間に定義が読める
      await pasteAndImport(user, standardSvdataText);
      await previewImport.reached;
      definitionFetch.release();
      expect(
        await screen.findByText(new RegExp(`${PROBE_LABEL}マスタ＝success／札割り＝(?:loading|ready)`)),
      ).toBeInTheDocument();
      previewImport.release();
      // 札割りのデータは、保存の前の中身（前の取り込み）を読み終える。その後で保存を続ける
      await expectLastImport("10/15 20:40", 5);
      await saveImport.reached;
      saveImport.release();

      // 検証：保存の後に読み直し、今回の取り込みを出す
      await findDoneRegion();
      await expectLastImport("10/17 21:40", 3);
    });
  });

  describe("取り込みの処理中は、入力を操作できない（PR-04b の Codex の指摘）", () => {
    it("外れる割り当ての件数を数えている間（previewImport の待ち）は、貼り付け欄・取り込む範囲・Lv 下限の欄とボタンを操作できず、取り込み終えたら操作できる", async () => {
      // 準備
      const user = await renderImportScreen();
      const previewImport = holdStorageCall("previewImport");
      await pasteText(user, standardSvdataText);
      await expectControlsOperable();

      // 実行
      await user.click(importButton());
      await previewImport.reached;

      // 検証：処理中
      await expectControlsLocked();

      // 実行・検証：終わった後
      previewImport.release();
      await findDoneRegion();
      await expectControlsOperable();
    });

    it("保存している間（saveImport の待ち）は、貼り付け欄・取り込む範囲・Lv 下限の欄とボタンを操作できず、取り込み終えたら操作できる", async () => {
      // 準備
      const user = await renderImportScreen();
      const saveImport = holdStorageCall("saveImport");
      await pasteText(user, standardSvdataText);

      // 実行
      await user.click(importButton());
      await saveImport.reached;

      // 検証：処理中
      await expectControlsLocked();

      // 実行・検証：終わった後
      saveImport.release();
      await findDoneRegion();
      await expectControlsOperable();
    });

    it("保存に失敗して終わったときも、理由の警告を出した後は操作できる", async () => {
      // 準備
      const user = await renderImportScreen();
      const saveImport = holdStorageCall("saveImport");
      await pasteText(user, standardSvdataText);
      await user.click(importButton());
      await saveImport.reached;
      await expectControlsLocked();

      // 実行
      saveImport.fail();

      // 検証
      await findAlertContaining(SAVE_FAILED_REASON);
      expectNoDoneRegion();
      await expectControlsOperable();
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

    it("確認の「外して取り込む」を同じ描画のうちに 2 回押しても、saveImport は 1 回だけ呼ぶ（PR-04b のレビューの確認 P2）", async () => {
      // 準備：保存の見張りは、前の取り込みを保存した後に付ける
      const user = await openWithAssignments();
      const saveImport = vi.spyOn(storage, "saveImport");
      const dialog = await importLockedOnly(user);
      const confirmButton = within(dialog).getByRole("button", { name: CONFIRM_BUTTON });

      // 実行：次の描画を待たずに 2 回押す
      act(() => {
        confirmButton.click();
        confirmButton.click();
      });

      // 検証
      await findDoneRegion();
      expect(saveImport).toHaveBeenCalledTimes(1);
    });

    it("確認を開くとフォーカスは「やめる」にあり、Esc で閉じると保存せず、フォーカスは「取り込む」に戻る（PR-04b のレビューの確認 P3）", async () => {
      // 準備：保存の見張りは、前の取り込みを保存した後に付ける
      const user = await openWithAssignments();
      const saveImport = vi.spyOn(storage, "saveImport");
      const dialog = await importLockedOnly(user);
      await waitFor(() => expect(within(dialog).getByRole("button", { name: CANCEL_BUTTON })).toHaveFocus());

      // 実行
      await user.keyboard("{Escape}");

      // 検証
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(saveImport).not.toHaveBeenCalled();
      await waitFor(() => expect(importButton()).toHaveFocus());
      expect(importButton()).toHaveAttribute("aria-disabled", "false");
    });

    it("確認を開いている間は、貼り付け欄・取り込む範囲・Lv 下限の欄とボタンを操作できず、「やめる」で閉じたら操作できる（PR-04b の Codex の指摘）", async () => {
      // 準備
      const user = await openWithAssignments();
      const dialog = await importLockedOnly(user);

      // 検証：確認の間
      await expectControlsLocked();

      // 実行・検証：「やめる」で閉じた後
      await user.click(within(dialog).getByRole("button", { name: CANCEL_BUTTON }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      await expectControlsOperable();
    });

    it("確認の文で、件数が保存しているすべてのイベントの割り当ての合計だと分かる（「すべてのイベント」と、2 つのイベントの合計 3 件。PR-04b のレビューの提案）", async () => {
      // 準備：最新イベント（103・105 の 2 件が外れる）に加え、別のイベントにも割り当てを保存しておく（103 の 1 件が外れ、101 は残る）
      await seedPreviousImport(ASSIGNED);
      await storage.saveAssignments(OTHER_EVENT_ID, { "101": "e1", "103": "e2" });
      const user = await renderImportScreen();

      // 実行
      const dialog = await importLockedOnly(user);

      // 検証
      expect(dialog).toHaveTextContent(ALL_EVENTS_PHRASE);
      expect(dialog).toHaveTextContent(willRemoveText(3));
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

    it("同じ失敗を続けて起こしたとき（何も貼り付けずに 2 回押す）も、2 回目に警告を作り直す（読み上げ直されるように。PR-04b のレビューの提案）", async () => {
      // 準備：1 回目の警告を出しておく
      const user = await renderImportScreen();
      await user.click(importButton());
      const first = await findAlertContaining(EMPTY_MESSAGE);

      // 実行
      await user.click(importButton());

      // 検証：同じ理由の警告が 1 つだけあり、1 回目の要素とは別のもの（1 回目の要素は外れている）
      await waitFor(() => {
        expect(alertsContaining(EMPTY_MESSAGE)).toHaveLength(1);
        expect(first.isConnected, "1 回目の警告の要素が残っている（作り直していない）").toBe(false);
      });
    });
  });

  describe("艦船マスタ・公開定義・ブラウザ内の保存が使えないとき（読み込み中を含む）", () => {
    it("艦船マスタの読み込み中は、「取り込む」が aria-disabled=\"true\" で説明「艦船マスタを読み込んでいます」が付き、押しても取り込まず警告も出さない（PR-04b のレビューの確認 P6）", async () => {
      // 準備：艦船マスタの取得を返さないままにする
      respondWithStaticData(fetchMock, {
        [SHIP_MASTER_PATH]: () => new Promise<Response>(() => {}),
      });
      const previewImport = vi.spyOn(storage, "previewImport");
      const user = await renderImportScreen({ master: "loading", plan: "ready" });

      // 検証：押す前
      expect(importButton()).toHaveAttribute("aria-disabled", "true");
      expect(importButton()).toHaveAccessibleDescription("艦船マスタを読み込んでいます");

      // 実行
      await user.click(importButton());

      // 検証：押した後
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(previewImport).not.toHaveBeenCalled();
      expectNoDoneRegion();
    });

    it("公開定義を読み込めない（404）ときも、取り込んで保存できる（PR-04b のレビューの確認 P4）", async () => {
      // 準備：公開定義だけを 404 にし、定義の警告が出るまで待つ
      respondWithStaticData(fetchMock, {
        [LATEST_DEFINITION_PATH]: () => new Response("Not Found", { status: 404 }),
      });
      const user = await renderImportScreen({ master: "success", plan: "idle" });
      await findAlertContaining("イベントの定義を読み込めませんでした");

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      expect(doneLine(await findDoneRegion(), "艦娘")).toHaveTextContent(/艦娘\s*5\s*隻/);
      await waitFor(async () => expect(await storedUids()).toEqual(["101", "102", "103", "104", "105"]));
    });

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

  // UI／UX の指摘 中7（親が決めた直し方。ユーザーの承認済み）
  // - 取り込み直し（前の取り込みがあり、個体 ID で割り当てを引き継いだ）のとき、完了の表示に「札割り n 隻を引き継ぎました」を出す。
  //   n は引き継いだ割り当ての数。外した件数の表示（「n件の割り当てを外しました」）は今のまま。初回の取り込みでは出さない
  // - 札が付いている艦（taggedShipCount > 0）があるときは「差分を見る」を主なボタン（見た目の主・並びの先）にし、
  //   ないときは今のまま「割り振りへ進む」が主
  // テストで決めていないこと：引き継いだ割り当てが 0 件の取り込み直しで出すか（親の方針に書かれていないため確かめない）
  describe("取り込み直しで引き継いだ札割りの知らせと、主なボタン（UI／UX の指摘 中7）", () => {
    /** 完了の表示に書く「札割り n 隻を引き継ぎました」 */
    function keptText(count: number): RegExp {
      return new RegExp(`札割り\\s*${count}\\s*隻を引き継ぎました`);
    }

    /** 「引き継ぎました」の語句（数を問わない） */
    const KEPT_PHRASE = /引き継ぎました/;

    /** 完了の表示の「割り振りへ進む」「差分を見る」のリンク */
    function doneLinks(region: HTMLElement): { assign: HTMLElement; drift: HTMLElement } {
      return {
        assign: within(region).getByRole("link", { name: "割り振りへ進む" }),
        drift: within(region).getByRole("link", { name: "差分を見る" }),
      };
    }

    it("取り込み直しで個体 ID が同じ艦の割り当て（101・102 の 2 件）を引き継いだら、「札割り 2 隻を引き継ぎました」と出す", async () => {
      // 準備：前の取り込み（101〜105）で、最新イベントに 101・102 を割り当てておく（どちらも今回の取り込みにいる）
      await seedPreviousImport({ "101": "s31", "102": "tago" });
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      const region = await findDoneRegion();
      expect(region).toHaveTextContent(keptText(2));
      expect(region).not.toHaveTextContent(/割り当てを外しました/);
      expect(await storage.loadAssignments(EVENT_ID)).toEqual({ "101": "s31", "102": "tago" });
    });

    it("外れる割り当てがある取り込み直しで「外して取り込む」を押すと、引き継いだ数（101 の 1 隻）と外した件数（2件）の両方を出す", async () => {
      // 準備：101・103・105 を割り当てておき、「ロック済みだけ」（101・102・104）で取り込む → 103・105 が外れ、101 を引き継ぐ
      await seedPreviousImport({ "101": "s31", "103": "rengo", "105": "tago" });
      const user = await renderImportScreen();
      await user.click(lockOption("ロック済みだけ"));
      await pasteAndImport(user, standardSvdataText);
      const dialog = await screen.findByRole("alertdialog");

      // 実行
      await user.click(within(dialog).getByRole("button", { name: CONFIRM_BUTTON }));

      // 検証
      const region = await findDoneRegion();
      expect(region).toHaveTextContent(keptText(1));
      expect(region).toHaveTextContent(removedText(2));
    });

    it("初回の取り込み（前の取り込みがない）では、引き継いだ知らせを出さない", async () => {
      // 準備
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      expect(await findDoneRegion()).not.toHaveTextContent(KEPT_PHRASE);
    });

    it("個体 ID がない古い形式の取り込み直しでは、引き継げない知らせを出し、引き継いだ知らせは出さない", async () => {
      // 準備：前の取り込みで 101 を割り当てておく（古い形式ではすべての割り当てが外れるため、確認が出る）
      await seedPreviousImport({ "101": "s31" });
      const user = await renderImportScreen();
      await pasteAndImport(user, LEGACY_TEXT);
      const dialog = await screen.findByRole("alertdialog");

      // 実行
      await user.click(within(dialog).getByRole("button", { name: CONFIRM_BUTTON }));

      // 検証
      const region = await findDoneRegion();
      expect(region).toHaveTextContent(NO_UID_NOTICE);
      expect(region).not.toHaveTextContent(KEPT_PHRASE);
    });

    it("札が付いている艦がいなければ「割り振りへ進む」が先（主）、札が付いている艦がいれば「差分を見る」が先になり、主なボタンの見た目が入れ替わる", async () => {
      // 準備：札が付いている艦がいない内容（時雨改三 1 隻）を取り込む
      const user = await renderImportScreen();
      await pasteAndImport(user, KNOWN_ONLY_SVDATA_TEXT);
      const withoutTags = doneLinks(await findDoneRegion());
      expect(doneLine(await findDoneRegion(), "すでに札が付いている艦")).toHaveTextContent(/艦\s*0\s*隻/);
      // 札がないときは今のまま：「割り振りへ進む」が先で、2 つの見た目（class）は違う
      expectInDocumentOrder([withoutTags.assign, withoutTags.drift]);
      const primaryClass = withoutTags.assign.className;
      const secondaryClass = withoutTags.drift.className;
      expect(primaryClass).not.toBe(secondaryClass);

      // 実行：札が付いている艦が 2 隻（102・104）いる内容を取り込み直す
      await user.clear(pasteBox());
      await pasteAndImport(user, standardSvdataText);

      // 検証：「差分を見る」が先になり、主なボタンの見た目（札がないときの「割り振りへ進む」の class）になる
      const region = await findDoneRegion();
      await waitFor(() => expect(doneLine(region, "すでに札が付いている艦")).toHaveTextContent(/艦\s*2\s*隻/));
      const withTags = doneLinks(await findDoneRegion());
      expectInDocumentOrder([withTags.drift, withTags.assign]);
      expect(withTags.drift.className).toBe(primaryClass);
      expect(withTags.assign.className).toBe(secondaryClass);
      expect(withTags.drift).toHaveAttribute("href", "/drift");
      expect(withTags.assign).toHaveAttribute("href", "/assign");
    });
  });

  // PR #44 の独立レビューの指摘（親の決定）：前の取り込みの記録は見ず、個体 ID のある取り込みで、保存した後に
  // 最新のイベントの割り当てが残っていれば「札割り n 隻を引き継ぎました」を出す（初回は割り当てがないので出ない）
  describe("引き継いだ札割りの知らせの数え方（PR #44 の独立レビュー）", () => {
    /** 完了の表示に書く「札割り n 隻を引き継ぎました」 */
    function keptText(count: number): RegExp {
      return new RegExp(`札割り\\s*${count}\\s*隻を引き継ぎました`);
    }

    /** 「引き継ぎました」の語句（数を問わない） */
    const KEPT_PHRASE = /引き継ぎました/;

    it("「取り込んだ艦娘データを削除」（最終取り込みの記録は消え、割り当ては残る）の後に取り込み直しても、残った割り当て（2 隻）を引き継いだと出す", async () => {
      // 準備
      await seedPreviousImport({ "101": "s31", "102": "tago" });
      await storage.clearImportedShips();
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      expect(await findDoneRegion()).toHaveTextContent(keptText(2));
    });

    it("引き継いだ数は最新のイベントの割り当てだけを数え、ほかのイベントの割り当ては含めない（最新の 1 隻）", async () => {
      // 準備：最新のイベントに 101、ほかのイベントに 102・103 を割り当てておく
      await seedPreviousImport({ "101": "s31" });
      await storage.saveAssignments(OTHER_EVENT_ID, { "102": "e1", "103": "e2" });
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      expect(await findDoneRegion()).toHaveTextContent(keptText(1));
    });

    it("前の取り込みがあっても、最新のイベントで引き継いだ割り当てが 0 件なら（ほかのイベントにだけ割り当てがあっても）出さない", async () => {
      // 準備
      await seedPreviousImport({});
      await storage.saveAssignments(OTHER_EVENT_ID, { "101": "e1" });
      const user = await renderImportScreen();

      // 実行
      await pasteAndImport(user, standardSvdataText);

      // 検証
      expect(await findDoneRegion()).not.toHaveTextContent(KEPT_PHRASE);
    });
  });
});
