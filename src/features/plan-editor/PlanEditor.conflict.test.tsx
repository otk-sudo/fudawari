import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DefinitionDoc } from "@/domain/definition-edit";
import type { Mutable } from "@/test/fixtures";
import {
  boostGroupNamed,
  confirmPublish,
  createFakeRepository,
  detailRegion,
  DRAFT_VERSION,
  expectTextMatching,
  expectTextShown,
  fixClock,
  fudaItem,
  LATEST_EVENT_ID,
  makeDoc,
  publishButton,
  renderEditor,
  type RenderedEditor,
  restoreClock,
  saveDraftButton,
  savedDraftInput,
  selectStage,
  stageButton,
  stageIn,
  textContaining,
} from "./test-helpers";
import type { SaveDraftResult } from "./types";

// イベント定義の画面の「保存時の衝突の確認」（要件 3.7「同時編集」、roadmap T3-8 の画面の部分、PR-11b）
//
// 下書きの保存（save_draft）が conflict（開いた後に他の人が保存していた）を返したら、
// 「開いたときの版（最後に読んだ・保存した下書き）」「自分の内容」「相手の内容」を mergeDefinitions で 3 方向に合わせる。
// - 衝突がなく、文書の問題もなければ：確認せずに、合わせた内容を、相手の版を開いたときの版として保存し直す
// - 衝突があれば：確認のウィンドウ（role="alertdialog"・名前「保存の確認」。モック PlanEditor.dc.html）で選ばせ、
//   選んだら resolveMerge で作った文書を、相手の版で保存する
// - 合わせた文書に問題（resolveMerge の issues・mergeDefinitions の issues）があれば、理由を出して保存しない
//
// 画面の部品の「形の約束」（テストが探すもの。実装の担当向け）
// - 確認のウィンドウ：role="alertdialog"、名前「保存の確認」。
//   中の文：「開いた後に（名前）が下書きを保存していました（日時）」、自動で合わせた所ごとに「自動で合わせた所：（表示名）（（名前）が追加）」
//   （変更の種類は 追加／削除／変更）と「場所を見る」、衝突ごとに「同じ所を2人が変えています：（表示名）」「どちらを残しますか？」と
//   選択肢 2 つ（role="radio"。名前「（名前）の内容：（相手の値）」「あなたの内容：（自分の値）」）と「場所を見る」。
//   ボタン「この内容で保存」（すべての衝突を選ぶまで押せない）・「保存をやめる」
// - 「場所を見る」のボタンは、その項目の文（表示名）と同じ入れ物に置く（テストは、表示名にいちばん近い「場所を見る」を押す）
// - 攻略の流れの印：段階のボタンの中に、2 人とも変えた段階は「要選択」、相手だけが変えた段階は「（名前）が変更」の文を置く
//   （色・枠〔赤く光らせる・橙の枠〕は見た目なので、ここでは文だけを確かめる）。自動で合わせた段階の印は、保存した後も残す
// - 保存した後の文：「下書きを保存しました。（名前）の変更も含めた内容が、管理者・協力者全員の定義画面に反映されます」
//
// テストで決めたこと（親の確認用）
// - 保存し直すときの保存の記録（p_logs）は、相手の内容から合わせた内容への変更（＝自分が足した変更）だけにする
//   （相手の変更を自分の記録に入れない。save_logs は保存した人の名前で残るため）
// - 「変更を公開する」の前の下書きの保存が衝突したら、公開しないで確認のウィンドウを出す（選んで保存した後に公開し直すのは利用者）
// - 衝突した項目の詳細欄での表示（「（名前）は「重要」に変更しています」）は、今回は確かめない（親の指示の範囲外）

/** 相手（先に保存した人）の表示名 */
const THEIRS_NAME = "協力者B";
/** 相手が保存した日時（「開いた後に…（日時）」に出す） */
const THEIRS_SAVED_AT = "2026-10-17T11:52:00+09:00";
/** 相手の版（開いたときの版 7 の次） */
const THEIRS_VERSION = DRAFT_VERSION + 1;
/** 相手が E3 ゲージ4 に足した特効グループ */
const ADDED_GROUP_NAME = "第二十七駆逐隊";
/** 保存した後の文 */
const SAVED_WITH_THEIRS = `下書きを保存しました。${THEIRS_NAME}の変更も含めた内容が、管理者・協力者全員の定義画面に反映されます`;

