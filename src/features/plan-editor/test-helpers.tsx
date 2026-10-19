// イベント定義の画面（PlanEditor）のテストの補助（テストからだけ使う。本体のコードからは使わない）
//
// - 定義の保管庫はメモリ上の偽物（createFakeRepository）を渡す。保管庫の関数は vi.fn なので、呼ばれた引数を確かめられる
// - 今の時刻は 2026-10-17 12:00（日本時間）に固定する（fixClock・restoreClock。Date だけを偽物にし、タイマーは本物のまま）
// - 画面の部品は、利用者に見える role・名前・文で探す。画面の部品の「形の約束」（テストが探す role と名前）は次のとおり
//   - 本文の区分：region「攻略の流れ」「札」「段階の詳細」（section に名前を付ける）
//   - 攻略の流れの海域の行：group（名前は海域名「E1」など）。段階のボタンは aria-pressed（選択中なら true）を持ち、
//     段階名と札名をそれぞれ別の要素の文字として持つ。行の「＋」はボタン「段階を追加」、開くメニューは role="menu"（項目は menuitem）
//   - 札の一覧：区分「札」の中の listitem（「n 段階」の文を含むもの）
//   - 段階の詳細の特効グループ：group（名前は「特効グループ」で始まる）。中に spinbutton「倍率」、textbox「グループ名」、
//     艦名のタグ（艦名だけの文字の要素）と、その × ボタン（名前「（艦名）を外す」または「（艦名）を削除」）
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { expect, type Mock, vi } from "vitest";
import type { Stage } from "@/domain/definition";
import type { DefinitionDoc } from "@/domain/definition-edit";
import { type Mutable, summer2026Definition } from "@/test/fixtures";
import { deepFreeze } from "@/test/fixtures/freeze";
import { PlanEditor } from "./PlanEditor";
import type {
  BaseEventOption,
  DefinitionRepository,
  EditableEvent,
  EditorMember,
  EditorUser,
  PlanEditorData,
  PublishResult,
  SaveDraftInput,
} from "./types";

// ---- 時刻 ----

/** テストの今の時刻（2026-10-17 12:00 日本時間） */
export const NOW = new Date("2026-10-17T12:00:00+09:00");

/** 今の時刻を NOW に固定する（beforeEach で呼ぶ）。Date だけを偽物にし、タイマーは本物のまま */
export function fixClock(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
}

/** 時刻を元に戻す（afterEach で呼ぶ） */
export function restoreClock(): void {
  vi.useRealTimers();
}

// ---- 人 ----

/** ログイン中の管理者 */
export const ADMIN: EditorUser = { displayName: "テスト管理者", role: "admin" };
/** ログイン中の協力者 */
export const COLLAB: EditorUser = { displayName: "協力者A", role: "collab" };
/** 編集できる人（PR-12b：利用者の ID を持つ。編集中の表示の名前・保存の記録の「誰が」を ID で引くため） */
export const MEMBERS: readonly EditorMember[] = [
  { userId: "user-admin", displayName: "テスト管理者", role: "admin" },
  { userId: "user-a", displayName: "協力者A", role: "collab" },
  { userId: "user-b", displayName: "協力者B", role: "collab" },
];

// ---- イベントと文書 ----

/** 最新のイベント（2026夏イベ）の ID・名前・開始日時（src/test/fixtures/summer2026Definition.ts と同じ） */
export const LATEST_EVENT_ID = "2026-summer";
export const LATEST_NAME = "2026夏イベ";
export const LATEST_START = "2026-08-07T12:00:00+09:00";
/** 最新のイベントの共有の下書きの版 */
export const DRAFT_VERSION = 7;

/** 新規作成の「元にするイベント」に使う過去のイベント（2025秋イベ） */
export const AUTUMN_EVENT_ID = "2025-autumn";

/**
 * 2025秋イベの文書（新規作成の元にするイベント。最新のイベントと札・段階を見分けられるようにした小さな定義）
 * - 海域：E1、E2。札：機動部隊（kido）、輸送部隊（yuso）
 * - 段階：E1「ゲージ1」（機動部隊・普通・特効あり）、E2「ゲージ2 輸送」（輸送部隊・重要・特効あり）
 */
