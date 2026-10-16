// 画像で保存のウィンドウ（ExportImageDialog。要件 3.9・11 章、モック Main.dc.html の画像で保存、roadmap T2-10）のテスト
//
// - 外部との境界は差し替える：modern-screenshot の domToBlob（DOM → PNG）、document.fonts（フォントの読み込み）、
//   navigator.clipboard と ClipboardItem（クリップボード）、a 要素の click と URL.createObjectURL（ダウンロード）。
//   差し替えの部品は src/test/export-browser-fakes.ts にある。
// - 部品の探し方は src/test/list-screen.ts の冒頭にまとめてある。
// - 画像の DOM の中身は ExportImage.test.tsx、枚数の分け方とファイル名は pages.test.ts で細かく確かめる。
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { domToBlob, type Options } from "modern-screenshot";
import type * as ModernScreenshot from "modern-screenshot";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { PublicDefinition } from "@/domain/definition";
import { createShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { ExportImageDialog } from "@/features/export-image/ExportImageDialog";
import { APP_NAME } from "@/lib/app-name";
import { expectInDocumentOrder } from "@/test/dom-order";
import {
  type ClipboardControl,
  type ClipboardSupport,
  type DownloadRecorder,
  FakeClipboardItem,
  type FontsControl,
  installClipboard,
  installDocumentFonts,
  loadedTextFor,
  pngBlob,
  recordDownloads,
  restoreBrowserFakes,
} from "@/test/export-browser-fakes";
import { summer2026Assignments, summer2026Definition, summer2026MasterEntries, summer2026Ships } from "@/test/fixtures";
import { definitionWithEightFudas, eightFudaAssignments } from "@/test/list-export";
import { fudaRegionNames, getExportDialog, getPreview } from "@/test/list-screen";

// modern-screenshot は domToBlob だけを差し替える（ほかの関数は本物のまま。使えば jsdom では動かないので気付ける）
vi.mock("modern-screenshot", async (importOriginal) => {
  const actual = await importOriginal<typeof ModernScreenshot>();
  return { ...actual, domToBlob: vi.fn() };
});

/** domToBlob の差し替え（DOM を受け取る形〔domToBlob(node, options)〕で呼ばれる前提） */
const domToBlobMock = domToBlob as unknown as Mock<(node: Node, options?: Options) => Promise<Blob>>;

// ---- 準備 ----

const master = createShipMaster(summer2026MasterEntries);

/** domToBlob が呼ばれたときの記録（呼ばれた時点の中身を写しておく。後で同じ DOM が描き直されても混ざらないように） */
interface Capture {
  /** 受け取った DOM の文字 */
  text: string;
  /** 受け取った DOM の札の列の名前（文書の順） */
  columns: string[];
  /** 受け取った設定 */
  options: Options | undefined;
  /** 返した PNG */
  blob: Blob;
}

let captures: Capture[];
let fonts: FontsControl;
let recorder: DownloadRecorder;

beforeEach(() => {
  captures = [];
  domToBlobMock.mockReset();
  domToBlobMock.mockImplementation(async (node, options) => {
    const element = node as HTMLElement;
    const blob = pngBlob();
    captures.push({ text: element.textContent ?? "", columns: fudaRegionNames(element), options, blob });
    return blob;
  });
  fonts = installDocumentFonts();
  recorder = recordDownloads();
});

afterEach(() => {
  restoreBrowserFakes();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface DialogData {
  definition?: PublicDefinition;
  ships?: readonly OwnedShip[];
  assignments?: AssignmentMap;
}

/** 開閉の状態を持つ入れ物（初めは開いている）。後ろの画面の代わりにボタンを 1 つ置く */
function Harness({ definition, ships, assignments }: Required<DialogData>): ReactNode {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        後ろの画面のボタン
      </button>
      <ExportImageDialog
        open={open}
        onOpenChange={setOpen}
        definition={definition}
        master={master}
        ships={ships}
        assignments={assignments}
      />
    </>
  );
}

/** ウィンドウを開いた状態で描く（クリップボードは指定の対応の具合にする。省略すると対応している） */
function renderDialog(
  data: DialogData = {},
  clipboardSupport: ClipboardSupport = "supported",
): { user: UserEvent; clipboard: ClipboardControl; dialog: HTMLElement } {
  const user = userEvent.setup();
  // userEvent.setup() がクリップボードの偽物を差し込むため、その後で差し替える
  const clipboard = installClipboard(clipboardSupport);
  render(
    <Harness
      definition={data.definition ?? summer2026Definition}
      ships={data.ships ?? summer2026Ships}
      assignments={data.assignments ?? summer2026Assignments}
    />,
  );
  return { user, clipboard, dialog: getExportDialog() };
}

/** 札が 8 つ（すべてに艦がいる）の場面で描く（6 札を超えるので 2 枚に分かれる） */
function renderEightFudaDialog(clipboardSupport: ClipboardSupport = "supported") {
  return renderDialog({ definition: definitionWithEightFudas(), assignments: eightFudaAssignments }, clipboardSupport);
}

/** 割り当てから個体を外す（控えに戻す） */
function withoutAssignment(assignments: AssignmentMap, uid: string): AssignmentMap {
  return Object.fromEntries(Object.entries(assignments).filter(([key]) => key !== uid));
}

/** 非同期の処理が進むのを少し待つ（「まだ呼ばれていない」ことを確かめる前に使う） */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/** 文字 text が、chars の文字をすべて含むか（足りない文字を返す） */
function missingChars(text: string, words: readonly string[]): string[] {
  const needed = new Set([...words.join("")].filter((char) => char.trim() !== ""));
  return [...needed].filter((char) => !text.includes(char));
}

/** 枚数の表示「n札 → m枚」 */
function pageNotePattern(fudaCount: number, pageCount: number): RegExp {
  return new RegExp(`(?<!\\d)${fudaCount}\\s*札\\s*→\\s*${pageCount}\\s*枚`);
}

/** 「札を選ぶ」に切り替える */
async function pickMode(user: UserEvent, dialog: HTMLElement): Promise<void> {
  await user.click(within(dialog).getByRole("radio", { name: "札を選ぶ" }));
}

/** 保存のボタン（1 枚なら「PNGで保存」、複数枚なら「m枚まとめて保存（PNG）」） */
function saveButton(dialog: HTMLElement, name: string | RegExp = "PNGで保存"): HTMLElement {
  return within(dialog).getByRole("button", { name });
}

/** 札の 5 つの名前（定義の順） */
const FIVE_FUDAS = ["第三十一戦隊", "多号作戦部隊", "連合艦隊", "ウルシー攻撃部隊", "第六艦隊"];
/** 札の 8 つの名前（definitionWithEightFudas の定義の順） */
const EIGHT_FUDAS = [...FIVE_FUDAS, "仏第3艦隊", "仏地中海艦隊", "欧州連合艦隊"];

/** コピーした後の知らせ */
const COPIED_MESSAGE = "画像をコピーしました。Xの投稿欄などにそのまま貼り付けられます";

// ---- テスト ----

describe("画像で保存のウィンドウ（ExportImageDialog）", () => {
  describe("ウィンドウの表示（要件 3.9）", () => {
    it("名前「画像で保存」・aria-modal=true のウィンドウに、見出しと「横長 1600×900 の PNG。X などに貼りやすい大きさです」を出す", () => {
      // 準備・実行
      const { dialog } = renderDialog();

      // 検証
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(within(dialog).getByRole("heading", { name: "画像で保存" })).toBeInTheDocument();
      expect(within(dialog).getByText("横長 1600×900 の PNG。X などに貼りやすい大きさです")).toBeInTheDocument();
    });

    it("「入れる札」で「札が付いた札をすべて」（初め）と「札を選ぶ」を選べる。初めは札のチェックボックスを出さない", () => {
      // 準備・実行
      const { dialog } = renderDialog();

      // 検証
      const group = within(dialog).getByRole("radiogroup", { name: "入れる札" });
      expect(within(group).getByRole("radio", { name: "札が付いた札をすべて" })).toBeChecked();
      expect(within(group).getByRole("radio", { name: "札を選ぶ" })).not.toBeChecked();
      expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
    });

    it("画像に入るものの説明を出す（まだ艦がいない札は入らない、1 枚に 6 札まで）", () => {
      // 準備・実行
      const { dialog } = renderDialog();

      // 検証
      expect(dialog).toHaveTextContent(
        "入るもの：イベント名・攻略の流れ・札ごとの艦（艦名・Lv・運・特効あり／なし）・ツール名。まだ艦がいない札は入りません。1枚に入るのは6札までで、超えると自動で分けて保存します",
      );
    });

    it("枚数を「5札 → 1枚」と出す（1 枚なら「（分けて保存）」を付けない）", () => {
      // 準備・実行
      const { dialog } = renderDialog();

      // 検証
      expect(dialog).toHaveTextContent(pageNotePattern(5, 1));
      expect(dialog).not.toHaveTextContent("（分けて保存）");
    });

    it("まだ艦がいない札は数えない（第六艦隊に艦がいなければ「4札 → 1枚」）", () => {
      // 準備・実行
      const { dialog } = renderDialog({ assignments: withoutAssignment(summer2026Assignments, "i41") });

      // 検証
      expect(dialog).toHaveTextContent(pageNotePattern(4, 1));
    });

    it("見本（1枚目）として、1 枚目の画像（イベント名・札の列）を縮小して出す", () => {
      // 準備・実行
      const { dialog } = renderDialog();

      // 検証
      const preview = getPreview(dialog);
      expect(preview).toHaveTextContent("2026夏イベ");
      expect(fudaRegionNames(preview)).toEqual(FIVE_FUDAS);
    });

    it("下部に「やめる」「画像をコピー」「PNGで保存」のボタンを出す（札があれば押せる）", async () => {
      // 準備・実行
      const { dialog } = renderDialog();

      // 検証
      expect(within(dialog).getByRole("button", { name: "やめる" })).toBeEnabled();
      expect(await within(dialog).findByRole("button", { name: "画像をコピー" })).toBeEnabled();
      expect(saveButton(dialog)).toBeEnabled();
    });
  });

  describe("札を選ぶ", () => {
    it("「札を選ぶ」にすると、艦がいる札のチェックボックスを定義の順に出す（初めはすべて ON。艦がいない札は出さない）", async () => {
      // 準備
      const { user, dialog } = renderDialog({ assignments: withoutAssignment(summer2026Assignments, "i41") });

      // 実行
      await pickMode(user, dialog);

      // 検証
      const names = ["第三十一戦隊", "多号作戦部隊", "連合艦隊", "ウルシー攻撃部隊"];
      const boxes = names.map((name) => within(dialog).getByRole("checkbox", { name }));
      expectInDocumentOrder(boxes);
      for (const box of boxes) expect(box).toBeChecked();
      expect(within(dialog).getAllByRole("checkbox")).toHaveLength(4);
      expect(within(dialog).queryByRole("checkbox", { name: "第六艦隊" })).not.toBeInTheDocument();
    });

    it("チェックを外すと、枚数の表示と見本からその札が外れる", async () => {
      // 準備
      const { user, dialog } = renderDialog();
      await pickMode(user, dialog);

      // 実行
      await user.click(within(dialog).getByRole("checkbox", { name: "第三十一戦隊" }));

      // 検証
      expect(dialog).toHaveTextContent(pageNotePattern(4, 1));
      expect(fudaRegionNames(getPreview(dialog))).toEqual(["多号作戦部隊", "連合艦隊", "ウルシー攻撃部隊", "第六艦隊"]);
    });

    it("札を 1 つも選んでいなければ「札を1つ以上選んでください」と出し、コピーと保存を押せない（押しても作らない）", async () => {
      // 準備
      const { user, dialog } = renderDialog();
      await within(dialog).findByRole("button", { name: "画像をコピー" });
      await pickMode(user, dialog);

      // 実行
      for (const name of FIVE_FUDAS) {
        await user.click(within(dialog).getByRole("checkbox", { name }));
      }

      // 検証
      expect(dialog).toHaveTextContent("札を1つ以上選んでください");
      const copy = within(dialog).getByRole("button", { name: "画像をコピー" });
      const save = saveButton(dialog);
      expect(copy).toBeDisabled();
      expect(save).toBeDisabled();
      await user.click(save);
      await user.click(copy);
      await settle();
      expect(domToBlobMock).not.toHaveBeenCalled();
      expect(recorder.downloads).toHaveLength(0);
    });

    it("「札が付いた札をすべて」に戻すと、艦がいる札がすべて入る", async () => {
      // 準備：「札を選ぶ」で 2 つ外す
      const { user, dialog } = renderDialog();
      await pickMode(user, dialog);
      await user.click(within(dialog).getByRole("checkbox", { name: "連合艦隊" }));
      await user.click(within(dialog).getByRole("checkbox", { name: "第六艦隊" }));
      expect(dialog).toHaveTextContent(pageNotePattern(3, 1));

      // 実行
      await user.click(within(dialog).getByRole("radio", { name: "札が付いた札をすべて" }));

      // 検証
      expect(dialog).toHaveTextContent(pageNotePattern(5, 1));
      expect(fudaRegionNames(getPreview(dialog))).toEqual(FIVE_FUDAS);
    });
  });

  describe("1 枚 6 札までで分ける", () => {
    it("8 札なら「8札 → 2枚（分けて保存）」と出し、保存のボタンを「2枚まとめて保存（PNG）」にする", () => {
      // 準備・実行
      const { dialog } = renderEightFudaDialog();

      // 検証
      expect(dialog).toHaveTextContent(pageNotePattern(8, 2));
      expect(dialog).toHaveTextContent("（分けて保存）");
      expect(saveButton(dialog, "2枚まとめて保存（PNG）")).toBeEnabled();
      expect(within(dialog).queryByRole("button", { name: "PNGで保存" })).not.toBeInTheDocument();
    });

    it("見本は 1 枚目（定義の順の最初の 6 札）で、「1 / 2」を出す", () => {
      // 準備・実行
      const { dialog } = renderEightFudaDialog();

      // 検証
      const preview = getPreview(dialog);
      expect(fudaRegionNames(preview)).toEqual(EIGHT_FUDAS.slice(0, 6));
      expect(preview).toHaveTextContent(/1\s*\/\s*2/);
    });

    it("ちょうど 6 札なら 1 枚（「PNGで保存」）、7 札にすると 2 枚に分ける", async () => {
      // 準備
      const { user, dialog } = renderEightFudaDialog();
      await pickMode(user, dialog);

      // 実行：2 つ外して 6 札にする
      await user.click(within(dialog).getByRole("checkbox", { name: "仏地中海艦隊" }));
      await user.click(within(dialog).getByRole("checkbox", { name: "欧州連合艦隊" }));

      // 検証
      expect(dialog).toHaveTextContent(pageNotePattern(6, 1));
      expect(dialog).not.toHaveTextContent("（分けて保存）");
      expect(saveButton(dialog, "PNGで保存")).toBeEnabled();

      // 実行・検証：1 つ戻して 7 札にする
      await user.click(within(dialog).getByRole("checkbox", { name: "欧州連合艦隊" }));
      expect(dialog).toHaveTextContent(pageNotePattern(7, 2));
      expect(saveButton(dialog, "2枚まとめて保存（PNG）")).toBeEnabled();
    });
  });

  describe("PNGで保存", () => {
    it("1 枚：画像の DOM を 1600×900 の PNG にし、a 要素の download（「2026夏イベ_札割り.png」）で保存する", async () => {
      // 準備
      const { user, dialog } = renderDialog();

      // 実行
      await user.click(saveButton(dialog));

      // 検証
      await waitFor(() => expect(recorder.downloads).toHaveLength(1));
      expect(captures).toHaveLength(1);
      const [capture] = captures;
      expect(capture.text).toContain("2026夏イベ");
      expect(capture.columns).toEqual(FIVE_FUDAS);
      expect(capture.options?.width).toBe(1600);
      expect(capture.options?.height).toBe(900);
      expect(capture.options?.scale ?? 1).toBe(1);
      expect(capture.options?.type ?? "image/png").toBe("image/png");
      const [download] = recorder.downloads;
      expect(download.download).toBe("2026夏イベ_札割り.png");
      expect(download.href).toBe(recorder.objectUrlOf(capture.blob));
    });

    it("複数枚：1 枚目・2 枚目の順に、それぞれの札の画像を「…_1.png」「…_2.png」で保存する", async () => {
      // 準備
      const { user, dialog } = renderEightFudaDialog();

      // 実行
      await user.click(saveButton(dialog, "2枚まとめて保存（PNG）"));

      // 検証
      await waitFor(() => expect(recorder.downloads).toHaveLength(2));
      expect(captures).toHaveLength(2);
      expect(captures[0].columns).toEqual(EIGHT_FUDAS.slice(0, 6));
      expect(captures[0].text).toMatch(/1\s*\/\s*2/);
      expect(captures[1].columns).toEqual(["仏地中海艦隊", "欧州連合艦隊"]);
      expect(captures[1].text).toMatch(/2\s*\/\s*2/);
      expect(recorder.downloads.map((download) => download.download)).toEqual([
        "2026夏イベ_札割り_1.png",
        "2026夏イベ_札割り_2.png",
      ]);
      expect(recorder.downloads[0].href).toBe(recorder.objectUrlOf(captures[0].blob));
      expect(recorder.downloads[1].href).toBe(recorder.objectUrlOf(captures[1].blob));
    });

    it("フォントの読み込みが終わる（document.fonts.ready）まで PNG を作らない", async () => {
      // 準備：document.fonts.ready を終わらせない
      fonts = installDocumentFonts({ holdReady: true });
      const { user, dialog } = renderDialog();

      // 実行
      await user.click(saveButton(dialog));
      await settle();

      // 検証：まだ作らない
      expect(domToBlobMock).not.toHaveBeenCalled();
      expect(recorder.downloads).toHaveLength(0);

      // 実行・検証：読み込みが終わると作って保存する
      fonts.resolveReady();
      await waitFor(() => expect(recorder.downloads).toHaveLength(1));
      expect(domToBlobMock).toHaveBeenCalledTimes(1);
    });

    it("日本語フォント（Noto Sans JP）の画像に使う文字を document.fonts.load で読み込み、終わるまで PNG を作らない", async () => {
      // 準備：document.fonts.load を終わらせない
      fonts = installDocumentFonts({ holdLoad: true });
      const { user, dialog } = renderDialog();

      // 実行
      await user.click(saveButton(dialog));
      await waitFor(() => expect(fonts.load).toHaveBeenCalled());
      await settle();

      // 検証：Noto Sans JP で、画像に出る文字（イベント名・札名・艦名・ツール名など）を読み込む。まだ作らない
      const text = loadedTextFor(fonts, "Noto Sans JP");
      expect(missingChars(text, ["2026夏イベ", "札割り", "連合艦隊", "時雨改二", "長門改二", APP_NAME, "特効"])).toEqual([]);
      expect(domToBlobMock).not.toHaveBeenCalled();

      // 実行・検証：読み込みが終わると作って保存する
      fonts.resolveLoad();
      await waitFor(() => expect(recorder.downloads).toHaveLength(1));
      expect(domToBlobMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("画像をコピー", () => {
    it("Clipboard API に対応していれば、PNG を ClipboardItem に入れてクリップボードへコピーし、「コピーしました ✓」と知らせる（ダウンロードはしない）", async () => {
      // 準備
      const { user, clipboard, dialog } = renderDialog();

      // 実行
      await user.click(await within(dialog).findByRole("button", { name: "画像をコピー" }));

      // 検証
      await waitFor(() => expect(clipboard.write).toHaveBeenCalledTimes(1));
      expect(captures).toHaveLength(1);
      expect(captures[0].columns).toEqual(FIVE_FUDAS);
      const items = clipboard.write.mock.calls[0][0];
      expect(items).toHaveLength(1);
      const item = items[0];
      expect(item).toBeInstanceOf(FakeClipboardItem);
      const clipboardItem = item as FakeClipboardItem;
      expect(clipboardItem.types).toEqual(["image/png"]);
      expect(await clipboardItem.items["image/png"]).toBe(captures[0].blob);
      expect(await within(dialog).findByRole("button", { name: "コピーしました ✓" })).toBeInTheDocument();
      const statuses = within(dialog).getAllByRole("status");
      expect(statuses.some((status) => status.textContent?.includes(COPIED_MESSAGE))).toBe(true);
      expect(recorder.downloads).toHaveLength(0);
    });

    it("コピーもフォントの読み込みが終わるまで PNG を作らない", async () => {
      // 準備
      fonts = installDocumentFonts({ holdReady: true });
      const { user, clipboard, dialog } = renderDialog();

      // 実行
      await user.click(await within(dialog).findByRole("button", { name: "画像をコピー" }));
      await settle();

      // 検証
      expect(domToBlobMock).not.toHaveBeenCalled();
      expect(clipboard.write).not.toHaveBeenCalled();

      // 実行・検証
      fonts.resolveReady();
      await waitFor(() => expect(clipboard.write).toHaveBeenCalledTimes(1));
    });

    it.each<[ClipboardSupport, string]>([
      ["no-clipboard-item", "ClipboardItem がない"],
      ["no-clipboard", "navigator.clipboard がない"],
      ["text-only", "navigator.clipboard.write がない（writeText だけ）"],
    ])("Clipboard API に対応していない（%s：%s）ブラウザでは「画像をコピー」を出さない（保存はできる）", async (support) => {
      // 準備・実行
      const { dialog } = renderDialog({}, support);
      await settle();

      // 検証
      expect(within(dialog).queryByRole("button", { name: "画像をコピー" })).not.toBeInTheDocument();
      expect(within(dialog).queryByRole("combobox", { name: "コピーする画像" })).not.toBeInTheDocument();
      expect(saveButton(dialog)).toBeEnabled();
    });

    it("複数枚のときは「コピーする画像」で何枚目かを選べ、選んだ画像をコピーして「2枚目の画像をコピーしました…」と知らせる", async () => {
      // 準備
      const { user, clipboard, dialog } = renderEightFudaDialog();
      const select = await within(dialog).findByRole("combobox", { name: "コピーする画像" });
      expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["1枚目", "2枚目"]);

      // 実行
      await user.selectOptions(select, "2枚目");
      await user.click(within(dialog).getByRole("button", { name: "画像をコピー" }));

      // 検証
      await waitFor(() => expect(clipboard.write).toHaveBeenCalledTimes(1));
      expect(captures).toHaveLength(1);
      expect(captures[0].columns).toEqual(["仏地中海艦隊", "欧州連合艦隊"]);
      expect(captures[0].text).toMatch(/2\s*\/\s*2/);
      await waitFor(() => {
        const statuses = within(dialog).getAllByRole("status");
        expect(statuses.some((status) => status.textContent?.includes(`2枚目の${COPIED_MESSAGE}`))).toBe(true);
      });
    });

    it("1 枚だけのときは「コピーする画像」を出さない", async () => {
      // 準備・実行
      const { dialog } = renderDialog();
      await within(dialog).findByRole("button", { name: "画像をコピー" });

      // 検証
      expect(within(dialog).queryByRole("combobox", { name: "コピーする画像" })).not.toBeInTheDocument();
    });
  });

  describe("閉じる", () => {
    it("右上の「×」（閉じる）で閉じる", async () => {
      // 準備
      const { user, dialog } = renderDialog();

      // 実行
      await user.click(within(dialog).getByRole("button", { name: "閉じる" }));

      // 検証
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("「やめる」で閉じる（PNG は作らない）", async () => {
      // 準備
      const { user, dialog } = renderDialog();

      // 実行
      await user.click(within(dialog).getByRole("button", { name: "やめる" }));

      // 検証
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(domToBlobMock).not.toHaveBeenCalled();
    });

    it("背景の暗い部分をクリックすると閉じ、ウィンドウの中をクリックしても閉じない", async () => {
      // 準備
      const { user, dialog } = renderDialog();

      // 実行・検証：中の説明をクリックしても閉じない
      await user.click(within(dialog).getByText("横長 1600×900 の PNG。X などに貼りやすい大きさです"));
      expect(screen.getByRole("dialog", { name: "画像で保存" })).toBeInTheDocument();

      // 実行・検証：背景をクリックすると閉じる
      await user.click(screen.getByTestId("export-image-dialog-overlay"));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("開いている間は後ろの画面の部品を操作できず（支援技術からも隠れる）、閉じると戻る", async () => {
      // 準備
      const { user, dialog } = renderDialog();

      // 検証：開いている間は見つからない
      expect(screen.queryByRole("button", { name: "後ろの画面のボタン" })).not.toBeInTheDocument();

      // 実行・検証：閉じると戻る
      await user.click(within(dialog).getByRole("button", { name: "やめる" }));
      expect(screen.getByRole("button", { name: "後ろの画面のボタン" })).toBeInTheDocument();
    });
  });
});
