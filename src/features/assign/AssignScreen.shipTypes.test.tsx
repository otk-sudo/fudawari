// 割り振り画面（AssignScreen）で、艦種で絞った国籍の特効グループ（v1.1「国籍の特効を艦種で絞る」の仕様 7 章）が効くことの画面テスト
//
// 割り振り画面は特効の計算（src/domain/boost）の結果を使うだけなので、ここでは「アメリカ・駆逐 ×1.2」のグループで
// 米駆逐艦にだけ倍率が出て、米戦艦（Iowa改）・日本の駆逐艦（時雨改二）には ×1.20 が出ないことを確かめる。
// 部品の探し方（role・名前・属性）は src/test/assign-screen.ts の冒頭にまとめてある。
//
// テスト用データ（src/test/fixtures/shipType.ts・nationality.ts）
// - 定義：2026夏イベの E2 ゲージ3（連合艦隊・難所）に「米駆逐」×1.20（艦名なし・国籍 アメリカ・艦種 駆逐）を足したもの
// - マスタ：仮マスタ ＋ 国籍の艦（Iowa改〔米戦艦〕・Samuel B.Roberts改〔米駆逐〕・Warspite改・謎の艦）＋ Johnston改（米駆逐）
// - 艦：モックの所持艦 31 隻 ＋ 国籍の 4 隻 ＋ Johnston改（どれも初めは控え）。割り当ては一覧の割り当て（時雨改二は連合艦隊）
// - 米駆逐艦を連合艦隊に置くと E2 ゲージ3 ×1.20、スコア +60。ほかの札では特効なし
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import { AssignScreen } from "@/features/assign/AssignScreen";
import type { SaveAssignments } from "@/features/assign/assign-store";
import { getCard, getColumn, getPanel, getTray, MULTIPLIER, queryCard } from "@/test/assign-screen";
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

const MASTER = createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries, ...shipTypeMasterEntries]);
const SHIPS = [...summer2026Ships, ...nationalityShips, ...shipTypeShips];

/** 割り振り画面の中身を描く（定義は「米駆逐」×1.20 を足したもの） */
function renderScreen(assignments: AssignmentMap = summer2026Assignments) {
  const save = vi.fn<SaveAssignments>(() => Promise.resolve());
  const user = userEvent.setup();
  render(
    <AssignScreen
      definition={summer2026DefinitionWithUsaDestroyerBoost}
      master={MASTER}
      ships={SHIPS}
      initialAssignments={assignments}
      save={save}
      returnedCount={0}
    />,
  );
  return { user, save };
}