export const autumn2025Definition: DefinitionDoc = deepFreeze({
  schemaVersion: 1,
  event: {
    id: AUTUMN_EVENT_ID,
    name: "2025秋イベ",
    startAt: "2025-11-14T11:00:00+09:00",
    endAt: "2025-12-02T11:00:00+09:00",
    versionDate: "2025-11-20",
  },
  areas: [
    { id: "E1", name: "E1" },
    { id: "E2", name: "E2" },
  ],
  fudas: [
    { id: "kido", name: "機動部隊", color: "#4C8DF6", gameNumber: 1 },
    { id: "yuso", name: "輸送部隊", color: "#3FB37F", gameNumber: 2 },
  ],
  stages: [
    {
      id: "A-E1-1",
      areaId: "E1",
      name: "ゲージ1",
      fudaId: "kido",
      importance: "normal",
      boosts: [{ id: "A-E1-1-A", name: "機動部隊A", multiplier: 1.2, shipNames: ["瑞鶴", "翔鶴"] }],
    },
    {
      id: "A-E2-1",
      areaId: "E2",
      name: "ゲージ2 輸送",
      fudaId: "yuso",
      importance: "important",
      boosts: [{ id: "A-E2-1-A", name: "輸送A", multiplier: 1.15, shipNames: ["鬼怒"] }],
    },
  ],
});

/** 新規作成の「元にするイベント」の候補 */
export const BASE_EVENT_OPTIONS: readonly BaseEventOption[] = [
  { id: LATEST_EVENT_ID, name: LATEST_NAME },
  { id: AUTUMN_EVENT_ID, name: "2025秋イベ" },
];

/** 2026夏イベの文書を複製して書き換え、凍結して返す（画面が文書を書き換えたら例外になるようにする） */
export function makeDoc(change?: (draft: Mutable<DefinitionDoc>) => void): DefinitionDoc {
  const draft = JSON.parse(JSON.stringify(summer2026Definition)) as Mutable<DefinitionDoc>;
  change?.(draft);
  return deepFreeze(draft);
}

/** makeEvent の指定 */
export interface EventOptions {
  id?: string;
  name?: string;
  startAt?: string;
  /** 保存済みの終了日時（省略時は未定の null） */
  endAt?: string | null;
  /** 下書きの文書（event はこのイベントの ID・名前・日時に書き直す）。省略時は 2026夏イベの定義 */
  draftContent?: DefinitionDoc;
  draftVersion?: number;
  updatedByName?: string;
  updatedAt?: string;
  /** 公開中の版の文書（event は同じく書き直す）。null ならまだ公開していない。省略時は 2026夏イベの定義（下書きと同じ内容） */
  publishedContent?: DefinitionDoc | null;
  /** 公開中の版の日付（省略時は "2026-08-04"） */
  versionDate?: string;
}

/**
 * 編集するイベントを作る（省略時は 2026夏イベ：開始 2026/08/07 12:00、終了日時は未定、下書きは版 7〔10/15 22:40 に協力者Aが保存〕、
 * 公開中は 2026/08/04 版で下書きと同じ内容＝未公開の変更なし）
 */
export function makeEvent(options: EventOptions = {}): EditableEvent {
  const id = options.id ?? LATEST_EVENT_ID;
  const name = options.name ?? LATEST_NAME;
  const startAt = options.startAt ?? LATEST_START;
  const endAt = options.endAt === undefined ? null : options.endAt;
  const withEvent = (doc: DefinitionDoc): DefinitionDoc =>
    deepFreeze({ ...doc, event: { ...doc.event, id, name, startAt, endAt } });
  const publishedContent = options.publishedContent === undefined ? summer2026Definition : options.publishedContent;
  return {
    id,
    name,
    startAt,
    endAt,
    draft: {
      version: options.draftVersion ?? DRAFT_VERSION,
      content: withEvent(options.draftContent ?? summer2026Definition),
      updatedByName: options.updatedByName ?? "協力者A",
      updatedAt: options.updatedAt ?? "2026-10-15T22:40:00+09:00",
    },
    published:
      publishedContent === null
        ? null
        : { versionDate: options.versionDate ?? "2026-08-04", content: withEvent(publishedContent) },
  };
}

/** 画面を開いたときに読むものを作る（省略時は管理者・最新のイベントは makeEvent()・未公開の新規イベントなし） */
export function makeData(overrides: Partial<PlanEditorData> = {}): PlanEditorData {
  return {
    user: ADMIN,
    latestEvent: makeEvent(),
    unpublishedEvent: null,
    members: MEMBERS,
    baseEventOptions: BASE_EVENT_OPTIONS,
    ...overrides,
  };
}

