// 設定のウィンドウの中身（SettingsContent。roadmap T2-12、要件 3.6、U13・U21）の画面テスト
//
// 部品の公開する形（実装の担当向け。テストはこの形で探す）
// - 差し込み方：レイアウトで `<SettingsDialog><SettingsContent /></SettingsDialog>`（枠は src/components/SettingsDialog.tsx。
//   開閉は settings-dialog-store）。中身は開いている間だけ描かれる（閉じると外れる）
// - 見出し「表示」「データ」（モックの h2。ウィンドウの見出し「設定」の下の階層）。アカウントの欄はデータの後（PR-10b を取り込んでから）
// - 表示：radiogroup「画面モード」（radio「ダーク」「ライト」「端末に合わせる」）、radiogroup「文字の大きさ」（「小」「標準」「大」）、
//   radiogroup「控えの表示」（「一行」「カード」）、radiogroup「控えの並び順」（「艦型」「Lv」「特効の強さ」「名前」）。
//   選ばれている項目は checked（<input type="radio"> か、role="radio" と aria-checked）。
//   中身は getPlanStorage().loadSettings() から出し、選ぶと getPlanStorage().saveSettings() で保存する。
//   画面モードは選んだらすぐに setThemeMode で画面に反映する（保存を待たない）。
//   艦娘のバナー画像の項目は出さない（U13）
// - データ：
//   - 「札割りの書き出し・読み込み」：ボタン「書き出す」と、名前（label または aria-label）に「読み込む」を含む <input type="file">
//     （例：<label> の文字を「読み込む」にして、中に見えない file の入力を置く）。
//     書き出しは U21 の JSON（{ formatVersion: 1, eventId, assignments }。src/domain/plan/planFile.ts）を拡張子 .json の
//     ファイルとしてダウンロードさせる（Blob → URL.createObjectURL → <a download> の click()）。
//     読み込みはファイルを選ぶ → role="alertdialog" の確認（「置き換え」る旨。ボタン「置き換える」を含む名前と「やめる」）→
//     共有の札割りのデータ（usePlanData の setAssignments）で最新イベントの割り当てを置き換える。
//     読めないファイル・別のイベントのファイルは、確認を出さずに role="alert" で知らせる（「読み込めませんでした」、別のイベントは「別のイベント」）
//   - 「取り込んだ艦娘データを削除」：「最終取り込み（M/D HH:mm） ／ n隻。札割りは残ります」とボタン「削除する」。
//     押すと role="alertdialog" の確認（ボタン「削除する」「やめる」）。削除は getPlanStorage().clearImportedShips() の後に
//     usePlanData の reload()。取り込んでいなければ「削除する」は押せない（disabled か、出さない）
//
// - 公開定義の取得は差し替える（最新イベントの ID を知るため。src/test/latest-data-fetch.ts）。
// - 保存先は fake-indexeddb の上の本物の保存（テストごとに別の DB）を、共有の札割りのデータに渡す（resetPlanDataCache）。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { type ReactNode, useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "@/components/SettingsDialog";
import { closeSettingsDialog, openSettingsDialog } from "@/components/settings-dialog-store";
import type { AssignmentMap } from "@/domain/plan/types";
import { SettingsContent } from "@/features/settings";
import { DEFAULT_THEME_MODE, setThemeMode, ThemeSync } from "@/features/theme";
import { resetLatestDefinitionCache, useLatestDefinition } from "@/lib/definition";
import { resetPlanDataCache, usePlanData } from "@/lib/plan";
import { resetShipMasterCache } from "@/lib/ship-master";
import type { FudawariStorage, Settings } from "@/lib/storage";
import { type FetchMock, stubFetch } from "@/test/definition-fetch";
import { expectInDocumentOrder } from "@/test/dom-order";
import { summer2026Assignments, summer2026Definition, summer2026Ships } from "@/test/fixtures";
import { respondWithLatestData } from "@/test/latest-data-fetch";
import { cleanupTestStorages, importInput, openTestStorage } from "@/test/plan-storage";

// ---- テスト用のデータ ----

/** 最新イベントの ID（"2026-summer"） */
const EVENT_ID = summer2026Definition.event.id;