describe("割り振り画面：艦種で絞った国籍の特効グループ（v1.1。アメリカ・駆逐 ×1.20）", () => {
  it("控えの「特効のある艦だけ」（初期）に、米駆逐艦は出て、米戦艦・英艦・国籍の分からない駆逐艦は出ない", () => {
    // 準備・実行
    renderScreen();

    // 検証
    const tray = getTray();
    expect(getCard(tray, "Johnston改")).toBeInTheDocument();
    expect(getCard(tray, "Samuel B.Roberts改")).toBeInTheDocument();
    expect(queryCard(tray, "Iowa改")).toBeNull();
    expect(queryCard(tray, "Warspite改")).toBeNull();
    expect(queryCard(tray, "謎の艦")).toBeNull();
  });

  it("米駆逐艦を選ぶと、パネルの「この艦の特効」に 連合艦隊 +60・E2 ゲージ3 ×1.20 を出し、ほかの札は「特効なし」", async () => {
    // 準備
    const { user } = renderScreen();

    // 実行
    await user.click(getCard(getTray(), "Johnston改"));

    // 検証
    const panel = getPanel();
    expect(panel).toHaveTextContent(/連合艦隊\s*\+60.*E2 ゲージ3[^×]*×1\.20.*連合艦隊に置く/);
    expect(within(panel).getByRole("button", { name: "連合艦隊に置く" })).toBeInTheDocument();
    expect(panel).toHaveTextContent(/特効なし：\s*第三十一戦隊、多号作戦部隊、ウルシー攻撃部隊、第六艦隊/);
  });

  it("米戦艦（Iowa改。国籍は当てはまるが艦種が違う）を選ぶと、倍率を出さず「特効なし」にすべての札を並べる", async () => {
    // 準備：「リセット」で特効のない艦も控えに出す
    const { user } = renderScreen();
    await user.click(within(getTray()).getByRole("button", { name: "リセット" }));

    // 実行
    await user.click(getCard(getTray(), "Iowa改"));

    // 検証
    const panel = getPanel();
    expect(panel).not.toHaveTextContent(MULTIPLIER);
    expect(panel).toHaveTextContent(/特効なし：\s*第三十一戦隊、多号作戦部隊、連合艦隊、ウルシー攻撃部隊、第六艦隊/);
  });

  it("日本の駆逐艦（時雨改二）は、米駆逐のグループの ×1.20 が掛からず、E2 ゲージ3 は元の ×1.24 のまま", async () => {
    // 準備
    const { user } = renderScreen();

    // 実行
    await user.click(getCard(getColumn("連合艦隊"), "時雨改二"));

    // 検証：×1.24 × 1.20 ＝ ×1.49 にはならない
    const panel = getPanel();
    expect(panel).toHaveTextContent(/E2 ゲージ3\s*×1\.24/);
    expect(panel).not.toHaveTextContent(/×1\.49/);
  });

  it("連合艦隊に置いた米駆逐艦は札の列で「特効あり」、米戦艦は「特効なし」", () => {
    // 準備・実行
    renderScreen({ ...summer2026Assignments, johnston: "rengo", iowa: "rengo" });

    // 検証
    const rengo = getColumn("連合艦隊");
    expect(getCard(rengo, "Johnston改")).toHaveTextContent("特効あり");
    expect(getCard(rengo, "Iowa改")).toHaveTextContent("特効なし");
  });
});

describe("割り振り画面：特効の行の国籍・艦種の内訳（v1.1「割り振りの特効の行に国籍・艦種の内訳を出す」）", () => {
  /** 米駆逐のグループで効く行（段階名・内訳の文・倍率の順） */
  const US_DESTROYER_LINE = /E2 ゲージ3\s*米駆逐（アメリカ・駆逐）\s*×1\.20/;

  it("控えの米駆逐艦（Johnston改）を選ぶと、開いたカードと選んだ艦のパネルに「E2 ゲージ3 米駆逐（アメリカ・駆逐） ×1.20」を出す", async () => {
    // 準備
    const { user } = renderScreen();

    // 実行
    await user.click(getCard(getTray(), "Johnston改"));

    // 検証
    const card = getCard(getTray(), "Johnston改");
    expect(card).toHaveAttribute("aria-expanded", "true");
    expect(card).toHaveTextContent(US_DESTROYER_LINE);
    expect(getPanel()).toHaveTextContent(US_DESTROYER_LINE);
  });

  it("連合艦隊に置いた米駆逐艦を選ぶと、札の列の開いたカードにも内訳を出す", async () => {
    // 準備
    const { user } = renderScreen({ ...summer2026Assignments, johnston: "rengo" });

    // 実行
    await user.click(getCard(getColumn("連合艦隊"), "Johnston改"));

    // 検証
    const card = getCard(getColumn("連合艦隊"), "Johnston改");
    expect(card).toHaveAttribute("aria-expanded", "true");
    expect(card).toHaveTextContent(US_DESTROYER_LINE);
  });

  it("艦名の特効だけの日本の駆逐艦（時雨改二）の行は今の文のまま「E2 ゲージ3 ×1.24」で、内訳を出さない", async () => {
    // 準備
    const { user } = renderScreen();

    // 実行
    await user.click(getCard(getColumn("連合艦隊"), "時雨改二"));

    // 検証
    const card = getCard(getColumn("連合艦隊"), "時雨改二");
    expect(card).toHaveTextContent(/E2 ゲージ2\s*×1\.19\s*E2 ゲージ3\s*×1\.24/);
    expect(card).not.toHaveTextContent("米駆逐");
    const panel = getPanel();
    expect(panel).toHaveTextContent(/E2 ゲージ2\s*×1\.19\s*E2 ゲージ3\s*×1\.24/);
    expect(panel).not.toHaveTextContent("米駆逐");
  });
});
