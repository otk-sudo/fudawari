import { render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createDeferred } from "@/test/deferred";
import { PlanEditor } from "../PlanEditor";
import {
  autumn2025Definition,
  COLLAB,
  MEMBERS,
  createFakeRepository,
  fixClock,
  LATEST_EVENT_ID,
  LATEST_NAME,
  makeData,
  makeEvent,
  ownTexts,
  restoreClock,
  switchToCreate,
  textMatching,
} from "../test-helpers";
import type { PlanEditorData } from "../types";
import type { SaveLogEntry, SaveLogKind, SaveLogLoader } from "./types";

// 保存の記録のウィンドウ（要件 3.7「保存の記録」・3.0 のウィンドウの共通の決まり、roadmap T3-10、plan-v1 の PR-12）
//
// 定義画面（PlanEditor）に loadSaveLogs（記録を読む関数）を渡して描き、利用者に見える role・名前・文で確かめる。
// 画面の部品の「形の約束」（実装担当が作る形）
// - 開くボタン：button「保存の記録を見る」（「共有の下書き：…」の横。既存の更新のときだけ。新規作成中は出さない）
// - ウィンドウ：Radix UI の Dialog。role="dialog"、名前は見出し「共有の下書きの記録」、中にイベント名を出す
//   - 右上の「×」（名前「閉じる」）、下の「閉じる」、背景の暗い部分（data-testid="save-log-dialog-overlay"）のクリックで閉じる
//   - 開いている間は後ろの画面を触れない（支援技術からも隠れる）
// - 絞り込み：combobox「誰が」（全員／各人）、「種類」（すべて／下書き保存／公開）、「海域」（すべて／定義の海域名）。
//   右に「表示件数 / 該当件数 件」（例「8 / 13 件」。空白の有無は問わない）
// - 一覧：list「記録」。1 件が 1 つの listitem で、日時（「10/15 22:52」を含む形）・誰・種類のバッジ（「下書き保存」「公開」だけの要素）・内容
// - 8 件ずつ表示し、button「さらに古い記録を表示」で 8 件足す。全部出たらボタンを出さない。絞り込みを変えたら 8 件に戻す
// - 該当なし：「条件に合う記録はありません」
// - 読み込み中：ウィンドウの中に role="status"（「読み込んでいます」を含む）。失敗：ウィンドウの中に role="alert"（理由の文を含む）
//
// テストで決めたこと（親の確認用）
// - ウィンドウを開くたびに記録を読み直す（保存した直後に開けば、その記録が出るように）
// - 「誰が」の選択肢は、全員と、記録に出てくる人（ここでは全員が記録を持つので、記録のない人を出すかは決めていない）
// - PR-12b（Codex #21-4301315082）：「誰が」は利用者の ID（save_logs.user_id）で絞り込む。同じ表示名の 2 人は別の選択肢にする
//   （記録と編集できる人に利用者の ID を持たせた。既存の記録の補助 log に userId を足しただけで、既存のテストの期待は変えていない）

const EMPTY_TEXT = "条件に合う記録はありません";

/** テストの編集できる人の表示名 → 利用者の ID（test-helpers の MEMBERS と同じ） */
const USER_IDS: Readonly<Record<string, string>> = { テスト管理者: "user-admin", 協力者A: "user-a", 協力者B: "user-b" };

/** 記録を 1 件作る（利用者の ID は、省略すれば表示名から決める） */
function log(
  id: number,
  createdAt: string,
  userName: string,
  kind: SaveLogKind,
  mapLabel: string | null,
  summary: string,
  userId: string | null = USER_IDS[userName] ?? null,
): SaveLogEntry {
  return { id, createdAt, userId, userName, kind, mapLabel, summary };
}

/**
 * 2026夏イベの保存の記録（新しい順の 13 件。モックの記録の人の名前を、テストの編集できる人に置き換えたもの）
 * - 協力者A 5 件・テスト管理者 5 件（うち公開 2 件）・協力者B 3 件
 * - 種類：下書き保存 11 件・公開 2 件。海域：E1 3 件・E2 4 件・E3 4 件・なし（公開）2 件
 */