// ---- 保管庫の偽物 ----

/** 保管庫の偽物（関数はすべて vi.fn） */
export type FakeRepository = { [Key in keyof DefinitionRepository]: Mock<DefinitionRepository[Key]> };

/** 公開の結果（偽物の既定） */
export const PUBLISH_RESULT: PublishResult = {
  status: "published",
  id: "published-1",
  versionLabel: "2026/10/17 版",
  versionDate: "2026-10-17",
};

/** 新規作成したイベントの ID（偽物の既定） */
export const CREATED_EVENT_ID = "new-event";

/**
 * 保管庫の偽物を作る。既定の動き
 * - load：data を返す
 * - saveDraft：保存したことにして、版を 1 増やした値を返す
 * - publish：PUBLISH_RESULT（2026/10/17 版）を返す
 * - createEvent：ID「new-event」・版 1 を返す
 * - updateEventMeta：成功する
 * - loadEventContent：2026夏イベ・2025秋イベの文書を返す（ほかは失敗）
 */
export function createFakeRepository(data: PlanEditorData = makeData()): FakeRepository {
  const contents: Readonly<Record<string, DefinitionDoc>> = {
    [LATEST_EVENT_ID]: summer2026Definition,
    [AUTUMN_EVENT_ID]: autumn2025Definition,
  };
  return {
    load: vi.fn<DefinitionRepository["load"]>(async () => data),
    saveDraft: vi.fn<DefinitionRepository["saveDraft"]>(async (input) => ({
      status: "saved",
      version: input.baseVersion + 1,
    })),
    publish: vi.fn<DefinitionRepository["publish"]>(async () => PUBLISH_RESULT),
    createEvent: vi.fn<DefinitionRepository["createEvent"]>(async () => ({
      eventId: CREATED_EVENT_ID,
      draftVersion: 1,
    })),
    updateEventMeta: vi.fn<DefinitionRepository["updateEventMeta"]>(async () => undefined),
    loadEventContent: vi.fn<DefinitionRepository["loadEventContent"]>(async (eventId) => {
      const doc = Object.hasOwn(contents, eventId) ? contents[eventId] : undefined;
      if (doc === undefined) throw new Error(`イベント ${eventId} がありません（テスト）`);
      return doc;
    }),
  };
}

// ---- 描画 ----

export interface RenderEditorOptions {
  /** 保管庫（省略時は data から createFakeRepository で作る） */
  repository?: FakeRepository;
  /** 艦船マスタにある改装段階を問わない艦名の集合（省略時は渡さない） */
  knownShipNames?: ReadonlySet<string>;
}

export interface RenderedEditor {
  user: UserEvent;
  repository: FakeRepository;
}

/** 定義画面を描き、読み込みが済む（「攻略の流れ」が出る）まで待つ */
export async function renderEditor(
  data: PlanEditorData = makeData(),
  options: RenderEditorOptions = {},
): Promise<RenderedEditor> {
  const user = userEvent.setup();
  const repository = options.repository ?? createFakeRepository(data);
  render(<PlanEditor repository={repository} knownShipNames={options.knownShipNames} />);
  await screen.findByRole("region", { name: "攻略の流れ" });
  return { user, repository };
}

// ---- 文の探し方 ----

