import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlanEditor } from "./PlanEditor";
import {
  ADMIN,
  blurInput,
  COLLAB,
  createFakeRepository,
  detailRegion,
  enterDateTime,
  expectTextMatching,
  expectTextNotShown,
  expectTextShown,
  fixClock,
  flowRegion,
  focusInput,
  fudaRegion,
  LATEST_EVENT_ID,
  LATEST_NAME,
  LATEST_START,
  makeData,
  makeDoc,
  makeEvent,
  renderEditor,
  restoreClock,
  saveDraftButton,
  savedDraftInput,
  selectStage,
  textContaining,
} from "./test-helpers";

// イベント定義の画面の上部の欄・状態の表示・終了したイベント・読み込み（要件 3.7「上部の欄」「終了したイベント」、2.3）
// 今は 2026-10-17 12:00（日本時間）。最新のイベントは 2026夏イベ（開始 2026/08/07 12:00、終了日時は未定）

/** 開始日時の入力欄（新規作成では「必須」の印が付くため前方一致で探す） */
function startInput(): HTMLElement {
  return screen.getByLabelText(/^開始日時/);
}

/** 終了日時の入力欄（「任意」の印が付くため前方一致で探す） */
function endInput(): HTMLElement {
  return screen.getByLabelText(/^終了日時/);
}

/** イベント名の入力欄 */
function nameInput(): HTMLElement {
  return screen.getByRole("textbox", { name: "イベント名" });
}

const END_BEFORE_START = "終了日時は開始日時より後にしてください";
const END_IN_PAST = "終了日時は今より後にしてください（過去の日時にすると、その場で更新できなくなるため）";