const LOGS: readonly SaveLogEntry[] = [
  log(13, "2026-10-15T22:52:00+09:00", "協力者A", "save", "E3", "E3 ゲージ4 の特効を追加（第二十七駆逐隊 ×1.20）"),
  log(12, "2026-10-15T22:40:00+09:00", "協力者A", "save", "E2", "E2 ゲージ3 の大事さを「難所」→「重要」"),
  log(11, "2026-10-15T21:40:00+09:00", "テスト管理者", "save", "E2", "E2 ゲージ3 の特効を更新（連合艦隊C を追加）"),
  log(10, "2026-10-14T22:18:00+09:00", "協力者B", "save", "E3", "E3 ゲージ3 の札を「ウルシー攻撃部隊」→「第六艦隊」"),
  log(9, "2026-10-13T23:41:00+09:00", "協力者A", "save", "E2", "E2 ゲージ1 輸送 の段階名を変更"),
  log(8, "2026-10-12T23:05:00+09:00", "協力者B", "save", "E3", "E3 の段階を追加（ゲージ4）"),
  log(7, "2026-10-10T21:12:00+09:00", "テスト管理者", "publish", null, "公開（2026/10/10 版）"),
  log(6, "2026-10-10T20:58:00+09:00", "テスト管理者", "save", "E1", "E1 の特効を更新（第三十一戦隊 ×1.15）"),
  log(5, "2026-10-09T22:30:00+09:00", "協力者A", "save", "E2", "E2 ギミック の札を「第三十一戦隊」に変更"),
  log(4, "2026-10-08T23:59:00+09:00", "協力者B", "save", "E3", "E3 ゲージ2 輸送 を追加"),
  log(3, "2026-08-04T20:10:00+09:00", "テスト管理者", "publish", null, "公開（2026/08/04 版）"),
  log(2, "2026-08-04T19:55:00+09:00", "協力者A", "save", "E1", "E1〜E3 の札と段階を作成"),
  log(1, "2026-08-03T22:40:00+09:00", "テスト管理者", "save", "E1", "札の並び順を変更"),
];

interface Rendered {
  user: UserEvent;
  loader: Mock<SaveLogLoader>;
}

/** 定義画面を、記録を読む関数つきで描き、読み込みが済むまで待つ */
async function renderWithSaveLogs(
  data: PlanEditorData = makeData(),
  loader: Mock<SaveLogLoader> = vi.fn<SaveLogLoader>(async () => LOGS),
): Promise<Rendered> {
  const user = userEvent.setup();
  render(<PlanEditor repository={createFakeRepository(data)} loadSaveLogs={loader} />);
  await screen.findByRole("region", { name: "攻略の流れ" });
  return { user, loader };
}

/** 「保存の記録を見る」 */
function openButton(): HTMLElement {
  return screen.getByRole("button", { name: "保存の記録を見る" });
}

/** 「保存の記録を見る」を押して、開いたウィンドウを返す */
async function openDialog(user: UserEvent): Promise<HTMLElement> {
  await user.click(openButton());
  return screen.findByRole("dialog", { name: /共有の下書きの記録/ });
}

/** ウィンドウを開き、記録の一覧が出るまで待つ */
async function openLoadedDialog(user: UserEvent): Promise<HTMLElement> {
  const dialog = await openDialog(user);
  await within(dialog).findByRole("list", { name: "記録" });
  return dialog;
}

/** 一覧の記録の行（「さらに古い記録を表示」の行と、該当なしの行は除く。上から順） */
function recordRows(dialog: HTMLElement): HTMLElement[] {
  const list = within(dialog).queryByRole("list", { name: "記録" });
  if (list === null) return [];
  return within(list)
    .queryAllByRole("listitem")
    .filter((item) => within(item).queryByRole("button") === null && !(item.textContent ?? "").includes(EMPTY_TEXT));
}

/** 行の内容（summary）の一覧 */
function rowSummaries(dialog: HTMLElement): string[] {
  return recordRows(dialog).map((row) => {
    const found = LOGS.find((entry) => (row.textContent ?? "").includes(entry.summary));
    if (found === undefined) throw new Error(`記録にない行です：${row.textContent ?? ""}`);
    return found.summary;
  });
}

/** 記録の内容の一覧（期待値用） */
function summariesOf(entries: readonly SaveLogEntry[]): string[] {
  return entries.map((entry) => entry.summary);
}

/** 絞り込みの欄 */
function filterBox(dialog: HTMLElement, name: "誰が" | "種類" | "海域"): HTMLElement {
  return within(dialog).getByRole("combobox", { name });
}

