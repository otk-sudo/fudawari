import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DefinitionDoc } from "@/domain/definition-edit";
import { createDeferred } from "@/test/deferred";
import type { Mutable } from "@/test/fixtures";
import {
  ADMIN,
  autumn2025Definition,
  blurInput,
  confirmPublish,
  createFakeRepository,
  detailRegion,
  DRAFT_VERSION,
  enterDateTime,
  expectStages,
  expectTextMatching,
  expectTextNotShown,
  expectTextShown,
  fixClock,
  fudaItem,
  LATEST_EVENT_ID,
  makeData,
  makeDoc,
  makeEvent,
  publishButton,
  renderEditor,
  type RenderedEditor,
  restoreClock,
  saveDraftButton,
  savedDraftInput,
  selectStage,
  stageIn,
  switchToCreate,
  textContaining,
} from "./test-helpers";
import type { SaveDraftResult } from "./types";

// イベント定義の画面（PR-11c）：PR-11b（定義画面と Supabase の結合）のレビュー・Codex の指摘の直し方を、先に画面テストにしたもの（TDD の Red）。
// 直し方は親（取りまとめ）が決めた。番号は親の指示の番号（7・10 は supabase-repository.test.ts と src/app/definition/page.test.tsx）
//  1. 確認のウィンドウが出ている間は、既存を更新／新規作成の切り替えを押せなくし、理由を出す（レビュー M1・Codex 4301057821）。
//     保存の途中で切り替えた後に衝突が返っても、その衝突のウィンドウが見えて解ける
//  2. 「変更を公開する」から確認のウィンドウに進み、選んで保存した後の知らせにも「もう一度公開してください」を出す（P3・Codex 4301057804）
//  3. 合わせた結果で消えた段階には「場所を見る」を出さない（Codex 4301057816）
//  4. 保存の後の「（名前）の変更も含めた内容が…」には、自動で合わせた変更か「相手の内容」を選んだ項目が実際に残った相手だけを出す。
//     どの相手の変更も残っていなければ、名前を出さない文（ふだんの保存の文）にする（Codex 4301057826）
//  6. 確認のウィンドウからの保存し直しで、3 人目と合わせた結果に文書の問題があったら、ウィンドウを古い版のまま残さない（P2）
//  8. 守りのテスト（M2-1〜6。いまの実装で通ってよい）
//  9. 確認のウィンドウ（role="alertdialog"）に aria-describedby（見出しの説明文を指す）（P5）
//
// 画面の部品の「形の約束」（テストが探すもの。実装の担当向け）
// - 切り替え：radio「既存を更新」「新規作成」（radiogroup「新規か更新か」）。確認のウィンドウが出ている間は両方 disabled。
//   理由の文は「保存の確認」と「切り替えられません」を含む 1 つの文（例「保存の確認が終わるまで、既存を更新・新規作成は切り替えられません」）
// - 確認のウィンドウ：role="alertdialog"・名前「保存の確認」。説明（aria-describedby）は「開いた後に（名前）が下書きを保存していました（日時）」を含む
// - 公開の後に出す文：MSG_PUBLISH_AFTER_MERGE「内容を確かめてから、もう一度公開してください」（自動で合わせたときと同じ文）
// - 相手の変更が残らなかった保存の文：「下書きを保存しました。管理者・協力者全員の定義画面に反映されます」（ふだんの保存と同じ文）
// - 消えた段階の自動で合わせた所：「自動で合わせた所：（表示名）（（名前）が削除）」の文は出すが、「場所を見る」のボタンは出さない
//
// 今は 2026-10-17 12:00（日本時間）。最新のイベントは 2026夏イベ（下書きの版 7）

