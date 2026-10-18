// 艦カード（ShipCard）の開いたときの段階の行に、国籍・艦種の内訳の文（BoostLine の note）を出すことの部品テスト
// （v1.1「割り振りの特効の行に国籍・艦種の内訳を出す」§2）
//
// - 内訳の文は、段階名と倍率の間に小さい文字で出す（モック Assign.dc.html の段階の行の「艦種 …」の位置）
// - note が null の行（艦名の特効だけの行）は今の文のまま「E2 ゲージ3 ×1.24」
// 艦カードは押したときの知らせと見た目だけの部品なので、行（lines）は直接渡す。
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShipUid } from "@/domain/ship/types";
import { ShipCard, type ShipCardProps } from "./ShipCard";
import type { BoostLine } from "./ship-view";

// ---- テストの補助 ----

/** 連合艦隊の色（2026夏イベの定義） */
const RENGO = "#4C8DF6";

const usDestroyerLine: BoostLine = {
  key: "rengo:E2-3",
  color: RENGO,
  label: "E2 ゲージ3",
  multiplier: 1.2,
  note: "米駆逐（アメリカ・駆逐）",
};
const namedLine: BoostLine = { key: "rengo:E2-2", color: RENGO, label: "E2 ゲージ2", multiplier: 1.19, note: null };

/** 開いた艦カードを描く（Johnston改。lines だけを変える） */
function renderCard(patch: Partial<ShipCardProps> = {}): HTMLElement {
  const onPress = vi.fn<(uid: ShipUid) => void>();
  render(
    <ShipCard
      uid="johnston"
      name="Johnston改"
      typeLabel="駆逐"
      level={127}
      luck={52}
      dense={false}
      hasBoost
      stripeColor={RENGO}
      selected={false}
      expanded
      lines={[usDestroyerLine]}
      noBoostText="特効なし"
      onPress={onPress}
      {...patch}
    />,
  );
  return screen.getByRole("button", { name: /Johnston改/ });
}

describe("艦カード：段階の行の国籍・艦種の内訳（note）", () => {
  it("開いたカードの行に、段階名・内訳の文・倍率の順で「E2 ゲージ3 米駆逐（アメリカ・駆逐） ×1.20」を出す", () => {
    // 準備・実行
    const card = renderCard();

    // 検証
    expect(card).toHaveTextContent(/E2 ゲージ3\s*米駆逐（アメリカ・駆逐）\s*×1\.20/);
  });

  it("内訳の文は段階名・倍率とは別の要素に入れる（小さい文字で出すため）", () => {
    const card = renderCard();

    expect(within(card).getByText("米駆逐（アメリカ・駆逐）")).toBeInTheDocument();
  });

  it("note が null の行（艦名の特効だけ）は、今の文のまま「E2 ゲージ2 ×1.19」で、内訳を出さない", () => {
    // 準備・実行：艦名だけの行と国籍・艦種の行を並べる
    const card = renderCard({ lines: [namedLine, usDestroyerLine] });

    // 検証
    expect(card).toHaveTextContent(/E2 ゲージ2\s*×1\.19\s*E2 ゲージ3\s*米駆逐（アメリカ・駆逐）\s*×1\.20/);
    expect(within(card).getAllByText(/（アメリカ/)).toHaveLength(1);
  });

  it("閉じたカードには段階の行も内訳も出さない", () => {
    const card = renderCard({ expanded: false, lines: [] });

    expect(card).not.toHaveTextContent("米駆逐");
    expect(card).not.toHaveTextContent(/×\s*\d/);
  });
});