/** 絞り込みの欄の選択肢の文字 */
function optionLabels(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole("option")
    .map((option) => (option.textContent ?? "").trim());
}

/** 「表示件数 / 該当件数 件」が出ていることを確かめる */
function expectCount(dialog: HTMLElement, shown: number, matched: number): void {
  expect(within(dialog).getByText(textMatching(new RegExp(`(^|\\D)${shown}\\s*/\\s*${matched}\\s*件`)))).toBeInTheDocument();
}

/** 「さらに古い記録を表示」（なければ null） */
function moreButton(dialog: HTMLElement): HTMLElement | null {
  return within(dialog).queryByRole("button", { name: "さらに古い記録を表示" });
}

/** 右上の「×」と下の「閉じる」（どちらも名前は「閉じる」。文字で見分ける） */
function closeButtons(dialog: HTMLElement): { cross: HTMLElement; footer: HTMLElement } {
  const buttons = within(dialog).getAllByRole("button", { name: "閉じる" });
  const cross = buttons.find((button) => button.textContent?.trim() === "×");
  const footer = buttons.find((button) => button.textContent?.trim() === "閉じる");
  if (cross === undefined || footer === undefined) throw new Error("「×」と「閉じる」のボタンが見つからない");
  return { cross, footer };
}

describe("保存の記録のウィンドウ（定義画面）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("「保存の記録を見る」", () => {
    it("既存の更新では「保存の記録を見る」を出す（管理者）", async () => {
      // 実行
      await renderWithSaveLogs();

      // 検証
      expect(openButton()).toBeInTheDocument();
    });

    it("協力者にも「保存の記録を見る」を出す", async () => {
      // 実行
      await renderWithSaveLogs(makeData({ user: COLLAB }));

      // 検証
      expect(openButton()).toBeInTheDocument();
    });

    it("新規作成に切り替えると「保存の記録を見る」を出さない", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();
      expect(openButton()).toBeInTheDocument();

      // 実行
      await switchToCreate(user);

      // 検証
      expect(screen.queryByRole("button", { name: "保存の記録を見る" })).not.toBeInTheDocument();
    });

    it("最新のイベントがなく新規作成から始まる管理者には「保存の記録を見る」を出さず、記録も読まない", async () => {
      // 実行
      const { loader } = await renderWithSaveLogs(makeData({ latestEvent: null }));

      // 検証
      expect(screen.queryByRole("button", { name: "保存の記録を見る" })).not.toBeInTheDocument();
      expect(loader).not.toHaveBeenCalled();
    });

    it("開く前は記録を読まず、押すと最新のイベントの記録を読む", async () => {
      // 準備
      const { user, loader } = await renderWithSaveLogs();
      expect(loader).not.toHaveBeenCalled();

      // 実行
      await openLoadedDialog(user);

      // 検証
      expect(loader).toHaveBeenCalledTimes(1);
      expect(loader).toHaveBeenCalledWith(LATEST_EVENT_ID);
    });
  });

  describe("ウィンドウの枠", () => {
    it("押すと、見出し「共有の下書きの記録」とイベント名のウィンドウ（aria-modal）が開く", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();

      // 実行
      const dialog = await openDialog(user);

      // 検証
      expect(within(dialog).getByRole("heading", { name: "共有の下書きの記録" })).toBeInTheDocument();
      expect(within(dialog).getByText(LATEST_NAME)).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    it("右上の「×」で閉じる", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();
      const dialog = await openLoadedDialog(user);

      // 実行
      await user.click(closeButtons(dialog).cross);

      // 検証
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("下の「閉じる」で閉じる", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();
      const dialog = await openLoadedDialog(user);

      // 実行
      await user.click(closeButtons(dialog).footer);

      // 検証
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("背景の暗い部分をクリックすると閉じる", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();
      await openLoadedDialog(user);

      // 実行
      await user.click(screen.getByTestId("save-log-dialog-overlay"));

      // 検証
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("開いている間は後ろの画面の部品を操作できず（支援技術からも隠れる）、閉じると戻る", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();

      // 実行・検証：開いている間は見つからない
      const dialog = await openLoadedDialog(user);
      expect(screen.queryByRole("button", { name: "下書きを保存" })).not.toBeInTheDocument();

      // 実行・検証：閉じると戻る
      await user.click(closeButtons(dialog).footer);
      expect(screen.getByRole("button", { name: "下書きを保存" })).toBeInTheDocument();
    });

    it("開き直すと記録を読み直す", async () => {
      // 準備
      const { user, loader } = await renderWithSaveLogs();
      const dialog = await openLoadedDialog(user);
      await user.click(closeButtons(dialog).footer);

      // 実行
      await openLoadedDialog(user);

      // 検証
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe("読み込み中・失敗", () => {
    it("読み込みの間は、ウィンドウの中に「読み込んでいます」を出す", async () => {
      // 準備
      const deferred = createDeferred<readonly SaveLogEntry[]>();
      const { user } = await renderWithSaveLogs(
        makeData(),
        vi.fn<SaveLogLoader>(() => deferred.promise),
      );

      // 実行
      const dialog = await openDialog(user);

      // 検証
      expect(within(dialog).getByRole("status")).toHaveTextContent(/読み込んでいます/);
      expect(recordRows(dialog)).toHaveLength(0);

      // 後片付け：読み込みを終えると記録が出る
      deferred.resolve(LOGS);
      expect(await within(dialog).findByRole("list", { name: "記録" })).toBeInTheDocument();
    });

    it("読み込みに失敗したら、ウィンドウの中に理由つきの警告（role=alert）を出す", async () => {
      // 準備
      const { user } = await renderWithSaveLogs(
        makeData(),
        vi.fn<SaveLogLoader>(async () => {
          throw new Error("通信に失敗しました。しばらくしてからやり直してください");
        }),
      );

      // 実行
      const dialog = await openDialog(user);

      // 検証
      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent("通信に失敗しました。しばらくしてからやり直してください");
      expect(recordRows(dialog)).toHaveLength(0);
    });
  });

  describe("一覧", () => {
    it("新しい順に 8 件を出し、「8 / 13 件」と「さらに古い記録を表示」を出す", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();

      // 実行
      const dialog = await openLoadedDialog(user);

      // 検証
      expect(rowSummaries(dialog)).toEqual(summariesOf(LOGS.slice(0, 8)));
      expectCount(dialog, 8, 13);
      expect(moreButton(dialog)).toBeInTheDocument();
    });

    it("1 行に日時・誰・種類のバッジ（「下書き保存」）・内容を出す", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();

      // 実行
      const dialog = await openLoadedDialog(user);

      // 検証
      const first = recordRows(dialog)[0] as HTMLElement;
      expect(first).toHaveTextContent("10/15 22:52");
      expect(first).toHaveTextContent("協力者A");
      expect(ownTexts(first)).toContain("下書き保存");
      expect(first).toHaveTextContent("E3 ゲージ4 の特効を追加（第二十七駆逐隊 ×1.20）");
    });

    it("公開の記録は種類のバッジを「公開」にする", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();

      // 実行
      const dialog = await openLoadedDialog(user);

      // 検証：7 行目（10/10 21:12 のテスト管理者の公開）
      const published = recordRows(dialog)[6] as HTMLElement;
      expect(published).toHaveTextContent("10/10 21:12");
      expect(published).toHaveTextContent("テスト管理者");
      expect(ownTexts(published)).toContain("公開");
      expect(ownTexts(published)).not.toContain("下書き保存");
      expect(published).toHaveTextContent("公開（2026/10/10 版）");
    });

    it("「さらに古い記録を表示」で残りを足し、全部出たら「13 / 13 件」にしてボタンを出さない", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();
      const dialog = await openLoadedDialog(user);

      // 実行
      await user.click(moreButton(dialog) as HTMLElement);

      // 検証
      expect(rowSummaries(dialog)).toEqual(summariesOf(LOGS));
      expectCount(dialog, 13, 13);
      expect(moreButton(dialog)).not.toBeInTheDocument();
    });

    it("記録が 8 件以下なら全部出し、「さらに古い記録を表示」を出さない", async () => {
      // 準備
      const { user } = await renderWithSaveLogs(makeData(), vi.fn<SaveLogLoader>(async () => LOGS.slice(0, 8)));

      // 実行
      const dialog = await openLoadedDialog(user);

      // 検証
      expect(recordRows(dialog)).toHaveLength(8);
      expectCount(dialog, 8, 8);
      expect(moreButton(dialog)).not.toBeInTheDocument();
    });

    it("記録が 1 件もなければ「条件に合う記録はありません」と「0 / 0 件」を出す", async () => {
      // 準備
      const { user } = await renderWithSaveLogs(makeData(), vi.fn<SaveLogLoader>(async () => []));

      // 実行
      const dialog = await openDialog(user);

      // 検証
      expect(await within(dialog).findByText(EMPTY_TEXT)).toBeInTheDocument();
      expect(recordRows(dialog)).toHaveLength(0);
      expectCount(dialog, 0, 0);
      expect(moreButton(dialog)).not.toBeInTheDocument();
    });
  });

  describe("絞り込み", () => {
    it("絞り込みの欄は「誰が」（全員・各人）・「種類」（すべて・下書き保存・公開）・「海域」（すべて・定義の海域）で、最初は全員・すべて", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();

      // 実行
      const dialog = await openLoadedDialog(user);

      // 検証
      const who = filterBox(dialog, "誰が");
      expect(optionLabels(who)[0]).toBe("全員");
      expect(optionLabels(who)).toEqual(expect.arrayContaining(["全員", "テスト管理者", "協力者A", "協力者B"]));
      expect(optionLabels(filterBox(dialog, "種類"))).toEqual(["すべて", "下書き保存", "公開"]);
      expect(optionLabels(filterBox(dialog, "海域"))).toEqual(["すべて", "E1", "E2", "E3"]);
      expect(who).toHaveDisplayValue("全員");
      expect(filterBox(dialog, "種類")).toHaveDisplayValue("すべて");
      expect(filterBox(dialog, "海域")).toHaveDisplayValue("すべて");
    });

    it("海域の選択肢は定義の海域から組み立てる（海域が E1・E2 のイベントなら E3 を出さない）", async () => {
      // 準備：2025秋イベの文書（海域 E1・E2）を最新のイベントの下書きにする
      const data = makeData({
        latestEvent: makeEvent({ draftContent: autumn2025Definition, publishedContent: autumn2025Definition }),
      });
      const { user } = await renderWithSaveLogs(data);

      // 実行
      const dialog = await openLoadedDialog(user);

      // 検証
      expect(optionLabels(filterBox(dialog, "海域"))).toEqual(["すべて", "E1", "E2"]);
    });

    it("誰が：選んだ人の記録だけを出し、件数を「3 / 3 件」にする", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();
      const dialog = await openLoadedDialog(user);

      // 実行
      await user.selectOptions(filterBox(dialog, "誰が"), "協力者B");

      // 検証
      expect(rowSummaries(dialog)).toEqual(summariesOf(LOGS.filter((entry) => entry.userName === "協力者B")));
      expectCount(dialog, 3, 3);
      expect(moreButton(dialog)).not.toBeInTheDocument();
    });

    it("種類：「公開」を選ぶと公開の記録だけを出す", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();
      const dialog = await openLoadedDialog(user);

      // 実行
      await user.selectOptions(filterBox(dialog, "種類"), "公開");

      // 検証
      expect(rowSummaries(dialog)).toEqual(["公開（2026/10/10 版）", "公開（2026/08/04 版）"]);
      expectCount(dialog, 2, 2);
    });

    it("海域：「E2」を選ぶと E2 の記録だけを出し、海域のない記録（公開）は出さない", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();
      const dialog = await openLoadedDialog(user);

      // 実行
      await user.selectOptions(filterBox(dialog, "海域"), "E2");

      // 検証
      expect(rowSummaries(dialog)).toEqual(summariesOf(LOGS.filter((entry) => entry.mapLabel === "E2")));
      expectCount(dialog, 4, 4);
    });

    it("条件を重ねて該当がなければ「条件に合う記録はありません」と「0 / 0 件」を出し、「さらに古い記録を表示」を出さない", async () => {
      // 準備
      const { user } = await renderWithSaveLogs();
      const dialog = await openLoadedDialog(user);

      // 実行
      await user.selectOptions(filterBox(dialog, "誰が"), "協力者B");
      await user.selectOptions(filterBox(dialog, "種類"), "公開");

      // 検証
      expect(within(dialog).getByText(EMPTY_TEXT)).toBeInTheDocument();
      expect(recordRows(dialog)).toHaveLength(0);
      expectCount(dialog, 0, 0);
      expect(moreButton(dialog)).not.toBeInTheDocument();
    });

    it("絞り込みを変えると 8 件の表示に戻す（全部出した後に「下書き保存」を選ぶと「8 / 11 件」）", async () => {
      // 準備：全部出しておく
      const { user } = await renderWithSaveLogs();
      const dialog = await openLoadedDialog(user);
      await user.click(moreButton(dialog) as HTMLElement);
      expect(recordRows(dialog)).toHaveLength(13);

      // 実行
      await user.selectOptions(filterBox(dialog, "種類"), "下書き保存");

      // 検証
      expect(rowSummaries(dialog)).toEqual(summariesOf(LOGS.filter((entry) => entry.kind === "save").slice(0, 8)));
      expectCount(dialog, 8, 11);
      expect(moreButton(dialog)).toBeInTheDocument();
    });

    describe("「誰が」は利用者の ID で見分ける（PR-12b：Codex #21-4301315082）", () => {
      /** 同じ表示名「協力者A」の 2 人（user-a・user-a2）が編集できる人にいる */
      const SAME_NAME_MEMBERS = [...MEMBERS, { userId: "user-a2", displayName: "協力者A", role: "collab" as const }];
      /** 記録（新しい順）：2 人目の協力者A（user-a2）が 2 件、1 人目（user-a）が 1 件、テスト管理者が 1 件 */
      const SAME_NAME_LOGS: readonly SaveLogEntry[] = [
        log(4, "2026-10-15T22:52:00+09:00", "協力者A", "save", "E3", "2 人目の記録（新）", "user-a2"),
        log(3, "2026-10-15T22:40:00+09:00", "協力者A", "save", "E2", "1 人目の記録", "user-a"),
        log(2, "2026-10-15T21:40:00+09:00", "協力者A", "save", "E2", "2 人目の記録（旧）", "user-a2"),
        log(1, "2026-10-14T22:18:00+09:00", "テスト管理者", "save", "E1", "管理者の記録", "user-admin"),
      ];

      /** 一覧の行の文字 */
      function rowTexts(dialog: HTMLElement): string[] {
        return recordRows(dialog).map((row) => row.textContent ?? "");
      }

      it("同じ表示名の 2 人は、「誰が」の別々の選択肢になり（編集できる人の並び）、2 つ目を選ぶと 2 人目の記録だけを出す", async () => {
        // 準備
        const { user } = await renderWithSaveLogs(
          makeData({ members: SAME_NAME_MEMBERS }),
          vi.fn<SaveLogLoader>(async () => SAME_NAME_LOGS),
        );
        const dialog = await openLoadedDialog(user);
        const who = filterBox(dialog, "誰が");

        // 検証：協力者A（を含む文字）の選択肢が 2 つ
        const sameNameOptions = within(who)
          .getAllByRole("option")
          .filter((option) => (option.textContent ?? "").includes("協力者A"));
        expect(sameNameOptions).toHaveLength(2);

        // 実行：2 つ目（編集できる人の並びで後ろ＝user-a2）を選ぶ
        await user.selectOptions(who, sameNameOptions[1] as HTMLElement);

        // 検証
        const texts = rowTexts(dialog);
        expect(texts).toHaveLength(2);
        expect(texts[0]).toContain("2 人目の記録（新）");
        expect(texts[1]).toContain("2 人目の記録（旧）");
        expectCount(dialog, 2, 2);
      });

      it("1 つ目の協力者A を選ぶと、1 人目の記録だけを出す（もう 1 人の同じ名前の記録は出さない）", async () => {
        // 準備
        const { user } = await renderWithSaveLogs(
          makeData({ members: SAME_NAME_MEMBERS }),
          vi.fn<SaveLogLoader>(async () => SAME_NAME_LOGS),
        );
        const dialog = await openLoadedDialog(user);
        const who = filterBox(dialog, "誰が");
        const sameNameOptions = within(who)
          .getAllByRole("option")
          .filter((option) => (option.textContent ?? "").includes("協力者A"));
        expect(sameNameOptions).toHaveLength(2);

        // 実行
        await user.selectOptions(who, sameNameOptions[0] as HTMLElement);

        // 検証
        const texts = rowTexts(dialog);
        expect(texts).toHaveLength(1);
        expect(texts[0]).toContain("1 人目の記録");
        expectCount(dialog, 1, 1);
      });
    });
  });
});
