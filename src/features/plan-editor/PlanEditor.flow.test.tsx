import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FUDA_COLOR_CHOICES } from "@/domain/definition-edit";
import { expectInDocumentOrder } from "@/test/dom-order";
import {
  areaRow,
  detailRegion,
  expectStages,
  expectTextShown,
  fixClock,
  flowRegion,
  fudaItem,
  fudaItems,
  fudaRegion,
  openAddMenu,
  queryAreaRow,
  renderEditor,
  restoreClock,
  saveDraftButton,
  savedDraftInput,
  selectStage,
  stageButton,
  stagesIn,
  switchToCreate,
} from "./test-helpers";

// イベント定義の画面の「攻略の流れ」と「札の一覧」（要件 3.7、U16）
// ドラッグ＆ドロップ（札を段階へ落として割り込む・段階の並べ替え・札の並べ替え）は Playwright で確かめるため、ここでは書かない。
// 同じ操作のクリックの経路（「＋」のメニューから札を選んで最後に追加など）を確かめる。
//
// テスト用の定義（2026夏イベ）の攻略の流れ
// - E1：ギミック〜ゲージ3（第三十一戦隊）
// - E2：ギミック（第三十一戦隊）、ゲージ1 輸送（多号作戦部隊）、ゲージ2（連合艦隊）、ゲージ3（連合艦隊）
// - E3：ギミック（第三十一戦隊）、ゲージ1（ウルシー攻撃部隊）、ゲージ2 輸送（第三十一戦隊）、ゲージ3（第六艦隊）、ゲージ4（ウルシー攻撃部隊）

const EMPTY_AREA_TEXT = "まだ段階がありません。右の＋で札を選ぶか、札をここに落としてください";

/** 札の並び（テスト用の定義の順） */
const FUDA_NAMES = ["第三十一戦隊", "多号作戦部隊", "連合艦隊", "ウルシー攻撃部隊", "第六艦隊"];

/** 「＋ 札を追加」で開く入力の欄 */
function addFudaForm(): HTMLElement {
  return screen.getByRole("form", { name: "札を追加" });
}

/** 札の色の選択肢（用意した色。FUDA_COLOR_CHOICES の順） */
function colorRadios(form: HTMLElement): HTMLElement[] {
  return within(within(form).getByRole("radiogroup", { name: "札の色" })).getAllByRole("radio");
}

