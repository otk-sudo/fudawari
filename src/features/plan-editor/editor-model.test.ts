// 定義画面の表示の補助（editor-model.ts）のうち、下書きの検証の誤りを画面の言葉にする describeDraftError のテスト
// v1.1「特効グループに国籍の条件を足す」で、特効グループの項目に国籍（nationalities）が増えたことを確かめる
import { describe, expect, it } from "vitest";
import { summer2026Definition } from "@/test/fixtures";
import { describeDraftError } from "./editor-model";

/** テスト用の定義で、E2 ゲージ3 の段階の配列の位置（連合艦隊C はその最初のグループ） */
const E2_3 = summer2026Definition.stages.findIndex((s) => s.id === "E2-3");

describe("describeDraftError（下書きの検証の誤りを画面の言葉にする）", () => {
  it("特効グループの国籍の誤りは「「E2 ゲージ3」の特効「連合艦隊C」の国籍：理由」（v1.1）", () => {
    const text = describeDraftError(summer2026Definition, {
      code: "invalid_value",
      path: `stages[${E2_3}].boosts[0].nationalities[1]`,
      message: "選べない国籍です",
    });

    expect(text).toBe("「E2 ゲージ3」の特効「連合艦隊C」の国籍：選べない国籍です");
  });

  it("特効グループの国籍の項目そのものの誤り（配列でない）も「…の国籍：理由」", () => {
    const text = describeDraftError(summer2026Definition, {
      code: "invalid_type",
      path: `stages[${E2_3}].boosts[0].nationalities`,
      message: "配列にしてください",
    });

    expect(text).toBe("「E2 ゲージ3」の特効「連合艦隊C」の国籍：配列にしてください");
  });

  it("特効グループの艦種の誤りは「「E2 ゲージ3」の特効「連合艦隊C」の艦種：理由」（v1.1。国籍の条件を絞る shipTypes）", () => {
    const text = describeDraftError(summer2026Definition, {
      code: "invalid_value",
      path: `stages[${E2_3}].boosts[0].shipTypes[1]`,
      message: "選べない艦種です",
    });

    expect(text).toBe("「E2 ゲージ3」の特効「連合艦隊C」の艦種：選べない艦種です");
  });

  it("特効グループの艦種の項目そのものの誤り（国籍なし）も「…の艦種：理由」", () => {
    const text = describeDraftError(summer2026Definition, {
      code: "invalid_value",
      path: `stages[${E2_3}].boosts[0].shipTypes`,
      message: "艦種は国籍と一緒に選んでください（艦種だけの特効は扱いません）",
    });

    expect(text).toBe(
      "「E2 ゲージ3」の特効「連合艦隊C」の艦種：艦種は国籍と一緒に選んでください（艦種だけの特効は扱いません）",
    );
  });

  it("艦名の誤りは今までどおり「…の艦名：理由」", () => {
    const text = describeDraftError(summer2026Definition, {
      code: "invalid_value",
      path: `stages[${E2_3}].boosts[0].shipNames[1]`,
      message: "艦名は空にはできません",
    });

    expect(text).toBe("「E2 ゲージ3」の特効「連合艦隊C」の艦名：艦名は空にはできません");
  });
});
