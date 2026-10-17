// 一覧の本文（ListBoard。要件 3.2、モック Main.dc.html、roadmap T2-9、U24）のテスト
//
// 読み込み済みの定義・マスタ・艦・割り当てを渡して、攻略の流れ・表示の切り替え・札ごとの行を確かめる。
// 読み込み中・失敗・未取り込みの出し分けと、ヘッダーのボタンは src/app/list/page.test.tsx で確かめる。
// 部品の探し方は src/test/list-screen.ts の冒頭にまとめてある。
//
// テスト用データ（src/test/fixtures）の割り当て：
// - 第三十一戦隊（4隻・特効3隻）：初霜改二 Lv131・冬月改 Lv120・涼風改二 Lv92（特効なし）・五十鈴改二 Lv140（軽巡）
// - 多号作戦部隊（3隻）：沖波改二・朝霜改二 Lv140・霞改二乙
// - 連合艦隊（8隻・特効8隻）：長門改二 170・雪風改二 168・瑞鶴改二甲 165・北上改二 160・矢矧改二乙 155・長波改二 152・潮改二 125・時雨改二 98
// - ウルシー攻撃部隊（3隻）：時雨改三・不知火改二・大和改二重
// - 第六艦隊（1隻）：伊41改
// - 控え：浜波改・利根改二・朝霜改二 Lv92 など
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PublicDefinition } from "@/domain/definition";
import { createShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { ListBoard } from "@/features/list/ListBoard";
import { expectInDocumentOrder } from "@/test/dom-order";
import {
  summer2026Assignments,
  summer2026Definition,
  summer2026MasterEntries,
  summer2026Ships,
  unknownShip,
} from "@/test/fixtures";
import { definitionWithEightFudas, eightFudaAssignments } from "@/test/list-export";
import {
  boostCountPattern,
  getAreaRow,
  getAreaSteps,
  getFudaRegion,
  getShipItem,
  getStep,
  getTimeline,
  expectRowCount,
  shipItems,
  shipNamesIn,
  UNKNOWN_SHIP_NAME,
} from "@/test/list-screen";

// ---- 準備 ----

const master = createShipMaster(summer2026MasterEntries);

/** 一覧の本文を描く（省略した値はテスト用データ） */
function renderBoard(
  options: { definition?: PublicDefinition; ships?: readonly OwnedShip[]; assignments?: AssignmentMap } = {},
) {
  const user = userEvent.setup();
  render(
    <ListBoard
      definition={options.definition ?? summer2026Definition}
      master={master}
      ships={options.ships ?? summer2026Ships}
      assignments={options.assignments ?? summer2026Assignments}
    />,
  );
  return { user };
}

/** 割り当てから個体を外す（控えに戻す） */
function withoutAssignment(assignments: AssignmentMap, uid: string): AssignmentMap {
  return Object.fromEntries(Object.entries(assignments).filter(([key]) => key !== uid));
}

/** 札ごとの行（名前が札名の region） */
function row(fudaName: string): HTMLElement {
  return getFudaRegion(document.body, fudaName);
}

/** 艦種のまとまり（名前が艦種名の group） */
function typeGroup(fudaRow: HTMLElement, typeName: string): HTMLElement {
  return within(fudaRow).getByRole("group", { name: typeName });
}

/** 札の色の帯の「–」（特効なし）。全角の「－」・半角の「-」でもよい */
const NO_BOOST_DASH = /[–－-]/;

// ---- テスト ----

describe("一覧の本文（ListBoard）", () => {
  describe("攻略の流れ", () => {
    it("海域ごとに 1 行（E1・E2・E3 の順）を出し、各行に段階を定義の順に並べる（段階名と札名）", () => {
      // 準備・実行
      renderBoard();

      // 検証
      const timeline = getTimeline();
      expectInDocumentOrder([getAreaRow(timeline, "E1"), getAreaRow(timeline, "E2"), getAreaRow(timeline, "E3")]);
      const e2 = getAreaSteps(timeline, "E2");
      expect(e2).toHaveLength(4);
      expect(e2[0]).toHaveTextContent("ギミック");
      expect(e2[0]).toHaveTextContent("第三十一戦隊");
      expect(e2[1]).toHaveTextContent("ゲージ1 輸送");
      expect(e2[1]).toHaveTextContent("多号作戦部隊");
      expect(e2[2]).toHaveTextContent("ゲージ2");
      expect(e2[2]).toHaveTextContent("連合艦隊");
      expect(e2[3]).toHaveTextContent("ゲージ3");
      expect(e2[3]).toHaveTextContent("連合艦隊");
      expect(getAreaSteps(timeline, "E1")).toHaveLength(1);
      expect(getAreaSteps(timeline, "E3")).toHaveLength(5);
    });

    it("各段階を使う札の色で塗る（段階の data-fuda-color が定義の札の色）", () => {
      // 準備・実行
      renderBoard();

      // 検証
      const timeline = getTimeline();
      expect(getStep(timeline, "E2", "ゲージ3", "連合艦隊")).toHaveAttribute("data-fuda-color", "#4C8DF6");
      expect(getStep(timeline, "E2", "ギミック", "第三十一戦隊")).toHaveAttribute("data-fuda-color", "#8B93A1");
      expect(getStep(timeline, "E3", "ゲージ3", "第六艦隊")).toHaveAttribute("data-fuda-color", "#A97EF0");
    });

    it("各段階に「特効 n隻」（その札に割り当てた艦のうち、その段階で特効がある隻数）を出す", () => {
      // 準備・実行
      renderBoard();

      // 検証：モック Main.dc.html の数（E3 ギミックの 0 隻は出し方を決めていないので見ない）
      const timeline = getTimeline();
      const expected: [area: string, stage: string, fuda: string, count: number][] = [
        ["E1", "ギミック〜ゲージ3", "第三十一戦隊", 3],
        ["E2", "ギミック", "第三十一戦隊", 3],
        ["E2", "ゲージ1 輸送", "多号作戦部隊", 3],
        ["E2", "ゲージ2", "連合艦隊", 6],
        ["E2", "ゲージ3", "連合艦隊", 8],
        ["E3", "ゲージ1", "ウルシー攻撃部隊", 3],
        ["E3", "ゲージ2 輸送", "第三十一戦隊", 3],
        ["E3", "ゲージ3", "第六艦隊", 1],
        ["E3", "ゲージ4", "ウルシー攻撃部隊", 3],
      ];
      for (const [area, stage, fuda, count] of expected) {
        expect(getStep(timeline, area, stage, fuda), `${area} ${stage}`).toHaveTextContent(boostCountPattern(count));
      }
    });

    it("割り当てがなければ、どの段階にも 1 隻以上の「特効 n隻」を出さない（割り当てから数える）", () => {
      // 準備・実行
      renderBoard({ assignments: {} });

      // 検証
      expect(getTimeline()).not.toHaveTextContent(/特効\s*[1-9]\d*\s*隻/);
    });

    it("大事さが難所の段階（E2 ゲージ3・E3 ゲージ4）だけに「難所」の印を付ける", () => {
      // 準備・実行
      renderBoard();

      // 検証
      const timeline = getTimeline();
      expect(getStep(timeline, "E2", "ゲージ3", "連合艦隊")).toHaveTextContent("難所");
      expect(getStep(timeline, "E3", "ゲージ4", "ウルシー攻撃部隊")).toHaveTextContent("難所");
      // 重要（E2 ゲージ2）・普通の段階には付けない
      expect(getStep(timeline, "E2", "ゲージ2", "連合艦隊")).not.toHaveTextContent("難所");
      const allSteps = ["E1", "E2", "E3"].flatMap((area) => getAreaSteps(timeline, area));
      expect(allSteps.filter((step) => step.textContent?.includes("難所"))).toHaveLength(2);
    });

    it("海域・段階は定義から組み立てる（海域 E4 を足した定義なら E4 の行と段階が出る）", () => {
      // 準備・実行
      renderBoard({ definition: definitionWithEightFudas(), assignments: eightFudaAssignments });

      // 検証
      const timeline = getTimeline();
      const e4 = getAreaSteps(timeline, "E4");
      expect(e4).toHaveLength(3);
      expect(e4[0]).toHaveTextContent("仏第3艦隊");
      expect(e4[1]).toHaveTextContent("仏地中海艦隊");
      expect(e4[2]).toHaveTextContent("欧州連合艦隊");
      expect(e4[2]).toHaveTextContent("難所");
    });
  });

  describe("札ごとの行", () => {
    it("定義の札の順に、全札を 1 段ずつ出す", () => {
      // 準備・実行
      renderBoard();

      // 検証
      expectInDocumentOrder(
        ["第三十一戦隊", "多号作戦部隊", "連合艦隊", "ウルシー攻撃部隊", "第六艦隊"].map((name) => row(name)),
      );
    });

    it("札の色帯に、札名・その札を使う段階（「・」でつなぐ）・「n隻 ・ 特効 m隻」を出し、札の色を data-fuda-color に入れる", () => {
      // 準備・実行
      renderBoard();

      // 検証
      const s31 = row("第三十一戦隊");
      expect(s31).toHaveTextContent("第三十一戦隊");
      expect(s31).toHaveTextContent(/E1 ギミック〜ゲージ3\s*・\s*E2 ギミック\s*・\s*E3 ギミック\s*・\s*E3 ゲージ2 輸送/);
      expectRowCount(s31, 4, 3);
      expect(s31).toHaveAttribute("data-fuda-color", "#8B93A1");

      const rengo = row("連合艦隊");
      expect(rengo).toHaveTextContent(/E2 ゲージ2\s*・\s*E2 ゲージ3/);
      expectRowCount(rengo, 8, 8);
      expect(rengo).toHaveAttribute("data-fuda-color", "#4C8DF6");
    });

    it("各艦に艦名・「Lv 運」・その札での最大倍率のバッジ（例「×1.12」）を出す", () => {
      // 準備・実行
      renderBoard();

      // 検証
      const hatsushimo = getShipItem(row("第三十一戦隊"), "初霜改二");
      expect(hatsushimo).toHaveTextContent(/Lv\s*131/);
      expect(hatsushimo).toHaveTextContent(/運\s*48/);
      expect(hatsushimo).toHaveTextContent("×1.12");
      expect(getShipItem(row("第三十一戦隊"), "冬月改")).toHaveTextContent("×1.21");
      expect(getShipItem(row("連合艦隊"), "潮改二")).toHaveTextContent("×1.27");
      expect(getShipItem(row("連合艦隊"), "時雨改二")).toHaveTextContent("×1.24");
    });

    it("その札で特効がない艦はバッジを「–」にして薄く表示し（data-dimmed=true）、特効がある艦は薄くしない", () => {
      // 準備・実行
      renderBoard();

      // 検証
      const suzukaze = getShipItem(row("第三十一戦隊"), "涼風改二");
      expect(suzukaze).not.toHaveTextContent(/×\s*\d/);
      expect(suzukaze).toHaveTextContent(NO_BOOST_DASH);
      expect(suzukaze).toHaveAttribute("data-dimmed", "true");
      expect(getShipItem(row("第三十一戦隊"), "初霜改二")).not.toHaveAttribute("data-dimmed", "true");
    });

    it("艦を艦種ごとにまとめ、艦種名の見出しを付ける（第三十一戦隊：駆逐 3隻・軽巡 1隻）", () => {
      // 準備・実行
      renderBoard();

      // 検証
      const s31 = row("第三十一戦隊");
      expect(shipNamesIn(typeGroup(s31, "駆逐")).sort()).toEqual(["初霜改二", "冬月改", "涼風改二"].sort());
      expect(shipNamesIn(typeGroup(s31, "軽巡"))).toEqual(["五十鈴改二"]);
      expect(within(typeGroup(s31, "駆逐")).getByText("駆逐")).toBeInTheDocument();
    });

    it("艦種のまとまりは艦種の順（戦艦 → 軽巡 → 駆逐）に並べ、艦種の中は Lv の高い順に並べる", () => {
      // 準備・実行
      renderBoard();

      // 検証
      const rengo = row("連合艦隊");
      expectInDocumentOrder([typeGroup(rengo, "戦艦"), typeGroup(rengo, "軽巡"), typeGroup(rengo, "駆逐")]);
      expect(shipNamesIn(typeGroup(rengo, "駆逐"))).toEqual(["雪風改二", "長波改二", "潮改二", "時雨改二"]);
    });

    it("控えの艦（どの札にも割り当てていない艦）は出さない（「札なしの特効艦」の段は作らない）", () => {
      // 準備・実行
      renderBoard();

      // 検証：浜波改・利根改二は控え（割り当てた艦は出ている）
      expect(getShipItem(row("多号作戦部隊"), "朝霜改二")).toBeInTheDocument();
      expect(screen.queryByText("浜波改")).not.toBeInTheDocument();
      expect(screen.queryByText("利根改二")).not.toBeInTheDocument();
    });

    it("定義にない札への割り当ては出さない（数にも入れない）", () => {
      // 準備・実行：浜波改を定義にない札に割り当てている
      renderBoard({ assignments: { ...summer2026Assignments, hamanami: "removed-fuda" } });

      // 検証
      expect(screen.queryByText("浜波改")).not.toBeInTheDocument();
      expectRowCount(row("第三十一戦隊"), 4, 3);
    });

    it("同名艦は別の個体として 2 隻とも出し、「サブ」と書かない（Lv と運で見分ける）", () => {
      // 準備・実行：控えの朝霜改二（Lv92）も多号作戦部隊に置く
      renderBoard({ assignments: { ...summer2026Assignments, asashimo2: "tago" } });

      // 検証
      const tago = row("多号作戦部隊");
      expect(getShipItem(tago, "朝霜改二", 140)).toHaveTextContent(/運\s*34/);
      expect(getShipItem(tago, "朝霜改二", 92)).toHaveTextContent(/運\s*20/);
      expectRowCount(tago, 4, 4);
      expect(screen.queryByText(/サブ/)).not.toBeInTheDocument();
    });

    it("艦船マスタにない艦も「名前が分からない艦」として札の行に出し、特効なしとして扱う", () => {
      // 準備・実行
      renderBoard({
        ships: [...summer2026Ships, unknownShip],
        assignments: { ...summer2026Assignments, [unknownShip.uid]: "sixth" },
      });

      // 検証
      const sixth = row("第六艦隊");
      const unknown = getShipItem(sixth, UNKNOWN_SHIP_NAME);
      expect(unknown).toHaveTextContent(/Lv\s*1(?!\d)/);
      expect(unknown).not.toHaveTextContent(/×\s*\d/);
      expect(unknown).toHaveAttribute("data-dimmed", "true");
      expectRowCount(sixth, 2, 1);
    });

    it("艦がいない札も行を出し、「まだ割り当てがありません」と「0隻 ・ 特効 0隻」を出す（艦がいる札には出さない）", () => {
      // 準備・実行：第六艦隊の伊41改を控えに戻す
      renderBoard({ assignments: withoutAssignment(summer2026Assignments, "i41") });

      // 検証
      const sixth = row("第六艦隊");
      expect(sixth).toHaveTextContent("まだ割り当てがありません");
      expectRowCount(sixth, 0, 0);
      expect(shipItems(sixth)).toHaveLength(0);
      expect(row("連合艦隊")).not.toHaveTextContent("まだ割り当てがありません");
    });

    it("札は定義から組み立てる（札が 8 つの定義なら 8 段出す）", () => {
      // 準備・実行
      renderBoard({ definition: definitionWithEightFudas(), assignments: eightFudaAssignments });

      // 検証
      expectInDocumentOrder(
        ["第六艦隊", "仏第3艦隊", "仏地中海艦隊", "欧州連合艦隊"].map((name) => row(name)),
      );
      expect(getShipItem(row("仏地中海艦隊"), "利根改二")).toBeInTheDocument();
    });

    it("見るだけの画面なので、札の行に操作の部品（ボタン・チェックボックス）を置かない", () => {
      // 準備・実行
      renderBoard();

      // 検証
      for (const name of ["第三十一戦隊", "連合艦隊", "第六艦隊"]) {
        expect(within(row(name)).queryAllByRole("button"), name).toHaveLength(0);
        expect(within(row(name)).queryAllByRole("checkbox"), name).toHaveLength(0);
      }
    });
  });

  describe("表示の切り替え（U24）", () => {
    it("初めは「艦種ごとに並べる」が ON、「特効艦だけ」が OFF", () => {
      // 準備・実行
      renderBoard();

      // 検証
      expect(screen.getByRole("button", { name: "艦種ごとに並べる" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "特効艦だけ" })).toHaveAttribute("aria-pressed", "false");
    });

    it("「艦種ごとに並べる」を OFF にすると、艦種の区切りをなくして札の中を Lv の高い順に並べる。ON に戻すと区切りが戻る", async () => {
      // 準備
      const { user } = renderBoard();
      const toggle = screen.getByRole("button", { name: "艦種ごとに並べる" });

      // 実行
      await user.click(toggle);

      // 検証
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      const rengo = row("連合艦隊");
      expect(within(rengo).queryAllByRole("group")).toHaveLength(0);
      expect(shipNamesIn(rengo)).toEqual([
        "長門改二",
        "雪風改二",
        "瑞鶴改二甲",
        "北上改二",
        "矢矧改二乙",
        "長波改二",
        "潮改二",
        "時雨改二",
      ]);

      // 実行・検証：ON に戻す
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(typeGroup(row("連合艦隊"), "駆逐")).toBeInTheDocument();
    });

    it("「特効艦だけ」を ON にすると、その札で特効がない艦を隠す（札の色帯の隻数は変えない）。OFF に戻すと出る", async () => {
      // 準備
      const { user } = renderBoard();
      const toggle = screen.getByRole("button", { name: "特効艦だけ" });

      // 実行
      await user.click(toggle);

      // 検証
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      const s31 = row("第三十一戦隊");
      expect(shipNamesIn(s31).sort()).toEqual(["五十鈴改二", "初霜改二", "冬月改"].sort());
      expect(within(s31).queryByText("涼風改二")).not.toBeInTheDocument();
      expectRowCount(s31, 4, 3);

      // 実行・検証：OFF に戻す
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(getShipItem(row("第三十一戦隊"), "涼風改二")).toBeInTheDocument();
    });

    it("「特効艦だけ」は札ごとに判定する（別の札では特効がある艦でも、その札で効かなければ隠す）", async () => {
      // 準備：雪風改二（第三十一戦隊でも連合艦隊でも特効あり）を第六艦隊（伊41・伊168 だけに効く）に置く
      const { user } = renderBoard({ assignments: { ...summer2026Assignments, yukikaze: "sixth" } });

      // 実行
      await user.click(screen.getByRole("button", { name: "特効艦だけ" }));

      // 検証
      const sixth = row("第六艦隊");
      expect(shipNamesIn(sixth)).toEqual(["伊41改"]);
    });

    it("「艦種ごとに並べる」OFF と「特効艦だけ」ON を合わせると、特効がある艦だけを Lv の高い順に並べる", async () => {
      // 準備
      const { user } = renderBoard();

      // 実行
      await user.click(screen.getByRole("button", { name: "艦種ごとに並べる" }));
      await user.click(screen.getByRole("button", { name: "特効艦だけ" }));

      // 検証
      const s31 = row("第三十一戦隊");
      expect(within(s31).queryAllByRole("group")).toHaveLength(0);
      expect(shipNamesIn(s31)).toEqual(["五十鈴改二", "初霜改二", "冬月改"]);
    });
  });
});
