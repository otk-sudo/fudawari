// 一覧の本文（ListBoard）で、国籍の条件の特効グループ（v1.1「特効グループに国籍の条件を足す」の仕様 8 章）が効くことのテスト
//
// 一覧は特効の計算（src/domain/boost）の結果を使うだけなので、ここでは国籍のグループで効く艦の
// 倍率のバッジ・札の行の「特効 n隻」・攻略の流れの段階の「特効 n隻」に出ることを確かめる。
// 部品の探し方は src/test/list-screen.ts の冒頭にまとめてある。
//
// テスト用データ（src/test/fixtures/nationality.ts）
// - 定義：2026夏イベの E2 ゲージ3（連合艦隊・難所）に「米艦」×1.20（艦名なし・国籍 アメリカ）を足したもの
// - 連合艦隊：一覧の割り当ての 8 隻（すべて特効あり）に、Iowa改（米）・Warspite改（英）・謎の艦（国籍 unknown）を足して 11 隻
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import { ListBoard } from "@/features/list/ListBoard";
import {
  nationalityMasterEntries,
  nationalityShips,
  summer2026Assignments,
  summer2026DefinitionWithUsaBoost,
  summer2026MasterEntries,
  summer2026Ships,
} from "@/test/fixtures";
import { boostCountPattern, expectRowCount, getFudaRegion, getShipItem, getStep, getTimeline } from "@/test/list-screen";

const master = createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries]);

/** 連合艦隊に米艦・英艦・国籍の分からない艦を足した割り当て */
const assignments: AssignmentMap = {
  ...summer2026Assignments,
  iowa: "rengo",
  warspite: "rengo",
  mystery: "rengo",
};

/** 特効なしのバッジ「–」（全角の「－」・半角の「-」でもよい） */
const NO_BOOST_DASH = /[–－-]/;

function renderBoard(): void {
  render(
    <ListBoard
      definition={summer2026DefinitionWithUsaBoost}
      master={master}
      ships={[...summer2026Ships, ...nationalityShips]}
      assignments={assignments}
    />,
  );
}

describe("一覧の本文：国籍の条件の特効グループ（v1.1）", () => {
  it("国籍のグループで効く米艦のバッジは、その札での最大倍率「×1.20」で、薄くしない", () => {
    // 準備・実行
    renderBoard();

    // 検証
    const iowa = getShipItem(getFudaRegion(document.body, "連合艦隊"), "Iowa改");
    expect(iowa).toHaveTextContent("×1.20");
    expect(iowa).not.toHaveAttribute("data-dimmed", "true");
  });

  it("国籍のグループに当てはまらない英艦・国籍の分からない艦は、バッジが「–」で薄く表示する", () => {
    // 準備・実行
    renderBoard();

    // 検証
    const rengo = getFudaRegion(document.body, "連合艦隊");
    for (const name of ["Warspite改", "謎の艦"]) {
      const item = getShipItem(rengo, name);
      expect(item, name).toHaveTextContent(NO_BOOST_DASH);
      expect(item, name).not.toHaveTextContent(/×\s*\d/);
      expect(item, name).toHaveAttribute("data-dimmed", "true");
    }
  });

  it("札の行の「n隻 ・ 特効 m隻」に、国籍のグループで効く艦を数える（連合艦隊 11隻 ・ 特効 9隻）", () => {
    // 準備・実行
    renderBoard();

    // 検証
    expectRowCount(getFudaRegion(document.body, "連合艦隊"), 11, 9);
  });

  it("攻略の流れの「特効 n隻」は、米艦のグループのある E2 ゲージ3 だけ 1 隻増える（8 → 9。E2 ゲージ2 は 6 のまま）", () => {
    // 準備・実行
    renderBoard();

    // 検証
    const timeline = getTimeline();
    expect(getStep(timeline, "E2", "ゲージ3", "連合艦隊")).toHaveTextContent(boostCountPattern(9));
    expect(getStep(timeline, "E2", "ゲージ2", "連合艦隊")).toHaveTextContent(boostCountPattern(6));
  });
});