describe("イベント定義の画面（PlanEditor）：上部の欄", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("読み込み", () => {
    it("保管庫の読み込み中は「読み込んでいます」を出し、下書きの保存のボタンを出さない", async () => {
      // 準備：読み込みが終わらない保管庫
      const repository = createFakeRepository();
      repository.load.mockImplementation(() => new Promise(() => undefined));

      // 実行
      render(<PlanEditor repository={repository} />);

      // 検証
      expect(await screen.findByText(textContaining("読み込んでいます"))).toBeInTheDocument();
      expect(repository.load).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "下書きを保存" })).not.toBeInTheDocument();
    });

    it("読み込みに失敗したら、読み込めなかったことと理由、再読み込みの案内を警告（role=alert）で出し、本文を出さない", async () => {
      // 準備
      const repository = createFakeRepository();
      repository.load.mockRejectedValue(new Error("通信に失敗しました（テスト）"));

      // 実行
      render(<PlanEditor repository={repository} />);

      // 検証
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("読み込めませんでした");
      expect(alert).toHaveTextContent("通信に失敗しました（テスト）");
      expect(alert).toHaveTextContent("ページを再読み込みしてください");
      expect(screen.queryByRole("region", { name: "攻略の流れ" })).not.toBeInTheDocument();
    });
  });

  describe("ヘッダー", () => {
    it("見出し（h1）「イベント定義」、「管理者・協力者専用」、説明の文を出す", async () => {
      // 準備・実行
      await renderEditor();

      // 検証
      expect(screen.getByRole("heading", { level: 1, name: "イベント定義" })).toBeInTheDocument();
      expectTextShown("管理者・協力者専用");
      expectTextShown("札・攻略の段階・特効を設定します。公開すると全員の割り振り画面に反映されます");
    });

    it.each([
      ["管理者", "ログイン中：テスト管理者（管理者）", ADMIN],
      ["協力者", "ログイン中：協力者A（協力者）", COLLAB],
    ])("%sなら「%s」を出す（名前と権限は保管庫が返したログイン中の人）", async (_label, text, user) => {
      // 準備・実行
      await renderEditor(makeData({ user }));

      // 検証
      expectTextShown(text);
    });
  });

  describe("既存を更新・新規作成の切り替えと、更新するイベント", () => {
    it("管理者には「既存を更新」「新規作成」の切り替えを出し、初めは「既存を更新」を選んでいる", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: ADMIN }));

      // 検証
      const group = screen.getByRole("radiogroup", { name: "新規か更新か" });
      expect(group).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "既存を更新" })).toBeChecked();
      expect(screen.getByRole("radio", { name: "新規作成" })).not.toBeChecked();
    });

    it("管理者には「更新するイベント：2026夏イベ（最新）」と、更新できるのは最新のイベントだけという説明を出す", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: ADMIN }));

      // 検証
      expectTextShown("更新するイベント：2026夏イベ（最新）");
      expectTextShown("札割りできるのは最新のイベントだけなので、更新も最新のイベントだけです");
    });

    it("協力者には切り替えを出さず、「更新するイベント：2026夏イベ（最新）」と協力者の説明を出す", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: COLLAB }));

      // 検証
      expect(screen.queryByRole("radiogroup", { name: "新規か更新か" })).not.toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "新規作成" })).not.toBeInTheDocument();
      expectTextShown("更新するイベント：2026夏イベ（最新）");
      expectTextShown("協力者は最新イベントの更新だけができます。新規作成は管理者が行います");
    });
  });

  describe("イベント名", () => {
    it("管理者はイベント名の欄（初めは今の名前）で変えられる", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: ADMIN }));

      // 検証
      expect(nameInput()).toHaveValue(LATEST_NAME);
    });

    it("協力者にはイベント名を表示するだけで、入力欄を出さない", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: COLLAB }));

      // 検証
      expect(screen.queryByRole("textbox", { name: "イベント名" })).not.toBeInTheDocument();
      expect(screen.getAllByText(LATEST_NAME).length).toBeGreaterThan(0);
    });

    it("イベント名は入力中には保管庫に書かず、確定（フォーカスを外す）したときに名前の更新を呼ぶ", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));

      // 実行：入力中
      await user.clear(nameInput());
      await user.type(nameInput(), "2026夏イベ 後段");

      // 検証：まだ呼ばない
      expect(repository.updateEventMeta).not.toHaveBeenCalled();

      // 実行：確定
      await user.tab();

      // 検証：開始日時・終了日時は保存済みの値をそのまま渡す
      await waitFor(() => {
        expect(repository.updateEventMeta).toHaveBeenCalledWith({
          eventId: LATEST_EVENT_ID,
          name: "2026夏イベ 後段",
          startAt: LATEST_START,
          endAt: null,
        });
      });
    });

    it("イベント名を空にして確定すると「イベント名を入力してください」を出し、名前の更新を呼ばない", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));

      // 実行
      await user.clear(nameInput());
      await user.tab();

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent("イベント名を入力してください");
      expect(repository.updateEventMeta).not.toHaveBeenCalled();
    });
  });

  describe("開始日時・終了日時", () => {
    it("管理者には開始日時の入力欄（今の開始日時）と終了日時の入力欄（未定なら空）を出し、終了日時の説明を出す", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: ADMIN }));

      // 検証
      expect(startInput()).toHaveValue("2026-08-07T12:00");
      expect(endInput()).toHaveValue("");
      expectTextShown("終了日時を過ぎると「開催中」でなくなります。延長されたときはここで直せます");
    });

    it("終了日時が未定なら「終了日時を消す」を出さない", async () => {
      // 準備・実行：終了日時が未定
      await renderEditor(makeData({ user: ADMIN }));

      // 検証
      expect(screen.queryByRole("button", { name: "終了日時を消す" })).not.toBeInTheDocument();
    });

    it("終了日時が決まっていれば入力欄にその日時（日本時間・分まで）を出し、「終了日時を消す」を出す", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: ADMIN, latestEvent: makeEvent({ endAt: "2026-10-20T11:00:00+09:00" }) }));

      // 検証
      expect(endInput()).toHaveValue("2026-10-20T11:00");
      expect(screen.getByRole("button", { name: "終了日時を消す" })).toBeInTheDocument();
    });

    it("協力者には開始日時を表示だけし（入力欄なし）、終了日時は入力欄で変えられる", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: COLLAB }));

      // 検証
      expect(screen.queryByLabelText(/^開始日時/)).not.toBeInTheDocument();
      expectTextMatching(/開始日時 ?2026\/08\/07 12:00/);
      expect(endInput()).toHaveValue("");
    });

    it("終了日時を開始日時以前にすると、その場で「終了日時は開始日時より後にしてください」を出し、確定しても更新を呼ばない", async () => {
      // 準備
      const { repository } = await renderEditor(makeData({ user: ADMIN }));

      // 実行：値を変える（まだ確定しない）
      enterDateTime(endInput(), "2026-08-07T11:00");

      // 検証：その場で出す
      expect(await screen.findByRole("alert")).toHaveTextContent(END_BEFORE_START);

      // 実行：確定
      blurInput(endInput());

      // 検証
      expect(repository.updateEventMeta).not.toHaveBeenCalled();
    });

    it.each([
      ["今より前", "2026-10-16T12:00"],
      ["今と同じ時刻", "2026-10-17T12:00"],
    ])(
      "終了日時を%s（%s）にすると、その場で「終了日時は今より後に…」を出し、確定しても更新を呼ばない",
      async (_label, value) => {
        // 準備
        const { repository } = await renderEditor(makeData({ user: ADMIN }));

        // 実行
        enterDateTime(endInput(), value);

        // 検証
        expect(await screen.findByRole("alert")).toHaveTextContent(END_IN_PAST);
        blurInput(endInput());
        expect(repository.updateEventMeta).not.toHaveBeenCalled();
      },
    );

    it("終了日時は値を変えただけでは保管庫に書かず、確定（フォーカスを外す）したときに期間の更新を呼び、期間の表示を変える", async () => {
      // 準備
      const { repository } = await renderEditor(makeData({ user: ADMIN }));

      // 実行：値を変える
      enterDateTime(endInput(), "2026-10-20T11:00");

      // 検証：まだ呼ばない
      expect(repository.updateEventMeta).not.toHaveBeenCalled();

      // 実行：確定
      blurInput(endInput());

      // 検証：入力欄の値は日本時間として時差つきに直す。名前・開始日時は保存済みの値をそのまま渡す
      await waitFor(() => {
        expect(repository.updateEventMeta).toHaveBeenCalledWith({
          eventId: LATEST_EVENT_ID,
          name: LATEST_NAME,
          startAt: LATEST_START,
          endAt: "2026-10-20T11:00+09:00",
        });
      });
      expectTextShown("期間：2026/08/07 12:00 〜 2026/10/20 11:00");
    });

    it("管理者が開始日時を変えて確定すると、開始日時の更新を呼ぶ", async () => {
      // 準備
      const { repository } = await renderEditor(makeData({ user: ADMIN }));

      // 実行
      enterDateTime(startInput(), "2026-08-08T12:00");
      blurInput(startInput());

      // 検証
      await waitFor(() => {
        expect(repository.updateEventMeta).toHaveBeenCalledWith({
          eventId: LATEST_EVENT_ID,
          name: LATEST_NAME,
          startAt: "2026-08-08T12:00+09:00",
          endAt: null,
        });
      });
    });

    it("協力者が終了日時を変えて確定すると、名前・開始日時は保存済みの文字列のまま（秒も変えずに）更新を呼ぶ", async () => {
      // 準備：保存済みの開始日時に秒が付いている（入力欄は秒を切り捨てて出す）
      const startWithSeconds = "2026-08-07T12:00:30+09:00";
      const { repository } = await renderEditor(
        makeData({ user: COLLAB, latestEvent: makeEvent({ startAt: startWithSeconds }) }),
      );

      // 実行
      enterDateTime(endInput(), "2026-10-20T11:00");
      blurInput(endInput());

      // 検証：協力者は名前・開始日時を変えられないので、DB の値と同じものを渡す
      await waitFor(() => {
        expect(repository.updateEventMeta).toHaveBeenCalledWith({
          eventId: LATEST_EVENT_ID,
          name: LATEST_NAME,
          startAt: startWithSeconds,
          endAt: "2026-10-20T11:00+09:00",
        });
      });
    });

    it("日時の入力欄にフォーカスを移して外しただけ（値は変えていない）なら、更新を呼ばず、文書の日時も書き換えない", async () => {
      // 準備：開始日時に秒が付いている（入力欄は "2026-08-07T12:00" と出すが、書き戻すと 30 秒ずれる）
      const startWithSeconds = "2026-08-07T12:00:30+09:00";
      const { user, repository } = await renderEditor(
        makeData({ user: ADMIN, latestEvent: makeEvent({ startAt: startWithSeconds }) }),
      );

      // 実行：開始日時・終了日時の欄に触れて外す
      focusInput(startInput());
      blurInput(startInput());
      focusInput(endInput());
      blurInput(endInput());

      // 検証：更新を呼ばない
      expect(repository.updateEventMeta).not.toHaveBeenCalled();

      // 実行：ほかの所を変えて下書きを保存する
      await selectStage(user, "E2", "ゲージ3");
      await user.click(screen.getByRole("button", { name: "重要" }));
      await user.click(saveDraftButton());

      // 検証：文書の開始日時・終了日時は読み込んだときのまま
      const input = await savedDraftInput(repository);
      expect(input.content.event.startAt).toBe(startWithSeconds);
      expect(input.content.event.endAt).toBeNull();
    });

    it("終了日時を変えて確定したら、その後に保存する下書きの文書の終了日時も新しい値になる", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      enterDateTime(endInput(), "2026-10-20T11:00");
      blurInput(endInput());
      await waitFor(() => {
        expect(repository.updateEventMeta).toHaveBeenCalledTimes(1);
      });

      // 実行：ほかの所を変えて下書きを保存する
      await selectStage(user, "E2", "ゲージ3");
      await user.click(screen.getByRole("button", { name: "重要" }));
      await user.click(saveDraftButton());

      // 検証
      const input = await savedDraftInput(repository);
      expect(input.content.event.endAt).toBe("2026-10-20T11:00+09:00");
    });

    it("「終了日時を消す」を押すと、終了日時を未定（null）にする更新を呼び、入力欄を空にして「終了日時は未定」と出す", async () => {
      // 準備
      const { user, repository } = await renderEditor(
        makeData({ user: ADMIN, latestEvent: makeEvent({ endAt: "2026-10-20T11:00:00+09:00" }) }),
      );

      // 実行
      await user.click(screen.getByRole("button", { name: "終了日時を消す" }));

      // 検証
      await waitFor(() => {
        expect(repository.updateEventMeta).toHaveBeenCalledWith({
          eventId: LATEST_EVENT_ID,
          name: LATEST_NAME,
          startAt: LATEST_START,
          endAt: null,
        });
      });
      expect(endInput()).toHaveValue("");
      expectTextShown("期間：2026/08/07 12:00 〜 終了日時は未定");
      expect(screen.queryByRole("button", { name: "終了日時を消す" })).not.toBeInTheDocument();
    });

    it("期間の更新に失敗したら、理由を警告（role=alert）で出す", async () => {
      // 準備
      const repository = createFakeRepository(makeData({ user: ADMIN }));
      repository.updateEventMeta.mockRejectedValue(new Error("このイベントは終了したため、更新できません"));
      await renderEditor(undefined, { repository });

      // 実行
      enterDateTime(endInput(), "2026-10-20T11:00");
      blurInput(endInput());

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent("このイベントは終了したため、更新できません");
    });
  });

  describe("状態の表示", () => {
    it("期間「期間：2026/08/07 12:00 〜 終了日時は未定」を出す（終了日時が未定）", async () => {
      // 準備・実行
      await renderEditor();

      // 検証
      expectTextShown("期間：2026/08/07 12:00 〜 終了日時は未定");
    });

    it("終了日時が決まっていれば「期間：2026/08/07 12:00 〜 2026/10/20 11:00」を出す", async () => {
      // 準備・実行
      await renderEditor(makeData({ latestEvent: makeEvent({ endAt: "2026-10-20T11:00:00+09:00" }) }));

      // 検証
      expectTextShown("期間：2026/08/07 12:00 〜 2026/10/20 11:00");
    });

    it("公開中の版「公開中：2026/08/04 版」を出し、下書きが公開中と同じなら「未公開の変更」を出さない", async () => {
      // 準備・実行
      await renderEditor();

      // 検証
      expectTextShown("公開中：2026/08/04 版");
      expectTextNotShown("未公開の変更");
    });

    it("下書きに公開中から 2 件の変更があれば「未公開の変更 2 件（主な変更 ほか）」を出す（主な変更は最初の変更の文）", async () => {
      // 準備：E2 ゲージ3 の大事さを難所 → 重要、E3 ゲージ4 の段階名を変えた下書き
      const draftContent = makeDoc((draft) => {
        const e23 = draft.stages.find((s) => s.id === "E2-3");
        const e34 = draft.stages.find((s) => s.id === "E3-4");
        if (e23 === undefined || e34 === undefined) throw new Error("テスト用の定義に段階がありません");
        e23.importance = "important";
        e34.name = "ゲージ4 最終";
      });

      // 実行
      await renderEditor(makeData({ latestEvent: makeEvent({ draftContent }) }));

      // 検証
      expectTextShown("公開中：2026/08/04 版");
      expectTextMatching(/未公開の変更 ?2 ?件（E2 ゲージ3 の大事さを「難所」→「重要」 ?ほか）/);
    });

    it("画面で変えた（まだ保存していない）内容も「未公開の変更」に数える", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行
      await selectStage(user, "E2", "ゲージ3");
      await user.click(screen.getByRole("button", { name: "重要" }));

      // 検証：1 件なら「ほか」は付けない
      expectTextMatching(/未公開の変更 ?1 ?件（E2 ゲージ3 の大事さを「難所」→「重要」）/);
    });

    it("まだ公開していないイベントなら「まだ公開していません」を出す", async () => {
      // 準備・実行
      await renderEditor(makeData({ latestEvent: makeEvent({ publishedContent: null }) }));

      // 検証
      expectTextShown("まだ公開していません");
    });

    it("共有の下書きを「共有の下書き：（日時）に（名前）が保存」と、保存したときの反映の説明つきで出す", async () => {
      // 準備・実行：10/15 22:40 に協力者Aが保存した下書き
      await renderEditor();

      // 検証：日時は年を付けてもよい（「10/15 22:40」「2026/10/15 22:40」）
      expectTextMatching(/共有の下書き：.*10\/15 22:40 に協力者Aが保存/);
      expectTextShown("保存すると管理者・協力者全員の定義画面に反映されます。一般の画面には公開するまで出ません");
    });

    it("「編集できる人：（管理者・協力者の名前）」を出す", async () => {
      // 準備・実行
      await renderEditor();

      // 検証
      expectTextShown("編集できる人：テスト管理者・協力者A・協力者B");
    });

    it("管理者には協力者の画面（/collaborators）へのリンク「協力者を管理」を出す", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: ADMIN }));

      // 検証
      expect(screen.getByRole("link", { name: "協力者を管理" })).toHaveAttribute("href", "/collaborators");
    });

    it("協力者には「協力者を管理」のリンクを出さない", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: COLLAB }));

      // 検証
      expectTextShown("編集できる人：テスト管理者・協力者A・協力者B");
      expect(screen.queryByRole("link", { name: "協力者を管理" })).not.toBeInTheDocument();
    });
  });

  describe("終了したイベント（保存済みの終了日時 2026/10/10 11:00 を過ぎている）", () => {
    const endedEvent = (): ReturnType<typeof makeEvent> => makeEvent({ endAt: "2026-10-10T11:00:00+09:00" });

    it("「このイベントは終了しました（2026/10/10 11:00 終了）」と、見るだけであることを出す", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: ADMIN, latestEvent: endedEvent() }));

      // 検証
      expectTextShown("このイベントは終了しました（2026/10/10 11:00 終了）");
      expectTextShown("終了したイベントは更新できません。内容は見るだけです。");
    });

    it("下書きの保存・公開のボタンを出さない", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: COLLAB, latestEvent: endedEvent() }));

      // 検証：終了の表示が出ていることを確かめてから、ボタンがないことを見る
      expectTextShown("このイベントは終了しました（2026/10/10 11:00 終了）");
      expect(screen.queryByRole("button", { name: "下書きを保存" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "変更を公開する" })).not.toBeInTheDocument();
    });

    it("本文（攻略の流れ・札・段階の詳細）を操作できない状態（inert）にする", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: ADMIN, latestEvent: endedEvent() }));

      // 検証
      expect(flowRegion().closest("[inert]")).not.toBeNull();
      expect(fudaRegion().closest("[inert]")).not.toBeNull();
      expect(detailRegion().closest("[inert]")).not.toBeNull();
    });

    it("日時の入力欄とイベント名の入力欄を出さない", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: ADMIN, latestEvent: endedEvent() }));

      // 検証
      expectTextShown("このイベントは終了しました（2026/10/10 11:00 終了）");
      expect(screen.queryByLabelText(/^開始日時/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^終了日時/)).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "イベント名" })).not.toBeInTheDocument();
    });

    it("管理者には「次のイベントは「新規作成」から作ってください。」と「新しいイベントを作成」を出す", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: ADMIN, latestEvent: endedEvent() }));

      // 検証
      expectTextShown("次のイベントは「新規作成」から作ってください。");
      expect(screen.getByRole("button", { name: "新しいイベントを作成" })).toBeInTheDocument();
    });

    it("管理者が「新しいイベントを作成」を押すと新規作成に切り替わり、本文を操作できるようになる", async () => {
      // 準備
      const { user } = await renderEditor(makeData({ user: ADMIN, latestEvent: endedEvent() }));

      // 実行
      await user.click(screen.getByRole("button", { name: "新しいイベントを作成" }));

      // 検証
      expect(screen.getByRole("radio", { name: "新規作成" })).toBeChecked();
      expect(screen.getByRole("button", { name: "公開して最新にする" })).toBeInTheDocument();
      expect(flowRegion().closest("[inert]")).toBeNull();
    });

    it("協力者には「次のイベントは管理者が作成するまでお待ちください。」を出し、「新しいイベントを作成」を出さない", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: COLLAB, latestEvent: endedEvent() }));

      // 検証
      expectTextShown("次のイベントは管理者が作成するまでお待ちください。");
      expect(screen.queryByRole("button", { name: "新しいイベントを作成" })).not.toBeInTheDocument();
    });

    it("終了日時がまだ来ていなければ（2026/10/20 11:00）終了の表示を出さない", async () => {
      // 準備・実行
      await renderEditor(makeData({ latestEvent: makeEvent({ endAt: "2026-10-20T11:00:00+09:00" }) }));

      // 検証
      expect(saveDraftButton()).toBeInTheDocument();
      expectTextNotShown("このイベントは終了しました");
    });
  });
});