/** 空白（改行・全角空白を含む）を 1 つの半角空白にそろえる */
function normalizeSpace(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * getByText などに渡す探し方：parts をすべて含む文を持つ要素のうち、いちばん内側の要素。
 * 文が太字などで別の要素に分かれていても、まとめた文（textContent）で探す
 */
export function textContaining(...parts: string[]): (content: string, element: Element | null) => boolean {
  const has = (element: Element): boolean => {
    const text = normalizeSpace(element.textContent);
    return parts.every((part) => text.includes(part));
  };
  return (_content, element) => element !== null && has(element) && !Array.from(element.children).some(has);
}

/** getByText などに渡す探し方：正規表現に合う文を持つ要素のうち、いちばん内側の要素 */
export function textMatching(pattern: RegExp): (content: string, element: Element | null) => boolean {
  const has = (element: Element): boolean => pattern.test(normalizeSpace(element.textContent));
  return (_content, element) => element !== null && has(element) && !Array.from(element.children).some(has);
}

/** parts をすべて含む文が画面のどこかに出ていることを確かめる */
export function expectTextShown(...parts: string[]): void {
  expect(screen.queryAllByText(textContaining(...parts)).length, `「${parts.join("」「")}」の文`).toBeGreaterThan(0);
}

/** parts をすべて含む文が画面に出ていないことを確かめる */
export function expectTextNotShown(...parts: string[]): void {
  expect(screen.queryAllByText(textContaining(...parts)), `「${parts.join("」「")}」の文`).toHaveLength(0);
}

/** 正規表現に合う文が画面のどこかに出ていることを確かめる */
export function expectTextMatching(pattern: RegExp): void {
  expect(screen.queryAllByText(textMatching(pattern)).length, `${String(pattern)} に合う文`).toBeGreaterThan(0);
}

/** 要素と子孫のうち、自分の文字（子の要素の文字を除く）を持つものの文字の一覧 */
export function ownTexts(element: Element): string[] {
  return [element, ...Array.from(element.querySelectorAll("*"))]
    .map((el) =>
      Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim(),
    )
    .filter((text) => text !== "");
}

// ---- 本文の区分 ----

/** 区分「攻略の流れ」 */
export function flowRegion(): HTMLElement {
  return screen.getByRole("region", { name: "攻略の流れ" });
}

/** 区分「札」（札の一覧） */
export function fudaRegion(): HTMLElement {
  return screen.getByRole("region", { name: "札" });
}

/** 区分「段階の詳細」 */
export function detailRegion(): HTMLElement {
  return screen.getByRole("region", { name: "段階の詳細" });
}

// ---- 攻略の流れ ----

/** 攻略の流れの海域の行 */
export function areaRow(areaName: string): HTMLElement {
  return within(flowRegion()).getByRole("group", { name: areaName });
}

/** 攻略の流れの海域の行（なければ null） */
export function queryAreaRow(areaName: string): HTMLElement | null {
  return within(flowRegion()).queryByRole("group", { name: areaName });
}

/** 海域の行の段階のボタン（左から順） */
export function stageButtons(areaName: string): HTMLElement[] {
  return within(areaRow(areaName))
    .queryAllByRole("button")
    .filter((button) => button.hasAttribute("aria-pressed"));
}

/** 海域の行の、段階名が stageName の段階のボタン */
export function stageButton(areaName: string, stageName: string): HTMLElement {
  const found = stageButtons(areaName).filter((button) => ownTexts(button).includes(stageName));
  expect(found, `${areaName} の段階「${stageName}」のボタン`).toHaveLength(1);
  return found[0] as HTMLElement;
}

/** 海域の行の段階が、左から順に [段階名, 札名] のとおり並んでいることを確かめる */
export function expectStages(areaName: string, expected: ReadonlyArray<readonly [string, string]>): void {
  const buttons = stageButtons(areaName);
  expect(
    buttons.map((button) => ownTexts(button)),
    `${areaName} の段階の並び`,
  ).toHaveLength(expected.length);
  expected.forEach(([stageName, fudaName], index) => {
    expect(ownTexts(buttons[index] as HTMLElement)).toEqual(expect.arrayContaining([stageName, fudaName]));
  });
}

/** 段階を押して選ぶ */
export async function selectStage(user: UserEvent, areaName: string, stageName: string): Promise<void> {
  await user.click(stageButton(areaName, stageName));
}

/** 海域の行の「＋」を押して、開いたメニューを返す */
export async function openAddMenu(user: UserEvent, areaName: string): Promise<HTMLElement> {
  await user.click(within(areaRow(areaName)).getByRole("button", { name: "段階を追加" }));
  return within(areaRow(areaName)).getByRole("menu");
}

// ---- 札の一覧 ----

/** 札の一覧の行（「n 段階」の文を含む listitem。上から順） */
export function fudaItems(): HTMLElement[] {
  return within(fudaRegion())
    .queryAllByRole("listitem")
    .filter((item) => /\d+\s*段階/.test(item.textContent ?? ""));
}

/** 札名が name の札の行 */
export function fudaItem(name: string): HTMLElement {
  const found = fudaItems().filter((item) => ownTexts(item).includes(name));
  expect(found, `札「${name}」の行`).toHaveLength(1);
  return found[0] as HTMLElement;
}

// ---- 段階の詳細 ----

/** 段階の詳細の特効グループ（上から順） */
export function boostGroups(): HTMLElement[] {
  return within(detailRegion()).queryAllByRole("group", { name: /^特効グループ/ });
}

/** グループ名の欄が name の特効グループ */
export function boostGroupNamed(name: string): HTMLElement {
  const found = boostGroups().filter(
    (group) => (within(group).getByRole("textbox", { name: "グループ名" }) as HTMLInputElement).value === name,
  );
  expect(found, `特効グループ「${name}」`).toHaveLength(1);
  return found[0] as HTMLElement;
}

// ---- ボタン ----

/** 「下書きを保存」 */
export function saveDraftButton(): HTMLElement {
  return screen.getByRole("button", { name: "下書きを保存" });
}

/** 「変更を公開する」（既存を更新） */
export function publishButton(): HTMLElement {
  return screen.getByRole("button", { name: "変更を公開する" });
}

/** 「公開して最新にする」（新規作成） */
export function publishAsLatestButton(): HTMLElement {
  return screen.getByRole("button", { name: "公開して最新にする" });
}

/** 公開の確認のウィンドウ（role="alertdialog"）の名前（UI／UX の指摘 中8） */
export const PUBLISH_CONFIRM_NAME = "公開の確認";

/** 公開の確認のウィンドウが出るまで待って返す（「変更を公開する」「公開して最新にする」を押した後に出る） */
export async function findPublishConfirm(): Promise<HTMLElement> {
  return screen.findByRole("alertdialog", { name: PUBLISH_CONFIRM_NAME });
}

/** 公開の確認のウィンドウ（なければ null） */
export function queryPublishConfirm(): HTMLElement | null {
  return screen.queryByRole("alertdialog", { name: PUBLISH_CONFIRM_NAME });
}

/** 公開の確認のウィンドウで「公開する」を押す（ウィンドウが出るまで待つ） */
export async function confirmPublish(user: UserEvent): Promise<void> {
  const dialog = await findPublishConfirm();
  await user.click(within(dialog).getByRole("button", { name: "公開する" }));
}

/**
 * 特効グループの「追加する艦名」の入力欄（「＋ 艦名」を押した後に出る）。
 * 艦名の候補（datalist など）を付けると role が textbox から combobox に変わるため、ラベルで探す（UI／UX の指摘 中10）
 */
export function shipNameInput(group: HTMLElement): HTMLInputElement {
  return within(group).getByLabelText("追加する艦名") as HTMLInputElement;
}

/** 特効グループの「追加する艦名」の入力欄（なければ null） */
export function queryShipNameInput(group: HTMLElement): HTMLInputElement | null {
  return within(group).queryByLabelText("追加する艦名") as HTMLInputElement | null;
}

/** 新規作成に切り替える（管理者） */
export async function switchToCreate(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("radio", { name: "新規作成" }));
}