type DraftDoc = Mutable<DefinitionDoc>;

/** 書き換えられる文書の段階（なければテストの書き間違いとして例外） */
function stageOf(draft: DraftDoc, stageId: string): DraftDoc["stages"][number] {
  const stage = draft.stages.find((s) => s.id === stageId);
  if (stage === undefined) throw new Error(`テスト用の定義に段階 ${stageId} がありません`);
  return stage;
}

/** 書き換えられる文書の札（なければテストの書き間違いとして例外） */
function fudaOf(draft: DraftDoc, fudaId: string): DraftDoc["fudas"][number] {
  const fuda = draft.fudas.find((f) => f.id === fudaId);
  if (fuda === undefined) throw new Error(`テスト用の定義に札 ${fudaId} がありません`);
  return fuda;
}

/**
 * 相手が保存した内容：開いたときの版（2026夏イベ）の E3 ゲージ4 に特効グループ「第二十七駆逐隊」を足したもの。
 * change でさらに書き換える（衝突を作るとき）
 */
function theirsDoc(change?: (draft: DraftDoc) => void): DefinitionDoc {
  return makeDoc((draft) => {
    stageOf(draft, "E3-4").boosts.push({ id: "E3-4-Z", name: ADDED_GROUP_NAME, multiplier: 1.1, shipNames: ["時雨", "白露"] });
    change?.(draft);
  });
}

/** save_draft の conflict の結果（相手の版 8・相手の内容・名前・日時） */
function conflictResult(content: DefinitionDoc): SaveDraftResult {
  return {
    status: "conflict",
    version: THEIRS_VERSION,
    content,
    updatedByName: THEIRS_NAME,
    updatedAt: THEIRS_SAVED_AT,
  };
}

/** 1 回目の下書きの保存が conflict（相手の内容 theirs）を返す保管庫で、画面を描く（2 回目からは保存できる） */
async function renderWithConflict(theirs: DefinitionDoc): Promise<RenderedEditor> {
  const repository = createFakeRepository();
  repository.saveDraft.mockResolvedValueOnce(conflictResult(theirs));
  return renderEditor(undefined, { repository });
}

/** 段階を選んで、大事さを変える */
async function setImportance(user: UserEvent, areaName: string, stageName: string, label: string): Promise<void> {
  await selectStage(user, areaName, stageName);
  await user.click(within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: label }));
}

/** 札の編集の欄で、札番号を変える */
async function setGameNumber(user: UserEvent, fudaName: string, gameNumber: string): Promise<void> {
  await user.click(within(fudaItem(fudaName)).getByRole("button", { name: /編集/ }));
  const form = screen.getByRole("form", { name: "札を編集" });
  const numberBox = within(form).getByLabelText(/^札番号/);
  await user.clear(numberBox);
  await user.type(numberBox, gameNumber);
  await user.click(within(form).getByRole("button", { name: "変更する" }));
}

/** 確認のウィンドウ（出るまで待つ） */
function findConfirmDialog(): Promise<HTMLElement> {
  return screen.findByRole("alertdialog", { name: "保存の確認" });
}

/** 確認のウィンドウ（なければ null） */
function queryConfirmDialog(): HTMLElement | null {
  return screen.queryByRole("alertdialog", { name: "保存の確認" });
}

/** 空白（改行・全角空白を含む）を 1 つの半角空白にそろえる */
function normalizeSpace(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** element から上へたどって、文 text を含む最初の祖先（自分を含む）までの段数。root の外に出たら Infinity */
function distanceToText(element: Element, text: string, root: Element): number {
  let distance = 0;
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    if (normalizeSpace(current.textContent).includes(text)) return distance;
    if (current === root) break;
    distance += 1;
  }
  return Number.POSITIVE_INFINITY;
}