describe("イベント定義の画面（PlanEditor）：攻略の流れと札の一覧", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("攻略の流れ", () => {
    it("見出し「攻略の流れ」と、操作の説明（押す・札を段階へドラッグ・＋・段階をドラッグ）を出す", async () => {
      // 準備・実行
      await renderEditor();

      // 検証
      expect(within(flowRegion()).getByRole("heading", { name: "攻略の流れ" })).toBeInTheDocument();
      expectTextShown("押す：右下で編集・削除");
      expectTextShown("札を段階へドラッグ：その前に割り込み");
      expectTextShown("＋：最後に追加");
      expectTextShown("段階をドラッグ：並べ替え");
    });

    it("海域ごとに 1 行で、E1・E2・E3 の順に並ぶ", async () => {
      // 準備・実行
      await renderEditor();

      // 検証
      expectInDocumentOrder([areaRow("E1"), areaRow("E2"), areaRow("E3")]);
    });

    it("各海域の行に、段階を左から順に段階名と札名で並べる", async () => {
      // 準備・実行
      await renderEditor();

      // 検証
      expectStages("E1", [["ギミック〜ゲージ3", "第三十一戦隊"]]);
      expectStages("E2", [
        ["ギミック", "第三十一戦隊"],
        ["ゲージ1 輸送", "多号作戦部隊"],
        ["ゲージ2", "連合艦隊"],
        ["ゲージ3", "連合艦隊"],
      ]);
      expectStages("E3", [
        ["ギミック", "第三十一戦隊"],
        ["ゲージ1", "ウルシー攻撃部隊"],
        ["ゲージ2 輸送", "第三十一戦隊"],
        ["ゲージ3", "第六艦隊"],
        ["ゲージ4", "ウルシー攻撃部隊"],
      ]);
    });

    it("初めは最初の段階（E1 ギミック〜ゲージ3）を選んでいて、詳細欄に出す", async () => {
      // 準備・実行
      await renderEditor();

      // 検証
      expect(stageButton("E1", "ギミック〜ゲージ3")).toHaveAttribute("aria-pressed", "true");
      expect(detailRegion()).toHaveTextContent("E1 ギミック〜ゲージ3");
    });

    it("段階を押すとその段階を選び（ほかは選ばない）、詳細欄に海域・段階名・札名を出す", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行
      await selectStage(user, "E2", "ゲージ3");

      // 検証
      expect(stageButton("E2", "ゲージ3")).toHaveAttribute("aria-pressed", "true");
      expect(stageButton("E1", "ギミック〜ゲージ3")).toHaveAttribute("aria-pressed", "false");
      expect(detailRegion()).toHaveTextContent("E2 ゲージ3");
      expect(detailRegion()).toHaveTextContent("連合艦隊");
    });

    it("行の「＋」を押すと「（海域）の最後に追加する札」のメニューを開き、今ある札を札の並び順で出す", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行
      const menu = await openAddMenu(user, "E2");

      // 検証
      expect(menu).toHaveTextContent("E2の最後に追加する札");
      const items = within(menu).getAllByRole("menuitem");
      expect(items).toHaveLength(FUDA_NAMES.length);
      FUDA_NAMES.forEach((name, index) => {
        expect(items[index]).toHaveTextContent(name);
      });
      expect(within(areaRow("E2")).getByRole("button", { name: "段階を追加" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    it("メニューで札を選ぶと、その海域の一番右に「新しい段階」（大事さ「普通」）を追加して選び、メニューを閉じる", async () => {
      // 準備
      const { user } = await renderEditor();
      const menu = await openAddMenu(user, "E2");

      // 実行
      await user.click(within(menu).getByRole("menuitem", { name: "第六艦隊" }));

      // 検証
      expect(within(areaRow("E2")).queryByRole("menu")).not.toBeInTheDocument();
      expectStages("E2", [
        ["ギミック", "第三十一戦隊"],
        ["ゲージ1 輸送", "多号作戦部隊"],
        ["ゲージ2", "連合艦隊"],
        ["ゲージ3", "連合艦隊"],
        ["新しい段階", "第六艦隊"],
      ]);
      expect(stageButton("E2", "新しい段階")).toHaveAttribute("aria-pressed", "true");
      expect(detailRegion()).toHaveTextContent("E2 新しい段階");
      expect(within(detailRegion()).getByRole("button", { name: "普通" })).toHaveAttribute("aria-pressed", "true");
    });

    it("メニューの「やめる」で、段階を追加せずにメニューを閉じる", async () => {
      // 準備
      const { user } = await renderEditor();
      const menu = await openAddMenu(user, "E2");

      // 実行
      await user.click(within(menu).getByRole("button", { name: "やめる" }));

      // 検証
      expect(within(areaRow("E2")).queryByRole("menu")).not.toBeInTheDocument();
      expect(within(areaRow("E2")).getByRole("button", { name: "段階を追加" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expectStages("E2", [
        ["ギミック", "第三十一戦隊"],
        ["ゲージ1 輸送", "多号作戦部隊"],
        ["ゲージ2", "連合艦隊"],
        ["ゲージ3", "連合艦隊"],
      ]);
    });

    it("追加した段階を下書きに保存すると、文書の E2 の最後に新しい段階（札・大事さ普通・特効なし）が入る", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      const menu = await openAddMenu(user, "E2");
      await user.click(within(menu).getByRole("menuitem", { name: "第六艦隊" }));

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const { content } = await savedDraftInput(repository);
      const e2 = stagesIn(content, "E2");
      expect(e2.map((s) => s.name)).toEqual(["ギミック", "ゲージ1 輸送", "ゲージ2", "ゲージ3", "新しい段階"]);
      expect(e2[4]).toMatchObject({ fudaId: "sixth", importance: "normal", boosts: [] });
    });

    it("「＋ E4 を追加」で E4 の行（段階がない文つき）を追加し、その行の「＋」メニューを開く", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行
      await user.click(screen.getByRole("button", { name: "＋ E4 を追加" }));

      // 検証
      const row = areaRow("E4");
      expect(row).toHaveTextContent(EMPTY_AREA_TEXT);
      expect(within(row).getByRole("menu")).toHaveTextContent("E4の最後に追加する札");
      expect(screen.getByRole("button", { name: "＋ E5 を追加" })).toBeInTheDocument();
    });

    it("段階のない海域で札を選ぶと段階ができ、段階がない文を消す", async () => {
      // 準備
      const { user } = await renderEditor();
      await user.click(screen.getByRole("button", { name: "＋ E4 を追加" }));

      // 実行
      await user.click(within(within(areaRow("E4")).getByRole("menu")).getByRole("menuitem", { name: "連合艦隊" }));

      // 検証
      expectStages("E4", [["新しい段階", "連合艦隊"]]);
      expect(areaRow("E4")).not.toHaveTextContent(EMPTY_AREA_TEXT);
    });

    it("追加した海域と段階を下書きに保存すると、文書の海域の最後に E4 が入る", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await user.click(screen.getByRole("button", { name: "＋ E4 を追加" }));
      await user.click(within(within(areaRow("E4")).getByRole("menu")).getByRole("menuitem", { name: "連合艦隊" }));

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const { content } = await savedDraftInput(repository);
      expect(content.areas.map((a) => a.name)).toEqual(["E1", "E2", "E3", "E4"]);
      const e4 = content.areas[3];
      expect(stagesIn(content, e4?.id ?? "")).toHaveLength(1);
    });

    it("最後の海域が段階のない海域なら「この海域を外す」を出し、押すとその海域を外す", async () => {
      // 準備
      const { user } = await renderEditor();
      await user.click(screen.getByRole("button", { name: "＋ E4 を追加" }));

      // 実行
      await user.click(within(areaRow("E4")).getByRole("button", { name: "この海域を外す" }));

      // 検証
      expect(queryAreaRow("E4")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "＋ E4 を追加" })).toBeInTheDocument();
    });

    it("最後の海域に段階があれば「この海域を外す」を出さない", async () => {
      // 準備・実行
      await renderEditor();

      // 検証
      expect(within(flowRegion()).queryByRole("button", { name: "この海域を外す" })).not.toBeInTheDocument();
    });

    it("段階のない海域でも、最後でなければ「この海域を外す」を出さない（E4・E5 を足すと E5 だけに出す）", async () => {
      // 準備
      const { user } = await renderEditor();
      await user.click(screen.getByRole("button", { name: "＋ E4 を追加" }));
      await user.click(within(within(areaRow("E4")).getByRole("menu")).getByRole("button", { name: "やめる" }));

      // 実行
      await user.click(screen.getByRole("button", { name: "＋ E5 を追加" }));

      // 検証
      expect(within(areaRow("E4")).queryByRole("button", { name: "この海域を外す" })).not.toBeInTheDocument();
      expect(within(areaRow("E5")).getByRole("button", { name: "この海域を外す" })).toBeInTheDocument();
    });

    it("海域が 1 つだけなら、段階がなくても「この海域を外す」を出さない（新規作成の空の状態）", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行
      await switchToCreate(user);

      // 検証
      expect(areaRow("E1")).toHaveTextContent(EMPTY_AREA_TEXT);
      expect(within(areaRow("E1")).queryByRole("button", { name: "この海域を外す" })).not.toBeInTheDocument();
    });
  });

  describe("札の一覧", () => {
    it("見出し「札」の下に、定義の札を並び順で、札名と使っている段階の数（n 段階）つきで並べる", async () => {
      // 準備・実行
      await renderEditor();

      // 検証
      expect(within(fudaRegion()).getByRole("heading", { name: "札" })).toBeInTheDocument();
      const items = fudaItems();
      const expected: ReadonlyArray<readonly [string, number]> = [
        ["第三十一戦隊", 4],
        ["多号作戦部隊", 1],
        ["連合艦隊", 2],
        ["ウルシー攻撃部隊", 2],
        ["第六艦隊", 1],
      ];
      expect(items).toHaveLength(expected.length);
      expected.forEach(([name, uses], index) => {
        expect(items[index]).toHaveTextContent(name);
        expect(items[index]).toHaveTextContent(new RegExp(`${uses} ?段階`));
      });
    });

    it("段階を追加すると、その札の段階の数が増える", async () => {
      // 準備
      const { user } = await renderEditor();
      const menu = await openAddMenu(user, "E2");

      // 実行
      await user.click(within(menu).getByRole("menuitem", { name: "第六艦隊" }));

      // 検証
      expect(fudaItem("第六艦隊")).toHaveTextContent(/2 ?段階/);
    });

    it("「＋ 札を追加」で、札の名前・札の色（用意した色）・札番号（任意）の入力の欄を開く", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行
      await user.click(within(fudaRegion()).getByRole("button", { name: "＋ 札を追加" }));

      // 検証
      const form = addFudaForm();
      expect(within(form).getByRole("textbox", { name: "札の名前" })).toHaveValue("");
      expect(colorRadios(form)).toHaveLength(FUDA_COLOR_CHOICES.length);
      expect(within(form).getByLabelText(/^札番号/)).toBeInTheDocument();
      expect(within(form).getByRole("button", { name: "追加する" })).toBeInTheDocument();
      expect(within(form).getByRole("button", { name: "やめる" })).toBeInTheDocument();
    });

    it("名前・色・札番号を入れて「追加する」と、札の一覧の最後に「0 段階」で並び、「＋」のメニューでも選べる", async () => {
      // 準備
      const { user } = await renderEditor();
      await user.click(within(fudaRegion()).getByRole("button", { name: "＋ 札を追加" }));
      const form = addFudaForm();

      // 実行
      await user.type(within(form).getByRole("textbox", { name: "札の名前" }), "遊撃部隊");
      await user.click(colorRadios(form)[1] as HTMLElement);
      await user.type(within(form).getByLabelText(/^札番号/), "6");
      await user.click(within(form).getByRole("button", { name: "追加する" }));

      // 検証
      expect(screen.queryByRole("form", { name: "札を追加" })).not.toBeInTheDocument();
      const items = fudaItems();
      expect(items).toHaveLength(6);
      expect(items[5]).toHaveTextContent("遊撃部隊");
      expect(items[5]).toHaveTextContent(/0 ?段階/);
      const menu = await openAddMenu(user, "E1");
      expect(within(menu).getByRole("menuitem", { name: "遊撃部隊" })).toBeInTheDocument();
    });

    it("追加した札を下書きに保存すると、文書の札の最後に名前・選んだ色・札番号で入る", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await user.click(within(fudaRegion()).getByRole("button", { name: "＋ 札を追加" }));
      const form = addFudaForm();
      await user.type(within(form).getByRole("textbox", { name: "札の名前" }), "遊撃部隊");
      await user.click(colorRadios(form)[1] as HTMLElement);
      await user.type(within(form).getByLabelText(/^札番号/), "6");
      await user.click(within(form).getByRole("button", { name: "追加する" }));

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const { content } = await savedDraftInput(repository);
      expect(content.fudas).toHaveLength(6);
      expect(content.fudas[5]).toMatchObject({ name: "遊撃部隊", color: FUDA_COLOR_CHOICES[1], gameNumber: 6 });
    });

    it("札番号を空のまま追加すると、札番号は未入力（null）になる", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await user.click(within(fudaRegion()).getByRole("button", { name: "＋ 札を追加" }));
      const form = addFudaForm();
      await user.type(within(form).getByRole("textbox", { name: "札の名前" }), "遊撃部隊");
      await user.click(colorRadios(form)[2] as HTMLElement);
      await user.click(within(form).getByRole("button", { name: "追加する" }));

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const { content } = await savedDraftInput(repository);
      expect(content.fudas[5]).toMatchObject({ name: "遊撃部隊", color: FUDA_COLOR_CHOICES[2], gameNumber: null });
    });

    it("名前が空のまま「追加する」と「札の名前を入力してください」を出し、札を追加しない", async () => {
      // 準備
      const { user } = await renderEditor();
      await user.click(within(fudaRegion()).getByRole("button", { name: "＋ 札を追加" }));
      const form = addFudaForm();
      await user.click(colorRadios(form)[1] as HTMLElement);

      // 実行
      await user.click(within(form).getByRole("button", { name: "追加する" }));

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent("札の名前を入力してください");
      expect(fudaItems()).toHaveLength(5);
    });

    it("札番号がほかの札と同じなら「その札番号は、ほかの札で使われています」を出し、札を追加しない", async () => {
      // 準備：連合艦隊の札番号は 3
      const { user } = await renderEditor();
      await user.click(within(fudaRegion()).getByRole("button", { name: "＋ 札を追加" }));
      const form = addFudaForm();
      await user.type(within(form).getByRole("textbox", { name: "札の名前" }), "遊撃部隊");
      await user.click(colorRadios(form)[1] as HTMLElement);
      await user.type(within(form).getByLabelText(/^札番号/), "3");

      // 実行
      await user.click(within(form).getByRole("button", { name: "追加する" }));

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent("その札番号は、ほかの札で使われています");
      expect(fudaItems()).toHaveLength(5);
    });

    it("入力の欄の「やめる」で、札を追加せずに閉じる", async () => {
      // 準備
      const { user } = await renderEditor();
      await user.click(within(fudaRegion()).getByRole("button", { name: "＋ 札を追加" }));
      const form = addFudaForm();
      await user.type(within(form).getByRole("textbox", { name: "札の名前" }), "遊撃部隊");

      // 実行
      await user.click(within(form).getByRole("button", { name: "やめる" }));

      // 検証
      expect(screen.queryByRole("form", { name: "札を追加" })).not.toBeInTheDocument();
      expect(fudaItems()).toHaveLength(5);
    });

    describe("札の編集（U16：名前と色は変更できる。削除できるのは使われていない札だけ）", () => {
      /** 札の行の編集のボタンを押して、開いた編集の欄を返す */
      async function openEditForm(user: UserEvent, name: string): Promise<HTMLElement> {
        await user.click(within(fudaItem(name)).getByRole("button", { name: /編集/ }));
        return screen.getByRole("form", { name: "札を編集" });
      }

      it("札の行の編集のボタンで、今の名前・色・札番号が入った編集の欄を開く", async () => {
        // 準備
        const { user } = await renderEditor();

        // 実行：第六艦隊（色 #A97EF0、札番号 5）
        const form = await openEditForm(user, "第六艦隊");

        // 検証
        expect(within(form).getByRole("textbox", { name: "札の名前" })).toHaveValue("第六艦隊");
        const purple = FUDA_COLOR_CHOICES.indexOf("#A97EF0");
        expect(colorRadios(form)[purple]).toBeChecked();
        expect(within(form).getByLabelText(/^札番号/)).toHaveValue(5);
      });

      it("名前を変えて「変更する」と、札の一覧と攻略の流れの札名が変わり、保存する文書の札の名前も変わる", async () => {
        // 準備
        const { user, repository } = await renderEditor();
        const form = await openEditForm(user, "第六艦隊");
        const nameBox = within(form).getByRole("textbox", { name: "札の名前" });

        // 実行
        await user.clear(nameBox);
        await user.type(nameBox, "第六艦隊（潜水）");
        await user.click(within(form).getByRole("button", { name: "変更する" }));

        // 検証
        expect(fudaItem("第六艦隊（潜水）")).toHaveTextContent(/1 ?段階/);
        expect(stageButton("E3", "ゲージ3")).toHaveTextContent("第六艦隊（潜水）");
        await user.click(saveDraftButton());
        const { content } = await savedDraftInput(repository);
        expect(content.fudas.find((f) => f.id === "sixth")?.name).toBe("第六艦隊（潜水）");
      });

      it("色を選び直して「変更する」と、保存する文書の札の色が変わる", async () => {
        // 準備
        const { user, repository } = await renderEditor();
        const form = await openEditForm(user, "第六艦隊");

        // 実行
        await user.click(colorRadios(form)[0] as HTMLElement);
        await user.click(within(form).getByRole("button", { name: "変更する" }));
        await user.click(saveDraftButton());

        // 検証
        const { content } = await savedDraftInput(repository);
        expect(content.fudas.find((f) => f.id === "sixth")?.color).toBe(FUDA_COLOR_CHOICES[0]);
      });

      it("段階で使われている札は「この札を削除」を押せず、理由「段階で使われている札は削除できません」を出す", async () => {
        // 準備
        const { user } = await renderEditor();

        // 実行
        const form = await openEditForm(user, "第六艦隊");

        // 検証
        expect(within(form).getByRole("button", { name: "この札を削除" })).toBeDisabled();
        expect(form).toHaveTextContent("段階で使われている札は削除できません");
      });

      it("使われていない札は「この札を削除」で一覧から消え、「＋」のメニューにも出なくなる", async () => {
        // 準備：使われていない札を追加する
        const { user } = await renderEditor();
        await user.click(within(fudaRegion()).getByRole("button", { name: "＋ 札を追加" }));
        const addForm = addFudaForm();
        await user.type(within(addForm).getByRole("textbox", { name: "札の名前" }), "遊撃部隊");
        await user.click(colorRadios(addForm)[1] as HTMLElement);
        await user.click(within(addForm).getByRole("button", { name: "追加する" }));
        const form = await openEditForm(user, "遊撃部隊");

        // 実行
        await user.click(within(form).getByRole("button", { name: "この札を削除" }));

        // 検証
        expect(fudaItems()).toHaveLength(5);
        const menu = await openAddMenu(user, "E1");
        expect(within(menu).queryByRole("menuitem", { name: "遊撃部隊" })).not.toBeInTheDocument();
      });
    });
  });
});