/**
 * 取り込んだ日時（端末の時刻帯で 2026-10-15 20:40）。画面には「10/15 20:40」と出る。
 * 端末の時刻帯に左右されないよう、端末の時刻で作ってから ISO 8601 にする
 */
const IMPORTED_AT = new Date(2026, 9, 15, 20, 40).toISOString();

/** 「最終取り込み 10/15 20:40 ／ 31隻。札割りは残ります」 */
const LAST_IMPORT_TEXT = /最終取り込み\s*10\/15 20:40\s*／\s*31\s*隻。?\s*札割りは残ります/;

/** 設定の初期値（モック SettingsDialog.dc.html どおり：ダーク・標準・一行・艦型） */
const DEFAULT_SETTINGS: Settings = { themeMode: "dark", fontSize: "mid", trayView: "dense", traySort: "class" };

/** 表示の設定の項目（radiogroup の名前、選択肢の名前〔画面の順〕、初期値の選択肢） */
const DISPLAY_GROUPS: ReadonlyArray<{ group: string; options: readonly string[]; initial: string }> = [
  { group: "画面モード", options: ["ダーク", "ライト", "端末に合わせる"], initial: "ダーク" },
  { group: "文字の大きさ", options: ["小", "標準", "大"], initial: "標準" },
  { group: "控えの表示", options: ["一行", "カード"], initial: "一行" },
  { group: "控えの並び順", options: ["艦型", "Lv", "特効の強さ", "名前"], initial: "艦型" },
];

const html = document.documentElement;

// ---- 補助 ----

let fetchMock: FetchMock;
/** このテストの保存先（beforeEach で開いて、共有の札割りのデータに渡す） */
let storage: FudawariStorage;

beforeEach(() => {
  resetLatestDefinitionCache();
  resetShipMasterCache();
  storage = openTestStorage("fudawari-settings-test").storage;
  resetPlanDataCache({ storage });
  fetchMock = stubFetch();
  respondWithLatestData(fetchMock);
  closeSettingsDialog();
  setThemeMode(DEFAULT_THEME_MODE);
});

afterEach(async () => {
  // 部品を外してから、開閉・画面モード・共有の読み込みの状態を戻し、差し替えを戻し、DB を消す
  cleanup();
  closeSettingsDialog();
  setThemeMode(DEFAULT_THEME_MODE);
  html.removeAttribute("data-theme");
  resetLatestDefinitionCache();
  resetShipMasterCache();
  resetPlanDataCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await cleanupTestStorages();
});

/** 取り込み（31 隻。日時は IMPORTED_AT）と、最新イベントの割り当てを保存しておく */
async function seedPlan(target: FudawariStorage, assignments: AssignmentMap = summer2026Assignments): Promise<void> {
  await target.saveImport(importInput(summer2026Ships, { importedAt: IMPORTED_AT }));
  await target.saveAssignments(EVENT_ID, assignments);
}

/** 確認用の部品が出す文の書き出し */
const PROBE = "確認用：";

/** 確認用：同じ画面の別の部品が使う札割りのデータ（usePlanData）の、取り込んだ艦の数と初霜改二の割り当てを出す */
function PlanProbe(): ReactNode {
  const state = useLatestDefinition();
  const definition = state.status === "success" ? state.definition : null;
  const fudaIds = useMemo(() => definition?.fudas.map((fuda) => fuda.id) ?? [], [definition]);
  const plan = usePlanData(definition?.event.id ?? null, fudaIds);
  if (plan.status !== "ready") return <p>{`${PROBE}${plan.status}`}</p>;
  return (
    <div>
      <p>{`${PROBE}艦＝${plan.ships.length}`}</p>
      <p>{`${PROBE}hatsushimo→${plan.assignments.hatsushimo ?? "控え"}`}</p>
    </div>
  );
}

/** 画面モードを反映する部品・設定のウィンドウ（中身つき）・確認用の部品を描き、ウィンドウを開く */
function renderSettings(): { user: UserEvent } {
  const user = userEvent.setup();
  render(
    <>
      <ThemeSync />
      <SettingsDialog>
        <SettingsContent />
      </SettingsDialog>
      <PlanProbe />
    </>,
  );
  act(() => {
    openSettingsDialog();
  });
  return { user };
}

