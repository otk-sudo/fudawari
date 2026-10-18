// 割り振り画面（AssignScreen）で、国籍の条件の特効グループ（v1.1「特効グループに国籍の条件を足す」の仕様 8 章）が効くことの画面テスト
//
// 割り振り画面は特効の計算（src/domain/boost）の結果を使うだけなので、ここでは国籍のグループで効く艦の倍率が
// 「この艦の特効」・開いた艦カード・札の列の特効の印・控えの「特効のある艦だけ」に出ることを確かめる。
// 部品の探し方（role・名前・属性）は src/test/assign-screen.ts の冒頭にまとめてある。
//
// テスト用データ（src/test/fixtures/nationality.ts）
// - 定義：2026夏イベの E2 ゲージ3（連合艦隊・難所）に「米艦」×1.20（艦名なし・国籍 アメリカ）を足したもの
// - マスタ：仮マスタ ＋ Iowa改（米）・Samuel B.Roberts改（米）・Warspite改（英）・謎の艦（国籍 unknown）
// - 艦：モックの所持艦 31 隻 ＋ 上の 4 隻（どれも初めは控え）。割り当ては一覧の割り当て
// - Iowa改（Lv161）を連合艦隊に置くと E2 ゲージ3 ×1.20、スコア +60。ほかの札では特効なし
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
  summer2026Assignments,
  summer2026DefinitionWithUsaBoost,
  summer2026MasterEntries,
  summer2026Ships,
} from "@/test/fixtures";

const MASTER = createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries]);
const SHIPS = [...summer2026Ships, ...nationalityShips];

/** 割り振り画面の中身を描く（定義は「米艦」×1.20 を足したもの） */
function renderScreen(assignments: AssignmentMap = summer2026Assignments) {
  const save = vi.fn<SaveAssignments>(() => Promise.resolve());
  const user = userEvent.setup();
  render(
    <AssignScreen
      definition={summer2026DefinitionWithUsaBoost}
      master={MASTER}
      ships={SHIPS}
      initialAssignments={assignments}
      save={save}
      returnedCount={0}
    />,
  );
  return { user, save };
}

describe("割り振り画面：国籍の条件の特効グループ（v1.1）", () => {
  it("控えの「特効のある艦だけ」（初期）に、国籍のグループで効く米艦は出て、英艦・国籍の分からない艦は出ない", () => {
    // 準備・実行
    renderScreen();

    // 検証
    const tray = getTray();
    expect(getCard(tray, "Iowa改")).toBeInTheDocument();
    expect(getCard(tray, "Samuel B.Roberts改")).toBeInTheDocument();
    expect(queryCard(tray, "Warspite改")).toBeNull();
    expect(queryCard(tray, "謎の艦")).toBeNull();
  });

  it("米艦を選ぶと、パネルの「この艦の特効」に 連合艦隊 +60・E2 ゲージ3 ×1.20・「連合艦隊に置く」を出し、ほかの札は「特効なし」", async () => {
    // 準備
    const { user } = renderScreen();

    // 実行
    await user.click(getCard(getTray(), "Iowa改"));

    // 検証
    const panel = getPanel();
    expect(panel).toHaveTextContent("この艦の特効（効く札の順）");
    expect(panel).toHaveTextContent(/連合艦隊\s*\+60.*E2 ゲージ3[^×]*×1\.20.*連合艦隊に置く/);
    expect(within(panel).getByRole("button", { name: "連合艦隊に置く" })).toBeInTheDocument();
    expect(panel).toHaveTextContent(/特効なし：\s*第三十一戦隊、多号作戦部隊、ウルシー攻撃部隊、第六艦隊/);
  });

  it("米艦を選ぶと、開いたカードに E2 ゲージ3 ×1.20 を出す", async () => {
    // 準備
    const { user } = renderScreen();

    // 実行
    await user.click(getCard(getTray(), "Samuel B.Roberts改"));

    // 検証
    const card = getCard(getTray(), "Samuel B.Roberts改");
    expect(card).toHaveAttribute("aria-expanded", "true");
    expect(card).toHaveTextContent(/E2 ゲージ3[^×]*×1\.20/);
  });

  it("英艦（国籍のグループに当てはまらない）を選ぶと、倍率を出さず「特効なし」にすべての札を並べる", async () => {
    // 準備：「リセット」で特効のない艦も控えに出す
    const { user } = renderScreen();
    await user.click(within(getTray()).getByRole("button", { name: "リセット" }));

    // 実行
    await user.click(getCard(getTray(), "Warspite改"));

    // 検証
    const panel = getPanel();
    expect(panel).not.toHaveTextContent(MULTIPLIER);
    expect(panel).toHaveTextContent(/特効なし：\s*第三十一戦隊、多号作戦部隊、連合艦隊、ウルシー攻撃部隊、第六艦隊/);
  });

  it("連合艦隊に置いた米艦は札の列で「特効あり」、英艦は「特効なし」", () => {
    // 準備・実行
    renderScreen({ ...summer2026Assignments, iowa: "rengo", warspite: "rengo" });

    // 検証
    const rengo = getColumn("連合艦隊");
    expect(getCard(rengo, "Iowa改")).toHaveTextContent("特効あり");
    expect(getCard(rengo, "Warspite改")).toHaveTextContent("特効なし");
  });
});