/** 先に保存した人（2 人目）・その後に保存した人（3 人目） */
const NAME_B = "協力者B";
const NAME_C = "協力者C";
const SAVED_AT = "2026-10-17T11:52:00+09:00";
/** 相手が E3 ゲージ4 に足した特効グループ */
const ADDED_GROUP_NAME = "第二十七駆逐隊";
/** ふだんの保存の文 */
const MSG_SAVED = "下書きを保存しました。管理者・協力者全員の定義画面に反映されます";
/** 公開の前の保存で相手の変更を合わせたときの文（自動で合わせたときと同じ） */
const MSG_PUBLISH_AFTER_MERGE = "内容を確かめてから、もう一度公開してください";
/** 確認のウィンドウが出ている間、切り替えられない理由（要点） */
const SWITCH_LOCKED_REASON = /保存の確認.*切り替えられません/;

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

/** 相手が E3 ゲージ4 に特効グループ「第二十七駆逐隊」を足す */
function addGroupToE34(draft: DraftDoc): void {
  stageOf(draft, "E3-4").boosts.push({ id: "E3-4-Z", name: ADDED_GROUP_NAME, multiplier: 1.1, shipNames: ["時雨"] });
}

/** 相手が E2 ゲージ3 の大事さを「重要」にする（自分が「普通」にすると衝突する） */
function makeE23Important(draft: DraftDoc): void {
  stageOf(draft, "E2-3").importance = "important";
}

/** save_draft の conflict の結果 */
function conflictResult(version: number, content: DefinitionDoc, name: string): SaveDraftResult {
  return { status: "conflict", version, content, updatedByName: name, updatedAt: SAVED_AT };
}

/** 保存の結果を順に返す保管庫で画面を描く（並べた分の後は、ふだんどおり保存できる） */
async function renderWithSaveResults(...results: SaveDraftResult[]): Promise<RenderedEditor> {
  const repository = createFakeRepository();
  for (const result of results) repository.saveDraft.mockResolvedValueOnce(result);
  return renderEditor(undefined, { repository });
}

/** 段階を選んで、大事さを変える */
async function setImportance(user: UserEvent, areaName: string, stageName: string, label: string): Promise<void> {
  await selectStage(user, areaName, stageName);
  await user.click(within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: label }));
}

/** 段階の詳細の大事さのボタンが押されているか（aria-pressed） */
function importancePressed(label: string): string | null {
  return within(within(detailRegion()).getByRole("group", { name: "大事さ" }))
    .getByRole("button", { name: label })
    .getAttribute("aria-pressed");
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

/** 確認のウィンドウが閉じるまで待つ */
async function waitForDialogClosed(): Promise<void> {
  await waitFor(() => {
    expect(queryConfirmDialog()).not.toBeInTheDocument();
  });
}

/** 切り替えの radio */
function modeRadio(label: "既存を更新" | "新規作成"): HTMLElement {
  return screen.getByRole("radio", { name: label });
}

/** 成功の知らせ（role="status"）のうち、文 text を含むもの（出るまで待つ） */
async function findStatusContaining(text: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = screen.queryAllByRole("status").filter((element) => (element.textContent ?? "").includes(text));
    expect(found, `「${text}」を含む知らせ`).toHaveLength(1);
    return found[0] as HTMLElement;
  });
}

/** 新規作成の「元にするイベント」の選択欄 */
function baseSelect(): HTMLElement {
  return screen.getByRole("combobox", { name: "元にするイベント" });
}