/** 設定のウィンドウ */
function getDialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "設定" });
}

/** 表示の設定の radiogroup の中の、選択肢 option の radio */
function radioOf(group: string, option: string): HTMLElement {
  const radiogroup = within(getDialog()).getByRole("radiogroup", { name: group });
  return within(radiogroup).getByRole("radio", { name: option });
}

/** 保存した設定を読み終えたことを、初期値と違う「控えの並び順：名前」が選ばれていることで確かめる（準備で traySort: "name" を保存しておく） */
async function waitForSettingsLoaded(): Promise<void> {
  await waitFor(() => expect(radioOf("控えの並び順", "名前")).toBeChecked());
}

/** 札割りのデータを読み終えたことを、最終取り込みの文で確かめる（準備で取り込みを保存しておく） */
async function waitForDataLoaded(): Promise<void> {
  await waitFor(() => expect(getDialog()).toHaveTextContent(LAST_IMPORT_TEXT));
}

/** 札割りのファイル（U21：{ formatVersion, eventId, assignments }）を作る */
function planFileOf(text: string, name = "fudawari-plan.json"): File {
  return new File([text], name, { type: "application/json" });
}

/** U21 の形の札割りのファイルの中身 */
function planFileText(eventId: string, assignments: AssignmentMap): string {
  return JSON.stringify({ formatVersion: 1, eventId, assignments });
}

/** 「読み込む」の file の入力 */
function getImportInput(): HTMLElement {
  const input = within(getDialog()).getByLabelText(/読み込む/);
  expect(input).toHaveAttribute("type", "file");
  return input;
}

/** ダウンロードさせたファイル 1 つ */
interface CapturedDownload {
  /** <a download> のファイル名 */
  fileName: string;
  /** 中身の文字 */
  text(): Promise<string>;
}