// ---- 日時の入力欄 ----

/** 入力欄にフォーカスを移す（フォーカスが移ったことを画面に伝える） */
export function focusInput(input: HTMLElement): void {
  act(() => {
    input.focus();
  });
}

/** 入力欄からフォーカスを外す（確定。onBlur が呼ばれる） */
export function blurInput(input: HTMLElement): void {
  act(() => {
    input.blur();
  });
}

/** 日時の入力欄（datetime-local）にフォーカスを移して値を変える（確定はしない。確定は blurInput） */
export function enterDateTime(input: HTMLElement, value: string): void {
  focusInput(input);
  fireEvent.change(input, { target: { value } });
}

// ---- 保管庫に渡したもの ----

/** n 回目（1 から数える）の下書きの保存の入力（呼ばれるまで待つ） */
export async function savedDraftInput(repository: FakeRepository, nth = 1): Promise<SaveDraftInput> {
  await waitFor(() => {
    expect(repository.saveDraft).toHaveBeenCalledTimes(nth);
  });
  const input = repository.saveDraft.mock.calls[nth - 1]?.[0];
  if (input === undefined) throw new Error(`${nth} 回目の下書きの保存の入力がありません`);
  return input;
}

/** 文書の海域の段階（並び順） */
export function stagesIn(doc: DefinitionDoc, areaId: string): Stage[] {
  return doc.stages.filter((stage) => stage.areaId === areaId);
}

/** 文書の段階（なければテストの書き間違いとして例外） */
export function stageIn(doc: DefinitionDoc, stageId: string): Stage {
  const stage = doc.stages.find((s) => s.id === stageId);
  if (stage === undefined) throw new Error(`段階 ${stageId} がありません`);
  return stage;
}
