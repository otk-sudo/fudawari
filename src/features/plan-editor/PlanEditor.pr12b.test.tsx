import { render, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DefinitionDoc } from "@/domain/definition-edit";
import { createDeferred } from "@/test/deferred";
import type { Mutable } from "@/test/fixtures";
import { PlanEditor } from "./PlanEditor";
import { SessionExpiredError } from "./repository-errors";
import {
  createFakeRepository,
  detailRegion,
  DRAFT_VERSION,
  expectTextMatching,
  fixClock,
  makeDoc,
  publishButton,
  renderEditor,
  restoreClock,
  saveDraftButton,
  savedDraftInput,
  selectStage,
  stageButton,
} from "./test-helpers";
import type { PlanEditorData, PublishResult, SaveDraftResult } from "./types";

// イベント定義の画面（PR-12b）：PR-11c（#22）のレビュー・Codex の指摘の直し方を、先に画面テストにしたもの（TDD の Red）。
// 直し方は親（取りまとめ）が決めた。番号は親の指示の番号（1・4 の一部は supabase-repository.test.ts）
//  2. 保存・公開の途中（busy の間）も、既存を更新／新規作成の切り替えを押せなくし、理由を出す
//     （Codex #22-4301258473・4301258475。確認のウィンドウの間と同じ扱い）
//  3. 確認のウィンドウの中の「場所を見る」は、編集中の文書と合わせた文書の両方にある段階だけに出す（レビュー P-a）
//  4. onSessionExpired が変わっても読み込み直さない（レビュー P-d。いまの実装で通ってよい守りのテスト）
//
// 画面の部品の「形の約束」（テストが探すもの。実装の担当向け）
// - 切り替え：radio「既存を更新」「新規作成」。保存・公開の途中は両方 disabled。
//   理由の文は「切り替えられません」を含む 1 つの文（例「保存・公開が終わるまで、既存を更新・新規作成は切り替えられません」）。
//   終わったら押せるように戻し、理由の文を消す
// - 確認のウィンドウ：role="alertdialog"・名前「保存の確認」。自動で合わせた所の行（listitem）に、
//   編集中の文書にない段階（相手が足した段階）の「場所を見る」を出さない
//
// PR-11c の既存のテスト「保存の途中で新規作成に切り替えた後に衝突が返っても…」（PlanEditor.followups.test.tsx）は変えていない。
// 押せない radio への click は何も起こさない（user-event の挙動）ため、切り替えられない仕様でもそのまま通る
//
// 今は 2026-10-17 12:00（日本時間）。最新のイベントは 2026夏イベ（下書きの版 7）

/** 先に保存した人 */
const NAME_B = "協力者B";
const SAVED_AT = "2026-10-17T11:52:00+09:00";
/** 保存・公開の途中に切り替えられない理由（要点） */
const BUSY_LOCKED_REASON = /切り替えられません/;

type DraftDoc = Mutable<DefinitionDoc>;

/** 書き換えられる文書の段階（なければテストの書き間違いとして例外） */
function stageOf(draft: DraftDoc, stageId: string): DraftDoc["stages"][number] {
  const stage = draft.stages.find((s) => s.id === stageId);
  if (stage === undefined) throw new Error(`テスト用の定義に段階 ${stageId} がありません`);
  return stage;
}

/** 切り替えの radio */
function modeRadio(label: "既存を更新" | "新規作成"): HTMLElement {
  return screen.getByRole("radio", { name: label });
}

/** 切り替えられない理由の文を持つ要素（なければ空） */
function lockedReasons(): HTMLElement[] {
  return screen.queryAllByText((_content, element) => {
    if (element === null || !BUSY_LOCKED_REASON.test(element.textContent ?? "")) return false;
    // いちばん内側の要素だけ
    return [...element.children].every((child) => !BUSY_LOCKED_REASON.test(child.textContent ?? ""));
  });
}