/** candidates のうち、文 text にいちばん近いもの（1 つに決まらなければテストの失敗にする） */
function nearestTo(candidates: HTMLElement[], text: string, root: HTMLElement): HTMLElement {
  const distances = candidates.map((candidate) => distanceToText(candidate, text, root));
  const min = Math.min(...distances);
  const nearest = candidates.filter((_, index) => distances[index] === min);
  expect(nearest, `「${text}」にいちばん近い部品`).toHaveLength(1);
  return nearest[0] as HTMLElement;
}

/** 確認のウィンドウの中の、表示名 label の項目の「場所を見る」 */
function placeButtonFor(dialog: HTMLElement, label: string): HTMLElement {
  return nearestTo(within(dialog).getAllByRole("button", { name: "場所を見る" }), label, dialog);
}

/** 確認のウィンドウの中の、表示名 label の衝突の選択肢（名前 optionName） */
function choiceFor(dialog: HTMLElement, label: string, optionName: string): HTMLElement {
  return nearestTo(within(dialog).getAllByRole("radio", { name: optionName }), label, dialog);
}

describe("イベント定義の画面（PlanEditor）：保存時の衝突の確認（同時編集）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("違う所を変えていたとき（衝突なし）：自動で合わせて保存し直す", () => {
    it("合わせた内容（自分の変更＋相手が足した特効）を、相手の版（8）を開いたときの版として保存し直す", async () => {
      // 準備：相手は E3 ゲージ4 に特効を足し、自分は E2 ゲージ3 の大事さを「重要」にした
      const { user, repository } = await renderWithConflict(theirsDoc());
      await setImportance(user, "E2", "ゲージ3", "重要");

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const resaved = await savedDraftInput(repository, 2);
      expect(resaved.eventId).toBe(LATEST_EVENT_ID);
      expect(resaved.baseVersion).toBe(THEIRS_VERSION);
      expect(stageIn(resaved.content, "E2-3").importance).toBe("important");
      expect(stageIn(resaved.content, "E3-4").boosts.map((group) => group.name)).toContain(ADDED_GROUP_NAME);
      expect(queryConfirmDialog()).not.toBeInTheDocument();
    });

    it("保存し直すときの保存の記録は、自分が変えた所だけにする（相手が足した特効を自分の記録に入れない）", async () => {
      // 準備
      const { user, repository } = await renderWithConflict(theirsDoc());
      await setImportance(user, "E2", "ゲージ3", "重要");

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const resaved = await savedDraftInput(repository, 2);
      const summaries = resaved.logs.map((log) => log.summary);
      expect(summaries.some((summary) => summary.includes("E2 ゲージ3 の大事さ"))).toBe(true);
      expect(summaries.filter((summary) => summary.includes(ADDED_GROUP_NAME))).toEqual([]);
    });

    it("自動で合わせた所（「E3 ゲージ4 の特効「第二十七駆逐隊」」と「協力者Bが追加」）と、相手の変更も含めて保存したことを伝える", async () => {
      // 準備
      const { user, repository } = await renderWithConflict(theirsDoc());
      await setImportance(user, "E2", "ゲージ3", "重要");

      // 実行
      await user.click(saveDraftButton());

      // 検証
      await savedDraftInput(repository, 2);
      await waitFor(() => {
        expectTextShown(SAVED_WITH_THEIRS);
      });
      expectTextShown("自動で合わせた所", `E3 ゲージ4 の特効「${ADDED_GROUP_NAME}」`, `${THEIRS_NAME}が追加`);
    });

    it("相手だけが変えた段階（E3 ゲージ4）に「協力者Bが変更」の印を付け、保存した後も残す（自分だけが変えた段階には付けない）", async () => {
      // 準備
      const { user, repository } = await renderWithConflict(theirsDoc());
      await setImportance(user, "E2", "ゲージ3", "重要");

      // 実行
      await user.click(saveDraftButton());

      // 検証
      await savedDraftInput(repository, 2);
      await waitFor(() => {
        expectTextShown(SAVED_WITH_THEIRS);
      });
      expect(within(stageButton("E3", "ゲージ4")).getByText(`${THEIRS_NAME}が変更`)).toBeInTheDocument();
      expect(within(stageButton("E2", "ゲージ3")).queryByText(`${THEIRS_NAME}が変更`)).not.toBeInTheDocument();
      expect(within(stageButton("E2", "ゲージ3")).queryByText("要選択")).not.toBeInTheDocument();
    });

    it("保存し直した後は、合わせた内容（相手が足した特効）を表示し、次の保存は新しい版（9）から合わせた内容に重ねる", async () => {
      // 準備
      const { user, repository } = await renderWithConflict(theirsDoc());
      await setImportance(user, "E2", "ゲージ3", "重要");
      await user.click(saveDraftButton());
      await savedDraftInput(repository, 2);
      await waitFor(() => {
        expectTextShown(SAVED_WITH_THEIRS);
      });

      // 実行：相手が足した特効を見て、E3 ゲージ4 の大事さを変えて、もう一度保存する
      await selectStage(user, "E3", "ゲージ4");
      expect(boostGroupNamed(ADDED_GROUP_NAME)).toBeInTheDocument();
      await user.click(within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: "普通" }));
      await user.click(saveDraftButton());

      // 検証
      const third = await savedDraftInput(repository, 3);
      expect(third.baseVersion).toBe(THEIRS_VERSION + 1);
      expect(stageIn(third.content, "E3-4").importance).toBe("normal");
      expect(stageIn(third.content, "E3-4").boosts.map((group) => group.name)).toContain(ADDED_GROUP_NAME);
      expect(stageIn(third.content, "E2-3").importance).toBe("important");
    });

    it("合わせた文書に問題（別々の札に同じ札番号 6）があれば、保存し直さずに理由を出す", async () => {
      // 準備：相手はウルシー攻撃部隊の札番号を 6 に、自分は第六艦隊の札番号を 6 にした（それぞれの文書には問題がない）
      const { user, repository } = await renderWithConflict(
        theirsDoc((draft) => {
          fudaOf(draft, "ulithi").gameNumber = 6;
        }),
      );
      await setGameNumber(user, "第六艦隊", "6");

      // 実行
      await user.click(saveDraftButton());

      // 検証
      await waitFor(() => {
        expectTextMatching(/札番号 ?6 ?が.*重複/);
      });
      expect(repository.saveDraft).toHaveBeenCalledTimes(1);
    });
  });

  describe("同じ所を 2 人が変えていたとき（衝突あり）：確認のウィンドウで選ばせる", () => {
    /** 相手は E2 ゲージ3 の大事さを「重要」にし、E3 ゲージ4 に特効を足した */
    const theirsWithConflict = (): DefinitionDoc =>
      theirsDoc((draft) => {
        stageOf(draft, "E2-3").importance = "important";
      });

    it("確認のウィンドウに、相手の名前と保存した日時、自動で合わせた所、衝突した所と 2 つの選択肢を出し、まだ保存し直さない", async () => {
      // 準備：自分は E2 ゲージ3 の大事さを「普通」にした
      const { user, repository } = await renderWithConflict(theirsWithConflict());
      await setImportance(user, "E2", "ゲージ3", "普通");

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const dialog = await findConfirmDialog();
      expect(dialog).toHaveTextContent(new RegExp(`開いた後に${THEIRS_NAME}が下書きを保存していました（[^）]*11:52）`));
      expect(
        within(dialog).getAllByText(
          textContaining("自動で合わせた所", `E3 ゲージ4 の特効「${ADDED_GROUP_NAME}」`, `${THEIRS_NAME}が追加`),
        ).length,
      ).toBeGreaterThan(0);
      expect(within(dialog).getAllByText(textContaining("同じ所を2人が変えています", "E2 ゲージ3 の大事さ")).length).toBeGreaterThan(0);
      expect(dialog).toHaveTextContent("どちらを残しますか？");
      expect(within(dialog).getByRole("radio", { name: `${THEIRS_NAME}の内容：重要` })).toBeInTheDocument();
      expect(within(dialog).getByRole("radio", { name: "あなたの内容：普通" })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "この内容で保存" })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "保存をやめる" })).toBeEnabled();
      expect(repository.saveDraft).toHaveBeenCalledTimes(1);
    });

    it("どちらかを選ぶと「この内容で保存」を押せるようになる", async () => {
      // 準備
      const { user } = await renderWithConflict(theirsWithConflict());
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 実行
      await user.click(within(dialog).getByRole("radio", { name: `${THEIRS_NAME}の内容：重要` }));

      // 検証
      expect(within(dialog).getByRole("radio", { name: `${THEIRS_NAME}の内容：重要` })).toBeChecked();
      expect(within(dialog).getByRole("button", { name: "この内容で保存" })).toBeEnabled();
    });

    it("「協力者Bの内容」を選んで保存すると、相手の値と自動で合わせた所を入れた文書を、相手の版（8）で保存し、相手の変更も含めて保存したことを伝える", async () => {
      // 準備
      const { user, repository } = await renderWithConflict(theirsWithConflict());
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 実行
      await user.click(within(dialog).getByRole("radio", { name: `${THEIRS_NAME}の内容：重要` }));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));

      // 検証
      const resaved = await savedDraftInput(repository, 2);
      expect(resaved.eventId).toBe(LATEST_EVENT_ID);
      expect(resaved.baseVersion).toBe(THEIRS_VERSION);
      expect(stageIn(resaved.content, "E2-3").importance).toBe("important");
      expect(stageIn(resaved.content, "E3-4").boosts.map((group) => group.name)).toContain(ADDED_GROUP_NAME);
      await waitFor(() => {
        expectTextShown(SAVED_WITH_THEIRS);
      });
      expect(queryConfirmDialog()).not.toBeInTheDocument();
    });

    it("「あなたの内容」を選んで保存すると、自分の値（普通）と自動で合わせた所を入れた文書を保存する", async () => {
      // 準備
      const { user, repository } = await renderWithConflict(theirsWithConflict());
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 実行
      await user.click(within(dialog).getByRole("radio", { name: "あなたの内容：普通" }));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));

      // 検証
      const resaved = await savedDraftInput(repository, 2);
      expect(resaved.baseVersion).toBe(THEIRS_VERSION);
      expect(stageIn(resaved.content, "E2-3").importance).toBe("normal");
      expect(stageIn(resaved.content, "E3-4").boosts.map((group) => group.name)).toContain(ADDED_GROUP_NAME);
    });

    it("衝突が 2 つあれば、両方を選ぶまで「この内容で保存」を押せず、選んだとおりに保存する", async () => {
      // 準備：相手は E2 ゲージ3 を「重要」・E3 ゲージ3 を「難所」に、自分はどちらも「普通」にした
      const { user, repository } = await renderWithConflict(
        theirsDoc((draft) => {
          stageOf(draft, "E2-3").importance = "important";
          stageOf(draft, "E3-3").importance = "hard";
        }),
      );
      await setImportance(user, "E2", "ゲージ3", "普通");
      await setImportance(user, "E3", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 実行：1 つ目だけを選ぶ
      await user.click(choiceFor(dialog, "E2 ゲージ3 の大事さ", `${THEIRS_NAME}の内容：重要`));

      // 検証
      expect(within(dialog).getByRole("button", { name: "この内容で保存" })).toBeDisabled();

      // 実行：2 つ目も選んで保存する
      await user.click(choiceFor(dialog, "E3 ゲージ3 の大事さ", "あなたの内容：普通"));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));

      // 検証
      const resaved = await savedDraftInput(repository, 2);
      expect(stageIn(resaved.content, "E2-3").importance).toBe("important");
      expect(stageIn(resaved.content, "E3-3").importance).toBe("normal");
    });

    it("「保存をやめる」で、保存し直さずにウィンドウを閉じ、自分の編集（普通）は残す", async () => {
      // 準備
      const { user, repository } = await renderWithConflict(theirsWithConflict());
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 実行
      await user.click(within(dialog).getByRole("button", { name: "保存をやめる" }));

      // 検証
      await waitFor(() => {
        expect(queryConfirmDialog()).not.toBeInTheDocument();
      });
      expect(repository.saveDraft).toHaveBeenCalledTimes(1);
      await selectStage(user, "E2", "ゲージ3");
      expect(
        within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: "普通" }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("攻略の流れで、2 人とも変えた段階に「要選択」、相手だけが変えた段階に「協力者Bが変更」の印を付け、保存した後は「要選択」だけを消す", async () => {
      // 準備
      const { user, repository } = await renderWithConflict(theirsWithConflict());
      await setImportance(user, "E2", "ゲージ3", "普通");

      // 実行
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 検証：確認の間
      expect(within(stageButton("E2", "ゲージ3")).getByText("要選択")).toBeInTheDocument();
      expect(within(stageButton("E3", "ゲージ4")).getByText(`${THEIRS_NAME}が変更`)).toBeInTheDocument();
      expect(within(stageButton("E1", "ギミック〜ゲージ3")).queryByText("要選択")).not.toBeInTheDocument();

      // 実行：選んで保存する
      await user.click(within(dialog).getByRole("radio", { name: "あなたの内容：普通" }));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));
      await savedDraftInput(repository, 2);

      // 検証：保存した後
      await waitFor(() => {
        expect(within(stageButton("E2", "ゲージ3")).queryByText("要選択")).not.toBeInTheDocument();
      });
      expect(within(stageButton("E3", "ゲージ4")).getByText(`${THEIRS_NAME}が変更`)).toBeInTheDocument();
    });

    it("「場所を見る」で、その段階を選ぶ（衝突した所は E2 ゲージ3、自動で合わせた所は E3 ゲージ4）", async () => {
      // 準備
      const { user } = await renderWithConflict(theirsWithConflict());
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();
      await selectStage(user, "E1", "ギミック〜ゲージ3");

      // 実行
      await user.click(placeButtonFor(dialog, "E2 ゲージ3 の大事さ"));

      // 検証
      expect(stageButton("E2", "ゲージ3")).toHaveAttribute("aria-pressed", "true");

      // 実行
      await user.click(placeButtonFor(dialog, `E3 ゲージ4 の特効「${ADDED_GROUP_NAME}」`));

      // 検証
      expect(stageButton("E3", "ゲージ4")).toHaveAttribute("aria-pressed", "true");
      expect(stageButton("E2", "ゲージ3")).toHaveAttribute("aria-pressed", "false");
    });

    it("選んだ結果の文書に問題（別々の札に同じ札番号 6）があれば、保存せずに理由を出す", async () => {
      // 準備：大事さの衝突に加えて、相手はウルシー攻撃部隊・自分は第六艦隊の札番号を 6 にした
      const { user, repository } = await renderWithConflict(
        theirsDoc((draft) => {
          stageOf(draft, "E2-3").importance = "important";
          fudaOf(draft, "ulithi").gameNumber = 6;
        }),
      );
      await setImportance(user, "E2", "ゲージ3", "普通");
      await setGameNumber(user, "第六艦隊", "6");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 実行（ボタンを押せなくする実装なら、押しても何も起きない）
      await user.click(within(dialog).getByRole("radio", { name: `${THEIRS_NAME}の内容：重要` }));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));

      // 検証
      await waitFor(() => {
        expectTextMatching(/札番号 ?6 ?が.*重複/);
      });
      expect(repository.saveDraft).toHaveBeenCalledTimes(1);
    });

    it("「変更を公開する」の前の下書きの保存が衝突したら、公開せずに確認のウィンドウを出す", async () => {
      // 準備
      const { user, repository } = await renderWithConflict(theirsWithConflict());
      await setImportance(user, "E2", "ゲージ3", "普通");

      // 実行
      await user.click(publishButton());
      await confirmPublish(user);

      // 検証
      await findConfirmDialog();
      expect(repository.publish).not.toHaveBeenCalled();
    });
  });
});
