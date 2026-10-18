// 選択中の艦のパネル（SelectedShipPanel）の「この艦の特効」の段階の行に、国籍・艦種の内訳の文を出すことの部品テスト
// （v1.1「割り振りの特効の行に国籍・艦種の内訳を出す」§2）
//
// - 国籍（・艦種）の条件で効くグループがある行は、段階名と倍率の間に「米駆逐（アメリカ・駆逐）」
// - 艦名の特効だけの行は今の文のまま「E2 ゲージ3 ×1.24」
//
// テスト用データ：2026夏イベの E2 ゲージ3（連合艦隊・難所）に「米駆逐」×1.20（国籍 アメリカ・艦種 駆逐）を足した定義、
// 仮マスタ ＋ 国籍の艦 ＋ Johnston改（米駆逐）。個体の特効のまとめは shipEntryOf（画面と同じ）で作る
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createShipMaster } from "@/domain/master";
import type { OwnedShip } from "@/domain/ship/types";
import {
  nationalityMasterEntries,
  shipByUid,
  shipTypeMasterEntries,
  shipTypeShips,
  summer2026DefinitionWithUsaDestroyerBoost,
  summer2026MasterEntries,
} from "@/test/fixtures";
import { SelectedShipPanel } from "./SelectedShipPanel";
import { fudaMapOf, shipEntryOf } from "./ship-view";

const def = summer2026DefinitionWithUsaDestroyerBoost;
const master = createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries, ...shipTypeMasterEntries]);

function shipOf(uid: string): OwnedShip {
  return shipTypeShips.find((s) => s.uid === uid) ?? shipByUid(uid);
}

/** 選択中の艦のパネルを描く（いまは控え） */
function renderPanel(uid: string): HTMLElement {
  render(
    <SelectedShipPanel
      definition={def}
      fudas={fudaMapOf(def)}
      entry={shipEntryOf(def, master, shipOf(uid))}
      placedFudaId={null}
      onPlace={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return screen.getByRole("region", { name: "選択中の艦" });
}

describe("選択中の艦のパネル：段階の行の国籍・艦種の内訳", () => {
  it("米駆逐艦（Johnston改）の連合艦隊の行に「E2 ゲージ3 米駆逐（アメリカ・駆逐） ×1.20」を出す", () => {
    // 準備・実行
    const panel = renderPanel("johnston");

    // 検証：段階名・内訳の文・倍率の順。内訳の文は別の要素（小さい文字）
    expect(panel).toHaveTextContent(/連合艦隊\s*\+60\s*E2 ゲージ3\s*米駆逐（アメリカ・駆逐）\s*×1\.20\s*連合艦隊に置く/);
    expect(within(panel).getByText("米駆逐（アメリカ・駆逐）")).toBeInTheDocument();
  });

  it("艦名の特効だけの艦（時雨改二）の行は今の文のまま「E2 ゲージ3 ×1.24」で、内訳を出さない", () => {
    // 準備・実行
    const panel = renderPanel("shigure2");

    // 検証
    expect(panel).toHaveTextContent(/E2 ゲージ2\s*×1\.19\s*E2 ゲージ3\s*×1\.24/);
    expect(panel).not.toHaveTextContent("米駆逐");
    expect(panel).not.toHaveTextContent(/（アメリカ/);
  });
});