/** data: URL の中身の文字 */
function decodeDataUrl(url: string): string {
  const comma = url.indexOf(",");
  const meta = url.slice(0, comma);
  const body = url.slice(comma + 1);
  if (meta.endsWith(";base64")) {
    const bytes = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(body);
}

/**
 * ダウンロード（Blob → URL.createObjectURL → <a download> の click()、または data: URL の <a download>）を捕まえる。
 * 実際の移動はしない。差し替えは vi.spyOn なので afterEach の vi.restoreAllMocks() で戻る
 */
function captureDownloads(): CapturedDownload[] {
  const blobs = new Map<string, Blob>();
  let seq = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation((object) => {
    seq += 1;
    const url = `blob:http://localhost/download-${seq}`;
    blobs.set(url, object as Blob);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const downloads: CapturedDownload[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    const href = this.getAttribute("href") ?? "";
    const fileName = this.getAttribute("download") ?? "";
    const blob = blobs.get(href);
    if (blob !== undefined) {
      downloads.push({ fileName, text: () => blob.text() });
    } else if (href.startsWith("data:")) {
      downloads.push({ fileName, text: async () => decodeDataUrl(href) });
    }
  });
  return downloads;
}

/** 「書き出す」を押して、ダウンロードさせたファイル（ちょうど 1 つ）を返す */
async function exportPlan(user: UserEvent, downloads: CapturedDownload[]): Promise<CapturedDownload> {
  const button = within(getDialog()).getByRole("button", { name: "書き出す" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  await waitFor(() => expect(downloads).toHaveLength(1));
  return downloads[0];
}

/** 取り込んだ艦娘データの「削除する」が押せない（disabled か、出していない）ことを確かめる */
function expectDeleteUnavailable(): void {
  const button = within(getDialog()).queryByRole("button", { name: "削除する" });
  if (button !== null) expect(button).toBeDisabled();
}

// ---- テスト ----

describe("設定のウィンドウの中身（SettingsContent）", () => {
  describe("表示", () => {
    it("見出し「表示」の下に、画面モード・文字の大きさ・控えの表示・控えの並び順の選択肢を出し、保存していなければ初期値（ダーク・標準・一行・艦型）を選んでいる", async () => {
      // 準備・実行
      renderSettings();
      const dialog = getDialog();

      // 検証
      expect(within(dialog).getByRole("heading", { name: "表示" })).toBeInTheDocument();
      for (const { group, options, initial } of DISPLAY_GROUPS) {
        const radiogroup = await within(dialog).findByRole("radiogroup", { name: group });
        const radios = options.map((option) => within(radiogroup).getByRole("radio", { name: option }));
        expect(within(radiogroup).getAllByRole("radio")).toHaveLength(options.length);
        expectInDocumentOrder(radios);
        await waitFor(() => expect(within(radiogroup).getByRole("radio", { name: initial })).toBeChecked());
        for (const option of options.filter((name) => name !== initial)) {
          expect(within(radiogroup).getByRole("radio", { name: option })).not.toBeChecked();
        }
      }
    });

    it("艦娘のバナー画像の表示の項目は出さない（U13：ゲームの画像は配信しない）", async () => {
      // 準備・実行
      renderSettings();
      const dialog = getDialog();
      await within(dialog).findByRole("radiogroup", { name: "画面モード" });

      // 検証
      expect(within(dialog).queryByText(/バナー画像/)).not.toBeInTheDocument();
    });

    it("このブラウザに保存した設定（ライト・大・カード・Lv）を選んだ状態で開く", async () => {
      // 準備
      await storage.saveSettings({ themeMode: "light", fontSize: "large", trayView: "card", traySort: "lv" });

      // 実行
      renderSettings();

      // 検証
      await waitFor(() => expect(radioOf("画面モード", "ライト")).toBeChecked());
      expect(radioOf("画面モード", "ダーク")).not.toBeChecked();
      expect(radioOf("文字の大きさ", "大")).toBeChecked();
      expect(radioOf("控えの表示", "カード")).toBeChecked();
      expect(radioOf("控えの並び順", "Lv")).toBeChecked();
    });

    it.each<[string, string, Partial<Settings>]>([
      ["画面モード", "ライト", { themeMode: "light" }],
      ["文字の大きさ", "大", { fontSize: "large" }],
      ["控えの表示", "カード", { trayView: "card" }],
      ["控えの並び順", "特効の強さ", { traySort: "boost" }],
    ])("「%s」で「%s」を選ぶと、それを選んだ状態にし、このブラウザに保存する（ほかの設定は変えない）", async (group, option, patch) => {
      // 準備：読み終えたことが分かるよう、並び順を「名前」で保存しておく
      await storage.saveSettings({ traySort: "name" });
      const { user } = renderSettings();
      await waitForSettingsLoaded();

      // 実行
      await user.click(radioOf(group, option));

      // 検証
      await waitFor(async () => {
        expect(await storage.loadSettings()).toEqual({ ...DEFAULT_SETTINGS, traySort: "name", ...patch });
      });
      expect(radioOf(group, option)).toBeChecked();
    });

    it("選んだ設定は、ウィンドウを閉じて開き直しても、ページを開き直しても（再訪）選んだまま", async () => {
      // 準備
      await storage.saveSettings({ traySort: "name" });
      const { user } = renderSettings();
      await waitForSettingsLoaded();
      await user.click(radioOf("文字の大きさ", "大"));
      await waitFor(async () => expect((await storage.loadSettings()).fontSize).toBe("large"));

      // 実行・検証：閉じて開き直す
      act(() => {
        closeSettingsDialog();
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      act(() => {
        openSettingsDialog();
      });
      await waitFor(() => expect(radioOf("文字の大きさ", "大")).toBeChecked());

      // 実行・検証：ページを開き直す（共有の読み込みの状態を捨てて描き直す。保存先は同じ）
      cleanup();
      closeSettingsDialog();
      resetLatestDefinitionCache();
      resetPlanDataCache({ storage });
      renderSettings();
      await waitFor(() => expect(radioOf("文字の大きさ", "大")).toBeChecked());
      expect(radioOf("文字の大きさ", "標準")).not.toBeChecked();
    });

    it("画面モードは選んだらすぐ画面に反映する（ライト → data-theme=light、端末に合わせる → data-theme なし、ダーク → data-theme=dark）", async () => {
      // 準備
      await storage.saveSettings({ traySort: "name" });
      const { user } = renderSettings();
      await waitForSettingsLoaded();

      // 実行・検証
      await user.click(radioOf("画面モード", "ライト"));
      expect(html).toHaveAttribute("data-theme", "light");

      await user.click(radioOf("画面モード", "端末に合わせる"));
      expect(html).not.toHaveAttribute("data-theme");

      await user.click(radioOf("画面モード", "ダーク"));
      expect(html).toHaveAttribute("data-theme", "dark");
    });
  });

  describe("データ：札割りの書き出し・読み込み", () => {
    it("見出し「データ」の下に「札割りの書き出し・読み込み」の「書き出す」と「読み込む」（ファイルを選ぶ）を出す", async () => {
      // 準備・実行
      await seedPlan(storage);
      renderSettings();
      const dialog = getDialog();
      await waitForDataLoaded();

      // 検証
      expect(within(dialog).getByRole("heading", { name: "データ" })).toBeInTheDocument();
      expect(within(dialog).getByText("札割りの書き出し・読み込み")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "書き出す" })).toBeInTheDocument();
      expect(getImportInput()).toBeInTheDocument();
    });

    it("「書き出す」で、最新イベントの札割りを U21 の JSON（形式の版・イベント ID・割り当て）の .json ファイルとしてダウンロードさせる", async () => {
      // 準備
      await seedPlan(storage);
      const downloads = captureDownloads();
      const { user } = renderSettings();
      await waitForDataLoaded();

      // 実行
      const file = await exportPlan(user, downloads);

      // 検証
      expect(file.fileName).toMatch(/\.json$/);
      expect(JSON.parse(await file.text())).toEqual({
        formatVersion: 1,
        eventId: EVENT_ID,
        assignments: summer2026Assignments,
      });
    });

    it("ファイルを選ぶと確認（role=alertdialog）を出し、「置き換える」で最新イベントの割り当てを置き換えて保存する（共有の札割りのデータにも届く）", async () => {
      // 準備
      await seedPlan(storage);
      const replaced: AssignmentMap = { hatsushimo: "rengo", okinami: "s31" };
      const { user } = renderSettings();
      await waitForDataLoaded();

      // 実行
      await user.upload(getImportInput(), planFileOf(planFileText(EVENT_ID, replaced)));
      const confirm = await screen.findByRole("alertdialog");
      expect(confirm).toHaveTextContent(/置き換え/);
      await user.click(within(confirm).getByRole("button", { name: /置き換える/ }));

      // 検証
      await waitFor(async () => expect(await storage.loadAssignments(EVENT_ID)).toEqual(replaced));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByText(`${PROBE}hatsushimo→rengo`)).toBeInTheDocument());
    });

    it("確認で「やめる」を押すと、割り当てを変えない", async () => {
      // 準備
      await seedPlan(storage);
      const { user } = renderSettings();
      await waitForDataLoaded();
      await user.upload(getImportInput(), planFileOf(planFileText(EVENT_ID, { hatsushimo: "rengo" })));
      const confirm = await screen.findByRole("alertdialog");

      // 実行
      await user.click(within(confirm).getByRole("button", { name: "やめる" }));

      // 検証
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(summer2026Assignments);
      expect(screen.getByText(`${PROBE}hatsushimo→s31`)).toBeInTheDocument();
    });

    it.each([
      ["JSON として読めない", "{ broken"],
      ["札割りのファイルの形でない", JSON.stringify({ hello: "world" })],
      ["知らない形式の版", JSON.stringify({ formatVersion: 99, eventId: EVENT_ID, assignments: {} })],
    ])("読めないファイル（%s）は、確認を出さずに「読み込めませんでした」と知らせ、割り当てを変えない", async (_label, text) => {
      // 準備
      await seedPlan(storage);
      const { user } = renderSettings();
      await waitForDataLoaded();

      // 実行
      await user.upload(getImportInput(), planFileOf(text));

      // 検証
      const alert = await within(getDialog()).findByRole("alert");
      expect(alert).toHaveTextContent(/読み込めませんでした/);
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(summer2026Assignments);
    });

    it("別のイベントの札割りのファイルは、確認を出さずに「別のイベント」のものだと知らせ、割り当てを変えない", async () => {
      // 準備
      await seedPlan(storage);
      const { user } = renderSettings();
      await waitForDataLoaded();

      // 実行
      await user.upload(getImportInput(), planFileOf(planFileText("2026-spring", { hatsushimo: "rengo" })));

      // 検証
      const alert = await within(getDialog()).findByRole("alert");
      expect(alert).toHaveTextContent(/別のイベント/);
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(summer2026Assignments);
    });

    it("書き出したファイルを別のブラウザ（別の保存先）で読み込むと、札割りが同じになる", async () => {
      // 準備：1 つめのブラウザで書き出す
      await seedPlan(storage);
      const downloads = captureDownloads();
      const first = renderSettings();
      await waitForDataLoaded();
      const exported = await (await exportPlan(first.user, downloads)).text();

      // 準備：2 つめのブラウザ（取り込みは済み、割り当てはない）に切り替える
      cleanup();
      closeSettingsDialog();
      resetLatestDefinitionCache();
      const other = openTestStorage("fudawari-settings-test-other").storage;
      await other.saveImport(importInput(summer2026Ships, { importedAt: IMPORTED_AT }));
      resetPlanDataCache({ storage: other });
      const { user } = renderSettings();
      await waitForDataLoaded();

      // 実行
      await user.upload(getImportInput(), planFileOf(exported));
      const confirm = await screen.findByRole("alertdialog");
      await user.click(within(confirm).getByRole("button", { name: /置き換える/ }));

      // 検証
      await waitFor(async () => expect(await other.loadAssignments(EVENT_ID)).toEqual(summer2026Assignments));
    });
  });

  describe("データ：取り込んだ艦娘データを削除", () => {
    it("「最終取り込み 10/15 20:40 ／ 31隻。札割りは残ります」と「削除する」を出す", async () => {
      // 準備
      await seedPlan(storage);

      // 実行
      renderSettings();

      // 検証
      await waitForDataLoaded();
      expect(within(getDialog()).getByText("取り込んだ艦娘データを削除")).toBeInTheDocument();
      expect(within(getDialog()).getByRole("button", { name: "削除する" })).toBeEnabled();
    });

    it("「削除する」→ 確認（role=alertdialog）の「削除する」で、取り込んだ艦と最終取り込みを消し、札割りは残し、表示を更新する（共有の札割りのデータも読み直す）", async () => {
      // 準備
      await seedPlan(storage);
      const { user } = renderSettings();
      await waitForDataLoaded();

      // 実行
      await user.click(within(getDialog()).getByRole("button", { name: "削除する" }));
      const confirm = await screen.findByRole("alertdialog");
      await user.click(within(confirm).getByRole("button", { name: "削除する" }));

      // 検証：保存先
      await waitFor(async () => expect(await storage.loadShips()).toEqual([]));
      expect(await storage.loadLastImport()).toBeNull();
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(summer2026Assignments);
      // 検証：表示と共有の札割りのデータ
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      await waitFor(() => expect(getDialog()).not.toHaveTextContent(/31\s*隻/));
      expectDeleteUnavailable();
      await waitFor(() => expect(screen.getByText(`${PROBE}艦＝0`)).toBeInTheDocument());
      expect(screen.getByText(`${PROBE}hatsushimo→s31`)).toBeInTheDocument();
    });

    it("確認で「やめる」を押すと、何も消さない", async () => {
      // 準備
      await seedPlan(storage);
      const { user } = renderSettings();
      await waitForDataLoaded();
      await user.click(within(getDialog()).getByRole("button", { name: "削除する" }));
      const confirm = await screen.findByRole("alertdialog");

      // 実行
      await user.click(within(confirm).getByRole("button", { name: "やめる" }));

      // 検証
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(await storage.loadShips()).toHaveLength(summer2026Ships.length);
      expect(getDialog()).toHaveTextContent(LAST_IMPORT_TEXT);
    });

    it("取り込んでいなければ、最終取り込みを出さず、「削除する」は押せない", async () => {
      // 準備：取り込みも割り当てもない保存先

      // 実行
      renderSettings();

      // 検証
      expect(await within(getDialog()).findByText("取り込んだ艦娘データを削除")).toBeInTheDocument();
      await waitFor(() => expectDeleteUnavailable());
      expect(getDialog()).not.toHaveTextContent(/最終取り込み\s*\d/);
    });
  });
});