/** 段階を選んで、大事さを変える */
async function setImportance(user: UserEvent, areaName: string, stageName: string, label: string): Promise<void> {
  await selectStage(user, areaName, stageName);
  await user.click(within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: label }));
}

/** 確認のウィンドウ（出るまで待つ） */
function findConfirmDialog(): Promise<HTMLElement> {
  return screen.findByRole("alertdialog", { name: "保存の確認" });
}

describe("イベント定義の画面（PlanEditor）：PR-11c のレビュー・Codex の指摘の直し方（PR-12b）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("2. 保存・公開の途中は、既存を更新／新規作成を切り替えられない（Codex #22-4301258473・4301258475）", () => {
    it("「下書きを保存」の途中は「既存を更新」「新規作成」を押せず、切り替えられない理由を出す。保存が終わると押せるように戻り、理由を消す", async () => {
      // 準備：保存の結果を後で返す
      const repository = createFakeRepository();
      const pending = createDeferred<SaveDraftResult>();
      repository.saveDraft.mockImplementationOnce(() => pending.promise);
      const { user } = await renderEditor(undefined, { repository });
      await setImportance(user, "E2", "ゲージ3", "普通");

      // 実行
      await user.click(saveDraftButton());
      await savedDraftInput(repository, 1);

      // 検証：保存の途中
      expect(modeRadio("新規作成")).toBeDisabled();
      expect(modeRadio("既存を更新")).toBeDisabled();
      expectTextMatching(BUSY_LOCKED_REASON);

      // 実行：保存が終わる
      pending.resolve({ status: "saved", version: DRAFT_VERSION + 1 });

      // 検証
      await waitFor(() => {
        expect(modeRadio("新規作成")).toBeEnabled();
      });
      expect(modeRadio("既存を更新")).toBeEnabled();
      expect(lockedReasons()).toHaveLength(0);
    });

    it("「下書きを保存」の途中に「新規作成」を押しても切り替わらない（既存を更新のまま）", async () => {
      // 準備
      const repository = createFakeRepository();
      const pending = createDeferred<SaveDraftResult>();
      repository.saveDraft.mockImplementationOnce(() => pending.promise);
      const { user } = await renderEditor(undefined, { repository });
      await setImportance(user, "E2", "ゲージ3", "普通");
      await user.click(saveDraftButton());
      await savedDraftInput(repository, 1);

      // 実行
      await user.click(modeRadio("新規作成"));

      // 検証
      expect(modeRadio("既存を更新")).toBeChecked();
      expect(modeRadio("新規作成")).not.toBeChecked();

      // 後片付け
      pending.resolve({ status: "saved", version: DRAFT_VERSION + 1 });
      await waitFor(() => {
        expect(saveDraftButton()).toBeEnabled();
      });
    });

    it("「変更を公開する」の途中も「既存を更新」「新規作成」を押せず、理由を出す。公開が終わると戻る", async () => {
      // 準備：公開の結果を後で返す（保存していない変更はないので、すぐ公開を呼ぶ）
      const repository = createFakeRepository();
      const pending = createDeferred<PublishResult>();
      repository.publish.mockImplementationOnce(() => pending.promise);
      const { user } = await renderEditor(undefined, { repository });

      // 実行
      await user.click(publishButton());
      await waitFor(() => {
        expect(repository.publish).toHaveBeenCalledTimes(1);
      });

      // 検証：公開の途中
      expect(modeRadio("新規作成")).toBeDisabled();
      expect(modeRadio("既存を更新")).toBeDisabled();
      expectTextMatching(BUSY_LOCKED_REASON);

      // 実行：公開が終わる
      pending.resolve({ status: "published", id: "published-1", versionLabel: "2026/10/17 版", versionDate: "2026-10-17" });

      // 検証
      await waitFor(() => {
        expect(modeRadio("新規作成")).toBeEnabled();
      });
      expect(lockedReasons()).toHaveLength(0);
    });
  });

  describe("3. 確認のウィンドウの「場所を見る」は、編集中の文書と合わせた文書の両方にある段階だけ（レビュー P-a）", () => {
    /** 相手が足した段階の名前 */
    const ADDED_STAGE_NAME = "相手が足した段階";

    /** 相手：E2 ゲージ3 を「重要」に（自分の「普通」と衝突）、E2 に新しい段階を足した */
    function theirsWithAddedStage(): DefinitionDoc {
      return makeDoc((draft) => {
        const e23 = stageOf(draft, "E2-3");
        e23.importance = "important";
        draft.stages.push({ ...e23, id: "E2-NEW", name: ADDED_STAGE_NAME, importance: "normal", boosts: [] });
      });
    }

    /** 確認のウィンドウの、文字 text を含む行 */
    function dialogLine(dialog: HTMLElement, text: string): HTMLElement {
      const found = within(dialog)
        .getAllByRole("listitem")
        .filter((item) => (item.textContent ?? "").includes(text));
      expect(found, `「${text}」を含む行`).toHaveLength(1);
      return found[0] as HTMLElement;
    }

    it("相手が足した段階（編集中の文書にない）の自動で合わせた所には「場所を見る」を出さない。衝突した段階（両方にある）には出す", async () => {
      // 準備
      const repository = createFakeRepository();
      repository.saveDraft.mockResolvedValueOnce({
        status: "conflict",
        version: DRAFT_VERSION + 1,
        content: theirsWithAddedStage(),
        updatedByName: NAME_B,
        updatedAt: SAVED_AT,
      });
      const { user } = await renderEditor(undefined, { repository });
      await setImportance(user, "E2", "ゲージ3", "普通");

      // 実行
      await user.click(saveDraftButton());
      const dialog = await findConfirmDialog();

      // 検証：相手が足した段階の行はあるが「場所を見る」はない
      const addedLine = dialogLine(dialog, ADDED_STAGE_NAME);
      expect(within(addedLine).queryByRole("button", { name: "場所を見る" })).not.toBeInTheDocument();
      // 衝突した E2 ゲージ3 の「場所を見る」は出す（ウィンドウの中の「場所を見る」はそれ 1 つだけ）
      const places = within(dialog).getAllByRole("button", { name: "場所を見る" });
      expect(places).toHaveLength(1);
      await user.click(places[0] as HTMLElement);
      expect(stageButton("E2", "ゲージ3")).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("4. onSessionExpired が変わっても読み込み直さない（レビュー P-d の守り）", () => {
    it("読み込みの後に onSessionExpired を別の関数にしても、保管庫の load を呼び直さない", async () => {
      // 準備
      const repository = createFakeRepository();
      const first = vi.fn<() => void>();
      const second = vi.fn<() => void>();
      const { rerender } = render(<PlanEditor repository={repository} onSessionExpired={first} />);
      await screen.findByRole("region", { name: "攻略の流れ" });

      // 実行
      rerender(<PlanEditor repository={repository} onSessionExpired={second} />);

      // 検証
      expect(screen.getByRole("region", { name: "攻略の流れ" })).toBeInTheDocument();
      expect(repository.load).toHaveBeenCalledTimes(1);
    });

    it("読み込みの途中に onSessionExpired を別の関数にしても読み込み直さず、セッション切れで失敗したら新しい関数だけを呼ぶ", async () => {
      // 準備：読み込みの結果を後で返す
      const repository = createFakeRepository();
      const loading = createDeferred<PlanEditorData>();
      repository.load.mockImplementationOnce(() => loading.promise);
      const first = vi.fn<() => void>();
      const second = vi.fn<() => void>();
      const { rerender } = render(<PlanEditor repository={repository} onSessionExpired={first} />);

      // 実行
      rerender(<PlanEditor repository={repository} onSessionExpired={second} />);
      loading.reject(new SessionExpiredError());

      // 検証
      await waitFor(() => {
        expect(second).toHaveBeenCalledTimes(1);
      });
      expect(first).not.toHaveBeenCalled();
      expect(repository.load).toHaveBeenCalledTimes(1);
    });
  });
});
