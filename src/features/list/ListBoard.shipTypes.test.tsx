// 一覧の本文（ListBoard）で、艦種で絞った国籍の特効グループ（v1.1「国籍の特効を艦種で絞る」の仕様 7 章）が効くことのテスト
//
// 一覧は特効の計算（src/domain/boost）の結果を使うだけなので、ここでは「アメリカ・駆逐 ×1.2」のグループで
// 米駆逐艦にだけ倍率のバッジが出て、札の行・攻略の流れの「特効 n隻」に米駆逐艦だけが数えられることを確かめる。
// 部品の探し方は src/test/list-screen.ts の冒頭にまとめてある。
//
// テスト用データ（src/test/fixtures/shipType.ts・nationality.ts）
// - 定義：2026夏イベの E2 ゲージ3（連合艦隊・難所）に「米駆逐」×1.20（艦名なし・国籍 アメリカ・艦種 駆逐）を足したもの
// - 連合艦隊：一覧の割り当ての 8 隻（すべて特効あり。時雨改二を含む）に、Johnston改（米駆逐）・Iowa改（米戦艦）・
//   Warspite改（英戦艦）を足して 11 隻
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import { ListBoard } from "@/features/list/ListBoard";
import {
  nationalityMasterEntries,
  nationalityShips,
  shipTypeMasterEntries,
  shipTypeShips,
  summer2026Assignments,
  summer2026DefinitionWithUsaDestroyerBoost,
  summer2026MasterEntries,
  summer2026Ships,
} from "@/test/fixtures";
import { boostCountPattern, expectRowCount, getFudaRegion, getShipItem, getStep, getTimeline } from "@/test/list-screen";

const master = createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries, ...shipTypeMasterEntries]);

/** 連合艦隊に米駆逐艦・米戦艦・英戦艦を足した割り当て */
const assignments: AssignmentMap = {
  ...summer2026Assignments,
  johnston: "rengo",
  iowa: "rengo",
  warspite: "rengo",
};

/** 特効なしのバッジ「–」（全角の「－」・半角の「-」でもよい） */
const NO_BOOST_DASH = /[–－-]/;

function renderBoard(): void {
  render(
    <ListBoard
      definition={summer2026DefinitionWithUsaDestroyerBoost}
      master={master}
      ships={[...summer2026Ships, ...nationalityShips, ...shipTypeShips]}
      assignments={assignments}
    />,
  );
}

describe("一覧の本文：艦種で絞った国籍の特効グループ（v1.1。アメリカ・駆逐 ×1.20）", () => {
  it("米駆逐艦のバッジは、その札での最大倍率「×1.20」で、薄くしない", () => {
    // 準備・実行
    renderBoard();

    // 検証
    const johnston = getShipItem(getFudaRegion(document.body, "連合艦隊"), "Johnston改");
    expect(johnston).toHaveTextContent("×1.20");
    expect(johnston).not.toHaveAttribute("data-dimmed", "true");
  });

  it("米戦艦（国籍は当てはまるが艦種が違う）・英戦艦は、バッジが「–」で薄く表示する", () => {
    // 準備・実行
    renderBoard();

    // 検証
    const rengo = getFudaRegion(document.body, "連合艦隊");
    for (const name of ["Iowa改", "Warspite改"]) {
      const item = getShipItem(rengo, name);
      expect(item, name).toHaveTextContent(NO_BOOST_DASH);
      expect(item, name).not.toHaveTextContent(/×\s*\d/);
      expect(item, name).toHaveAttribute("data-dimmed", "true");
    }
  });

  it("日本の駆逐艦（時雨改二）のバッジは元の「×1.24」のまま（米駆逐の ×1.20 は掛からない）", () => {
    // 準備・実行
    renderBoard();

    // 検証
    const shigure = getShipItem(getFudaRegion(document.body, "連合艦隊"), "時雨改二");
    expect(shigure).toHaveTextContent("×1.24");
    expect(shigure).not.toHaveTextContent("×1.49");
  });

  it("札の行の「n隻 ・ 特効 m隻」に、米駆逐艦だけを足して数える（連合艦隊 11隻 ・ 特効 9隻）", () => {
    // 準備・実行
    renderBoard();

    // 検証
    expectRowCount(getFudaRegion(document.body, "連合艦隊"), 11, 9);
  });

  it("攻略の流れの「特効 n隻」は、米駆逐のグループのある E2 ゲージ3 だけ 1 隻増える（8 → 9。E2 ゲージ2 は 6 のまま）", () => {
    // 準備・実行
    renderBoard();

    // 検証
    const timeline = getTimeline();
    expect(getStep(timeline, "E2", "ゲージ3", "連合艦隊")).toHaveTextContent(boostCountPattern(9));
    expect(getStep(timeline, "E2", "ゲージ2", "連合艦隊")).toHaveTextContent(boostCountPattern(6));
  });
});