describe("イベント定義の画面（PlanEditor）：PR-11b のレビュー・Codex の指摘の直し方（PR-11c）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("1. 確認のウィンドウが出ている間は、既存を更新／新規作成を切り替えられない（レビュー M1・Codex 4301057821）", () => {
    it("確認のウィンドウが出ている間は「既存を更新」「新規作成」を押せず、切り替えられない理由を出す", async () => {
      // 準備：相手は E2 ゲージ3 を「重要」、自分は「普通」にした（衝突する）
      const { user } = await renderWithSaveResults(conflictResult(DRAFT_VERSION + 1, makeDoc(makeE23Important), NAME_B));
      await setImportance(user, "E2", "ゲージ3", "普通");

      // 実行
      await user.click(saveDraftButton());
      await findConfirmDialog();

      // 検証
      expect(modeRadio("新規作成")).toBeDisabled();
      expect(modeRadio("既存を更新")).toBeDisabled();
      expectTextMatching(SWITCH_LOCKED_REASON);
    });

    it("確認のウィンドウが出ている間に「新規作成」を押しても切り替わらず、ウィンドウは出たまま", async () => {
      // 準備
      const { user } = await renderWithSaveResults(conflictResult(DRAFT_VERSION + 1, makeDoc(makeE23Important), NAME_B));
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      await findConfirmDialog();

      // 実行（押せなくする実装なら、押しても何も起きない）
      await user.click(modeRadio("新規作成"));

      // 検証
      expect(modeRadio("既存を更新")).toBeChecked();
      expect(queryConfirmDialog()).toBeInTheDocument();
    });

    it("確認のウィンドウを閉じたら（保存をやめる）、切り替えを押せるように戻り、理由の文を消す", async () => {
      // 準備
      const { user } = await renderWithSaveResults(conflictResult(DRAFT_VERSION + 1, makeDoc(makeE23Important), NAME_B));
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 実行
      await user.click(within(dialog).getByRole("button", { name: "保存をやめる" }));
      await waitForDialogClosed();

      // 検証
      expect(modeRadio("新規作成")).toBeEnabled();
      expect(modeRadio("既存を更新")).toBeEnabled();
      expect(screen.queryAllByText((_content, element) => SWITCH_LOCKED_REASON.test(element?.textContent ?? ""))).toHaveLength(0);
    });

    it("保存の途中で新規作成に切り替えた後に衝突が返っても、その衝突の確認のウィンドウが見え、選んで保存すると最新のイベントに相手の版（8）で保存する", async () => {
      // 準備：1 回目の保存の結果を後で返す
      const repository = createFakeRepository();
      const first = createDeferred<SaveDraftResult>();
      repository.saveDraft.mockImplementationOnce(() => first.promise);
      const { user } = await renderEditor(undefined, { repository });
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      await savedDraftInput(repository, 1);

      // 実行：保存の途中で新規作成に切り替え（切り替えを押せなくする実装なら、そのまま）、その後に衝突が返る
      await user.click(modeRadio("新規作成"));
      first.resolve(conflictResult(DRAFT_VERSION + 1, makeDoc(makeE23Important), NAME_B));

      // 検証：衝突の確認のウィンドウが見える
      const dialog = await findConfirmDialog();
      expect(dialog).toHaveTextContent(`開いた後に${NAME_B}が下書きを保存していました`);

      // 実行：選んで保存する
      await user.click(within(dialog).getByRole("radio", { name: "あなたの内容：普通" }));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));

      // 検証：最新のイベントに、相手の版で保存し直し、ウィンドウを閉じる
      const resaved = await savedDraftInput(repository, 2);
      expect(resaved.eventId).toBe(LATEST_EVENT_ID);
      expect(resaved.baseVersion).toBe(DRAFT_VERSION + 1);
      expect(stageIn(resaved.content, "E2-3").importance).toBe("normal");
      await waitForDialogClosed();
    });
  });

  describe("2. 「変更を公開する」から確認のウィンドウに進んで保存したら、もう一度公開してもらう（P3・Codex 4301057804）", () => {
    it("「変更を公開する」の前の保存が衝突し、選んで保存したら、公開せずに「内容を確かめてから、もう一度公開してください」を出す", async () => {
      // 準備：相手は E2 ゲージ3 を「重要」にし、E3 ゲージ4 に特効を足した
      const { user, repository } = await renderWithSaveResults(
        conflictResult(
          DRAFT_VERSION + 1,
          makeDoc((draft) => {
            makeE23Important(draft);
            addGroupToE34(draft);
          }),
          NAME_B,
        ),
      );
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(publishButton());
      await confirmPublish(user);
      const dialog = await findConfirmDialog();

      // 実行
      await user.click(within(dialog).getByRole("radio", { name: `${NAME_B}の内容：重要` }));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));

      // 検証
      await savedDraftInput(repository, 2);
      const status = await findStatusContaining("下書きを保存しました");
      expect(status).toHaveTextContent(MSG_PUBLISH_AFTER_MERGE);
      expect(repository.publish).not.toHaveBeenCalled();
    });

    it("（比べる元）「下書きを保存」から確認のウィンドウに進んで保存したときは、「もう一度公開してください」を出さない", async () => {
      // 準備
      const { user, repository } = await renderWithSaveResults(
        conflictResult(
          DRAFT_VERSION + 1,
          makeDoc((draft) => {
            makeE23Important(draft);
            addGroupToE34(draft);
          }),
          NAME_B,
        ),
      );
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 実行
      await user.click(within(dialog).getByRole("radio", { name: `${NAME_B}の内容：重要` }));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));

      // 検証
      await savedDraftInput(repository, 2);
      const status = await findStatusContaining("下書きを保存しました");
      expect(status).not.toHaveTextContent("もう一度公開してください");
    });
  });

  describe("3. 合わせた結果で消えた段階には「場所を見る」を出さない（Codex 4301057816）", () => {
    /** 相手が E3 ゲージ4 を削除した */
    const deleteE34 = (draft: DraftDoc): void => {
      draft.stages = draft.stages.filter((s) => s.id !== "E3-4");
    };

    it("自動で合わせて保存し直した後の知らせで、相手が削除した段階（E3 ゲージ4）の行に「場所を見る」を出さない", async () => {
      // 準備：相手は E3 ゲージ4 を削除し、自分は E2 ゲージ3 の大事さを「重要」にした（衝突しない）
      const { user, repository } = await renderWithSaveResults(conflictResult(DRAFT_VERSION + 1, makeDoc(deleteE34), NAME_B));
      await setImportance(user, "E2", "ゲージ3", "重要");

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const resaved = await savedDraftInput(repository, 2);
      expect(resaved.content.stages.some((s) => s.id === "E3-4"), "前提：合わせた結果で E3 ゲージ4 が消える").toBe(false);
      const status = await findStatusContaining("下書きを保存しました");
      expect(within(status).getAllByText(textContaining("自動で合わせた所", `${NAME_B}が削除`)).length).toBeGreaterThan(0);
      expect(within(status).queryAllByRole("button", { name: "場所を見る" })).toHaveLength(0);
    });

    it("確認のウィンドウでも、相手が削除した段階の自動で合わせた所には「場所を見る」を出さない（衝突した所には出す）", async () => {
      // 準備：相手は E3 ゲージ4 を削除し、E2 ゲージ3 を「重要」に。自分は E2 ゲージ3 を「普通」にした
      const { user } = await renderWithSaveResults(
        conflictResult(
          DRAFT_VERSION + 1,
          makeDoc((draft) => {
            deleteE34(draft);
            makeE23Important(draft);
          }),
          NAME_B,
        ),
      );
      await setImportance(user, "E2", "ゲージ3", "普通");

      // 実行
      await user.click(saveDraftButton());

      // 検証：削除した段階の行はあり、「場所を見る」は衝突した E2 ゲージ3 の 1 つだけ
      const dialog = await findConfirmDialog();
      expect(within(dialog).getAllByText(textContaining("自動で合わせた所", `${NAME_B}が削除`)).length).toBeGreaterThan(0);
      expect(within(dialog).getAllByRole("button", { name: "場所を見る" })).toHaveLength(1);
    });
  });

  describe("4. 「（名前）の変更も含めた」には、変更が実際に残った相手だけを出す（Codex 4301057826）", () => {
    it("衝突だけで自動で合わせた所がなく、すべて「あなたの内容」を選んで保存したら、名前を出さずにふだんの保存の文を出す", async () => {
      // 準備：相手は E2 ゲージ3 を「重要」にしただけ（自動で合わせる所はない）
      const { user, repository } = await renderWithSaveResults(
        conflictResult(DRAFT_VERSION + 1, makeDoc(makeE23Important), NAME_B),
      );
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 実行
      await user.click(within(dialog).getByRole("radio", { name: "あなたの内容：普通" }));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));

      // 検証
      await savedDraftInput(repository, 2);
      await waitFor(() => {
        expectTextShown(MSG_SAVED);
      });
      expectTextNotShown(`${NAME_B}の変更も含めた`);
    });

    it("（比べる元）衝突だけでも「協力者Bの内容」を選んで保存したら、協力者Bの名前を出す", async () => {
      // 準備
      const { user, repository } = await renderWithSaveResults(
        conflictResult(DRAFT_VERSION + 1, makeDoc(makeE23Important), NAME_B),
      );
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 実行
      await user.click(within(dialog).getByRole("radio", { name: `${NAME_B}の内容：重要` }));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));

      // 検証
      await savedDraftInput(repository, 2);
      await waitFor(() => {
        expectTextShown(`下書きを保存しました。${NAME_B}の変更も含めた内容が、管理者・協力者全員の定義画面に反映されます`);
      });
    });

    it("3 人目：協力者Bの変更は自動で合わせ、協力者Cとの衝突で「あなたの内容」を選んだら、協力者Bだけを出す（協力者Cは出さない）", async () => {
      // 準備：協力者B は E3 ゲージ4 に特効を足した（自動で合わせる）。協力者C はさらに E2 ゲージ3 を「重要」にした（衝突）
      const theirsB = makeDoc(addGroupToE34);
      const theirsC = makeDoc((draft) => {
        addGroupToE34(draft);
        makeE23Important(draft);
      });
      const { user, repository } = await renderWithSaveResults(
        conflictResult(DRAFT_VERSION + 1, theirsB, NAME_B),
        conflictResult(DRAFT_VERSION + 2, theirsC, NAME_C),
      );
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 実行
      await user.click(within(dialog).getByRole("radio", { name: "あなたの内容：普通" }));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));

      // 検証
      const third = await savedDraftInput(repository, 3);
      expect(third.baseVersion).toBe(DRAFT_VERSION + 2);
      const status = await findStatusContaining("下書きを保存しました");
      expect(status).toHaveTextContent(`${NAME_B}の変更も含めた内容`);
      expect(status).not.toHaveTextContent(NAME_C);
    });
  });

  describe("6. 確認のウィンドウからの保存し直しで、3 人目と合わせた結果に問題があったら、ウィンドウを古い版のまま残さない（P2）", () => {
    it("協力者Cと合わせると別々の札に同じ札番号 6 になるなら、協力者Bの版のウィンドウを残さない（閉じて理由を出すか、協力者Cの版に入れ替える）", async () => {
      // 準備：協力者B は E2 ゲージ3 を「重要」に（衝突）。自分は E2 ゲージ3 を「普通」に、第六艦隊の札番号を 6 にした。
      // 保存し直すと、協力者C（協力者B の内容に加えて、ウルシー攻撃部隊の札番号を 6 にした）が先に保存していた
      const theirsB = makeDoc(makeE23Important);
      const theirsC = makeDoc((draft) => {
        makeE23Important(draft);
        fudaOf(draft, "ulithi").gameNumber = 6;
      });
      const { user, repository } = await renderWithSaveResults(
        conflictResult(DRAFT_VERSION + 1, theirsB, NAME_B),
        conflictResult(DRAFT_VERSION + 2, theirsC, NAME_C),
      );
      await setImportance(user, "E2", "ゲージ3", "普通");
      await setGameNumber(user, "第六艦隊", "6");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();
      expect(dialog).toHaveTextContent(`開いた後に${NAME_B}が下書きを保存していました`);

      // 実行
      await user.click(within(dialog).getByRole("radio", { name: "あなたの内容：普通" }));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));

      // 検証：協力者B の版のウィンドウは残らない（閉じて札番号の重複の理由を出す、または協力者C の版に入れ替える）
      await savedDraftInput(repository, 2);
      await waitFor(() => {
        const current = queryConfirmDialog();
        if (current === null) {
          expectTextMatching(/札番号 ?6 ?が.*重複/);
        } else {
          expect(current).toHaveTextContent(`開いた後に${NAME_C}が下書きを保存していました`);
        }
      });
      // 問題のある文書は保存しない
      expect(repository.saveDraft).toHaveBeenCalledTimes(2);
    });
  });

  describe("8. 守りのテスト（M2-1〜6）", () => {
    it("M2-1 3 人目：自動で合わせて保存し直したらまた衝突したら、前に自動で合わせた所も確認のウィンドウに出し、選ぶと新しい相手の版（9）で保存する", async () => {
      // 準備
      const theirsB = makeDoc(addGroupToE34);
      const theirsC = makeDoc((draft) => {
        addGroupToE34(draft);
        makeE23Important(draft);
      });
      const { user, repository } = await renderWithSaveResults(
        conflictResult(DRAFT_VERSION + 1, theirsB, NAME_B),
        conflictResult(DRAFT_VERSION + 2, theirsC, NAME_C),
      );
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 検証：確認のウィンドウ
      expect(dialog).toHaveTextContent(`開いた後に${NAME_C}が下書きを保存していました`);
      expect(dialog).toHaveTextContent(`${NAME_B}が追加`);

      // 実行
      await user.click(within(dialog).getByRole("radio", { name: `${NAME_C}の内容：重要` }));
      await user.click(within(dialog).getByRole("button", { name: "この内容で保存" }));

      // 検証
      const third = await savedDraftInput(repository, 3);
      expect(third.baseVersion).toBe(DRAFT_VERSION + 2);
      expect(stageIn(third.content, "E2-3").importance).toBe("important");
      expect(stageIn(third.content, "E3-4").boosts.map((group) => group.name)).toContain(ADDED_GROUP_NAME);
      await waitForDialogClosed();
      expectTextShown(`${NAME_B}・${NAME_C}の変更も含めた内容`);
    });

    it("M2-2 保存の途中で編集した分は、自動で合わせて保存し直した後も残り、次の保存で新しい版（9）から送る", async () => {
      // 準備：1 回目の保存の結果を後で返す
      const repository = createFakeRepository();
      const first = createDeferred<SaveDraftResult>();
      repository.saveDraft.mockImplementationOnce(() => first.promise);
      const { user } = await renderEditor(undefined, { repository });
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      await savedDraftInput(repository, 1);

      // 実行：保存の途中で編集し、その後に衝突（協力者B が特効を足した）が返る
      await setImportance(user, "E2", "ゲージ3", "重要");
      first.resolve(conflictResult(DRAFT_VERSION + 1, makeDoc(addGroupToE34), NAME_B));

      // 検証：保存し直す内容は押したときの内容（普通）
      const second = await savedDraftInput(repository, 2);
      expect(stageIn(second.content, "E2-3").importance).toBe("normal");
      await waitFor(() => {
        expectTextShown(`${NAME_B}の変更も含めた内容`);
      });
      // 検証：途中の編集（重要）は残る
      await selectStage(user, "E2", "ゲージ3");
      expect(importancePressed("重要")).toBe("true");

      // 実行：もう一度保存する
      await user.click(saveDraftButton());

      // 検証
      const third = await savedDraftInput(repository, 3);
      expect(third.baseVersion).toBe(DRAFT_VERSION + 2);
      expect(stageIn(third.content, "E2-3").importance).toBe("important");
      expect(stageIn(third.content, "E3-4").boosts.map((group) => group.name)).toContain(ADDED_GROUP_NAME);
    });

    it("M2-3 「変更を公開する」の前の保存で相手の変更を自動で合わせたら、公開せずに「もう一度公開してください」を出す", async () => {
      // 準備
      const { user, repository } = await renderWithSaveResults(conflictResult(DRAFT_VERSION + 1, makeDoc(addGroupToE34), NAME_B));
      await setImportance(user, "E2", "ゲージ3", "重要");

      // 実行
      await user.click(publishButton());
      await confirmPublish(user);

      // 検証
      await savedDraftInput(repository, 2);
      await waitFor(() => {
        expectTextShown(MSG_PUBLISH_AFTER_MERGE);
      });
      expect(repository.publish).not.toHaveBeenCalled();
    });

    it("M2-4 確認のウィンドウが開いたらフォーカスをウィンドウの中に移し、Esc で閉じて「下書きを保存」にフォーカスを戻す", async () => {
      // 準備
      const { user, repository } = await renderWithSaveResults(
        conflictResult(DRAFT_VERSION + 1, makeDoc(makeE23Important), NAME_B),
      );
      await setImportance(user, "E2", "ゲージ3", "普通");

      // 実行
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 検証：開いたとき
      expect(dialog.contains(document.activeElement), "フォーカスが確認のウィンドウの中にある").toBe(true);

      // 実行
      await user.keyboard("{Escape}");

      // 検証：閉じたとき
      await waitForDialogClosed();
      expect(saveDraftButton()).toHaveFocus();
      expect(repository.saveDraft).toHaveBeenCalledTimes(1);
    });

    it("M2-4 「保存をやめる」で閉じたときも、押したボタン（変更を公開する）にフォーカスを戻す", async () => {
      // 準備
      const { user } = await renderWithSaveResults(conflictResult(DRAFT_VERSION + 1, makeDoc(makeE23Important), NAME_B));
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(publishButton());
      await confirmPublish(user);
      const dialog = await findConfirmDialog();

      // 実行
      await user.click(within(dialog).getByRole("button", { name: "保存をやめる" }));

      // 検証
      await waitForDialogClosed();
      expect(publishButton()).toHaveFocus();
    });

    it("M2-5 段階の削除の確認を「やめる」で閉じたら、「この段階を削除」にフォーカスを戻す", async () => {
      // 準備
      const { user } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      await user.click(within(detailRegion()).getByRole("button", { name: "この段階を削除" }));
      const confirm = screen.getByRole("alertdialog", { name: "段階の削除の確認" });

      // 実行
      await user.click(within(confirm).getByRole("button", { name: "やめる" }));

      // 検証
      expect(within(detailRegion()).getByRole("button", { name: "この段階を削除" })).toHaveFocus();
    });

    it("M2-6 新規作成でイベントを作った後は、「元にするイベント」の欄に「作成済み（2025秋イベを元に作成）」を出す", async () => {
      // 準備：2025秋イベを元にして、名前・開始日時を入れる
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      await switchToCreate(user);
      await user.selectOptions(baseSelect(), "2025秋イベ");
      await waitFor(() => {
        expectStages("E1", [["ゲージ1", "機動部隊"]]);
      });
      await user.type(screen.getByRole("textbox", { name: "イベント名" }), "2026秋イベ");
      enterDateTime(screen.getByLabelText(/^開始日時/), "2026-11-14T11:00");
      blurInput(screen.getByLabelText(/^開始日時/));

      // 実行
      await user.click(saveDraftButton());

      // 検証
      await waitFor(() => {
        expect(repository.createEvent).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(baseSelect()).toHaveDisplayValue("作成済み（2025秋イベを元に作成）");
      });
    });

    it("M2-6 未公開の新規イベントの続きでは、「元にするイベント」の欄に「作成済み（変えられません）」を出す", async () => {
      // 準備
      const unpublishedEvent = makeEvent({
        id: "2026-autumn",
        name: "2026秋イベ",
        startAt: "2026-11-14T11:00:00+09:00",
        draftContent: autumn2025Definition,
        draftVersion: 3,
        publishedContent: null,
      });
      const { user } = await renderEditor(makeData({ user: ADMIN, unpublishedEvent }));

      // 実行
      await switchToCreate(user);

      // 検証
      expect(baseSelect()).toHaveDisplayValue("作成済み（変えられません）");
    });
  });

  describe("9. 確認のウィンドウの説明（aria-describedby）（P5）", () => {
    it("確認のウィンドウ（alertdialog）の説明は、見出しの文「開いた後に協力者Bが下書きを保存していました（日時）」を含む", async () => {
      // 準備
      const { user } = await renderWithSaveResults(conflictResult(DRAFT_VERSION + 1, makeDoc(makeE23Important), NAME_B));
      await setImportance(user, "E2", "ゲージ3", "普通");

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const dialog = await findConfirmDialog();
      expect(dialog).toHaveAttribute("aria-describedby");
      expect(dialog).toHaveAccessibleDescription(new RegExp(`開いた後に${NAME_B}が下書きを保存していました（[^）]*11:52）`));
    });
  });
});
